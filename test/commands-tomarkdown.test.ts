import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { Readable } from "node:stream";

vi.mock("../src/api-client.js", () => ({
  cfFetchMultipart: vi.fn(),
}));

vi.mock("../src/config.js", () => ({
  WORKERS_AI_BASE: () => "https://api.test.com/v4/accounts/test/ai",
  OUTPUT_DIR: "/tmp/cf-crawl-test-output",
}));

vi.mock("../src/output.js", () => ({
  saveText: vi.fn().mockResolvedValue("/tmp/out.md"),
}));

vi.mock("node:fs/promises", () => ({
  stat: vi.fn(),
}));

vi.mock("node:fs", () => ({
  createReadStream: vi.fn(() => Readable.from([Buffer.from("fake bytes")])),
}));

const { tomarkdown } = await import("../src/commands/tomarkdown.js");
const { cfFetchMultipart } = (await import("../src/api-client.js")) as {
  cfFetchMultipart: Mock;
};
const fsPromises = (await import("node:fs/promises")) as unknown as { stat: Mock };
const { CrawlError } = await import("../src/errors.js");

describe("tomarkdown command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("rejects http:// and https:// arguments with a CrawlError", async () => {
    await expect(tomarkdown(["https://example.com"])).rejects.toBeInstanceOf(CrawlError);
    await expect(tomarkdown(["http://example.com/foo.pdf"])).rejects.toBeInstanceOf(CrawlError);
    await expect(tomarkdown(["./valid-local.pdf", "https://example.com"])).rejects.toThrow(
      /expects local file paths, not URLs/,
    );
    // API must not have been called
    expect(cfFetchMultipart).not.toHaveBeenCalled();
  });

  it("throws when no file paths are provided", async () => {
    await expect(tomarkdown([])).rejects.toThrow(/at least one file path/);
  });

  it("throws when a path does not exist", async () => {
    fsPromises.stat.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("ENOENT"));
    await expect(tomarkdown(["./does-not-exist.pdf"])).rejects.toBeInstanceOf(CrawlError);
  });
});
