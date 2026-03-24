# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A CLI tool that crawls and scrapes any website using the **Cloudflare Browser Rendering API**. Written in TypeScript (ESM, Node.js) with a modular architecture under `src/`.

## Commands

```bash
npm install

# Dev (runs TypeScript directly via tsx)
npm run crawl -- <url> [<url2> ...]
npm run crawl:render -- <url> [<url2> ...]
npm run scrape -- <url> [<url2> ...]

# Build & run compiled output
npm run build
node dist/index.js crawl <url> [<url2> ...]

# Quality
npm test              # vitest run
npm run typecheck     # tsc --noEmit
npm run lint          # eslint .
npm run format:check  # prettier --check .
npm run format        # prettier --write .
```

## Architecture

Modular ESM structure under `src/`:

- **`index.ts`** — Thin entry point: loads dotenv and calls `main()`.
- **`src/types.ts`** — Shared TypeScript interfaces and type definitions.
- **`src/cli.ts`** — CLI arg parsing, input validation, command dispatch, SIGINT handler.
- **`src/config.ts`** — Constants, env validation, status sets (`COMPLETED_STATUSES`, `FAILED_STATUSES`).
- **`src/errors.ts`** — `CrawlError`, `ApiError` with `retryable` flag.
- **`src/utils.ts`** — `sleep`, `backoffDelay`, `timestamp`, `normalizeUrl`, `runConcurrent`.
- **`src/api-client.ts`** — `cfFetch` with retry + exponential backoff + rate limiting.
- **`src/output.ts`** — `saveResult`, `ensureOutputDir` (cached mkdir).
- **`src/job-log.ts`** — `logJob`, `readJobLog`, `updateJobLog` (JSONL persistence).
- **`src/commands/crawl.ts`** — `submitCrawl`, `pollCrawlJobs` (parallel polling), `crawl`, `collectResults`.
- **`src/commands/scrape.ts`** — `scrape` + `DEFAULT_SELECTORS`.
- **`src/commands/status.ts`** — `status` command.
- **`src/commands/download.ts`** — `download` command.
- **`src/commands/jobs.ts`** — `listJobs` command.
- **`scripts/`** — Deprecated bash equivalents (`crawl.sh`, `scrape.sh`) using `curl` + `jq`. Reference implementations that may lack feature parity.
- **`output/`** — JSON results saved as `crawl_{hostname}_{timestamp}.json` or `scrape_{slug}_{timestamp}.json` (gitignored).

Dependency graph (no cycles, max 3 levels deep):

```
index.ts -> src/cli.ts -> src/config.ts
                       -> src/commands/* -> src/api-client.ts -> src/config.ts
                                                              -> src/errors.ts
                                                              -> src/utils.ts
                                         -> src/output.ts    -> src/config.ts
                                         -> src/job-log.ts   -> src/output.ts
```

## Environment

Requires `.env` with Cloudflare credentials (see `.env.example`):

- `CF_ACCOUNT_ID`
- `CF_API_TOKEN` (needs Browser Rendering: Edit permission)

## Key Details

- TypeScript with strict mode, compiled via `tsc` to `dist/`, dev via `tsx`
- ESM modules (`"type": "module"`) — use `import`, not `require`
- Import paths use `.js` extensions (required by `moduleResolution: "Node16"`)
- Only runtime dependency is `dotenv`
- ESLint (flat config) with `typescript-eslint` + Prettier integration
- Prettier for formatting (double quotes, semicolons, trailing commas, 100 char width)
- Default mode is fast HTML-only (no rendering, free during beta). Use `--render` to opt in to full browser rendering (billed at $0.09/browser hour)
- Crawl jobs are async: POST to `/crawl`, then poll `/crawl/{jobId}` every 10s with cursor-based pagination for results. Max poll time ~60 minutes
- Scrape is synchronous: single POST to `/scrape` returns immediately
- `cfFetch` retries transient network errors up to 4 times with exponential backoff
- Crawl results persist on Cloudflare for 14 days after job completion

## Conventions

- Always update `CHANGELOG.md` when making changes to the codebase
