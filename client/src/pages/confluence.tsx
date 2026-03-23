import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Search, RefreshCw, ExternalLink, FileText, Clock, User, AlertCircle } from "lucide-react";
import { SiConfluence } from "react-icons/si";

type ConfluenceSpace = {
  key: string;
  name: string;
  type: string;
  status: string;
};

type ConfluencePage = {
  id: string;
  title: string;
  type: string;
  status: string;
  _links: { webui: string; base: string };
  space?: { key: string; name: string };
  history?: { lastUpdated: { by: { displayName: string }; when: string } };
  version?: { when: string; by: { displayName: string } };
};

function timeAgo(dateStr: string | undefined) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

export default function ConfluencePage() {
  const { toast } = useToast();
  const [selectedSpace, setSelectedSpace] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const spacesQuery = useQuery<{ results: ConfluenceSpace[]; size: number }>({
    queryKey: ["/api/confluence/spaces"],
    queryFn: async () => {
      const res = await fetch("/api/confluence/spaces", { credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to load spaces");
      return res.json();
    },
  });

  const pagesQuery = useQuery<{ results: ConfluencePage[]; totalSize: number }>({
    queryKey: ["/api/confluence/pages", selectedSpace, searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedSpace !== "all") params.set("space", selectedSpace);
      if (searchQuery) params.set("q", searchQuery);
      const res = await fetch(`/api/confluence/pages?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to load pages");
      return res.json();
    },
  });

  const spaces = spacesQuery.data?.results || [];
  const pages = pagesQuery.data?.results || [];
  const isConnected = !spacesQuery.error;

  const getSiteUrl = (page: ConfluencePage) => {
    return page._links?.base
      ? `${page._links.base}${page._links.webui}`
      : page._links?.webui || "#";
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(search);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      <div className="flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-border/50 bg-card/50 flex-shrink-0">
        <SiConfluence className="h-5 w-5 text-[#0052CC]" />
        <div>
          <h1 className="text-lg font-bold leading-tight" data-testid="text-page-title">Confluence</h1>
          <p className="text-xs text-muted-foreground">
            {spacesQuery.isLoading ? "Loading..." : isConnected ? `${spaces.length} space${spaces.length !== 1 ? "s" : ""}` : "Not connected"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/confluence/spaces"] });
              queryClient.invalidateQueries({ queryKey: ["/api/confluence/pages"] });
            }}
            data-testid="button-refresh-confluence"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {!isConnected && !spacesQuery.isLoading && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
          <SiConfluence className="h-12 w-12 text-[#0052CC] opacity-50" />
          <p className="text-lg font-semibold">Confluence not connected</p>
          <p className="text-sm text-muted-foreground max-w-sm">{(spacesQuery.error as Error)?.message}</p>
        </div>
      )}

      {isConnected && (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          {/* Space filter + search */}
          <div className="flex-shrink-0 px-4 sm:px-6 py-2 border-b border-border/50 bg-background/50 space-y-2">
            <form onSubmit={handleSearch} className="relative max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search pages..."
                className="pl-8 h-8 text-sm"
                data-testid="input-search-confluence"
              />
            </form>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground font-medium">Space:</span>
              <button
                onClick={() => setSelectedSpace("all")}
                data-testid="filter-space-all"
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${selectedSpace === "all" ? "bg-primary/10 border-primary/30 text-primary" : "border-border/50 text-muted-foreground hover:border-border"}`}
              >
                All spaces
              </button>
              {spacesQuery.isLoading
                ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-6 w-20 rounded-full" />)
                : spaces.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setSelectedSpace(s.key)}
                    data-testid={`filter-space-${s.key}`}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${selectedSpace === s.key ? "bg-primary/10 border-primary/30 text-primary" : "border-border/50 text-muted-foreground hover:border-border"}`}
                  >
                    {s.name}
                  </button>
                ))}
              <span className="ml-auto text-xs text-muted-foreground">
                {pagesQuery.data ? `${pagesQuery.data.totalSize} page${pagesQuery.data.totalSize !== 1 ? "s" : ""}` : ""}
              </span>
            </div>
          </div>

          {/* Pages list */}
          <div className="flex-1 overflow-y-auto">
            {pagesQuery.isLoading && (
              <div className="p-4 space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-border/40">
                    <Skeleton className="h-4 w-4 rounded" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {pagesQuery.error && (
              <div className="p-8 text-center">
                <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm text-muted-foreground">{(pagesQuery.error as Error).message}</p>
              </div>
            )}
            {!pagesQuery.isLoading && !pagesQuery.error && pages.length === 0 && (
              <div className="p-8 text-center">
                <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm text-muted-foreground">
                  {searchQuery ? `No pages found for "${searchQuery}"` : "No pages found"}
                </p>
              </div>
            )}
            {pages.map((page) => {
              const updatedBy = page.history?.lastUpdated?.by?.displayName || page.version?.by?.displayName;
              const updatedAt = page.history?.lastUpdated?.when || page.version?.when;
              return (
                <a
                  key={page.id}
                  href={getSiteUrl(page)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 px-4 sm:px-6 py-3 border-b border-border/30 hover:bg-muted/30 transition-colors group"
                  data-testid={`page-row-${page.id}`}
                >
                  <FileText className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{page.title}</p>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      {page.space && (
                        <span className="text-[11px] text-muted-foreground">{page.space.name}</span>
                      )}
                      {updatedBy && (
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {updatedBy}
                        </span>
                      )}
                      {updatedAt && (
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {timeAgo(updatedAt)}
                        </span>
                      )}
                    </div>
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5" />
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
