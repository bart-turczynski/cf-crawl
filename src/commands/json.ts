/**
 * JSON command -- /json endpoint (synchronous, AI-extracted structured data).
 *
 * Sends a prompt (required) and optional JSON schema. When a schema is provided,
 * it's passed as response_format: { type: "json_schema", json_schema: <schema> }.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeUrl, timestamp, urlSlug } from "../utils.js";
import { cfFetch } from "../api-client.js";
import { ensureOutputDir } from "../output.js";
import { OUTPUT_DIR } from "../config.js";
import { CrawlError } from "../errors.js";
import type { CfApiResponse } from "../types.js";

export interface JsonCommandOptions {
  prompt: string;
  schemaPath?: string;
}

export async function json(
  targetUrl: string,
  opts: JsonCommandOptions,
): Promise<CfApiResponse<unknown>> {
  if (!opts.prompt || opts.prompt.trim().length === 0) {
    throw new CrawlError("--prompt is required for `json`");
  }

  const url = normalizeUrl(targetUrl);
  console.log(`\nExtracting structured data: ${url}`);
  console.log(`  prompt: ${opts.prompt}`);

  const body: Record<string, unknown> = { url, prompt: opts.prompt };

  if (opts.schemaPath) {
    const raw = await readFile(opts.schemaPath, "utf8");
    let schema: unknown;
    try {
      schema = JSON.parse(raw);
    } catch (err) {
      throw new CrawlError(
        `Invalid JSON schema file "${opts.schemaPath}": ${(err as Error).message}`,
      );
    }
    body.response_format = { type: "json_schema", json_schema: schema };
    console.log(`  schema: ${opts.schemaPath}`);
  }
  console.log();

  const result = await cfFetch<unknown>("/json", {
    method: "POST",
    body: JSON.stringify(body),
  });

  await ensureOutputDir();
  const filename = `json_${urlSlug(url)}_${timestamp()}.json`;
  const filepath = join(OUTPUT_DIR, filename);
  await writeFile(filepath, JSON.stringify(result, null, 2));
  console.log(`Saved: ${filepath}`);

  return result;
}
