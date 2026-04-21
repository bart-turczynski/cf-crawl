/**
 * PDF command -- /pdf endpoint (synchronous, returns binary PDF).
 */

import { normalizeUrl, timestamp, urlSlug } from "../utils.js";
import { cfFetchBinary } from "../api-client.js";
import { saveBinary } from "../output.js";

export async function pdf(targetUrl: string): Promise<{ filepath: string; bytes: number }> {
  const url = normalizeUrl(targetUrl);
  console.log(`\nRendering PDF: ${url}\n`);

  const { result } = await cfFetchBinary("/pdf", {
    method: "POST",
    body: JSON.stringify({ url }),
  });

  console.log(`  ${result.length} bytes`);

  const filename = `pdf_${urlSlug(url)}_${timestamp()}.pdf`;
  const filepath = await saveBinary(filename, result);

  return { filepath, bytes: result.length };
}
