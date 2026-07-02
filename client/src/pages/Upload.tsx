import { useState, useRef, useCallback } from "react";
import {
  Upload as UploadIcon,
  FileText,
  FileType2,
  FileArchive,
  CheckCircle2,
  XCircle,
  Loader2,
  X,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Package,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCEPTED_DOC_TYPES = new Set([
  "application/pdf",
  "application/x-pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.ms-word",
]);
const ACCEPTED_DOC_EXTS = [".pdf", ".doc", ".docx"];
const ACCEPTED_ZIP_TYPES = new Set(["application/zip", "application/x-zip-compressed", "application/x-zip"]);
const MAX_DOC_SIZE_MB = 20;
const MAX_ZIP_SIZE_MB = 100;

// ─── Types ────────────────────────────────────────────────────────────────────

type UploadStatus = "idle" | "uploading" | "processing" | "success" | "error";

type BatchSubEntry = {
  name: string;
  id?: number;
  status: "queued" | "skipped" | "error";
  reason?: string;
};

type FileEntry =
  | {
      kind: "single";
      file: File;
      status: UploadStatus;
      error?: string;
      docId?: number;
    }
  | {
      kind: "zip";
      file: File;
      status: UploadStatus;
      error?: string;
      subEntries?: BatchSubEntry[];
      expanded: boolean;
    };

// ─── Validation ───────────────────────────────────────────────────────────────

function validateFile(file: File): { kind: "single" | "zip"; error?: string } {
  const ext = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
  const isDoc = ACCEPTED_DOC_EXTS.includes(ext) || ACCEPTED_DOC_TYPES.has(file.type);
  const isZip = ext === ".zip" || ACCEPTED_ZIP_TYPES.has(file.type);

  if (!isDoc && !isZip) {
    return { kind: "single", error: "Unsupported type. Only PDF, Word (.doc/.docx), or ZIP files are accepted." };
  }
  if (isZip && file.size > MAX_ZIP_SIZE_MB * 1024 * 1024) {
    return { kind: "zip", error: `ZIP too large. Maximum size is ${MAX_ZIP_SIZE_MB} MB.` };
  }
  if (isDoc && file.size > MAX_DOC_SIZE_MB * 1024 * 1024) {
    return { kind: "single", error: `File too large. Maximum size is ${MAX_DOC_SIZE_MB} MB.` };
  }
  return { kind: isZip ? "zip" : "single" };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DocFileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  const isPdf = mimeType.includes("pdf");
  return isPdf
    ? <FileType2 className={cn("text-destructive/70", className)} />
    : <FileText className={cn("text-primary/70", className)} />;
}

function subStatusIcon(status: BatchSubEntry["status"]) {
  if (status === "queued") return <CheckCircle2 className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />;
  if (status === "skipped") return <XCircle className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />;
  return <XCircle className="w-3.5 h-3.5 text-destructive flex-shrink-0" />;
}

// ─── Single-file row ──────────────────────────────────────────────────────────

function SingleFileRow({
  entry,
  onRemove,
}: {
  entry: Extract<FileEntry, { kind: "single" }>;
  onRemove: () => void;
}) {
  const { file, status, error } = entry;
  return (
    <div
      className={cn(
        "animate-fade-up flex items-center gap-4 p-4 rounded-xl border transition-all duration-200",
        status === "success" && "bg-green-50/50 border-green-200/60",
        status === "error" && "bg-red-50/50 border-red-200/60",
        (status === "uploading" || status === "processing") && "bg-primary/5 border-primary/20",
        status === "idle" && "bg-card border-border/60"
      )}
    >
      <DocFileIcon mimeType={file.type} className="w-5 h-5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{formatBytes(file.size)}</p>
        {error && <p className="text-xs text-destructive mt-1 leading-snug">{error}</p>}
        {status === "processing" && (
          <p className="text-xs text-primary mt-1">Extracting text &amp; generating embedding…</p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {(status === "uploading" || status === "processing") && (
          <Loader2 className="w-4 h-4 text-primary animate-spin" />
        )}
        {status === "success" && <CheckCircle2 className="w-4 h-4 text-green-600" />}
        {status === "error" && <XCircle className="w-4 h-4 text-destructive" />}
        {(status === "idle" || status === "error") && (
          <button
            onClick={onRemove}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors duration-150"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── ZIP row ──────────────────────────────────────────────────────────────────

function ZipFileRow({
  entry,
  onRemove,
  onToggleExpand,
}: {
  entry: Extract<FileEntry, { kind: "zip" }>;
  onRemove: () => void;
  onToggleExpand: () => void;
}) {
  const { file, status, error, subEntries, expanded } = entry;

  const queuedCount = subEntries?.filter(e => e.status === "queued").length ?? 0;
  const skippedCount = subEntries?.filter(e => e.status === "skipped").length ?? 0;
  const errorCount = subEntries?.filter(e => e.status === "error").length ?? 0;

  return (
    <div
      className={cn(
        "animate-fade-up rounded-xl border transition-all duration-200 overflow-hidden",
        status === "success" && "bg-green-50/50 border-green-200/60",
        status === "error" && "bg-red-50/50 border-red-200/60",
        (status === "uploading" || status === "processing") && "bg-primary/5 border-primary/20",
        status === "idle" && "bg-card border-border/60"
      )}
    >
      {/* Header row */}
      <div className="flex items-center gap-4 p-4">
        <FileArchive className="w-5 h-5 text-accent flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
            <span className="text-xs px-2 py-0.5 rounded-full bg-accent/15 text-accent font-semibold flex-shrink-0">
              ZIP
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{formatBytes(file.size)}</p>
          {error && <p className="text-xs text-destructive mt-1 leading-snug">{error}</p>}
          {status === "uploading" && (
            <p className="text-xs text-primary mt-1">Extracting archive…</p>
          )}
          {status === "success" && subEntries && (
            <p className="text-xs text-muted-foreground mt-1">
              <span className="text-green-700 font-medium">{queuedCount} indexed</span>
              {skippedCount > 0 && <span className="ml-2 text-muted-foreground">{skippedCount} skipped</span>}
              {errorCount > 0 && <span className="ml-2 text-destructive">{errorCount} errors</span>}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {status === "uploading" && <Loader2 className="w-4 h-4 text-primary animate-spin" />}
          {status === "success" && <CheckCircle2 className="w-4 h-4 text-green-600" />}
          {status === "error" && <XCircle className="w-4 h-4 text-destructive" />}
          {subEntries && subEntries.length > 0 && (
            <button
              onClick={onToggleExpand}
              className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors duration-150"
              title={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          )}
          {(status === "idle" || status === "error") && (
            <button
              onClick={onRemove}
              className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors duration-150"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Sub-entries list */}
      {expanded && subEntries && subEntries.length > 0 && (
        <div className="border-t border-border/40 px-4 py-3 space-y-1.5 bg-secondary/20">
          {subEntries.map((sub, i) => (
            <div key={i} className="flex items-center gap-2.5 text-xs">
              {subStatusIcon(sub.status)}
              <span
                className={cn(
                  "truncate flex-1",
                  sub.status === "queued" ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {sub.name}
              </span>
              {sub.reason && (
                <span className="text-muted-foreground/70 flex-shrink-0 max-w-[160px] truncate" title={sub.reason}>
                  {sub.reason}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function UploadPage() {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const addFiles = useCallback((files: FileList | File[]) => {
    const newEntries: FileEntry[] = Array.from(files).map(file => {
      const { kind, error } = validateFile(file);
      if (kind === "zip") {
        return { kind: "zip", file, status: error ? "error" : "idle", error, expanded: false } as FileEntry;
      }
      return { kind: "single", file, status: error ? "error" : "idle", error } as FileEntry;
    });
    setEntries(prev => [...prev, ...newEntries]);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const removeEntry = (index: number) =>
    setEntries(prev => prev.filter((_, i) => i !== index));

  const toggleExpand = (index: number) =>
    setEntries(prev =>
      prev.map((e, i) =>
        i === index && e.kind === "zip" ? { ...e, expanded: !e.expanded } : e
      )
    );

  // ── Upload single doc ──────────────────────────────────────────────────────

  const uploadSingle = async (index: number) => {
    const entry = entries[index];
    if (!entry || entry.kind !== "single" || entry.status !== "idle") return;

    setEntries(prev =>
      prev.map((e, i) => (i === index ? { ...e, status: "uploading" } : e))
    );

    try {
      const fd = new FormData();
      fd.append("file", entry.file);
      const resp = await fetch("/api/upload", { method: "POST", body: fd });
      if (!resp.ok) {
        const err = (await resp.json()) as { error?: string };
        throw new Error(err.error ?? "Upload failed");
      }
      const data = (await resp.json()) as { id: number };

      setEntries(prev =>
        prev.map((e, i) =>
          i === index ? { ...e, status: "processing", docId: data.id } : e
        )
      );

      // Poll for completion
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const docs = await utils.documents.list.fetch();
          const doc = docs.find(d => d.id === data.id);
          if (doc?.status === "ready") {
            clearInterval(poll);
            setEntries(prev =>
              prev.map((e, i) => (i === index ? { ...e, status: "success" } : e))
            );
            utils.documents.list.invalidate();
          } else if (doc?.status === "error") {
            clearInterval(poll);
            setEntries(prev =>
              prev.map((e, i) =>
                i === index ? { ...e, status: "error", error: doc.errorMessage ?? "Processing failed" } : e
              )
            );
          } else if (attempts > 30) {
            clearInterval(poll);
            setEntries(prev =>
              prev.map((e, i) => (i === index ? { ...e, status: "success" } : e))
            );
            utils.documents.list.invalidate();
          }
        } catch { /* ignore poll errors */ }
      }, 2000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setEntries(prev =>
        prev.map((e, i) => (i === index ? { ...e, status: "error", error: message } : e))
      );
    }
  };

  // ── Upload ZIP ─────────────────────────────────────────────────────────────

  const uploadZip = async (index: number) => {
    const entry = entries[index];
    if (!entry || entry.kind !== "zip" || entry.status !== "idle") return;

    setEntries(prev =>
      prev.map((e, i) => (i === index ? { ...e, status: "uploading" } : e))
    );

    try {
      const fd = new FormData();
      fd.append("file", entry.file);
      const resp = await fetch("/api/upload-batch", { method: "POST", body: fd });
      if (!resp.ok) {
        const err = (await resp.json()) as { error?: string };
        throw new Error(err.error ?? "Batch upload failed");
      }
      const data = (await resp.json()) as {
        queued: number;
        results: BatchSubEntry[];
      };

      setEntries(prev =>
        prev.map((e, i) =>
          i === index
            ? {
                ...e,
                status: "success",
                subEntries: data.results,
                expanded: true,
              }
            : e
        )
      );
      utils.documents.list.invalidate();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Batch upload failed";
      setEntries(prev =>
        prev.map((e, i) => (i === index ? { ...e, status: "error", error: message } : e))
      );
    }
  };

  // ── Upload all ─────────────────────────────────────────────────────────────

  const uploadAll = () => {
    entries.forEach((e, i) => {
      if (e.status !== "idle") return;
      if (e.kind === "single") uploadSingle(i);
      else uploadZip(i);
    });
  };

  const readyCount = entries.filter(e => e.status === "idle").length;
  const successCount = entries.filter(e => e.status === "success").length;
  const allDone =
    entries.length > 0 &&
    entries.every(e => e.status === "success" || e.status === "error");

  return (
    <div className="container py-16 max-w-2xl">
      {/* Header */}
      <div className="animate-fade-up mb-10">
        <h1 className="font-serif text-4xl font-bold text-foreground mb-3">
          Upload Documents
        </h1>
        <p className="text-muted-foreground leading-relaxed">
          Add individual PDF or Word files, or upload a <strong>ZIP archive</strong> containing
          many documents at once. Text is extracted and semantically indexed automatically.
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "animate-fade-up stagger-1 relative cursor-pointer rounded-2xl border-2 border-dashed p-12 text-center transition-all duration-200",
          isDragging
            ? "border-primary bg-primary/5 scale-[1.01]"
            : "border-border/60 hover:border-primary/40 hover:bg-secondary/50"
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.zip"
          multiple
          onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
          className="hidden"
        />

        <div
          className={cn(
            "w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5 transition-all duration-200",
            isDragging
              ? "bg-primary text-primary-foreground scale-110"
              : "bg-muted text-muted-foreground"
          )}
        >
          <UploadIcon className="w-6 h-6" strokeWidth={1.5} />
        </div>

        <p className="text-base font-semibold text-foreground mb-1">
          {isDragging ? "Drop files here" : "Drag & drop files here"}
        </p>
        <p className="text-sm text-muted-foreground mb-5">or click to browse</p>

        {/* Accepted formats */}
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground/70">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted font-mono">
            <FileType2 className="w-3 h-3" /> PDF
          </span>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted font-mono">
            <FileText className="w-3 h-3" /> DOC
          </span>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted font-mono">
            <FileText className="w-3 h-3" /> DOCX
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent/10 text-accent font-mono border border-accent/20">
            <Package className="w-3 h-3" /> ZIP (batch)
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span>Max {MAX_DOC_SIZE_MB} MB / file · {MAX_ZIP_SIZE_MB} MB / ZIP</span>
        </div>
      </div>

      {/* File list */}
      {entries.length > 0 && (
        <div className="mt-6 space-y-3">
          {entries.map((entry, i) =>
            entry.kind === "single" ? (
              <SingleFileRow
                key={`${entry.file.name}-${i}`}
                entry={entry}
                onRemove={() => removeEntry(i)}
              />
            ) : (
              <ZipFileRow
                key={`${entry.file.name}-${i}`}
                entry={entry}
                onRemove={() => removeEntry(i)}
                onToggleExpand={() => toggleExpand(i)}
              />
            )
          )}
        </div>
      )}

      {/* Actions */}
      {entries.length > 0 && (
        <div className="animate-fade-up mt-6 flex items-center justify-between gap-4">
          <button
            onClick={() => setEntries([])}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors duration-150 link-underline"
          >
            Clear all
          </button>
          <div className="flex items-center gap-3">
            {allDone && successCount > 0 && (
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 text-sm text-primary font-medium link-underline"
              >
                Search documents
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            )}
            {readyCount > 0 && (
              <button
                onClick={uploadAll}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold shadow-soft hover:shadow-medium transition-all duration-150 hover:opacity-90 active:scale-[0.98]"
              >
                <UploadIcon className="w-4 h-4" />
                Upload {readyCount} item{readyCount !== 1 ? "s" : ""}
              </button>
            )}
          </div>
        </div>
      )}

      {/* How it works */}
      <div className="animate-fade-up stagger-2 mt-10 p-5 rounded-xl bg-secondary/60 border border-border/40">
        <h3 className="text-sm font-semibold text-foreground mb-3">How it works</h3>
        <ol className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
            <span>Upload individual PDF or Word files, or a <strong className="text-foreground">ZIP archive</strong> containing many documents at once.</span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
            <span>Each document is stored securely and its text is extracted automatically.</span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
            <span>A semantic vector embedding is generated and the document becomes instantly searchable via natural language.</span>
          </li>
        </ol>

        {/* ZIP tip */}
        <div className="mt-4 pt-4 border-t border-border/40 flex items-start gap-2.5">
          <Package className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Batch upload tip:</strong> Place all your PDF and Word files in a ZIP archive (up to {MAX_ZIP_SIZE_MB} MB, up to 200 files). Nested folders are supported — only PDF and DOCX files inside the archive will be processed.
          </p>
        </div>
      </div>
    </div>
  );
}
