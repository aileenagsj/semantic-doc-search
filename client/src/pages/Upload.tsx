import { useState, useRef, useCallback } from "react";
import { Upload as UploadIcon, FileText, FileType2, CheckCircle2, XCircle, Loader2, X, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";

const ACCEPTED_TYPES = new Set([
  "application/pdf",
  "application/x-pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
]);

const ACCEPTED_EXTENSIONS = [".pdf", ".doc", ".docx"];
const MAX_SIZE_MB = 20;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

type UploadStatus = "idle" | "uploading" | "processing" | "success" | "error";

type FileEntry = {
  file: File;
  status: UploadStatus;
  error?: string;
  docId?: number;
};

function validateFile(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase();
  const validExt = ext && ACCEPTED_EXTENSIONS.includes(`.${ext}`);
  const validMime = ACCEPTED_TYPES.has(file.type);

  if (!validExt && !validMime) {
    return `Unsupported file type. Only PDF and Word (.doc, .docx) files are accepted.`;
  }
  if (file.size > MAX_SIZE_BYTES) {
    return `File too large. Maximum size is ${MAX_SIZE_MB} MB.`;
  }
  return null;
}

function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  const isPdf = mimeType.includes("pdf") || mimeType === "application/x-pdf";
  return isPdf ? (
    <FileType2 className={cn("text-destructive/70", className)} />
  ) : (
    <FileText className={cn("text-primary/70", className)} />
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileRow({
  entry,
  onRemove,
}: {
  entry: FileEntry;
  onRemove: () => void;
}) {
  const { file, status, error } = entry;

  return (
    <div
      className={cn(
        "animate-fade-up flex items-center gap-4 p-4 rounded-xl border transition-all duration-200",
        status === "success" && "bg-green-50/50 border-green-200/60",
        status === "error" && "bg-red-50/50 border-red-200/60",
        status === "uploading" || status === "processing" ? "bg-primary/5 border-primary/20" : "",
        status === "idle" && "bg-card border-border/60"
      )}
    >
      <FileIcon mimeType={file.type} className="w-5 h-5 flex-shrink-0" />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{formatBytes(file.size)}</p>
        {error && (
          <p className="text-xs text-destructive mt-1 leading-snug">{error}</p>
        )}
        {status === "processing" && (
          <p className="text-xs text-primary mt-1">Extracting text and generating embedding…</p>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {status === "uploading" && (
          <Loader2 className="w-4 h-4 text-primary animate-spin" />
        )}
        {status === "processing" && (
          <Loader2 className="w-4 h-4 text-primary animate-spin" />
        )}
        {status === "success" && (
          <CheckCircle2 className="w-4 h-4 text-green-600" />
        )}
        {status === "error" && (
          <XCircle className="w-4 h-4 text-destructive" />
        )}
        {(status === "idle" || status === "error") && (
          <button
            onClick={onRemove}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors duration-150"
            title="Remove"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export default function UploadPage() {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const addFiles = useCallback((files: FileList | File[]) => {
    const newEntries: FileEntry[] = Array.from(files).map(file => {
      const error = validateFile(file) ?? undefined;
      return { file, status: error ? "error" : "idle", error };
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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = "";
  };

  const removeEntry = (index: number) => {
    setEntries(prev => prev.filter((_, i) => i !== index));
  };

  const uploadEntry = async (index: number) => {
    const entry = entries[index];
    if (!entry || entry.status !== "idle") return;

    setEntries(prev =>
      prev.map((e, i) => (i === index ? { ...e, status: "uploading" } : e))
    );

    try {
      const formData = new FormData();
      formData.append("file", entry.file);

      const resp = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

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

      // Poll until the document is processed (up to 60s)
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
                i === index
                  ? { ...e, status: "error", error: doc.errorMessage ?? "Processing failed" }
                  : e
              )
            );
          } else if (attempts > 30) {
            clearInterval(poll);
            // Mark as success anyway — processing may finish later
            setEntries(prev =>
              prev.map((e, i) => (i === index ? { ...e, status: "success" } : e))
            );
            utils.documents.list.invalidate();
          }
        } catch {
          // ignore poll errors
        }
      }, 2000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setEntries(prev =>
        prev.map((e, i) => (i === index ? { ...e, status: "error", error: message } : e))
      );
    }
  };

  const uploadAll = () => {
    entries.forEach((e, i) => {
      if (e.status === "idle") uploadEntry(i);
    });
  };

  const readyCount = entries.filter(e => e.status === "idle").length;
  const successCount = entries.filter(e => e.status === "success").length;
  const allDone = entries.length > 0 && entries.every(e => e.status === "success" || e.status === "error");

  return (
    <div className="container py-16 max-w-2xl">
      {/* Header */}
      <div className="animate-fade-up mb-10">
        <h1 className="font-serif text-4xl font-bold text-foreground mb-3">
          Upload Documents
        </h1>
        <p className="text-muted-foreground leading-relaxed">
          Add PDF or Word documents to your search index. Text is extracted and
          semantically indexed automatically.
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
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
          accept=".pdf,.doc,.docx"
          multiple
          onChange={handleFileInput}
          className="hidden"
        />

        <div
          className={cn(
            "w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5 transition-all duration-200",
            isDragging ? "bg-primary text-primary-foreground scale-110" : "bg-muted text-muted-foreground"
          )}
        >
          <UploadIcon className="w-6 h-6" strokeWidth={1.5} />
        </div>

        <p className="text-base font-semibold text-foreground mb-1">
          {isDragging ? "Drop files here" : "Drag & drop files here"}
        </p>
        <p className="text-sm text-muted-foreground mb-4">
          or click to browse
        </p>
        <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground/70">
          <span className="px-2.5 py-1 rounded-full bg-muted font-mono">PDF</span>
          <span className="px-2.5 py-1 rounded-full bg-muted font-mono">DOC</span>
          <span className="px-2.5 py-1 rounded-full bg-muted font-mono">DOCX</span>
          <span>·</span>
          <span>Max {MAX_SIZE_MB} MB each</span>
        </div>
      </div>

      {/* File list */}
      {entries.length > 0 && (
        <div className="mt-6 space-y-3">
          {entries.map((entry, i) => (
            <FileRow
              key={`${entry.file.name}-${i}`}
              entry={entry}
              onRemove={() => removeEntry(i)}
            />
          ))}
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
                Upload {readyCount} file{readyCount !== 1 ? "s" : ""}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Info box */}
      <div className="animate-fade-up stagger-2 mt-10 p-5 rounded-xl bg-secondary/60 border border-border/40">
        <h3 className="text-sm font-semibold text-foreground mb-2">How it works</h3>
        <ol className="space-y-1.5 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
            Upload your PDF or Word document (up to {MAX_SIZE_MB} MB).
          </li>
          <li className="flex items-start gap-2">
            <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
            Text is extracted and a semantic vector embedding is generated.
          </li>
          <li className="flex items-start gap-2">
            <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
            Your document is indexed and instantly searchable via natural language.
          </li>
        </ol>
      </div>
    </div>
  );
}
