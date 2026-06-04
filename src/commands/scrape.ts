/**
 * Scrape command -- /scrape endpoint (synchronous, single page).
 */

import { normalizeUrl, timestamp, urlSlug } from "../utils.js";
import { cfFetch } from "../api-client.js";
import { saveJson } from "../output.js";
import { logOutputUrl } from "../output-log.js";
import type { CfApiResponse, ScrapeOptions, ScrapeResultGroup, SelectorSpec } from "../types.js";

/**
 * Fallback selectors used when the caller doesn't supply their own via
 * `--selector`/`opts.selectors`. They mirror a "give me the readable bones of
 * the page" default; custom selectors fully replace this list.
 */
export const DEFAULT_SELECTORS: SelectorSpec[] = [
  { selector: "head > title" },
  { selector: "meta[name='description']" },
  { selector: "h1" },
  { selector: "h2" },
  { selector: "h3" },
  { selector: "p" },
  { selector: "li" },
  { selector: "td" },
  { selector: "th" },
  { selector: "a[href]" },
  { selector: "img[src]" },
];

export async function scrape(
  targetUrl: string,
  opts: ScrapeOptions = {},
): Promise<CfApiResponse<ScrapeResultGroup[]>> {
  const { wait = 0, selectors, waitFor, waitUntil, strict, headers, userAgent, cookies } = opts;
  const url = normalizeUrl(targetUrl);
  const elements = selectors && selectors.length > 0 ? selectors : DEFAULT_SELECTORS;
  const navWaitUntil = waitUntil ?? "load";

  console.log(`\nScraping: ${url}`);
  console.log(
    `Selectors: ${elements.map((e) => e.selector).join(", ")}${
      elements === DEFAULT_SELECTORS ? " (default)" : ""
    }`,
  );
  const waitParts = [`until ${navWaitUntil}`];
  if (waitFor) waitParts.push(`selector "${waitFor}"`);
  if (wait > 0) waitParts.push(`${wait}ms`);
  console.log(`Wait: ${waitParts.join(" + ")}${strict ? " (strict)" : ""}`);
  console.log();

  // Wait directives compose: gotoOptions gates navigation, waitForSelector then
  // waits for an element, waitForTimeout adds a fixed pad. bestAttempt lets the
  // scrape proceed with whatever loaded if a wait condition times out; --strict
  // turns it off so an unmet condition fails loudly instead.
  const body: Record<string, unknown> = {
    url,
    elements,
    gotoOptions: { waitUntil: navWaitUntil },
  };
  if (!strict) body.bestAttempt = true;
  if (waitFor) body.waitForSelector = { selector: waitFor };
  if (wait > 0) body.waitForTimeout = wait;
  if (headers && Object.keys(headers).length > 0) body.setExtraHTTPHeaders = headers;
  if (userAgent) body.userAgent = userAgent;
  if (cookies && cookies.length > 0) body.cookies = cookies;

  const result = await cfFetch<ScrapeResultGroup[]>("/scrape", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const results = result.result ?? [];
  console.log("=== Summary ===");
  for (const group of results) {
    console.log(`  ${group.selector}: ${group.results?.length ?? 0} element(s)`);
  }

  const ts = timestamp();
  const filename = `scrape_${urlSlug(url)}_${ts}.json`;
  await saveJson(filename, { url, ...result });
  await logOutputUrl({ command: "scrape", url, filename, timestamp: ts });
  return result;
}
