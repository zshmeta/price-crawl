import { PlaywrightCrawler, log } from 'crawlee';
import { getRedisStore, type DataRecord } from './redis-store.js';
import { runBrowserlessScrape } from './browserless-crawler.js';
import { normalizeTableData, type RawTableData } from './normalizer.js';
import { detectChallengePage, validateRecords, meetsMinimumQuality } from './validator.js';
import { generateRecordId } from './id-generator.js';

export interface CrawlerConfig {
    category: string;
    region: string;
    targetUrl: string;
    pollIntervalMs?: number;
    rowSelector?: string;
    onStatusChange?: (status: 'idle' | 'scraping' | 'error' | 'sleeping') => void;
    onDataStored?: (count: number) => void;
}

export interface CrawlerInstance {
    start: () => Promise<void>;
    stop: () => void;
}

const DEFAULT_ROW_SELECTOR = '.datatable-v2_row__hkEus';
const DEFAULT_POLL_INTERVAL = 30000;

// Environment-configurable parameters
const MAX_RETRIES = parseInt(process.env.CRAWLER_MAX_RETRIES || '3', 10);
const RETRY_DELAY_BASE_MS = parseInt(process.env.CRAWLER_RETRY_DELAY_BASE_MS || '5000', 10);
const PLAYWRIGHT_TIMEOUT_MS = parseInt(process.env.PLAYWRIGHT_TIMEOUT_MS || '30000', 10);
const NO_DATA_BACKOFF_MS = parseInt(process.env.NO_DATA_BACKOFF_MS || '300000', 10);

// Helper for AbortSignal-aware sleep
async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, ms);
        const abortHandler = () => {
            clearTimeout(timeout);
            reject(new Error('Aborted'));
        };
        signal?.addEventListener('abort', abortHandler, { once: true });
    });
}

export function createCrawler(config: CrawlerConfig): CrawlerInstance {
    const POLL_INTERVAL_MS = config.pollIntervalMs || DEFAULT_POLL_INTERVAL;
    const ROW_SELECTOR = config.rowSelector || DEFAULT_ROW_SELECTOR;

    let isRunning = false;
    let abortController: AbortController | null = null;
    let storedCountThisRun = 0;

    // Here we configure the Playwright crawler to handle the scraping logic
    const crawler = new PlaywrightCrawler({
        headless: true,
        maxRequestRetries: MAX_RETRIES,
        requestHandlerTimeoutSecs: 60,
        navigationTimeoutSecs: 30,

        async requestHandler({ page, request }) {
            config.onStatusChange?.('scraping');
            log.info(`[${config.category}/${config.region}] Processing ${request.url}`);

            // Check for challenge/blocked page
            const pageTitle = await page.title();
            const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 1000));
            
            const challengeResult = detectChallengePage({
                url: request.url,
                title: pageTitle,
                bodyText,
            });
            
            if (challengeResult.isBlocked) {
                log.warning(
                    `[${config.category}/${config.region}] Challenge page detected: ${challengeResult.reasons.join(', ')}`
                );
                config.onDataStored?.(0);
                return;
            }

            try {
                // Here we wait for the table to load on the page
                await page.waitForSelector(ROW_SELECTOR, { timeout: 20000 });
            } catch (e) {
                log.warning(`[${config.category}/${config.region}] Table not found. Page structure may have changed.`);
                config.onDataStored?.(0);
                return;
            }

            // Extract raw table data (headers + rows)
            const rawTableData = await page.evaluate((selector: string) => {
                // Extract headers from table
                const headerElements = document.querySelectorAll('th');
                const headers: string[] = [];
                headerElements.forEach(th => {
                    const text = th.textContent?.trim() || '';
                    if (text) headers.push(text);
                });
                
                // Extract rows
                const rows = document.querySelectorAll(selector);
                const extractedRows: any[] = [];
                
                rows.forEach(row => {
                    const nameEl = row.querySelector('h4') || row.querySelector('a.font-semibold');
                    const name = nameEl?.textContent?.trim();
                    
                    if (!name) return; // Skip rows without names
                    
                    // Extract href if available
                    const linkEl = row.querySelector('a[href]');
                    const href = linkEl?.getAttribute('href') || undefined;
                    
                    // Extract all cell values
                    const cells = Array.from(row.querySelectorAll('td'));
                    const cellValues = cells.map(cell => cell.textContent?.trim() || '');
                    
                    extractedRows.push({
                        name,
                        href,
                        cells: cellValues,
                    });
                });
                
                return {
                    headers,
                    rows: extractedRows,
                };
            }, ROW_SELECTOR);

            if (rawTableData.rows.length === 0) {
                log.warning(`[${config.category}/${config.region}] No data extracted`);
                storedCountThisRun = 0;
                return;
            }

            // Add IDs to records
            const recordsWithIds: DataRecord[] = validRecords.map(record => ({
                id: generateRecordId(record.name, record.region, (record as any).href),
                ...record,
            }));

            // Here we save the records to our Redis store (with JSON fallback)
            const store = await getRedisStore(config.category);
            await store.push(recordsWithIds);

            storedCountThisRun = records.length;
            log.info(`[${config.category}/${config.region}] Stored ${records.length} records`);
            config.onDataStored?.(records.length);
        },

        failedRequestHandler({ request }) {
            config.onStatusChange?.('error');
            log.error(`[${config.category}/${config.region}] Request failed: ${request.url}`);
            storedCountThisRun = 0;
        },
    });
    
    async function runWithRetry(retryCount = 0): Promise<void> {
        storedCountThisRun = 0; // Reset counter for this run
        
        try {
            const uniqueKey = `${config.targetUrl}-${Date.now()}`;
            
            // Here we wrap the crawler in a timeout to prevent hanging too long
            const crawlerPromise = crawler.run([{
                url: config.targetUrl,
                uniqueKey
            }]);
            
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Playwright timeout - falling back')), PLAYWRIGHT_TIMEOUT_MS);
            });
            
            await Promise.race([crawlerPromise, timeoutPromise]);
            
            // Check if Playwright cycle was successful by verifying storedCountThisRun > 0
            if (storedCountThisRun === 0) {
                throw new Error('Playwright extracted 0 records - triggering fallback');
            }
            
            log.info(`[${config.category}/${config.region}] Playwright cycle succeeded with ${storedCountThisRun} records`);
        } catch (error) {
            if (retryCount < MAX_RETRIES && storedCountThisRun === 0) {
                // Here we calculate the exponential backoff delay
                const delay = RETRY_DELAY_BASE_MS * Math.pow(2, retryCount);
                log.warning(`[${config.category}/${config.region}] Retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
                
                try {
                    await sleep(delay, abortController?.signal);
                } catch {
                    // Aborted during sleep
                    throw new Error('Aborted during retry backoff');
                }
                
                return runWithRetry(retryCount + 1);
            }
            
            // Here we fall back to Browserless when Playwright exhausts retries or stores 0 records
            log.warning(`[${config.category}/${config.region}] Playwright failed (stored ${storedCountThisRun} records), falling back to Browserless...`);
            try {
                const recordCount = await runBrowserlessScrape({
                    category: config.category,
                    region: config.region,
                    targetUrl: config.targetUrl,
                    rowSelector: ROW_SELECTOR,
                    onStatusChange: config.onStatusChange,
                    onDataStored: config.onDataStored
                });
                
                if (recordCount > 0) {
                    log.info(`[${config.category}/${config.region}] Browserless fallback succeeded with ${recordCount} records`);
                    return;
                }
                
                // Both Playwright and Browserless returned 0 records
                log.warning(`[${config.category}/${config.region}] Both Playwright and Browserless returned 0 records. Applying NO_DATA_BACKOFF_MS (${NO_DATA_BACKOFF_MS}ms)`);
                
                try {
                    await sleep(NO_DATA_BACKOFF_MS, abortController?.signal);
                } catch {
                    // Aborted during no-data backoff
                    return;
                }
            } catch (browserlessError) {
                log.error(`[${config.category}/${config.region}] Browserless fallback also failed: ${browserlessError}`);
                throw error;
            }
        }
    }

    // Here we start the continuous crawling loop
    async function start(): Promise<void> {
        if (isRunning) {
            log.warning(`[${config.category}/${config.region}] Crawler already running`);
            return;
        }

        isRunning = true;
        abortController = new AbortController();

        log.info(`[${config.category}/${config.region}] Starting continuous crawl`);

        while (isRunning) {
            try {
                await runWithRetry();
                config.onStatusChange?.('sleeping');
                log.info(`[${config.category}/${config.region}] Run complete. Next run in ${POLL_INTERVAL_MS}ms`);
            } catch (error) {
                config.onStatusChange?.('error');
                log.error(`[${config.category}/${config.region}] Fatal error: ${error}`);
            }

            // Here we wait for the next scheduled run with AbortSignal awareness
            try {
                await sleep(POLL_INTERVAL_MS, abortController?.signal);
            } catch {
                // Aborted, exit the loop
                break;
            }
        }
    }

    function stop(): void {
        log.info(`[${config.category}/${config.region}] Stopping crawler`);
        isRunning = false;
        abortController?.abort();
    }

    return { start, stop };
}
