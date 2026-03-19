import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(() => Promise.resolve()),
  writeFile: vi.fn(() => Promise.resolve()),
}));

vi.mock("node:fs", () => {
  const mockWrite = vi.fn((_chunk, _encoding, cb) => {
    if (cb) cb();
    return true;
  });
  const mockEnd = vi.fn();
  const mockStream = {
    write: mockWrite,
    end: mockEnd,
    on: vi.fn((event, handler) => {
      if (event === "finish") {
        // Defer finish so it fires after ws.end() is called
        mockEnd.mockImplementation(() => handler());
      }
      return mockStream;
    }),
  };
  return {
    createWriteStream: vi.fn(() => mockStream),
    __mockStream: mockStream,
  };
});

describe("output", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the cached mkdirPromise by re-importing fresh module
    vi.resetModules();
  });

  describe("ensureOutputDir", () => {
    it("calls mkdir only once across multiple invocations", async () => {
      const { mkdir } = await import("node:fs/promises");
      const { ensureOutputDir } = await import("../src/output.js");

      await ensureOutputDir();
      await ensureOutputDir();

      expect(mkdir).toHaveBeenCalledTimes(1);
      expect(mkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    });
  });

  describe("saveResult", () => {
    it("writes JSON file for small results using writeFile", async () => {
      const { writeFile } = await import("node:fs/promises");
      const { saveResult } = await import("../src/output.js");
      vi.spyOn(console, "log").mockImplementation(() => {});

      const data = { result: { records: [{ url: "https://example.com" }] } };
      const filepath = await saveResult("test.json", data);

      expect(writeFile).toHaveBeenCalledTimes(1);
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining("test.json"),
        JSON.stringify(data, null, 2),
      );
      expect(filepath).toContain("test.json");
    });

    it("uses streaming for results with >500 records", async () => {
      const { writeFile } = await import("node:fs/promises");
      const { createWriteStream } = await import("node:fs");
      const { saveResult } = await import("../src/output.js");
      vi.spyOn(console, "log").mockImplementation(() => {});

      const records = Array.from({ length: 501 }, (_, i) => ({ id: i }));
      const data = { result: { records } };

      await saveResult("large.json", data);

      expect(createWriteStream).toHaveBeenCalledTimes(1);
      expect(createWriteStream).toHaveBeenCalledWith(expect.stringContaining("large.json"));
      // writeFile should NOT have been called for the large case
      expect(writeFile).not.toHaveBeenCalled();
    });
  });
});
