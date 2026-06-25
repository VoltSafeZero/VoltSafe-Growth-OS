import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Newspaper, Plus, ExternalLink, RefreshCw, Trash2, ChevronDown, ChevronUp,
  Loader2, AlertTriangle, Edit3, Tag, Clock, Star, Check, X,
  TrendingUp, Lightbulb, ListOrdered, Bookmark,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

export type NewsEntityType = "lead" | "account" | "contact" | "partner" | "marina" | "utility" | "port" | "investor" | "other";

interface NewsItem {
  id: number;
  entityType: string;
  entityId: number;
  url: string;
  title: string | null;
  source: string | null;
  author: string | null;
  publishedAt: string | null;
  addedAt: string;
  addedByUserId: number;
  addedByName: string | null;
  userNote: string | null;
  relevanceType: string | null;
  tags: string[] | null;
  aiSummary: string | null;
  strategicRelevance: string | null;
  suggestedOutreachAngle: string | null;
  aiKeyPoints: string[] | null;
  aiRelevanceScore: number | null;
  aiStatus: "pending" | "processing" | "done" | "failed";
  processingError: string | null;
  isArchived: boolean;
  useInEmailContext: boolean;
}

const RELEVANCE_TYPES = [
  "Funding / Grant",
  "Infrastructure Upgrade",
  "Marina Expansion",
  "Sustainability / Clean Energy",
  "Safety / Compliance",
  "Leadership Change",
  "New Project",
  "Partnership",
  "Regulatory Change",
  "Customer Pain Signal",
  "Competitive Signal",
  "General Context",
];

function ScoreBadge({ score }: { score: number | null }) {
  if (!score) return null;
  const color =
    score >= 5 ? "bg-red-500/20 text-red-400 border-red-500/30" :
    score >= 4 ? "bg-orange-500/20 text-orange-400 border-orange-500/30" :
    score >= 3 ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" :
    "bg-muted text-muted-foreground border-border";
  const label = score >= 5 ? "High Priority" : score >= 4 ? "Strong Signal" : score >= 3 ? "Useful Context" : score >= 2 ? "Mildly Relevant" : "Background";
  return (
    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0.5 gap-1", color)}>
      <Star className="h-2.5 w-2.5" /> {score}/5 · {label}
    </Badge>
  );
}

function AiStatusBadge({ status, error }: { status: string; error: string | null }) {
  if (status === "done") return null;
  if (status === "processing") return (
    <Badge variant="outline" className="text-[10px] gap-1 text-blue-400 border-blue-500/30 bg-blue-500/10">
      <Loader2 className="h-2.5 w-2.5 animate-spin" /> Processing…
    </Badge>
  );
  if (status === "pending") return (
    <Badge variant="outline" className="text-[10px] gap-1 text-muted-foreground">
      <Clock className="h-2.5 w-2.5" /> Pending
    </Badge>
  );
  if (status === "failed") return (
    <Badge variant="outline" className="text-[10px] gap-1 text-amber-400 border-amber-500/30 bg-amber-500/10" title={error || "Processing failed"}>
      <AlertTriangle className="h-2.5 w-2.5" /> Could not fetch
    </Badge>
  );
  return null;
}

// ─── Add / Edit modal ─────────────────────────────────────────────────────────

interface AddNewsModalProps {
  entityType: NewsEntityType;
  entityId: number;
  existingItem?: NewsItem | null;
  onClose: () => void;
  onSaved: () => void;
}

function AddNewsModal({ entityType, entityId, existingItem, onClose, onSaved }: AddNewsModalProps) {
  const { toast } = useToast();
  const isEditing = !!existingItem;

  const [url, setUrl] = useState(existingItem?.url || "");
  const [note, setNote] = useState(existingItem?.userNote || "");
  const [relevanceType, setRelevanceType] = useState(existingItem?.relevanceType || "");
  const [tagsRaw, setTagsRaw] = useState((existingItem?.tags || []).join(", "));
  const [urlError, setUrlError] = useState("");

  const saveMutation = useMutation({
    mutationFn: async () => {
      const tags = tagsRaw.split(",").map(t => t.trim()).filter(Boolean);
      if (isEditing) {
        return apiRequest("PUT", `/api/crm/recent-news/${existingItem!.id}`, {
          userNote: note.trim() || null,
          relevanceType: relevanceType || null,
          tags,
        });
      }
      return apiRequest("POST", "/api/crm/recent-news", {
        entityType,
        entityId,
        url: url.trim(),
        userNote: note.trim() || null,
        relevanceType: relevanceType || null,
        tags,
      });
    },
    onSuccess: () => {
      toast({ title: isEditing ? "Note updated" : "Article added — AI summary generating…" });
      onSaved();
      onClose();
    },
    onError: (err: any) => {
      const msg = err?.message || "Failed to save";
      if (!isEditing && msg.toLowerCase().includes("duplicate")) {
        setUrlError("This article is already attached to this record.");
      } else {
        toast({ title: "Error", description: msg, variant: "destructive" });
      }
    },
  });

  function handleSubmit() {
    setUrlError("");
    if (!isEditing && !url.trim()) { setUrlError("URL is required"); return; }
    if (!isEditing) {
      try {
        const u = new URL(url.trim());
        if (!["http:", "https:"].includes(u.protocol)) { setUrlError("Only http/https URLs are supported"); return; }
      } catch { setUrlError("Enter a valid URL"); return; }
    }
    saveMutation.mutate();
  }

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Newspaper className="h-4 w-4 text-primary" />
            {isEditing ? "Edit note & tags" : "Add News Article"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update your context note, tags, or relevance type."
              : "Paste a news article URL. The AI will fetch it, summarise it, and suggest an outreach angle."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {!isEditing && (
            <div>
              <Label htmlFor="news-url" className="text-xs">Article URL <span className="text-destructive">*</span></Label>
              <Input
                id="news-url"
                type="url"
                placeholder="https://example.com/article"
                value={url}
                onChange={e => { setUrl(e.target.value); setUrlError(""); }}
                className="mt-1"
                data-testid="input-news-url"
              />
              {urlError && <p className="text-xs text-destructive mt-1">{urlError}</p>}
            </div>
          )}

          <div>
            <Label htmlFor="news-note" className="text-xs">Your note <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea
              id="news-note"
              placeholder="Why does this article matter? Any specific context to remember…"
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              className="mt-1 text-sm"
              data-testid="textarea-news-note"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Relevance type <span className="text-muted-foreground">(optional)</span></Label>
              <Select value={relevanceType} onValueChange={setRelevanceType}>
                <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-news-relevance-type">
                  <SelectValue placeholder="Select type…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {RELEVANCE_TYPES.map(t => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="news-tags" className="text-xs">Tags <span className="text-muted-foreground">(comma-separated)</span></Label>
              <Input
                id="news-tags"
                placeholder="electrification, safety…"
                value={tagsRaw}
                onChange={e => setTagsRaw(e.target.value)}
                className="mt-1 h-8 text-xs"
                data-testid="input-news-tags"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-news-cancel">Cancel</Button>
          <Button size="sm" onClick={handleSubmit} disabled={saveMutation.isPending} data-testid="button-news-save">
            {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
            {isEditing ? "Save changes" : "Add article"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Individual news card ──────────────────────────────────────────────────────

interface NewsCardProps {
  item: NewsItem;
  onRefresh: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onToggleEmailContext: () => void;
  isRefreshing: boolean;
  isDeleting: boolean;
  isTogglingContext: boolean;
}

function NewsCard({ item, onRefresh, onDelete, onEdit, onToggleEmailContext, isRefreshing, isDeleting, isTogglingContext }: NewsCardProps) {
  const [expanded, setExpanded] = useState(false);

  const hasAi = item.aiStatus === "done" && item.aiSummary;
  const displayTitle = item.title || item.url;
  const keyPoints: string[] = Array.isArray(item.aiKeyPoints) ? item.aiKeyPoints : [];

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden bg-card/30 hover:bg-card/50 transition-colors">
      {/* Header row */}
      <div className="p-3">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 mb-1">
              <AiStatusBadge status={item.aiStatus} error={item.processingError} />
              {item.aiRelevanceScore && <ScoreBadge score={item.aiRelevanceScore} />}
              {item.relevanceType && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">{item.relevanceType}</Badge>
              )}
            </div>

            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium hover:text-primary transition-colors line-clamp-2"
              data-testid={`link-news-title-${item.id}`}
            >
              {displayTitle}
            </a>

            <div className="flex flex-wrap gap-2 mt-1">
              {item.source && (
                <span className="text-xs text-muted-foreground">{item.source}</span>
              )}
              {item.publishedAt && (
                <span className="text-xs text-muted-foreground">· {item.publishedAt}</span>
              )}
              {item.addedByName && (
                <span className="text-xs text-muted-foreground">· Added by {item.addedByName}</span>
              )}
              <span className="text-xs text-muted-foreground">
                · {formatDistanceToNow(new Date(item.addedAt), { addSuffix: true })}
              </span>
            </div>

            {item.userNote && (
              <p className="text-xs text-muted-foreground/80 mt-1.5 italic border-l-2 border-primary/30 pl-2">
                {item.userNote}
              </p>
            )}

            {item.tags && item.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {item.tags.map(tag => (
                  <span key={tag} className="inline-flex items-center gap-0.5 text-[10px] bg-secondary/50 text-muted-foreground rounded px-1.5 py-0.5">
                    <Tag className="h-2 w-2" />{tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <Button
              variant="ghost" size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => window.open(item.url, "_blank", "noopener,noreferrer")}
              title="Open article"
              data-testid={`button-news-open-${item.id}`}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost" size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={onEdit}
              title="Edit note & tags"
              data-testid={`button-news-edit-${item.id}`}
            >
              <Edit3 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost" size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={onRefresh}
              disabled={isRefreshing || item.aiStatus === "processing"}
              title="Refresh AI summary"
              data-testid={`button-news-refresh-${item.id}`}
            >
              {isRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
            <Button
              variant="ghost" size="icon"
              className={cn(
                "h-7 w-7",
                item.useInEmailContext
                  ? "text-primary hover:text-primary/70"
                  : "text-muted-foreground hover:text-primary"
              )}
              onClick={onToggleEmailContext}
              disabled={isTogglingContext}
              title={item.useInEmailContext ? "Pinned for email context — click to unpin" : "Pin for email context"}
              data-testid={`button-news-email-context-${item.id}`}
            >
              {isTogglingContext
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Bookmark className={cn("h-3.5 w-3.5", item.useInEmailContext && "fill-primary")} />
              }
            </Button>
            <Button
              variant="ghost" size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
              disabled={isDeleting}
              title="Remove article"
              data-testid={`button-news-delete-${item.id}`}
            >
              {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>

        {/* Expand toggle */}
        {hasAi && (
          <button
            className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setExpanded(e => !e)}
            data-testid={`button-news-expand-${item.id}`}
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "Hide AI analysis" : "Show AI analysis"}
          </button>
        )}

        {/* Fetch error inline */}
        {item.aiStatus === "failed" && item.processingError && (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {item.processingError.includes("HTTP 4") || item.processingError.includes("paywall")
              ? "Article may be behind a paywall — add a note above with key context and refresh."
              : `Could not auto-fetch: ${item.processingError}. Add a note and refresh to retry.`}
          </p>
        )}
      </div>

      {/* Expanded AI detail */}
      {expanded && hasAi && (
        <div className="border-t border-border/40 px-3 pb-3 pt-2.5 space-y-3 bg-muted/20">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Newspaper className="h-3 w-3 text-primary" />
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">AI Summary</span>
            </div>
            <p className="text-sm leading-relaxed">{item.aiSummary}</p>
          </div>

          {item.strategicRelevance && (
            <>
              <Separator className="opacity-50" />
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <TrendingUp className="h-3 w-3 text-emerald-400" />
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Strategic Relevance</span>
                </div>
                <p className="text-sm leading-relaxed">{item.strategicRelevance}</p>
              </div>
            </>
          )}

          {item.suggestedOutreachAngle && (
            <>
              <Separator className="opacity-50" />
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <Lightbulb className="h-3 w-3 text-yellow-400" />
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Suggested Outreach Angle</span>
                </div>
                <p className="text-sm leading-relaxed italic text-muted-foreground border-l-2 border-yellow-400/40 pl-2.5">
                  {item.suggestedOutreachAngle}
                </p>
              </div>
            </>
          )}

          {keyPoints.length > 0 && (
            <>
              <Separator className="opacity-50" />
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <ListOrdered className="h-3 w-3 text-blue-400" />
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Key Points</span>
                </div>
                <ul className="space-y-1">
                  {keyPoints.map((pt, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <Check className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                      <span>{pt}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main RecentNewsPanel ──────────────────────────────────────────────────────

interface Props {
  entityType: NewsEntityType;
  entityId: number;
}

export function RecentNewsPanel({ entityType, entityId }: Props) {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<NewsItem | null>(null);
  const [refreshingId, setRefreshingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [togglingContextId, setTogglingContextId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const qKey = ["/api/crm/recent-news", entityType, entityId];

  const { data: items = [], isLoading } = useQuery<NewsItem[]>({
    queryKey: qKey,
    queryFn: async () => {
      const res = await fetch(
        `/api/crm/recent-news?entityType=${entityType}&entityId=${entityId}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to load news");
      return res.json();
    },
    refetchInterval: (data: any) => {
      const arr: NewsItem[] = Array.isArray(data?.state?.data) ? data.state.data : (Array.isArray(data) ? data : []);
      return arr.some(n => n.aiStatus === "processing" || n.aiStatus === "pending") ? 4000 : false;
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async (id: number) => {
      setRefreshingId(id);
      return apiRequest("POST", `/api/crm/recent-news/${id}/refresh-summary`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qKey });
      toast({ title: "Refreshing AI summary…" });
    },
    onError: (err: any) => {
      toast({ title: "Refresh failed", description: err?.message, variant: "destructive" });
    },
    onSettled: () => setRefreshingId(null),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      setDeletingId(id);
      return apiRequest("DELETE", `/api/crm/recent-news/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qKey });
      toast({ title: "Article removed" });
    },
    onError: (err: any) => {
      toast({ title: "Delete failed", description: err?.message, variant: "destructive" });
    },
    onSettled: () => setDeletingId(null),
  });

  const emailContextMutation = useMutation({
    mutationFn: async (id: number) => {
      setTogglingContextId(id);
      return apiRequest("POST", `/api/crm/recent-news/${id}/use-in-email-context`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qKey });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/recent-news/for-email", entityType, entityId] });
    },
    onError: (err: any) => {
      toast({ title: "Could not update pin", description: err?.message, variant: "destructive" });
    },
    onSettled: () => setTogglingContextId(null),
  });

  const active = items.filter(i => !i.isArchived);
  const pendingCount = active.filter(i => i.aiStatus === "processing" || i.aiStatus === "pending").length;

  return (
    <>
      {addOpen && (
        <AddNewsModal
          entityType={entityType}
          entityId={entityId}
          onClose={() => setAddOpen(false)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: qKey })}
        />
      )}
      {editItem && (
        <AddNewsModal
          entityType={entityType}
          entityId={entityId}
          existingItem={editItem}
          onClose={() => setEditItem(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: qKey })}
        />
      )}

      <Card className="border-border/50" data-testid={`recent-news-panel-${entityType}-${entityId}`}>
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center justify-between">
            <button
              className="flex items-center gap-2 hover:opacity-80 transition-opacity text-left"
              onClick={() => setCollapsed(c => !c)}
              data-testid="button-news-panel-toggle"
            >
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Newspaper className="h-4 w-4 text-primary" />
                Recent News
                {active.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{active.length}</Badge>
                )}
                {pendingCount > 0 && (
                  <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
                )}
              </CardTitle>
              {collapsed
                ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                : <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />}
            </button>
            <Button
              size="sm" variant="outline"
              className="h-7 px-2.5 text-xs gap-1.5"
              onClick={() => setAddOpen(true)}
              data-testid="button-add-news"
            >
              <Plus className="h-3.5 w-3.5" /> Add News
            </Button>
          </div>
          {!collapsed && (
            <p className="text-xs text-muted-foreground mt-1">
              Relevant articles, announcements, or market updates connected to this relationship.
            </p>
          )}
        </CardHeader>

        {!collapsed && (
          <CardContent className="px-4 pb-4 pt-0">
            {isLoading ? (
              <div className="space-y-2 mt-2">
                <Skeleton className="h-16 w-full rounded-lg" />
                <Skeleton className="h-16 w-full rounded-lg" />
              </div>
            ) : active.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-center border border-dashed border-border/50 rounded-lg mt-2">
                <Newspaper className="h-7 w-7 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">No news articles yet</p>
                <p className="text-xs text-muted-foreground/60 mt-0.5 max-w-xs">
                  Add a news article URL to give the AI timely context for emails and outreach.
                </p>
                <Button
                  size="sm" variant="outline"
                  className="mt-3 h-7 px-3 text-xs gap-1.5"
                  onClick={() => setAddOpen(true)}
                  data-testid="button-add-news-empty"
                >
                  <Plus className="h-3.5 w-3.5" /> Add first article
                </Button>
              </div>
            ) : (
              <div className="space-y-2 mt-2">
                {active.map(item => (
                  <NewsCard
                    key={item.id}
                    item={item}
                    onRefresh={() => refreshMutation.mutate(item.id)}
                    onDelete={() => deleteMutation.mutate(item.id)}
                    onEdit={() => setEditItem(item)}
                    onToggleEmailContext={() => emailContextMutation.mutate(item.id)}
                    isRefreshing={refreshingId === item.id && refreshMutation.isPending}
                    isDeleting={deletingId === item.id && deleteMutation.isPending}
                    isTogglingContext={togglingContextId === item.id && emailContextMutation.isPending}
                  />
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </>
  );
}
