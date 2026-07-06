/**
 * Capital Board / CFO Reporting Pack — Phase 2J
 *
 * Pure assembly service: no DB calls, no side effects.
 * Composes existing service functions and formats reports.
 * All DB queries stay in routes-capital.ts.
 */

import {
  computeWeightedPipeline,
  computeLeadCandidates,
  computeThisWeekActions,
  computeRiskFlags,
  computeRunway,
  computeScenarios,
} from "./capital-command-center.js";

import {
  computeValuationSummary,
  computeDilutionScenarios,
  computeAllocationPlan,
  computeClosePlan,
  computeCloseChecklist,
  computeValuationRiskFlags,
} from "./capital-valuation.js";

import {
  extractEngagementSignals,
  computeEngagementScore,
  computeEngagementAnalytics,
  computeMaterialEngagement,
} from "./capital-engagement.js";

import {
  computeDataRoomIntelligence,
  computeMaterialRiskFlags,
} from "./capital-data-room.js";

import {
  computePortalIntelligence,
  computePortalRiskFlags,
} from "./capital-portal.js";

// ── Report type registry ──────────────────────────────────────────────────────

export type ReportType = "weekly_brief" | "board_update" | "cfo_closing" | "engagement";

export const REPORT_TYPES: ReportType[] = [
  "weekly_brief", "board_update", "cfo_closing", "engagement",
];

export const REPORT_TYPE_META: Record<ReportType, {
  title: string;
  subtitle: string;
  description: string;
  audience: string;
  has_csv: boolean;
}> = {
  weekly_brief: {
    title:       "Weekly Capital Brief",
    subtitle:    "Executive weekly status for CEO",
    description: "Current round progress, this-week priorities, engagement pulse, and risk flags.",
    audience:    "Trevor (CEO)",
    has_csv:     false,
  },
  board_update: {
    title:       "Board Capital Update",
    subtitle:    "Investor-ready board pack section",
    description: "Round headline, valuation summary, pipeline table, and board-level risk flags.",
    audience:    "Board of Directors",
    has_csv:     false,
  },
  cfo_closing: {
    title:       "CFO Closing Report",
    subtitle:    "Legal-close and allocation tracker",
    description: "Allocation plan, close plan groups, closing checklist, and runway projections.",
    audience:    "Scott (CFO)",
    has_csv:     true,
  },
  engagement: {
    title:       "Investor Engagement Report",
    subtitle:    "Engagement analytics and follow-up digest",
    description: "Engagement tiers, portal activity, material leaderboard, and recommended follow-ups.",
    audience:    "Trevor & Scott",
    has_csv:     true,
  },
};

// ── Input / Options ───────────────────────────────────────────────────────────

export interface ReportInput {
  round:           any;
  rounds:          any[];
  investors:       any[];
  commitments:     any[];
  contacts:        any[];
  activities:      any[];
  emailLinks:      any[];
  portalAccesses:  any[];
  portalEvents:    any[];
  materials:       any[];
  materialShares:  any[];
  materialRequests: any[];
}

export interface ReportOptions {
  round_id:          number | null;
  date_from:         string | null;
  date_to:           string | null;
  include_sensitive: boolean;
}

// ── Base / shared ─────────────────────────────────────────────────────────────

interface ReportBase {
  report_type:       ReportType;
  report_title:      string;
  round_id:          number | null;
  round_name:        string | null;
  generated_at:      string;
  include_sensitive: boolean;
  warnings:          string[];
}

// ── Report shapes ─────────────────────────────────────────────────────────────

export interface WeeklyBriefReport extends ReportBase {
  report_type: "weekly_brief";
  round_status: {
    name:             string;
    status:           string;
    instrument:       string | null;
    target_amount:    number;
    committed_amount: number;
    weighted_pipeline: number;
    pct_to_target:    number;
    target_close_date: string | null;
    days_open:        number | null;
  };
  pipeline_momentum: {
    total_active:        number;
    committed_count:     number;
    soft_circle_count:   number;
    diligence_count:     number;
    new_this_week:       number;
    hot_leads:           { name: string; stage: string; target_amount: number | null }[];
  };
  this_week_priority: {
    actions: { investor_name: string; action: string; priority: string; reason: string }[];
    total_actions: number;
  };
  risk_flags: {
    critical: string[];
    warning:  string[];
  };
  engagement_pulse: {
    highly_engaged_count:   number;
    engaged_count:          number;
    portal_opens_7d:        number;
    material_views_7d:      number;
    recent_inbound_replies: number;
    cold_count:             number;
  };
  data_room_status: {
    has_pitch_deck:       boolean;
    has_financial_model:  boolean;
    active_materials:     number;
    stale_shares:         number;
    pending_requests:     number;
    overdue_requests:     number;
  };
}

export interface BoardUpdateReport extends ReportBase {
  report_type: "board_update";
  round_headline: {
    name:                   string;
    status:                 string;
    instrument:             string | null;
    target_amount:          number;
    min_close_target:       number | null;
    committed_amount:       number;
    wired_amount:           number;
    weighted_pipeline:      number;
    pct_to_target:          number;
    target_close_date:      string | null;
    runway_today_months:    number | null;
    runway_after_target_months: number | null;
  };
  valuation_summary: {
    instrument:                string | null;
    pre_money:                 number | null;
    effective_valuation:       number | null;
    new_investor_ownership_pct: number | null;
    valuation_cap:             number | null;
    has_valuation_data:        boolean;
    warnings:                  string[];
    scenario_range:            { min_amount: number; max_amount: number } | null;
  };
  pipeline_table: {
    investor_name:  string;
    stage:          string;
    priority:       string;
    target_amount:  number | null;
    committed:      boolean;
    commitment_amount: number | null;
    closing_status: string | null;
  }[];
  data_room_portal: {
    active_portals:      number;
    portal_opens_7d:     number;
    material_views_7d:   number;
    pitch_deck_ready:    boolean;
    financial_model_ready: boolean;
    investors_missing_key_materials: number;
  };
  risk_summary: {
    critical_flags: string[];
    warning_flags:  string[];
    total_flags:    number;
  };
  management_asks: string[];
}

export interface CfoClosingReport extends ReportBase {
  report_type: "cfo_closing";
  close_summary: {
    total_in_close:   number;
    wired_amount:     number;
    closed_amount:    number;
    funds_pending:    number;
    docs_signed:      number;
    docs_sent:        number;
    not_started:      number;
    dropped_amount:   number;
    pct_to_target:    number;
    pct_to_min_close: number | null;
  };
  allocation_table: {
    investor_name:           string;
    stage:                   string;
    allocation_status:       string;
    closing_status:          string;
    committed_amount:        number | null;
    docs_sent_at:            string | null;
    docs_signed_at:          string | null;
    funds_received_at:       string | null;
  }[];
  close_plan_groups: {
    label:         string;
    status:        string;
    count:         number;
    total_amount:  number;
    investors:     string[];
  }[];
  checklist_items: {
    key:      string;
    label:    string;
    complete: boolean;
    note?:    string;
  }[];
  runway_scenarios: {
    name:                string;
    amount:              number;
    runway_added_months: number | null;
    description:         string;
  }[];
  valuation_warnings: string[];
}

export interface EngagementReport extends ReportBase {
  report_type: "engagement";
  analytics: {
    total_investors:            number;
    highly_engaged_count:       number;
    engaged_count:              number;
    watching_count:             number;
    stale_count:                number;
    cold_count:                 number;
    portal_opens_7d:            number;
    material_views_7d:          number;
    material_downloads_7d:      number;
    recent_inbound_replies:     number;
    no_engagement_after_portal: number;
    hot_with_stale_followup:    number;
  };
  top_engaged: {
    rank:                number;
    investor_name:       string;
    stage:               string;
    engagement_score:    number;
    engagement_tier:     string;
    recommended_action:  string;
    last_engagement_at:  string | null;
  }[];
  stale_investors: {
    investor_name:   string;
    stage:           string;
    engagement_tier: string;
    last_contact:    string | null;
    risk_flags:      string[];
  }[];
  material_leaderboard: {
    rank:             number;
    material_title:   string;
    material_type:    string;
    total_views:      number;
    total_downloads:  number;
    investor_count:   number;
  }[];
  portal_summary: {
    active_portals:             number;
    portals_never_opened:       number;
    investors_without_portal:   number;
    total_views_7d:             number;
    total_downloads_7d:         number;
  };
  follow_up_recommendations: {
    investor_name:   string;
    stage:           string;
    priority:        string;
    recommended_action: string;
    reason:          string;
  }[];
}

export type AnyReport = WeeklyBriefReport | BoardUpdateReport | CfoClosingReport | EngagementReport;

// ── Helper: format amounts ────────────────────────────────────────────────────

function fmtM(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtPct(n: number): string {
  return `${Math.round(n)}%`;
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return s;
  }
}

// ── Pre-compute engagement rows (needed by multiple report types) ──────────────

function buildEngagementRows(input: ReportInput): any[] {
  const invIds = input.investors.map((i: any) => i.id);
  return input.investors.map((inv: any) => {
    const invAct = input.activities.filter((a: any)     => Number(a.entity_id)            === inv.id);
    const invEml = input.emailLinks.filter((e: any)     => Number(e.capital_investor_id)  === inv.id);
    const invPA  = input.portalAccesses.filter((p: any) => Number(p.investor_id)          === inv.id);
    const invPE  = input.portalEvents.filter((e: any)   => Number(e.investor_id)          === inv.id);
    const invMS  = input.materialShares.filter((s: any) => Number(s.investor_id)          === inv.id);
    const invMR  = input.materialRequests.filter((r: any) => Number(r.investor_id)        === inv.id);
    const invCom = input.commitments.filter((c: any)    => Number(c.investor_id)          === inv.id);

    const signals = extractEngagementSignals(
      inv, invAct, invEml, invPA, invPE, invMS, invMR, invCom, input.materials,
    );
    const result  = computeEngagementScore(inv, signals);
    return {
      investor_id:   inv.id,
      investor_name: inv.name,
      investor_type: inv.investor_type ?? "",
      stage:         inv.stage ?? "",
      priority:      inv.priority ?? "",
      warmth:        inv.warmth ?? "",
      do_not_contact: !!inv.do_not_contact,
      ...result,
      signals,
    };
  });
}

// ── Main assembler ────────────────────────────────────────────────────────────

export function assembleReport(
  type: ReportType,
  input: ReportInput,
  options: ReportOptions,
): AnyReport {
  const base: ReportBase = {
    report_type:       type,
    report_title:      REPORT_TYPE_META[type].title,
    round_id:          input.round?.id ?? null,
    round_name:        input.round?.name ?? null,
    generated_at:      new Date().toISOString(),
    include_sensitive: options.include_sensitive,
    warnings:          [],
  };

  if (!input.round) {
    base.warnings.push("No active round found — report will be incomplete");
  }

  switch (type) {
    case "weekly_brief": return buildWeeklyBrief(input, base, options);
    case "board_update": return buildBoardUpdate(input, base, options);
    case "cfo_closing":  return buildCfoClosing(input, base, options);
    case "engagement":   return buildEngagementReport(input, base, options);
  }
}

// ── Weekly Brief ──────────────────────────────────────────────────────────────

function buildWeeklyBrief(
  input: ReportInput,
  base: ReportBase,
  _opts: ReportOptions,
): WeeklyBriefReport {
  const round = input.round ?? {};

  const emailLinkCounts = new Map<number, number>();
  for (const el of input.emailLinks) {
    const id = Number(el.capital_investor_id);
    emailLinkCounts.set(id, (emailLinkCounts.get(id) ?? 0) + 1);
  }

  const pipeline  = computeWeightedPipeline(round, input.investors, input.commitments);
  const actions   = computeThisWeekActions(input.investors, input.commitments, emailLinkCounts);
  const riskFlags = computeRiskFlags(round, input.investors, pipeline);

  // Data room
  const drIntel = computeDataRoomIntelligence(
    input.materials, input.materialShares, input.materialRequests, input.investors,
  );

  // Engagement
  const engRows = buildEngagementRows(input);
  const engAnalytics = computeEngagementAnalytics(
    engRows, input.portalEvents, input.materialShares, input.emailLinks,
  );

  // Pipeline momentum
  const activeInvestors = input.investors.filter(
    (i: any) => !["Passed", "Do Not Contact"].includes(i.stage ?? ""),
  );
  const committed  = input.investors.filter((i: any) =>
    ["Committed", "Wired / Closed"].includes(i.stage ?? ""),
  ).length;
  const softCircle = input.investors.filter((i: any) =>
    ["Soft Commit", "Soft-Circled"].includes(i.stage ?? ""),
  ).length;
  const diligence  = input.investors.filter((i: any) =>
    ["Diligence", "Partner Meeting"].includes(i.stage ?? ""),
  ).length;

  const sevenDaysAgo = Date.now() - 7 * 86400000;
  const newThisWeek  = input.investors.filter((i: any) =>
    i.created_at && new Date(i.created_at).getTime() > sevenDaysAgo,
  ).length;

  const leads = computeLeadCandidates(
    input.investors, input.commitments, input.contacts, emailLinkCounts,
  );
  const hotLeads = leads.slice(0, 5).map((l: any) => ({
    name:          l.name,
    stage:         l.stage,
    target_amount: l.target_cheque_amount != null ? Number(l.target_cheque_amount) : null,
  }));

  const pctToTarget = pipeline.target_amount > 0
    ? Math.round((pipeline.committed_amount / pipeline.target_amount) * 100)
    : 0;

  const topActions = actions.slice(0, 8).map((a: any) => ({
    investor_name: a.investor_name ?? a.name ?? "Unknown",
    action:        a.action,
    priority:      a.priority ?? "Medium",
    reason:        a.reason ?? "",
  }));

  return {
    ...base,
    report_type: "weekly_brief",
    round_status: {
      name:              round.name ?? "Unnamed Round",
      status:            round.status ?? "Unknown",
      instrument:        round.round_instrument ?? null,
      target_amount:     pipeline.target_amount,
      committed_amount:  pipeline.committed_amount,
      weighted_pipeline: pipeline.weighted_pipeline,
      pct_to_target:     pctToTarget,
      target_close_date: round.target_close_date ?? null,
      days_open:         round.days_open ?? null,
    },
    pipeline_momentum: {
      total_active:      activeInvestors.length,
      committed_count:   committed,
      soft_circle_count: softCircle,
      diligence_count:   diligence,
      new_this_week:     newThisWeek,
      hot_leads:         hotLeads,
    },
    this_week_priority: {
      actions:       topActions,
      total_actions: actions.length,
    },
    risk_flags: {
      critical: riskFlags.filter((f: any) => f.severity === "critical").map((f: any) => f.message),
      warning:  riskFlags.filter((f: any) => f.severity === "warning").map((f: any) => f.message),
    },
    engagement_pulse: {
      highly_engaged_count:   engAnalytics.highly_engaged_count,
      engaged_count:          engAnalytics.engaged_count,
      portal_opens_7d:        engAnalytics.portal_opens_7d,
      material_views_7d:      engAnalytics.material_views_7d,
      recent_inbound_replies: engAnalytics.recent_inbound_replies,
      cold_count:             engAnalytics.cold_count,
    },
    data_room_status: {
      has_pitch_deck:      drIntel.has_pitch_deck,
      has_financial_model: drIntel.has_financial_model,
      active_materials:    drIntel.active_materials,
      stale_shares:        drIntel.stale_shares.length,
      pending_requests:    drIntel.open_requests,
      overdue_requests:    drIntel.overdue_requests,
    },
  };
}

// ── Board Capital Update ──────────────────────────────────────────────────────

function buildBoardUpdate(
  input: ReportInput,
  base: ReportBase,
  opts: ReportOptions,
): BoardUpdateReport {
  const round = input.round ?? {};

  const emailLinkCounts = new Map<number, number>();
  for (const el of input.emailLinks) {
    const id = Number(el.capital_investor_id);
    emailLinkCounts.set(id, (emailLinkCounts.get(id) ?? 0) + 1);
  }

  const pipeline  = computeWeightedPipeline(round, input.investors, input.commitments);
  const runway    = computeRunway(round, pipeline.weighted_pipeline);
  const scenarios = computeScenarios(round, pipeline, runway);
  const riskFlags = computeRiskFlags(round, input.investors, pipeline);
  const valSummary = computeValuationSummary(round, pipeline);
  const dilScenarios = computeDilutionScenarios(round, scenarios, valSummary);
  const allocPlan = computeAllocationPlan(input.investors, input.commitments);
  const valFlags  = computeValuationRiskFlags(round, valSummary, allocPlan, pipeline);

  // Data room
  const drIntel = computeDataRoomIntelligence(
    input.materials, input.materialShares, input.materialRequests, input.investors,
  );

  // Portal
  const materialTitlesMap = new Map<number, string>();
  for (const m of input.materials) {
    materialTitlesMap.set(Number(m.id), m.title ?? "Untitled");
  }
  const portalIntel = computePortalIntelligence(
    input.portalAccesses, input.portalEvents, input.investors, materialTitlesMap,
  );

  // Engagement
  const engRows = buildEngagementRows(input);
  const engAnalytics = computeEngagementAnalytics(
    engRows, input.portalEvents, input.materialShares, input.emailLinks,
  );

  // All risk flags merged
  const allCritical = [
    ...riskFlags.filter((f: any) => f.severity === "critical").map((f: any) => f.message),
    ...valFlags.filter((f: any) => f.severity === "critical").map((f: any) => f.message),
  ];
  const allWarnings = [
    ...riskFlags.filter((f: any) => f.severity === "warning").map((f: any) => f.message),
    ...valFlags.filter((f: any) => f.severity === "warning").map((f: any) => f.message),
  ];

  const pctToTarget = pipeline.target_amount > 0
    ? Math.round((pipeline.committed_amount / pipeline.target_amount) * 100)
    : 0;

  // Pipeline table — top investors
  const pipelineTable = input.investors
    .filter((i: any) => !["Passed", "Do Not Contact"].includes(i.stage ?? ""))
    .map((inv: any) => {
      const comm = input.commitments.find((c: any) => c.investor_id === inv.id);
      return {
        investor_name:     inv.name,
        stage:             inv.stage ?? "",
        priority:          inv.priority ?? "",
        target_amount:     inv.target_cheque_amount != null ? Number(inv.target_cheque_amount) : null,
        committed:         !!comm && ["Committed", "Wired / Closed", "Soft Commit"].includes(inv.stage ?? ""),
        commitment_amount: comm?.amount != null ? Number(comm.amount) : null,
        closing_status:    comm?.closing_status ?? null,
      };
    })
    .sort((a, b) => {
      const stageWeight: Record<string, number> = {
        "Wired / Closed": 0, "Committed": 1, "Soft Commit": 2,
        "Partner Meeting": 3, "Diligence": 4, "Follow-Up": 5,
        "First Meeting": 6, "Intro Made": 7,
      };
      return (stageWeight[a.stage] ?? 9) - (stageWeight[b.stage] ?? 9);
    })
    .slice(0, opts.include_sensitive ? 50 : 20);

  // Scenario range for valuation display
  const scenarioAmounts = dilScenarios.map((s: any) => s.amount);
  const scenarioRange = scenarioAmounts.length >= 2
    ? { min_amount: Math.min(...scenarioAmounts), max_amount: Math.max(...scenarioAmounts) }
    : null;

  // Management asks derived from critical flags
  const managementAsks: string[] = [];
  if (allCritical.length > 0) managementAsks.push("Board guidance requested on flagged blockers");
  if (!valSummary.has_valuation_data) managementAsks.push("Confirm round instrument and valuation terms");
  if (pipeline.pct_to_target != null && pipeline.pct_to_target < 50) {
    managementAsks.push("Board introductions needed — pipeline below 50% of target");
  }
  if (drIntel.overdue_requests > 0) {
    managementAsks.push(`${drIntel.overdue_requests} overdue diligence requests require response`);
  }

  const wiredAmount = input.commitments
    .filter((c: any) => c.closing_status === "wired" || c.closing_status === "closed")
    .reduce((sum: number, c: any) => sum + Number(c.amount ?? 0), 0);

  return {
    ...base,
    report_type: "board_update",
    round_headline: {
      name:                       round.name ?? "Unnamed Round",
      status:                     round.status ?? "Unknown",
      instrument:                 round.round_instrument ?? null,
      target_amount:              pipeline.target_amount,
      min_close_target:           round.minimum_close_target ? Number(round.minimum_close_target) : null,
      committed_amount:           pipeline.committed_amount,
      wired_amount:               wiredAmount,
      weighted_pipeline:          pipeline.weighted_pipeline,
      pct_to_target:              pctToTarget,
      target_close_date:          round.target_close_date ?? null,
      runway_today_months:        runway.runway_today_months,
      runway_after_target_months: runway.runway_after_target_months,
    },
    valuation_summary: {
      instrument:                 valSummary.instrument,
      pre_money:                  valSummary.pre_money,
      effective_valuation:        valSummary.effective_valuation,
      new_investor_ownership_pct: valSummary.new_investor_ownership_pct,
      valuation_cap:              valSummary.valuation_cap,
      has_valuation_data:         valSummary.has_valuation_data,
      warnings:                   valSummary.warnings,
      scenario_range:             scenarioRange,
    },
    pipeline_table:  pipelineTable,
    data_room_portal: {
      active_portals:                     portalIntel.active_portals,
      portal_opens_7d:                    portalIntel.total_views_7d,
      material_views_7d:                  engAnalytics.material_views_7d,
      pitch_deck_ready:                   drIntel.has_pitch_deck,
      financial_model_ready:              drIntel.has_financial_model,
      investors_missing_key_materials:    drIntel.investors_without_key_materials.length,
    },
    risk_summary: {
      critical_flags: allCritical,
      warning_flags:  allWarnings,
      total_flags:    allCritical.length + allWarnings.length,
    },
    management_asks: managementAsks,
  };
}

// ── CFO Closing Report ────────────────────────────────────────────────────────

function buildCfoClosing(
  input: ReportInput,
  base: ReportBase,
  _opts: ReportOptions,
): CfoClosingReport {
  const round = input.round ?? {};

  const pipeline   = computeWeightedPipeline(round, input.investors, input.commitments);
  const runway     = computeRunway(round, pipeline.weighted_pipeline);
  const scenarios  = computeScenarios(round, pipeline, runway);
  const valSummary = computeValuationSummary(round, pipeline);
  const allocPlan  = computeAllocationPlan(input.investors, input.commitments);
  const closePlan  = computeClosePlan(allocPlan, pipeline);
  const checklist  = computeCloseChecklist(round, input.investors, pipeline, allocPlan);

  // Close summary by closing_status
  const byStatus = (status: string) =>
    input.commitments.filter((c: any) => c.closing_status === status)
      .reduce((sum: number, c: any) => sum + Number(c.amount ?? 0), 0);

  const wiredAmount  = byStatus("wired");
  const closedAmount = byStatus("closed");
  const droppedAmount = byStatus("dropped");
  const docsSigned   = input.commitments.filter((c: any) => c.closing_status === "docs_signed").length;
  const docsSent     = input.commitments.filter((c: any) => c.closing_status === "docs_sent").length;
  const fundsPending = input.commitments.filter((c: any) => c.closing_status === "funds_pending").length;
  const notStarted   = input.commitments.filter((c: any) =>
    !c.closing_status || c.closing_status === "not_started",
  ).length;

  const pctToTarget = pipeline.target_amount > 0
    ? Math.round((pipeline.committed_amount / pipeline.target_amount) * 100)
    : 0;
  const minClose = round.minimum_close_target ? Number(round.minimum_close_target) : null;
  const pctToMin = minClose && minClose > 0
    ? Math.round((pipeline.committed_amount / minClose) * 100)
    : null;

  // Allocation table (board-safe subset)
  const allocTable = allocPlan.map((row: any) => ({
    investor_name:     row.investor_name,
    stage:             row.stage,
    allocation_status: row.allocation_status,
    closing_status:    row.closing_status,
    committed_amount:  row.committed_amount,
    docs_sent_at:      row.docs_sent_at,
    docs_signed_at:    row.docs_signed_at,
    funds_received_at: row.funds_received_at,
  }));

  // Close plan groups
  const closePlanGroups = closePlan.groups.map((g: any) => ({
    label:        g.label,
    status:       g.status,
    count:        g.count,
    total_amount: g.total_amount,
    investors:    g.investors.map((inv: any) => inv.investor_name),
  }));

  // Runway scenarios
  const runwayScenarios = scenarios.map((s: any) => ({
    name:                s.name,
    amount:              s.amount,
    runway_added_months: s.runway_added_months,
    description:         s.description,
  }));

  return {
    ...base,
    report_type: "cfo_closing",
    close_summary: {
      total_in_close:   closePlan.total_committed_in_close,
      wired_amount:     wiredAmount,
      closed_amount:    closedAmount,
      funds_pending:    fundsPending,
      docs_signed:      docsSigned,
      docs_sent:        docsSent,
      not_started:      notStarted,
      dropped_amount:   droppedAmount,
      pct_to_target:    pctToTarget,
      pct_to_min_close: pctToMin,
    },
    allocation_table:   allocTable,
    close_plan_groups:  closePlanGroups,
    checklist_items:    checklist.map((item: any) => ({
      key:      item.key,
      label:    item.label,
      complete: item.complete,
      note:     item.note,
    })),
    runway_scenarios:   runwayScenarios,
    valuation_warnings: valSummary.warnings,
  };
}

// ── Investor Engagement Report ─────────────────────────────────────────────────

function buildEngagementReport(
  input: ReportInput,
  base: ReportBase,
  _opts: ReportOptions,
): EngagementReport {
  const engRows = buildEngagementRows(input);

  const analytics = computeEngagementAnalytics(
    engRows, input.portalEvents, input.materialShares, input.emailLinks,
  );

  const materialLeaderboard = computeMaterialEngagement(
    input.materials, input.materialShares, input.portalEvents,
  );

  const materialTitlesMap = new Map<number, string>();
  for (const m of input.materials) {
    materialTitlesMap.set(Number(m.id), m.title ?? "Untitled");
  }
  const portalIntel = computePortalIntelligence(
    input.portalAccesses, input.portalEvents, input.investors, materialTitlesMap,
  );

  // Top engaged (top 10)
  const topEngaged = [...engRows]
    .sort((a: any, b: any) => b.engagement_score - a.engagement_score)
    .slice(0, 10)
    .map((r: any, i: number) => ({
      rank:               i + 1,
      investor_name:      r.investor_name,
      stage:              r.stage,
      engagement_score:   r.engagement_score,
      engagement_tier:    r.engagement_tier,
      recommended_action: r.recommended_next_action ?? "",
      last_engagement_at: r.last_meaningful_engagement_at ?? null,
    }));

  // Stale investors with risk flags
  const staleInvestors = engRows
    .filter((r: any) => ["Stale", "Cold"].includes(r.engagement_tier) &&
      !["Passed", "Do Not Contact"].includes(r.stage))
    .map((r: any) => ({
      investor_name:   r.investor_name,
      stage:           r.stage,
      engagement_tier: r.engagement_tier,
      last_contact:    r.last_meaningful_engagement_at ?? null,
      risk_flags:      r.risk_flags ?? [],
    }))
    .sort((a, b) => {
      if (a.last_contact === null && b.last_contact !== null) return -1;
      if (a.last_contact !== null && b.last_contact === null) return 1;
      return 0;
    })
    .slice(0, 10);

  // Material leaderboard (top 8)
  const matLeaderboard = materialLeaderboard.slice(0, 8).map((m: any, i: number) => ({
    rank:            i + 1,
    material_title:  m.material_title,
    material_type:   m.material_type,
    total_views:     m.total_views,
    total_downloads: m.total_downloads,
    investor_count:  m.investor_count,
  }));

  // Follow-up recommendations (top 10 hot/active investors missing follow-up)
  const followUps = engRows
    .filter((r: any) =>
      !r.do_not_contact &&
      !["Passed", "Do Not Contact"].includes(r.stage) &&
      (r.recommended_next_action || r.risk_flags?.length > 0)
    )
    .sort((a: any, b: any) => {
      const tierOrder: Record<string, number> = {
        "Highly Engaged": 0, "Engaged": 1, "Watching": 2, "Stale": 3, "Cold": 4,
      };
      return (tierOrder[a.engagement_tier] ?? 5) - (tierOrder[b.engagement_tier] ?? 5);
    })
    .slice(0, 10)
    .map((r: any) => ({
      investor_name:      r.investor_name,
      stage:              r.stage,
      priority:           r.priority ?? "Medium",
      recommended_action: r.recommended_next_action ?? "",
      reason:             (r.reasons ?? []).slice(0, 2).join("; "),
    }));

  return {
    ...base,
    report_type: "engagement",
    analytics,
    top_engaged:              topEngaged,
    stale_investors:          staleInvestors,
    material_leaderboard:     matLeaderboard,
    portal_summary: {
      active_portals:           portalIntel.active_portals,
      portals_never_opened:     portalIntel.portals_never_opened.length,
      investors_without_portal: portalIntel.investors_without_portal,
      total_views_7d:           portalIntel.total_views_7d,
      total_downloads_7d:       portalIntel.total_downloads_7d,
    },
    follow_up_recommendations: followUps,
  };
}

// ── Markdown generation ───────────────────────────────────────────────────────

export function reportToMarkdown(report: AnyReport): string {
  const lines: string[] = [];
  const now = fmtDate(report.generated_at);

  switch (report.report_type) {
    case "weekly_brief": return weeklyBriefToMarkdown(report as WeeklyBriefReport, now);
    case "board_update": return boardUpdateToMarkdown(report as BoardUpdateReport, now);
    case "cfo_closing":  return cfoClosingToMarkdown(report as CfoClosingReport, now);
    case "engagement":   return engagementToMarkdown(report as EngagementReport, now);
  }
  return lines.join("\n");
}

function weeklyBriefToMarkdown(r: WeeklyBriefReport, now: string): string {
  const lines: string[] = [];
  lines.push(`# ${r.report_title}`);
  lines.push(`**Round:** ${r.round_name ?? "—"} | **Generated:** ${now}`);
  lines.push("");

  lines.push("## Round Status");
  lines.push(`- **Target:** ${fmtM(r.round_status.target_amount)} | **Committed:** ${fmtM(r.round_status.committed_amount)} (${fmtPct(r.round_status.pct_to_target)} to target)`);
  lines.push(`- **Weighted Pipeline:** ${fmtM(r.round_status.weighted_pipeline)}`);
  if (r.round_status.target_close_date) lines.push(`- **Target Close:** ${fmtDate(r.round_status.target_close_date)}`);
  lines.push("");

  lines.push("## Pipeline Momentum");
  lines.push(`- Active: ${r.pipeline_momentum.total_active} | Committed: ${r.pipeline_momentum.committed_count} | Diligence: ${r.pipeline_momentum.diligence_count}`);
  lines.push(`- Soft Circle: ${r.pipeline_momentum.soft_circle_count} | New this week: ${r.pipeline_momentum.new_this_week}`);
  if (r.pipeline_momentum.hot_leads.length > 0) {
    lines.push("- **Hot Leads:** " + r.pipeline_momentum.hot_leads.map(l => `${l.name} (${l.stage})`).join(", "));
  }
  lines.push("");

  lines.push("## This Week's Priorities");
  for (const a of r.this_week_priority.actions.slice(0, 5)) {
    lines.push(`- [${a.priority}] **${a.investor_name}** — ${a.action}${a.reason ? ` _(${a.reason})_` : ""}`);
  }
  if (r.this_week_priority.total_actions > 5) {
    lines.push(`- _…and ${r.this_week_priority.total_actions - 5} more actions_`);
  }
  lines.push("");

  if (r.risk_flags.critical.length > 0) {
    lines.push("## 🚨 Critical Risks");
    for (const f of r.risk_flags.critical) lines.push(`- ${f}`);
    lines.push("");
  }
  if (r.risk_flags.warning.length > 0) {
    lines.push("## ⚠️ Warnings");
    for (const f of r.risk_flags.warning.slice(0, 5)) lines.push(`- ${f}`);
    lines.push("");
  }

  lines.push("## Engagement Pulse");
  lines.push(`- Highly Engaged: ${r.engagement_pulse.highly_engaged_count} | Engaged: ${r.engagement_pulse.engaged_count} | Cold: ${r.engagement_pulse.cold_count}`);
  lines.push(`- Portal Opens (7d): ${r.engagement_pulse.portal_opens_7d} | Material Views (7d): ${r.engagement_pulse.material_views_7d}`);
  lines.push(`- Inbound Replies (7d): ${r.engagement_pulse.recent_inbound_replies}`);
  lines.push("");

  lines.push("## Data Room");
  lines.push(`- Pitch Deck: ${r.data_room_status.has_pitch_deck ? "✓ Ready" : "✗ Missing"} | Financial Model: ${r.data_room_status.has_financial_model ? "✓ Ready" : "✗ Missing"}`);
  lines.push(`- Active Materials: ${r.data_room_status.active_materials} | Stale Shares: ${r.data_room_status.stale_shares} | Open Requests: ${r.data_room_status.pending_requests}`);

  return lines.join("\n");
}

function boardUpdateToMarkdown(r: BoardUpdateReport, now: string): string {
  const lines: string[] = [];
  lines.push(`# ${r.report_title}`);
  lines.push(`**Round:** ${r.round_name ?? "—"} | **Generated:** ${now} | _Confidential — Board Only_`);
  lines.push("");

  lines.push("## Round Headline");
  const h = r.round_headline;
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| Round | ${h.name} (${h.status}) |`);
  lines.push(`| Target | ${fmtM(h.target_amount)} |`);
  if (h.min_close_target) lines.push(`| Minimum Close | ${fmtM(h.min_close_target)} |`);
  lines.push(`| Committed | ${fmtM(h.committed_amount)} (${fmtPct(h.pct_to_target)} to target) |`);
  lines.push(`| Wired | ${fmtM(h.wired_amount)} |`);
  lines.push(`| Weighted Pipeline | ${fmtM(h.weighted_pipeline)} |`);
  if (h.target_close_date) lines.push(`| Target Close | ${fmtDate(h.target_close_date)} |`);
  if (h.runway_today_months != null) lines.push(`| Runway Today | ${h.runway_today_months} months |`);
  if (h.runway_after_target_months != null) lines.push(`| Runway After Raise | ${h.runway_after_target_months} months |`);
  lines.push("");

  lines.push("## Valuation");
  const v = r.valuation_summary;
  if (!v.has_valuation_data) {
    lines.push("_Valuation terms not yet set._");
  } else {
    if (v.instrument) lines.push(`- **Instrument:** ${v.instrument}`);
    if (v.pre_money) lines.push(`- **Pre-Money:** ${fmtM(v.pre_money)}`);
    if (v.effective_valuation) lines.push(`- **Effective Valuation:** ${fmtM(v.effective_valuation)}`);
    if (v.new_investor_ownership_pct != null) lines.push(`- **Investor Ownership:** ${v.new_investor_ownership_pct}%`);
    if (v.valuation_cap) lines.push(`- **Valuation Cap:** ${fmtM(v.valuation_cap)}`);
    if (v.scenario_range) lines.push(`- **Scenario Range:** ${fmtM(v.scenario_range.min_amount)} — ${fmtM(v.scenario_range.max_amount)}`);
    for (const w of v.warnings) lines.push(`- _⚠ ${w}_`);
  }
  lines.push("");

  lines.push("## Investor Pipeline");
  lines.push("| Investor | Stage | Priority | Target | Committed |");
  lines.push("|---|---|---|---|---|");
  for (const inv of r.pipeline_table.slice(0, 15)) {
    lines.push(`| ${inv.investor_name} | ${inv.stage} | ${inv.priority} | ${inv.target_amount != null ? fmtM(inv.target_amount) : "—"} | ${inv.commitment_amount != null ? fmtM(inv.commitment_amount) : "—"} |`);
  }
  if (r.pipeline_table.length > 15) lines.push(`| _…${r.pipeline_table.length - 15} more_ | | | | |`);
  lines.push("");

  lines.push("## Data Room & Portal");
  const dp = r.data_room_portal;
  lines.push(`- Pitch Deck: ${dp.pitch_deck_ready ? "✓" : "✗"} | Financial Model: ${dp.financial_model_ready ? "✓" : "✗"}`);
  lines.push(`- Active Portals: ${dp.active_portals} | Portal Views (7d): ${dp.portal_opens_7d}`);
  lines.push(`- Investors Missing Key Materials: ${dp.investors_missing_key_materials}`);
  lines.push("");

  if (r.risk_summary.critical_flags.length > 0) {
    lines.push("## 🚨 Critical Issues for Board Attention");
    for (const f of r.risk_summary.critical_flags) lines.push(`- ${f}`);
    lines.push("");
  }

  if (r.management_asks.length > 0) {
    lines.push("## Management Asks");
    for (const ask of r.management_asks) lines.push(`- ${ask}`);
  }

  return lines.join("\n");
}

function cfoClosingToMarkdown(r: CfoClosingReport, now: string): string {
  const lines: string[] = [];
  lines.push(`# ${r.report_title}`);
  lines.push(`**Round:** ${r.round_name ?? "—"} | **Generated:** ${now} | _Confidential — CFO Only_`);
  lines.push("");

  lines.push("## Close Summary");
  const s = r.close_summary;
  lines.push(`| Status | Amount |`);
  lines.push(`|---|---|`);
  lines.push(`| Total in Close | ${fmtM(s.total_in_close)} |`);
  lines.push(`| Wired | ${fmtM(s.wired_amount)} |`);
  lines.push(`| Closed | ${fmtM(s.closed_amount)} |`);
  lines.push(`| Docs Signed (${s.docs_signed} investors) | — |`);
  lines.push(`| Docs Sent (${s.docs_sent} investors) | — |`);
  lines.push(`| Funds Pending (${s.funds_pending} investors) | — |`);
  lines.push(`| Not Started (${s.not_started} investors) | — |`);
  lines.push(`| Dropped | ${fmtM(s.dropped_amount)} |`);
  lines.push(`| % to Target | ${fmtPct(s.pct_to_target)} |`);
  if (s.pct_to_min_close != null) lines.push(`| % to Minimum Close | ${fmtPct(s.pct_to_min_close)} |`);
  lines.push("");

  if (r.close_plan_groups.length > 0) {
    lines.push("## Close Plan Groups");
    lines.push("| Group | Investors | Total |");
    lines.push("|---|---|---|");
    for (const g of r.close_plan_groups) {
      lines.push(`| ${g.label} (${g.count}) | ${g.investors.slice(0, 3).join(", ")}${g.count > 3 ? ` +${g.count - 3}` : ""} | ${fmtM(g.total_amount)} |`);
    }
    lines.push("");
  }

  if (r.checklist_items.length > 0) {
    lines.push("## Closing Checklist");
    for (const item of r.checklist_items) {
      lines.push(`- [${item.complete ? "x" : " "}] **${item.label}**${item.note ? ` — _${item.note}_` : ""}`);
    }
    lines.push("");
  }

  lines.push("## Runway Scenarios");
  lines.push("| Scenario | Amount | Runway Added |");
  lines.push("|---|---|---|");
  for (const sc of r.runway_scenarios) {
    lines.push(`| ${sc.name} | ${fmtM(sc.amount)} | ${sc.runway_added_months != null ? `+${sc.runway_added_months}mo` : "—"} |`);
  }

  if (r.valuation_warnings.length > 0) {
    lines.push("");
    lines.push("## Valuation Warnings");
    for (const w of r.valuation_warnings) lines.push(`- ⚠ ${w}`);
  }

  return lines.join("\n");
}

function engagementToMarkdown(r: EngagementReport, now: string): string {
  const lines: string[] = [];
  lines.push(`# ${r.report_title}`);
  lines.push(`**Round:** ${r.round_name ?? "—"} | **Generated:** ${now}`);
  lines.push("");

  const a = r.analytics;
  lines.push("## Engagement Summary");
  lines.push(`| Tier | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| Highly Engaged | ${a.highly_engaged_count} |`);
  lines.push(`| Engaged | ${a.engaged_count} |`);
  lines.push(`| Watching | ${a.watching_count} |`);
  lines.push(`| Stale | ${a.stale_count} |`);
  lines.push(`| Cold | ${a.cold_count} |`);
  lines.push(`| **Total** | **${a.total_investors}** |`);
  lines.push("");

  lines.push("## 7-Day Activity");
  lines.push(`- Portal Opens: ${a.portal_opens_7d} | Material Views: ${a.material_views_7d} | Downloads: ${a.material_downloads_7d}`);
  lines.push(`- Inbound Replies: ${a.recent_inbound_replies}`);
  if (a.no_engagement_after_portal > 0) {
    lines.push(`- ⚠ ${a.no_engagement_after_portal} investors have portal access but no engagement`);
  }
  if (a.hot_with_stale_followup > 0) {
    lines.push(`- ⚠ ${a.hot_with_stale_followup} hot investors with no follow-up in 7+ days`);
  }
  lines.push("");

  if (r.top_engaged.length > 0) {
    lines.push("## Top Engaged Investors");
    lines.push("| # | Investor | Stage | Score | Tier | Next Action |");
    lines.push("|---|---|---|---|---|---|");
    for (const inv of r.top_engaged) {
      lines.push(`| ${inv.rank} | ${inv.investor_name} | ${inv.stage} | ${inv.engagement_score} | ${inv.engagement_tier} | ${inv.recommended_action} |`);
    }
    lines.push("");
  }

  if (r.material_leaderboard.length > 0) {
    lines.push("## Material Leaderboard");
    lines.push("| # | Material | Type | Views | Downloads | Investors |");
    lines.push("|---|---|---|---|---|---|");
    for (const m of r.material_leaderboard) {
      lines.push(`| ${m.rank} | ${m.material_title} | ${m.material_type} | ${m.total_views} | ${m.total_downloads} | ${m.investor_count} |`);
    }
    lines.push("");
  }

  if (r.follow_up_recommendations.length > 0) {
    lines.push("## Follow-Up Recommendations");
    for (const f of r.follow_up_recommendations) {
      lines.push(`- **${f.investor_name}** (${f.stage} · ${f.priority}): ${f.recommended_action}${f.reason ? ` — _${f.reason}_` : ""}`);
    }
  }

  return lines.join("\n");
}

// ── CSV generation ────────────────────────────────────────────────────────────

export function reportToCsv(report: AnyReport): { filename: string; rows: Record<string, any>[] } | null {
  if (report.report_type === "cfo_closing") {
    const r = report as CfoClosingReport;
    return {
      filename: `cfo-closing-${report.round_id ?? "unknown"}-${new Date().toISOString().slice(0, 10)}.csv`,
      rows: r.allocation_table.map(row => ({
        "Investor":         row.investor_name,
        "Stage":            row.stage,
        "Allocation Status": row.allocation_status,
        "Closing Status":   row.closing_status,
        "Committed Amount": row.committed_amount ?? "",
        "Docs Sent":        row.docs_sent_at ?? "",
        "Docs Signed":      row.docs_signed_at ?? "",
        "Funds Received":   row.funds_received_at ?? "",
      })),
    };
  }

  if (report.report_type === "engagement") {
    const r = report as EngagementReport;
    return {
      filename: `engagement-${report.round_id ?? "unknown"}-${new Date().toISOString().slice(0, 10)}.csv`,
      rows: r.top_engaged.concat(r.stale_investors.map((s: any) => ({
        rank:               null,
        investor_name:      s.investor_name,
        stage:              s.stage,
        engagement_score:   null,
        engagement_tier:    s.engagement_tier,
        recommended_action: "",
        last_engagement_at: s.last_contact,
      }))).map(row => ({
        "Rank":            row.rank ?? "",
        "Investor":        row.investor_name,
        "Stage":           row.stage,
        "Score":           row.engagement_score ?? "",
        "Tier":            row.engagement_tier,
        "Last Engagement": row.last_engagement_at ?? "",
        "Next Action":     row.recommended_action ?? "",
      })),
    };
  }

  return null;
}
