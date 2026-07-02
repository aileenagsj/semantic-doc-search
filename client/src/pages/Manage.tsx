import { useState } from "react";
import {
  FileText,
  FileType2,
  Trash2,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  ChevronRight,
  FolderOpen,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

type Doc = {
  id: number;
  originalName: string;
  fileUrl: string;
  mimeType: string;
  fileSize: number;
  status: "processing" | "ready" | "error";
  errorMessage?: string | null;
  createdAt: Date;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusBadge({ status, errorMessage }: { status: Doc["status"]; errorMessage?: string | null }) {
  if (status === "ready") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-700">
        <CheckCircle2 className="w-3 h-3" />
        Indexed
      </span>
    );
  }
  if (status === "processing") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-100 text-blue-700">
        <Loader2 className="w-3 h-3 animate-spin" />
        Processing
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-700 cursor-help"
      title={errorMessage ?? "Processing failed"}
    >
      <XCircle className="w-3 h-3" />
      Error
    </span>
  );
}

function FileIcon({ mimeType }: { mimeType: string }) {
  const isPdf = mimeType.includes("pdf");
  return isPdf ? (
    <FileType2 className="w-5 h-5 text-destructive/60 flex-shrink-0" />
  ) : (
    <FileText className="w-5 h-5 text-primary/60 flex-shrink-0" />
  );
}

function DocRow({
  doc,
  onDelete,
}: {
  doc: Doc;
  onDelete: (id: number, name: string) => void;
}) {
  return (
    <tr className="group border-b border-border/40 hover:bg-secondary/30 transition-colors duration-100">
      <td className="py-4 px-5">
        <div className="flex items-center gap-3 min-w-0">
          <FileIcon mimeType={doc.mimeType} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate max-w-xs">
              {doc.originalName}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatBytes(doc.fileSize)}
            </p>
          </div>
        </div>
      </td>
      <td className="py-4 px-5 hidden sm:table-cell">
        <StatusBadge status={doc.status} errorMessage={doc.errorMessage} />
      </td>
      <td className="py-4 px-5 hidden md:table-cell">
        <span className="text-sm text-muted-foreground">
          {new Date(doc.createdAt).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </span>
      </td>
      <td className="py-4 px-5">
        <div className="flex items-center justify-end gap-1">
          <a
            href={doc.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors duration-150"
            title="Open document"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
          <button
            onClick={() => onDelete(doc.id, doc.originalName)}
            className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors duration-150"
            title="Delete document"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function ManagePage() {
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const utils = trpc.useUtils();

  const { data: docs, isLoading, isError } = trpc.documents.list.useQuery(undefined, {
    refetchInterval: (query) => {
      // Poll every 3s if any doc is still processing
      const data = query.state.data;
      if (data?.some(d => d.status === "processing")) return 3000;
      return false;
    },
  });

  const deleteMutation = trpc.documents.delete.useMutation({
    onSuccess: () => {
      utils.documents.list.invalidate();
      toast.success("Document deleted");
      setDeleteTarget(null);
    },
    onError: (err) => {
      toast.error(err.message ?? "Failed to delete document");
      setDeleteTarget(null);
    },
  });

  const handleDelete = (id: number, name: string) => {
    setDeleteTarget({ id, name });
  };

  const confirmDelete = () => {
    if (deleteTarget) deleteMutation.mutate({ id: deleteTarget.id });
  };

  const readyCount = docs?.filter(d => d.status === "ready").length ?? 0;
  const processingCount = docs?.filter(d => d.status === "processing").length ?? 0;
  const errorCount = docs?.filter(d => d.status === "error").length ?? 0;

  return (
    <div className="container py-16 max-w-4xl">
      {/* Header */}
      <div className="animate-fade-up flex items-start justify-between gap-4 mb-10">
        <div>
          <h1 className="font-serif text-4xl font-bold text-foreground mb-3">
            Documents
          </h1>
          <p className="text-muted-foreground leading-relaxed">
            Manage your indexed document library.
          </p>
        </div>
        <Link
          href="/upload"
          className="flex-shrink-0 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold shadow-soft hover:shadow-medium transition-all duration-150 hover:opacity-90 active:scale-[0.98]"
        >
          Upload
          <ChevronRight className="w-4 h-4" />
        </Link>
      </div>

      {/* Stats */}
      {docs && docs.length > 0 && (
        <div className="animate-fade-up stagger-1 grid grid-cols-3 gap-4 mb-8">
          {[
            { label: "Indexed", value: readyCount, color: "text-green-600", bg: "bg-green-50" },
            { label: "Processing", value: processingCount, color: "text-blue-600", bg: "bg-blue-50" },
            { label: "Errors", value: errorCount, color: "text-red-600", bg: "bg-red-50" },
          ].map(({ label, value, color, bg }) => (
            <div key={label} className={cn("rounded-xl p-4 border border-border/40", bg)}>
              <p className={cn("text-2xl font-bold font-serif", color)}>{value}</p>
              <p className="text-xs text-muted-foreground mt-0.5 font-medium">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-16 rounded-xl animate-shimmer" />
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="animate-fade-in rounded-xl bg-destructive/10 border border-destructive/20 p-6 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0" />
          <p className="text-sm text-destructive font-medium">
            Failed to load documents. Please refresh the page.
          </p>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && docs && docs.length === 0 && (
        <div className="animate-fade-in flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-5">
            <FolderOpen className="w-7 h-7 text-muted-foreground/50" />
          </div>
          <h3 className="font-serif text-xl font-semibold text-foreground mb-2">
            No documents yet
          </h3>
          <p className="text-muted-foreground text-sm max-w-xs leading-relaxed mb-6">
            Upload your first document to get started.
          </p>
          <Link
            href="/upload"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium shadow-soft hover:shadow-medium transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
          >
            Upload a document
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      )}

      {/* Table */}
      {!isLoading && !isError && docs && docs.length > 0 && (
        <div className="animate-fade-up stagger-2 bg-card rounded-2xl border border-border/60 shadow-soft overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/60 bg-secondary/40">
                <th className="py-3.5 px-5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Document
                </th>
                <th className="py-3.5 px-5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden sm:table-cell">
                  Status
                </th>
                <th className="py-3.5 px-5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">
                  Uploaded
                </th>
                <th className="py-3.5 px-5 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {docs.map(doc => (
                <DocRow key={doc.id} doc={doc} onDelete={handleDelete} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif text-xl">Delete document?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground leading-relaxed">
              <strong className="text-foreground">{deleteTarget?.name}</strong> will be permanently
              removed from your search index. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleteMutation.isPending}
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
