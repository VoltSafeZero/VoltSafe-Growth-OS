import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Brain, Search, Filter, ExternalLink, Edit2, Trash2, ChevronDown,
  ChevronUp, AlertTriangle, Tag, Calendar, User, Sparkles, RefreshCw, X, Link2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { SaveToCortexModal } from "@/components/inbox/save-to-cortex-modal";
import { SaveUrlToCortexModal } from "@/components/cortex/save-url-to-cortex-modal";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Constants ──────────────────────────────────────────────────────────────

const INTEL_TYPES = [
  "Marine Industry Intel",
  "NMMA / Association News",
  "Marina Market Data",
  "Boating Consumer Trends",
  "Regulatory / Compliance",
  "Competitor / Partner Intel",
  "Grant / Funding Intel",
  "Customer Pain / Voice of Market",
  "Other",
] as const;

const IMPORTANCE_LEVELS = ["Low", "Medium", "High", "Board-Level / Strategic", "Critical"] as const;

const USE_FOR_OPTIONS = [
  "AI email writing",
  "Lead/account research",
  "Campaign context",
  "Investor/funding narrative",
  "Cortex knowledge base",
] as const;

const IMPORTANCE_COLORS: Record<string, string> = {
  "Low": "bg-muted/50 text-muted-foreground border-border/30",
  "Medium": "bg-blue-500/15 text-blue-400 border-blue-500/20",
  "High": "bg-amber-500/15 text-amber-400 border-amber-500/20",
  "Board-Level / Strategic": "bg-purple-500/15 text-purple-400 border-purple-500/20",
  "Critical": "bg-purple-500/15 text-purple-400 border-purple-500/20",
};

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

function fmtDateShort(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-CA", { year: "numeric", month: "short" });
}

// ── Record detail sheet ─────────────────────────────────────────────────────

function IntelDetailSheet({ record, onClose, onEdit }: { record: any; onClose: () => void; onEdit: () => void }) {
  const { toast } = useToast();
  const facts: string[] = Array.isArray(record.extracted_facts)
    ? record.extracted_facts
    : typeof record.extracted_facts === "object" && record.extracted_facts
    ? Object.values(record.extracted_facts as Record<string, string>)
    : [];

  const deleteMut = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/cortex-intel/${record.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cortex-intel"] });
      toast({ title: "Record deleted" });
      onClose();
    },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  return (
    <div className="space-y-4 pt-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground leading-snug">{record.subject || "(No subject)"}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {record.sender_name || record.sender_email || "Unknown sender"} · {fmtDate(record.received_at)}
          </p>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium shrink-0 ${IMPORTANCE_COLORS[record.importance] || ""}`}>
          {record.importance}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Badge variant="secondary" className="text-[10px]">{record.intel_type}</Badge>
        {Array.isArray(record.tags) && record.tags.map((t: string) => (
          <Badge key={t} variant="outline" className="text-[10px] text-muted-foreground">{t}</Badge>
        ))}
      </div>

      {record.ai_summary && (
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">AI Summary</p>
          <p className="text-sm text-foreground/90 leading-relaxed">{record.ai_summary}</p>
        </div>
      )}

      {record.strategic_relevance && (
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Strategic Relevance</p>
          <p className="text-sm text-muted-foreground leading-relaxed">{record.strategic_relevance}</p>
        </div>
      )}

      {facts.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Key Facts</p>
          <ul className="space-y-1">
            {facts.map((f, i) => (
              <li key={i} className="flex gap-2 text-xs text-foreground/80">
                <span className="text-cyan-400 flex-shrink-0 mt-0.5">›</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {record.user_notes && (
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Notes</p>
          <p className="text-xs text-muted-foreground italic">{record.user_notes}</p>
        </div>
      )}

      {Array.isArray(record.use_for) && record.use_for.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Use For</p>
          <div className="flex flex-wrap gap-1">
            {record.use_for.map((u: string) => (
              <Badge key={u} variant="secondary" className="text-[10px]">{u}</Badge>
            ))}
          </div>
        </div>
      )}

      <Separator />

      <div className="text-xs text-muted-foreground space-y-0.5">
        <p>Saved: {fmtDate(record.created_at)}</p>
        {record.source_url && (
          <a href={record.source_url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-cyan-400 hover:underline">
            <ExternalLink className="w-3 h-3" /> View source
          </a>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button variant="outline" size="sm" className="flex-1 text-xs gap-1.5" onClick={onEdit}
          data-testid="btn-edit-intel">
          <Edit2 className="w-3.5 h-3.5" /> Edit
        </Button>
        <Button variant="outline" size="sm" className="text-xs text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/10 gap-1.5"
          onClick={() => {
            if (confirm("Delete this Cortex intel record?")) deleteMut.mutate();
          }}
          disabled={deleteMut.isPending}
          data-testid="btn-delete-intel">
          <Trash2 className="w-3.5 h-3.5" /> Delete
        </Button>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function CortexIntelLibrary() {
  const { toast } = useToast();

  // Filters
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterImportance, setFilterImportance] = useState("all");
  const [filterUseFor, setFilterUseFor] = useState("all");
  const [filterSender, setFilterSender] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  // Selected record for detail / edit
  const [detailRecord, setDetailRecord] = useState<any>(null);
  const [editRecord, setEditRecord] = useState<any>(null);
  const [addUrlOpen, setAddUrlOpen] = useState(false);

  const qParams = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(page * PAGE_SIZE),
    ...(search ? { search } : {}),
    ...(filterType !== "all" ? { intelType: filterType } : {}),
    ...(filterImportance !== "all" ? { importance: filterImportance } : {}),
    ...(filterUseFor !== "all" ? { useFor: filterUseFor } : {}),
    ...(filterSender ? { senderEmail: filterSender } : {}),
    ...(filterDateFrom ? { dateFrom: filterDateFrom } : {}),
    ...(filterDateTo ? { dateTo: filterDateTo } : {}),
  });

  const { data, isLoading, isError, refetch } = useQuery<{ records: any[]; total: number }>({
    queryKey: ["/api/cortex-intel", qParams.toString()],
    queryFn: () =>
      fetch(`/api/cortex-intel?${qParams.toString()}`, { credentials: "include" })
        .then(r => { if (!r.ok) throw new Error("Failed"); return r.json(); }),
  });

  const records = data?.records ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  function clearFilters() {
    setSearch(""); setFilterType("all"); setFilterImportance("all");
    setFilterUseFor("all"); setFilterSender(""); setFilterDateFrom(""); setFilterDateTo("");
    setPage(0);
  }
  const hasActiveFilters = search || filterType !== "all" || filterImportance !== "all" ||
    filterUseFor !== "all" || filterSender || filterDateFrom || filterDateTo;

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border/40 shrink-0">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-cyan-500/15 flex items-center justify-center shrink-0">
              <Brain className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-base font-bold text-foreground">Cortex Intel Library</h1>
              <p className="text-xs text-muted-foreground">
                {total > 0 ? `${total} saved intel record${total !== 1 ? "s" : ""}` : "Saved marine industry intelligence"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground h-7 gap-1" onClick={clearFilters}>
                <X className="w-3 h-3" /> Clear filters
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5"
              onClick={() => setShowFilters(v => !v)} data-testid="btn-toggle-filters">
              <Filter className="w-3 h-3" />
              {showFilters ? "Hide" : "Filters"}
              {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 inline-block" />}
            </Button>
            <Button size="sm" className="h-7 text-xs gap-1.5 bg-cyan-600 hover:bg-cyan-700"
              onClick={() => setAddUrlOpen(true)} data-testid="btn-add-url">
              <Link2 className="w-3 h-3" /> Add URL
            </Button>
          </div>
        </div>

        {/* Search bar */}
        <div className="mt-3 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-8 h-8 text-xs"
            placeholder="Search subject, summary, sender, tags, notes…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            data-testid="intel-search-input"
          />
        </div>

        {/* Expanded filters */}
        {showFilters && (
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            <Select value={filterType} onValueChange={v => { setFilterType(v); setPage(0); }}>
              <SelectTrigger className="h-7 text-xs" data-testid="filter-intel-type">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All types</SelectItem>
                {INTEL_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filterImportance} onValueChange={v => { setFilterImportance(v); setPage(0); }}>
              <SelectTrigger className="h-7 text-xs" data-testid="filter-importance">
                <SelectValue placeholder="All importance" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All importance</SelectItem>
                {IMPORTANCE_LEVELS.map(l => <SelectItem key={l} value={l} className="text-xs">{l}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filterUseFor} onValueChange={v => { setFilterUseFor(v); setPage(0); }}>
              <SelectTrigger className="h-7 text-xs" data-testid="filter-use-for">
                <SelectValue placeholder="All use-for" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All use-for</SelectItem>
                {USE_FOR_OPTIONS.map(u => <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>)}
              </SelectContent>
            </Select>

            <Input
              className="h-7 text-xs"
              placeholder="Filter by sender email…"
              value={filterSender}
              onChange={e => { setFilterSender(e.target.value); setPage(0); }}
              data-testid="filter-sender"
            />

            <div className="flex items-center gap-1 col-span-2">
              <Input type="date" className="h-7 text-xs" value={filterDateFrom}
                onChange={e => { setFilterDateFrom(e.target.value); setPage(0); }}
                data-testid="filter-date-from" />
              <span className="text-xs text-muted-foreground">–</span>
              <Input type="date" className="h-7 text-xs" value={filterDateTo}
                onChange={e => { setFilterDateTo(e.target.value); setPage(0); }}
                data-testid="filter-date-to" />
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="p-6 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center h-48 text-center px-6">
            <AlertTriangle className="w-8 h-8 text-amber-400 mb-3" />
            <p className="text-sm font-medium">Could not load intel records</p>
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => refetch()}>Retry</Button>
          </div>
        )}

        {!isLoading && !isError && records.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-center px-6">
            <Brain className="w-10 h-10 text-muted-foreground/20 mb-3" />
            <p className="text-sm font-medium text-foreground">
              {hasActiveFilters ? "No records match these filters" : "No Cortex intel saved yet"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {hasActiveFilters ? "Try clearing some filters" : "Open an email and click the Brain / Cortex button to save intel"}
            </p>
          </div>
        )}

        {!isLoading && !isError && records.length > 0 && (
          <div className="divide-y divide-border/15">
            {records.map(r => (
              <div
                key={r.id}
                className="px-6 py-4 hover:bg-muted/10 transition-colors cursor-pointer group"
                onClick={() => setDetailRecord(r)}
                data-testid={`intel-row-${r.id}`}
              >
                <div className="flex items-start gap-3">
                  {/* Importance dot */}
                  <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                    r.importance === "Board-Level / Strategic" || r.importance === "Critical" ? "bg-purple-400" :
                    r.importance === "High" ? "bg-amber-400" :
                    r.importance === "Medium" ? "bg-blue-400" : "bg-muted-foreground/30"
                  }`} />

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <p className="text-sm font-medium text-foreground truncate flex-1">
                        {r.subject || "(No subject)"}
                      </p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${IMPORTANCE_COLORS[r.importance] || ""}`}>
                          {r.importance}
                        </span>
                        <span className="text-[10px] text-muted-foreground/60 bg-muted/30 px-1.5 py-0.5 rounded">
                          {r.intel_type}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {r.sender_name || r.sender_email || "Unknown"}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {fmtDateShort(r.received_at)}
                      </span>
                      {Array.isArray(r.use_for) && r.use_for.length > 0 && (
                        <span className="text-muted-foreground/60">
                          {r.use_for.slice(0, 2).join(", ")}
                          {r.use_for.length > 2 && ` +${r.use_for.length - 2}`}
                        </span>
                      )}
                    </div>

                    {r.ai_summary && (
                      <p className="text-xs text-muted-foreground/80 mt-1.5 line-clamp-2">
                        {r.ai_summary}
                      </p>
                    )}

                    {Array.isArray(r.tags) && r.tags.length > 0 && (
                      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                        <Tag className="w-2.5 h-2.5 text-muted-foreground/40 shrink-0" />
                        {r.tags.slice(0, 5).map((t: string) => (
                          <span key={t} className="text-[10px] text-muted-foreground/70 bg-muted/30 px-1 py-0.5 rounded">
                            {t}
                          </span>
                        ))}
                        {r.tags.length > 5 && (
                          <span className="text-[10px] text-muted-foreground/50">+{r.tags.length - 5}</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Edit button */}
                  <button
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-muted/30 text-muted-foreground hover:text-foreground shrink-0"
                    onClick={e => { e.stopPropagation(); setEditRecord(r); }}
                    data-testid={`btn-quick-edit-${r.id}`}
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-border/20 text-xs text-muted-foreground">
            <span>{total} records · Page {page + 1} of {totalPages}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page === 0}
                onClick={() => setPage(p => p - 1)} data-testid="btn-prev-page">
                Previous
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page >= totalPages - 1}
                onClick={() => setPage(p => p + 1)} data-testid="btn-next-page">
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Detail sheet */}
      <Sheet open={detailRecord != null} onOpenChange={v => !v && setDetailRecord(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto" side="right">
          <SheetHeader className="mb-4">
            <SheetTitle className="flex items-center gap-2 text-sm">
              <Brain className="w-4 h-4 text-cyan-400" /> Intel Record
            </SheetTitle>
          </SheetHeader>
          {detailRecord && (
            <IntelDetailSheet
              record={detailRecord}
              onClose={() => setDetailRecord(null)}
              onEdit={() => { setEditRecord(detailRecord); setDetailRecord(null); }}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Edit modal — reuses the save-to-cortex modal in edit mode */}
      {editRecord && (
        <SaveToCortexModal
          open={editRecord != null}
          onOpenChange={v => !v && setEditRecord(null)}
          email={{
            id: editRecord.mail_message_id,
            threadId: editRecord.thread_id,
            subject: editRecord.subject,
            senderName: editRecord.sender_name,
            senderEmail: editRecord.sender_email,
            receivedAt: editRecord.received_at,
            snippet: editRecord.ai_summary,
            sourceLabel: editRecord.source_label,
          }}
        />
      )}

      {/* Add URL modal */}
      <SaveUrlToCortexModal open={addUrlOpen} onOpenChange={setAddUrlOpen} />
    </div>
  );
}
