/**
 * Tests for the normalizer module
 */
import { describe, it, expect } from 'vitest';
import { buildHeaderMap, normalizeRow, normalizeTableData } from '../src/lib/normalizer.js';
import type { RawTableData, RawRowData } from '../src/lib/normalizer.js';

describe('Normalizer', () => {
    describe('buildHeaderMap', () => {
        it('should map commodities headers correctly', () => {
            const headers = ['Name', 'Month', 'Last', 'High', 'Low', 'Chg.', 'Chg. %', 'Time'];
            const map = buildHeaderMap(headers);
            
            expect(map.name).toBe(0);
            expect(map.month).toBe(1);
            expect(map.last).toBe(2);
            expect(map.high).toBe(3);
            expect(map.low).toBe(4);
            expect(map.change).toBe(5);
            expect(map.changePct).toBe(6);
            expect(map.time).toBe(7);
        });

        it('should map forex headers correctly', () => {
            const headers = ['Pair', 'Bid', 'Ask', 'High', 'Low', 'Chg.', 'Chg. %', 'Time'];
            const map = buildHeaderMap(headers);
            
            expect(map.name).toBe(0); // Pair maps to name
            expect(map.bid).toBe(1);
            expect(map.last).toBe(1); // Bid also maps to last
            expect(map.ask).toBe(2);
            expect(map.high).toBe(3);
            expect(map.low).toBe(4);
            expect(map.change).toBe(5);
            expect(map.changePct).toBe(6);
        });

        it('should handle case-insensitive matching', () => {
            const headers = ['NAME', 'LAST', 'HIGH', 'LOW', 'CHANGE', 'CHANGE %'];
            const map = buildHeaderMap(headers);
            
            expect(map.name).toBe(0);
            expect(map.last).toBe(1);
            expect(map.high).toBe(2);
            expect(map.low).toBe(3);
            expect(map.change).toBe(4);
            expect(map.changePct).toBe(5);
        });

        it('should handle abbreviated headers', () => {
            const headers = ['Name', 'Vol.', 'Chg.', 'Chg. %'];
            const map = buildHeaderMap(headers);
            
            expect(map.volume).toBe(1);
            expect(map.change).toBe(2);
            expect(map.changePct).toBe(3);
        });

        it('should handle price/last variations', () => {
            const headers1 = ['Name', 'Price'];
            const map1 = buildHeaderMap(headers1);
            expect(map1.last).toBe(1);
            expect(map1.price).toBe(1);

            const headers2 = ['Name', 'Last'];
            const map2 = buildHeaderMap(headers2);
            expect(map2.last).toBe(1);
            expect(map2.price).toBe(1);
        });
    });

    describe('normalizeRow', () => {
        it('should normalize a commodities row correctly', () => {
            const headerMap = buildHeaderMap(['Name', 'Month', 'Last', 'High', 'Low', 'Chg.', 'Chg. %', 'Time']);
            const rawRow: RawRowData = {
                name: 'Gold',
                href: '/commodities/gold',
                cells: ['', 'Feb 26', '4,478.95', '4,512.10', '4,470.45', '-17.15', '-0.38%', '00:21:10'],
            };

            const normalized = normalizeRow(
                rawRow,
                headerMap,
                'commodities',
                'global',
                'https://www.investing.com/commodities/real-time-futures',
                '2026-01-07T05:22:54.875Z'
            );

            expect(normalized.name).toBe('Gold');
            expect(normalized.category).toBe('commodities');
            expect(normalized.region).toBe('global');
            expect(normalized.month).toBe('Feb 26');
            expect(normalized.last).toBe('4,478.95');
            expect(normalized.high).toBe('4,512.10');
            expect(normalized.low).toBe('4,470.45');
            expect(normalized.change).toBe('-17.15');
            expect(normalized.changePct).toBe('-0.38%');
            expect(normalized.time).toBe('00:21:10');
            expect((normalized as any).href).toBe('/commodities/gold');
        });

        it('should normalize a forex row correctly', () => {
            const headerMap = buildHeaderMap(['Pair', 'Bid', 'Ask', 'High', 'Low', 'Chg.', 'Chg. %']);
            const rawRow: RawRowData = {
                name: 'EUR/USD',
                href: '/currencies/eur-usd',
                cells: ['', '1.0412', '1.0413', '1.0425', '1.0395', '+0.0008', '+0.08%'],
            };

            const normalized = normalizeRow(
                rawRow,
                headerMap,
                'forex',
                'global',
                'https://www.investing.com/currencies/single-currency-crosses',
                '2026-01-07T05:22:46.361Z'
            );

            expect(normalized.name).toBe('EUR/USD');
            expect(normalized.last).toBe('1.0412'); // Bid maps to last
            expect(normalized.high).toBe('1.0425');
            expect(normalized.low).toBe('1.0395');
            expect(normalized.change).toBe('+0.0008');
            expect(normalized.changePct).toBe('+0.08%');
        });

        it('should include raw trace when enabled', () => {
            const headerMap = buildHeaderMap(['Name', 'Last']);
            const rawRow: RawRowData = {
                name: 'Test',
                cells: ['', '100.00'],
            };

            const normalized = normalizeRow(
                rawRow,
                headerMap,
                'test',
                'global',
                'https://example.com',
                '2026-01-07T00:00:00.000Z',
                true
            );

            expect(normalized).toHaveProperty('rawTrace');
            expect((normalized as any).rawTrace.url).toBe('https://example.com');
            expect((normalized as any).rawTrace.cells).toEqual(['', '100.00']);
        });

        it('should not include raw trace when disabled', () => {
            const headerMap = buildHeaderMap(['Name', 'Last']);
            const rawRow: RawRowData = {
                name: 'Test',
                cells: ['', '100.00'],
            };

            const normalized = normalizeRow(
                rawRow,
                headerMap,
                'test',
                'global',
                'https://example.com',
                '2026-01-07T00:00:00.000Z',
                false
            );

            expect(normalized).not.toHaveProperty('rawTrace');
        });
    });

    describe('normalizeTableData', () => {
        it('should normalize a complete table', () => {
            const rawData: RawTableData = {
                url: 'https://www.investing.com/commodities/real-time-futures',
                scrapedAt: '2026-01-07T05:22:54.875Z',
                headers: ['Name', 'Last', 'High', 'Low', 'Chg.', 'Chg. %'],
                rows: [
                    {
                        name: 'Gold',
                        href: '/commodities/gold',
                        cells: ['', '4,478.95', '4,512.10', '4,470.45', '-17.15', '-0.38%'],
                    },
                    {
                        name: 'Silver',
                        href: '/commodities/silver',
                        cells: ['', '31.12', '31.45', '30.98', '+0.15', '+0.48%'],
                    },
                ],
            };

            const normalized = normalizeTableData(rawData, 'commodities', 'global');

            expect(normalized).toHaveLength(2);
            expect(normalized[0].name).toBe('Gold');
            expect(normalized[0].last).toBe('4,478.95');
            expect(normalized[1].name).toBe('Silver');
            expect(normalized[1].last).toBe('31.12');
        });

        it('should handle empty table data', () => {
            const rawData: RawTableData = {
                url: 'https://example.com',
                scrapedAt: '2026-01-07T00:00:00.000Z',
                headers: [],
                rows: [],
            };

            const normalized = normalizeTableData(rawData, 'test', 'global');
            expect(normalized).toHaveLength(0);
        });
    });

    describe('Real-world snapshot data', () => {
        it('should correctly normalize commodities snapshot data', () => {
            // Simulating the commodities-global.json snapshot structure
            const headers = ['', 'Name', 'Month', 'Last', 'High', 'Low', 'Chg.', 'Chg. %', 'Time'];
            const headerMap = buildHeaderMap(headers);

            expect(headerMap.name).toBe(1);
            expect(headerMap.month).toBe(2);
            expect(headerMap.last).toBe(3);
            expect(headerMap.high).toBe(4);
            expect(headerMap.low).toBe(5);
            expect(headerMap.change).toBe(6);
            expect(headerMap.changePct).toBe(7);
            expect(headerMap.time).toBe(8);
        });
    });
});
