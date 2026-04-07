/**
 * Crawl command -- /crawl endpoint (async job + polling + pagination).
 */

import { POLL_DEFAULTS, COMPLETED_STATUSES, FAILED_STATUSES } from "../config.js";
import { CrawlError } from "../errors.js";
import { sleep, normalizeUrl, timestamp } from "../utils.js";
import { cfFetch } from "../api-client.js";
import { createResultWriter } from "../output.js";
import { logJob, updateJobLog } from "../job-log.js";
import type {
  CfApiResponse,
  CrawlResult,
  CrawlJob,
  CrawlOptions,
  PollResultEntry,
  PollFailureEntry,
  PollResult,
  CollectResultSummary,
  OutputFormat,
} from "../types.js";

export async function submitCrawl(
  startUrl: string,
  render = false,
  { limit = 100_000, max_depth }: CrawlOptions = {},
): Promise<CrawlJob> {
  const url = normalizeUrl(startUrl);
  console.log(`\nStarting crawl: ${url}`);
  console.log(`Render mode: ${render ? "full browser (billed)" : "fast HTML (free beta)"}`);
  console.log(`Limit: ${limit}\n`);

  const body: Record<string, unknown> = { url, render, limit };
  if (max_depth != null) body.max_depth = max_depth;

  const job = await cfFetch<CrawlResult | string>("/crawl", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const jobId =
    typeof job.result === "string"
      ? job.result
      : ((job.result as CrawlResult)?.id ?? (job.result as CrawlResult)?.jobId);

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

export async function pollCrawlJobs(
  jobs: CrawlJob[],
  options?: { format?: OutputFormat },
): Promise<PollResult> {
  const { intervalMs, maxAttempts } = POLL_DEFAULTS;
  const active = new Map<string, CrawlJob>(jobs.map((j) => [j.jobId, j]));
  const results: PollResultEntry[] = [];
  const failures: PollFailureEntry[] = [];

  for (let i = 1; i <= maxAttempts && active.size > 0; i++) {
    // Parallel polling -- fire all job status checks concurrently
    const checks = await Promise.allSettled(
      [...active.entries()].map(async ([jobId, job]) => {
        const result = await cfFetch<CrawlResult>(`/crawl/${jobId}`);
        return { jobId, job, result };
      }),
    );

    for (const check of checks) {
      if (check.status === "rejected") {
        const err = check.reason as CrawlError;
        // Try to find which job this was for -- if retryable, continue
        if (err.retryable !== false) {
          console.warn(`\n  Poll error (attempt ${i}): ${err.message}. Will retry...`);
          continue;
        }
        // Non-retryable errors are harder to attribute without the jobId;
        // in practice this path is rare since cfFetch wraps errors
        continue;
      }

      const { jobId, job, result } = check.value;
      const st = result.result?.status ?? "unknown";

      if (COMPLETED_STATUSES.has(st)) {
        console.log(`\n[${new URL(job.url).hostname}] Crawl complete! Fetching all pages...`);
        await updateJobLog(jobId, {
          status: "completed",
          finished: result.result?.finished,
          skipped: result.result?.skipped,
        });
        try {
          const collected = await collectResults(jobId, result, job.url, {
            format: options?.format,
          });
          results.push({ ...job, status: "success", result: collected });
        } catch (err) {
          failures.push({ ...job, status: "failed", error: (err as Error).message });
        }
        active.delete(jobId);
        continue;
      }

      if (FAILED_STATUSES.has(st)) {
        await updateJobLog(jobId, { status: "failed" });
        failures.push({
          ...job,
          status: "failed",
          error: `Crawl job failed: ${JSON.stringify(result.result)}`,
        });
        active.delete(jobId);
        continue;
      }

      // Progress
      const finished = result.result?.finished;
      const skipped = result.result?.skipped;
      const progress =
        finished != null
          ? `${finished} finished, ${skipped ?? 0} skipped`
          : (result.result?.pagesProcessed ?? result.result?.progress ?? "in progress");
      const host = new URL(job.url).hostname;
      console.log(`  Poll ${i}/${maxAttempts} \u2014 [${host}] status: ${st} | pages: ${progress}`);
    }

    if (active.size > 0) await sleep(intervalMs);
  }

  // Timed-out jobs
  for (const [jobId, job] of active) {
    console.log(`\n[${new URL(job.url).hostname}] Timed out. To resume:`);
    console.log(`  node index.js status ${jobId}`);
    console.log(`  node index.js download ${jobId}`);
    await updateJobLog(jobId, { status: "poll-timeout" });
    failures.push({
      ...job,
      status: "timeout",
      error: `Timed out after ${POLL_DEFAULTS.maxAttempts} polls`,
    });
  }

  return { results, failures };
}

export async function crawl(
  startUrl: string,
  render = false,
  { limit = 100_000, max_depth, wait = true, format }: CrawlOptions = {},
): Promise<CollectResultSummary | { jobId: string } | undefined> {
  const { jobId, url } = await submitCrawl(startUrl, render, { limit, max_depth });

  if (!wait) {
    console.log(`\nJob submitted (not waiting). To check later:`);
    console.log(`  node index.js status ${jobId}`);
    console.log(`  node index.js download ${jobId}`);
    return { jobId };
  }

  const { results: pollResults, failures } = await pollCrawlJobs([{ jobId, url }], { format });
  if (failures.length > 0) {
    throw new CrawlError(failures[0].error);
  }
  return pollResults[0]?.result;
}

export async function collectResults(
  jobId: string,
  initialResult: CfApiResponse<CrawlResult>,
  startUrl?: string,
  options?: { format?: OutputFormat },
): Promise<CollectResultSummary> {
  const r = initialResult.result;
  const total = r?.finished ?? r?.total ?? 0;
  const skipped = r?.skipped ?? 0;
  const format = options?.format ?? "json";

  // Derive hostname from startUrl, first record, or job ID
  const initialRecords = r?.records ?? [];
  let host: string;
  if (startUrl) {
    host = new URL(startUrl).hostname.replace(/^www\./, "");
  } else if (initialRecords.length > 0 && initialRecords[0].url) {
    host = new URL(initialRecords[0].url).hostname.replace(/^www\./, "");
  } else {
    host = jobId.slice(0, 8);
  }

  const shortId = jobId.slice(0, 8);
  const filename = `crawl_${host}_${shortId}_${timestamp()}.json`;

  // Build metadata (everything except records) for the JSON envelope
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { records: _discarded, ...resultMeta } = r ?? {};
  const metadata = { ...initialResult, result: resultMeta };

  const writer = createResultWriter(filename, format, metadata);
  await writer.open();

  try {
    // Write initial batch of records
    if (initialRecords.length > 0) {
      await writer.writeRecords(initialRecords);
    }

    // Paginate through remaining records, streaming each page to disk
    let cursor = r?.cursor;
    while (cursor && writer.recordCount < total) {
      process.stdout.write(`\r  Fetching records: ${writer.recordCount} / ${total}   `);
      const page = await cfFetch<CrawlResult>(`/crawl/${jobId}?cursor=${cursor}`);
      const pageRecords = page.result?.records ?? [];
      if (pageRecords.length === 0) break;
      await writer.writeRecords(pageRecords);
      cursor = page.result?.cursor;
    }
  } finally {
    await writer.close();
  }

  console.log(
    `\nPages fetched: ${writer.recordCount} | Skipped: ${skipped} | Total discovered: ${total + skipped}`,
  );
  if (r?.browserSecondsUsed != null) console.log(`Browser seconds used: ${r.browserSecondsUsed}`);

  return {
    filepath: filename,
    recordCount: writer.recordCount,
    status: r?.status ?? "unknown",
    finished: total,
    skipped,
    browserSecondsUsed: r?.browserSecondsUsed ?? 0,
  };
}
