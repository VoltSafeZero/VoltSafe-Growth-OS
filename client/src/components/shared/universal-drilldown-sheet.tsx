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
  Info, BarChart3, X,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type UniversalDrilldownConfig = {
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
  if (key.includes("_rate") && typeof val === "number") return `${val.toFixed(1)}%`;
  if ((key.includes("amount") || key.includes("value") || key.includes("revenue") || key.includes("total")) && typeof val === "number") {
    if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}k`;
    return `$${Math.round(val).toLocaleString()}`;
  }
  if (typeof val === "number") return val.toLocaleString();
  if (typeof val === "boolean") return val ? "Yes" : "No";
  return String(val);
}

function StatusBadge({ val, colKey }: { val: any; colKey: string }) {
  const s = String(val ?? "").toLowerCase();

  if (colKey === "stage") {
    const STAGE_LABELS: Record<string, string> = {
      inbound_new: "New", qualifying: "Qualifying", discovery: "Discovery",
      proposal: "Proposal", negotiation: "Negotiating", verbal_commit: "Verbal Commit",
      closed_won: "Won", closed_lost: "Lost",
    };
    const STAGE_COLOR: Record<string, string> = {
      inbound_new: "bg-gray-500/15 text-gray-400 border-gray-500/30",
      qualifying: "bg-purple-500/15 text-purple-400 border-purple-500/30",
      discovery: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
      proposal: "bg-blue-500/15 text-blue-400 border-blue-500/30",
      negotiation: "bg-amber-500/15 text-amber-400 border-amber-500/30",
      verbal_commit: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
      closed_won: "bg-green-600/15 text-green-400 border-green-600/30",
      closed_lost: "bg-red-500/15 text-red-400 border-red-500/30",
    };
    const color = STAGE_COLOR[s] ?? "bg-slate-500/15 text-slate-400 border-slate-500/30";
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${color}`}>{STAGE_LABELS[s] ?? String(val)}</span>;
  }

  if (colKey === "status" || colKey === "workflow_status" || colKey === "install_status") {
    const color =
      s === "active" || s === "in_progress" || s === "in progress" ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
      : s === "accepted" || s === "completed" || s === "complete" || s === "closed_won" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      : s === "declined" || s === "expired" || s === "closed_lost" || s === "at_risk" ? "bg-red-500/15 text-red-400 border-red-500/30"
      : s === "sent" || s === "pending_kickoff" || s === "pending" ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
      : s === "draft" || s === "on_hold" ? "bg-slate-500/15 text-slate-400 border-slate-500/30"
      : "bg-slate-500/15 text-slate-400 border-slate-500/30";
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${color}`}>{String(val).replace(/_/g, " ")}</span>;
  }

  if (colKey === "forecast_category") {
    const color = s === "commit" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      : s === "best_case" ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
      : "bg-slate-500/15 text-slate-400 border-slate-500/30";
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${color}`}>{String(val).replace(/_/g, " ")}</span>;
  }

  if (colKey === "health" || colKey === "health_status" || colKey === "cs_health") {
    const color = s === "healthy" || s === "good" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      : s === "at_risk" || s === "churned" ? "bg-red-500/15 text-red-400 border-red-500/30"
      : "bg-amber-500/15 text-amber-400 border-amber-500/30";
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${color}`}>{String(val).replace(/_/g, " ")}</span>;
  }

  if (colKey === "source" || colKey === "acquisition_channel") {
    const color = s === "referral" ? "bg-purple-500/15 text-purple-400 border-purple-500/30"
      : s === "organic" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      : s === "paid" ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
      : "bg-slate-500/15 text-slate-400 border-slate-500/30";
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${color}`}>{String(val)}</span>;
  }

  return null;
}

function CellValue({ col, row }: { col: DrilldownColumn; row: DrilldownRow }) {
  const val = row[col.key];

  // ── Link cells ────────────────────────────────────────────────────────────
  if (col.key === "title" && row.opp_id) {
    return <Link href={`/opportunities/${row.opp_id}`}><span className="text-primary hover:underline cursor-pointer font-medium">{val || "—"}</span></Link>;
  }
  if (col.key === "opportunity_title" && row.opp_id) {
    return <Link href={`/opportunities/${row.opp_id}`}><span className="text-primary hover:underline cursor-pointer">{val || "—"}</span></Link>;
  }
  if (col.key === "company" && row.lead_id) {
    return <Link href={`/opportunities/${row.lead_id}`}><span className="text-primary hover:underline cursor-pointer font-medium">{val || "—"}</span></Link>;
  }
  if (col.key === "contact_name" && row.lead_id) {
    return <Link href={`/opportunities/${row.lead_id}`}><span className="text-primary hover:underline cursor-pointer">{val || "—"}</span></Link>;
  }
  if (col.key === "account_name" && row.account_id) {
    return <Link href={`/accounts/${row.account_id}`}><span className="text-primary hover:underline cursor-pointer">{val || "—"}</span></Link>;
  }
  if (col.key === "contact_name" && row.contact_id) {
    return <Link href={`/contacts/${row.contact_id}`}><span className="text-primary hover:underline cursor-pointer font-medium">{val || "—"}</span></Link>;
  }
  if (col.key === "quote_number" && row.quote_id) {
    return <Link href={`/quotes/${row.quote_id}`}><span className="text-primary hover:underline cursor-pointer font-mono text-xs">{val || "—"}</span></Link>;
  }
  if (col.key === "install_title" && row.install_id) {
    return <Link href={`/install-workflows/${row.install_id}`}><span className="text-primary hover:underline cursor-pointer">{val || "—"}</span></Link>;
  }

  // ── Badge cells ───────────────────────────────────────────────────────────
  const badge = <StatusBadge colKey={col.key} val={val} />;
  if (badge) return badge;

  // ── Days-since highlighting ────────────────────────────────────────────────
  if (col.key === "days_since_activity" || col.key === "days_inactive") {
    const n = Number(val ?? 0);
    const color = n >= 21 ? "text-red-400" : n >= 14 ? "text-amber-400" : n >= 7 ? "text-yellow-400" : "text-muted-foreground";
    return <span className={`font-mono tabular-nums text-xs ${color}`}>{n === 0 ? "Today" : `${n}d`}</span>;
  }

  // ── Win-rate / probability highlighting ───────────────────────────────────
  if (col.key === "win_rate" || col.key === "probability") {
    const n = parseFloat(String(val ?? 0));
    const color = n >= 50 ? "text-emerald-400" : n >= 25 ? "text-amber-400" : "text-red-400";
    return <span className={`font-mono tabular-nums text-xs ${color}`}>{n.toFixed(0)}%</span>;
  }

  return <span className="text-xs text-foreground">{fmtVal(col.key, val)}</span>;
}

// ── Row link helper ───────────────────────────────────────────────────────────

function RowLink({ row }: { row: DrilldownRow }) {
  if (row.opp_id)     return <Link href={`/opportunities/${row.opp_id}`}><ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-primary transition-colors cursor-pointer" aria-label="Open opportunity" /></Link>;
  if (row.lead_id)    return <Link href={`/opportunities/${row.lead_id}`}><ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-primary transition-colors cursor-pointer" aria-label="Open lead" /></Link>;
  if (row.contact_id) return <Link href={`/contacts/${row.contact_id}`}><ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-primary transition-colors cursor-pointer" aria-label="Open contact" /></Link>;
  if (row.account_id) return <Link href={`/accounts/${row.account_id}`}><ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-primary transition-colors cursor-pointer" aria-label="Open account" /></Link>;
  if (row.quote_id)   return <Link href={`/quotes/${row.quote_id}`}><ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-primary transition-colors cursor-pointer" aria-label="Open quote" /></Link>;
  if (row.install_id) return <Link href={`/install-workflows/${row.install_id}`}><ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-primary transition-colors cursor-pointer" aria-label="Open install workflow" /></Link>;
  return null;
}

// ── Main component ─────────────────────────────────────────────────────────────

export function UniversalDrilldownSheet({
  config,
  onClose,
  endpoint = "/api/pipeline/drilldown",
}: {
  config: UniversalDrilldownConfig | null;
  onClose: () => void;
  endpoint?: string;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage]     = useState(1);
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

  const queryKey = [endpoint, metric, page, search, JSON.stringify(extraParams)];

  const { data, isLoading, isFetching, refetch } = useQuery<DrilldownResult>({
    queryKey,
    queryFn: () => fetch(`${endpoint}?${queryParams}`, { credentials: "include" }).then(r => r.json()),
    enabled: isOpen && !!metric,
    staleTime: 30000,
  });

  function handleSearch(val: string) { setSearch(val); setPage(1); }
  function handleClose() { setSearch(""); setPage(1); onClose(); }

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
        data-testid="universal-drilldown-sheet"
      >
        {/* Header */}
        <SheetHeader className="px-5 py-4 border-b border-border/50 shrink-0 space-y-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <BarChart3 className="w-4 h-4 text-primary" />
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
              placeholder="Search records…"
              className="pl-8 h-8 text-xs bg-muted/30"
              data-testid="input-drilldown-search"
            />
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto min-h-0">
          {isLoading ? (
            <div className="p-5 space-y-2">
              {[1,2,3,4,5,6,7,8].map(i => <Skeleton key={i} className="h-8 rounded" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 px-8 text-center" data-testid="drilldown-empty">
              <div className="w-12 h-12 rounded-xl bg-muted/30 flex items-center justify-center mb-4">
                <Info className="w-6 h-6 text-muted-foreground/50" />
              </div>
              <p className="text-sm font-medium text-foreground mb-1">
                {search ? "No matching records" : "No records found"}
              </p>
              <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">
                {emptyState || (search ? "Try a different search term." : `No records currently match this metric.`)}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[640px]" data-testid="drilldown-table">
                <thead className="bg-muted/30 border-b border-border/40 sticky top-0 z-10">
                  <tr>
                    {columns.map(col => (
                      <th key={col.key} className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                        {col.label}
                      </th>
                    ))}
                    <th className="px-4 py-2.5 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr
                      key={row.opp_id ?? row.lead_id ?? row.contact_id ?? row.quote_id ?? row.account_id ?? row.install_id ?? i}
                      className="border-b border-border/20 hover:bg-muted/10 transition-colors"
                      data-testid={`drilldown-row-${row.opp_id ?? row.lead_id ?? row.contact_id ?? row.quote_id ?? row.install_id ?? i}`}
                    >
                      {columns.map(col => (
                        <td key={col.key} className="px-4 py-2.5 max-w-[220px]">
                          <CellValue col={col} row={row} />
                        </td>
                      ))}
                      <td className="px-4 py-2.5">
                        <RowLink row={row} />
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
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} data-testid="btn-drilldown-prev" aria-label="Previous page">
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} data-testid="btn-drilldown-next" aria-label="Next page">
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Footer timestamp */}
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
