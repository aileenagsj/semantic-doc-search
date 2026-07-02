import { ENV } from "./_core/env";

const EMBEDDING_DIM = 128; // compact vector dimension

/**
 * Call the built-in LLM proxy's embeddings endpoint.
 * Falls back to a TF-IDF-style pseudo-embedding if the endpoint is unavailable.
 */
async function callEmbeddingAPI(text: string): Promise<number[] | null> {
  try {
    const resp = await fetch(`${ENV.forgeApiUrl}/v1/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ENV.forgeApiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text.slice(0, 8000),
      }),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as {
      data?: Array<{ embedding: number[] }>;
    };
    return json.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

/**
 * Deterministic pseudo-embedding based on character n-gram hashing.
 * Produces a normalised float vector of length EMBEDDING_DIM.
 * Used as a fallback when no embedding API is available.
 */
function pseudoEmbed(text: string): number[] {
  const lower = text.toLowerCase().replace(/\s+/g, " ").trim();
  const vec = new Float64Array(EMBEDDING_DIM);

  // Unigrams
  for (let i = 0; i < lower.length; i++) {
    const code = lower.charCodeAt(i);
    vec[code % EMBEDDING_DIM] += 1;
  }

  // Bigrams
  for (let i = 0; i < lower.length - 1; i++) {
    const h = (lower.charCodeAt(i) * 31 + lower.charCodeAt(i + 1)) >>> 0;
    vec[h % EMBEDDING_DIM] += 0.5;
  }

  // Trigrams
  for (let i = 0; i < lower.length - 2; i++) {
    const h =
      ((lower.charCodeAt(i) * 31 + lower.charCodeAt(i + 1)) * 31 +
        lower.charCodeAt(i + 2)) >>>
      0;
    vec[h % EMBEDDING_DIM] += 0.25;
  }

  // L2-normalise
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec).map(v => v / norm);
}

/**
 * Generate a semantic embedding for the given text.
 * Tries the real embedding API first; falls back to pseudo-embedding.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const apiResult = await callEmbeddingAPI(text);
  if (apiResult && apiResult.length > 0) return apiResult;
  return pseudoEmbed(text);
}

/**
 * Cosine similarity between two vectors (both assumed normalised).
 * Returns a value in [-1, 1]; higher = more similar.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Serialise a vector to a compact JSON string for DB storage.
 */
export function serializeEmbedding(vec: number[]): string {
  return JSON.stringify(vec);
}

/**
 * Deserialise a vector from a DB JSON string.
 */
export function deserializeEmbedding(json: string): number[] {
  return JSON.parse(json) as number[];
}
