import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  deleteDocument,
  getDocumentById,
  getDocuments,
  getReadyDocuments,
  insertDocument,
  updateDocumentEmbedding,
  updateDocumentError,
} from "../documentDb";
import {
  cosineSimilarity,
  deserializeEmbedding,
  generateEmbedding,
  serializeEmbedding,
} from "../embedding";
import { extractText, findRelevantSnippet, makeSnippet } from "../textExtraction";
import { storagePut } from "../storage";

// ─── List ────────────────────────────────────────────────────────────────────

export const listDocuments = publicProcedure.query(async () => {
  const docs = await getDocuments();
  return docs.map(d => ({
    id: d.id,
    originalName: d.originalName,
    filename: d.filename,
    fileUrl: d.fileUrl,
    mimeType: d.mimeType,
    fileSize: d.fileSize,
    status: d.status,
    errorMessage: d.errorMessage,
    createdAt: d.createdAt,
  }));
});

// ─── Delete ──────────────────────────────────────────────────────────────────

export const deleteDocumentProcedure = publicProcedure
  .input(z.object({ id: z.number().int().positive() }))
  .mutation(async ({ input }) => {
    const doc = await getDocumentById(input.id);
    if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
    await deleteDocument(input.id);
    return { success: true };
  });

// ─── Search ──────────────────────────────────────────────────────────────────

export const searchDocuments = publicProcedure
  .input(z.object({ query: z.string().min(1).max(500) }))
  .query(async ({ input }) => {
    const { query } = input;

    // Embed the query
    const queryEmbedding = await generateEmbedding(query);

    // Fetch all ready documents
    const docs = await getReadyDocuments();

    if (docs.length === 0) return [];

    // Score each document
    const scored = docs
      .filter(d => d.embeddingJson)
      .map(d => {
        const docEmbedding = deserializeEmbedding(d.embeddingJson!);
        const score = cosineSimilarity(queryEmbedding, docEmbedding);
        const snippet = d.extractedText
          ? findRelevantSnippet(d.extractedText, query, 280)
          : "";
        return {
          id: d.id,
          originalName: d.originalName,
          fileUrl: d.fileUrl,
          mimeType: d.mimeType,
          score: Math.round(score * 1000) / 1000,
          snippet,
          createdAt: d.createdAt,
        };
      });

    // Sort descending by score, return top 20
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 20);
  });

// ─── Process (background-style: extract + embed after upload) ─────────────────

export async function processDocument(id: number, buffer: Buffer, mimeType: string) {
  try {
    const { text } = await extractText(buffer, mimeType);
    if (!text || text.length < 5) {
      await updateDocumentError(id, "Could not extract text from document.");
      return;
    }
    // Use first 6000 chars for embedding to keep cost low
    const embeddingText = text.slice(0, 6000);
    const embedding = await generateEmbedding(embeddingText);
    const embeddingJson = serializeEmbedding(embedding);
    await updateDocumentEmbedding(id, text, embeddingJson);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error during processing";
    await updateDocumentError(id, msg);
  }
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const documentsRouter = router({
  list: listDocuments,
  delete: deleteDocumentProcedure,
  search: searchDocuments,
});
