import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportCsv, defaultOutputPath } from "../src/commands/export.js";
import { UsageError } from "../src/errors.js";

describe("exportCsv", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cf-crawl-export-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  async function writeFixture(name: string, contents: string): Promise<string> {
    const path = join(dir, name);
    await writeFile(path, contents, "utf8");
    return path;
  }

  function jsonl(...records: unknown[]): string {
    return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  }

  const record = (url: string, status: string, metadata: Record<string, unknown> = {}) => ({
    url,
    status,
    metadata,
    html: "<html></html>",
  });

  it("writes a header row and one row per record", async () => {
    const path = await writeFixture(
      "crawl.jsonl",
      jsonl(
        record("https://a.com/", "completed", { status: 200, title: "A", lastModified: "" }),
        record("https://b.com/", "errored", { status: 403, title: "B", lastModified: "" }),
      ),
    );

    const summary = await exportCsv(path);

    expect(summary.rowCount).toBe(2);
    expect(await readFile(summary.outputPath, "utf8")).toBe(
      "url,status,httpStatus,title,lastModified\n" +
        "https://a.com/,completed,200,A,\n" +
        "https://b.com/,errored,403,B,\n",
    );
  });

  // The Python predecessor read `title` from the top level, where it never
  // exists, so every exported title was blank.
  it("reads title and httpStatus from metadata, not the record root", async () => {
    const path = await writeFixture(
      "crawl.jsonl",
      jsonl(record("https://a.com/", "completed", { status: 200, title: "Real Title" })),
    );

    await exportCsv(path);

    const csv = await readFile(join(dir, "crawl.csv"), "utf8");
    expect(csv).toContain("https://a.com/,completed,200,Real Title,");
  });

  it("quotes fields containing commas, quotes, or newlines", async () => {
    const path = await writeFixture(
      "crawl.jsonl",
      jsonl(
        record("https://a.com/", "completed", { title: 'Guides, tips & "tricks"' }),
        record("https://b.com/", "completed", { title: "Line one\nLine two" }),
      ),
    );

    await exportCsv(path);

    const rows = (await readFile(join(dir, "crawl.csv"), "utf8")).split("\n");
    expect(rows[1]).toBe('https://a.com/,completed,,"Guides, tips & ""tricks""",');
    expect(rows[2]).toBe('https://b.com/,completed,,"Line one');
    expect(rows[3]).toBe('Line two",');
  });

  it("fills empty columns when metadata is missing entirely", async () => {
    const path = await writeFixture("crawl.jsonl", jsonl({ url: "https://a.com/" }));

    await exportCsv(path);

    expect(await readFile(join(dir, "crawl.csv"), "utf8")).toBe(
      "url,status,httpStatus,title,lastModified\nhttps://a.com/,,,,\n",
    );
  });

  it("keeps only the requested statuses and counts the rest", async () => {
    const path = await writeFixture(
      "crawl.jsonl",
      jsonl(
        record("https://a.com/", "completed"),
        record("https://b.com/", "errored"),
        record("https://c.com/", "skipped"),
        record("https://d.com/", "errored"),
      ),
    );

    const summary = await exportCsv(path, { statuses: ["errored"] });

    expect(summary.rowCount).toBe(2);
    expect(summary.skipped).toBe(2);
    const csv = await readFile(summary.outputPath, "utf8");
    expect(csv).toContain("https://b.com/");
    expect(csv).toContain("https://d.com/");
    expect(csv).not.toContain("https://a.com/");
  });

  it("accepts multiple --status values", async () => {
    const path = await writeFixture(
      "crawl.jsonl",
      jsonl(
        record("https://a.com/", "completed"),
        record("https://b.com/", "errored"),
        record("https://c.com/", "queued"),
      ),
    );

    const summary = await exportCsv(path, { statuses: ["errored", "queued"] });

    expect(summary.rowCount).toBe(2);
    expect(summary.skipped).toBe(1);
  });

  it("skips blank and unparsable JSONL lines, reporting the count", async () => {
    const path = await writeFixture(
      "crawl.jsonl",
      `${JSON.stringify(record("https://a.com/", "completed"))}\n\nnot json\n{"broken":\n`,
    );

    const summary = await exportCsv(path);

    expect(summary.rowCount).toBe(1);
    expect(summary.malformed).toBe(2);
  });

  it("handles CRLF line endings", async () => {
    const path = await writeFixture(
      "crawl.jsonl",
      `${JSON.stringify(record("https://a.com/", "completed"))}\r\n${JSON.stringify(
        record("https://b.com/", "completed"),
      )}\r\n`,
    );

    expect((await exportCsv(path)).rowCount).toBe(2);
  });

  it("reads records out of a crawl JSON envelope", async () => {
    const path = await writeFixture(
      "crawl.json",
      JSON.stringify({
        success: true,
        result: {
          status: "completed",
          records: [record("https://a.com/", "completed", { status: 200, title: "A" })],
        },
      }),
    );

    const summary = await exportCsv(path);

    expect(summary.outputPath).toBe(join(dir, "crawl.csv"));
    expect(await readFile(summary.outputPath, "utf8")).toContain("https://a.com/,completed,200,A,");
  });

  it("accepts a bare JSON array of records", async () => {
    const path = await writeFixture(
      "crawl.json",
      JSON.stringify([record("https://a.com/", "completed")]),
    );

    expect((await exportCsv(path)).rowCount).toBe(1);
  });

  it("rejects JSON without a records array", async () => {
    const path = await writeFixture("crawl.json", JSON.stringify({ success: true, result: {} }));

    await expect(exportCsv(path)).rejects.toThrow(UsageError);
    await expect(exportCsv(path)).rejects.toThrow(/not a crawl result file/);
  });

  it("rejects malformed JSON input", async () => {
    const path = await writeFixture("crawl.json", "{ not json");

    await expect(exportCsv(path)).rejects.toThrow(UsageError);
    await expect(exportCsv(path)).rejects.toThrow(/Failed to parse/);
  });

  it("leaves no output file behind when the input cannot be parsed", async () => {
    const path = await writeFixture("crawl.json", "{ not json");

    await expect(exportCsv(path)).rejects.toThrow(UsageError);
    await expect(readFile(join(dir, "crawl.csv"), "utf8")).rejects.toThrow(/ENOENT/);
  });

  it("rejects unsupported file extensions", async () => {
    const path = await writeFixture("crawl.csv", "url\n");

    await expect(exportCsv(path)).rejects.toThrow(UsageError);
    await expect(exportCsv(path)).rejects.toThrow(/expected a .json or .jsonl/);
  });

  it("rejects a missing input file", async () => {
    await expect(exportCsv(join(dir, "absent.jsonl"))).rejects.toThrow(UsageError);
    await expect(exportCsv(join(dir, "absent.json"))).rejects.toThrow(/Failed to read/);
  });

  it("refuses to overwrite its own input", async () => {
    const path = await writeFixture("crawl.jsonl", jsonl(record("https://a.com/", "completed")));

    await expect(exportCsv(path, { out: path })).rejects.toThrow(/--out must differ/);
  });

  it("honors an explicit --out path", async () => {
    const path = await writeFixture("crawl.jsonl", jsonl(record("https://a.com/", "completed")));
    const out = join(dir, "nested-name.csv");

    const summary = await exportCsv(path, { out });

    expect(summary.outputPath).toBe(out);
    expect(await readFile(out, "utf8")).toContain("https://a.com/");
  });

  it("emits a header-only file for an empty input", async () => {
    const path = await writeFixture("crawl.jsonl", "");

    const summary = await exportCsv(path);

    expect(summary.rowCount).toBe(0);
    expect(await readFile(summary.outputPath, "utf8")).toBe(
      "url,status,httpStatus,title,lastModified\n",
    );
  });
});

describe("defaultOutputPath", () => {
  it("swaps a known extension for .csv", () => {
    expect(defaultOutputPath("/out/crawl.jsonl")).toBe("/out/crawl.csv");
    expect(defaultOutputPath("/out/crawl.json")).toBe("/out/crawl.csv");
  });

  it("appends .csv when there is no extension", () => {
    expect(defaultOutputPath("/out/crawl")).toBe("/out/crawl.csv");
  });

  it("preserves dots in the directory and stem", () => {
    expect(defaultOutputPath("/out/crawl_example.com_abc.jsonl")).toBe(
      "/out/crawl_example.com_abc.csv",
    );
  });
});
