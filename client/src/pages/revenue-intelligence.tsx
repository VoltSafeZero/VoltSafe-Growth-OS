/**
 * Revenue Intelligence — Revenue Command Center
 *
 * Surfaces buying committees, champions, accelerating accounts,
 * at-risk accounts, and follow-up opportunities in one page.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Flame, TrendingUp, TrendingDown, AlertTriangle, Clock,
  ArrowRight, Eye, MousePointerClick, Users, Trophy, Zap,
  Building2, BarChart3, RefreshCw, ChevronRight, Activity,
  Mail,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ── Types ─────────────────────────────────────────────────────────────────────

type MomentumStatus = "accelerating" | "stable" | "cooling" | "dormant";

interface AccountEngagement {
  accountId: number;
  accountName: string;
  engagementScore: number;
  trend: MomentumStatus;
  trendPct: number;
  champion: { name: string | null; email: string; score?: number } | null;
  committeeSize: number;
  lastEngagementAt: string | null;
  totalOpens: number;
  totalClicks: number;
  opens7d: number;
  opens30d: number;
}

interface FollowUpOpportunity {
  accountId: number;
  accountName: string;
  champion: { name: string | null; email: string } | null;
  lastActivityAt: string | null;
  daysSilent: number;
  score: number;
  totalOpens: number;
  totalClicks: number;
  lastThreadId: string | null;
  lastSubject: string | null;
}

interface CommandCenterData {
  hotAccounts:           AccountEngagement[];
  accelerating:          AccountEngagement[];
  followUpOpportunities: FollowUpOpportunity[];
  atRisk:                AccountEngagement[];
  heatmap:               AccountEngagement[];
  summary: {
    hotCount: number;
    totalActiveAccounts: number;
    avgScore: number;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function trendColor(t: MomentumStatus) {
  switch (t) {
    case "accelerating": return "text-emerald-400";
    case "stable":       return "text-amber-400";
    case "cooling":      return "text-orange-400";
    case "dormant":      return "text-muted-foreground/50";
  }
}

function trendBg(t: MomentumStatus) {
  switch (t) {
    case "accelerating": return "bg-emerald-500/10 border-emerald-500/20";
    case "stable":       return "bg-amber-500/10 border-amber-500/20";
    case "cooling":      return "bg-orange-500/10 border-orange-500/20";
    case "dormant":      return "bg-muted/20 border-border/30";
  }
}

function trendLabel(t: MomentumStatus, pct: number) {
  switch (t) {
    case "accelerating": return `↑ ${pct > 0 ? pct + "%" : "Rising"}`;
    case "stable":       return "→ Stable";
    case "cooling":      return `↓ ${Math.abs(pct) > 0 ? Math.abs(pct) + "%" : "Cooling"}`;
    case "dormant":      return "Dormant";
  }
}

function TrendIcon({ trend, className }: { trend: MomentumStatus; className?: string }) {
  switch (trend) {
    case "accelerating": return <TrendingUp  className={`h-3 w-3 ${className ?? trendColor(trend)}`} />;
    case "cooling":
    case "dormant":      return <TrendingDown className={`h-3 w-3 ${className ?? trendColor(trend)}`} />;
    default:             return <Activity    className={`h-3 w-3 ${className ?? trendColor(trend)}`} />;
  }
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
              : score >= 40 ? "bg-amber-500/15 text-amber-400 border-amber-500/20"
              : score >= 20 ? "bg-orange-500/15 text-orange-400 border-orange-500/20"
              :               "bg-muted/20 text-muted-foreground/60 border-border/30";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${color}`}>
      {score}
    </span>
  );
}

function timeAgo(ts: string | null) {
  if (!ts) return "—";
  try { return formatDistanceToNow(new Date(ts), { addSuffix: true }); } catch { return "—"; }
}

// ── Account Row ───────────────────────────────────────────────────────────────

function AccountRow({ acct, onNavigate }: { acct: AccountEngagement; onNavigate: (id: number) => void }) {
  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/30 cursor-pointer transition-colors group"
      onClick={() => onNavigate(acct.accountId)}
      data-testid={`ri-account-row-${acct.accountId}`}
    >
      <div className={`flex-shrink-0 w-1.5 h-8 rounded-full ${
        acct.trend === "accelerating" ? "bg-emerald-400" :
        acct.trend === "cooling"      ? "bg-orange-400"  :
        acct.trend === "dormant"      ? "bg-muted/40"    : "bg-amber-400"
      }`} />

      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-foreground truncate">{acct.accountName}</p>
        {acct.champion && (
          <p className="text-[10px] text-muted-foreground/60 truncate">
            🏆 {acct.champion.name ?? acct.champion.email}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
          <Eye className="h-2.5 w-2.5 text-sky-400" />
          {acct.totalOpens}
        </span>
        <ScoreBadge score={acct.engagementScore} />
        <span className={`text-[10px] font-medium flex items-center gap-0.5 ${trendColor(acct.trend)}`}>
          <TrendIcon trend={acct.trend} />
          <span className="hidden sm:inline">{trendLabel(acct.trend, acct.trendPct)}</span>
        </span>
        <ChevronRight className="h-3 w-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />
      </div>
    </div>
  );
}

// ── Follow-Up Row ─────────────────────────────────────────────────────────────

function FollowUpRow({ opp, onNavigate }: { opp: FollowUpOpportunity; onNavigate: (id: number) => void }) {
  const urgent = opp.daysSilent >= 14;
  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/30 cursor-pointer transition-colors group"
      onClick={() => onNavigate(opp.accountId)}
      data-testid={`ri-followup-row-${opp.accountId}`}
    >
      <div className={`flex-shrink-0 p-1.5 rounded-md ${urgent ? "bg-red-500/10" : "bg-amber-500/10"}`}>
        <Clock className={`h-3 w-3 ${urgent ? "text-red-400" : "text-amber-400"}`} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-foreground truncate">{opp.accountName}</p>
        {opp.lastSubject && (
          <p className="text-[10px] text-muted-foreground/50 truncate">{opp.lastSubject}</p>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0 text-right">
        <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
          <Eye className="h-2.5 w-2.5 text-sky-400" />{opp.totalOpens}
          {opp.totalClicks > 0 && <><MousePointerClick className="h-2.5 w-2.5 text-blue-400 ml-0.5" />{opp.totalClicks}</>}
        </div>
        <span className={`text-[11px] font-semibold ${urgent ? "text-red-400" : "text-amber-400"}`}>
          {opp.daysSilent}d silent
        </span>
        <ChevronRight className="h-3 w-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />
      </div>
    </div>
  );
}

// ── Section Card ──────────────────────────────────────────────────────────────

function SectionCard({
  title, icon: Icon, iconClass, badge, children, emptyText,
}: {
  title: string;
  icon: React.FC<{ className?: string }>;
  iconClass?: string;
  badge?: number;
  children: React.ReactNode;
  emptyText?: string;
}) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className={`h-4 w-4 ${iconClass ?? "text-primary"}`} />
            <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          </div>
          {badge !== undefined && badge > 0 && (
            <span className="text-[10px] font-semibold bg-primary/15 text-primary px-1.5 py-0.5 rounded-full">
              {badge}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-2 pb-3 pt-0">
        {children}
        {(!children || (Array.isArray(children) && children.length === 0)) && emptyText && (
          <p className="text-[11px] text-muted-foreground/40 text-center py-4">{emptyText}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Heatmap Table ─────────────────────────────────────────────────────────────

type SortKey = "score" | "trend" | "opens" | "last_active";

function HeatmapTable({ data, onNavigate }: { data: AccountEngagement[]; onNavigate: (id: number) => void }) {
  const [sortKey, setSortKey] = useState<SortKey>("score");

  const sorted = [...data].sort((a, b) => {
    switch (sortKey) {
      case "score":   return b.engagementScore - a.engagementScore;
      case "opens":   return b.totalOpens - a.totalOpens;
      case "last_active": {
        const aT = a.lastEngagementAt ? new Date(a.lastEngagementAt).getTime() : 0;
        const bT = b.lastEngagementAt ? new Date(b.lastEngagementAt).getTime() : 0;
        return bT - aT;
      }
      case "trend": {
        const order: Record<MomentumStatus, number> = { accelerating: 0, stable: 1, cooling: 2, dormant: 3 };
        return (order[a.trend] ?? 4) - (order[b.trend] ?? 4);
      }
    }
  });

  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => (
    <button
      className={`text-[10px] px-2 py-0.5 rounded transition-colors ${sortKey === k ? "bg-primary/20 text-primary font-semibold" : "text-muted-foreground/60 hover:text-foreground"}`}
      onClick={() => setSortKey(k)}
      data-testid={`heatmap-sort-${k}`}
    >
      {label}
    </button>
  );

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-semibold">Engagement Heatmap</CardTitle>
          </div>
          <div className="flex items-center gap-1 bg-muted/20 rounded-lg p-0.5">
            <SortBtn k="score"       label="Score" />
            <SortBtn k="opens"       label="Opens" />
            <SortBtn k="trend"       label="Trend" />
            <SortBtn k="last_active" label="Recent" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 pb-3 pt-0">
        {sorted.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/40 text-center py-6">
            No account engagement data yet. Send tracked emails to start seeing insights.
          </p>
        ) : (
          <div className="space-y-0.5">
            {/* Header */}
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 px-3 py-1.5 text-[10px] text-muted-foreground/50 uppercase tracking-wide font-medium">
              <span>Account</span>
              <span className="text-right w-14">Score</span>
              <span className="text-right w-12">Opens</span>
              <span className="text-right w-16">Trend</span>
              <span className="text-right w-24">Last Active</span>
            </div>
            {sorted.map(acct => (
              <div
                key={acct.accountId}
                className={`grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors hover:bg-muted/30 border ${trendBg(acct.trend)}`}
                onClick={() => onNavigate(acct.accountId)}
                data-testid={`heatmap-row-${acct.accountId}`}
              >
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold truncate">{acct.accountName}</p>
                  {acct.champion && (
                    <p className="text-[9.5px] text-muted-foreground/50 truncate">
                      🏆 {acct.champion.name ?? acct.champion.email}
                    </p>
                  )}
                </div>
                <div className="text-right w-14">
                  <ScoreBadge score={acct.engagementScore} />
                </div>
                <div className="text-right w-12 text-[11px] text-muted-foreground/70">
                  {acct.totalOpens}
                </div>
                <div className={`text-right w-16 text-[10px] font-medium flex items-center justify-end gap-0.5 ${trendColor(acct.trend)}`}>
                  <TrendIcon trend={acct.trend} />
                  {trendLabel(acct.trend, acct.trendPct)}
                </div>
                <div className="text-right w-24 text-[10px] text-muted-foreground/50">
                  {timeAgo(acct.lastEngagementAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Summary Stat Card ─────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon: Icon, iconClass }: {
  label: string; value: number | string; sub?: string;
  icon: React.FC<{ className?: string }>; iconClass?: string;
}) {
  return (
    <Card className="border-border/50">
      <CardContent className="px-4 py-3">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide font-medium">{label}</p>
          <Icon className={`h-3.5 w-3.5 ${iconClass ?? "text-muted-foreground/40"}`} />
        </div>
        <p className="text-2xl font-bold text-foreground leading-none">{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground/50 mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function RevenueIntelligencePage() {
  const [, navigate] = useLocation();

  const { data, isLoading, refetch, isFetching } = useQuery<CommandCenterData>({
    queryKey: ["/api/revenue-intelligence/command-center"],
    queryFn: () =>
      fetch("/api/revenue-intelligence/command-center", { credentials: "include" })
        .then(r => r.ok ? r.json() : Promise.reject(r)),
    staleTime: 120_000,
    retry: false,
  });

  const goToAccount = (id: number) => navigate(`/accounts/${id}`);

  const summary = data?.summary;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border/40 bg-card/30 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h1 className="text-base font-bold text-foreground">Revenue Intelligence</h1>
              <p className="text-[11px] text-muted-foreground/60">Champion detection · Buying committees · Account momentum</p>
            </div>
          </div>
          <Button
            variant="ghost" size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-muted-foreground/60 hover:text-foreground"
            data-testid="ri-refresh-btn"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-4 space-y-4">
        {/* Summary Stats */}
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[0,1,2,3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="ri-summary-stats">
            <StatCard label="Hot Accounts"    value={summary?.hotCount ?? 0}            icon={Flame}     iconClass="text-orange-400" sub="Score ≥ 50" />
            <StatCard label="Active Accounts" value={summary?.totalActiveAccounts ?? 0} icon={Building2} iconClass="text-primary"    sub="With engagement" />
            <StatCard label="Avg Score"       value={summary?.avgScore ?? 0}            icon={BarChart3} iconClass="text-sky-400"    sub="0–100 scale" />
            <StatCard label="Follow-Ups"      value={data?.followUpOpportunities?.length ?? 0} icon={Clock} iconClass="text-amber-400" sub="Gone quiet" />
          </div>
        )}

        {/* Main 2-col grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 🔥 Hot Accounts */}
          <SectionCard
            title="Hot Accounts"
            icon={Flame}
            iconClass="text-orange-400"
            badge={data?.hotAccounts?.length}
            emptyText="No hot accounts yet — send tracked emails to start seeing data."
          >
            {isLoading ? (
              <div className="space-y-2 px-2">{[0,1,2].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
            ) : (data?.hotAccounts ?? []).length === 0 ? (
              <p className="text-[11px] text-muted-foreground/40 text-center py-5">No hot accounts yet.</p>
            ) : (
              <div className="space-y-0.5">
                {(data?.hotAccounts ?? []).map(a => (
                  <AccountRow key={a.accountId} acct={a} onNavigate={goToAccount} />
                ))}
              </div>
            )}
          </SectionCard>

          {/* ⏳ Follow-Up Opportunities */}
          <SectionCard
            title="Follow-Up Opportunities"
            icon={Clock}
            iconClass="text-amber-400"
            badge={data?.followUpOpportunities?.length}
            emptyText="No follow-up opportunities. All active accounts are staying warm."
          >
            {isLoading ? (
              <div className="space-y-2 px-2">{[0,1,2].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
            ) : (data?.followUpOpportunities ?? []).length === 0 ? (
              <p className="text-[11px] text-muted-foreground/40 text-center py-5">All warm — no follow-ups needed.</p>
            ) : (
              <div className="space-y-0.5">
                {(data?.followUpOpportunities ?? []).map(o => (
                  <FollowUpRow key={`${o.accountId}-${o.lastThreadId}`} opp={o} onNavigate={goToAccount} />
                ))}
              </div>
            )}
          </SectionCard>

          {/* 📈 Accelerating */}
          <SectionCard
            title="Accelerating Relationships"
            icon={TrendingUp}
            iconClass="text-emerald-400"
            badge={data?.accelerating?.length}
          >
            {isLoading ? (
              <div className="space-y-2 px-2">{[0,1,2].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
            ) : (data?.accelerating ?? []).length === 0 ? (
              <p className="text-[11px] text-muted-foreground/40 text-center py-5">No accelerating accounts this period.</p>
            ) : (
              <div className="space-y-0.5">
                {(data?.accelerating ?? []).map(a => (
                  <AccountRow key={a.accountId} acct={a} onNavigate={goToAccount} />
                ))}
              </div>
            )}
          </SectionCard>

          {/* ⚠ At Risk */}
          <SectionCard
            title="At Risk"
            icon={AlertTriangle}
            iconClass="text-red-400"
            badge={data?.atRisk?.length}
          >
            {isLoading ? (
              <div className="space-y-2 px-2">{[0,1,2].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
            ) : (data?.atRisk ?? []).length === 0 ? (
              <p className="text-[11px] text-muted-foreground/40 text-center py-5">No at-risk accounts — engagement looks healthy.</p>
            ) : (
              <div className="space-y-0.5">
                {(data?.atRisk ?? []).map(a => (
                  <AccountRow key={a.accountId} acct={a} onNavigate={goToAccount} />
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        {/* Heatmap */}
        {isLoading ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : (
          <HeatmapTable data={data?.heatmap ?? []} onNavigate={goToAccount} />
        )}
      </div>
    </div>
  );
}
