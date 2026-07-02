import { Link, useLocation } from "wouter";
import { Search, Upload, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Search", icon: Search },
  { href: "/upload", label: "Upload", icon: Upload },
  { href: "/manage", label: "Documents", icon: FolderOpen },
];

export default function NavBar() {
  const [location] = useLocation();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="container flex items-center justify-between h-16">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-soft transition-transform duration-200 group-hover:scale-105">
            <Search className="w-4 h-4 text-primary-foreground" strokeWidth={2.5} />
          </div>
          <span className="font-serif font-bold text-lg tracking-tight text-foreground">
            Semantic<span className="text-accent">Search</span>
          </span>
        </Link>

        {/* Nav links */}
        <nav className="flex items-center gap-1">
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
