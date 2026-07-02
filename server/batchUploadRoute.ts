import { Express, Request, Response } from "express";
import multer from "multer";
import AdmZip from "adm-zip";
import path from "path";
import { nanoid } from "nanoid";
import { storagePut } from "./storage";
import { insertDocument } from "./documentDb";
import { processDocument } from "./routers/documents";

const ALLOWED_DOC_MIMES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
};

const MAX_ZIP_SIZE = 100 * 1024 * 1024; // 100 MB
const MAX_ENTRY_SIZE = 20 * 1024 * 1024; // 20 MB per file inside the ZIP
const MAX_ENTRIES = 200; // safety cap

const zipUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ZIP_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === ".zip" || file.mimetype === "application/zip" || file.mimetype === "application/x-zip-compressed") {
      cb(null, true);
    } else {
      cb(new Error("Only .zip files are accepted for batch upload."));
    }
  },
});

type BatchEntry = {
  name: string;
  id?: number;
  status: "queued" | "skipped" | "error";
  reason?: string;
};

export function registerBatchUploadRoute(app: Express) {
  app.post(
    "/api/upload-batch",
    zipUpload.single("file"),
    async (req: Request, res: Response) => {
      if (!req.file) {
        res.status(400).json({ error: "No ZIP file provided." });
        return;
      }

      let zip: AdmZip;
      try {
        zip = new AdmZip(req.file.buffer);
      } catch {
        res.status(400).json({ error: "Could not read ZIP file. Make sure it is a valid .zip archive." });
        return;
      }

      const entries = zip.getEntries().filter(e => !e.isDirectory);

      if (entries.length === 0) {
        res.status(400).json({ error: "The ZIP archive contains no files." });
        return;
      }

      const results: BatchEntry[] = [];
      let queued = 0;

      for (const entry of entries) {
        if (queued >= MAX_ENTRIES) {
          results.push({ name: entry.name, status: "skipped", reason: `Batch limit of ${MAX_ENTRIES} files reached.` });
          continue;
        }

        const entryName = entry.entryName; // preserves directory path
        const baseName = path.basename(entryName);
        const ext = path.extname(baseName).toLowerCase();

        // Skip hidden files, __MACOSX artefacts, and unsupported types
        if (
          baseName.startsWith(".") ||
          entryName.includes("__MACOSX") ||
          !ALLOWED_DOC_MIMES[ext]
        ) {
          results.push({ name: baseName, status: "skipped", reason: "Unsupported file type or system file." });
          continue;
        }

        const mimeType = ALLOWED_DOC_MIMES[ext]!;
        let buffer: Buffer;
        try {
          buffer = entry.getData();
        } catch {
          results.push({ name: baseName, status: "error", reason: "Could not read file from archive." });
          continue;
        }

        if (buffer.length === 0) {
          results.push({ name: baseName, status: "skipped", reason: "File is empty." });
          continue;
        }

        if (buffer.length > MAX_ENTRY_SIZE) {
          results.push({ name: baseName, status: "skipped", reason: `File exceeds 20 MB limit (${(buffer.length / 1024 / 1024).toFixed(1)} MB).` });
          continue;
        }

        try {
          const safeBase = path.basename(baseName, ext).replace(/[^a-zA-Z0-9_\-]/g, "_");
          const storageKey = `documents/${nanoid(12)}_${safeBase}${ext}`;
          const { key, url } = await storagePut(storageKey, buffer, mimeType);

          const docId = await insertDocument({
            filename: storageKey,
            originalName: baseName,
            fileKey: key,
            fileUrl: url,
            mimeType,
            fileSize: buffer.length,
            status: "processing",
          });

          // Fire-and-forget background processing
          processDocument(docId, buffer, mimeType).catch(err => {
            console.error(`[BatchUpload] Processing failed for doc ${docId}:`, err);
          });

          results.push({ name: baseName, id: docId, status: "queued" });
          queued++;
        } catch (err: unknown) {
          const reason = err instanceof Error ? err.message : "Upload failed";
          results.push({ name: baseName, status: "error", reason });
        }
      }

      res.json({
        success: true,
        total: entries.length,
        queued,
        results,
      });
    }
  );
}
