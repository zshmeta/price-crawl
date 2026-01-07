import { log } from 'crawlee';
import { getRedisStore, type DataRecord } from './redis-store.js';

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

export async function scrapeWithBrowserless(config: BrowserlessConfig): Promise<Omit<DataRecord, 'id'>[]> {
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
                return [];
            }
            
            // Extract data from the table rows
            const rawData = await page.$$eval(rowSelector, (rows: Element[]) => {
                return rows.map((row: any) => {
                    const nameEl = row.querySelector('h4') || row.querySelector('a.font-semibold');
                    const name = nameEl?.textContent?.trim();
                    
                    const cells = Array.from(row.querySelectorAll('td'));
                    const price = cells[3]?.textContent?.trim();
                    const open = cells[4]?.textContent?.trim();
                    const high = cells[5]?.textContent?.trim();
                    const low = cells[6]?.textContent?.trim();
                    const change = cells[7]?.textContent?.trim();
                    const changePct = cells[8]?.textContent?.trim();
                    
                    const timeEl = row.querySelector('time');
                    const time = timeEl?.textContent?.trim();
                    
                    return { name, price, open, high, low, change, changePct, time };
                }).filter((item: any) => item.name);
            });
            
            return rawData;
        }, { timeout: BROWSERLESS_TIMEOUT_MS });
        
        const rawData = await extractData({ url: config.targetUrl });
        
        log.info(`[Browserless/${config.category}/${config.region}] Extracted ${rawData.length} records`);
        
        // Here we format data to match existing DataRecord schema
        const records: Omit<DataRecord, 'id'>[] = rawData.map((item: any) => ({
            name: item.name || 'Unknown',
            region: config.region,
            category: config.category,
            last: item.price || '',
            price: item.price,
            open: item.open,
            high: item.high,
            low: item.low,
            change: item.change,
            changePct: item.changePct,
            time: item.time,
            scrapedAt: new Date().toISOString()
        }));
        
        return records;
        
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



