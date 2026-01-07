/**
 * ID Generation Module
 * 
 * Provides stable ID generation for data records.
 * Incorporates href when available to reduce collisions and improve stability.
 */

import { createHash } from 'crypto';

/**
 * Generate a stable ID for a data record
 * If href is available, use it to create a more stable ID
 * Otherwise, fall back to name-region combination
 */
export function generateRecordId(
    name: string,
    region: string,
    href?: string
): string {
    if (href) {
        // Extract meaningful part from href (e.g., "/commodities/gold" -> "gold")
        const hrefParts = href.split('/').filter(p => p.length > 0);
        const slug = hrefParts[hrefParts.length - 1] || '';
        
        if (slug) {
            // Use hash of href slug for stability
            const hash = createHash('md5').update(href).digest('hex').substring(0, 8);
            return `${slug}-${region}-${hash}`;
        }
    }
    
    // Fallback to name-based ID (backward compatible)
    return `${name.replace(/\s+/g, '-').toLowerCase()}-${region}`;
}
