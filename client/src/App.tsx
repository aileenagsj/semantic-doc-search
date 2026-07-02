import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import NavBar from "./components/NavBar";
import Home from "./pages/Home";
import UploadPage from "./pages/Upload";
import ManagePage from "./pages/Manage";

function Router() {
  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <NavBar />
      <main className="flex-1">
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/upload" component={UploadPage} />
          <Route path="/manage" component={ManagePage} />
          <Route path="/404" component={NotFound} />
          <Route component={NotFound} />
        </Switch>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/40 py-8 mt-auto">
        <div className="container flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground/60">
          <span className="font-serif font-semibold text-muted-foreground/80">
            Semantic<span className="text-accent">Search</span>
          </span>
          <span>Powered by vector embeddings · PDF &amp; Word document search</span>
        </div>
      </footer>
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster position="bottom-right" richColors />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
