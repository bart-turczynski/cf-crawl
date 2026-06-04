import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { OutputUrlEntry } from "../src/types.js";

vi.mock("node:fs/promises", () => ({
  appendFile: vi.fn(() => Promise.resolve()),
}));

vi.mock("../src/output.js", () => ({
  ensureOutputDir: vi.fn(() => Promise.resolve()),
}));

describe("output-log", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("logOutputUrl", () => {
    it("appends a JSONL entry to the urls file", async () => {
      const { appendFile } = (await import("node:fs/promises")) as { appendFile: Mock };
      const { ensureOutputDir } = (await import("../src/output.js")) as {
        ensureOutputDir: Mock;
      };
      const { logOutputUrl } = await import("../src/output-log.js");

      const entry = {
        command: "scrape",
        url: "https://kiwicommerce.co.uk/9-best-ai-tools-for-e-commerce-sites/",
        filename:
          "scrape_kiwicommerce_co_uk_9-best-ai-tools-for-e-commerce-sites_2026-06-04T00-00-00.json",
        timestamp: "2026-06-04T00-00-00",
      } satisfies OutputUrlEntry;

      await logOutputUrl(entry);

      expect(ensureOutputDir).toHaveBeenCalledTimes(1);
      expect(appendFile).toHaveBeenCalledTimes(1);
      expect(appendFile).toHaveBeenCalledWith(
        expect.stringContaining("urls.jsonl"),
        JSON.stringify(entry) + "\n",
      );
    });
  });
});
