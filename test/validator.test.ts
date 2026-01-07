/**
 * Tests for the validator module
 */
import { describe, it, expect } from 'vitest';
import {
    detectChallengePage,
    validateRecord,
    validateRecords,
    meetsMinimumQuality,
    type PageMetadata,
} from '../src/lib/validator.js';
import type { DataRecord } from '../src/lib/redis-store.js';

describe('Validator', () => {
    describe('detectChallengePage', () => {
        it('should detect Cloudflare challenge title', () => {
            const metadata: PageMetadata = {
                url: 'https://example.com',
                title: 'Just a moment...',
                bodyText: 'Please wait',
            };

            const result = detectChallengePage(metadata);
            expect(result.isBlocked).toBe(true);
            expect(result.reasons).toContain('Challenge title detected');
        });

        it('should detect human verification text', () => {
            const metadata: PageMetadata = {
                url: 'https://example.com',
                title: 'Site',
                bodyText: 'Please verify you are human to continue',
            };

            const result = detectChallengePage(metadata);
            expect(result.isBlocked).toBe(true);
            expect(result.reasons).toContain('Human verification text detected');
        });

        it('should detect browser checking text', () => {
            const metadata: PageMetadata = {
                url: 'https://example.com',
                title: 'Please wait',
                bodyText: 'Checking your browser before accessing the site',
            };

            const result = detectChallengePage(metadata);
            expect(result.isBlocked).toBe(true);
            expect(result.reasons).toContain('Browser check text detected');
        });

        it('should detect Turnstile script', () => {
            const metadata: PageMetadata = {
                url: 'https://example.com',
                title: 'Loading',
                bodyText: '<script src="cf-turnstile.js"></script>',
            };

            const result = detectChallengePage(metadata);
            expect(result.isBlocked).toBe(true);
            expect(result.reasons).toContain('Turnstile script detected');
        });

        it('should detect Cloudflare Ray ID', () => {
            const metadata: PageMetadata = {
                url: 'https://example.com',
                title: 'Error',
                bodyText: 'Cloudflare Ray ID: abc123def456',
            };

            const result = detectChallengePage(metadata);
            expect(result.isBlocked).toBe(true);
            expect(result.reasons).toContain('Cloudflare Ray ID detected');
        });

        it('should not flag normal pages', () => {
            const metadata: PageMetadata = {
                url: 'https://example.com',
                title: 'Market Data',
                bodyText: 'Welcome to our financial data platform. Here are the latest prices...',
            };

            const result = detectChallengePage(metadata);
            expect(result.isBlocked).toBe(false);
            expect(result.reasons).toHaveLength(0);
        });

        it('should handle missing metadata gracefully', () => {
            const metadata: PageMetadata = {
                url: 'https://example.com',
            };

            const result = detectChallengePage(metadata);
            expect(result.isBlocked).toBe(false);
        });

        it('should detect multiple challenge indicators', () => {
            const metadata: PageMetadata = {
                url: 'https://example.com',
                title: 'Just a moment...',
                bodyText: 'Checking your browser. Please verify you are human. Cloudflare Ray ID: xyz',
            };

            const result = detectChallengePage(metadata);
            expect(result.isBlocked).toBe(true);
            expect(result.reasons.length).toBeGreaterThan(1);
        });
    });

    describe('validateRecord', () => {
        it('should validate a good record', () => {
            const record: Omit<DataRecord, 'id'> = {
                name: 'Gold',
                region: 'global',
                category: 'commodities',
                last: '4,478.95',
                high: '4,512.10',
                low: '4,470.45',
                change: '-17.15',
                changePct: '-0.38%',
                scrapedAt: '2026-01-07T05:22:54.875Z',
            };

            expect(validateRecord(record)).toBe(true);
        });

        it('should reject record with empty name', () => {
            const record: Omit<DataRecord, 'id'> = {
                name: '',
                region: 'global',
                category: 'commodities',
                last: '100.00',
                scrapedAt: '2026-01-07T00:00:00.000Z',
            };

            expect(validateRecord(record)).toBe(false);
        });

        it('should reject record with "Unknown" name', () => {
            const record: Omit<DataRecord, 'id'> = {
                name: 'Unknown',
                region: 'global',
                category: 'commodities',
                last: '100.00',
                scrapedAt: '2026-01-07T00:00:00.000Z',
            };

            expect(validateRecord(record)).toBe(false);
        });

        it('should reject record without price data', () => {
            const record: Omit<DataRecord, 'id'> = {
                name: 'Gold',
                region: 'global',
                category: 'commodities',
                last: '',
                scrapedAt: '2026-01-07T00:00:00.000Z',
            };

            expect(validateRecord(record)).toBe(false);
        });

        it('should accept record with price field instead of last', () => {
            const record: Omit<DataRecord, 'id'> = {
                name: 'Gold',
                region: 'global',
                category: 'commodities',
                last: '',
                price: '100.00',
                scrapedAt: '2026-01-07T00:00:00.000Z',
            };

            expect(validateRecord(record)).toBe(true);
        });

        it('should accept record with last field', () => {
            const record: Omit<DataRecord, 'id'> = {
                name: 'Gold',
                region: 'global',
                category: 'commodities',
                last: '100.00',
                scrapedAt: '2026-01-07T00:00:00.000Z',
            };

            expect(validateRecord(record)).toBe(true);
        });
    });

    describe('validateRecords', () => {
        it('should filter out invalid records', () => {
            const records: Array<Omit<DataRecord, 'id'>> = [
                {
                    name: 'Gold',
                    region: 'global',
                    category: 'commodities',
                    last: '100.00',
                    scrapedAt: '2026-01-07T00:00:00.000Z',
                },
                {
                    name: '',
                    region: 'global',
                    category: 'commodities',
                    last: '200.00',
                    scrapedAt: '2026-01-07T00:00:00.000Z',
                },
                {
                    name: 'Silver',
                    region: 'global',
                    category: 'commodities',
                    last: '',
                    scrapedAt: '2026-01-07T00:00:00.000Z',
                },
                {
                    name: 'Copper',
                    region: 'global',
                    category: 'commodities',
                    last: '300.00',
                    scrapedAt: '2026-01-07T00:00:00.000Z',
                },
            ];

            const valid = validateRecords(records, 'commodities', 'global');
            expect(valid).toHaveLength(2);
            expect(valid[0].name).toBe('Gold');
            expect(valid[1].name).toBe('Copper');
        });

        it('should return empty array when all records are invalid', () => {
            const records: Array<Omit<DataRecord, 'id'>> = [
                {
                    name: '',
                    region: 'global',
                    category: 'commodities',
                    last: '100.00',
                    scrapedAt: '2026-01-07T00:00:00.000Z',
                },
                {
                    name: 'Test',
                    region: 'global',
                    category: 'commodities',
                    last: '',
                    scrapedAt: '2026-01-07T00:00:00.000Z',
                },
            ];

            const valid = validateRecords(records, 'commodities', 'global');
            expect(valid).toHaveLength(0);
        });

        it('should return all records when all are valid', () => {
            const records: Array<Omit<DataRecord, 'id'>> = [
                {
                    name: 'Gold',
                    region: 'global',
                    category: 'commodities',
                    last: '100.00',
                    scrapedAt: '2026-01-07T00:00:00.000Z',
                },
                {
                    name: 'Silver',
                    region: 'global',
                    category: 'commodities',
                    last: '200.00',
                    scrapedAt: '2026-01-07T00:00:00.000Z',
                },
            ];

            const valid = validateRecords(records, 'commodities', 'global');
            expect(valid).toHaveLength(2);
        });
    });

    describe('meetsMinimumQuality', () => {
        it('should pass with sufficient records', () => {
            const records: Array<Omit<DataRecord, 'id'>> = [
                {
                    name: 'Gold',
                    region: 'global',
                    category: 'commodities',
                    last: '100.00',
                    scrapedAt: '2026-01-07T00:00:00.000Z',
                },
            ];

            expect(meetsMinimumQuality(records, 1)).toBe(true);
        });

        it('should fail with insufficient records', () => {
            const records: Array<Omit<DataRecord, 'id'>> = [];
            expect(meetsMinimumQuality(records, 1)).toBe(false);
        });

        it('should use default minimum of 1', () => {
            const records: Array<Omit<DataRecord, 'id'>> = [
                {
                    name: 'Gold',
                    region: 'global',
                    category: 'commodities',
                    last: '100.00',
                    scrapedAt: '2026-01-07T00:00:00.000Z',
                },
            ];

            expect(meetsMinimumQuality(records)).toBe(true);
        });

        it('should respect custom minimum', () => {
            const records: Array<Omit<DataRecord, 'id'>> = [
                {
                    name: 'Gold',
                    region: 'global',
                    category: 'commodities',
                    last: '100.00',
                    scrapedAt: '2026-01-07T00:00:00.000Z',
                },
            ];

            expect(meetsMinimumQuality(records, 5)).toBe(false);
        });
    });
});
