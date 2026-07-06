/**
 * Capital Investor Engagement Analytics — computation service (Phase 2I)
 *
 * Pure functions: no DB calls, no side effects.
 * All DB queries stay in routes-capital.ts.
 * All weights and thresholds are exported for tests.
 */

// ── Tiers ─────────────────────────────────────────────────────────────────────

export const ENGAGEMENT_TIERS = {
  HIGHLY_ENGAGED: "Highly Engaged",
  ENGAGED:        "Engaged",
  WATCHING:       "Watching",
  STALE:          "Stale",
  COLD:           "Cold",
} as const;
export type EngagementTier = (typeof ENGAGEMENT_TIERS)[keyof typeof ENGAGEMENT_TIERS];

export const TIER_THRESHOLDS: Record<EngagementTier, number> = {
  "Highly Engaged": 70,
  "Engaged":        45,
  "Watching":       25,
  "Stale":          10,
  "Cold":           0,
};

export function engagementTierFromScore(score: number): EngagementTier {
  if (score >= 70) return "Highly Engaged";
  if (score >= 45) return "Engaged";
  if (score >= 25) return "Watching";
  if (score >= 10) return "Stale";
  return "Cold";
}

// ── Material types that signal deep diligence intent ──────────────────────────

export const HIGH_VALUE_MATERIAL_TYPES = new Set([
  "pitch_deck",
  "financial_model",
  "executive_summary",
  "cap_table",
]);

// ── Activity types that count as meetings / calls ─────────────────────────────

export const MEETING_ACTIVITY_TYPES = new Set([
  "meeting", "call", "demo", "partner_meeting", "zoom", "video_call", "site_visit",
]);

// ── Commitment stages that indicate real intent ───────────────────────────────

export const STRONG_COMMITMENT_STAGES = new Set([
  "Verbal Commit", "Verbal Interest", "Soft Circle", "Soft-Circled",
  "Hard Circle", "Committed", "Wired",
]);

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface EngagementSignals {
  // Email
  linked_email_count:      number;
  inbound_email_count:     number;
  outbound_email_count:    number;
  latest_inbound_email_at: string | null;
  latest_email_at:         string | null;
  // Portal
  has_portal_access:       boolean;
  portal_opened:           boolean;
  portal_open_count:       number;
  portal_last_accessed_at: string | null;
  portal_never_opened:     boolean;
  // Materials
  materials_shared_count:    number;
  materials_viewed_count:    number;
  materials_downloaded_count: number;
  high_value_materials_viewed: string[];   // material types (e.g. pitch_deck)
  material_request_count:    number;
  latest_material_activity_at: string | null;
  // Activities
  recent_meeting_count:    number;   // within 30 days
  total_activity_count:    number;
  latest_activity_at:      string | null;
  // Commitments
  has_commitment:          boolean;
  commitment_stage:        string | null;
  // Stage / metadata
  investor_stage:          string;
  do_not_contact:          boolean;
}

export interface EngagementResult {
  engagement_score:                number;   // 0–100
  engagement_tier:                 EngagementTier;
  reasons:                         string[];
  risk_flags:                      string[];
  recommended_next_action:         string;
  last_meaningful_engagement_at:   string | null;
  signal_breakdown:                Record<string, number>;
}

export interface EngagementTimelineEvent {
  event_type:      string;
  label:           string;
  timestamp:       string;
  source:          string;
  investor_id?:    number | null;
  material_id?:    number | null;
  round_id?:       number | null;
  display_summary: string;
}

export interface InvestorEngagementRow {
  investor_id:                   number;
  investor_name:                 string;
  investor_type:                 string;
  stage:                         string;
  priority:                      string;
  warmth:                        string;
  round_id?:                     number | null;
  round_name?:                   string | null;
  do_not_contact:                boolean;
  engagement_score:              number;
  engagement_tier:               EngagementTier;
  reasons:                       string[];
  risk_flags:                    string[];
  recommended_next_action:       string;
  last_meaningful_engagement_at: string | null;
  signal_breakdown:              Record<string, number>;
  signals:                       EngagementSignals;
}

export interface EngagementAnalyticsSummary {
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
}

// ── Signal extraction ─────────────────────────────────────────────────────────

/**
 * Extract all engagement signals for a single investor from pre-loaded DB rows.
 * All arrays should already be filtered to this investor before calling.
 */
export function extractEngagementSignals(
  investor:         any,
  activities:       any[],
  emailLinks:       any[],
  portalAccesses:   any[],
  portalEvents:     any[],
  materialShares:   any[],
  materialRequests: any[],
  commitments:      any[],
  materials:        any[],
): EngagementSignals {
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 86400000;

  // ── Email signals ──
  const inboundEmails  = emailLinks.filter(e => e.direction === "inbound");
  const outboundEmails = emailLinks.filter(e => e.direction === "outbound");
  const latestInbound  = inboundEmails
    .map(e => e.latest_message_at)
    .filter(Boolean)
    .sort()
    .reverse()[0] ?? null;
  const latestEmail    = emailLinks
    .map(e => e.latest_message_at)
    .filter(Boolean)
    .sort()
    .reverse()[0] ?? null;

  // ── Portal signals ──
  const activePortals     = portalAccesses.filter(p =>
    p.status === "active" &&
    (!p.expires_at || new Date(p.expires_at).getTime() > now)
  );
  const portalOpenCount   = activePortals.reduce((s: number, p: any) => s + (Number(p.access_count) || 0), 0);
  const portalLastAccess  = activePortals
    .map((p: any) => p.last_accessed_at)
    .filter(Boolean)
    .sort()
    .reverse()[0] ?? null;
  const portalOpened      = portalOpenCount > 0;
  const portalNeverOpened = activePortals.length > 0 && !portalOpened &&
    activePortals.some((p: any) => {
      const ageDays = (now - new Date(p.created_at).getTime()) / 86400000;
      return ageDays > 3;
    });

  // ── Material signals ──
  const materialTypeById = new Map<number, string>();
  for (const m of materials) {
    materialTypeById.set(Number(m.id), m.material_type);
  }

  const activeShares = materialShares.filter((s: any) => !s.deleted_at);
  const viewedShares = activeShares.filter((s: any) => s.viewed_at);
  const downloadedShares = activeShares.filter((s: any) => s.downloaded_at);

  const highValueViewed: string[] = [];
  const seenHighValueTypes = new Set<string>();
  for (const s of viewedShares) {
    const matType = materialTypeById.get(Number(s.material_id));
    if (matType && HIGH_VALUE_MATERIAL_TYPES.has(matType) && !seenHighValueTypes.has(matType)) {
      highValueViewed.push(matType);
      seenHighValueTypes.add(matType);
    }
  }

  const latestMaterialActivity = [
    ...activeShares.map((s: any) => s.viewed_at ?? s.shared_at),
    ...downloadedShares.map((s: any) => s.downloaded_at),
  ].filter(Boolean).sort().reverse()[0] ?? null;

  // ── Portal events for views/downloads (from portal system) ──
  // Also check portal events for additional view signals
  const portalViewEvents     = portalEvents.filter((e: any) => e.event_type === "material_viewed");
  const portalDownloadEvents = portalEvents.filter((e: any) => e.event_type === "material_downloaded");

  // Merge portal view signals into high value detection
  for (const e of portalViewEvents) {
    if (e.material_id) {
      const matType = materialTypeById.get(Number(e.material_id));
      if (matType && HIGH_VALUE_MATERIAL_TYPES.has(matType) && !seenHighValueTypes.has(matType)) {
        highValueViewed.push(matType);
        seenHighValueTypes.add(matType);
      }
    }
  }

  const totalViewed     = new Set([
    ...viewedShares.map((s: any) => s.material_id),
    ...portalViewEvents.map((e: any) => e.material_id).filter(Boolean),
  ]).size;
  const totalDownloaded = new Set([
    ...downloadedShares.map((s: any) => s.material_id),
    ...portalDownloadEvents.map((e: any) => e.material_id).filter(Boolean),
  ]).size;

  // ── Activity signals ──
  const recentMeetings  = activities.filter((a: any) => {
    if (!MEETING_ACTIVITY_TYPES.has((a.activity_type ?? "").toLowerCase())) return false;
    return a.activity_at && new Date(a.activity_at).getTime() > thirtyDaysAgo;
  });
  const latestActivity  = activities
    .map((a: any) => a.activity_at)
    .filter(Boolean)
    .sort()
    .reverse()[0] ?? null;

  // ── Commitment signals ──
  const validCommitments = commitments.filter((c: any) =>
    c.commitment_stage && c.commitment_stage !== "Passed"
  );
  const bestCommitment   = validCommitments.sort((a: any, b: any) => {
    const order = [...STRONG_COMMITMENT_STAGES.values()].reverse();
    const ai = order.indexOf(a.commitment_stage);
    const bi = order.indexOf(b.commitment_stage);
    return bi - ai;
  })[0] ?? null;

  return {
    linked_email_count:          emailLinks.length,
    inbound_email_count:         inboundEmails.length,
    outbound_email_count:        outboundEmails.length,
    latest_inbound_email_at:     latestInbound,
    latest_email_at:             latestEmail,

    has_portal_access:           portalAccesses.length > 0,
    portal_opened:               portalOpened,
    portal_open_count:           portalOpenCount,
    portal_last_accessed_at:     portalLastAccess,
    portal_never_opened:         portalNeverOpened,

    materials_shared_count:      activeShares.length,
    materials_viewed_count:      totalViewed,
    materials_downloaded_count:  totalDownloaded,
    high_value_materials_viewed: highValueViewed,
    material_request_count:      materialRequests.filter((r: any) => !r.deleted_at).length,
    latest_material_activity_at: latestMaterialActivity,

    recent_meeting_count:        recentMeetings.length,
    total_activity_count:        activities.length,
    latest_activity_at:          latestActivity,

    has_commitment:              validCommitments.length > 0,
    commitment_stage:            bestCommitment?.commitment_stage ?? null,

    investor_stage:              investor.stage ?? "Target Identified",
    do_not_contact:              !!investor.do_not_contact,
  };
}

// ── Score computation ─────────────────────────────────────────────────────────

/**
 * Compute engagement score (0–100) and tier from signals.
 * All scoring constants are exported for tests.
 */
export const SCORE_WEIGHTS = {
  inbound_reply_7d: 20,
  inbound_reply_30d: 12,
  inbound_reply_60d: 6,
  email_threads_max: 10,          // min(count * 3, 10)
  portal_opened: 15,
  portal_repeat_max: 9,           // min((opens-1) * 3, 9)
  material_viewed_max: 15,        // min(count * 5, 15)
  material_downloaded_max: 12,    // min(count * 6, 12)
  high_value_viewed_max: 15,      // min(count * 10, 15)
  material_request: 8,
  recent_meeting_max: 20,         // min(count * 10, 20)
  stage_diligence_plus: 10,
  commitment: 20,
  // Penalties
  portal_never_opened: -10,
  no_activity: -10,
} as const;

export function computeEngagementScore(
  investor: any,
  signals:  EngagementSignals,
): EngagementResult {
  // do_not_contact override — always Cold
  if (signals.do_not_contact || investor.stage === "Passed") {
    return {
      engagement_score:              0,
      engagement_tier:               "Cold",
      reasons:                       [signals.do_not_contact ? "Marked as Do Not Contact" : "Investor has passed"],
      risk_flags:                    [],
      recommended_next_action:       "No action — do not contact",
      last_meaningful_engagement_at: null,
      signal_breakdown:              { forced_cold: 1 },
    };
  }

  const now   = Date.now();
  const breakdown: Record<string, number> = {};
  let score   = 0;
  const reasons: string[] = [];
  const riskFlags: string[] = [];

  // ── Inbound email recency ──
  if (signals.latest_inbound_email_at) {
    const ageDays = (now - new Date(signals.latest_inbound_email_at).getTime()) / 86400000;
    if (ageDays <= 7) {
      breakdown.inbound_reply_7d = SCORE_WEIGHTS.inbound_reply_7d;
      score += SCORE_WEIGHTS.inbound_reply_7d;
      reasons.push("Replied within 7 days");
    } else if (ageDays <= 30) {
      breakdown.inbound_reply_30d = SCORE_WEIGHTS.inbound_reply_30d;
      score += SCORE_WEIGHTS.inbound_reply_30d;
      reasons.push("Replied within 30 days");
    } else if (ageDays <= 60) {
      breakdown.inbound_reply_60d = SCORE_WEIGHTS.inbound_reply_60d;
      score += SCORE_WEIGHTS.inbound_reply_60d;
      reasons.push("Replied within 60 days");
    }
  }

  // ── Email thread activity ──
  const emailThreadScore = Math.min(signals.linked_email_count * 3, SCORE_WEIGHTS.email_threads_max);
  if (emailThreadScore > 0) {
    breakdown.email_threads = emailThreadScore;
    score += emailThreadScore;
    reasons.push(`${signals.linked_email_count} linked email thread${signals.linked_email_count === 1 ? "" : "s"}`);
  }

  // ── Portal opened ──
  if (signals.portal_opened) {
    breakdown.portal_opened = SCORE_WEIGHTS.portal_opened;
    score += SCORE_WEIGHTS.portal_opened;
    reasons.push(`Portal opened (${signals.portal_open_count}x)`);

    if (signals.portal_open_count > 1) {
      const repeatScore = Math.min((signals.portal_open_count - 1) * 3, SCORE_WEIGHTS.portal_repeat_max);
      breakdown.portal_repeat = repeatScore;
      score += repeatScore;
    }
  }

  // ── Materials viewed ──
  const viewedScore = Math.min(signals.materials_viewed_count * 5, SCORE_WEIGHTS.material_viewed_max);
  if (viewedScore > 0) {
    breakdown.materials_viewed = viewedScore;
    score += viewedScore;
    reasons.push(`${signals.materials_viewed_count} material${signals.materials_viewed_count === 1 ? "" : "s"} viewed`);
  }

  // ── Materials downloaded ──
  const downloadedScore = Math.min(signals.materials_downloaded_count * 6, SCORE_WEIGHTS.material_downloaded_max);
  if (downloadedScore > 0) {
    breakdown.materials_downloaded = downloadedScore;
    score += downloadedScore;
    reasons.push(`${signals.materials_downloaded_count} material${signals.materials_downloaded_count === 1 ? "" : "s"} downloaded`);
  }

  // ── High-value material viewed ──
  const hvScore = Math.min(signals.high_value_materials_viewed.length * 10, SCORE_WEIGHTS.high_value_viewed_max);
  if (hvScore > 0) {
    breakdown.high_value_viewed = hvScore;
    score += hvScore;
    const hvLabels = signals.high_value_materials_viewed.map(t => {
      const lbl: Record<string, string> = {
        pitch_deck: "Pitch Deck", financial_model: "Financial Model",
        executive_summary: "Executive Summary", cap_table: "Cap Table",
      };
      return lbl[t] ?? t;
    });
    reasons.push(`Viewed high-value material: ${hvLabels.join(", ")}`);
  }

  // ── Material request ──
  if (signals.material_request_count > 0) {
    breakdown.material_request = SCORE_WEIGHTS.material_request;
    score += SCORE_WEIGHTS.material_request;
    reasons.push(`Requested ${signals.material_request_count} material${signals.material_request_count === 1 ? "" : "s"}`);
  }

  // ── Recent meetings / calls ──
  const meetingScore = Math.min(signals.recent_meeting_count * 10, SCORE_WEIGHTS.recent_meeting_max);
  if (meetingScore > 0) {
    breakdown.recent_meetings = meetingScore;
    score += meetingScore;
    reasons.push(`${signals.recent_meeting_count} meeting${signals.recent_meeting_count === 1 ? "" : "s"} / call${signals.recent_meeting_count === 1 ? "" : "s"} (30d)`);
  }

  // ── Stage advancement ──
  const advancedStages = new Set(["Diligence","Partner Meeting","Soft Commit","Committed","Wired / Closed"]);
  if (advancedStages.has(signals.investor_stage)) {
    breakdown.stage_advancement = SCORE_WEIGHTS.stage_diligence_plus;
    score += SCORE_WEIGHTS.stage_diligence_plus;
    reasons.push(`Advanced stage: ${signals.investor_stage}`);
  }

  // ── Commitment ──
  if (signals.has_commitment && signals.commitment_stage &&
      STRONG_COMMITMENT_STAGES.has(signals.commitment_stage)) {
    breakdown.commitment = SCORE_WEIGHTS.commitment;
    score += SCORE_WEIGHTS.commitment;
    reasons.push(`Commitment: ${signals.commitment_stage}`);
  }

  // ── Penalties ──
  if (signals.portal_never_opened) {
    breakdown.portal_never_opened = SCORE_WEIGHTS.portal_never_opened;
    score += SCORE_WEIGHTS.portal_never_opened;
    riskFlags.push("Portal link sent but never opened");
  }

  if (signals.total_activity_count === 0 && signals.linked_email_count === 0 &&
      !signals.portal_opened && signals.materials_viewed_count === 0) {
    breakdown.no_activity = SCORE_WEIGHTS.no_activity;
    score += SCORE_WEIGHTS.no_activity;
    riskFlags.push("No engagement signals recorded");
  }

  // ── Additional risk flags ──
  if (advancedStages.has(signals.investor_stage) && !signals.latest_inbound_email_at) {
    riskFlags.push("In diligence/advanced stage but no inbound email reply");
  }

  if (signals.portal_opened && !signals.latest_inbound_email_at) {
    riskFlags.push("Opened portal but no email follow-up received");
  }

  if (signals.high_value_materials_viewed.includes("financial_model") &&
      (signals.total_activity_count === 0 ||
       !signals.latest_activity_at ||
       (now - new Date(signals.latest_activity_at).getTime()) / 86400000 > 7)) {
    riskFlags.push("Viewed financial model but no recent follow-up activity");
  }

  if (investor.likely_lead && score < 25) {
    riskFlags.push("Likely lead investor with low engagement score");
  }

  // ── Last meaningful engagement ──
  const engagementDates = [
    signals.latest_inbound_email_at,
    signals.portal_last_accessed_at,
    signals.latest_material_activity_at,
    signals.latest_activity_at,
  ].filter(Boolean) as string[];
  const lastMeaningful = engagementDates.sort().reverse()[0] ?? null;

  // ── Clamp score ──
  const clampedScore = Math.max(0, Math.min(100, score));
  const tier         = engagementTierFromScore(clampedScore);

  // ── Recommended next action ──
  const recommended = recommendNextAction(investor, signals, tier);

  return {
    engagement_score:              clampedScore,
    engagement_tier:               tier,
    reasons:                       reasons.length > 0 ? reasons : ["No significant engagement signals"],
    risk_flags:                    riskFlags,
    recommended_next_action:       recommended,
    last_meaningful_engagement_at: lastMeaningful,
    signal_breakdown:              breakdown,
  };
}

// ── Recommendation engine ─────────────────────────────────────────────────────

export function recommendNextAction(
  investor: any,
  signals:  EngagementSignals,
  tier:     EngagementTier,
): string {
  if (signals.do_not_contact || investor.stage === "Passed") {
    return "No action — do not contact";
  }

  // Commitment signals
  if (signals.commitment_stage === "Hard Circle" || signals.commitment_stage === "Committed") {
    return "Confirm commitment — send closing documents";
  }
  if (signals.commitment_stage === "Verbal Commit" || signals.commitment_stage === "Soft Circle") {
    return "Confirm verbal commitment — move to hard circle";
  }

  // High-value material engaged → follow up
  if (signals.high_value_materials_viewed.includes("financial_model") &&
      (!signals.latest_inbound_email_at ||
       (Date.now() - new Date(signals.latest_inbound_email_at).getTime()) / 86400000 > 7)) {
    return "Follow up now — investor viewed financial model";
  }
  if (signals.high_value_materials_viewed.includes("pitch_deck") &&
      signals.materials_viewed_count >= 2 && !signals.latest_inbound_email_at) {
    return "Ask for feedback — deck viewed but no reply received";
  }

  // Portal opened → meet
  if (tier === "Highly Engaged" || (signals.portal_opened && signals.materials_viewed_count >= 2)) {
    return "Schedule meeting — investor is highly engaged";
  }

  // Portal never opened
  if (signals.portal_never_opened) {
    return "Re-send data room link — portal not opened after 3+ days";
  }

  // No portal for advanced stage
  if (!signals.has_portal_access &&
      ["Diligence","Partner Meeting","Soft Commit","Follow-Up"].includes(signals.investor_stage)) {
    return "Send data room link — investor in advanced stage has no portal access";
  }

  // Warm but no email
  if (["Engaged","Highly Engaged"].includes(tier) && signals.linked_email_count === 0) {
    return "Start email conversation — no linked threads yet";
  }

  // Stale engagement
  if (tier === "Stale" || tier === "Cold") {
    const lastAt = [
      signals.latest_inbound_email_at,
      signals.latest_activity_at,
      signals.latest_email_at,
    ].filter(Boolean).sort().reverse()[0];
    if (lastAt) {
      const days = Math.floor((Date.now() - new Date(lastAt).getTime()) / 86400000);
      return `Re-engage — no activity in ${days} day${days === 1 ? "" : "s"}`;
    }
    return "Re-engage — no engagement signals recorded";
  }

  // Material requested
  if (signals.material_request_count > 0) {
    return "Fulfil material request — investor asked for document";
  }

  return "Maintain momentum — send an update or check-in";
}

// ── Timeline builder ──────────────────────────────────────────────────────────

export function buildEngagementTimeline(
  investor:       any,
  activities:     any[],
  emailLinks:     any[],
  portalEvents:   any[],
  materialShares: any[],
  commitments:    any[],
  materials:      any[],
  limit:          number = 30,
): EngagementTimelineEvent[] {
  const events: EngagementTimelineEvent[] = [];
  const materialTitles = new Map<number, string>();
  const materialTypes  = new Map<number, string>();
  for (const m of materials) {
    materialTitles.set(Number(m.id), m.title ?? "Untitled");
    materialTypes.set(Number(m.id), m.material_type ?? "other");
  }

  // Activities
  for (const a of activities) {
    if (!a.activity_at) continue;
    events.push({
      event_type:      `activity_${a.activity_type ?? "general"}`,
      label:           a.title || a.activity_type || "Activity",
      timestamp:       a.activity_at,
      source:          "activity",
      investor_id:     investor.id,
      display_summary: a.title || a.activity_type || "Activity logged",
    });
  }

  // Email links — event_type: email_inbound | email_outbound | email_unknown
  for (const e of emailLinks) {
    if (!e.latest_message_at) continue;
    const direction = e.direction === "inbound" ? "↩ Inbound reply" : "↗ Outbound email";
    // event_type will be email_inbound, email_outbound, or email_unknown
    const emailEventType = e.direction === "inbound" ? "email_inbound" : `email_${e.direction ?? "unknown"}`;
    events.push({
      event_type:      emailEventType,
      label:           e.subject ? `Email: ${e.subject}` : direction,
      timestamp:       e.latest_message_at,
      source:          "email",
      investor_id:     investor.id,
      display_summary: e.subject ? `${direction}: ${e.subject}` : direction,
    });
  }

  // Portal events
  for (const e of portalEvents) {
    if (!e.occurred_at) continue;
    const typeLabel: Record<string, string> = {
      portal_opened:       "🔓 Opened investor portal",
      material_viewed:     "👁 Viewed material in portal",
      material_downloaded: "⬇ Downloaded material from portal",
    };
    const matTitle = e.material_id ? (materialTitles.get(Number(e.material_id)) ?? "document") : null;
    events.push({
      event_type:  e.event_type,
      label:       typeLabel[e.event_type] ?? e.event_type,
      timestamp:   e.occurred_at,
      source:      "portal",
      investor_id: investor.id,
      material_id: e.material_id ?? null,
      display_summary: matTitle
        ? `${typeLabel[e.event_type] ?? e.event_type}: ${matTitle}`
        : (typeLabel[e.event_type] ?? e.event_type),
    });
  }

  // Material shares
  for (const s of materialShares) {
    if (s.deleted_at) continue;
    if (s.viewed_at) {
      const matTitle = materialTitles.get(Number(s.material_id)) ?? "document";
      events.push({
        event_type:      "material_viewed",
        label:           `Viewed: ${matTitle}`,
        timestamp:       s.viewed_at,
        source:          "material_share",
        investor_id:     investor.id,
        material_id:     s.material_id,
        display_summary: `Viewed material: ${matTitle}`,
      });
    }
    if (s.downloaded_at) {
      const matTitle = materialTitles.get(Number(s.material_id)) ?? "document";
      events.push({
        event_type:      "material_downloaded",
        label:           `Downloaded: ${matTitle}`,
        timestamp:       s.downloaded_at,
        source:          "material_share",
        investor_id:     investor.id,
        material_id:     s.material_id,
        display_summary: `Downloaded material: ${matTitle}`,
      });
    }
    if (s.shared_at) {
      const matTitle = materialTitles.get(Number(s.material_id)) ?? "document";
      events.push({
        event_type:      "material_shared",
        label:           `Shared: ${matTitle}`,
        timestamp:       s.shared_at,
        source:          "material_share",
        investor_id:     investor.id,
        material_id:     s.material_id,
        display_summary: `Material shared: ${matTitle}`,
      });
    }
  }

  // Commitments
  for (const c of commitments) {
    if (!c.created_at) continue;
    events.push({
      event_type:      "commitment",
      label:           `Commitment: ${c.commitment_stage ?? "recorded"}`,
      timestamp:       c.created_at,
      source:          "commitment",
      investor_id:     investor.id,
      round_id:        c.round_id ?? null,
      display_summary: `Commitment stage: ${c.commitment_stage ?? "recorded"}`,
    });
  }

  // Deduplicate + sort descending + limit
  const seen = new Set<string>();
  const unique: EngagementTimelineEvent[] = [];
  for (const e of events.sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )) {
    const key = `${e.event_type}:${e.timestamp}:${e.material_id ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(e);
    }
  }

  return unique.slice(0, limit);
}

// ── Batch analytics summary ───────────────────────────────────────────────────

export function computeEngagementAnalytics(
  rows:         InvestorEngagementRow[],
  portalEvents: any[],
  materialShares: any[],
  emailLinks:   any[],
): EngagementAnalyticsSummary {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 86400000;

  const highly_engaged = rows.filter(r => r.engagement_tier === "Highly Engaged").length;
  const engaged        = rows.filter(r => r.engagement_tier === "Engaged").length;
  const watching       = rows.filter(r => r.engagement_tier === "Watching").length;
  const stale          = rows.filter(r => r.engagement_tier === "Stale").length;
  const cold           = rows.filter(r => r.engagement_tier === "Cold").length;

  const portalOpens7d = portalEvents.filter(e =>
    e.event_type === "portal_opened" &&
    new Date(e.occurred_at).getTime() > sevenDaysAgo
  ).length;

  const materialViews7d = [
    ...portalEvents.filter(e =>
      e.event_type === "material_viewed" &&
      new Date(e.occurred_at).getTime() > sevenDaysAgo
    ),
    ...materialShares.filter(s =>
      s.viewed_at && new Date(s.viewed_at).getTime() > sevenDaysAgo
    ),
  ].length;

  const materialDownloads7d = [
    ...portalEvents.filter(e =>
      e.event_type === "material_downloaded" &&
      new Date(e.occurred_at).getTime() > sevenDaysAgo
    ),
    ...materialShares.filter(s =>
      s.downloaded_at && new Date(s.downloaded_at).getTime() > sevenDaysAgo
    ),
  ].length;

  const recentInbound = emailLinks.filter(e => {
    if (e.direction !== "inbound" || !e.latest_message_at) return false;
    return new Date(e.latest_message_at).getTime() > sevenDaysAgo;
  }).length;

  // Investors who have portal access but never opened it
  const noEngagementAfterPortal = rows.filter(r =>
    r.signals.has_portal_access && !r.signals.portal_opened &&
    !r.signals.latest_inbound_email_at && r.signals.total_activity_count === 0
  ).length;

  // Hot investors (Highly Engaged/Engaged) with no activity in 7+ days
  const hotWithStaleFollowup = rows.filter(r => {
    if (!["Highly Engaged","Engaged"].includes(r.engagement_tier)) return false;
    const last = r.last_meaningful_engagement_at;
    if (!last) return true;
    return (now - new Date(last).getTime()) / 86400000 > 7;
  }).length;

  return {
    total_investors:            rows.length,
    highly_engaged_count:       highly_engaged,
    engaged_count:              engaged,
    watching_count:             watching,
    stale_count:                stale,
    cold_count:                 cold,
    portal_opens_7d:            portalOpens7d,
    material_views_7d:          materialViews7d,
    material_downloads_7d:      materialDownloads7d,
    recent_inbound_replies:     recentInbound,
    no_engagement_after_portal: noEngagementAfterPortal,
    hot_with_stale_followup:    hotWithStaleFollowup,
  };
}

// ── Material engagement leaderboard ──────────────────────────────────────────

export interface MaterialEngagementRow {
  material_id:      number;
  material_title:   string;
  material_type:    string;
  total_views:      number;
  total_downloads:  number;
  unique_investors: number;
  last_viewed_at:   string | null;
  is_high_value:    boolean;
}

export function computeMaterialEngagement(
  materials:    any[],
  shares:       any[],
  portalEvents: any[],
): MaterialEngagementRow[] {
  const matViews     = new Map<number, number>();
  const matDownloads = new Map<number, number>();
  const matInvestors = new Map<number, Set<number>>();
  const matLastView  = new Map<number, string>();

  // From material shares
  for (const s of shares) {
    if (s.deleted_at) continue;
    const mid = Number(s.material_id);
    const iid = Number(s.investor_id);
    if (s.viewed_at) {
      matViews.set(mid, (matViews.get(mid) ?? 0) + 1);
      if (!matLastView.has(mid) || s.viewed_at > matLastView.get(mid)!) {
        matLastView.set(mid, s.viewed_at);
      }
    }
    if (s.downloaded_at) {
      matDownloads.set(mid, (matDownloads.get(mid) ?? 0) + 1);
    }
    if (iid) {
      if (!matInvestors.has(mid)) matInvestors.set(mid, new Set());
      matInvestors.get(mid)!.add(iid);
    }
  }

  // From portal events
  for (const e of portalEvents) {
    if (!e.material_id) continue;
    const mid = Number(e.material_id);
    if (e.event_type === "material_viewed") {
      matViews.set(mid, (matViews.get(mid) ?? 0) + 1);
      if (!matLastView.has(mid) || e.occurred_at > matLastView.get(mid)!) {
        matLastView.set(mid, e.occurred_at);
      }
    }
    if (e.event_type === "material_downloaded") {
      matDownloads.set(mid, (matDownloads.get(mid) ?? 0) + 1);
    }
    if (e.investor_id) {
      if (!matInvestors.has(mid)) matInvestors.set(mid, new Set());
      matInvestors.get(mid)!.add(Number(e.investor_id));
    }
  }

  const rows: MaterialEngagementRow[] = materials
    .filter(m => !m.deleted_at && m.status === "active")
    .map(m => ({
      material_id:      Number(m.id),
      material_title:   m.title ?? "Untitled",
      material_type:    m.material_type ?? "other",
      total_views:      matViews.get(Number(m.id)) ?? 0,
      total_downloads:  matDownloads.get(Number(m.id)) ?? 0,
      unique_investors: matInvestors.get(Number(m.id))?.size ?? 0,
      last_viewed_at:   matLastView.get(Number(m.id)) ?? null,
      is_high_value:    HIGH_VALUE_MATERIAL_TYPES.has(m.material_type ?? ""),
    }))
    .sort((a, b) => (b.total_views + b.total_downloads) - (a.total_views + a.total_downloads));

  return rows;
}

// ── Command center engagement intelligence ────────────────────────────────────

export interface EngagementIntelligence {
  top_engaged:      { investor_id: number; investor_name: string; score: number; tier: EngagementTier; last_at: string | null }[];
  stale_high_value: { investor_id: number; investor_name: string; stage: string; days_since: number }[];
  portal_non_openers: { investor_id: number; investor_name: string; stage: string; portal_age_days: number }[];
  recent_activity_feed: { investor_id: number; investor_name: string; event_type: string; summary: string; at: string }[];
  materials_driving_engagement: { material_id: number; title: string; type: string; views: number }[];
  engagement_risk_flags: { code: string; level: "critical" | "warning" | "info"; message: string }[];
}

export function computeCommandCenterEngagement(
  investorRows:   InvestorEngagementRow[],
  materialEngagement: MaterialEngagementRow[],
  timeline:       EngagementTimelineEvent[],
  portalAccesses: any[],
): EngagementIntelligence {
  const now = Date.now();

  // Top 5 most engaged investors
  const topEngaged = investorRows
    .filter(r => !r.do_not_contact && r.engagement_score > 0)
    .sort((a, b) => b.engagement_score - a.engagement_score)
    .slice(0, 5)
    .map(r => ({
      investor_id:   r.investor_id,
      investor_name: r.investor_name,
      score:         r.engagement_score,
      tier:          r.engagement_tier,
      last_at:       r.last_meaningful_engagement_at,
    }));

  // High-value investors (Priority High/Critical or advanced stage) who are stale
  const advancedStages = new Set(["Diligence","Partner Meeting","Soft Commit","Committed"]);
  const highValueStale = investorRows
    .filter(r => {
      if (r.do_not_contact) return false;
      const isHighValue = ["Critical","High"].includes(r.priority) || advancedStages.has(r.stage);
      if (!isHighValue) return false;
      if (!r.last_meaningful_engagement_at) return true;
      const days = (now - new Date(r.last_meaningful_engagement_at).getTime()) / 86400000;
      return days > 7;
    })
    .map(r => {
      const daysSince = r.last_meaningful_engagement_at
        ? Math.floor((now - new Date(r.last_meaningful_engagement_at).getTime()) / 86400000)
        : 999;
      return { investor_id: r.investor_id, investor_name: r.investor_name, stage: r.stage, days_since: daysSince };
    })
    .sort((a, b) => b.days_since - a.days_since)
    .slice(0, 5);

  // Portal non-openers (sent >3 days ago, never opened)
  const portalNonOpeners = investorRows
    .filter(r => r.signals.portal_never_opened)
    .map(r => {
      const oldestPortal = portalAccesses
        .filter(p => Number(p.investor_id) === r.investor_id && p.status === "active" && Number(p.access_count) === 0)
        .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];
      const ageDays = oldestPortal
        ? Math.floor((now - new Date(oldestPortal.created_at).getTime()) / 86400000)
        : 0;
      return { investor_id: r.investor_id, investor_name: r.investor_name, stage: r.stage, portal_age_days: ageDays };
    })
    .sort((a, b) => b.portal_age_days - a.portal_age_days)
    .slice(0, 5);

  // Recent engagement feed (last 10 meaningful timeline events)
  const recentFeed = timeline
    .filter(e => !["material_shared"].includes(e.event_type)) // only inbound/engagement events
    .slice(0, 10)
    .map(e => ({
      investor_id:   e.investor_id ?? 0,
      investor_name: investorRows.find(r => r.investor_id === e.investor_id)?.investor_name ?? "Investor",
      event_type:    e.event_type,
      summary:       e.display_summary,
      at:            e.timestamp,
    }));

  // Top materials by engagement
  const materialsTop = materialEngagement
    .filter(m => m.total_views + m.total_downloads > 0)
    .slice(0, 5)
    .map(m => ({
      material_id: m.material_id,
      title:       m.material_title,
      type:        m.material_type,
      views:       m.total_views,
    }));

  // Engagement risk flags
  const engRiskFlags: EngagementIntelligence["engagement_risk_flags"] = [];

  const leadInvestors = investorRows.filter(r => r.signals.investor_stage !== "Passed" && !r.do_not_contact);
  const leadNoEngagement7d = leadInvestors.filter(r => {
    const last = r.last_meaningful_engagement_at;
    if (!last) return true;
    return (now - new Date(last).getTime()) / 86400000 > 7;
  });
  if (leadNoEngagement7d.length > 0) {
    engRiskFlags.push({
      level: "warning",
      code: "lead_no_engagement_7d",
      message: `${leadNoEngagement7d.length} investor${leadNoEngagement7d.length === 1 ? "" : "s"} with no engagement in 7+ days`,
    });
  }

  const portalNeverOpenedCount = investorRows.filter(r => r.signals.portal_never_opened).length;
  if (portalNeverOpenedCount > 0) {
    engRiskFlags.push({
      level: "info",
      code: "portal_never_opened",
      message: `${portalNeverOpenedCount} investor${portalNeverOpenedCount === 1 ? "" : "s"} never opened their portal link`,
    });
  }

  const highScoreNoInbound = investorRows.filter(r =>
    r.engagement_score >= 45 && !r.signals.latest_inbound_email_at
  );
  if (highScoreNoInbound.length > 0) {
    engRiskFlags.push({
      level: "info",
      code: "high_score_no_inbound",
      message: `${highScoreNoInbound.length} engaged investor${highScoreNoInbound.length === 1 ? "" : "s"} with no inbound email reply`,
    });
  }

  const engagedNoNextStep = investorRows.filter(r => {
    if (!["Highly Engaged","Engaged"].includes(r.engagement_tier)) return false;
    return !r.signals.has_commitment;
  });
  if (engagedNoNextStep.length > 0) {
    engRiskFlags.push({
      level: "info",
      code: "engaged_no_commitment",
      message: `${engagedNoNextStep.length} engaged investor${engagedNoNextStep.length === 1 ? "" : "s"} with no commitment recorded`,
    });
  }

  return {
    top_engaged:              topEngaged,
    stale_high_value:         highValueStale,
    portal_non_openers:       portalNonOpeners,
    recent_activity_feed:     recentFeed,
    materials_driving_engagement: materialsTop,
    engagement_risk_flags:    engRiskFlags,
  };
}
