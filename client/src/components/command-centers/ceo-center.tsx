import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TrendingUp, AlertTriangle, ShieldAlert, Truck, Building2,
  Zap, ChevronRight, DollarSign,
} from "lucide-react";
import type { LayoutMode } from "@/lib/dashboard-config";

function fmt$(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n}`;
}

function WidgetCard({ title, icon: Icon, children, accent, link, compact }: {
  title: string; icon: React.ElementType; children: React.ReactNode;
  accent?: string; link?: string; compact?: boolean;
}) {
  return (
    <Card className="border border-border/50 bg-card/80" data-testid={`widget-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardHeader className={`${compact ? "pb-1 pt-3 px-4" : "pb-2 pt-4 px-4"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className={`h-4 w-4 ${accent ?? "text-violet-400"}`} />
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</CardTitle>
          </div>
          {link && (
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

function Row({ title, sub, badge, link, color }: {
  title: string; sub?: string; badge?: string; link?: string; color?: string;
}) {
  const inner = (
    <div className="flex items-center gap-2 py-1.5 rounded hover:bg-muted/30 -mx-1 px-1 transition-colors cursor-pointer">
      <div className={`h-2 w-2 rounded-full shrink-0 ${color ?? "bg-violet-400"}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{title}</p>
        {sub && <p className="text-xs text-muted-foreground truncate">{sub}</p>}
      </div>
      {badge && <Badge variant="outline" className="text-[10px] shrink-0">{badge}</Badge>}
    </div>
  );
  return link ? <Link href={link}>{inner}</Link> : inner;
}

export function CEOCommandCenter({ visible, compact }: { visible: Record<string, boolean>; compact?: boolean }) {
  const kpis = useQuery<any>({ queryKey: ["/api/executive/kpis"] });
  const risks = useQuery<any>({ queryKey: ["/api/executive/risk-alerts"] });
  const forecast = useQuery<any>({ queryKey: ["/api/pipeline/forecast"] });
  const csDash = useQuery<any>({ queryKey: ["/api/cs/dashboard"] });
  const certSummary = useQuery<any>({ queryKey: ["/api/projects/cert-summary"] });
  const deployDash = useQuery<any>({ queryKey: ["/api/deployments/dashboard"] });

  const isLoading = kpis.isLoading || forecast.isLoading;
  const kd = kpis.data;
  const fd = forecast.data;
  const cd = csDash.data;
  const cert = certSummary.data;
  const deploy = deployDash.data;
  // risk-alerts returns { stalledOpps, overdueTasks, installBlockers, awaitingQuotes, unownedLeads, ... }
  const rd = risks.data;
  const riskAlerts: any[] = [
    ...(rd?.stalledOpps ?? []).map((o: any) => ({
      id: `opp-${o.id}`, objectName: o.title ?? o.account_name, reason: `Stalled ${o.days_stale ?? "?"}d — ${o.stage}`,
      severity: rd?.severity?.stalledOpps ?? "medium", deepLink: `/pipeline`,
    })),
    ...(rd?.overdueTasks ?? []).slice(0, 3).map((t: any) => ({
      id: `task-${t.id}`, objectName: t.title, reason: `${Math.round(t.days_overdue ?? 0)}d overdue`,
      severity: rd?.severity?.overdueTasks ?? "medium", deepLink: `/execution/tasks`,
    })),
    ...(rd?.installBlockers ?? []).map((i: any) => ({
      id: `install-${i.id}`, objectName: i.account_name ?? i.title, reason: i.blocker,
      severity: rd?.severity?.installBlockers ?? "medium", deepLink: `/install-workflows`,
    })),
  ].slice(0, 8);

  // Normalise KPI fields from the nested executive/kpis response
  const totalOpps = kd?.pipeline?.totalOpps?.current ?? 0;
  const winRate = kd?.quotes?.winRate?.current ?? null;
  const overdueInstalls = kd?.installs?.overdueInstalls ?? 0;
  const overdueTaskCount = kd?.risks?.overdueTaskCount ?? 0;

  // Normalise forecast fields from pipeline/forecast response
  const totalPipeline = fd ? (fd.summary?.commit ?? 0) + (fd.summary?.best_case ?? 0) + (fd.summary?.pipeline ?? 0) : 0;
  const weightedForecast = fd?.summary?.totalWeighted ?? 0;
  const periods: any[] = fd?.periods ?? [];

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2" data-testid="ceo-center-loading">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-40 rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="ceo-command-center">

      {visible.summary_bullets && (
        <WidgetCard title="Executive Snapshot" icon={Zap} accent="text-violet-400" compact={compact}>
          <div className="space-y-2 mt-1">
            <div className="flex items-center gap-3">
              <div className="text-center">
                <p className="text-xl font-bold text-violet-400">{weightedForecast > 0 ? fmt$(weightedForecast) : "—"}</p>
                <p className="text-[10px] text-muted-foreground uppercase">Wtd Forecast</p>
              </div>
              <div className="h-8 w-px bg-border/50" />
              <div className="text-center">
                <p className="text-xl font-bold text-emerald-400">{winRate != null ? `${winRate}%` : "—"}</p>
                <p className="text-[10px] text-muted-foreground uppercase">Win Rate</p>
              </div>
              <div className="h-8 w-px bg-border/50" />
              <div className="text-center">
                <p className="text-xl font-bold text-amber-400">{totalOpps > 0 ? totalOpps : "—"}</p>
                <p className="text-[10px] text-muted-foreground uppercase">Open Opps</p>
              </div>
            </div>
            {overdueInstalls > 0 && (
              <p className="text-xs text-red-400 font-medium flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> {overdueInstalls} overdue installs need escalation
              </p>
            )}
            {cd?.renewalsThisMonth > 0 && (
              <p className="text-xs text-amber-400 font-medium">⚠ {cd.renewalsThisMonth} renewals this month — verify coverage</p>
            )}
            {riskAlerts.length > 0 && (
              <p className="text-xs text-orange-400 font-medium">⚡ {riskAlerts.length} active risk signal{riskAlerts.length > 1 ? "s" : ""} detected</p>
            )}
            {overdueTaskCount > 0 && (
              <p className="text-xs text-red-400 font-medium">📋 {overdueTaskCount} overdue tasks across the team</p>
            )}
          </div>
        </WidgetCard>
      )}

      {visible.pipeline_health && (
        <WidgetCard title="Pipeline Health" icon={TrendingUp} accent="text-violet-400" link="/pipeline" compact={compact}>
          <div className="space-y-1 mt-1">
            {periods.length > 0 ? periods.slice(0, 4).map((p: any) => (
              <div key={p.month} className="flex items-center gap-2">
                <div className="flex-1 text-xs truncate text-muted-foreground">{p.label}</div>
                <div className="text-xs font-semibold w-12 text-right">
                  {(p.commit?.count ?? 0) + (p.best_case?.count ?? 0) + (p.pipeline?.count ?? 0)}
                </div>
                <div className="text-xs text-muted-foreground w-14 text-right">
                  {fmt$(p.totalWeighted ?? 0)}
                </div>
              </div>
            )) : (
              <p className="text-sm text-muted-foreground">No pipeline data</p>
            )}
            <div className="mt-2 pt-2 border-t border-border/30 flex gap-4">
              <div><p className="text-[10px] text-muted-foreground uppercase">Total Pipe</p>
                <p className="text-sm font-bold">{fmt$(totalPipeline)}</p></div>
              <div><p className="text-[10px] text-muted-foreground uppercase">Wtd Forecast</p>
                <p className="text-sm font-bold">{fmt$(weightedForecast)}</p></div>
            </div>
          </div>
        </WidgetCard>
      )}

      {visible.revenue_at_risk && (
        <WidgetCard title="Revenue at Risk" icon={DollarSign} accent="text-red-400" link="/renewals" compact={compact}>
          <div className="space-y-1.5 mt-1">
            {cd?.overview ? (
              <>
                <Row title="Renewals due" badge={String(cd.overview.renewalDue ?? 0)} color="bg-amber-400" />
                <Row title="Churn risk accounts" badge={String(cd.overview.churnRisk ?? cd.atRisk?.length ?? 0)} color="bg-red-400" link="/renewals" />
                <Row title="Active contracts" badge={String(cd.overview.active ?? 0)} color="bg-blue-400" />
                {cd.overview.totalArr > 0 && (
                  <div className="mt-2 pt-2 border-t border-border/30">
                    <p className="text-xs text-muted-foreground">Total ARR under management</p>
                    <p className="text-base font-bold text-emerald-400">{fmt$(cd.overview.totalArr)}</p>
                  </div>
                )}
              </>
            ) : <p className="text-sm text-muted-foreground">No CS data</p>}
          </div>
        </WidgetCard>
      )}

      {visible.cert_blockers && (
        <WidgetCard title="Certification Blockers" icon={ShieldAlert} accent="text-amber-400" link="/execution/projects" compact={compact}>
          <div className="space-y-1.5 mt-1">
            {cert != null ? (
              <>
                {cert.blocked > 0
                  ? <Row title={`${cert.blocked} cert${cert.blocked > 1 ? "s" : ""} blocked`} color="bg-red-400" link="/execution/projects" />
                  : <p className="text-xs text-emerald-400">✓ No cert blockers</p>
                }
                {cert.at_risk > 0 && <Row title={`${cert.at_risk} cert${cert.at_risk > 1 ? "s" : ""} at risk`} color="bg-amber-400" />}
                {cert.failure_open > 0 && <Row title={`${cert.failure_open} cert failure${cert.failure_open > 1 ? "s" : ""} open`} badge="urgent" color="bg-red-400" link="/execution/projects" />}
                {cert.cert_expiring_90d > 0 && <Row title={`${cert.cert_expiring_90d} cert${cert.cert_expiring_90d > 1 ? "s" : ""} expiring in 90d`} color="bg-amber-400" />}
                {cert.certified > 0 && <Row title={`${cert.certified} certified`} color="bg-emerald-400" />}
              </>
            ) : <p className="text-sm text-muted-foreground">No cert data</p>}
          </div>
        </WidgetCard>
      )}

      {visible.deployment_blockers && (
        <WidgetCard title="Deployment Blockers" icon={Truck} accent="text-orange-400" link="/deployments" compact={compact}>
          <div className="space-y-1.5 mt-1">
            {deploy?.overview != null ? (
              <>
                {deploy.overview.blocked > 0 || (deploy.blockedDeployments?.length ?? 0) > 0
                  ? <Row title={`${deploy.blockedDeployments?.length ?? deploy.overview.blocked} site${(deploy.blockedDeployments?.length ?? deploy.overview.blocked) > 1 ? "s" : ""} blocked`} badge="blocked" color="bg-red-400" link="/deployments" />
                  : <p className="text-xs text-emerald-400">✓ No blocked sites</p>}
                {deploy.overview.commissioning > 0 && <Row title={`${deploy.overview.commissioning} in commissioning`} color="bg-blue-400" link="/deployments" />}
                {deploy.overview.liveThisMonth > 0 && <Row title={`${deploy.overview.liveThisMonth} went live this month`} color="bg-emerald-400" />}
                {deploy.overview.overdue > 0 && (
                  <Row title={`${deploy.overview.overdue} deployment${deploy.overview.overdue > 1 ? "s" : ""} overdue`} badge="urgent" color="bg-red-400" link="/deployments" />
                )}
              </>
            ) : <p className="text-sm text-muted-foreground">No deployment data</p>}
          </div>
        </WidgetCard>
      )}

      {visible.key_accounts && (
        <WidgetCard title="Key Accounts Needing Action" icon={Building2} accent="text-violet-400" link="/accounts" compact={compact}>
          <div className="space-y-0 mt-1">
            {riskAlerts.length > 0 ? riskAlerts.slice(0, 5).map((a: any) => (
              <Row
                key={a.id}
                title={a.objectName ?? a.title ?? "Account"}
                sub={a.reason}
                badge={a.severity}
                link={a.deepLink ?? "/accounts"}
                color={a.severity === "high" ? "bg-red-400" : a.severity === "medium" ? "bg-amber-400" : "bg-blue-400"}
              />
            )) : <p className="text-xs text-muted-foreground">No flagged accounts right now.</p>}
          </div>
        </WidgetCard>
      )}
    </div>
  );
}
