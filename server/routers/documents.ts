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
  sidecarDeleteDocument,
  sidecarEmbedDocument,
  sidecarReindexDocument,
  sidecarSearch,
} from "../embedding";
import { extractText, findRelevantSnippet } from "../textExtraction";
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
    // Remove from FAISS index (fire-and-forget — never blocks the response)
    void sidecarDeleteDocument(input.id);
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

    // ── Path A: Python sidecar (FAISS + Ollama) ───────────────────────────
    const sidecarResults = await sidecarSearch(query, topK);
    if (sidecarResults !== null) {
      if (sidecarResults.length === 0) return [];
      // Fetch full document metadata for the returned IDs
      const docs = await getReadyDocuments();
      const docMap = new Map(docs.map(d => [d.id, d]));
      return sidecarResults
        .map(({ doc_id, score }) => {
          const d = docMap.get(doc_id);
          if (!d) return null;
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
        })
        .filter(Boolean) as Array<{
          id: number; originalName: string; fileUrl: string;
          mimeType: string; score: number; snippet: string; createdAt: Date;
        }>;
    }

    // ── Path B: fallback — n-gram cosine similarity in Node.js ────────────
    const queryEmbedding = await generateEmbedding(query);
    const docs = await getReadyDocuments();
    if (docs.length === 0) return [];

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

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  });

// ─── Process (background: extract + embed after upload) ──────────────────────

/**
 * Shared document processing pipeline.
 * @param isReindex - when true, calls sidecarReindexDocument (removes old vectors first)
 *                    when false, calls sidecarEmbedDocument (fresh add)
 */
export async function processDocument(
  id: number,
  buffer: Buffer,
  mimeType: string,
  isReindex = false
) {
  try {
    const { text } = await extractText(buffer, mimeType);
    if (!text || text.length < 5) {
      await updateDocumentError(id, "Could not extract text from document.");
      return;
    }

    // Use first 6000 chars for embedding
    const embeddingText = text.slice(0, 6000);

    // Try the Python sidecar first
    const sidecarFn = isReindex ? sidecarReindexDocument : sidecarEmbedDocument;
    const sidecarVec = await sidecarFn(id, embeddingText);
    if (sidecarVec) {
      await updateDocumentEmbedding(id, text, serializeEmbedding(sidecarVec));
      return;
    }

    // Fallback: n-gram embedding stored in DB
    const embedding = await generateEmbedding(embeddingText);
    await updateDocumentEmbedding(id, text, serializeEmbedding(embedding));
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

    await resetDocumentToProcessing(input.id);

    let fileBuffer: Buffer;
    try {
      const signedUrl = await storageGetSignedUrl(doc.fileKey);
      const resp = await fetch(signedUrl);
      if (!resp.ok) throw new Error(`S3 fetch failed: ${resp.status}`);
      fileBuffer = Buffer.from(await resp.arrayBuffer());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to fetch file from storage";
      await updateDocumentError(input.id, msg);
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
    }

    processDocument(input.id, fileBuffer, doc.mimeType, true).catch(() => {});
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
    // Remove from FAISS index (fire-and-forget — never blocks the response)
    void Promise.allSettled(input.ids.map(id => sidecarDeleteDocument(id)));
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
