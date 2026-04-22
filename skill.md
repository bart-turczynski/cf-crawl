---
name: cf-crawl
description: Use the cf-crawl CLI to crawl sites, scrape pages, render HTML or PDFs, extract links or structured JSON, capture screenshots or snapshots, and convert local files to markdown.
allowed-tools: Bash, Agent, Read
argument-hint: "<crawl|scrape|markdown|content|links|json|pdf|screenshot|snapshot|tomarkdown|status|download|jobs> ..."
---

# cf-crawl

Use the `cf-crawl` CLI from the project root to access the Cloudflare Browser Rendering API and Workers AI `tomarkdown`.

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

URLs may be passed without `https://`; the CLI normalizes them internally.

## Important Flags

| Flag                 | Applies to   | Meaning                                          |
| -------------------- | ------------ | ------------------------------------------------ | ------------------------------- | ----------------------- |
| `--render`           | `crawl` only | Full browser rendering instead of fast HTML mode |
| `--limit N`          | `crawl`      | Max pages to crawl                               |
| `--max_depth N`      | `crawl`      | Max link depth                                   |
| `--no-wait`          | `crawl`      | Submit job and exit without polling              |
| `--format json       | jsonl`       | `crawl`, `download`                              | Output format for crawl results |
| `--wait N`           | `scrape`     | Delay before extraction                          |
| `--visible-only`     | `links`      | Keep only visible links                          |
| `--exclude-external` | `links`      | Exclude off-domain links                         |
| `--prompt "..."`     | `json`       | Required extraction instruction                  |
| `--schema <path>`    | `json`       | Optional JSON schema file                        |
| `--full-page`        | `screenshot` | Capture the full page                            |
| `--format png        | jpeg         | webp`                                            | `screenshot`                    | Screenshot image format |

## Execution Guidance

Prefer a single CLI invocation. The CLI already supports multiple live URLs in one run for:

- `crawl`
- `scrape`
- `markdown`
- `content`
- `links`
- `json`
- `pdf`
- `screenshot`
- `snapshot`

`tomarkdown` accepts multiple local files in one invocation.

Use Agent fan-out only if the user explicitly wants additional parallel work per URL beyond what the CLI already does.

Examples:

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

## Crawl Size Guidance

Use synchronous crawl mode when the scope is obviously small, such as `--limit 500` or less.

Use `--no-wait` when:

- the user asks for async or fire-and-forget behavior
- the crawl is likely large
- there is no explicit limit
- the user wants the whole site

For async crawls, provide follow-up commands:

```bash
npm run status -- <jobId>
npm run download -- <jobId>
npm run download -- <jobId> --format jsonl
npm run jobs
```

## Output Expectations

Summarize the result based on the command:

- `crawl`: finished/skipped counts, output path, browser seconds when present
- `status`: job status and current crawl counts
- `download`: output path and record count
- `scrape`: per-selector element counts and output path
- `markdown`: character and line count plus output path
- `content`, `links`, `json`, `snapshot`: concise summary plus output path
- `pdf`, `screenshot`: byte count plus output path
- `tomarkdown`: success or error per file plus output path for each generated markdown file

## Important Notes

- `.env` must contain `CF_ACCOUNT_ID` and `CF_API_TOKEN`
- `crawl` is async; most other live-URL commands are synchronous
- `crawl` results stream directly into the final output file; there is no `.partial` file
- `tomarkdown` only accepts local files and intentionally rejects live URLs
- Use `markdown` for live webpages, not `tomarkdown`
