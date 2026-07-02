"""
Unit tests for the embedding sidecar.

Run with:
    cd embed_service
    pip install -r requirements.txt pytest pytest-asyncio httpx
    pytest test_main.py -v
"""

import numpy as np
import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch

# We need to import the app and VectorStore from main.py.
# Patch Ollama calls so tests run without a real Ollama server.
import main as sidecar_main
from main import VectorStore, EMBED_DIM, app

# ─── VectorStore unit tests ───────────────────────────────────────────────────

def make_vec(seed: int) -> np.ndarray:
    """Create a deterministic normalised float32 vector."""
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

    def test_search_returns_empty_on_empty_index(self):
        results = self.store.search(make_vec(1), top_k=5)
        assert results == []

    def test_add_multiple_docs_and_rank(self):
        query = make_vec(42)
        # doc 1 is identical to query → highest score
        self.store.add(doc_id=1, vector=query.copy())
        # doc 2 is orthogonal → low score
        orthogonal = np.zeros(EMBED_DIM, dtype=np.float32)
        orthogonal[0] = 1.0
        self.store.add(doc_id=2, vector=orthogonal)

        results = self.store.search(query, top_k=2)
        assert results[0]["doc_id"] == 1
        assert results[0]["score"] > results[1]["score"]

    def test_remove_existing_doc(self):
        vec = make_vec(5)
        self.store.add(doc_id=5, vector=vec)
        assert 5 in self.store.doc_id_to_rows
        self.store.remove(doc_id=5)
        assert 5 not in self.store.doc_id_to_rows
        assert self.store.index.ntotal == 0

    def test_remove_nonexistent_doc_is_noop(self):
        """Removing a doc that was never added must not raise."""
        self.store.remove(doc_id=999)  # should not raise

    def test_remove_one_of_many_docs(self):
        for i in range(1, 6):
            self.store.add(doc_id=i, vector=make_vec(i))
        self.store.remove(doc_id=3)
        assert 3 not in self.store.doc_id_to_rows
        assert self.store.index.ntotal == 4
        remaining_ids = set(self.store.row_to_doc_id)
        assert 3 not in remaining_ids

    def test_reindex_replaces_vector(self):
        old_vec = make_vec(10)
        new_vec = make_vec(99)
        self.store.add(doc_id=10, vector=old_vec)
        # Simulate reindex: remove then add
        self.store.remove(doc_id=10)
        self.store.add(doc_id=10, vector=new_vec)
        results = self.store.search(new_vec, top_k=1)
        assert results[0]["doc_id"] == 10
        assert results[0]["score"] == pytest.approx(1.0, abs=1e-5)

    def test_deduplication_returns_best_score_per_doc(self):
        """When a doc has multiple vectors, search should return only one entry for it."""
        vec_a = make_vec(1)
        vec_b = make_vec(2)
        self.store.add(doc_id=7, vector=vec_a)
        self.store.add(doc_id=7, vector=vec_b)
        results = self.store.search(vec_a, top_k=10)
        doc_ids = [r["doc_id"] for r in results]
        assert doc_ids.count(7) == 1

    def test_top_k_limits_results(self):
        for i in range(1, 11):
            self.store.add(doc_id=i, vector=make_vec(i))
        results = self.store.search(make_vec(1), top_k=3)
        assert len(results) <= 3

    def test_scores_are_in_descending_order(self):
        for i in range(1, 6):
            self.store.add(doc_id=i, vector=make_vec(i))
        results = self.store.search(make_vec(3), top_k=5)
        scores = [r["score"] for r in results]
        assert scores == sorted(scores, reverse=True)


# ─── FastAPI endpoint tests (mocked Ollama) ───────────────────────────────────

MOCK_VEC = make_vec(42).tolist()


@pytest.fixture(autouse=True)
def reset_store():
    """Reset the global VectorStore before each test."""
    sidecar_main.store = VectorStore()
    yield


@pytest.fixture
def client():
    return TestClient(app)


def mock_get_embedding(text: str):
    """Return a deterministic vector based on text length so different texts differ."""
    seed = len(text) % 100
    return make_vec(seed)


@pytest.fixture(autouse=True)
def patch_ollama(monkeypatch):
    """Replace the async get_embedding with a sync-compatible mock."""
    async def fake_embed(text: str):
        return mock_get_embedding(text)
    monkeypatch.setattr(sidecar_main, "get_embedding", fake_embed)


class TestHealthEndpoint:
    def test_health_returns_ok(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "indexed" in data


class TestStatsEndpoint:
    def test_stats_returns_model_info(self, client):
        resp = client.get("/stats")
        assert resp.status_code == 200
        data = resp.json()
        assert "model" in data
        assert "total_vectors" in data
        assert "total_documents" in data


class TestEmbedEndpoint:
    def test_embed_adds_to_index(self, client):
        resp = client.post("/embed", json={"doc_id": 1, "text": "hello world"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["doc_id"] == 1
        assert isinstance(data["vector"], list)
        assert len(data["vector"]) == EMBED_DIM
        assert sidecar_main.store.index.ntotal == 1

    def test_embed_multiple_docs(self, client):
        client.post("/embed", json={"doc_id": 1, "text": "document one"})
        client.post("/embed", json={"doc_id": 2, "text": "document two"})
        assert sidecar_main.store.index.ntotal == 2


class TestEmbedQueryEndpoint:
    def test_embed_query_does_not_modify_index(self, client):
        resp = client.post("/embed_query", json={"text": "search query"})
        assert resp.status_code == 200
        assert sidecar_main.store.index.ntotal == 0  # index unchanged
        data = resp.json()
        assert "vector" in data
        assert len(data["vector"]) == EMBED_DIM


class TestSearchEndpoint:
    def test_search_empty_index(self, client):
        resp = client.post("/search", json={"query": "anything", "top_k": 5})
        assert resp.status_code == 200
        data = resp.json()
        assert data["results"] == []

    def test_search_returns_results(self, client):
        client.post("/embed", json={"doc_id": 1, "text": "machine learning"})
        client.post("/embed", json={"doc_id": 2, "text": "cooking recipes"})
        resp = client.post("/search", json={"query": "machine learning", "top_k": 2})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["results"]) > 0
        assert all("doc_id" in r and "score" in r for r in data["results"])

    def test_search_respects_top_k(self, client):
        for i in range(1, 6):
            client.post("/embed", json={"doc_id": i, "text": f"document {i}"})
        resp = client.post("/search", json={"query": "document", "top_k": 2})
        assert resp.status_code == 200
        assert len(resp.json()["results"]) <= 2


class TestDeleteEndpoint:
    def test_delete_removes_from_index(self, client):
        client.post("/embed", json={"doc_id": 10, "text": "to be deleted"})
        assert sidecar_main.store.index.ntotal == 1
        resp = client.delete("/document/10")
        assert resp.status_code == 200
        assert sidecar_main.store.index.ntotal == 0

    def test_delete_nonexistent_is_noop(self, client):
        resp = client.delete("/document/999")
        assert resp.status_code == 200


class TestReindexEndpoint:
    def test_reindex_replaces_vector(self, client):
        client.post("/embed", json={"doc_id": 20, "text": "original text"})
        assert sidecar_main.store.index.ntotal == 1
        resp = client.post("/reindex", json={"doc_id": 20, "text": "updated text"})
        assert resp.status_code == 200
        # Still one vector (old removed, new added)
        assert sidecar_main.store.index.ntotal == 1
        data = resp.json()
        assert data["doc_id"] == 20
