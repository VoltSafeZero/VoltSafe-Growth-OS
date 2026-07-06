// Capital Board / CFO Reporting Pack — Phase 2J
// Restricted to Trevor (user ID 4) and Scott Carlson only via requireCapitalAccess.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  FileBarChart2, Download, Copy, RefreshCw, ChevronRight,
  AlertTriangle, CheckCircle2, TrendingUp, Users, BarChart3,
  FileText, Target, Shield, Zap, ClipboardList, Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

// ── Types ──────────────────────────────────────────────────────────────────────

type ReportType = "weekly_brief" | "board_update" | "cfo_closing" | "engagement";

type ReportTypeMeta = {
  title:       string;
  subtitle:    string;
  description: string;
  audience:    string;
  has_csv:     boolean;
};

type ReportMeta = {
  report_types: Record<ReportType, ReportTypeMeta>;
  rounds:       { id: number; name: string; status: string }[];
};

type Round = { id: number; name: string; status: string };

// ── Report section renderers ───────────────────────────────────────────────────

function SectionCard({ title, icon, children }: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function StatRow({ label, value, highlight }: { label: string; value: React.ReactNode; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium tabular-nums ${highlight ? "text-primary" : ""}`}>{value}</span>
    </div>
  );
}

function FlagList({ flags, severity }: { flags: string[]; severity: "critical" | "warning" | "info" }) {
  if (flags.length === 0) return <p className="text-xs text-muted-foreground italic">None</p>;
  const cls = severity === "critical"
    ? "bg-red-500/10 text-red-400 border-red-500/20"
    : severity === "warning"
    ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
    : "bg-blue-500/10 text-blue-400 border-blue-500/20";
  return (
    <ul className="space-y-1.5">
      {flags.map((f, i) => (
        <li key={i} className={`text-xs px-2 py-1.5 rounded-md border ${cls}`}>{f}</li>
      ))}
    </ul>
  );
}

function PctBar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-primary" : "bg-amber-500"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function fmtM(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return s; }
}

// ── Weekly Brief ──────────────────────────────────────────────────────────────

function WeeklyBriefView({ data }: { data: any }) {
  return (
    <div className="space-y-4">
      <SectionCard title="Round Status" icon={<Target className="w-4 h-4" />}>
        <StatRow label="Target Amount"    value={fmtM(data.round_status.target_amount)} />
        <StatRow label="Committed"        value={`${fmtM(data.round_status.committed_amount)} (${data.round_status.pct_to_target}%)`} highlight />
        <StatRow label="Weighted Pipeline" value={fmtM(data.round_status.weighted_pipeline)} />
        <StatRow label="Status"           value={data.round_status.status} />
        <StatRow label="Target Close"     value={fmtDate(data.round_status.target_close_date)} />
        <PctBar value={data.round_status.pct_to_target} />
      </SectionCard>

      <SectionCard title="Pipeline Momentum" icon={<TrendingUp className="w-4 h-4" />}>
        <div className="grid grid-cols-3 gap-3 mb-3">
          {[
            { label: "Active", value: data.pipeline_momentum.total_active },
            { label: "Committed", value: data.pipeline_momentum.committed_count },
            { label: "Diligence", value: data.pipeline_momentum.diligence_count },
          ].map(s => (
            <div key={s.label} className="bg-muted/40 rounded-lg p-3 text-center">
              <p className="text-xl font-bold">{s.value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
        <StatRow label="Soft Circle" value={data.pipeline_momentum.soft_circle_count} />
        <StatRow label="New this week" value={data.pipeline_momentum.new_this_week} />
        {data.pipeline_momentum.hot_leads.length > 0 && (
          <div className="mt-2">
            <p className="text-xs text-muted-foreground mb-1.5">Hot Leads</p>
            <div className="space-y-1">
              {data.pipeline_momentum.hot_leads.map((l: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground w-4">{i + 1}.</span>
                  <span className="font-medium flex-1 truncate">{l.name}</span>
                  <Badge className="text-[9px] bg-amber-500/15 text-amber-400 border-amber-500/20">{l.stage}</Badge>
                  {l.target_amount && <span className="text-muted-foreground shrink-0">{fmtM(l.target_amount)}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard title="This Week's Priorities" icon={<Zap className="w-4 h-4" />}>
        {data.this_week_priority.actions.length === 0
          ? <p className="text-xs text-muted-foreground italic">No priority actions found.</p>
          : (
            <ul className="space-y-2">
              {data.this_week_priority.actions.map((a: any, i: number) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <Badge className={`text-[9px] mt-0.5 shrink-0 ${a.priority === "High" || a.priority === "Critical" ? "bg-red-500/15 text-red-400 border-red-500/20" : "bg-amber-500/15 text-amber-400 border-amber-500/20"}`}>
                    {a.priority}
                  </Badge>
                  <span>
                    <span className="font-medium">{a.investor_name}</span>
                    {" — "}{a.action}
                    {a.reason && <span className="text-muted-foreground"> ({a.reason})</span>}
                  </span>
                </li>
              ))}
            </ul>
          )
        }
        {data.this_week_priority.total_actions > 5 && (
          <p className="text-[10px] text-muted-foreground mt-2">
            +{data.this_week_priority.total_actions - 5} more actions
          </p>
        )}
      </SectionCard>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard title="Risk Flags" icon={<AlertTriangle className="w-4 h-4" />}>
          {data.risk_flags.critical.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] font-medium text-red-400 uppercase tracking-wide mb-1.5">Critical</p>
              <FlagList flags={data.risk_flags.critical} severity="critical" />
            </div>
          )}
          {data.risk_flags.warning.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-amber-400 uppercase tracking-wide mb-1.5">Warnings</p>
              <FlagList flags={data.risk_flags.warning.slice(0, 4)} severity="warning" />
            </div>
          )}
          {data.risk_flags.critical.length === 0 && data.risk_flags.warning.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No risk flags — all clear.</p>
          )}
        </SectionCard>

        <SectionCard title="Engagement Pulse" icon={<Activity className="w-4 h-4" />}>
          <StatRow label="Highly Engaged" value={data.engagement_pulse.highly_engaged_count} />
          <StatRow label="Engaged"        value={data.engagement_pulse.engaged_count} />
          <StatRow label="Cold"           value={data.engagement_pulse.cold_count} />
          <div className="border-t border-border mt-2 pt-2">
            <StatRow label="Portal Opens (7d)"    value={data.engagement_pulse.portal_opens_7d} />
            <StatRow label="Material Views (7d)"  value={data.engagement_pulse.material_views_7d} />
            <StatRow label="Inbound Replies (7d)" value={data.engagement_pulse.recent_inbound_replies} />
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Data Room" icon={<FileText className="w-4 h-4" />}>
        <div className="flex flex-wrap gap-3 mb-3">
          {[
            { label: "Pitch Deck",       ok: data.data_room_status.has_pitch_deck },
            { label: "Financial Model",  ok: data.data_room_status.has_financial_model },
          ].map(item => (
            <div key={item.label} className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border ${item.ok ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"}`}>
              {item.ok ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
              {item.label}
            </div>
          ))}
        </div>
        <StatRow label="Active Materials"  value={data.data_room_status.active_materials} />
        <StatRow label="Stale Shares"      value={data.data_room_status.stale_shares} />
        <StatRow label="Pending Requests"  value={data.data_room_status.pending_requests} />
        <StatRow label="Overdue Requests"  value={data.data_room_status.overdue_requests} />
      </SectionCard>
    </div>
  );
}

// ── Board Update ──────────────────────────────────────────────────────────────

function BoardUpdateView({ data }: { data: any }) {
  const h = data.round_headline;
  const v = data.valuation_summary;
  const rs = data.risk_summary;

  return (
    <div className="space-y-4">
      <SectionCard title="Round Headline" icon={<Target className="w-4 h-4" />}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-0">
          <StatRow label="Target"        value={fmtM(h.target_amount)} />
          <StatRow label="Committed"     value={fmtM(h.committed_amount)} highlight />
          {h.min_close_target && <StatRow label="Minimum Close" value={fmtM(h.min_close_target)} />}
          <StatRow label="Wired"         value={fmtM(h.wired_amount)} />
          <StatRow label="Weighted"      value={fmtM(h.weighted_pipeline)} />
          <StatRow label="Progress"      value={`${h.pct_to_target}% to target`} />
        </div>
        <PctBar value={h.pct_to_target} />
        <div className="mt-3 grid grid-cols-2 gap-3">
          {h.runway_today_months != null && (
            <div className="bg-muted/40 rounded-lg p-3 text-center">
              <p className="text-xl font-bold">{h.runway_today_months}mo</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Runway Today</p>
            </div>
          )}
          {h.runway_after_target_months != null && (
            <div className="bg-muted/40 rounded-lg p-3 text-center">
              <p className="text-xl font-bold">{h.runway_after_target_months}mo</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Runway After Raise</p>
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Valuation" icon={<BarChart3 className="w-4 h-4" />}>
        {!v.has_valuation_data ? (
          <p className="text-xs text-muted-foreground italic">Valuation terms not yet configured.</p>
        ) : (
          <>
            <StatRow label="Instrument"    value={v.instrument ?? "—"} />
            <StatRow label="Pre-Money"     value={fmtM(v.pre_money)} />
            <StatRow label="Effective Val" value={fmtM(v.effective_valuation)} />
            {v.new_investor_ownership_pct != null && (
              <StatRow label="Investor Ownership" value={`${v.new_investor_ownership_pct}%`} />
            )}
            {v.valuation_cap && <StatRow label="Valuation Cap" value={fmtM(v.valuation_cap)} />}
            {v.scenario_range && (
              <StatRow label="Scenario Range" value={`${fmtM(v.scenario_range.min_amount)} — ${fmtM(v.scenario_range.max_amount)}`} />
            )}
            {v.warnings.length > 0 && (
              <div className="mt-2">
                <FlagList flags={v.warnings} severity="warning" />
              </div>
            )}
          </>
        )}
      </SectionCard>

      <SectionCard title="Investor Pipeline" icon={<Users className="w-4 h-4" />}>
        <div className="overflow-x-auto -mx-4">
          <table className="w-full text-xs" data-testid="pipeline-table">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Investor</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Stage</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Priority</th>
                <th className="text-right px-4 py-2 text-muted-foreground font-medium">Target</th>
                <th className="text-right px-4 py-2 text-muted-foreground font-medium">Committed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.pipeline_table.slice(0, 15).map((inv: any, i: number) => (
                <tr key={i}>
                  <td className="px-4 py-2 font-medium truncate max-w-[140px]">{inv.investor_name}</td>
                  <td className="px-4 py-2">
                    <Badge className="text-[9px] bg-muted/60 text-muted-foreground border-border">{inv.stage}</Badge>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{inv.priority}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtM(inv.target_amount)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtM(inv.commitment_amount)}</td>
                </tr>
              ))}
              {data.pipeline_table.length > 15 && (
                <tr>
                  <td colSpan={5} className="px-4 py-2 text-center text-muted-foreground italic text-[10px]">
                    …{data.pipeline_table.length - 15} more investors
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard title="Data Room & Portal" icon={<FileText className="w-4 h-4" />}>
          <StatRow label="Active Portals"          value={data.data_room_portal.active_portals} />
          <StatRow label="Portal Views (7d)"       value={data.data_room_portal.portal_opens_7d} />
          <StatRow label="Material Views (7d)"     value={data.data_room_portal.material_views_7d} />
          <StatRow label="Pitch Deck"              value={data.data_room_portal.pitch_deck_ready ? "✓ Ready" : "✗ Missing"} />
          <StatRow label="Financial Model"         value={data.data_room_portal.financial_model_ready ? "✓ Ready" : "✗ Missing"} />
          <StatRow label="Missing Key Materials"   value={data.data_room_portal.investors_missing_key_materials} />
        </SectionCard>

        <SectionCard title="Risk Summary" icon={<AlertTriangle className="w-4 h-4" />}>
          {rs.critical_flags.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] font-medium text-red-400 uppercase tracking-wide mb-1.5">Critical ({rs.critical_flags.length})</p>
              <FlagList flags={rs.critical_flags} severity="critical" />
            </div>
          )}
          {rs.warning_flags.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-amber-400 uppercase tracking-wide mb-1.5">Warnings ({rs.warning_flags.length})</p>
              <FlagList flags={rs.warning_flags.slice(0, 3)} severity="warning" />
            </div>
          )}
          {rs.total_flags === 0 && <p className="text-xs text-muted-foreground italic">No risk flags.</p>}
        </SectionCard>
      </div>

      {data.management_asks.length > 0 && (
        <SectionCard title="Management Asks" icon={<ChevronRight className="w-4 h-4" />}>
          <ul className="space-y-1.5">
            {data.management_asks.map((ask: string, i: number) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <ChevronRight className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                {ask}
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}

// ── CFO Closing ───────────────────────────────────────────────────────────────

function CfoClosingView({ data }: { data: any }) {
  const s = data.close_summary;
  return (
    <div className="space-y-4">
      <SectionCard title="Close Summary" icon={<ClipboardList className="w-4 h-4" />}>
        <div className="grid grid-cols-2 gap-3 mb-3">
          {[
            { label: "Total in Close", value: fmtM(s.total_in_close), highlight: true },
            { label: "Wired",          value: fmtM(s.wired_amount) },
            { label: "Docs Signed",    value: s.docs_signed + " inv." },
            { label: "Docs Sent",      value: s.docs_sent + " inv." },
            { label: "Funds Pending",  value: s.funds_pending + " inv." },
            { label: "Not Started",    value: s.not_started + " inv." },
          ].map(item => (
            <div key={item.label} className="bg-muted/40 rounded-lg p-3">
              <p className={`text-sm font-bold ${item.highlight ? "text-primary" : ""}`}>{item.value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{item.label}</p>
            </div>
          ))}
        </div>
        <StatRow label="% to Target"       value={`${s.pct_to_target}%`} highlight />
        {s.pct_to_min_close != null && <StatRow label="% to Minimum Close" value={`${s.pct_to_min_close}%`} />}
        <PctBar value={s.pct_to_target} />
      </SectionCard>

      {data.close_plan_groups.length > 0 && (
        <SectionCard title="Close Plan Groups" icon={<Target className="w-4 h-4" />}>
          <div className="space-y-2">
            {data.close_plan_groups.map((g: any, i: number) => (
              <div key={i} className="flex items-center gap-3 text-xs">
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{g.label} ({g.count})</p>
                  <p className="text-muted-foreground truncate">{g.investors.slice(0, 3).join(", ")}{g.count > 3 ? ` +${g.count - 3}` : ""}</p>
                </div>
                <span className="font-bold tabular-nums shrink-0">{fmtM(g.total_amount)}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard title="Allocation Table" icon={<Users className="w-4 h-4" />}>
        <div className="overflow-x-auto -mx-4">
          <table className="w-full text-xs" data-testid="allocation-table">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Investor</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Stage</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Closing</th>
                <th className="text-right px-4 py-2 text-muted-foreground font-medium">Amount</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Docs Signed</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Wired</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.allocation_table.map((row: any, i: number) => (
                <tr key={i}>
                  <td className="px-4 py-2 font-medium truncate max-w-[130px]">{row.investor_name}</td>
                  <td className="px-4 py-2 text-muted-foreground">{row.stage}</td>
                  <td className="px-4 py-2">
                    <Badge className={`text-[9px] ${row.closing_status === "wired" || row.closing_status === "closed" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" : "bg-muted/60 text-muted-foreground border-border"}`}>
                      {row.closing_status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtM(row.committed_amount)}</td>
                  <td className="px-4 py-2 text-muted-foreground">{fmtDate(row.docs_signed_at)}</td>
                  <td className="px-4 py-2 text-muted-foreground">{fmtDate(row.funds_received_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {data.checklist_items.length > 0 && (
        <SectionCard title="Closing Checklist" icon={<CheckCircle2 className="w-4 h-4" />}>
          <div className="space-y-1.5">
            {data.checklist_items.map((item: any, i: number) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className={`mt-0.5 shrink-0 ${item.complete ? "text-emerald-400" : "text-muted-foreground"}`}>
                  {item.complete ? <CheckCircle2 className="w-3.5 h-3.5" /> : <div className="w-3.5 h-3.5 rounded-full border border-muted-foreground/40" />}
                </span>
                <span className={item.complete ? "text-muted-foreground line-through" : ""}>
                  {item.label}
                  {item.note && <span className="text-muted-foreground not-italic"> — {item.note}</span>}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {data.runway_scenarios.length > 0 && (
        <SectionCard title="Runway Scenarios" icon={<BarChart3 className="w-4 h-4" />}>
          <div className="space-y-2">
            {data.runway_scenarios.map((sc: any, i: number) => (
              <div key={i} className="flex items-center gap-3 text-xs">
                <span className="flex-1 font-medium">{sc.name}</span>
                <span className="text-muted-foreground tabular-nums">{fmtM(sc.amount)}</span>
                <Badge className="bg-primary/10 text-primary border-primary/20 text-[9px]">
                  {sc.runway_added_months != null ? `+${sc.runway_added_months}mo runway` : "—"}
                </Badge>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {data.valuation_warnings.length > 0 && (
        <SectionCard title="Valuation Warnings" icon={<AlertTriangle className="w-4 h-4" />}>
          <FlagList flags={data.valuation_warnings} severity="warning" />
        </SectionCard>
      )}
    </div>
  );
}

// ── Engagement ────────────────────────────────────────────────────────────────

function EngagementView({ data }: { data: any }) {
  const a = data.analytics;
  return (
    <div className="space-y-4">
      <SectionCard title="Engagement Summary" icon={<Activity className="w-4 h-4" />}>
        <div className="grid grid-cols-3 gap-3 mb-3">
          {[
            { label: "Highly Engaged", value: a.highly_engaged_count, cls: "text-rose-400" },
            { label: "Engaged",        value: a.engaged_count,        cls: "text-emerald-400" },
            { label: "Cold",           value: a.cold_count,           cls: "text-muted-foreground" },
          ].map(s => (
            <div key={s.label} className="bg-muted/40 rounded-lg p-3 text-center">
              <p className={`text-xl font-bold ${s.cls}`}>{s.value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
        <StatRow label="Total Investors" value={a.total_investors} />
        <StatRow label="Watching"        value={a.watching_count} />
        <StatRow label="Stale"           value={a.stale_count} />
        <div className="border-t border-border mt-2 pt-2">
          <StatRow label="Portal Opens (7d)"    value={a.portal_opens_7d} />
          <StatRow label="Material Views (7d)"  value={a.material_views_7d} />
          <StatRow label="Downloads (7d)"       value={a.material_downloads_7d} />
          <StatRow label="Inbound Replies (7d)" value={a.recent_inbound_replies} />
        </div>
        {(a.no_engagement_after_portal > 0 || a.hot_with_stale_followup > 0) && (
          <div className="mt-2 space-y-1">
            {a.no_engagement_after_portal > 0 && (
              <FlagList flags={[`${a.no_engagement_after_portal} investors have portal access but no engagement`]} severity="warning" />
            )}
            {a.hot_with_stale_followup > 0 && (
              <FlagList flags={[`${a.hot_with_stale_followup} hot investors with no follow-up in 7+ days`]} severity="warning" />
            )}
          </div>
        )}
      </SectionCard>

      {data.top_engaged.length > 0 && (
        <SectionCard title="Top Engaged Investors" icon={<TrendingUp className="w-4 h-4" />}>
          <div className="space-y-2">
            {data.top_engaged.map((inv: any) => (
              <div key={inv.rank} className="flex items-center gap-2 text-xs" data-testid={`eng-row-${inv.rank}`}>
                <span className="text-muted-foreground w-4 text-right shrink-0">{inv.rank}.</span>
                <span className="font-medium flex-1 truncate">{inv.investor_name}</span>
                <Badge className="text-[9px] bg-muted/60 text-muted-foreground border-border shrink-0">{inv.stage}</Badge>
                <Badge className={`text-[9px] shrink-0 ${inv.engagement_tier === "Highly Engaged" ? "bg-rose-500/15 text-rose-400 border-rose-500/20" : "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"}`}>
                  {inv.engagement_tier}
                </Badge>
                <span className="text-muted-foreground w-6 text-right shrink-0 tabular-nums">{inv.engagement_score}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {data.material_leaderboard.length > 0 && (
        <SectionCard title="Material Leaderboard" icon={<FileText className="w-4 h-4" />}>
          <div className="space-y-2">
            {data.material_leaderboard.map((m: any) => (
              <div key={m.rank} className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground w-4 text-right shrink-0">{m.rank}.</span>
                <span className="flex-1 font-medium truncate">{m.material_title}</span>
                <Badge className="text-[9px] bg-violet-500/15 text-violet-400 border-violet-500/20 shrink-0">{m.material_type.replace(/_/g, " ")}</Badge>
                <span className="text-muted-foreground shrink-0">{m.total_views}v / {m.total_downloads}d</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard title="Portal Summary" icon={<Shield className="w-4 h-4" />}>
          <StatRow label="Active Portals"            value={data.portal_summary.active_portals} />
          <StatRow label="Never Opened"             value={data.portal_summary.portals_never_opened} />
          <StatRow label="Without Portal"           value={data.portal_summary.investors_without_portal} />
          <StatRow label="Views (7d)"               value={data.portal_summary.total_views_7d} />
          <StatRow label="Downloads (7d)"           value={data.portal_summary.total_downloads_7d} />
        </SectionCard>

        {data.stale_investors.length > 0 && (
          <SectionCard title="Stale / Cold Investors" icon={<AlertTriangle className="w-4 h-4" />}>
            <div className="space-y-1.5">
              {data.stale_investors.slice(0, 6).map((inv: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="flex-1 font-medium truncate">{inv.investor_name}</span>
                  <Badge className="text-[9px] bg-muted/60 text-muted-foreground border-border shrink-0">{inv.stage}</Badge>
                  <span className="text-muted-foreground shrink-0 text-[9px]">
                    {inv.last_contact ? fmtDate(inv.last_contact) : "Never"}
                  </span>
                </div>
              ))}
            </div>
          </SectionCard>
        )}
      </div>

      {data.follow_up_recommendations.length > 0 && (
        <SectionCard title="Follow-Up Recommendations" icon={<Zap className="w-4 h-4" />}>
          <ul className="space-y-2">
            {data.follow_up_recommendations.map((f: any, i: number) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <Badge className={`text-[9px] mt-0.5 shrink-0 ${f.priority === "High" || f.priority === "Critical" ? "bg-red-500/15 text-red-400 border-red-500/20" : "bg-amber-500/15 text-amber-400 border-amber-500/20"}`}>
                  {f.priority}
                </Badge>
                <span>
                  <span className="font-medium">{f.investor_name}</span> ({f.stage})
                  {" — "}{f.recommended_action}
                  {f.reason && <span className="text-muted-foreground"> — {f.reason}</span>}
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}

// ── Report type selector cards ─────────────────────────────────────────────────

const REPORT_ICONS: Record<ReportType, React.ReactNode> = {
  weekly_brief: <Zap className="w-5 h-5" />,
  board_update: <Shield className="w-5 h-5" />,
  cfo_closing:  <ClipboardList className="w-5 h-5" />,
  engagement:   <Activity className="w-5 h-5" />,
};

// ── Page ───────────────────────────────────────────────────────────────────────

export default function CapitalReportsPage() {
  const [location] = useLocation();
  const params     = new URLSearchParams(location.includes("?") ? location.split("?")[1] : "");
  const { toast }  = useToast();

  const [selectedType, setSelectedType] = useState<ReportType>(
    (params.get("type") as ReportType) || "weekly_brief",
  );
  const [selectedRoundId, setSelectedRoundId] = useState<number | null>(
    params.get("round_id") ? Number(params.get("round_id")) : null,
  );
  const [includeSensitive, setIncludeSensitive] = useState(false);
  const [generatedData, setGeneratedData]       = useState<any | null>(null);
  const [isGenerating, setIsGenerating]         = useState(false);
  const [markdown, setMarkdown]                 = useState<string | null>(null);

  // Fetch report metadata (types + rounds)
  const { data: meta, isLoading: metaLoading } = useQuery<ReportMeta>({
    queryKey: ["/api/capital/reports"],
    queryFn: () => fetch("/api/capital/reports", { credentials: "include" }).then(r => r.json()),
  });

  const rounds: Round[] = meta?.rounds ?? [];
  const activeRoundId   = selectedRoundId ?? rounds[0]?.id ?? null;
  const currentMeta     = meta?.report_types[selectedType];

  async function handleGenerate() {
    if (!activeRoundId) return;
    setIsGenerating(true);
    setGeneratedData(null);
    setMarkdown(null);
    try {
      const params = new URLSearchParams({
        round_id:          String(activeRoundId),
        include_sensitive: String(includeSensitive),
      });
      const r = await fetch(`/api/capital/reports/${selectedType}?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      const json = await r.json();
      setGeneratedData(json);
    } catch (err: any) {
      toast({ title: "Report failed", description: err.message, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleCopyMarkdown() {
    if (!activeRoundId) return;
    try {
      const params = new URLSearchParams({
        round_id:          String(activeRoundId),
        include_sensitive: String(includeSensitive),
        format:            "markdown",
      });
      const r = await fetch(`/api/capital/reports/${selectedType}?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      const text = await r.text();
      await navigator.clipboard.writeText(text);
      toast({ title: "Markdown copied", description: "Paste into Notion, Docs, or email." });
    } catch (err: any) {
      toast({ title: "Copy failed", description: err.message, variant: "destructive" });
    }
  }

  async function handleExportCsv() {
    if (!activeRoundId) return;
    try {
      const params = new URLSearchParams({
        round_id:          String(activeRoundId),
        include_sensitive: String(includeSensitive),
        format:            "csv",
      });
      const r = await fetch(`/api/capital/reports/${selectedType}?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      const blob = await r.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `capital-${selectedType}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    }
  }

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-6" data-testid="capital-reports-page">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-primary/10 rounded-lg shrink-0">
            <FileBarChart2 className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Capital Reports</h1>
            <p className="text-xs text-muted-foreground">Board-ready and CFO-ready reporting packs — Trevor &amp; Scott only</p>
          </div>
        </div>
      </div>

      {metaLoading && <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>}

      {meta && (
        <>
          {/* Report type selector */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="report-type-selector">
            {(Object.keys(meta.report_types) as ReportType[]).map(type => {
              const m = meta.report_types[type];
              const isActive = type === selectedType;
              return (
                <button
                  key={type}
                  data-testid={`report-type-${type}`}
                  onClick={() => { setSelectedType(type); setGeneratedData(null); }}
                  className={`text-left p-3.5 rounded-xl border transition-all ${
                    isActive
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border bg-card hover:border-border/80 hover:bg-muted/30"
                  }`}
                >
                  <div className={`mb-2 ${isActive ? "text-primary" : "text-muted-foreground"}`}>
                    {REPORT_ICONS[type]}
                  </div>
                  <p className="text-xs font-semibold leading-tight">{m.title}</p>
                  <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{m.audience}</p>
                </button>
              );
            })}
          </div>

          {/* Controls */}
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-xs text-muted-foreground shrink-0">Round:</span>
                <Select
                  value={String(activeRoundId ?? "")}
                  onValueChange={v => setSelectedRoundId(Number(v))}
                >
                  <SelectTrigger className="h-8 text-xs flex-1" data-testid="report-round-selector">
                    <SelectValue placeholder="Select round" />
                  </SelectTrigger>
                  <SelectContent>
                    {rounds.map(r => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        {r.name} — {r.status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Switch
                  id="include-sensitive"
                  checked={includeSensitive}
                  onCheckedChange={setIncludeSensitive}
                  data-testid="toggle-include-sensitive"
                />
                <Label htmlFor="include-sensitive" className="text-xs text-muted-foreground cursor-pointer">
                  Include sensitive
                </Label>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  onClick={handleGenerate}
                  disabled={isGenerating || !activeRoundId}
                  data-testid="btn-generate-report"
                  className="gap-1.5"
                >
                  {isGenerating
                    ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Generating…</>
                    : <><BarChart3 className="w-3.5 h-3.5" /> Generate</>
                  }
                </Button>
                {generatedData && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCopyMarkdown}
                      data-testid="btn-copy-markdown"
                      className="gap-1.5"
                    >
                      <Copy className="w-3.5 h-3.5" /> Markdown
                    </Button>
                    {currentMeta?.has_csv && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleExportCsv}
                        data-testid="btn-export-csv"
                        className="gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5" /> CSV
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>

            {currentMeta && (
              <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
                <span className="font-medium text-foreground">{currentMeta.title}</span>
                {" — "}{currentMeta.description}
              </p>
            )}
          </div>

          {/* Warnings */}
          {generatedData?.warnings?.length > 0 && (
            <div className="text-xs space-y-1">
              {generatedData.warnings.map((w: string, i: number) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  {w}
                </div>
              ))}
            </div>
          )}

          {/* Report preview */}
          {generatedData && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="flex-1 h-px bg-border" />
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest px-2">
                  {generatedData.report_title} — {new Date(generatedData.generated_at).toLocaleString()}
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>

              {selectedType === "weekly_brief" && <WeeklyBriefView data={generatedData} />}
              {selectedType === "board_update"  && <BoardUpdateView data={generatedData} />}
              {selectedType === "cfo_closing"   && <CfoClosingView  data={generatedData} />}
              {selectedType === "engagement"    && <EngagementView  data={generatedData} />}
            </div>
          )}

          {!generatedData && !isGenerating && (
            <div className="text-center py-16 text-muted-foreground" data-testid="empty-state">
              <FileBarChart2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select a report type and click <strong>Generate</strong></p>
              <p className="text-xs mt-1">Reports are generated on-demand and not stored.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
