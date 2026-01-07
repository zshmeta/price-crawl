/**
 * Data Validation Module
 * 
 * Provides validation for scraped data to ensure quality and detect blocked/challenge pages.
 * This module helps prevent storing malformed or bot-challenge data.
 */

import { log } from 'crawlee';
import type { DataRecord } from './redis-store.js';

/**
 * Page metadata for validation
 */
export interface PageMetadata {
    url: string;
    title?: string;
    bodyText?: string;
}

/**
 * Challenge detection result
 */
export interface ChallengeDetectionResult {
    isBlocked: boolean;
    reasons: string[];
}

/**
 * Detect if a page is showing a Cloudflare or bot challenge
 */
export function detectChallengePage(metadata: PageMetadata): ChallengeDetectionResult {
    const reasons: string[] = [];
    
    // Check title for "Just a moment..."
    if (metadata.title?.includes('Just a moment')) {
        reasons.push('Challenge title detected');
    }
    
    // Check for common Cloudflare challenge text
    if (metadata.bodyText) {
        const bodyLower = metadata.bodyText.toLowerCase();
        
        if (bodyLower.includes('verify you are human')) {
            reasons.push('Human verification text detected');
        }
        
        if (bodyLower.includes('checking your browser')) {
            reasons.push('Browser check text detected');
        }
        
        if (bodyLower.includes('turnstile') || bodyLower.includes('cf-turnstile')) {
            reasons.push('Turnstile script detected');
        }
        
        if (bodyLower.includes('cloudflare') && bodyLower.includes('ray id')) {
            reasons.push('Cloudflare Ray ID detected');
        }
    }
    
    return {
        isBlocked: reasons.length > 0,
        reasons,
    };
}

/**
 * Validate a single data record
 */
export function validateRecord(record: Omit<DataRecord, 'id'>): boolean {
    // Name must be present and not empty
    if (!record.name || record.name.trim() === '' || record.name === 'Unknown') {
        return false;
    }
    
    // At least one price field must be present and non-empty
    const hasPriceData = 
        (record.last && record.last.trim() !== '') ||
        (record.price && record.price.trim() !== '');
    
    if (!hasPriceData) {
        return false;
    }
    
    return true;
}

/**
 * Validate an array of records and return only valid ones
 */
export function validateRecords(
    records: Array<Omit<DataRecord, 'id'>>,
    category: string,
    region: string
): Array<Omit<DataRecord, 'id'>> {
    const validRecords = records.filter(record => validateRecord(record));
    
    const invalidCount = records.length - validRecords.length;
    if (invalidCount > 0) {
        log.warning(
            `[Validator/${category}/${region}] Filtered out ${invalidCount} invalid records`
        );
    }
    
    return validRecords;
}

/**
 * Check if the extracted data meets minimum quality thresholds
 */
export function meetsMinimumQuality(
    records: Array<Omit<DataRecord, 'id'>>,
    minRecords: number = 1
): boolean {
    return records.length >= minRecords;
}
