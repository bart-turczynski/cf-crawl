// --- Job tracking ---

export interface JobEntry {
  jobId: string;
  url?: string;
  render?: boolean;
  limit?: number;
  max_depth?: number | null;
  startedAt?: string;
  status?: string;
  updatedAt?: string;
  finished?: number;
  skipped?: number;
  downloaded?: boolean;
}

export interface JobLogEvent extends Partial<JobEntry> {
  jobId: string;
}

/**
 * One line in the `output/urls.jsonl` sidecar manifest. Sync single-page
 * commands append an entry per saved file so the originating URL survives
 * the lossy `urlSlug()` filename encoding.
 */
export interface OutputUrlEntry {
  command: string;
  url: string;
  filename: string;
  timestamp: string;
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
  /** Repeatable flag — each `--selector` occurrence appends one CSS selector. */
  selector?: string[];
  [key: string]: string | number | boolean | string[] | undefined;
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

// --- New endpoint response shapes ---

export interface LinksOptions {
  visibleLinksOnly?: boolean;
  excludeExternalLinks?: boolean;
}

export interface JsonExtractionOptions {
  prompt: string;
  responseFormat?: unknown;
}

export interface SnapshotResult {
  content?: string;
  screenshot?: string;
}

export type ScreenshotFormat = "png" | "jpeg" | "webp";

export interface ScreenshotOptions {
  fullPage?: boolean;
  format?: ScreenshotFormat;
}

export interface ToMarkdownResultItem {
  id?: string;
  name?: string;
  mimeType?: string;
  format?: string;
  tokens?: number;
  data?: string;
  error?: string;
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

/**
 * A browser cookie accepted by Cloudflare Browser Rendering endpoints. The API
 * accepts more fields (path, expires, httpOnly, ...), but we forward the minimal
 * trio that covers the common geo-routing / session use cases.
 */
export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
}

/**
 * Navigation lifecycle event to wait for before extracting, mapped to
 * `gotoOptions.waitUntil`. Ordered earliest -> latest.
 */
export type WaitUntilEvent = "domcontentloaded" | "load" | "networkidle2" | "networkidle0";

export interface ScrapeOptions {
  /** Fixed delay (ms) before extracting; mapped to `waitForTimeout`. */
  wait?: number;
  /** CSS selectors to extract. When empty, `scrape` falls back to DEFAULT_SELECTORS. */
  selectors?: SelectorSpec[];
  /** Wait for this CSS selector to appear before extracting; mapped to `waitForSelector`. */
  waitFor?: string;
  /** Navigation event to await; mapped to `gotoOptions.waitUntil`. Defaults to "load". */
  waitUntil?: WaitUntilEvent;
  /** When true, disable `bestAttempt` so an unmet wait condition fails the scrape. */
  strict?: boolean;
  /** Forwarded as `setExtraHTTPHeaders`. */
  headers?: Record<string, string>;
  /** Forwarded as `userAgent`. */
  userAgent?: string;
  /** Forwarded as `cookies`. */
  cookies?: BrowserCookie[];
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
