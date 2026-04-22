/**
 * CLI parser, dispatcher, and graceful shutdown handler.
 */

import { validateEnv } from "./config.js";
import { CrawlError, UsageError } from "./errors.js";
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

interface ExecutionContext {
  trackJob(jobId: string): void;
  untrackJob(jobId: string): void;
  dispose(): void;
}

interface CommandSpec {
  run(args: ParsedArgs, context: ExecutionContext): Promise<void>;
}

const OUTPUT_FORMATS = new Set<OutputFormat>(["json", "jsonl"]);
const SCREENSHOT_FORMATS = new Set<ScreenshotFormat>(["png", "jpeg", "webp"]);

const USAGE = {
  crawl: "node index.js crawl <url> [url2 ...] [--render] [--limit N] [--no-wait]",
  status: "node index.js status <jobId>",
  download: "node index.js download <jobId>",
  scrape: "node index.js scrape <url> [url2 ...] [--wait N]",
  markdown: "node index.js markdown <url> [url2 ...]",
  content: "node index.js content <url> [url2 ...]",
  links: "node index.js links <url> [url2 ...] [--visible-only] [--exclude-external]",
  json: 'node index.js json <url> --prompt "..." [--schema path]',
  pdf: "node index.js pdf <url> [url2 ...]",
  screenshot: "node index.js screenshot <url> [url2 ...] [--full-page] [--format png|jpeg|webp]",
  snapshot: "node index.js snapshot <url> [url2 ...]",
  tomarkdown: "node index.js tomarkdown <file> [file2 ...]",
} as const;

function createExecutionContext(): ExecutionContext {
  const activeJobIds = new Set<string>();
  const handleSigint = async (): Promise<void> => {
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
  };

  process.on("SIGINT", handleSigint);

  let disposed = false;
  return {
    trackJob(jobId: string): void {
      activeJobIds.add(jobId);
    },
    untrackJob(jobId: string): void {
      activeJobIds.delete(jobId);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      process.off("SIGINT", handleSigint);
    },
  };
}

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

function failUsage(message: string, usage?: string): never {
  const formatted = usage ? `Error: ${message}\nUsage: ${usage}` : `Error: ${message}`;
  throw new UsageError(formatted);
}

function validateUrls(urls: string[]): string[] {
  return urls.map((url) => normalizeUrl(url));
}

function requireUrls(positionals: string[], usage: string): string[] {
  if (positionals.length === 0) {
    failUsage("URL is required.", usage);
  }
  return validateUrls(positionals);
}

function requireJobId(positionals: string[], usage: string): string {
  const jobId = positionals[0];
  if (!jobId) {
    failUsage("Job ID is required.", usage);
  }
  return jobId;
}

function requireFilePaths(positionals: string[], usage: string): string[] {
  if (positionals.length === 0) {
    failUsage("at least one file path is required.", usage);
  }
  return positionals;
}

function getNumberFlag(
  flags: Flags,
  key: string,
  errorMessage: string,
  { min = 0 }: { min?: number } = {},
): number | undefined {
  const value = flags[key];
  if (value == null) return undefined;
  if (typeof value !== "number" || value < min) {
    failUsage(errorMessage);
  }
  return value;
}

function getOutputFormat(flags: Flags): OutputFormat | undefined {
  const format = flags.format;
  if (format == null) return undefined;
  if (format === "json" || format === "jsonl") {
    return format;
  }
  failUsage(`--format must be one of: ${[...OUTPUT_FORMATS].join(", ")}`);
}

function getCrawlOptions(flags: Flags): { render: boolean; options: CrawlOptions } {
  const limit = getNumberFlag(flags, "limit", "--limit must be a positive integer", { min: 1 });
  const maxDepth = getNumberFlag(flags, "max_depth", "--max_depth must be a non-negative integer");
  const format = getOutputFormat(flags);

  const options: CrawlOptions = {};
  if (limit != null) options.limit = limit;
  if (maxDepth != null) options.max_depth = maxDepth;
  if (format) options.format = format;

  return {
    render: !!flags.render,
    options,
  };
}

function getScrapeOptions(flags: Flags): ScrapeOptions {
  const wait = getNumberFlag(flags, "wait", "--wait must be a non-negative integer");
  return wait != null ? { wait } : {};
}

function getLinksOptions(flags: Flags): LinksOptions {
  const options: LinksOptions = {};
  if (flags["visible-only"]) options.visibleLinksOnly = true;
  if (flags["exclude-external"]) options.excludeExternalLinks = true;
  return options;
}

function getScreenshotOptions(flags: Flags): ScreenshotOptions {
  const options: ScreenshotOptions = {};
  if (flags["full-page"]) options.fullPage = true;

  if (flags.format != null) {
    if (typeof flags.format !== "string") {
      failUsage("--format must be one of: png, jpeg, webp");
    }
    const format = flags.format.toLowerCase();
    if (!SCREENSHOT_FORMATS.has(format as ScreenshotFormat)) {
      failUsage("--format must be one of: png, jpeg, webp");
    }
    options.format = format as ScreenshotFormat;
  }

  return options;
}

async function runUrlCommand(
  urls: string[],
  handler: (url: string) => Promise<unknown>,
): Promise<void> {
  if (urls.length === 1) {
    await handler(urls[0]);
    return;
  }

  await runConcurrent(urls, handler, { labelFn: String });
}

async function runCrawlCommand(
  { flags, positionals }: ParsedArgs,
  context: ExecutionContext,
): Promise<void> {
  const urls = requireUrls(positionals, USAGE.crawl);
  const { render, options } = getCrawlOptions(flags);
  const format = options.format;

  if (urls.length === 1) {
    if (flags["no-wait"]) options.wait = false;
    const { jobId } = await submitCrawl(urls[0], render, options);
    context.trackJob(jobId);
    if (options.wait === false) {
      console.log(`\nJob submitted (not waiting). To check later:`);
      console.log(`  node index.js status ${jobId}`);
      console.log(`  node index.js download ${jobId}`);
      return;
    }

    try {
      const { failures } = await pollCrawlJobs([{ jobId, url: urls[0] }], { format });
      if (failures.length > 0) {
        throw new CrawlError(failures[0].error);
      }
    } finally {
      context.untrackJob(jobId);
    }
    return;
  }

  const { successes: submitted } = await runConcurrent(
    urls,
    async (url) => {
      const result = await submitCrawl(url, render, options);
      context.trackJob(result.jobId);
      return result;
    },
    { labelFn: String },
  );

  if (submitted.length === 0) {
    throw new CrawlError("All crawl submissions failed");
  }

  const jobs: CrawlJob[] = submitted.map((entry) => entry.value);

  if (flags["no-wait"]) {
    console.log("\nAll jobs submitted (not waiting). To check later:");
    for (const job of jobs) {
      console.log(`  [${new URL(job.url).hostname}] node index.js status ${job.jobId}`);
    }
    return;
  }

  try {
    const { results, failures } = await pollCrawlJobs(jobs, { format });

    console.log(`\n${"="} Summary ${"="}`);
    for (const result of results) {
      console.log(`  \u2713 ${result.url} \u2014 success (job ${result.jobId.slice(0, 8)})`);
    }
    for (const failure of failures) {
      console.log(`  \u2717 ${failure.url} \u2014 ${failure.status}: ${failure.error}`);
    }

    if (failures.length > 0 && results.length === 0) {
      throw new CrawlError(`All ${failures.length} crawl(s) failed`);
    }
    if (failures.length > 0) {
      console.error(`\n${failures.length} of ${jobs.length} crawl(s) failed.`);
    }
  } finally {
    for (const job of jobs) {
      context.untrackJob(job.jobId);
    }
  }
}

const COMMANDS: Record<string, CommandSpec> = {
  crawl: {
    run: runCrawlCommand,
  },
  status: {
    async run({ positionals }): Promise<void> {
      await status(requireJobId(positionals, USAGE.status));
    },
  },
  download: {
    async run({ flags, positionals }): Promise<void> {
      await download(requireJobId(positionals, USAGE.download), {
        format: getOutputFormat(flags),
      });
    },
  },
  jobs: {
    async run(): Promise<void> {
      await listJobs();
    },
  },
  scrape: {
    async run({ flags, positionals }): Promise<void> {
      const urls = requireUrls(positionals, USAGE.scrape);
      const options = getScrapeOptions(flags);
      await runUrlCommand(urls, async (url) => scrape(url, options));
    },
  },
  markdown: {
    async run({ positionals }): Promise<void> {
      await runUrlCommand(requireUrls(positionals, USAGE.markdown), markdown);
    },
  },
  content: {
    async run({ positionals }): Promise<void> {
      await runUrlCommand(requireUrls(positionals, USAGE.content), content);
    },
  },
  links: {
    async run({ flags, positionals }): Promise<void> {
      const urls = requireUrls(positionals, USAGE.links);
      const options = getLinksOptions(flags);
      await runUrlCommand(urls, async (url) => links(url, options));
    },
  },
  json: {
    async run({ flags, positionals }): Promise<void> {
      const urls = requireUrls(positionals, USAGE.json);
      if (typeof flags.prompt !== "string" || flags.prompt.trim().length === 0) {
        failUsage('--prompt "<text>" is required for `json`.');
      }

      const options = {
        prompt: flags.prompt,
        schemaPath: typeof flags.schema === "string" ? flags.schema : undefined,
      };

      await runUrlCommand(urls, async (url) => jsonExtract(url, options));
    },
  },
  pdf: {
    async run({ positionals }): Promise<void> {
      await runUrlCommand(requireUrls(positionals, USAGE.pdf), pdf);
    },
  },
  screenshot: {
    async run({ flags, positionals }): Promise<void> {
      const urls = requireUrls(positionals, USAGE.screenshot);
      const options = getScreenshotOptions(flags);
      await runUrlCommand(urls, async (url) => screenshot(url, options));
    },
  },
  snapshot: {
    async run({ positionals }): Promise<void> {
      await runUrlCommand(requireUrls(positionals, USAGE.snapshot), snapshot);
    },
  },
  tomarkdown: {
    async run({ positionals }): Promise<void> {
      await tomarkdown(requireFilePaths(positionals, USAGE.tomarkdown));
    },
  },
};

export async function main(argv: string[] = process.argv): Promise<void> {
  const parsed = parseArgs(argv);

  if (!parsed.command || parsed.flags.help) {
    printUsage();
    return;
  }

  const command = COMMANDS[parsed.command];
  if (!command) {
    printUsage();
    return;
  }

  validateEnv();
  const context = createExecutionContext();

  try {
    await command.run(parsed, context);
  } finally {
    context.dispose();
  }
}
