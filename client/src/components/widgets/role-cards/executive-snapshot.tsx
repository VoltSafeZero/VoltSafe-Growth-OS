import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Zap, AlertTriangle } from "lucide-react";
import { RoleWidgetCard, fmt$ } from "./role-card-helpers";

export function ExecutiveSnapshotWidget({ compact }: { compact?: boolean } = {}) {
  const kpis = useQuery<any>({ queryKey: ["/api/executive/kpis"] });
  const risks = useQuery<any>({ queryKey: ["/api/executive/risk-alerts"] });
  const forecast = useQuery<any>({ queryKey: ["/api/pipeline/forecast"] });
  const csDash = useQuery<any>({ queryKey: ["/api/cs/dashboard"] });

  if (kpis.isLoading || forecast.isLoading) {
    return (
      <RoleWidgetCard title="Executive Snapshot" icon={Zap} accent="text-violet-400" compact={compact}>
        <Skeleton className="h-24 w-full" />
      </RoleWidgetCard>
    );
  }

  const kd = kpis.data;
  const fd = forecast.data;
  const cd = csDash.data;
  const rd = risks.data;

  const totalOpps = kd?.pipeline?.totalOpps?.current ?? 0;
  const winRate = kd?.quotes?.winRate?.current ?? null;
  const overdueInstalls = kd?.installs?.overdueInstalls ?? 0;
  const overdueTaskCount = kd?.risks?.overdueTaskCount ?? 0;
  const weightedForecast = fd?.summary?.totalWeighted ?? 0;

  const riskAlertCount =
    (rd?.stalledOpps?.length ?? 0) +
    Math.min(rd?.overdueTasks?.length ?? 0, 3) +
    (rd?.installBlockers?.length ?? 0);

  return (
    <RoleWidgetCard title="Executive Snapshot" icon={Zap} accent="text-violet-400" compact={compact}>
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
        {riskAlertCount > 0 && (
          <p className="text-xs text-orange-400 font-medium">
            ⚡ {riskAlertCount} active risk signal{riskAlertCount > 1 ? "s" : ""} detected
          </p>
        )}
        {overdueTaskCount > 0 && (
          <p className="text-xs text-red-400 font-medium">📋 {overdueTaskCount} overdue tasks across the team</p>
        )}
      </div>
    </RoleWidgetCard>
  );
}
