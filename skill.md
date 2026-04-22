---
name: cf-crawl
description: Use the cf-crawl CLI to crawl sites, scrape pages, render HTML or PDFs, extract links or structured JSON, capture screenshots or snapshots, and convert local files to markdown via the Cloudflare Browser Rendering API.
allowed-tools: Bash, Agent
argument-hint: "<command> <url-or-file> [<url2> ...] [flags]  — commands: crawl|scrape|markdown|content|links|json|pdf|screenshot|snapshot|tomarkdown|status|download|jobs"
---

# cf-crawl

Use the `cf-crawl` CLI from the project root (the directory containing `package.json`) to access the Cloudflare Browser Rendering API and Workers AI `tomarkdown`. Run commands as `npm run <command> -- <args>`.

URLs may be passed without `https://`; the CLI normalizes them internally.

## Command Selection

Pick the command that matches the user's intent:

| Intent                                                  | Command      |
| ------------------------------------------------------- | ------------ |
| Site-wide crawl, discover many pages, async job         | `crawl`      |
| Extract structured page content from built-in selectors | `scrape`     |
| Save readable page content as markdown                  | `markdown`   |
| Fetch rendered HTML                                     | `content`    |
| Extract hyperlinks                                      | `links`      |
| Prompt-driven structured extraction                     | `json`       |
| Render a PDF                                            | `pdf`        |
| Capture a screenshot                                    | `screenshot` |
| Capture HTML plus screenshot metadata                   | `snapshot`   |
| Convert local files to markdown                         | `tomarkdown` |
| Check crawl progress                                    | `status`     |
| Download crawl results                                  | `download`   |
| List locally tracked crawl jobs                         | `jobs`       |

Pick `markdown` when the user wants **clean readable content** ("get the article text", "save these pages as markdown", "scrape output is too messy"). Pick `scrape` when the user wants **structured element counts / specific selectors**. Pick `content` when the user needs **raw rendered HTML**.

`tomarkdown` accepts local files only and rejects live `http(s)` URLs. For live webpages, use `markdown`.

## Important Flags

| Flag                                | Applies to          | Meaning                                              |
| ----------------------------------- | ------------------- | ---------------------------------------------------- |
| `--render`                          | `crawl` only        | Full browser rendering instead of fast HTML mode     |
| `--limit N`                         | `crawl`             | Max pages to crawl                                   |
| `--max_depth N`                     | `crawl`             | Max link depth                                       |
| `--no-wait`                         | `crawl`             | Submit job and exit without polling                  |
| `--format json` \| `--format jsonl` | `crawl`, `download` | Output format for crawl results                      |
| `--wait N`                          | `scrape`            | Delay (ms) before extraction; default waits for `h1` |
| `--visible-only`                    | `links`             | Keep only visible links                              |
| `--exclude-external`                | `links`             | Exclude off-domain links                             |
| `--prompt "..."`                    | `json`              | Required extraction instruction                      |
| `--schema <path>`                   | `json`              | Optional JSON schema file                            |
| `--full-page`                       | `screenshot`        | Capture the full scrollable page                     |
| `--format png` \| `jpeg` \| `webp`  | `screenshot`        | Screenshot image format (default `png`)              |

## Crawl Size Tiers

Decide sync vs async based on expected scope:

| Tier      | Condition                                                                    | Behavior                                                                         |
| --------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Small** | `--limit` ≤ 500, or user implies small scope                                 | Run synchronously — wait, report summary                                         |
| **Large** | `--limit` > 500, no `--limit`, or user says "full site"/"large"/"everything" | Use `--no-wait` — submit, return job ID, tell the user how to check status later |

When in doubt about size, ask. A crawl with no `--limit` can discover 100K+ pages and run for an hour.

## Cost / Billing

- Default `crawl` mode is fast HTML-only and free during beta.
- `--render` uses full browser rendering and is billed (~$0.09 per browser hour).
- `scrape`, `markdown`, `content`, `links`, `json`, `pdf`, `screenshot`, `snapshot` always use browser rendering on Cloudflare's side — they incur rendering cost per call.
- Cloudflare retains crawl results for 14 days after job completion. After that `download` will fail for that `jobId`.

## Execution Guidance

Prefer a **single CLI invocation**. The CLI already accepts multiple URLs in one run for `crawl`, `scrape`, `markdown`, `content`, `links`, `json`, `pdf`, `screenshot`, `snapshot`. `tomarkdown` accepts multiple local file paths. Run from the project root:

```bash
npm run crawl -- https://example.com --limit 100
npm run crawl -- https://example.com --no-wait
npm run scrape -- https://example.com/page --wait 3000
npm run markdown -- https://example.com/article
npm run content -- https://example.com
npm run links -- https://example.com --visible-only --exclude-external
npm run json -- https://example.com --prompt "Extract title and main CTA"
npm run pdf -- https://example.com
npm run screenshot -- https://example.com --full-page --format webp
npm run snapshot -- https://example.com
npm run tomarkdown -- ./report.pdf ./notes.docx
npm run status -- <jobId>
npm run download -- <jobId> --format jsonl
npm run jobs
```

### Agent fan-out

Only use Agent fan-out when the user explicitly asks for parallel per-URL work beyond what the CLI already does (e.g. a different `--prompt` per URL for `json`).

**CRITICAL: never launch more than 10 concurrent agents. This is a hard billing safety cap.** Split larger lists into batches of ≤10, run each batch in a single message so they execute concurrently, wait for completion, then launch the next batch.

Each agent runs `npm run <command> -- <url> [flags]` from the project root and reports back: the command, success/failure, key output (job ID for async crawls, summary for sync calls, or error message).

## Async Crawl Follow-up

After an async (`--no-wait`) crawl, give the user the exact follow-up commands:

```bash
npm run status -- <jobId>      # check progress
npm run download -- <jobId>    # download current results (works while running too)
npm run download -- <jobId> --format jsonl
npm run jobs                   # list locally tracked jobs
```

## Output Expectations

Summarize the result based on the command:

- `crawl` (sync): finished/skipped counts, output path, browser seconds when present
- `crawl` (`--no-wait`): job ID + URL + the follow-up commands above; tabulate if multiple
- `status`: job status and current crawl counts
- `download`: output path and record count
- `scrape`: per-selector element counts and output path
- `markdown`: character and line count plus output path
- `content`, `links`, `json`, `snapshot`: concise summary plus output path
- `pdf`, `screenshot`: byte count plus output path
- `tomarkdown`: success or error per file plus output path for each generated markdown file

## Errors

- Auth errors → suggest checking `.env` (`CF_ACCOUNT_ID`, `CF_API_TOKEN`)
- Empty / broken crawl results on JS-heavy sites → suggest `--render`
- `download` failing for an old job → likely past the 14-day retention window

## Important Notes

- `.env` must contain `CF_ACCOUNT_ID` and `CF_API_TOKEN` in the project root
- `crawl` is async; all other live-URL commands are synchronous
- `crawl` results stream directly into the final output file — there is no `.partial` file
- `tomarkdown` only accepts local files and intentionally rejects live URLs
- Use `markdown` for live webpages, not `tomarkdown`
