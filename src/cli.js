/**
 * CLI parser, dispatcher, and graceful shutdown handler.
 */

import { validateEnv } from "./config.js";
import { CrawlError } from "./errors.js";
import { normalizeUrl, runConcurrent } from "./utils.js";
import { crawl, submitCrawl, pollCrawlJobs } from "./commands/crawl.js";
import { scrape } from "./commands/scrape.js";
import { status } from "./commands/status.js";
import { download } from "./commands/download.js";
import { listJobs } from "./commands/jobs.js";
import { updateJobLog } from "./job-log.js";

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

const activeJobIds = new Set();

export function trackJob(jobId) {
  activeJobIds.add(jobId);
}

export function untrackJob(jobId) {
  activeJobIds.delete(jobId);
}

function setupSigintHandler() {
  process.on("SIGINT", async () => {
    console.log("\n\nInterrupted by user.");
    if (activeJobIds.size > 0) {
      console.log("Active job IDs (still running on Cloudflare):");
      for (const jobId of activeJobIds) {
        console.log(`  ${jobId}`);
        console.log(`    node index.js status ${jobId}`);
        console.log(`    node index.js download ${jobId}`);
        try {
          await updateJobLog(jobId, { status: "interrupted" });
        } catch {
          // Best-effort
        }
      }
    }
    process.exit(130);
  });
}

// ---------------------------------------------------------------------------
// Arg parsing
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

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function validateUrls(urls) {
  return urls.map((u) => normalizeUrl(u));
}

function validateLimit(flags) {
  if (flags.limit != null && (typeof flags.limit !== "number" || flags.limit < 1)) {
    throw new CrawlError("--limit must be a positive integer");
  }
}

function validateDepth(flags) {
  if (flags.max_depth != null && (typeof flags.max_depth !== "number" || flags.max_depth < 0)) {
    throw new CrawlError("--max_depth must be a non-negative integer");
  }
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export async function main() {
  validateEnv();
  setupSigintHandler();

  const { command, flags, positionals } = parseArgs(process.argv);

  switch (command) {
    case "crawl": {
      const urls = positionals;
      if (urls.length === 0) {
        console.error("Error: URL is required.\nUsage: node index.js crawl <url> [url2 ...] [--render] [--limit N] [--no-wait]");
        process.exit(1);
      }

      // Validate inputs at the boundary
      validateUrls(urls);
      validateLimit(flags);
      validateDepth(flags);

      const render = !!flags.render;
      const crawlOpts = {};
      if (flags.limit) crawlOpts.limit = flags.limit;
      if (flags.max_depth) crawlOpts.max_depth = flags.max_depth;

      if (urls.length === 1) {
        if (flags["no-wait"]) crawlOpts.wait = false;
        const { jobId } = await submitCrawl(urls[0], render, crawlOpts);
        trackJob(jobId);
        if (crawlOpts.wait === false) {
          console.log(`\nJob submitted (not waiting). To check later:`);
          console.log(`  node index.js status ${jobId}`);
          console.log(`  node index.js download ${jobId}`);
        } else {
          const { results, failures } = await pollCrawlJobs([{ jobId, url: normalizeUrl(urls[0]) }]);
          untrackJob(jobId);
          if (failures.length > 0) {
            throw new CrawlError(failures[0].error);
          }
        }
      } else {
        // Multiple URLs — concurrent submission
        const { successes: submitted, failures: submitFailures } = await runConcurrent(
          urls,
          async (u) => {
            const result = await submitCrawl(u, render, crawlOpts);
            trackJob(result.jobId);
            return result;
          },
          { labelFn: String }
        );

        if (submitted.length === 0) {
          throw new CrawlError("All crawl submissions failed");
        }

        const jobs = submitted.map((s) => s.value);

        if (flags["no-wait"]) {
          console.log("\nAll jobs submitted (not waiting). To check later:");
          for (const s of jobs) {
            console.log(`  [${new URL(s.url).hostname}] node index.js status ${s.jobId}`);
          }
        } else {
          const { results, failures } = await pollCrawlJobs(jobs);
          for (const j of jobs) untrackJob(j.jobId);

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
            console.error(`\n${failures.length} of ${jobs.length} crawl(s) failed.`);
          }
        }
      }
      break;
    }
    case "status": {
      if (!positionals[0]) {
        console.error("Error: Job ID is required.\nUsage: node index.js status <jobId>");
        process.exit(1);
      }
      await status(positionals[0]);
      break;
    }
    case "download": {
      if (!positionals[0]) {
        console.error("Error: Job ID is required.\nUsage: node index.js download <jobId>");
        process.exit(1);
      }
      await download(positionals[0]);
      break;
    }
    case "jobs": {
      await listJobs();
      break;
    }
    case "scrape": {
      const urls = positionals;
      if (urls.length === 0) {
        console.error("Error: URL is required.\nUsage: node index.js scrape <url> [url2 ...] [--render] [--wait N]");
        process.exit(1);
      }

      // Validate inputs at the boundary
      validateUrls(urls);

      const scrapeOpts = {};
      if (flags.render) scrapeOpts.render = true;
      if (flags.wait) scrapeOpts.wait = flags.wait;

      if (urls.length === 1) {
        await scrape(urls[0], scrapeOpts);
      } else {
        await runConcurrent(urls, (u) => scrape(u, scrapeOpts), { labelFn: String });
      }
      break;
    }
    default:
      printUsage();
  }
}
