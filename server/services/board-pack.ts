/**
 * Board Pack — Phase 10 Service
 * CEO/CFO-only operating pack builder.
 * No auto-send. No external API. No AI dependency.
 * Pulls from CEO Cockpit (Phase 5/6/7/8) + CRM data.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { composeReport } from "./report-composer";
import {
  buildExecutionScorecard,
  detectExecutionDrift,
  buildCommitmentsRadar,
  buildRecurringRiskPatterns,
} from "./ceo-execution-intelligence";
import { listCeoActions } from "./ceo-action-loop";

// ── CEO/CFO Access ────────────────────────────────────────────────────────────

const BOARD_PACK_USER_IDS = new Set([4]); // Trevor (CEO)
const BOARD_PACK_USER_EMAILS = new Set<string>([
  "scott.carlson@voltsafe.com", // CFO — Scott Carlson
]);

export function isBoardPackUser(userId: number, userEmail: string | null | undefined): boolean {
  if (BOARD_PACK_USER_IDS.has(userId)) return true;
  if (userEmail && BOARD_PACK_USER_EMAILS.has(userEmail.toLowerCase())) return true;
  return false;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type PackType = "board" | "investor" | "lender" | "grant" | "internal_exec";
export type PackStatus = "draft" | "finalized" | "archived";

export type BoardPackOptions = {
  packType?: PackType;
  dateFrom?: string;
  dateTo?: string;
  title?: string;
  notes?: string;
};

export type WhatChangedSummary = {
  new_blockers: number;
  resolved_blockers: number;
  new_overdue_commitments: number;
  completed_commitments: number;
  pipeline_movement: string;
  capital_movement: string;
  new_risks: number;
  new_wins: number;
  action_queue_movement: string;
  no_previous_pack: boolean;
};

export type ExecutiveSummarySection = {
  bullets: string[];
  top_wins: string[];
  top_risks: string[];
  top_ceo_asks: string[];
  next_30_day_priorities: string[];
  what_changed: WhatChangedSummary | null;
};

export type CompanyScorecardSection = {
  execution_health_score: number;
  execution_health_label: string;
  open_blockers: number;
  overdue_commitments: number;
  completed_commitments: number;
  stale_tasks: number;
  high_priority_ceo_actions: number;
  total_pipeline: number;
  closed_won_amount: number;
  win_rate: number;
  week_over_week_note: string;
};

export type RevenuePipelineSection = {
  total_pipeline: number;
  weighted_pipeline: number;
  top_opportunities: Array<{ name: string; amount: number; stage: string; close_date: string | null }>;
  stale_opportunities: number;
  hot_accounts: number;
  closed_won_amount: number;
  win_rate: number;
  quote_sent: number;
  quote_accepted: number;
  revenue_blockers: string[];
};

export type CapitalFundingSection = {
  raise_status: string;
  target_raise_amount: number | null;
  total_investors: number;
  active_conversations: number;
  committed_capital: number;
  soft_circled: number;
  grant_opportunities: number;
  next_investor_actions: string[];
  funding_risks: string[];
  key_asks: string[];
};

export type ProductOperationsSection = {
  total_installs: number;
  installs_in_progress: number;
  flagged_deployments: number;
  stalled_workflows: number;
  cert_blocked: number;
  cert_at_risk: number;
  procurement_low_stock: number;
  product_risks: string[];
  operational_blockers: string[];
};

export type TeamAccountabilitySection = {
  team_pulse_summary: string;
  open_commitments: number;
  missed_commitments: number;
  completed_commitments: number;
  owner_load_risks: Array<{ name: string; overdue_count: number }>;
  support_needed: string[];
};

export type RisksDecisionsSection = {
  critical_drift_items: Array<{ section: string; severity: string; summary: string }>;
  recurring_risks: Array<{ owner: string; pattern: string; count: number }>;
  unresolved_blockers: number;
  capital_risks: string[];
  revenue_risks: string[];
  product_risks: string[];
  decisions_needed: string[];
};

export type WinsMomentumSection = {
  completed_high_priority_actions: number;
  resolved_blockers: number;
  customer_movement: string[];
  partner_movement: string[];
  product_milestones: string[];
  funding_progress: string[];
  team_wins: string[];
};

export type Next306090Section = {
  next_30_days: string[];
  next_60_days: string[];
  next_90_days: string[];
};

export type BoardInvestorAsksSection = {
  intros_needed: string[];
  funding_asks: string[];
  customer_introductions: string[];
  hiring_advisor_needs: string[];
  technical_compliance_support: string[];
  government_grant_support: string[];
  partnership_support: string[];
};

export type BoardPackSections = {
  executive_summary: ExecutiveSummarySection;
  company_scorecard: CompanyScorecardSection;
  revenue_pipeline: RevenuePipelineSection;
  capital_funding: CapitalFundingSection | null;
  product_operations: ProductOperationsSection;
  team_accountability: TeamAccountabilitySection;
  risks_decisions: RisksDecisionsSection;
  wins_momentum: WinsMomentumSection;
  next_30_60_90: Next306090Section;
  board_investor_asks: BoardInvestorAsksSection;
};

export type BuiltBoardPack = {
  meta: {
    pack_type: PackType;
    generated_at: string;
    date_from: string | null;
    date_to: string | null;
    generated_by: string;
    has_capital: boolean;
  };
  sections: BoardPackSections;
};

export type BoardPackRecord = {
  id: number;
  title: string;
  pack_type: PackType;
  status: PackStatus;
  date_from: string | null;
  date_to: string | null;
  sections_data: BoardPackSections | null;
  notes: string | null;
  created_by: number | null;
  created_at: string;
  finalized_at: string | null;
  archived_at: string | null;
  previous_pack_id: number | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeRows(res: any): any[] {
  return (res?.rows ?? []) as any[];
}

function n(v: any): number {
  const x = Number(v);
  return isNaN(x) ? 0 : x;
}

function esc(v: string): string {
  return String(v).replace(/'/g, "''");
}

function fmtAmt(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val}`;
}

function extractWins(scorecardData: any, actions: any[]): string[] {
  const wins: string[] = [];
  const completed = actions.filter((a: any) => a.status === "completed" || a.status === "done");
  if (completed.length > 0) wins.push(`${completed.length} CEO action(s) completed`);
  if (scorecardData?.score != null && scorecardData.score >= 70) {
    wins.push(`Execution score at ${scorecardData.score}/100 (${scorecardData.label})`);
  }
  return wins.slice(0, 5);
}

function extractTopRisks(scorecardData: any, driftData: any): string[] {
  const risks: string[] = [];
  const sc = scorecardData as any;
  if (sc?.metrics?.open_blockers > 0) risks.push(`${sc.metrics.open_blockers} open blocker(s) unresolved`);
  if (sc?.metrics?.overdue_commitments > 0) risks.push(`${sc.metrics.overdue_commitments} commitment(s) drifting`);
  const critical = (driftData as any)?.items?.filter((i: any) => i.severity === "critical").length ?? 0;
  if (critical > 0) risks.push(`${critical} critical drift item(s) detected`);
  return risks.slice(0, 5);
}

// ── Capital Data ──────────────────────────────────────────────────────────────

async function fetchCapitalData(): Promise<CapitalFundingSection> {
  const [investorsRes, roundsRes, grantsRes] = await Promise.all([
    db.execute(sql.raw(`
      SELECT status, committed_amount, soft_circle_amount
      FROM capital_investors
      WHERE status NOT IN ('passed', 'archived')
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 100
    `)).catch(() => ({ rows: [] })),
    db.execute(sql.raw(`
      SELECT raise_status, target_amount, current_amount
      FROM capital_rounds
      WHERE is_active = true OR closed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `)).catch(() => ({ rows: [] })),
    db.execute(sql.raw(`
      SELECT COUNT(*) AS cnt
      FROM capital_grants
      WHERE status NOT IN ('closed', 'rejected')
    `)).catch(() => ({ rows: [] })),
  ]);

  const investors = safeRows(investorsRes);
  const activeConversations = investors.filter((i: any) =>
    ["meeting_scheduled", "term_sheet", "due_diligence", "active", "interested"].includes(i.status)
  ).length;
  const committed = investors.reduce((s: number, i: any) => s + n(i.committed_amount), 0);
  const softCircled = investors.reduce((s: number, i: any) => s + n(i.soft_circle_amount), 0);
  const round = safeRows(roundsRes)[0] as any;
  const grantCount = n(safeRows(grantsRes)[0]?.cnt ?? 0);

  const targetAmt = round?.target_amount ? n(round.target_amount) : null;

  return {
    raise_status: round?.raise_status ?? "Active",
    target_raise_amount: targetAmt,
    total_investors: investors.length,
    active_conversations: activeConversations,
    committed_capital: committed,
    soft_circled: softCircled,
    grant_opportunities: grantCount,
    next_investor_actions: activeConversations > 0
      ? [`Follow up with ${activeConversations} active investor conversation(s)`]
      : ["Identify new investor prospects"],
    funding_risks: committed === 0 && activeConversations === 0
      ? ["No active investor conversations — capital pipeline stalled"]
      : [],
    key_asks: [
      "Investor introductions to strategic angels or institutional leads",
      targetAmt ? `Targeting ${fmtAmt(targetAmt)} raise` : "Define target raise amount",
    ],
  };
}

// ── Top Opportunities ─────────────────────────────────────────────────────────

async function fetchTopOpportunities(dateFrom?: string, dateTo?: string): Promise<RevenuePipelineSection["top_opportunities"]> {
  try {
    const res = await db.execute(sql.raw(`
      SELECT o.name, o.amount, o.stage, o.expected_close_date
      FROM opportunities o
      WHERE o.stage NOT IN ('closed_lost', 'closed_won')
        AND (o.amount IS NULL OR o.amount > 0)
      ORDER BY COALESCE(o.amount, 0) DESC NULLS LAST
      LIMIT 5
    `));
    return safeRows(res).map((r: any) => ({
      name: String(r.name ?? ""),
      amount: n(r.amount),
      stage: String(r.stage ?? ""),
      close_date: r.expected_close_date ? String(r.expected_close_date) : null,
    }));
  } catch {
    return [];
  }
}

// ── Build Board Pack ──────────────────────────────────────────────────────────

export async function buildBoardPack(
  actorUser: { id: number; name: string; hasCapital: boolean },
  options: BoardPackOptions = {},
): Promise<BuiltBoardPack> {
  const { packType = "board", dateFrom, dateTo } = options;

  const [crmData, scorecardData, driftData, commitmentsData, recurringRisks, ceoActions, capitalData, topOpps] = await Promise.all([
    composeReport("board_pack", { dateFrom, dateTo }).catch(() => null),
    buildExecutionScorecard(actorUser).catch(() => null),
    detectExecutionDrift(actorUser).catch(() => null),
    buildCommitmentsRadar(actorUser).catch(() => null),
    buildRecurringRiskPatterns(actorUser).catch(() => null),
    listCeoActions(actorUser.id, { status: "open", limit: 50 } as any).catch(() => [] as any[]),
    actorUser.hasCapital ? fetchCapitalData().catch(() => null) : Promise.resolve(null),
    fetchTopOpportunities(dateFrom, dateTo).catch(() => [] as RevenuePipelineSection["top_opportunities"]),
  ]);

  const ceoActionsArr = (ceoActions ?? []) as any[];
  const highPriorityActions = ceoActionsArr.filter((a: any) => a.priority === "high" && a.status === "open");
  const driftItems = (driftData as any)?.items ?? [];

  // ─── A. Executive Summary ─────────────────────────────────────────────────
  const executiveSummary: ExecutiveSummarySection = {
    bullets: (crmData?.narrativeBullets ?? []).slice(0, 10),
    top_wins: extractWins(scorecardData, ceoActionsArr),
    top_risks: extractTopRisks(scorecardData, driftData),
    top_ceo_asks: highPriorityActions.slice(0, 3).map((a: any) => a.title),
    next_30_day_priorities: ceoActionsArr
      .filter((a: any) => a.status === "open")
      .slice(0, 5)
      .map((a: any) => a.title),
    what_changed: null,
  };

  // ─── B. Company Scorecard ─────────────────────────────────────────────────
  const sc = scorecardData as any;
  const companyScorecard: CompanyScorecardSection = {
    execution_health_score: sc?.score ?? 0,
    execution_health_label: sc?.label ?? "Unknown",
    open_blockers: sc?.metrics?.open_blockers ?? 0,
    overdue_commitments: sc?.metrics?.overdue_commitments ?? 0,
    completed_commitments: sc?.metrics?.completed_commitments ?? 0,
    stale_tasks: sc?.metrics?.stale_tasks ?? 0,
    high_priority_ceo_actions: sc?.metrics?.high_priority_actions ?? highPriorityActions.length,
    total_pipeline: n(crmData?.kpiSummary?.totalPipeline),
    closed_won_amount: n(crmData?.kpiSummary?.closedWonAmount),
    win_rate: n(crmData?.kpiSummary?.winRate),
    week_over_week_note: sc
      ? `Execution score: ${sc.score}/100 (${sc.label})`
      : "Score data unavailable",
  };

  // ─── C. Revenue / Pipeline ────────────────────────────────────────────────
  const kpi = crmData?.kpiSummary ?? {};
  const revenuePipeline: RevenuePipelineSection = {
    total_pipeline: n(kpi.totalPipeline),
    weighted_pipeline: n(kpi.weightedPipeline),
    top_opportunities: topOpps,
    stale_opportunities: n(kpi.stalledCount),
    hot_accounts: 0,
    closed_won_amount: n(kpi.closedWonAmount),
    win_rate: n(kpi.winRate),
    quote_sent: n(crmData?.quoteSnapshot?.sent),
    quote_accepted: n(crmData?.quoteSnapshot?.accepted),
    revenue_blockers: driftItems
      .filter((i: any) => String(i.section ?? "").toLowerCase().includes("pipeline") || String(i.section ?? "").toLowerCase().includes("revenue"))
      .slice(0, 3)
      .map((i: any) => String(i.summary ?? i.title ?? "")),
  };

  // ─── D. Capital / Funding ─────────────────────────────────────────────────
  const capitalFunding: CapitalFundingSection | null = actorUser.hasCapital && capitalData ? capitalData : null;

  // ─── E. Product / Operations ──────────────────────────────────────────────
  const installs = crmData?.installsDeployments ?? {} as any;
  const cert = crmData?.certificationOversight ?? {} as any;
  const proc = crmData?.procurementRisks ?? {} as any;
  const productOperations: ProductOperationsSection = {
    total_installs: n(installs.total),
    installs_in_progress: n(installs.inProgress),
    flagged_deployments: n(installs.withBlockers),
    stalled_workflows: n(installs.onHold),
    cert_blocked: n(cert.blocked),
    cert_at_risk: n(cert.atRisk),
    procurement_low_stock: n(proc.lowStockItems),
    product_risks: (installs.recentBlockers ?? [])
      .slice(0, 3)
      .map((b: any) => String(b.description ?? b.note ?? b)),
    operational_blockers: n(installs.withBlockers) > 0
      ? [`${n(installs.withBlockers)} install(s) have open blockers`]
      : [],
  };

  // ─── F. Team / Accountability ─────────────────────────────────────────────
  const cr = commitmentsData as any;
  const ownerLoadRisks = (recurringRisks as any)?.owner_risks ?? [];
  const teamAccountability: TeamAccountabilitySection = {
    team_pulse_summary: cr
      ? `${cr.summary?.total_open ?? 0} open commitments across ${cr.groups?.length ?? 0} team members`
      : "Commitment data unavailable",
    open_commitments: cr?.summary?.total_open ?? 0,
    missed_commitments: cr?.summary?.total_overdue ?? 0,
    completed_commitments: cr?.summary?.total_completed ?? 0,
    owner_load_risks: ownerLoadRisks
      .slice(0, 5)
      .map((r: any) => ({
        name: r.owner ?? r.name ?? "Unknown",
        overdue_count: n(r.overdue_count ?? r.count ?? 0),
      })),
    support_needed: ownerLoadRisks
      .filter((r: any) => n(r.overdue_count ?? r.count ?? 0) >= 3)
      .slice(0, 3)
      .map((r: any) => `${r.owner ?? r.name}: follow-up suggested on ${n(r.overdue_count ?? r.count)} items`),
  };

  // ─── G. Risks / Decisions Needed ─────────────────────────────────────────
  const criticalDrift = driftItems
    .filter((i: any) => i.severity === "critical" || i.severity === "high")
    .slice(0, 5);
  const recurringItems = (recurringRisks as any)?.owner_risks ?? [];
  const riskBlockers = crmData?.riskBlockers ?? {} as any;
  const risksDecisions: RisksDecisionsSection = {
    critical_drift_items: criticalDrift.map((i: any) => ({
      section: String(i.section ?? ""),
      severity: String(i.severity ?? ""),
      summary: String(i.summary ?? i.title ?? ""),
    })),
    recurring_risks: recurringItems
      .slice(0, 5)
      .map((r: any) => ({
        owner: r.owner ?? r.name ?? "",
        pattern: "overdue tasks",
        count: n(r.overdue_count ?? r.count ?? 0),
      })),
    unresolved_blockers: n(riskBlockers.stalledOpps) + n(riskBlockers.awaitingQuotes),
    capital_risks: actorUser.hasCapital && capitalData ? capitalData.funding_risks.slice(0, 2) : [],
    revenue_risks: (riskBlockers.recentIssues ?? [])
      .slice(0, 3)
      .map((i: any) => String(i.issue ?? i ?? "")),
    product_risks: n(installs.withBlockers) > 0
      ? [`${n(installs.withBlockers)} deployment(s) stalled`]
      : [],
    decisions_needed: criticalDrift
      .slice(0, 3)
      .map((i: any) => `Decision needed: ${i.summary ?? i.title ?? ""}`),
  };

  // ─── H. Wins / Momentum ──────────────────────────────────────────────────
  const completedActions = ceoActionsArr.filter(
    (a: any) => a.status === "completed" || a.status === "done"
  );
  const winsMomentum: WinsMomentumSection = {
    completed_high_priority_actions: completedActions.filter((a: any) => a.priority === "high").length,
    resolved_blockers: n((sc as any)?.metrics?.resolved_this_week ?? 0),
    customer_movement: [],
    partner_movement: [],
    product_milestones: n(installs.completedThisMonth) > 0
      ? [`${n(installs.completedThisMonth)} installation(s) completed this period`]
      : [],
    funding_progress: actorUser.hasCapital && capitalData?.next_investor_actions?.length
      ? capitalData.next_investor_actions.slice(0, 1)
      : [],
    team_wins: completedActions.slice(0, 3).map((a: any) => a.title),
  };

  // ─── I. Next 30 / 60 / 90 Days ───────────────────────────────────────────
  const openActions = ceoActionsArr.filter((a: any) => a.status === "open");
  const next306090: Next306090Section = {
    next_30_days: openActions
      .filter((a: any) => a.priority === "high" || a.priority === "urgent")
      .slice(0, 5)
      .map((a: any) => a.title),
    next_60_days: openActions
      .filter((a: any) => a.priority === "medium")
      .slice(0, 4)
      .map((a: any) => a.title),
    next_90_days: openActions
      .filter((a: any) => a.priority === "low")
      .slice(0, 3)
      .map((a: any) => a.title),
  };

  // ─── J. Board / Investor Asks ─────────────────────────────────────────────
  const boardInvestorAsks: BoardInvestorAsksSection = {
    intros_needed: actorUser.hasCapital && capitalData
      ? capitalData.next_investor_actions
          .filter((a: string) => a.toLowerCase().includes("intro"))
          .slice(0, 3)
      : [],
    funding_asks: actorUser.hasCapital && capitalData?.target_raise_amount
      ? [`Targeting ${fmtAmt(capitalData.target_raise_amount)} raise`]
      : [],
    customer_introductions: [],
    hiring_advisor_needs: [],
    technical_compliance_support: n(cert.blocked) > 0
      ? [`${n(cert.blocked)} certification(s) blocked — support needed`]
      : [],
    government_grant_support: actorUser.hasCapital && capitalData
      ? Array.from({ length: Math.min(capitalData.grant_opportunities, 2) }, (_, i) => `Grant opportunity ${i + 1} — follow-up needed`)
      : [],
    partnership_support: [],
  };

  return {
    meta: {
      pack_type: packType,
      generated_at: new Date().toISOString(),
      date_from: dateFrom ?? null,
      date_to: dateTo ?? null,
      generated_by: actorUser.name,
      has_capital: actorUser.hasCapital,
    },
    sections: {
      executive_summary: executiveSummary,
      company_scorecard: companyScorecard,
      revenue_pipeline: revenuePipeline,
      capital_funding: capitalFunding,
      product_operations: productOperations,
      team_accountability: teamAccountability,
      risks_decisions: risksDecisions,
      wins_momentum: winsMomentum,
      next_30_60_90: next306090,
      board_investor_asks: boardInvestorAsks,
    },
  };
}

// ── Markdown Builder ──────────────────────────────────────────────────────────

export function buildBoardPackMarkdown(pack: BuiltBoardPack): { markdown: string; copy_only: true } {
  const { sections, meta } = pack;
  const lines: string[] = [];

  const packLabel =
    meta.pack_type === "board" ? "Board Pack"
    : meta.pack_type === "investor" ? "Investor Update"
    : meta.pack_type === "lender" ? "Lender Pack"
    : meta.pack_type === "grant" ? "Grant Report"
    : "Executive Pack";

  lines.push(`# VoltSafe — ${packLabel}`);
  lines.push(`*Generated: ${new Date(meta.generated_at).toLocaleDateString()} · By: ${meta.generated_by}*`);
  if (meta.date_from || meta.date_to) {
    lines.push(`*Period: ${meta.date_from ?? "—"} to ${meta.date_to ?? "—"}*`);
  }
  lines.push("", "---", "");

  // A. Executive Summary
  lines.push("## A. Executive Summary", "");
  if (sections.executive_summary.bullets.length) {
    sections.executive_summary.bullets.forEach(b => lines.push(`- ${b}`));
    lines.push("");
  }
  if (sections.executive_summary.top_wins.length) {
    lines.push("**Top Wins**");
    sections.executive_summary.top_wins.forEach(w => lines.push(`- ${w}`));
    lines.push("");
  }
  if (sections.executive_summary.top_risks.length) {
    lines.push("**Key Risks**");
    sections.executive_summary.top_risks.forEach(r => lines.push(`- ${r}`));
    lines.push("");
  }
  if (sections.executive_summary.top_ceo_asks.length) {
    lines.push("**Top CEO Asks**");
    sections.executive_summary.top_ceo_asks.forEach(a => lines.push(`- ${a}`));
    lines.push("");
  }
  if (sections.executive_summary.next_30_day_priorities.length) {
    lines.push("**Next 30-Day Priorities**");
    sections.executive_summary.next_30_day_priorities.forEach(p => lines.push(`- ${p}`));
    lines.push("");
  }

  // What Changed
  if (sections.executive_summary.what_changed && !sections.executive_summary.what_changed.no_previous_pack) {
    const wc = sections.executive_summary.what_changed;
    lines.push("**What Changed Since Last Pack**");
    lines.push(`- New Blockers: ${wc.new_blockers}`);
    lines.push(`- Resolved Blockers: ${wc.resolved_blockers}`);
    lines.push(`- Pipeline: ${wc.pipeline_movement}`);
    lines.push(`- Wins: ${wc.new_wins}`);
    lines.push("");
  }

  // B. Company Scorecard
  lines.push("## B. Company Scorecard", "");
  const sc = sections.company_scorecard;
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Execution Health | **${sc.execution_health_score}/100** (${sc.execution_health_label}) |`);
  lines.push(`| Open Blockers | ${sc.open_blockers} |`);
  lines.push(`| Overdue Commitments | ${sc.overdue_commitments} |`);
  lines.push(`| Completed Commitments | ${sc.completed_commitments} |`);
  lines.push(`| Stale Tasks | ${sc.stale_tasks} |`);
  lines.push(`| High-Priority CEO Actions | ${sc.high_priority_ceo_actions} |`);
  lines.push(`| Total Pipeline | ${fmtAmt(sc.total_pipeline)} |`);
  lines.push(`| Closed Won | ${fmtAmt(sc.closed_won_amount)} |`);
  lines.push(`| Win Rate | ${sc.win_rate.toFixed(1)}% |`);
  lines.push("");

  // C. Revenue / Pipeline
  lines.push("## C. Revenue / Pipeline", "");
  const rv = sections.revenue_pipeline;
  lines.push(`- Total Pipeline: **${fmtAmt(rv.total_pipeline)}**`);
  lines.push(`- Weighted Pipeline: ${fmtAmt(rv.weighted_pipeline)}`);
  lines.push(`- Stale Opportunities: ${rv.stale_opportunities}`);
  lines.push(`- Win Rate: ${rv.win_rate.toFixed(1)}%`);
  lines.push(`- Quotes Sent: ${rv.quote_sent} | Accepted: ${rv.quote_accepted}`);
  if (rv.top_opportunities.length) {
    lines.push("", "**Top Opportunities**");
    rv.top_opportunities.forEach(o =>
      lines.push(`- ${o.name}: ${fmtAmt(o.amount)} (${o.stage})${o.close_date ? ` — close ${o.close_date}` : ""}`)
    );
  }
  if (rv.revenue_blockers.length) {
    lines.push("", "**Revenue Blockers**");
    rv.revenue_blockers.forEach(b => lines.push(`- ${b}`));
  }
  lines.push("");

  // D. Capital / Funding (only if hasCapital)
  if (sections.capital_funding) {
    lines.push("## D. Capital / Funding *(Confidential — CEO/CFO Only)*", "");
    const cf = sections.capital_funding;
    lines.push(`- Raise Status: **${cf.raise_status}**`);
    if (cf.target_raise_amount) lines.push(`- Target Raise: ${fmtAmt(cf.target_raise_amount)}`);
    lines.push(`- Total Investors: ${cf.total_investors}`);
    lines.push(`- Active Conversations: ${cf.active_conversations}`);
    lines.push(`- Committed Capital: ${fmtAmt(cf.committed_capital)}`);
    if (cf.soft_circled > 0) lines.push(`- Soft-Circled: ${fmtAmt(cf.soft_circled)}`);
    if (cf.grant_opportunities > 0) lines.push(`- Grant Opportunities: ${cf.grant_opportunities}`);
    if (cf.next_investor_actions.length) {
      lines.push("", "**Next Investor Actions**");
      cf.next_investor_actions.forEach(a => lines.push(`- ${a}`));
    }
    if (cf.funding_risks.length) {
      lines.push("", "**Funding Risks**");
      cf.funding_risks.forEach(r => lines.push(`- ${r}`));
    }
    lines.push("");
  }

  // E. Product / Operations
  lines.push("## E. Product / Operations", "");
  const po = sections.product_operations;
  lines.push(`- Total Installs: ${po.total_installs} (${po.installs_in_progress} in progress)`);
  lines.push(`- Flagged Deployments: ${po.flagged_deployments}`);
  lines.push(`- Stalled Workflows: ${po.stalled_workflows}`);
  lines.push(`- Certifications Blocked: ${po.cert_blocked}`);
  lines.push(`- At-Risk Certs: ${po.cert_at_risk}`);
  lines.push(`- Low-Stock Items: ${po.procurement_low_stock}`);
  if (po.operational_blockers.length) {
    lines.push("", "**Operational Blockers**");
    po.operational_blockers.forEach(b => lines.push(`- ${b}`));
  }
  lines.push("");

  // F. Team / Accountability
  lines.push("## F. Team / Accountability", "");
  const ta = sections.team_accountability;
  lines.push(`- ${ta.team_pulse_summary}`);
  lines.push(`- Open Commitments: ${ta.open_commitments}`);
  lines.push(`- Missed Commitments: ${ta.missed_commitments}`);
  lines.push(`- Completed Commitments: ${ta.completed_commitments}`);
  if (ta.support_needed.length) {
    lines.push("", "**Support Needed**");
    ta.support_needed.forEach(s => lines.push(`- ${s}`));
  }
  if (ta.owner_load_risks.length) {
    lines.push("", "**Owner Load Risks**");
    ta.owner_load_risks.forEach(r => lines.push(`- ${r.name}: ${r.overdue_count} overdue`));
  }
  lines.push("");

  // G. Risks / Decisions Needed
  lines.push("## G. Risks / Decisions Needed", "");
  const rd = sections.risks_decisions;
  if (rd.critical_drift_items.length) {
    lines.push("**Critical Drift Items**");
    rd.critical_drift_items.forEach(d =>
      lines.push(`- [${d.severity.toUpperCase()}] ${d.summary}`)
    );
    lines.push("");
  }
  if (rd.revenue_risks.length) {
    lines.push("**Revenue Risks**");
    rd.revenue_risks.forEach(r => lines.push(`- ${r}`));
    lines.push("");
  }
  if (rd.product_risks.length) {
    lines.push("**Product Risks**");
    rd.product_risks.forEach(r => lines.push(`- ${r}`));
    lines.push("");
  }
  if (rd.capital_risks.length) {
    lines.push("**Capital Risks**");
    rd.capital_risks.forEach(r => lines.push(`- ${r}`));
    lines.push("");
  }
  if (rd.decisions_needed.length) {
    lines.push("**Decisions Needed**");
    rd.decisions_needed.forEach(d => lines.push(`- ${d}`));
    lines.push("");
  }

  // H. Wins / Momentum
  lines.push("## H. Wins / Momentum", "");
  const wm = sections.wins_momentum;
  lines.push(`- Completed High-Priority Actions: ${wm.completed_high_priority_actions}`);
  lines.push(`- Resolved Blockers: ${wm.resolved_blockers}`);
  if (wm.product_milestones.length) {
    lines.push("", "**Product Milestones**");
    wm.product_milestones.forEach(m => lines.push(`- ${m}`));
  }
  if (wm.team_wins.length) {
    lines.push("", "**Team Wins**");
    wm.team_wins.forEach(w => lines.push(`- ${w}`));
  }
  lines.push("");

  // I. Next 30 / 60 / 90 Days
  lines.push("## I. Next 30 / 60 / 90 Days", "");
  const next = sections.next_30_60_90;
  lines.push("**Next 30 Days — Urgent Execution**");
  (next.next_30_days.length ? next.next_30_days : ["(no high-priority items)"]).forEach(d => lines.push(`- ${d}`));
  lines.push("", "**Next 60 Days — Growth & Funding**");
  (next.next_60_days.length ? next.next_60_days : ["(no medium-priority items)"]).forEach(d => lines.push(`- ${d}`));
  lines.push("", "**Next 90 Days — Strategic Outcomes**");
  (next.next_90_days.length ? next.next_90_days : ["(no strategic items)"]).forEach(d => lines.push(`- ${d}`));
  lines.push("");

  // J. Board / Investor Asks
  lines.push("## J. Board / Investor Asks", "");
  const ba = sections.board_investor_asks;
  const hasAny = ba.funding_asks.length || ba.intros_needed.length || ba.technical_compliance_support.length ||
    ba.government_grant_support.length || ba.customer_introductions.length || ba.hiring_advisor_needs.length;
  if (!hasAny) {
    lines.push("*(No active board asks this period)*");
  } else {
    if (ba.funding_asks.length) {
      lines.push("**Funding Asks**");
      ba.funding_asks.forEach(a => lines.push(`- ${a}`));
      lines.push("");
    }
    if (ba.intros_needed.length) {
      lines.push("**Introductions Needed**");
      ba.intros_needed.forEach(a => lines.push(`- ${a}`));
      lines.push("");
    }
    if (ba.technical_compliance_support.length) {
      lines.push("**Technical / Compliance Support**");
      ba.technical_compliance_support.forEach(a => lines.push(`- ${a}`));
      lines.push("");
    }
    if (ba.government_grant_support.length) {
      lines.push("**Government / Grant Support**");
      ba.government_grant_support.forEach(a => lines.push(`- ${a}`));
      lines.push("");
    }
  }

  lines.push("---", "*Confidential — VoltSafe Internal Use Only*");

  return { markdown: lines.join("\n"), copy_only: true };
}

// ── Executive Summary Builder ─────────────────────────────────────────────────

export function buildBoardPackExecutiveSummary(pack: BuiltBoardPack): {
  bullets: string[];
  top_wins: string[];
  top_risks: string[];
  top_ceo_asks: string[];
  next_30_day_priorities: string[];
  copy_only: true;
} {
  const es = pack.sections.executive_summary;
  return {
    bullets: es.bullets,
    top_wins: es.top_wins,
    top_risks: es.top_risks,
    top_ceo_asks: es.top_ceo_asks,
    next_30_day_priorities: es.next_30_day_priorities,
    copy_only: true,
  };
}

// ── Investor Update Draft ─────────────────────────────────────────────────────

export function buildInvestorUpdateDraft(
  pack: BuiltBoardPack,
  packId?: number,
): { subject: string; body: string; source_pack_id: number | null; copy_only: true } {
  const now = new Date();
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const month = MONTHS[now.getMonth()];
  const year = now.getFullYear();
  const quarter = `Q${Math.ceil((now.getMonth() + 1) / 3)}`;

  const { sections, meta } = pack;
  const sc = sections.company_scorecard;
  const rv = sections.revenue_pipeline;
  const cf = sections.capital_funding;
  const es = sections.executive_summary;

  const winsBlock = es.top_wins.length
    ? es.top_wins.slice(0, 3).map(w => `  - ${w}`).join("\n")
    : "  - Execution on track";

  const nextBlock = sections.next_30_60_90.next_30_days.length
    ? sections.next_30_60_90.next_30_days.slice(0, 3).map(p => `  - ${p}`).join("\n")
    : "  - Continued focus on deployment milestones";

  const bodyParts: string[] = [
    `Hi [Investor Name],`,
    "",
    `Hope this finds you well. Here's a quick ${month} / ${quarter} ${year} update from VoltSafe.`,
    "",
    `**Top 3 Wins**`,
    winsBlock,
    "",
    `**Key Metrics**`,
    `  - Total Pipeline: ${fmtAmt(rv.total_pipeline)}`,
    `  - Closed Won: ${fmtAmt(sc.closed_won_amount)}`,
    `  - Win Rate: ${sc.win_rate.toFixed(1)}%`,
    `  - Execution Score: ${sc.execution_health_score}/100 (${sc.execution_health_label})`,
    "",
    `**Product / Revenue Progress**`,
    nextBlock,
    "",
  ];

  if (cf) {
    bodyParts.push(
      `**Funding / Capital Update**`,
      `  - Raise Status: ${cf.raise_status}`,
      `  - Active Conversations: ${cf.active_conversations}`,
      cf.target_raise_amount ? `  - Target: ${fmtAmt(cf.target_raise_amount)}` : "",
      "",
    );
  }

  if (es.top_risks.length) {
    bodyParts.push(
      `**Risks / Asks**`,
      es.top_risks.slice(0, 2).map(r => `  - ${r}`).join("\n"),
      "",
    );
  }

  bodyParts.push(
    `**Next Milestones**`,
    nextBlock,
    "",
    `Thank you for your continued support. Happy to connect for a quick call if helpful.`,
    "",
    `Best,`,
    `${meta.generated_by}`,
    `VoltSafe`,
  );

  return {
    subject: `VoltSafe Update — ${month} / ${quarter} ${year}`,
    body: bodyParts.filter(l => l !== undefined).join("\n"),
    source_pack_id: packId ?? null,
    copy_only: true,
  };
}

// ── Compare Against Previous Pack ────────────────────────────────────────────

const NO_PREVIOUS: WhatChangedSummary = {
  new_blockers: 0,
  resolved_blockers: 0,
  new_overdue_commitments: 0,
  completed_commitments: 0,
  pipeline_movement: "No previous finalized pack available for comparison.",
  capital_movement: "No previous finalized pack available for comparison.",
  new_risks: 0,
  new_wins: 0,
  action_queue_movement: "No previous finalized pack available for comparison.",
  no_previous_pack: true,
};

export async function compareAgainstPreviousPack(
  current: BoardPackSections,
  previousPackId: number | null,
): Promise<WhatChangedSummary> {
  if (!previousPackId) return { ...NO_PREVIOUS };

  try {
    const res = await db.execute(
      sql.raw(`SELECT sections_data FROM board_packs WHERE id = ${previousPackId} AND status = 'finalized' LIMIT 1`)
    );
    const prev = safeRows(res)[0]?.sections_data as BoardPackSections | null;
    if (!prev) return { ...NO_PREVIOUS };

    const currBlockers = current.company_scorecard.open_blockers;
    const prevBlockers = prev.company_scorecard.open_blockers;
    const currPipeline = current.revenue_pipeline.total_pipeline;
    const prevPipeline = prev.revenue_pipeline.total_pipeline;
    const pipeDelta = currPipeline - prevPipeline;

    const pipeMovement =
      pipeDelta > 0 ? `Pipeline up ${fmtAmt(pipeDelta)} vs previous pack`
      : pipeDelta < 0 ? `Pipeline down ${fmtAmt(Math.abs(pipeDelta))} vs previous pack`
      : "Pipeline unchanged vs previous pack";

    const currCap = current.capital_funding?.committed_capital ?? 0;
    const prevCap = prev.capital_funding?.committed_capital ?? 0;
    const capDelta = currCap - prevCap;
    const capMovement = capDelta > 0
      ? `Committed capital up ${fmtAmt(capDelta)} vs previous pack`
      : "No capital movement vs previous pack";

    return {
      new_blockers: Math.max(0, currBlockers - prevBlockers),
      resolved_blockers: Math.max(0, prevBlockers - currBlockers),
      new_overdue_commitments: Math.max(
        0,
        current.company_scorecard.overdue_commitments - prev.company_scorecard.overdue_commitments
      ),
      completed_commitments: current.team_accountability.completed_commitments,
      pipeline_movement: pipeMovement,
      capital_movement: capMovement,
      new_risks: Math.max(
        0,
        current.risks_decisions.critical_drift_items.length - prev.risks_decisions.critical_drift_items.length
      ),
      new_wins: current.wins_momentum.completed_high_priority_actions,
      action_queue_movement: `${current.company_scorecard.high_priority_ceo_actions} high-priority action(s) open`,
      no_previous_pack: false,
    };
  } catch {
    return { ...NO_PREVIOUS };
  }
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function createBoardPack(
  actorUser: { id: number; name: string; hasCapital: boolean },
  input: {
    title?: string;
    pack_type?: PackType;
    date_from?: string;
    date_to?: string;
    notes?: string;
    sections_data?: BoardPackSections;
    previous_pack_id?: number;
  },
): Promise<BoardPackRecord> {
  const { title = "Board Pack", pack_type = "board", date_from, date_to, notes, sections_data, previous_pack_id } = input;
  const sdJson = sections_data ? `'${esc(JSON.stringify(sections_data))}'::jsonb` : "NULL";
  const res = await db.execute(sql.raw(`
    INSERT INTO board_packs (title, pack_type, status, date_from, date_to, sections_data, notes, created_by, previous_pack_id, created_at)
    VALUES (
      '${esc(title)}',
      '${esc(pack_type)}',
      'draft',
      ${date_from ? `'${esc(date_from)}'` : "NULL"},
      ${date_to ? `'${esc(date_to)}'` : "NULL"},
      ${sdJson},
      ${notes ? `'${esc(notes)}'` : "NULL"},
      ${actorUser.id},
      ${previous_pack_id ? Number(previous_pack_id) : "NULL"},
      NOW()
    )
    RETURNING *
  `));
  return rowToPack(safeRows(res)[0]);
}

export async function getBoardPack(packId: number): Promise<BoardPackRecord | null> {
  const res = await db.execute(sql.raw(`SELECT * FROM board_packs WHERE id = ${packId} LIMIT 1`));
  const row = safeRows(res)[0];
  return row ? rowToPack(row) : null;
}

export async function listBoardPacks(options: { status?: PackStatus; limit?: number } = {}): Promise<BoardPackRecord[]> {
  const where = options.status ? `WHERE status = '${esc(options.status)}'` : "";
  const limit = Math.min(options.limit ?? 50, 100);
  const res = await db.execute(sql.raw(`SELECT * FROM board_packs ${where} ORDER BY created_at DESC LIMIT ${limit}`));
  return safeRows(res).map(rowToPack);
}

export async function updateBoardPack(
  packId: number,
  patch: { title?: string; notes?: string; sections_data?: BoardPackSections },
): Promise<BoardPackRecord | null> {
  const parts: string[] = [];
  if (patch.title !== undefined) parts.push(`title = '${esc(patch.title)}'`);
  if (patch.notes !== undefined) parts.push(`notes = ${patch.notes ? `'${esc(patch.notes)}'` : "NULL"}`);
  if (patch.sections_data !== undefined) parts.push(`sections_data = '${esc(JSON.stringify(patch.sections_data))}'::jsonb`);
  if (!parts.length) return getBoardPack(packId);
  const res = await db.execute(sql.raw(
    `UPDATE board_packs SET ${parts.join(", ")} WHERE id = ${packId} AND status = 'draft' RETURNING *`
  ));
  const row = safeRows(res)[0];
  return row ? rowToPack(row) : null;
}

export async function finalizeBoardPack(packId: number): Promise<BoardPackRecord | null> {
  const res = await db.execute(sql.raw(`
    UPDATE board_packs SET status = 'finalized', finalized_at = NOW()
    WHERE id = ${packId} AND status = 'draft'
    RETURNING *
  `));
  const row = safeRows(res)[0];
  return row ? rowToPack(row) : null;
}

export async function archiveBoardPack(packId: number): Promise<BoardPackRecord | null> {
  const res = await db.execute(sql.raw(`
    UPDATE board_packs SET status = 'archived', archived_at = NOW()
    WHERE id = ${packId} AND status IN ('draft', 'finalized')
    RETURNING *
  `));
  const row = safeRows(res)[0];
  return row ? rowToPack(row) : null;
}

// ── Internal ──────────────────────────────────────────────────────────────────

function rowToPack(r: any): BoardPackRecord {
  return {
    id: Number(r.id),
    title: String(r.title ?? "Board Pack"),
    pack_type: (r.pack_type ?? "board") as PackType,
    status: (r.status ?? "draft") as PackStatus,
    date_from: r.date_from ? String(r.date_from) : null,
    date_to: r.date_to ? String(r.date_to) : null,
    sections_data: r.sections_data
      ? (typeof r.sections_data === "string" ? JSON.parse(r.sections_data) : r.sections_data)
      : null,
    notes: r.notes ? String(r.notes) : null,
    created_by: r.created_by != null ? Number(r.created_by) : null,
    created_at: String(r.created_at ?? ""),
    finalized_at: r.finalized_at ? String(r.finalized_at) : null,
    archived_at: r.archived_at ? String(r.archived_at) : null,
    previous_pack_id: r.previous_pack_id != null ? Number(r.previous_pack_id) : null,
  };
}
