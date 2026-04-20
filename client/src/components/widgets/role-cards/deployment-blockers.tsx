import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Truck } from "lucide-react";
import { RoleWidgetCard, RoleRow } from "./role-card-helpers";

export function DeploymentBlockersWidget({ compact }: { compact?: boolean } = {}) {
  const deployDash = useQuery<any>({ queryKey: ["/api/deployments/dashboard"] });

  if (deployDash.isLoading) {
    return (
      <RoleWidgetCard title="Deployment Blockers" icon={Truck} accent="text-orange-400" link="/deployments" compact={compact}>
        <Skeleton className="h-24 w-full" />
      </RoleWidgetCard>
    );
  }

  const deploy = deployDash.data;

  return (
    <RoleWidgetCard title="Deployment Blockers" icon={Truck} accent="text-orange-400" link="/deployments" compact={compact}>
      <div className="space-y-1.5 mt-1">
        {deploy?.overview != null ? (
          <>
            {deploy.overview.blocked > 0 || (deploy.blockedDeployments?.length ?? 0) > 0
              ? <RoleRow title={`${deploy.blockedDeployments?.length ?? deploy.overview.blocked} site${(deploy.blockedDeployments?.length ?? deploy.overview.blocked) > 1 ? "s" : ""} blocked`} badge="blocked" color="bg-red-400" link="/deployments" />
              : <p className="text-xs text-emerald-400">✓ No blocked sites</p>}
            {deploy.overview.commissioning > 0 && <RoleRow title={`${deploy.overview.commissioning} in commissioning`} color="bg-blue-400" link="/deployments" />}
            {deploy.overview.liveThisMonth > 0 && <RoleRow title={`${deploy.overview.liveThisMonth} went live this month`} color="bg-emerald-400" />}
            {deploy.overview.overdue > 0 && (
              <RoleRow title={`${deploy.overview.overdue} deployment${deploy.overview.overdue > 1 ? "s" : ""} overdue`} badge="urgent" color="bg-red-400" link="/deployments" />
            )}
          </>
        ) : <p className="text-sm text-muted-foreground">No deployment data</p>}
      </div>
    </RoleWidgetCard>
  );
}
