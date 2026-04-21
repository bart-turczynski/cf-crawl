import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../src/config.js", () => ({
  API_BASE: () => "https://api.test.com/v4/accounts/test-account/browser-rendering",
  WORKERS_AI_BASE: () => "https://api.test.com/v4/accounts/test-account/ai",
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

const { cfFetch, cfFetchBinary, cfFetchMultipart } = await import("../src/api-client.js");
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

describe("cfFetchBinary", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sleep.mockClear();
    sleep.mockResolvedValue(undefined);
    globalThis.fetch = mockFetch;
    mockFetch.mockReset();
  });

  function mockBinaryResponse(
    status: number,
    body: ArrayBuffer | string,
    contentType = "application/pdf",
    extraHeaders: Record<string, string> = {},
  ) {
    const headers: Record<string, string> = { "content-type": contentType, ...extraHeaders };
    return {
      status,
      ok: status >= 200 && status < 300,
      arrayBuffer: vi
        .fn()
        .mockResolvedValue(typeof body === "string" ? new TextEncoder().encode(body).buffer : body),
      json: vi.fn().mockResolvedValue({}),
      headers: {
        get: vi.fn((name: string) => headers[name.toLowerCase()] ?? null),
      },
    };
  }

  it("returns a Buffer and content type on success", async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    mockFetch.mockResolvedValueOnce(mockBinaryResponse(200, pdfBytes.buffer, "application/pdf"));

    const { result, contentType } = await cfFetchBinary("/pdf", {
      method: "POST",
      body: JSON.stringify({ url: "https://example.com" }),
    });

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.slice(0, 4).toString("ascii")).toBe("%PDF");
    expect(contentType).toBe("application/pdf");
  });

  it("hits the browser-rendering base URL", async () => {
    mockFetch.mockResolvedValueOnce(
      mockBinaryResponse(200, new Uint8Array([1, 2, 3]).buffer, "image/png"),
    );

    await cfFetchBinary("/screenshot", { method: "POST", body: "{}" });

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("https://api.test.com/v4/accounts/test-account/browser-rendering/screenshot");
  });

  it("surfaces a JSON error envelope as ApiError", async () => {
    const errResp = {
      status: 400,
      ok: false,
      arrayBuffer: vi.fn(),
      json: vi.fn().mockResolvedValue({ errors: [{ message: "bad request" }] }),
      headers: {
        get: vi.fn((name: string) =>
          name.toLowerCase() === "content-type" ? "application/json" : null,
        ),
      },
    };
    mockFetch.mockResolvedValueOnce(errResp);

    const err = await cfFetchBinary("/pdf", { method: "POST", body: "{}" }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ApiError);
    expect((err as InstanceType<typeof ApiError>).message).toBe("bad request");
    expect((err as InstanceType<typeof ApiError>).status).toBe(400);
  });
});

describe("cfFetchMultipart", () => {
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

  it("posts to the provided base URL with FormData body and no Content-Type header", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, { success: true, result: [{ name: "a.pdf", data: "# hi" }] }),
    );

    const form = new FormData();
    form.append("files", new Blob(["hello"], { type: "text/plain" }), "a.txt");

    const result = await cfFetchMultipart(
      "https://api.test.com/v4/accounts/test-account/ai",
      "/tomarkdown",
      form,
    );

    expect(result.success).toBe(true);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.test.com/v4/accounts/test-account/ai/tomarkdown");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    // Content-Type must NOT be set manually -- fetch computes the boundary
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
    expect(headers.Authorization).toBe("Bearer test-token-123");
  });

  it("throws ApiError on non-2xx envelope", async () => {
    mockFetch.mockResolvedValue(mockResponse(401, { errors: [{ message: "unauthorized" }] }));

    const err = await cfFetchMultipart(
      "https://api.test.com/v4/accounts/test-account/ai",
      "/tomarkdown",
      new FormData(),
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as InstanceType<typeof ApiError>).status).toBe(401);
  });
});
