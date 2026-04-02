import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  UserPlus, TrendingUp, LifeBuoy, FileText,
  AlertTriangle, Clock, MapPin, Building2,
  CalendarClock, CheckSquare, Handshake, Plus,
  ArrowRight, Activity, DollarSign,
} from "lucide-react";
import { DashboardCalendar } from "@/components/dashboard/dashboard-calendar";
import { Link, useLocation } from "wouter";
import type { Activity as ActivityType, Quote, Account } from "@shared/schema";

const DashboardMap = lazy(() => import("@/components/dashboard/dashboard-map"));

type DashboardSummary = {
  totalLeads: number;
  activeDeals: number;
  openTickets: number;
  pendingQuotes: number;
  overdueTasks: number;
  recentActivities: ActivityType[];
};

const stageConfig: Record<string, { label: string; color: string; bar: string }> = {
  new: { label: "New", color: "bg-slate-500/10 text-slate-400 border-slate-500/20", bar: "bg-slate-500" },
  contacted: { label: "Contacted", color: "bg-blue-500/10 text-blue-400 border-blue-500/20", bar: "bg-blue-500" },
  meeting_scheduled: { label: "Meeting", color: "bg-purple-500/10 text-purple-400 border-purple-500/20", bar: "bg-purple-500" },
  qualified: { label: "Qualified", color: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20", bar: "bg-cyan-500" },
  proposal_sent: { label: "Proposal", color: "bg-amber-500/10 text-amber-400 border-amber-500/20", bar: "bg-amber-500" },
  negotiation: { label: "Negotiation", color: "bg-orange-500/10 text-orange-400 border-orange-500/20", bar: "bg-orange-500" },
  won: { label: "Won", color: "bg-green-500/10 text-green-400 border-green-500/20", bar: "bg-green-500" },
  lost: { label: "Lost", color: "bg-red-500/10 text-red-400 border-red-500/20", bar: "bg-red-500" },
};

export default function Dashboard() {
  const [, navigate] = useLocation();

  const { data: summary, isLoading: summaryLoading } = useQuery<DashboardSummary>({
    queryKey: ["/api/dashboard/summary"],
  });

  const activeStages = ["contacted", "meeting_scheduled", "qualified", "proposal_sent", "negotiation"];
  const { data: activeLeads, isLoading: activeLeadsLoading } = useQuery<any[]>({
    queryKey: ["/api/leads", "active-dashboard"],
    queryFn: async () => {
      const results = await Promise.all(
        activeStages.map(stage =>
          fetch(`/api/leads?status=${stage}&limit=50`).then(r => r.json()).then(r => r.data || [])
        )
      );
      return results.flat().sort((a: any, b: any) =>
        activeStages.indexOf(a.status) - activeStages.indexOf(b.status)
      );
    },
  });

  const { data: quotesData } = useQuery<{ data: Quote[]; total: number }>({
    queryKey: ["/api/quotes"],
    queryFn: async () => {
      const res = await fetch("/api/quotes?limit=200");
      return res.json();
    },
  });

  const { data: accountsData } = useQuery<{ data: Account[]; total: number }>({
    queryKey: ["/api/accounts"],
    queryFn: async () => {
      const res = await fetch("/api/accounts?limit=5");
      return res.json();
    },
  });

  const quoteValueInPlay = useMemo(() => {
    if (!quotesData?.data) return 0;
    return quotesData.data
      .filter(q => ["draft", "sent", "accepted"].includes(q.status))
      .reduce((sum, q) => sum + (q.total || 0), 0);
  }, [quotesData]);

  const pipelineByStage = useMemo(() => {
    if (!activeLeads) return [];
    const counts: Record<string, number> = {};
    for (const lead of activeLeads) {
      counts[lead.status] = (counts[lead.status] || 0) + 1;
    }
    return activeStages.map(s => ({ stage: s, count: counts[s] || 0, ...stageConfig[s] }));
  }, [activeLeads]);

  const maxCount = Math.max(...pipelineByStage.map(s => s.count), 1);

  const kpiCards = [
    {
      title: "Open Opportunities",
      value: summary?.activeDeals ?? 0,
      icon: TrendingUp,
      color: "text-green-400",
      bg: "bg-green-500/10",
      href: "/opportunities",
      description: "Active in pipeline",
    },
    {
      title: "Quote Value in Play",
      value: `$${(quoteValueInPlay / 1000).toFixed(0)}k`,
      icon: DollarSign,
      color: "text-purple-400",
      bg: "bg-purple-500/10",
      href: "/quotes",
      description: "Open & draft quotes",
    },
    {
      title: "Open Support Tickets",
      value: summary?.openTickets ?? 0,
      icon: LifeBuoy,
      color: "text-orange-400",
      bg: "bg-orange-500/10",
      href: "/support/tickets",
      description: "Tickets needing attention",
    },
    {
      title: "Leads in Pipeline",
      value: summary?.totalLeads ?? 0,
      icon: UserPlus,
      color: "text-blue-400",
      bg: "bg-blue-500/10",
      href: "/opportunities",
      description: "New leads awaiting contact",
    },
    {
      title: "Draft Quotes",
      value: summary?.pendingQuotes ?? 0,
      icon: FileText,
      color: "text-amber-400",
      bg: "bg-amber-500/10",
      href: "/quotes",
      description: "Requiring follow-up",
    },
    {
      title: "Overdue Tasks",
      value: summary?.overdueTasks ?? 0,
      icon: CheckSquare,
      color: "text-red-400",
      bg: "bg-red-500/10",
      href: "/execution/team-workload",
      description: "Past due date",
    },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-6" data-testid="dashboard-page">

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-page-title">Home</h1>
          <p className="text-muted-foreground mt-1 text-sm">Company overview and recent activity.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="border-border/50 bg-secondary/30 hover:bg-secondary/60 h-9" onClick={() => navigate("/accounts")} data-testid="button-new-account">
            <Plus className="w-3.5 h-3.5 mr-1.5" />New Account
          </Button>
          <Button variant="outline" size="sm" className="border-border/50 bg-secondary/30 hover:bg-secondary/60 h-9" onClick={() => navigate("/opportunities")} data-testid="button-new-opportunity">
            <Plus className="w-3.5 h-3.5 mr-1.5" />New Opportunity
          </Button>
          <Button variant="outline" size="sm" className="border-border/50 bg-secondary/30 hover:bg-secondary/60 h-9" onClick={() => navigate("/support/tickets")} data-testid="button-new-ticket">
            <Plus className="w-3.5 h-3.5 mr-1.5" />New Ticket
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {summaryLoading ? (
          [...Array(6)].map((_, i) => (
            <Card key={i} className="border-border/50 bg-card/50">
              <CardHeader className="pb-2"><Skeleton className="h-4 w-24" /></CardHeader>
              <CardContent><Skeleton className="h-8 w-16 mb-1" /><Skeleton className="h-3 w-28" /></CardContent>
            </Card>
          ))
        ) : (
          kpiCards.map((card) => (
            <Link key={card.title} href={card.href}>
              <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:border-primary/30 hover:bg-card/80 transition-all cursor-pointer h-full" data-testid={`card-kpi-${card.title.toLowerCase().replace(/\s+/g, '-')}`}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-muted-foreground leading-tight">{card.title}</span>
                    <div className={`w-7 h-7 rounded-lg ${card.bg} flex items-center justify-center`}>
                      <card.icon className={`w-3.5 h-3.5 ${card.color}`} />
                    </div>
                  </div>
                  <div className="text-2xl font-bold tracking-tight mb-0.5">{card.value}</div>
                  <p className="text-xs text-muted-foreground/70">{card.description}</p>
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </div>

      {/* Overdue alert */}
      {summary && summary.overdueTasks > 0 && (
        <Link href="/execution/team-workload" data-testid="card-overdue-tasks">
          <Card className="border-orange-500/30 bg-orange-500/5 hover:border-orange-500/50 transition-colors cursor-pointer">
            <CardContent className="flex items-center gap-3 p-4">
              <AlertTriangle className="h-5 w-5 text-orange-400" />
              <div className="flex-1">
                <p className="font-medium text-orange-400">{summary.overdueTasks} overdue task{summary.overdueTasks > 1 ? "s" : ""}</p>
                <p className="text-sm text-muted-foreground">Tasks past their due date need attention.</p>
              </div>
              <ArrowRight className="w-4 h-4 text-orange-400/60" />
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Main content grid */}
      <div className="grid gap-5 lg:grid-cols-3">

        {/* Pipeline Snapshot */}
        <div className="lg:col-span-2 space-y-5">
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                Pipeline Snapshot
              </CardTitle>
              <Link href="/opportunities" className="text-xs text-primary hover:underline flex items-center gap-1" data-testid="link-view-all-opportunities">
                View all <ArrowRight className="w-3 h-3" />
              </Link>
            </CardHeader>
            <CardContent>
              {activeLeadsLoading ? (
                <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
              ) : pipelineByStage.length === 0 || pipelineByStage.every(s => s.count === 0) ? (
                <p className="text-sm text-muted-foreground text-center py-8">No active opportunities</p>
              ) : (
                <div className="space-y-2">
                  {pipelineByStage.filter(s => s.count > 0).map(stage => (
                    <div key={stage.stage} className="flex items-center gap-3">
                      <div className="w-24 shrink-0">
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${stage.color}`}>{stage.label}</Badge>
                      </div>
                      <div className="flex-1 h-5 bg-secondary/30 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${stage.bar} opacity-70`}
                          style={{ width: `${(stage.count / maxCount) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-semibold w-6 text-right shrink-0">{stage.count}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Active leads list */}
              {activeLeads && activeLeads.length > 0 && (
                <div className="mt-4 space-y-1 max-h-[280px] overflow-y-auto">
                  {activeLeads.slice(0, 8).map((lead: any) => {
                    const stage = stageConfig[lead.status] || { label: lead.status, color: "bg-secondary text-muted-foreground" };
                    return (
                      <Link key={lead.id} href={`/opportunities?selected=${lead.id}`} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-secondary/30 transition-colors" data-testid={`active-lead-${lead.id}`}>
                        <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{lead.company}</p>
                          {(lead.city || lead.state) && (
                            <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                              <MapPin className="w-3 h-3 shrink-0" />
                              {[lead.city, lead.state].filter(Boolean).join(", ")}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {lead.dealAmount > 0 && (
                            <span className="text-xs text-muted-foreground">${(lead.dealAmount / 1000).toFixed(0)}k</span>
                          )}
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${stage.color}`}>{stage.label}</Badge>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Support Snapshot */}
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <LifeBuoy className="w-4 h-4 text-orange-400" />
                Support Snapshot
              </CardTitle>
              <Link href="/support/tickets" className="text-xs text-primary hover:underline flex items-center gap-1" data-testid="link-view-all-tickets">
                View all <ArrowRight className="w-3 h-3" />
              </Link>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Open", value: summary?.openTickets ?? 0, color: "text-blue-400" },
                  { label: "Draft Quotes", value: summary?.pendingQuotes ?? 0, color: "text-amber-400" },
                  { label: "Overdue Tasks", value: summary?.overdueTasks ?? 0, color: "text-red-400" },
                ].map(item => (
                  <div key={item.label} className="bg-secondary/20 rounded-lg px-3 py-2.5 text-center">
                    <div className={`text-xl font-bold ${item.color}`}>{item.value}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{item.label}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Open Quotes */}
          {quotesData?.data && quotesData.data.length > 0 && (
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <FileText className="w-4 h-4 text-purple-400" />
                  Open Quotes
                </CardTitle>
                <Link href="/quotes" className="text-xs text-primary hover:underline flex items-center gap-1" data-testid="link-view-all-quotes">
                  View all <ArrowRight className="w-3 h-3" />
                </Link>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {quotesData.data.filter(q => ["draft","sent"].includes(q.status)).slice(0, 5).map(q => (
                    <Link key={q.id} href={`/quotes`} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-secondary/30 transition-colors" data-testid={`quote-row-${q.id}`}>
                      <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{q.quoteNumber}</p>
                        <p className="text-xs text-muted-foreground truncate">{q.customerName || "—"}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-medium">${(q.total || 0).toLocaleString()}</span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">{q.status}</Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-5">

          {/* Calendar */}
          <DashboardCalendar />

          {/* Recent Activity */}
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!summary?.recentActivities || summary.recentActivities.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No recent activity</p>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {summary.recentActivities.map((activity: any) => {
                    const objType = activity.linkedObjectType || activity.objectType;
                    const objId = activity.linkedObjectId || activity.objectId;
                    const linkMap: Record<string, string> = {
                      lead: `/opportunities?selected=${objId}`,
                      account: `/accounts?selected=${objId}`,
                      ticket: `/support/tickets?selected=${objId}`,
                      opportunity: `/opportunities?selected=${objId}`,
                      quote: `/quotes?selected=${objId}`,
                    };
                    const href = objType ? linkMap[objType] : undefined;
                    return (
                      <div key={activity.id} data-testid={`activity-${activity.id}`}>
                        {href ? (
                          <Link href={href} className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-secondary/30 transition-colors cursor-pointer">
                            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                              <Clock className="w-3 h-3 text-primary" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs leading-snug">{activity.summary}</p>
                              <p className="text-[10px] text-muted-foreground mt-0.5">{new Date(activity.createdAt).toLocaleString()}</p>
                            </div>
                          </Link>
                        ) : (
                          <div className="flex items-start gap-2.5 p-2 rounded-lg">
                            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                              <Clock className="w-3 h-3 text-primary" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs leading-snug">{activity.summary}</p>
                              <p className="text-[10px] text-muted-foreground mt-0.5">{new Date(activity.createdAt).toLocaleString()}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recently Updated Accounts */}
          {accountsData?.data && accountsData.data.length > 0 && (
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-muted-foreground" />
                  Accounts
                </CardTitle>
                <Link href="/accounts" className="text-xs text-primary hover:underline flex items-center gap-1" data-testid="link-view-all-accounts">
                  View all <ArrowRight className="w-3 h-3" />
                </Link>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {accountsData.data.slice(0, 5).map((account) => (
                    <Link key={account.id} href={`/accounts?selected=${account.id}`} className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-secondary/30 transition-colors" data-testid={`account-row-${account.id}`}>
                      <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                        <span className="text-[10px] font-semibold text-primary">{account.name[0].toUpperCase()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{account.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{account.city || account.country || account.segment || "—"}</p>
                      </div>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize shrink-0">{account.leadStatus}</Badge>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Map */}
      <Suspense fallback={
        <Card className="border-border/50 bg-card/50">
          <CardHeader><Skeleton className="h-6 w-40" /></CardHeader>
          <CardContent><Skeleton className="h-[400px] rounded-xl" /></CardContent>
        </Card>
      }>
        <DashboardMap />
      </Suspense>
    </div>
  );
}
