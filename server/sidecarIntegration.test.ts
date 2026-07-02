/**
 * Tests for the sidecar integration layer in embedding.ts.
 *
 * vi.mock is hoisted above all imports by Vitest, so we cannot reference a
 * variable declared in the test file inside the vi.mock factory. Instead we
 * expose a mutable config object through the mock itself and mutate it in
 * beforeEach/afterEach.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mutable config shared between the mock factory and the tests ─────────────
// Declared with `let` so the factory closure always reads the current value.
// vi.mock is hoisted, but the factory is called lazily on first import, so
// by the time tests run the `let` binding is already initialised.
let _embedServiceUrl = "http://localhost:8765";

vi.mock("./_core/env", () => ({
  ENV: {
    get embedServiceUrl() { return _embedServiceUrl; },
    appId: "",
    cookieSecret: "",
    databaseUrl: "",
    oAuthServerUrl: "",
    ownerOpenId: "",
    isProduction: false,
    forgeApiUrl: "",
    forgeApiKey: "",
  },
}));

import {
  sidecarEmbedDocument,
  sidecarReindexDocument,
  sidecarDeleteDocument,
  sidecarSearch,
  isSidecarAvailable,
  generateEmbedding,
} from "./embedding";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MOCK_VEC = Array.from({ length: 1024 }, (_, i) => i / 1024);

function mockFetchOk(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  } as unknown as Response);
}

function mockFetchFail() {
  return vi.fn().mockRejectedValue(new Error("Network error"));
}

// ─── sidecarEmbedDocument ─────────────────────────────────────────────────────

describe("sidecarEmbedDocument", () => {
  beforeEach(() => { _embedServiceUrl = "http://localhost:8765"; });
  afterEach(() => { vi.restoreAllMocks(); });

  it("sends the full text without truncation", async () => {
    const fullText = "a".repeat(50_000);
    const mockFetch = mockFetchOk({ vector: MOCK_VEC, chunks: 100 });
    vi.stubGlobal("fetch", mockFetch);

    await sidecarEmbedDocument(1, fullText);

    const calls = mockFetch.mock.calls as Array<[string, RequestInit]>;
    expect(calls.length).toBeGreaterThan(0);
    const [, init] = calls[0];
    const body = JSON.parse(init.body as string) as { text: string };
    expect(body.text.length).toBe(50_000);
  });

  it("posts to /embed with correct doc_id", async () => {
    const mockFetch = mockFetchOk({ vector: MOCK_VEC, chunks: 1 });
    vi.stubGlobal("fetch", mockFetch);

    await sidecarEmbedDocument(42, "hello world");

    const calls = mockFetch.mock.calls as Array<[string, RequestInit]>;
    const [url, init] = calls[0];
    expect(url).toContain("/embed");
    const body = JSON.parse(init.body as string) as { doc_id: number };
    expect(body.doc_id).toBe(42);
  });

  it("returns the vector on success", async () => {
    vi.stubGlobal("fetch", mockFetchOk({ vector: MOCK_VEC, chunks: 2 }));
    const result = await sidecarEmbedDocument(1, "text");
    expect(result).toEqual(MOCK_VEC);
  });

  it("returns null on network failure", async () => {
    vi.stubGlobal("fetch", mockFetchFail());
    expect(await sidecarEmbedDocument(1, "text")).toBeNull();
  });

  it("returns null when embedServiceUrl is empty", async () => {
    _embedServiceUrl = "";
    expect(await sidecarEmbedDocument(1, "text")).toBeNull();
  });
});

// ─── sidecarReindexDocument ───────────────────────────────────────────────────

describe("sidecarReindexDocument", () => {
  beforeEach(() => { _embedServiceUrl = "http://localhost:8765"; });
  afterEach(() => { vi.restoreAllMocks(); });

  it("posts to /reindex endpoint", async () => {
    const mockFetch = mockFetchOk({ vector: MOCK_VEC, chunks: 3 });
    vi.stubGlobal("fetch", mockFetch);

    await sidecarReindexDocument(7, "updated text");

    const calls = mockFetch.mock.calls as Array<[string, RequestInit]>;
    const [url] = calls[0];
    expect(url).toContain("/reindex");
  });

  it("sends the full text to /reindex without truncation", async () => {
    const fullText = "b".repeat(20_000);
    const mockFetch = mockFetchOk({ vector: MOCK_VEC, chunks: 40 });
    vi.stubGlobal("fetch", mockFetch);

    await sidecarReindexDocument(7, fullText);

    const calls = mockFetch.mock.calls as Array<[string, RequestInit]>;
    const [, init] = calls[0];
    const body = JSON.parse(init.body as string) as { text: string };
    expect(body.text.length).toBe(20_000);
  });

  it("returns null on failure", async () => {
    vi.stubGlobal("fetch", mockFetchFail());
    expect(await sidecarReindexDocument(7, "text")).toBeNull();
  });
});

// ─── sidecarDeleteDocument ────────────────────────────────────────────────────

describe("sidecarDeleteDocument", () => {
  beforeEach(() => { _embedServiceUrl = "http://localhost:8765"; });
  afterEach(() => { vi.restoreAllMocks(); });

  it("sends DELETE to /document/{id}", async () => {
    const mockFetch = mockFetchOk({ success: true });
    vi.stubGlobal("fetch", mockFetch);

    await sidecarDeleteDocument(55);

    const calls = mockFetch.mock.calls as Array<[string, RequestInit & { method: string }]>;
    const [url, init] = calls[0];
    expect(url).toContain("/document/55");
    expect(init.method).toBe("DELETE");
  });

  it("does not throw on network failure (best-effort)", async () => {
    vi.stubGlobal("fetch", mockFetchFail());
    await expect(sidecarDeleteDocument(1)).resolves.not.toThrow();
  });
});

// ─── sidecarSearch ────────────────────────────────────────────────────────────

describe("sidecarSearch", () => {
  beforeEach(() => { _embedServiceUrl = "http://localhost:8765"; });
  afterEach(() => { vi.restoreAllMocks(); });

  it("posts to /search with query and top_k", async () => {
    const mockFetch = mockFetchOk({
      results: [{ doc_id: 1, score: 0.95 }],
      total_indexed: 5,
    });
    vi.stubGlobal("fetch", mockFetch);

    const results = await sidecarSearch("machine learning", 10);

    const calls = mockFetch.mock.calls as Array<[string, RequestInit]>;
    const [url, init] = calls[0];
    expect(url).toContain("/search");
    const body = JSON.parse(init.body as string) as { query: string; top_k: number };
    expect(body.query).toBe("machine learning");
    expect(body.top_k).toBe(10);
    expect(results).toEqual([{ doc_id: 1, score: 0.95 }]);
  });

  it("returns null on failure", async () => {
    vi.stubGlobal("fetch", mockFetchFail());
    expect(await sidecarSearch("query", 5)).toBeNull();
  });
});

// ─── isSidecarAvailable ───────────────────────────────────────────────────────

describe("isSidecarAvailable", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns false when embedServiceUrl is empty", async () => {
    _embedServiceUrl = "";
    expect(await isSidecarAvailable()).toBe(false);
  });

  it("returns false when the health check fails", async () => {
    _embedServiceUrl = "http://localhost:8765";
    vi.stubGlobal("fetch", mockFetchFail());
    expect(await isSidecarAvailable()).toBe(false);
  });

  it("returns true when the health check succeeds", async () => {
    _embedServiceUrl = "http://localhost:8765";
    vi.stubGlobal("fetch", mockFetchOk({ status: "ok" }));
    expect(await isSidecarAvailable()).toBe(true);
  });
});

// ─── generateEmbedding (fallback) ────────────────────────────────────────────

describe("generateEmbedding fallback (no sidecar)", () => {
  beforeEach(() => { _embedServiceUrl = ""; });
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns a non-empty vector", async () => {
    const vec = await generateEmbedding("hello world");
    expect(vec.length).toBeGreaterThan(0);
  });

  it("returns a unit-normalised vector", async () => {
    const vec = await generateEmbedding("test text for normalisation");
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("produces different vectors for different texts", async () => {
    const v1 = await generateEmbedding("machine learning");
    const v2 = await generateEmbedding("cooking recipes");
    expect(v1).not.toEqual(v2);
  });

  it("produces identical vectors for identical texts", async () => {
    const v1 = await generateEmbedding("deterministic text");
    const v2 = await generateEmbedding("deterministic text");
    expect(v1).toEqual(v2);
  });
});

// ─── Full-text: no 6000-char cap ─────────────────────────────────────────────

describe("full-text sidecar path (no 6000-char cap)", () => {
  beforeEach(() => { _embedServiceUrl = "http://localhost:8765"; });
  afterEach(() => { vi.restoreAllMocks(); });

  it("sidecarEmbedDocument receives text longer than 6000 chars", async () => {
    const longText = "word ".repeat(2000); // ~10 000 chars
    const mockFetch = mockFetchOk({ vector: MOCK_VEC, chunks: 20 });
    vi.stubGlobal("fetch", mockFetch);

    await sidecarEmbedDocument(1, longText);

    const calls = mockFetch.mock.calls as Array<[string, RequestInit]>;
    const [, init] = calls[0];
    const body = JSON.parse(init.body as string) as { text: string };
    expect(body.text.length).toBeGreaterThan(6000);
  });

  it("sidecarReindexDocument receives text longer than 6000 chars", async () => {
    const longText = "chunk ".repeat(2000); // ~12 000 chars
    const mockFetch = mockFetchOk({ vector: MOCK_VEC, chunks: 24 });
    vi.stubGlobal("fetch", mockFetch);

    await sidecarReindexDocument(2, longText);

    const calls = mockFetch.mock.calls as Array<[string, RequestInit]>;
    const [, init] = calls[0];
    const body = JSON.parse(init.body as string) as { text: string };
    expect(body.text.length).toBeGreaterThan(6000);
  });
});
