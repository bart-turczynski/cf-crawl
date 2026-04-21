/**
 * Configuration constants and environment validation.
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { RetryOptions, PollOptions } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Env-dependent values are getters so they read process.env at call time,
// not at import time. This ensures dotenv has loaded before values are used.
export function CF_ACCOUNT_ID(): string | undefined {
  return process.env.CF_ACCOUNT_ID;
}
export function CF_API_TOKEN(): string | undefined {
  return process.env.CF_API_TOKEN;
}
export function API_BASE(): string {
  return `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/browser-rendering`;
}
export function WORKERS_AI_BASE(): string {
  return `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai`;
}
export const OUTPUT_DIR: string = join(__dirname, "..", "output");

export const RETRY_DEFAULTS: Required<RetryOptions> = {
  maxAttempts: 4,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
};
export const POLL_DEFAULTS: PollOptions = { intervalMs: 10_000, maxAttempts: 360 }; // ~60 min

export const COMPLETED_STATUSES: Set<string> = new Set(["completed", "done", "finished"]);
export const FAILED_STATUSES: Set<string> = new Set(["failed", "error"]);

export function validateEnv(): void {
  if (!process.env.CF_ACCOUNT_ID || !process.env.CF_API_TOKEN) {
    console.error("Missing CF_ACCOUNT_ID or CF_API_TOKEN in .env");
    process.exit(1);
  }
}
