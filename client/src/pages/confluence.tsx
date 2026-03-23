import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, RefreshCw, ExternalLink, FileText, Clock, User, ChevronRight, AlertTriangle, BookOpen } from "lucide-react";
import { SiConfluence } from "react-icons/si";

const SITE_URL = "https://voltsafe.atlassian.net/wiki";

type ConfluenceSpace = { key: string; name: string };

type ConfluencePage = {
  id: string; title: string; type: string; status: string;
  _links: { webui?: string; base?: string };
  space?: { key: string; name: string };
  history?: { lastUpdated: { by: { displayName: string; profilePicture?: { path: string } }; when: string } };
  version?: { when: string; by: { displayName: string; profilePicture?: { path: string } } };
};

const SPACE_COLORS: Record<string, string> = {
  MKT: "bg-pink-500", ADMIN: "bg-slate-500", SF: "bg-amber-500",
  ENGINEERIN: "bg-blue-600", MOLLY: "bg-teal-500", SOFT: "bg-violet-500",
  VSHW: "bg-orange-500", VS: "bg-emerald-500", IT: "bg-cyan-500",
};

function spaceColor(key: string) {
  return SPACE_COLORS[key] || "bg-[#0052CC]";
}

function SpaceAvatar({ spaceKey, name, size = "sm" }: { spaceKey: string; name: string; size?: "sm" | "md" }) {
  const bg = spaceColor(spaceKey);
  const dim = size === "md" ? "h-9 w-9 text-sm" : "h-6 w-6 text-[10px]";
  return (
    <div className={`${dim} ${bg} rounded flex items-center justify-center text-white font-bold flex-shrink-0`}>
      {spaceKey.slice(0, 2)}
    </div>
  );
}

function timeAgo(dateStr: string | undefined) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function ConfluencePage() {
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

  const pagesQuery = useQuery<{ results: ConfluencePage[]; totalSize?: number; size?: number }>({
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

  const pageUrl = (page: ConfluencePage) => {
    if (page._links?.webui) return `${SITE_URL}${page._links.webui}`;
    return SITE_URL;
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(search);
    setSelectedSpace("all");
  };

  const selectedSpaceData = spaces.find(s => s.key === selectedSpace);
  const pageCount = pagesQuery.data?.totalSize ?? pagesQuery.data?.size ?? pages.length;

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Left: Space sidebar */}
      <div className="w-52 flex-shrink-0 border-r border-border/50 bg-card/30 flex flex-col overflow-hidden">
        <div className="px-3 py-2.5 border-b border-border/50 flex items-center gap-2">
          <SiConfluence className="h-4 w-4 text-[#0052CC] flex-shrink-0" />
          <span className="text-xs font-semibold text-foreground">Spaces</span>
          <button
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => { queryClient.invalidateQueries({ queryKey: ["/api/confluence/spaces"] }); queryClient.invalidateQueries({ queryKey: ["/api/confluence/pages"] }); }}
            data-testid="button-refresh-confluence"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          <button
            onClick={() => { setSelectedSpace("all"); setSearchQuery(""); setSearch(""); }}
            data-testid="filter-space-all"
            className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors ${selectedSpace === "all" && !searchQuery ? "bg-[#0052CC]/10 border-l-2 border-[#0052CC]" : "border-l-2 border-transparent"}`}
          >
            <div className="h-6 w-6 rounded bg-muted flex items-center justify-center flex-shrink-0">
              <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <span className={`text-xs truncate ${selectedSpace === "all" && !searchQuery ? "text-foreground font-medium" : "text-muted-foreground"}`}>All spaces</span>
          </button>

          {spacesQuery.isLoading
            ? Array.from({ length: 5 }).map((_, i) => <div key={i} className="px-3 py-2 flex items-center gap-2"><Skeleton className="h-6 w-6 rounded" /><Skeleton className="h-3 flex-1" /></div>)
            : spaces.map((s) => (
              <button
                key={s.key}
                onClick={() => { setSelectedSpace(s.key); setSearchQuery(""); setSearch(""); }}
                data-testid={`filter-space-${s.key}`}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors ${selectedSpace === s.key ? "bg-[#0052CC]/10 border-l-2 border-[#0052CC]" : "border-l-2 border-transparent"}`}
              >
                <SpaceAvatar spaceKey={s.key} name={s.name} />
                <span className={`text-xs truncate ${selectedSpace === s.key ? "text-foreground font-medium" : "text-muted-foreground"}`}>{s.name}</span>
              </button>
            ))}
        </div>
        <div className="p-2 border-t border-border/50">
          <a href={SITE_URL} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            data-testid="link-confluence-open">
            <ExternalLink className="h-3 w-3" /> Open in Confluence
          </a>
        </div>
      </div>

      {/* Right: Pages */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!isConnected && !spacesQuery.isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
            <SiConfluence className="h-14 w-14 text-[#0052CC] opacity-30" />
            <p className="text-lg font-semibold">Confluence not connected</p>
            <p className="text-sm text-muted-foreground max-w-sm">{(spacesQuery.error as Error)?.message}</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex-shrink-0 px-4 py-2.5 border-b border-border/50 bg-card/20">
              <div className="flex items-center gap-3">
                {selectedSpace !== "all" && selectedSpaceData ? (
                  <>
                    <SpaceAvatar spaceKey={selectedSpaceData.key} name={selectedSpaceData.name} size="md" />
                    <div>
                      <h2 className="font-semibold text-sm">{selectedSpaceData.name}</h2>
                      <p className="text-xs text-muted-foreground font-mono">{selectedSpaceData.key}</p>
                    </div>
                  </>
                ) : searchQuery ? (
                  <div>
                    <h2 className="font-semibold text-sm">Search results for "{searchQuery}"</h2>
                    <p className="text-xs text-muted-foreground">across all spaces</p>
                  </div>
                ) : (
                  <div>
                    <h2 className="font-semibold text-sm">Recent pages</h2>
                    <p className="text-xs text-muted-foreground">across all spaces</p>
                  </div>
                )}
                <form onSubmit={handleSearch} className="ml-auto flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <Input value={search} onChange={e => setSearch(e.target.value)}
                      placeholder="Search in Confluence..." className="pl-8 h-7 text-xs w-56 bg-background/50"
                      data-testid="input-search-confluence" />
                  </div>
                  <Button type="submit" size="sm" variant="outline" className="h-7 text-xs">Search</Button>
                  {searchQuery && (
                    <button type="button" onClick={() => { setSearch(""); setSearchQuery(""); }}
                      className="text-xs text-[#0052CC] hover:underline">Clear</button>
                  )}
                </form>
              </div>
            </div>

            {/* Column headers */}
            <div className="flex-shrink-0 flex items-center px-4 py-1.5 border-b border-border/50 bg-muted/20 text-[11px] text-muted-foreground font-medium uppercase tracking-wide gap-3">
              <span className="flex-1 min-w-0">Title</span>
              <span className="w-32 flex-shrink-0">Space</span>
              <span className="w-36 flex-shrink-0">Last updated by</span>
              <span className="w-24 flex-shrink-0 text-right">When</span>
              <span className="w-5 flex-shrink-0" />
            </div>

            {/* Page list */}
            <div className="flex-1 overflow-y-auto">
              {pagesQuery.isLoading && (
                <div className="divide-y divide-border/30">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3">
                      <Skeleton className="h-4 w-4 rounded flex-shrink-0" />
                      <Skeleton className="h-3 flex-1" />
                      <Skeleton className="h-4 w-24 rounded" />
                      <Skeleton className="h-4 w-5 rounded-full" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  ))}
                </div>
              )}
              {pagesQuery.error && (
                <div className="flex flex-col items-center justify-center p-12 gap-3 text-center">
                  <AlertTriangle className="h-8 w-8 text-muted-foreground opacity-40" />
                  <p className="text-sm text-muted-foreground">{(pagesQuery.error as Error).message}</p>
                </div>
              )}
              {!pagesQuery.isLoading && !pagesQuery.error && pages.length === 0 && (
                <div className="flex flex-col items-center justify-center p-12 gap-2 text-center">
                  <FileText className="h-8 w-8 text-muted-foreground opacity-30" />
                  <p className="text-sm text-muted-foreground">
                    {searchQuery ? `No pages found for "${searchQuery}"` : "No pages found in this space"}
                  </p>
                </div>
              )}
              <div className="divide-y divide-border/20">
                {pages.map((page) => {
                  const updatedBy = page.history?.lastUpdated?.by?.displayName || page.version?.by?.displayName;
                  const avatarPath = page.history?.lastUpdated?.by?.profilePicture?.path || page.version?.by?.profilePicture?.path;
                  const updatedAt = page.history?.lastUpdated?.when || page.version?.when;
                  const spaceKey = page.space?.key || "";
                  return (
                    <a
                      key={page.id}
                      href={pageUrl(page)}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid={`page-row-${page.id}`}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors group"
                    >
                      <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0 group-hover:text-[#0052CC] transition-colors" />
                      <span className="flex-1 min-w-0 text-sm truncate group-hover:text-[#0052CC] transition-colors">{page.title}</span>
                      {page.space && (
                        <div className="w-32 flex-shrink-0 flex items-center gap-1.5 overflow-hidden">
                          <div className={`h-4 w-4 rounded-sm ${spaceColor(spaceKey)} flex items-center justify-center text-white text-[8px] font-bold flex-shrink-0`}>
                            {spaceKey.slice(0, 2)}
                          </div>
                          <span className="text-xs text-muted-foreground truncate">{page.space.name}</span>
                        </div>
                      )}
                      <div className="w-36 flex-shrink-0 flex items-center gap-1.5 overflow-hidden">
                        {avatarPath ? (
                          <img src={`https://voltsafe.atlassian.net${avatarPath}`} alt="" className="h-5 w-5 rounded-full flex-shrink-0" />
                        ) : (
                          <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                            <User className="h-3 w-3 text-muted-foreground" />
                          </div>
                        )}
                        <span className="text-xs text-muted-foreground truncate">{updatedBy || "Unknown"}</span>
                      </div>
                      <span className="w-24 flex-shrink-0 text-right text-xs text-muted-foreground">{timeAgo(updatedAt)}</span>
                      <ChevronRight className="w-5 flex-shrink-0 h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </a>
                  );
                })}
              </div>
              {pages.length > 0 && (
                <p className="text-center text-xs text-muted-foreground py-3">
                  Showing {pages.length} page{pages.length !== 1 ? "s" : ""}
                  {pageCount && pageCount > pages.length ? ` of ${pageCount}` : ""}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
