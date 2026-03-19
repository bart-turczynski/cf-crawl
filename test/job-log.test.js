import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  appendFile: vi.fn(() => Promise.resolve()),
  readFile: vi.fn(() => Promise.resolve("")),
  writeFile: vi.fn(() => Promise.resolve()),
}));

vi.mock("../src/output.js", () => ({
  ensureOutputDir: vi.fn(() => Promise.resolve()),
}));

describe("job-log", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("logJob", () => {
    it("appends a JSONL entry to the jobs file", async () => {
      const { appendFile } = await import("node:fs/promises");
      const { ensureOutputDir } = await import("../src/output.js");
      const { logJob } = await import("../src/job-log.js");

      const entry = { jobId: "abc-123", url: "https://example.com", status: "started" };
      await logJob(entry);

      expect(ensureOutputDir).toHaveBeenCalledTimes(1);
      expect(appendFile).toHaveBeenCalledTimes(1);
      expect(appendFile).toHaveBeenCalledWith(
        expect.stringContaining("jobs.jsonl"),
        JSON.stringify(entry) + "\n",
      );
    });
  });

  describe("readJobLog", () => {
    it("returns parsed entries from the JSONL file", async () => {
      const { readFile } = await import("node:fs/promises");
      const entries = [
        { jobId: "abc-123", url: "https://example.com" },
        { jobId: "def-456", url: "https://other.com" },
      ];
      readFile.mockResolvedValue(entries.map((e) => JSON.stringify(e)).join("\n") + "\n");

      const { readJobLog } = await import("../src/job-log.js");
      const result = await readJobLog();

      expect(result).toEqual(entries);
      expect(readFile).toHaveBeenCalledWith(expect.stringContaining("jobs.jsonl"), "utf-8");
    });

    it("returns empty array when file does not exist", async () => {
      const { readFile } = await import("node:fs/promises");
      readFile.mockRejectedValue(new Error("ENOENT: no such file or directory"));

      const { readJobLog } = await import("../src/job-log.js");
      const result = await readJobLog();

      expect(result).toEqual([]);
    });
  });

  describe("updateJobLog", () => {
    it("updates an existing entry by jobId", async () => {
      const { readFile, writeFile } = await import("node:fs/promises");
      const existing = [
        { jobId: "abc-123", url: "https://example.com", status: "started" },
        { jobId: "def-456", url: "https://other.com", status: "started" },
      ];
      readFile.mockResolvedValue(existing.map((e) => JSON.stringify(e)).join("\n") + "\n");

      const { updateJobLog } = await import("../src/job-log.js");
      await updateJobLog("abc-123", { status: "completed", pages: 42 });

      expect(writeFile).toHaveBeenCalledTimes(1);
      const written = writeFile.mock.calls[0][1];
      const lines = written.trim().split("\n").map((l) => JSON.parse(l));

      expect(lines).toHaveLength(2);
      expect(lines[0].jobId).toBe("abc-123");
      expect(lines[0].status).toBe("completed");
      expect(lines[0].pages).toBe(42);
      expect(lines[0].updatedAt).toEqual(expect.any(String));
      // Second entry unchanged (except no updatedAt added)
      expect(lines[1].jobId).toBe("def-456");
      expect(lines[1].status).toBe("started");
    });

    it("adds a new entry when jobId is not found", async () => {
      const { readFile, writeFile } = await import("node:fs/promises");
      const existing = [{ jobId: "abc-123", url: "https://example.com", status: "started" }];
      readFile.mockResolvedValue(existing.map((e) => JSON.stringify(e)).join("\n") + "\n");

      const { updateJobLog } = await import("../src/job-log.js");
      await updateJobLog("new-999", { status: "interrupted" });

      expect(writeFile).toHaveBeenCalledTimes(1);
      const written = writeFile.mock.calls[0][1];
      const lines = written.trim().split("\n").map((l) => JSON.parse(l));

      expect(lines).toHaveLength(2);
      expect(lines[0].jobId).toBe("abc-123");
      expect(lines[1].jobId).toBe("new-999");
      expect(lines[1].status).toBe("interrupted");
      expect(lines[1].updatedAt).toEqual(expect.any(String));
    });
  });
});
