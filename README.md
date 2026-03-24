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

```
npx tsx index.ts --help
npx tsx index.ts -h
```

### Crawl sites

```bash
npx tsx index.ts crawl <url> [<url2> ...] [options]
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
npx tsx index.ts crawl https://example.com
npx tsx index.ts crawl example.com blog.example.com --render --limit 100
npx tsx index.ts crawl www.site1.com www.site2.com www.site3.com --limit 1
npx tsx index.ts crawl site.com --no-wait
```

Crawl jobs run asynchronously on Cloudflare. The CLI polls for results and saves them when complete. Results are available on Cloudflare for 14 days after completion.

### Scrape pages

```bash
npx tsx index.ts scrape <url> [<url2> ...] [options]
```

Extracts titles, headings, paragraphs, links, images, and meta descriptions. Multiple URLs are scraped **in parallel**.

Options:

- `--render` — Use full browser rendering
- `--wait N` — Wait N ms for page to load

### Manage jobs

```bash
npx tsx index.ts status <jobId>     # Check crawl job status
npx tsx index.ts download <jobId>   # Download results for a job
npx tsx index.ts jobs               # List all logged jobs
```

### npm scripts

```bash
npm run crawl -- <url> [<url2> ...]        # fast HTML-only
npm run crawl:render -- <url> [<url2> ...]  # full browser rendering
npm run scrape -- <url> [<url2> ...]
```

### Build

```bash
npm run build                # compile TypeScript to dist/
node dist/index.js --help    # run compiled output
```

## Development

```bash
npm test              # run tests (vitest)
npm run typecheck     # type check (tsc --noEmit)
npm run lint          # lint (eslint)
npm run format        # format (prettier --write)
npm run format:check  # check formatting
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
