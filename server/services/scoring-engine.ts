export interface ScoreResult {
  score: number;
  band: "low" | "medium" | "high" | "critical";
  label: string;
  reasons: string[];
  scoredAt: string;
  confidence: number;        // 0-100: how many data points were available
  confidenceLabel: string;   // "low" | "medium" | "high"
  modelName: string;         // machine-readable model identifier
}

function toConfidenceLabel(c: number): string {
  if (c >= 70) return "high";
  if (c >= 40) return "medium";
  return "low";
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function toBand(score: number, thresholds: [number, number, number] = [30, 55, 75]): "low" | "medium" | "high" | "critical" {
  if (score < thresholds[0]) return "low";
  if (score < thresholds[1]) return "medium";
  if (score < thresholds[2]) return "high";
  return "critical";
}

function daysSince(date: Date | string | null | undefined): number | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (24 * 3600 * 1000));
}

function daysUntil(date: Date | string | null | undefined): number | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (24 * 3600 * 1000));
}

export interface LeadInput {
  source?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  ownerUserId?: number | null;
  dealAmount?: number | null;
  estimatedSlipsImpacted?: number | null;
  estimatedPedestalCount?: number | null;
  status?: string | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  nextStep?: string | null;
  estCloseDate?: string | Date | null;
  region?: string | null;
  segment?: string | null;
  openTaskCount?: number;
  overdueTaskCount?: number;
  activityCount?: number;
  lastActivityAt?: string | Date | null;
}

const HIGH_QUALITY_SOURCES = new Set(["referral", "partner", "inbound_marketing", "conference", "trade_show", "industry_event", "strategic_referral"]);
const MEDIUM_QUALITY_SOURCES = new Set(["website", "linkedin", "cold_outreach", "email_campaign", "webinar"]);

export function scoreLeadQuality(lead: LeadInput): ScoreResult {
  let score = 0;
  const reasons: string[] = [];

  const src = (lead.source || "").toLowerCase();
  if (HIGH_QUALITY_SOURCES.has(src)) {
    score += 20;
    reasons.push(`High-quality source: ${lead.source}`);
  } else if (MEDIUM_QUALITY_SOURCES.has(src)) {
    score += 10;
    reasons.push(`Moderate source: ${lead.source}`);
  } else if (src) {
    score += 4;
  } else {
    reasons.push("Source not recorded — attribution incomplete");
  }

  if (lead.contactEmail) { score += 10; reasons.push("Contact email on file"); }
  else { reasons.push("No contact email — reachability low"); }

  if (lead.contactPhone) { score += 6; reasons.push("Contact phone on file"); }

  if (lead.ownerUserId) { score += 12; reasons.push("Owner assigned"); }
  else { reasons.push("No owner assigned — may fall through cracks"); }

  const amt = lead.dealAmount ?? 0;
  if (amt >= 200000) { score += 14; reasons.push(`High deal value: $${amt.toLocaleString()}`); }
  else if (amt >= 50000) { score += 8; reasons.push(`Moderate deal value: $${amt.toLocaleString()}`); }
  else if (amt > 0) { score += 4; reasons.push(`Deal value recorded: $${amt.toLocaleString()}`); }
  else { reasons.push("No deal amount — sizing unknown"); }

  const slips = lead.estimatedSlipsImpacted ?? lead.estimatedPedestalCount ?? 0;
  if (slips >= 200) { score += 10; reasons.push(`Large site: ~${slips} slips`); }
  else if (slips >= 50) { score += 6; reasons.push(`Mid-size site: ~${slips} slips`); }

  const status = (lead.status || "new").toLowerCase();
  if (["qualified", "contacted", "meeting_booked"].includes(status)) { score += 12; reasons.push(`Status: ${status} — active engagement`); }
  else if (status === "new") { /* neutral */ }
  else if (["closed_lost", "disqualified"].includes(status)) {
    score -= 25;
    reasons.push(`Status: ${status} — not a live opportunity`);
  }

  const sinceUpdate = daysSince(lead.updatedAt);
  if (sinceUpdate !== null && sinceUpdate <= 7) { score += 8; reasons.push("Updated within the last week"); }
  else if (sinceUpdate !== null && sinceUpdate <= 30) { score += 4; reasons.push("Updated within the last month"); }
  else if (sinceUpdate !== null && sinceUpdate > 60) {
    score -= 8;
    reasons.push(`Not updated in ${sinceUpdate} days — may be stale`);
  }

  if (lead.nextStep) { score += 5; reasons.push("Next step defined"); }
  if (lead.estCloseDate) { score += 5; reasons.push("Close date set"); }
  if (lead.region) { score += 2; }

  if ((lead.activityCount ?? 0) >= 3) { score += 5; reasons.push("Multiple activities logged"); }
  if ((lead.overdueTaskCount ?? 0) > 0) { score -= 5; reasons.push(`${lead.overdueTaskCount} overdue task(s)`); }

  const finalScore = clamp(score);
  const conf = clamp(
    (lead.source ? 12 : 0) +
    (lead.contactEmail ? 12 : 0) +
    (lead.ownerUserId ? 12 : 0) +
    (lead.dealAmount ? 12 : 0) +
    (lead.status ? 10 : 0) +
    (lead.updatedAt ? 10 : 0) +
    (lead.estCloseDate ? 10 : 0) +
    (lead.region ? 8 : 0) +
    ((lead.activityCount ?? 0) > 0 ? 8 : 0) +
    (lead.contactPhone ? 6 : 0)
  );
  return {
    score: finalScore,
    band: toBand(finalScore, [30, 55, 72]),
    label: "Lead Quality",
    reasons,
    scoredAt: new Date().toISOString(),
    confidence: conf,
    confidenceLabel: toConfidenceLabel(conf),
    modelName: "lead_quality",
  };
}

export interface OpportunityInput {
  stage?: string | null;
  estCloseDate?: string | Date | null;
  lastActivityDate?: string | Date | null;
  isStalled?: boolean;
  stalledAt?: string | Date | null;
  ownerUserId?: number | null;
  championIdentified?: string | null;
  economicBuyerIdentified?: string | null;
  decisionCriteriaKnown?: string | null;
  decisionProcessKnown?: string | null;
  amount?: number | null;
  hasQuote?: boolean;
  overdueTaskCount?: number;
  openTaskCount?: number;
  activityCount?: number;
  painClarity?: number | null;
  riskFlags?: string | null;
  forecastCategory?: string | null;
}

const STAGE_BASE: Record<string, number> = {
  inbound_new: 8,
  qualifying: 18,
  discovery: 28,
  proposal: 42,
  proof_of_concept: 52,
  negotiation: 65,
  verbal_commit: 80,
  closed_won: 100,
  closed_lost: 0,
};

export function scoreOpportunityClose(opp: OpportunityInput): ScoreResult {
  let score = 0;
  const reasons: string[] = [];

  const stage = (opp.stage || "inbound_new").toLowerCase();
  const base = STAGE_BASE[stage] ?? 15;
  score += base;
  reasons.push(`Stage: ${stage.replace(/_/g, " ")} (base ${base})`);

  if (stage === "closed_won") {
    return { score: 100, band: "critical", label: "Opportunity Close", reasons: ["Closed won"], scoredAt: new Date().toISOString(), confidence: 100, confidenceLabel: "high", modelName: "opportunity_close" };
  }
  if (stage === "closed_lost") {
    return { score: 0, band: "low", label: "Opportunity Close", reasons: ["Closed lost"], scoredAt: new Date().toISOString(), confidence: 100, confidenceLabel: "high", modelName: "opportunity_close" };
  }

  if (opp.hasQuote) { score += 8; reasons.push("Active quote attached"); }
  else { reasons.push("No quote issued yet"); }

  if (opp.championIdentified === "yes") { score += 8; reasons.push("Champion identified"); }
  if (opp.economicBuyerIdentified === "yes") { score += 8; reasons.push("Economic buyer identified"); }
  if (opp.decisionCriteriaKnown === "yes") { score += 5; reasons.push("Decision criteria known"); }
  if (opp.decisionProcessKnown === "yes") { score += 4; reasons.push("Decision process mapped"); }

  const painClarity = opp.painClarity ?? 0;
  if (painClarity >= 4) { score += 6; reasons.push("Pain clarity strong"); }
  else if (painClarity <= 1 && stage !== "inbound_new") { reasons.push("Pain clarity low for stage"); }

  const daysToClose = daysUntil(opp.estCloseDate);
  if (daysToClose === null) { score -= 5; reasons.push("No close date set"); }
  else if (daysToClose < 0) { score -= 15; reasons.push(`Close date overdue by ${Math.abs(daysToClose)} days`); }
  else if (daysToClose <= 14) { score += 10; reasons.push(`Close date in ${daysToClose} days — imminent`); }
  else if (daysToClose <= 30) { score += 5; reasons.push(`Close date within 30 days`); }

  const sinceActivity = daysSince(opp.lastActivityDate);
  if (sinceActivity === null) { score -= 8; reasons.push("No activity logged"); }
  else if (sinceActivity > 30) { score -= 18; reasons.push(`No activity in ${sinceActivity} days — going cold`); }
  else if (sinceActivity > 14) { score -= 10; reasons.push(`Last activity ${sinceActivity} days ago`); }
  else { reasons.push(`Recent activity ${sinceActivity} days ago`); }

  if (opp.isStalled) { score -= 15; reasons.push("Marked stalled"); }
  if ((opp.overdueTaskCount ?? 0) > 0) { score -= 8; reasons.push(`${opp.overdueTaskCount} overdue task(s)`); }
  if (opp.riskFlags) { score -= 5; reasons.push("Risk flags recorded"); }

  const amt = opp.amount ?? 0;
  if (amt >= 200000) { score += 6; reasons.push(`High-value deal: $${amt.toLocaleString()}`); }
  else if (amt >= 50000) { score += 3; }

  if (opp.forecastCategory === "commit") { score += 8; reasons.push("Forecast category: commit"); }

  const finalScore = clamp(score);
  const conf = clamp(
    (opp.stage ? 15 : 0) +
    (opp.amount ? 12 : 0) +
    (opp.estCloseDate ? 12 : 0) +
    (opp.ownerUserId ? 12 : 0) +
    (opp.lastActivityDate ? 10 : 0) +
    (opp.championIdentified === "yes" ? 8 : 0) +
    (opp.economicBuyerIdentified === "yes" ? 8 : 0) +
    (opp.painClarity ? 8 : 0) +
    (opp.forecastCategory ? 8 : 0) +
    (opp.hasQuote ? 7 : 0)
  );
  return {
    score: finalScore,
    band: toBand(finalScore, [30, 55, 75]),
    label: "Opportunity Close",
    reasons,
    scoredAt: new Date().toISOString(),
    confidence: conf,
    confidenceLabel: toConfidenceLabel(conf),
    modelName: "opportunity_close",
  };
}

export interface QuoteInput {
  status?: string | null;
  sentAt?: string | Date | null;
  validUntil?: string | Date | null;
  total?: number | null;
  opportunityId?: number | null;
  hasFollowUpTask?: boolean;
  ownerUserId?: number | null;
  declinedAt?: string | Date | null;
  acceptedAt?: string | Date | null;
  archivedAt?: string | Date | null;
}

export function scoreQuoteFollowUpUrgency(quote: QuoteInput): ScoreResult {
  let score = 0;
  const reasons: string[] = [];

  const status = (quote.status || "draft").toLowerCase();

  if (["accepted", "declined", "archived"].includes(status)) {
    return {
      score: 0, band: "low", label: "Quote Follow-up Urgency",
      reasons: [`Quote ${status} — no follow-up needed`], scoredAt: new Date().toISOString(),
      confidence: 80, confidenceLabel: "high", modelName: "quote_urgency",
    };
  }

  if (status === "sent") {
    score += 45;
    reasons.push("Quote sent — awaiting customer response");

    const daysSinceSent = daysSince(quote.sentAt);
    if (daysSinceSent !== null) {
      if (daysSinceSent >= 14) { score += 25; reasons.push(`Sent ${daysSinceSent} days ago — significantly overdue for follow-up`); }
      else if (daysSinceSent >= 7) { score += 15; reasons.push(`Sent ${daysSinceSent} days ago — follow-up due`); }
      else if (daysSinceSent >= 3) { score += 8; reasons.push(`Sent ${daysSinceSent} days ago`); }
      else { reasons.push(`Sent ${daysSinceSent} day(s) ago — allow time to review`); }
    }
  } else if (status === "draft") {
    score += 8;
    reasons.push("Draft quote — consider sending");
  }

  const daysToExpiry = daysUntil(quote.validUntil);
  if (daysToExpiry !== null) {
    if (daysToExpiry < 0) { score += 20; reasons.push(`Quote expired ${Math.abs(daysToExpiry)} days ago`); }
    else if (daysToExpiry <= 7) { score += 18; reasons.push(`Expires in ${daysToExpiry} days — urgent`); }
    else if (daysToExpiry <= 14) { score += 8; reasons.push(`Expires in ${daysToExpiry} days`); }
  }

  const total = quote.total ?? 0;
  if (total >= 200000) { score += 15; reasons.push(`High-value quote: $${total.toLocaleString()}`); }
  else if (total >= 100000) { score += 10; reasons.push(`Significant quote value: $${total.toLocaleString()}`); }
  else if (total >= 50000) { score += 5; reasons.push(`Quote value: $${total.toLocaleString()}`); }

  if (!quote.opportunityId) { score += 6; reasons.push("Not linked to an opportunity — may be orphaned"); }
  if (!quote.hasFollowUpTask) { score += 8; reasons.push("No follow-up task scheduled"); }
  if (!quote.ownerUserId) { score += 5; reasons.push("No owner assigned to quote"); }

  const finalScore = clamp(score);
  const conf = clamp(
    (quote.status ? 20 : 0) +
    (quote.sentAt ? 20 : 0) +
    (quote.validUntil ? 15 : 0) +
    (quote.total ? 15 : 0) +
    (quote.ownerUserId ? 15 : 0) +
    (quote.opportunityId ? 15 : 0)
  );
  return {
    score: finalScore,
    band: toBand(finalScore, [25, 50, 72]),
    label: "Quote Follow-up Urgency",
    reasons,
    scoredAt: new Date().toISOString(),
    confidence: conf,
    confidenceLabel: toConfidenceLabel(conf),
    modelName: "quote_urgency",
  };
}

export interface DeploymentInput {
  status?: string | null;
  plannedStart?: string | Date | null;
  actualStart?: string | Date | null;
  targetGoLive?: string | Date | null;
  actualGoLive?: string | Date | null;
  ownerUserId?: number | null;
  blockers?: string | null;
  openBlockerCount?: number;
  criticalBlockerCount?: number;
  pendingCheckpointCount?: number;
  updatedAt?: string | Date | null;
  createdAt?: string | Date | null;
}

export function scoreDeploymentDelayRisk(dep: DeploymentInput): ScoreResult {
  let score = 0;
  const reasons: string[] = [];

  const status = (dep.status || "planned").toLowerCase();

  if (status === "completed" || status === "live") {
    return {
      score: 0, band: "low", label: "Deployment Delay Risk",
      reasons: ["Deployment completed"], scoredAt: new Date().toISOString(),
      confidence: 100, confidenceLabel: "high", modelName: "deployment_risk",
    };
  }

  const STATUS_BASE: Record<string, number> = {
    planned: 10,
    in_progress: 15,
    commissioning: 20,
    blocked: 45,
    on_hold: 30,
  };
  score += STATUS_BASE[status] ?? 10;
  reasons.push(`Status: ${status.replace(/_/g, " ")}`);

  if ((dep.openBlockerCount ?? 0) > 0) {
    const bc = dep.openBlockerCount!;
    score += Math.min(30, bc * 12);
    reasons.push(`${bc} open blocker${bc > 1 ? "s" : ""}`);
    if ((dep.criticalBlockerCount ?? 0) > 0) {
      score += 10;
      reasons.push(`${dep.criticalBlockerCount} critical blocker(s)`);
    }
  }

  const daysOverGoLive = dep.targetGoLive ? Math.max(0, -daysUntil(dep.targetGoLive)!) : null;
  if (daysOverGoLive !== null && daysOverGoLive > 0) {
    score += Math.min(25, 10 + Math.floor(daysOverGoLive / 7) * 5);
    reasons.push(`Target go-live overdue by ${daysOverGoLive} days`);
  }

  if (!dep.actualStart && dep.plannedStart) {
    const daysOverPlannedStart = Math.max(0, -(daysUntil(dep.plannedStart) ?? 0));
    if (daysOverPlannedStart > 14) {
      score += 12;
      reasons.push(`Work not started — planned start was ${daysOverPlannedStart} days ago`);
    }
  }

  if (!dep.ownerUserId) { score += 10; reasons.push("No owner assigned"); }

  const sinceUpdate = daysSince(dep.updatedAt);
  if (sinceUpdate !== null && sinceUpdate > 30) {
    score += 8;
    reasons.push(`No updates in ${sinceUpdate} days — may be stalled`);
  }

  if ((dep.pendingCheckpointCount ?? 0) > 3) {
    score += 6;
    reasons.push(`${dep.pendingCheckpointCount} commissioning checkpoints pending`);
  }

  if (dep.blockers && dep.blockers.length > 50) {
    score += 5;
    reasons.push("Detailed blocker notes recorded");
  }

  const finalScore = clamp(score);
  const conf = clamp(
    (dep.status ? 20 : 0) +
    (dep.targetGoLive ? 20 : 0) +
    (dep.ownerUserId ? 15 : 0) +
    (dep.plannedStart ? 15 : 0) +
    (dep.updatedAt ? 15 : 0) +
    ((dep.openBlockerCount !== undefined) ? 15 : 0)
  );
  return {
    score: finalScore,
    band: toBand(finalScore, [25, 50, 72]),
    label: "Deployment Delay Risk",
    reasons,
    scoredAt: new Date().toISOString(),
    confidence: conf,
    confidenceLabel: toConfidenceLabel(conf),
    modelName: "deployment_risk",
  };
}

export interface ChurnRiskInput {
  healthScore?: number | null;
  healthStatus?: string | null;
  billingStatus?: string | null;
  renewalDate?: string | Date | null;
  status?: string | null;
  lastCheckinAt?: string | Date | null;
  expansionPotential?: string | null;
  churnRiskFlags?: string[] | null;
  mrr?: number | null;
  arr?: number | null;
  contractTermMonths?: number | null;
  overdueTaskCount?: number;
  openTaskCount?: number;
  subscriptionStart?: string | Date | null;
}

export function scoreChurnRisk(sub: ChurnRiskInput): ScoreResult {
  let score = 0;
  const reasons: string[] = [];

  const hs = (sub.healthStatus || "healthy").toLowerCase();
  const HEALTH_BASE: Record<string, number> = { healthy: 0, at_risk: 35, critical: 60, churned: 100 };
  score += HEALTH_BASE[hs] ?? 20;
  if (hs !== "healthy") reasons.push(`Health status: ${hs}`);
  else reasons.push("Health status: healthy");

  const hScore = sub.healthScore ?? 100;
  if (hScore < 40) { score += 15; reasons.push(`Health score very low: ${hScore}/100`); }
  else if (hScore < 65) { score += 8; reasons.push(`Health score below average: ${hScore}/100`); }
  else if (hScore >= 85) { score -= 8; reasons.push(`Strong health score: ${hScore}/100`); }

  const billing = (sub.billingStatus || "current").toLowerCase();
  if (billing === "overdue") { score += 20; reasons.push("Billing overdue"); }
  else if (billing === "paused") { score += 10; reasons.push("Billing paused"); }

  const daysToRenewal = daysUntil(sub.renewalDate);
  const subStatus = (sub.status || "active").toLowerCase();
  if (sub.renewalDate) {
    if (daysToRenewal !== null && daysToRenewal < 0) {
      score += 25;
      reasons.push(`Renewal date passed ${Math.abs(daysToRenewal)} days ago without renewal`);
    } else if (daysToRenewal !== null && daysToRenewal <= 30 && subStatus === "renewal_due") {
      score += 15;
      reasons.push(`Renewal due in ${daysToRenewal} days — not yet actioned`);
    } else if (daysToRenewal !== null && daysToRenewal <= 60 && subStatus !== "renewed") {
      score += 8;
      reasons.push(`Renewal approaching in ${daysToRenewal} days`);
    }
  } else {
    score += 5;
    reasons.push("No renewal date set");
  }

  const sinceCheckin = daysSince(sub.lastCheckinAt);
  if (sinceCheckin === null) { score += 15; reasons.push("No check-in recorded"); }
  else if (sinceCheckin > 60) { score += 18; reasons.push(`No check-in in ${sinceCheckin} days`); }
  else if (sinceCheckin > 30) { score += 10; reasons.push(`Last check-in ${sinceCheckin} days ago`); }
  else { reasons.push(`Recent check-in ${sinceCheckin} days ago`); }

  const flags = sub.churnRiskFlags || [];
  if (flags.length > 0) {
    const flagScore = Math.min(20, flags.length * 6);
    score += flagScore;
    reasons.push(`${flags.length} churn risk flag(s): ${flags.slice(0, 2).join(", ")}${flags.length > 2 ? "…" : ""}`);
  }

  const ep = (sub.expansionPotential || "none").toLowerCase();
  if (ep === "high") { score -= 10; reasons.push("High expansion potential — likely satisfied"); }
  else if (ep === "medium") { score -= 5; }

  if ((sub.overdueTaskCount ?? 0) > 0) { score += 8; reasons.push(`${sub.overdueTaskCount} overdue task(s) for this account`); }

  const finalScore = clamp(score);
  const conf = clamp(
    (sub.healthScore !== undefined && sub.healthScore !== null ? 18 : 0) +
    (sub.healthStatus ? 15 : 0) +
    (sub.billingStatus ? 15 : 0) +
    (sub.renewalDate ? 15 : 0) +
    (sub.lastCheckinAt ? 12 : 0) +
    (sub.status ? 12 : 0) +
    ((sub.churnRiskFlags && sub.churnRiskFlags.length > 0) ? 8 : 0) +
    (sub.expansionPotential ? 5 : 0)
  );
  return {
    score: finalScore,
    band: toBand(finalScore, [25, 50, 72]),
    label: "Churn Risk",
    reasons,
    scoredAt: new Date().toISOString(),
    confidence: conf,
    confidenceLabel: toConfidenceLabel(conf),
    modelName: "churn_risk",
  };
}

export interface ExpansionInput {
  expansionPlans?: boolean | null;
  expansionNotes?: string | null;
  expansionPotential?: string | null;
  contractedUnits?: number | null;
  installedUnits?: number | null;
  voltsafeSlipsLive?: number | null;
  slipCount?: number | null;
  totalSlips?: number | null;
  healthStatus?: string | null;
  healthScore?: number | null;
  priority?: string | null;
  betaTester?: boolean | null;
  lastInteractionAt?: string | Date | null;
  activityCount?: number;
  openOpportunityCount?: number;
  arr?: number | null;
}

export function scoreExpansionLikelihood(acc: ExpansionInput): ScoreResult {
  let score = 0;
  const reasons: string[] = [];

  if (acc.expansionPlans) { score += 28; reasons.push("Expansion plans confirmed"); }

  const ep = (acc.expansionPotential || "none").toLowerCase();
  const EP_SCORE: Record<string, number> = { high: 25, medium: 15, low: 5, none: 0 };
  score += EP_SCORE[ep] ?? 0;
  if (ep !== "none") reasons.push(`Expansion potential: ${ep}`);

  if (acc.expansionNotes && acc.expansionNotes.length > 20) {
    score += 8;
    reasons.push("Expansion notes recorded");
  }

  const contracted = acc.contractedUnits ?? 0;
  const installed = acc.installedUnits ?? 0;
  if (contracted > 0 && installed < contracted) {
    const remaining = contracted - installed;
    score += Math.min(12, Math.round((remaining / contracted) * 12));
    reasons.push(`${remaining} contracted units not yet installed`);
  }

  const liveSlips = acc.voltsafeSlipsLive ?? 0;
  if (liveSlips > 0) { score += 12; reasons.push(`${liveSlips} VoltSafe slips live — proven deployment`); }

  const hs = (acc.healthStatus || "healthy").toLowerCase();
  if (hs === "healthy") { score += 18; reasons.push("Account health: healthy"); }
  else if (hs === "at_risk" || hs === "critical") {
    score -= 15;
    reasons.push(`Account health: ${hs} — unlikely to expand`);
  }

  const hScore = acc.healthScore ?? 100;
  if (hScore >= 85) { score += 8; reasons.push(`High health score: ${hScore}/100`); }

  const slips = acc.slipCount ?? acc.totalSlips ?? 0;
  if (slips >= 500) { score += 10; reasons.push(`Large marina: ${slips} slips — high expansion ceiling`); }
  else if (slips >= 200) { score += 6; reasons.push(`Mid-large marina: ${slips} slips`); }

  if (acc.priority === "high") { score += 6; reasons.push("High priority account"); }

  if (acc.betaTester) { score += 5; reasons.push("Beta tester — high engagement indicator"); }

  const sinceInteraction = daysSince(acc.lastInteractionAt);
  if (sinceInteraction !== null && sinceInteraction <= 14) {
    score += 6;
    reasons.push("Active relationship — recent interaction");
  }

  if ((acc.activityCount ?? 0) >= 5) { score += 4; reasons.push("High activity volume"); }

  if ((acc.openOpportunityCount ?? 0) > 0) { score += 8; reasons.push("Open opportunity in pipeline"); }

  const arr = acc.arr ?? 0;
  if (arr >= 50000) { score += 5; reasons.push(`Significant ARR: $${arr.toLocaleString()}`); }

  if (!acc.expansionPlans && ep === "none" && hs !== "healthy") {
    reasons.push("No expansion signals detected");
  }

  const finalScore = clamp(score);
  const conf = clamp(
    (acc.expansionPotential ? 18 : 0) +
    (acc.healthStatus ? 15 : 0) +
    (acc.healthScore !== undefined && acc.healthScore !== null ? 15 : 0) +
    (acc.arr ? 12 : 0) +
    (acc.lastInteractionAt ? 12 : 0) +
    (acc.contractedUnits !== undefined ? 10 : 0) +
    (acc.priority ? 10 : 0) +
    (acc.activityCount !== undefined ? 8 : 0)
  );
  return {
    score: finalScore,
    band: toBand(finalScore, [25, 50, 72]),
    label: "Expansion Likelihood",
    reasons,
    scoredAt: new Date().toISOString(),
    confidence: conf,
    confidenceLabel: toConfidenceLabel(conf),
    modelName: "expansion_likelihood",
  };
}

export interface HotListItem {
  type: "lead" | "opportunity" | "quote" | "deployment" | "churn" | "expansion";
  id: number;
  name: string;
  score: ScoreResult;
  actionHint: string;
  link: string;
}

export function bandRank(band: string): number {
  return { low: 1, medium: 2, high: 3, critical: 4 }[band] ?? 0;
}

export function actionHintFor(type: HotListItem["type"], score: ScoreResult): string {
  const b = score.band;
  switch (type) {
    case "lead": return b === "critical" ? "Reach out today — hot lead" : b === "high" ? "Follow up this week" : "Nurture or qualify";
    case "opportunity": return b === "critical" ? "Push to close — high close probability" : b === "high" ? "Advance stage — close date approaching" : "Re-engage or review blockers";
    case "quote": return b === "critical" ? "Follow up immediately — quote may expire" : b === "high" ? "Schedule follow-up call" : "Review quote status";
    case "deployment": return b === "critical" ? "Escalate blockers — deployment stalled" : b === "high" ? "Review and unblock" : "Monitor progress";
    case "churn": return b === "critical" ? "Escalate to CS manager — churn risk" : b === "high" ? "Schedule customer check-in" : "Monitor account health";
    case "expansion": return b === "critical" ? "Create expansion opportunity now" : b === "high" ? "Explore expansion with customer" : "Flag for QBR discussion";
  }
}
