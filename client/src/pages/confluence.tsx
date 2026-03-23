import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Search, RefreshCw, ExternalLink, FileText, User, ChevronRight,
  ChevronLeft, AlertTriangle, BookOpen, Plus, Pencil, X, Save,
  Loader2, ArrowLeft, FolderOpen
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
  const { toast } = useToast();
  const [selectedSpace, setSelectedSpace] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [newPageOpen, setNewPageOpen] = useState(false);
  const [newPage, setNewPage] = useState({ title: "", body: "", spaceKey: "", parentId: "" });

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
    queryFn: async () => {
      const res = await fetch(`/api/confluence/pages/${selectedPageId}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const detail = pageDetailQuery.data!;
      const res = await apiRequest("PUT", `/api/confluence/pages/${selectedPageId}`, {
        title: editTitle,
        body: editBody,
        version: (detail.version?.number || 1) + 1,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Page updated" });
      setIsEditing(false);
      queryClient.invalidateQueries({ queryKey: ["/api/confluence/pages", selectedPageId] });
      queryClient.invalidateQueries({ queryKey: ["/api/confluence/pages"] });
    },
    onError: (e: any) => toast({ title: "Failed to update", description: e.message, variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/confluence/pages", {
        title: newPage.title,
        spaceKey: newPage.spaceKey || selectedSpace,
        parentId: newPage.parentId || undefined,
        body: newPage.body,
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Page created", description: data.title });
      setNewPageOpen(false);
      setNewPage({ title: "", body: "", spaceKey: "", parentId: "" });
      queryClient.invalidateQueries({ queryKey: ["/api/confluence/pages"] });
    },
    onError: (e: any) => toast({ title: "Failed to create page", description: e.message, variant: "destructive" }),
  });

  const spaces = spacesQuery.data?.results || [];
  const pages = pagesQuery.data?.results || [];
  const detail = pageDetailQuery.data;
  const isConnected = !spacesQuery.error;
  const pageUrl = detail ? `${SITE_URL}${detail._links?.webui || ""}` : SITE_URL;
  const ancestors = detail?.ancestors || [];
  const childPages = detail?.children?.page?.results || [];

  function openPage(id: string) {
    setSelectedPageId(id);
    setIsEditing(false);
  }

  function startEdit() {
    if (!detail) return;
    setEditTitle(detail.title);
    const storage = detail.body?.storage?.value || "";
    const plain = storage.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
    setEditBody(plain);
    setIsEditing(true);
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
          <button onClick={() => { setNewPage(p => ({ ...p, spaceKey: selectedSpace !== "all" ? selectedSpace : "" })); setNewPageOpen(true); }}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors" data-testid="button-new-page">
            <Plus className="h-3 w-3" /> New page
          </button>
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
            {/* Detail toolbar */}
            <div className="flex-shrink-0 px-4 py-2 border-b border-border/50 bg-card/20 flex items-center gap-2">
              <button onClick={() => { setSelectedPageId(null); setIsEditing(false); }}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="button-back">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
              <span className="text-muted-foreground">/</span>
              {ancestors.map((a, i) => (
                <span key={a.id} className="flex items-center gap-1">
                  <button onClick={() => openPage(a.id)} className="text-xs text-muted-foreground hover:text-[#0052CC] transition-colors">{a.title}</button>
                  {i < ancestors.length - 1 && <span className="text-muted-foreground">/</span>}
                </span>
              ))}
              {ancestors.length > 0 && <span className="text-muted-foreground">/</span>}
              <span className="text-xs font-medium truncate flex-1">{detail?.title}</span>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {!isEditing ? (
                  <>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={startEdit} data-testid="button-edit-page">
                      <Pencil className="h-3 w-3" /> Edit
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                      onClick={() => { setNewPage(p => ({ ...p, spaceKey: detail?.space?.key || "", parentId: selectedPageId })); setNewPageOpen(true); }}
                      data-testid="button-add-child-page">
                      <Plus className="h-3 w-3" /> Add child page
                    </Button>
                    <a href={pageUrl} target="_blank" rel="noopener noreferrer">
                      <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground">
                        <ExternalLink className="h-3 w-3" /> Open in Confluence
                      </Button>
                    </a>
                  </>
                ) : (
                  <>
                    <Button size="sm" className="h-7 text-xs gap-1 bg-[#0052CC] hover:bg-[#0747A6]"
                      onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending} data-testid="button-save-page">
                      {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setIsEditing(false)}>Cancel</Button>
                  </>
                )}
              </div>
            </div>

            {/* Detail content */}
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
                  {/* Space badge */}
                  {detail?.space && (
                    <div className="flex items-center gap-2 mb-4">
                      <SpaceAvatar spaceKey={detail.space.key} name={detail.space.name} size="sm" />
                      <span className="text-xs text-muted-foreground font-medium">{detail.space.name}</span>
                    </div>
                  )}

                  {isEditing ? (
                    <div className="space-y-3">
                      <div>
                        <Label className="text-xs mb-1 block">Title</Label>
                        <Input value={editTitle} onChange={e => setEditTitle(e.target.value)} className="text-lg font-bold" data-testid="input-edit-title" />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Content</Label>
                        <Textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={20}
                          className="font-mono text-sm resize-none" placeholder="Write your page content here..." data-testid="textarea-edit-body" />
                      </div>
                    </div>
                  ) : (
                    <>
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
                          className="confluence-content prose prose-sm prose-invert max-w-none text-foreground"
                          dangerouslySetInnerHTML={{ __html: detail.body.view.value }}
                        />
                      ) : (
                        <p className="text-muted-foreground italic text-sm">This page has no content yet. Click Edit to add content.</p>
                      )}
                    </>
                  )}

                  {/* Child pages */}
                  {!isEditing && childPages.length > 0 && (
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
              <div className="flex items-center gap-3">
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

            {/* Column headers */}
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

      {/* New Page Dialog */}
      <Dialog open={newPageOpen} onOpenChange={setNewPageOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SiConfluence className="h-4 w-4 text-[#0052CC]" /> Create page
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block">Space *</Label>
                <Select value={newPage.spaceKey} onValueChange={v => setNewPage(p => ({ ...p, spaceKey: v }))}>
                  <SelectTrigger data-testid="select-new-page-space"><SelectValue placeholder="Select space..." /></SelectTrigger>
                  <SelectContent>{spaces.map(s => <SelectItem key={s.key} value={s.key}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Parent page ID (optional)</Label>
                <Input value={newPage.parentId} onChange={e => setNewPage(p => ({ ...p, parentId: e.target.value }))}
                  placeholder="e.g. 12345678" data-testid="input-parent-id" />
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Title *</Label>
              <Input value={newPage.title} onChange={e => setNewPage(p => ({ ...p, title: e.target.value }))}
                placeholder="Page title" data-testid="input-new-page-title" />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Content</Label>
              <Textarea value={newPage.body} onChange={e => setNewPage(p => ({ ...p, body: e.target.value }))}
                placeholder="Write your page content..." rows={6} data-testid="textarea-new-page-body" />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setNewPageOpen(false)}>Cancel</Button>
              <Button className="flex-1 bg-[#0052CC] hover:bg-[#0747A6]"
                disabled={!newPage.title || !newPage.spaceKey || createMutation.isPending}
                onClick={() => createMutation.mutate()} data-testid="button-create-page">
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Create page
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
