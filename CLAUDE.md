# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A CLI tool that crawls and scrapes the Tidio website using the **Cloudflare Browser Rendering API**. Written in vanilla JavaScript (ESM, Node.js), single-file architecture in `index.js`. Shell script equivalents live in `scripts/`.

## Commands

```bash
# Install dependencies
npm install

# Crawl entire site (async job, polls until complete — can take minutes)
npm run crawl              # full browser-rendered crawl (billed)
npm run crawl:fast         # HTML-only, no rendering (free during beta)
npm run crawl:full         # HTML-only, 5000-page limit

# Scrape a single page (synchronous)
npm run scrape

# Direct CLI usage with options
node index.js crawl [url] [--no-render] [--limit N] [--max_depth N]
node index.js scrape [url]
```

## Architecture

- **`index.js`** — Entire application: CLI parser, Cloudflare API client (`cfFetch`), crawl logic (async job + polling), scrape logic (synchronous), and output handling. Default target is `https://www.tidio.com/`.
- **`scripts/`** — Standalone bash equivalents (`crawl.sh`, `scrape.sh`) using `curl` + `jq`. Same API, useful for quick one-off runs.
- **`output/`** — JSON results saved with timestamps (gitignored).

## Environment

Requires `.env` with Cloudflare credentials (see `.env.example`):
- `CF_ACCOUNT_ID`
- `CF_API_TOKEN` (needs Browser Rendering: Edit permission)

## Key Details

- ESM modules (`"type": "module"` in package.json) — use `import`, not `require`
- Only dependency is `dotenv`
- Crawl jobs are async: POST to `/crawl`, then poll `/crawl/{jobId}` with cursor-based pagination for results
- Scrape is synchronous: single POST to `/scrape` returns immediately
- The `--no-render` flag switches from billed browser rendering to free HTML-only fetch
