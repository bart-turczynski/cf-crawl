/**
 * Download command -- fetch and save results for any job ID.
 */

import { cfFetch } from "../api-client.js";
import { updateJobLog } from "../job-log.js";
import { collectResults } from "./crawl.js";
import type { CrawlResult, CollectResultSummary, DownloadOptions } from "../types.js";

export async function download(
  jobId: string,
  options?: DownloadOptions,
): Promise<CollectResultSummary> {
  console.log(`\nFetching results for job: ${jobId}`);
  const initialResult = await cfFetch<CrawlResult>(`/crawl/${jobId}`);
  const r = initialResult.result;
  const st = r?.status ?? "unknown";
  console.log(`  Job status: ${st}`);

  const result = await collectResults(jobId, initialResult, undefined, {
    format: options?.format,
  });
  await updateJobLog(jobId, {
    status: st,
    finished: r?.finished,
    skipped: r?.skipped,
    downloaded: true,
  });
  return result;
}
