import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sleep, backoffDelay, timestamp, normalizeUrl, runConcurrent } from "../src/utils.js";
import { CrawlError } from "../src/errors.js";

describe("sleep", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("resolves after the specified delay", async () => {
    const p = sleep(1000);
    let resolved = false;
    p.then(() => { resolved = true; });

    await vi.advanceTimersByTimeAsync(999);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
  });
});

describe("backoffDelay", () => {
  it("returns a value <= maxMs", () => {
    for (let i = 0; i < 100; i++) {
      expect(backoffDelay(10, 1000, 30000)).toBeLessThanOrEqual(30000);
    }
  });

  it("increases with attempt number", () => {
    // With jitter the relationship isn't strictly monotonic per call,
    // but the base (before jitter) doubles each attempt.
    // We sample many times and compare averages.
    const samples = 200;
    let sumAttempt0 = 0;
    let sumAttempt5 = 0;
    for (let i = 0; i < samples; i++) {
      sumAttempt0 += backoffDelay(0, 1000, 1_000_000);
      sumAttempt5 += backoffDelay(5, 1000, 1_000_000);
    }
    expect(sumAttempt5 / samples).toBeGreaterThan(sumAttempt0 / samples);
  });
});

describe("timestamp", () => {
  it("returns an ISO-ish string of length 19", () => {
    const ts = timestamp();
    expect(ts).toHaveLength(19);
    // Should look like 2026-03-19T12-34-56
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
  });
});

describe("normalizeUrl", () => {
  it("adds https:// to a bare hostname", () => {
    expect(normalizeUrl("example.com")).toBe("https://example.com/");
  });

  it("preserves existing https://", () => {
    expect(normalizeUrl("https://example.com")).toBe("https://example.com/");
  });

  it("preserves existing http://", () => {
    expect(normalizeUrl("http://example.com")).toBe("http://example.com/");
  });

  it("throws CrawlError for an invalid URL", () => {
    expect(() => normalizeUrl("://not-valid")).toThrow(CrawlError);
  });
});

describe("runConcurrent", () => {
  it("runs all handlers concurrently and returns successes/failures", async () => {
    const handler = async (item) => item * 2;
    const { successes, failures } = await runConcurrent([1], handler);
    expect(successes).toHaveLength(1);
    expect(successes[0]).toEqual({ item: 1, value: 2 });
    expect(failures).toHaveLength(0);
  });

  it("throws CrawlError when all operations fail", async () => {
    const handler = async () => { throw new Error("boom"); };
    await expect(runConcurrent([1, 2], handler)).rejects.toThrow(CrawlError);
    await expect(runConcurrent([1, 2], handler)).rejects.toThrow("All 2 operation(s) failed");
  });

  it("prints summary for multiple items", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const handler = async (item) => {
      if (item === "fail") throw new Error("oops");
      return item;
    };

    const { successes, failures } = await runConcurrent(["ok", "fail"], handler);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    // Summary header + one success line + one failure line
    expect(logSpy).toHaveBeenCalled();
    const allLogCalls = logSpy.mock.calls.map((c) => c[0]);
    expect(allLogCalls.some((msg) => msg.includes("Summary"))).toBe(true);
    expect(allLogCalls.some((msg) => msg.includes("ok"))).toBe(true);
    expect(allLogCalls.some((msg) => msg.includes("fail"))).toBe(true);

    // console.error for the failure count
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("1 of 2"));

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
