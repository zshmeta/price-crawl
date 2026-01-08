
import { createCrawler } from './src/lib/crawler-factory.js';
import { log } from 'crawlee';

log.setLevel(log.LEVELS.INFO);

const configs = [
    {
        category: 'commodities',
        region: 'real-time-futures',
        targetUrl: 'https://www.investing.com/commodities/real-time-futures',
    },
    {
        category: 'crypto',
        region: 'global',
        targetUrl: 'https://www.investing.com/crypto/currencies',
    }
];

async function verify() {
    console.log('Starting verification...');
    
    for (const config of configs) {
        console.log(`Testing ${config.category}/${config.region} at ${config.targetUrl}`);
        const crawler = createCrawler({
            ...config,
            onDataStored: (count) => {
                console.log(`[PASS] Stored ${count} records for ${config.category}/${config.region}`);
            },
            onStatusChange: (status) => {
                console.log(`[STATUS] ${config.category}/${config.region}: ${status}`);
            }
        });

        // We only want to run one scrape, but crawler.start() runs a loop.
        // We can't easily extract just "runWithRetry" as it is internal.
        // But we can start it and stop it after a few seconds or after data is stored.
        
        // Start without awaiting immediately
        const runPromise = crawler.start();
        
        // Wait for enough time for one scrape to complete
        console.log('Waiting for scrape to complete...');
        await new Promise(resolve => setTimeout(resolve, 30000));
        
        crawler.stop();
        await runPromise;
    }
    console.log('Verification complete.');
    process.exit(0);
}

verify().catch(console.error);
