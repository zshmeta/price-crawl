import { log } from 'crawlee';
import { getRedisStore, type DataRecord } from './redis-store.js';
import { normalizeTableData } from './normalizer.js';
import { detectChallengePage, validateRecords, meetsMinimumQuality } from './validator.js';
import { generateRecordId } from './id-generator.js';

export interface BrowserlessConfig {
    category: string;
    region: string;
    targetUrl: string;
    rowSelector?: string;
    onStatusChange?: (status: 'idle' | 'scraping' | 'error' | 'sleeping') => void;
    onDataStored?: (count: number) => void;
}

const DEFAULT_ROW_SELECTOR = '.datatable-v2_row__hkEus';

/**
 * Scrapes price data using the browserless npm package.
 * This provides better anti-bot evasion than raw Playwright.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const createBrowser = require('browserless');

export async function scrapeWithBrowserless(config: BrowserlessConfig): Promise<DataRecord[]> {
    const rowSelector = config.rowSelector || DEFAULT_ROW_SELECTOR;
    
    // Here we create a browserless browser instance with sensible defaults matching the README
    const browser = createBrowser({
        timeout: 30000,
        lossyDeviceName: true,
        ignoreHTTPSErrors: true
    });
    
    let browserless: any = null;
    
    try {
        log.info(`[Browserless/${config.category}/${config.region}] Starting scrape of ${config.targetUrl}`);
        config.onStatusChange?.('scraping');
        
        // Here we create a browser context (like opening a new tab)
        browserless = await browser.createContext({ retry: 2 });
        
        // Here we use the evaluate method to run custom extraction logic
        const extractData = browserless.evaluate(async (page: any) => {
            // Check for challenge page
            const pageTitle = await page.title();
            const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 1000));
            
            // Extract headers
            const headerElements = await page.$$('th');
            const headers: string[] = [];
            for (const th of headerElements) {
                const text = await page.evaluate((el: any) => el.textContent?.trim() || '', th);
                if (text) headers.push(text);
            }
            
            // Wait for the table rows to appear
            try {
                await page.waitForSelector(rowSelector, { timeout: 20000 });
            } catch {
                return { pageTitle, bodyText, headers: [], rows: [] };
            }
            
            // Extract data from the table rows
            const rawRows = await page.$$eval(rowSelector, (rows: Element[]) => {
                return rows.map(row => {
                    const nameEl = row.querySelector('h4') || row.querySelector('a.font-semibold');
                    const name = nameEl?.textContent?.trim();
                    
                    if (!name) return null;
                    
                    // Extract href if available
                    const linkEl = row.querySelector('a[href]');
                    const href = linkEl?.getAttribute('href') || undefined;
                    
                    // Extract all cell values
                    const cells = Array.from(row.querySelectorAll('td'));
                    const cellValues = cells.map(cell => cell.textContent?.trim() || '');
                    
                    return {
                        name,
                        href,
                        cells: cellValues,
                    };
                }).filter((item: any) => item !== null);
            });
            
            return {
                pageTitle,
                bodyText,
                headers,
                rows: rawRows,
            };
        }, { 
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
        const extractedData = await extractData(config.targetUrl);
        
        // Check for challenge page
        const challengeResult = detectChallengePage({
            url: config.targetUrl,
            title: extractedData.pageTitle,
            bodyText: extractedData.bodyText,
        });
        
        if (challengeResult.isBlocked) {
            log.warning(
                `[Browserless/${config.category}/${config.region}] Challenge page detected: ${challengeResult.reasons.join(', ')}`
            );
            return [];
        }
        
        log.info(`[Browserless/${config.category}/${config.region}] Extracted ${extractedData.rows.length} raw rows`);
        
        if (extractedData.rows.length === 0) {
            return [];
        }
        
        // Normalize the raw data using header mapping
        const includeTrace = process.env.STORE_RAW_TRACE === '1';
        const normalizedRecords = normalizeTableData(
            {
                url: config.targetUrl,
                scrapedAt: new Date().toISOString(),
                headers: extractedData.headers,
                rows: extractedData.rows,
            },
            config.category,
            config.region,
            includeTrace
        );
        
        // Validate records
        const validRecords = validateRecords(normalizedRecords, config.category, config.region);
        
        if (!meetsMinimumQuality(validRecords)) {
            log.warning(`[Browserless/${config.category}/${config.region}] No valid records after validation`);
            return [];
        }
        
        // Add IDs to records
        const recordsWithIds: DataRecord[] = validRecords.map(record => ({
            id: generateRecordId(record.name, record.region, (record as any).href),
            ...record,
        }));
        
        return recordsWithIds;
        
    } catch (error) {
        log.error(`[Browserless/${config.category}/${config.region}] Error: ${error}`);
        config.onStatusChange?.('error');
        throw error;
    } finally {
        // Here we clean up resources
        if (browserless) {
            await browserless.destroyContext();
        }
        await browser.close();
    }
}

/**
 * Runs a full scrape cycle using Browserless and stores results.
 */
export async function runBrowserlessScrape(config: BrowserlessConfig): Promise<number> {
    const records = await scrapeWithBrowserless(config);
    
    if (records.length === 0) {
        log.warning(`[Browserless/${config.category}/${config.region}] No data extracted`);
        return 0;
    }
    
    // Here we save records using the same Redis store as the main crawler
    const store = await getRedisStore(config.category);
    await store.push(records);
    
    log.info(`[Browserless/${config.category}/${config.region}] Stored ${records.length} records`);
    config.onDataStored?.(records.length);
    
    return records.length;
}



