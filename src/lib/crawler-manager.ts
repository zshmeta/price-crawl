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
    private crawlers: Map<string, CrawlerInstance> = new Map();
    private sources: SourcesFile = {};
    private isRunning = false;
    private states: Map<string, CrawlerState> = new Map();

    constructor() {
        super();
    }

    // Here we load the crawler configuration from the sources.json file
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

    // Here we initialize and start all crawlers defined in the configuration
    async startAll(): Promise<void> {
        if (this.isRunning) {
            log.warning('CrawlerManager already running');
            return;
        }

        this.isRunning = true;
        const startPromises: Promise<void>[] = [];

        for (const [category, sourceConfig] of Object.entries(this.sources)) {
            for (const region of sourceConfig.regions) {
                const crawlerKey = `${category}-${region}`;

                const config: CrawlerConfig = {
                    category,
                    region,
                    targetUrl: this.buildUrl(sourceConfig.baseUrl, region),
                    pollIntervalMs: sourceConfig.pollIntervalMs
                };

                // Initialize state
                this.states.set(crawlerKey, {
                    category,
                    region,
                    status: 'idle',
                    totalRecords: 0
                });

                // Create the crawler instance with callbacks for state updates
                const crawler = createCrawler({
                    ...config,
                    onStatusChange: (status) => this.updateState(crawlerKey, { status }),
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

                log.info(`Spawning crawler: ${crawlerKey}`);

                // Here we stagger the start times to avoid overwhelming the system or target
                startPromises.push(
                    new Promise<void>((resolve) => {
                        setTimeout(() => {
                            crawler.start().catch(err => {
                                log.error(`Crawler ${crawlerKey} failed: ${err}`);
                            });
                            resolve();
                        }, startPromises.length * 2000)
                    })
                );
            }
        }

        await Promise.all(startPromises);
        log.info(`Started ${this.crawlers.size} crawlers`);
    }

    // Here we gracefully stop all running crawlers associated with this manager
    stopAll(): void {
        log.info('Stopping all crawlers...');
        this.isRunning = false;

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
