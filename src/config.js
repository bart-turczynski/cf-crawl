/**
 * Configuration constants and environment validation.
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
export const CF_API_TOKEN = process.env.CF_API_TOKEN;
export const API_BASE = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/browser-rendering`;
export const OUTPUT_DIR = join(__dirname, "..", "output");

export const RETRY_DEFAULTS = { maxAttempts: 4, baseDelayMs: 1_000, maxDelayMs: 30_000 };
export const POLL_DEFAULTS = { intervalMs: 10_000, maxAttempts: 360 }; // ~60 min

export const COMPLETED_STATUSES = new Set(["completed", "done", "finished"]);
export const FAILED_STATUSES = new Set(["failed", "error"]);

export function validateEnv() {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
    console.error("Missing CF_ACCOUNT_ID or CF_API_TOKEN in .env");
    process.exit(1);
  }
}
