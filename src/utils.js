/**
 * Shared utility functions.
 */

import { CrawlError } from "./errors.js";

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function backoffDelay(attempt, baseMs, maxMs) {
  const jitter = Math.random() * 0.3 + 0.85; // 0.85–1.15x
  return Math.min(baseMs * 2 ** attempt * jitter, maxMs);
}

export function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

export function normalizeUrl(input) {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  try {
    return new URL(url).href;
  } catch {
    throw new CrawlError(`Invalid URL: "${input}"`);
  }
}

/**
 * Run a handler concurrently for multiple items, then print a summary.
 * Returns { successes, failures } arrays.
 */
export async function runConcurrent(items, handler, { labelFn = String } = {}) {
  const results = await Promise.allSettled(items.map(handler));

  const successes = [];
  const failures = [];

  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "fulfilled") {
      successes.push({ item: items[i], value: results[i].value });
    } else {
      failures.push({ item: items[i], error: results[i].reason?.message ?? String(results[i].reason) });
    }
  }

  if (items.length > 1) {
    console.log(`\n${"="} Summary ${"="}`);
    for (const s of successes) {
      console.log(`  ✓ ${labelFn(s.item)} — success`);
    }
    for (const f of failures) {
      console.log(`  ✗ ${labelFn(f.item)} — failed: ${f.error}`);
    }

    if (failures.length > 0) {
      console.error(`\n${failures.length} of ${items.length} operation(s) failed.`);
    }
  }

  if (failures.length > 0 && successes.length === 0) {
    throw new CrawlError(`All ${failures.length} operation(s) failed`);
  }

  return { successes, failures };
}
