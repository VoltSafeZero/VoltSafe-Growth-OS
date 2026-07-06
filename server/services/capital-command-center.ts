/**
 * Capital Round Command Center — computation service (Phase 2E)
 *
 * Pure functions: no DB calls, no side effects.
 * All DB queries stay in routes-capital.ts.
 * All weight maps and formulas are exported for tests.
 */

// ── Stage weight maps ──────────────────────────────────────────────────────────

/** Investor pipeline stage → close probability weight (0–1). */
export const INVESTOR_STAGE_WEIGHTS: Record<string, number> = {
  "Wired / Closed":  1.00,
  "Committed":       0.95,
  "Partner Meeting": 0.80,
  "Soft Commit":     0.45,
  "Diligence":       0.60,
  "Follow-Up":       0.25,
  "First Meeting":   0.25,
  "Intro Made":      0.10,
  "Intro Needed":    0.10,
  "Target Identified": 0.10,
  "Passed":          0.00,
};

/** Commitment stage → close probability weight (0–1). */
export const COMMITMENT_STAGE_WEIGHTS: Record<string, number> = {
  "Wired":          1.00,
  "Hard Circle":    0.95,
  "Committed":      0.95,
  "Verbal Commit":  0.80,
  "Diligence":      0.60,
  "Soft-Circled":   0.45,
  "Soft Circle":    0.45,
  "Interested":     0.25,
  "Verbal Interest": 0.25,
  "Stalled":        0.05,
  "Target":         0.10,
  "Passed":         0.00,
};

export function investorStageWeight(stage: string | null | undefined): number {
  if (!stage) return 0.10;
  return INVESTOR_STAGE_WEIGHTS[stage] ?? 0.10;
}

export function commitmentStageWeight(stage: string | null | undefined): number {
  if (!stage) return 0.10;
  return COMMITMENT_STAGE_WEIGHTS[stage] ?? 0.10;
}

// ── Amount resolution ──────────────────────────────────────────────────────────

/** Best available amount for an investor row (target_cheque_amount → check_size_max → check_size_min). */
export function investorBestAmount(inv: any): number {
  return Number(inv.target_cheque_amount || inv.check_size_max || inv.check_size_min || 0);
}

// ── Committed/wired amount ─────────────────────────────────────────────────────

/** Stages considered "committed" (high-confidence money). */
export const COMMITTED_STAGES = new Set(["Committed", "Hard Circle", "Wired / Closed"]);
/** Stages considered "wired" (money received). */
export const WIRED_STAGES     = new Set(["Wired / Closed"]);
/** Stages considered "soft-circled" (verbal or soft interest). */
export const SOFT_STAGES      = new Set(["Soft Commit", "Soft Circle", "Soft-Circled"]);

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WeightedPipelineResult {
  target_amount:         number;
  minimum_close_target:  number;
  committed_amount:      number;
  wired_amount:          number;
  soft_circled_amount:   number;
  weighted_pipeline:     number;
  remaining_to_target:   number;
  remaining_to_min_close: number;
  committed_count:       number;
  soft_circled_count:    number;
  hot_count:             number;
  likely_lead_count:     number;
  total_active:          number;
  confidence_low:        number;
  confidence_high:       number;
}

export interface LeadCandidate {
  id:                  number;
  name:                string;
  investor_type:       string;
  stage:               string;
  target_cheque_amount: number | null;
  committed_amount:    number | null;
  score:               number;
  tier:                string;
  last_touch_at:       string | null;
  next_step:           string | null;
  next_step_date:      string | null;
  likely_lead:         boolean;
  warmth:              string;
  primary_contact:     string | null;
  email_link_count:    number;
  risk_flags:          string[];
}

export interface ThisWeekAction {
  investor_id:   number;
  investor_name: string;
  reason:        string;
  action:        string;
  priority:      "critical" | "high" | "medium" | "low";
  due_date:      string | null;
}

export interface RiskFlag {
  level:   "critical" | "warning" | "info";
  code:    string;
  message: string;
  count?:  number;
}

export interface RunwayResult {
  current_cash_balance:    number | null;
  monthly_burn:            number | null;
  runway_today_months:     number | null;
  runway_after_min_months: number | null;
  runway_after_target_months: number | null;
  runway_after_weighted_months: number | null;
  cashout_date_today:      string | null;
  cashout_date_after_target: string | null;
  has_data:                boolean;
}

export interface Scenario {
  name:           string;
  key:            string;
  amount:         number;
  runway_added_months: number | null;
  gap_to_target:  number;
  required_additional: number;
  description:    string;
}

// ── Scoring (same logic as computeInvestorScore in routes-capital.ts) ──────────

export function computeCommandCenterScore(inv: any): { score: number; tier: string } {
  if (inv.stage === "Passed" || inv.status === "Passed") return { score: 0, tier: "Do Not Contact" };
  let score = 0;
  const stageScores: Record<string, number> = {
    "Wired / Closed": 40, "Committed": 40, "Soft Commit": 35,
    "Partner Meeting": 30, "Diligence": 25, "Follow-Up": 20,
    "First Meeting": 15, "Intro Made": 10, "Intro Needed": 5, "Target Identified": 5,
  };
  score += stageScores[inv.stage] ?? 5;
  const priorityScores: Record<string, number> = { "Critical": 30, "High": 22, "Medium": 12, "Low": 4 };
  score += priorityScores[inv.priority] ?? 4;
  const warmthScores: Record<string, number> = { "Hot": 20, "Warm": 12, "Cold": 2 };
  score += warmthScores[inv.warmth] ?? 2;
  if (inv.last_touch_at) {
    const ageDays = (Date.now() - new Date(inv.last_touch_at).getTime()) / 86400000;
    if (ageDays > 90) score -= 20;
    else if (ageDays > 45) score -= 10;
    else if (ageDays > 21) score -= 5;
  } else { score -= 20; }
  const clamped = Math.max(0, Math.min(100, score));
  const tier = clamped >= 55 ? "Hot" : clamped >= 35 ? "Warm" : clamped >= 15 ? "Nurture" : "Low Priority";
  return { score: clamped, tier };
}

// ── Weighted pipeline ──────────────────────────────────────────────────────────

/**
 * Compute weighted pipeline for a round.
 *
 * @param round        The capital_rounds row (with new Phase 2E fields).
 * @param investors    All capital_investors rows (active, in this round or general pool).
 * @param commitments  All capital_commitments rows for this round.
 * @param emailLinkCounts  Map of investor_id → email conversation count.
 */
export function computeWeightedPipeline(
  round: any,
  investors: any[],
  commitments: any[],
): WeightedPipelineResult {
  const targetAmount        = Number(round.target_amount || 0);
  const minimumCloseTarget  = Number(round.minimum_close_target || 0);

  const commByInvestor = new Map<number, any[]>();
  for (const c of commitments) {
    if (!commByInvestor.has(c.investor_id)) commByInvestor.set(c.investor_id, []);
    commByInvestor.get(c.investor_id)!.push(c);
  }

  let committedAmount     = 0;
  let wiredAmount         = 0;
  let softCircledAmount   = 0;
  let weightedPipeline    = 0;
  let committedCount      = 0;
  let softCircledCount    = 0;
  let hotCount            = 0;
  let likelyLeadCount     = 0;
  let totalActive         = 0;

  for (const inv of investors) {
    if (inv.stage === "Passed" || inv.status === "Inactive" || inv.do_not_contact) continue;
    totalActive++;
    const { score, tier } = computeCommandCenterScore(inv);
    if (tier === "Hot") hotCount++;
    if (inv.likely_lead) likelyLeadCount++;

    const invComms = commByInvestor.get(inv.id) || [];

    if (invComms.length > 0) {
      // Use commitment-level data
      for (const c of invComms) {
        const amt = Number(c.amount || 0) || investorBestAmount(inv);
        if (!amt) continue;
        const w = commitmentStageWeight(c.commitment_stage);
        weightedPipeline += Math.round(amt * w);

        if (COMMITTED_STAGES.has(c.commitment_stage) || COMMITTED_STAGES.has(inv.stage)) {
          committedAmount += amt;
          committedCount++;
        }
        if (WIRED_STAGES.has(c.commitment_stage) || inv.stage === "Wired / Closed") {
          wiredAmount += amt;
        }
        if (SOFT_STAGES.has(c.commitment_stage) || inv.stage === "Soft Commit") {
          softCircledAmount += amt;
          softCircledCount++;
        }
      }
    } else {
      // Fall back to investor stage
      const amt = investorBestAmount(inv);
      if (!amt) continue;
      const w = investorStageWeight(inv.stage);
      weightedPipeline += Math.round(amt * w);

      if (COMMITTED_STAGES.has(inv.stage)) {
        committedAmount += amt;
        committedCount++;
      }
      if (WIRED_STAGES.has(inv.stage) || inv.stage === "Wired / Closed") {
        wiredAmount += amt;
      }
      if (SOFT_STAGES.has(inv.stage) || inv.stage === "Soft Commit") {
        softCircledAmount += amt;
        softCircledCount++;
      }
    }
  }

  const remainingToTarget  = Math.max(0, targetAmount - committedAmount);
  const remainingToMinClose = Math.max(0, minimumCloseTarget - committedAmount);
  const confidenceLow  = Math.round(weightedPipeline * 0.7);
  const confidenceHigh = Math.round(weightedPipeline * 1.15);

  return {
    target_amount:         targetAmount,
    minimum_close_target:  minimumCloseTarget,
    committed_amount:      committedAmount,
    wired_amount:          wiredAmount,
    soft_circled_amount:   softCircledAmount,
    weighted_pipeline:     weightedPipeline,
    remaining_to_target:   remainingToTarget,
    remaining_to_min_close: remainingToMinClose,
    committed_count:       committedCount,
    soft_circled_count:    softCircledCount,
    hot_count:             hotCount,
    likely_lead_count:     likelyLeadCount,
    total_active:          totalActive,
    confidence_low:        confidenceLow,
    confidence_high:       confidenceHigh,
  };
}

// ── Lead investor candidates ───────────────────────────────────────────────────

export function computeLeadCandidates(
  investors: any[],
  commitments: any[],
  contacts: any[],
  emailLinkCounts: Map<number, number>,
): LeadCandidate[] {
  const commByInvestor = new Map<number, any[]>();
  for (const c of commitments) {
    if (!commByInvestor.has(c.investor_id)) commByInvestor.set(c.investor_id, []);
    commByInvestor.get(c.investor_id)!.push(c);
  }
  const contactsByInvestor = new Map<number, any[]>();
  for (const c of contacts) {
    if (!contactsByInvestor.has(c.investor_id)) contactsByInvestor.set(c.investor_id, []);
    contactsByInvestor.get(c.investor_id)!.push(c);
  }

  const candidates: LeadCandidate[] = [];

  for (const inv of investors) {
    if (inv.stage === "Passed" || inv.do_not_contact || inv.status === "Inactive") continue;
    const { score, tier } = computeCommandCenterScore(inv);
    const invComms = commByInvestor.get(inv.id) || [];
    const committedAmt = invComms.reduce((s: number, c: any) =>
      COMMITTED_STAGES.has(c.commitment_stage) ? s + Number(c.amount || 0) : s, 0);
    const isLeadType = ["Venture Capital", "Family Office", "Angel", "HNW Angel"].includes(inv.investor_type);
    const hasLargeCheck = investorBestAmount(inv) >= 250_000;
    const inLateStage = ["Diligence", "Partner Meeting", "Soft Commit", "Committed", "Wired / Closed"].includes(inv.stage);

    if (!inv.likely_lead && score < 45 && !hasLargeCheck && !inLateStage) continue;
    if (!isLeadType && !inv.likely_lead && !inLateStage) continue;

    const invContacts = contactsByInvestor.get(inv.id) || [];
    const primaryContact = invContacts.find((c: any) => c.influence_level === "Decision Maker")
      || invContacts[0];

    const riskFlags: string[] = [];
    if (!inv.last_touch_at) riskFlags.push("Never contacted");
    else {
      const days = (Date.now() - new Date(inv.last_touch_at).getTime()) / 86400000;
      if (days > 14 && inLateStage) riskFlags.push(`${Math.round(days)}d since last touch`);
    }
    if (!inv.next_step && inLateStage) riskFlags.push("No next step");
    if (emailLinkCounts.get(inv.id) === 0) riskFlags.push("No linked emails");

    candidates.push({
      id:                   inv.id,
      name:                 inv.name,
      investor_type:        inv.investor_type,
      stage:                inv.stage,
      target_cheque_amount: inv.target_cheque_amount || null,
      committed_amount:     committedAmt || null,
      score,
      tier,
      last_touch_at:        inv.last_touch_at || null,
      next_step:            inv.next_step || null,
      next_step_date:       inv.next_step_date || null,
      likely_lead:          inv.likely_lead === true,
      warmth:               inv.warmth || "Cold",
      primary_contact:      primaryContact ? `${primaryContact.first_name || ""} ${primaryContact.last_name || ""}`.trim() || primaryContact.full_name : null,
      email_link_count:     emailLinkCounts.get(inv.id) ?? 0,
      risk_flags:           riskFlags,
    });
  }

  return candidates
    .sort((a, b) => {
      if (a.likely_lead !== b.likely_lead) return a.likely_lead ? -1 : 1;
      return b.score - a.score;
    })
    .slice(0, 12);
}

// ── This-week actions ──────────────────────────────────────────────────────────

export function computeThisWeekActions(
  investors: any[],
  commitments: any[],
  emailLinkCounts: Map<number, number>,
): ThisWeekAction[] {
  const actions: ThisWeekAction[] = [];
  const now = Date.now();

  const commByInvestor = new Map<number, any[]>();
  for (const c of commitments) {
    if (!commByInvestor.has(c.investor_id)) commByInvestor.set(c.investor_id, []);
    commByInvestor.get(c.investor_id)!.push(c);
  }

  for (const inv of investors) {
    if (inv.stage === "Passed" || inv.do_not_contact || inv.status === "Inactive") continue;
    const { score, tier } = computeCommandCenterScore(inv);
    const daysSinceTouch = inv.last_touch_at
      ? (now - new Date(inv.last_touch_at).getTime()) / 86400000
      : null;
    const nextStepOverdue = inv.next_step_date && new Date(inv.next_step_date) < new Date();
    const invComms = commByInvestor.get(inv.id) || [];
    const emailCount = emailLinkCounts.get(inv.id) ?? 0;

    // Committed/Partner Meeting investors not yet wired
    if (["Committed", "Partner Meeting"].includes(inv.stage) &&
        !invComms.some((c: any) => WIRED_STAGES.has(c.commitment_stage))) {
      actions.push({
        investor_id:   inv.id,
        investor_name: inv.name,
        reason:        inv.stage === "Committed" ? "Commitment not yet wired" : "Verbal commitment — confirm hard circle",
        action:        "Follow up on wire / documentation",
        priority:      "critical",
        due_date:      null,
      });
    }

    // Overdue next step
    if (nextStepOverdue) {
      actions.push({
        investor_id:   inv.id,
        investor_name: inv.name,
        reason:        `Next step overdue: ${inv.next_step || "scheduled action"}`,
        action:        "Complete overdue follow-up",
        priority:      "critical",
        due_date:      inv.next_step_date,
      });
    }

    // Hot investor going cold
    if (tier === "Hot" && daysSinceTouch !== null && daysSinceTouch > 7) {
      actions.push({
        investor_id:   inv.id,
        investor_name: inv.name,
        reason:        `Hot investor — ${Math.round(daysSinceTouch)}d since last touch`,
        action:        "Re-engage with update or ask",
        priority:      "high",
        due_date:      null,
      });
    }

    // Soft Commit needing confirmation
    if (inv.stage === "Soft Commit" && (daysSinceTouch === null || daysSinceTouch > 14)) {
      actions.push({
        investor_id:   inv.id,
        investor_name: inv.name,
        reason:        "Soft circle not confirmed recently",
        action:        "Confirm soft circle status",
        priority:      "high",
        due_date:      null,
      });
    }

    // Diligence with no next step
    if (inv.stage === "Diligence" && !inv.next_step) {
      actions.push({
        investor_id:   inv.id,
        investor_name: inv.name,
        reason:        "In diligence with no next step",
        action:        "Send data room follow-up or schedule next call",
        priority:      "high",
        due_date:      null,
      });
    }

    // Likely lead with no next meeting
    if (inv.likely_lead && !inv.next_step && !["Committed", "Wired / Closed"].includes(inv.stage)) {
      actions.push({
        investor_id:   inv.id,
        investor_name: inv.name,
        reason:        "Likely lead investor has no next meeting scheduled",
        action:        "Schedule lead investor meeting",
        priority:      "high",
        due_date:      null,
      });
    }

    // Warm investor with no linked email
    if (["Warm", "Hot"].includes(tier) && emailCount === 0) {
      actions.push({
        investor_id:   inv.id,
        investor_name: inv.name,
        reason:        "No linked email conversation",
        action:        "Start or link email conversation",
        priority:      "medium",
        due_date:      null,
      });
    }
  }

  // Deduplicate by investor+reason, prioritize critical first
  const seen = new Set<string>();
  const deduped: ThisWeekAction[] = [];
  for (const a of actions) {
    const key = `${a.investor_id}:${a.reason.slice(0, 40)}`;
    if (!seen.has(key)) { seen.add(key); deduped.push(a); }
  }

  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  return deduped
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
    .slice(0, 20);
}

// ── Risk flags ─────────────────────────────────────────────────────────────────

export function computeRiskFlags(
  round: any,
  investors: any[],
  pipeline: WeightedPipelineResult,
): RiskFlag[] {
  const flags: RiskFlag[] = [];

  if (!round.target_amount) {
    flags.push({ level: "critical", code: "no_target", message: "Active round has no target raise amount" });
  }
  if (!round.target_close_date && round.status === "Open") {
    flags.push({ level: "critical", code: "no_close_date", message: "Active round has no expected close date" });
  }

  if (pipeline.likely_lead_count === 0) {
    flags.push({ level: "critical", code: "no_lead", message: "No likely lead investor identified — rounds without leads rarely close" });
  }

  if (round.target_amount && pipeline.committed_amount < Number(round.minimum_close_target || 0)) {
    flags.push({ level: "critical", code: "below_min_close", message: `Committed amount below minimum close target (${fmtMoneyFlag(pipeline.committed_amount)} of ${fmtMoneyFlag(Number(round.minimum_close_target || 0))})` });
  }

  const totalActive = investors.filter(i => i.stage !== "Passed" && !i.do_not_contact && i.status !== "Inactive");
  const noNextStep = totalActive.filter(i => !i.next_step && !["Committed", "Wired / Closed", "Passed"].includes(i.stage));
  if (noNextStep.length > 3) {
    flags.push({ level: "warning", code: "no_next_step", message: `${noNextStep.length} investors have no next step defined`, count: noNextStep.length });
  }

  const hotGoCold = investors.filter(i => {
    if (i.warmth !== "Hot" || i.stage === "Passed") return false;
    if (!i.last_touch_at) return true;
    return (Date.now() - new Date(i.last_touch_at).getTime()) / 86400000 > 7;
  });
  if (hotGoCold.length > 0) {
    flags.push({ level: "warning", code: "hot_going_cold", message: `${hotGoCold.length} hot investor(s) not contacted in 7+ days`, count: hotGoCold.length });
  }

  const diligenceStale = investors.filter(i => {
    if (!["Diligence", "Partner Meeting"].includes(i.stage)) return false;
    if (!i.last_touch_at) return true;
    return (Date.now() - new Date(i.last_touch_at).getTime()) / 86400000 > 14;
  });
  if (diligenceStale.length > 0) {
    flags.push({ level: "warning", code: "diligence_stale", message: `${diligenceStale.length} investor(s) in diligence with no recent activity`, count: diligenceStale.length });
  }

  if (round.target_amount && pipeline.weighted_pipeline < Number(round.target_amount) * 0.6) {
    flags.push({ level: "warning", code: "low_pipeline", message: `Weighted pipeline covers less than 60% of target (${fmtPct(pipeline.weighted_pipeline / Number(round.target_amount))})` });
  }

  const softStaleThreshold = 21;
  const softStale = investors.filter(i => {
    if (!["Soft Commit"].includes(i.stage)) return false;
    if (!i.last_touch_at) return true;
    return (Date.now() - new Date(i.last_touch_at).getTime()) / 86400000 > softStaleThreshold;
  });
  if (softStale.length > 0) {
    flags.push({ level: "info", code: "soft_stale", message: `${softStale.length} soft circle(s) not confirmed in 3+ weeks`, count: softStale.length });
  }

  return flags;
}

function fmtMoneyFlag(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
}
function fmtPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

// ── Runway calculation ─────────────────────────────────────────────────────────

function addMonths(date: Date, months: number): string {
  const d = new Date(date);
  d.setMonth(d.getMonth() + Math.floor(months));
  return d.toISOString().slice(0, 10);
}

export function computeRunway(
  round: any,
  weightedPipeline: number,
): RunwayResult {
  const cash   = Number(round.current_cash_balance || 0);
  const burn   = Number(round.monthly_burn || 0);
  const target = Number(round.target_amount || 0);
  const minClose = Number(round.minimum_close_target || 0);

  if (!cash || !burn) {
    return {
      current_cash_balance: cash || null,
      monthly_burn: burn || null,
      runway_today_months: null,
      runway_after_min_months: null,
      runway_after_target_months: null,
      runway_after_weighted_months: null,
      cashout_date_today: null,
      cashout_date_after_target: null,
      has_data: false,
    };
  }

  const today = new Date();
  const runwayToday         = cash / burn;
  const runwayAfterMin      = minClose  ? (cash + minClose)        / burn : null;
  const runwayAfterTarget   = target    ? (cash + target)          / burn : null;
  const runwayAfterWeighted = weightedPipeline > 0 ? (cash + weightedPipeline) / burn : null;

  return {
    current_cash_balance:    cash,
    monthly_burn:            burn,
    runway_today_months:     Math.round(runwayToday * 10) / 10,
    runway_after_min_months: runwayAfterMin != null ? Math.round(runwayAfterMin * 10) / 10 : null,
    runway_after_target_months: runwayAfterTarget != null ? Math.round(runwayAfterTarget * 10) / 10 : null,
    runway_after_weighted_months: runwayAfterWeighted != null ? Math.round(runwayAfterWeighted * 10) / 10 : null,
    cashout_date_today:      addMonths(today, runwayToday),
    cashout_date_after_target: runwayAfterTarget != null ? addMonths(today, runwayAfterTarget) : null,
    has_data:                true,
  };
}

// ── Scenario planning ──────────────────────────────────────────────────────────

export function computeScenarios(
  round: any,
  pipeline: WeightedPipelineResult,
  runway: RunwayResult,
): Scenario[] {
  const target    = Number(round.target_amount || 0);
  const minClose  = Number(round.minimum_close_target || 0);
  const burn      = Number(round.monthly_burn || 0);
  const committed = pipeline.committed_amount;

  function runwayAdded(amount: number): number | null {
    if (!burn || amount <= 0) return null;
    return Math.round((amount / burn) * 10) / 10;
  }

  const scenarios: Scenario[] = [];

  if (minClose > 0) {
    scenarios.push({
      name:                "Minimum Close",
      key:                 "min_close",
      amount:              minClose,
      runway_added_months: runwayAdded(minClose),
      gap_to_target:       Math.max(0, target - minClose),
      required_additional: Math.max(0, minClose - committed),
      description:         "Minimum viable close — keeps the company funded with a clean round signal",
    });
  }

  scenarios.push({
    name:                "Base Case",
    key:                 "base",
    amount:              pipeline.weighted_pipeline,
    runway_added_months: runwayAdded(pipeline.weighted_pipeline),
    gap_to_target:       Math.max(0, target - pipeline.weighted_pipeline),
    required_additional: Math.max(0, pipeline.weighted_pipeline - committed),
    description:         "Probability-weighted current pipeline — best single estimate",
  });

  if (target > 0) {
    scenarios.push({
      name:                "Target Close",
      key:                 "target",
      amount:              target,
      runway_added_months: runwayAdded(target),
      gap_to_target:       0,
      required_additional: Math.max(0, target - committed),
      description:         "Full round closed at target — maximizes runway and ownership",
    });

    const stretch = Math.round(target * 1.2);
    scenarios.push({
      name:                "Stretch",
      key:                 "stretch",
      amount:              stretch,
      runway_added_months: runwayAdded(stretch),
      gap_to_target:       0,
      required_additional: Math.max(0, stretch - committed),
      description:         "Oversubscribed round — selectively fill remaining allocation",
    });
  }

  return scenarios;
}
