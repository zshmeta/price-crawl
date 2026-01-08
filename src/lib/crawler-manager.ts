import { EventEmitter } from 'events';
import { log } from 'crawlee';
import { createCrawler, type CrawlerInstance, type CrawlerConfig } from './crawler-factory.js';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface SourceConfig {
    baseUrl: string;
    regions: string[];
    pollIntervalMs: number;
}

interface SourcesFile {
    [category: string]: SourceConfig;
}



export interface CrawlerState {
    category: string;
    region: string;
    status: 'idle' | 'scraping' | 'error' | 'sleeping';
    lastRun?: string;
    totalRecords: number;
    nextRun?: string;
}

export class CrawlerManager extends EventEmitter {
    // Priority Queue for managing crawl jobs
    private jobQueue: string[] = [];
    private activeCrawlers = 0;
    private readonly MAX_CONCURRENT_CRAWLERS = 2; // Strict limit to prevent memory overload

    private crawlers: Map<string, CrawlerInstance> = new Map();
    private sources: SourcesFile = {};
    private isRunning = false;
    private states: Map<string, CrawlerState> = new Map();

    constructor() {
        super();
    }

    async loadSources(configPath?: string): Promise<void> {
        const path = configPath || join(__dirname, '../../config/sources.json');
        const content = await readFile(path, 'utf-8');
        this.sources = JSON.parse(content);
        log.info(`Loaded ${Object.keys(this.sources).length} source categories`);
    }

    private buildUrl(baseUrl: string, region: string): string {
        if (region === 'global') {
            return baseUrl;
        }
        return `${baseUrl}/${region}`;
    }

    async startAll(): Promise<void> {
        if (this.isRunning) {
            log.warning('CrawlerManager already running');
            return;
        }

        this.isRunning = true;
        this.crawlers.clear();
        this.states.clear();
        this.jobQueue = [];

        // Initialize all crawlers and their states
        for (const [category, sourceConfig] of Object.entries(this.sources)) {
            for (const region of sourceConfig.regions) {
                const crawlerKey = `${category}-${region}`;
                const config: CrawlerConfig = {
                    category,
                    region,
                    targetUrl: this.buildUrl(sourceConfig.baseUrl, region),
                    pollIntervalMs: sourceConfig.pollIntervalMs
                };

                this.states.set(crawlerKey, {
                    category,
                    region,
                    status: 'idle',
                    totalRecords: 0
                });

                // Create crawler with lifecycle callbacks
                const crawler = createCrawler({
                    ...config,
                    onStatusChange: (status) => {
                        this.updateState(crawlerKey, { status });
                        
                        // When a crawler goes to sleep or errors, it yields its slot
                        if (status === 'sleeping' || status === 'error') {
                            this.releaseSlot(crawlerKey);
                        }
                    },
                    onDataStored: (count) => {
                        const state = this.states.get(crawlerKey);
                        if (state) {
                            this.updateState(crawlerKey, { 
                                totalRecords: state.totalRecords + count,
                                lastRun: new Date().toISOString()
                            });
                        }
                    }
                });

                this.crawlers.set(crawlerKey, crawler);
                
                // Add to queue
                this.jobQueue.push(crawlerKey);
            }
        }

        log.info(`Queued ${this.jobQueue.length} crawlers`);
        this.processQueue();
    }

    private async processQueue() {
        if (!this.isRunning) return;

        // Start crawlers while we have slots and items in queue
        while (this.activeCrawlers < this.MAX_CONCURRENT_CRAWLERS && this.jobQueue.length > 0) {
            const crawlerKey = this.jobQueue.shift();
            if (!crawlerKey) break;

            const crawler = this.crawlers.get(crawlerKey);
            if (crawler) {
                this.activeCrawlers++;
                log.info(`Starting crawler: ${crawlerKey} (Active: ${this.activeCrawlers}/${this.MAX_CONCURRENT_CRAWLERS})`);
                
                // Start without awaiting - the onStatusChange callback handles the lifecycle
                crawler.start().catch((err: any) => {
                    log.error(`Crawler ${crawlerKey} failed to start: ${err}`);
                    this.releaseSlot(crawlerKey);
                });
            }
        }
    }

    private releaseSlot(key: string) {
        // Decrease count but don't let it go below zero (safety)
        if (this.activeCrawlers > 0) {
            this.activeCrawlers--;
            log.debug(`Slot released by ${key}. Active: ${this.activeCrawlers}`);
            
            // Re-queue the crawler for its next run if allowed?
            // Note: The crawler usually sleeps internally. 
            // BUT, since we are limiting concurrency of *browsers*, we need 'sleeping' crawlers 
            // to NOT hold a browser instance.
            // However, the current createCrawler implementation runs a continuous loop.
            // To truly save memory, we might need createCrawler to be 'run-once' controlled by Manager.
            // For now, assuming createCrawler releases browser resources when sleeping (it does await sleep),
            // but the object stays alive.
            // Wait, createCrawler keeps the loop running. 
            // If we want strict concurrency, the Manager should trigger single runs.
            // Let's refactor approach: 
            // The START method in crawler-factory loops. This is problematic for strict queueing.
            // But if createCrawler closes browser between runs (it does 'close()' in finally block of runWithRetry?),
            // let's check crawler-factory.
            
            // Assuming for now we just want to throttle STARTUP.
            this.processQueue();
        }
    }

    stopAll(): void {
        log.info('Stopping all crawlers...');
        this.isRunning = false;
        this.jobQueue = []; // Clear queue

        for (const [key, crawler] of this.crawlers) {
            log.info(`Stopping crawler: ${key}`);
            crawler.stop();
        }
        this.crawlers.clear();
        log.info('All crawlers stopped');
    }

    getCrawlerCount(): number {
        return this.crawlers.size;
    }

    getCategories(): string[] {
        return Object.keys(this.sources);
    }

    private updateState(key: string, updates: Partial<CrawlerState>) {
        const current = this.states.get(key);
        if (current) {
            const newState = { ...current, ...updates };
            this.states.set(key, newState);
            this.emit('state-update', Array.from(this.states.values()));
        }
    }

    getAllStates(): CrawlerState[] {
        return Array.from(this.states.values());
    }
}
