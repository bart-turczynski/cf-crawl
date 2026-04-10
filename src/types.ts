// --- Job tracking ---

export interface JobEntry {
  jobId: string;
  url: string;
  render?: boolean;
  limit?: number;
  max_depth?: number | null;
  startedAt: string;
  status: string;
  updatedAt?: string;
  finished?: number;
  skipped?: number;
  downloaded?: boolean;
}

// --- CLI ---

export interface ParsedArgs {
  command: string | undefined;
  flags: Flags;
  positionals: string[];
}

export interface Flags {
  help?: boolean;
  render?: boolean;
  limit?: number;
  max_depth?: number;
  wait?: number | boolean;
  "no-wait"?: boolean;
  [key: string]: string | number | boolean | undefined;
}

// --- Config ---

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export interface PollOptions {
  intervalMs: number;
  maxAttempts: number;
}

// --- API responses ---

export interface CfApiError {
  code?: number;
  message: string;
}

export interface CfApiResponse<T = unknown> {
  success: boolean;
  errors?: CfApiError[];
  result: T;
}

export interface CrawlResult {
  status?: string;
  finished?: number;
  skipped?: number;
  cursor?: string;
  records?: CrawlRecord[];
  browserSecondsUsed?: number;
  pagesProcessed?: number;
  progress?: string;
  total?: number;
  id?: string;
  jobId?: string;
}

export interface CrawlRecord {
  url: string;
  [key: string]: unknown;
}

export interface ScrapeResultGroup {
  selector: string;
  results?: unknown[];
}

export interface SelectorSpec {
  selector: string;
}

// --- Command options ---

export type OutputFormat = "json" | "jsonl";

export interface CrawlOptions {
  limit?: number;
  max_depth?: number;
  wait?: boolean;
  format?: OutputFormat;
}

export interface DownloadOptions {
  format?: OutputFormat;
}

export interface CollectResultSummary {
  filepath: string;
  recordCount: number;
  status: string;
  finished: number;
  skipped: number;
  browserSecondsUsed: number;
}

export interface ResultWriter {
  open(): Promise<void>;
  writeRecords(records: CrawlRecord[]): Promise<void>;
  close(): Promise<string>;
  readonly recordCount: number;
}

export interface ScrapeOptions {
  wait?: number;
}

// --- Crawl job tracking ---

export interface CrawlJob {
  jobId: string;
  url: string;
}

export interface PollResultEntry extends CrawlJob {
  status: string;
  result: CollectResultSummary;
}

export interface PollFailureEntry extends CrawlJob {
  status: string;
  error: string;
}

export interface PollResult {
  results: PollResultEntry[];
  failures: PollFailureEntry[];
}

export interface ConcurrentResult<T, V> {
  successes: Array<{ item: T; value: V }>;
  failures: Array<{ item: T; error: string }>;
}
