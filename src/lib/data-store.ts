import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');

const MAX_RECORDS = 99;

export interface DataRecord {
    id: string;
    name: string;
    symbol?: string;
    region: string;
    category: string;
    last: string;
    high: string;
    low: string;
    price?: string;
    change?: string;
    changePct?: string;
    volume?: string;
    month?: string;
    scrapedAt?: string;
}

export interface DataFile {
    metadata: {
        category: string;
        lastUpdated: string;
        totalRecords: number;
    };
    records: DataRecord[];
}

export class DataStore {
    private category: string;
    private filePath: string;
    private writeQueue: Promise<void> = Promise.resolve();

    constructor(category: string) {
        this.category = category;
        this.filePath = join(DATA_DIR, `${category}.json`);
    }

    // Here we create the data directory if it doesn't exist
    async init(): Promise<void> {
        await fs.mkdir(DATA_DIR, { recursive: true });

        try {
            await fs.access(this.filePath);
        } catch {
            // Here we initialize an empty data structure since the file is missing
            const initial: DataFile = {
                metadata: {
                    category: this.category,
                    lastUpdated: new Date().toISOString(),
                    totalRecords: 0
                },
                records: []
            };
            await this.writeFile(initial);
        }
    }

    // Here we add new items to the store and rotate out old ones
    async push(items: Omit<DataRecord, 'id'>[]): Promise<void> {
        this.writeQueue = this.writeQueue.then(async () => {
            const data = await this.readFile();

            // Here we update existing records or add new ones with a generated ID
            for (const item of items) {
                const id = `${item.name?.replace(/\s+/g, '-').toLowerCase()}-${item.region}`;
                const record: DataRecord = { id, ...item };

                const existingIndex = data.records.findIndex(r => r.id === id);
                if (existingIndex >= 0) {
                    data.records[existingIndex] = record;
                } else {
                    data.records.push(record);
                }
            }

            // First: Sort by recency (newest first) to prioritize fresh data
            data.records.sort((a, b) => {
                const dateA = a.scrapedAt ? new Date(a.scrapedAt).getTime() : 0;
                const dateB = b.scrapedAt ? new Date(b.scrapedAt).getTime() : 0;
                return dateB - dateA;
            });

            // Second: Keep only the latest MAX_RECORDS
            if (data.records.length > MAX_RECORDS) {
                data.records = data.records.slice(0, MAX_RECORDS);
            }

            // Third: Sort the kept records alphabetically for clean storage
            data.records.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            // Here we update the metadata timestamp
            data.metadata.lastUpdated = new Date().toISOString();
            data.metadata.totalRecords = data.records.length;

            await this.writeFile(data);
        });

        await this.writeQueue;
    }

    async getAll(): Promise<DataFile> {
        return this.readFile();
    }

    async getCurrent(): Promise<DataRecord[]> {
        const data = await this.readFile();
        return data.records;
    }

    async getByRegion(region: string): Promise<DataRecord[]> {
        const data = await this.readFile();
        return data.records.filter(r => r.region === region);
    }

    private async readFile(): Promise<DataFile> {
        try {
            const content = await fs.readFile(this.filePath, 'utf-8');
            return JSON.parse(content);
        } catch {
            return {
                metadata: {
                    category: this.category,
                    lastUpdated: new Date().toISOString(),
                    totalRecords: 0
                },
                records: []
            };
        }
    }

    // Here we write the data to a temporary file first for safety
    private async writeFile(data: DataFile): Promise<void> {
        const tempPath = `${this.filePath}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
        await fs.rename(tempPath, this.filePath);
    }
}

const stores: Map<string, DataStore> = new Map();

// Here we retrieve the singleton DataStore instance for a category
export async function getDataStore(category: string): Promise<DataStore> {
    if (!stores.has(category)) {
        const store = new DataStore(category);
        await store.init();
        stores.set(category, store);
    }
    return stores.get(category)!;
}
