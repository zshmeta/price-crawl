import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataStore, getDataStore, type DataRecord } from '../src/lib/data-store.js';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DATA_DIR = join(__dirname, '../data');

describe('DataStore', () => {
    const testCategory = 'test-category';
    let store: DataStore;

    beforeEach(async () => {
        // Clean up test file before each test
        try {
            await fs.unlink(join(TEST_DATA_DIR, `${testCategory}.json`));
        } catch {
            // File doesn't exist, that's fine
        }
        store = new DataStore(testCategory);
        await store.init();
    });

    afterEach(async () => {
        // Clean up test file after each test
        try {
            await fs.unlink(join(TEST_DATA_DIR, `${testCategory}.json`));
        } catch {
            // Ignore
        }
    });

    it('should initialize with empty records', async () => {
        const data = await store.getAll();
        expect(data.metadata.category).toBe(testCategory);
        expect(data.records).toHaveLength(0);
    });

    it('should push and retrieve records', async () => {
        const records: Omit<DataRecord, 'id'>[] = [
            { name: 'Apple', region: 'us', price: '150', scrapedAt: new Date().toISOString() },
            { name: 'Google', region: 'us', price: '2800', scrapedAt: new Date().toISOString() }
        ];

        await store.push(records);
        const data = await store.getAll();

        expect(data.records).toHaveLength(2);
    });

    it('should sort records by name', async () => {
        const records: Omit<DataRecord, 'id'>[] = [
            { name: 'Zebra', region: 'us', price: '100', scrapedAt: new Date().toISOString() },
            { name: 'Apple', region: 'us', price: '150', scrapedAt: new Date().toISOString() },
            { name: 'Microsoft', region: 'us', price: '300', scrapedAt: new Date().toISOString() }
        ];

        await store.push(records);
        const data = await store.getAll();

        expect(data.records[0].name).toBe('Apple');
        expect(data.records[1].name).toBe('Microsoft');
        expect(data.records[2].name).toBe('Zebra');
    });

    it('should update existing records by ID', async () => {
        const record1: Omit<DataRecord, 'id'>[] = [
            { name: 'Apple', region: 'us', price: '150', scrapedAt: new Date().toISOString() }
        ];

        await store.push(record1);

        const record2: Omit<DataRecord, 'id'>[] = [
            { name: 'Apple', region: 'us', price: '155', scrapedAt: new Date().toISOString() }
        ];

        await store.push(record2);
        const data = await store.getAll();

        // Should still have 1 record, but with updated price
        expect(data.records).toHaveLength(1);
        expect(data.records[0].price).toBe('155');
    });

    it('should filter by region', async () => {
        const records: Omit<DataRecord, 'id'>[] = [
            { name: 'Apple', region: 'us', price: '150', scrapedAt: new Date().toISOString() },
            { name: 'SAP', region: 'germany', price: '120', scrapedAt: new Date().toISOString() },
            { name: 'Google', region: 'us', price: '2800', scrapedAt: new Date().toISOString() }
        ];

        await store.push(records);

        const usRecords = await store.getByRegion('us');
        expect(usRecords).toHaveLength(2);

        const germanRecords = await store.getByRegion('germany');
        expect(germanRecords).toHaveLength(1);
    });

    it('should enforce max 99 records with FIFO rotation', async () => {
        // Push 100 records
        const records: Omit<DataRecord, 'id'>[] = [];
        for (let i = 0; i < 100; i++) {
            records.push({
                name: `Company${i.toString().padStart(3, '0')}`,
                region: 'test',
                price: `${i}`,
                scrapedAt: new Date().toISOString()
            });
        }

        await store.push(records);
        const data = await store.getAll();

        expect(data.records.length).toBeLessThanOrEqual(99);
    });
});
