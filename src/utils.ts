/**
 * Shared utility functions.
 */

import { CrawlError } from "./errors.js";
import type { ConcurrentResult } from "./types.js";

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  const jitter = Math.random() * 0.3 + 0.85; // 0.85-1.15x
  return Math.min(baseMs * 2 ** attempt * jitter, maxMs);
}

export function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/** Slug a URL for use in output filenames. */
export function urlSlug(url: string): string {
  return url
    .replace(/https?:\/\//, "")
    .replace(/[/?.#&=]+/g, "_")
    .replace(/_$/, "");
}

export function normalizeUrl(input: string): string {
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
export async function runConcurrent<T, V>(
  items: T[],
  handler: (item: T) => Promise<V>,
  { labelFn = String }: { labelFn?: (item: T) => string } = {},
): Promise<ConcurrentResult<T, V>> {
  const results = await Promise.allSettled(items.map(handler));

  const successes: Array<{ item: T; value: V }> = [];
  const failures: Array<{ item: T; error: string }> = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      successes.push({ item: items[i], value: result.value });
    } else {
      failures.push({
        item: items[i],
        error: (result.reason as Error)?.message ?? String(result.reason),
      });
    }
  }

  if (items.length > 1) {
    console.log(`\n${"="} Summary ${"="}`);
    for (const s of successes) {
      console.log(`  \u2713 ${labelFn(s.item)} \u2014 success`);
    }
    for (const f of failures) {
      console.log(`  \u2717 ${labelFn(f.item)} \u2014 failed: ${f.error}`);
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
