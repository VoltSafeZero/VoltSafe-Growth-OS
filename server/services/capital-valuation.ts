/**
 * Capital Valuation, Dilution, Allocation & Close Plan — computation service (Phase 2F)
 *
 * Pure functions: no DB calls, no side effects.
 * All DB queries stay in routes-capital.ts.
 * Transparent math — every output includes the assumptions used.
 */

import type { WeightedPipelineResult, RiskFlag, Scenario } from "./capital-command-center.js";

// ── Constants ──────────────────────────────────────────────────────────────────

export const ROUND_INSTRUMENTS = ["priced_equity", "SAFE", "convertible_note", "grant", "other"] as const;
export type RoundInstrument = typeof ROUND_INSTRUMENTS[number];

export const ALLOCATION_STATUSES = [
  "unallocated", "proposed", "reserved", "confirmed", "reduced", "increased", "rejected",
] as const;

export const CLOSING_STATUSES = [
  "not_started", "docs_sent", "docs_signed", "funds_pending", "wired", "closed", "dropped",
] as const;

export const CLOSING_STATUS_LABELS: Record<string, string> = {
  not_started:   "Not Started",
  docs_sent:     "Docs Sent",
  docs_signed:   "Docs Signed",
  funds_pending: "Funds Pending",
  wired:         "Wired",
  closed:        "Closed",
  dropped:       "Dropped",
};

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ValuationSummary {
  instrument:              string | null;
  pre_money:               number | null;
  post_money_computed:     number | null;
  post_money_manual:       number | null;
  amount_raised:           number;
  share_price:             number | null;
  option_pool_pre:         number | null;
  option_pool_post:        number | null;
  valuation_cap:           number | null;
  discount_rate:           number | null;
  interest_rate:           number | null;
  maturity_date:           string | null;
  legal_close_status:      string | null;
  new_investor_ownership_pct: number | null;
  effective_valuation:     number | null;
  is_priced:               boolean;
  is_safe_or_convertible:  boolean;
  warnings:                string[];
  has_valuation_data:      boolean;
}

export interface DilutionScenario {
  name:                  string;
  key:                   string;
  amount:                number;
  runway_added_months:   number | null;
  gap_to_target:         number;
  required_additional:   number;
  description:           string;
  post_money_valuation:  number | null;
  new_investor_pct:      number | null;
  dilution_pct:          number | null;
  dilution_warnings:     string[];
  assumptions:           string[];
}

export interface AllocationRow {
  investor_id:            number;
  investor_name:          string;
  investor_type:          string;
  stage:                  string;
  commitment_id:          number | null;
  requested_amount:       number | null;
  allocation_amount:      number | null;
  final_allocation_amount: number | null;
  committed_amount:       number | null;
  allocation_status:      string;
  closing_status:         string;
  docs_sent_at:           string | null;
  docs_signed_at:         string | null;
  funds_received_at:      string | null;
  allocation_notes:       string | null;
  target_cheque_amount:   number | null;
  score:                  number;
  tier:                   string;
  likely_lead:            boolean;
  last_touch_at:          string | null;
  next_step:              string | null;
}

export interface ClosePlanGroup {
  status:           string;
  label:            string;
  investors:        AllocationRow[];
  total_amount:     number;
  count:            number;
  pct_of_target:    number | null;
  pct_of_min_close: number | null;
}

export interface ClosePlanSummary {
  groups:             ClosePlanGroup[];
  total_committed_in_close: number;
  wired_amount:       number;
  closed_amount:      number;
  dropped_amount:     number;
  pending_wire:       number;
  alerts:             string[];
}

export interface CloseChecklistItem {
  key:      string;
  label:    string;
  complete: boolean;
  note?:    string;
}

// ── Scoring (mirrors routes-capital.ts — kept independent for pure service) ────

function simpleScore(inv: any): { score: number; tier: string } {
  if (inv.stage === "Passed" || inv.status === "Inactive" || inv.do_not_contact) return { score: 0, tier: "Low Priority" };
  let score = 0;
  const stageScores: Record<string, number> = {
    "Wired / Closed": 40, "Committed": 40, "Soft Commit": 35,
    "Partner Meeting": 30, "Diligence": 25, "Follow-Up": 20,
    "First Meeting": 15, "Intro Made": 10, "Intro Needed": 5, "Target Identified": 5,
  };
  score += stageScores[inv.stage] ?? 5;
  const priorityScores: Record<string, number> = { Critical: 30, High: 22, Medium: 12, Low: 4 };
  score += priorityScores[inv.priority] ?? 4;
  const warmthScores: Record<string, number> = { Hot: 20, Warm: 12, Cold: 2 };
  score += warmthScores[inv.warmth] ?? 2;
  if (inv.last_touch_at) {
    const d = (Date.now() - new Date(inv.last_touch_at).getTime()) / 86400000;
    if (d > 90) score -= 20; else if (d > 45) score -= 10; else if (d > 21) score -= 5;
  } else score -= 20;
  const clamped = Math.max(0, Math.min(100, score));
  const tier = clamped >= 55 ? "Hot" : clamped >= 35 ? "Warm" : clamped >= 15 ? "Nurture" : "Low Priority";
  return { score: clamped, tier };
}

// ── Valuation summary ──────────────────────────────────────────────────────────

/**
 * Summarise round valuation/instrument details and compute derived metrics.
 * Returns warnings instead of pretending to be precise when data is missing.
 */
export function computeValuationSummary(
  round: any,
  pipeline: WeightedPipelineResult,
): ValuationSummary {
  const instrument: string | null = round.round_instrument || null;
  const preMoney:   number | null = round.pre_money_valuation ? Number(round.pre_money_valuation) : null;
  const postMoneyManual: number | null = round.post_money_valuation ? Number(round.post_money_valuation) : null;
  const sharePrice: number | null = round.share_price ? Number(round.share_price) : null;
  const optPoolPre: number | null = round.option_pool_percent_pre != null ? Number(round.option_pool_percent_pre) : null;
  const optPoolPost: number | null = round.option_pool_percent_post != null ? Number(round.option_pool_percent_post) : null;
  const valuationCap: number | null = round.valuation_cap ? Number(round.valuation_cap) : null;
  const discountRate: number | null = round.discount_rate != null ? Number(round.discount_rate) : null;
  const interestRate: number | null = round.interest_rate != null ? Number(round.interest_rate) : null;
  const maturityDate: string | null = round.maturity_date || null;
  const legalStatus: string | null = round.legal_close_status || null;

  const amountRaised = pipeline.committed_amount;

  const isPriced = instrument === "priced_equity";
  const isSafeOrConvertible = instrument === "SAFE" || instrument === "convertible_note";

  const warnings: string[] = [];
  let postMoneyComputed: number | null = null;
  let newInvestorOwnershipPct: number | null = null;
  let effectiveValuation: number | null = null;

  if (isPriced) {
    if (preMoney && amountRaised > 0) {
      postMoneyComputed = preMoney + amountRaised;
      if (postMoneyComputed > 0) {
        newInvestorOwnershipPct = Math.round((amountRaised / postMoneyComputed) * 10000) / 100;
      }
    } else {
      if (!preMoney) warnings.push("Pre-money valuation not set — ownership % cannot be computed");
      if (amountRaised === 0) warnings.push("No committed capital yet — dilution is estimated");
    }
    if (!sharePrice) warnings.push("Share price not set — per-share math unavailable");
    effectiveValuation = postMoneyComputed || postMoneyManual || preMoney;
  } else if (isSafeOrConvertible) {
    if (valuationCap) {
      effectiveValuation = valuationCap;
      if (amountRaised > 0) {
        newInvestorOwnershipPct = Math.round((amountRaised / valuationCap) * 10000) / 100;
        warnings.push("Ownership % is estimated at cap — actual % depends on conversion price at next priced round");
      }
      if (discountRate) {
        warnings.push(`Discount rate ${discountRate}% will reduce conversion price — actual ownership will be higher than cap estimate`);
      }
    } else {
      warnings.push("No valuation cap set — ownership % cannot be estimated until next priced round");
    }
    if (!discountRate && !valuationCap) {
      warnings.push("Neither discount rate nor valuation cap set — SAFE/note terms are incomplete");
    }
  } else if (!instrument) {
    warnings.push("Investment instrument not selected");
  }

  if (optPoolPre != null && optPoolPost != null && optPoolPost > optPoolPre) {
    warnings.push(`Option pool expanding from ${optPoolPre}% to ${optPoolPost}% pre-money — increases effective dilution for founders`);
  }

  const hasValuationData = !!(instrument || preMoney || valuationCap || sharePrice);

  return {
    instrument,
    pre_money:              preMoney,
    post_money_computed:    postMoneyComputed,
    post_money_manual:      postMoneyManual,
    amount_raised:          amountRaised,
    share_price:            sharePrice,
    option_pool_pre:        optPoolPre,
    option_pool_post:       optPoolPost,
    valuation_cap:          valuationCap,
    discount_rate:          discountRate,
    interest_rate:          interestRate,
    maturity_date:          maturityDate,
    legal_close_status:     legalStatus,
    new_investor_ownership_pct: newInvestorOwnershipPct,
    effective_valuation:    effectiveValuation,
    is_priced:              isPriced,
    is_safe_or_convertible: isSafeOrConvertible,
    warnings,
    has_valuation_data:     hasValuationData,
  };
}

// ── Dilution scenarios ─────────────────────────────────────────────────────────

/**
 * Extend base scenarios with dilution math for each amount.
 */
export function computeDilutionScenarios(
  round: any,
  scenarios: Scenario[],
  valuation: ValuationSummary,
): DilutionScenario[] {
  return scenarios.map(s => {
    const warnings: string[] = [];
    const assumptions: string[] = [];
    let postMoney: number | null = null;
    let newInvestorPct: number | null = null;
    let dilutionPct: number | null = null;

    if (valuation.is_priced) {
      if (valuation.pre_money) {
        postMoney = valuation.pre_money + s.amount;
        if (postMoney > 0) {
          newInvestorPct = Math.round((s.amount / postMoney) * 10000) / 100;
          dilutionPct = newInvestorPct; // simplified: dilution ≈ new investor ownership in priced round
          assumptions.push(`Post-money = pre-money $${fmtM(valuation.pre_money)} + raise $${fmtM(s.amount)}`);
          if (valuation.option_pool_post && valuation.option_pool_pre) {
            const poolImpact = valuation.option_pool_post - valuation.option_pool_pre;
            if (poolImpact > 0) {
              assumptions.push(`Option pool expansion +${poolImpact}% adds to dilution`);
              dilutionPct = Math.round((newInvestorPct + poolImpact) * 100) / 100;
            }
          }
        }
      } else {
        warnings.push("Pre-money valuation not set — dilution cannot be computed");
      }
    } else if (valuation.is_safe_or_convertible) {
      if (valuation.valuation_cap) {
        postMoney = valuation.valuation_cap;
        if (postMoney > 0) {
          newInvestorPct = Math.round((s.amount / postMoney) * 10000) / 100;
          dilutionPct = newInvestorPct;
          assumptions.push(`Ownership estimated at valuation cap $${fmtM(valuation.valuation_cap)}`);
        }
        warnings.push("Actual dilution determined at conversion — this is a cap-based estimate only");
      } else {
        warnings.push("No valuation cap — dilution only knowable at next priced round");
      }
    } else {
      if (!valuation.instrument) {
        warnings.push("Investment instrument not selected — dilution unknown");
      } else {
        warnings.push(`${valuation.instrument} instrument — dilution modelling not applicable`);
      }
    }

    return {
      ...s,
      post_money_valuation: postMoney,
      new_investor_pct:     newInvestorPct,
      dilution_pct:         dilutionPct,
      dilution_warnings:    warnings,
      assumptions,
    };
  });
}

function fmtM(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
}

// ── Allocation plan ────────────────────────────────────────────────────────────

const ALLOCATION_RELEVANT_STAGES = new Set([
  "Soft Commit", "Diligence", "Partner Meeting",
  "Committed", "Wired / Closed", "Follow-Up",
]);

/**
 * Build per-investor allocation rows for the round.
 * Includes investors with a commitment OR in a relevant pipeline stage.
 */
export function computeAllocationPlan(
  investors: any[],
  commitments: any[],
): AllocationRow[] {
  const commByInvestor = new Map<number, any>();
  for (const c of commitments) {
    if (!commByInvestor.has(c.investor_id)) commByInvestor.set(c.investor_id, c);
  }

  const rows: AllocationRow[] = [];
  const seen = new Set<number>();

  // First: all investors with a commitment
  for (const c of commitments) {
    const inv = investors.find(i => i.id === c.investor_id);
    if (!inv) continue;
    seen.add(inv.id);
    const { score, tier } = simpleScore(inv);
    rows.push({
      investor_id:             inv.id,
      investor_name:           inv.name,
      investor_type:           inv.investor_type || "",
      stage:                   inv.stage,
      commitment_id:           c.id,
      requested_amount:        c.requested_amount != null ? Number(c.requested_amount) : null,
      allocation_amount:       c.allocation_amount != null ? Number(c.allocation_amount) : null,
      final_allocation_amount: c.final_allocation_amount != null ? Number(c.final_allocation_amount) : null,
      committed_amount:        c.amount != null ? Number(c.amount) : null,
      allocation_status:       c.allocation_status || "unallocated",
      closing_status:          c.closing_status || "not_started",
      docs_sent_at:            c.docs_sent_at || null,
      docs_signed_at:          c.docs_signed_at || null,
      funds_received_at:       c.funds_received_at || null,
      allocation_notes:        c.allocation_notes || null,
      target_cheque_amount:    inv.target_cheque_amount != null ? Number(inv.target_cheque_amount) : null,
      score,
      tier,
      likely_lead:             !!inv.likely_lead,
      last_touch_at:           inv.last_touch_at || null,
      next_step:               inv.next_step || null,
    });
  }

  // Second: investors in relevant stages without a commitment
  for (const inv of investors) {
    if (seen.has(inv.id)) continue;
    if (inv.stage === "Passed" || inv.do_not_contact || inv.status === "Inactive") continue;
    if (!ALLOCATION_RELEVANT_STAGES.has(inv.stage)) continue;
    const { score, tier } = simpleScore(inv);
    rows.push({
      investor_id:             inv.id,
      investor_name:           inv.name,
      investor_type:           inv.investor_type || "",
      stage:                   inv.stage,
      commitment_id:           null,
      requested_amount:        null,
      allocation_amount:       null,
      final_allocation_amount: null,
      committed_amount:        null,
      allocation_status:       "unallocated",
      closing_status:          "not_started",
      docs_sent_at:            null,
      docs_signed_at:          null,
      funds_received_at:       null,
      allocation_notes:        null,
      target_cheque_amount:    inv.target_cheque_amount != null ? Number(inv.target_cheque_amount) : null,
      score,
      tier,
      likely_lead:             !!inv.likely_lead,
      last_touch_at:           inv.last_touch_at || null,
      next_step:               inv.next_step || null,
    });
  }

  // Sort: likely_lead first, then by score desc, then by closing_status progress
  const closingOrder: Record<string, number> = {
    wired: 0, closed: 0, funds_pending: 1, docs_signed: 2, docs_sent: 3, not_started: 4, dropped: 9,
  };
  return rows.sort((a, b) => {
    if (a.likely_lead !== b.likely_lead) return a.likely_lead ? -1 : 1;
    const closeDiff = (closingOrder[a.closing_status] ?? 5) - (closingOrder[b.closing_status] ?? 5);
    if (closeDiff !== 0) return closeDiff;
    return b.score - a.score;
  });
}

// ── Close plan ─────────────────────────────────────────────────────────────────

export function computeClosePlan(
  allocationPlan: AllocationRow[],
  pipeline: WeightedPipelineResult,
): ClosePlanSummary {
  const groupMap = new Map<string, AllocationRow[]>();
  for (const status of CLOSING_STATUSES) groupMap.set(status, []);
  for (const row of allocationPlan) {
    const s = row.closing_status || "not_started";
    if (!groupMap.has(s)) groupMap.set(s, []);
    groupMap.get(s)!.push(row);
  }

  const target   = pipeline.target_amount;
  const minClose = pipeline.minimum_close_target;

  function bestAmount(row: AllocationRow): number {
    return Number(row.final_allocation_amount ?? row.allocation_amount ?? row.committed_amount ?? row.target_cheque_amount ?? 0);
  }

  const groups: ClosePlanGroup[] = Array.from(groupMap.entries()).map(([status, investors]) => {
    const total = investors.reduce((s, r) => s + bestAmount(r), 0);
    return {
      status,
      label:            CLOSING_STATUS_LABELS[status] || status,
      investors,
      total_amount:     total,
      count:            investors.length,
      pct_of_target:    target > 0 ? Math.round((total / target) * 1000) / 10 : null,
      pct_of_min_close: minClose > 0 ? Math.round((total / minClose) * 1000) / 10 : null,
    };
  });

  const wiredGroup   = groupMap.get("wired")    || [];
  const closedGroup  = groupMap.get("closed")   || [];
  const pendingGroup = groupMap.get("funds_pending") || [];
  const droppedGroup = groupMap.get("dropped")  || [];
  const docsSentGroup = groupMap.get("docs_sent") || [];
  const docsSignedGroup = groupMap.get("docs_signed") || [];

  const wiredAmount  = wiredGroup.reduce((s, r) => s + bestAmount(r), 0);
  const closedAmount = closedGroup.reduce((s, r) => s + bestAmount(r), 0);
  const droppedAmount = droppedGroup.reduce((s, r) => s + bestAmount(r), 0);
  const pendingWire  = pendingGroup.reduce((s, r) => s + bestAmount(r), 0);

  const alerts: string[] = [];

  // Committed but docs not started
  const committedNoAction = allocationPlan.filter(
    r => ["Committed", "Hard Circle"].includes(r.stage) && r.closing_status === "not_started"
  );
  if (committedNoAction.length > 0) {
    alerts.push(`${committedNoAction.length} committed investor(s) — docs not yet started`);
  }

  // Docs sent but not signed for >7 days
  const docsSentStale = docsSentGroup.filter(r => {
    if (!r.docs_sent_at) return false;
    return (Date.now() - new Date(r.docs_sent_at).getTime()) / 86400000 > 7;
  });
  if (docsSentStale.length > 0) {
    alerts.push(`${docsSentStale.length} investor(s) — docs sent 7+ days ago, not yet signed`);
  }

  // Docs signed but funds not wired
  if (docsSignedGroup.length > 0) {
    alerts.push(`${docsSignedGroup.length} investor(s) have signed docs — follow up on wire`);
  }

  // Funds pending long
  const fundsLong = pendingGroup.filter(r => {
    if (!r.docs_signed_at) return false;
    return (Date.now() - new Date(r.docs_signed_at).getTime()) / 86400000 > 5;
  });
  if (fundsLong.length > 0) {
    alerts.push(`${fundsLong.length} investor(s) — funds pending 5+ days after signing`);
  }

  return {
    groups,
    total_committed_in_close: wiredAmount + closedAmount + pendingWire,
    wired_amount:   wiredAmount,
    closed_amount:  closedAmount,
    dropped_amount: droppedAmount,
    pending_wire:   pendingWire,
    alerts,
  };
}

// ── Close checklist ────────────────────────────────────────────────────────────

export function computeCloseChecklist(
  round: any,
  investors: any[],
  pipeline: WeightedPipelineResult,
  allocationPlan: AllocationRow[],
): CloseChecklistItem[] {
  const hasLead          = pipeline.likely_lead_count > 0;
  const hasInstrument    = !!round.round_instrument;
  const hasPreMoney      = !!round.pre_money_valuation;
  const hasTarget        = !!round.target_amount;
  const hasMinClose      = !!round.minimum_close_target;
  const hasCloseDate     = !!round.target_close_date;

  const confirmedAlloc   = allocationPlan.filter(r => ["confirmed", "reserved"].includes(r.allocation_status));
  const allocationDone   = confirmedAlloc.length > 0 && allocationPlan.filter(r => r.allocation_status === "unallocated").length === 0;

  const docsSentCount    = allocationPlan.filter(r => !["not_started", "dropped"].includes(r.closing_status)).length;
  const signedCount      = allocationPlan.filter(r => ["docs_signed", "funds_pending", "wired", "closed"].includes(r.closing_status)).length;
  const wiredCount       = allocationPlan.filter(r => ["wired", "closed"].includes(r.closing_status)).length;

  const isPricedEquity   = round.round_instrument === "priced_equity";
  const isPendingMin     = pipeline.committed_amount >= pipeline.minimum_close_target && pipeline.minimum_close_target > 0;

  const checklist: CloseChecklistItem[] = [
    {
      key:      "target_set",
      label:    "Round target set",
      complete: hasTarget,
      note:     !hasTarget ? "Set target amount in Funding Rounds" : undefined,
    },
    {
      key:      "min_close_set",
      label:    "Minimum close target set",
      complete: hasMinClose,
      note:     !hasMinClose ? "Set minimum close to understand critical threshold" : undefined,
    },
    {
      key:      "instrument_selected",
      label:    "Investment instrument selected",
      complete: hasInstrument,
      note:     !hasInstrument ? "Choose SAFE, priced equity, convertible note, or grant" : undefined,
    },
    {
      key:      "premoney_set",
      label:    isPricedEquity ? "Pre-money valuation set" : "Valuation / cap set",
      complete: isPricedEquity ? hasPreMoney : (!!(round.valuation_cap || round.pre_money_valuation)),
      note:     !isPricedEquity && !round.valuation_cap && !round.pre_money_valuation
        ? "Set valuation cap or pre-money for dilution modelling"
        : undefined,
    },
    {
      key:      "close_date_set",
      label:    "Target close date set",
      complete: hasCloseDate,
      note:     !hasCloseDate ? "Required to track urgency and investor timeline" : undefined,
    },
    {
      key:      "lead_identified",
      label:    "Lead investor identified",
      complete: hasLead,
      note:     !hasLead ? "Tag a likely lead in Investor Targets — rounds without leads rarely close" : undefined,
    },
    {
      key:      "min_committed",
      label:    "Minimum close commitments reached",
      complete: isPendingMin,
      note:     !isPendingMin && hasMinClose
        ? `Committed ${fmtMoney(pipeline.committed_amount)} of ${fmtMoney(pipeline.minimum_close_target)} minimum`
        : undefined,
    },
    {
      key:      "allocation_complete",
      label:    "Allocation plan complete",
      complete: allocationDone,
      note:     !allocationDone ? "Confirm or reduce all investor allocations" : undefined,
    },
    {
      key:      "docs_prepared",
      label:    "Legal docs prepared and sent",
      complete: docsSentCount > 0,
      note:     docsSentCount === 0 ? "No investors have received legal documents yet" : undefined,
    },
    {
      key:      "docs_signed",
      label:    "Docs signed by committed investors",
      complete: signedCount > 0 && signedCount >= confirmedAlloc.length,
      note:     signedCount < confirmedAlloc.length
        ? `${signedCount} of ${confirmedAlloc.length} confirmed investors have signed`
        : undefined,
    },
    {
      key:      "funds_wired",
      label:    "Funds received",
      complete: wiredCount > 0,
      note:     wiredCount === 0 ? "No funds wired yet" : `${wiredCount} investor(s) have wired`,
    },
    {
      key:      "closing_summary",
      label:    "Closing summary prepared",
      complete: round.legal_close_status === "closed" || round.status === "Closed",
      note:     "Prepare cap table update and investor notification after close",
    },
  ];

  return checklist;
}

function fmtMoney(v: number): string {
  if (!v) return "$0";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
}

// ── Valuation & allocation risk flags ─────────────────────────────────────────

export function computeValuationRiskFlags(
  round: any,
  valuation: ValuationSummary,
  allocationPlan: AllocationRow[],
  pipeline: WeightedPipelineResult,
): RiskFlag[] {
  const flags: RiskFlag[] = [];

  // Valuation completeness
  if (!valuation.instrument) {
    flags.push({ level: "critical", code: "no_instrument", message: "Investment instrument not selected (SAFE, priced equity, convertible note)" });
  }

  if (valuation.is_priced && !valuation.pre_money) {
    flags.push({ level: "critical", code: "no_valuation", message: "Priced round with no pre-money valuation — ownership math impossible" });
  }

  if (valuation.is_safe_or_convertible && !valuation.valuation_cap && !valuation.discount_rate) {
    flags.push({ level: "warning", code: "safe_incomplete", message: "SAFE/convertible note with no valuation cap or discount rate — terms incomplete" });
  }

  if (valuation.is_priced && !valuation.share_price) {
    flags.push({ level: "info", code: "no_share_price", message: "Share price not set — per-share allocation math unavailable" });
  }

  if (valuation.option_pool_pre != null && valuation.option_pool_post == null) {
    flags.push({ level: "info", code: "pool_incomplete", message: "Pre-money option pool set but post-money pool missing — dilution estimate is incomplete" });
  }

  // Allocation risks
  const totalFinalAlloc = allocationPlan.reduce((s, r) => s + Number(r.final_allocation_amount ?? 0), 0);
  const totalAlloc = allocationPlan.reduce((s, r) => s + Number(r.allocation_amount ?? 0), 0);
  const target = pipeline.target_amount;

  if (target > 0 && totalFinalAlloc > target * 1.05) {
    flags.push({ level: "warning", code: "overallocated", message: `Final allocations (${fmtMoney(totalFinalAlloc)}) exceed target raise by more than 5%` });
  }

  const confirmedAlloc = allocationPlan.filter(r => ["confirmed", "reserved"].includes(r.allocation_status));
  const confirmedTotal = confirmedAlloc.reduce((s, r) => s + Number(r.final_allocation_amount ?? r.allocation_amount ?? 0), 0);
  if (pipeline.minimum_close_target > 0 && confirmedTotal < pipeline.minimum_close_target) {
    flags.push({ level: "critical", code: "alloc_below_min", message: `Confirmed allocations (${fmtMoney(confirmedTotal)}) below minimum close (${fmtMoney(pipeline.minimum_close_target)})` });
  }

  const noLeadAlloc = allocationPlan.filter(r => r.likely_lead && r.allocation_status === "unallocated");
  if (noLeadAlloc.length > 0) {
    flags.push({ level: "critical", code: "lead_unallocated", message: `${noLeadAlloc.length} likely lead investor(s) have no allocation confirmed` });
  }

  // Closing-status risks
  const committedNoClose = allocationPlan.filter(
    r => ["Committed", "Hard Circle", "Wired / Closed"].includes(r.stage) && r.closing_status === "not_started"
  );
  if (committedNoClose.length > 0) {
    flags.push({ level: "warning", code: "committed_no_docs", message: `${committedNoClose.length} committed investor(s) have no closing action started`, count: committedNoClose.length });
  }

  const docsSentStale = allocationPlan.filter(r => {
    if (r.closing_status !== "docs_sent" || !r.docs_sent_at) return false;
    return (Date.now() - new Date(r.docs_sent_at).getTime()) / 86400000 > 7;
  });
  if (docsSentStale.length > 0) {
    flags.push({ level: "warning", code: "docs_stale", message: `${docsSentStale.length} investor(s) received docs 7+ days ago — no signature yet`, count: docsSentStale.length });
  }

  const fundsLong = allocationPlan.filter(r => {
    if (r.closing_status !== "funds_pending" || !r.docs_signed_at) return false;
    return (Date.now() - new Date(r.docs_signed_at).getTime()) / 86400000 > 5;
  });
  if (fundsLong.length > 0) {
    flags.push({ level: "warning", code: "funds_delayed", message: `${fundsLong.length} investor(s) signed 5+ days ago — wire not yet confirmed`, count: fundsLong.length });
  }

  // Wired below minimum close
  const wiredTotal = allocationPlan.filter(r => ["wired", "closed"].includes(r.closing_status))
    .reduce((s, r) => s + Number(r.final_allocation_amount ?? r.committed_amount ?? 0), 0);
  if (pipeline.minimum_close_target > 0 && wiredTotal > 0 && wiredTotal < pipeline.minimum_close_target) {
    flags.push({ level: "warning", code: "wired_below_min", message: `Wired/closed amount (${fmtMoney(wiredTotal)}) is below minimum close target` });
  }

  return flags;
}
