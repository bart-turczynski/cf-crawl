# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`cf-crawl` is a TypeScript CLI for the Cloudflare Browser Rendering API plus Workers AI `tomarkdown`. It supports:

- Async site crawls via `/crawl`
- Synchronous single-page operations: `scrape`, `markdown`, `content`, `links`, `json`, `pdf`, `screenshot`, `snapshot`
- Local file conversion via `/ai/tomarkdown`

## Commands

```bash
npm install

# Dev (runs TypeScript directly via tsx)
npm run crawl -- <url> [<url2> ...] [--render] [--limit N] [--max_depth N] [--no-wait] [--format json|jsonl]
npm run crawl:render -- <url> [<url2> ...]
npm run scrape -- <url> [<url2> ...] [--wait N]
npm run markdown -- <url> [<url2> ...]
npm run content -- <url> [<url2> ...]
npm run links -- <url> [<url2> ...] [--visible-only] [--exclude-external]
npm run json -- <url> [<url2> ...] --prompt "..." [--schema ./schema.json]
npm run pdf -- <url> [<url2> ...]
npm run screenshot -- <url> [<url2> ...] [--full-page] [--format png|jpeg|webp]
npm run snapshot -- <url> [<url2> ...]
npm run tomarkdown -- <file> [<file2> ...]
npm run status -- <jobId>
npm run download -- <jobId> [--format json|jsonl]
npm run jobs

# Build & run compiled output
npm run build
node dist/index.js --help

# Quality
npm test
npm run test:watch
npm run typecheck
npm run lint
npm run lint:fix
npm run format:check
npm run format

# Run a single test file or by name pattern
npx vitest run test/api-client.test.ts
npx vitest run -t "some test name"
```

## Claude Code skill

This repo ships a `skill.md` that maps to a Claude Code skill. Install it with:

```bash
mkdir -p .claude/skills/cf-crawl
cp skill.md .claude/skills/cf-crawl/SKILL.md
```

## Architecture

Entry point: `index.ts` -> `src/cli.ts`

Main modules:

- **`src/cli.ts`** — arg parsing, typed usage validation, command dispatch, per-run execution context, SIGINT lifecycle
- **`src/commands/`** — one file per command: `crawl`, `scrape`, `markdown`, `content`, `links`, `json`, `pdf`, `screenshot`, `snapshot`, `tomarkdown`, `status`, `download`, `jobs`
- **`src/api-client.ts`** — `cfFetch`, `cfFetchBinary`, `cfFetchMultipart`; shared retry, rate-limit, and backoff behavior
- **`src/config.ts`** — env-backed config helpers, retry/poll defaults, status sets
- **`src/errors.ts`** — `UsageError`, `ConfigError`, `CrawlError`, `ApiError`
- **`src/utils.ts`** — `sleep`, `backoffDelay`, `timestamp`, `normalizeUrl`, `urlSlug`, `runConcurrent`
- **`src/output.ts`** — `saveJson`, `saveText`, `saveBinary`, output dir creation, and crawl-specific streaming writers
- **`src/job-log.ts`** — append-only JSONL crawl-job events with fold-on-read reconstruction
- **`src/types.ts`** — shared types for CLI flags, API responses, job entries, and writer contracts

High-level dependency flow:

```text
index.ts
  -> src/cli.ts
    -> src/commands/*
      -> src/api-client.ts
      -> src/output.ts
      -> src/job-log.ts
    -> src/config.ts
    -> src/errors.ts
    -> src/utils.ts
```

Other repo paths:

- **`scripts/`** — older bash reference scripts for `crawl` and `scrape`
- **`output/`** — gitignored runtime output including crawl JSON/JSONL, rendered assets, markdown files, and `jobs.jsonl`

## Environment

Requires `.env` with:

- `CF_ACCOUNT_ID`
- `CF_API_TOKEN`

## Key Details

- TypeScript strict mode, ESM modules, `.js` import extensions
- `index.ts` is the only process-exit boundary; CLI/config validation throws typed errors
- `crawl` is the only command with a real `--render` switch; other page commands use the endpoint's native rendering behavior
- `crawl` and `download` support `--format jsonl`
- `scrape` supports `--wait N`; without it, `/scrape` waits for an `h1` before extracting
- Cloudflare retains crawl results for 14 days after completion; after that `download` will fail for that `jobId`
- `links` supports `--visible-only` and `--exclude-external`
- `json` requires `--prompt` and optionally accepts `--schema <path>`
- `screenshot` supports `--full-page` and `--format png|jpeg|webp`
- `tomarkdown` accepts local files only and rejects `http(s)` arguments intentionally
- Large crawl downloads stream directly into the final output file during pagination; there is no `.partial` file model
- `src/cli.ts` uses a per-run execution context so SIGINT listeners are removed in `finally`
- Job logging is append-only JSONL; reads fold the latest state per `jobId`

## Testing

- Tests live in `test/`
- Uses Vitest with `vi` mocks and module resets
- Source and test imports use `.js` extensions
- If behavior changes, update `CHANGELOG.md` alongside the code and tests

## Large Downloads

For large crawl jobs, prefer the compiled CLI in a normal terminal:

```bash
npm run build
node dist/index.js download <jobId>
node dist/index.js download <jobId> --format jsonl
```

The crawl writer streams records page-by-page, so memory stays bounded even for large result sets.
