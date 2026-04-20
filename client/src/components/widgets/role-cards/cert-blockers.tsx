import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldAlert } from "lucide-react";
import { RoleWidgetCard, RoleRow } from "./role-card-helpers";

export function CertBlockersWidget({ compact }: { compact?: boolean } = {}) {
  const certSummary = useQuery<any>({ queryKey: ["/api/projects/cert-summary"] });

  if (certSummary.isLoading) {
    return (
      <RoleWidgetCard title="Certification Blockers" icon={ShieldAlert} accent="text-amber-400" link="/execution/projects" compact={compact}>
        <Skeleton className="h-24 w-full" />
      </RoleWidgetCard>
    );
  }

  const cert = certSummary.data;

  return (
    <RoleWidgetCard title="Certification Blockers" icon={ShieldAlert} accent="text-amber-400" link="/execution/projects" compact={compact}>
      <div className="space-y-1.5 mt-1">
        {cert != null ? (
          <>
            {cert.blocked > 0
              ? <RoleRow title={`${cert.blocked} cert${cert.blocked > 1 ? "s" : ""} blocked`} color="bg-red-400" link="/execution/projects" />
              : <p className="text-xs text-emerald-400">✓ No cert blockers</p>
            }
            {cert.at_risk > 0 && <RoleRow title={`${cert.at_risk} cert${cert.at_risk > 1 ? "s" : ""} at risk`} color="bg-amber-400" />}
            {cert.failure_open > 0 && <RoleRow title={`${cert.failure_open} cert failure${cert.failure_open > 1 ? "s" : ""} open`} badge="urgent" color="bg-red-400" link="/execution/projects" />}
            {cert.cert_expiring_90d > 0 && <RoleRow title={`${cert.cert_expiring_90d} cert${cert.cert_expiring_90d > 1 ? "s" : ""} expiring in 90d`} color="bg-amber-400" />}
            {cert.certified > 0 && <RoleRow title={`${cert.certified} certified`} color="bg-emerald-400" />}
          </>
        ) : <p className="text-sm text-muted-foreground">No cert data</p>}
      </div>
    </RoleWidgetCard>
  );
}
