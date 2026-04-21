/**
 * Content command -- /content endpoint (synchronous, returns rendered HTML).
 */

import { normalizeUrl, timestamp, urlSlug } from "../utils.js";
import { cfFetch } from "../api-client.js";
import { saveText } from "../output.js";
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

  await saveText(`content_${urlSlug(url)}_${timestamp()}.html`, html);

  return result;
}
