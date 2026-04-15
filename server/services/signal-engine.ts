/**
 * Signal Engine — deterministic relationship signal computation.
 *
 * Takes pre-fetched record data and emits signals (each signal is a
 * potential task suggestion). The engine is pure / side-effect-free;
 * callers are responsible for persisting and deduplicating results.
 *
 * Signal ordering (highest → lowest priority):
 *   1. overdue_task
 *   2. recent_inbound_no_followup
 *   3. high_value_stale_opp
 *   4. stale_open_opp
 *   5. no_inbound_45d
 *   6. health_stale
 *   7. no_outbound_21d
 *   8. no_inbound_30d
 *   9. health_at_risk
 *  10. no_inbound_14d
 *  11. health_cooling
 *
 * Only the top-N (default 3) signals should be returned to the caller.
 */

export type SignalSeverity = "low" | "medium" | "high";
export type ActionType =
  | "send_email"
  | "reply_email"
  | "log_call"
  | "add_note"
  | "schedule_meeting"
  | "review_opportunity"
  | "complete_task"
  | "create_task";

export interface Signal {
  signalType: string;
  severity: SignalSeverity;
  title: string;
  reason: string;
  suggestedActionType: ActionType;
  suggestedActionLabel: string;
  priority: "low" | "medium" | "high";
  suggestedDueDays: number;
}

export interface SignalInput {
  objectType: "account" | "contact" | "opportunity" | "lead" | "partner";
  objectId: number;
  lastInboundEmail: string | null;
  lastOutboundEmail: string | null;
  lastNote: string | null;
  lastActivity: string | null;
  lastTouch: string | null;
  openTasksCount: number;
  overdueTasksCount: number;
  openOppsCount: number;
  openOppsValue: number;
  staleOppsCount: number;
  healthScore: number;
  healthLabel: string;
  opportunityAmount?: number;
}

function daysSince(date: string | null | undefined): number | null {
  if (!date) return null;
  const ms = Date.now() - new Date(date).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function severityToPriority(s: SignalSeverity): "low" | "medium" | "high" {
  return s;
}

export function computeSignals(input: SignalInput): Signal[] {
  const signals: Signal[] = [];
  const {
    lastInboundEmail,
    lastOutboundEmail,
    overdueTasksCount,
    staleOppsCount,
    openOppsValue,
    healthLabel,
    objectType,
  } = input;

  const inboundDays = daysSince(lastInboundEmail);
  const outboundDays = daysSince(lastOutboundEmail);

  // 1. Overdue task — highest priority, always actionable
  if (overdueTasksCount > 0) {
    const plural = overdueTasksCount > 1 ? "s" : "";
    signals.push({
      signalType: "overdue_task",
      severity: "high",
      title: `Complete overdue task${plural}`,
      reason: `${overdueTasksCount} open task${plural} ${overdueTasksCount > 1 ? "are" : "is"} past due — action needed now`,
      suggestedActionType: "complete_task",
      suggestedActionLabel: "View & complete overdue tasks",
      priority: "high",
      suggestedDueDays: 0,
    });
  }

  // 2. Recent inbound with no follow-up (inbound in last 2 days, no outbound since)
  const recentInboundNoFollowup =
    lastInboundEmail !== null &&
    inboundDays !== null &&
    inboundDays <= 2 &&
    (lastOutboundEmail === null ||
      new Date(lastInboundEmail) > new Date(lastOutboundEmail));

  if (recentInboundNoFollowup) {
    signals.push({
      signalType: "recent_inbound_no_followup",
      severity: "high",
      title: "Reply to recent email",
      reason: "A message came in recently with no response logged yet",
      suggestedActionType: "reply_email",
      suggestedActionLabel: "Reply to latest email",
      priority: "high",
      suggestedDueDays: 1,
    });
  }

  // 3. High-value stale opportunity ($10k+ deal, no activity 30d)
  if (staleOppsCount > 0 && openOppsValue >= 10000) {
    const valueStr = openOppsValue >= 1000
      ? `$${(openOppsValue / 1000).toFixed(0)}k`
      : `$${openOppsValue}`;
    signals.push({
      signalType: "high_value_stale_opp",
      severity: "high",
      title: "Re-engage on high-value deal",
      reason: `An open deal worth ${valueStr} has had no activity in 30+ days`,
      suggestedActionType: "review_opportunity",
      suggestedActionLabel: "Review stalled deal",
      priority: "high",
      suggestedDueDays: 2,
    });
  } else if (staleOppsCount > 0) {
    // 4. Generic stale opportunity
    signals.push({
      signalType: "stale_open_opp",
      severity: "medium",
      title: "Review stalled opportunity",
      reason: `${staleOppsCount > 1 ? `${staleOppsCount} open deals have` : "An open deal has"} had no activity in 30+ days`,
      suggestedActionType: "review_opportunity",
      suggestedActionLabel: "Review stalled deal",
      priority: "medium",
      suggestedDueDays: 3,
    });
  }

  // 5. No inbound in 45+ days
  if (inboundDays !== null && inboundDays >= 45) {
    signals.push({
      signalType: "no_inbound_45d",
      severity: "high",
      title: "Re-activate dormant relationship",
      reason: `No inbound message in ${inboundDays} days — this contact may have gone dark`,
      suggestedActionType: "log_call",
      suggestedActionLabel: "Log a re-engagement call",
      priority: "high",
      suggestedDueDays: 2,
    });
  }

  // 6. Health stale (health-based, only if no inbound signal already)
  if (healthLabel === "Stale") {
    signals.push({
      signalType: "health_stale",
      severity: "high",
      title: "Re-engage this relationship",
      reason: "Relationship health has dropped to Stale — urgently needs a personal touchpoint",
      suggestedActionType: "schedule_meeting",
      suggestedActionLabel: "Schedule a reconnect",
      priority: "high",
      suggestedDueDays: 3,
    });
  }

  // 7. No outbound in 21+ days (or never)
  const outboundSignalDays = outboundDays ?? 999;
  if (outboundSignalDays >= 21) {
    const daysLabel = outboundDays !== null ? `${outboundDays} days` : "ever";
    signals.push({
      signalType: "no_outbound_21d",
      severity: "medium",
      title: "Send a proactive follow-up",
      reason: `No outbound message sent in ${daysLabel}`,
      suggestedActionType: "send_email",
      suggestedActionLabel: "Send a follow-up email",
      priority: "medium",
      suggestedDueDays: 3,
    });
  }

  // 8. No inbound in 30–44 days
  if (inboundDays !== null && inboundDays >= 30 && inboundDays < 45) {
    signals.push({
      signalType: "no_inbound_30d",
      severity: "medium",
      title: "Reach out to re-engage",
      reason: `No inbound message in ${inboundDays} days — relationship may be cooling`,
      suggestedActionType: "send_email",
      suggestedActionLabel: "Send a re-engagement email",
      priority: "medium",
      suggestedDueDays: 3,
    });
  }

  // 9. Health at risk
  if (healthLabel === "At Risk") {
    signals.push({
      signalType: "health_at_risk",
      severity: "medium",
      title: "Schedule a reconnect",
      reason: "Relationship health is At Risk — a personal touchpoint is needed soon",
      suggestedActionType: "schedule_meeting",
      suggestedActionLabel: "Schedule a meeting",
      priority: "medium",
      suggestedDueDays: 5,
    });
  }

  // 10. No inbound in 14–29 days
  if (inboundDays !== null && inboundDays >= 14 && inboundDays < 30) {
    signals.push({
      signalType: "no_inbound_14d",
      severity: "low",
      title: "Follow up on last conversation",
      reason: `No inbound message in ${inboundDays} days`,
      suggestedActionType: "send_email",
      suggestedActionLabel: "Send a follow-up email",
      priority: "low",
      suggestedDueDays: 5,
    });
  }

  // 11. Health cooling
  if (healthLabel === "Cooling") {
    signals.push({
      signalType: "health_cooling",
      severity: "low",
      title: "Log a relationship update",
      reason: "Relationship health is cooling — add a note to stay current",
      suggestedActionType: "add_note",
      suggestedActionLabel: "Add a quick note",
      priority: "low",
      suggestedDueDays: 7,
    });
  }

  // Deduplicate by signalType (keep first occurrence)
  const seen = new Set<string>();
  return signals.filter((s) => {
    if (seen.has(s.signalType)) return false;
    seen.add(s.signalType);
    return true;
  });
}

// The COOLDOWN_DAYS values control when a suppressed suggestion re-surfaces
export const COOLDOWN_DAYS = {
  dismissed: 7,
  accepted: 3,
} as const;
