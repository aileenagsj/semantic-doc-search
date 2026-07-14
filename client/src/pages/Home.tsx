import { useState, useRef, useEffect } from "react";
import { Search, Sparkles, FileText, FileType2, ExternalLink, ChevronRight } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { highlightTerms } from "@/lib/highlightTerms";
import { Link } from "wouter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Constants ────────────────────────────────────────────────────────────────

const TOP_K_OPTIONS = [3, 5, 10, 20] as const;
type TopKOption = (typeof TOP_K_OPTIONS)[number];
const DEFAULT_TOP_K: TopKOption = 10;
const LS_KEY = "semanticSearch_topK";

function loadTopK(): TopKOption {
  try {
    const stored = localStorage.getItem(LS_KEY);
    const n = stored ? parseInt(stored, 10) : NaN;
    return (TOP_K_OPTIONS as readonly number[]).includes(n) ? (n as TopKOption) : DEFAULT_TOP_K;
  } catch {
    return DEFAULT_TOP_K;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

type SearchResult = {
  id: number;
  originalName: string;
  fileUrl: string;
  mimeType: string;
  score: number;
  snippet: string;
  createdAt: Date;
};

function ScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const cls =
    pct >= 70 ? "score-high" : pct >= 40 ? "score-medium" : "score-low";
  const label = pct >= 70 ? "Strong match" : pct >= 40 ? "Good match" : "Partial match";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full", cls)}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {label} · {pct}%
    </span>
  );
}

function FileIcon({ mimeType }: { mimeType: string }) {
  const isPdf = mimeType.includes("pdf");
  return isPdf ? (
    <FileType2 className="w-5 h-5 text-destructive/70 flex-shrink-0" />
  ) : (
    <FileText className="w-5 h-5 text-primary/70 flex-shrink-0" />
  );
}

function ResultCard({ result, index, query }: { result: SearchResult; index: number; query: string }) {
  return (
    <article
      className={cn(
        "animate-fade-up group relative bg-card rounded-xl border border-border/60 shadow-soft hover:shadow-medium transition-all duration-200 overflow-hidden",
        `stagger-${Math.min(index + 1, 5)}`
      )}
    >
      {/* Accent bar */}
      <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b from-accent/60 to-primary/30 rounded-l-xl" />

      <div className="p-6 pl-7">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <FileIcon mimeType={result.mimeType} />
            <h3 className="font-semibold text-foreground truncate text-base leading-tight">
              {result.originalName}
            </h3>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <ScoreBadge score={result.score} />
            <a
              href={result.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors duration-150"
              title="Open document"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        {/* Snippet */}
        {result.snippet && (
          <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
            {highlightTerms(result.snippet, query).map((segment, i) => (
              <span
                key={i}
                className={segment.isMatch ? "bg-accent/30 text-accent-foreground font-semibold" : ""}
              >
                {segment.text}
              </span>
            ))}
          </p>
        )}

        {/* Footer */}
        <div className="mt-3 pt-3 border-t border-border/40 flex items-center justify-between">
          <span className="text-xs text-muted-foreground/70">
            {new Date(result.createdAt).toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </span>
          <span className="text-xs text-muted-foreground/70 font-mono">
            #{result.id}
          </span>
        </div>
      </div>
    </article>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="animate-fade-in flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-5">
        <Search className="w-7 h-7 text-muted-foreground/50" />
      </div>
      <h3 className="font-serif text-xl font-semibold text-foreground mb-2">
        No results found
      </h3>
      <p className="text-muted-foreground text-sm max-w-xs leading-relaxed">
        No documents matched <strong>"{query}"</strong>. Try different keywords or{" "}
        <Link href="/upload" className="text-primary underline underline-offset-2">
          upload more documents
        </Link>
        .
      </p>
    </div>
  );
}

function NoDocumentsState() {
  return (
    <div className="animate-fade-in flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-5">
        <FileText className="w-7 h-7 text-muted-foreground/50" />
      </div>
      <h3 className="font-serif text-xl font-semibold text-foreground mb-2">
        No documents yet
      </h3>
      <p className="text-muted-foreground text-sm max-w-xs leading-relaxed mb-6">
        Upload your first PDF or Word document to start searching.
      </p>
      <Link
        href="/upload"
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium shadow-soft hover:shadow-medium transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
      >
        Upload a document
        <ChevronRight className="w-4 h-4" />
      </Link>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [topK, setTopK] = useState<TopKOption>(loadTopK);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: allDocs } = trpc.documents.list.useQuery();
  const hasDocuments = allDocs && allDocs.length > 0;

  const {
    data: results,
    isFetching,
    isError,
  } = trpc.documents.search.useQuery(
    { query: submittedQuery, topK },
    { enabled: submittedQuery.length > 0 }
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed) setSubmittedQuery(trimmed);
  };

  const handleTopKChange = (val: string) => {
    const n = parseInt(val, 10) as TopKOption;
    setTopK(n);
    try { localStorage.setItem(LS_KEY, String(n)); } catch { /* ignore */ }
    // Re-run the current query with the new limit if one is active
    if (submittedQuery) setSubmittedQuery(submittedQuery);
  };

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const showResults = submittedQuery.length > 0;
  const showSkeleton = isFetching;

  return (
    <div className="min-h-[calc(100dvh-4rem)]">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Background texture */}
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, oklch(0.18 0.025 255) 1px, transparent 0)",
            backgroundSize: "32px 32px",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background via-background to-transparent" />

        <div className="container relative pt-20 pb-16">
          {/* Eyebrow */}
          <div className="animate-fade-up flex justify-center mb-6">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-accent border border-accent/30 rounded-full px-3.5 py-1.5 bg-accent/5">
              <Sparkles className="w-3 h-3" />
              Semantic Search
            </span>
          </div>

          {/* Headline */}
          <div className="animate-fade-up stagger-1 text-center mb-4">
            <h1 className="font-serif text-5xl sm:text-6xl lg:text-7xl font-bold text-foreground leading-[1.1] tracking-tight">
              Find anything in
              <br />
              <span className="text-gradient">your documents</span>
            </h1>
          </div>

          {/* Subhead */}
          <p className="animate-fade-up stagger-2 text-center text-muted-foreground text-lg sm:text-xl max-w-xl mx-auto mb-12 leading-relaxed">
            Natural language search across all your PDFs and Word documents.
            No keywords required — just ask.
          </p>

          {/* Search form */}
          <form
            onSubmit={handleSearch}
            className="animate-fade-up stagger-3 max-w-2xl mx-auto"
          >
            <div className="relative group">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-primary/20 to-accent/20 blur-xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-500" />
              <div className="relative flex items-center bg-card border border-border shadow-medium rounded-2xl overflow-hidden transition-all duration-200 group-focus-within:border-primary/40 group-focus-within:shadow-strong">
                <Search className="w-5 h-5 text-muted-foreground ml-5 flex-shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search your documents…"
                  className="flex-1 px-4 py-5 bg-transparent text-foreground placeholder:text-muted-foreground/60 text-base focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!query.trim() || isFetching}
                  className="m-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold transition-all duration-150 hover:opacity-90 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed shadow-soft"
                >
                  {isFetching ? "Searching…" : "Search"}
                </button>
              </div>
            </div>

            {/* Controls row: result count selector */}
            <div className="flex items-center justify-end gap-2 mt-3">
              <label className="text-xs text-muted-foreground/70 font-medium">
                Show
              </label>
              <Select value={String(topK)} onValueChange={handleTopKChange}>
                <SelectTrigger className="h-7 w-20 text-xs rounded-lg border-border/60 bg-card shadow-none focus:ring-0 focus:ring-offset-0 px-2.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end" className="min-w-[5rem]">
                  {TOP_K_OPTIONS.map(n => (
                    <SelectItem key={n} value={String(n)} className="text-xs">
                      {n} results
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </form>

          {/* Hint */}
          {!showResults && (
            <p className="animate-fade-up stagger-4 text-center text-xs text-muted-foreground/60 mt-2">
              Try: "quarterly revenue report" · "project timeline" · "legal contract terms"
            </p>
          )}
        </div>
      </section>

      {/* ── Results ──────────────────────────────────────────────────────── */}
      <section className="container pb-20">
        {/* Result header */}
        {showResults && !showSkeleton && results && results.length > 0 && (
          <div className="animate-fade-in flex items-center justify-between mb-6">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{results.length}</span>{" "}
              result{results.length !== 1 ? "s" : ""} for{" "}
              <span className="font-semibold text-foreground">"{submittedQuery}"</span>
            </p>
            <button
              onClick={() => { setQuery(""); setSubmittedQuery(""); }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors duration-150 link-underline"
            >
              Clear
            </button>
          </div>
        )}

        {/* Skeleton */}
        {showSkeleton && (
          <div className="space-y-4">
            {Array.from({ length: Math.min(topK, 5) }).map((_, i) => (
              <div key={i} className="bg-card rounded-xl border border-border/60 p-6 shadow-soft">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-5 h-5 rounded animate-shimmer" />
                  <div className="h-4 w-48 rounded animate-shimmer" />
                  <div className="ml-auto h-6 w-24 rounded-full animate-shimmer" />
                </div>
                <div className="space-y-2">
                  <div className="h-3 w-full rounded animate-shimmer" />
                  <div className="h-3 w-4/5 rounded animate-shimmer" />
                  <div className="h-3 w-3/5 rounded animate-shimmer" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="animate-fade-in rounded-xl bg-destructive/10 border border-destructive/20 p-6 text-center">
            <p className="text-sm text-destructive font-medium">
              Search failed. Please try again.
            </p>
          </div>
        )}

        {/* Results list */}
        {!showSkeleton && showResults && results && results.length > 0 && (
          <div className="space-y-4">
            {results.map((r, i) => (
              <ResultCard key={r.id} result={r} index={i} query={submittedQuery} />
            ))}
          </div>
        )}

        {/* Empty state — no results */}
        {!showSkeleton && showResults && results && results.length === 0 && (
          <EmptyState query={submittedQuery} />
        )}

        {/* Initial state — no query yet */}
        {!showResults && !hasDocuments && <NoDocumentsState />}

        {/* Initial state — has documents, no query */}
        {!showResults && hasDocuments && (
          <div className="animate-fade-in mt-2">
            <p className="text-sm font-medium text-muted-foreground mb-4 text-center">
              {allDocs.length} document{allDocs.length !== 1 ? "s" : ""} indexed · ready to search
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-w-2xl mx-auto">
              {allDocs.slice(0, 8).map(doc => (
                <button
                  key={doc.id}
                  onClick={() => {
                    const name = doc.originalName.replace(/\.[^.]+$/, "");
                    setQuery(name);
                    setSubmittedQuery(name);
                  }}
                  className="flex items-center gap-2 p-3 rounded-xl bg-card border border-border/60 text-left text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 hover:shadow-soft transition-all duration-150 truncate group"
                >
                  <FileText className="w-3.5 h-3.5 flex-shrink-0 text-primary/50 group-hover:text-primary/80 transition-colors" />
                  <span className="truncate">{doc.originalName}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
