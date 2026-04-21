/**
 * Snapshot command -- /snapshot endpoint (synchronous, returns HTML + base64 image).
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeUrl, timestamp, urlSlug } from "../utils.js";
import { cfFetch } from "../api-client.js";
import { ensureOutputDir } from "../output.js";
import { OUTPUT_DIR } from "../config.js";
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

  await ensureOutputDir();
  const filename = `snapshot_${urlSlug(url)}_${timestamp()}.json`;
  const filepath = join(OUTPUT_DIR, filename);
  await writeFile(filepath, JSON.stringify(result, null, 2));
  console.log(`Saved: ${filepath}`);

  return result;
}
