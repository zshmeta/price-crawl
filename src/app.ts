import React from 'react';
import { render } from 'ink';
import { log, LogLevel } from 'crawlee';
import { CrawlerManager } from './lib/crawler-manager.js';
import { Dashboard } from './ui/Dashboard.js';
import { getLogHandler } from './ui/log-store.js';
import { closeAllStores } from './lib/redis-store.js';

// Configure Crawlee to use our custom logger for TUI display
// This intercepts logs and feeds them into the Dashboard component
const logHandler = getLogHandler();
log.setOptions({
    level: LogLevel.INFO,
    logger: logHandler
});

async function main() {
    // Initialize crawler manager
    // This loads configuration but doesn't start crawling yet
    const crawlerManager = new CrawlerManager();
    await crawlerManager.loadSources();

    // Render the Terminal UI
    // Ink handles the process lifecycle and input
    const { unmount, waitUntilExit } = render(React.createElement(Dashboard, { crawlerManager }));

    // Handle graceful shutdown
    const shutdown = async () => {
        log.info('Shutting down...');
        crawlerManager.stopAll();
        await closeAllStores(); // Close Redis connections
        // Give time for final logs to appear
        setTimeout(() => {
            unmount();
            process.exit(0);
        }, 1000);
    };

    // process.on('SIGINT', shutdown); // Ink handles SIGINT
    // process.on('SIGTERM', shutdown);

    // Start all crawlers
    // The Dashboard will automatically pick up state changes via events
    crawlerManager.startAll().catch(error => {
        log.error(`Startup error: ${error}`);
    });

    // Keep the process alive until the UI exits
    await waitUntilExit();
}

main().catch((error) => {
    // Fallback error logging if UI fails
    console.error(`Fatal error: ${error}`);
    process.exit(1);
});
