import { Component, type ReactNode } from "react";

const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /ChunkLoadError/i,
  /Loading chunk \d+ failed/i,
  /Unable to preload CSS/i,
  /error loading dynamically imported module/i,
];

function isChunkError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return CHUNK_ERROR_PATTERNS.some(re => re.test(msg));
}

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  isChunkError: boolean;
}

export class ChunkErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, isChunkError: false };
  }

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      isChunkError: isChunkError(error),
    };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }) {
    const msg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? (error.stack ?? "") : "";
    const componentStack = info?.componentStack ?? "";

    if (isChunkError(error)) {
      console.warn("[ChunkErrorBoundary] Chunk load failure detected — app was likely redeployed.", error);
    } else {
      console.error("[ChunkErrorBoundary] React render error:", msg);
    }

    // Report to server (authenticated endpoint, sanitized payload — no user content)
    try {
      fetch("/api/debug/client-error", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg.slice(0, 300),
          stack: stack.slice(0, 800),
          componentStack: componentStack.slice(0, 500),
        }),
      }).catch(() => {});
    } catch {}
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.state.isChunkError) {
      return (
        <div className="flex flex-col items-center justify-center flex-1 h-full min-h-[60vh] text-center p-8 gap-4">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-2">
            <svg className="w-7 h-7 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold">App updated — please refresh</h2>
          <p className="text-muted-foreground text-sm max-w-xs">
            A new version of VoltSafe was deployed. Reload the page to get the latest version.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Hard refresh
          </button>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center flex-1 h-full min-h-[60vh] text-center p-8 gap-4">
        <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mb-2">
          <svg className="w-7 h-7 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <p className="text-muted-foreground text-sm max-w-xs">
          An unexpected error occurred. Please reload and try again.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Reload page
        </button>
      </div>
    );
  }
}
