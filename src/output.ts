/**
 * Output file handling with cached mkdir.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { OUTPUT_DIR } from "./config.js";
import type { CfApiResponse, CrawlResult } from "./types.js";

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
