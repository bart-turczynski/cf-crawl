/**
 * Snapshot command -- /snapshot endpoint (synchronous, returns HTML + base64 image).
 */

import { normalizeUrl, timestamp, urlSlug } from "../utils.js";
import { cfFetch } from "../api-client.js";
import { saveJson } from "../output.js";
import type { CfApiResponse, SnapshotResult } from "../types.js";

export async function snapshot(targetUrl: string): Promise<CfApiResponse<SnapshotResult>> {
  const url = normalizeUrl(targetUrl);
  console.log(`\nCapturing snapshot (HTML + screenshot): ${url}\n`);

  const result = await cfFetch<SnapshotResult>("/snapshot", {
    method: "POST",
    body: JSON.stringify({ url }),
  });

  const html = result.result?.content ?? "";
  const shot = result.result?.screenshot ?? "";
  console.log(`  html: ${html.length} chars`);
  console.log(`  screenshot: ${shot.length} base64 chars`);

  const filename = `snapshot_${urlSlug(url)}_${timestamp()}.json`;
  await saveJson(filename, result);

  return result;
}
