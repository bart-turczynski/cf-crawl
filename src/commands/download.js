/**
 * Download command — fetch and save results for any job ID.
 */

import { cfFetch } from "../api-client.js";
import { updateJobLog } from "../job-log.js";
import { collectResults } from "./crawl.js";

export async function download(jobId) {
  console.log(`\nFetching results for job: ${jobId}`);
  const initialResult = await cfFetch(`/crawl/${jobId}`);
  const r = initialResult.result;
  const st = r?.status ?? "unknown";
  console.log(`  Job status: ${st}`);

  const result = await collectResults(jobId, initialResult);
  await updateJobLog(jobId, { status: st, finished: r?.finished, skipped: r?.skipped, downloaded: true });
  return result;
}
