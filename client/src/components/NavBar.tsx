import { Link, useLocation } from "wouter";
import { Search, Upload, FolderOpen, Cpu, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const links = [
  { href: "/", label: "Search", icon: Search },
  { href: "/upload", label: "Upload", icon: Upload },
  { href: "/manage", label: "Documents", icon: FolderOpen },
];

function SidecarBadge() {
  const { data, isLoading } = trpc.documents.sidecarStatus.useQuery(undefined, {
    refetchInterval: 30_000, // re-check every 30 s
    staleTime: 20_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/50 bg-secondary/50">
        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-pulse" />
        <span className="text-xs text-muted-foreground/60 font-medium hidden sm:inline">Checking…</span>
      </div>
    );
  }

  const connected = data?.connected ?? false;

  const label = connected
    ? (data?.model ? `Ollama · ${data.model}` : "Sidecar connected")
    : (data?.url ? "Sidecar unreachable" : "Fallback mode");

  const detail = connected
    ? `${data?.totalDocuments ?? 0} docs · ${data?.totalVectors ?? 0} vectors · chunk ${data?.chunkSize ?? "?"}`
    : data?.url
      ? `Cannot reach ${data.url} — using n-gram fallback`
      : "Set EMBED_SERVICE_URL to connect a remote Ollama/FAISS sidecar";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium cursor-default select-none transition-colors",
            connected
              ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400"
              : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400"
          )}
        >
          {connected ? (
            <Cpu className="w-3 h-3 shrink-0" strokeWidth={2.5} />
          ) : (
            <AlertCircle className="w-3 h-3 shrink-0" strokeWidth={2.5} />
          )}
          <span className="hidden sm:inline truncate max-w-[140px]">{label}</span>
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full shrink-0",
              connected ? "bg-emerald-500" : "bg-amber-500"
            )}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs text-xs">
        <p className="font-semibold mb-0.5">{connected ? "Sidecar connected" : "Sidecar offline"}</p>
        <p className="text-muted-foreground">{detail}</p>
        {!connected && (
          <p className="mt-1 text-muted-foreground/70">
            See <code className="font-mono">embed_service/DEPLOY.md</code> to set up a remote sidecar.
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export default function NavBar() {
  const [location] = useLocation();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="container flex items-center justify-between h-16 gap-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group shrink-0">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-soft transition-transform duration-200 group-hover:scale-105">
            <Search className="w-4 h-4 text-primary-foreground" strokeWidth={2.5} />
          </div>
          <span className="font-serif font-bold text-lg tracking-tight text-foreground">
            Semantic<span className="text-accent">Search</span>
          </span>
        </Link>

        {/* Status badge — centre on wide screens */}
        <div className="flex-1 flex justify-center">
          <SidecarBadge />
        </div>

        {/* Nav links */}
        <nav className="flex items-center gap-1 shrink-0">
          {links.map(({ href, label, icon: Icon }) => {
            const isActive = location === href;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-150",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-soft"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                )}
              >
                <Icon className="w-3.5 h-3.5" strokeWidth={2} />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
