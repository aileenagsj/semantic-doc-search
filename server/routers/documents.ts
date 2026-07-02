import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  deleteDocument,
  deleteDocuments,
  getDocumentById,
  getDocuments,
  getReadyDocuments,
  insertDocument,
  resetDocumentToProcessing,
  updateDocumentEmbedding,
  updateDocumentError,
} from "../documentDb";
import { storageGetSignedUrl } from "../storage";
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
  .input(z.object({
    query: z.string().min(1).max(500),
    topK: z.number().int().min(1).max(100).default(10),
  }))
  .query(async ({ input }) => {
    const { query, topK } = input;

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

    // Sort descending by score, return topK results
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
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

// ─── Re-index ────────────────────────────────────────────────────────────────

export const reindexDocumentProcedure = publicProcedure
  .input(z.object({ id: z.number().int().positive() }))
  .mutation(async ({ input }) => {
    const doc = await getDocumentById(input.id);
    if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });

    // Mark as processing immediately so the UI can start polling
    await resetDocumentToProcessing(input.id);

    // Fetch the original file from S3 via a signed URL
    let fileBuffer: Buffer;
    try {
      const signedUrl = await storageGetSignedUrl(doc.fileKey);
      const resp = await fetch(signedUrl);
      if (!resp.ok) throw new Error(`S3 fetch failed: ${resp.status}`);
      const arrayBuf = await resp.arrayBuffer();
      fileBuffer = Buffer.from(arrayBuf);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to fetch file from storage";
      await updateDocumentError(input.id, msg);
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
    }

    // Fire-and-forget re-processing (same pipeline as initial upload)
    processDocument(input.id, fileBuffer, doc.mimeType).catch(() => {/* already logged in processDocument */});

    return { success: true };
  });

// ─── Bulk Delete ─────────────────────────────────────────────────────────────

export const bulkDeleteDocumentsProcedure = publicProcedure
  .input(
    z.object({
      ids: z
        .array(z.number().int().positive())
        .min(1, "At least one document ID is required")
        .max(500, "Cannot delete more than 500 documents at once"),
    })
  )
  .mutation(async ({ input }) => {
    await deleteDocuments(input.ids);
    return { success: true, deleted: input.ids.length };
  });

// ─── Router ──────────────────────────────────────────────────────────────────

export const documentsRouter = router({
  list: listDocuments,
  delete: deleteDocumentProcedure,
  bulkDelete: bulkDeleteDocumentsProcedure,
  reindex: reindexDocumentProcedure,
  search: searchDocuments,
});
