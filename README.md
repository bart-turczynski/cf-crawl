# cf-crawl

Crawl and scrape any website using the [Cloudflare Browser Rendering API](https://developers.cloudflare.com/browser-rendering/).

## Setup

```bash
npm install
cp .env.example .env
# Fill in your Cloudflare credentials in .env

# Optional: install Claude Code skill for natural-language crawl/scrape
mkdir -p .claude/commands
cp cf-crawl.md .claude/commands/cf-crawl.md
```

You need:
- **CF_ACCOUNT_ID** — found in the Cloudflare dashboard under any domain → Overview → right sidebar
- **CF_API_TOKEN** — create at https://dash.cloudflare.com/profile/api-tokens with Browser Rendering: Edit permission

## Usage

```
node index.js --help
node index.js -h
```

### Crawl sites

```bash
node index.js crawl <url> [<url2> ...] [options]
```

Multiple URLs are crawled **in parallel**. URLs can be passed with or without `https://` prefix.

Options:
- `--render` — Use full browser rendering (billed at $0.09/hr). Default is fast HTML-only fetch (free during beta)
- `--limit N` — Max pages to crawl per site (default: 100,000)
- `--max_depth N` — Max link depth to follow
- `--no-wait` — Submit job(s) and exit without polling (fire-and-forget)
- `--help`, `-h` — Show usage information

Examples:
```bash
node index.js crawl https://example.com
node index.js crawl example.com blog.example.com --render --limit 100
node index.js crawl www.site1.com www.site2.com www.site3.com --limit 1
node index.js crawl site.com --no-wait
```

Crawl jobs run asynchronously on Cloudflare. The CLI polls for results and saves them when complete. Results are available on Cloudflare for 14 days after completion.

### Scrape pages

```bash
node index.js scrape <url> [<url2> ...] [options]
```

Extracts titles, headings, paragraphs, links, images, and meta descriptions. Multiple URLs are scraped **in parallel**.

Options:
- `--render` — Use full browser rendering
- `--wait N` — Wait N ms for page to load

### Manage jobs

```bash
node index.js status <jobId>     # Check crawl job status
node index.js download <jobId>   # Download results for a job
node index.js jobs               # List all logged jobs
```

### npm scripts

```bash
npm run crawl -- <url> [<url2> ...]       # fast HTML-only
npm run crawl:render -- <url> [<url2> ...]  # full browser rendering
npm run scrape -- <url> [<url2> ...]
```

## Output

Results are saved as JSON to the `output/` directory with timestamped filenames:
- `crawl_{hostname}_{timestamp}.json`
- `scrape_{slug}_{timestamp}.json`

## Shell scripts

Standalone bash equivalents are available in `scripts/` for quick one-off runs using `curl` and `jq`:

```bash
./scripts/crawl.sh <url>
./scripts/scrape.sh <url>
```
