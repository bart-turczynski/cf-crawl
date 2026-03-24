import { describe, it, expect, vi, beforeEach } from "vitest";

describe("config", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("COMPLETED_STATUSES", () => {
    it("is a Set", async () => {
      const { COMPLETED_STATUSES } = await import("../src/config.js");
      expect(COMPLETED_STATUSES).toBeInstanceOf(Set);
    });

    it('contains "completed"', async () => {
      const { COMPLETED_STATUSES } = await import("../src/config.js");
      expect(COMPLETED_STATUSES.has("completed")).toBe(true);
    });

    it('contains "done"', async () => {
      const { COMPLETED_STATUSES } = await import("../src/config.js");
      expect(COMPLETED_STATUSES.has("done")).toBe(true);
    });

    it('contains "finished"', async () => {
      const { COMPLETED_STATUSES } = await import("../src/config.js");
      expect(COMPLETED_STATUSES.has("finished")).toBe(true);
    });
  });

  describe("FAILED_STATUSES", () => {
    it("is a Set", async () => {
      const { FAILED_STATUSES } = await import("../src/config.js");
      expect(FAILED_STATUSES).toBeInstanceOf(Set);
    });

    it('contains "failed"', async () => {
      const { FAILED_STATUSES } = await import("../src/config.js");
      expect(FAILED_STATUSES.has("failed")).toBe(true);
    });

    it('contains "error"', async () => {
      const { FAILED_STATUSES } = await import("../src/config.js");
      expect(FAILED_STATUSES.has("error")).toBe(true);
    });
  });

  describe("RETRY_DEFAULTS", () => {
    it("has expected shape", async () => {
      const { RETRY_DEFAULTS } = await import("../src/config.js");
      expect(RETRY_DEFAULTS).toEqual({
        maxAttempts: 4,
        baseDelayMs: 1_000,
        maxDelayMs: 30_000,
      });
    });
  });

  describe("POLL_DEFAULTS", () => {
    it("has expected shape", async () => {
      const { POLL_DEFAULTS } = await import("../src/config.js");
      expect(POLL_DEFAULTS).toEqual({
        intervalMs: 10_000,
        maxAttempts: 360,
      });
    });
  });

  describe("validateEnv", () => {
    it("calls process.exit(1) when CF_ACCOUNT_ID is missing", async () => {
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation((() => {}) as unknown as (code?: number) => never);
      vi.spyOn(console, "error").mockImplementation(() => {});

      const originalAccountId = process.env.CF_ACCOUNT_ID;
      const originalApiToken = process.env.CF_API_TOKEN;
      delete process.env.CF_ACCOUNT_ID;
      delete process.env.CF_API_TOKEN;

      // validateEnv reads process.env directly (lazy), but reset modules
      // for a clean import.
      vi.resetModules();
      const { validateEnv } = await import("../src/config.js");
      validateEnv();

      expect(exitSpy).toHaveBeenCalledWith(1);

      // Restore
      if (originalAccountId !== undefined) process.env.CF_ACCOUNT_ID = originalAccountId;
      if (originalApiToken !== undefined) process.env.CF_API_TOKEN = originalApiToken;
    });

    it("does not call process.exit when env vars are set", async () => {
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation((() => {}) as unknown as (code?: number) => never);

      const originalAccountId = process.env.CF_ACCOUNT_ID;
      const originalApiToken = process.env.CF_API_TOKEN;
      process.env.CF_ACCOUNT_ID = "test-account-id";
      process.env.CF_API_TOKEN = "test-api-token";

      vi.resetModules();
      const { validateEnv } = await import("../src/config.js");
      validateEnv();

      expect(exitSpy).not.toHaveBeenCalled();

      // Restore
      if (originalAccountId !== undefined) {
        process.env.CF_ACCOUNT_ID = originalAccountId;
      } else {
        delete process.env.CF_ACCOUNT_ID;
      }
      if (originalApiToken !== undefined) {
        process.env.CF_API_TOKEN = originalApiToken;
      } else {
        delete process.env.CF_API_TOKEN;
      }
    });
  });
});
