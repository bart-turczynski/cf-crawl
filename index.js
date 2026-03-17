/**
 * Crawl — Cloudflare Browser Rendering API client
 *
 * Usage:
 *   node index.js crawl <url> [url2 ...] [--render] [--limit N] [--max_depth N] [--no-wait]
 *   node index.js scrape <url> [url2 ...] [--render]
 *   node index.js status <jobId>
 *   node index.js download <jobId>
 *   node index.js jobs
 *
 *   npm run crawl -- <url>
 *   npm run crawl:render -- <url>
 *   npm run scrape -- <url>
 */

import "dotenv/config";
import { writeFile, readFile, appendFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CF_API_TOKEN;
const API_BASE = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/browser-rendering`;
const OUTPUT_DIR = join(__dirname, "output");

const RETRY_DEFAULTS = { maxAttempts: 4, baseDelayMs: 1_000, maxDelayMs: 30_000 };
const POLL_DEFAULTS = { intervalMs: 10_000, maxAttempts: 360 }; // ~60 min

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

class CrawlError extends Error {
  constructor(message, { cause, retryable = false } = {}) {
    super(message, { cause });
    this.name = "CrawlError";
    this.retryable = retryable;
  }
}

class ApiError extends CrawlError {
  constructor(message, { status, errors, cause } = {}) {
    const retryable = status >= 500 || status === 429;
    super(message, { cause, retryable });
    this.name = "ApiError";
    this.status = status;
    this.errors = errors;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffDelay(attempt, baseMs, maxMs) {
  const jitter = Math.random() * 0.3 + 0.85; // 0.85–1.15x
  return Math.min(baseMs * 2 ** attempt * jitter, maxMs);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function normalizeUrl(input) {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  try {
    return new URL(url).href;
  } catch {
    throw new CrawlError(`Invalid URL: "${input}"`);
  }
}

async function saveResult(filename, data) {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const filepath = join(OUTPUT_DIR, filename);

  // For large results with many records, stream JSON to avoid string length limits
  const records = data.result?.records;
  if (records && records.length > 500) {
    const { createWriteStream } = await import("node:fs");
    const meta = { ...data, result: { ...data.result } };
    delete meta.result.records;

    await new Promise((resolve, reject) => {
      const ws = createWriteStream(filepath);
      ws.on("error", reject);
      ws.on("finish", resolve);

      // Write opening structure
      const metaJson = JSON.stringify(meta, null, 2);
      // Insert records array before the closing braces
      const insertPoint = metaJson.lastIndexOf("}");
      const before = metaJson.slice(0, insertPoint);
      ws.write(before);
      ws.write(`  "records": [\n`);

      for (let i = 0; i < records.length; i++) {
        const comma = i < records.length - 1 ? "," : "";
        ws.write(`    ${JSON.stringify(records[i])}${comma}\n`);
      }

      ws.write(`  ]\n`);
      // Close result object and root object
      ws.write(`  }\n}`);
      ws.end();
    });
  } else {
    await writeFile(filepath, JSON.stringify(data, null, 2));
  }

  console.log(`Saved: ${filepath}`);
  return filepath;
}

// ---------------------------------------------------------------------------
// Job log — JSONL file tracking all crawl jobs
// ---------------------------------------------------------------------------

const JOBS_FILE = join(OUTPUT_DIR, "jobs.jsonl");

async function logJob(entry) {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await appendFile(JOBS_FILE, JSON.stringify(entry) + "\n");
}

async function readJobLog() {
  try {
    const raw = await readFile(JOBS_FILE, "utf-8");
    return raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function updateJobLog(jobId, updates) {
  const entries = await readJobLog();
  let found = false;
  const updated = entries.map((e) => {
    if (e.jobId === jobId) {
      found = true;
      return { ...e, ...updates, updatedAt: new Date().toISOString() };
    }
    return e;
  });
  if (!found) {
    updated.push({ jobId, ...updates, updatedAt: new Date().toISOString() });
  }
  await writeFile(JOBS_FILE, updated.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

// ---------------------------------------------------------------------------
// Cloudflare API client with retry + exponential backoff
// ---------------------------------------------------------------------------

async function cfFetch(path, options = {}, retryOpts = {}) {
  const { maxAttempts, baseDelayMs, maxDelayMs } = { ...RETRY_DEFAULTS, ...retryOpts };
  const url = `${API_BASE}${path}`;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${CF_API_TOKEN}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });

      // Rate-limited — always retry
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after")) || 0;
        const delay = retryAfter > 0
          ? retryAfter * 1_000
          : backoffDelay(attempt, baseDelayMs, maxDelayMs);
        if (attempt < maxAttempts - 1) {
          console.warn(`  Rate limited. Retrying in ${(delay / 1000).toFixed(1)}s...`);
          await sleep(delay);
          continue;
        }
      }

      let data;
      try {
        data = await res.json();
      } catch {
        throw new ApiError(`Non-JSON response (HTTP ${res.status})`, { status: res.status });
      }

      if (!res.ok || data.errors?.length) {
        const err = new ApiError(
          data.errors?.[0]?.message || `HTTP ${res.status}`,
          { status: res.status, errors: data.errors }
        );
        if (err.retryable && attempt < maxAttempts - 1) {
          const delay = backoffDelay(attempt, baseDelayMs, maxDelayMs);
          console.warn(`  Server error (${res.status}). Retrying in ${(delay / 1000).toFixed(1)}s...`);
          await sleep(delay);
          continue;
        }
        throw err;
      }

      return data;
    } catch (err) {
      if (err instanceof ApiError) throw err;

      // Network-level error (ECONNRESET, DNS, timeout, etc.)
      if (attempt < maxAttempts - 1) {
        const delay = backoffDelay(attempt, baseDelayMs, maxDelayMs);
        console.warn(`  Network error: ${err.message}. Retrying in ${(delay / 1000).toFixed(1)}s...`);
        await sleep(delay);
      } else {
        throw new CrawlError(`Network request failed after ${maxAttempts} attempts`, {
          cause: err,
          retryable: false,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Crawl — /crawl endpoint (async job + polling + pagination)
// ---------------------------------------------------------------------------

async function submitCrawl(startUrl, render = false, { limit = 100_000, max_depth } = {}) {
  const url = normalizeUrl(startUrl);
  console.log(`\nStarting crawl: ${url}`);
  console.log(`Render mode: ${render ? "full browser (billed)" : "fast HTML (free beta)"}`);
  console.log(`Limit: ${limit}\n`);

  const body = { url, render, limit };
  if (max_depth != null) body.max_depth = max_depth;

  const job = await cfFetch("/crawl", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const jobId = typeof job.result === "string"
    ? job.result
    : (job.result?.id ?? job.result?.jobId);

  if (!jobId) {
    throw new CrawlError(`No job ID returned: ${JSON.stringify(job)}`);
  }

  console.log(`Job ID: ${jobId}`);

  await logJob({
    jobId,
    url,
    render,
    limit,
    max_depth: max_depth ?? null,
    startedAt: new Date().toISOString(),
    status: "submitted",
  });

  return { jobId, url };
}

async function pollCrawlJobs(jobs) {
  const { intervalMs, maxAttempts } = POLL_DEFAULTS;
  const active = new Map(jobs.map((j) => [j.jobId, j]));
  const results = [];
  const failures = [];

  for (let i = 1; i <= maxAttempts && active.size > 0; i++) {
    for (const [jobId, job] of active) {
      let result;
      try {
        result = await cfFetch(`/crawl/${jobId}`);
      } catch (err) {
        if (err.retryable !== false) {
          console.warn(`\n  Poll error for ${job.url} (attempt ${i}): ${err.message}. Will retry...`);
          continue;
        }
        failures.push({ ...job, error: err.message });
        active.delete(jobId);
        continue;
      }

      const st = result.result?.status ?? "unknown";

      if (["completed", "done", "finished"].includes(st)) {
        console.log(`\n[${new URL(job.url).hostname}] Crawl complete! Fetching all pages...`);
        await updateJobLog(jobId, { status: "completed", finished: result.result?.finished, skipped: result.result?.skipped });
        try {
          const collected = await collectResults(jobId, result, job.url);
          results.push({ ...job, status: "success", result: collected });
        } catch (err) {
          failures.push({ ...job, status: "failed", error: err.message });
        }
        active.delete(jobId);
        continue;
      }

      if (["failed", "error"].includes(st)) {
        await updateJobLog(jobId, { status: "failed" });
        failures.push({ ...job, status: "failed", error: `Crawl job failed: ${JSON.stringify(result.result)}` });
        active.delete(jobId);
        continue;
      }

      // Progress
      const finished = result.result?.finished;
      const skipped = result.result?.skipped;
      const progress = (finished != null)
        ? `${finished} finished, ${skipped ?? 0} skipped`
        : (result.result?.pagesProcessed ?? result.result?.progress ?? "in progress");
      const host = new URL(job.url).hostname;
      console.log(`  Poll ${i}/${maxAttempts} — [${host}] status: ${st} | pages: ${progress}`);
    }

    if (active.size > 0) await sleep(intervalMs);
  }

  // Timed-out jobs
  for (const [jobId, job] of active) {
    console.log(`\n[${new URL(job.url).hostname}] Timed out. To resume:`);
    console.log(`  node index.js status ${jobId}`);
    console.log(`  node index.js download ${jobId}`);
    await updateJobLog(jobId, { status: "poll-timeout" });
    failures.push({ ...job, status: "timeout", error: `Timed out after ${POLL_DEFAULTS.maxAttempts} polls` });
  }

  return { results, failures };
}

async function crawl(startUrl, render = false, { limit = 100_000, max_depth, wait = true } = {}) {
  const { jobId, url } = await submitCrawl(startUrl, render, { limit, max_depth });

  if (!wait) {
    console.log(`\nJob submitted (not waiting). To check later:`);
    console.log(`  node index.js status ${jobId}`);
    console.log(`  node index.js download ${jobId}`);
    return { jobId };
  }

  const { results, failures } = await pollCrawlJobs([{ jobId, url }]);
  if (failures.length > 0) {
    throw new CrawlError(failures[0].error);
  }
  return results[0]?.result;
}

async function collectResults(jobId, initialResult, startUrl) {
  const r = initialResult.result;
  const total = r?.finished ?? r?.total ?? 0;
  const skipped = r?.skipped ?? 0;

  let allRecords = [...(r?.records ?? [])];
  let cursor = r?.cursor;

  while (cursor && allRecords.length < total) {
    process.stdout.write(`\r  Fetching records: ${allRecords.length} / ${total}   `);
    const page = await cfFetch(`/crawl/${jobId}?cursor=${cursor}`);
    const pageRecords = page.result?.records ?? [];
    if (pageRecords.length === 0) break;
    allRecords.push(...pageRecords);
    cursor = page.result?.cursor;
  }

  console.log(`\nPages fetched: ${allRecords.length} | Skipped: ${skipped} | Total discovered: ${total + skipped}`);
  if (r?.browserSecondsUsed != null) console.log(`Browser seconds used: ${r.browserSecondsUsed}`);

  const fullResult = { ...initialResult, result: { ...r, records: allRecords } };

  // Derive hostname from startUrl if provided, otherwise from first record or job ID
  let host;
  if (startUrl) {
    host = new URL(startUrl).hostname.replace(/^www\./, "");
  } else if (allRecords.length > 0 && allRecords[0].url) {
    host = new URL(allRecords[0].url).hostname.replace(/^www\./, "");
  } else {
    host = jobId.slice(0, 8);
  }

  const shortId = jobId.slice(0, 8);
  await saveResult(`crawl_${host}_${shortId}_${timestamp()}.json`, fullResult);
  return fullResult;
}

// ---------------------------------------------------------------------------
// Status — check a crawl job's current state
// ---------------------------------------------------------------------------

async function status(jobId) {
  console.log(`\nChecking job: ${jobId}`);
  const result = await cfFetch(`/crawl/${jobId}`);
  const r = result.result;

  const st = r?.status ?? "unknown";
  const finished = r?.finished ?? 0;
  const skipped = r?.skipped ?? 0;
  const browserSec = r?.browserSecondsUsed;

  console.log(`  Status:   ${st}`);
  console.log(`  Finished: ${finished} pages`);
  console.log(`  Skipped:  ${skipped} pages`);
  console.log(`  Total:    ${finished + skipped} discovered`);
  if (browserSec != null) console.log(`  Browser:  ${browserSec}s used`);

  await updateJobLog(jobId, { status: st, finished, skipped });

  if (["completed", "done", "finished"].includes(st)) {
    console.log(`\nReady to download. Run:`);
    console.log(`  node index.js download ${jobId}`);
  } else if (["running"].includes(st)) {
    console.log(`\nStill running. Check again later or download partial results:`);
    console.log(`  node index.js download ${jobId}`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Download — fetch and save results for any job ID
// ---------------------------------------------------------------------------

async function download(jobId) {
  console.log(`\nFetching results for job: ${jobId}`);
  const initialResult = await cfFetch(`/crawl/${jobId}`);
  const r = initialResult.result;
  const st = r?.status ?? "unknown";
  console.log(`  Job status: ${st}`);

  const result = await collectResults(jobId, initialResult);
  await updateJobLog(jobId, { status: st, finished: r?.finished, skipped: r?.skipped, downloaded: true });
  return result;
}

// ---------------------------------------------------------------------------
// Scrape — /scrape endpoint (synchronous, single page)
// ---------------------------------------------------------------------------

async function scrape(targetUrl, { render = false, wait = 0 } = {}) {
  const url = normalizeUrl(targetUrl);
  console.log(`\nScraping: ${url}`);
  if (render) console.log("Render: full browser");
  if (wait) console.log(`Wait: ${wait}ms`);
  console.log();

  const body = {
    url,
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
  };
  if (wait > 0) body.waitForTimeout = wait;
  else body.waitForSelector = { selector: "h1" };

  const result = await cfFetch("/scrape", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const results = result.result ?? [];
  console.log("=== Summary ===");
  for (const group of results) {
    console.log(`  ${group.selector}: ${group.results?.length ?? 0} element(s)`);
  }

  const slug = url.replace(/https?:\/\//, "").replace(/[/?.#&=]+/g, "_").replace(/_$/, "");
  await saveResult(`scrape_${slug}_${timestamp()}.json`, result);
  return result;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0];
  const flags = {};
  const positionals = [];

  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = /^\d+$/.test(next) ? Number(next) : next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(args[i]);
    }
  }

  return { command, flags, positionals };
}

function printUsage() {
  console.log(`
Usage:
  node index.js crawl <url> [url2 ...] [options]   Crawl site(s) concurrently (async)
  node index.js scrape <url> [url2 ...] [options]   Scrape page(s) concurrently (sync)
  node index.js status <jobId>                       Check crawl job status
  node index.js download <jobId>                     Download results for a job
  node index.js jobs                                 List all logged jobs

Crawl options:
  --render       Use full browser rendering (billed; default is fast HTML-only)
  --limit N      Max pages to crawl (default: 100000)
  --max_depth N  Max link depth to follow
  --no-wait      Submit job(s) and exit without polling (fire-and-forget)

Scrape options:
  --render       Use full browser rendering
  --wait N       Wait N ms for page to load

Examples:
  node index.js crawl example.com
  node index.js crawl site1.com site2.com --render --limit 100
  node index.js crawl site1.com site2.com --no-wait
  node index.js status 3ad0fe7f-f607-4fb7-a371-8f19f11120b7
  node index.js download 3ad0fe7f-f607-4fb7-a371-8f19f11120b7
  node index.js scrape https://example.com https://example.org
  `);
}

async function main() {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
    console.error("Missing CF_ACCOUNT_ID or CF_API_TOKEN in .env");
    process.exit(1);
  }

  const { command, flags, positionals } = parseArgs(process.argv);
  const urlArg = positionals[0];

  switch (command) {
    case "crawl": {
      const urls = positionals;
      if (urls.length === 0) {
        console.error("Error: URL is required.\nUsage: node index.js crawl <url> [url2 ...] [--render] [--limit N] [--no-wait]");
        process.exit(1);
      }
      const render = !!flags.render;
      const crawlOpts = {};
      if (flags.limit) crawlOpts.limit = flags.limit;
      if (flags.max_depth) crawlOpts.max_depth = flags.max_depth;

      if (urls.length === 1) {
        // Single URL — use original path
        if (flags["no-wait"]) crawlOpts.wait = false;
        await crawl(urls[0], render, crawlOpts);
      } else {
        // Multiple URLs — concurrent submission
        const submissions = await Promise.allSettled(
          urls.map((u) => submitCrawl(u, render, crawlOpts))
        );

        const submitted = [];
        for (let i = 0; i < submissions.length; i++) {
          if (submissions[i].status === "fulfilled") {
            submitted.push(submissions[i].value);
          } else {
            console.error(`\nFailed to submit ${urls[i]}: ${submissions[i].reason?.message}`);
          }
        }

        if (submitted.length === 0) {
          throw new CrawlError("All crawl submissions failed");
        }

        if (flags["no-wait"]) {
          console.log("\nAll jobs submitted (not waiting). To check later:");
          for (const s of submitted) {
            console.log(`  [${new URL(s.url).hostname}] node index.js status ${s.jobId}`);
          }
        } else {
          const { results, failures } = await pollCrawlJobs(submitted);

          // Print summary
          console.log(`\n${"="} Summary ${"="}`);
          for (const r of results) {
            console.log(`  ✓ ${r.url} — success (job ${r.jobId.slice(0, 8)})`);
          }
          for (const f of failures) {
            console.log(`  ✗ ${f.url} — ${f.status}: ${f.error}`);
          }

          if (failures.length > 0 && results.length === 0) {
            throw new CrawlError(`All ${failures.length} crawl(s) failed`);
          }
          if (failures.length > 0) {
            console.error(`\n${failures.length} of ${submitted.length} crawl(s) failed.`);
          }
        }
      }
      break;
    }
    case "status": {
      if (!urlArg) {
        console.error("Error: Job ID is required.\nUsage: node index.js status <jobId>");
        process.exit(1);
      }
      await status(urlArg);
      break;
    }
    case "download": {
      if (!urlArg) {
        console.error("Error: Job ID is required.\nUsage: node index.js download <jobId>");
        process.exit(1);
      }
      await download(urlArg);
      break;
    }
    case "jobs": {
      const entries = await readJobLog();
      if (entries.length === 0) {
        console.log("\nNo jobs logged yet.");
      } else {
        console.log(`\n${"Job ID".padEnd(38)} ${"URL".padEnd(35)} ${"Status".padEnd(14)} ${"Pages".padEnd(8)} Started`);
        console.log("-".repeat(115));
        for (const e of entries) {
          const id = e.jobId ?? "?";
          const url = (e.url ?? "?").slice(0, 33);
          const st = e.status ?? "?";
          const pages = e.finished != null ? String(e.finished) : "-";
          const started = e.startedAt ? e.startedAt.slice(0, 19).replace("T", " ") : "?";
          console.log(`${id.padEnd(38)} ${url.padEnd(35)} ${st.padEnd(14)} ${pages.padEnd(8)} ${started}`);
        }
        console.log(`\n${entries.length} job(s) total.`);
      }
      break;
    }
    case "scrape": {
      const urls = positionals;
      if (urls.length === 0) {
        console.error("Error: URL is required.\nUsage: node index.js scrape <url> [url2 ...] [--render] [--wait N]");
        process.exit(1);
      }
      const scrapeOpts = {};
      if (flags.render) scrapeOpts.render = true;
      if (flags.wait) scrapeOpts.wait = flags.wait;

      if (urls.length === 1) {
        await scrape(urls[0], scrapeOpts);
      } else {
        const results = await Promise.allSettled(
          urls.map((u) => scrape(u, scrapeOpts))
        );

        console.log(`\n${"="} Summary ${"="}`);
        for (let i = 0; i < results.length; i++) {
          if (results[i].status === "fulfilled") {
            console.log(`  ✓ ${urls[i]} — success`);
          } else {
            console.log(`  ✗ ${urls[i]} — failed: ${results[i].reason?.message}`);
          }
        }

        const failed = results.filter((r) => r.status === "rejected");
        if (failed.length > 0 && failed.length === results.length) {
          throw new CrawlError(`All ${failed.length} scrape(s) failed`);
        }
        if (failed.length > 0) {
          console.error(`\n${failed.length} of ${urls.length} scrape(s) failed.`);
        }
      }
      break;
    }
    default:
      printUsage();
  }
}

main().catch((err) => {
  console.error(`\n${err.name ?? "Error"}: ${err.message}`);
  if (err.errors) console.error("Details:", JSON.stringify(err.errors, null, 2));
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
