# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed

- Clarified `CLAUDE.md`: documented `src/types.ts` in the module list and narrowed the `--render` flag note to `crawl` only.
- Updated `README.md`, `CLAUDE.md`, and `skill.md` to cover the current command set, output filenames, crawl follow-up commands, and the streamed-final-file crawl download behavior.

## [3.4.0] - 2026-04-21

### Added

- Seven new commands wrapping additional Cloudflare endpoints, all single-page by design:
  - `content` — `POST /content`, returns rendered HTML, saved as `content_{slug}_{ts}.html`.
  - `links` — `POST /links`, returns all hyperlinks. Flags: `--visible-only`, `--exclude-external`.
  - `json` — `POST /json`, AI-extracted structured data. Requires `--prompt "..."`; optional `--schema <path>` passed as `response_format: { type: "json_schema", json_schema: ... }`.
  - `pdf` — `POST /pdf`, binary PDF written to `pdf_{slug}_{ts}.pdf`.
  - `screenshot` — `POST /screenshot`, binary image. Flags: `--full-page`, `--format png|jpeg|webp`.
  - `snapshot` — `POST /snapshot`, JSON containing HTML + base64 screenshot in one record.
  - `tomarkdown` — Workers AI `POST /ai/tomarkdown` for local file uploads (PDF, docx, images, etc.). Multipart upload, one `.md` per input file. **Rejects http(s) args** with a guardrail — live URLs should use `markdown` (browser-rendering), not `/ai/tomarkdown`.
- `WORKERS_AI_BASE()` config helper for the Workers AI API base URL.
- `cfFetchBinary(path, options)` — shares retry/backoff with `cfFetch`, returns `{ result: Buffer, contentType }`. Powers `pdf` and `screenshot`.
- `cfFetchMultipart(baseUrl, path, formData)` — same retry semantics; omits `Content-Type` so fetch sets the multipart boundary. Powers `tomarkdown`.
- `saveBinary(filename, buffer)` and `saveText(filename, text)` output helpers.
- `urlSlug(url)` utility extracted from `scrape`/`markdown` and reused across new commands.
- `ApiError` constructor now accepts an explicit `retryable` override (used internally so non-JSON 5xx responses don't retry indefinitely — matches prior behavior).
- `npm run {content,links,json,pdf,screenshot,snapshot,tomarkdown}` scripts.
- 22 new tests: `cfFetchBinary` (3), `cfFetchMultipart` (2), `json` command (4), `tomarkdown` command (3), plus 10 CLI dispatch tests for the new endpoints.

### Refactored

- `api-client.ts` split into a private `executeWithRetry(url, init, parse, retryOpts)` helper used by all three fetch variants. Retry/backoff/rate-limit logic lives in one place instead of duplicated per flavor.
- `markdown` and `scrape` commands now use the shared `urlSlug` helper.

### Notes

- All new commands operate on **single URLs (or a batch passed on the CLI)**. No integration with the async `/crawl` job. Site-wide markdown conversion will be solved later with a local (non-API) converter to avoid consuming additional API credits.

## [3.3.0] - 2026-04-21

### Added

- `scrape` DEFAULT_SELECTORS now captures `li`, `td`, and `th`. Listicle and comparison-table pages expose most of their entity-dense content (tool names, vendor brands, pricing cells) through these tags; classifiers and NLP pipelines consuming scrape output now receive that content out of the box.

## [3.2.0] - 2026-04-10

### Added

- `markdown` command — convert page(s) to clean markdown via the Cloudflare Browser Rendering `/markdown` endpoint. Synchronous, single-URL per request, supports multiple URLs concurrently. Writes one `.md` file per URL to `output/`.
- `npm run markdown` script.
- CLI dispatch tests for the new command.

### Removed

- `--render` flag from the `scrape` command. The Cloudflare `/scrape` endpoint always runs in a full browser — there is no documented HTML-only mode — so the flag was a no-op and its name implied behavior that did not exist. `--wait N` remains and is now the primary lever for JS-heavy pages. Only `/crawl` still has a genuine `render: false` fast path.

## [3.1.1] - 2026-04-07

### Changed

- Migrated Claude Code skill from `.claude/commands/` to `.claude/skills/cf-crawl/SKILL.md`
- Renamed root `cf-crawl.md` to `skill.md` for clarity as the copyable documentation file
- Updated README setup instructions to use the new skill path
- Removed hardcoded absolute paths from SKILL.md

## [3.1.0] - 2026-04-07

### Changed

- **Streaming downloads** — `collectResults` now streams records to disk incrementally during cursor pagination instead of accumulating all records in memory. Eliminates OOM crashes and timeouts on large crawls (60K+ pages). Each page of records is written to disk immediately, so memory usage stays constant regardless of crawl size.

### Added

- `--format jsonl` option for `crawl` and `download` commands — writes one JSON record per line instead of a single JSON object. Useful for streaming processing of large result sets.
- `StreamingJsonWriter` and `StreamingJsonlWriter` classes in `output.ts` with backpressure-aware incremental writing.
- 13 new tests covering streaming writers, backpressure handling, comma placement, and format selection.

### Fixed

- Memory exhaustion when downloading large crawl results — records are now streamed to disk page-by-page instead of held in a multi-GB array.

## [3.0.1] - 2026-03-24

### Fixed

- Fixed cf-crawl skill command to use `npm run` scripts instead of non-existent `node index.js`
- Added missing `status`, `download`, and `jobs` npm scripts to `package.json`
- Updated `CLAUDE.md` to document all available npm scripts

## [3.0.0] - 2026-03-24

### Changed

- **Rewritten in TypeScript** — all source files (`src/`, `index.ts`) and test files (`test/`) converted from JavaScript to TypeScript with strict type checking
- Shared type definitions in `src/types.ts` (interfaces for API responses, job entries, CLI flags, command options)
- Build with `tsc` to `dist/`, dev with `tsx` for instant execution
- Updated `package.json` scripts: `build`, `dev`, `typecheck`, `lint`, `format`, etc.

### Added

- **ESLint** — flat config (`eslint.config.js`) with `typescript-eslint` and `eslint-config-prettier`
- **Prettier** — consistent formatting with `.prettierrc` (double quotes, semicolons, trailing commas, 100 char width)
- `tsconfig.json` and `tsconfig.test.json` for build and test type checking
- `vitest.config.ts` for explicit test configuration
- New dev dependencies: `typescript`, `tsx`, `@types/node`, `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-config-prettier`, `prettier`

## [2.1.0] - 2026-03-24

### Fixed

- **Streaming JSON writer** — fixed critical bug producing malformed JSON for crawls with >500 records (misplaced `records` array and unbalanced braces)
- **`--limit 0` and `--max_depth 0` silently ignored** — falsy check dropped valid zero values; now uses `!= null`
- **`push(...spread)` overflow** — replaced with `concat()` to avoid call stack overflow on large paginated results
- **Scrape `--render` flag ignored** — the flag was accepted and logged but never sent in the API request body
- **`readJobLog` swallowed all errors** — now only catches `ENOENT`; permission errors and corruption propagate
- **`cfFetch` could return `undefined`** — added defensive throw after retry loop exhaustion

### Changed

- **Lazy env config** — `CF_ACCOUNT_ID`, `CF_API_TOKEN`, and `API_BASE` are now getter functions reading `process.env` at call time, not import time
- **URL normalization at boundary** — `validateUrls` return value is now used; URLs are normalized once in `cli.js` instead of redundantly downstream
- **Narrower number coercion** — `parseArgs` only coerces `limit`, `max_depth`, and `wait` to numbers (was coercing all digit-only flag values)
- **SIGINT handler guard** — handler now registers only once even if `main()` is called multiple times
- **`updateJobLog` race condition** — documented known read-modify-write race (acceptable for CLI)

### Added

- `--help` / `-h` flag — prints usage without requiring env credentials
- README updated with all commands, options, and `--help` usage

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
