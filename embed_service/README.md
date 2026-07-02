# Embedding Sidecar

A lightweight Python FastAPI service that provides real semantic embeddings via **Ollama `mxbai-embed-large`** and **FAISS** vector similarity search for the Semantic Document Search application.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Python 3.10+ | `python3 --version` |
| [Ollama](https://ollama.com) | Install from ollama.com, then run `ollama serve` |
| `mxbai-embed-large` model | Pull once: `ollama pull mxbai-embed-large` |

---

## Quick Start

```bash
# 1. Navigate to this directory
cd embed_service

# 2. Create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Make sure Ollama is running in another terminal
ollama serve

# 5. Start the sidecar (default port 8765)
python main.py
```

The service will be available at `http://localhost:8765`. Visit `http://localhost:8765/docs` for the interactive API explorer.

---

## Configuration

All settings are controlled via environment variables:

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
| `EMBED_MODEL` | `mxbai-embed-large` | Ollama model name |
| `EMBED_DIM` | `1024` | Embedding dimension (must match the model) |
| `INDEX_PATH` | `./faiss_index` | Directory where the FAISS index is persisted |
| `PORT` | `8765` | Port the sidecar listens on |

Example with custom settings:

```bash
OLLAMA_BASE_URL=http://192.168.1.10:11434 PORT=9000 python main.py
```

---

## Wiring to the Node.js Backend

Set the `EMBED_SERVICE_URL` environment variable in the Node.js project to point to this sidecar:

```bash
# In the semantic-doc-search project root, create or edit .env.local:
EMBED_SERVICE_URL=http://localhost:8765
```

When `EMBED_SERVICE_URL` is set and the sidecar is reachable, the Node.js backend will:

- Send document text to `/embed` after upload or re-index.
- Send search queries to `/search` to get FAISS-ranked results.
- Delete vectors via `/document/{id}` when a document is deleted.

When the sidecar is **not** reachable, the backend automatically falls back to the built-in n-gram embedder so the application continues to work.

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness check — returns model name, dimension, and index size |
| `GET` | `/stats` | Detailed index statistics |
| `POST` | `/embed` | Embed a document and add it to the FAISS index |
| `POST` | `/embed_query` | Embed a query string (does not modify the index) |
| `POST` | `/search` | Embed a query and return top-K nearest document IDs with scores |
| `DELETE` | `/document/{id}` | Remove all vectors for a document |
| `POST` | `/reindex` | Remove, re-embed, and re-add a document |

---

## Index Persistence

The FAISS index and metadata are saved to `INDEX_PATH` (default `./faiss_index/`) after every write operation. The directory contains:

- `index.faiss` — the FAISS flat inner-product index
- `meta.pkl` — Python pickle mapping FAISS row indices to document IDs

The index is loaded automatically on startup. To reset it, delete both files.

---

## Remote Deployment

To run the sidecar on a remote host (Cloud Computer, VPS, or any server) so the
published web app can use real Ollama embeddings, see **[DEPLOY.md](./DEPLOY.md)**
for step-by-step instructions covering:

- Manus Cloud Computer (managed Ubuntu VM, $10/month Basic tier)
- Any VPS (DigitalOcean, Hetzner, AWS EC2, etc.)
- Local machine with the web app running in development mode

Once the sidecar is running on a remote host, set `EMBED_SERVICE_URL` in the
Manus WebDev Secrets panel (Management UI → Settings → Secrets) to
`http://<YOUR_HOST_IP>:8765`. The nav bar badge will turn green within 30 seconds.

---

## Notes on the Model

`mxbai-embed-large` produces **1024-dimensional** embeddings and is one of the strongest open-source embedding models for English text (MTEB benchmark top-10 as of 2024). The FAISS index uses **IndexFlatIP** (exact inner product search) on L2-normalised vectors, which is equivalent to cosine similarity. For very large libraries (>1 million documents) you could switch to `IndexIVFFlat` for approximate search, but exact search is recommended for most use cases.
