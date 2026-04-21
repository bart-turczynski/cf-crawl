/**
 * toMarkdown command -- Workers AI /ai/tomarkdown endpoint.
 *
 * Accepts one or more LOCAL file paths (PDF, docx, images, html, etc.),
 * multipart-uploads them, and writes each returned markdown payload to its own
 * .md file. Live http(s) URLs are rejected -- users should use the `markdown`
 * command for those, or (future) a local HTML-to-markdown converter.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { Readable } from "node:stream";
import { cfFetchMultipart } from "../api-client.js";
import { WORKERS_AI_BASE } from "../config.js";
import { CrawlError } from "../errors.js";
import { saveText } from "../output.js";
import { timestamp } from "../utils.js";
import type { CfApiResponse, ToMarkdownResultItem } from "../types.js";

export async function tomarkdown(
  filePaths: string[],
): Promise<CfApiResponse<ToMarkdownResultItem[]>> {
  if (filePaths.length === 0) {
    throw new CrawlError("tomarkdown: at least one file path is required");
  }

  // Guardrail: live URLs are out of scope. Direct users to alternatives.
  const urlArg = filePaths.find((p) => /^https?:\/\//i.test(p));
  if (urlArg) {
    throw new CrawlError(
      `tomarkdown expects local file paths, not URLs. Got: "${urlArg}"\n` +
        `  For live webpages use: npm run markdown -- ${urlArg}\n` +
        `  (Converting live URLs via /ai/tomarkdown is intentionally not supported here.)`,
    );
  }

  // Validate every path exists before hitting the API
  const resolvedPaths: string[] = [];
  for (const p of filePaths) {
    const abs = resolve(p);
    const s = await stat(abs).catch(() => null);
    if (!s || !s.isFile()) {
      throw new CrawlError(`tomarkdown: file not found or not a regular file: "${p}"`);
    }
    resolvedPaths.push(abs);
  }

  console.log(`\nConverting ${resolvedPaths.length} file(s) to markdown via /ai/tomarkdown\n`);

  const form = new FormData();
  for (const abs of resolvedPaths) {
    const stream = Readable.toWeb(createReadStream(abs)) as unknown as ReadableStream;
    // `new Response(stream).blob()` is the standard way to turn a Node stream into a Blob
    // accepted by FormData/fetch (undici) without buffering in memory up-front.
    const blob = await new Response(stream).blob();
    form.append("files", blob, basename(abs));
  }

  const result = await cfFetchMultipart<ToMarkdownResultItem[]>(
    WORKERS_AI_BASE(),
    "/tomarkdown",
    form,
  );

  const items = result.result ?? [];
  console.log("=== Summary ===");
  for (const item of items) {
    if (item.error) {
      console.log(`  ✗ ${item.name ?? "(unnamed)"} — ${item.error}`);
    } else {
      console.log(
        `  ✓ ${item.name ?? "(unnamed)"} — ${item.data?.length ?? 0} chars${
          item.tokens != null ? `, ${item.tokens} tokens` : ""
        }`,
      );
    }
  }

  // Persist each successful conversion to its own .md file
  const ts = timestamp();
  for (const item of items) {
    if (!item.data) continue;
    const base = (item.name ?? "file").replace(/\s+/g, "_");
    const stem = base.slice(0, base.length - extname(base).length) || base;
    await saveText(`tomarkdown_${stem}_${ts}.md`, item.data);
  }

  return result;
}
