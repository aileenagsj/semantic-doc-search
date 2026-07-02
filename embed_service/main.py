"""
Semantic Document Search — Embedding Sidecar
=============================================
FastAPI service that:
  1. Splits document text into 500-character chunks with 100-character overlap.
  2. Calls Ollama (mxbai-embed-large) to produce 1024-dim embeddings per chunk.
  3. Maintains an in-memory FAISS flat-IP index (cosine similarity via
     normalised vectors), with multiple vectors per document (one per chunk).
  4. Persists the index + metadata to disk so it survives restarts.
  5. Search deduplicates by doc_id, returning the best chunk score per document.

Endpoints
---------
POST /embed           – chunk + embed a document, add all chunk vectors to index
POST /embed_query     – embed a query string, return vector only (no index add)
POST /search          – embed a query and return top-K nearest documents
DELETE /document/{id} – remove all chunk vectors for a document
POST /reindex         – remove old vectors, re-chunk, re-embed, re-add
GET  /health          – liveness check
GET  /stats           – index statistics
"""

import logging
import os
import pickle
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import faiss
import httpx
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ─── Configuration ────────────────────────────────────────────────────────────

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
EMBED_MODEL     = os.getenv("EMBED_MODEL", "mxbai-embed-large")
EMBED_DIM       = int(os.getenv("EMBED_DIM", "1024"))
CHUNK_SIZE      = int(os.getenv("CHUNK_SIZE", "500"))
CHUNK_OVERLAP   = int(os.getenv("CHUNK_OVERLAP", "100"))
INDEX_PATH      = Path(os.getenv("INDEX_PATH", "./faiss_index"))
PORT            = int(os.getenv("PORT", "8765"))

INDEX_PATH.mkdir(parents=True, exist_ok=True)
FAISS_FILE = INDEX_PATH / "index.faiss"
META_FILE  = INDEX_PATH / "meta.pkl"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ─── Chunking ─────────────────────────────────────────────────────────────────

def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """
    Split text into fixed-size character chunks with overlap.

    - chunk_size: maximum characters per chunk (default 500)
    - overlap:    characters shared between consecutive chunks (default 100)

    The last chunk may be shorter than chunk_size. If the text is shorter
    than chunk_size, a single chunk containing the full text is returned.
    """
    if not text:
        return []
    step = max(chunk_size - overlap, 1)
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        if end >= len(text):
            break
        start += step
    return chunks

# ─── FAISS index + metadata ───────────────────────────────────────────────────

class VectorStore:
    def __init__(self):
        self.index: faiss.IndexFlatIP = faiss.IndexFlatIP(EMBED_DIM)
        # row_to_doc_id[i] = document id for FAISS row i
        self.row_to_doc_id: list[int] = []
        # doc_id_to_rows[doc_id] = list of FAISS row indices for that doc
        self.doc_id_to_rows: dict[int, list[int]] = {}

    # ── Persistence ───────────────────────────────────────────────────────────

    def save(self):
        faiss.write_index(self.index, str(FAISS_FILE))
        with open(META_FILE, "wb") as f:
            pickle.dump(
                {"row_to_doc_id": self.row_to_doc_id, "doc_id_to_rows": self.doc_id_to_rows},
                f,
            )
        log.info("Index saved (%d vectors)", self.index.ntotal)

    def load(self):
        if FAISS_FILE.exists() and META_FILE.exists():
            self.index = faiss.read_index(str(FAISS_FILE))
            with open(META_FILE, "rb") as f:
                meta = pickle.load(f)
            self.row_to_doc_id = meta["row_to_doc_id"]
            self.doc_id_to_rows = meta["doc_id_to_rows"]
            log.info(
                "Index loaded (%d vectors, %d documents)",
                self.index.ntotal, len(self.doc_id_to_rows),
            )
        else:
            log.info("No existing index found — starting fresh")

    # ── Mutations ─────────────────────────────────────────────────────────────

    def add(self, doc_id: int, vector: np.ndarray):
        """Add a single normalised vector for doc_id (one call per chunk)."""
        row = self.index.ntotal
        self.index.add(vector.reshape(1, -1).astype(np.float32))
        self.row_to_doc_id.append(doc_id)
        self.doc_id_to_rows.setdefault(doc_id, []).append(row)

    def remove(self, doc_id: int):
        """Remove all chunk vectors for doc_id by rebuilding the index without them."""
        if doc_id not in self.doc_id_to_rows:
            return
        rows_to_remove = set(self.doc_id_to_rows[doc_id])
        keep_rows = [i for i in range(self.index.ntotal) if i not in rows_to_remove]
        if not keep_rows:
            self.index = faiss.IndexFlatIP(EMBED_DIM)
            self.row_to_doc_id = []
            self.doc_id_to_rows = {}
        else:
            vectors = np.vstack([self.index.reconstruct(i) for i in keep_rows])
            new_index = faiss.IndexFlatIP(EMBED_DIM)
            new_index.add(vectors)
            new_row_to_doc = [self.row_to_doc_id[r] for r in keep_rows]
            new_doc_to_rows: dict[int, list[int]] = {}
            for new_row, did in enumerate(new_row_to_doc):
                new_doc_to_rows.setdefault(did, []).append(new_row)
            self.index = new_index
            self.row_to_doc_id = new_row_to_doc
            self.doc_id_to_rows = new_doc_to_rows
            # doc_id is already absent from new_doc_to_rows — nothing to delete

    # ── Search ────────────────────────────────────────────────────────────────

    def search(self, query_vector: np.ndarray, top_k: int) -> list[dict[str, Any]]:
        """
        Return top-K (doc_id, score) pairs.
        Over-fetches to account for multiple chunks per doc, then deduplicates
        by keeping the best chunk score per document.
        """
        if self.index.ntotal == 0:
            return []
        # Over-fetch: each doc may have many chunks; fetch enough to cover top_k unique docs
        k = min(top_k * 10, self.index.ntotal)
        scores, indices = self.index.search(
            query_vector.reshape(1, -1).astype(np.float32), k
        )
        best: dict[int, float] = {}
        for score, idx in zip(scores[0], indices[0]):
            if idx < 0:
                continue
            doc_id = self.row_to_doc_id[idx]
            if doc_id not in best or score > best[doc_id]:
                best[doc_id] = float(score)
        ranked = sorted(best.items(), key=lambda x: x[1], reverse=True)[:top_k]
        return [{"doc_id": did, "score": score} for did, score in ranked]


store = VectorStore()


@asynccontextmanager
async def lifespan(app: FastAPI):
    store.load()
    yield


# ─── Ollama client ────────────────────────────────────────────────────────────

async def get_embedding(text: str) -> np.ndarray:
    """Call Ollama embeddings API and return a normalised float32 vector."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{OLLAMA_BASE_URL}/api/embed",
            json={"model": EMBED_MODEL, "input": text},
        )
        if resp.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"Ollama returned {resp.status_code}: {resp.text[:200]}",
            )
        data = resp.json()
        embeddings = data.get("embeddings") or data.get("embedding")
        if not embeddings:
            raise HTTPException(status_code=502, detail="Ollama returned no embeddings")
        vec = np.array(
            embeddings[0] if isinstance(embeddings[0], list) else embeddings,
            dtype=np.float32,
        )
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec = vec / norm
        return vec


async def embed_and_index(doc_id: int, text: str) -> tuple[list[float], int]:
    """
    Chunk text, embed each chunk, add all chunk vectors to the FAISS index.
    Returns (first_chunk_vector, num_chunks) for the API response.
    """
    chunks = chunk_text(text)
    if not chunks:
        raise HTTPException(status_code=422, detail="Text produced no chunks after splitting")

    first_vec: np.ndarray | None = None
    for chunk in chunks:
        vec = await get_embedding(chunk)
        store.add(doc_id, vec)
        if first_vec is None:
            first_vec = vec

    log.info(
        "Indexed doc_id=%d: %d chunk(s), index size=%d",
        doc_id, len(chunks), store.index.ntotal,
    )
    return first_vec.tolist(), len(chunks)  # type: ignore[union-attr]


# ─── FastAPI app ──────────────────────────────────────────────────────────────

app = FastAPI(
    title="Semantic Doc Search — Embedding Sidecar",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request / Response models ─────────────────────────────────────────────────

class EmbedRequest(BaseModel):
    doc_id: int
    text: str

class EmbedQueryRequest(BaseModel):
    text: str

class SearchRequest(BaseModel):
    query: str
    top_k: int = 10

class ReindexRequest(BaseModel):
    doc_id: int
    text: str

class EmbedResponse(BaseModel):
    doc_id: int
    vector: list[float]   # first chunk vector (representative)
    dim: int
    chunks: int           # number of chunks indexed

class SearchResult(BaseModel):
    doc_id: int
    score: float

class SearchResponse(BaseModel):
    results: list[SearchResult]
    total_indexed: int    # total vectors (chunks) in the index


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model": EMBED_MODEL,
        "dim": EMBED_DIM,
        "chunk_size": CHUNK_SIZE,
        "chunk_overlap": CHUNK_OVERLAP,
        "indexed": store.index.ntotal,
        "documents": len(store.doc_id_to_rows),
    }


@app.get("/stats")
async def stats():
    return {
        "model": EMBED_MODEL,
        "dim": EMBED_DIM,
        "chunk_size": CHUNK_SIZE,
        "chunk_overlap": CHUNK_OVERLAP,
        "total_vectors": store.index.ntotal,
        "total_documents": len(store.doc_id_to_rows),
        "ollama_url": OLLAMA_BASE_URL,
    }


@app.post("/embed", response_model=EmbedResponse)
async def embed_document(req: EmbedRequest):
    """Chunk and embed a document; add all chunk vectors to the FAISS index."""
    first_vec, num_chunks = await embed_and_index(req.doc_id, req.text)
    store.save()
    return EmbedResponse(doc_id=req.doc_id, vector=first_vec, dim=EMBED_DIM, chunks=num_chunks)


@app.post("/embed_query")
async def embed_query(req: EmbedQueryRequest):
    """Embed a query string and return the vector (does not modify the index)."""
    vec = await get_embedding(req.text)
    return {"vector": vec.tolist(), "dim": len(vec)}


@app.post("/search", response_model=SearchResponse)
async def search(req: SearchRequest):
    """Embed a query and return the top-K most similar document IDs with scores."""
    vec = await get_embedding(req.query)
    results = store.search(vec, req.top_k)
    return SearchResponse(
        results=[SearchResult(**r) for r in results],
        total_indexed=store.index.ntotal,
    )


@app.delete("/document/{doc_id}")
async def delete_document(doc_id: int):
    """Remove all chunk vectors for a document from the FAISS index."""
    store.remove(doc_id)
    store.save()
    log.info("Removed doc_id=%d (index size=%d)", doc_id, store.index.ntotal)
    return {"success": True, "doc_id": doc_id}


@app.post("/reindex", response_model=EmbedResponse)
async def reindex_document(req: ReindexRequest):
    """Remove existing chunk vectors, re-chunk, re-embed, and re-add to the index."""
    store.remove(req.doc_id)
    first_vec, num_chunks = await embed_and_index(req.doc_id, req.text)
    store.save()
    return EmbedResponse(doc_id=req.doc_id, vector=first_vec, dim=EMBED_DIM, chunks=num_chunks)


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False)
