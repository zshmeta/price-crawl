# Price Crawler

A financial data aggregation platform that crawls real-time market data from investing.com.


## Features

- **Multi-asset crawling**: Equities, Crypto, Forex, Commodities
- **Multi-region support**: 10+ countries for equities, configurable via JSON
- **Data rotation**: FIFO storage with max 99 records per category
- **Robust**: Retry logic, graceful shutdown, error recovery

## Quick Start

```bash
# Install dependencies
npm install

# Start the application (crawlers + API)
npm start

# Run tests
npm test
```

### Example

```bash
# Get crypto prices
curl http://localhost:3000/api/crypto

# Get French equities
curl http://localhost:3000/api/equities/france

# Get commodities history
curl http://localhost:3000/api/commodities/history
```

## Configuration

Edit `config/sources.json` to add/remove data sources:

```json
{
  "equities": {
    "baseUrl": "https://www.investing.com/equities",
    "regions": ["united-states", "france", "germany"],
    "pollIntervalMs": 30000
  }
}
```

## Project Structure

```
price-crawl/
├── config/
│   └── sources.json        # Data source configuration
├── data/
│   └── *.json              # Scraped data (auto-generated)
├── src/
│   ├── lib/
│   │   ├── crawler-factory.ts   # Core crawler logic
│   │   ├── crawler-manager.ts   # Orchestrator
│   │   └── data-store.ts        # JSON persistence
│   │── ui-                      # Terminal Frontend using Ink
│   │   ├── Dashboard.tsx        # Reac dashboard  Ink
│   │   └── data-store.ts        # ui
│   └── app.ts              # Main entry point
└── test/
    └── *.test.ts           # Unit tests
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start crawlers + API server |
| `npm run dev` | Start with auto-reload |
| `npm run start:api` | Start API server only |
| `npm test` | Run tests |

## Technologies

- **Crawlee** + **Playwright** - Web scraping
- **Vitest** - Testing
- **TypeScript** - Type safety

## License

MIT
