/**
 * Screenshot command -- /screenshot endpoint (synchronous, returns binary image).
 */

import { normalizeUrl, timestamp, urlSlug } from "../utils.js";
import { cfFetchBinary } from "../api-client.js";
import { saveBinary } from "../output.js";
import { logOutputUrl } from "../output-log.js";
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
  const screenshotOptions: Record<string, unknown> = {};
  if (opts.fullPage) screenshotOptions.fullPage = true;
  if (format !== "png") screenshotOptions.type = format;
  if (Object.keys(screenshotOptions).length > 0) body.screenshotOptions = screenshotOptions;

  const { result } = await cfFetchBinary("/screenshot", {
    method: "POST",
    body: JSON.stringify(body),
  });

  console.log(`  ${result.length} bytes`);

  const ext = format === "jpeg" ? "jpg" : format;
  const ts = timestamp();
  const filename = `screenshot_${urlSlug(url)}_${ts}.${ext}`;
  const filepath = await saveBinary(filename, result);
  await logOutputUrl({ command: "screenshot", url, filename, timestamp: ts });

  return { filepath, bytes: result.length };
}
