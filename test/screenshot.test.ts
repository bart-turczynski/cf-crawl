import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../src/api-client.js", () => ({
  cfFetchBinary: vi.fn(),
}));

vi.mock("../src/config.js", () => ({
  OUTPUT_DIR: "/tmp/cf-crawl-test-output",
}));

vi.mock("../src/output.js", () => ({
  saveBinary: vi.fn().mockResolvedValue("/tmp/cf-crawl-test-output/out.png"),
}));

vi.mock("../src/output-log.js", () => ({
  logOutputUrl: vi.fn(() => Promise.resolve()),
}));

const { screenshot } = await import("../src/commands/screenshot.js");
const { cfFetchBinary } = (await import("../src/api-client.js")) as { cfFetchBinary: Mock };

function lastBody(): Record<string, unknown> {
  const call = cfFetchBinary.mock.calls.at(-1) as [string, { body: string }];
  return JSON.parse(call[1].body) as Record<string, unknown>;
}

describe("screenshot command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    cfFetchBinary.mockResolvedValue({ result: Buffer.from("png") });
  });

  it("sends only the url by default", async () => {
    await screenshot("https://example.com");

    const body = lastBody();
    expect(body.url).toBe("https://example.com/");
    expect(body.screenshotOptions).toBeUndefined();
  });

  it("nests fullPage inside screenshotOptions", async () => {
    await screenshot("https://example.com", { fullPage: true });

    const body = lastBody();
    // Top-level fullPage is rejected by /screenshot with "Unrecognized key".
    expect(body.fullPage).toBeUndefined();
    expect(body.screenshotOptions).toEqual({ fullPage: true });
  });

  it("nests a non-png format as screenshotOptions.type", async () => {
    await screenshot("https://example.com", { format: "jpeg" });

    expect(lastBody().screenshotOptions).toEqual({ type: "jpeg" });
  });

  it("combines fullPage and format in one screenshotOptions object", async () => {
    await screenshot("https://example.com", { fullPage: true, format: "webp" });

    expect(lastBody().screenshotOptions).toEqual({ fullPage: true, type: "webp" });
  });
});
