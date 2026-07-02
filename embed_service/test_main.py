"""
Unit tests for the embedding sidecar (v2 — with chunking).

Run with:
    cd embed_service
    pip install -r requirements.txt pytest httpx
    pytest test_main.py -v
"""

import numpy as np
import pytest
from fastapi.testclient import TestClient

import main as sidecar_main
from main import VectorStore, EMBED_DIM, CHUNK_SIZE, CHUNK_OVERLAP, chunk_text, app

# ─── chunk_text unit tests ────────────────────────────────────────────────────

class TestChunkText:
    def test_empty_string_returns_empty_list(self):
        assert chunk_text("") == []

    def test_short_text_returns_single_chunk(self):
        text = "hello world"
        chunks = chunk_text(text, chunk_size=500, overlap=100)
        assert chunks == ["hello world"]

    def test_exact_chunk_size_returns_single_chunk(self):
        text = "a" * 500
        chunks = chunk_text(text, chunk_size=500, overlap=100)
        assert len(chunks) == 1
        assert chunks[0] == text

    def test_text_longer_than_chunk_size_splits(self):
        text = "a" * 1000
        chunks = chunk_text(text, chunk_size=500, overlap=100)
        assert len(chunks) == 3  # [0:500], [400:900], [800:1000]

    def test_chunk_size_is_respected(self):
        text = "x" * 2000
        chunks = chunk_text(text, chunk_size=500, overlap=100)
        for chunk in chunks[:-1]:  # all but last must be exactly chunk_size
            assert len(chunk) == 500

    def test_overlap_creates_shared_content(self):
        text = "abcdefghij" * 100  # 1000 chars
        chunks = chunk_text(text, chunk_size=500, overlap=100)
        # The end of chunk[0] and start of chunk[1] should share 100 chars
        assert chunks[0][-100:] == chunks[1][:100]

    def test_no_overlap(self):
        text = "a" * 1000
        chunks = chunk_text(text, chunk_size=500, overlap=0)
        assert len(chunks) == 2
        assert chunks[0] == "a" * 500
        assert chunks[1] == "a" * 500

    def test_default_params_match_config(self):
        """Default chunk_size and overlap must match CHUNK_SIZE / CHUNK_OVERLAP constants."""
        text = "z" * (CHUNK_SIZE + 1)
        chunks = chunk_text(text)
        assert len(chunks) >= 2

    def test_last_chunk_may_be_shorter(self):
        text = "b" * 550
        chunks = chunk_text(text, chunk_size=500, overlap=100)
        assert len(chunks[-1]) <= 500

    def test_single_char_text(self):
        assert chunk_text("x") == ["x"]

    def test_unicode_text(self):
        text = "日本語テスト" * 100
        chunks = chunk_text(text, chunk_size=50, overlap=10)
        assert all(len(c) <= 50 for c in chunks[:-1])


# ─── VectorStore unit tests ───────────────────────────────────────────────────

def make_vec(seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    v = rng.random(EMBED_DIM).astype(np.float32)
    return v / np.linalg.norm(v)


class TestVectorStore:
    def setup_method(self):
        self.store = VectorStore()

    def test_add_and_search_single_doc(self):
        vec = make_vec(1)
        self.store.add(doc_id=1, vector=vec)
        results = self.store.search(vec, top_k=1)
        assert len(results) == 1
        assert results[0]["doc_id"] == 1
        assert results[0]["score"] == pytest.approx(1.0, abs=1e-5)

    def test_search_empty_index(self):
        assert self.store.search(make_vec(1), top_k=5) == []

    def test_multiple_chunks_same_doc_deduplicated(self):
        """Multiple chunk vectors for the same doc → only one result entry."""
        for i in range(5):
            self.store.add(doc_id=7, vector=make_vec(i))
        results = self.store.search(make_vec(0), top_k=10)
        doc_ids = [r["doc_id"] for r in results]
        assert doc_ids.count(7) == 1

    def test_best_chunk_score_returned(self):
        """The result score should be the maximum over all chunk scores."""
        query = make_vec(42)
        # Add one chunk identical to query (score ≈ 1.0) and one orthogonal
        self.store.add(doc_id=1, vector=query.copy())
        orthogonal = np.zeros(EMBED_DIM, dtype=np.float32)
        orthogonal[0] = 1.0
        self.store.add(doc_id=1, vector=orthogonal)
        results = self.store.search(query, top_k=1)
        assert results[0]["score"] == pytest.approx(1.0, abs=1e-5)

    def test_remove_clears_all_chunks(self):
        for i in range(3):
            self.store.add(doc_id=5, vector=make_vec(i))
        self.store.remove(doc_id=5)
        assert 5 not in self.store.doc_id_to_rows
        assert self.store.index.ntotal == 0

    def test_remove_nonexistent_is_noop(self):
        self.store.remove(doc_id=999)  # must not raise

    def test_remove_one_of_many_docs(self):
        for i in range(1, 4):
            for j in range(3):  # 3 chunks per doc
                self.store.add(doc_id=i, vector=make_vec(i * 10 + j))
        self.store.remove(doc_id=2)
        assert 2 not in self.store.doc_id_to_rows
        assert self.store.index.ntotal == 6  # 2 docs × 3 chunks
        assert 2 not in set(self.store.row_to_doc_id)

    def test_scores_descending(self):
        for i in range(1, 6):
            self.store.add(doc_id=i, vector=make_vec(i))
        results = self.store.search(make_vec(1), top_k=5)
        scores = [r["score"] for r in results]
        assert scores == sorted(scores, reverse=True)

    def test_top_k_limits_results(self):
        for i in range(1, 11):
            self.store.add(doc_id=i, vector=make_vec(i))
        assert len(self.store.search(make_vec(1), top_k=3)) <= 3

    def test_reindex_replaces_vectors(self):
        old_vec = make_vec(10)
        new_vec = make_vec(99)
        self.store.add(doc_id=10, vector=old_vec)
        self.store.remove(doc_id=10)
        self.store.add(doc_id=10, vector=new_vec)
        results = self.store.search(new_vec, top_k=1)
        assert results[0]["doc_id"] == 10
        assert results[0]["score"] == pytest.approx(1.0, abs=1e-5)


# ─── FastAPI endpoint tests (mocked Ollama) ───────────────────────────────────

@pytest.fixture(autouse=True)
def reset_store():
    sidecar_main.store = VectorStore()
    yield


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def patch_ollama(monkeypatch):
    """Replace async get_embedding with a deterministic mock (no Ollama needed)."""
    async def fake_embed(text: str) -> np.ndarray:
        seed = len(text) % 100
        return make_vec(seed)
    monkeypatch.setattr(sidecar_main, "get_embedding", fake_embed)


class TestHealthEndpoint:
    def test_health_returns_ok(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["chunk_size"] == CHUNK_SIZE
        assert data["chunk_overlap"] == CHUNK_OVERLAP

    def test_health_reports_document_count(self, client):
        client.post("/embed", json={"doc_id": 1, "text": "hello"})
        data = client.get("/health").json()
        assert data["documents"] == 1


class TestStatsEndpoint:
    def test_stats_returns_chunk_config(self, client):
        resp = client.get("/stats")
        assert resp.status_code == 200
        data = resp.json()
        assert data["chunk_size"] == CHUNK_SIZE
        assert data["chunk_overlap"] == CHUNK_OVERLAP


class TestEmbedEndpoint:
    def test_embed_short_text_one_chunk(self, client):
        resp = client.post("/embed", json={"doc_id": 1, "text": "short text"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["chunks"] == 1
        assert sidecar_main.store.index.ntotal == 1

    def test_embed_long_text_multiple_chunks(self, client):
        long_text = "word " * 300  # ~1500 chars → 3+ chunks at 500/100
        resp = client.post("/embed", json={"doc_id": 2, "text": long_text})
        assert resp.status_code == 200
        data = resp.json()
        assert data["chunks"] > 1
        assert sidecar_main.store.index.ntotal == data["chunks"]

    def test_embed_response_has_vector_and_dim(self, client):
        resp = client.post("/embed", json={"doc_id": 3, "text": "test"})
        data = resp.json()
        assert len(data["vector"]) == EMBED_DIM
        assert data["dim"] == EMBED_DIM


class TestEmbedQueryEndpoint:
    def test_does_not_modify_index(self, client):
        client.post("/embed_query", json={"text": "query"})
        assert sidecar_main.store.index.ntotal == 0


class TestSearchEndpoint:
    def test_search_empty_index(self, client):
        resp = client.post("/search", json={"query": "anything", "top_k": 5})
        assert resp.json()["results"] == []

    def test_search_returns_results_after_embed(self, client):
        client.post("/embed", json={"doc_id": 1, "text": "machine learning"})
        resp = client.post("/search", json={"query": "machine learning", "top_k": 1})
        data = resp.json()
        assert len(data["results"]) == 1
        assert data["results"][0]["doc_id"] == 1

    def test_search_respects_top_k(self, client):
        for i in range(1, 6):
            client.post("/embed", json={"doc_id": i, "text": f"document {i}"})
        resp = client.post("/search", json={"query": "document", "top_k": 2})
        assert len(resp.json()["results"]) <= 2

    def test_search_deduplicates_chunked_doc(self, client):
        """A document with many chunks should appear only once in results."""
        long_text = "semantic search " * 200  # many chunks
        client.post("/embed", json={"doc_id": 99, "text": long_text})
        resp = client.post("/search", json={"query": "semantic search", "top_k": 10})
        doc_ids = [r["doc_id"] for r in resp.json()["results"]]
        assert doc_ids.count(99) == 1


class TestDeleteEndpoint:
    def test_delete_removes_all_chunks(self, client):
        long_text = "chunk me " * 200
        client.post("/embed", json={"doc_id": 10, "text": long_text})
        assert sidecar_main.store.index.ntotal > 1
        client.delete("/document/10")
        assert sidecar_main.store.index.ntotal == 0

    def test_delete_nonexistent_is_noop(self, client):
        assert client.delete("/document/999").status_code == 200


class TestReindexEndpoint:
    def test_reindex_replaces_all_chunks(self, client):
        client.post("/embed", json={"doc_id": 20, "text": "original " * 200})
        old_count = sidecar_main.store.index.ntotal
        resp = client.post("/reindex", json={"doc_id": 20, "text": "updated " * 200})
        assert resp.status_code == 200
        # Index should have the new chunks, not the old ones
        new_count = sidecar_main.store.index.ntotal
        assert new_count > 0
        assert 20 in sidecar_main.store.doc_id_to_rows
