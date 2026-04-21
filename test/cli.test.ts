import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { ConfigError } from "../src/errors.js";

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

vi.mock("../src/commands/markdown.js", () => ({
  markdown: vi.fn(),
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

vi.mock("../src/commands/content.js", () => ({ content: vi.fn() }));
vi.mock("../src/commands/links.js", () => ({ links: vi.fn() }));
vi.mock("../src/commands/json.js", () => ({ json: vi.fn() }));
vi.mock("../src/commands/pdf.js", () => ({ pdf: vi.fn() }));
vi.mock("../src/commands/screenshot.js", () => ({ screenshot: vi.fn() }));
vi.mock("../src/commands/snapshot.js", () => ({ snapshot: vi.fn() }));
vi.mock("../src/commands/tomarkdown.js", () => ({ tomarkdown: vi.fn() }));

vi.mock("../src/job-log.js", () => ({
  updateJobLog: vi.fn(() => Promise.resolve()),
}));

describe("cli", () => {
  let originalArgv: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let baselineSigintListeners: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    originalArgv = process.argv;
    baselineSigintListeners = process.listenerCount("SIGINT");
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { validateEnv } = (await import("../src/config.js")) as { validateEnv: Mock };
    validateEnv.mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.argv = originalArgv;
    logSpy.mockRestore();
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

  describe("SIGINT lifecycle", () => {
    it("cleans up SIGINT listeners across repeated successful runs", async () => {
      const { content } = (await import("../src/commands/content.js")) as { content: Mock };
      content.mockResolvedValue(undefined);
      const emitWarningSpy = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
      const { main } = await import("../src/cli.js");

      for (let i = 0; i < 12; i++) {
        process.argv = ["node", "index.js", "content", "https://example.com"];
        await main();
        expect(process.listenerCount("SIGINT")).toBe(baselineSigintListeners);
      }

      const warningMessages = emitWarningSpy.mock.calls.map((call) => String(call[0]));
      expect(
        warningMessages.some((message) =>
          message.includes("Possible EventEmitter memory leak detected"),
        ),
      ).toBe(false);
      emitWarningSpy.mockRestore();
    });

    it("cleans up SIGINT listeners after command failures", async () => {
      const { scrape } = (await import("../src/commands/scrape.js")) as { scrape: Mock };
      scrape.mockRejectedValue(new Error("boom"));
      process.argv = ["node", "index.js", "scrape", "https://example.com"];
      const { main } = await import("../src/cli.js");

      await expect(main()).rejects.toThrow("boom");
      expect(process.listenerCount("SIGINT")).toBe(baselineSigintListeners);
    });

    it("does not leak SIGINT listeners on usage errors", async () => {
      process.argv = ["node", "index.js", "markdown"];
      const { main } = await import("../src/cli.js");

      await expect(main()).rejects.toThrow(/URL is required/);
      expect(process.listenerCount("SIGINT")).toBe(baselineSigintListeners);
    });

    it("does not register SIGINT listeners on config errors", async () => {
      const { validateEnv } = (await import("../src/config.js")) as { validateEnv: Mock };
      validateEnv.mockImplementation(() => {
        throw new ConfigError("Missing CF_ACCOUNT_ID or CF_API_TOKEN in .env");
      });

      process.argv = ["node", "index.js", "jobs"];
      const { main } = await import("../src/cli.js");

      await expect(main()).rejects.toThrow(ConfigError);
      expect(process.listenerCount("SIGINT")).toBe(baselineSigintListeners);
    });
  });

  describe("crawl", () => {
    it("throws a usage error when no URL is provided", async () => {
      process.argv = ["node", "index.js", "crawl"];
      const { main } = await import("../src/cli.js");

      await expect(main()).rejects.toThrow(/URL is required/);
    });

    it("calls submitCrawl and pollCrawlJobs for a single URL", async () => {
      const { submitCrawl, pollCrawlJobs } = (await import("../src/commands/crawl.js")) as {
        submitCrawl: Mock;
        pollCrawlJobs: Mock;
      };
      submitCrawl.mockResolvedValue({ jobId: "job-abc", url: "https://example.com/" });
      pollCrawlJobs.mockResolvedValue({
        results: [{ url: "https://example.com/", jobId: "job-abc" }],
        failures: [],
      });

      process.argv = ["node", "index.js", "crawl", "example.com"];
      const { main } = await import("../src/cli.js");

      await main();

      expect(submitCrawl).toHaveBeenCalledWith("https://example.com/", false, expect.any(Object));
      expect(pollCrawlJobs).toHaveBeenCalledTimes(1);
    });
  });

  describe("scrape", () => {
    it("throws a usage error when no URL is provided", async () => {
      process.argv = ["node", "index.js", "scrape"];
      const { main } = await import("../src/cli.js");

      await expect(main()).rejects.toThrow(/URL is required/);
    });

    it("calls scrape for a single URL", async () => {
      const { scrape } = (await import("../src/commands/scrape.js")) as { scrape: Mock };
      scrape.mockResolvedValue(undefined);

      process.argv = ["node", "index.js", "scrape", "https://example.com"];
      const { main } = await import("../src/cli.js");

      await main();

      expect(scrape).toHaveBeenCalledWith("https://example.com/", expect.any(Object));
    });
  });

  describe("markdown", () => {
    it("throws a usage error when no URL is provided", async () => {
      process.argv = ["node", "index.js", "markdown"];
      const { main } = await import("../src/cli.js");

      await expect(main()).rejects.toThrow(/URL is required/);
    });

    it("calls markdown for a single URL", async () => {
      const { markdown } = (await import("../src/commands/markdown.js")) as { markdown: Mock };
      markdown.mockResolvedValue(undefined);

      process.argv = ["node", "index.js", "markdown", "https://example.com"];
      const { main } = await import("../src/cli.js");

      await main();

      expect(markdown).toHaveBeenCalledWith("https://example.com/");
    });

    it("calls markdown for each URL when multiple are provided", async () => {
      const { markdown } = (await import("../src/commands/markdown.js")) as { markdown: Mock };
      markdown.mockResolvedValue(undefined);

      process.argv = ["node", "index.js", "markdown", "https://example.com", "https://example.org"];
      const { main } = await import("../src/cli.js");

      await main();

      expect(markdown).toHaveBeenCalledTimes(2);
      expect(markdown.mock.calls.map((call) => call[0])).toEqual([
        "https://example.com/",
        "https://example.org/",
      ]);
    });
  });

  describe("new endpoints dispatch", () => {
    it("content calls content for a URL", async () => {
      const { content } = (await import("../src/commands/content.js")) as { content: Mock };
      content.mockResolvedValue(undefined);
      process.argv = ["node", "index.js", "content", "https://example.com"];
      const { main } = await import("../src/cli.js");
      await main();
      expect(content).toHaveBeenCalledWith("https://example.com/");
    });

    it("links passes --visible-only and --exclude-external flags", async () => {
      const { links } = (await import("../src/commands/links.js")) as { links: Mock };
      links.mockResolvedValue(undefined);
      process.argv = [
        "node",
        "index.js",
        "links",
        "https://example.com",
        "--visible-only",
        "--exclude-external",
      ];
      const { main } = await import("../src/cli.js");
      await main();
      expect(links).toHaveBeenCalledWith("https://example.com/", {
        visibleLinksOnly: true,
        excludeExternalLinks: true,
      });
    });

    it("json requires --prompt", async () => {
      process.argv = ["node", "index.js", "json", "https://example.com"];
      const { main } = await import("../src/cli.js");
      await expect(main()).rejects.toThrow(/--prompt/);
    });

    it("json passes prompt and schemaPath", async () => {
      const { json } = (await import("../src/commands/json.js")) as { json: Mock };
      json.mockResolvedValue(undefined);
      process.argv = [
        "node",
        "index.js",
        "json",
        "https://example.com",
        "--prompt",
        "extract title",
        "--schema",
        "./schema.json",
      ];
      const { main } = await import("../src/cli.js");
      await main();
      expect(json).toHaveBeenCalledWith("https://example.com/", {
        prompt: "extract title",
        schemaPath: "./schema.json",
      });
    });

    it("pdf calls pdf for a URL", async () => {
      const { pdf } = (await import("../src/commands/pdf.js")) as { pdf: Mock };
      pdf.mockResolvedValue(undefined);
      process.argv = ["node", "index.js", "pdf", "https://example.com"];
      const { main } = await import("../src/cli.js");
      await main();
      expect(pdf).toHaveBeenCalledWith("https://example.com/");
    });

    it("screenshot passes --full-page and --format", async () => {
      const { screenshot } = (await import("../src/commands/screenshot.js")) as {
        screenshot: Mock;
      };
      screenshot.mockResolvedValue(undefined);
      process.argv = [
        "node",
        "index.js",
        "screenshot",
        "https://example.com",
        "--full-page",
        "--format",
        "jpeg",
      ];
      const { main } = await import("../src/cli.js");
      await main();
      expect(screenshot).toHaveBeenCalledWith("https://example.com/", {
        fullPage: true,
        format: "jpeg",
      });
    });

    it("screenshot rejects unsupported --format values", async () => {
      process.argv = ["node", "index.js", "screenshot", "https://example.com", "--format", "gif"];
      const { main } = await import("../src/cli.js");
      await expect(main()).rejects.toThrow(/--format must be one of/);
    });

    it("snapshot calls snapshot for a URL", async () => {
      const { snapshot } = (await import("../src/commands/snapshot.js")) as { snapshot: Mock };
      snapshot.mockResolvedValue(undefined);
      process.argv = ["node", "index.js", "snapshot", "https://example.com"];
      const { main } = await import("../src/cli.js");
      await main();
      expect(snapshot).toHaveBeenCalledWith("https://example.com/");
    });

    it("tomarkdown passes file path positionals without URL-normalizing them", async () => {
      const { tomarkdown } = (await import("../src/commands/tomarkdown.js")) as {
        tomarkdown: Mock;
      };
      tomarkdown.mockResolvedValue(undefined);
      process.argv = ["node", "index.js", "tomarkdown", "./report.pdf", "./notes.docx"];
      const { main } = await import("../src/cli.js");
      await main();
      expect(tomarkdown).toHaveBeenCalledWith(["./report.pdf", "./notes.docx"]);
    });

    it("tomarkdown throws a usage error when no args are provided", async () => {
      process.argv = ["node", "index.js", "tomarkdown"];
      const { main } = await import("../src/cli.js");
      await expect(main()).rejects.toThrow(/at least one file path is required/);
    });
  });
});
