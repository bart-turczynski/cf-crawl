/**
 * Export command -- convert a saved crawl result file into CSV.
 *
 * Local-only: reads a `.json` or `.jsonl` file already on disk and writes a
 * sibling `.csv`. No Cloudflare API call, so no credentials are required.
 *
 * `.jsonl` input is streamed line by line and rows are written as they are
 * read, so memory stays bounded on multi-gigabyte crawl dumps. Row order
 * follows the input; nothing is buffered to sort.
 */

import { createReadStream, createWriteStream } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { createInterface } from "node:readline";
import { extname } from "node:path";
import { UsageError } from "../errors.js";
import { streamWrite } from "../output.js";
import type { CrawlRecord, CrawlRecordMetadata, ExportOptions, ExportSummary } from "../types.js";

const COLUMNS = ["url", "status", "httpStatus", "title", "lastModified"] as const;

/** RFC 4180: a field needs quoting when it holds a quote, comma, or newline. */
const NEEDS_QUOTING_RE = /["\r\n,]/;

function csvField(value: string): string {
  return NEEDS_QUOTING_RE.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function csvLine(fields: readonly string[]): string {
  return `${fields.map(csvField).join(",")}\n`;
}

function str(value: unknown): string {
  return value == null ? "" : String(value);
}

/**
 * Flatten one crawl record into a CSV row.
 *
 * `record.status` is the crawl outcome (`completed`, `errored`, `skipped`,
 * `queued`); the HTTP status and page title live one level down in
 * `record.metadata`.
 */
function toRow(record: CrawlRecord): string[] {
  const metadata: CrawlRecordMetadata = (record.metadata as CrawlRecordMetadata) ?? {};
  return [
    str(record.url),
    str(record.status),
    str(metadata.status),
    str(metadata.title),
    str(metadata.lastModified),
  ];
}

/** Default output path: the input path with its extension swapped for `.csv`. */
export function defaultOutputPath(inputPath: string): string {
  const ext = extname(inputPath);
  return ext ? `${inputPath.slice(0, -ext.length)}.csv` : `${inputPath}.csv`;
}

function extractRecords(parsed: unknown, inputPath: string): CrawlRecord[] {
  if (Array.isArray(parsed)) return parsed as CrawlRecord[];
  const records = (parsed as { result?: { records?: unknown } })?.result?.records;
  if (Array.isArray(records)) return records as CrawlRecord[];
  throw new UsageError(
    `"${inputPath}" is not a crawl result file (no \`result.records\` array found).`,
  );
}

export async function exportCsv(
  inputPath: string,
  options: ExportOptions = {},
): Promise<ExportSummary> {
  const ext = extname(inputPath).toLowerCase();
  if (ext !== ".json" && ext !== ".jsonl") {
    throw new UsageError(
      `Unsupported input "${inputPath}": expected a .json or .jsonl crawl result file.`,
    );
  }

  const outputPath = options.out ?? defaultOutputPath(inputPath);
  if (outputPath === inputPath) {
    throw new UsageError("--out must differ from the input file.");
  }

  // Whole-file formats are read and validated before the output stream opens,
  // so a bad input never leaves a stray CSV behind.
  const eagerRecords = ext === ".json" ? await readJsonRecords(inputPath) : null;

  const statuses = options.statuses?.length ? new Set(options.statuses) : null;

  const ws = createWriteStream(outputPath);
  const finished = new Promise<void>((resolve, reject) => {
    ws.on("error", reject);
    ws.on("finish", resolve);
  });

  let rowCount = 0;
  let skipped = 0;
  let malformed = 0;

  const writeRecord = async (record: CrawlRecord): Promise<void> => {
    if (statuses && !statuses.has(str(record.status))) {
      skipped++;
      return;
    }
    await streamWrite(ws, csvLine(toRow(record)));
    rowCount++;
  };

  try {
    await streamWrite(ws, csvLine(COLUMNS));

    if (eagerRecords) {
      for (const record of eagerRecords) {
        await writeRecord(record);
      }
    } else {
      malformed = await streamJsonl(inputPath, writeRecord);
    }
  } catch (err) {
    // destroy() surfaces any in-flight write as a stream error; claim it so it
    // does not escape as an unhandled rejection, then discard the partial file.
    finished.catch(() => {});
    ws.destroy();
    await rm(outputPath, { force: true }).catch(() => {});
    throw err;
  }

  ws.end();
  await finished;

  console.log(`Saved: ${outputPath}`);
  console.log(`  ${rowCount.toLocaleString()} row(s) written`);
  if (skipped > 0) console.log(`  ${skipped.toLocaleString()} record(s) filtered out by --status`);
  if (malformed > 0) console.log(`  ${malformed.toLocaleString()} unparsable line(s) skipped`);

  return { outputPath, rowCount, skipped, malformed };
}

/** Read, parse, and unwrap a whole `.json` crawl result file. */
async function readJsonRecords(inputPath: string): Promise<CrawlRecord[]> {
  const raw = await readInput(inputPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new UsageError(`Failed to parse "${inputPath}": ${(err as Error).message}`);
  }
  return extractRecords(parsed, inputPath);
}

async function readInput(inputPath: string): Promise<string> {
  try {
    return await readFile(inputPath, "utf8");
  } catch (err) {
    throw new UsageError(`Failed to read "${inputPath}": ${(err as Error).message}`);
  }
}

/** Stream a JSONL file, invoking `onRecord` per line. Returns the unparsable-line count. */
async function streamJsonl(
  inputPath: string,
  onRecord: (record: CrawlRecord) => Promise<void>,
): Promise<number> {
  const lines = createInterface({
    input: createReadStream(inputPath, "utf8"),
    crlfDelay: Infinity,
  });

  let malformed = 0;
  try {
    for await (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let record: CrawlRecord;
      try {
        record = JSON.parse(trimmed) as CrawlRecord;
      } catch {
        malformed++;
        continue;
      }
      await onRecord(record);
    }
  } catch (err) {
    throw new UsageError(`Failed to read "${inputPath}": ${(err as Error).message}`);
  } finally {
    lines.close();
  }

  return malformed;
}
