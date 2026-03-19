/**
 * Custom error classes for crawl operations.
 */

export class CrawlError extends Error {
  constructor(message, { cause, retryable = false } = {}) {
    super(message, { cause });
    this.name = "CrawlError";
    this.retryable = retryable;
  }
}

export class ApiError extends CrawlError {
  constructor(message, { status, errors, cause } = {}) {
    const retryable = status >= 500 || status === 429;
    super(message, { cause, retryable });
    this.name = "ApiError";
    this.status = status;
    this.errors = errors;
  }
}
