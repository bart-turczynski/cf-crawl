/**
 * Scrape command -- /scrape endpoint (synchronous, single page).
 */

import { normalizeUrl, timestamp, urlSlug } from "../utils.js";
import { cfFetch } from "../api-client.js";
import { saveJson } from "../output.js";
import type { CfApiResponse, ScrapeResultGroup, SelectorSpec } from "../types.js";

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
  { wait = 0 }: { wait?: number } = {},
): Promise<CfApiResponse<ScrapeResultGroup[]>> {
  const url = normalizeUrl(targetUrl);
  console.log(`\nScraping: ${url}`);
  if (wait) console.log(`Wait: ${wait}ms`);
  console.log();

  const body: Record<string, unknown> = { url, elements: DEFAULT_SELECTORS };
  if (wait > 0) body.waitForTimeout = wait;
  else body.waitForSelector = { selector: "h1" };

  const result = await cfFetch<ScrapeResultGroup[]>("/scrape", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const results = result.result ?? [];
  console.log("=== Summary ===");
  for (const group of results) {
    console.log(`  ${group.selector}: ${group.results?.length ?? 0} element(s)`);
  }

  const slug = urlSlug(url);
  await saveJson(`scrape_${slug}_${timestamp()}.json`, result);
  return result;
}
