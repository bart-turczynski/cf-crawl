import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { JobEntry } from "../src/types.js";

vi.mock("node:fs/promises", () => ({
  appendFile: vi.fn(() => Promise.resolve()),
  readFile: vi.fn(() => Promise.resolve("")),
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
      const { appendFile } = (await import("node:fs/promises")) as { appendFile: Mock };
      const { ensureOutputDir } = (await import("../src/output.js")) as {
        ensureOutputDir: Mock;
      };
      const { logJob } = await import("../src/job-log.js");

      const entry = {
        jobId: "abc-123",
        url: "https://example.com",
        status: "started",
        startedAt: new Date().toISOString(),
      } satisfies JobEntry;

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
    it("folds append-only events by jobId", async () => {
      const { readFile } = (await import("node:fs/promises")) as { readFile: Mock };
      readFile.mockResolvedValue(
        [
          JSON.stringify({
            jobId: "abc-123",
            url: "https://example.com",
            status: "started",
            startedAt: "2026-04-21T20:00:00.000Z",
          }),
          JSON.stringify({
            jobId: "def-456",
            url: "https://other.com",
            status: "started",
          }),
          JSON.stringify({
            jobId: "abc-123",
            status: "completed",
            finished: 42,
            updatedAt: "2026-04-21T20:05:00.000Z",
          }),
        ].join("\n") + "\n",
      );

      const { readJobLog } = await import("../src/job-log.js");
      const result = await readJobLog();

      expect(result).toEqual([
        {
          jobId: "abc-123",
          url: "https://example.com",
          status: "completed",
          startedAt: "2026-04-21T20:00:00.000Z",
          finished: 42,
          updatedAt: "2026-04-21T20:05:00.000Z",
        },
        {
          jobId: "def-456",
          url: "https://other.com",
          status: "started",
        },
      ]);
      expect(readFile).toHaveBeenCalledWith(expect.stringContaining("jobs.jsonl"), "utf-8");
    });

    it("returns empty array when file does not exist", async () => {
      const { readFile } = (await import("node:fs/promises")) as { readFile: Mock };
      const err = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      readFile.mockRejectedValue(err);

      const { readJobLog } = await import("../src/job-log.js");
      const result = await readJobLog();

      expect(result).toEqual([]);
    });
  });

  describe("updateJobLog", () => {
    it("appends an update event for an existing entry", async () => {
      const { appendFile } = (await import("node:fs/promises")) as { appendFile: Mock };
      const { updateJobLog } = await import("../src/job-log.js");

      await updateJobLog("abc-123", { status: "completed", finished: 10 });

      expect(appendFile).toHaveBeenCalledTimes(1);
      const event = JSON.parse((appendFile.mock.calls[0][1] as string).trim()) as JobEntry;
      expect(event.jobId).toBe("abc-123");
      expect(event.status).toBe("completed");
      expect(event.finished).toBe(10);
      expect(event.updatedAt).toEqual(expect.any(String));
    });

    it("appends an update event for a previously unseen jobId", async () => {
      const { appendFile } = (await import("node:fs/promises")) as { appendFile: Mock };
      const { updateJobLog } = await import("../src/job-log.js");

      await updateJobLog("new-999", { status: "interrupted" });

      expect(appendFile).toHaveBeenCalledTimes(1);
      const event = JSON.parse((appendFile.mock.calls[0][1] as string).trim()) as JobEntry;
      expect(event.jobId).toBe("new-999");
      expect(event.status).toBe("interrupted");
      expect(event.updatedAt).toEqual(expect.any(String));
    });
  });
});
