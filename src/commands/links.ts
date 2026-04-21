/**
 * Links command -- /links endpoint (synchronous, returns all hyperlinks).
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeUrl, timestamp, urlSlug } from "../utils.js";
import { cfFetch } from "../api-client.js";
import { ensureOutputDir } from "../output.js";
import { OUTPUT_DIR } from "../config.js";
import type { CfApiResponse, LinksOptions } from "../types.js";

export async function links(
  targetUrl: string,
  opts: LinksOptions = {},
): Promise<CfApiResponse<string[]>> {
  const url = normalizeUrl(targetUrl);
  console.log(`\nFetching links: ${url}\n`);

  const body: Record<string, unknown> = { url };
  if (opts.visibleLinksOnly) body.visibleLinksOnly = true;
  if (opts.excludeExternalLinks) body.excludeExternalLinks = true;

  const result = await cfFetch<string[]>("/links", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const list = result.result ?? [];
  console.log(`  ${list.length} link(s)`);

  await ensureOutputDir();
  const filename = `links_${urlSlug(url)}_${timestamp()}.json`;
  const filepath = join(OUTPUT_DIR, filename);
  await writeFile(filepath, JSON.stringify(result, null, 2));
  console.log(`Saved: ${filepath}`);

  return result;
}
