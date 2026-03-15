# cf-crawl

Crawl and scrape any website using the [Cloudflare Browser Rendering API](https://developers.cloudflare.com/browser-rendering/).

## Setup

```bash
npm install
cp .env.example .env
# Fill in your Cloudflare credentials in .env
```

You need:
- **CF_ACCOUNT_ID** — found in the Cloudflare dashboard under any domain → Overview → right sidebar
- **CF_API_TOKEN** — create at https://dash.cloudflare.com/profile/api-tokens with Browser Rendering: Edit permission

## Usage

### Crawl an entire site

```bash
node index.js crawl <url> [options]
```

Options:
- `--render` — Use full browser rendering (billed at $0.09/hr). Default is fast HTML-only fetch (free during beta)
- `--limit N` — Max pages to crawl (default: 100,000)
- `--max_depth N` — Max link depth to follow

Examples:
```bash
node index.js crawl https://example.com
node index.js crawl https://example.com --render --limit 1000
```

Crawl jobs run asynchronously on Cloudflare. The CLI polls for results and saves them when complete. Results are available on Cloudflare for 14 days after completion.

### Scrape a single page

```bash
node index.js scrape <url>
```

Extracts titles, headings, paragraphs, links, images, and meta descriptions from a single page.

### npm scripts

```bash
npm run crawl -- <url>            # fast HTML-only
npm run crawl:render -- <url>     # full browser rendering
npm run scrape -- <url>
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
