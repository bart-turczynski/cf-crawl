/**
 * Jobs command — list all logged jobs.
 */

import { readJobLog } from "../job-log.js";

export async function listJobs() {
  const entries = await readJobLog();
  if (entries.length === 0) {
    console.log("\nNo jobs logged yet.");
    return;
  }

  console.log(`\n${"Job ID".padEnd(38)} ${"URL".padEnd(35)} ${"Status".padEnd(14)} ${"Pages".padEnd(8)} Started`);
  console.log("-".repeat(115));
  for (const e of entries) {
    const id = e.jobId ?? "?";
    const url = (e.url ?? "?").slice(0, 33);
    const st = e.status ?? "?";
    const pages = e.finished != null ? String(e.finished) : "-";
    const started = e.startedAt ? e.startedAt.slice(0, 19).replace("T", " ") : "?";
    console.log(`${id.padEnd(38)} ${url.padEnd(35)} ${st.padEnd(14)} ${pages.padEnd(8)} ${started}`);
  }
  console.log(`\n${entries.length} job(s) total.`);
}
