# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-03-17

### Added
- Support for multiple URLs in a single command (crawled/scraped sequentially)
- Auto-prepend `https://` for bare domain URLs (e.g., `www.example.com`)

## [1.0.0] - 2026-03-15

### Added
- Crawl any website using Cloudflare Browser Rendering `/crawl` endpoint (async job with polling)
- Scrape single pages using `/scrape` endpoint (synchronous)
- Fast HTML-only mode as default; opt-in to full browser rendering with `--render`
- Configurable page limit via `--limit N` (default: 100,000)
- `--max_depth N` option for controlling link depth
- Cursor-based pagination to fetch all crawl records
- Retry logic (3 attempts with 5s delay) for transient network errors
- Output saved as timestamped JSON files in `output/`
- Shell script equivalents (`scripts/crawl.sh`, `scripts/scrape.sh`)
- `.env`-based configuration for Cloudflare credentials
