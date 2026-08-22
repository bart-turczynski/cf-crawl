# Architecture

Entry point: `index.ts` -> `src/cli.ts`.

## Modules

- **`src/cli.ts`** — arg parsing, typed usage validation, command dispatch, per-run execution context, SIGINT lifecycle
- **`src/commands/`** — one file per command: `crawl`, `scrape`, `markdown`, `content`, `links`, `json`, `pdf`, `screenshot`, `snapshot`, `tomarkdown`, `status`, `download`, `jobs`, `export`
- **`src/api-client.ts`** — `cfFetch`, `cfFetchBinary`, `cfFetchMultipart`; shared retry, rate-limit, and backoff behavior
- **`src/config.ts`** — env-backed config helpers, retry/poll defaults, status sets
- **`src/errors.ts`** — `UsageError`, `ConfigError`, `CrawlError`, `ApiError`
- **`src/utils.ts`** — `sleep`, `backoffDelay`, `timestamp`, `normalizeUrl`, `urlSlug`, `runConcurrent`
- **`src/input.ts`** — `readUrlsFromFile` for the `--input <file>` flag. Format-agnostic line-oriented parser: first URL-like token per line wins, comments (`#`) and blank lines skipped, BOM stripped
- **`src/output.ts`** — `saveJson`, `saveText`, `saveBinary`, output dir creation, and crawl-specific streaming writers
- **`src/job-log.ts`** — append-only JSONL crawl-job events with fold-on-read reconstruction
- **`src/output-log.ts`** — `logOutputUrl` appends `{command, url, filename, timestamp}` to `output/urls.jsonl`
- **`src/types.ts`** — shared types for CLI flags, API responses, job entries, and writer contracts

Dependency flow:

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

- **`scripts/`** — older bash reference scripts for `crawl` and `scrape`, not kept at feature parity with the CLI
- **`output/`** — gitignored runtime output including crawl JSON/JSONL, rendered assets, markdown files, and `jobs.jsonl`

## Runtime invariants

**Per-run execution context.** `src/cli.ts` builds a context per invocation and removes its SIGINT
listeners in `finally`, so listeners do not accumulate across runs. The handler prints active job IDs,
marks them `interrupted` in the job log, and exits `130`.

**Append-only job logging.** Crawl job events are appended as JSONL; reads fold the latest state per
`jobId` rather than rewriting history.

**Source-URL persistence.** `urlSlug()` collapses a URL into a filename lossily, so sync single-page
commands record the source URL twice. JSON outputs (`scrape`, `links`, `snapshot`, `json`) embed a
top-level `url` key (`{ url, ...result }`), and every sync command appends
`{command, url, filename, timestamp}` to `output/urls.jsonl`. Forward-looking only — historical files
are unaffected. Async crawl output already carries per-page `records[*].url`.

**Local-only commands.** `src/cli.ts` calls `validateEnv()` per command, gated on
`CommandSpec.requiresEnv` (default `true`). `export` sets it to `false`: it reads a crawl result
file off disk and writes a CSV without touching the Cloudflare API, so requiring credentials would
be a false dependency. Every other command still fails fast on a missing `CF_ACCOUNT_ID` /
`CF_API_TOKEN`.

**Streaming crawl writer.** Large crawl downloads stream record-by-record into the final output file
during pagination, so memory stays bounded and there is no `.partial` file model. `export` reads
back the same way: `.jsonl` input is consumed line by line through `readline` and rows are written
as they are read, sharing `streamWrite` (backpressure-aware) with the crawl writers. Row order
therefore follows the input — nothing is buffered to sort. `.json` input is parsed whole, which is
the format's own ceiling, and is validated before the output stream opens so a bad input leaves no
partial CSV behind.

## Large downloads

For large crawl jobs, prefer the compiled CLI in a normal terminal over `tsx`:

```bash
pnpm run build
node dist/index.js download <jobId>
node dist/index.js download <jobId> --format jsonl
```
