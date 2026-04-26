import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  LayoutDashboard, RefreshCw, ChevronDown,
  Eye, EyeOff, RotateCcw, Maximize2, Minimize2, SlidersHorizontal,
  AlertTriangle, CheckSquare, TrendingUp, Building2, Mail,
  ChevronRight, Zap, CalendarDays, ShieldAlert, ArrowRight, Route, MapPin, Navigation,
  Sparkles, MoreHorizontal, Check,
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ScoreBadge } from "@/components/scores/score-badge";
import { useHotList, useCommandCenterWidgets } from "@/hooks/use-scores";
import { ScoreListWidget } from "@/components/scores/score-widget";
import {
  buildDashboardConfig, detectCenterType, ALL_CENTER_TYPES,
  type CenterType, type UserProfile, type WidgetDef,
} from "@/lib/dashboard-config";
import { CEOCommandCenter } from "@/components/command-centers/ceo-center";
import { TravelPlannerDialog } from "@/components/travel/travel-planner-dialog";
import { CFOCommandCenter } from "@/components/command-centers/cfo-center";
import { CTOCommandCenter } from "@/components/command-centers/cto-center";
import { CMOCommandCenter } from "@/components/command-centers/cmo-center";
import { ActionWidgetsGrid, ACTION_WIDGET_MAP } from "@/components/command-centers/action-widgets";
import { DashboardGrid, DashboardEditToolbar, generateDefaultLayouts, reconcileLayouts, type DashboardGridHandle } from "@/components/command-centers/dashboard-grid";
import type { Layouts } from "react-grid-layout";
import { format, formatDistanceToNow, isToday, isTomorrow } from "date-fns";
import { Link } from "wouter";

// ── Sales / Default Command Center (reuse existing data) ─────────────────────

type Severity = "high" | "medium" | "low";
const SEV_DOT: Record<Severity, string> = { high: "bg-red-400", medium: "bg-amber-400", low: "bg-blue-400" };
const STAGE_LABEL: Record<string, string> = {
  inbound_new: "New", qualifying: "Qualifying", proposal: "Proposal",
  negotiation: "Negotiating", verbal_commit: "Verbal", closed_won: "Won", closed_lost: "Lost",
};
function fmtMoney(n?: number) { return n && n > 0 ? (n >= 1000 ? `$${(n / 1000).toFixed(0)}k` : `$${n}`) : "—"; }

function SalesSection({ icon: Icon, title, count, link, children, compact, className }: {
  icon: React.ElementType; title: string; count: number; link?: string; children: React.ReactNode; compact?: boolean; className?: string;
}) {
  return (
    <Card className={`border border-border/50 bg-card/80 ${className ?? ""}`} data-testid={`widget-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardHeader className={`${compact ? "pb-1 pt-3 px-4" : "pb-2 pt-4 px-4"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</CardTitle>
            {count > 0 && (
              <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-primary/10 text-primary text-xs font-bold">{count}</span>
            )}
          </div>
          {link && count > 0 && (
            <Link href={link}>
              <button className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5">
                View all <ChevronRight className="h-3 w-3" />
              </button>
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent className={`${compact ? "px-4 pb-3 pt-0" : "px-4 pb-4 pt-0"}`}>{children}</CardContent>
    </Card>
  );
}

function SalesItemRow({ link, severity, title, subtitle, rightLabel, action, testId }: {
  link: string; severity: Severity; title: string; subtitle?: string;
  rightLabel?: string; action?: string; testId?: string;
}) {
  return (
    <Link href={link}>
      <div className="flex items-start gap-2 py-2 px-2 -mx-2 rounded-md hover:bg-muted/40 cursor-pointer transition-colors group" data-testid={testId}>
        <div className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${SEV_DOT[severity]}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{title}</p>
          {subtitle && <p className="text-xs text-muted-foreground truncate mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex flex-col items-end shrink-0 gap-1">
          {rightLabel && <span className="text-xs text-muted-foreground whitespace-nowrap">{rightLabel}</span>}
          {action && <span className="text-xs text-primary opacity-0 group-hover:opacity-100 flex items-center gap-0.5">{action} <ArrowRight className="h-3 w-3" /></span>}
        </div>
      </div>
    </Link>
  );
}

const TYPE_ICONS: Record<string, string> = {
  lead: "🎯", opportunity: "📊", quote: "📋", deployment: "🏗️", churn: "⚠️", expansion: "🚀",
};

function useNearbyRoutes() {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locError, setLocError] = useState(false);

  useEffect(() => {
    if (!navigator.geolocation) { setLocError(true); return; }
    navigator.geolocation.getCurrentPosition(
      pos => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setLocError(true),
      { timeout: 5000 }
    );
  }, []);

  const { data, isLoading } = useQuery<{ suggestions: any[] }>({
    queryKey: ["/api/routing/suggestions", coords?.lat, coords?.lng],
    enabled: !!coords,
    queryFn: async () => {
      if (!coords) return { suggestions: [] };
      const res = await fetch(`/api/routing/suggestions?lat=${coords.lat}&lng=${coords.lng}`, { credentials: "include" });
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  return { suggestions: data?.suggestions ?? [], isLoading: isLoading && !!coords, locError, hasCoords: !!coords };
}

function NearbyRoutesWidget({ compact }: { compact?: boolean }) {
  const { suggestions, isLoading, locError, hasCoords } = useNearbyRoutes();

  if (locError || !hasCoords) {
    return (
      <div className="flex flex-col items-center justify-center py-4 gap-2" data-testid="nearby-routes-no-location">
        <MapPin className="h-6 w-6 text-muted-foreground/30" />
        <p className="text-xs text-muted-foreground text-center">
          Enable location access to see nearby route suggestions.
        </p>
        <Link href="/routing">
          <button className="text-xs text-primary underline-offset-2 hover:underline">Open Territory Routing</button>
        </Link>
      </div>
    );
  }

  if (isLoading) return <Skeleton className="h-16" />;

  if (suggestions.length === 0) {
    return (
      <div className="py-3" data-testid="nearby-routes-empty">
        <p className="text-xs text-muted-foreground italic">No high-priority stops within 25–50 km of your current location.</p>
        <Link href="/routing">
          <button className="mt-1.5 text-xs text-primary underline-offset-2 hover:underline flex items-center gap-1">
            <Route className="h-3 w-3" />View Territory Routing
          </button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="nearby-routes-list">
      {suggestions.map((s: any, i: number) => (
        <Link key={i} href={s.link ?? "/routing"}>
          <div
            className="flex items-center gap-2.5 py-1.5 hover:bg-muted/30 rounded -mx-1 px-1 transition-colors cursor-pointer group"
            data-testid={`nearby-route-${i}`}
          >
            <span className="text-base shrink-0">{s.icon}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate leading-tight">{s.title}</p>
              <p className="text-xs text-muted-foreground truncate">{s.subtitle}</p>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0 transition-colors" />
          </div>
        </Link>
      ))}
      <Link href="/routing">
        <button className="text-xs text-primary underline-offset-2 hover:underline flex items-center gap-1 mt-1">
          <Navigation className="h-3 w-3" />Plan a route
        </button>
      </Link>
    </div>
  );
}

function SalesCommandCenter({ visible, compact }: { visible: Record<string, boolean>; compact?: boolean }) {
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/daily-command-center"], refetchInterval: 5 * 60 * 1000 });
  const sections = data?.sections;
  const { data: hotList, isLoading: hotLoading } = useHotList(10);
  const scoreWidgetsEnabled = !!(visible.hottest_leads_score || visible.close_opps_score || visible.quote_urgency_score);
  const { widgets: scoreWidgets, isLoading: scoreWidgetsLoading } = useCommandCenterWidgets(scoreWidgetsEnabled);

  if (isLoading) return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="sales-center-loading">
      {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-36 rounded-xl" />)}
    </div>
  );

  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="sales-command-center">
      {visible.overdue_tasks && (
        <SalesSection icon={CheckSquare} title="Overdue Tasks" count={sections?.overdueTasks.count ?? 0} link="/execution/tasks" compact={compact}>
          {sections?.overdueTasks.count === 0
            ? <p className="text-xs text-muted-foreground italic py-2">No overdue tasks.</p>
            : sections?.overdueTasks.items.slice(0, 5).map((t: any) => (
                <SalesItemRow key={t.id} link={t.deepLink} severity={t.severity} title={t.title}
                  subtitle={t.linked_object_name ? `${t.linked_object_type}: ${t.linked_object_name}` : undefined}
                  rightLabel={`${Math.round(t.days_overdue)}d overdue`} action="Open" testId={`task-overdue-${t.id}`} />
              ))
          }
        </SalesSection>
      )}
      {visible.suggested_actions && (
        <SalesSection icon={Zap} title="Suggested Actions" count={sections?.suggestedActions.count ?? 0} compact={compact}>
          {sections?.suggestedActions.count === 0
            ? <p className="text-xs text-muted-foreground italic py-2">No urgent signals.</p>
            : sections?.suggestedActions.items.slice(0, 5).map((s: any) => (
                <SalesItemRow key={s.id} link={s.deepLink} severity={s.severity} title={s.title}
                  subtitle={s.reason} action={s.suggested_action_label} testId={`suggestion-${s.id}`} />
              ))
          }
        </SalesSection>
      )}
      {visible.accounts_at_risk && (
        <SalesSection icon={Building2} title="Accounts at Risk" count={sections?.accountsAtRisk.count ?? 0} link="/accounts" compact={compact}>
          {sections?.accountsAtRisk.count === 0
            ? <p className="text-xs text-muted-foreground italic py-2">All accounts recently touched.</p>
            : sections?.accountsAtRisk.items.slice(0, 5).map((a: any) => (
                <SalesItemRow key={a.id} link={a.deepLink} severity={a.severity} title={a.name}
                  subtitle={Number(a.open_deal_count) > 0 ? `${a.open_deal_count} deals · ${fmtMoney(Number(a.open_deal_value))}` : "No open deals"}
                  rightLabel={a.last_interaction_at ? `${Math.round(Number(a.days_since_touch))}d ago` : "Never"} action="View" testId={`account-risk-${a.id}`} />
              ))
          }
        </SalesSection>
      )}
      {visible.stale_deals && (
        <SalesSection icon={TrendingUp} title="Stale Deals" count={sections?.staleOpportunities.count ?? 0} link="/pipeline" compact={compact}>
          {sections?.staleOpportunities.count === 0
            ? <p className="text-xs text-muted-foreground italic py-2">All deals have recent activity.</p>
            : sections?.staleOpportunities.items.slice(0, 5).map((o: any) => (
                <SalesItemRow key={o.id} link={o.deepLink} severity={o.severity} title={o.title}
                  subtitle={[o.account_name, STAGE_LABEL[o.stage] ?? o.stage].filter(Boolean).join(" · ")}
                  rightLabel={`${Math.round(Number(o.days_stale))}d stale`} action="Review" testId={`opp-stale-${o.id}`} />
              ))
          }
        </SalesSection>
      )}
      {visible.inbox_followups && (
        <SalesSection icon={Mail} title="Inbox Follow-ups" count={sections?.inboxFollowUps.count ?? 0} link="/communications" compact={compact}>
          {sections?.inboxFollowUps.count === 0
            ? <p className="text-xs text-muted-foreground italic py-2">Inbox clear.</p>
            : sections?.inboxFollowUps.items.slice(0, 4).map((e: any) => (
                <SalesItemRow key={e.id} link={e.deepLink} severity="high"
                  title={e.subject ?? "(No subject)"}
                  subtitle={`From: ${e.from_name ?? e.from_email ?? "Unknown"}${e.account_name ? ` · ${e.account_name}` : ""}`}
                  rightLabel={e.sent_at ? formatDistanceToNow(new Date(e.sent_at), { addSuffix: true }) : ""}
                  action="Follow up" testId={`inbox-followup-${e.id}`} />
              ))
          }
        </SalesSection>
      )}
      {visible.week_priorities && (
        <SalesSection icon={CalendarDays} title="This Week" count={sections?.thisWeekPriorities.count ?? 0} compact={compact}>
          {sections?.thisWeekPriorities.count === 0
            ? <p className="text-xs text-muted-foreground italic py-2">Nothing on the calendar this week.</p>
            : (
                <>
                  {(sections?.thisWeekPriorities.meetings ?? []).slice(0, 3).map((m: any) => {
                    const start = new Date(m.start_time);
                    const label = isToday(start) ? `Today ${format(start, "h:mm a")}` : isTomorrow(start) ? `Tomorrow` : format(start, "EEE MMM d");
                    return (
                      <Link key={m.id} href="/execution/calendar">
                        <div className="flex items-center gap-2 py-1.5 hover:bg-muted/30 rounded -mx-1 px-1 transition-colors">
                          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <p className="flex-1 text-sm font-medium truncate">{m.title}</p>
                          <span className="text-xs text-muted-foreground">{label}</span>
                        </div>
                      </Link>
                    );
                  })}
                  {(sections?.thisWeekPriorities.tasks ?? []).slice(0, 3).map((t: any) => {
                    const due = new Date(t.due_date);
                    const label = isToday(due) ? "Today" : isTomorrow(due) ? "Tomorrow" : format(due, "EEE MMM d");
                    return (
                      <div key={t.id} className="flex items-center gap-2 py-1.5">
                        <div className={`h-2 w-2 rounded-full shrink-0 ${t.priority === "high" ? "bg-red-400" : t.priority === "medium" ? "bg-amber-400" : "bg-blue-400"}`} />
                        <p className="flex-1 text-sm font-medium truncate">{t.title}</p>
                        <span className="text-xs text-muted-foreground">{label}</span>
                      </div>
                    );
                  })}
                </>
              )
          }
        </SalesSection>
      )}
      {visible.hottest_leads_score && (
        <ScoreListWidget
          title="Hottest Leads"
          icon={Zap}
          items={scoreWidgets?.hottestLeads ?? []}
          objectType="lead"
          accentColor="text-primary"
          link="/opportunities"
          compact={compact}
          isLoading={scoreWidgetsLoading}
          emptyMessage="No leads to score right now"
        />
      )}

      {/* close_opps_score migrated to draggable grid (ACTION_WIDGET_MAP) */}

      {visible.quote_urgency_score && (
        <ScoreListWidget
          title="Quote Follow-up Urgency"
          icon={AlertTriangle}
          items={scoreWidgets?.urgentQuotes ?? []}
          objectType="quote"
          accentColor="text-amber-400"
          link="/quotes"
          compact={compact}
          isLoading={scoreWidgetsLoading}
          emptyMessage="No active quotes to score"
        />
      )}

      {visible.hot_list !== false && (
        <SalesSection icon={Zap} title="Priority Hot List" count={hotList?.length ?? 0} compact={compact}
          className="md:col-span-2">
          {hotLoading && <Skeleton className="h-20" />}
          {!hotLoading && (!hotList || hotList.length === 0) && (
            <p className="text-xs text-muted-foreground italic py-2">No high-priority items across pipeline, quotes, or accounts right now.</p>
          )}
          {!hotLoading && (hotList ?? []).map((item: any, i: number) => (
            <Link key={`${item.type}-${item.id}`} href={item.link}>
              <div className="flex items-center gap-2.5 py-1.5 hover:bg-muted/30 rounded -mx-1 px-1 transition-colors cursor-pointer group" data-testid={`hot-list-item-${item.type}-${item.id}`}>
                <span className="text-base shrink-0">{TYPE_ICONS[item.type] ?? "•"}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate leading-tight">{item.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{item.actionHint}</p>
                </div>
                <ScoreBadge score={item.score} variant="compact" showReasons={true} />
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0 transition-colors" />
              </div>
            </Link>
          ))}
        </SalesSection>
      )}
      {visible.nearby_routes !== false && (
        <SalesSection icon={Route} title="Nearby Routes" count={0} link="/routing" compact={compact}>
          <NearbyRoutesWidget compact={compact} />
        </SalesSection>
      )}
    </div>
  );
}

// ── CS Command Center ─────────────────────────────────────────────────────────
function CSCommandCenter({ visible, compact }: { visible: Record<string, boolean>; compact?: boolean }) {
  const csDash = useQuery<any>({ queryKey: ["/api/cs/dashboard"] });
  const dailyCC = useQuery<any>({ queryKey: ["/api/daily-command-center"] });
  const cd = csDash.data;
  const sections = dailyCC.data?.sections;
  const csScoreEnabled = !!(visible.churn_risk_score || visible.expansion_score);
  const { widgets: csScoreWidgets, isLoading: csScoreLoading } = useCommandCenterWidgets(csScoreEnabled);

  if (csDash.isLoading) return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="cs-center-loading">
      {[1, 2].map(i => <Skeleton key={i} className="h-40 rounded-xl" />)}
    </div>
  );

  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="cs-command-center">
      {visible.health_scores && (
        <SalesSection icon={ShieldAlert} title="Account Health" count={cd?.atRiskCount ?? 0} link="/renewals" compact={compact}>
          {cd ? (
            <div className="space-y-1 mt-1">
              <div className="flex gap-3">
                <div className="text-center">
                  <p className="text-xl font-bold text-blue-400">{cd.avgHealthScore != null ? Math.round(cd.avgHealthScore) : "—"}</p>
                  <p className="text-[10px] text-muted-foreground uppercase">Avg Health</p>
                </div>
                <div className="h-8 w-px bg-border/50" />
                <div className="text-center">
                  <p className="text-xl font-bold text-red-400">{cd.atRiskCount ?? 0}</p>
                  <p className="text-[10px] text-muted-foreground uppercase">At Risk</p>
                </div>
                <div className="h-8 w-px bg-border/50" />
                <div className="text-center">
                  <p className="text-xl font-bold text-amber-400">{cd.renewalsThisMonth ?? 0}</p>
                  <p className="text-[10px] text-muted-foreground uppercase">Renewals</p>
                </div>
              </div>
            </div>
          ) : <p className="text-sm text-muted-foreground">No CS data</p>}
        </SalesSection>
      )}
      {visible.renewal_exposure && (
        <SalesSection icon={RefreshCw} title="Renewal Exposure" count={cd?.renewalsThisMonth ?? 0} link="/renewals" compact={compact}>
          {cd?.totalRenewalValue > 0
            ? <p className="text-base font-bold text-amber-400 mt-1">${(cd.totalRenewalValue / 1000).toFixed(0)}k at stake</p>
            : <p className="text-xs text-emerald-400 mt-1">✓ No renewal exposure this month</p>
          }
        </SalesSection>
      )}
      {visible.overdue_tasks && (
        <SalesSection icon={CheckSquare} title="Overdue Tasks" count={sections?.overdueTasks.count ?? 0} link="/execution/tasks" compact={compact}>
          {sections?.overdueTasks.count === 0
            ? <p className="text-xs text-muted-foreground italic py-2">No overdue tasks.</p>
            : sections?.overdueTasks.items.slice(0, 4).map((t: any) => (
                <SalesItemRow key={t.id} link={t.deepLink} severity={t.severity} title={t.title}
                  rightLabel={`${Math.round(t.days_overdue)}d overdue`} testId={`task-overdue-${t.id}`} />
              ))
          }
        </SalesSection>
      )}
      {visible.accounts_at_risk && (
        <SalesSection icon={Building2} title="Accounts at Risk" count={sections?.accountsAtRisk.count ?? 0} link="/accounts" compact={compact}>
          {sections?.accountsAtRisk.count === 0
            ? <p className="text-xs text-muted-foreground italic py-2">All accounts recently touched.</p>
            : sections?.accountsAtRisk.items.slice(0, 4).map((a: any) => (
                <SalesItemRow key={a.id} link={a.deepLink} severity={a.severity} title={a.name}
                  rightLabel={a.last_interaction_at ? `${Math.round(Number(a.days_since_touch))}d ago` : "Never"} testId={`account-risk-${a.id}`} />
              ))
          }
        </SalesSection>
      )}

      {visible.churn_risk_score && (
        <ScoreListWidget
          title="Churn Risk"
          icon={ShieldAlert}
          items={csScoreWidgets?.churnRisks ?? []}
          objectType="account"
          accentColor="text-cyan-400"
          link="/renewals"
          compact={compact}
          isLoading={csScoreLoading}
          emptyMessage="No active accounts with churn risk"
        />
      )}

      {visible.expansion_score && (
        <ScoreListWidget
          title="Expansion Ready"
          icon={TrendingUp}
          items={csScoreWidgets?.expansionReady ?? []}
          objectType="account"
          accentColor="text-emerald-400"
          link="/accounts"
          compact={compact}
          isLoading={csScoreLoading}
          emptyMessage="No accounts flagged for expansion"
        />
      )}
    </div>
  );
}

// ── Widget Visibility Panel ───────────────────────────────────────────────────
const CATEGORY_LABELS: Record<string, string> = {
  action:   "Action & Productivity",
  risk:     "Risk & Alerts",
  revenue:  "Revenue & Finance",
  team:     "Team",
  pipeline: "Pipeline & Sales",
  classic:  "Role-Specific Widgets",
};

function WidgetVisibilityPanel({ widgets, visible, onToggle, onReset }: {
  widgets: WidgetDef[];
  visible: Record<string, boolean>;
  onToggle: (id: string) => void;
  onReset: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"new" | "classic">("new");

  const newWidgets     = widgets.filter(w => w.isNew);
  const classicWidgets = widgets.filter(w => !w.isNew);

  // Group new widgets by category
  const byCategory: Record<string, WidgetDef[]> = {};
  for (const w of newWidgets) {
    const cat = w.category ?? "action";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(w);
  }

  const renderWidget = (w: WidgetDef) => (
    <div key={w.id} className="flex items-center justify-between p-3 rounded-lg border border-border/40 hover:bg-muted/30 transition-colors">
      <div className="flex-1 min-w-0 pr-4">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium">{w.label}</p>
          {w.isNew && <Badge className="text-[9px] h-3.5 px-1 py-0 bg-primary/20 text-primary border-primary/30 rounded-full">NEW</Badge>}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{w.description}</p>
      </div>
      <Button
        variant={visible[w.id] ? "default" : "outline"}
        size="sm"
        onClick={() => onToggle(w.id)}
        className="shrink-0 gap-1 text-xs h-7"
        data-testid={`toggle-widget-${w.id}`}
      >
        {visible[w.id] ? <><Eye className="h-3 w-3" /> On</> : <><EyeOff className="h-3 w-3" /> Off</>}
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Toggle which widgets appear on your dashboard.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="text-xs gap-1 shrink-0"
            title="Restore the default set of visible widgets for your role. This does NOT change widget positions or sizes — use 'Reset Layout Positions' on the dashboard for that."
            data-testid="picker-reset-visibility-btn"
          >
            <RotateCcw className="h-3 w-3" /> Reset Visible Widgets
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground/70 leading-snug">
          Only changes which widgets are shown or hidden. To restore widget
          positions and sizes, use <span className="font-medium text-foreground/80">Reset Layout Positions</span> in the dashboard's Edit Layout toolbar.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex rounded-md border border-border/50 overflow-hidden">
        <button
          className={`flex-1 py-1.5 text-xs font-medium transition-colors ${activeTab === "new" ? "bg-primary text-primary-foreground" : "hover:bg-muted/50 text-muted-foreground"}`}
          onClick={() => setActiveTab("new")}
          data-testid="picker-tab-new"
        >
          <Sparkles className="h-3 w-3 inline mr-1" />New Widgets ({newWidgets.length})
        </button>
        <button
          className={`flex-1 py-1.5 text-xs font-medium border-l border-border/50 transition-colors ${activeTab === "classic" ? "bg-primary text-primary-foreground" : "hover:bg-muted/50 text-muted-foreground"}`}
          onClick={() => setActiveTab("classic")}
          data-testid="picker-tab-classic"
        >
          Role-Specific ({classicWidgets.length})
        </button>
      </div>

      {activeTab === "new" && (
        <div className="space-y-5">
          {Object.entries(byCategory).map(([cat, catWidgets]) => (
            <div key={cat}>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2 px-1">
                {CATEGORY_LABELS[cat] ?? cat}
              </p>
              <div className="space-y-2">{catWidgets.map(renderWidget)}</div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "classic" && (
        <div className="space-y-2">{classicWidgets.map(renderWidget)}</div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function RoleCommandCenter() {
  const [previewCenterType, setPreviewCenterType] = useState<CenterType | null>(null);
  const [useRoleDefault, setUseRoleDefault] = useState(false);
  const [localVisibility, setLocalVisibility] = useState<Record<string, boolean> | null>(null);
  const [localLayout, setLocalLayout] = useState<"expanded" | "compact" | null>(null);
  const [localWidgetOrder, setLocalWidgetOrder] = useState<string[] | null>(null);
  const orderSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibilitySaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast } = useToast();

  // ── Dashboard grid edit state ───────────────────────────────────────
  const [editingLayout, setEditingLayout] = useState(false);
  const [draftLayouts, setDraftLayouts] = useState<Layouts | null>(null);
  const [resetSeed, setResetSeed] = useState(0); // bumps to force grid to re-read defaults
  const gridHandleRef = useRef<DashboardGridHandle | null>(null);

  const profileQuery = useQuery<UserProfile>({ queryKey: ["/api/users/me/profile"] });

  const saveMutation = useMutation({
    mutationFn: (data: { preferredLayout?: string; widgetVisibility?: Record<string, boolean>; defaultCommandCenter?: string; widgetOrder?: string[] }) =>
      apiRequest("PATCH", "/api/users/me/layout", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users/me/profile"] });
      toast({ title: "Layout saved" });
    },
    onError: (err: any) => { toast({ title: "Error", description: err?.message || "Failed to save layout", variant: "destructive" }); },
  });

  const profile = profileQuery.data;
  const isAdmin = profile ? ["master_admin", "admin"].includes(profile.globalRole) : false;

  const baseConfig = profile ? buildDashboardConfig(profile) : null;
  const displayCenterType = previewCenterType ?? (profile ? detectCenterType(profile) : "default");
  const config = profile ? buildDashboardConfig(profile, displayCenterType) : null;

  const visible = localVisibility ?? (useRoleDefault ? undefined : config?.visibleWidgets) ?? config?.visibleWidgets ?? {};
  const layoutMode = (localLayout ?? profile?.preferredLayout ?? "expanded") as "expanded" | "compact";
  const compact = layoutMode === "compact";
  const widgetOrder = localWidgetOrder ?? config?.widgetOrder ?? [];

  // ── Dashboard grid layout per center ──────────────────────────────────────
  // Filter visible IDs that have a registered grid widget component
  const visibleGridIds = widgetOrder.filter(id => visible[id] !== false && id in ACTION_WIDGET_MAP);
  const allDashboardLayouts = (profile?.dashboardLayouts ?? {}) as Record<string, Layouts>;
  const savedLayoutsForCenter: Layouts | undefined = useRoleDefault
    ? undefined
    : allDashboardLayouts[displayCenterType];
  // When resetSeed bumps, force grid to fall back to defaults by passing undefined
  const effectiveSavedLayouts = resetSeed > 0 && !savedLayoutsForCenter ? undefined : savedLayoutsForCenter;

  const handleToggleWidget = useCallback((id: string) => {
    const current = localVisibility ?? config?.visibleWidgets ?? {};
    // Treat undefined as "currently visible" — same default as renderers below.
    const isOn = current[id] !== false;
    const next = { ...current, [id]: !isOn };
    setLocalVisibility(next);
    // Auto-save toggles with a short debounce so the user never has to hit a
    // separate "Save Layout" button — matches the handleReorder behavior.
    if (visibilitySaveTimer.current) clearTimeout(visibilitySaveTimer.current);
    visibilitySaveTimer.current = setTimeout(() => {
      saveMutation.mutate({ widgetVisibility: next });
    }, 600);
  }, [localVisibility, config, saveMutation]);

  const handleResetWidgets = useCallback(() => {
    setLocalVisibility(null);
    setLocalWidgetOrder(null);
    // Also persist the reset on the server so the next page load matches.
    if (visibilitySaveTimer.current) clearTimeout(visibilitySaveTimer.current);
    saveMutation.mutate({ widgetVisibility: {} });
  }, [saveMutation]);

  const handleReorder = useCallback((newOrder: string[]) => {
    setLocalWidgetOrder(newOrder);
    // Auto-save order with debounce
    if (orderSaveTimer.current) clearTimeout(orderSaveTimer.current);
    orderSaveTimer.current = setTimeout(() => {
      saveMutation.mutate({ widgetOrder: newOrder });
    }, 1500);
  }, [saveMutation]);

  const handleSaveLayout = () => {
    if (!localVisibility && !localLayout) return;
    saveMutation.mutate({
      ...(localVisibility ? { widgetVisibility: localVisibility } : {}),
      ...(localLayout ? { preferredLayout: localLayout } : {}),
    });
  };

  // ── Dashboard grid handlers ───────────────────────────────────────
  const handleEnterEditMode = useCallback(() => {
    setEditingLayout(true);
    setDraftLayouts(null);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingLayout(false);
    setDraftLayouts(null);
    // Bump seed to force re-sync from server-saved layouts
    setResetSeed(s => s + 1);
  }, []);

  const handleSaveDashboard = useCallback(() => {
    // Prefer the live grid layouts via the imperative ref (bypasses any
    // dirty-flag race), fall back to draftLayouts for older code paths.
    const live = gridHandleRef.current?.getLayouts();
    const layoutsToSave = live ?? draftLayouts;
    if (!layoutsToSave) {
      setEditingLayout(false);
      return;
    }
    saveMutation.mutate(
      { dashboardLayouts: { [displayCenterType]: layoutsToSave } } as any,
      {
        onSuccess: () => {
          setEditingLayout(false);
          setDraftLayouts(null);
        },
      },
    );
  }, [draftLayouts, displayCenterType, saveMutation]);

  const resetMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/users/me/layout/reset", { centerType: displayCenterType }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users/me/profile"] });
      setEditingLayout(false);
      setDraftLayouts(null);
      setResetSeed(s => s + 1);
      toast({ title: "Layout reset to role default" });
    },
    onError: (err: any) => toast({ title: "Reset failed", description: err?.message, variant: "destructive" }),
  });

  const handleResetDashboard = useCallback(() => {
    resetMutation.mutate();
  }, [resetMutation]);

  const handleSetDefaultCenter = (ct: CenterType) => {
    saveMutation.mutate({ defaultCommandCenter: ct });
  };

  // Plan My Travel Day → opens the multi-trip Travel Planner.
  // (declared before any early returns to keep hook order stable)
  const [travelPlannerOpen, setTravelPlannerOpen] = useState(false);
  const [travelPlannerEditId, setTravelPlannerEditId] = useState<string | null>(null);
  const openPlanner = useCallback(() => {
    setTravelPlannerEditId(null);
    setTravelPlannerOpen(true);
  }, []);
  const openPlannerForTrip = useCallback((tripId: string | null) => {
    setTravelPlannerEditId(tripId);
    setTravelPlannerOpen(true);
  }, []);

  // Marina day-routing dialog now lives inside the LeadsNearbyGridWidget itself
  // (and remains available from the nearby-marinas map page).

  if (profileQuery.isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-4" data-testid="role-command-center-loading">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!profile || !config) {
    return (
      <div className="p-6 text-center text-muted-foreground" data-testid="role-command-center-error">
        <p>Unable to load command center.</p>
      </div>
    );
  }

  // greeting
  const h = new Date().getHours();
  const greet = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6" data-testid="role-command-center">

      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-foreground" data-testid="rcc-greeting">
              {greet}, {profile.name?.split(" ")[0] ?? "there"}
            </h1>
            <Button
              size="sm"
              onClick={openPlanner}
              className="gap-1.5 h-8 text-xs bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 text-primary-foreground shadow-md"
              data-testid="rcc-plan-travel-day"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Plan My Travel Day</span>
              <span className="sm:hidden">Plan Day</span>
            </Button>
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <p className="text-sm text-muted-foreground">{config.centerLabel}</p>
            {previewCenterType && (
              <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30">Preview mode</Badge>
            )}
            {profile.department && (
              <Badge variant="outline" className="text-[10px]">{profile.department}</Badge>
            )}
            {profile.jobTitle && (
              <Badge variant="outline" className="text-[10px]">{profile.jobTitle}</Badge>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Primary: Edit Layout / Save / Cancel / Reset Positions
              (component swaps its own contents based on `editing`). */}
          <DashboardEditToolbar
            editing={editingLayout}
            // Always allow Save while editing — even if no widget gesture has
            // fired (e.g. a resize that didn't propagate), Save now reads the
            // live grid layouts via gridHandleRef so nothing is lost.
            dirty={editingLayout}
            saving={saveMutation.isPending || resetMutation.isPending}
            onEdit={handleEnterEditMode}
            onSave={handleSaveDashboard}
            onCancel={handleCancelEdit}
            onReset={handleResetDashboard}
          />

          {/* Primary: Widgets sheet trigger */}
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8" data-testid="rcc-settings-btn">
                <SlidersHorizontal className="h-3.5 w-3.5" /> Widgets
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-80 flex flex-col">
              <SheetHeader>
                <SheetTitle>Widget Settings</SheetTitle>
              </SheetHeader>
              <div className="mt-4 flex-1 min-h-0 overflow-y-auto pr-1 -mr-1">
                <WidgetVisibilityPanel
                  widgets={config.widgets}
                  visible={visible}
                  onToggle={handleToggleWidget}
                  onReset={handleResetWidgets}
                />
                {(localVisibility || localLayout) && (
                  <div className="mt-4 pt-4 border-t border-border/30">
                    <Button
                      className="w-full text-sm"
                      onClick={handleSaveLayout}
                      disabled={saveMutation.isPending}
                      data-testid="rcc-save-layout-btn"
                    >
                      {saveMutation.isPending ? "Saving…" : "Save Layout"}
                    </Button>
                    {saveMutation.isSuccess && (
                      <p className="text-xs text-emerald-400 text-center mt-2">Layout saved.</p>
                    )}
                  </div>
                )}
                {isAdmin && (
                  <div className="mt-4 pt-4 border-t border-border/30">
                    <p className="text-xs text-muted-foreground mb-2 font-semibold uppercase tracking-wide">Set Default Center</p>
                    <div className="space-y-1">
                      {ALL_CENTER_TYPES.map(ct => (
                        <Button key={ct.value} variant={profile.defaultCommandCenter === ct.value ? "default" : "outline"}
                          size="sm" className="w-full text-xs justify-start"
                          onClick={() => handleSetDefaultCenter(ct.value)}
                          data-testid={`set-default-${ct.value}`}
                        >
                          {ct.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </SheetContent>
          </Sheet>

          {/* Secondary controls — tucked behind a kebab so the header stays calm.
              Holds: density toggle, layout source, admin "preview as role". */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-9 w-9 sm:h-8 sm:w-8 p-0"
                aria-label="More dashboard options"
                data-testid="rcc-more-menu"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Density</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => setLocalLayout(l => l === "compact" || (l === null && layoutMode === "compact") ? "expanded" : "compact")}
                data-testid="rcc-layout-toggle"
              >
                {compact ? <Maximize2 className="mr-2 h-4 w-4" /> : <Minimize2 className="mr-2 h-4 w-4" />}
                Switch to {compact ? "expanded" : "compact"}
              </DropdownMenuItem>

              <DropdownMenuSeparator />
              <DropdownMenuLabel>Layout source</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => setUseRoleDefault(false)}
                data-testid="rcc-my-layout-btn"
              >
                {!useRoleDefault ? <Check className="mr-2 h-4 w-4" /> : <span className="mr-2 h-4 w-4 inline-block" />}
                My Layout
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => { setUseRoleDefault(true); setLocalVisibility(null); }}
                data-testid="rcc-role-default-btn"
              >
                {useRoleDefault ? <Check className="mr-2 h-4 w-4" /> : <span className="mr-2 h-4 w-4 inline-block" />}
                Role Default
              </DropdownMenuItem>

              {isAdmin && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Preview as role</DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() => setPreviewCenterType(null)}
                    data-testid="preview-my-role"
                  >
                    {!previewCenterType ? <Check className="mr-2 h-4 w-4" /> : <span className="mr-2 h-4 w-4 inline-block" />}
                    My Role ({baseConfig?.centerLabel})
                  </DropdownMenuItem>
                  {ALL_CENTER_TYPES.map(ct => (
                    <DropdownMenuItem
                      key={ct.value}
                      onClick={() => setPreviewCenterType(ct.value)}
                      data-testid={`preview-${ct.value}`}
                    >
                      {previewCenterType === ct.value ? <Check className="mr-2 h-4 w-4" /> : <span className="mr-2 h-4 w-4 inline-block" />}
                      {ct.label}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Travel Calendar and Leads Nearby are draggable grid widgets — see ACTION_WIDGET_MAP */}

      {/* ── Dashboard Grid (drag + resize) ────────────────────────────── */}
      <DashboardGrid
        key={`grid-${displayCenterType}-${resetSeed}`}
        visibleIds={visibleGridIds}
        savedLayouts={effectiveSavedLayouts}
        editing={editingLayout}
        onLayoutsChange={setDraftLayouts}
        gridHandleRef={gridHandleRef}
      />

      {/* ── Role-Specific Center Content ────────────────────────────────── */}
      {displayCenterType === "ceo" && (
        <CEOCommandCenter visible={visible} compact={compact} />
      )}
      {displayCenterType === "cfo" && (
        <CFOCommandCenter visible={visible} compact={compact} />
      )}
      {displayCenterType === "cto" && (
        <CTOCommandCenter visible={visible} compact={compact} />
      )}
      {displayCenterType === "cmo" && (
        <CMOCommandCenter visible={visible} compact={compact} />
      )}
      {(displayCenterType === "sales" || displayCenterType === "default") && (
        <SalesCommandCenter visible={visible} compact={compact} />
      )}
      {displayCenterType === "cs" && (
        <CSCommandCenter visible={visible} compact={compact} />
      )}

      <TravelPlannerDialog
        open={travelPlannerOpen}
        onOpenChange={setTravelPlannerOpen}
        initialTripId={travelPlannerEditId}
      />
    </div>
  );
}
