import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/config.js", () => ({
  API_BASE: () => "https://api.test.com/v4/accounts/test-account/browser-rendering",
  CF_API_TOKEN: () => "test-token-123",
  RETRY_DEFAULTS: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000 },
}));

vi.mock("../src/utils.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    sleep: vi.fn().mockResolvedValue(undefined),
  };
});

const { cfFetch } = await import("../src/api-client.js");
const { ApiError, CrawlError } = await import("../src/errors.js");
const { sleep } = await import("../src/utils.js");

describe("cfFetch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sleep.mockClear();
    sleep.mockResolvedValue(undefined);
    globalThis.fetch = vi.fn();
  });

  function mockResponse(status, body, headers = {}) {
    return {
      status,
      ok: status >= 200 && status < 300,
      json: vi.fn().mockResolvedValue(body),
      headers: {
        get: vi.fn((name) => headers[name.toLowerCase()] ?? null),
      },
    };
  }

  it("successful request returns parsed JSON", async () => {
    const data = { success: true, result: { id: "abc" } };
    globalThis.fetch.mockResolvedValueOnce(mockResponse(200, data));

    const result = await cfFetch("/crawl");

    expect(result).toEqual(data);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it("passes Authorization header with Bearer token", async () => {
    globalThis.fetch.mockResolvedValueOnce(mockResponse(200, { success: true }));

    await cfFetch("/crawl");

    const [, options] = globalThis.fetch.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer test-token-123");
    expect(options.headers["Content-Type"]).toBe("application/json");
  });

  it("retries on 429 with backoff", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(mockResponse(429, { errors: [{ message: "rate limited" }] }))
      .mockResolvedValueOnce(mockResponse(429, { errors: [{ message: "rate limited" }] }))
      .mockResolvedValueOnce(mockResponse(200, { success: true }));

    const result = await cfFetch("/crawl");

    expect(result).toEqual({ success: true });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("respects Retry-After header on 429", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(mockResponse(429, { errors: [{ message: "rate limited" }] }, { "retry-after": "5" }))
      .mockResolvedValueOnce(mockResponse(200, { success: true }));

    await cfFetch("/crawl");

    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it("retries on 500 server errors", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(mockResponse(500, { errors: [{ message: "Internal Server Error" }] }))
      .mockResolvedValueOnce(mockResponse(200, { success: true }));

    const result = await cfFetch("/crawl");

    expect(result).toEqual({ success: true });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("throws ApiError on 4xx (non-429) without retry", async () => {
    globalThis.fetch.mockResolvedValue(
      mockResponse(403, { errors: [{ message: "Forbidden" }] })
    );

    const err = await cfFetch("/crawl").catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("Forbidden");
    expect(err.status).toBe(403);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("throws ApiError on non-JSON response", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      status: 502,
      ok: false,
      json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token")),
      headers: { get: vi.fn(() => null) },
    });

    const err = await cfFetch("/crawl").catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toMatch(/Non-JSON response/);
    expect(err.status).toBe(502);
  });

  it("throws CrawlError after max retries on network error", async () => {
    globalThis.fetch.mockRejectedValue(new TypeError("fetch failed"));

    const err = await cfFetch("/crawl").catch((e) => e);

    expect(err).toBeInstanceOf(CrawlError);
    expect(err.message).toMatch(/Network request failed after 3 attempts/);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("constructs the full URL from API_BASE + path", async () => {
    globalThis.fetch.mockResolvedValueOnce(mockResponse(200, { success: true }));

    await cfFetch("/crawl/job-123");

    const [url] = globalThis.fetch.mock.calls[0];
    expect(url).toBe(
      "https://api.test.com/v4/accounts/test-account/browser-rendering/crawl/job-123"
    );
  });
});
