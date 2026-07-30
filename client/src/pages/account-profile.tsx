import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Mail, Phone, Building2, Users, Zap, CheckSquare,
  CalendarDays, TrendingUp, TrendingDown, MessageSquare, AlertTriangle, RefreshCw,
  MapPin, Globe, Clock, ExternalLink, Send, Plus, User, Anchor, Pin,
  DollarSign, Package, BarChart2, Pencil, Trophy, Activity, Flame, Eye,
} from "lucide-react";
import { AccountDetailDialog } from "./accounts";
import { formatDistanceToNow, format, isPast } from "date-fns";
import { Link } from "wouter";
import { RecordSummaryBar } from "@/components/record-summary-bar";
import { SuggestedActionsCard } from "@/components/suggested-actions-card";
import { TimelineTab } from "@/components/timeline-tab";
import { ContactsPanel } from "@/components/contacts/contacts-panel";
import { AccountEngagementWidget } from "@/components/engagement/EngagementWidget";
import { MousePointerClick } from "lucide-react";

const STAGE_LABEL: Record<string, string> = {
  inbound_new: "New", qualified: "Qualified", discovery: "Discovery",
  proposal: "Proposal", negotiation: "Negotiation", closed_won: "Won", closed_lost: "Lost",
};
const STAGE_COLOR: Record<string, string> = {
  inbound_new: "bg-slate-500/15 text-slate-400",
  qualified: "bg-blue-500/15 text-blue-400",
  discovery: "bg-violet-500/15 text-violet-400",
  proposal: "bg-amber-500/15 text-amber-400",
  negotiation: "bg-orange-500/15 text-orange-400",
  closed_won: "bg-emerald-500/15 text-emerald-400",
  closed_lost: "bg-red-500/15 text-red-400",
};
const SEG_COLOR: Record<string, string> = {
  A: "bg-emerald-500/15 text-emerald-400",
  B: "bg-blue-500/15 text-blue-400",
  C: "bg-amber-500/15 text-amber-400",
  D: "bg-red-500/15 text-red-400",
};

// ── Heat score tiers (mirrors accounts.tsx) ──────────────────────────────────
type HeatTier = "hot" | "warm" | "nurture" | "low" | "cold";

function getHeatTier(score: number): HeatTier {
  if (score >= 60) return "hot";
  if (score >= 30) return "warm";
  if (score >= 10) return "nurture";
  if (score > 0)   return "low";
  return "cold";
}

const heatTierConfig: Record<HeatTier, { label: string; className: string }> = {
  hot:     { label: "Hot",     className: "bg-red-500/15 text-red-400 border-red-500/30" },
  warm:    { label: "Warm",    className: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
  nurture: { label: "Nurture", className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  low:     { label: "Low",     className: "bg-slate-500/10 text-slate-400 border-slate-500/20" },
  cold:    { label: "Cold",    className: "bg-blue-500/10 text-blue-300 border-blue-500/20" },
};

function ProfileTrendArrow({ trend }: { trend: string | undefined }) {
  if (trend === "accelerating") {
    return <span className="text-emerald-400 leading-none" title="Accelerating">▲</span>;
  }
  if (trend === "cooling" || trend === "dormant") {
    return <span className="text-red-400/70 leading-none" title={trend === "dormant" ? "Dormant" : "Cooling"}>▼</span>;
  }
  return null;
}

type ProfileData = {
  account: any;
  contacts: any[];
  opportunities: any[];
  emails: any[];
  meetings: any[];
  notes: any[];
  tasks: any[];
  suggestedAction: string;
};

function SectionCard({ title, icon: Icon, count, children, action }: {
  title: string; icon: React.ElementType; count?: number; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-semibold">{title}</CardTitle>
            {count !== undefined && count > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-xs">{count}</Badge>
            )}
          </div>
          {action}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">{children}</CardContent>
    </Card>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground py-3 text-center italic">{text}</p>;
}

function NoteComposer({ accountId, onAdded }: { accountId: number; onAdded: () => void }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/notes", {
      content: text, linkedObjectType: "account", linkedObjectId: accountId,
    }),
    onSuccess: () => { setText(""); setOpen(false); queryClient.invalidateQueries({ queryKey: ["/api/notes/all"] }); onAdded(); toast({ title: "Note saved" }); },
    onError: () => toast({ title: "Failed to save note", variant: "destructive" }),
  });
  if (!open) return (
    <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-muted-foreground"
      onClick={() => setOpen(true)} data-testid="button-add-note">
      <Plus className="h-3 w-3" /> Add
    </Button>
  );
  return (
    <div className="mt-2 space-y-2">
      <Textarea value={text} onChange={e => setText(e.target.value)}
        placeholder="Write a note..." className="text-sm min-h-[80px] resize-none"
        data-testid="textarea-note" />
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" disabled={!text.trim() || mutation.isPending}
          onClick={() => mutation.mutate()} className="gap-1.5" data-testid="button-save-note">
          <Send className="h-3 w-3" /> Save
        </Button>
      </div>
    </div>
  );
}

// ── Account Intelligence Panel ─────────────────────────────────────────────

interface RIAccountIntelligence {
  accountId: number;
  accountName: string;
  engagementScore: number;
  committee: {
    champion: { name: string | null; email: string; title: string | null; championScore: number } | null;
    decisionMaker: { name: string | null; email: string } | null;
    committeeSize: number;
    confidenceScore: number;
  };
  mostEngaged: { name: string | null; email: string; opens: number; clicks: number; championScore: number } | null;
  momentum: { status: "accelerating" | "stable" | "cooling" | "dormant"; trendPct: number; last30d: number };
  insights: Array<{ type: string; severity: "info" | "warning" | "success"; text: string }>;
  lastEngagementAt: string | null;
}

interface ActivityEvent {
  type: "open" | "click" | "reply" | "meeting" | "demo";
  at: string;
  contactName: string | null;
  contactEmail: string | null;
  subject: string | null;
  url: string | null;
}

interface AccountOpportunity {
  id: number;
  title: string;
  stage: string;
  amount: number;
  currency: string;
  estCloseDate: string | null;
  forecastCategory: string;
}

const OPP_STAGE_LABEL: Record<string, string> = {
  inbound_new: "New", qualified: "Qualified", discovery: "Discovery",
  proposal: "Proposal", negotiation: "Negotiation",
};
const OPP_STAGE_COLOR: Record<string, string> = {
  inbound_new: "bg-slate-500/15 text-slate-400",
  qualified: "bg-blue-500/15 text-blue-400",
  discovery: "bg-violet-500/15 text-violet-400",
  proposal: "bg-amber-500/15 text-amber-400",
  negotiation: "bg-orange-500/15 text-orange-400",
};

function activityIcon(type: ActivityEvent["type"]) {
  switch (type) {
    case "open":    return <Eye className="h-3 w-3 text-sky-400" />;
    case "click":   return <MousePointerClick className="h-3 w-3 text-blue-400" />;
    case "demo":    return <Activity className="h-3 w-3 text-violet-400" />;
    case "reply":   return <Mail className="h-3 w-3 text-emerald-400" />;
    case "meeting": return <CalendarDays className="h-3 w-3 text-amber-400" />;
  }
}

function ActivityLabel(type: ActivityEvent["type"]) {
  switch (type) {
    case "open": return "Opened";
    case "click": return "Clicked";
    case "demo": return "Viewed Demo";
    case "reply": return "Replied";
    case "meeting": return "Meeting";
  }
}

function timeAgoShort(ts: string | null) {
  if (!ts) return "";
  try { return formatDistanceToNow(new Date(ts), { addSuffix: true }); } catch { return ""; }
}

function AccountIntelligencePanel({ accountId }: { accountId: number }) {
  const { data, isLoading } = useQuery<RIAccountIntelligence | null>({
    queryKey: ["/api/revenue-intelligence/account", accountId],
    queryFn: () =>
      fetch(`/api/revenue-intelligence/account/${accountId}`, { credentials: "include" })
        .then(r => r.ok ? r.json() : null).catch(() => null),
    staleTime: 120_000,
    retry: false,
    enabled: !!accountId,
  });

  const { data: timeline } = useQuery<ActivityEvent[]>({
    queryKey: ["/api/revenue-intelligence/account", accountId, "activity-timeline"],
    queryFn: () =>
      fetch(`/api/revenue-intelligence/account/${accountId}/activity-timeline`, { credentials: "include" })
        .then(r => r.ok ? r.json() : []).catch(() => []),
    staleTime: 120_000,
    retry: false,
    enabled: !!accountId,
  });

  const { data: openOpps } = useQuery<AccountOpportunity[]>({
    queryKey: ["/api/revenue-intelligence/account", accountId, "opportunities"],
    queryFn: () =>
      fetch(`/api/revenue-intelligence/account/${accountId}/opportunities`, { credentials: "include" })
        .then(r => r.ok ? r.json() : []).catch(() => []),
    staleTime: 120_000,
    retry: false,
    enabled: !!accountId,
  });

  if (isLoading) {
    return (
      <Card className="border-border/50" data-testid="account-intelligence-panel">
        <CardContent className="px-4 py-3 space-y-2">
          <Skeleton className="h-4 w-32 rounded" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  if (!data || (!data.committee.champion && !data.mostEngaged && data.engagementScore === 0)) {
    return null;
  }

  const { engagementScore, committee, momentum, insights, mostEngaged } = data;

  const scoreColor = engagementScore >= 70 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                   : engagementScore >= 40 ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
                   : engagementScore >= 20 ? "text-orange-400 bg-orange-500/10 border-orange-500/20"
                   : "text-muted-foreground bg-muted/20 border-border/30";

  const trendColor = momentum.status === "accelerating" ? "text-emerald-400"
                   : momentum.status === "cooling" || momentum.status === "dormant" ? "text-orange-400"
                   : "text-amber-400";

  const TrendIco = momentum.status === "accelerating" ? TrendingUp
                 : momentum.status === "cooling" || momentum.status === "dormant" ? TrendingDown
                 : Activity;

  const successInsights  = insights.filter(i => i.severity === "success");
  const warningInsights  = insights.filter(i => i.severity === "warning");
  const topInsight = warningInsights[0] ?? successInsights[0];

  return (
    <Card className="border-border/50" data-testid="account-intelligence-panel">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm font-semibold">Revenue Intelligence</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 space-y-3">
        {/* Score + Trend */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-sm font-bold ${scoreColor}`}>
            <BarChart2 className="h-3.5 w-3.5" />
            Score {engagementScore}
            {momentum.status === "accelerating" && <span className="text-emerald-400 leading-none ml-0.5">▲</span>}
            {(momentum.status === "cooling" || momentum.status === "dormant") && <span className="text-red-400/70 leading-none ml-0.5">▼</span>}
          </div>
          <span className={`flex items-center gap-1 text-[11px] font-medium ${trendColor}`}>
            <TrendIco className="h-3 w-3" />
            {momentum.status === "accelerating" ? `↑ ${momentum.trendPct > 0 ? momentum.trendPct + "% vs prior 30d" : "Rising"}` :
             momentum.status === "cooling"       ? `↓ ${Math.abs(momentum.trendPct)}% vs prior 30d` :
             momentum.status === "dormant"       ? "Dormant — no recent activity" :
             "Stable"}
          </span>
          {committee.committeeSize > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground/60">
              <Users className="h-3 w-3" />
              {committee.committeeSize} in committee
            </span>
          )}
        </div>

        {/* Champion */}
        {committee.champion && (
          <div className="flex items-center gap-2 bg-amber-500/5 border border-amber-500/15 rounded-lg px-3 py-2" data-testid="champion-card">
            <Trophy className="h-4 w-4 text-amber-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold truncate">{committee.champion.name ?? committee.champion.email}</p>
              {committee.champion.title && (
                <p className="text-[10px] text-muted-foreground/50 truncate">{committee.champion.title}</p>
              )}
            </div>
            <span className="text-[10px] text-amber-500 font-bold flex-shrink-0 bg-amber-500/15 px-1.5 py-0.5 rounded">
              Champion · {committee.champion.championScore} pts
            </span>
          </div>
        )}

        {/* Top Insight */}
        {topInsight && (
          <div className={`flex items-start gap-2 text-[11px] px-3 py-2 rounded-lg border ${
            topInsight.severity === "warning" ? "bg-amber-500/5 border-amber-500/15 text-amber-300/80" :
            topInsight.severity === "success" ? "bg-emerald-500/5 border-emerald-500/15 text-emerald-300/80" :
            "bg-muted/20 border-border/30 text-muted-foreground/70"
          }`} data-testid="intelligence-insight">
            <AlertTriangle className={`h-3 w-3 flex-shrink-0 mt-0.5 ${
              topInsight.severity === "warning" ? "text-amber-400" :
              topInsight.severity === "success" ? "text-emerald-400" : "text-muted-foreground"
            }`} />
            <span className="leading-relaxed">{topInsight.text}</span>
          </div>
        )}

        {/* Recent Activity Timeline */}
        {(timeline ?? []).length > 0 && (
          <div className="border-t border-border/20 pt-3" data-testid="account-activity-timeline">
            <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wide font-medium mb-2 flex items-center gap-1">
              <Activity className="h-2.5 w-2.5" />
              Recent Activity
            </p>
            <div className="space-y-1.5">
              {(timeline ?? []).slice(0, 5).map((ev, idx) => (
                <div key={idx} className="flex items-center gap-2 text-[11px]">
                  <span className="flex-shrink-0">{activityIcon(ev.type)}</span>
                  <span className="flex-1 min-w-0 text-foreground/70 truncate">
                    <span className="font-medium">{ActivityLabel(ev.type)}</span>
                    {ev.contactName ? ` · ${ev.contactName}` : ev.contactEmail ? ` · ${ev.contactEmail}` : ""}
                    {ev.subject ? ` — ${ev.subject}` : ""}
                  </span>
                  <span className="flex-shrink-0 text-[10px] text-muted-foreground/40 whitespace-nowrap">
                    {timeAgoShort(ev.at)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Open Opportunities */}
        {(openOpps ?? []).length > 0 && (
          <div className="border-t border-border/20 pt-3" data-testid="account-open-opportunities">
            <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wide font-medium mb-2 flex items-center gap-1">
              <DollarSign className="h-2.5 w-2.5" />
              Open Opportunities
              <span className="ml-auto bg-primary/10 text-primary text-[9px] font-semibold px-1.5 py-0.5 rounded-full">
                {(openOpps ?? []).length}
              </span>
            </p>
            <div className="space-y-1.5">
              {(openOpps ?? []).map(opp => (
                <div key={opp.id} className="flex items-center gap-2 text-[11px]">
                  <span className={`flex-shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded ${OPP_STAGE_COLOR[opp.stage] ?? "bg-muted/20 text-muted-foreground"}`}>
                    {OPP_STAGE_LABEL[opp.stage] ?? opp.stage}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-foreground/70">{opp.title}</span>
                  {opp.amount > 0 && (
                    <span className="flex-shrink-0 font-semibold text-foreground/60">
                      ${opp.amount.toLocaleString()}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AccountProfilePage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, navigate] = useLocation();
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<ProfileData>({
    queryKey: ["/api/accounts", id, "profile"],
    queryFn: () => fetch(`/api/accounts/${id}/profile`).then(r => {
      if (!r.ok) throw new Error("Not found");
      return r.json();
    }),
  });

  // Heat / per-account intelligence — same queryKey as AccountIntelligencePanel so React Query shares the cache
  const { data: accountIntel } = useQuery<RIAccountIntelligence | null>({
    queryKey: ["/api/revenue-intelligence/account", id],
    queryFn: () =>
      fetch(`/api/revenue-intelligence/account/${id}`, { credentials: "include" })
        .then(r => r.ok ? r.json() : null).catch(() => null),
    staleTime: 120_000,
    retry: false,
    enabled: !!id,
  });

  // Revenue data — hoisted above early returns to satisfy React rules of hooks
  const { data: billingLines } = useQuery<any[]>({ queryKey: ["/api/accounts", id, "billing-lines"], queryFn: () => fetch(`/api/accounts/${id}/billing-lines`).then(r => r.json()), staleTime: 30_000, enabled: !!id });
  const { data: rolloutPhases } = useQuery<any[]>({ queryKey: ["/api/accounts", id, "rollout-phases"], queryFn: () => fetch(`/api/accounts/${id}/rollout-phases`).then(r => r.json()), staleTime: 30_000, enabled: !!id });
  const { data: revenueMetrics } = useQuery<any>({ queryKey: ["/api/revenue/account", id, "metrics"], queryFn: () => fetch(`/api/revenue/account/${id}/metrics`).then(r => r.json()), staleTime: 30_000, enabled: !!id });

  if (isLoading) return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-32 w-full" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-40" />)}
      </div>
    </div>
  );

  if (isError || !data) return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[40vh] gap-4">
      <AlertTriangle className="h-8 w-8 text-amber-400" />
      <p className="text-sm text-muted-foreground">Could not load account profile.</p>
      <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
        <RefreshCw className="h-3.5 w-3.5" /> Retry
      </Button>
    </div>
  );

  const { account, contacts, opportunities, emails, meetings, notes, tasks, suggestedAction } = data;
  const openTasks = tasks.filter((t: any) => t.status !== "done");
  const overdueTasks = openTasks.filter((t: any) => t.due_date && isPast(new Date(t.due_date)));
  const openOpps = opportunities.filter((o: any) => !["closed_won", "closed_lost"].includes(o.stage));
  const wonOpps = opportunities.filter((o: any) => o.stage === "closed_won");
  const totalPipeline = openOpps.reduce((s: number, o: any) => s + (Number(o.amount) || 0), 0);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5" data-testid="account-profile-page">
      {editDialogOpen && (
        <AccountDetailDialog
          account={account as any}
          onClose={() => { setEditDialogOpen(false); refetch(); }}
          canEdit={true}
        />
      )}
      {/* Back */}
      <Button variant="ghost" size="sm" onClick={() => navigate("/accounts")}
        className="gap-1.5 text-muted-foreground hover:text-foreground" data-testid="button-back">
        <ArrowLeft className="h-4 w-4" /> Accounts
      </Button>

      {/* Identity Card */}
      <Card className="border-border/50">
        <CardContent className="p-5">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-shrink-0">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Anchor className="h-8 w-8 text-primary" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h1 className="text-xl font-bold" data-testid="text-account-name">{account.name}</h1>
                {account.segment && (
                  <Badge className={`text-xs ${SEG_COLOR[account.segment] ?? "bg-secondary"}`}>
                    Tier {account.segment}
                  </Badge>
                )}
                {account.priority && (
                  <Badge variant="outline" className="text-xs capitalize">{account.priority}</Badge>
                )}
                {accountIntel && accountIntel.engagementScore > 0 && (() => {
                  const tier = getHeatTier(accountIntel.engagementScore);
                  const cfg = heatTierConfig[tier];
                  return (
                    <Badge variant="outline" className={`text-xs flex items-center gap-1 ${cfg.className}`} data-testid="heat-badge">
                      <Flame className="h-2.5 w-2.5" />
                      {cfg.label}
                      <span className="opacity-60">{accountIntel.engagementScore}</span>
                      <ProfileTrendArrow trend={accountIntel.momentum?.status} />
                    </Badge>
                  );
                })()}
              </div>
              {account.org_type && <p className="text-sm text-muted-foreground capitalize">{account.org_type.replace(/_/g, " ")}</p>}
              <div className="flex flex-wrap gap-3 mt-3">
                {(account.city || account.state_province) && (
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5 text-primary" />
                    {[account.city, account.state_province].filter(Boolean).join(", ")}
                  </span>
                )}
                {account.website && (
                  <a href={account.website.startsWith("http") ? account.website : `https://${account.website}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
                    <Globe className="h-3.5 w-3.5 text-primary" /> {account.website}
                  </a>
                )}
                {account.slip_count && (
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Anchor className="h-3.5 w-3.5 text-primary" /> {account.slip_count} slips
                  </span>
                )}
              </div>
              {/* KPIs */}
              <div className="flex flex-wrap gap-3 mt-4">
                {[
                  { label: "Contacts", value: contacts.length, color: "text-foreground" },
                  { label: "Open Deals", value: openOpps.length, color: "text-blue-400" },
                  { label: "Pipeline", value: totalPipeline > 0 ? `$${(totalPipeline / 1000).toFixed(0)}k` : "$0", color: "text-primary" },
                  { label: "Won", value: wonOpps.length, color: "text-emerald-400" },
                ].map(kpi => (
                  <div key={kpi.label} className="text-center px-3 py-2 rounded-lg bg-secondary/30 border border-border/40">
                    <p className={`text-lg font-bold ${kpi.color}`}>{kpi.value}</p>
                    <p className="text-xs text-muted-foreground">{kpi.label}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex-shrink-0 flex flex-col gap-2 sm:items-end">
              <Button variant="outline" size="sm" onClick={() => setEditDialogOpen(true)} className="gap-1.5" data-testid="button-edit-org">
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
              {overdueTasks.length > 0 && (
                <Badge variant="destructive" className="text-xs">{overdueTasks.length} overdue</Badge>
              )}
              {account.next_action && (
                <div className="text-xs text-muted-foreground text-right max-w-[160px]">
                  <span className="text-primary font-medium">Next:</span> {account.next_action}
                </div>
              )}
            </div>
          </div>

          {/* Suggested Action */}
          <div className="mt-4 flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-primary/5 border border-primary/20">
            <Zap className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-0.5">Suggested Next Action</p>
              <p className="text-sm text-foreground" data-testid="text-suggested-action">{suggestedAction}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Field Quick Actions — one-tap actions for field use */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="field-quick-actions">
        {account.website ? (
          <a
            href={account.website.startsWith("http") ? account.website : `https://${account.website}`}
            target="_blank" rel="noopener noreferrer"
            data-testid="button-quick-website"
            className="flex flex-col items-center justify-center gap-1.5 py-3.5 rounded-xl bg-secondary/40 border border-border/40 hover:bg-primary/10 hover:border-primary/30 active:scale-95 transition-all"
          >
            <Globe className="h-5 w-5 text-primary" />
            <span className="text-xs font-medium">Website</span>
          </a>
        ) : (
          <div className="flex flex-col items-center justify-center gap-1.5 py-3.5 rounded-xl bg-secondary/20 border border-border/20 opacity-30 cursor-not-allowed">
            <Globe className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">Website</span>
          </div>
        )}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("open-quick-capture", { detail: { tab: "note" } }))}
          data-testid="button-quick-note"
          className="flex flex-col items-center justify-center gap-1.5 py-3.5 rounded-xl bg-secondary/40 border border-border/40 hover:bg-primary/10 hover:border-primary/30 active:scale-95 transition-all"
        >
          <MessageSquare className="h-5 w-5 text-primary" />
          <span className="text-xs font-medium">Note</span>
        </button>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("open-quick-capture", { detail: { tab: "task" } }))}
          data-testid="button-quick-task"
          className="flex flex-col items-center justify-center gap-1.5 py-3.5 rounded-xl bg-secondary/40 border border-border/40 hover:bg-primary/10 hover:border-primary/30 active:scale-95 transition-all"
        >
          <CheckSquare className="h-5 w-5 text-primary" />
          <span className="text-xs font-medium">Task</span>
        </button>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("open-quick-capture", { detail: { tab: "opportunity" } }))}
          data-testid="button-quick-deal"
          className="flex flex-col items-center justify-center gap-1.5 py-3.5 rounded-xl bg-secondary/40 border border-border/40 hover:bg-primary/10 hover:border-primary/30 active:scale-95 transition-all"
        >
          <TrendingUp className="h-5 w-5 text-primary" />
          <span className="text-xs font-medium">New Deal</span>
        </button>
      </div>

      {/* Record Summary Bar */}
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <RecordSummaryBar objectType="account" objectId={id} />
        </CardContent>
      </Card>

      {/* Suggested Next Actions */}
      <SuggestedActionsCard
        objectType="account"
        objectId={id}
        onOpenNoteComposer={() => {
          document.getElementById("account-notes-section")?.scrollIntoView({ behavior: "smooth" });
        }}
        onScrollToSection={(section) => {
          document.getElementById(`account-${section}-section`)?.scrollIntoView({ behavior: "smooth" });
        }}
      />

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left */}
        <div className="lg:col-span-2 space-y-4">
          {/* Emails */}
          <SectionCard title="Recent Emails" icon={Mail} count={emails.length}>
            {emails.length === 0 ? <EmptyRow text="No emails synced for this account" /> : (
              <div className="space-y-0.5">
                {emails.map((e: any) => (
                  <div key={e.id} className="flex items-start gap-2.5 py-2 border-b border-border/30 last:border-0">
                    <div className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${e.direction === "inbound" ? "bg-blue-400" : "bg-emerald-400"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate" data-testid={`email-subject-${e.id}`}>{e.subject || "(no subject)"}</div>
                      <div className="text-xs text-muted-foreground truncate">{e.from_name || e.from_email} · {e.sent_at ? formatDistanceToNow(new Date(e.sent_at), { addSuffix: true }) : "—"}</div>
                      {e.snippet && <div className="text-xs text-muted-foreground/60 truncate mt-0.5">{e.snippet}</div>}
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${e.direction === "inbound" ? "bg-blue-500/10 text-blue-400" : "bg-emerald-500/10 text-emerald-400"}`}>
                      {e.direction === "inbound" ? "In" : "Out"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Meetings */}
          <SectionCard title="Meetings" icon={CalendarDays} count={meetings.length}>
            {meetings.length === 0 ? <EmptyRow text="No meetings linked to this account" /> : (
              <div className="space-y-0.5">
                {meetings.map((m: any) => (
                  <div key={m.id} className="flex items-center gap-2.5 py-2 border-b border-border/30 last:border-0">
                    <CalendarDays className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{m.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {m.start_time ? format(new Date(m.start_time), "MMM d, yyyy h:mm a") : "—"}
                        {m.location && ` · ${m.location}`}
                      </div>
                    </div>
                    {m.meeting_url && (
                      <a href={m.meeting_url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Key Facts (pinned notes) */}
          {notes.some((n: any) => n.is_pinned) && (
            <SectionCard title="Key Facts" icon={Pin}>
              <div className="space-y-2">
                {notes.filter((n: any) => n.is_pinned).map((n: any) => (
                  <div key={n.id} className="rounded-lg border border-primary/25 bg-primary/8 p-3" data-testid={`key-fact-${n.id}`}>
                    <p className="text-sm whitespace-pre-wrap font-medium">{n.content}</p>
                    <p className="text-xs text-muted-foreground mt-1.5">
                      {n.author_name} · {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                    </p>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {/* Notes */}
          <SectionCard title="Notes" icon={MessageSquare} count={notes.length}
            action={<NoteComposer accountId={id} onAdded={() => refetch()} />}>
            {notes.length === 0 ? <EmptyRow text="No notes yet — add one above" /> : (
              <div className="space-y-3">
                {notes.filter((n: any) => !n.is_pinned).length === 0
                  ? <EmptyRow text="All notes pinned as key facts above" />
                  : notes.filter((n: any) => !n.is_pinned).map((n: any) => (
                    <div key={n.id} className="rounded-lg bg-secondary/30 p-3">
                      <p className="text-sm whitespace-pre-wrap">{n.content}</p>
                      <p className="text-xs text-muted-foreground mt-1.5">
                        {n.author_name} · {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                      </p>
                    </div>
                  ))}
              </div>
            )}
          </SectionCard>
        </div>

        {/* Right */}
        <div className="space-y-4">
          {/* Contacts */}
          <SectionCard title="Contacts" icon={Users} count={contacts.length}>
            <ContactsPanel entityType="account" entityId={account.id} emptyText="No contacts on record yet." />
          </SectionCard>

          {/* Opportunities */}
          <SectionCard title="Opportunities" icon={TrendingUp} count={opportunities.length}>
            {opportunities.length === 0 ? <EmptyRow text="No deals on record" /> : (
              <div className="space-y-2">
                {opportunities.map((o: any) => (
                  <Link key={o.id} href={`/opportunities/${o.id}`}>
                    <div className="p-2.5 rounded-lg border border-border/40 hover:border-border hover:bg-muted/30 transition-colors cursor-pointer"
                      data-testid={`opp-link-${o.id}`}>
                      <div className="text-sm font-medium truncate">{o.title}</div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <Badge variant="outline" className={`text-[10px] h-5 px-1.5 ${STAGE_COLOR[o.stage] ?? ""}`}>
                          {STAGE_LABEL[o.stage] ?? o.stage}
                        </Badge>
                        {o.amount && <span className="text-xs text-muted-foreground">${Number(o.amount).toLocaleString()}</span>}
                      </div>
                      {o.owner_name && <p className="text-xs text-muted-foreground mt-1">{o.owner_name}</p>}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Tasks */}
          <SectionCard title="Tasks" icon={CheckSquare} count={openTasks.length}>
            {tasks.length === 0 ? <EmptyRow text="No tasks linked" /> : (
              <div className="space-y-1.5">
                {tasks.map((t: any) => {
                  const overdue = t.status !== "done" && t.due_date && isPast(new Date(t.due_date));
                  return (
                    <div key={t.id} className="flex items-start gap-2 py-1.5 border-b border-border/20 last:border-0"
                      data-testid={`task-row-${t.id}`}>
                      <div className={`w-3 h-3 rounded-full border mt-0.5 flex-shrink-0 ${t.status === "done" ? "bg-emerald-500 border-emerald-500" : overdue ? "border-red-400" : "border-border"}`} />
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm leading-tight ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>{t.title}</p>
                        {t.due_date && (
                          <p className={`text-xs mt-0.5 ${overdue ? "text-red-400" : "text-muted-foreground"}`}>
                            {overdue ? "Overdue · " : "Due "}{format(new Date(t.due_date), "MMM d")}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      {/* Commercial / Revenue Section */}
      {(revenueMetrics || account.contractedUnits || (billingLines && billingLines.length > 0) || (rolloutPhases && rolloutPhases.length > 0)) && (
        <div id="account-commercial-section" data-testid="commercial-section">
          <Card className="border-border/50">
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-primary" />
                  <CardTitle className="text-sm font-semibold">Commercial & Revenue</CardTitle>
                </div>
                <Link href="/revenue">
                  <Button variant="ghost" size="sm" className="text-xs h-7 gap-1" data-testid="button-revenue-hub">
                    Revenue Hub <BarChart2 className="h-3 w-3" />
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-4">
              {/* Slip Breakdown */}
              {(account.totalSlips || account.voltsafeSlipsLive || account.nonVoltsafeSlipsOnSoftware) && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Slip Breakdown</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {account.totalSlips && (
                      <div className="p-2 rounded-lg border border-border/40 text-center" data-testid="stat-total-slips">
                        <p className="text-lg font-bold">{account.totalSlips}</p>
                        <p className="text-[11px] text-muted-foreground">Total Slips</p>
                      </div>
                    )}
                    {account.voltsafeSlipsLive != null && account.voltsafeSlipsLive >= 0 && (
                      <div className="p-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 text-center" data-testid="stat-voltsafe-live">
                        <p className="text-lg font-bold text-emerald-400">{account.voltsafeSlipsLive}</p>
                        <p className="text-[11px] text-muted-foreground">VoltSafe Live</p>
                      </div>
                    )}
                    {account.nonVoltsafeSlipsOnSoftware != null && account.nonVoltsafeSlipsOnSoftware >= 0 && (
                      <div className="p-2 rounded-lg border border-blue-500/30 bg-blue-500/5 text-center" data-testid="stat-software-only">
                        <p className="text-lg font-bold text-blue-400">{account.nonVoltsafeSlipsOnSoftware}</p>
                        <p className="text-[11px] text-muted-foreground">Software Only</p>
                      </div>
                    )}
                    {account.futureUpgradeSlips != null && account.futureUpgradeSlips > 0 && (
                      <div className="p-2 rounded-lg border border-amber-500/30 bg-amber-500/5 text-center" data-testid="stat-future-upgrade">
                        <p className="text-lg font-bold text-amber-400">{account.futureUpgradeSlips}</p>
                        <p className="text-[11px] text-muted-foreground">Future Upgrade</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* MRR Summary */}
              {revenueMetrics?.mrr && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">SaaS Revenue</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="p-2 rounded-lg border border-border/40 text-center" data-testid="stat-current-mrr">
                      <p className="text-lg font-bold text-emerald-400">${revenueMetrics.mrr.current.toFixed(0)}</p>
                      <p className="text-[11px] text-muted-foreground">Current MRR</p>
                    </div>
                    <div className="p-2 rounded-lg border border-border/40 text-center" data-testid="stat-contracted-mrr">
                      <p className="text-lg font-bold">${revenueMetrics.mrr.contractedFuture.toFixed(0)}</p>
                      <p className="text-[11px] text-muted-foreground">Contracted MRR</p>
                    </div>
                    {revenueMetrics.mrr.fullyDeployed > 0 && (
                      <div className="p-2 rounded-lg border border-border/40 text-center" data-testid="stat-fully-deployed-mrr">
                        <p className="text-lg font-bold">${revenueMetrics.mrr.fullyDeployed.toFixed(0)}</p>
                        <p className="text-[11px] text-muted-foreground">Fully Deployed</p>
                      </div>
                    )}
                    {revenueMetrics.mrr.softwareOnly > 0 && (
                      <div className="p-2 rounded-lg border border-border/40 text-center" data-testid="stat-software-mrr">
                        <p className="text-lg font-bold text-blue-400">${revenueMetrics.mrr.softwareOnly.toFixed(0)}</p>
                        <p className="text-[11px] text-muted-foreground">Software MRR</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Hardware Contract */}
              {(account.contractedHardwareValue || account.contractedUnits) && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Hardware Contract</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {account.contractedHardwareValue && (
                      <div className="p-2 rounded-lg border border-border/40" data-testid="stat-contracted-hw">
                        <p className="text-xs text-muted-foreground">Contracted</p>
                        <p className="text-sm font-bold">${Number(account.contractedHardwareValue).toLocaleString()}</p>
                      </div>
                    )}
                    {account.bookedHardwareValue && (
                      <div className="p-2 rounded-lg border border-border/40" data-testid="stat-booked-hw">
                        <p className="text-xs text-muted-foreground">Booked</p>
                        <p className="text-sm font-bold">${Number(account.bookedHardwareValue).toLocaleString()}</p>
                      </div>
                    )}
                    {account.deliveredHardwareValue && (
                      <div className="p-2 rounded-lg border border-emerald-500/30" data-testid="stat-delivered-hw">
                        <p className="text-xs text-muted-foreground">Delivered</p>
                        <p className="text-sm font-bold text-emerald-400">${Number(account.deliveredHardwareValue).toLocaleString()}</p>
                      </div>
                    )}
                  </div>
                  {account.contractedUnits && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <Package className="h-3 w-3" />
                      {account.installedUnits ?? 0}/{account.contractedUnits} units installed
                      {account.rolloutEndTarget && <span>· Target: {account.rolloutEndTarget}</span>}
                    </div>
                  )}
                  {revenueMetrics?.units?.rolloutCompletionPct != null && (
                    <div className="mt-2">
                      <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>Rollout progress</span>
                        <span>{revenueMetrics.units.rolloutCompletionPct}%</span>
                      </div>
                      <div className="w-full bg-border/40 rounded-full h-1.5">
                        <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${Math.min(100, revenueMetrics.units.rolloutCompletionPct)}%` }} />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* SaaS Billing Lines */}
              {billingLines && billingLines.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">SaaS Billing Lines ({billingLines.length})</p>
                  <div className="space-y-1.5">
                    {billingLines.map((line: any) => (
                      <div key={line.id} className={`flex items-center justify-between px-3 py-2 rounded-lg border ${line.isActive ? "border-border/40" : "border-border/20 opacity-50"}`}
                        data-testid={`billing-line-${line.id}`}>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium truncate">{line.label || line.lineType.replace(/_/g, " ")}</p>
                            <Badge variant="outline" className={`text-[10px] h-4 px-1 flex-shrink-0 ${line.isActive ? "text-emerald-400" : "text-muted-foreground"}`}>
                              {line.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{line.quantity}× @ ${Number(line.monthlyRate).toFixed(2)}/mo</p>
                        </div>
                        <p className="text-sm font-semibold text-emerald-400 flex-shrink-0">
                          ${(Number(line.quantity) * Number(line.monthlyRate)).toFixed(2)}/mo
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Rollout Phases */}
              {rolloutPhases && rolloutPhases.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Rollout Phases ({rolloutPhases.length})</p>
                  <div className="space-y-1.5">
                    {rolloutPhases.map((phase: any) => {
                      const phaseColor: Record<string, string> = {
                        planned: "text-slate-400", in_progress: "text-blue-400",
                        complete: "text-emerald-400", blocked: "text-red-400", cancelled: "text-zinc-500",
                      };
                      return (
                        <div key={phase.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-border/40"
                          data-testid={`rollout-phase-${phase.id}`}>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium truncate">{phase.phaseName}</p>
                              {phase.dock_finger_zone && <span className="text-xs text-muted-foreground truncate">{phase.dock_finger_zone}</span>}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                              <span>{phase.installedUnits}/{phase.plannedUnits} units</span>
                              {phase.target_install_date && <span>· {phase.target_install_date}</span>}
                            </div>
                          </div>
                          <Badge variant="outline" className={`text-[10px] h-5 px-1.5 capitalize flex-shrink-0 ${phaseColor[phase.status] ?? ""}`}>
                            {phase.status.replace(/_/g, " ")}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Pricing Lock */}
              {(account.pricingLockDate || account.pricingLockExpiry || account.commercialNotes) && (
                <div className="p-3 bg-muted/30 rounded-lg border border-border/30">
                  {(account.pricingLockDate || account.pricingLockExpiry) && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                      <Pin className="h-3 w-3" />
                      <span>Pricing lock: {account.pricingLockDate ?? "—"}</span>
                      {account.pricingLockExpiry && <span>· Expires: {account.pricingLockExpiry}</span>}
                    </div>
                  )}
                  {account.commercialNotes && (
                    <p className="text-xs text-muted-foreground">{account.commercialNotes}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Account Intelligence */}
      <AccountIntelligencePanel accountId={id} />

      {/* Engagement Intelligence */}
      <Card className="border-border/50" data-testid="account-engagement-section">
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center gap-2">
            <MousePointerClick className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-semibold">Engagement</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <AccountEngagementWidget accountId={id} />
        </CardContent>
      </Card>

      {/* Timeline */}
      <div id="account-timeline-section">
        <Card className="border-border/50">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm font-semibold">Timeline</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <TimelineTab objectType="account" objectId={id} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
