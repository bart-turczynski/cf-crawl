/**
 * Screenshot command -- /screenshot endpoint (synchronous, returns binary image).
 */

import { normalizeUrl, timestamp, urlSlug } from "../utils.js";
import { cfFetchBinary } from "../api-client.js";
import { saveBinary } from "../output.js";
import type { ScreenshotOptions } from "../types.js";

export async function screenshot(
  targetUrl: string,
  opts: ScreenshotOptions = {},
): Promise<{ filepath: string; bytes: number }> {
  const url = normalizeUrl(targetUrl);
  const format = opts.format ?? "png";
  console.log(`\nCapturing screenshot: ${url}`);
  if (opts.fullPage) console.log("  fullPage: true");
  console.log(`  format: ${format}\n`);

  const body: Record<string, unknown> = { url };
  if (opts.fullPage) body.fullPage = true;
  if (format !== "png") body.screenshotOptions = { type: format };

  const { result } = await cfFetchBinary("/screenshot", {
    method: "POST",
    body: JSON.stringify(body),
  });

  console.log(`  ${result.length} bytes`);

  const ext = format === "jpeg" ? "jpg" : format;
  const filename = `screenshot_${urlSlug(url)}_${timestamp()}.${ext}`;
  const filepath = await saveBinary(filename, result);

  return { filepath, bytes: result.length };
}
