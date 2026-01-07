/**
 * Tests for the ID generator module
 */
import { describe, it, expect } from 'vitest';
import { generateRecordId } from '../src/lib/id-generator.js';

describe('ID Generator', () => {
    describe('generateRecordId', () => {
        it('should generate ID from name and region when no href', () => {
            const id = generateRecordId('Gold Futures', 'global');
            expect(id).toBe('gold-futures-global');
        });

        it('should generate ID with href hash when href is provided', () => {
            const id = generateRecordId('Gold', 'global', '/commodities/gold');
            expect(id).toMatch(/^gold-global-[a-f0-9]{8}$/);
        });

        it('should generate stable IDs for same href', () => {
            const id1 = generateRecordId('Gold', 'global', '/commodities/gold');
            const id2 = generateRecordId('Gold', 'global', '/commodities/gold');
            expect(id1).toBe(id2);
        });

        it('should generate different IDs for different hrefs', () => {
            const id1 = generateRecordId('Gold', 'global', '/commodities/gold');
            const id2 = generateRecordId('Gold', 'global', '/commodities/silver');
            expect(id1).not.toBe(id2);
        });

        it('should handle complex hrefs', () => {
            const id = generateRecordId('EUR/USD', 'global', 'https://www.investing.com/currencies/eur-usd');
            expect(id).toMatch(/^eur-usd-global-[a-f0-9]{8}$/);
        });

        it('should normalize name with spaces to hyphens', () => {
            const id = generateRecordId('S&P 500', 'united-states');
            expect(id).toBe('s&p-500-united-states');
        });

        it('should handle multiple spaces in name', () => {
            const id = generateRecordId('Dow  Jones   Index', 'united-states');
            expect(id).toBe('dow-jones-index-united-states');
        });

        it('should lowercase name', () => {
            const id = generateRecordId('GOLD', 'GLOBAL');
            expect(id).toBe('gold-GLOBAL');
        });

        it('should be backward compatible for simple cases', () => {
            const id = generateRecordId('gold', 'global');
            expect(id).toBe('gold-global');
        });

        it('should extract slug from href correctly', () => {
            const id = generateRecordId('Test Name', 'global', '/category/subcategory/my-asset');
            expect(id).toContain('my-asset-global');
        });

        it('should handle href with trailing slash', () => {
            const id = generateRecordId('Test', 'global', '/commodities/gold/');
            expect(id).toMatch(/^gold-global-[a-f0-9]{8}$/);
        });

        it('should fallback to name-based ID if href has no meaningful slug', () => {
            const id = generateRecordId('Gold', 'global', '/');
            expect(id).toBe('gold-global');
        });
    });
});
