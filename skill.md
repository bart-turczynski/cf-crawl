---
name: cf-crawl
description: Crawl or scrape websites using the Cloudflare Browser Rendering API. Use when the user says "crawl", "scrape", or wants to fetch/extract content from URLs. Supports batch operations with up to 10 concurrent agents.
allowed-tools: Bash, Agent, Read
argument-hint: "<crawl|scrape> <url> [url2 ...] [--render] [--limit N] [--max_depth N]"
---

# cf-crawl

Crawl or scrape websites via the Cloudflare Browser Rendering API using the `cf-crawl` CLI tool.

All commands run from the project root (the directory containing `package.json`). Use `npm run <command> -- <args>` from there.

## Parsing $ARGUMENTS

Parse `$ARGUMENTS` to determine the command and parameters:

| Part            | How to detect                                                                                                      | Default                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Command         | First word: `crawl` or `scrape`                                                                                    | `crawl`                                         |
| URLs            | Any tokens that look like URLs or domains (contain `.`)                                                            | required, at least one                          |
| `--render`      | User says "render", "rendered", "full browser", "JS rendering"                                                     | omit (fast HTML mode)                           |
| `--limit N`     | User says "limit N", "cap at N", "max N pages"                                                                     | omit for scrape; see size tiers below for crawl |
| `--max_depth N` | User says "depth N", "N levels deep"                                                                               | omit                                            |
| `--no-wait`     | User says "async", "don't wait", "fire and forget", "large", "full site" — OR if limit > 500 or no limit specified | omit                                            |

URLs work with or without `https://` prefix. Always pass them as-is to the CLI (it normalizes internally).

## Size tiers for crawl

Decide the execution mode based on the expected crawl size:

| Tier      | Condition                                                                | Behavior                                                                                               |
| --------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| **Small** | `--limit` <= 500 (or user implies small scope)                           | Run synchronously — wait for results, report summary                                                   |
| **Large** | `--limit` > 500, no limit, or user says "full site"/"large"/"everything" | Use `--no-wait` — submit the job, return job IDs, tell the user how to check status and download later |

When in doubt about size, ask the user. A crawl with no `--limit` can discover 100K+ pages and run for an hour.

## Single URL execution

Run directly via Bash from the project root:

Examples:

- `npm run crawl -- https://example.com --limit 100`
- `npm run crawl -- https://example.com --no-wait` (large/async)
- `npm run scrape -- https://example.com/page`
- `npm run scrape -- https://example.com/page --render --wait 3000`

## Multiple URLs execution

**CRITICAL: Never exceed 10 concurrent agents. This is a hard billing safety limit.**

When the user provides multiple URLs:

1. Split the URLs into batches of **at most 10**.
2. Launch one Agent (subagent_type: `general-purpose`) per URL in the batch, all in a **single message** so they run concurrently.
3. Each agent runs `npm run <command> -- <url> [flags]` from the project root.
4. If there are more than 10 URLs, wait for the first batch to complete, then launch the next batch.
5. Collect and summarize all results after all batches complete.

Agent prompt template for each URL:

```
Run this command from the cf-crawl project root and report the output:
npm run <command> -- <url> [flags]

Report back: the command you ran, whether it succeeded or failed, and the key output (job ID for async crawls, summary stats for completed crawls/scrapes, or the error message if it failed).
```

For **large async crawls** with multiple URLs, each agent uses `--no-wait`. After all agents return, compile a table of job IDs for the user.

## Async crawl follow-up

After submitting async (large) crawls, tell the user they can check status or download results later. Provide the exact commands:

```
npm run status -- <jobId>      # Check if the crawl is done
npm run download -- <jobId>    # Download results when complete
npm run jobs                   # List all logged jobs
```

If the user asks to "check on" or "download" a previous crawl, run the appropriate command directly.

## Output format

After execution, present results to the user:

**For completed crawls:**

- Pages crawled count
- Pages skipped count
- Output file path
- Browser seconds used (if render mode)

**For scrapes:**

- Element counts per selector (title, h1, h2, links, etc.)
- Output file path

**For async (no-wait) crawls:**

- Job ID
- URL submitted
- Commands to check status / download later
- If multiple jobs, present as a table

**For errors:**

- The error message
- Suggest checking `.env` credentials if it's an auth error
- Suggest `--render` if the site requires JS rendering

## Important notes

- The `.env` file with `CF_ACCOUNT_ID` and `CF_API_TOKEN` must exist in the project root
- Default crawl mode is fast HTML-only (free during beta). `--render` uses full browser rendering (billed at ~$0.09/browser hour)
- Crawl results persist on Cloudflare for 14 days after job completion
- Output files are saved to `output/` as JSON
- Scrape is always synchronous (returns immediately) — no async mode needed
