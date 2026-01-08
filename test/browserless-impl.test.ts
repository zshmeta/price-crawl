import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataRecord } from '../src/lib/redis-store.js';

// Mock validateRecords to pass everything
vi.mock('../src/lib/validator.js', () => ({
    validateRecords: vi.fn((records) => records),
    meetsMinimumQuality: vi.fn(() => true)
}));

// Mock redis-store
vi.mock('../src/lib/redis-store.js', () => ({
    getRedisStore: vi.fn(),
}));

// Mock module.createRequire
const { mockCreateBrowser, mockBrowser, mockContext } = vi.hoisted(() => ({
    mockCreateBrowser: vi.fn(),
    mockBrowser: {
        createContext: vi.fn(),
        close: vi.fn()
    },
    mockContext: {
        evaluate: vi.fn(),
        destroyContext: vi.fn()
    }
}));

vi.mock('module', async (importOriginal) => {
    const actual = await importOriginal<typeof import('module')>();
    return {
        ...actual,
        createRequire: vi.fn(() => (moduleName: string) => {
            if (moduleName === 'browserless') return mockCreateBrowser;
            return actual.createRequire(import.meta.url)(moduleName); // Fallback attempt
        })
    };
});

// Import the module under test
import { scrapeWithBrowserless } from '../src/lib/browserless-crawler.js';

describe('scrapeWithBrowserless Implementation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        
        // Setup default mocks
        mockCreateBrowser.mockReturnValue(mockBrowser);
        mockBrowser.createContext.mockResolvedValue(mockContext);
        mockContext.evaluate.mockReturnValue(async () => ({
            rows: [
                {
                    name: "Test Company",
                    href: "/equities/test-company",
                    cells: ["", "100.00", "99.00", "101.00", "98.00", "+1.00", "+1.00%", "12:00:00"]
                }
            ],
            html: "<html></html>"
        }));
    });

    it('should initialize browserless and scrape data', async () => {
        const config = {
            category: 'equities',
            region: 'test-region',
            targetUrl: 'http://example.com'
        };

        const result = await scrapeWithBrowserless(config);

        expect(mockCreateBrowser).toHaveBeenCalled();
        expect(mockBrowser.createContext).toHaveBeenCalled();
        expect(mockContext.evaluate).toHaveBeenCalled();
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Test Company');
        
        // Cleanup check
        expect(mockContext.destroyContext).toHaveBeenCalled();
        expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('should handle errors gracefully and ensure cleanup', async () => {
        const config = {
            category: 'equities',
            region: 'test-region',
            targetUrl: 'http://example.com'
        };

        mockContext.evaluate.mockImplementation(() => {
            throw new Error('Scrape failed');
        });

        await expect(scrapeWithBrowserless(config)).rejects.toThrow('Scrape failed');

        // Cleanup check
        expect(mockContext.destroyContext).toHaveBeenCalled();
        expect(mockBrowser.close).toHaveBeenCalled();
    });
});
