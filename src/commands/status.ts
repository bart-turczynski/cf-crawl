/**
 * Status command -- check a crawl job's current state.
 */

import { COMPLETED_STATUSES } from "../config.js";
import { cfFetch } from "../api-client.js";
import { updateJobLog } from "../job-log.js";
import type { CfApiResponse, CrawlResult } from "../types.js";

export async function status(jobId: string): Promise<CfApiResponse<CrawlResult>> {
  console.log(`\nChecking job: ${jobId}`);
  const result = await cfFetch<CrawlResult>(`/crawl/${jobId}`);
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

  if (COMPLETED_STATUSES.has(st)) {
    console.log(`\nReady to download. Run:`);
    console.log(`  node index.js download ${jobId}`);
  } else if (st === "running") {
    console.log(`\nStill running. Check again later or download partial results:`);
    console.log(`  node index.js download ${jobId}`);
  }

  return result;
}
