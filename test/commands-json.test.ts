import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../src/api-client.js", () => ({
  cfFetch: vi.fn(),
}));

vi.mock("../src/config.js", () => ({
  OUTPUT_DIR: "/tmp/cf-crawl-test-output",
}));

vi.mock("../src/output.js", () => ({
  ensureOutputDir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

const { json } = await import("../src/commands/json.js");
const { cfFetch } = (await import("../src/api-client.js")) as { cfFetch: Mock };
const fsPromises = (await import("node:fs/promises")) as unknown as {
  readFile: Mock;
  writeFile: Mock;
};
const { CrawlError } = await import("../src/errors.js");

describe("json command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("throws when prompt is missing or empty", async () => {
    await expect(json("https://example.com", { prompt: "" })).rejects.toBeInstanceOf(CrawlError);
    await expect(json("https://example.com", { prompt: "   " })).rejects.toBeInstanceOf(CrawlError);
  });

  it("posts prompt only when no schema is given", async () => {
    cfFetch.mockResolvedValueOnce({ success: true, result: { title: "Hi" } });

    await json("https://example.com", { prompt: "extract title" });

    expect(cfFetch).toHaveBeenCalledWith(
      "/json",
      expect.objectContaining({
        method: "POST",
        body: expect.any(String),
      }),
    );
    const body = JSON.parse((cfFetch.mock.calls[0][1] as { body: string }).body);
    expect(body.url).toBe("https://example.com/");
    expect(body.prompt).toBe("extract title");
    expect(body.response_format).toBeUndefined();
  });

  it("reads schema file and wraps it as response_format when --schema is given", async () => {
    const schema = { type: "object", properties: { title: { type: "string" } } };
    fsPromises.readFile.mockResolvedValueOnce(JSON.stringify(schema));
    cfFetch.mockResolvedValueOnce({ success: true, result: { title: "Hi" } });

    await json("https://example.com", {
      prompt: "extract title",
      schemaPath: "./schema.json",
    });

    expect(fsPromises.readFile).toHaveBeenCalledWith("./schema.json", "utf8");
    const body = JSON.parse((cfFetch.mock.calls[0][1] as { body: string }).body);
    expect(body.response_format).toEqual({ type: "json_schema", json_schema: schema });
  });

  it("throws a CrawlError on invalid schema JSON", async () => {
    fsPromises.readFile.mockResolvedValueOnce("{not valid json");
    await expect(
      json("https://example.com", { prompt: "x", schemaPath: "./bad.json" }),
    ).rejects.toBeInstanceOf(CrawlError);
  });
});
