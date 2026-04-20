import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2 } from "lucide-react";
import { RoleWidgetCard, RoleRow } from "./role-card-helpers";

export function KeyAccountsActionWidget({ compact }: { compact?: boolean } = {}) {
  const risks = useQuery<any>({ queryKey: ["/api/executive/risk-alerts"] });

  if (risks.isLoading) {
    return (
      <RoleWidgetCard title="Key Accounts Needing Action" icon={Building2} accent="text-violet-400" link="/accounts" compact={compact}>
        <Skeleton className="h-24 w-full" />
      </RoleWidgetCard>
    );
  }

  const rd = risks.data;
  const riskAlerts: any[] = [
    ...(rd?.stalledOpps ?? []).map((o: any) => ({
      id: `opp-${o.id}`, objectName: o.title ?? o.account_name,
      reason: `Stalled ${o.days_stale ?? "?"}d — ${o.stage}`,
      severity: rd?.severity?.stalledOpps ?? "medium", deepLink: "/pipeline",
    })),
    ...(rd?.overdueTasks ?? []).slice(0, 3).map((t: any) => ({
      id: `task-${t.id}`, objectName: t.title,
      reason: `${Math.round(t.days_overdue ?? 0)}d overdue`,
      severity: rd?.severity?.overdueTasks ?? "medium", deepLink: "/execution/tasks",
    })),
    ...(rd?.installBlockers ?? []).map((i: any) => ({
      id: `install-${i.id}`, objectName: i.account_name ?? i.title,
      reason: i.blocker,
      severity: rd?.severity?.installBlockers ?? "medium", deepLink: "/install-workflows",
    })),
  ].slice(0, 8);

  return (
    <RoleWidgetCard title="Key Accounts Needing Action" icon={Building2} accent="text-violet-400" link="/accounts" compact={compact}>
      <div className="space-y-0 mt-1">
        {riskAlerts.length > 0 ? riskAlerts.slice(0, 5).map((a: any) => (
          <RoleRow
            key={a.id}
            title={a.objectName ?? "Account"}
            sub={a.reason}
            badge={a.severity}
            link={a.deepLink ?? "/accounts"}
            color={a.severity === "high" ? "bg-red-400" : a.severity === "medium" ? "bg-amber-400" : "bg-blue-400"}
          />
        )) : <p className="text-xs text-muted-foreground">No flagged accounts right now.</p>}
      </div>
    </RoleWidgetCard>
  );
}
