import { describe, it, expect } from "vitest";
import { highlightTerms } from "./highlightTerms";

describe("highlightTerms", () => {
  it("should highlight single term", () => {
    const result = highlightTerms("The quick brown fox", "quick");
    expect(result).toEqual([
      { text: "The ", isMatch: false },
      { text: "quick", isMatch: true },
      { text: " brown fox", isMatch: false },
    ]);
  });

  it("should highlight multiple occurrences", () => {
    const result = highlightTerms("cat and cat", "cat");
    expect(result).toEqual([
      { text: "cat", isMatch: true },
      { text: " and ", isMatch: false },
      { text: "cat", isMatch: true },
    ]);
  });

  it("should be case-insensitive", () => {
    const result = highlightTerms("The Quick Brown Fox", "quick");
    expect(result).toEqual([
      { text: "The ", isMatch: false },
      { text: "Quick", isMatch: true },
      { text: " Brown Fox", isMatch: false },
    ]);
  });

  it("should handle multiple query terms", () => {
    const result = highlightTerms("The quick brown fox", "quick fox");
    expect(result).toEqual([
      { text: "The ", isMatch: false },
      { text: "quick", isMatch: true },
      { text: " brown ", isMatch: false },
      { text: "fox", isMatch: true },
    ]);
  });

  it("should handle empty query", () => {
    const result = highlightTerms("The quick brown fox", "");
    expect(result).toEqual([{ text: "The quick brown fox", isMatch: false }]);
  });

  it("should handle empty text", () => {
    const result = highlightTerms("", "quick");
    expect(result).toEqual([{ text: "", isMatch: false }]);
  });

  it("should handle no matches", () => {
    const result = highlightTerms("The quick brown fox", "zebra");
    expect(result).toEqual([{ text: "The quick brown fox", isMatch: false }]);
  });

  it("should handle special regex characters", () => {
    const result = highlightTerms("Price is $100", "$100");
    expect(result).toEqual([
      { text: "Price is ", isMatch: false },
      { text: "$100", isMatch: true },
    ]);
  });

  it("should handle whitespace-only query", () => {
    const result = highlightTerms("The quick brown fox", "   ");
    expect(result).toEqual([{ text: "The quick brown fox", isMatch: false }]);
  });

  it("should handle overlapping terms", () => {
    const result = highlightTerms("testing test", "test");
    expect(result).toEqual([
      { text: "test", isMatch: true },
      { text: "ing ", isMatch: false },
      { text: "test", isMatch: true },
    ]);
  });
});
