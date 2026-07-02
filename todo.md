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
