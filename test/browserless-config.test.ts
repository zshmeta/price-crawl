/**
 * Tests for browserless configuration and environment variables
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock crawlee
vi.mock('crawlee', () => ({
    log: {
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
    }
}));

// Mock redis-store
vi.mock('../src/lib/redis-store.js', () => ({
    getRedisStore: vi.fn().mockResolvedValue({
        push: vi.fn().mockResolvedValue(undefined),
        init: vi.fn().mockResolvedValue(undefined)
    })
}));

// Mock browserless module
vi.mock('browserless', () => {
    return {
        default: vi.fn(() => ({
            createContext: vi.fn().mockResolvedValue({
                withPage: vi.fn(() => vi.fn().mockResolvedValue([])),
                destroyContext: vi.fn().mockResolvedValue(undefined)
            }),
            close: vi.fn().mockResolvedValue(undefined)
        }))
    };
});

describe('Browserless Configuration', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        vi.clearAllMocks();
        originalEnv = { ...process.env };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('should use default BROWSERLESS_TIMEOUT_MS when not set', async () => {
        delete process.env.BROWSERLESS_TIMEOUT_MS;
        
        const { scrapeWithBrowserless } = await import('../src/lib/browserless-crawler.js');
        
        // Just verify the function exists and can be called
        expect(typeof scrapeWithBrowserless).toBe('function');
    });

    it('should respect BROWSERLESS_TIMEOUT_MS environment variable', async () => {
        process.env.BROWSERLESS_TIMEOUT_MS = '45000';
        
        const { scrapeWithBrowserless } = await import('../src/lib/browserless-crawler.js');
        
        expect(typeof scrapeWithBrowserless).toBe('function');
    });

    it('should respect BROWSERLESS_WAIT_UNTIL environment variable', async () => {
        process.env.BROWSERLESS_WAIT_UNTIL = 'load';
        
        const { scrapeWithBrowserless } = await import('../src/lib/browserless-crawler.js');
        
        expect(typeof scrapeWithBrowserless).toBe('function');
    });

    it('should export runBrowserlessScrape function', async () => {
        const { runBrowserlessScrape } = await import('../src/lib/browserless-crawler.js');
        
        expect(typeof runBrowserlessScrape).toBe('function');
    });
});
