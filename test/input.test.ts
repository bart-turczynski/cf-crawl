import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readUrlsFromFile } from "../src/input.js";
import { UsageError } from "../src/errors.js";

describe("readUrlsFromFile", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cf-crawl-input-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeFixture(name: string, contents: string): Promise<string> {
    const path = join(dir, name);
    await writeFile(path, contents, "utf8");
    return path;
  }

  it("reads plain text with one URL per line", async () => {
    const path = await writeFixture("urls.txt", "https://example.com\nhttps://example.org\n");
    expect(await readUrlsFromFile(path)).toEqual(["https://example.com", "https://example.org"]);
  });

  it("skips blank lines and comments", async () => {
    const path = await writeFixture(
      "urls.txt",
      "\n# this is a comment\nhttps://a.com\n\n# another\nhttps://b.com\n",
    );
    expect(await readUrlsFromFile(path)).toEqual(["https://a.com", "https://b.com"]);
  });

  it("strips a UTF-8 BOM from the first line", async () => {
    const path = await writeFixture("urls.txt", "﻿https://example.com\n");
    expect(await readUrlsFromFile(path)).toEqual(["https://example.com"]);
  });

  it("handles CRLF line endings", async () => {
    const path = await writeFixture("urls.txt", "https://a.com\r\nhttps://b.com\r\n");
    expect(await readUrlsFromFile(path)).toEqual(["https://a.com", "https://b.com"]);
  });

  it("accepts bare domains as URLs", async () => {
    const path = await writeFixture("urls.txt", "example.com\nsub.example.org/path\n");
    expect(await readUrlsFromFile(path)).toEqual(["example.com", "sub.example.org/path"]);
  });

  it("extracts the URL from a CSV with a header row", async () => {
    const path = await writeFixture(
      "urls.csv",
      "URL,Title,Status\nhttps://example.com,Home,200\nhttps://example.org,About,200\n",
    );
    expect(await readUrlsFromFile(path)).toEqual(["https://example.com", "https://example.org"]);
  });

  it("extracts the URL from a non-first CSV column", async () => {
    const path = await writeFixture(
      "urls.csv",
      "Title,URL,Status\nHome,https://example.com,200\nAbout,https://example.org,200\n",
    );
    expect(await readUrlsFromFile(path)).toEqual(["https://example.com", "https://example.org"]);
  });

  it("extracts URLs from a TSV", async () => {
    const path = await writeFixture(
      "urls.tsv",
      "URL\tStatus\nhttps://example.com\t200\nhttps://example.org\t200\n",
    );
    expect(await readUrlsFromFile(path)).toEqual(["https://example.com", "https://example.org"]);
  });

  it("handles quoted CSV cells", async () => {
    const path = await writeFixture(
      "urls.csv",
      'URL,Title\n"https://example.com","Hello, world"\n',
    );
    expect(await readUrlsFromFile(path)).toEqual(["https://example.com"]);
  });

  it("returns an empty array for a header-only file", async () => {
    const path = await writeFixture("urls.csv", "URL,Title,Status\n");
    expect(await readUrlsFromFile(path)).toEqual([]);
  });

  it("returns an empty array for an empty file", async () => {
    const path = await writeFixture("empty.txt", "");
    expect(await readUrlsFromFile(path)).toEqual([]);
  });

  it("throws a UsageError for a missing file", async () => {
    await expect(readUrlsFromFile(join(dir, "does-not-exist.txt"))).rejects.toThrow(UsageError);
  });
});
