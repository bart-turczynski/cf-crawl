/**
 * Cloudflare API client with retry + exponential backoff.
 *
 * Three flavors:
 *   - cfFetch           JSON in, JSON out (browser-rendering base)
 *   - cfFetchBinary     JSON in, binary out (browser-rendering base; /pdf, /screenshot)
 *   - cfFetchMultipart  multipart in, JSON out (arbitrary base; Workers AI /ai/tomarkdown)
 *
 * All three share retry/backoff/rate-limit handling via `executeWithRetry`.
 */

import { API_BASE, CF_API_TOKEN, RETRY_DEFAULTS } from "./config.js";
import { ApiError, CrawlError } from "./errors.js";
import { sleep, backoffDelay } from "./utils.js";
import type { CfApiResponse, RetryOptions } from "./types.js";

export interface BinaryResponse {
  result: Buffer;
  contentType: string;
}

/**
 * Shared fetch loop with 429 handling, retryable-error retries, and network-error
 * retries. `parse` converts a Response to the final value; it may throw ApiError
 * for error envelopes or format mismatches. Retryable ApiErrors (5xx) are retried;
 * non-retryable ApiErrors (4xx, non-JSON) propagate immediately.
 */
async function executeWithRetry<T>(
  url: string,
  init: RequestInit,
  parse: (res: Response) => Promise<T>,
  retryOpts: RetryOptions,
): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs } = { ...RETRY_DEFAULTS, ...retryOpts };

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url, init);

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

      return await parse(res);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.retryable && attempt < maxAttempts - 1) {
          const delay = backoffDelay(attempt, baseDelayMs, maxDelayMs);
          console.warn(
            `  Server error (${err.status}). Retrying in ${(delay / 1000).toFixed(1)}s...`,
          );
          await sleep(delay);
          continue;
        }
        throw err;
      }

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

export async function cfFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
  retryOpts: RetryOptions = {},
): Promise<CfApiResponse<T>> {
  const url = `${API_BASE()}${path}`;
  const init: RequestInit = {
    ...options,
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN()}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  };

  return executeWithRetry(url, init, parseJsonEnvelope<T>, retryOpts);
}

export async function cfFetchBinary(
  path: string,
  options: RequestInit = {},
  retryOpts: RetryOptions = {},
): Promise<BinaryResponse> {
  const url = `${API_BASE()}${path}`;
  const init: RequestInit = {
    ...options,
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN()}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  };

  return executeWithRetry(
    url,
    init,
    async (res) => {
      const contentType = res.headers.get("content-type") ?? "application/octet-stream";
      // If the endpoint returned JSON, it's almost always an error envelope
      if (contentType.includes("application/json")) {
        const body = (await res.json().catch(() => null)) as CfApiResponse<unknown> | null;
        if (body && (body.errors?.length ?? 0) > 0) {
          throw new ApiError(body.errors?.[0]?.message || `HTTP ${res.status}`, {
            status: res.status,
            errors: body.errors,
          });
        }
        throw new ApiError(`Expected binary response, got JSON (HTTP ${res.status})`, {
          status: res.status,
        });
      }
      if (!res.ok) {
        throw new ApiError(`HTTP ${res.status}`, { status: res.status });
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return { result: buf, contentType };
    },
    retryOpts,
  );
}

export async function cfFetchMultipart<T = unknown>(
  baseUrl: string,
  path: string,
  formData: FormData,
  retryOpts: RetryOptions = {},
): Promise<CfApiResponse<T>> {
  const url = `${baseUrl}${path}`;
  // Important: do NOT set Content-Type -- fetch computes the multipart boundary.
  const init: RequestInit = {
    method: "POST",
    body: formData,
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN()}`,
    },
  };

  return executeWithRetry(url, init, parseJsonEnvelope<T>, retryOpts);
}

async function parseJsonEnvelope<T>(res: Response): Promise<CfApiResponse<T>> {
  let data: CfApiResponse<T>;
  try {
    data = (await res.json()) as CfApiResponse<T>;
  } catch {
    throw new ApiError(`Non-JSON response (HTTP ${res.status})`, {
      status: res.status,
      retryable: false,
    });
  }
  if (!res.ok || (data.errors?.length ?? 0) > 0) {
    throw new ApiError(data.errors?.[0]?.message || `HTTP ${res.status}`, {
      status: res.status,
      errors: data.errors,
    });
  }
  return data;
}
