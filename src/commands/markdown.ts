/**
 * Markdown command -- /markdown endpoint (synchronous, single page -> markdown).
 *
 * Cloudflare Browser Rendering's /markdown endpoint accepts setExtraHTTPHeaders,
 * userAgent, and cookies in the JSON body. We expose them as MarkdownOptions so
 * callers can force locale (Accept-Language), bypass geo-redirects (Cookie:
 * georedirect=false on zendesk.com), or impersonate a real browser UA when CF
 * BR's default UA gets rate-limited.
 */

import { normalizeUrl, timestamp, urlSlug } from "../utils.js";
import { cfFetch } from "../api-client.js";
import { saveText } from "../output.js";
import { logOutputUrl } from "../output-log.js";
import type { BrowserCookie, CfApiResponse } from "../types.js";

/** @deprecated alias retained for back-compat; use {@link BrowserCookie}. */
export type MarkdownCookie = BrowserCookie;

export interface MarkdownOptions {
  headers?: Record<string, string>;
  userAgent?: string;
  cookies?: BrowserCookie[];
}

export async function markdown(
  targetUrl: string,
  opts: MarkdownOptions = {},
): Promise<CfApiResponse<string>> {
  const url = normalizeUrl(targetUrl);
  console.log(`\nConverting to markdown: ${url}\n`);

  const body: Record<string, unknown> = { url };
  if (opts.headers && Object.keys(opts.headers).length > 0) {
    body.setExtraHTTPHeaders = opts.headers;
  }
  if (opts.userAgent) body.userAgent = opts.userAgent;
  if (opts.cookies && opts.cookies.length > 0) body.cookies = opts.cookies;

  const result = await cfFetch<string>("/markdown", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const md = result.result ?? "";
  const lineCount = md ? md.split("\n").length : 0;
  console.log(`  ${md.length} chars, ${lineCount} lines`);

  const ts = timestamp();
  const filename = `markdown_${urlSlug(url)}_${ts}.md`;
  await saveText(filename, md);
  await logOutputUrl({ command: "markdown", url, filename, timestamp: ts });

  return result;
}
