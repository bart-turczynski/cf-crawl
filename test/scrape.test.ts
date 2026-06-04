import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../src/api-client.js", () => ({
  cfFetch: vi.fn(),
}));

vi.mock("../src/config.js", () => ({
  OUTPUT_DIR: "/tmp/cf-crawl-test-output",
}));

vi.mock("../src/output.js", () => ({
  saveJson: vi.fn().mockResolvedValue("/tmp/cf-crawl-test-output/out.json"),
}));

vi.mock("../src/output-log.js", () => ({
  logOutputUrl: vi.fn(() => Promise.resolve()),
}));

const { scrape, DEFAULT_SELECTORS } = await import("../src/commands/scrape.js");
const { cfFetch } = (await import("../src/api-client.js")) as { cfFetch: Mock };

function lastBody(): Record<string, unknown> {
  const call = cfFetch.mock.calls.at(-1) as [string, { body: string }];
  return JSON.parse(call[1].body) as Record<string, unknown>;
}

describe("scrape command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    cfFetch.mockResolvedValue({ success: true, result: [] });
  });

  it("defaults to the built-in selectors, waitUntil 'load', and bestAttempt", async () => {
    await scrape("https://example.com");

    const body = lastBody();
    expect(body.url).toBe("https://example.com/");
    expect(body.elements).toEqual(DEFAULT_SELECTORS);
    expect(body.gotoOptions).toEqual({ waitUntil: "load" });
    expect(body.bestAttempt).toBe(true);
    // The old hardcoded h1 wait is gone unless explicitly requested.
    expect(body.waitForSelector).toBeUndefined();
    expect(body.waitForTimeout).toBeUndefined();
  });

  it("uses caller selectors verbatim when provided", async () => {
    await scrape("https://example.com", {
      selectors: [{ selector: ".price" }, { selector: "h1" }],
    });

    expect(lastBody().elements).toEqual([{ selector: ".price" }, { selector: "h1" }]);
  });

  it("composes wait-until, wait-for, and wait into the body", async () => {
    await scrape("https://example.com", {
      waitUntil: "networkidle2",
      waitFor: ".product-grid",
      wait: 500,
    });

    const body = lastBody();
    expect(body.gotoOptions).toEqual({ waitUntil: "networkidle2" });
    expect(body.waitForSelector).toEqual({ selector: ".product-grid" });
    expect(body.waitForTimeout).toBe(500);
    expect(body.bestAttempt).toBe(true);
  });

  it("omits bestAttempt under strict mode", async () => {
    await scrape("https://example.com", { strict: true, waitFor: ".gone" });

    expect(lastBody().bestAttempt).toBeUndefined();
  });

  it("forwards the browser HTTP trio", async () => {
    await scrape("https://example.com", {
      headers: { "Accept-Language": "en-US" },
      userAgent: "MyBot/1.0",
      cookies: [{ name: "georedirect", value: "false", domain: ".example.com" }],
    });

    const body = lastBody();
    expect(body.setExtraHTTPHeaders).toEqual({ "Accept-Language": "en-US" });
    expect(body.userAgent).toBe("MyBot/1.0");
    expect(body.cookies).toEqual([{ name: "georedirect", value: "false", domain: ".example.com" }]);
  });
});
