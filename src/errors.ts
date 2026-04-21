/**
 * Custom error classes for crawl operations.
 */

interface BaseErrorOptions {
  cause?: Error;
}

interface CrawlErrorOptions {
  cause?: Error;
  retryable?: boolean;
}

interface ApiErrorOptions {
  status?: number;
  errors?: Array<{ code?: number; message: string }>;
  cause?: Error;
  retryable?: boolean;
}

export class UsageError extends Error {
  constructor(message: string, { cause }: BaseErrorOptions = {}) {
    super(message, { cause });
    this.name = "UsageError";
  }
}

export class ConfigError extends Error {
  constructor(message: string, { cause }: BaseErrorOptions = {}) {
    super(message, { cause });
    this.name = "ConfigError";
  }
}

export class CrawlError extends Error {
  retryable: boolean;

  constructor(message: string, { cause, retryable = false }: CrawlErrorOptions = {}) {
    super(message, { cause });
    this.name = "CrawlError";
    this.retryable = retryable;
  }
}

export class ApiError extends CrawlError {
  status?: number;
  errors?: Array<{ code?: number; message: string }>;

  constructor(message: string, { status, errors, cause, retryable }: ApiErrorOptions = {}) {
    const effectiveRetryable = retryable ?? ((status ?? 0) >= 500 || status === 429);
    super(message, { cause, retryable: effectiveRetryable });
    this.name = "ApiError";
    this.status = status;
    this.errors = errors;
  }
}
