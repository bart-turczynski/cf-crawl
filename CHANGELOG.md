# Changelog

All notable changes to this project will be documented in this file.

## [2.0.1] - 2026-03-19

### Added
- **Test suite** — 53 unit tests across 7 test files using vitest, covering all modules:
  - `errors.js` — CrawlError/ApiError construction, retryable flag, inheritance
  - `utils.js` — sleep, backoffDelay, timestamp, normalizeUrl, runConcurrent
  - `config.js` — status sets, defaults shape, validateEnv
  - `output.js` — ensureOutputDir caching, writeFile for small results, streaming for large
  - `job-log.js` — logJob, readJobLog, updateJobLog
  - `cli.js` — job tracking, usage output, command dispatch, input validation
  - `api-client.js` — cfFetch retries, backoff, rate limiting, error handling
- Added `vitest` as dev dependency

## [2.0.0] - 2026-03-19

### Changed
- **Modularized architecture** — Decomposed 700-line `index.js` into 12 focused modules under `src/` with a thin 5-line entry point
- **Parallel polling** — `pollCrawlJobs` fires all job status checks per tick with `Promise.allSettled` instead of sequential `for...of` (N jobs: 1 RTT per tick instead of N)
- **One-time mkdir** — `ensureOutputDir()` caches the mkdir promise, eliminating redundant syscalls on every save/log call
- **Status constants** — Replaced repeated `["completed", "done", "finished"]` arrays with `COMPLETED_STATUSES` / `FAILED_STATUSES` Sets in `config.js`
- **Consolidated single/multi-URL duplication** — Extracted shared `runConcurrent()` utility for `Promise.allSettled` + summary printing
- **Input validation at the boundary** — URL normalization and limit/depth validation moved to `cli.js` so business functions receive clean inputs
- Shell scripts (`scripts/crawl.sh`, `scripts/scrape.sh`) marked as deprecated reference implementations

### Added
- **Graceful shutdown** — `SIGINT` handler in `cli.js` logs active job IDs, updates job log with "interrupted" status, and prints resume commands
- `runConcurrent()` utility for deduplicating multi-URL execution logic

## [1.3.0] - 2026-03-17

### Added
- **Concurrent multi-URL support for `crawl`** — `node index.js crawl site1.com site2.com` submits all jobs concurrently and polls them in a unified loop
- **Concurrent multi-URL support for `scrape`** — `node index.js scrape url1 url2` runs all scrapes concurrently via `Promise.allSettled`
- Summary table printed after multi-URL crawl/scrape showing success/failure per URL
- `--no-wait` with multiple crawl URLs submits all jobs and prints all job IDs

### Changed
- Scrape no longer supports `--delay` flag (not needed with concurrent execution)
- Crawl internals refactored: extracted `submitCrawl()` and `pollCrawlJobs()` helpers for composability

## [1.2.0] - 2026-03-17

### Added
- `status <jobId>` subcommand — check crawl job status, finished/skipped counts
- `download <jobId>` subcommand — fetch and save results for any job (even still-running ones)
- `jobs` subcommand — list all logged jobs with ID, URL, status, page count, and start time
- Job log (`output/jobs.jsonl`) — every crawl submission, status check, and download is recorded
- `--no-wait` flag for `crawl` — submit job and exit immediately (fire-and-forget)
- Polling now shows real-time page counts (`pages: 2747 finished, 10432 skipped`) instead of generic "in progress"
- Timeout message now prints `status` and `download` commands for easy resume
- Streaming JSON writer for large crawl results (fixes `RangeError: Invalid string length` on 500+ record results)

## [1.1.0] - 2026-03-16

### Changed
- Exponential backoff with jitter on retries (replaces flat 5s delay)
- Retry 429 (rate-limited) responses with `Retry-After` header support
- Retry 5xx server errors automatically; non-retryable errors fail fast
- URL normalization: bare hostnames like `example.com` are auto-prefixed with `https://`
- Proper arg parser: replaces fragile positional detection with flag/positional separation
- All business logic throws errors instead of calling `process.exit()` — single top-level catch
- Transient poll failures warn and continue instead of aborting the crawl
- Extracted `collectResults` for cleaner crawl flow
- Custom error classes (`CrawlError`, `ApiError`) with `retryable` flag
- Slug sanitization for scrape filenames handles query strings and fragments
- `max_depth` only included in crawl body when explicitly set

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
