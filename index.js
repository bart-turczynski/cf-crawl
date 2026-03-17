/**
 * Crawl — Cloudflare Browser Rendering API client
 *
 * Usage:
 *   node index.js crawl <url> [--render] [--limit N] [--max_depth N]
 *   node index.js scrape <url>
 *
 *   npm run crawl -- <url>
 *   npm run crawl:render -- <url>
 *   npm run scrape -- <url>
 */

import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CF_API_TOKEN;

if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
  console.error("Missing CF_ACCOUNT_ID or CF_API_TOKEN in .env");
  process.exit(1);
}

const API_BASE = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/browser-rendering`;
const DEFAULT_URL = undefined;
const OUTPUT_DIR = join(__dirname, "output");
const POLL_INTERVAL_MS = 15_000;
const MAX_POLL_ATTEMPTS = 240;  // ~60 minutes max

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function cfFetch(path, options = {}, retries = 3) {
  const url = `${API_BASE}${path}`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${CF_API_TOKEN}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });

      const data = await res.json();

      if (data.errors?.length) {
        console.error("API Error:", JSON.stringify(data.errors, null, 2));
        process.exit(1);
      }

      return data;
    } catch (err) {
      if (attempt < retries) {
        console.warn(`\n  Network error (attempt ${attempt}/${retries}): ${err.message}. Retrying in 5s...`);
        await sleep(5000);
      } else {
        throw err;
      }
    }
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function saveResult(filename, data) {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const filepath = join(OUTPUT_DIR, filename);
  await writeFile(filepath, JSON.stringify(data, null, 2));
  console.log(`Saved: ${filepath}`);
  return filepath;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Crawl — uses /crawl endpoint (async job)
// ---------------------------------------------------------------------------

async function crawl(startUrl, render = false, { limit = 100_000 } = {}) {
  const tag = `[${new URL(startUrl).hostname}]`;
  console.log(`\n${tag} Starting crawl: ${startUrl}`);
  console.log(`${tag} Render: ${render ? "full browser (billed)" : "fast HTML (free beta)"} | Limit: ${limit}`);

  // Kick off
  const body = { url: startUrl, render, limit };
  const job = await cfFetch("/crawl", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const jobId = typeof job.result === "string"
    ? job.result
    : (job.result?.id ?? job.result?.jobId);
  if (!jobId) {
    console.error(`${tag} No job ID returned:`, JSON.stringify(job, null, 2));
    return { error: "no_job_id", url: startUrl };
  }

  console.log(`${tag} Job ID: ${jobId}`);

  // Poll
  for (let i = 1; i <= MAX_POLL_ATTEMPTS; i++) {
    const result = await cfFetch(`/crawl/${jobId}`);
    const status = result.result?.status ?? "unknown";

    if (["completed", "done", "finished"].includes(status)) {
      console.log(`${tag} Crawl complete! Fetching all pages...`);
      const r = result.result;
      const total = r?.finished ?? r?.total ?? 0;
      const skipped = r?.skipped ?? 0;

      // Paginate through all records
      let allRecords = [...(r?.records ?? [])];
      let cursor = r?.cursor;

      while (cursor && allRecords.length < total) {
        console.log(`${tag} Fetching records: ${allRecords.length} / ${total}`);
        const page = await cfFetch(`/crawl/${jobId}?cursor=${cursor}`);
        const pageRecords = page.result?.records ?? [];
        if (pageRecords.length === 0) break;
        allRecords.push(...pageRecords);
        cursor = page.result?.cursor;
      }

      console.log(`${tag} Pages fetched: ${allRecords.length} | Skipped: ${skipped} | Total discovered: ${total + skipped}`);
      if (r?.browserSecondsUsed != null) console.log(`${tag} Browser seconds used: ${r.browserSecondsUsed}`);

      // Save full result with all records
      const fullResult = { ...result, result: { ...r, records: allRecords } };
      const host = new URL(startUrl).hostname.replace(/^www\./, "");
      await saveResult(`crawl_${host}_${timestamp()}.json`, fullResult);
      return fullResult;
    }

    if (["failed", "error"].includes(status)) {
      console.error(`${tag} Crawl failed:`, JSON.stringify(result.result, null, 2));
      return { error: "crawl_failed", url: startUrl, result: result.result };
    }

    const progress = result.result?.pagesProcessed ?? result.result?.progress ?? "in progress";
    console.log(`${tag} Poll ${i}/${MAX_POLL_ATTEMPTS} — status: ${status} | progress: ${progress}`);
    await sleep(POLL_INTERVAL_MS);
  }

  console.error(`${tag} Timed out. Job ID for manual check: ${jobId}`);
  return { error: "timeout", url: startUrl, jobId };
}

// ---------------------------------------------------------------------------
// Scrape — uses /scrape endpoint (synchronous, single page)
// ---------------------------------------------------------------------------

async function scrape(targetUrl) {
  const tag = `[${new URL(targetUrl).hostname}]`;
  console.log(`\n${tag} Scraping: ${targetUrl}`);

  const result = await cfFetch("/scrape", {
    method: "POST",
    body: JSON.stringify({
      url: targetUrl,
      elements: [
        { selector: "title" },
        { selector: "meta[name='description']" },
        { selector: "h1" },
        { selector: "h2" },
        { selector: "h3" },
        { selector: "p" },
        { selector: "a[href]" },
        { selector: "img[src]" },
      ],
      waitForSelector: { selector: "h1" },
    }),
  });

  // Quick summary
  const results = result.result ?? [];
  console.log(`${tag} === Summary ===`);
  for (const group of results) {
    const count = group.results?.length ?? 0;
    console.log(`${tag}   ${group.selector}: ${count} element(s)`);
  }

  const slug = targetUrl.replace(/https?:\/\//, "").replace(/\//g, "_").replace(/_$/, "");
  await saveResult(`scrape_${slug}_${timestamp()}.json`, result);
  return result;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const [command, ...rest] = process.argv.slice(2);
const doRender = rest.includes("--render");

function flagValue(name) {
  const idx = rest.indexOf(name);
  return idx !== -1 && rest[idx + 1] ? Number(rest[idx + 1]) : undefined;
}

const limitArg = flagValue("--limit");
const max_depthArg = flagValue("--max_depth");

function normalizeUrl(raw) {
  if (!/^https?:\/\//i.test(raw)) return `https://${raw}`;
  return raw;
}

const urlArgs = rest
  .filter((a) => !a.startsWith("--") && !(rest[rest.indexOf(a) - 1]?.startsWith("--") && !isNaN(Number(a))))
  .filter((a) => isNaN(Number(a)))
  .map(normalizeUrl);

const targetUrls = urlArgs.length ? urlArgs : DEFAULT_URL ? [DEFAULT_URL] : [];

switch (command) {
  case "crawl": {
    if (targetUrls.length === 0) {
      console.error("Error: URL is required.\nUsage: node index.js crawl <url> [<url2> ...] [--render] [--limit N]");
      process.exit(1);
    }
    const opts = {};
    if (limitArg) opts.limit = limitArg;
    if (max_depthArg) opts.max_depth = max_depthArg;
    console.log(`\nCrawling ${targetUrls.length} URL(s) in parallel...\n`);
    const results = await Promise.allSettled(targetUrls.map((url) => crawl(url, doRender, opts)));
    const failed = results.filter((r) => r.status === "rejected" || r.value?.error);
    if (failed.length) {
      console.error(`\n${failed.length} crawl(s) failed.`);
    }
    console.log(`\nAll ${targetUrls.length} crawl(s) finished.`);
    break;
  }
  case "scrape": {
    if (targetUrls.length === 0) {
      console.error("Error: URL is required.\nUsage: node index.js scrape <url> [<url2> ...]");
      process.exit(1);
    }
    console.log(`\nScraping ${targetUrls.length} URL(s) in parallel...\n`);
    const results = await Promise.allSettled(targetUrls.map((url) => scrape(url)));
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length) {
      console.error(`\n${failed.length} scrape(s) failed.`);
    }
    console.log(`\nAll ${targetUrls.length} scrape(s) finished.`);
    break;
  }
  default:
    console.log(`
Usage:
  node index.js crawl <url> [<url2> ...] [--render]   Crawl site(s) (async)
  node index.js scrape <url> [<url2> ...]              Scrape page(s) (sync)

Options:
  --render       Use full browser rendering (billed; default is fast HTML-only)
  --limit N      Max pages to crawl (default: 100000)
  --max_depth N  Max link depth to follow

URLs can be passed with or without https:// prefix.

Examples:
  node index.js crawl https://example.com
  node index.js crawl example.com blog.example.com --render --limit 100
  node index.js scrape https://example.com/pricing
    `);
}
