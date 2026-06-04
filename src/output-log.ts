/**
 * Output URL manifest -- append-only JSONL trail of sync-command outputs.
 *
 * Sync single-page commands encode the URL into the filename via the lossy
 * `urlSlug()` (`.`, `/`, `?`, `=`, `&`, `#` all collapse to `_`), so the
 * original URL can't be reconstructed from the filename. JSON outputs also
 * embed a top-level `url`, but text (markdown, content) and binary (pdf,
 * screenshot) outputs have nowhere to put it. This sidecar manifest gives a
 * uniform, non-invasive URL trail for every output type, mirroring how
 * `jobs.jsonl` tracks async crawl seeds.
 */

import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { OUTPUT_DIR } from "./config.js";
import { ensureOutputDir } from "./output.js";
import type { OutputUrlEntry } from "./types.js";

const URLS_FILE = join(OUTPUT_DIR, "urls.jsonl");

export async function logOutputUrl(entry: OutputUrlEntry): Promise<void> {
  await ensureOutputDir();
  await appendFile(URLS_FILE, JSON.stringify(entry) + "\n");
}
