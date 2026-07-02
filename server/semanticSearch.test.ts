import { describe, it, expect } from "vitest";
import { cosineSimilarity, deserializeEmbedding, serializeEmbedding } from "./embedding";
import { makeSnippet, findRelevantSnippet } from "./textExtraction";

// ─── Cosine Similarity ────────────────────────────────────────────────────────

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const v = [0.6, 0.8];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
  });

  it("returns 0 for empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("returns 0 for mismatched lengths", () => {
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
  });

  it("handles unnormalised vectors correctly", () => {
    // [3, 4] and [6, 8] are parallel — cosine = 1
    expect(cosineSimilarity([3, 4], [6, 8])).toBeCloseTo(1, 5);
  });
});

// ─── Serialisation ────────────────────────────────────────────────────────────

describe("serializeEmbedding / deserializeEmbedding", () => {
  it("round-trips a float vector", () => {
    const vec = [0.1, 0.2, 0.3, -0.4, 0.5];
    const json = serializeEmbedding(vec);
    const recovered = deserializeEmbedding(json);
    expect(recovered).toHaveLength(vec.length);
    vec.forEach((v, i) => expect(recovered[i]).toBeCloseTo(v, 10));
  });

  it("produces valid JSON", () => {
    const json = serializeEmbedding([1, 2, 3]);
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

// ─── Snippet Utilities ────────────────────────────────────────────────────────

describe("makeSnippet", () => {
  it("returns the full text when shorter than maxLength", () => {
    const text = "Short text.";
    expect(makeSnippet(text, 100)).toBe(text);
  });

  it("truncates to a word boundary and appends ellipsis", () => {
    const text = "The quick brown fox jumps over the lazy dog";
    const snippet = makeSnippet(text, 20);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(21); // 20 chars + ellipsis
  });

  it("collapses whitespace", () => {
    const text = "  hello   world  ";
    expect(makeSnippet(text, 200)).toBe("hello world");
  });

  it("returns empty string for empty input", () => {
    expect(makeSnippet("", 100)).toBe("");
  });
});

describe("findRelevantSnippet", () => {
  it("returns a snippet containing query keywords when present", () => {
    const text =
      "Introduction to machine learning. " +
      "This document covers neural networks and deep learning. ".repeat(20) +
      "Final chapter discusses quantum computing.";
    const snippet = findRelevantSnippet(text, "neural networks deep learning", 200);
    expect(snippet.toLowerCase()).toMatch(/neural|deep/);
  });

  it("falls back to opening snippet when no keywords match", () => {
    const text = "The quick brown fox jumps over the lazy dog. ".repeat(10);
    const snippet = findRelevantSnippet(text, "zzz nonexistent xyz", 50);
    // Should still return something non-empty
    expect(snippet.length).toBeGreaterThan(0);
  });

  it("returns empty string for empty text", () => {
    expect(findRelevantSnippet("", "query", 100)).toBe("");
  });
});

// ─── Ranking Logic ────────────────────────────────────────────────────────────

describe("ranking via cosineSimilarity", () => {
  it("ranks more similar documents higher", () => {
    // Simulate a query vector and two document vectors
    const query = [1, 0, 0, 0];
    const docA = [0.9, 0.1, 0, 0]; // highly similar
    const docB = [0.1, 0.9, 0, 0]; // less similar

    const scoreA = cosineSimilarity(query, docA);
    const scoreB = cosineSimilarity(query, docB);

    expect(scoreA).toBeGreaterThan(scoreB);
  });

  it("sorts results in descending score order", () => {
    const query = [1, 0];
    const docs = [
      { id: 1, vec: [0.3, 0.7] },
      { id: 2, vec: [0.9, 0.1] },
      { id: 3, vec: [0.6, 0.4] },
    ];

    const scored = docs
      .map(d => ({ id: d.id, score: cosineSimilarity(query, d.vec) }))
      .sort((a, b) => b.score - a.score);

    expect(scored[0].id).toBe(2);
    expect(scored[1].id).toBe(3);
    expect(scored[2].id).toBe(1);
  });
});
