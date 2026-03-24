import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../src/config.js", () => ({
  API_BASE: () => "https://api.test.com/v4/accounts/test-account/browser-rendering",
  CF_API_TOKEN: () => "test-token-123",
  RETRY_DEFAULTS: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000 },
}));

vi.mock("../src/utils.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    sleep: vi.fn().mockResolvedValue(undefined),
  };
});

const { cfFetch } = await import("../src/api-client.js");
const { ApiError, CrawlError } = await import("../src/errors.js");
const { sleep } = (await import("../src/utils.js")) as { sleep: Mock };

const mockFetch = vi.fn();

describe("cfFetch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sleep.mockClear();
    sleep.mockResolvedValue(undefined);
    globalThis.fetch = mockFetch;
    mockFetch.mockReset();
  });

  function mockResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
    return {
      status,
      ok: status >= 200 && status < 300,
      json: vi.fn().mockResolvedValue(body),
      headers: {
        get: vi.fn((name: string) => headers[name.toLowerCase()] ?? null),
      },
    };
  }

  it("successful request returns parsed JSON", async () => {
    const data = { success: true, result: { id: "abc" } };
    mockFetch.mockResolvedValueOnce(mockResponse(200, data));

    const result = await cfFetch("/crawl");

    expect(result).toEqual(data);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("passes Authorization header with Bearer token", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, { success: true }));

    await cfFetch("/crawl");

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>).Authorization).toBe("Bearer test-token-123");
    expect((options.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("retries on 429 with backoff", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(429, { errors: [{ message: "rate limited" }] }))
      .mockResolvedValueOnce(mockResponse(429, { errors: [{ message: "rate limited" }] }))
      .mockResolvedValueOnce(mockResponse(200, { success: true }));

    const result = await cfFetch("/crawl");

    expect(result).toEqual({ success: true });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("respects Retry-After header on 429", async () => {
    mockFetch
      .mockResolvedValueOnce(
        mockResponse(429, { errors: [{ message: "rate limited" }] }, { "retry-after": "5" }),
      )
      .mockResolvedValueOnce(mockResponse(200, { success: true }));

    await cfFetch("/crawl");

    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it("retries on 500 server errors", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(500, { errors: [{ message: "Internal Server Error" }] }))
      .mockResolvedValueOnce(mockResponse(200, { success: true }));

    const result = await cfFetch("/crawl");

    expect(result).toEqual({ success: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("throws ApiError on 4xx (non-429) without retry", async () => {
    mockFetch.mockResolvedValue(mockResponse(403, { errors: [{ message: "Forbidden" }] }));

    const err = await cfFetch("/crawl").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as InstanceType<typeof ApiError>).message).toBe("Forbidden");
    expect((err as InstanceType<typeof ApiError>).status).toBe(403);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("throws ApiError on non-JSON response", async () => {
    mockFetch.mockResolvedValueOnce({
      status: 502,
      ok: false,
      json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token")),
      headers: { get: vi.fn(() => null) },
    });

    const err = await cfFetch("/crawl").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as InstanceType<typeof ApiError>).message).toMatch(/Non-JSON response/);
    expect((err as InstanceType<typeof ApiError>).status).toBe(502);
  });

  it("throws CrawlError after max retries on network error", async () => {
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));

    const err = await cfFetch("/crawl").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CrawlError);
    expect((err as Error).message).toMatch(/Network request failed after 3 attempts/);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("constructs the full URL from API_BASE + path", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, { success: true }));

    await cfFetch("/crawl/job-123");

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe(
      "https://api.test.com/v4/accounts/test-account/browser-rendering/crawl/job-123",
    );
  });
});
