import { Express, Request, Response } from "express";
import multer from "multer";
import path from "path";
import { nanoid } from "nanoid";
import { storagePut } from "./storage";
import { insertDocument } from "./documentDb";
import { processDocument } from "./routers/documents";

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/x-pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.ms-word",
]);

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Only PDF and DOCX are allowed.`));
    }
  },
});

export function registerUploadRoute(app: Express) {
  app.post(
    "/api/upload",
    upload.single("file"),
    async (req: Request, res: Response) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: "No file provided" });
          return;
        }

        const { originalname, mimetype, buffer, size } = req.file;

        // Sanitise filename and generate a unique storage key
        const ext = path.extname(originalname).toLowerCase();
        const safeBase = path.basename(originalname, ext).replace(/[^a-zA-Z0-9_\-]/g, "_");
        const uniqueKey = `documents/${nanoid(12)}_${safeBase}${ext}`;

        // Upload to S3
        const { key, url } = await storagePut(uniqueKey, buffer, mimetype);

        // Insert DB record (status = processing)
        const docId = await insertDocument({
          filename: uniqueKey,
          originalName: originalname,
          fileKey: key,
          fileUrl: url,
          mimeType: mimetype,
          fileSize: size,
          status: "processing",
        });

        // Fire-and-forget background processing (extract + embed)
        processDocument(docId, buffer, mimetype).catch(err => {
          console.error(`[Upload] Background processing failed for doc ${docId}:`, err);
        });

        res.json({
          success: true,
          id: docId,
          originalName: originalname,
          fileUrl: url,
          status: "processing",
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Upload failed";
        console.error("[Upload] Error:", message);
        res.status(500).json({ error: message });
      }
    }
  );
}
