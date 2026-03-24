/**
 * Job log -- JSONL file tracking all crawl jobs.
 */

import { writeFile, readFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { OUTPUT_DIR } from "./config.js";
import { ensureOutputDir } from "./output.js";
import type { JobEntry } from "./types.js";

const JOBS_FILE = join(OUTPUT_DIR, "jobs.jsonl");

export async function logJob(entry: JobEntry): Promise<void> {
  await ensureOutputDir();
  await appendFile(JOBS_FILE, JSON.stringify(entry) + "\n");
}

export async function readJobLog(): Promise<JobEntry[]> {
  try {
    const raw = await readFile(JOBS_FILE, "utf-8");
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as JobEntry);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

// Note: read-modify-write without locking. Concurrent calls (e.g. SIGINT
// racing with poll loop) can lose updates. Acceptable for a CLI tool.
export async function updateJobLog(jobId: string, updates: Partial<JobEntry>): Promise<void> {
  const entries = await readJobLog();
  let found = false;
  const updated = entries.map((e) => {
    if (e.jobId === jobId) {
      found = true;
      return { ...e, ...updates, updatedAt: new Date().toISOString() };
    }
    return e;
  });
  if (!found) {
    updated.push({ jobId, ...updates, updatedAt: new Date().toISOString() } as JobEntry);
  }
  await writeFile(JOBS_FILE, updated.map((e) => JSON.stringify(e)).join("\n") + "\n");
}
