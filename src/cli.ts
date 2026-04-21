/**
 * CLI parser, dispatcher, and graceful shutdown handler.
 */

import { validateEnv } from "./config.js";
import { CrawlError } from "./errors.js";
import { normalizeUrl, runConcurrent } from "./utils.js";
import { submitCrawl, pollCrawlJobs } from "./commands/crawl.js";
import { scrape } from "./commands/scrape.js";
import { markdown } from "./commands/markdown.js";
import { status } from "./commands/status.js";
import { download } from "./commands/download.js";
import { listJobs } from "./commands/jobs.js";
import { content } from "./commands/content.js";
import { links } from "./commands/links.js";
import { json as jsonExtract } from "./commands/json.js";
import { pdf } from "./commands/pdf.js";
import { screenshot } from "./commands/screenshot.js";
import { snapshot } from "./commands/snapshot.js";
import { tomarkdown } from "./commands/tomarkdown.js";
import { updateJobLog } from "./job-log.js";
import type {
  Flags,
  ParsedArgs,
  CrawlOptions,
  ScrapeOptions,
  CrawlJob,
  OutputFormat,
  LinksOptions,
  ScreenshotOptions,
  ScreenshotFormat,
} from "./types.js";

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

const activeJobIds = new Set<string>();

export function trackJob(jobId: string): void {
  activeJobIds.add(jobId);
}

export function untrackJob(jobId: string): void {
  activeJobIds.delete(jobId);
}

let sigintRegistered = false;

function setupSigintHandler(): void {
  if (sigintRegistered) return;
  sigintRegistered = true;
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

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const command = args[0];
  const flags: Flags = {};
  const positionals: string[] = [];

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "-h") {
      flags.help = true;
    } else if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const numericFlags = new Set(["limit", "max_depth", "wait"]);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = numericFlags.has(key) && /^\d+$/.test(next) ? Number(next) : next;
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

function printUsage(): void {
  console.log(`
Usage:
  node index.js crawl <url> [url2 ...] [options]       Crawl site(s) concurrently (async)
  node index.js scrape <url> [url2 ...] [options]      Scrape page(s) concurrently (sync)
  node index.js markdown <url> [url2 ...]              Convert page(s) to markdown (sync)
  node index.js content <url> [url2 ...]               Fetch rendered HTML for page(s) (sync)
  node index.js links <url> [url2 ...] [options]       List all hyperlinks on page(s) (sync)
  node index.js json <url> --prompt "..." [opts]       AI-extract structured JSON (sync)
  node index.js pdf <url> [url2 ...]                   Render page(s) to PDF (sync, binary)
  node index.js screenshot <url> [url2 ...] [opts]     Capture page screenshot(s) (sync, binary)
  node index.js snapshot <url> [url2 ...]              Capture HTML + screenshot in one call
  node index.js tomarkdown <file> [file2 ...]          Convert local file(s) to markdown (Workers AI)
  node index.js status <jobId>                         Check crawl job status
  node index.js download <jobId>                       Download results for a job
  node index.js jobs                                   List all logged jobs

Crawl options:
  --render       Use full browser rendering (billed; default is fast HTML-only)
  --limit N      Max pages to crawl (default: 100000)
  --max_depth N  Max link depth to follow
  --no-wait      Submit job(s) and exit without polling (fire-and-forget)
  --format F     Output format: "json" (default) or "jsonl" (one record per line)

Download options:
  --format F     Output format: "json" (default) or "jsonl" (one record per line)

Scrape options:
  --wait N       Wait N ms before extracting (scrape always uses browser rendering)

Links options:
  --visible-only         Include only visible links
  --exclude-external     Exclude off-domain links

Json options:
  --prompt "..."         (required) Natural-language extraction instruction
  --schema <path>        (optional) Path to a JSON schema file for structured output

Screenshot options:
  --full-page            Capture full scrollable page (default: viewport only)
  --format F             png | jpeg | webp (default: png)

Markdown options:
  (no flags -- endpoint always uses full browser rendering)

Examples:
  node index.js crawl example.com
  node index.js crawl site1.com site2.com --render --limit 100
  node index.js scrape https://example.com https://example.org
  node index.js markdown https://example.com
  node index.js content https://example.com
  node index.js links https://example.com --exclude-external
  node index.js json https://example.com --prompt "Extract title and main heading"
  node index.js json https://example.com --prompt "..." --schema ./schema.json
  node index.js pdf https://example.com
  node index.js screenshot https://example.com --full-page --format jpeg
  node index.js snapshot https://example.com
  node index.js tomarkdown ./report.pdf ./notes.docx
  `);
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function validateUrls(urls: string[]): string[] {
  return urls.map((u) => normalizeUrl(u));
}

function validateLimit(flags: Flags): void {
  if (flags.limit != null && (typeof flags.limit !== "number" || flags.limit < 1)) {
    throw new CrawlError("--limit must be a positive integer");
  }
}

function validateDepth(flags: Flags): void {
  if (flags.max_depth != null && (typeof flags.max_depth !== "number" || flags.max_depth < 0)) {
    throw new CrawlError("--max_depth must be a non-negative integer");
  }
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export async function main(): Promise<void> {
  const { command, flags, positionals } = parseArgs(process.argv);

  if (!command || flags.help) {
    printUsage();
    return;
  }

  validateEnv();
  setupSigintHandler();

  switch (command) {
    case "crawl": {
      if (positionals.length === 0) {
        console.error(
          "Error: URL is required.\nUsage: node index.js crawl <url> [url2 ...] [--render] [--limit N] [--no-wait]",
        );
        process.exit(1);
      }

      // Validate and normalize inputs at the boundary
      const urls = validateUrls(positionals);
      validateLimit(flags);
      validateDepth(flags);

      const render = !!flags.render;
      const format = (flags.format as OutputFormat) ?? undefined;
      const crawlOpts: CrawlOptions = {};
      if (flags.limit != null) crawlOpts.limit = flags.limit as number;
      if (flags.max_depth != null) crawlOpts.max_depth = flags.max_depth as number;
      if (format) crawlOpts.format = format;

      if (urls.length === 1) {
        if (flags["no-wait"]) crawlOpts.wait = false;
        const { jobId } = await submitCrawl(urls[0], render, crawlOpts);
        trackJob(jobId);
        if (crawlOpts.wait === false) {
          console.log(`\nJob submitted (not waiting). To check later:`);
          console.log(`  node index.js status ${jobId}`);
          console.log(`  node index.js download ${jobId}`);
        } else {
          const { failures } = await pollCrawlJobs([{ jobId, url: urls[0] }], { format });
          untrackJob(jobId);
          if (failures.length > 0) {
            throw new CrawlError(failures[0].error);
          }
        }
      } else {
        // Multiple URLs -- concurrent submission
        const { successes: submitted } = await runConcurrent(
          urls,
          async (u) => {
            const result = await submitCrawl(u, render, crawlOpts);
            trackJob(result.jobId);
            return result;
          },
          { labelFn: String },
        );

        if (submitted.length === 0) {
          throw new CrawlError("All crawl submissions failed");
        }

        const jobs: CrawlJob[] = submitted.map((s) => s.value);

        if (flags["no-wait"]) {
          console.log("\nAll jobs submitted (not waiting). To check later:");
          for (const s of jobs) {
            console.log(`  [${new URL(s.url).hostname}] node index.js status ${s.jobId}`);
          }
        } else {
          const { results, failures } = await pollCrawlJobs(jobs, { format });
          for (const j of jobs) untrackJob(j.jobId);

          // Print summary
          console.log(`\n${"="} Summary ${"="}`);
          for (const r of results) {
            console.log(`  \u2713 ${r.url} \u2014 success (job ${r.jobId.slice(0, 8)})`);
          }
          for (const f of failures) {
            console.log(`  \u2717 ${f.url} \u2014 ${f.status}: ${f.error}`);
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
      const dlFormat = (flags.format as OutputFormat) ?? undefined;
      await download(positionals[0], { format: dlFormat });
      break;
    }
    case "jobs": {
      await listJobs();
      break;
    }
    case "scrape": {
      if (positionals.length === 0) {
        console.error(
          "Error: URL is required.\nUsage: node index.js scrape <url> [url2 ...] [--wait N]",
        );
        process.exit(1);
      }

      // Validate and normalize inputs at the boundary
      const urls = validateUrls(positionals);

      const scrapeOpts: ScrapeOptions = {};
      if (flags.wait) scrapeOpts.wait = flags.wait as number;

      if (urls.length === 1) {
        await scrape(urls[0], scrapeOpts);
      } else {
        await runConcurrent(urls, (u) => scrape(u, scrapeOpts), { labelFn: String });
      }
      break;
    }
    case "markdown": {
      if (positionals.length === 0) {
        console.error("Error: URL is required.\nUsage: node index.js markdown <url> [url2 ...]");
        process.exit(1);
      }

      const urls = validateUrls(positionals);

      if (urls.length === 1) {
        await markdown(urls[0]);
      } else {
        await runConcurrent(urls, (u) => markdown(u), { labelFn: String });
      }
      break;
    }
    case "content": {
      if (positionals.length === 0) {
        console.error("Error: URL is required.\nUsage: node index.js content <url> [url2 ...]");
        process.exit(1);
      }
      const urls = validateUrls(positionals);
      if (urls.length === 1) {
        await content(urls[0]);
      } else {
        await runConcurrent(urls, (u) => content(u), { labelFn: String });
      }
      break;
    }
    case "links": {
      if (positionals.length === 0) {
        console.error(
          "Error: URL is required.\nUsage: node index.js links <url> [url2 ...] [--visible-only] [--exclude-external]",
        );
        process.exit(1);
      }
      const urls = validateUrls(positionals);
      const linksOpts: LinksOptions = {};
      if (flags["visible-only"]) linksOpts.visibleLinksOnly = true;
      if (flags["exclude-external"]) linksOpts.excludeExternalLinks = true;
      if (urls.length === 1) {
        await links(urls[0], linksOpts);
      } else {
        await runConcurrent(urls, (u) => links(u, linksOpts), { labelFn: String });
      }
      break;
    }
    case "json": {
      if (positionals.length === 0) {
        console.error(
          'Error: URL is required.\nUsage: node index.js json <url> --prompt "..." [--schema path]',
        );
        process.exit(1);
      }
      if (typeof flags.prompt !== "string" || flags.prompt.trim().length === 0) {
        console.error('Error: --prompt "<text>" is required for `json`.');
        process.exit(1);
      }
      const urls = validateUrls(positionals);
      const jsonOpts = {
        prompt: flags.prompt,
        schemaPath: typeof flags.schema === "string" ? flags.schema : undefined,
      };
      if (urls.length === 1) {
        await jsonExtract(urls[0], jsonOpts);
      } else {
        await runConcurrent(urls, (u) => jsonExtract(u, jsonOpts), { labelFn: String });
      }
      break;
    }
    case "pdf": {
      if (positionals.length === 0) {
        console.error("Error: URL is required.\nUsage: node index.js pdf <url> [url2 ...]");
        process.exit(1);
      }
      const urls = validateUrls(positionals);
      if (urls.length === 1) {
        await pdf(urls[0]);
      } else {
        await runConcurrent(urls, (u) => pdf(u), { labelFn: String });
      }
      break;
    }
    case "screenshot": {
      if (positionals.length === 0) {
        console.error(
          "Error: URL is required.\nUsage: node index.js screenshot <url> [url2 ...] [--full-page] [--format png|jpeg|webp]",
        );
        process.exit(1);
      }
      const urls = validateUrls(positionals);
      const shotOpts: ScreenshotOptions = {};
      if (flags["full-page"]) shotOpts.fullPage = true;
      if (typeof flags.format === "string") {
        const f = flags.format.toLowerCase();
        if (f !== "png" && f !== "jpeg" && f !== "webp") {
          throw new CrawlError("--format must be one of: png, jpeg, webp");
        }
        shotOpts.format = f as ScreenshotFormat;
      }
      if (urls.length === 1) {
        await screenshot(urls[0], shotOpts);
      } else {
        await runConcurrent(urls, (u) => screenshot(u, shotOpts), { labelFn: String });
      }
      break;
    }
    case "snapshot": {
      if (positionals.length === 0) {
        console.error("Error: URL is required.\nUsage: node index.js snapshot <url> [url2 ...]");
        process.exit(1);
      }
      const urls = validateUrls(positionals);
      if (urls.length === 1) {
        await snapshot(urls[0]);
      } else {
        await runConcurrent(urls, (u) => snapshot(u), { labelFn: String });
      }
      break;
    }
    case "tomarkdown": {
      if (positionals.length === 0) {
        console.error(
          "Error: at least one file path is required.\nUsage: node index.js tomarkdown <file> [file2 ...]",
        );
        process.exit(1);
      }
      // File paths: do NOT normalize as URLs. The command itself rejects http(s) args.
      await tomarkdown(positionals);
      break;
    }
    default:
      printUsage();
  }
}
