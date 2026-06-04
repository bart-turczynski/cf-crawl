/**
 * PDF command -- /pdf endpoint (synchronous, returns binary PDF).
 */

import { normalizeUrl, timestamp, urlSlug } from "../utils.js";
import { cfFetchBinary } from "../api-client.js";
import { saveBinary } from "../output.js";
import { logOutputUrl } from "../output-log.js";

export async function pdf(targetUrl: string): Promise<{ filepath: string; bytes: number }> {
  const url = normalizeUrl(targetUrl);
  console.log(`\nRendering PDF: ${url}\n`);

  const { result } = await cfFetchBinary("/pdf", {
    method: "POST",
    body: JSON.stringify({ url }),
  });

  console.log(`  ${result.length} bytes`);

  const ts = timestamp();
  const filename = `pdf_${urlSlug(url)}_${ts}.pdf`;
  const filepath = await saveBinary(filename, result);
  await logOutputUrl({ command: "pdf", url, filename, timestamp: ts });

  return { filepath, bytes: result.length };
}
