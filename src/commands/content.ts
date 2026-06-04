/**
 * Content command -- /content endpoint (synchronous, returns rendered HTML).
 */

import { normalizeUrl, timestamp, urlSlug } from "../utils.js";
import { cfFetch } from "../api-client.js";
import { saveText } from "../output.js";
import { logOutputUrl } from "../output-log.js";
import type { CfApiResponse } from "../types.js";

export async function content(targetUrl: string): Promise<CfApiResponse<string>> {
  const url = normalizeUrl(targetUrl);
  console.log(`\nFetching rendered HTML: ${url}\n`);

  const result = await cfFetch<string>("/content", {
    method: "POST",
    body: JSON.stringify({ url }),
  });

  const html = result.result ?? "";
  console.log(`  ${html.length} chars`);

  const ts = timestamp();
  const filename = `content_${urlSlug(url)}_${ts}.html`;
  await saveText(filename, html);
  await logOutputUrl({ command: "content", url, filename, timestamp: ts });

  return result;
}
