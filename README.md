# cf-crawl

Crawl sites, scrape pages, render PDFs and screenshots, extract structured JSON, and convert local files to markdown using the [Cloudflare Browser Rendering API](https://developers.cloudflare.com/browser-rendering/).

The CLI supports three broad workflows:

- Async site crawls via `/crawl`
- Synchronous single-page operations such as `scrape`, `markdown`, `content`, `links`, `json`, `pdf`, `screenshot`, and `snapshot`
- Local file conversion via Workers AI `/ai/tomarkdown`

## Setup

```bash
npm install
cp .env.example .env
# Fill in your Cloudflare credentials in .env

# Install the Claude Code skill
mkdir -p .claude/skills/cf-crawl
cp skill.md .claude/skills/cf-crawl/SKILL.md
```

You need:

- **CF_ACCOUNT_ID** — found in the Cloudflare dashboard under any domain -> Overview -> right sidebar
- **CF_API_TOKEN** — create at https://dash.cloudflare.com/profile/api-tokens with Browser Rendering: Edit permission

## Quick Start

```bash
npx tsx index.ts --help
npx tsx index.ts crawl example.com --limit 100
npx tsx index.ts markdown https://example.com/article
```

URLs can be passed with or without `https://`. The CLI normalizes them internally.

## Commands

### Crawl sites

```bash
npx tsx index.ts crawl <url> [<url2> ...] [options]
```

`crawl` submits async jobs to Cloudflare and, unless `--no-wait` is passed, polls until completion and downloads the results.

Options:

- `--render` — use full browser rendering; default is fast HTML-only crawl
- `--limit N` — max pages to crawl per site, default `100000`
- `--max_depth N` — max link depth to follow
- `--no-wait` — submit the job and exit without polling
- `--format json|jsonl` — output format when results are downloaded

Examples:

```bash
npx tsx index.ts crawl https://example.com
npx tsx index.ts crawl example.com blog.example.com --render --limit 100
npx tsx index.ts crawl site.com --limit 1000 --format jsonl
npx tsx index.ts crawl site.com --no-wait
```

Notes:

- Multiple URLs are submitted concurrently.
- Completed crawl downloads stream directly into the final output file; there is no separate `.partial` artifact.
- Cloudflare keeps crawl results for 14 days after completion.

### Check or download crawl jobs

```bash
npx tsx index.ts status <jobId>
npx tsx index.ts download <jobId> [--format json|jsonl]
npx tsx index.ts jobs
```

- `status` shows the current crawl state, finished/skipped counts, and browser seconds used when available
- `download` fetches the current result set for any crawl job ID, including still-running jobs
- `jobs` prints the locally tracked crawl job log from `output/jobs.jsonl`

### Scrape pages

```bash
npx tsx index.ts scrape <url> [<url2> ...] [--wait N]
```

Extracts:

- title
- meta description
- headings (`h1`, `h2`, `h3`)
- paragraphs
- list items
- table cells (`td`, `th`)
- links
- images

`/scrape` always uses browser rendering. `--wait N` adds a fixed delay before extraction; without it, the command waits for an `h1`.

### Convert pages to markdown

```bash
npx tsx index.ts markdown <url> [<url2> ...]
```

Converts live pages to clean markdown via `/markdown`. One `.md` file is written per URL.

### Fetch rendered HTML

```bash
npx tsx index.ts content <url> [<url2> ...]
```

Fetches fully rendered HTML from `/content` and saves it as `.html`.

### Extract links

```bash
npx tsx index.ts links <url> [<url2> ...] [--visible-only] [--exclude-external]
```

Returns the page hyperlinks as JSON.

- `--visible-only` — include only visible links
- `--exclude-external` — exclude off-domain links

### Extract structured JSON

```bash
npx tsx index.ts json <url> [<url2> ...] --prompt "..." [--schema ./schema.json]
```

Runs the `/json` endpoint with a required natural-language prompt.

- `--prompt "..."` — required extraction instruction
- `--schema <path>` — optional JSON schema file; sent as `response_format: { type: "json_schema", json_schema: ... }`

Example:

```bash
npx tsx index.ts json https://example.com --prompt "Extract the page title and main CTA"
npx tsx index.ts json https://example.com --prompt "Extract product details" --schema ./schema.json
```

### Render PDFs

```bash
npx tsx index.ts pdf <url> [<url2> ...]
```

Renders each page to a PDF via `/pdf`.

### Capture screenshots

```bash
npx tsx index.ts screenshot <url> [<url2> ...] [--full-page] [--format png|jpeg|webp]
```

- `--full-page` — capture the full scrollable page
- `--format png|jpeg|webp` — image format, default `png`

When `jpeg` is selected, the file is saved with a `.jpg` extension.

### Capture HTML plus screenshot in one call

```bash
npx tsx index.ts snapshot <url> [<url2> ...]
```

Calls `/snapshot` and saves the JSON response containing rendered HTML plus a base64 screenshot.

### Convert local files to markdown

```bash
npx tsx index.ts tomarkdown <file> [<file2> ...]
```

Uploads local files such as PDFs, DOCX files, images, or HTML to Workers AI `/ai/tomarkdown` and writes one `.md` file per successful result.

Notes:

- This command accepts only local file paths
- Live `http(s)` URLs are rejected intentionally
- Use `markdown` for live webpages

## npm Scripts

```bash
npm run crawl -- <url> [<url2> ...]
npm run crawl:render -- <url> [<url2> ...]
npm run scrape -- <url> [<url2> ...]
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
```

## Output

Results are written to `output/` with timestamped names:

- `crawl_{hostname}_{shortJobId}_{timestamp}.json`
- `crawl_{hostname}_{shortJobId}_{timestamp}.jsonl`
- `scrape_{slug}_{timestamp}.json`
- `markdown_{slug}_{timestamp}.md`
- `content_{slug}_{timestamp}.html`
- `links_{slug}_{timestamp}.json`
- `json_{slug}_{timestamp}.json`
- `pdf_{slug}_{timestamp}.pdf`
- `screenshot_{slug}_{timestamp}.png`
- `screenshot_{slug}_{timestamp}.jpg`
- `screenshot_{slug}_{timestamp}.webp`
- `snapshot_{slug}_{timestamp}.json`
- `tomarkdown_{stem}_{timestamp}.md`
- `jobs.jsonl`

## Build and Development

```bash
npm run build                # compile TypeScript to dist/
node dist/index.js --help    # run the compiled CLI

npm test
npm run typecheck
npm run lint
npm run format
npm run format:check
```

## Shell Scripts

Standalone bash equivalents remain in `scripts/` for quick one-off reference runs:

```bash
./scripts/crawl.sh <url>
./scripts/scrape.sh <url>
```

They are not kept at full feature parity with the TypeScript CLI.
