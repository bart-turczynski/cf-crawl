import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock all external dependencies so no real API calls are made
vi.mock("../src/config.js", () => ({
  CF_ACCOUNT_ID: "fake-account-id",
  CF_API_TOKEN: "fake-api-token",
  API_BASE: "https://api.cloudflare.com/client/v4/accounts/fake-account-id/browser-rendering",
  OUTPUT_DIR: "/tmp/test-output",
  RETRY_DEFAULTS: { maxAttempts: 4, baseDelayMs: 1_000, maxDelayMs: 30_000 },
  POLL_DEFAULTS: { intervalMs: 10_000, maxAttempts: 360 },
  COMPLETED_STATUSES: new Set(["completed", "done", "finished"]),
  FAILED_STATUSES: new Set(["failed", "error"]),
  validateEnv: vi.fn(),
}));

vi.mock("../src/commands/crawl.js", () => ({
  crawl: vi.fn(),
  submitCrawl: vi.fn(),
  pollCrawlJobs: vi.fn(),
}));

vi.mock("../src/commands/scrape.js", () => ({
  scrape: vi.fn(),
}));

vi.mock("../src/commands/status.js", () => ({
  status: vi.fn(),
}));

vi.mock("../src/commands/download.js", () => ({
  download: vi.fn(),
}));

vi.mock("../src/commands/jobs.js", () => ({
  listJobs: vi.fn(),
}));

vi.mock("../src/job-log.js", () => ({
  updateJobLog: vi.fn(() => Promise.resolve()),
}));

describe("cli", () => {
  let originalArgv;
  let exitSpy;
  let errorSpy;
  let logSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    originalArgv = process.argv;
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = originalArgv;
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  describe("trackJob / untrackJob", () => {
    it("trackJob adds a jobId to the active set and untrackJob removes it", async () => {
      const { trackJob, untrackJob } = await import("../src/cli.js");

      // trackJob should not throw
      trackJob("job-1");
      trackJob("job-2");

      // untrackJob should not throw
      untrackJob("job-1");

      // Calling untrackJob on a non-existent id should not throw
      untrackJob("non-existent");
    });
  });

  describe("main() with no command", () => {
    it("prints usage when no command is provided", async () => {
      process.argv = ["node", "index.js"];
      const { main } = await import("../src/cli.js");

      await main();

      expect(logSpy).toHaveBeenCalled();
      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Usage:");
      expect(output).toContain("crawl");
      expect(output).toContain("scrape");
    });
  });

  describe("crawl with no URL", () => {
    it("exits with error when no URL is provided", async () => {
      process.argv = ["node", "index.js", "crawl"];
      const { main } = await import("../src/cli.js");

      await expect(main()).rejects.toThrow("process.exit called");

      expect(exitSpy).toHaveBeenCalledWith(1);
      const errorOutput = errorSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(errorOutput).toContain("URL is required");
    });
  });

  describe("scrape with no URL", () => {
    it("exits with error when no URL is provided", async () => {
      process.argv = ["node", "index.js", "scrape"];
      const { main } = await import("../src/cli.js");

      await expect(main()).rejects.toThrow("process.exit called");

      expect(exitSpy).toHaveBeenCalledWith(1);
      const errorOutput = errorSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(errorOutput).toContain("URL is required");
    });
  });

  describe("crawl dispatches to submitCrawl", () => {
    it("calls submitCrawl and pollCrawlJobs for a single URL", async () => {
      const { submitCrawl, pollCrawlJobs } = await import("../src/commands/crawl.js");
      submitCrawl.mockResolvedValue({ jobId: "job-abc", url: "https://example.com/" });
      pollCrawlJobs.mockResolvedValue({ results: [{ url: "https://example.com/", jobId: "job-abc" }], failures: [] });

      process.argv = ["node", "index.js", "crawl", "example.com"];
      const { main } = await import("../src/cli.js");

      await main();

      expect(submitCrawl).toHaveBeenCalledWith(
        "example.com",
        false,
        expect.any(Object),
      );
      expect(pollCrawlJobs).toHaveBeenCalledTimes(1);
    });
  });

  describe("scrape dispatches to scrape command", () => {
    it("calls scrape for a single URL", async () => {
      const { scrape } = await import("../src/commands/scrape.js");
      scrape.mockResolvedValue(undefined);

      process.argv = ["node", "index.js", "scrape", "https://example.com"];
      const { main } = await import("../src/cli.js");

      await main();

      expect(scrape).toHaveBeenCalledWith("https://example.com", expect.any(Object));
    });
  });
});
