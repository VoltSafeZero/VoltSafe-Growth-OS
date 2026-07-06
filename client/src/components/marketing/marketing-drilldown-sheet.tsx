import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  Search, ChevronLeft, ChevronRight, ExternalLink, RefreshCw,
  Info, AlertTriangle, Users, X,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DrilldownConfig = {
  metric: string;
  title?: string;
  extraParams?: Record<string, string | number>;
};

type DrilldownColumn = { key: string; label: string };
type DrilldownRow    = Record<string, any>;

type DrilldownResult = {
  metric: string;
  title: string;
  description: string;
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  columns: DrilldownColumn[];
  rows: DrilldownRow[];
  empty_state?: string;
  refreshed_at: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(raw: string | null | undefined): string {
  if (!raw) return "—";
  try {
    const d = new Date(raw);
    return d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
  } catch { return String(raw); }
}

function fmtVal(key: string, val: any): string {
  if (val === null || val === undefined || val === "") return "—";
  if (key.includes("_at") || key.includes("_date") || key === "created_at") return fmtDate(String(val));
  if (key.includes("_rate") && typeof val === "number") return `${val}%`;
  if (typeof val === "number") return val.toLocaleString();
  if (typeof val === "boolean") return val ? "Yes" : "No";
  return String(val);
}

function BadgeCell({ colKey, val }: { colKey: string; val: any }) {
  const s = String(val ?? "").toLowerCase();

  if (colKey === "consent_status") {
    const color = s === "express" ? "bg-green-500/15 text-green-400 border-green-500/30"
                : s === "implied" ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/30"
                : s === "withdrawn" ? "bg-red-500/15 text-red-400 border-red-500/30"
                : "bg-slate-500/15 text-slate-400 border-slate-500/30";
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${color}`}>{String(val)}</span>;
  }
  if (colKey === "jurisdiction") {
    const color = s === "canada" ? "bg-red-500/15 text-red-300 border-red-500/30"
                : s === "us" ? "bg-blue-500/15 text-blue-300 border-blue-500/30"
                : s === "unknown" ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                : "bg-slate-500/15 text-slate-400 border-slate-500/30";
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${color}`}>{String(val)}</span>;
  }
  if (colKey === "suppression_status" || colKey === "suppression") {
    if (s === "none" || !s) return <span className="text-muted-foreground text-xs">—</span>;
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border bg-red-500/15 text-red-400 border-red-500/30">{String(val)}</span>;
  }
  if (colKey === "unsubscribe_status") {
    if (s === "subscribed") return <span className="text-xs text-muted-foreground">Subscribed</span>;
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border bg-red-500/15 text-red-400 border-red-500/30">{String(val)}</span>;
  }
  if (colKey === "status") {
    const color = s === "active" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                : s === "draft" ? "bg-slate-500/15 text-slate-400 border-slate-500/30"
                : s === "paused" ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                : s === "completed" ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
                : "bg-slate-500/15 text-slate-400 border-slate-500/30";
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${color}`}>{String(val)}</span>;
  }
  if (colKey === "compliance_status") {
    const color = s === "preflight_failed" || s === "blocked" ? "bg-red-500/15 text-red-400 border-red-500/30"
                : s === "cleared" || s === "approved" ? "bg-green-500/15 text-green-400 border-green-500/30"
                : "bg-slate-500/15 text-slate-400 border-slate-500/30";
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${color}`}>{String(val)}</span>;
  }
  if (colKey === "sentiment") {
    const color = s === "positive" ? "bg-emerald-500/15 text-emerald-400" : s === "negative" ? "bg-rose-500/15 text-rose-400" : "bg-slate-500/15 text-slate-400";
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${color}`}>{String(val)}</span>;
  }
  if (colKey === "classification") {
    const colors: Record<string, string> = {
      interested: "bg-emerald-500/15 text-emerald-400",
      meeting_request: "bg-blue-500/15 text-blue-400",
      unsubscribe_request: "bg-red-500/15 text-red-400",
      out_of_office: "bg-slate-500/15 text-slate-400",
      not_interested: "bg-orange-500/15 text-orange-400",
      referral: "bg-purple-500/15 text-purple-400",
    };
    const c = colors[s] ?? "bg-slate-500/15 text-slate-400";
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${c}`}>{String(val).replace(/_/g, " ")}</span>;
  }

  return null; // render as plain text
}

function CellValue({ col, row }: { col: DrilldownColumn; row: DrilldownRow }) {
  const val = row[col.key];

  // Link cells
  if (col.key === "name" && row.id && !row.campaign_id) {
    return (
      <Link href={`/contacts/${row.id}`}>
        <span className="text-primary hover:underline cursor-pointer font-medium">{val || "—"}</span>
      </Link>
    );
  }
  if (col.key === "account_name" && row.account_id) {
    return (
      <Link href={`/accounts/${row.account_id}`}>
        <span className="text-primary hover:underline cursor-pointer">{val || "—"}</span>
      </Link>
    );
  }
  if (col.key === "campaign_name" && row.id) {
    return (
      <Link href={`/marketing/campaigns/${row.id}`}>
        <span className="text-primary hover:underline cursor-pointer">{val || "—"}</span>
      </Link>
    );
  }
  if ((col.key === "campaign_name") && row.campaign_id) {
    return (
      <Link href={`/marketing/campaigns/${row.campaign_id}`}>
        <span className="text-primary hover:underline cursor-pointer">{val || "—"}</span>
      </Link>
    );
  }

  // Badge cells
  const badge = <BadgeCell colKey={col.key} val={val} />;
  if (badge) return badge;

  // Rate highlighting
  if (col.key === "unsub_rate" || col.key === "bounce_rate") {
    const num = parseFloat(String(val ?? 0));
    const color = col.key === "unsub_rate"
      ? num > 2 ? "text-red-400" : num > 0.5 ? "text-amber-400" : "text-muted-foreground"
      : num > 5 ? "text-red-400" : num > 2 ? "text-amber-400" : "text-muted-foreground";
    return <span className={`font-mono tabular-nums text-xs ${color}`}>{num}%</span>;
  }

  // Preview truncation
  if (col.key === "reply_body_preview") {
    return <span className="text-muted-foreground text-xs italic truncate max-w-[200px] block">{String(val ?? "—").slice(0, 80)}{String(val ?? "").length > 80 ? "…" : ""}</span>;
  }

  return <span className="text-xs text-foreground">{fmtVal(col.key, val)}</span>;
}

// ── Main component ─────────────────────────────────────────────────────────────

export function MarketingDrilldownSheet({
  config,
  onClose,
}: {
  config: DrilldownConfig | null;
  onClose: () => void;
}) {
  const [search, setSearch]   = useState("");
  const [page, setPage]       = useState(1);
  const PAGE_SIZE = 25;

  const isOpen = config !== null;
  const metric = config?.metric ?? "";

  const extraParams = config?.extraParams ?? {};
  const queryParams = new URLSearchParams({
    metric,
    page: String(page),
    page_size: String(PAGE_SIZE),
    ...(search ? { search } : {}),
    ...Object.fromEntries(Object.entries(extraParams).map(([k, v]) => [k, String(v)])),
  });

  const queryKey = ["/api/marketing/drilldown", metric, page, search, JSON.stringify(extraParams)];

  const { data, isLoading, isFetching, refetch } = useQuery<DrilldownResult>({
    queryKey,
    queryFn: () => fetch(`/api/marketing/drilldown?${queryParams}`, { credentials: "include" }).then(r => r.json()),
    enabled: isOpen && !!metric,
    staleTime: 30000,
  });

  function handleSearch(val: string) {
    setSearch(val);
    setPage(1);
  }

  function handleClose() {
    setSearch("");
    setPage(1);
    onClose();
  }

  const title       = data?.title       ?? config?.title ?? "Details";
  const description = data?.description ?? "";
  const total       = data?.total       ?? 0;
  const totalPages  = data?.total_pages ?? 1;
  const columns     = data?.columns     ?? [];
  const rows        = data?.rows        ?? [];
  const emptyState  = data?.empty_state ?? "";
  const refreshedAt = data?.refreshed_at;

  return (
    <Sheet open={isOpen} onOpenChange={open => { if (!open) handleClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-4xl flex flex-col p-0 gap-0 bg-background border-l border-border/50 overflow-hidden"
        data-testid="marketing-drilldown-sheet"
      >
        {/* Header */}
        <SheetHeader className="px-5 py-4 border-b border-border/50 shrink-0 space-y-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Users className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0">
                <SheetTitle className="text-base font-semibold leading-tight">{title}</SheetTitle>
                {description && (
                  <SheetDescription className="text-xs text-muted-foreground mt-0.5 leading-snug">
                    {description}
                  </SheetDescription>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {!isLoading && (
                <Badge variant="secondary" className="text-xs font-mono tabular-nums" data-testid="drilldown-total">
                  {total.toLocaleString()} total
                </Badge>
              )}
              <Button
                variant="ghost" size="icon" className="h-8 w-8"
                onClick={() => refetch()}
                data-testid="btn-drilldown-refresh"
                aria-label="Refresh data"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
              </Button>
              <Button
                variant="ghost" size="icon" className="h-8 w-8"
                onClick={handleClose}
                data-testid="btn-drilldown-close"
                aria-label="Close"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </SheetHeader>

        {/* Search bar */}
        <div className="px-5 py-3 border-b border-border/30 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Search by name, email, or company…"
              className="pl-8 h-8 text-xs bg-muted/30"
              data-testid="input-drilldown-search"
            />
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto min-h-0">
          {isLoading ? (
            <div className="p-5 space-y-2">
              {[1,2,3,4,5,6,7,8].map(i => (
                <Skeleton key={i} className="h-8 rounded" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 px-8 text-center" data-testid="drilldown-empty">
              <div className="w-12 h-12 rounded-xl bg-muted/30 flex items-center justify-center mb-4">
                <Info className="w-6 h-6 text-muted-foreground/50" />
              </div>
              <p className="text-sm font-medium text-foreground mb-1">
                {search ? "No matching records" : `No records found`}
              </p>
              <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">
                {emptyState || (search
                  ? "Try a different search term."
                  : `No contacts or records currently match the "${title}" criteria.`
                )}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[640px]" data-testid="drilldown-table">
                <thead className="bg-muted/30 border-b border-border/40 sticky top-0 z-10">
                  <tr>
                    {columns.map(col => (
                      <th
                        key={col.key}
                        className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap"
                      >
                        {col.label}
                      </th>
                    ))}
                    <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wide w-10" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr
                      key={row.id ?? i}
                      className="border-b border-border/20 hover:bg-muted/10 transition-colors"
                      data-testid={`drilldown-row-${row.id ?? i}`}
                    >
                      {columns.map(col => (
                        <td
                          key={col.key}
                          className="px-4 py-2.5 max-w-[200px]"
                        >
                          <CellValue col={col} row={row} />
                        </td>
                      ))}
                      <td className="px-4 py-2.5">
                        {row.id && !row.campaign_id && (
                          <Link href={`/contacts/${row.id}`}>
                            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-primary transition-colors cursor-pointer" aria-label="Open CRM record" />
                          </Link>
                        )}
                        {row.id && row.campaign_id && (
                          <Link href={`/accounts/${row.account_id}`}>
                            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-primary transition-colors cursor-pointer" aria-label="Open account" />
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination footer */}
        {!isLoading && totalPages > 1 && (
          <div className="px-5 py-3 border-t border-border/40 shrink-0 flex items-center justify-between" data-testid="drilldown-pagination">
            <span className="text-xs text-muted-foreground">
              Page {page} of {totalPages} · {total.toLocaleString()} records
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline" size="icon" className="h-7 w-7"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                data-testid="btn-drilldown-prev"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="outline" size="icon" className="h-7 w-7"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                data-testid="btn-drilldown-next"
                aria-label="Next page"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Refreshed at footer */}
        {refreshedAt && (
          <div className="px-5 py-2 border-t border-border/20 shrink-0">
            <p className="text-[10px] text-muted-foreground/60">
              Refreshed {fmtDate(refreshedAt)} · counts match the dashboard cards
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
