// Capital Investor Engagement Analytics — Phase 2I
// Restricted to Trevor (user ID 4) and Scott Carlson only via requireCapitalAccess.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, TrendingUp, Users, Flame, Eye, Download, Mail,
  Globe, AlertTriangle, Clock, Zap, BarChart3, ArrowUpRight,
  CheckCircle2, Info, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ── Types ──────────────────────────────────────────────────────────────────────

type EngagementTier = "Highly Engaged" | "Engaged" | "Watching" | "Stale" | "Cold";

type EngagementSignals = {
  linked_email_count:        number;
  inbound_email_count:       number;
  latest_inbound_email_at:   string | null;
  has_portal_access:         boolean;
  portal_opened:             boolean;
  portal_open_count:         number;
  portal_last_accessed_at:   string | null;
  portal_never_opened:       boolean;
  materials_viewed_count:    number;
  materials_downloaded_count: number;
  high_value_materials_viewed: string[];
  material_request_count:    number;
  recent_meeting_count:      number;
  total_activity_count:      number;
  latest_activity_at:        string | null;
  has_commitment:            boolean;
  commitment_stage:          string | null;
  investor_stage:            string;
  do_not_contact:            boolean;
};

type InvestorEngagementRow = {
  investor_id:                   number;
  investor_name:                 string;
  investor_type:                 string;
  stage:                         string;
  priority:                      string;
  warmth:                        string;
  do_not_contact:                boolean;
  engagement_score:              number;
  engagement_tier:               EngagementTier;
  reasons:                       string[];
  risk_flags:                    string[];
  recommended_next_action:       string;
  last_meaningful_engagement_at: string | null;
  signal_breakdown:              Record<string, number>;
  signals:                       EngagementSignals;
};

type MaterialEngagement = {
  material_id:      number;
  material_title:   string;
  material_type:    string;
  total_views:      number;
  total_downloads:  number;
  unique_investors: number;
  last_viewed_at:   string | null;
  is_high_value:    boolean;
};

type EngagementAnalytics = {
  total_investors:            number;
  highly_engaged_count:       number;
  engaged_count:              number;
  watching_count:             number;
  stale_count:                number;
  cold_count:                 number;
  portal_opens_7d:            number;
  material_views_7d:          number;
  material_downloads_7d:      number;
  recent_inbound_replies:     number;
  no_engagement_after_portal: number;
  hot_with_stale_followup:    number;
};

type Round = { id: number; name: string; status: string };

type EngagementData = {
  investors:         InvestorEngagementRow[];
  analytics:         EngagementAnalytics;
  material_engagement: MaterialEngagement[];
  round_id:          number | null;
  rounds:            Round[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function fmtDaysAgo(d: string | null | undefined) {
  if (!d) return null;
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days}d ago`;
}

function tierColor(tier: EngagementTier): string {
  switch (tier) {
    case "Highly Engaged": return "bg-emerald-500/15 text-emerald-400 border-emerald-500/20";
    case "Engaged":        return "bg-cyan-500/15 text-cyan-400 border-cyan-500/20";
    case "Watching":       return "bg-blue-500/15 text-blue-400 border-blue-500/20";
    case "Stale":          return "bg-amber-500/15 text-amber-400 border-amber-500/20";
    case "Cold":           return "bg-muted text-muted-foreground";
  }
}

function tierDot(tier: EngagementTier): string {
  switch (tier) {
    case "Highly Engaged": return "bg-emerald-400";
    case "Engaged":        return "bg-cyan-400";
    case "Watching":       return "bg-blue-400";
    case "Stale":          return "bg-amber-400";
    case "Cold":           return "bg-muted-foreground";
  }
}

function scoreBar(score: number) {
  const pct = Math.min(100, score);
  const color =
    pct >= 70 ? "bg-emerald-500" :
    pct >= 45 ? "bg-cyan-500" :
    pct >= 25 ? "bg-blue-500" :
    pct >= 10 ? "bg-amber-500" :
    "bg-muted-foreground/40";
  return { pct, color };
}

function priorityColor(p: string) {
  if (p === "Critical") return "text-red-400";
  if (p === "High")     return "text-amber-400";
  if (p === "Medium")   return "text-cyan-400";
  return "text-muted-foreground";
}

function materialTypeLabel(t: string): string {
  const map: Record<string, string> = {
    pitch_deck: "Pitch Deck", financial_model: "Financial Model",
    executive_summary: "Executive Summary", cap_table: "Cap Table",
    product_overview: "Product Overview", technical_overview: "Technical Overview",
    patent_ip: "Patent / IP", customer_pipeline: "Customer Pipeline",
    pilot_results: "Pilot Results", market_analysis: "Market Analysis",
    data_room_index: "Data Room Index", legal_docs: "Legal Docs",
    subscription_agreement: "Subscription Agreement", due_diligence: "Due Diligence",
    board_material: "Board Material", grant_document: "Grant Document",
    other: "Other",
  };
  return map[t] ?? t;
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function CapitalEngagement() {
  const [roundId, setRoundId]     = useState<string>("all");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [search, setSearch]       = useState("");
  const [detailId, setDetailId]   = useState<number | null>(null);

  const { data, isLoading, error } = useQuery<EngagementData>({
    queryKey: ["/api/capital/engagement", roundId],
    queryFn: () => {
      const p = new URLSearchParams();
      if (roundId !== "all") p.set("round_id", roundId);
      return fetch(`/api/capital/engagement?${p}`).then(r => r.json());
    },
  });

  const investors: InvestorEngagementRow[] = data?.investors ?? [];
  const analytics  = data?.analytics;
  const materials  = data?.material_engagement ?? [];
  const rounds     = data?.rounds ?? [];

  const filtered = investors.filter(inv => {
    if (tierFilter !== "all" && inv.engagement_tier !== tierFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!inv.investor_name.toLowerCase().includes(s)) return false;
    }
    return true;
  });

  const detail = detailId != null ? investors.find(i => i.investor_id === detailId) : null;

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border/40 shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" /> Engagement Analytics
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Investor engagement intelligence across email, portal, and materials
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={roundId} onValueChange={setRoundId}>
              <SelectTrigger className="h-8 text-sm w-[180px]" data-testid="select-round-filter">
                <SelectValue placeholder="All rounds" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All rounds</SelectItem>
                {rounds.map((r: Round) => (
                  <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
            <AlertTriangle className="w-4 h-4 mr-2 text-amber-400" /> Failed to load engagement data
          </div>
        ) : (
          <div className="p-6 space-y-6">

            {/* ── Summary cards ── */}
            {analytics && (
              <section>
                <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" data-testid="section-engagement-summary">
                  <BarChart3 className="w-4 h-4 text-muted-foreground" /> Engagement Overview
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" data-testid="engagement-summary-cards">
                  <SummaryCard
                    icon={<Flame className="w-4 h-4 text-emerald-400" />}
                    label="Highly Engaged"
                    value={analytics.highly_engaged_count}
                    subtext={`${analytics.engaged_count} more Engaged`}
                    testId="card-highly-engaged"
                    onClick={() => setTierFilter(tierFilter === "Highly Engaged" ? "all" : "Highly Engaged")}
                    active={tierFilter === "Highly Engaged"}
                    highlight="emerald"
                  />
                  <SummaryCard
                    icon={<Activity className="w-4 h-4 text-cyan-400" />}
                    label="Engaged"
                    value={analytics.engaged_count}
                    subtext={`${analytics.watching_count} Watching`}
                    testId="card-engaged"
                    onClick={() => setTierFilter(tierFilter === "Engaged" ? "all" : "Engaged")}
                    active={tierFilter === "Engaged"}
                    highlight="cyan"
                  />
                  <SummaryCard
                    icon={<Clock className="w-4 h-4 text-amber-400" />}
                    label="Stale"
                    value={analytics.stale_count + analytics.cold_count}
                    subtext={`${analytics.cold_count} Cold`}
                    testId="card-stale-cold"
                    onClick={() => setTierFilter(tierFilter === "Stale" ? "all" : "Stale")}
                    active={tierFilter === "Stale"}
                    highlight="amber"
                  />
                  <SummaryCard
                    icon={<Globe className="w-4 h-4 text-primary" />}
                    label="Portal Opens"
                    value={analytics.portal_opens_7d}
                    subtext="last 7 days"
                    testId="card-portal-opens-7d"
                  />
                  <SummaryCard
                    icon={<Eye className="w-4 h-4 text-violet-400" />}
                    label="Material Views"
                    value={analytics.material_views_7d}
                    subtext={`${analytics.material_downloads_7d} downloads`}
                    testId="card-material-views-7d"
                  />
                  <SummaryCard
                    icon={<Mail className="w-4 h-4 text-blue-400" />}
                    label="Inbound Replies"
                    value={analytics.recent_inbound_replies}
                    subtext="last 7 days"
                    testId="card-inbound-replies-7d"
                  />
                </div>

                {/* Attention alerts */}
                {(analytics.no_engagement_after_portal > 0 || analytics.hot_with_stale_followup > 0) && (
                  <div className="mt-3 flex flex-wrap gap-2" data-testid="engagement-attention-alerts">
                    {analytics.no_engagement_after_portal > 0 && (
                      <div className="flex items-center gap-1.5 text-xs bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5 text-amber-400" data-testid="alert-portal-no-engagement">
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        {analytics.no_engagement_after_portal} investor{analytics.no_engagement_after_portal === 1 ? "" : "s"} sent portal — no engagement yet
                      </div>
                    )}
                    {analytics.hot_with_stale_followup > 0 && (
                      <div className="flex items-center gap-1.5 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-1.5 text-red-400" data-testid="alert-hot-stale">
                        <Zap className="w-3 h-3 shrink-0" />
                        {analytics.hot_with_stale_followup} hot investor{analytics.hot_with_stale_followup === 1 ? "" : "s"} with no follow-up in 7+ days
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* ── Investor engagement table ── */}
              <div className="lg:col-span-2 space-y-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold flex items-center gap-2">
                    <Users className="w-4 h-4 text-muted-foreground" /> Investor Engagement
                    <span className="text-xs text-muted-foreground font-normal">({filtered.length})</span>
                  </h2>
                  <div className="flex-1 flex items-center gap-2 justify-end">
                    <div className="relative max-w-[200px]">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                      <Input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search…"
                        className="pl-7 h-7 text-xs"
                        data-testid="input-engagement-search"
                      />
                    </div>
                    <Select value={tierFilter} onValueChange={setTierFilter}>
                      <SelectTrigger className="h-7 text-xs w-[140px]" data-testid="select-tier-filter">
                        <SelectValue placeholder="All tiers" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All tiers</SelectItem>
                        <SelectItem value="Highly Engaged">Highly Engaged</SelectItem>
                        <SelectItem value="Engaged">Engaged</SelectItem>
                        <SelectItem value="Watching">Watching</SelectItem>
                        <SelectItem value="Stale">Stale</SelectItem>
                        <SelectItem value="Cold">Cold</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden" data-testid="investor-engagement-table">
                  {filtered.length === 0 ? (
                    <div className="py-10 text-center text-muted-foreground text-sm">
                      No investors match the current filters
                    </div>
                  ) : (
                    filtered.map(inv => {
                      const bar = scoreBar(inv.engagement_score);
                      return (
                        <div
                          key={inv.investor_id}
                          className={`px-4 py-3 cursor-pointer hover:bg-muted/20 transition-colors ${detailId === inv.investor_id ? "bg-primary/5" : ""}`}
                          onClick={() => setDetailId(detailId === inv.investor_id ? null : inv.investor_id)}
                          data-testid={`row-investor-engagement-${inv.investor_id}`}
                        >
                          <div className="flex items-center gap-3">
                            {/* Tier dot */}
                            <div className={`w-2 h-2 rounded-full shrink-0 ${tierDot(inv.engagement_tier)}`} />

                            {/* Name + stage */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium truncate">{inv.investor_name}</span>
                                <span className="text-[10px] text-muted-foreground">{inv.stage}</span>
                                {inv.risk_flags.length > 0 && (
                                  <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                                )}
                              </div>
                              {/* Score bar */}
                              <div className="flex items-center gap-2 mt-1" data-testid={`score-bar-${inv.investor_id}`}>
                                <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden score-bar">
                                  <div className={`h-full rounded-full ${bar.color}`} style={{ width: `${bar.pct}%` }} />
                                </div>
                                <span className="text-[10px] text-muted-foreground w-6 text-right shrink-0">{inv.engagement_score}</span>
                              </div>
                            </div>

                            {/* Tier badge */}
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 shrink-0 ${tierColor(inv.engagement_tier)}`}
                              data-testid={`badge-tier-${inv.investor_id}`}
                            >
                              {inv.engagement_tier}
                            </Badge>

                            {/* Signal icons */}
                            <div className="flex items-center gap-1.5 shrink-0">
                              {inv.signals.inbound_email_count > 0 && (
                                <Mail className="w-3 h-3 text-blue-400" title="Has inbound email" />
                              )}
                              {inv.signals.portal_opened && (
                                <Globe className="w-3 h-3 text-primary" title="Portal opened" />
                              )}
                              {inv.signals.materials_downloaded_count > 0 && (
                                <Download className="w-3 h-3 text-violet-400" title="Downloaded materials" />
                              )}
                              {inv.signals.has_commitment && (
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" title="Has commitment" />
                              )}
                            </div>

                            {/* Last engagement */}
                            <span className="text-[10px] text-muted-foreground shrink-0 w-16 text-right hidden sm:block">
                              {fmtDaysAgo(inv.last_meaningful_engagement_at) ?? "—"}
                            </span>
                          </div>

                          {/* Expanded detail */}
                          {detailId === inv.investor_id && (
                            <div className="mt-3 pt-3 border-t border-border/40 space-y-2" data-testid={`detail-engagement-${inv.investor_id}`}>
                              {/* Score breakdown */}
                              <div>
                                <p className="text-[10px] text-muted-foreground mb-1.5 font-medium uppercase tracking-wide">Score Breakdown</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {Object.entries(inv.signal_breakdown).map(([k, v]) => (
                                    v !== 0 && (
                                      <span
                                        key={k}
                                        className={`text-[10px] rounded px-1.5 py-0.5 ${v > 0 ? "bg-primary/10 text-primary" : "bg-red-500/10 text-red-400"}`}
                                        title={k}
                                      >
                                        {k.replace(/_/g, " ")}: {v > 0 ? "+" : ""}{v}
                                      </span>
                                    )
                                  ))}
                                </div>
                              </div>

                              {/* Reasons */}
                              {inv.reasons.length > 0 && (
                                <div>
                                  <p className="text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wide">Signals</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {inv.reasons.map((r, i) => (
                                      <span key={i} className="text-[10px] bg-muted/40 rounded px-1.5 py-0.5">{r}</span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Risk flags */}
                              {inv.risk_flags.length > 0 && (
                                <div>
                                  <p className="text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wide">Risk Flags</p>
                                  <div className="space-y-0.5">
                                    {inv.risk_flags.map((f, i) => (
                                      <div key={i} className="flex items-center gap-1.5 text-[10px] text-amber-400">
                                        <AlertTriangle className="w-2.5 h-2.5 shrink-0" /> {f}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Recommended action */}
                              <div className="flex items-start gap-1.5 text-xs text-cyan-400 bg-cyan-500/5 border border-cyan-500/10 rounded-lg px-3 py-2 mt-1">
                                <Zap className="w-3 h-3 shrink-0 mt-0.5" />
                                <span data-testid={`recommended-action-${inv.investor_id}`}>{inv.recommended_next_action}</span>
                              </div>

                              {/* Signal grid */}
                              <div className="grid grid-cols-3 gap-2 mt-1">
                                <SignalMini label="Emails" value={`${inv.signals.inbound_email_count}↩ / ${inv.signals.outbound_email_count ?? inv.signals.linked_email_count}↗`} />
                                <SignalMini label="Portal opens" value={String(inv.signals.portal_open_count)} />
                                <SignalMini label="Materials viewed" value={String(inv.signals.materials_viewed_count)} />
                                <SignalMini label="Downloaded" value={String(inv.signals.materials_downloaded_count)} />
                                <SignalMini label="Meetings (30d)" value={String(inv.signals.recent_meeting_count)} />
                                <SignalMini label="Last activity" value={fmtDate(inv.signals.latest_activity_at)} />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* ── Right column: material engagement + actions ── */}
              <div className="space-y-4">
                {/* Material engagement leaderboard */}
                {materials.length > 0 && (
                  <div>
                    <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" data-testid="section-material-engagement">
                      <Eye className="w-4 h-4 text-muted-foreground" /> Top Materials by Engagement
                    </h2>
                    <div className="bg-card border border-border rounded-xl divide-y divide-border" data-testid="material-engagement-list">
                      {materials.slice(0, 8).map((m, i) => (
                        <div key={m.material_id} className="px-4 py-2.5 flex items-center gap-3" data-testid={`row-material-engagement-${m.material_id}`}>
                          <span className="text-[10px] text-muted-foreground w-4 shrink-0">{i + 1}.</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs truncate">{m.material_title}</p>
                            <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                              <span>{materialTypeLabel(m.material_type)}</span>
                              {m.is_high_value && <span className="text-amber-400">★</span>}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 text-[10px] text-muted-foreground">
                            {m.total_views > 0 && (
                              <span className="flex items-center gap-0.5">
                                <Eye className="w-2.5 h-2.5" />{m.total_views}
                              </span>
                            )}
                            {m.total_downloads > 0 && (
                              <span className="flex items-center gap-0.5">
                                <Download className="w-2.5 h-2.5" />{m.total_downloads}
                              </span>
                            )}
                            {m.unique_investors > 0 && (
                              <span className="flex items-center gap-0.5">
                                <Users className="w-2.5 h-2.5" />{m.unique_investors}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Stale high-value investors */}
                {investors.filter(i => ["Highly Engaged","Engaged"].includes(i.engagement_tier) && i.last_meaningful_engagement_at && (Date.now() - new Date(i.last_meaningful_engagement_at).getTime()) / 86400000 > 7).length > 0 && (
                  <div data-testid="section-stale-hot">
                    <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-400" /> Hot Investors — Stale Follow-up
                    </h2>
                    <div className="bg-card border border-amber-500/20 rounded-xl divide-y divide-border">
                      {investors
                        .filter(i =>
                          ["Highly Engaged","Engaged"].includes(i.engagement_tier) &&
                          i.last_meaningful_engagement_at &&
                          (Date.now() - new Date(i.last_meaningful_engagement_at).getTime()) / 86400000 > 7
                        )
                        .slice(0, 5)
                        .map(inv => (
                          <div key={inv.investor_id} className="px-4 py-2.5 flex items-center gap-3" data-testid={`row-stale-hot-${inv.investor_id}`}>
                            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${tierDot(inv.engagement_tier)}`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs truncate font-medium">{inv.investor_name}</p>
                              <p className="text-[10px] text-muted-foreground">{inv.stage}</p>
                            </div>
                            <span className="text-[10px] text-amber-400 shrink-0">
                              {fmtDaysAgo(inv.last_meaningful_engagement_at)}
                            </span>
                          </div>
                        ))
                      }
                    </div>
                  </div>
                )}

                {/* Portal non-openers */}
                {investors.filter(i => i.signals.portal_never_opened).length > 0 && (
                  <div data-testid="section-portal-non-openers">
                    <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <Globe className="w-4 h-4 text-muted-foreground" /> Portal Not Opened
                    </h2>
                    <div className="bg-card border border-border rounded-xl divide-y divide-border">
                      {investors.filter(i => i.signals.portal_never_opened).slice(0, 5).map(inv => (
                        <div key={inv.investor_id} className="px-4 py-2.5 flex items-center gap-3" data-testid={`row-portal-non-opener-${inv.investor_id}`}>
                          <Globe className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs truncate">{inv.investor_name}</p>
                            <p className="text-[10px] text-muted-foreground">{inv.stage}</p>
                          </div>
                          <Badge variant="outline" className={`text-[10px] ${tierColor(inv.engagement_tier)}`}>
                            {inv.engagement_tier}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommended actions */}
                {investors.filter(i =>
                  !i.do_not_contact &&
                  i.stage !== "Passed" &&
                  ["Highly Engaged","Engaged"].includes(i.engagement_tier)
                ).length > 0 && (
                  <div data-testid="section-recommended-actions">
                    <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <Zap className="w-4 h-4 text-cyan-400" /> Priority Actions
                    </h2>
                    <div className="bg-card border border-border rounded-xl divide-y divide-border">
                      {investors
                        .filter(i =>
                          !i.do_not_contact &&
                          i.stage !== "Passed" &&
                          (i.engagement_score >= 45 || i.risk_flags.length > 0)
                        )
                        .sort((a, b) => b.engagement_score - a.engagement_score)
                        .slice(0, 6)
                        .map(inv => (
                          <div key={inv.investor_id} className="px-4 py-2.5 flex items-start gap-3" data-testid={`row-priority-action-${inv.investor_id}`}>
                            <ArrowUpRight className="w-3 h-3 text-cyan-400 mt-0.5 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium truncate">{inv.investor_name}</p>
                              <p className="text-[10px] text-cyan-400/80 mt-0.5 leading-relaxed">{inv.recommended_next_action}</p>
                            </div>
                          </div>
                        ))
                      }
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Tier distribution visualization ── */}
            {analytics && (
              <section>
                <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" data-testid="section-tier-distribution">
                  <TrendingUp className="w-4 h-4 text-muted-foreground" /> Tier Distribution
                </h2>
                <div className="bg-card border border-border rounded-xl p-4" data-testid="tier-distribution-chart">
                  <div className="flex items-end gap-2 h-20">
                    {[
                      { tier: "Highly Engaged" as EngagementTier, count: analytics.highly_engaged_count, color: "bg-emerald-500" },
                      { tier: "Engaged"        as EngagementTier, count: analytics.engaged_count,        color: "bg-cyan-500" },
                      { tier: "Watching"       as EngagementTier, count: analytics.watching_count,       color: "bg-blue-500" },
                      { tier: "Stale"          as EngagementTier, count: analytics.stale_count,          color: "bg-amber-500" },
                      { tier: "Cold"           as EngagementTier, count: analytics.cold_count,           color: "bg-muted-foreground/40" },
                    ].map(({ tier, count, color }) => {
                      const maxCount = Math.max(
                        analytics.highly_engaged_count, analytics.engaged_count,
                        analytics.watching_count, analytics.stale_count, analytics.cold_count, 1
                      );
                      const h = Math.max(4, Math.round((count / maxCount) * 64));
                      return (
                        <div key={tier} className="flex-1 flex flex-col items-center gap-1 cursor-pointer" onClick={() => setTierFilter(tierFilter === tier ? "all" : tier)}>
                          <span className="text-[10px] text-muted-foreground">{count}</span>
                          <div
                            className={`w-full rounded-t-sm transition-all ${color} ${tierFilter === tier ? "opacity-100" : "opacity-70 hover:opacity-100"}`}
                            style={{ height: `${h}px` }}
                            data-testid={tier === "Highly Engaged" ? "bar-tier-highly-engaged" : `bar-tier-${tier.toLowerCase().replace(/ /g, "-")}`}
                          />
                          <span className="text-[9px] text-muted-foreground text-center leading-tight">{tier.split(" ")[0]}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            )}

          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SummaryCard({
  icon, label, value, subtext, testId, onClick, active, highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  subtext?: string;
  testId: string;
  onClick?: () => void;
  active?: boolean;
  highlight?: string;
}) {
  const ring = active
    ? "ring-1 ring-primary"
    : "hover:bg-muted/20";
  return (
    <div
      className={`bg-card border border-border rounded-xl p-3 transition-colors ${onClick ? "cursor-pointer" : ""} ${ring}`}
      onClick={onClick}
      data-testid={testId}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon}
        <span className="text-[10px] text-muted-foreground">{label}</span>
      </div>
      <p className="text-xl font-bold">{value}</p>
      {subtext && <p className="text-[10px] text-muted-foreground mt-0.5">{subtext}</p>}
    </div>
  );
}

function SignalMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/20 rounded-lg px-2 py-1.5">
      <p className="text-[9px] text-muted-foreground">{label}</p>
      <p className="text-xs font-medium">{value}</p>
    </div>
  );
}
