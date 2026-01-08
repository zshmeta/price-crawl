
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CrawlerManager } from '../src/lib/crawler-manager.js';
import * as factory from '../src/lib/crawler-factory.js';

// Mock fs/promises
vi.mock('fs/promises', () => ({
    readFile: vi.fn().mockResolvedValue(JSON.stringify({
        "category1": { "baseUrl": "http://test1", "regions": ["r1", "r2"], "pollIntervalMs": 1000 },
        "category2": { "baseUrl": "http://test2", "regions": ["r3", "r4"], "pollIntervalMs": 1000 }
    }))
}));

// Mock createCrawler
const mockStart = vi.fn();
const mockStop = vi.fn();

describe('CrawlerManager Concurrency', () => {
    let crawlerManager: CrawlerManager;
    let createdCrawlers: any[] = [];

    beforeEach(() => {
        vi.useFakeTimers();
        createdCrawlers = [];
        mockStart.mockReset();
        mockStop.mockReset();

        // When start is called, return a promise that doesn't resolve immediately
        // simulating a running crawler.
        mockStart.mockImplementation(() => new Promise(() => {})); 

        vi.spyOn(factory, 'createCrawler').mockImplementation((config: any) => {
           const crawler = {
               start: mockStart,
               stop: mockStop,
               config 
           };
           createdCrawlers.push(crawler);
           return crawler;
        });

        crawlerManager = new CrawlerManager();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('should only start 2 crawlers concurrently', async () => {
        await crawlerManager.loadSources();
        
        // Configuration has 2 categories * 2 regions = 4 total crawlers
        // Expected behavior: Start 2, Queue 2.
        
        await crawlerManager.startAll();
        
        // Check calls to start
        expect(mockStart).toHaveBeenCalledTimes(2);
        
        // Verify specifically which ones started (FIFO from config usually)
        // Usually cat1-r1 and cat1-r2
        
        // Simulate one crawler finishing (going to sleep)
        // We find the callback passed to createCrawler
        const firstCrawlerConfig = (factory.createCrawler as any).mock.calls[0][0];
        const onStatusChange = firstCrawlerConfig.onStatusChange;
        
        // Trigger 'sleeping' status
        onStatusChange('sleeping');
        
        // Now a slot should open up, and the 3rd one should start
        expect(mockStart).toHaveBeenCalledTimes(3);
    });

    it('should release slot on error', async () => {
         await crawlerManager.loadSources();
         
         // Start initial 2
         await crawlerManager.startAll();
         expect(mockStart).toHaveBeenCalledTimes(2);
         
         // Trigger error on one
         const firstCrawlerConfig = (factory.createCrawler as any).mock.calls[0][0];
         firstCrawlerConfig.onStatusChange('error');
         
         // Slot released, 3rd starts
         expect(mockStart).toHaveBeenCalledTimes(3);
    });
});
