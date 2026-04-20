import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckSquare, Package, ChevronRight, Cpu, AlertOctagon } from "lucide-react";
import { useCommandCenterWidgets } from "@/hooks/use-scores";
import { ScoreListWidget } from "@/components/scores/score-widget";

function WidgetCard({ title, icon: Icon, children, link, compact }: {
  title: string; icon: React.ElementType; children: React.ReactNode; link?: string; compact?: boolean;
}) {
  return (
    <Card className="border border-border/50 bg-card/80" data-testid={`widget-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardHeader className={`${compact ? "pb-1 pt-3 px-4" : "pb-2 pt-4 px-4"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-blue-400" />
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

function BlockerRow({ title, sub, severity, link }: {
  title: string; sub?: string; severity?: string; link?: string;
}) {
  const color = severity === "high" ? "bg-red-400" : severity === "medium" ? "bg-amber-400" : "bg-blue-400";
  const inner = (
    <div className="flex items-start gap-2 py-1.5 rounded hover:bg-muted/30 -mx-1 px-1 transition-colors">
      <div className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${color}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{title}</p>
        {sub && <p className="text-xs text-muted-foreground truncate">{sub}</p>}
      </div>
    </div>
  );
  return link ? <Link href={link}>{inner}</Link> : inner;
}

// NOTE: cert_blockers and deployment_blockers have been migrated into the draggable
// DashboardGrid via ACTION_WIDGET_MAP — see client/src/components/widgets/role-cards/.
export function CTOCommandCenter({ visible, compact }: { visible: Record<string, boolean>; compact?: boolean }) {
  const dailyCC = useQuery<any>({ queryKey: ["/api/daily-command-center"] });
  const kpis    = useQuery<any>({ queryKey: ["/api/executive/kpis"] });
  const { widgets, isLoading: widgetsLoading } = useCommandCenterWidgets(visible.deployment_risk_score);

  if (kpis.isLoading && dailyCC.isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2" data-testid="cto-center-loading">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-40 rounded-xl" />)}
      </div>
    );
  }

  const cc = dailyCC.data;
  const kd = kpis.data;
  const overdueTasks: any[] = cc?.sections?.overdueTasks?.items ?? [];
  const criticalTasks = overdueTasks.filter((t: any) => t.priority === "high" || t.severity === "high");

  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="cto-command-center">

      {/* cert_blockers and deployment_blockers migrated to draggable grid (ACTION_WIDGET_MAP) */}

      {visible.install_workflows && (
        <WidgetCard title="Install Workflows at Risk" icon={Cpu} link="/install-workflows" compact={compact}>
          <div className="space-y-0 mt-1">
            {kd?.installs != null ? (
              <>
                {kd.installs.overdueInstalls > 0
                  ? <BlockerRow title={`${kd.installs.overdueInstalls} install${kd.installs.overdueInstalls > 1 ? "s" : ""} overdue`}
                      severity="high" link="/install-workflows" />
                  : <p className="text-xs text-emerald-400 py-1">✓ All installs on schedule</p>
                }
                {kd.installs.pendingKickoff > 0 && (
                  <BlockerRow title={`${kd.installs.pendingKickoff} install${kd.installs.pendingKickoff > 1 ? "s" : ""} pending kickoff`}
                    severity="medium" />
                )}
                {kd.installs.withBlockers > 0 && (
                  <BlockerRow title={`${kd.installs.withBlockers} install${kd.installs.withBlockers > 1 ? "s" : ""} have blockers`}
                    sub="Action required to unblock" severity="high" link="/install-workflows" />
                )}
              </>
            ) : <p className="text-sm text-muted-foreground">No install workflow data</p>}
          </div>
        </WidgetCard>
      )}

      {visible.procurement_blocked && (
        <WidgetCard title="Procurement Blocked" icon={Package} link="/procurement" compact={compact}>
          <div className="mt-1">
            {kd?.installs?.pendingKickoff > 0 ? (
              <BlockerRow title={`${kd.installs.pendingKickoff} install${kd.installs.pendingKickoff > 1 ? "s" : ""} pending kickoff`}
                severity="medium" link="/procurement" />
            ) : (
              <p className="text-xs text-emerald-400 py-1">✓ No procurement blockers</p>
            )}
          </div>
        </WidgetCard>
      )}

      {visible.deployment_risk_score && (
        <ScoreListWidget
          title="Deployment Delay Risk"
          icon={AlertOctagon}
          items={widgets?.deploymentRisks ?? []}
          objectType="deployment"
          accentColor="text-blue-400"
          link="/deployments"
          compact={compact}
          isLoading={widgetsLoading}
          emptyMessage="No active deployments to score"
        />
      )}

      {visible.critical_tasks && (
        <WidgetCard title="Critical Tasks" icon={CheckSquare} link="/execution/tasks" compact={compact}>
          <div className="space-y-0 mt-1">
            {criticalTasks.length > 0 ? criticalTasks.slice(0, 5).map((t: any) => (
              <BlockerRow
                key={t.id}
                title={t.title}
                sub={t.linked_object_name ? `${t.linked_object_type}: ${t.linked_object_name}` : `${Math.round(t.days_overdue)}d overdue`}
                severity={t.severity}
                link={t.deepLink ?? "/execution/tasks"}
              />
            )) : (
              <p className="text-xs text-emerald-400 py-1">✓ No critical overdue tasks</p>
            )}
          </div>
        </WidgetCard>
      )}
    </div>
  );
}
