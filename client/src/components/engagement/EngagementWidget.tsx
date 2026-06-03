/**
 * EngagementWidget — full engagement intelligence UI (Phase 2).
 *
 * Exports:
 *   EngagementIntentBadge       — intent level pill
 *   CreateFollowUpButton        — opens compose dialog with context draft
 *   EngagementSummaryCards      — stat cards row (opens / links / demo / replies / last)
 *   EngagementFilterTabs        — filter tabs with counts
 *   EngagementActivityTable     — sortable activity rows table
 *   ThreadEngagementWidget      — full collapsible thread-view panel
 *   ContactEngagementWidget     — contact-page summary + activity table
 *   AccountEngagementWidget     — account-page aggregate + contact rows
 *   CtaEngagementBanner         — thin backward-compat banner (kept for reference)
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, format, isToday, isYesterday } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MousePointerClick, Mail, Eye, Zap, TrendingUp, Clock,
  ArrowRight, AlertTriangle, ThumbsUp, Flame, ChevronDown,
  ChevronUp, Link2, Reply, Video, BarChart2, ArrowUpDown,
  ArrowUp, ArrowDown, Filter,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

type IntentLevel =
  | "none"
  | "interested"
  | "high_intent"
  | "very_high_intent"
  | "follow_up_recommended";

type ActivityType =
  | "email_open"
  | "email_link_click"
  | "signature_cta_click"
  | "video_click"
  | "reply";

type FilterType = "all" | "opens" | "links" | "demo" | "replies" | "high_intent";
type SortType   = "newest" | "oldest" | "most_opens" | "most_clicks" | "most_demo" | "highest_intent";

interface ActivityRow {
  recipientEmail: string;
  contactId: number | null;
  contactName: string | null;
  accountId: number | null;
  activityType: ActivityType;
  label: string;
  ctaName: string | null;
  url: string | null;
  count: number;
  firstAt: string | null;
  lastAt: string | null;
  intentLevel: IntentLevel;
  suggestedAction: string | null;
  relatedEmailId: string | null;
  threadId: string | null;
}

interface EngagementSummary {
  opens: number;
  emailLinkClicks: number;
  signatureCtaClicks: number;
  videoClicks: number;
  replies: number;
  lastActivityAt: string | null;
  highestIntentLevel: IntentLevel;
}

interface ContactEngagement {
  contactId: number;
  accountId: number | null;
  contactName: string;
  contactEmail: string | null;
  totalCtaClicks: number;
  uniqueCtasClicked: number;
  demoClickCount: number;
  demoClicksIn7d: number;
  lastCtaClickedAt: string | null;
  lastCtaName: string | null;
  lastCtaDestination: string | null;
  totalOpens: number;
  uniqueOpens: number;
  lastOpenAt: string | null;
  isReplied: boolean;
  lastReplyAt: string | null;
  intentLevel: IntentLevel;
  suggestedAction: string | null;
}

interface AccountEngagement {
  accountId: number;
  accountName: string;
  totalCtaClicks: number;
  demoClickCount: number;
  engagedContactCount: number;
  demoCtickerContactCount: number;
  mostClickedCtaName: string | null;
  lastCtaClickedAt: string | null;
  intentLevel: IntentLevel;
  suggestedAction: string | null;
  contacts: ContactEngagement[];
}

interface ThreadEngagementFull {
  threadId: string;
  summary: EngagementSummary;
  activities: ActivityRow[];
  ctaClicks: Array<{
    recipientEmail: string;
    contactId: number | null;
    ctaName: string | null;
    clickCount: number;
    lastClickedAt: string | null;
    intentLevel: IntentLevel;
  }>;
  totalCtaClicks: number;
  uniqueCtaRecipients: number;
  hasHighIntent: boolean;
  bannerText: string | null;
  suggestedAction: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function friendlyDate(isoStr: string | null): string {
  if (!isoStr) return "—";
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return "—";
  if (isToday(d))     return formatDistanceToNow(d, { addSuffix: true });
  if (isYesterday(d)) return "Yesterday";
  const ageMs = Date.now() - d.getTime();
  if (ageMs < 7 * 24 * 60 * 60 * 1000) return formatDistanceToNow(d, { addSuffix: true });
  return format(d, "MMM d, yyyy");
}

const INTENT_ORDER: IntentLevel[] = [
  "none", "interested", "high_intent", "very_high_intent", "follow_up_recommended",
];

function activityTypeIcon(t: ActivityType) {
  switch (t) {
    case "email_open":          return <Eye className="h-3 w-3 text-sky-400" />;
    case "email_link_click":    return <Link2 className="h-3 w-3 text-blue-400" />;
    case "signature_cta_click": return <MousePointerClick className="h-3 w-3 text-violet-400" />;
    case "video_click":         return <Video className="h-3 w-3 text-orange-400" />;
    case "reply":               return <Reply className="h-3 w-3 text-emerald-400" />;
  }
}

// ── Intent Badge ──────────────────────────────────────────────────────────

interface IntentBadgeProps { level: IntentLevel; className?: string; }

export function EngagementIntentBadge({ level, className = "" }: IntentBadgeProps) {
  const cfg: Record<IntentLevel, { label: string; icon: React.ReactNode; cls: string }> = {
    none:                 { label: "No activity",     icon: null, cls: "bg-muted/30 text-muted-foreground border-muted/20" },
    interested:           { label: "Interested",      icon: <ThumbsUp className="h-2.5 w-2.5" />,     cls: "bg-sky-500/10 text-sky-400 border-sky-500/20" },
    high_intent:          { label: "High Intent",     icon: <Zap className="h-2.5 w-2.5" />,           cls: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
    very_high_intent:     { label: "Very High Intent",icon: <Flame className="h-2.5 w-2.5" />,         cls: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
    follow_up_recommended:{ label: "Follow Up",       icon: <AlertTriangle className="h-2.5 w-2.5" />, cls: "bg-red-500/10 text-red-400 border-red-500/20" },
  };
  const { label, icon, cls } = cfg[level] ?? cfg.none;
  if (level === "none") return null;
  return (
    <Badge
      variant="outline"
      className={`inline-flex items-center gap-1 text-[10.5px] font-medium h-5 px-1.5 border ${cls} ${className}`}
      data-testid={`intent-badge-${level}`}
    >
      {icon}{label}
    </Badge>
  );
}

// ── Follow-up button ──────────────────────────────────────────────────────

interface CreateFollowUpButtonProps {
  contactEmail: string | null;
  contactName: string;
  ctaName: string | null;
  activityType?: ActivityType;
  className?: string;
  size?: "sm" | "xs";
}

export function CreateFollowUpButton({
  contactEmail, contactName, ctaName, activityType, className = "", size = "sm",
}: CreateFollowUpButtonProps) {
  function openComposer() {
    const firstName = contactName.split(" ")[0] || contactName;
    const isDemo = (ctaName ?? "").toLowerCase().includes("demo") ||
                   (ctaName ?? "").toLowerCase().includes("watch") ||
                   activityType === "video_click";
    const isLink = activityType === "email_link_click";

    const subject = isDemo
      ? "Following up on the VoltSafe demo"
      : isLink
      ? "Any questions on VoltSafe?"
      : "Quick follow-up";

    const body = isDemo
      ? `Hi ${firstName},\n\nI wanted to follow up in case the demo raised any questions or if you'd like a walkthrough of how VoltSafe applies to your marina.\n\nWould it be helpful to schedule a quick 15-minute call this week?\n\nBest,`
      : isLink
      ? `Hi ${firstName},\n\nI wanted to see if you had any questions — happy to help.\n\nBest,`
      : `Hi ${firstName},\n\nJust following up to see if there's anything I can help with.\n\nBest,`;

    window.dispatchEvent(new CustomEvent("open-compose", {
      detail: { to: contactEmail ?? "", subject, body },
    }));
  }

  return (
    <Button
      size={size === "xs" ? "sm" : size}
      variant="outline"
      onClick={openComposer}
      className={`h-7 text-[11.5px] gap-1 border-primary/30 text-primary hover:bg-primary/10 ${className}`}
      data-testid="button-create-followup"
    >
      <Mail className="h-3 w-3" />
      Follow-Up Email
    </Button>
  );
}

// ── Summary stat card ──────────────────────────────────────────────────────

function StatCard({
  icon: Icon, label, value, sub, highlight,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-0.5 rounded-lg border px-3 py-2 min-w-0 ${highlight ? "bg-primary/8 border-primary/25" : "bg-muted/20 border-border/20"}`}>
      <div className="flex items-center gap-1 text-muted-foreground">
        <Icon className={`h-3 w-3 flex-shrink-0 ${highlight ? "text-primary" : ""}`} />
        <span className="text-[10px] font-medium uppercase tracking-wide truncate">{label}</span>
      </div>
      <span className={`text-base font-semibold leading-tight ${highlight ? "text-primary" : "text-foreground"}`}>{value}</span>
      {sub && <span className="text-[10px] text-muted-foreground truncate">{sub}</span>}
    </div>
  );
}

// ── EngagementSummaryCards ─────────────────────────────────────────────────

export function EngagementSummaryCards({ summary }: { summary: EngagementSummary }) {
  const hasAny = summary.opens + summary.emailLinkClicks + summary.signatureCtaClicks +
    summary.videoClicks + summary.replies > 0;

  if (!hasAny) return null;

  return (
    <div className="grid grid-cols-5 gap-1.5" data-testid="engagement-summary-cards">
      <StatCard icon={Eye}              label="Opens"       value={summary.opens}            highlight={summary.opens > 3} />
      <StatCard icon={Link2}           label="Links"       value={summary.emailLinkClicks}  />
      <StatCard icon={Video}           label="Demo"        value={summary.videoClicks}       highlight={summary.videoClicks > 0} />
      <StatCard icon={Reply}           label="Replies"     value={summary.replies}           highlight={summary.replies > 0} />
      <StatCard
        icon={Clock}
        label="Last"
        value={summary.lastActivityAt ? friendlyDate(summary.lastActivityAt) : "—"}
      />
    </div>
  );
}

// ── EngagementFilterTabs ──────────────────────────────────────────────────

interface FilterTabsProps {
  filter: FilterType;
  onFilter: (f: FilterType) => void;
  counts: Record<FilterType, number>;
}

const FILTER_LABELS: Record<FilterType, string> = {
  all:         "All",
  opens:       "Opens",
  links:       "Links",
  demo:        "Demo",
  replies:     "Replies",
  high_intent: "High Intent",
};

export function EngagementFilterTabs({ filter, onFilter, counts }: FilterTabsProps) {
  const tabs: FilterType[] = ["all", "opens", "links", "demo", "replies", "high_intent"];
  return (
    <div className="flex items-center gap-1 flex-wrap" data-testid="engagement-filter-tabs">
      <Filter className="h-3 w-3 text-muted-foreground flex-shrink-0" />
      {tabs.map(tab => (
        <button
          key={tab}
          onClick={() => onFilter(tab)}
          data-testid={`filter-tab-${tab}`}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium transition-colors border ${
            filter === tab
              ? "bg-primary/15 text-primary border-primary/30"
              : "bg-transparent text-muted-foreground border-border/30 hover:bg-muted/30 hover:text-foreground"
          }`}
        >
          {FILTER_LABELS[tab]}
          {counts[tab] > 0 && (
            <span className={`text-[9px] font-semibold rounded-full px-1 ${filter === tab ? "bg-primary/20 text-primary" : "bg-muted/40 text-muted-foreground"}`}>
              {counts[tab]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── EngagementActivityTable ────────────────────────────────────────────────

interface ActivityTableProps {
  activities: ActivityRow[];
  filter: FilterType;
  sort: SortType;
  onSort: (s: SortType) => void;
  showContact?: boolean;
}

function applyFilter(rows: ActivityRow[], filter: FilterType): ActivityRow[] {
  switch (filter) {
    case "opens":       return rows.filter(r => r.activityType === "email_open");
    case "links":       return rows.filter(r => r.activityType === "email_link_click");
    case "demo":        return rows.filter(r => r.activityType === "video_click" || r.activityType === "signature_cta_click");
    case "replies":     return rows.filter(r => r.activityType === "reply");
    case "high_intent": return rows.filter(r => INTENT_ORDER.indexOf(r.intentLevel) >= INTENT_ORDER.indexOf("high_intent"));
    default:            return rows;
  }
}

function applySort(rows: ActivityRow[], sort: SortType): ActivityRow[] {
  const copy = [...rows];
  switch (sort) {
    case "newest":
      return copy.sort((a, b) => new Date(b.lastAt ?? 0).getTime() - new Date(a.lastAt ?? 0).getTime());
    case "oldest":
      return copy.sort((a, b) => new Date(a.lastAt ?? 0).getTime() - new Date(b.lastAt ?? 0).getTime());
    case "most_opens":
      return copy.sort((a, b) => {
        const aScore = a.activityType === "email_open" ? a.count : 0;
        const bScore = b.activityType === "email_open" ? b.count : 0;
        return bScore - aScore;
      });
    case "most_clicks":
      return copy.sort((a, b) =>
        (b.activityType !== "email_open" ? b.count : 0) -
        (a.activityType !== "email_open" ? a.count : 0)
      );
    case "most_demo":
      return copy.sort((a, b) => {
        const aScore = a.activityType === "video_click" ? a.count : 0;
        const bScore = b.activityType === "video_click" ? b.count : 0;
        return bScore - aScore;
      });
    case "highest_intent":
      return copy.sort((a, b) =>
        INTENT_ORDER.indexOf(b.intentLevel) - INTENT_ORDER.indexOf(a.intentLevel)
      );
    default:
      return copy;
  }
}

function SortButton({
  field, current, onSort, label,
}: {
  field: SortType; current: SortType; onSort: (s: SortType) => void; label: string;
}) {
  const active = current === field;
  return (
    <button
      onClick={() => onSort(field)}
      className={`inline-flex items-center gap-0.5 text-[10px] font-medium uppercase tracking-wide transition-colors ${
        active ? "text-primary" : "text-muted-foreground/60 hover:text-muted-foreground"
      }`}
      data-testid={`sort-${field}`}
    >
      {label}
      {active ? <ArrowDown className="h-2.5 w-2.5" /> : <ArrowUpDown className="h-2.5 w-2.5 opacity-40" />}
    </button>
  );
}

export function EngagementActivityTable({
  activities, filter, sort, onSort, showContact = true,
}: ActivityTableProps) {
  const filtered = applyFilter(activities, filter);
  const sorted   = applySort(filtered, sort);

  if (sorted.length === 0) {
    return (
      <div className="text-center py-6" data-testid="activity-table-empty">
        <BarChart2 className="h-6 w-6 text-muted-foreground/20 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground/60">No activity matching this filter.</p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5" data-testid="engagement-activity-table">
      {/* Column headers */}
      <div className={`grid gap-2 px-2 pb-1 border-b border-border/15 ${showContact ? "grid-cols-[1fr_100px_80px_60px_70px]" : "grid-cols-[120px_1fr_60px_70px]"}`}>
        {showContact && <SortButton field="newest" current={sort} onSort={onSort} label="Contact" />}
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">Activity</span>
        <SortButton field="most_demo" current={sort} onSort={onSort} label="CTA/Link" />
        <SortButton field="most_clicks" current={sort} onSort={onSort} label="Count" />
        <SortButton field="newest" current={sort} onSort={onSort} label="Last" />
        {!showContact && <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">Action</span>}
      </div>

      {/* Rows */}
      {sorted.map((row, i) => (
        <div
          key={i}
          className={`grid gap-2 px-2 py-2 rounded-md transition-colors hover:bg-muted/20 ${showContact ? "grid-cols-[1fr_100px_80px_60px_70px]" : "grid-cols-[120px_1fr_60px_70px]"}`}
          data-testid={`activity-row-${i}`}
        >
          {/* Contact column */}
          {showContact && (
            <div className="min-w-0">
              <p className="text-[11.5px] font-medium truncate leading-snug">
                {row.contactName ?? row.recipientEmail}
              </p>
              {row.intentLevel !== "none" && (
                <EngagementIntentBadge level={row.intentLevel} className="mt-0.5" />
              )}
            </div>
          )}

          {/* Activity type */}
          <div className="flex items-center gap-1 min-w-0">
            {activityTypeIcon(row.activityType)}
            <span className="text-[11px] text-muted-foreground truncate">{row.label}</span>
          </div>

          {/* CTA / link name */}
          <div className="min-w-0">
            {row.ctaName ? (
              <span className="text-[11px] font-medium text-foreground/80 truncate block">
                {row.ctaName}
              </span>
            ) : row.url ? (
              <span className="text-[10.5px] text-muted-foreground/60 truncate block" title={row.url}>
                {row.url.replace(/^https?:\/\//, "").substring(0, 30)}
              </span>
            ) : (
              <span className="text-[10.5px] text-muted-foreground/30">—</span>
            )}
          </div>

          {/* Count */}
          <div className="flex items-center">
            <span className={`text-[12px] font-semibold tabular-nums ${row.count >= 3 ? "text-orange-400" : row.count >= 2 ? "text-amber-400" : "text-foreground/70"}`}>
              {row.count}×
            </span>
          </div>

          {/* Last activity */}
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[10.5px] text-muted-foreground/70 truncate">
              {friendlyDate(row.lastAt)}
            </span>
            {!showContact && row.suggestedAction && row.contactEmail !== undefined && (
              <CreateFollowUpButton
                contactEmail={row.recipientEmail}
                contactName={row.contactName ?? row.recipientEmail}
                ctaName={row.ctaName}
                activityType={row.activityType}
                size="xs"
                className="mt-0.5"
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── ThreadEngagementWidget ─────────────────────────────────────────────────

function filterCounts(activities: ActivityRow[]): Record<FilterType, number> {
  return {
    all:         activities.length,
    opens:       activities.filter(r => r.activityType === "email_open").length,
    links:       activities.filter(r => r.activityType === "email_link_click").length,
    demo:        activities.filter(r => r.activityType === "video_click" || r.activityType === "signature_cta_click").length,
    replies:     activities.filter(r => r.activityType === "reply").length,
    high_intent: activities.filter(r => INTENT_ORDER.indexOf(r.intentLevel) >= INTENT_ORDER.indexOf("high_intent")).length,
  };
}

export function ThreadEngagementWidget({ threadId }: { threadId: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter]     = useState<FilterType>("all");
  const [sort, setSort]         = useState<SortType>("newest");

  const { data, isLoading } = useQuery<ThreadEngagementFull>({
    queryKey: ["/api/engagement/thread", threadId],
    queryFn: () =>
      fetch(`/api/engagement/thread/${encodeURIComponent(threadId!)}`, { credentials: "include" })
        .then(r => r.ok ? r.json() : Promise.reject(r)),
    enabled: !!threadId,
    staleTime: 30_000,
    retry: false,
  });

  if (!threadId) return null;

  if (isLoading) {
    return (
      <div className="space-y-1.5 py-1" data-testid="thread-engagement-loading">
        <div className="h-3 w-24 bg-muted/30 rounded animate-pulse" />
        <div className="h-8 w-full bg-muted/20 rounded-lg animate-pulse" />
      </div>
    );
  }

  const hasActivity = (data?.activities?.length ?? 0) > 0 || (data?.totalCtaClicks ?? 0) > 0;
  const hasOpenActivity = (data?.summary?.opens ?? 0) > 0;

  if (!data || (!hasActivity && !hasOpenActivity)) {
    return (
      <div className="py-2" data-testid="thread-engagement-empty">
        <p className="text-[10.5px] font-semibold text-muted-foreground/50 uppercase tracking-wide mb-1">Engagement</p>
        <p className="text-[11px] text-muted-foreground/50">No engagement yet.</p>
        <p className="text-[10.5px] text-muted-foreground/35 mt-0.5">
          Opens, clicks, and demo signals will appear here.
        </p>
      </div>
    );
  }

  const levelCls: Record<IntentLevel, string> = {
    none:                  "hidden",
    interested:            "border-sky-500/20 bg-sky-500/5 text-sky-300",
    high_intent:           "border-amber-500/20 bg-amber-500/5 text-amber-300",
    very_high_intent:      "border-orange-500/20 bg-orange-500/5 text-orange-300",
    follow_up_recommended: "border-red-500/20 bg-red-500/5 text-red-300",
  };

  const topLevel = data.summary?.highestIntentLevel ?? "none";
  const bannerCls = topLevel !== "none" ? levelCls[topLevel] : "border-border/20 bg-muted/10 text-muted-foreground";

  const bannerText = data.bannerText ?? (
    data.summary?.opens > 0
      ? `Opened ${data.summary.opens} time${data.summary.opens !== 1 ? "s" : ""}`
      : null
  );
  if (!bannerText) return null;

  const topCtaRow = data.ctaClicks?.[0] ?? null;
  const counts = filterCounts(data.activities ?? []);

  return (
    <div className="flex-shrink-0 border-b border-border/20" data-testid="thread-engagement-widget">
      {/* Collapsed banner */}
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11.5px] transition-colors hover:brightness-110 ${bannerCls}`}
        data-testid="thread-engagement-banner-toggle"
      >
        <MousePointerClick className="h-3 w-3 flex-shrink-0" />
        <span className="flex-1 min-w-0 text-left truncate">{bannerText}</span>
        {data.suggestedAction && (
          <span className="flex items-center gap-0.5 flex-shrink-0 opacity-70 text-[10.5px]">
            {data.suggestedAction}
            <ArrowRight className="h-2.5 w-2.5" />
          </span>
        )}
        {expanded
          ? <ChevronUp className="h-3 w-3 flex-shrink-0 opacity-50" />
          : <ChevronDown className="h-3 w-3 flex-shrink-0 opacity-50" />
        }
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div className="bg-card/50 border-t border-border/15 p-3 space-y-3" data-testid="thread-engagement-panel">
          {/* Summary cards */}
          {data.summary && <EngagementSummaryCards summary={data.summary} />}

          {/* Filter tabs */}
          {data.activities.length > 0 && (
            <EngagementFilterTabs filter={filter} onFilter={setFilter} counts={counts} />
          )}

          {/* Sort controls */}
          {data.activities.length > 1 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wide">Sort:</span>
              {(["newest", "most_opens", "most_clicks", "most_demo", "highest_intent"] as SortType[]).map(s => (
                <button
                  key={s}
                  onClick={() => setSort(s)}
                  data-testid={`sort-option-${s}`}
                  className={`text-[10.5px] px-1.5 py-0.5 rounded transition-colors ${
                    sort === s
                      ? "text-primary bg-primary/10"
                      : "text-muted-foreground/60 hover:text-muted-foreground"
                  }`}
                >
                  {s === "newest" ? "Recent" : s === "most_opens" ? "Opens" : s === "most_clicks" ? "Clicks" : s === "most_demo" ? "Demo" : "Intent"}
                </button>
              ))}
            </div>
          )}

          {/* Activity table */}
          {data.activities.length > 0 ? (
            <EngagementActivityTable
              activities={data.activities}
              filter={filter}
              sort={sort}
              onSort={setSort}
              showContact={true}
            />
          ) : (
            <p className="text-[11px] text-muted-foreground/50 text-center py-2">
              Detailed activity breakdown not yet available.
            </p>
          )}

          {/* Follow-up button for top CTA recipient */}
          {topCtaRow && (
            <div className="pt-1 border-t border-border/15">
              <CreateFollowUpButton
                contactEmail={topCtaRow.recipientEmail}
                contactName={topCtaRow.contactId ? (data.activities.find(a => a.contactId === topCtaRow.contactId)?.contactName ?? topCtaRow.recipientEmail) : topCtaRow.recipientEmail}
                ctaName={topCtaRow.ctaName}
                size="sm"
                className="w-full justify-center"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── ContactEngagementWidget ────────────────────────────────────────────────

export function ContactEngagementWidget({ contactId }: { contactId: number }) {
  const [showTable, setShowTable] = useState(false);
  const [filter, setFilter]       = useState<FilterType>("all");
  const [sort, setSort]           = useState<SortType>("newest");

  const { data, isLoading, isError } = useQuery<ContactEngagement>({
    queryKey: ["/api/engagement/contact", contactId],
    queryFn: () =>
      fetch(`/api/engagement/contact/${contactId}`, { credentials: "include" })
        .then(r => r.ok ? r.json() : Promise.reject(r)),
    staleTime: 60_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="engagement-widget-loading">
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-3/4 rounded-lg" />
      </div>
    );
  }

  if (isError || !data) {
    return <p className="text-xs text-muted-foreground/60 py-1" data-testid="engagement-widget-error">Couldn't load engagement activity.</p>;
  }

  if (data.intentLevel === "none" && data.totalOpens === 0) {
    return (
      <div className="text-center py-4" data-testid="engagement-widget-empty">
        <p className="text-xs text-muted-foreground/60">No engagement yet.</p>
        <p className="text-[11px] text-muted-foreground/40 mt-0.5">
          When this contact opens or clicks your email, activity will appear here.
        </p>
      </div>
    );
  }

  // Build a synthetic summary for the summary cards
  const syntheticSummary: EngagementSummary = {
    opens: data.uniqueOpens,
    emailLinkClicks: 0,
    signatureCtaClicks: Math.max(0, data.totalCtaClicks - data.demoClickCount),
    videoClicks: data.demoClickCount,
    replies: data.isReplied ? 1 : 0,
    lastActivityAt: data.lastCtaClickedAt ?? data.lastOpenAt,
    highestIntentLevel: data.intentLevel,
  };

  // Build a synthetic activity row list from summary data
  const syntheticActivities: ActivityRow[] = [];
  if (data.uniqueOpens > 0) {
    syntheticActivities.push({
      recipientEmail: data.contactEmail ?? "",
      contactId: data.contactId,
      contactName: data.contactName,
      accountId: data.accountId,
      activityType: "email_open",
      label: "Email Open",
      ctaName: null, url: null,
      count: data.uniqueOpens,
      firstAt: null, lastAt: data.lastOpenAt,
      intentLevel: "interested",
      suggestedAction: null,
      relatedEmailId: null, threadId: null,
    });
  }
  if (data.demoClickCount > 0) {
    syntheticActivities.push({
      recipientEmail: data.contactEmail ?? "",
      contactId: data.contactId,
      contactName: data.contactName,
      accountId: data.accountId,
      activityType: "video_click",
      label: "Demo/Video Click",
      ctaName: data.lastCtaName, url: data.lastCtaDestination,
      count: data.demoClickCount,
      firstAt: null, lastAt: data.lastCtaClickedAt,
      intentLevel: data.intentLevel,
      suggestedAction: data.suggestedAction,
      relatedEmailId: null, threadId: null,
    });
  }
  if (data.isReplied) {
    syntheticActivities.push({
      recipientEmail: data.contactEmail ?? "",
      contactId: data.contactId,
      contactName: data.contactName,
      accountId: data.accountId,
      activityType: "reply",
      label: "Reply",
      ctaName: null, url: null,
      count: 1,
      firstAt: data.lastReplyAt, lastAt: data.lastReplyAt,
      intentLevel: "none",
      suggestedAction: null,
      relatedEmailId: null, threadId: null,
    });
  }

  const counts = filterCounts(syntheticActivities);

  return (
    <div className="space-y-3" data-testid={`engagement-widget-contact-${contactId}`}>
      {/* Intent badge + follow-up */}
      {data.intentLevel !== "none" && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <EngagementIntentBadge level={data.intentLevel} />
          {data.suggestedAction && data.contactEmail && (
            <CreateFollowUpButton
              contactEmail={data.contactEmail}
              contactName={data.contactName}
              ctaName={data.lastCtaName}
              size="xs"
            />
          )}
        </div>
      )}

      {/* Summary cards */}
      <EngagementSummaryCards summary={syntheticSummary} />

      {/* Activity breakdown toggle */}
      {syntheticActivities.length > 0 && (
        <button
          type="button"
          onClick={() => setShowTable(v => !v)}
          className="flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          data-testid="toggle-activity-table"
        >
          {showTable ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {showTable ? "Hide" : "View"} activity breakdown
        </button>
      )}

      {showTable && syntheticActivities.length > 0 && (
        <div className="space-y-2">
          <EngagementFilterTabs filter={filter} onFilter={setFilter} counts={counts} />
          <EngagementActivityTable
            activities={syntheticActivities}
            filter={filter}
            sort={sort}
            onSort={setSort}
            showContact={false}
          />
        </div>
      )}
    </div>
  );
}

// ── AccountEngagementWidget ────────────────────────────────────────────────

export function AccountEngagementWidget({ accountId }: { accountId: number }) {
  const [filter, setFilter] = useState<FilterType>("all");
  const [sort, setSort]     = useState<SortType>("highest_intent");

  const { data, isLoading, isError } = useQuery<AccountEngagement>({
    queryKey: ["/api/engagement/account", accountId],
    queryFn: () =>
      fetch(`/api/engagement/account/${accountId}`, { credentials: "include" })
        .then(r => r.ok ? r.json() : Promise.reject(r)),
    staleTime: 60_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="engagement-widget-loading">
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-8 w-3/4 rounded-lg" />
      </div>
    );
  }

  if (isError || !data) {
    return <p className="text-xs text-muted-foreground/60 py-1" data-testid="engagement-widget-error">Couldn't load engagement activity.</p>;
  }

  if (data.intentLevel === "none") {
    return (
      <div className="text-center py-4" data-testid="engagement-widget-empty">
        <p className="text-xs text-muted-foreground/60">No engagement yet.</p>
        <p className="text-[11px] text-muted-foreground/40 mt-0.5">
          When contacts at this account click your emails, activity will appear here.
        </p>
      </div>
    );
  }

  const syntheticSummary: EngagementSummary = {
    opens: data.contacts.reduce((s, c) => s + c.uniqueOpens, 0),
    emailLinkClicks: 0,
    signatureCtaClicks: Math.max(0, data.totalCtaClicks - data.demoClickCount),
    videoClicks: data.demoClickCount,
    replies: data.contacts.some(c => c.isReplied) ? 1 : 0,
    lastActivityAt: data.lastCtaClickedAt,
    highestIntentLevel: data.intentLevel,
  };

  // Flatten active contacts into synthetic activity rows
  const activeContacts = data.contacts.filter(c => c.intentLevel !== "none" || c.uniqueOpens > 0);
  const allActivityRows: ActivityRow[] = activeContacts.flatMap(c => {
    const rows: ActivityRow[] = [];
    if (c.uniqueOpens > 0) {
      rows.push({
        recipientEmail: c.contactEmail ?? "",
        contactId: c.contactId, contactName: c.contactName, accountId: c.accountId,
        activityType: "email_open", label: "Email Open",
        ctaName: null, url: null,
        count: c.uniqueOpens, firstAt: null, lastAt: c.lastOpenAt,
        intentLevel: "interested", suggestedAction: null,
        relatedEmailId: null, threadId: null,
      });
    }
    if (c.demoClickCount > 0) {
      rows.push({
        recipientEmail: c.contactEmail ?? "",
        contactId: c.contactId, contactName: c.contactName, accountId: c.accountId,
        activityType: "video_click", label: "Demo/Video Click",
        ctaName: c.lastCtaName, url: c.lastCtaDestination,
        count: c.demoClickCount, firstAt: null, lastAt: c.lastCtaClickedAt,
        intentLevel: c.intentLevel, suggestedAction: c.suggestedAction,
        relatedEmailId: null, threadId: null,
      });
    }
    return rows;
  });

  const counts = filterCounts(allActivityRows);

  return (
    <div className="space-y-3" data-testid={`engagement-widget-account-${accountId}`}>
      {/* Account-level badges */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <EngagementIntentBadge level={data.intentLevel} />
        {data.demoCtickerContactCount >= 2 && (
          <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-orange-500/30 text-orange-400 bg-orange-500/10">
            <Flame className="h-2.5 w-2.5 mr-1" />
            Account Heating Up
          </Badge>
        )}
      </div>

      {/* Summary cards */}
      <EngagementSummaryCards summary={syntheticSummary} />

      {/* Filter tabs */}
      {allActivityRows.length > 0 && (
        <EngagementFilterTabs filter={filter} onFilter={setFilter} counts={counts} />
      )}

      {/* Per-contact activity table */}
      {allActivityRows.length > 0 ? (
        <EngagementActivityTable
          activities={allActivityRows}
          filter={filter}
          sort={sort}
          onSort={setSort}
          showContact={true}
        />
      ) : (
        <div className="space-y-1.5">
          {activeContacts.map(c => (
            <div key={c.contactId}
              className="flex items-center gap-2 py-1.5 border-b border-border/15 last:border-0"
              data-testid={`engagement-contact-row-${c.contactId}`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate">{c.contactName}</p>
                {c.lastCtaName && (
                  <p className="text-[10.5px] text-muted-foreground/70 truncate">
                    Clicked "{c.lastCtaName}"
                    {c.demoClickCount > 1 && ` · ${c.demoClickCount}×`}
                    {c.lastCtaClickedAt && ` · ${friendlyDate(c.lastCtaClickedAt)}`}
                  </p>
                )}
              </div>
              <EngagementIntentBadge level={c.intentLevel} />
              {c.suggestedAction && c.contactEmail && (
                <CreateFollowUpButton
                  contactEmail={c.contactEmail}
                  contactName={c.contactName}
                  ctaName={c.lastCtaName}
                  size="xs"
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── CtaEngagementBanner (backward-compat thin banner) ─────────────────────

export function CtaEngagementBanner({ threadId }: { threadId: string | null }) {
  return <ThreadEngagementWidget threadId={threadId} />;
}
