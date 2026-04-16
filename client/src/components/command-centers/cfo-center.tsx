import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DollarSign, TrendingUp, AlertTriangle, Lock, RefreshCw,
  ChevronRight, BarChart3, Cpu,
} from "lucide-react";

function fmt$(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function WidgetCard({ title, icon: Icon, children, link, compact }: {
  title: string; icon: React.ElementType; children: React.ReactNode; link?: string; compact?: boolean;
}) {
  return (
    <Card className="border border-border/50 bg-card/80" data-testid={`widget-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardHeader className={`${compact ? "pb-1 pt-3 px-4" : "pb-2 pt-4 px-4"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-emerald-400" />
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

function KpiRow({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
      <p className={`text-base font-bold ${color ?? "text-emerald-400"}`}>{value}</p>
    </div>
  );
}

export function CFOCommandCenter({ visible, compact }: { visible: Record<string, boolean>; compact?: boolean }) {
  const revDash = useQuery<any>({ queryKey: ["/api/revenue/dashboard"] });
  const csDash  = useQuery<any>({ queryKey: ["/api/cs/dashboard"] });
  const forecast = useQuery<any>({ queryKey: ["/api/pipeline/forecast"] });
  const kpis    = useQuery<any>({ queryKey: ["/api/executive/kpis"] });

  if (revDash.isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2" data-testid="cfo-center-loading">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-40 rounded-xl" />)}
      </div>
    );
  }

  const rd = revDash.data;
  const cd = csDash.data;
  const fd = forecast.data;
  const kd = kpis.data;

  // Normalise forecast fields
  const totalPipeline = fd ? (fd.summary?.commit ?? 0) + (fd.summary?.best_case ?? 0) + (fd.summary?.pipeline ?? 0) : 0;
  const weightedForecast = fd?.summary?.totalWeighted ?? 0;
  const winRate = kd?.quotes?.winRate?.current ?? null;

  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="cfo-command-center">

      {visible.mrr_overview && (
        <WidgetCard title="MRR Overview" icon={DollarSign} link="/revenue" compact={compact}>
          {rd ? (
            <div className="space-y-0.5 mt-1 divide-y divide-border/30">
              <KpiRow label="Current MRR" value={fmt$(rd.mrr?.current ?? 0)} color="text-emerald-400" />
              <KpiRow label="Contracted MRR" value={fmt$(rd.mrr?.contracted ?? 0)} color="text-violet-400"
                sub="All active billing lines" />
              <KpiRow label="Software-Only MRR" value={fmt$(rd.mrr?.softwareOnly ?? 0)} color="text-blue-400" />
              <KpiRow label="Accounts w/ Billing" value={String(rd.mrr?.accountsWithBilling ?? 0)} color="text-foreground" />
            </div>
          ) : <p className="text-sm text-muted-foreground mt-1">No revenue data</p>}
        </WidgetCard>
      )}

      {visible.hardware_revenue && (
        <WidgetCard title="Hardware Revenue" icon={BarChart3} link="/revenue" compact={compact}>
          {rd ? (
            <div className="space-y-0.5 mt-1 divide-y divide-border/30">
              <KpiRow label="Contracted" value={fmt$(rd.hardware?.contracted ?? 0)} color="text-violet-400" />
              <KpiRow label="Booked" value={fmt$(rd.hardware?.booked ?? 0)} color="text-blue-400" />
              <KpiRow label="Delivered" value={fmt$(rd.hardware?.delivered ?? 0)} color="text-emerald-400" />
              <KpiRow label="Remaining" value={fmt$(rd.hardware?.remaining ?? 0)} color="text-amber-400"
                sub="Contracted minus delivered" />
            </div>
          ) : <p className="text-sm text-muted-foreground mt-1">No hardware data</p>}
        </WidgetCard>
      )}

      {visible.pricing_lock_expiries && (
        <WidgetCard title="Pricing Lock Expiries" icon={Lock} link="/revenue" compact={compact}>
          <div className="space-y-1.5 mt-1">
            {rd?.pricingLockExpiries && rd.pricingLockExpiries.length > 0 ? (
              rd.pricingLockExpiries.slice(0, 5).map((a: any, i: number) => (
                <div key={i} className="flex items-center justify-between py-1">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{a.name}</p>
                    <p className="text-xs text-muted-foreground">{a.pricingLockExpiry}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0 ml-2 text-amber-400 border-amber-500/30">
                    {a.daysUntilExpiry != null ? `${a.daysUntilExpiry}d` : "—"}
                  </Badge>
                </div>
              ))
            ) : (
              <p className="text-xs text-emerald-400 mt-1">✓ No pricing locks expiring soon</p>
            )}
          </div>
        </WidgetCard>
      )}

      {visible.renewal_exposure && (
        <WidgetCard title="Renewal Exposure" icon={RefreshCw} link="/renewals" compact={compact}>
          {cd?.overview ? (
            <div className="space-y-0.5 mt-1 divide-y divide-border/30">
              <KpiRow label="Renewals due" value={String(cd.overview.renewalDue ?? 0)} color="text-amber-400" />
              <KpiRow label="Churn risk" value={String(cd.overview.churnRisk ?? cd.atRisk?.length ?? 0)} color="text-red-400" />
              <KpiRow label="Active contracts" value={String(cd.overview.active ?? 0)} color="text-blue-400" />
              {cd.overview.totalArr > 0 && (
                <KpiRow label="Total ARR managed" value={fmt$(cd.overview.totalArr)} color="text-emerald-400" />
              )}
            </div>
          ) : <p className="text-sm text-muted-foreground mt-1">No CS data</p>}
        </WidgetCard>
      )}

      {visible.billing_anomalies && (
        <WidgetCard title="Billing Anomalies" icon={AlertTriangle} link="/revenue" compact={compact}>
          <div className="space-y-1.5 mt-1">
            {rd?.billingAnomalies && rd.billingAnomalies.length > 0 ? (
              rd.billingAnomalies.slice(0, 4).map((a: any, i: number) => (
                <div key={i} className="flex items-center gap-2 py-1">
                  <div className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{a.accountName}</p>
                    <p className="text-xs text-muted-foreground">{a.issue}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-emerald-400 mt-1">✓ No billing anomalies detected</p>
            )}
          </div>
        </WidgetCard>
      )}

      {visible.forecast_pressure && (
        <WidgetCard title="Forecast Pressure" icon={TrendingUp} link="/pipeline" compact={compact}>
          {fd ? (
            <div className="space-y-0.5 mt-1 divide-y divide-border/30">
              <KpiRow label="Weighted Forecast" value={fmt$(weightedForecast)} color="text-violet-400" />
              <KpiRow label="Total Pipeline" value={fmt$(totalPipeline)} color="text-blue-400" />
              <KpiRow label="Committed" value={fmt$(fd.summary?.commit ?? 0)} color="text-foreground" />
              {winRate != null && (
                <KpiRow label="Win Rate" value={`${winRate}%`} color={winRate >= 40 ? "text-emerald-400" : "text-red-400"} />
              )}
            </div>
          ) : <p className="text-sm text-muted-foreground mt-1">No forecast data</p>}
        </WidgetCard>
      )}
    </div>
  );
}
