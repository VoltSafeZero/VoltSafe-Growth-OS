import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search, RefreshCw, ExternalLink, FileText, User, ChevronRight,
  AlertTriangle, BookOpen, Plus, Pencil, ArrowLeft, FolderOpen
} from "lucide-react";
import { SiConfluence } from "react-icons/si";

const SITE_URL = "https://voltsafe.atlassian.net/wiki";

type ConfluenceSpace = { key: string; name: string };
type ConfluencePage = {
  id: string; title: string; type: string; status: string;
  _links: { webui?: string; base?: string };
  space?: { key: string; name: string };
  history?: { lastUpdated: { by: { displayName: string; profilePicture?: { path: string } }; when: string } };
  version?: { when: string; number: number; by: { displayName: string; profilePicture?: { path: string } } };
};
type ConfluencePageDetail = ConfluencePage & {
  body?: { view?: { value: string }; storage?: { value: string } };
  ancestors?: { id: string; title: string }[];
  children?: { page?: { results: ConfluencePage[]; size: number } };
};

const SPACE_COLORS: Record<string, string> = {
  MKT: "bg-pink-500", ADMIN: "bg-slate-500", SF: "bg-amber-500",
  ENGINEERIN: "bg-blue-600", MOLLY: "bg-teal-500", SOFT: "bg-violet-500",
  VSHW: "bg-orange-500", VS: "bg-emerald-500", IT: "bg-cyan-500",
};
function spaceColor(key: string) { return SPACE_COLORS[key] || "bg-[#0052CC]"; }

function SpaceAvatar({ spaceKey, name, size = "sm" }: { spaceKey: string; name: string; size?: "sm" | "md" | "lg" }) {
  const bg = spaceColor(spaceKey);
  const dim = size === "lg" ? "h-10 w-10 text-sm" : size === "md" ? "h-7 w-7 text-xs" : "h-5 w-5 text-[9px]";
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

function PageRow({ page, onClick }: { page: ConfluencePage; onClick: () => void }) {
  const updatedBy = page.history?.lastUpdated?.by?.displayName || page.version?.by?.displayName;
  const avatarPath = page.history?.lastUpdated?.by?.profilePicture?.path || page.version?.by?.profilePicture?.path;
  const updatedAt = page.history?.lastUpdated?.when || page.version?.when;
  const spaceKey = page.space?.key || "";
  return (
    <button onClick={onClick} data-testid={`page-row-${page.id}`}
      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors group text-left border-b border-border/20 last:border-0">
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
        {avatarPath
          ? <img src={`https://voltsafe.atlassian.net${avatarPath}`} alt="" className="h-5 w-5 rounded-full flex-shrink-0" />
          : <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center flex-shrink-0"><User className="h-3 w-3 text-muted-foreground" /></div>
        }
        <span className="text-xs text-muted-foreground truncate">{updatedBy || "Unknown"}</span>
      </div>
      <span className="w-24 flex-shrink-0 text-right text-xs text-muted-foreground">{timeAgo(updatedAt)}</span>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
    </button>
  );
}

export default function ConfluencePage() {
  const [selectedSpace, setSelectedSpace] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);

  const spacesQuery = useQuery<{ results: ConfluenceSpace[]; size: number }>({
    queryKey: ["/api/confluence/spaces"],
    queryFn: async () => {
      const res = await fetch("/api/confluence/spaces", { credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
  });

  const pagesQuery = useQuery<{ results: ConfluencePage[] }>({
    queryKey: ["/api/confluence/pages", selectedSpace, searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedSpace !== "all") params.set("space", selectedSpace);
      if (searchQuery) params.set("q", searchQuery);
      const res = await fetch(`/api/confluence/pages?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
  });

  const pageDetailQuery = useQuery<ConfluencePageDetail>({
    queryKey: ["/api/confluence/pages", selectedPageId],
    enabled: !!selectedPageId,
    staleTime: 0,
    gcTime: 0,
    retry: 1,
    queryFn: async () => {
      const res = await fetch(`/api/confluence/pages/${selectedPageId}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
  });

  const spaces = spacesQuery.data?.results || [];
  const pages = pagesQuery.data?.results || [];
  const detail = pageDetailQuery.data;
  const isConnected = !spacesQuery.error;
  const pageUrl = detail ? `${SITE_URL}${detail._links?.webui || ""}` : SITE_URL;
  const editUrl = detail && detail.space?.key
    ? `${SITE_URL}/spaces/${detail.space.key}/pages/edit-v2/${detail.id}`
    : pageUrl;
  const createUrl = selectedSpace !== "all"
    ? `${SITE_URL}/spaces/${selectedSpace}/pages/create`
    : `${SITE_URL}`;
  const ancestors = detail?.ancestors || [];
  const childPages = detail?.children?.page?.results || [];

  function openPage(id: string) {
    // Clear any cached error so the query always fires fresh on navigation
    queryClient.removeQueries({ queryKey: ["/api/confluence/pages", id] });
    setSelectedPageId(id);
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Spaces sidebar */}
      <div className="w-48 flex-shrink-0 border-r border-border/50 bg-card/30 flex flex-col overflow-hidden">
        <div className="px-3 py-2.5 border-b border-border/50 flex items-center gap-2">
          <SiConfluence className="h-4 w-4 text-[#0052CC] flex-shrink-0" />
          <span className="text-xs font-semibold">Spaces</span>
          <button onClick={() => { queryClient.invalidateQueries({ queryKey: ["/api/confluence/spaces"] }); queryClient.invalidateQueries({ queryKey: ["/api/confluence/pages"] }); }}
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors" data-testid="button-refresh">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          <button onClick={() => { setSelectedSpace("all"); setSearchQuery(""); setSearch(""); setSelectedPageId(null); }}
            data-testid="filter-space-all"
            className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors ${selectedSpace === "all" && !searchQuery ? "bg-[#0052CC]/10 border-l-2 border-[#0052CC]" : "border-l-2 border-transparent"}`}>
            <div className="h-5 w-5 rounded bg-muted flex items-center justify-center flex-shrink-0">
              <BookOpen className="h-3 w-3 text-muted-foreground" />
            </div>
            <span className={`text-xs truncate ${selectedSpace === "all" && !searchQuery ? "text-foreground font-medium" : "text-muted-foreground"}`}>All spaces</span>
          </button>
          {spacesQuery.isLoading
            ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="px-3 py-2 flex items-center gap-2"><Skeleton className="h-5 w-5 rounded" /><Skeleton className="h-3 flex-1" /></div>)
            : spaces.map((s) => (
              <button key={s.key} onClick={() => { setSelectedSpace(s.key); setSearchQuery(""); setSearch(""); setSelectedPageId(null); }}
                data-testid={`filter-space-${s.key}`}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors ${selectedSpace === s.key ? "bg-[#0052CC]/10 border-l-2 border-[#0052CC]" : "border-l-2 border-transparent"}`}>
                <SpaceAvatar spaceKey={s.key} name={s.name} />
                <span className={`text-xs truncate ${selectedSpace === s.key ? "text-foreground font-medium" : "text-muted-foreground"}`}>{s.name}</span>
              </button>
            ))
          }
        </div>
        <div className="p-2 border-t border-border/50 space-y-1">
          <a href={createUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors" data-testid="link-new-page">
            <Plus className="h-3 w-3" /> New page
          </a>
          <a href={SITE_URL} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
            <ExternalLink className="h-3 w-3" /> Open in Confluence
          </a>
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!isConnected && !spacesQuery.isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
            <SiConfluence className="h-14 w-14 text-[#0052CC] opacity-30" />
            <p className="text-lg font-semibold">Confluence not connected</p>
            <p className="text-sm text-muted-foreground">{(spacesQuery.error as Error)?.message}</p>
          </div>
        ) : selectedPageId ? (
          /* ─── Page Detail View ─── */
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-shrink-0 px-4 py-2 border-b border-border/50 bg-card/20 flex items-center gap-2 min-w-0">
              <button onClick={() => setSelectedPageId(null)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0" data-testid="button-back">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
              <span className="text-muted-foreground flex-shrink-0">/</span>
              {ancestors.map((a, i) => (
                <span key={a.id} className="flex items-center gap-1 min-w-0">
                  <button onClick={() => openPage(a.id)} className="text-xs text-muted-foreground hover:text-[#0052CC] transition-colors truncate max-w-24">{a.title}</button>
                  {i < ancestors.length - 1 && <span className="text-muted-foreground flex-shrink-0">/</span>}
                </span>
              ))}
              {ancestors.length > 0 && <span className="text-muted-foreground flex-shrink-0">/</span>}
              <span className="text-xs font-medium truncate flex-1 min-w-0">{detail?.title}</span>
              <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                <a href={editUrl} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" data-testid="button-edit-page">
                    <Pencil className="h-3 w-3" /> Edit in Confluence
                  </Button>
                </a>
                <a href={`${SITE_URL}/spaces/${detail?.space?.key || ""}/pages/create?parentPageId=${detail?.id}`} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" data-testid="button-add-child-page">
                    <Plus className="h-3 w-3" /> Add child page
                  </Button>
                </a>
                <a href={pageUrl} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground">
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                </a>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {pageDetailQuery.isLoading ? (
                <div className="max-w-3xl mx-auto px-8 py-8 space-y-3">
                  <Skeleton className="h-8 w-2/3" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ) : pageDetailQuery.error ? (
                <div className="flex flex-col items-center justify-center p-12 gap-3 text-center">
                  <AlertTriangle className="h-8 w-8 text-muted-foreground opacity-40" />
                  <p className="text-sm text-muted-foreground">{(pageDetailQuery.error as Error).message}</p>
                </div>
              ) : (
                <div className="max-w-3xl mx-auto px-8 py-8">
                  {detail?.space && (
                    <div className="flex items-center gap-2 mb-4">
                      <SpaceAvatar spaceKey={detail.space.key} name={detail.space.name} size="sm" />
                      <span className="text-xs text-muted-foreground font-medium">{detail.space.name}</span>
                    </div>
                  )}
                  <h1 className="text-2xl font-bold mb-2">{detail?.title}</h1>
                  <div className="flex items-center gap-3 mb-6 text-xs text-muted-foreground border-b border-border/30 pb-4">
                    {detail?.version?.by?.profilePicture?.path && (
                      <img src={`https://voltsafe.atlassian.net${detail.version.by.profilePicture.path}`} alt="" className="h-5 w-5 rounded-full" />
                    )}
                    <span>Last edited by <span className="text-foreground">{detail?.version?.by?.displayName || "Unknown"}</span></span>
                    <span>·</span>
                    <span>{timeAgo(detail?.version?.when)}</span>
                    <span>·</span>
                    <span>Version {detail?.version?.number}</span>
                  </div>

                  {detail?.body?.view?.value ? (
                    <div
                      className="confluence-content max-w-none text-foreground"
                      dangerouslySetInnerHTML={{ __html: detail.body.view.value }}
                    />
                  ) : (
                    <div className="text-center py-12">
                      <FileText className="h-10 w-10 text-muted-foreground opacity-30 mx-auto mb-3" />
                      <p className="text-muted-foreground italic text-sm mb-3">This page has no content yet.</p>
                      <a href={editUrl} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" variant="outline" className="gap-1.5">
                          <Pencil className="h-3.5 w-3.5" /> Edit in Confluence
                        </Button>
                      </a>
                    </div>
                  )}

                  {childPages.length > 0 && (
                    <div className="mt-10 border-t border-border/30 pt-6">
                      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <FolderOpen className="h-4 w-4 text-muted-foreground" />
                        Child pages ({childPages.length})
                      </h3>
                      <div className="space-y-1">
                        {childPages.map((child) => (
                          <button key={child.id} onClick={() => openPage(child.id)} data-testid={`child-page-${child.id}`}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-muted/50 transition-colors group text-left">
                            <FileText className="h-4 w-4 text-muted-foreground group-hover:text-[#0052CC] flex-shrink-0" />
                            <span className="text-sm group-hover:text-[#0052CC] transition-colors">{child.title}</span>
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-auto opacity-0 group-hover:opacity-100" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ─── Page List View ─── */
          <>
            <div className="flex-shrink-0 px-4 py-2.5 border-b border-border/50 bg-card/20">
              <div className="flex items-center gap-3 flex-wrap">
                <div>
                  <h2 className="font-semibold text-sm">
                    {searchQuery ? `Results for "${searchQuery}"` : selectedSpace !== "all" ? (spaces.find(s => s.key === selectedSpace)?.name || selectedSpace) : "Recent pages"}
                  </h2>
                  <p className="text-xs text-muted-foreground">{pages.length} page{pages.length !== 1 ? "s" : ""}</p>
                </div>
                <form onSubmit={(e) => { e.preventDefault(); setSearchQuery(search); setSelectedSpace("all"); setSelectedPageId(null); }} className="ml-auto flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search pages..."
                      className="pl-8 h-7 text-xs w-52 bg-background/50" data-testid="input-search-confluence" />
                  </div>
                  <Button type="submit" size="sm" variant="outline" className="h-7 text-xs">Search</Button>
                  {searchQuery && (
                    <button type="button" onClick={() => { setSearch(""); setSearchQuery(""); }}
                      className="text-xs text-[#0052CC] hover:underline">Clear</button>
                  )}
                </form>
              </div>
            </div>

            <div className="flex-shrink-0 flex items-center px-4 py-1.5 border-b border-border/50 bg-muted/20 text-[11px] text-muted-foreground font-medium uppercase tracking-wide gap-3">
              <span className="flex-1">Title</span>
              <span className="w-32 flex-shrink-0">Space</span>
              <span className="w-36 flex-shrink-0">Last updated by</span>
              <span className="w-24 flex-shrink-0 text-right">When</span>
              <span className="w-5 flex-shrink-0" />
            </div>

            <div className="flex-1 overflow-y-auto">
              {pagesQuery.isLoading && (
                <div>{Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-border/20">
                    <Skeleton className="h-4 w-4" /><Skeleton className="h-3 flex-1" />
                    <Skeleton className="h-4 w-24 rounded" /><Skeleton className="h-4 w-5 rounded-full" /><Skeleton className="h-3 w-16" />
                  </div>
                ))}</div>
              )}
              {pagesQuery.error && (
                <div className="flex flex-col items-center justify-center p-12 gap-3 text-center">
                  <AlertTriangle className="h-8 w-8 opacity-40" />
                  <p className="text-sm text-muted-foreground">{(pagesQuery.error as Error).message}</p>
                </div>
              )}
              {!pagesQuery.isLoading && !pagesQuery.error && pages.length === 0 && (
                <div className="flex flex-col items-center justify-center p-12 gap-2 text-center">
                  <FileText className="h-8 w-8 text-muted-foreground opacity-30" />
                  <p className="text-sm text-muted-foreground">{searchQuery ? `No pages found for "${searchQuery}"` : "No pages in this space"}</p>
                </div>
              )}
              {pages.map((page) => <PageRow key={page.id} page={page} onClick={() => openPage(page.id)} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
