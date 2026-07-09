import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Search, ChevronLeft, ChevronRight, ExternalLink, RefreshCw, Users, X, Download, CheckCheck, Mail, Plus, Tag,
} from "lucide-react";
import { InfoIcon as Info } from "@/components/icons/info-icon";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DrilldownConfig = {
  metric: string;
  title?: string;
  extraParams?: Record<string, string | number>;
  cardCount?: number;
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

// ── Metric categories ─────────────────────────────────────────────────────────

const CONTACT_METRICS = new Set([
  "unknown_jurisdiction","jurisdiction_canada","jurisdiction_us","jurisdiction_other",
  "express_consent","implied_active","implied_expiring_30","implied_expiring_60",
  "implied_expiring_90","implied_expired","missing_consent_proof","unknown_consent",
  "us_biz_eligible","us_opted_out","unsubscribed","suppressed","quarantined",
  "consent_source","audience_contacts",
]);

const CAMPAIGN_METRICS = new Set([
  "all_campaigns","active_campaigns","campaigns_blocked","campaigns_needs_approval",
  "campaigns_with_replies","avg_unsub_rate","avg_bounce_rate","spam_complaint_rate",
]);

const REPLY_METRICS = new Set([
  "replies_total","replies_pending","replies_auto_ingested","replies_task_created",
]);

// ── Per-metric empty states ───────────────────────────────────────────────────

const METRIC_EMPTY_STATES: Record<string, string> = {
  express_consent:       "No contacts currently have express consent on file. Add consent proof from CRM contact records or create a consent capture workflow.",
  campaigns_blocked:     "No campaigns are currently blocked by compliance checks. All campaigns have passed preflight — no action needed.",
  spam_complaint_rate:   "No spam complaints found for the selected period. Keep monitoring as campaigns are sent.",
  form_opt_in_rate:      "Form opt-in tracking is not yet configured. Once web forms are connected, opt-in contacts will appear here.",
  implied_expired:       "No contacts with expired implied consent — your implied consent base is current.",
  missing_consent_proof: "All Canadian express-consent contacts have documented proof on file. No action needed.",
  unknown_jurisdiction:  "All contacts have a jurisdiction on file. No unclassified contacts found.",
  unknown_consent:       "All contacts have a consent classification. No unknown consent records found.",
  implied_expiring_30:   "No contacts with implied consent expiring within 30 days.",
  implied_expiring_60:   "No contacts with implied consent expiring within 60 days.",
  implied_expiring_90:   "No contacts with implied consent expiring within 90 days.",
  unsubscribed:          "No unsubscribed contacts found for the current filters.",
  suppressed:            "No suppressed contacts found for the current filters.",
  quarantined:           "No quarantined imports found.",
  replies_pending:       "No replies are currently waiting for review. All replies have been processed.",
  replies_total:         "No inbound campaign replies found. Replies will appear here once recipients respond to campaigns.",
  hot_accounts_by_label: "No engaged accounts found. Accounts will appear here once contacts start opening or clicking campaign emails.",
  audience_contacts:     "This audience segment has no contacts matching the current criteria.",
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
    const color = s === "express"   ? "bg-green-500/15 text-green-400 border-green-500/30"
                : s === "implied"   ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/30"
                : s === "withdrawn" ? "bg-red-500/15 text-red-400 border-red-500/30"
                : "bg-slate-500/15 text-slate-400 border-slate-500/30";
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${color}`}>{String(val)}</span>;
  }
  if (colKey === "jurisdiction") {
    const color = s === "canada"  ? "bg-red-500/15 text-red-300 border-red-500/30"
                : s === "us"      ? "bg-blue-500/15 text-blue-300 border-blue-500/30"
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
    const color = s === "active"    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                : s === "draft"     ? "bg-slate-500/15 text-slate-400 border-slate-500/30"
                : s === "paused"    ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                : s === "completed" ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
                : "bg-slate-500/15 text-slate-400 border-slate-500/30";
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${color}`}>{String(val)}</span>;
  }
  if (colKey === "compliance_status") {
    const color = s === "preflight_failed" || s === "blocked"
      ? "bg-red-500/15 text-red-400 border-red-500/30"
      : s === "cleared" || s === "approved"
      ? "bg-green-500/15 text-green-400 border-green-500/30"
      : "bg-slate-500/15 text-slate-400 border-slate-500/30";
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${color}`}>{String(val)}</span>;
  }
  if (colKey === "sentiment") {
    const color = s === "positive" ? "bg-emerald-500/15 text-emerald-400"
                : s === "negative" ? "bg-rose-500/15 text-rose-400"
                : "bg-slate-500/15 text-slate-400";
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${color}`}>{String(val)}</span>;
  }
  if (colKey === "classification") {
    const colors: Record<string, string> = {
      interested:           "bg-emerald-500/15 text-emerald-400",
      meeting_request:      "bg-blue-500/15 text-blue-400",
      unsubscribe_request:  "bg-red-500/15 text-red-400",
      out_of_office:        "bg-slate-500/15 text-slate-400",
      not_interested:       "bg-orange-500/15 text-orange-400",
      referral:             "bg-purple-500/15 text-purple-400",
    };
    const c = colors[s] ?? "bg-slate-500/15 text-slate-400";
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${c}`}>{String(val).replace(/_/g, " ")}</span>;
  }
  return null;
}

function CellValue({ col, row }: { col: DrilldownColumn; row: DrilldownRow }) {
  const val = row[col.key];

  if (col.key === "name" && row.id && !row.campaign_id) {
    return (
      <Link href={`/contacts/${row.id}`}>
        <span className="text-primary hover:underline cursor-pointer font-medium">{val || "—"}</span>
      </Link>
    );
  }
  if (col.key === "contact_name") {
    return <span className="font-medium text-foreground">{val || "—"}</span>;
  }
  if (col.key === "account_name" && row.account_id) {
    return (
      <Link href={`/accounts/${row.account_id}`}>
        <span className="text-primary hover:underline cursor-pointer">{val || "—"}</span>
      </Link>
    );
  }
  if (col.key === "campaign_name" && row.id && !row.account_id && !row.contact_name) {
    return (
      <Link href={`/marketing/campaigns/${row.id}`}>
        <span className="text-primary hover:underline cursor-pointer">{val || "—"}</span>
      </Link>
    );
  }
  if (col.key === "campaign_name" && row.campaign_id) {
    return (
      <Link href={`/marketing/campaigns/${row.campaign_id}`}>
        <span className="text-primary hover:underline cursor-pointer">{val || "—"}</span>
      </Link>
    );
  }

  const badge = <BadgeCell colKey={col.key} val={val} />;
  if (badge) return badge;

  if (col.key === "unsub_rate" || col.key === "bounce_rate") {
    const num = parseFloat(String(val ?? 0));
    const color = col.key === "unsub_rate"
      ? num > 2 ? "text-red-400" : num > 0.5 ? "text-amber-400" : "text-muted-foreground"
      : num > 5 ? "text-red-400" : num > 2  ? "text-amber-400" : "text-muted-foreground";
    return <span className={`font-mono tabular-nums text-xs ${color}`}>{num}%</span>;
  }
  if (col.key === "reply_body_preview") {
    return <span className="text-muted-foreground text-xs italic truncate max-w-[200px] block">{String(val ?? "—").slice(0, 80)}{String(val ?? "").length > 80 ? "…" : ""}</span>;
  }
  return <span className="text-xs text-foreground">{fmtVal(col.key, val)}</span>;
}

// ── Row Detail Panel ──────────────────────────────────────────────────────────

function DetailField({ label, value }: { label: string; value: any }) {
  const display = value === null || value === undefined || value === "" ? "—" : String(value);
  return (
    <div>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-xs text-foreground break-words">{display}</p>
    </div>
  );
}

function RowDetailPanel({
  row, metric, onClose, onCreateTask, onMarkReviewed, isCreatingTask, isMarkingReviewed,
}: {
  row: DrilldownRow;
  metric: string;
  onClose: () => void;
  onCreateTask: (row: DrilldownRow) => void;
  onMarkReviewed: (row: DrilldownRow) => void;
  isCreatingTask: boolean;
  isMarkingReviewed: boolean;
}) {
  const displayName = row.name || row.contact_name || row.campaign_name || row.account_name || "Record";
  const fields: Array<{ label: string; value: any }> = [];
  const isReply      = REPLY_METRICS.has(metric);
  const isHotAccount = metric === "hot_accounts_by_label";
  const isCampaign   = CAMPAIGN_METRICS.has(metric);

  if (CONTACT_METRICS.has(metric)) {
    if (row.email)        fields.push({ label: "Email",           value: row.email });
    if (row.account_name) fields.push({ label: "Company",         value: row.account_name });
    if (row.jurisdiction) fields.push({ label: "Jurisdiction",    value: row.jurisdiction });
    if (row.province_state) fields.push({ label: "Province/State", value: row.province_state });
    fields.push({ label: "Consent Status", value: row.consent_status || "—" });
    if (row.consent_source) fields.push({ label: "Consent Source", value: row.consent_source });
    if (row.implied_consent_expiry_date) fields.push({ label: "Consent Expiry", value: fmtDate(row.implied_consent_expiry_date) });
    if (row.unsubscribe_status && row.unsubscribe_status !== "subscribed") {
      fields.push({ label: "Unsub Status", value: row.unsubscribe_status });
      if (row.unsubscribe_source) fields.push({ label: "Unsub Source", value: row.unsubscribe_source });
    }
    if (row.suppression_status && row.suppression_status !== "none") {
      fields.push({ label: "Suppression",        value: row.suppression_status });
      if (row.suppression_reason) fields.push({ label: "Suppression Reason", value: row.suppression_reason });
    }
    if (row.lead_source) fields.push({ label: "Lead Source", value: row.lead_source });
    fields.push({ label: "Created", value: fmtDate(row.created_at) });
  } else if (isCampaign) {
    if (row.status)            fields.push({ label: "Status",          value: row.status });
    if (row.compliance_status) fields.push({ label: "Compliance",      value: row.compliance_status });
    if (row.campaign_type)     fields.push({ label: "Type",            value: row.campaign_type });
    if (row.sent_count        !== undefined) fields.push({ label: "Sent",              value: (row.sent_count        ?? 0).toLocaleString() });
    if (row.opened_count      !== undefined) fields.push({ label: "Opened",            value: (row.opened_count      ?? 0).toLocaleString() });
    if (row.clicked_count     !== undefined) fields.push({ label: "Clicked",           value: (row.clicked_count     ?? 0).toLocaleString() });
    if (row.replied_count     !== undefined) fields.push({ label: "Replies",           value: (row.replied_count     ?? 0).toLocaleString() });
    if (row.bounced_count     !== undefined) fields.push({ label: "Bounced",           value: (row.bounced_count     ?? 0).toLocaleString() });
    if (row.unsubscribed_count !== undefined) fields.push({ label: "Unsubscribed",     value: (row.unsubscribed_count ?? 0).toLocaleString() });
    if (row.blocked_recipient_count !== undefined) fields.push({ label: "Blocked Recipients", value: (row.blocked_recipient_count ?? 0).toLocaleString() });
    if (row.unsub_rate   !== undefined) fields.push({ label: "Unsub Rate",   value: `${row.unsub_rate}%` });
    if (row.bounce_rate  !== undefined) fields.push({ label: "Bounce Rate",  value: `${row.bounce_rate}%` });
    if (row.owner_name)        fields.push({ label: "Owner",   value: row.owner_name });
    fields.push({ label: "Created", value: fmtDate(row.created_at) });
  } else if (isReply) {
    if (row.contact_email) fields.push({ label: "Email",           value: row.contact_email });
    if (row.account_name)  fields.push({ label: "Company",         value: row.account_name });
    if (row.campaign_name) fields.push({ label: "Campaign",        value: row.campaign_name });
    fields.push({ label: "Classification", value: (row.classification || "—").replace(/_/g, " ") });
    fields.push({ label: "Sentiment",      value: row.sentiment || "—" });
    fields.push({ label: "Status",         value: row.status    || "—" });
    if (row.confidence !== undefined) fields.push({ label: "Confidence", value: `${Math.round((row.confidence || 0) * 100)}%` });
    if (row.reply_body_preview) fields.push({ label: "Reply Preview", value: row.reply_body_preview });
    fields.push({ label: "Received", value: fmtDate(row.created_at) });
  } else if (isHotAccount) {
    if (row.marina_type)    fields.push({ label: "Type",             value: row.marina_type });
    if (row.state_province) fields.push({ label: "Region",           value: row.state_province });
    if (row.engaged_contacts !== undefined) fields.push({ label: "Engaged Contacts", value: (row.engaged_contacts ?? 0).toLocaleString() });
    if (row.open_count       !== undefined) fields.push({ label: "Opens",   value: (row.open_count  ?? 0).toLocaleString() });
    if (row.click_count      !== undefined) fields.push({ label: "Clicks",  value: (row.click_count ?? 0).toLocaleString() });
    if (row.reply_count      !== undefined) fields.push({ label: "Replies", value: (row.reply_count ?? 0).toLocaleString() });
    if (row.last_engagement_at) fields.push({ label: "Last Engagement", value: fmtDate(row.last_engagement_at) });
  }

  return (
    <div
      className="w-72 shrink-0 border-l border-border/40 flex flex-col bg-muted/5 overflow-hidden"
      data-testid="drilldown-row-detail"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 shrink-0">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground truncate">{displayName}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Record detail</p>
        </div>
        <Button
          variant="ghost" size="icon" className="h-6 w-6 shrink-0"
          onClick={onClose}
          data-testid="btn-detail-close"
          aria-label="Close detail"
        >
          <X className="w-3 h-3" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {fields.map(f => <DetailField key={f.label} label={f.label} value={f.value} />)}
      </div>

      <div className="px-4 py-3 border-t border-border/40 shrink-0 space-y-2">
        {CONTACT_METRICS.has(metric) && row.id && (
          <Link href={`/contacts/${row.id}`}>
            <Button variant="outline" size="sm" className="w-full h-7 text-xs gap-1.5" data-testid="btn-detail-open-contact">
              <ExternalLink className="w-3 h-3" />
              Open Contact Record
            </Button>
          </Link>
        )}
        {isCampaign && row.id && (
          <Link href={`/marketing/campaigns/${row.id}`}>
            <Button variant="outline" size="sm" className="w-full h-7 text-xs gap-1.5" data-testid="btn-detail-open-campaign">
              <ExternalLink className="w-3 h-3" />
              Open Campaign
            </Button>
          </Link>
        )}
        {isHotAccount && row.account_id && (
          <Link href={`/accounts/${row.account_id}`}>
            <Button variant="outline" size="sm" className="w-full h-7 text-xs gap-1.5" data-testid="btn-detail-open-account">
              <ExternalLink className="w-3 h-3" />
              Open Account
            </Button>
          </Link>
        )}
        {isReply && row.contact_email && (
          <Link href={`/gmail?search=${encodeURIComponent(row.contact_email)}`}>
            <Button variant="outline" size="sm" className="w-full h-7 text-xs gap-1.5" data-testid="btn-detail-open-mail">
              <Mail className="w-3 h-3" />
              Open in VoltSafe Mail
            </Button>
          </Link>
        )}
        {isReply && row.status === "pending" && (
          <Button
            variant="outline" size="sm"
            className="w-full h-7 text-xs gap-1.5"
            onClick={() => onMarkReviewed(row)}
            disabled={isMarkingReviewed}
            data-testid="btn-detail-mark-reviewed"
          >
            <CheckCheck className="w-3 h-3" />
            {isMarkingReviewed ? "Marking…" : "Mark as Reviewed"}
          </Button>
        )}
        <Button
          variant="default" size="sm"
          className="w-full h-7 text-xs gap-1.5"
          onClick={() => onCreateTask(row)}
          disabled={isCreatingTask}
          data-testid="btn-detail-create-task"
        >
          <Plus className="w-3 h-3" />
          {isCreatingTask ? "Creating…" : "Create Follow-up Task"}
        </Button>
      </div>
    </div>
  );
}

// ── Filter Chips ──────────────────────────────────────────────────────────────

function FilterChips({
  metric, extraParams, search, onClearSearch,
}: {
  metric: string;
  extraParams: Record<string, string | number>;
  search: string;
  onClearSearch: () => void;
}) {
  const chips: Array<{ label: string; value: string; onRemove?: () => void }> = [];
  chips.push({ label: "Metric", value: metric.replace(/_/g, " ") });

  Object.entries(extraParams).forEach(([k, v]) => {
    if (k !== "segment_id") chips.push({ label: k.replace(/_/g, " "), value: String(v) });
  });
  if (search) chips.push({ label: "Search", value: `"${search}"`, onRemove: onClearSearch });

  return (
    <div className="px-5 py-2 border-b border-border/20 flex flex-wrap items-center gap-1.5 shrink-0" data-testid="drilldown-filter-chips">
      <Tag className="w-3 h-3 text-muted-foreground/60 shrink-0" />
      {chips.map((chip, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-primary/10 text-primary border border-primary/20"
        >
          <span className="text-muted-foreground">{chip.label}:</span>
          <span className="font-medium">{chip.value}</span>
          {chip.onRemove && (
            <button
              onClick={chip.onRemove}
              className="ml-0.5 hover:text-foreground"
              aria-label={`Remove ${chip.label} filter`}
            >
              <X className="w-2.5 h-2.5" />
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function MarketingDrilldownSheet({
  config,
  onClose,
}: {
  config: DrilldownConfig | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [search, setSearch]             = useState("");
  const [page, setPage]                 = useState(1);
  const [selectedRow, setSelectedRow]   = useState<DrilldownRow | null>(null);
  const PAGE_SIZE = 25;

  const isOpen      = config !== null;
  const metric      = config?.metric ?? "";
  const cardCount   = config?.cardCount;
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

  const createTaskMutation = useMutation({
    mutationFn: (body: object) => apiRequest("/api/tasks", { method: "POST", body }),
    onSuccess: () => toast({ title: "Follow-up task created", description: "Added to your task list." }),
    onError:   () => toast({ title: "Failed to create task", variant: "destructive" }),
  });

  const markReviewedMutation = useMutation({
    mutationFn: (replyId: number) => apiRequest(`/api/marketing/replies/${replyId}/review`, { method: "POST", body: {} }),
    onSuccess: () => {
      toast({ title: "Marked as reviewed" });
      refetch();
      setSelectedRow(null);
    },
    onError: () => toast({ title: "Failed to mark as reviewed", variant: "destructive" }),
  });

  function handleSearch(val: string) { setSearch(val); setPage(1); }

  function handleClose() {
    setSearch("");
    setPage(1);
    setSelectedRow(null);
    onClose();
  }

  function handleExport() {
    const params = new URLSearchParams({
      metric,
      ...(search ? { search } : {}),
      ...Object.fromEntries(Object.entries(extraParams).map(([k, v]) => [k, String(v)])),
    });
    window.location.href = `/api/marketing/drilldown/export?${params}`;
  }

  function handleCreateTask(row: DrilldownRow) {
    let title       = "Follow-up task";
    let description = `Created from ${metric.replace(/_/g, " ")} drilldown`;
    let body: Record<string, any> = { status: "todo", priority: "medium" };

    if (CONTACT_METRICS.has(metric) && row.id) {
      title       = `Follow up with ${row.name || "contact"}`;
      body.linkedObjectType = "contact";
      body.linkedObjectId   = row.id;
      if (row.account_id) body.accountId = row.account_id;
    } else if (REPLY_METRICS.has(metric)) {
      title       = `Review reply from ${row.contact_name || "contact"}`;
      description = `${(row.classification || "").replace(/_/g, " ")} reply via "${row.campaign_name || "campaign"}"`;
      if (["interested","meeting_request"].includes(row.classification)) body.priority = "high";
    } else if (metric === "hot_accounts_by_label" && row.account_id) {
      title       = `Follow up with ${row.account_name || "account"}`;
      description = `Hot account: ${row.open_count || 0} opens, ${row.click_count || 0} clicks, ${row.reply_count || 0} replies`;
      body.accountId = row.account_id;
      body.priority  = "high";
    } else if (CAMPAIGN_METRICS.has(metric) && row.id) {
      title = `Review campaign: ${row.campaign_name || "campaign"}`;
    }
    createTaskMutation.mutate({ ...body, title, description });
  }

  function handleMarkReviewed(row: DrilldownRow) {
    if (!row.id) return;
    markReviewedMutation.mutate(row.id);
  }

  function handleRowClick(row: DrilldownRow) {
    const sameRow = selectedRow
      ? (selectedRow.id !== undefined && selectedRow.id === row.id) ||
        (selectedRow.account_id !== undefined && selectedRow.id === undefined && selectedRow.account_id === row.account_id)
      : false;
    setSelectedRow(sameRow ? null : row);
  }

  const title       = data?.title       ?? config?.title ?? "Details";
  const description = data?.description ?? "";
  const total       = data?.total       ?? 0;
  const totalPages  = data?.total_pages ?? 1;
  const columns     = data?.columns     ?? [];
  const rows        = data?.rows        ?? [];
  const emptyState  = data?.empty_state ?? METRIC_EMPTY_STATES[metric] ?? "";
  const refreshedAt = data?.refreshed_at;
  const countMismatch = !isLoading && cardCount !== undefined && cardCount !== total && total > 0;

  return (
    <Sheet open={isOpen} onOpenChange={open => { if (!open) handleClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-5xl flex flex-col p-0 gap-0 bg-background border-l border-border/50 overflow-hidden"
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
              {countMismatch && (
                <Badge
                  variant="outline"
                  className="text-xs font-mono tabular-nums text-amber-400 border-amber-400/30"
                  data-testid="drilldown-count-mismatch"
                >
                  Updated: {total.toLocaleString()}
                </Badge>
              )}
              <Button
                variant="outline" size="sm" className="h-8 px-2.5 text-xs gap-1.5"
                onClick={handleExport}
                data-testid="btn-drilldown-export"
                aria-label="Export CSV"
                disabled={isLoading || total === 0}
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">CSV</span>
              </Button>
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

        {/* Search */}
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

        {/* Filter chips */}
        <FilterChips
          metric={metric}
          extraParams={extraParams}
          search={search}
          onClearSearch={() => handleSearch("")}
        />

        {/* Body: table + optional detail panel side-by-side */}
        <div className="flex-1 flex min-h-0 overflow-hidden">

          {/* Table */}
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
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wide w-24">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => {
                      const rowId = row.id ?? row.account_id;
                      const isSelected = selectedRow
                        ? (selectedRow.id !== undefined && selectedRow.id === row.id) ||
                          (selectedRow.account_id !== undefined && selectedRow.id === undefined && selectedRow.account_id === row.account_id)
                        : false;
                      return (
                        <tr
                          key={rowId ?? i}
                          className={`border-b border-border/20 hover:bg-muted/10 transition-colors cursor-pointer ${isSelected ? "bg-primary/5" : ""}`}
                          onClick={() => handleRowClick(row)}
                          data-testid={`drilldown-row-${rowId ?? i}`}
                        >
                          {columns.map(col => (
                            <td key={col.key} className="px-4 py-2.5 max-w-[200px]">
                              <CellValue col={col} row={row} />
                            </td>
                          ))}
                          <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center gap-1.5">
                              {CONTACT_METRICS.has(metric) && row.id && (
                                <Link href={`/contacts/${row.id}`}>
                                  <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-primary transition-colors" aria-label="Open contact" />
                                </Link>
                              )}
                              {CAMPAIGN_METRICS.has(metric) && row.id && (
                                <Link href={`/marketing/campaigns/${row.id}`}>
                                  <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-primary transition-colors" aria-label="Open campaign" />
                                </Link>
                              )}
                              {metric === "hot_accounts_by_label" && row.account_id && (
                                <Link href={`/accounts/${row.account_id}`}>
                                  <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-primary transition-colors" aria-label="Open account" />
                                </Link>
                              )}
                              {REPLY_METRICS.has(metric) && row.contact_email && (
                                <Link href={`/gmail?search=${encodeURIComponent(row.contact_email)}`}>
                                  <Mail className="w-3.5 h-3.5 text-muted-foreground hover:text-primary transition-colors" aria-label="Open in mail" />
                                </Link>
                              )}
                              {REPLY_METRICS.has(metric) && row.status === "pending" && (
                                <button
                                  onClick={() => handleMarkReviewed(row)}
                                  disabled={markReviewedMutation.isPending}
                                  className="text-muted-foreground hover:text-emerald-400 transition-colors disabled:opacity-50"
                                  aria-label="Mark as reviewed"
                                  data-testid={`btn-mark-reviewed-${rowId ?? i}`}
                                >
                                  <CheckCheck className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {(CONTACT_METRICS.has(metric) || REPLY_METRICS.has(metric) || metric === "hot_accounts_by_label") && (
                                <button
                                  onClick={() => handleCreateTask(row)}
                                  disabled={createTaskMutation.isPending}
                                  className="text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                                  aria-label="Create follow-up task"
                                  data-testid={`btn-create-task-${rowId ?? i}`}
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Row detail panel */}
          {selectedRow && (
            <RowDetailPanel
              row={selectedRow}
              metric={metric}
              onClose={() => setSelectedRow(null)}
              onCreateTask={handleCreateTask}
              onMarkReviewed={handleMarkReviewed}
              isCreatingTask={createTaskMutation.isPending}
              isMarkingReviewed={markReviewedMutation.isPending}
            />
          )}
        </div>

        {/* Pagination */}
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
