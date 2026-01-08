import { inspect } from 'util';

// Mock config
const config = {
    category: 'equities',
    region: 'united-states',
    targetUrl: 'https://www.investing.com/equities/united-states',
    rowSelector: '.datatable-v2_row__hkEus'
};

async function testBrowserless() {
    console.log('--- Starting Browserless Test ---');
    try {
        console.log('Importing browserless...');
        const { createRequire } = await import('module');
        const require = createRequire(import.meta.url);
        const createBrowser = require('browserless');
        
        console.log('Creating browser instance...');
        const browser = createBrowser({
            timeout: 30000,
            lossyDeviceName: true,
            ignoreHTTPSErrors: true
        });

        console.log('Creating context...');
        const browserless = await browser.createContext({ retry: 2 });
        
        console.log('Defining extract function...');
        const extractData = browserless.evaluate(async (page: any) => {
            console.log('In page context...');
            try {
                await page.waitForSelector('.datatable-v2_row__hkEus', { timeout: 20000 });
            } catch (e) {
                console.log('Timeout waiting for selector');
                return { error: 'Timeout' };
            }
            
            const rows = await page.$$eval('.datatable-v2_row__hkEus', (els: any[]) => els.length);
            const html = await page.content();
            console.log(`Found ${rows} rows`);
            return { rowCount: rows, html };
        });
        
        console.log(`Navigating to ${config.targetUrl}...`);
        const result = await extractData(config.targetUrl);
        console.log('Extraction result:', result);

        if (result && result.html) {
            console.log('Writing HTML dump to debug_browserless.html...');
            const fs = await import('fs/promises');
            await fs.writeFile('debug_browserless.html', result.html);
            console.log('HTML dump saved.');
        }
        
        console.log('Cleaning up...');
        await browserless.destroyContext();
        await browser.close();
        console.log('--- Test Complete ---');
        
    } catch (error) {
        console.error('Test Failed:', error);
    }
}

testBrowserless().catch(console.error);
