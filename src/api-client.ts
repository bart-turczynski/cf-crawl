/**
 * Cloudflare API client with retry + exponential backoff.
 */

import { API_BASE, CF_API_TOKEN, RETRY_DEFAULTS } from "./config.js";
import { ApiError, CrawlError } from "./errors.js";
import { sleep, backoffDelay } from "./utils.js";
import type { CfApiResponse, RetryOptions } from "./types.js";

export async function cfFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
  retryOpts: RetryOptions = {},
): Promise<CfApiResponse<T>> {
  const { maxAttempts, baseDelayMs, maxDelayMs } = { ...RETRY_DEFAULTS, ...retryOpts };
  const url = `${API_BASE()}${path}`;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${CF_API_TOKEN()}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });

      // Rate-limited -- always retry
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after")) || 0;
        const delay =
          retryAfter > 0 ? retryAfter * 1_000 : backoffDelay(attempt, baseDelayMs, maxDelayMs);
        if (attempt < maxAttempts - 1) {
          console.warn(`  Rate limited. Retrying in ${(delay / 1000).toFixed(1)}s...`);
          await sleep(delay);
          continue;
        }
      }

      let data: CfApiResponse<T>;
      try {
        data = (await res.json()) as CfApiResponse<T>;
      } catch {
        throw new ApiError(`Non-JSON response (HTTP ${res.status})`, { status: res.status });
      }

      if (!res.ok || (data.errors?.length ?? 0) > 0) {
        const err = new ApiError(data.errors?.[0]?.message || `HTTP ${res.status}`, {
          status: res.status,
          errors: data.errors,
        });
        if (err.retryable && attempt < maxAttempts - 1) {
          const delay = backoffDelay(attempt, baseDelayMs, maxDelayMs);
          console.warn(
            `  Server error (${res.status}). Retrying in ${(delay / 1000).toFixed(1)}s...`,
          );
          await sleep(delay);
          continue;
        }
        throw err;
      }

      return data;
    } catch (err) {
      if (err instanceof ApiError) throw err;

      // Network-level error (ECONNRESET, DNS, timeout, etc.)
      if (attempt < maxAttempts - 1) {
        const delay = backoffDelay(attempt, baseDelayMs, maxDelayMs);
        console.warn(
          `  Network error: ${(err as Error).message}. Retrying in ${(delay / 1000).toFixed(1)}s...`,
        );
        await sleep(delay);
      } else {
        throw new CrawlError(`Network request failed after ${maxAttempts} attempts`, {
          cause: err as Error,
          retryable: false,
        });
      }
    }
  }

  throw new CrawlError("Unexpected: retry loop exhausted without result");
}
