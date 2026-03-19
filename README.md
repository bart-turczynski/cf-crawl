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

### Crawl sites

```bash
node index.js crawl <url> [<url2> ...] [options]
```

Multiple URLs are crawled **in parallel**. URLs can be passed with or without `https://` prefix.

Options:
- `--render` — Use full browser rendering (billed at $0.09/hr). Default is fast HTML-only fetch (free during beta)
- `--limit N` — Max pages to crawl per site (default: 100,000)
- `--max_depth N` — Max link depth to follow

Examples:
```bash
node index.js crawl https://example.com
node index.js crawl example.com blog.example.com --render --limit 100
node index.js crawl www.site1.com www.site2.com www.site3.com --limit 1
```

Crawl jobs run asynchronously on Cloudflare. The CLI polls for results and saves them when complete. Results are available on Cloudflare for 14 days after completion.

### Scrape pages

```bash
node index.js scrape <url> [<url2> ...]
```

Extracts titles, headings, paragraphs, links, images, and meta descriptions. Multiple URLs are scraped **in parallel**.

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
