/**
 * Markdown command -- /markdown endpoint (synchronous, single page -> markdown).
 */

import { normalizeUrl, timestamp, urlSlug } from "../utils.js";
import { cfFetch } from "../api-client.js";
import { saveText } from "../output.js";
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

  await saveText(`markdown_${urlSlug(url)}_${timestamp()}.md`, md);

  return result;
}
