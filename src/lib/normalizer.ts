/**
 * Data Normalizer Module
 * 
 * Provides header-based field mapping and normalization for scraped table data.
 * This module enables dynamic column mapping based on actual table headers rather
 * than hard-coded indices, improving resilience across different asset categories.
 */

import { log } from 'crawlee';
import type { DataRecord } from './redis-store.js';

/**
 * Raw table data extracted from the page
 */
export interface RawTableData {
    url: string;
    scrapedAt: string;
    headers: string[];
    rows: RawRowData[];
}

/**
 * Raw row data with cells and metadata
 */
export interface RawRowData {
    name: string;
    href?: string;
    cells: string[];
}

/**
 * Normalized field mapping
 */
interface HeaderMap {
    name?: number;
    last?: number;
    price?: number;
    bid?: number;
    ask?: number;
    open?: number;
    high?: number;
    low?: number;
    change?: number;
    changePct?: number;
    volume?: number;
    month?: number;
    time?: number;
}

/**
 * Normalize header text to a canonical form for matching
 */
function normalizeHeaderText(header: string): string {
    return header.toLowerCase().trim()
        .replace(/\s+/g, ' ')
        .replace(/[.\-_]/g, '');
}

/**
 * Build a header-to-index mapping from table headers
 * Handles common variations in header names (case-insensitive, abbreviations)
 */
export function buildHeaderMap(headers: string[]): HeaderMap {
    const map: HeaderMap = {};
    
    for (let i = 0; i < headers.length; i++) {
        const normalized = normalizeHeaderText(headers[i]);
        
        // Name/Pair column
        if (normalized.match(/^(name|pair|symbol)$/)) {
            map.name = i;
        }
        // Last/Price column
        else if (normalized.match(/^(last|price)$/)) {
            if (!map.last) map.last = i;
            if (!map.price) map.price = i;
        }
        // Bid column (forex)
        else if (normalized.match(/^bid$/)) {
            map.bid = i;
            if (!map.last) map.last = i; // Use bid as last if no explicit last
        }
        // Ask column (forex)
        else if (normalized.match(/^ask$/)) {
            map.ask = i;
        }
        // Open column
        else if (normalized.match(/^open$/)) {
            map.open = i;
        }
        // High column
        else if (normalized.match(/^high$/)) {
            map.high = i;
        }
        // Low column
        else if (normalized.match(/^low$/)) {
            map.low = i;
        }
        // Change column
        else if (normalized.match(/^(chg|change)$/)) {
            map.change = i;
        }
        // Change % column
        else if (normalized.match(/^(chg %|change %|change percent)$/)) {
            map.changePct = i;
        }
        // Volume column
        else if (normalized.match(/^(vol|volume)$/)) {
            map.volume = i;
        }
        // Month column (for futures)
        else if (normalized.match(/^month$/)) {
            map.month = i;
        }
        // Time column
        else if (normalized.match(/^time$/)) {
            map.time = i;
        }
    }
    
    return map;
}

/**
 * Normalize a single row using the header map
 */
export function normalizeRow(
    rawRow: RawRowData,
    headerMap: HeaderMap,
    category: string,
    region: string,
    url: string,
    scrapedAt: string,
    includeTrace: boolean = false
): Omit<DataRecord, 'id'> & { rawTrace?: any } {
    const cells = rawRow.cells;
    
    // Extract fields based on header mapping
    const record: any = {
        name: rawRow.name || 'Unknown',
        region,
        category,
        scrapedAt,
    };
    
    // Map fields from cells using header indices
    if (headerMap.last !== undefined) {
        record.last = cells[headerMap.last] || '';
    } else if (headerMap.price !== undefined) {
        record.last = cells[headerMap.price] || '';
    } else if (headerMap.bid !== undefined) {
        record.last = cells[headerMap.bid] || '';
    }
    
    if (headerMap.price !== undefined) {
        record.price = cells[headerMap.price];
    }
    
    if (headerMap.open !== undefined) {
        record.open = cells[headerMap.open];
    }
    
    if (headerMap.high !== undefined) {
        record.high = cells[headerMap.high];
    }
    
    if (headerMap.low !== undefined) {
        record.low = cells[headerMap.low];
    }
    
    if (headerMap.change !== undefined) {
        record.change = cells[headerMap.change];
    }
    
    if (headerMap.changePct !== undefined) {
        record.changePct = cells[headerMap.changePct];
    }
    
    if (headerMap.volume !== undefined) {
        record.volume = cells[headerMap.volume];
    }
    
    if (headerMap.month !== undefined) {
        record.month = cells[headerMap.month];
    }
    
    if (headerMap.time !== undefined) {
        record.time = cells[headerMap.time];
    }
    
    // Store href for ID generation
    if (rawRow.href) {
        record.href = rawRow.href;
    }
    
    // Add raw trace if enabled
    if (includeTrace) {
        record.rawTrace = {
            url,
            headers: Object.keys(headerMap),
            cells: rawRow.cells,
            headerMap,
        };
    }
    
    return record;
}

/**
 * Normalize raw table data into DataRecord objects
 */
export function normalizeTableData(
    rawData: RawTableData,
    category: string,
    region: string,
    includeTrace: boolean = false
): Array<Omit<DataRecord, 'id'>> {
    // Build header map
    const headerMap = buildHeaderMap(rawData.headers);
    
    log.debug(`[Normalizer/${category}/${region}] Header map:`, headerMap);
    
    // Normalize each row
    const records = rawData.rows.map(row => 
        normalizeRow(row, headerMap, category, region, rawData.url, rawData.scrapedAt, includeTrace)
    );
    
    return records;
}
