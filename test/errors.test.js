import { describe, it, expect } from "vitest";
import { CrawlError, ApiError } from "../src/errors.js";

describe("CrawlError", () => {
  it("sets name, message, and retryable defaults to false", () => {
    const err = new CrawlError("something broke");
    expect(err.name).toBe("CrawlError");
    expect(err.message).toBe("something broke");
    expect(err.retryable).toBe(false);
    expect(err).toBeInstanceOf(Error);
  });

  it("accepts retryable: true", () => {
    const err = new CrawlError("transient", { retryable: true });
    expect(err.retryable).toBe(true);
  });

  it("accepts a cause", () => {
    const cause = new Error("root cause");
    const err = new CrawlError("wrapper", { cause });
    expect(err.cause).toBe(cause);
  });
});

describe("ApiError", () => {
  it("sets name, status, and errors array", () => {
    const errors = [{ message: "bad request" }];
    const err = new ApiError("api fail", { status: 400, errors });
    expect(err.name).toBe("ApiError");
    expect(err.status).toBe(400);
    expect(err.errors).toBe(errors);
  });

  it("extends CrawlError", () => {
    const err = new ApiError("fail");
    expect(err).toBeInstanceOf(CrawlError);
    expect(err).toBeInstanceOf(Error);
  });

  it("is retryable for status >= 500", () => {
    expect(new ApiError("fail", { status: 500 }).retryable).toBe(true);
    expect(new ApiError("fail", { status: 502 }).retryable).toBe(true);
    expect(new ApiError("fail", { status: 503 }).retryable).toBe(true);
  });

  it("is retryable for status 429", () => {
    expect(new ApiError("rate limited", { status: 429 }).retryable).toBe(true);
  });

  it("is NOT retryable for 4xx (not 429)", () => {
    expect(new ApiError("bad", { status: 400 }).retryable).toBe(false);
    expect(new ApiError("forbidden", { status: 403 }).retryable).toBe(false);
    expect(new ApiError("not found", { status: 404 }).retryable).toBe(false);
  });
});
