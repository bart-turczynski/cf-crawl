/**
 * Output file handling with cached mkdir.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { OUTPUT_DIR } from "./config.js";

// One-time mkdir — caches the promise so subsequent calls are free
let mkdirPromise = null;

export function ensureOutputDir() {
  if (!mkdirPromise) {
    mkdirPromise = mkdir(OUTPUT_DIR, { recursive: true });
  }
  return mkdirPromise;
}

export async function saveResult(filename, data) {
  await ensureOutputDir();
  const filepath = join(OUTPUT_DIR, filename);

  // For large results with many records, stream JSON to avoid string length limits
  const records = data.result?.records;
  if (records && records.length > 500) {
    const { createWriteStream } = await import("node:fs");
    const meta = { ...data, result: { ...data.result } };
    delete meta.result.records;

    await new Promise((resolve, reject) => {
      const ws = createWriteStream(filepath);
      ws.on("error", reject);
      ws.on("finish", resolve);

      // Write opening structure
      const metaJson = JSON.stringify(meta, null, 2);
      // Insert records array before the closing braces
      const insertPoint = metaJson.lastIndexOf("}");
      const before = metaJson.slice(0, insertPoint);
      ws.write(before);
      ws.write(`  "records": [\n`);

      for (let i = 0; i < records.length; i++) {
        const comma = i < records.length - 1 ? "," : "";
        ws.write(`    ${JSON.stringify(records[i])}${comma}\n`);
      }

      ws.write(`  ]\n`);
      // Close result object and root object
      ws.write(`  }\n}`);
      ws.end();
    });
  } else {
    await writeFile(filepath, JSON.stringify(data, null, 2));
  }

  console.log(`Saved: ${filepath}`);
  return filepath;
}
