import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCrawler, type CrawlerConfig } from '../src/lib/crawler-factory.js';
import { PlaywrightCrawler } from 'crawlee';

// Mock Crawlee
vi.mock('crawlee', () => ({
    PlaywrightCrawler: vi.fn(),
    log: {
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
        setLevel: vi.fn(),
        LEVELS: { INFO: 1 }
    }
}));

// Mock data-store
vi.mock('../src/lib/data-store.js', () => ({
    getDataStore: vi.fn().mockResolvedValue({
        push: vi.fn().mockResolvedValue(undefined),
        init: vi.fn().mockResolvedValue(undefined)
    })
}));

describe('createCrawler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should create a PlaywrightCrawler instance with correct config', () => {
        const config: CrawlerConfig = {
            category: 'crypto',
            region: 'global',
            targetUrl: 'https://www.investing.com/crypto/currencies',
            pollIntervalMs: 5000
        };

        const crawler = createCrawler(config);

        expect(PlaywrightCrawler).toHaveBeenCalledTimes(1);
        expect(crawler).toHaveProperty('start');
        expect(crawler).toHaveProperty('stop');
    });

    it('should return start and stop functions', () => {
        const config: CrawlerConfig = {
            category: 'equities',
            region: 'united-states',
            targetUrl: 'https://www.investing.com/equities/united-states',
            pollIntervalMs: 10000
        };

        // Mock PlaywrightCrawler
        vi.mocked(PlaywrightCrawler).mockImplementation(function () {
            return {
                run: vi.fn().mockResolvedValue(undefined)
            } as any;
        });

        const crawler = createCrawler(config);

        expect(typeof crawler.start).toBe('function');
        expect(typeof crawler.stop).toBe('function');
    });
});
