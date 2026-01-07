/**
 * Quick test to verify Redis fallback works.
 * Run with: npx tsx test/test-redis-fallback.ts
 */

import { getRedisStore } from '../src/lib/redis-store.js';

async function test() {
    console.log('Testing Redis store with fallback...\n');
    
    try {
        const store = await getRedisStore('test-category');
        console.log('✓ Store created');
        console.log(`  Redis available: ${store.isRedisAvailable()}`);
        
        // Try to push some test data
        await store.push([{
            name: 'Test Item',
            region: 'test',
            category: 'test-category',
            last: '100.00',
            high: '101.00',
            low: '99.00',
            scrapedAt: new Date().toISOString()
        }]);
        
        console.log('✓ Data pushed successfully');
        
        // Read it back
        const data = await store.getAll();
        console.log(`✓ Records retrieved: ${data.records.length}`);
        if (data.records.length > 0) {
            console.log(`  Sample record: ${data.records[0]?.name}`);
        }
        
        await store.close();
        console.log('\n✓ Test complete!');
        
        if (!store.isRedisAvailable()) {
            console.log('\n📝 Redis was unavailable - JSON fallback was used successfully!');
            console.log('   Check data/test-category.json for the stored data.');
        }
    } catch (error) {
        console.error('✗ Test failed:', error);
        process.exit(1);
    }
}

test();
