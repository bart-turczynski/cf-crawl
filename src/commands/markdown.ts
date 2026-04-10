/**
 * Markdown command -- /markdown endpoint (synchronous, single page -> markdown).
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeUrl, timestamp } from "../utils.js";
import { cfFetch } from "../api-client.js";
import { ensureOutputDir } from "../output.js";
import { OUTPUT_DIR } from "../config.js";
import type { CfApiResponse } from "../types.js";

export async function markdown(targetUrl: string): Promise<CfApiResponse<string>> {
  const url = normalizeUrl(targetUrl);
  console.log(`\nConverting to markdown: ${url}\n`);

  const result = await cfFetch<string>("/markdown", {
    method: "POST",
    body: JSON.stringify({ url }),
  });

  const md = result.result ?? "";
  const lineCount = md ? md.split("\n").length : 0;
  console.log(`  ${md.length} chars, ${lineCount} lines`);

  const slug = url
    .replace(/https?:\/\//, "")
    .replace(/[/?.#&=]+/g, "_")
    .replace(/_$/, "");
  const filename = `markdown_${slug}_${timestamp()}.md`;

  await ensureOutputDir();
  const filepath = join(OUTPUT_DIR, filename);
  await writeFile(filepath, md);
  console.log(`Saved: ${filepath}`);

  return result;
}
