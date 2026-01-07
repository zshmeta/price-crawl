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
const BROWSERLESS_TIMEOUT_MS = parseInt(process.env.BROWSERLESS_TIMEOUT_MS || '30000', 10);
const BROWSERLESS_WAIT_UNTIL = process.env.BROWSERLESS_WAIT_UNTIL || 'networkidle2';

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
        timeout: BROWSERLESS_TIMEOUT_MS,
        lossyDeviceName: true,
        ignoreHTTPSErrors: true
    });
    
    let browserless: any = null;
    
    try {
        log.info(`[Browserless/${config.category}/${config.region}] Starting scrape of ${config.targetUrl}`);
        config.onStatusChange?.('scraping');
        
        // Here we create a browser context (like opening a new tab)
        browserless = await browser.createContext({ retry: 2 });
        
        // Here we use withPage + goto pattern to avoid closure capture issues
        const extractData = browserless.withPage((page: any, goto: any) => async (opts: any) => {
            await goto(page, {
                url: opts.url,
                waitUntil: BROWSERLESS_WAIT_UNTIL as any,
                timeout: BROWSERLESS_TIMEOUT_MS
            });
            
            // Wait for the table rows to appear
            try {
                await page.waitForSelector(rowSelector, { timeout: 20000 });
            } catch {
                return { pageTitle, bodyText, headers: [], rows: [] };
            }
            
            // Extract data from the table rows
            const rawData = await page.$$eval(rowSelector, (rows: Element[]) => {
                return rows.map((row: any) => {
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
            
            return rawData;
        }, { timeout: BROWSERLESS_TIMEOUT_MS });
        
        const rawData = await extractData({ url: config.targetUrl });
        
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



