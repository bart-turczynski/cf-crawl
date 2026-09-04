# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- New `export` command converts a crawl result file already on disk into CSV, replacing an untracked `export_urls.py` helper that had drifted out of the codebase. `node index.js export <file.json|file.jsonl> [--out <path>] [--status <s> ...]` emits the columns `url,status,httpStatus,title,lastModified`. **Fixes a silent bug in the Python predecessor:** it read `title` from the record root, where crawl records never carry it, so every exported title was blank; titles and HTTP status codes live one level down in `record.metadata`, which the new command reads. Two distinct statuses are now both exported and documented — `status` is the crawl outcome (`completed`, `errored`, `skipped`, `queued`) and `httpStatus` is `metadata.status`. `--status` is repeatable and filters on the crawl outcome, which closes the crawl -> export failures -> `crawl --input retry.csv` retry loop, since exported CSVs feed straight back into `--input` (the header row is skipped by the existing parser). `.jsonl` input is streamed line by line via `readline` and rows are written as they are read, sharing the backpressure-aware `streamWrite` helper now exported from `src/output.ts`; a 5.4 GB / 18,404-record crawl exports in ~22 s at ~275 MB RSS, and row order follows the input rather than being buffered to sort as the Python version did. `.json` input is parsed whole and validated before the output stream opens, so a malformed input leaves no partial CSV behind. Unparsable JSONL lines are skipped and counted rather than aborting. CSV fields are quoted per RFC 4180. New module `src/commands/export.ts`; new `ExportOptions`, `ExportSummary`, and `CrawlRecordMetadata` types in `src/types.ts`; `CrawlRecord.metadata` is now typed rather than reached through the index signature.
- `CommandSpec` in `src/cli.ts` gained `requiresEnv` (default `true`), and `main()` now calls `validateEnv()` per command instead of unconditionally. `export` sets `requiresEnv: false` because it never calls Cloudflare — previously any command, including a purely local file transform, would have failed without `CF_ACCOUNT_ID` / `CF_API_TOKEN` in `.env`.
- Code coverage reporting via Codecov. Added `@vitest/coverage-v8` devDep and a `coverage` block to `vitest.config.ts` (`provider: "v8"`, `reporter: ["text", "lcovonly"]`, output to `coverage/`, scoped to `src/**/*.ts` + `index.ts`). New `.github/workflows/verify.yml` runs on pushes to `master` and on PRs: pnpm install (frozen lockfile) → typecheck → lint → format check → test → coverage (`vitest run --coverage --coverage.reporter=lcovonly`) → upload `coverage/lcov.info` to Codecov via `codecov/codecov-action` (pinned to SHA `fb8b3582c8e4def4969c97caa2f19720cb33a72f`, v7) with `fail_ci_if_error: false`. cf-crawl is public, so the upload is tokenless (`CODECOV_TOKEN` is optional). Added a Codecov badge to `README.md`.
- `scrape` now accepts custom CSS selectors via a repeatable `--selector` flag (e.g. `--selector ".price" --selector "h1"`), so callers can target exactly the elements they care about instead of being limited to the hardcoded `DEFAULT_SELECTORS` set. When no `--selector` is given the previous default list is still used as a fallback, so existing zero-arg behavior is unchanged. `scrape` also gained `--headers`, `--ua`, and `--cookies` — the same Browser Rendering trio already on `markdown` — forwarded to the `/scrape` endpoint as `setExtraHTTPHeaders`, `userAgent`, and `cookies`; useful for the same geo-routing / UA / session cases. That trio's parsing is now shared between `markdown` and `scrape` via `getBrowserHttpOptions` in `src/cli.ts`. `ScrapeOptions` (`src/types.ts`) gained `selectors`, `headers`, `userAgent`, and `cookies`; the cookie shape is now the shared `BrowserCookie` type (`MarkdownCookie` remains as a deprecated alias). The CLI arg parser learned to accumulate repeatable flags (currently just `--selector`) into an array.
- `scrape` gained composable wait controls and a safer default. New flags: `--wait-until <load|networkidle2|networkidle0|domcontentloaded>` (maps to `gotoOptions.waitUntil`), `--wait-for "<css>"` (maps to `waitForSelector`), and `--strict`. These compose with the existing `--wait N` (`waitForTimeout`): navigation awaits `--wait-until`, then `--wait-for`, then a fixed `--wait` pad. **Behavior change:** the previous hardcoded `waitForSelector: { selector: "h1" }` default is gone. `scrape` now defaults to `gotoOptions.waitUntil: "load"` plus `bestAttempt: true`, so it extracts whatever loaded instead of hard-failing on pages without an `h1` (or whose awaited condition times out). `--strict` disables `bestAttempt` for callers who'd rather fail loudly. `ScrapeOptions` gained `waitFor`, `waitUntil`, and `strict`; new `WaitUntilEvent` type in `src/types.ts`. New `test/scrape.test.ts` covers the request-body construction.
- Sync single-page commands now persist the originating URL so it survives the lossy `urlSlug()` filename encoding (`.`, `/`, `?`, `=`, `&`, `#` all collapse to `_`, making the URL unrecoverable from the filename). Two complementary mechanisms: (1) JSON-output commands (`scrape`, `links`, `snapshot`, `json`) embed a top-level `url` key — `saveJson(filename, { url, ...result })` — a non-breaking addition to the existing `{success, result}` envelope; (2) a new `output/urls.jsonl` sidecar manifest records `{command, url, filename, timestamp}` for **every** sync command including the text (`markdown`, `content`) and binary (`pdf`, `screenshot`) outputs that have nowhere to embed the URL. New module `src/output-log.ts` exports `logOutputUrl`, mirroring the append-only `jobs.jsonl` pattern in `src/job-log.ts`. Forward-looking only — existing output files are unaffected. Resolves the case where, e.g., `kiwicommerce.co.uk` and `kiwicommerce_co_uk` map to the same slug. New `OutputUrlEntry` type in `src/types.ts`.
- `--concurrency N` flag on all URL-taking commands (default `10`) caps in-flight requests, matching Cloudflare's Workers Paid quick-action limit (10 rps; Free is 0.1 rps). `runConcurrent` in `src/utils.ts` gained an optional `concurrency` option implementing a worker-pool — when unset or `>= items.length` it falls back to the original `Promise.allSettled` parallel path. Use a lower value on Workers Free (`--concurrency 1`) and a higher one on accounts with elevated quotas. Necessary for `--input` batches at any meaningful size: unbounded fan-out trips Cloudflare's per-second rate limit and floods the retry path with 429s.
- `--input <file>` flag on all URL-taking commands (`crawl`, `scrape`, `markdown`, `content`, `links`, `json`, `pdf`, `screenshot`, `snapshot`) for reading URLs from a text file. File-extension agnostic — `.csv`, `.tsv`, `.txt`, anything UTF-8. One URL per line; the first URL-like token on each line is taken, so CSV/TSV files with header rows or extra columns work without preprocessing. Blank lines and lines starting with `#` are skipped. Combine with positional URLs to extend the list. New module `src/input.ts` exports `readUrlsFromFile`. `tomarkdown` is unaffected — it takes local-file paths, not URLs.
- `markdown` command now accepts `--headers`, `--ua`, and `--cookies` flags so callers can forward `setExtraHTTPHeaders`, `userAgent`, and `cookies` to Cloudflare Browser Rendering's `/markdown` endpoint. Useful when the target site geo-routes on the BR worker's egress IP — e.g. `zendesk.com` returns German content from the default BR egress, but setting `Accept-Language: en-US,en;q=0.9` + `Cookie: georedirect=false` + a Chrome UA forces the canonical English content. Each flag takes a single JSON-encoded argument: `--headers '{"Accept-Language":"en-US"}'`, `--ua "<UA>"`, `--cookies '[{"name","value","domain"}]'`. Exposed via `MarkdownOptions` in `src/commands/markdown.ts` so library callers can use it directly too.

### Changed

- CI ported from GitHub Actions to GitLab CI. `origin` is GitLab, so `.github/workflows/verify.yml` had never run for this remote — nothing gated pushes or merge requests. New `.gitlab-ci.yml` mirrors it as a single fail-fast `verify` job on `node:22`: corepack (pinning pnpm@11.1.1 from `packageManager`) → `pnpm install --frozen-lockfile` → typecheck → lint → format check → test → coverage. Runs on merge request events and on the default branch, with the pnpm store cached on `pnpm-lock.yaml`. Coverage now also emits a `cobertura` reporter alongside `lcovonly`, exposed as a GitLab `coverage_report` artifact for MR diff annotations, plus a job-level `coverage` regex for the badge. Codecov has no tokenless upload on GitLab (that is GitHub-only), so the upload step runs only when `CODECOV_TOKEN` is set and never fails the pipeline.
- GitHub is gone: `.github/workflows/verify.yml` and the `.github/` directory are removed. The workflow had never run for this remote and duplicated `.gitlab-ci.yml`.
- README status badges switched from Codecov to GitLab-native pipeline and coverage badges. The Codecov badge pointed at a `codecov.io/gh/` path that could never reflect a GitLab remote, and its tokenless upload is a GitHub-only feature, so no upload had ever run. The GitLab badges need no external service or token. **They will read `failed` / `unknown` until the namespace has CI/CD minutes again** — see below.
- Repository visibility changed from private to public on GitLab. Git history was scanned first: `.env` was never committed, `.env.example` holds only placeholders, and no credential-shaped strings appear in any blob. Public projects also get a reduced CI minute cost factor, though that does not restore an exhausted quota.
- GitLab CI now actually runs. Pipelines #1-#10 all failed instantly as `ci_quota_exceeded` with no runner assigned, because the `bart-turczynski` namespace had spent its Free-tier CI/CD minutes; the monthly reset on the 1st restored them, and pipeline #11 was picked up by a `saas-linux-small-amd64` shared runner. No configuration change was needed for that part. Making the project public had not helped: a public project gets a reduced per-minute cost factor, which does not refill a quota already spent.
- Added `.pnpm-store/` to `.prettierignore`, fixing the first pipeline that got far enough to fail on its own merits. `.gitlab-ci.yml` sets `PNPM_STORE_DIR: .pnpm-store` so the store sits inside the working directory where GitLab's `cache` can keep it, which also puts it in front of `prettier --check .`. The store holds third-party executables whose `#!` line lets Prettier infer a parser, so `format:check` reported "Code style issues found in 17 files" — all of them vendored blobs under `.pnpm-store/v11/files/`. The failure was CI-only and invisible to the `.githooks/pre-push` gate, since a local pnpm store lives outside the repository. `eslint .` was unaffected only because ESLint skips dot-directories by default. Also added to `.gitignore` so a local run with that store path cannot commit it.
- Added a tracked `pre-push` hook at `.githooks/pre-push` running the same chain as CI: typecheck, lint, format check, tests. Enable per clone with `git config core.hooksPath .githooks`; bypass a single push with `--no-verify`. Deletion-only pushes skip the chain. Until the CI/CD minutes issue is resolved this is the project's only automated gate — GitHub Actions never ran here (wrong forge), GitLab CI cannot start (quota), and no hook was previously installed.
- Agent instructions consolidated onto a canonical root `AGENTS.md`; `CLAUDE.md` is now a single `@AGENTS.md` import line. `AGENTS.md` carries only what applies to every task — the project description, the `.env` requirement, the ESM/`.js`-import convention, the process-exit boundary, and the CHANGELOG rule — plus pointers to `README.md`, `docs/ARCHITECTURE.md`, and `skill.md`. The module map, dependency-flow diagram, and runtime invariants (per-run SIGINT execution context, append-only job log with fold-on-read, two-way source-URL persistence, streaming crawl writer, large-download guidance) moved to a new `docs/ARCHITECTURE.md`. Per-command flag documentation was dropped in favor of `README.md`, which already covered it. Corrected a false claim carried by the old `CLAUDE.md`: `index.ts` is not the only process-exit boundary — the SIGINT handler in `src/cli.ts` also exits (code `130`).
- `--include-pattern` / `--exclude-pattern` are now documented in `README.md` and `skill.md`. Both flags shipped documented only in `CLAUDE.md`, so neither the user-facing README nor the agent-facing skill mentioned them. Includes the glob semantics: patterns match the full URL and `*` does not cross `/`, so `*/section/*` silently matches nothing while `https://site.com/section/**` works.
- `README.md` switched from `npm` to `pnpm` throughout, matching the declared `packageManager`, the sole `pnpm-lock.yaml`, and CI's `pnpm install --frozen-lockfile`. The `## npm Scripts` heading is now `## Scripts`. The `--` argument separator is retained — pnpm forwards args after `--` correctly, and omitting it lets the runner intercept leading flags.
- `package.json` declares `engines.node: ">=22"`, matching the Node version `verify.yml` already pins via `actions/setup-node`. Previously CI enforced a runtime that no manifest declared.
- Added `pnpm-lock.yaml` to `.prettierignore` — the lockfile is auto-generated by pnpm and was never prettier-formatted, so `format:check` failed on it. With the lockfile ignored, `format:check` now passes cleanly and is enforced as a step in the `verify.yml` CI workflow.
- Skill install switched from copying `skill.md` into the **project-level** `.claude/skills/cf-crawl/SKILL.md` (gitignored, drifted out of sync) to a **symlink** in the **user-level** dir: `ln -sf "$(git rev-parse --show-toplevel)/skill.md" ~/.claude/skills/cf-crawl/SKILL.md`. The installed skill now always reflects the version-controlled `skill.md` source with no re-install. `git rev-parse --show-toplevel` + `~` keep the command device- and user-independent for team clones. `README.md` and `CLAUDE.md` install steps updated accordingly.
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
