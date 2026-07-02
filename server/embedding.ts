import { ENV } from "./_core/env";

// ─── Sidecar client ───────────────────────────────────────────────────────────

/**
 * Returns the base URL of the Python embedding sidecar, or null if not configured.
 */
function sidecarUrl(): string | null {
  const url = ENV.embedServiceUrl.trim().replace(/\/+$/, "");
  return url || null;
}

/**
 * Check if the sidecar is reachable (fast health check, 2 s timeout).
 */
export async function isSidecarAvailable(): Promise<boolean> {
  const base = sidecarUrl();
  if (!base) return false;
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 2000);
    const resp = await fetch(`${base}/health`, { signal: ctrl.signal });
    clearTimeout(tid);
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Ask the sidecar to embed a document and add it to the FAISS index.
 * Returns the vector on success, null on failure.
 */
export async function sidecarEmbedDocument(
  docId: number,
  text: string
): Promise<number[] | null> {
  const base = sidecarUrl();
  if (!base) return null;
  try {
    const resp = await fetch(`${base}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc_id: docId, text }),
      signal: AbortSignal.timeout(120_000), // 2 min — large docs take time
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { vector: number[] };
    return data.vector ?? null;
  } catch {
    return null;
  }
}

/**
 * Ask the sidecar to re-embed a document (remove old vectors, add new ones).
 */
export async function sidecarReindexDocument(
  docId: number,
  text: string
): Promise<number[] | null> {
  const base = sidecarUrl();
  if (!base) return null;
  try {
    const resp = await fetch(`${base}/reindex`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc_id: docId, text }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { vector: number[] };
    return data.vector ?? null;
  } catch {
    return null;
  }
}

/**
 * Ask the sidecar to remove a document's vectors from the FAISS index.
 */
export async function sidecarDeleteDocument(docId: number): Promise<void> {
  const base = sidecarUrl();
  if (!base) return;
  try {
    await fetch(`${base}/document/${docId}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(2_000),
    });
  } catch {
    // best-effort
  }
}

/**
 * Ask the sidecar to search the FAISS index for the top-K most similar documents.
 * Returns an array of { doc_id, score } on success, null on failure.
 */
export async function sidecarSearch(
  query: string,
  topK: number
): Promise<Array<{ doc_id: number; score: number }> | null> {
  const base = sidecarUrl();
  if (!base) return null;
  try {
    const resp = await fetch(`${base}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, top_k: topK }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { results: Array<{ doc_id: number; score: number }> };
    return data.results ?? null;
  } catch {
    return null;
  }
}

// ─── Fallback: n-gram pseudo-embedding ───────────────────────────────────────

const EMBEDDING_DIM = 128;

/**
 * Deterministic pseudo-embedding based on character n-gram hashing.
 * Used when the Python sidecar is not available.
 */
function pseudoEmbed(text: string): number[] {
  const lower = text.toLowerCase().replace(/\s+/g, " ").trim();
  const vec = new Float64Array(EMBEDDING_DIM);

  for (let i = 0; i < lower.length; i++) {
    const code = lower.charCodeAt(i);
    vec[code % EMBEDDING_DIM] += 1;
  }
  for (let i = 0; i < lower.length - 1; i++) {
    const h = (lower.charCodeAt(i) * 31 + lower.charCodeAt(i + 1)) >>> 0;
    vec[h % EMBEDDING_DIM] += 0.5;
  }
  for (let i = 0; i < lower.length - 2; i++) {
    const h =
      ((lower.charCodeAt(i) * 31 + lower.charCodeAt(i + 1)) * 31 +
        lower.charCodeAt(i + 2)) >>> 0;
    vec[h % EMBEDDING_DIM] += 0.25;
  }

  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec).map(v => v / norm);
}

/**
 * Generate a semantic embedding for the given text.
 * Tries the Python sidecar first; falls back to pseudo-embedding.
 * NOTE: This function does NOT add the vector to the FAISS index.
 * Use sidecarEmbedDocument() for that. This is used for query embedding only.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const base = sidecarUrl();
  if (base) {
    try {
      const resp = await fetch(`${base}/embed_query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(30_000),
      });
      if (resp.ok) {
        const data = (await resp.json()) as { vector: number[] };
        if (data.vector?.length) return data.vector;
      }
    } catch {
      // fall through to pseudo-embed
    }
  }
  return pseudoEmbed(text);
}

/**
 * Cosine similarity between two vectors (both assumed normalised).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function serializeEmbedding(vec: number[]): string {
  return JSON.stringify(vec);
}

export function deserializeEmbedding(json: string): number[] {
  return JSON.parse(json) as number[];
}
