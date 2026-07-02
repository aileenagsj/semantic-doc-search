import mammoth from "mammoth";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
// pdf-parse v2 exports a class-based API; use PDFParse with data in constructor options
const { PDFParse } = require("pdf-parse") as {
  PDFParse: new (opts: { verbosity: number; data: Buffer }) => {
    getText(opts?: object): Promise<{ text: string; total: number; pages: unknown[] }>;
  };
};

export type ExtractionResult = {
  text: string;
  pageCount?: number;
};

/**
 * Extract plain text from a PDF buffer.
 */
export async function extractPdfText(buffer: Buffer): Promise<ExtractionResult> {
  const parser = new PDFParse({ verbosity: 0, data: buffer });
  const data = await parser.getText({});
  return {
    text: data.text.trim(),
    pageCount: data.total,
  };
}

/**
 * Extract plain text from a DOCX buffer.
 */
export async function extractDocxText(buffer: Buffer): Promise<ExtractionResult> {
  const result = await mammoth.extractRawText({ buffer });
  return {
    text: result.value.trim(),
  };
}

/**
 * Dispatch to the correct extractor based on MIME type.
 */
export async function extractText(
  buffer: Buffer,
  mimeType: string
): Promise<ExtractionResult> {
  if (
    mimeType === "application/pdf" ||
    mimeType === "application/x-pdf"
  ) {
    return extractPdfText(buffer);
  }

  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword" ||
    mimeType === "application/vnd.ms-word"
  ) {
    return extractDocxText(buffer);
  }

  throw new Error(`Unsupported MIME type for text extraction: ${mimeType}`);
}

/**
 * Produce a short excerpt (up to maxLength chars) from the beginning of extracted text,
 * trimming to the nearest word boundary.
 */
export function makeSnippet(text: string, maxLength = 300): string {
  if (!text) return "";
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  const cut = cleaned.lastIndexOf(" ", maxLength);
  return cut > 0 ? cleaned.slice(0, cut) + "…" : cleaned.slice(0, maxLength) + "…";
}

/**
 * Find the most relevant snippet for a query by scanning the text for keyword matches.
 * Falls back to the opening snippet if no keywords are found.
 */
export function findRelevantSnippet(text: string, query: string, maxLength = 300): string {
  if (!text) return "";
  const cleaned = text.replace(/\s+/g, " ").trim();
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  let bestPos = -1;
  let bestScore = 0;

  // Slide a window and score by keyword density
  const windowSize = maxLength * 2;
  for (let i = 0; i < cleaned.length - windowSize; i += 50) {
    const window = cleaned.slice(i, i + windowSize).toLowerCase();
    const score = words.reduce((acc, w) => acc + (window.includes(w) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestPos = i;
    }
  }

  if (bestPos < 0 || bestScore === 0) {
    return makeSnippet(cleaned, maxLength);
  }

  const raw = cleaned.slice(bestPos, bestPos + windowSize);
  if (raw.length <= maxLength) return raw;
  const cut = raw.lastIndexOf(" ", maxLength);
  return (cut > 0 ? raw.slice(0, cut) : raw.slice(0, maxLength)) + "…";
}
