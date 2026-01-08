/**
 * Redis Data Store with JSON Fallback
 * 
 * This module provides a Redis-backed data store for price records with automatic
 * fallback to JSON file storage when Redis is unavailable. It supports:
 * 
 * - Hash-based storage for current prices (one hash per category)
 * - Pub/Sub for real-time price update notifications
 * - Automatic health monitoring and reconnection
 * - Seamless fallback to JSON files when Redis is down
 */

import { Redis } from 'ioredis';
import { log } from 'crawlee';
import { redisConfig } from './redis.config.js';
import { DataStore, getDataStore, type DataRecord, type DataFile } from './data-store.js';

const MAX_RECORDS = 99;

/**
 * RedisStore manages price data in Redis with automatic JSON fallback.
 * It maintains a single hash per category containing all current prices,
 * and publishes updates via Pub/Sub for real-time consumers.
 */
export class RedisStore {
    private category: string;
    private redis: Redis | null = null;
    private publisher: Redis | null = null;
    private isAvailable = false;
    private jsonFallback: DataStore | null = null;
    private healthCheckTimer: NodeJS.Timeout | null = null;
    private reconnectAttempts = 0;

    // Redis key names for this category
    private readonly hashKey: string;
    private readonly metaKey: string;
    private readonly channel: string;

    constructor(category: string) {
        this.category = category;
        this.hashKey = `${redisConfig.keyPrefix}prices:${category}`;
        this.metaKey = `${redisConfig.keyPrefix}meta:${category}`;
        this.channel = `${redisConfig.channelPrefix}${category}`;
    }

    /**
     * Initialize connections to Redis and set up health monitoring.
     * If Redis is unavailable, we immediately fall back to JSON storage.
     */
    async init(): Promise<void> {
        try {
            await this.connectToRedis();
        } catch (error) {
            log.info(`[RedisStore/${this.category}] Redis unavailable, using JSON fallback (this is expected if Redis is not running): ${error}`);
            await this.initJsonFallback();
        }

        // Start periodic health checks to detect Redis availability changes
        this.startHealthCheck();
    }

    /**
     * Establish connections to Redis for both data operations and publishing.
     * We use separate connections because Pub/Sub requires a dedicated connection.
     */
    private async connectToRedis(): Promise<void> {
        const connectionOptions = {
            host: redisConfig.host,
            port: redisConfig.port,
            password: redisConfig.password,
            db: redisConfig.db,
            retryStrategy: (times: number) => {
                if (times > redisConfig.maxRetries) {
                    return null; // Stop retrying, trigger fallback
                }
                return Math.min(times * redisConfig.retryDelayMs, 30000);
            },
            lazyConnect: true, // Don't connect until we explicitly call connect()
        };

        this.redis = new Redis(connectionOptions);
        this.publisher = new Redis(connectionOptions);

        // Set up error handlers to catch connection issues
        this.redis.on('error', (err: Error) => this.handleRedisError(err));
        this.publisher.on('error', (err: Error) => this.handleRedisError(err));

        this.redis.on('connect', () => {
            log.info(`[RedisStore/${this.category}] Connected to Redis`);
            this.isAvailable = true;
            this.reconnectAttempts = 0;
        });

        this.redis.on('close', () => {
            log.info(`[RedisStore/${this.category}] Redis connection closed`);
            this.isAvailable = false;
        });

        // Attempt to connect
        await this.redis.connect();
        await this.publisher.connect();

        // Verify connection with a ping
        await this.redis.ping();
        this.isAvailable = true;
        log.info(`[RedisStore/${this.category}] Redis connection established`);
    }

    /**
     * Handle Redis errors by logging and potentially triggering fallback.
     */
    private handleRedisError(error: Error): void {
        // If we are already unavailable, downgrade to debug to avoid log spam
        if (!this.isAvailable) {
            log.debug(`[RedisStore/${this.category}] Redis error (suppressed): ${error.message}`);
            return;
        }
        log.warning(`[RedisStore/${this.category}] Redis error: ${error.message}`);
        this.isAvailable = false;
    }

    /**
     * Initialize the JSON fallback store for when Redis is unavailable.
     */
    private async initJsonFallback(): Promise<void> {
        if (!this.jsonFallback) {
            this.jsonFallback = await getDataStore(this.category);
        }
    }

    /**
     * Start periodic health checks to monitor Redis availability.
     * This allows us to recover when Redis comes back online.
     */
    private startHealthCheck(): void {
        this.healthCheckTimer = setInterval(async () => {
            await this.checkHealth();
        }, redisConfig.healthCheckIntervalMs);
    }

    /**
     * Check Redis health and attempt reconnection if needed.
     */
    private async checkHealth(): Promise<void> {
        if (this.isAvailable) {
            try {
                await this.redis?.ping();
            } catch {
                log.warning(`[RedisStore/${this.category}] Health check failed, Redis unavailable`);
                this.isAvailable = false;
            }
        } else {
            // Try to reconnect if we were previously disconnected
            try {
                if (!this.redis || this.redis.status === 'end') {
                    await this.connectToRedis();
                    log.info(`[RedisStore/${this.category}] Reconnected to Redis`);
                }
            } catch {
                this.reconnectAttempts++;
                if (this.reconnectAttempts % 5 === 0) {
                    log.debug(`[RedisStore/${this.category}] Still trying to reconnect... (attempt ${this.reconnectAttempts})`);
                }
            }
        }
    }

    /**
     * Push new price records to the store.
     * 
     * Records are stored in a Redis hash with the record ID as field name.
     * After storing, we publish the new records to the Pub/Sub channel.
     * If Redis is unavailable, we fall back to JSON file storage.
     */
    async push(items: Omit<DataRecord, 'id'>[] | DataRecord[]): Promise<void> {
        if (this.isAvailable && this.redis) {
            try {
                await this.pushToRedis(items);
                return;
            } catch (error) {
                log.warning(`[RedisStore/${this.category}] Redis push failed, falling back to JSON: ${error}`);
                this.isAvailable = false;
            }
        }

        // Fallback to JSON storage
        await this.initJsonFallback();
        await this.jsonFallback!.push(items as Omit<DataRecord, 'id'>[]);
    }

    /**
     * Internal method to push records to Redis.
     */
    private async pushToRedis(items: Omit<DataRecord, 'id'>[] | DataRecord[]): Promise<void> {
        const pipeline = this.redis!.pipeline();

        // Build records with IDs (if not already present)
        const records: DataRecord[] = items.map(item => {
            if ('id' in item && item.id) {
                return item as DataRecord;
            }
            const id = `${item.name?.replace(/\s+/g, '-').toLowerCase()}-${item.region}`;
            return { id, ...item } as DataRecord;
        });

        // Store each record in the hash
        for (const record of records) {
            pipeline.hset(this.hashKey, record.id, JSON.stringify(record));
        }

        // Update metadata
        const meta = {
            category: this.category,
            lastUpdated: new Date().toISOString(),
        };
        pipeline.set(this.metaKey, JSON.stringify(meta));

        // Execute the pipeline
        await pipeline.exec();

        // Enforce the MAX_RECORDS limit using FIFO (keep newest records)
        await this.enforceRecordLimit();

        // Publish the update for real-time consumers
        if (this.publisher) {
            const message = JSON.stringify({
                category: this.category,
                timestamp: new Date().toISOString(),
                records,
            });
            await this.publisher.publish(this.channel, message);
        }

        log.debug(`[RedisStore/${this.category}] Stored ${records.length} records in Redis`);
    }

    /**
     * Enforce the maximum record limit by removing oldest entries.
     * We sort by scrapedAt timestamp and remove the oldest if over limit.
     */
    private async enforceRecordLimit(): Promise<void> {
        const allRecords = await this.redis!.hgetall(this.hashKey);
        const recordCount = Object.keys(allRecords).length;

        if (recordCount <= MAX_RECORDS) return;

        // Parse and sort by timestamp (oldest first)
        const parsed = Object.entries(allRecords)
            .map(([id, json]) => ({ id, record: JSON.parse(json as string) as DataRecord }))
            .sort((a, b) => {
                const dateA = a.record.scrapedAt ? new Date(a.record.scrapedAt).getTime() : 0;
                const dateB = b.record.scrapedAt ? new Date(b.record.scrapedAt).getTime() : 0;
                return dateA - dateB;
            });

        // Remove oldest records to get back under limit
        const toRemove = parsed.slice(0, recordCount - MAX_RECORDS);
        if (toRemove.length > 0) {
            await this.redis!.hdel(this.hashKey, ...toRemove.map(r => r.id));
            log.debug(`[RedisStore/${this.category}] Removed ${toRemove.length} old records`);
        }
    }

    /**
     * Get all records and metadata from the store.
     */
    async getAll(): Promise<DataFile> {
        if (this.isAvailable && this.redis) {
            try {
                return await this.getAllFromRedis();
            } catch (error) {
                log.warning(`[RedisStore/${this.category}] Redis read failed, falling back to JSON: ${error}`);
            }
        }

        // Fallback to JSON
        await this.initJsonFallback();
        return this.jsonFallback!.getAll();
    }

    /**
     * Internal method to get all records from Redis.
     */
    private async getAllFromRedis(): Promise<DataFile> {
        const [allRecords, metaJson] = await Promise.all([
            this.redis!.hgetall(this.hashKey),
            this.redis!.get(this.metaKey),
        ]);

        const records = Object.values(allRecords)
            .map(json => JSON.parse(json as string) as DataRecord)
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        const meta = metaJson ? JSON.parse(metaJson) : {
            category: this.category,
            lastUpdated: new Date().toISOString(),
        };

        return {
            metadata: {
                ...meta,
                totalRecords: records.length,
            },
            records,
        };
    }

    /**
     * Get all current records.
     */
    async getCurrent(): Promise<DataRecord[]> {
        const data = await this.getAll();
        return data.records;
    }

    /**
     * Get records filtered by region.
     */
    async getByRegion(region: string): Promise<DataRecord[]> {
        const data = await this.getAll();
        return data.records.filter(r => r.region === region);
    }

    /**
     * Check if Redis is currently available.
     */
    isRedisAvailable(): boolean {
        return this.isAvailable;
    }

    /**
     * Clean up connections and timers.
     */
    async close(): Promise<void> {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
        }
        if (this.redis) {
            await this.redis.quit();
        }
        if (this.publisher) {
            await this.publisher.quit();
        }
    }
}

// Singleton instances per category
const stores: Map<string, RedisStore> = new Map();

/**
 * Get or create a RedisStore instance for the given category.
 * This is the main entry point for other modules.
 */
export async function getRedisStore(category: string): Promise<RedisStore> {
    if (!stores.has(category)) {
        const store = new RedisStore(category);
        await store.init();
        stores.set(category, store);
    }
    return stores.get(category)!;
}

/**
 * Close all Redis connections. Call this during shutdown.
 */
export async function closeAllStores(): Promise<void> {
    for (const store of stores.values()) {
        await store.close();
    }
    stores.clear();
}

// Re-export types for convenience
export type { DataRecord, DataFile } from './data-store.js';
