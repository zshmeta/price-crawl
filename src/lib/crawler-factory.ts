import { PlaywrightCrawler, log } from 'crawlee';
import { getRedisStore, type DataRecord } from './redis-store.js';
import { runBrowserlessScrape } from './browserless-crawler.js';

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
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 5000;

export function createCrawler(config: CrawlerConfig): CrawlerInstance {
    const POLL_INTERVAL_MS = config.pollIntervalMs || DEFAULT_POLL_INTERVAL;
    const ROW_SELECTOR = config.rowSelector || DEFAULT_ROW_SELECTOR;

    let isRunning = false;
    let abortController: AbortController | null = null;

    // Here we configure the Playwright crawler to handle the scraping logic
    const crawler = new PlaywrightCrawler({
        headless: true,
        maxRequestRetries: MAX_RETRIES,
        requestHandlerTimeoutSecs: 60,
        navigationTimeoutSecs: 30,

        async requestHandler({ page, request }) {
            config.onStatusChange?.('scraping');
            log.info(`[${config.category}/${config.region}] Processing ${request.url}`);

            try {
                // Here we wait for the table to load on the page
                await page.waitForSelector(ROW_SELECTOR, { timeout: 20000 });
            } catch (e) {
                log.warning(`[${config.category}/${config.region}] Table not found. Page structure may have changed.`);
                return;
            }

            // Here we extract price data from the table rows
            const rawData = await page.$$eval(ROW_SELECTOR, (rows: Array<HTMLElement>) => {
                return rows.map(row => {
                    const nameEl = row.querySelector('h4') || row.querySelector('a.font-semibold');
                    const name = nameEl?.textContent?.trim();

                    const cells = Array.from(row.querySelectorAll('td')) as Array<HTMLElement>;
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

            if (rawData.length === 0) {
                log.warning(`[${config.category}/${config.region}] No data extracted`);
                return;
            }

            // Here we format the extracted data into our standard record structure
            const records: Omit<DataRecord, 'id'>[] = rawData.map(item => ({
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

            // Here we save the records to our Redis store (with JSON fallback)
            const store = await getRedisStore(config.category);
            await store.push(records);

            log.info(`[${config.category}/${config.region}] Stored ${records.length} records`);
            config.onDataStored?.(records.length);
        },

        failedRequestHandler({ request }) {
            config.onStatusChange?.('error');
            log.error(`[${config.category}/${config.region}] Request failed: ${request.url}`);
        },
    });

    // Here we track if Playwright succeeded to determine if fallback is needed
    let playwrightSucceeded = false;
    const PLAYWRIGHT_TIMEOUT_MS = 30000; // 30 seconds max before falling back
    
    async function runWithRetry(retryCount = 0): Promise<void> {
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
            playwrightSucceeded = true;
        } catch (error) {
            if (retryCount < MAX_RETRIES) {
                // Here we calculate the exponential backoff delay
                const delay = RETRY_DELAY_BASE * Math.pow(2, retryCount);
                log.warning(`[${config.category}/${config.region}] Retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return runWithRetry(retryCount + 1);
            }
            
            // Here we fall back to Browserless when Playwright exhausts retries
            log.warning(`[${config.category}/${config.region}] Playwright failed, falling back to Browserless...`);
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
            } catch (browserlessError) {
                log.error(`[${config.category}/${config.region}] Browserless fallback also failed: ${browserlessError}`);
            }
            throw error;
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

            // Here we wait for the next scheduled run
            await new Promise<void>((resolve) => {
                const timeout = setTimeout(resolve, POLL_INTERVAL_MS);
                abortController?.signal.addEventListener('abort', () => {
                    clearTimeout(timeout);
                    resolve();
                });
            });
        }
    }

    function stop(): void {
        log.info(`[${config.category}/${config.region}] Stopping crawler`);
        isRunning = false;
        abortController?.abort();
    }

    return { start, stop };
}
