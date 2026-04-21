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
npm run markdown -- <url> [<url2> ...]
npm run content -- <url> [<url2> ...]
npm run links -- <url> [--visible-only] [--exclude-external]
npm run json -- <url> --prompt "..." [--schema ./schema.json]
npm run pdf -- <url> [<url2> ...]
npm run screenshot -- <url> [--full-page] [--format png|jpeg|webp]
npm run snapshot -- <url> [<url2> ...]
npm run tomarkdown -- <file> [<file2> ...]
npm run status -- <jobId>
npm run download -- <jobId>
npm run jobs

# Build & run compiled output
npm run build
node dist/index.js crawl <url> [<url2> ...]

# Quality
npm test              # vitest run
npm run test:watch    # vitest (watch mode)
npm run typecheck     # tsc --noEmit
npm run lint          # eslint .
npm run lint:fix      # eslint . --fix
npm run format:check  # prettier --check .
npm run format        # prettier --write .

# Run a single test file
npx vitest run test/utils.test.ts

# Run a single test by name
npx vitest run -t "normalizeUrl"
```

## Architecture

Modular ESM structure under `src/`. Entry point: `index.ts` -> `src/cli.ts` (arg parsing, command dispatch).

Commands live in `src/commands/` (crawl, scrape, markdown, content, links, json, pdf, screenshot, snapshot, tomarkdown, status, download, jobs). Shared infrastructure:

- **`src/api-client.ts`** — `cfFetch` (JSON), `cfFetchBinary` (binary responses for `/pdf`, `/screenshot`), `cfFetchMultipart` (file uploads for Workers AI `/ai/tomarkdown`). All share retry + exponential backoff + rate limiting
- **`src/config.ts`** — Constants, env validation, status sets (`COMPLETED_STATUSES`, `FAILED_STATUSES`). `API_BASE()` → browser-rendering; `WORKERS_AI_BASE()` → Workers AI
- **`src/errors.ts`** — `CrawlError`, `ApiError` with `retryable` flag (overridable)
- **`src/utils.ts`** — `sleep`, `backoffDelay`, `timestamp`, `normalizeUrl`, `urlSlug`, `runConcurrent`
- **`src/output.ts`** — `saveResult`, `saveBinary`, `saveText`, `ensureOutputDir` (cached mkdir), `StreamingJsonWriter` / `StreamingJsonlWriter` for incremental disk writes
- **`src/job-log.ts`** — JSONL persistence for job tracking

Dependency graph (no cycles, max 3 levels deep):

```
index.ts -> src/cli.ts -> src/config.ts
                       -> src/commands/* -> src/api-client.ts -> src/config.ts
                                                              -> src/errors.ts
                                                              -> src/utils.ts
                                         -> src/output.ts    -> src/config.ts
                                         -> src/job-log.ts   -> src/output.ts
```

- **`scripts/`** — Deprecated bash equivalents. Reference only, may lack feature parity.
- **`output/`** — JSON results (gitignored), named `crawl_{hostname}_{timestamp}.json` or `scrape_{slug}_{timestamp}.json`.

## Environment

Requires `.env` with Cloudflare credentials (see `.env.example`):

- `CF_ACCOUNT_ID`
- `CF_API_TOKEN` (needs Browser Rendering: Edit permission)

## Key Details

- TypeScript strict mode, compiled via `tsc` to `dist/`, dev via `tsx`
- ESM modules (`"type": "module"`) — use `import`, not `require`
- Import paths use `.js` extensions (required by `moduleResolution: "Node16"`)
- Only runtime dependency is `dotenv`
- ESLint (flat config) with `typescript-eslint` + Prettier integration
- Prettier: double quotes, semicolons, trailing commas, 100 char width
- Default mode is fast HTML-only (no rendering, free during beta). Use `--render` for full browser rendering
- Crawl jobs are async: POST `/crawl`, poll `/crawl/{jobId}` every 10s with cursor-based pagination. Max poll ~60 minutes
- Scrape is synchronous: single POST `/scrape` returns immediately
- Markdown is synchronous: single POST `/markdown` returns a plain markdown string; always uses full browser rendering (no `--render` flag)
- `content`, `links`, `json`, `pdf`, `screenshot`, `snapshot` are all synchronous single-page operations on live URLs (no crawl integration — by design)
- `tomarkdown` multipart-uploads LOCAL files (PDF, docx, images, etc.) to Workers AI `/ai/tomarkdown`. It rejects http(s) args with a guardrail — use `markdown` for live URLs, or (future) a local HTML-to-markdown converter
- `json` requires `--prompt "..."`; pass `--schema <path>` to constrain the response to a JSON schema (sent as `response_format: { type: "json_schema", json_schema: <schema> }`)
- `cfFetch` / `cfFetchBinary` / `cfFetchMultipart` all retry transient errors up to 4 times with exponential backoff
- Large crawl results are streamed to disk incrementally during pagination (never held fully in memory). Use `--format jsonl` for one-record-per-line output suited to streaming pipelines

## Testing

- Tests live in `test/` directory, one test file per source module (e.g., `test/utils.test.ts` for `src/utils.ts`)
- Uses vitest with `vi` for mocking/fake timers
- Test imports use `.js` extensions matching source (e.g., `from "../src/utils.js"`)

## Large downloads

For very large crawls (50K+ pages), downloads can take several minutes. If running from within Claude Code, the background task may be killed by session timeouts. In that case, run the download directly in a terminal:

```bash
# Build first if needed
npm run build

# Run download outside Claude Code -- no timeout limits
node dist/index.js download <jobId>

# Or use JSONL for streaming-friendly output
node dist/index.js download <jobId> --format jsonl
```

The streaming writer keeps memory usage constant regardless of crawl size — only one page of records (~50 records) is in memory at any time.

## Conventions

- Always update `CHANGELOG.md` when making changes to the codebase
