/**
 * Job log -- JSONL file tracking all crawl jobs.
 */

import { readFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { OUTPUT_DIR } from "./config.js";
import { ensureOutputDir } from "./output.js";
import type { JobEntry, JobLogEvent } from "./types.js";

const JOBS_FILE = join(OUTPUT_DIR, "jobs.jsonl");

export async function logJob(entry: JobEntry): Promise<void> {
  await appendJobEvent(entry);
}

async function appendJobEvent(event: JobLogEvent): Promise<void> {
  await ensureOutputDir();
  await appendFile(JOBS_FILE, JSON.stringify(event) + "\n");
}

export async function readJobLog(): Promise<JobEntry[]> {
  try {
    const raw = await readFile(JOBS_FILE, "utf-8");
    const events = raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as JobLogEvent);

    const entriesByJobId = new Map<string, JobEntry>();
    for (const event of events) {
      const current = entriesByJobId.get(event.jobId) ?? { jobId: event.jobId };
      entriesByJobId.set(event.jobId, { ...current, ...event });
    }

    return [...entriesByJobId.values()];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function updateJobLog(jobId: string, updates: Partial<JobEntry>): Promise<void> {
  await appendJobEvent({ jobId, ...updates, updatedAt: new Date().toISOString() });
}
