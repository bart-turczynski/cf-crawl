import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// Track all chunks written to the mock stream
let writtenChunks: string[] = [];

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(() => Promise.resolve()),
  writeFile: vi.fn(() => Promise.resolve()),
}));

vi.mock("node:fs", () => {
  const mockWrite = vi.fn((chunk: string, _encoding?: unknown, cb?: () => void) => {
    writtenChunks.push(chunk);
    if (cb) cb();
    return true;
  });
  const mockEnd = vi.fn();
  const mockStream = {
    write: mockWrite,
    end: mockEnd,
    on: vi.fn((event: string, handler: () => void) => {
      if (event === "finish") {
        mockEnd.mockImplementation(() => handler());
      }
      return mockStream;
    }),
    once: vi.fn((_event: string, handler: () => void) => {
      // drain handler -- fire immediately since write always returns true
      handler();
      return mockStream;
    }),
  };
  return {
    createWriteStream: vi.fn(() => mockStream),
    __mockStream: mockStream,
  };
});

describe("StreamingJsonWriter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    writtenChunks = [];
  });

  it("writes valid JSON structure with metadata and records", async () => {
    const { StreamingJsonWriter } = await import("../src/output.js");
    vi.spyOn(console, "log").mockImplementation(() => {});

    const metadata = {
      success: true,
      result: { status: "completed", finished: 2, skipped: 0 },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = new StreamingJsonWriter("test.json", metadata as any);

    await writer.open();
    await writer.writeRecords([{ url: "https://a.com" }, { url: "https://b.com" }]);
    await writer.close();

    const output = writtenChunks.join("");
    const parsed = JSON.parse(output);
    expect(parsed.success).toBe(true);
    expect(parsed.result.status).toBe("completed");
    expect(parsed.result.records).toHaveLength(2);
    expect(parsed.result.records[0].url).toBe("https://a.com");
    expect(parsed.result.records[1].url).toBe("https://b.com");
  });

  it("handles multiple writeRecords calls with correct comma placement", async () => {
    const { StreamingJsonWriter } = await import("../src/output.js");
    vi.spyOn(console, "log").mockImplementation(() => {});

    const metadata = {
      success: true,
      result: { status: "completed", finished: 3, skipped: 0 },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = new StreamingJsonWriter("test.json", metadata as any);

    await writer.open();
    await writer.writeRecords([{ url: "https://a.com" }]);
    await writer.writeRecords([{ url: "https://b.com" }]);
    await writer.writeRecords([{ url: "https://c.com" }]);
    await writer.close();

    const output = writtenChunks.join("");
    const parsed = JSON.parse(output);
    expect(parsed.result.records).toHaveLength(3);
  });

  it("tracks recordCount across batches", async () => {
    const { StreamingJsonWriter } = await import("../src/output.js");
    vi.spyOn(console, "log").mockImplementation(() => {});

    const metadata = { success: true, result: { status: "completed" } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = new StreamingJsonWriter("test.json", metadata as any);

    await writer.open();
    expect(writer.recordCount).toBe(0);

    await writer.writeRecords([{ url: "https://a.com" }, { url: "https://b.com" }]);
    expect(writer.recordCount).toBe(2);

    await writer.writeRecords([{ url: "https://c.com" }]);
    expect(writer.recordCount).toBe(3);

    await writer.close();
  });

  it("handles empty writeRecords call", async () => {
    const { StreamingJsonWriter } = await import("../src/output.js");
    vi.spyOn(console, "log").mockImplementation(() => {});

    const metadata = { success: true, result: { status: "completed" } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = new StreamingJsonWriter("test.json", metadata as any);

    await writer.open();
    await writer.writeRecords([]);
    await writer.writeRecords([{ url: "https://a.com" }]);
    await writer.close();

    const output = writtenChunks.join("");
    const parsed = JSON.parse(output);
    expect(parsed.result.records).toHaveLength(1);
    expect(writer.recordCount).toBe(1);
  });

  it("throws if writeRecords called before open", async () => {
    const { StreamingJsonWriter } = await import("../src/output.js");

    const metadata = { success: true, result: { status: "completed" } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = new StreamingJsonWriter("test.json", metadata as any);

    await expect(writer.writeRecords([{ url: "https://a.com" }])).rejects.toThrow(
      "Writer not opened",
    );
  });

  it("throws if close called before open", async () => {
    const { StreamingJsonWriter } = await import("../src/output.js");

    const metadata = { success: true, result: { status: "completed" } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = new StreamingJsonWriter("test.json", metadata as any);

    await expect(writer.close()).rejects.toThrow("Writer not opened");
  });

  it("awaits drain when write returns false (backpressure)", async () => {
    const { createWriteStream } = (await import("node:fs")) as {
      createWriteStream: Mock;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      __mockStream: any;
    };

    let drainHandler: (() => void) | null = null;
    let writeCallCount = 0;

    const bpStream = {
      write: vi.fn((chunk: string, _encoding?: unknown, cb?: () => void) => {
        writtenChunks.push(chunk);
        if (cb) cb();
        writeCallCount++;
        // Return false on the 3rd write to simulate backpressure
        return writeCallCount !== 3;
      }),
      end: vi.fn(),
      on: vi.fn((event: string, handler: () => void) => {
        if (event === "finish") {
          bpStream.end.mockImplementation(() => handler());
        }
        return bpStream;
      }),
      once: vi.fn((event: string, handler: () => void) => {
        if (event === "drain") {
          drainHandler = handler;
          // Simulate async drain after a tick
          Promise.resolve().then(() => {
            if (drainHandler) drainHandler();
          });
        }
        return bpStream;
      }),
    };

    createWriteStream.mockReturnValue(bpStream);

    const { StreamingJsonWriter } = await import("../src/output.js");
    vi.spyOn(console, "log").mockImplementation(() => {});

    const metadata = { success: true, result: { status: "completed" } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = new StreamingJsonWriter("test.json", metadata as any);

    await writer.open();
    await writer.writeRecords([{ url: "https://a.com" }]);
    await writer.close();

    // drain should have been awaited
    expect(bpStream.once).toHaveBeenCalledWith("drain", expect.any(Function));
  });
});

describe("StreamingJsonlWriter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    writtenChunks = [];
  });

  it("writes one JSON object per line", async () => {
    const { StreamingJsonlWriter } = await import("../src/output.js");
    vi.spyOn(console, "log").mockImplementation(() => {});

    const writer = new StreamingJsonlWriter("test.jsonl");

    await writer.open();
    await writer.writeRecords([{ url: "https://a.com" }, { url: "https://b.com" }]);
    await writer.close();

    const output = writtenChunks.join("");
    const lines = output.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).url).toBe("https://a.com");
    expect(JSON.parse(lines[1]).url).toBe("https://b.com");
  });

  it("tracks recordCount", async () => {
    const { StreamingJsonlWriter } = await import("../src/output.js");
    vi.spyOn(console, "log").mockImplementation(() => {});

    const writer = new StreamingJsonlWriter("test.jsonl");

    await writer.open();
    await writer.writeRecords([{ url: "https://a.com" }]);
    expect(writer.recordCount).toBe(1);
    await writer.writeRecords([{ url: "https://b.com" }, { url: "https://c.com" }]);
    expect(writer.recordCount).toBe(3);
    await writer.close();
  });

  it("handles multiple batches across calls", async () => {
    const { StreamingJsonlWriter } = await import("../src/output.js");
    vi.spyOn(console, "log").mockImplementation(() => {});

    const writer = new StreamingJsonlWriter("test.jsonl");

    await writer.open();
    await writer.writeRecords([{ url: "https://a.com" }]);
    await writer.writeRecords([{ url: "https://b.com" }]);
    await writer.close();

    const output = writtenChunks.join("");
    const lines = output.trim().split("\n");
    expect(lines).toHaveLength(2);
  });
});

describe("createResultWriter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    writtenChunks = [];
  });

  it("returns StreamingJsonWriter for json format", async () => {
    const { createResultWriter, StreamingJsonWriter } = await import("../src/output.js");

    const metadata = { success: true, result: { status: "completed" } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = createResultWriter("test.json", "json", metadata as any);
    expect(writer).toBeInstanceOf(StreamingJsonWriter);
  });

  it("returns StreamingJsonlWriter for jsonl format", async () => {
    const { createResultWriter, StreamingJsonlWriter } = await import("../src/output.js");

    const metadata = { success: true, result: { status: "completed" } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = createResultWriter("test.json", "jsonl", metadata as any);
    expect(writer).toBeInstanceOf(StreamingJsonlWriter);
  });

  it("renames .json to .jsonl for jsonl format", async () => {
    const { createResultWriter, StreamingJsonlWriter } = await import("../src/output.js");
    vi.spyOn(console, "log").mockImplementation(() => {});

    const metadata = { success: true, result: { status: "completed" } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = createResultWriter("crawl_example.json", "jsonl", metadata as any);
    expect(writer).toBeInstanceOf(StreamingJsonlWriter);

    await writer.open();
    await writer.close();

    const { createWriteStream } = (await import("node:fs")) as { createWriteStream: Mock };
    const filepath = createWriteStream.mock.calls[0][0] as string;
    expect(filepath).toContain(".jsonl");
    expect(filepath).not.toContain(".json.jsonl");
  });
});
