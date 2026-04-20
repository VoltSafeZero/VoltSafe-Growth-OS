import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp } from "lucide-react";
import { RoleWidgetCard, fmt$ } from "./role-card-helpers";

export function PipelineHealthWidget({ compact }: { compact?: boolean } = {}) {
  const forecast = useQuery<any>({ queryKey: ["/api/pipeline/forecast"] });

  if (forecast.isLoading) {
    return (
      <RoleWidgetCard title="Pipeline Health" icon={TrendingUp} accent="text-violet-400" link="/pipeline" compact={compact}>
        <Skeleton className="h-24 w-full" />
      </RoleWidgetCard>
    );
  }

  const fd = forecast.data;
  const periods: any[] = fd?.periods ?? [];
  const totalPipeline = fd ? (fd.summary?.commit ?? 0) + (fd.summary?.best_case ?? 0) + (fd.summary?.pipeline ?? 0) : 0;
  const weightedForecast = fd?.summary?.totalWeighted ?? 0;

  return (
    <RoleWidgetCard title="Pipeline Health" icon={TrendingUp} accent="text-violet-400" link="/pipeline" compact={compact}>
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
          <div>
            <p className="text-[10px] text-muted-foreground uppercase">Total Pipe</p>
            <p className="text-sm font-bold">{fmt$(totalPipeline)}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase">Wtd Forecast</p>
            <p className="text-sm font-bold">{fmt$(weightedForecast)}</p>
          </div>
        </div>
      </div>
    </RoleWidgetCard>
  );
}
