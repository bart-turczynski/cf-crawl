/**
 * Read URLs from a text-based input file.
 *
 * Format-agnostic: csv, tsv, txt — any UTF-8 file works. One URL per line.
 * Tokens are split on whitespace, commas, semicolons, and quotes; the first
 * URL-like token per line is taken. Lines without a URL-like token (e.g.
 * CSV header rows) are skipped silently. Blank lines and lines starting with
 * `#` are skipped.
 */

import { readFile } from "node:fs/promises";
import { UsageError } from "./errors.js";

const URL_PROTOCOL_RE = /^https?:\/\/\S+$/i;
const BARE_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+(?:\/\S*)?$/i;
const TOKEN_SPLIT_RE = /[\s,;"']+/;

function extractUrlFromLine(line: string): string | null {
  for (const token of line.split(TOKEN_SPLIT_RE)) {
    if (!token) continue;
    if (URL_PROTOCOL_RE.test(token) || BARE_DOMAIN_RE.test(token)) {
      return token;
    }
  }
  return null;
}

export async function readUrlsFromFile(path: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    throw new UsageError(`Failed to read --input file "${path}": ${(err as Error).message}`);
  }

  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

  const urls: string[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const url = extractUrlFromLine(line);
    if (url) urls.push(url);
  }

  return urls;
}
