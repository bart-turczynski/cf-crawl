/**
 * Output file handling with cached mkdir and streaming writers.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { createWriteStream, type WriteStream } from "node:fs";
import { join } from "node:path";
import { OUTPUT_DIR } from "./config.js";
import type {
  CfApiResponse,
  CrawlResult,
  CrawlRecord,
  OutputFormat,
  ResultWriter,
} from "./types.js";

// One-time mkdir -- caches the promise so subsequent calls are free
let mkdirPromise: Promise<string | undefined> | null = null;

export function ensureOutputDir(): Promise<string | undefined> {
  if (!mkdirPromise) {
    mkdirPromise = mkdir(OUTPUT_DIR, { recursive: true });
  }
  return mkdirPromise;
}

export async function saveResult(
  filename: string,
  data: CfApiResponse<CrawlResult>,
): Promise<string> {
  await ensureOutputDir();
  const filepath = join(OUTPUT_DIR, filename);

  // For large results with many records, stream JSON to avoid string length limits
  const records = data.result?.records;
  if (records && records.length > 500) {
    const meta = { ...data, result: { ...data.result } };
    delete meta.result.records;

    await new Promise<void>((resolve, reject) => {
      const ws = createWriteStream(filepath);
      ws.on("error", reject);
      ws.on("finish", resolve);

      // Build JSON structure explicitly to avoid string-splice errors
      const { result: resultObj, ...rootRest } = meta;

      ws.write(`{\n`);

      // Write root-level keys (success, errors, etc.)
      const rootKeys = Object.entries(rootRest);
      for (let k = 0; k < rootKeys.length; k++) {
        const [key, val] = rootKeys[k];
        ws.write(
          `  ${JSON.stringify(key)}: ${JSON.stringify(val)}${k < rootKeys.length - 1 ? "," : ","}\n`,
        );
      }

      // Open result object
      ws.write(`  "result": {\n`);

      // Write result-level keys (status, finished, skipped, etc.)
      const resultKeys = Object.entries(resultObj);
      for (let k = 0; k < resultKeys.length; k++) {
        const [key, val] = resultKeys[k];
        ws.write(`    ${JSON.stringify(key)}: ${JSON.stringify(val)},\n`);
      }

      // Stream records array
      ws.write(`    "records": [\n`);
      for (let i = 0; i < records.length; i++) {
        const comma = i < records.length - 1 ? "," : "";
        ws.write(`      ${JSON.stringify(records[i])}${comma}\n`);
      }
      ws.write(`    ]\n`);

      // Close result object and root object
      ws.write(`  }\n}\n`);
      ws.end();
    });
  } else {
    await writeFile(filepath, JSON.stringify(data, null, 2));
  }

  console.log(`Saved: ${filepath}`);
  return filepath;
}

// ---------------------------------------------------------------------------
// Streaming writers -- write records to disk incrementally during pagination
// ---------------------------------------------------------------------------

/** Wait for a writable stream to drain before writing more data. */
function waitForDrain(ws: WriteStream): Promise<void> {
  return new Promise((resolve) => ws.once("drain", resolve));
}

/** Write a string to a stream, awaiting drain if backpressured. */
async function streamWrite(ws: WriteStream, chunk: string): Promise<void> {
  const ok = ws.write(chunk);
  if (!ok) await waitForDrain(ws);
}

/**
 * Streams crawl records to a JSON file incrementally.
 *
 * Writes the same JSON structure as `saveResult` but accepts records in
 * batches via `writeRecords()` so the full dataset never lives in memory.
 */
export class StreamingJsonWriter implements ResultWriter {
  private ws: WriteStream | null = null;
  private filepath: string;
  private _recordCount = 0;
  private firstRecord = true;
  private metadata: Record<string, unknown>;

  constructor(
    filename: string,
    metadata: Omit<CfApiResponse<CrawlResult>, "result"> & {
      result: Omit<CrawlResult, "records">;
    },
  ) {
    this.filepath = join(OUTPUT_DIR, filename);
    this.metadata = metadata as Record<string, unknown>;
  }

  get recordCount(): number {
    return this._recordCount;
  }

  async open(): Promise<void> {
    await ensureOutputDir();
    this.ws = createWriteStream(this.filepath);

    const { result: resultObj, ...rootRest } = this.metadata;

    await streamWrite(this.ws, `{\n`);

    // Write root-level keys (success, errors, etc.)
    const rootKeys = Object.entries(rootRest);
    for (let k = 0; k < rootKeys.length; k++) {
      await streamWrite(
        this.ws,
        `  ${JSON.stringify(rootKeys[k][0])}: ${JSON.stringify(rootKeys[k][1])},\n`,
      );
    }

    // Open result object
    await streamWrite(this.ws, `  "result": {\n`);

    // Write result-level keys (status, finished, skipped, etc.)
    const resultKeys = Object.entries(resultObj as Record<string, unknown>);
    for (let k = 0; k < resultKeys.length; k++) {
      await streamWrite(
        this.ws,
        `    ${JSON.stringify(resultKeys[k][0])}: ${JSON.stringify(resultKeys[k][1])},\n`,
      );
    }

    // Open records array
    await streamWrite(this.ws, `    "records": [\n`);
  }

  async writeRecords(records: CrawlRecord[]): Promise<void> {
    if (!this.ws) throw new Error("Writer not opened. Call open() first.");
    for (const record of records) {
      const prefix = this.firstRecord ? "" : ",\n";
      this.firstRecord = false;
      await streamWrite(this.ws, `${prefix}      ${JSON.stringify(record)}`);
      this._recordCount++;
    }
  }

  async close(): Promise<string> {
    if (!this.ws) throw new Error("Writer not opened. Call open() first.");

    // Close records array, result object, root object
    await streamWrite(this.ws, `\n    ]\n  }\n}\n`);

    await new Promise<void>((resolve, reject) => {
      this.ws!.on("error", reject);
      this.ws!.on("finish", resolve);
      this.ws!.end();
    });

    console.log(`Saved: ${this.filepath}`);
    return this.filepath;
  }
}

/**
 * Streams crawl records to a JSONL file (one JSON object per line).
 *
 * More suitable for large datasets and streaming processing pipelines.
 * Each line is a self-contained JSON object representing one crawl record.
 */
export class StreamingJsonlWriter implements ResultWriter {
  private ws: WriteStream | null = null;
  private filepath: string;
  private _recordCount = 0;

  constructor(filename: string) {
    this.filepath = join(OUTPUT_DIR, filename);
  }

  get recordCount(): number {
    return this._recordCount;
  }

  async open(): Promise<void> {
    await ensureOutputDir();
    this.ws = createWriteStream(this.filepath);
  }

  async writeRecords(records: CrawlRecord[]): Promise<void> {
    if (!this.ws) throw new Error("Writer not opened. Call open() first.");
    for (const record of records) {
      await streamWrite(this.ws, `${JSON.stringify(record)}\n`);
      this._recordCount++;
    }
  }

  async close(): Promise<string> {
    if (!this.ws) throw new Error("Writer not opened. Call open() first.");

    await new Promise<void>((resolve, reject) => {
      this.ws!.on("error", reject);
      this.ws!.on("finish", resolve);
      this.ws!.end();
    });

    console.log(`Saved: ${this.filepath}`);
    return this.filepath;
  }
}

/** Create the appropriate streaming writer based on format. */
export function createResultWriter(
  filename: string,
  format: OutputFormat,
  metadata: Omit<CfApiResponse<CrawlResult>, "result"> & {
    result: Omit<CrawlResult, "records">;
  },
): ResultWriter {
  if (format === "jsonl") {
    return new StreamingJsonlWriter(filename.replace(/\.json$/, ".jsonl"));
  }
  return new StreamingJsonWriter(filename, metadata);
}
