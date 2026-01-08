import { log } from 'crawlee';
import { getRedisStore, type DataRecord } from './redis-store.js';
import { validateRecords, meetsMinimumQuality } from './validator.js';
import { generateRecordId } from './id-generator.js';
import { createRequire } from 'module';
import fs from 'fs/promises';

const require = createRequire(import.meta.url);
const createBrowser = require('browserless');

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
const DEBUG_HTML_DUMP = process.env.DEBUG_HTML_DUMP === 'true';

/**
 * Scrapes price data using the browserless npm package.
 * This provides better anti-bot evasion than raw Playwright.
 */
export async function scrapeWithBrowserless(config: BrowserlessConfig): Promise<DataRecord[]> {
    const rowSelector = config.rowSelector || DEFAULT_ROW_SELECTOR;
    
    // Create a browserless factory instance
    const browser = createBrowser({
        timeout: BROWSERLESS_TIMEOUT_MS,
        lossyDeviceName: true,
        ignoreHTTPSErrors: true
    });
    
    let browserless: any = null;
    
    try {
        log.info(`[Browserless/${config.category}/${config.region}] Starting scrape of ${config.targetUrl}`);
        config.onStatusChange?.('scraping');
        
        // Create a browser context
        browserless = await browser.createContext({ retry: 2 });
        
        // Define the extraction function to be evaluated in the browser context
        const extractData = browserless.evaluate(async (page: any, response: any) => {
            // Wait for the table rows to appear
            try {
                await page.waitForSelector(rowSelector, { timeout: 20000 });
            } catch {
                return { headers: [], rows: [], html: await page.content() };
            }
            
            // Extract data from the table rows
            const rawData = await page.$$eval(rowSelector, (rows: any[]) => {
                return rows.map((row: any) => {
                    const nameEl = row.querySelector('h4') || row.querySelector('a.font-semibold');
                    const name = nameEl?.textContent?.trim();
                    
                    if (!name) return null;
                    
                    // Extract href if available
                    const linkEl = row.querySelector('a[href]');
                    const href = linkEl?.getAttribute('href') || undefined;
                    
                    // Extract all cell values
                    const cells = Array.from(row.querySelectorAll('td'));
                    const cellValues = cells.map((cell: any) => cell.textContent?.trim() || '');
                    
                    return {
                        name,
                        href,
                        cells: cellValues,
                    };
                }).filter((item: any) => item !== null);
            });
            
            return { rows: rawData, html: await page.content() };
        });
        
        const result = await extractData(config.targetUrl);
        const rawRows = result.rows || [];

        if (DEBUG_HTML_DUMP && result.html) {
             const filename = `debug_browserless_${config.category}_${config.region}.html`;
             await fs.writeFile(filename, result.html);
             log.warning(`[Browserless] Dumped HTML to ${filename}`);
        }

        if (rawRows.length === 0) {
            return [];
        }

        const formattedRecords = rawRows.map((row: any) => ({
            name: row.name,
            region: config.region,
            category: config.category,
            // Map cells to fields based on assumption of column order
            // This might need adjustment based on specific table layouts if they vary
            last: row.cells[1],
            open: row.cells[2],
            high: row.cells[3],
            low: row.cells[4],
            change: row.cells[5],
            changePct: row.cells[6],
            time: row.cells[7],
            scrapedAt: new Date().toISOString(),
            href: row.href
        }));
        
        // Validate records
        const validRecords = validateRecords(formattedRecords, config.category, config.region);
        
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
    
    // Save records
    const store = await getRedisStore(config.category);
    await store.push(records);
    
    log.info(`[Browserless/${config.category}/${config.region}] Stored ${records.length} records`);
    config.onDataStored?.(records.length);
    
    return records.length;
}



