/**
 * CEO Cockpit Phase 9 — Forecasting, Scenario Planning, and Runway Intelligence
 *
 * Tabs: Overview | Scenarios | Runway | Revenue | Execution | Funding | Assumptions
 *
 * Safety:
 * - No auto-send of any kind
 * - Runway/Funding tabs show lock state for non-CEO/CFO users
 * - All language uses planning assumption phrasing
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { TrendingUp, TrendingDown, Minus, Lock, AlertTriangle, CheckCircle, Zap, DollarSign, Target, BarChart2, Activity, Layers, ChevronRight, Copy, Plus, RefreshCw, BookOpen,
} from "lucide-react";
import { InfoIcon as Info } from "@/components/icons/info-icon";

// ── Types ─────────────────────────────────────────────────────────────────────

type Severity = "info" | "watch" | "urgent" | "critical";

interface ForecastSection {
  section: string;
  title: string;
  severity?: Severity;
  error?: string;
  access_denied?: boolean;
  empty_state?: boolean;
}

interface RevenueForecast extends ForecastSection {
  summary?: string;
  total_open_pipeline?: number;
  weighted_pipeline?: number;
  closed_won_amount?: number;
  commit_amount?: number;
  stale_opportunities?: Array<{ id: number; title: string; amount: number; stage: string; est_close_date?: string }>;
  slipped_opportunities?: Array<{ id: number; title: string; amount: number; stage: string; est_close_date?: string }>;
  high_confidence_opportunities?: Array<{ id: number; title: string; amount: number; forecast_category?: string }>;
  monthly_forecast?: Array<{ month_key: string; label: string; opp_count: number; total_amount: number; commit_amount: number }>;
  next_30_days?: { total: number; count: number };
  next_60_days?: { total: number; count: number };
  next_90_days?: { total: number; count: number };
  blockers_to_revenue?: string[];
  recommended_ceo_actions?: string[];
  assumptions?: string[];
}

interface RunwayForecast extends ForecastSection {
  summary?: string;
  current_cash_balance?: number;
  monthly_burn?: number;
  runway_today_months?: number;
  cashout_date_today?: string;
  runway_downside_months?: number;
  runway_after_target_months?: number;
  runway_upside_months?: number;
  committed_capital?: number;
  missing_inputs?: string[];
  key_risks?: string[];
  recommended_ceo_actions?: string[];
  assumptions?: string[];
  message?: string;
}

interface ExecutionForecast extends ForecastSection {
  summary?: string;
  execution_health_score?: number;
  execution_health_label?: string;
  likely_slips?: Array<{ title: string; severity: string; reason: string }>;
  at_risk_commitments?: Array<{ title: string; severity: string; reason: string }>;
  recurring_risks?: Array<{ title: string; severity: string; reason: string }>;
  owner_load_risks?: Array<{ name: string; overdue_count: number }>;
  stale_tasks_count?: number;
  recommended_interventions?: string[];
  assumptions?: string[];
}

interface FundingForecast extends ForecastSection {
  summary?: string;
  total_investors?: number;
  active_conversations?: number;
  round_name?: string;
  target_raise?: number;
  committed_capital?: number;
  soft_circled?: number;
  remaining_to_target?: number;
  grant_secured?: number;
  grant_pending?: number;
  active_grant_applications?: number;
  next_funding_actions?: string[];
  funding_risks?: string[];
  assumptions?: string[];
}

interface ScenarioPlan {
  section: string;
  title: string;
  scenarios?: {
    base_case: ScenarioData;
    upside_case: ScenarioData;
    downside_case: ScenarioData;
  };
  pipeline_context?: {
    total_pipeline: number;
    weighted_pipeline: number;
    commit_amount: number;
    slipped_count: number;
    open_count: number;
  };
  assumptions?: string[];
}

interface ScenarioData {
  label: string;
  summary: string;
  likely_outcome: string;
  revenue_implication: number;
  revenue_implication_label: string;
  key_assumptions: string[];
  top_risks: string[];
  top_opportunities: string[];
  recommended_actions: string[];
}

interface FullForecast {
  generated_at?: string;
  overall_severity?: Severity;
  executive_forecast_summary?: {
    title: string;
    severity: Severity;
    bullets: string[];
    top_risks: string[];
    top_opportunities: string[];
    recommended_actions: string[];
  };
  revenue_forecast?: RevenueForecast;
  execution_forecast?: ExecutionForecast;
  scenario_plan?: ScenarioPlan;
  runway_intelligence?: RunwayForecast;
  funding_forecast?: FundingForecast;
  forecast_interventions?: {
    interventions: Array<{ title: string; priority: string; reason: string; action_type: string }>;
    count: number;
  };
  key_assumptions?: string[];
  leading_indicators?: {
    weighted_pipeline?: number;
    commit_amount?: number;
    slipped_count?: number;
    stale_count?: number;
    execution_health_score?: number;
    likely_slips?: number;
    runway_months?: number;
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt$(v?: number | null): string {
  if (!v) return "$0";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${Math.round(v)}`;
}

function SeverityBadge({ severity }: { severity?: Severity }) {
  const map: Record<string, { label: string; className: string }> = {
    critical: { label: "Critical", className: "bg-red-500/20 text-red-400 border-red-500/30" },
    urgent:   { label: "Urgent",   className: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
    watch:    { label: "Watch",    className: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
    info:     { label: "On Track", className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  };
  const s = map[severity ?? "info"];
  return <Badge variant="outline" className={`text-xs ${s.className}`}>{s.label}</Badge>;
}

function SeverityIcon({ severity }: { severity?: Severity }) {
  if (severity === "critical") return <AlertTriangle className="h-4 w-4 text-red-400" />;
  if (severity === "urgent")   return <AlertTriangle className="h-4 w-4 text-amber-400" />;
  if (severity === "watch")    return <Minus className="h-4 w-4 text-yellow-400" />;
  return <CheckCircle className="h-4 w-4 text-emerald-400" />;
}

function PlanningNote() {
  return (
    <p className="text-xs text-muted-foreground italic mt-1">
      Planning assumption only — not a financial guarantee or scientific prediction.
    </p>
  );
}

function AccessDeniedCard({ section }: { section: string }) {
  return (
    <div data-testid={`forecast-access-denied-${section}`} className="flex flex-col items-center gap-3 py-12 text-center">
      <Lock className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">This section requires CEO or CFO access.</p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <Info className="h-6 w-6 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function BulletList({ items, icon }: { items: string[]; icon?: React.ReactNode }) {
  if (!items || items.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-sm text-muted-foreground">
          <span className="mt-0.5 shrink-0">{icon ?? <ChevronRight className="h-3.5 w-3.5 mt-0.5" />}</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function ScenarioCard({ scenario, variant }: { scenario: ScenarioData; variant: "base" | "upside" | "downside" }) {
  const colors = {
    base:     { border: "border-blue-500/20",   bg: "bg-blue-500/5",   text: "text-blue-400",   icon: <Minus className="h-5 w-5 text-blue-400" /> },
    upside:   { border: "border-emerald-500/20", bg: "bg-emerald-500/5",text: "text-emerald-400",icon: <TrendingUp className="h-5 w-5 text-emerald-400" /> },
    downside: { border: "border-red-500/20",     bg: "bg-red-500/5",    text: "text-red-400",    icon: <TrendingDown className="h-5 w-5 text-red-400" /> },
  }[variant];

  return (
    <Card data-testid={`scenario-card-${variant}`} className={`border ${colors.border} ${colors.bg}`}>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          {colors.icon}
          <CardTitle className="text-sm font-semibold">{scenario.label}</CardTitle>
          <span className={`ml-auto text-lg font-bold ${colors.text}`}>{scenario.revenue_implication_label}</span>
        </div>
        <p className="text-xs text-muted-foreground">{scenario.summary}</p>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        <div>
          <p className="text-xs font-medium text-foreground mb-1">Likely Outcome</p>
          <p className="text-xs text-muted-foreground">{scenario.likely_outcome}</p>
        </div>
        {scenario.key_assumptions?.length > 0 && (
          <div>
            <p className="text-xs font-medium text-foreground mb-1">Key Assumptions</p>
            <BulletList items={scenario.key_assumptions} />
          </div>
        )}
        {scenario.top_risks?.length > 0 && (
          <div>
            <p className="text-xs font-medium text-foreground mb-1">Top Risks</p>
            <BulletList items={scenario.top_risks} icon={<AlertTriangle className="h-3 w-3 text-amber-400 mt-0.5" />} />
          </div>
        )}
        {scenario.recommended_actions?.length > 0 && (
          <div>
            <p className="text-xs font-medium text-foreground mb-1">Recommended Actions</p>
            <BulletList items={scenario.recommended_actions} icon={<Zap className="h-3 w-3 text-cyan-400 mt-0.5" />} />
          </div>
        )}
        <PlanningNote />
      </CardContent>
    </Card>
  );
}

// ── Tab: Overview ──────────────────────────────────────────────────────────────

function OverviewTab({ data, onCreateActions }: { data: FullForecast; onCreateActions: () => void }) {
  const summary = data.executive_forecast_summary;
  const indicators = data.leading_indicators;
  const interventions = data.forecast_interventions?.interventions ?? [];

  return (
    <div data-testid="forecast-tab-overview" className="space-y-4">
      {/* Executive Summary */}
      <Card className="border-border/40">
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center gap-2">
            <SeverityIcon severity={data.overall_severity} />
            <CardTitle className="text-sm font-semibold">Executive Forecast Summary</CardTitle>
            <span className="ml-auto"><SeverityBadge severity={data.overall_severity} /></span>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          {summary?.bullets?.length > 0 && (
            <ul className="space-y-1">
              {summary.bullets.map((b, i) => (
                <li key={i} className="text-sm text-muted-foreground flex gap-2">
                  <span className="text-cyan-400 mt-0.5">•</span> {b}
                </li>
              ))}
            </ul>
          )}
          {summary?.top_risks?.length > 0 && (
            <div>
              <p className="text-xs font-medium text-foreground mb-1">Top Risks</p>
              <BulletList items={summary.top_risks} icon={<AlertTriangle className="h-3 w-3 text-amber-400 mt-0.5" />} />
            </div>
          )}
          <PlanningNote />
        </CardContent>
      </Card>

      {/* Leading Indicators */}
      {indicators && (
        <div data-testid="forecast-leading-indicators" className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Weighted Pipeline", value: fmt$(indicators.weighted_pipeline), icon: <BarChart2 className="h-4 w-4" /> },
            { label: "Commit Amount",     value: fmt$(indicators.commit_amount),     icon: <Target className="h-4 w-4" /> },
            { label: "Likely Slips",      value: String(indicators.likely_slips ?? 0), icon: <Activity className="h-4 w-4" /> },
            { label: "Stale Opps",        value: String(indicators.stale_count ?? 0), icon: <Layers className="h-4 w-4" /> },
          ].map(kpi => (
            <Card key={kpi.label} className="border-border/40">
              <CardContent className="pt-3 pb-3 px-3">
                <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                  {kpi.icon}
                  <span className="text-xs">{kpi.label}</span>
                </div>
                <p className="text-lg font-bold">{kpi.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Base / Upside / Downside Mini Cards */}
      {data.scenario_plan?.scenarios && (
        <div className="grid grid-cols-3 gap-3">
          {(["base_case", "upside_case", "downside_case"] as const).map(k => {
            const sc = data.scenario_plan!.scenarios![k];
            const variant = k === "base_case" ? "base" : k === "upside_case" ? "upside" : "downside";
            const colors = { base: "text-blue-400", upside: "text-emerald-400", downside: "text-red-400" };
            return (
              <Card key={k} data-testid={`overview-scenario-${variant}`} className="border-border/40">
                <CardContent className="pt-3 pb-3 px-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">{sc.label}</p>
                  <p className={`text-base font-bold ${colors[variant]}`}>{sc.revenue_implication_label}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Recommended Interventions */}
      {interventions.length > 0 && (
        <Card className="border-border/40">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-cyan-400" />
              <CardTitle className="text-sm font-semibold">Recommended CEO Interventions</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {interventions.slice(0, 4).map((iv, i) => (
              <div key={i} data-testid={`intervention-item-${i}`} className="flex items-start gap-2 text-sm">
                <Badge variant="outline" className={`text-xs shrink-0 ${iv.priority === "critical" ? "border-red-500/40 text-red-400" : iv.priority === "high" ? "border-amber-500/40 text-amber-400" : "border-muted"}`}>
                  {iv.priority}
                </Badge>
                <div>
                  <p className="font-medium text-sm">{iv.title}</p>
                  <p className="text-xs text-muted-foreground">{iv.reason}</p>
                </div>
              </div>
            ))}
            <Button
              data-testid="btn-create-forecast-actions"
              size="sm"
              variant="outline"
              className="mt-2 w-full text-xs"
              onClick={onCreateActions}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add to CEO Action Queue
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Tab: Scenarios ─────────────────────────────────────────────────────────────

function ScenariosTab({ data }: { data: ScenarioPlan }) {
  if (!data.scenarios) return <EmptyState message="Scenario plan unavailable." />;

  return (
    <div data-testid="forecast-tab-scenarios" className="space-y-4">
      <div className="grid gap-4">
        <ScenarioCard scenario={data.scenarios.base_case}    variant="base" />
        <ScenarioCard scenario={data.scenarios.upside_case}  variant="upside" />
        <ScenarioCard scenario={data.scenarios.downside_case} variant="downside" />
      </div>
      {data.pipeline_context && (
        <Card className="border-border/40">
          <CardContent className="px-4 py-3">
            <p className="text-xs font-medium text-foreground mb-2">Pipeline Context</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div><p className="text-xs text-muted-foreground">Total Pipeline</p><p className="font-semibold text-sm">{fmt$(data.pipeline_context.total_pipeline)}</p></div>
              <div><p className="text-xs text-muted-foreground">Weighted</p><p className="font-semibold text-sm">{fmt$(data.pipeline_context.weighted_pipeline)}</p></div>
              <div><p className="text-xs text-muted-foreground">Slipped</p><p className="font-semibold text-sm">{data.pipeline_context.slipped_count}</p></div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Tab: Runway ────────────────────────────────────────────────────────────────

function RunwayTab({ data }: { data: RunwayForecast }) {
  if (data.access_denied) return <AccessDeniedCard section="runway" />;

  if (data.empty_state || data.missing_inputs) {
    return (
      <div data-testid="forecast-tab-runway" className="space-y-4">
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="px-4 py-4">
            <div className="flex gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-sm font-medium">{data.message ?? "Runway data unavailable"}</p>
            </div>
            {data.missing_inputs && data.missing_inputs.length > 0 && (
              <div>
                <p className="text-xs font-medium text-foreground mb-2">Missing Inputs Required</p>
                <BulletList items={data.missing_inputs} icon={<Info className="h-3 w-3 text-muted-foreground mt-0.5" />} />
              </div>
            )}
          </CardContent>
        </Card>
        <PlanningNote />
      </div>
    );
  }

  const barWidth = (months?: number) => Math.min(100, Math.round(((months ?? 0) / 24) * 100));

  return (
    <div data-testid="forecast-tab-runway" className="space-y-4">
      {/* Primary runway card */}
      <Card className="border-border/40">
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center gap-2">
            <SeverityIcon severity={data.severity} />
            <CardTitle className="text-sm font-semibold">Runway Intelligence</CardTitle>
            <span className="ml-auto"><SeverityBadge severity={data.severity} /></span>
          </div>
          {data.summary && <p className="text-xs text-muted-foreground">{data.summary}</p>}
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Current Cash", value: fmt$(data.current_cash_balance) },
              { label: "Monthly Burn",  value: fmt$(data.monthly_burn) },
              { label: "Runway (Today)", value: `${data.runway_today_months} mo`, note: data.cashout_date_today },
              { label: "Committed Capital", value: fmt$(data.committed_capital) },
            ].map(kpi => (
              <div key={kpi.label} className="rounded-lg bg-muted/30 px-3 py-2">
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <p className="text-base font-bold">{kpi.value}</p>
                {kpi.note && <p className="text-xs text-muted-foreground">Est. cashout: {kpi.note}</p>}
              </div>
            ))}
          </div>

          {/* Scenario bars */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Scenario Runway</p>
            {[
              { label: "Downside", months: data.runway_downside_months, color: "bg-red-500" },
              { label: "Base (Today)", months: data.runway_today_months, color: "bg-blue-500" },
              { label: "After Target Raise", months: data.runway_after_target_months, color: "bg-emerald-500" },
              { label: "Upside (+ Committed)", months: data.runway_upside_months, color: "bg-cyan-500" },
            ].filter(b => b.months != null).map(bar => (
              <div key={bar.label} className="space-y-0.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{bar.label}</span>
                  <span className="font-medium">{bar.months} mo</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted/40">
                  <div className={`h-full rounded-full ${bar.color}`} style={{ width: `${barWidth(bar.months!)}%` }} />
                </div>
              </div>
            ))}
          </div>

          {data.key_risks && data.key_risks.length > 0 && (
            <div>
              <p className="text-xs font-medium text-foreground mb-1">Key Risks</p>
              <BulletList items={data.key_risks} icon={<AlertTriangle className="h-3 w-3 text-amber-400 mt-0.5" />} />
            </div>
          )}
          {data.recommended_ceo_actions && data.recommended_ceo_actions.length > 0 && (
            <div>
              <p className="text-xs font-medium text-foreground mb-1">Recommended CEO Actions</p>
              <BulletList items={data.recommended_ceo_actions} icon={<Zap className="h-3 w-3 text-cyan-400 mt-0.5" />} />
            </div>
          )}
          <PlanningNote />
        </CardContent>
      </Card>
    </div>
  );
}

// ── Tab: Revenue ───────────────────────────────────────────────────────────────

function RevenueTab({ data }: { data: RevenueForecast }) {
  return (
    <div data-testid="forecast-tab-revenue" className="space-y-4">
      <Card className="border-border/40">
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center gap-2">
            <SeverityIcon severity={data.severity} />
            <CardTitle className="text-sm font-semibold">Revenue Forecast</CardTitle>
            <span className="ml-auto"><SeverityBadge severity={data.severity} /></span>
          </div>
          {data.summary && <p className="text-xs text-muted-foreground">{data.summary}</p>}
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-4">
          {/* Pipeline totals */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Total Open", value: fmt$(data.total_open_pipeline) },
              { label: "Weighted", value: fmt$(data.weighted_pipeline) },
              { label: "Commit", value: fmt$(data.commit_amount) },
            ].map(k => (
              <div key={k.label} className="rounded-lg bg-muted/30 px-3 py-2 text-center">
                <p className="text-xs text-muted-foreground">{k.label}</p>
                <p className="text-sm font-bold">{k.value}</p>
              </div>
            ))}
          </div>

          {/* 30/60/90 */}
          <div>
            <p className="text-xs font-medium text-foreground mb-2">Expected Close Movement</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Next 30 Days", d: data.next_30_days },
                { label: "Next 60 Days", d: data.next_60_days },
                { label: "Next 90 Days", d: data.next_90_days },
              ].map(b => (
                <div key={b.label} className="rounded-lg bg-muted/30 px-3 py-2 text-center">
                  <p className="text-xs text-muted-foreground">{b.label}</p>
                  <p className="text-sm font-bold">{fmt$(b.d?.total)}</p>
                  <p className="text-xs text-muted-foreground">{b.d?.count ?? 0} opp{(b.d?.count ?? 0) !== 1 ? "s" : ""}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Monthly forecast */}
          {data.monthly_forecast && data.monthly_forecast.length > 0 && (
            <div>
              <p className="text-xs font-medium text-foreground mb-2">Monthly Close Forecast</p>
              <div className="space-y-1.5">
                {data.monthly_forecast.map(m => (
                  <div key={m.month_key} className="flex items-center gap-2 text-xs">
                    <span className="w-20 text-muted-foreground">{m.label}</span>
                    <span className="font-medium">{fmt$(m.total_amount)}</span>
                    <span className="text-muted-foreground">({m.opp_count} opp{m.opp_count !== 1 ? "s" : ""})</span>
                    {m.commit_amount > 0 && <span className="text-emerald-400">{fmt$(m.commit_amount)} commit</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Slipped */}
          {data.slipped_opportunities && data.slipped_opportunities.length > 0 && (
            <div>
              <p className="text-xs font-medium text-foreground mb-2 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-amber-400" />
                Slipped Opportunities ({data.slipped_opportunities.length})
              </p>
              <div className="space-y-1">
                {data.slipped_opportunities.slice(0, 5).map(o => (
                  <div key={o.id} data-testid={`slipped-opp-${o.id}`} className="flex justify-between text-xs text-muted-foreground">
                    <span className="truncate max-w-[60%]">{o.title}</span>
                    <span>{fmt$(o.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stale */}
          {data.stale_opportunities && data.stale_opportunities.length > 0 && (
            <div>
              <p className="text-xs font-medium text-foreground mb-2">Stale Opportunities ({data.stale_opportunities.length})</p>
              <div className="space-y-1">
                {data.stale_opportunities.slice(0, 5).map(o => (
                  <div key={o.id} className="flex justify-between text-xs text-muted-foreground">
                    <span className="truncate max-w-[60%]">{o.title}</span>
                    <span>{fmt$(o.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.blockers_to_revenue && data.blockers_to_revenue.length > 0 && (
            <div>
              <p className="text-xs font-medium text-foreground mb-1">Revenue Blockers</p>
              <BulletList items={data.blockers_to_revenue} icon={<AlertTriangle className="h-3 w-3 text-amber-400 mt-0.5" />} />
            </div>
          )}
          {data.recommended_ceo_actions && data.recommended_ceo_actions.length > 0 && (
            <div>
              <p className="text-xs font-medium text-foreground mb-1">Recommended CEO Actions</p>
              <BulletList items={data.recommended_ceo_actions} icon={<Zap className="h-3 w-3 text-cyan-400 mt-0.5" />} />
            </div>
          )}
          <PlanningNote />
        </CardContent>
      </Card>
    </div>
  );
}

// ── Tab: Execution ─────────────────────────────────────────────────────────────

function ExecutionTab({ data }: { data: ExecutionForecast }) {
  return (
    <div data-testid="forecast-tab-execution" className="space-y-4">
      <Card className="border-border/40">
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center gap-2">
            <SeverityIcon severity={data.severity} />
            <CardTitle className="text-sm font-semibold">Execution Forecast</CardTitle>
            <span className="ml-auto">
              {data.execution_health_score != null && (
                <span className="text-xs text-muted-foreground mr-2">Health: {data.execution_health_score}</span>
              )}
              <SeverityBadge severity={data.severity} />
            </span>
          </div>
          {data.summary && <p className="text-xs text-muted-foreground">{data.summary}</p>}
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-4">
          {/* Likely slips */}
          {data.likely_slips && data.likely_slips.length > 0 && (
            <div>
              <p className="text-xs font-medium text-foreground mb-2">Likely Slips ({data.likely_slips.length})</p>
              <div className="space-y-2">
                {data.likely_slips.map((s, i) => (
                  <div key={i} data-testid={`likely-slip-${i}`} className="rounded-lg bg-muted/20 px-3 py-2">
                    <div className="flex items-center gap-2 mb-0.5">
                      <SeverityBadge severity={s.severity as Severity} />
                      <span className="text-xs font-medium">{s.title}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{s.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* At-risk commitments */}
          {data.at_risk_commitments && data.at_risk_commitments.length > 0 && (
            <div>
              <p className="text-xs font-medium text-foreground mb-2">At-Risk Commitments ({data.at_risk_commitments.length})</p>
              <div className="space-y-1">
                {data.at_risk_commitments.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <AlertTriangle className="h-3 w-3 text-amber-400 mt-0.5 shrink-0" />
                    <span>{c.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Owner load risks */}
          {data.owner_load_risks && data.owner_load_risks.length > 0 && (
            <div>
              <p className="text-xs font-medium text-foreground mb-2">Owner Load Risks</p>
              {data.owner_load_risks.map((o, i) => (
                <div key={i} className="flex justify-between text-xs text-muted-foreground">
                  <span>{o.name}</span>
                  <span>{o.overdue_count} overdue tasks</span>
                </div>
              ))}
            </div>
          )}

          {data.stale_tasks_count != null && data.stale_tasks_count > 0 && (
            <p className="text-xs text-muted-foreground">{data.stale_tasks_count} stale tasks likely to remain without intervention.</p>
          )}

          {data.recommended_interventions && data.recommended_interventions.length > 0 && (
            <div>
              <p className="text-xs font-medium text-foreground mb-1">Recommended Interventions</p>
              <BulletList items={data.recommended_interventions} icon={<Zap className="h-3 w-3 text-cyan-400 mt-0.5" />} />
            </div>
          )}
          <PlanningNote />
        </CardContent>
      </Card>
    </div>
  );
}

// ── Tab: Funding ───────────────────────────────────────────────────────────────

function FundingTab({ data }: { data: FundingForecast }) {
  if (data.access_denied) return <AccessDeniedCard section="funding" />;

  return (
    <div data-testid="forecast-tab-funding" className="space-y-4">
      <Card className="border-border/40">
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-cyan-400" />
            <CardTitle className="text-sm font-semibold">Funding Forecast</CardTitle>
            <span className="ml-auto"><SeverityBadge severity={data.severity} /></span>
          </div>
          {data.summary && <p className="text-xs text-muted-foreground">{data.summary}</p>}
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Target Raise", value: fmt$(data.target_raise) },
              { label: "Committed",    value: fmt$(data.committed_capital) },
              { label: "Soft-Circled", value: fmt$(data.soft_circled) },
              { label: "Remaining",    value: data.remaining_to_target != null ? fmt$(data.remaining_to_target) : "—" },
              { label: "Grant Secured", value: fmt$(data.grant_secured) },
              { label: "Grant Pending", value: fmt$(data.grant_pending) },
            ].map(k => (
              <div key={k.label} className="rounded-lg bg-muted/30 px-3 py-2">
                <p className="text-xs text-muted-foreground">{k.label}</p>
                <p className="text-sm font-bold">{k.value}</p>
              </div>
            ))}
          </div>

          {data.next_funding_actions && data.next_funding_actions.length > 0 && (
            <div>
              <p className="text-xs font-medium text-foreground mb-1">Next Funding Actions</p>
              <BulletList items={data.next_funding_actions} icon={<Zap className="h-3 w-3 text-cyan-400 mt-0.5" />} />
            </div>
          )}
          {data.funding_risks && data.funding_risks.length > 0 && (
            <div>
              <p className="text-xs font-medium text-foreground mb-1">Funding Risks</p>
              <BulletList items={data.funding_risks} icon={<AlertTriangle className="h-3 w-3 text-amber-400 mt-0.5" />} />
            </div>
          )}
          <PlanningNote />
        </CardContent>
      </Card>
    </div>
  );
}

// ── Tab: Assumptions ──────────────────────────────────────────────────────────

function AssumptionsTab({ data }: { data: FullForecast }) {
  const { toast } = useToast();

  const allAssumptions: Record<string, string[]> = {
    "Key Assumptions": data.key_assumptions ?? [],
    "Revenue Forecast": (data.revenue_forecast as any)?.assumptions ?? [],
    "Execution Forecast": (data.execution_forecast as any)?.assumptions ?? [],
    "Scenario Plan": (data.scenario_plan as any)?.assumptions ?? [],
    "Runway Intelligence": (data.runway_intelligence as any)?.assumptions ?? [],
    "Funding Forecast": (data.funding_forecast as any)?.assumptions ?? [],
  };

  const handleCopy = () => {
    const text = Object.entries(allAssumptions)
      .map(([section, items]) => items.length > 0 ? `${section}:\n${items.map(i => `• ${i}`).join("\n")}` : "")
      .filter(Boolean)
      .join("\n\n");
    navigator.clipboard.writeText(text).then(() => toast({ title: "Assumptions copied to clipboard" }));
  };

  return (
    <div data-testid="forecast-tab-assumptions" className="space-y-4">
      <div className="flex justify-end">
        <Button data-testid="btn-copy-assumptions" size="sm" variant="outline" onClick={handleCopy} className="text-xs gap-1">
          <Copy className="h-3.5 w-3.5" /> Copy All Assumptions
        </Button>
      </div>
      {Object.entries(allAssumptions).map(([section, items]) =>
        items.length > 0 ? (
          <Card key={section} className="border-border/40">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{section}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <BulletList items={items} icon={<BookOpen className="h-3 w-3 text-muted-foreground mt-0.5" />} />
            </CardContent>
          </Card>
        ) : null
      )}
      <p className="text-xs text-muted-foreground text-center italic">
        All forecasts use planning assumptions only. No numbers are invented.
        Missing data is explicitly identified rather than estimated.
      </p>
    </div>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────────

export function CeoForecastingPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("overview");

  const forecastQuery = useQuery<FullForecast>({
    queryKey: ["/api/today/ceo-forecast"],
    staleTime: 5 * 60 * 1000,
  });

  const createActionsMutation = useMutation({
    mutationFn: (interventions: any[]) =>
      apiRequest("POST", "/api/today/ceo-forecast/interventions/create-actions", { interventions }),
    onSuccess: (data: any) => {
      toast({ title: `${data?.created ?? 0} action${data?.created !== 1 ? "s" : ""} added to CEO Action Queue` });
      queryClient.invalidateQueries({ queryKey: ["/api/today/ceo-actions"] });
    },
    onError: (err: any) => toast({ title: "Failed to create actions", description: err?.message, variant: "destructive" }),
  });

  const handleCreateActions = () => {
    const interventions = forecastQuery.data?.forecast_interventions?.interventions ?? [];
    if (interventions.length === 0) {
      toast({ title: "No interventions available", description: "Run forecast first to generate interventions." });
      return;
    }
    createActionsMutation.mutate(interventions);
  };

  const data = forecastQuery.data;

  const tabs = [
    { id: "overview",    label: "Overview",    icon: <BarChart2 className="h-3 w-3" /> },
    { id: "scenarios",   label: "Scenarios",   icon: <Layers className="h-3 w-3" /> },
    { id: "runway",      label: "Runway",      icon: <Activity className="h-3 w-3" /> },
    { id: "revenue",     label: "Revenue",     icon: <TrendingUp className="h-3 w-3" /> },
    { id: "execution",   label: "Execution",   icon: <Target className="h-3 w-3" /> },
    { id: "funding",     label: "Funding",     icon: <DollarSign className="h-3 w-3" /> },
    { id: "assumptions", label: "Assumptions", icon: <BookOpen className="h-3 w-3" /> },
  ];

  return (
    <div data-testid="ceo-forecasting-panel" className="rounded-xl border border-border/40 bg-card p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-cyan-400" />
          <h2 className="text-base font-semibold">Forecasting</h2>
          {data?.overall_severity && <SeverityBadge severity={data.overall_severity} />}
        </div>
        <Button
          data-testid="btn-refresh-forecast"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/today/ceo-forecast"] })}
          disabled={forecastQuery.isFetching}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${forecastQuery.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {forecastQuery.isLoading && (
        <div data-testid="ceo-forecasting-loading" className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
      )}

      {forecastQuery.isError && (
        <div data-testid="ceo-forecasting-error" className="py-8 text-center">
          <AlertTriangle className="h-6 w-6 text-amber-400 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Failed to load forecast data.</p>
        </div>
      )}

      {data && (
        <Tabs value={activeTab} onValueChange={setActiveTab} data-testid="forecast-tabs">
          <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/30 p-1">
            {tabs.map(t => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                data-testid={`forecast-tab-trigger-${t.id}`}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                {t.icon} {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            <OverviewTab data={data} onCreateActions={handleCreateActions} />
          </TabsContent>

          <TabsContent value="scenarios" className="mt-4">
            <ScenariosTab data={data.scenario_plan ?? { section: "scenario_plan", title: "Scenario Planning" }} />
          </TabsContent>

          <TabsContent value="runway" className="mt-4">
            {data.runway_intelligence
              ? <RunwayTab data={data.runway_intelligence as RunwayForecast} />
              : <AccessDeniedCard section="runway" />
            }
          </TabsContent>

          <TabsContent value="revenue" className="mt-4">
            {data.revenue_forecast
              ? <RevenueTab data={data.revenue_forecast as RevenueForecast} />
              : <EmptyState message="Revenue forecast unavailable." />
            }
          </TabsContent>

          <TabsContent value="execution" className="mt-4">
            {data.execution_forecast
              ? <ExecutionTab data={data.execution_forecast as ExecutionForecast} />
              : <EmptyState message="Execution forecast unavailable." />
            }
          </TabsContent>

          <TabsContent value="funding" className="mt-4">
            {data.funding_forecast
              ? <FundingTab data={data.funding_forecast as FundingForecast} />
              : <AccessDeniedCard section="funding" />
            }
          </TabsContent>

          <TabsContent value="assumptions" className="mt-4">
            <AssumptionsTab data={data} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
