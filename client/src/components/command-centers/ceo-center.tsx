import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronRight, DollarSign, UserX } from "lucide-react";
import type { LayoutMode } from "@/lib/dashboard-config";
import { useCommandCenterWidgets } from "@/hooks/use-scores";
import { ScoreListWidget } from "@/components/scores/score-widget";

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

function Row({ title, badge, link, color }: {
  title: string; badge?: string; link?: string; color?: string;
}) {
  const inner = (
    <div className="flex items-center gap-2 py-1.5 rounded hover:bg-muted/30 -mx-1 px-1 transition-colors cursor-pointer">
      <div className={`h-2 w-2 rounded-full shrink-0 ${color ?? "bg-violet-400"}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{title}</p>
      </div>
      {badge && <Badge variant="outline" className="text-[10px] shrink-0">{badge}</Badge>}
    </div>
  );
  return link ? <Link href={link}>{inner}</Link> : inner;
}

// NOTE: summary_bullets, pipeline_health, cert_blockers, deployment_blockers,
// close_opps_score and key_accounts have been migrated into the draggable
// DashboardGrid via ACTION_WIDGET_MAP — see client/src/components/widgets/role-cards/.
// Only revenue_at_risk and churn_score still render statically here.
export function CEOCommandCenter({ visible, compact }: { visible: Record<string, boolean>; compact?: boolean }) {
  const csDash = useQuery<any>({ queryKey: ["/api/cs/dashboard"] });
  const { widgets, isLoading: widgetsLoading } = useCommandCenterWidgets(visible.churn_score);

  const cd = csDash.data;

  if (csDash.isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2" data-testid="ceo-center-loading">
        {[1, 2].map(i => <Skeleton key={i} className="h-40 rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="ceo-command-center">
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

      {visible.churn_score && (
        <ScoreListWidget
          title="Churn Risk Signals"
          icon={UserX}
          items={widgets?.churnRisks ?? []}
          objectType="account"
          accentColor="text-red-400"
          link="/renewals"
          compact={compact}
          isLoading={widgetsLoading}
          emptyMessage="No churn risk signals"
        />
      )}
    </div>
  );
}
