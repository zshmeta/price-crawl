
import { getRedisStore } from './src/lib/redis-store.js';

async function testPersistence() {
    console.log('Testing persistence...');
    const store = await getRedisStore('test-category');
    
    const record = {
        name: 'Test Item',
        region: 'test-region',
        last: '100.00',
        scrapedAt: new Date().toISOString()
    };
    
    console.log('Pushing record...');
    await store.push([record]);
    console.log('Record pushed.');
    
    // Check if we can read it back
    const stored = await store.getCurrent();
    console.log('Stored records:', stored);
    
    await store.close();
}

testPersistence().catch(console.error);
