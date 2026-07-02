# Semantic Document Search — TODO

## Backend / Infrastructure
- [x] Install dependencies: multer, mammoth (docx→text), pdf-parse
- [x] Database schema: documents table (id, filename, originalName, fileKey, fileUrl, extractedText, embeddingJson, chunkCount, status, createdAt)
- [x] Run migration SQL
- [x] server/db.ts: insertDocument, getDocuments, getDocumentById, deleteDocument, updateDocumentEmbedding
- [x] server/routers/documents.ts: upload procedure (multipart), list procedure, delete procedure
- [x] server/routers/search.ts: semantic search procedure (embed query → cosine similarity → ranked results with score + snippet)
- [x] Text extraction utility: PDF via pdf-parse, DOCX via mammoth
- [x] Embedding utility: use invokeLLM to generate a dense semantic vector (JSON array of floats) for each document chunk
- [x] Cosine similarity utility for ranking
- [x] Wire all routers into appRouter

## Frontend
- [x] Global design: Inter font, dark navy/cream palette, generous whitespace, premium feel
- [x] index.css: CSS variables, typography scale, smooth animations
- [x] Landing/Search page (Home.tsx): hero section with search bar, recent documents preview
- [x] Search results page: ranked cards with doc name, relevance score badge, text snippet
- [x] Upload page: drag-and-drop zone, file type validation, upload progress, success/error states
- [x] Document management page: table/grid of all docs, delete confirmation, status indicators
- [x] Navigation: top nav with Search, Upload, Manage links
- [x] Loading states, empty states, error states throughout
- [x] Responsive design (mobile-first)
- [x] App.tsx: register all routes

## Tests
- [x] Vitest: cosine similarity utility
- [x] Vitest: text extraction helpers
- [x] Vitest: search ranking logic

## Delivery
- [x] Checkpoint and publish

## Batch ZIP Upload
- [x] Install adm-zip for server-side ZIP extraction
- [x] Create /api/upload-batch Express route: accept a .zip file, unzip in memory, validate each entry, upload each doc to S3, insert DB records, fire background processing
- [x] Return a batch result listing each file's id, name, and status
- [x] Update Upload page: accept .zip in file picker and drop zone
- [x] Show ZIP contents as an expandable list of per-file status rows
- [x] Vitest: ZIP batch route helpers
- [x] Checkpoint

## Bulk Delete
- [x] Add bulkDelete tRPC procedure that accepts an array of document IDs
- [x] Update Manage page: row checkboxes, select-all header checkbox, bulk delete toolbar, confirmation dialog
- [x] Vitest: bulkDelete procedure
- [x] Checkpoint

## Re-index
- [x] Add reindex tRPC procedure: fetch doc from S3, re-extract text, regenerate embedding, update DB
- [x] Add RefreshCw button to each row on the Manage page; show spinner while processing; poll until ready
- [x] Vitest: reindex procedure input validation
- [x] Checkpoint

## Result Count Selector
- [x] Update search procedure to accept a topK parameter (default 10, max 100)
- [x] Add result count selector to the search UI (options: 5, 10, 20, 50, 100)
- [x] Persist the user's preference in localStorage
- [x] Checkpoint

## Python/Ollama/FAISS Embedding Sidecar (Local)
- [x] Write embed_service/main.py: FastAPI sidecar with /embed and /search endpoints using Ollama mxbai-embed-large + FAISS
- [x] Write embed_service/requirements.txt
- [x] Write embed_service/README.md with setup instructions
- [x] Update server/embedding.ts to call the sidecar with fallback to n-gram
- [x] Update server/routers/documents.ts search to call sidecar /search when available
- [x] Add EMBED_SERVICE_URL env var support
- [x] Write sidecar tests
- [x] Checkpoint

## Document Chunking (500-char blocks)
- [x] Add chunk_text() utility to sidecar: 500-char blocks with 100-char overlap
- [x] Update sidecar /embed to embed all chunks and add each as a separate FAISS vector
- [x] Update sidecar /reindex to remove old vectors then re-embed all chunks
- [x] Update Node.js processDocument to send full extracted text (no 6000-char cap)
- [x] Update chunking tests in Python and Node.js
- [x] Checkpoint

## Configurable Remote Sidecar
- [x] Register EMBED_SERVICE_URL via webdev_request_secrets
- [x] Add GET /api/sidecar-status endpoint returning { connected, url, model, totalIndexed }
- [x] Add sidecar status badge to NavBar (green = connected, amber = fallback)
- [x] Write embed_service/DEPLOY.md: Cloud Computer, VPS, and local setup guide
- [x] Write systemd service file for the sidecar
- [x] Update embed_service/README.md with remote deployment notes
- [x] Checkpoint
