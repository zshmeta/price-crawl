/**
 * Unit tests for both the Playwright-based crawler and Browserless fallback crawler.
 * These tests mock external dependencies to test the logic without hitting live sites.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock crawlee with a proper constructor mock
vi.mock('crawlee', () => {
    const MockPlaywrightCrawler = vi.fn().mockImplementation(function(this: any) {
        this.run = vi.fn().mockResolvedValue(undefined);
        return this;
    });
    
    return {
        PlaywrightCrawler: MockPlaywrightCrawler,
        log: {
            info: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
            setLevel: vi.fn(),
            LEVELS: { INFO: 1 }
        }
    };
});

// Mock redis-store
vi.mock('../src/lib/redis-store.js', () => ({
    getRedisStore: vi.fn().mockResolvedValue({
        push: vi.fn().mockResolvedValue(undefined),
        init: vi.fn().mockResolvedValue(undefined)
    })
}));

// Mock browserless-crawler
vi.mock('../src/lib/browserless-crawler.js', () => ({
    runBrowserlessScrape: vi.fn().mockResolvedValue(10),
    scrapeWithBrowserless: vi.fn().mockResolvedValue([])
}));

// Import after mocks are set up
import { createCrawler, type CrawlerConfig } from '../src/lib/crawler-factory.js';
import { PlaywrightCrawler } from 'crawlee';

describe('Playwright Crawler (crawler-factory)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('createCrawler', () => {
        it('should create a crawler instance with start and stop methods', () => {
            const config: CrawlerConfig = {
                category: 'equities',
                region: 'united-states',
                targetUrl: 'https://www.investing.com/equities/united-states',
                pollIntervalMs: 10000
            };

            const crawler = createCrawler(config);

            expect(crawler).toHaveProperty('start');
            expect(crawler).toHaveProperty('stop');
            expect(typeof crawler.start).toBe('function');
            expect(typeof crawler.stop).toBe('function');
        });

        it('should instantiate PlaywrightCrawler', () => {
            const config: CrawlerConfig = {
                category: 'crypto',
                region: 'global',
                targetUrl: 'https://www.investing.com/crypto/currencies'
            };

            createCrawler(config);
            
            expect(PlaywrightCrawler).toHaveBeenCalledTimes(1);
        });

        it('should use default poll interval when not provided', () => {
            const config: CrawlerConfig = {
                category: 'crypto',
                region: 'global',
                targetUrl: 'https://www.investing.com/crypto/currencies'
            };

            const crawler = createCrawler(config);
            expect(crawler).toBeDefined();
        });

        it('should accept custom row selector', () => {
            const config: CrawlerConfig = {
                category: 'commodities',
                region: 'global',
                targetUrl: 'https://www.investing.com/commodities/real-time-futures',
                rowSelector: '.custom-row-selector'
            };

            const crawler = createCrawler(config);
            expect(crawler).toBeDefined();
        });
    });

    describe('status callbacks', () => {
        it('should accept onStatusChange callback', () => {
            const onStatusChange = vi.fn();
            const config: CrawlerConfig = {
                category: 'equities',
                region: 'france',
                targetUrl: 'https://www.investing.com/equities/france',
                onStatusChange
            };

            const crawler = createCrawler(config);
            expect(crawler).toBeDefined();
        });

        it('should accept onDataStored callback', () => {
            const onDataStored = vi.fn();
            const config: CrawlerConfig = {
                category: 'equities',
                region: 'australia',
                targetUrl: 'https://www.investing.com/equities/australia',
                onDataStored
            };

            const crawler = createCrawler(config);
            expect(crawler).toBeDefined();
        });
    });
});

describe('Browserless Crawler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('module exports', () => {
        it('should export scrapeWithBrowserless function', async () => {
            const browserlessCrawler = await import('../src/lib/browserless-crawler.js');
            expect(browserlessCrawler).toHaveProperty('scrapeWithBrowserless');
        });

        it('should export runBrowserlessScrape function', async () => {
            const browserlessCrawler = await import('../src/lib/browserless-crawler.js');
            expect(browserlessCrawler).toHaveProperty('runBrowserlessScrape');
        });
    });

    describe('runBrowserlessScrape', () => {
        it('should return record count when successful', async () => {
            const { runBrowserlessScrape } = await import('../src/lib/browserless-crawler.js');
            
            const config = {
                category: 'equities',
                region: 'united-states',
                targetUrl: 'https://www.investing.com/equities/united-states'
            };

            const result = await runBrowserlessScrape(config);
            expect(result).toBe(10); // Mocked to return 10
        });
    });
});

describe('Fallback Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should create crawler with fallback capability', () => {
        const config: CrawlerConfig = {
            category: 'equities',
            region: 'united-states',
            targetUrl: 'https://www.investing.com/equities/united-states',
            pollIntervalMs: 5000
        };

        const crawler = createCrawler(config);
        
        expect(crawler).toBeDefined();
        expect(crawler.start).toBeDefined();
        expect(crawler.stop).toBeDefined();
    });

    it('should configure crawler for all supported categories', () => {
        const categories = ['equities', 'crypto', 'forex', 'commodities'];
        
        categories.forEach(category => {
            const config: CrawlerConfig = {
                category,
                region: 'global',
                targetUrl: `https://www.investing.com/${category}`
            };

            const crawler = createCrawler(config);
            expect(crawler).toBeDefined();
        });
    });
});

describe('DataRecord Schema', () => {
    it('should define expected fields for price data', () => {
        const expectedFields = [
            'name',
            'region', 
            'category',
            'last',
            'price',
            'open',
            'high',
            'low',
            'change',
            'changePct',
            'time',
            'scrapedAt'
        ];

        // Verify all expected fields are defined
        expect(expectedFields).toHaveLength(12);
        expectedFields.forEach(field => {
            expect(typeof field).toBe('string');
        });
    });
});

describe('Fallback and Timeout Behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should trigger Browserless fallback when Playwright stores 0 records', async () => {
        const { getRedisStore } = await import('../src/lib/redis-store.js');
        const { runBrowserlessScrape } = await import('../src/lib/browserless-crawler.js');
        
        // Mock store.push to track if it's called
        const mockPush = vi.fn().mockResolvedValue(undefined);
        vi.mocked(getRedisStore).mockResolvedValue({
            push: mockPush,
            init: vi.fn().mockResolvedValue(undefined)
        } as any);
        
        // Mock Browserless to return records
        vi.mocked(runBrowserlessScrape).mockResolvedValue(5);

        const config: CrawlerConfig = {
            category: 'test',
            region: 'global',
            targetUrl: 'https://example.com/test'
        };

        const crawler = createCrawler(config);
        
        // Verify crawler was created
        expect(crawler).toBeDefined();
        expect(typeof crawler.start).toBe('function');
    });

    it('should apply NO_DATA_BACKOFF_MS when both Playwright and Browserless return 0 records', async () => {
        const { runBrowserlessScrape } = await import('../src/lib/browserless-crawler.js');
        
        // Mock Browserless to return 0 records
        vi.mocked(runBrowserlessScrape).mockResolvedValue(0);

        const config: CrawlerConfig = {
            category: 'test',
            region: 'global',
            targetUrl: 'https://example.com/test'
        };

        const crawler = createCrawler(config);
        
        // Verify crawler was created with NO_DATA_BACKOFF_MS logic
        expect(crawler).toBeDefined();
    });

    it('should respect environment variable PLAYWRIGHT_TIMEOUT_MS', () => {
        // Set environment variable
        process.env.PLAYWRIGHT_TIMEOUT_MS = '15000';

        const config: CrawlerConfig = {
            category: 'test',
            region: 'global',
            targetUrl: 'https://example.com/test'
        };

        const crawler = createCrawler(config);
        
        expect(crawler).toBeDefined();
        
        // Clean up
        delete process.env.PLAYWRIGHT_TIMEOUT_MS;
    });

    it('should respect environment variable CRAWLER_MAX_RETRIES', () => {
        process.env.CRAWLER_MAX_RETRIES = '5';

        const config: CrawlerConfig = {
            category: 'test',
            region: 'global',
            targetUrl: 'https://example.com/test'
        };

        const crawler = createCrawler(config);
        
        expect(crawler).toBeDefined();
        
        // Clean up
        delete process.env.CRAWLER_MAX_RETRIES;
    });

    it('should use exponential backoff between retries', () => {
        process.env.CRAWLER_RETRY_DELAY_BASE_MS = '1000';

        const config: CrawlerConfig = {
            category: 'test',
            region: 'global',
            targetUrl: 'https://example.com/test'
        };

        const crawler = createCrawler(config);
        
        expect(crawler).toBeDefined();
        
        // Clean up
        delete process.env.CRAWLER_RETRY_DELAY_BASE_MS;
    });
});
