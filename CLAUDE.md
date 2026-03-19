# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A CLI tool that crawls and scrapes any website using the **Cloudflare Browser Rendering API**. Written in vanilla JavaScript (ESM, Node.js) with a modular architecture under `src/`.

## Commands

```bash
npm install

# Crawl websites (async jobs, polls until complete, parallel)
node index.js crawl <url> [<url2> ...]               # fast HTML-only (default)
node index.js crawl <url> [<url2> ...] --render       # full browser rendering (billed)
node index.js crawl <url> [<url2> ...] --limit 500    # cap at 500 pages per site

# Scrape pages (synchronous, parallel)
node index.js scrape <url> [<url2> ...]

# URLs work with or without https:// prefix
node index.js crawl www.example.com www.other.com

# npm script shortcuts (pass URL after --)
npm run crawl -- <url> [<url2> ...]
npm run crawl:render -- <url> [<url2> ...]
npm run scrape -- <url> [<url2> ...]
```

## Architecture

Modular ESM structure under `src/`:

- **`index.js`** — Thin entry point: loads dotenv and calls `main()`.
- **`src/cli.js`** — CLI arg parsing, input validation, command dispatch, SIGINT handler.
- **`src/config.js`** — Constants, env validation, status sets (`COMPLETED_STATUSES`, `FAILED_STATUSES`).
- **`src/errors.js`** — `CrawlError`, `ApiError` with `retryable` flag.
- **`src/utils.js`** — `sleep`, `backoffDelay`, `timestamp`, `normalizeUrl`, `runConcurrent`.
- **`src/api-client.js`** — `cfFetch` with retry + exponential backoff + rate limiting.
- **`src/output.js`** — `saveResult`, `ensureOutputDir` (cached mkdir).
- **`src/job-log.js`** — `logJob`, `readJobLog`, `updateJobLog` (JSONL persistence).
- **`src/commands/crawl.js`** — `submitCrawl`, `pollCrawlJobs` (parallel polling), `crawl`, `collectResults`.
- **`src/commands/scrape.js`** — `scrape` + `DEFAULT_SELECTORS`.
- **`src/commands/status.js`** — `status` command.
- **`src/commands/download.js`** — `download` command.
- **`src/commands/jobs.js`** — `listJobs` command.
- **`scripts/`** — Deprecated bash equivalents (`crawl.sh`, `scrape.sh`) using `curl` + `jq`. Reference implementations that may lack feature parity.
- **`output/`** — JSON results saved as `crawl_{hostname}_{timestamp}.json` or `scrape_{slug}_{timestamp}.json` (gitignored).

Dependency graph (no cycles, max 3 levels deep):
```
index.js -> src/cli.js -> src/config.js
                       -> src/commands/* -> src/api-client.js -> src/config.js
                                                              -> src/errors.js
                                                              -> src/utils.js
                                         -> src/output.js    -> src/config.js
                                         -> src/job-log.js   -> src/output.js
```

## Environment

Requires `.env` with Cloudflare credentials (see `.env.example`):
- `CF_ACCOUNT_ID`
- `CF_API_TOKEN` (needs Browser Rendering: Edit permission)

## Key Details

- ESM modules (`"type": "module"`) — use `import`, not `require`
- Only dependency is `dotenv`
- Default mode is fast HTML-only (no rendering, free during beta). Use `--render` to opt in to full browser rendering (billed at $0.09/browser hour)
- Crawl jobs are async: POST to `/crawl`, then poll `/crawl/{jobId}` every 10s with cursor-based pagination for results. Max poll time ~60 minutes
- Scrape is synchronous: single POST to `/scrape` returns immediately
- `cfFetch` retries transient network errors up to 4 times with exponential backoff
- Crawl results persist on Cloudflare for 14 days after job completion

## Conventions

- Always update `CHANGELOG.md` when making changes to the codebase
