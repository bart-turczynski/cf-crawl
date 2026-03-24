/**
 * Scrape command — /scrape endpoint (synchronous, single page).
 */

import { normalizeUrl, timestamp } from "../utils.js";
import { cfFetch } from "../api-client.js";
import { saveResult } from "../output.js";

export const DEFAULT_SELECTORS = [
  { selector: "title" },
  { selector: "meta[name='description']" },
  { selector: "h1" },
  { selector: "h2" },
  { selector: "h3" },
  { selector: "p" },
  { selector: "a[href]" },
  { selector: "img[src]" },
];

export async function scrape(targetUrl, { render = false, wait = 0 } = {}) {
  const url = normalizeUrl(targetUrl);
  console.log(`\nScraping: ${url}`);
  if (render) console.log("Render: full browser");
  if (wait) console.log(`Wait: ${wait}ms`);
  console.log();

  const body = { url, elements: DEFAULT_SELECTORS };
  if (render) body.render = true;
  if (wait > 0) body.waitForTimeout = wait;
  else body.waitForSelector = { selector: "h1" };

  const result = await cfFetch("/scrape", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const results = result.result ?? [];
  console.log("=== Summary ===");
  for (const group of results) {
    console.log(`  ${group.selector}: ${group.results?.length ?? 0} element(s)`);
  }

  const slug = url.replace(/https?:\/\//, "").replace(/[/?.#&=]+/g, "_").replace(/_$/, "");
  await saveResult(`scrape_${slug}_${timestamp()}.json`, result);
  return result;
}
