/**
 * Redis Configuration
 * 
 * Centralized configuration for Redis connection with environment variable support.
 * Uses sensible defaults for local development while allowing production overrides.
 */

export interface RedisConfig {
    host: string;
    port: number;
    password?: string;
    db: number;
    keyPrefix: string;
    // Reconnection settings
    retryDelayMs: number;
    maxRetries: number;
    // Health check interval to detect Redis availability
    healthCheckIntervalMs: number;
    // Channel prefix for Pub/Sub
    channelPrefix: string;
}

export const redisConfig: RedisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'pricecrawl:',
    retryDelayMs: 5000,
    maxRetries: 10,
    healthCheckIntervalMs: 30000,
    channelPrefix: 'price-updates:',
};
