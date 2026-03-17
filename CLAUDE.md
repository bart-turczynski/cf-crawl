# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A CLI tool that crawls and scrapes any website using the **Cloudflare Browser Rendering API**. Written in vanilla JavaScript (ESM, Node.js), single-file architecture in `index.js`. Shell script equivalents live in `scripts/`.

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

- **`index.js`** — Entire application: CLI parser, Cloudflare API client (`cfFetch` with retry logic), crawl (async job + polling + cursor pagination), scrape (synchronous), and output handling.
- **`scripts/`** — Standalone bash equivalents (`crawl.sh`, `scrape.sh`) using `curl` + `jq`.
- **`output/`** — JSON results saved as `crawl_{hostname}_{timestamp}.json` or `scrape_{slug}_{timestamp}.json` (gitignored).

## Environment

Requires `.env` with Cloudflare credentials (see `.env.example`):
- `CF_ACCOUNT_ID`
- `CF_API_TOKEN` (needs Browser Rendering: Edit permission)

## Key Details

- ESM modules (`"type": "module"`) — use `import`, not `require`
- Only dependency is `dotenv`
- Default mode is fast HTML-only (no rendering, free during beta). Use `--render` to opt in to full browser rendering (billed at $0.09/browser hour)
- Multiple URLs are processed in parallel using `Promise.allSettled`; log output is tagged with `[hostname]`
- Crawl jobs are async: POST to `/crawl`, then poll `/crawl/{jobId}` every 15s with cursor-based pagination for results. Max poll time ~60 minutes
- Scrape is synchronous: single POST to `/scrape` returns immediately
- `cfFetch` retries transient network errors up to 3 times with 5s delay
- Crawl results persist on Cloudflare for 14 days after job completion

## Conventions

- Always update `CHANGELOG.md` when making changes to the codebase
