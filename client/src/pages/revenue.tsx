import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DollarSign, Zap, Anchor, TrendingUp, Package, AlertTriangle,
  BarChart2, ChevronRight, RefreshCw, LayoutGrid, ArrowUpRight,
} from "lucide-react";

type RevenueDashboard = {
  generatedAt: string;
  mrr: {
    current: number;
    contracted: number;
    softwareOnly: number;
    accountsWithBilling: number;
  };
  hardware: {
    contracted: number;
    booked: number;
    delivered: number;
    remaining: number;
    accountsWithContracts: number;
  };
  slips: {
    total: number;
    voltsafeLive: number;
    softwareOnly: number;
    futureUpgrade: number;
  };
  rolloutPhases: Record<string, number>;
  topExpansionAccounts: {
    id: number;
    name: string;
    futureUpgradeSlips: number;
    contractedUnits: number;
    installedUnits: number;
    remainingUnits: number;
    currentMrr: number;
  }[];
};

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtNum(n: number) {
  return n.toLocaleString();
}

function KpiCard({ title, value, sub, icon: Icon, color = "text-primary", trend }: {
  title: string; value: string; sub?: string; icon: React.ElementType; color?: string; trend?: string;
}) {
  return (
    <Card className="border-border/50" data-testid={`kpi-card-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium">{title}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className={`w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0`}>
            <Icon className={`h-4 w-4 ${color}`} />
          </div>
        </div>
        {trend && <p className="text-xs text-emerald-400 mt-2">{trend}</p>}
      </CardContent>
    </Card>
  );
}

const PHASE_COLOR: Record<string, string> = {
  planned: "bg-slate-500/15 text-slate-400",
  in_progress: "bg-blue-500/15 text-blue-400",
  complete: "bg-emerald-500/15 text-emerald-400",
  blocked: "bg-red-500/15 text-red-400",
  cancelled: "bg-zinc-500/15 text-zinc-500",
};

export default function RevenuePage() {
  const [view, setView] = useState<"overview" | "accounts">("overview");

  const { data, isLoading, isError, refetch } = useQuery<RevenueDashboard>({
    queryKey: ["/api/revenue/dashboard"],
  });

  if (isLoading) return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <Skeleton className="h-8 w-56" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-28" />)}
      </div>
    </div>
  );

  if (isError || !data) return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[40vh] gap-4">
      <AlertTriangle className="h-8 w-8 text-amber-400" />
      <p className="text-sm text-muted-foreground">Could not load revenue dashboard.</p>
      <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
        <RefreshCw className="h-3.5 w-3.5" /> Retry
      </Button>
    </div>
  );

  const { mrr, hardware, slips, rolloutPhases, topExpansionAccounts } = data;
  const totalPhases = Object.values(rolloutPhases).reduce((s, n) => s + n, 0);
  const completePhases = rolloutPhases["complete"] ?? 0;
  const blockedPhases = rolloutPhases["blocked"] ?? 0;
  const inProgressPhases = rolloutPhases["in_progress"] ?? 0;
  const mrrGap = mrr.contracted - mrr.current;
  const deliveryPct = hardware.contracted > 0
    ? Math.round((hardware.delivered / hardware.contracted) * 100)
    : null;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6" data-testid="revenue-hub-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" data-testid="heading-revenue-hub">Revenue Hub</h1>
          <p className="text-sm text-muted-foreground">Phased rollout, SaaS billing, and hardware contract tracking</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={view === "overview" ? "default" : "outline"} size="sm"
            onClick={() => setView("overview")} className="gap-1.5" data-testid="button-overview-view">
            <BarChart2 className="h-3.5 w-3.5" /> Overview
          </Button>
          <Button variant={view === "accounts" ? "default" : "outline"} size="sm"
            onClick={() => setView("accounts")} className="gap-1.5" data-testid="button-accounts-view">
            <LayoutGrid className="h-3.5 w-3.5" /> Expansion Accounts
          </Button>
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {view === "overview" && (
        <>
          {/* MRR Section */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">SaaS MRR</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiCard title="Current MRR" value={fmt(mrr.current)} sub={`${mrr.accountsWithBilling} billing accounts`}
                icon={DollarSign} color="text-emerald-400" />
              <KpiCard title="Contracted MRR" value={fmt(mrr.contracted)} sub="All active lines"
                icon={TrendingUp} />
              <KpiCard title="MRR Gap" value={fmt(mrrGap)}
                sub="Contracted – live (rollout upside)"
                icon={ArrowUpRight} color={mrrGap > 0 ? "text-amber-400" : "text-emerald-400"} />
              <KpiCard title="Software-Only MRR" value={fmt(mrr.softwareOnly)} sub="Lite-slip SaaS"
                icon={Zap} color="text-blue-400" />
            </div>
          </div>

          {/* Hardware Section */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Hardware Revenue</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiCard title="Contracted Value" value={fmt(hardware.contracted)}
                sub={`${hardware.accountsWithContracts} accounts`} icon={Package} />
              <KpiCard title="Booked" value={fmt(hardware.booked)} sub="POs confirmed"
                icon={Package} color="text-blue-400" />
              <KpiCard title="Delivered" value={fmt(hardware.delivered)}
                sub={deliveryPct != null ? `${deliveryPct}% of contracted` : ""}
                icon={Package} color="text-emerald-400" />
              <KpiCard title="Remaining" value={fmt(hardware.remaining)} sub="To be delivered"
                icon={Package} color={hardware.remaining > 0 ? "text-amber-400" : "text-emerald-400"} />
            </div>
          </div>

          {/* Slips Section */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Slip Counts</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiCard title="Total Slips" value={fmtNum(slips.total)} sub="Across all accounts"
                icon={Anchor} />
              <KpiCard title="VoltSafe Live" value={fmtNum(slips.voltsafeLive)} sub="Full smart slips"
                icon={Zap} color="text-emerald-400" />
              <KpiCard title="Software-Only" value={fmtNum(slips.softwareOnly)} sub="Lite SaaS, no hardware"
                icon={Zap} color="text-blue-400" />
              <KpiCard title="Future Upgrade" value={fmtNum(slips.futureUpgrade)} sub="Expansion pipeline"
                icon={TrendingUp} color="text-amber-400" />
            </div>
          </div>

          {/* Rollout Phase Summary */}
          {totalPhases > 0 && (
            <Card className="border-border/50" data-testid="card-rollout-phases">
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Package className="h-4 w-4 text-primary" /> Rollout Phase Status
                  </CardTitle>
                  <span className="text-xs text-muted-foreground">{totalPhases} total phases</span>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="flex flex-wrap gap-2">
                  {Object.entries(rolloutPhases).map(([status, count]) => (
                    <div key={status} className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${PHASE_COLOR[status] ?? "bg-slate-500/15 text-slate-400"}`}
                      data-testid={`phase-status-${status}`}>
                      <span className="capitalize">{status.replace(/_/g, " ")}</span>
                      <span className="font-bold">{count}</span>
                    </div>
                  ))}
                </div>
                {blockedPhases > 0 && (
                  <div className="mt-3 flex items-center gap-2 p-2 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />
                    <p className="text-xs text-red-400">{blockedPhases} phase{blockedPhases !== 1 ? "s" : ""} blocked — review expansion accounts</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {view === "accounts" && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Top Expansion Accounts ({topExpansionAccounts.length})
          </h2>
          {topExpansionAccounts.length === 0 ? (
            <Card className="border-border/50">
              <CardContent className="p-8 text-center">
                <TrendingUp className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No expansion accounts tracked yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Add future_upgrade_slips or contracted units on accounts to see them here.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {topExpansionAccounts.map(a => {
                const installPct = a.contractedUnits > 0
                  ? Math.round((a.installedUnits / a.contractedUnits) * 100)
                  : null;
                return (
                  <Card key={a.id} className="border-border/50 hover:border-border transition-colors" data-testid={`expansion-account-${a.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Link href={`/accounts/${a.id}`}>
                              <span className="font-semibold text-sm hover:text-primary cursor-pointer transition-colors" data-testid={`link-account-${a.id}`}>
                                {a.name}
                              </span>
                            </Link>
                            {a.currentMrr > 0 && (
                              <Badge className="bg-emerald-500/15 text-emerald-400 text-[10px] h-4 px-1.5">
                                {fmt(a.currentMrr)}/mo
                              </Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                            {a.contractedUnits > 0 && (
                              <span>{a.installedUnits}/{a.contractedUnits} units installed
                                {installPct != null && <span className="text-primary ml-1">({installPct}%)</span>}
                              </span>
                            )}
                            {a.futureUpgradeSlips > 0 && (
                              <span className="text-amber-400">+{a.futureUpgradeSlips} future slips</span>
                            )}
                            {a.remainingUnits > 0 && (
                              <span className="text-slate-400">{a.remainingUnits} units remaining</span>
                            )}
                          </div>
                          {/* Progress bar */}
                          {a.contractedUnits > 0 && (
                            <div className="mt-2 w-full bg-border/40 rounded-full h-1.5">
                              <div
                                className="bg-emerald-500 h-1.5 rounded-full transition-all"
                                style={{ width: `${Math.min(100, installPct ?? 0)}%` }}
                              />
                            </div>
                          )}
                        </div>
                        <Link href={`/accounts/${a.id}`}>
                          <Button variant="ghost" size="sm" className="gap-1 flex-shrink-0" data-testid={`button-view-account-${a.id}`}>
                            View <ChevronRight className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground text-right">
        Updated {data.generatedAt ? new Date(data.generatedAt).toLocaleTimeString() : "—"}
      </p>
    </div>
  );
}
