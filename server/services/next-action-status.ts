/**
 * next-action-status.ts
 *
 * Pure, side-effect-free status derivation for the Next Action system.
 * No database access. No imports with side-effects.
 * All inputs are explicit. Tests replicate these functions inline.
 *
 * Ten states (locked visual contract for Run 2):
 *   NEVER_CONTACTED   gray solid      — never had any communication
 *   UNKNOWN           gray hollow     — no comm data available
 *   NO_ACTION         green solid     — open action exists but nothing is pending
 *   SCHEDULED         amber hollow    — VoltSafe action due in the future
 *   DUE               amber solid     — VoltSafe action due today or overdue ≤ critical threshold
 *   CRITICAL          red solid       — VoltSafe action overdue > critical threshold
 *   WAITING_CUSTOMER  blue solid      — waiting on customer, within nudge window
 *   CUSTOMER_NUDGE_DUE blue hollow    — waiting on customer, nudge window elapsed
 *   BLOCKED           slate solid     — action has a blocker
 *   SNOOZED           gray hollow     — action is snoozed until future date
 */

export type NextActionStatus =
  | 'NEVER_CONTACTED'
  | 'UNKNOWN'
  | 'NO_ACTION'
  | 'SCHEDULED'
  | 'DUE'
  | 'CRITICAL'
  | 'WAITING_CUSTOMER'
  | 'CUSTOMER_NUDGE_DUE'
  | 'BLOCKED'
  | 'SNOOZED';

export interface OpenAction {
  waitingOn:     'voltsafe' | 'customer';
  waitingSinceAt: Date;
  dueAt:          Date | null;
  blocker:        string | null;
  snoozedUntil:   Date | null;
}

export interface StatusInput {
  /** The single open next_action row, or null if none exists. */
  openAction:             OpenAction | null;
  /**
   * Whether the lead/account has ever had a meaningful communication.
   * true  = reliable evidence of contact
   * false = reliable evidence of NO contact (e.g. lead_comms_summary shows no record)
   * null  = unknown / insufficient data (Accounts without a comm summary)
   */
  hasEverContacted:       true | false | null;
  now:                    Date;
  customerWaitNudgeDays:  number;   // from org_settings.customer_wait_nudge_days
  criticalOverdueDays:    number;   // from org_settings.critical_overdue_days
  orgTimezone:            string;   // from org_settings.org_timezone (e.g. 'America/Vancouver')
}

export interface StatusResult {
  status:   NextActionStatus;
  /** Calendar days relevant to the state (overdue days, waiting days, etc.). Null when not applicable. */
  days:     number | null;
  /** The timestamp that most directly drives the state (for display + sorting). */
  relevantAt: Date | null;
}

// ── Calendar-day helpers ──────────────────────────────────────────────────────

/**
 * Return the local calendar date components for a timestamp in a given IANA timezone.
 * Uses Intl.DateTimeFormat — correctly handles DST spring-forward and fall-back.
 */
function localDateComponents(d: Date, tz: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year:  'numeric',
    month: '2-digit',
    day:   '2-digit',
  }).formatToParts(d);
  return {
    year:  parseInt(parts.find(p => p.type === 'year')!.value,  10),
    month: parseInt(parts.find(p => p.type === 'month')!.value, 10),
    day:   parseInt(parts.find(p => p.type === 'day')!.value,   10),
  };
}

/**
 * Convert a local calendar date (in a given timezone) to a UTC-noon Date for
 * arithmetic purposes. Using noon avoids any edge case with UTC midnight crossing
 * DST boundaries when doing subtraction.
 */
function localDateToUtcNoon(d: Date, tz: string): Date {
  const { year, month, day } = localDateComponents(d, tz);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

/**
 * Count calendar days between two timestamps, using local calendar dates in the
 * given timezone. A positive result means `to` is after `from`.
 *
 * DST-safe: compares calendar date ordinals, not elapsed milliseconds.
 * March 9 → March 11 in America/Vancouver is always 2 calendar days even if
 * the spring-forward wall-clock gap is 47 hours.
 */
export function calendarDaysBetween(from: Date, to: Date, tz: string): number {
  const fromNoon = localDateToUtcNoon(from, tz);
  const toNoon   = localDateToUtcNoon(to,   tz);
  return Math.round((toNoon.getTime() - fromNoon.getTime()) / 86_400_000);
}

// ── Main derivation ───────────────────────────────────────────────────────────

/**
 * Derive the next-action status from explicit inputs.
 * Pure function — no side effects, no database access.
 * Evaluation order matches the spec exactly.
 */
export function deriveNextActionStatus(input: StatusInput): StatusResult {
  const { openAction, hasEverContacted, now, customerWaitNudgeDays, criticalOverdueDays, orgTimezone } = input;

  // ── Open action exists ────────────────────────────────────────────────────
  if (openAction !== null) {
    const { waitingOn, waitingSinceAt, dueAt, blocker, snoozedUntil } = openAction;

    // 1. Snoozed (takes precedence if snooze is still active)
    if (snoozedUntil !== null && snoozedUntil > now) {
      return { status: 'SNOOZED', days: null, relevantAt: snoozedUntil };
    }
    // (expired snooze falls through to normal derivation below)

    // 2. Blocked
    if (blocker !== null && blocker.trim() !== '') {
      return { status: 'BLOCKED', days: null, relevantAt: null };
    }

    // 3. Waiting on customer
    if (waitingOn === 'customer') {
      const daysSinceCustomerWait = calendarDaysBetween(waitingSinceAt, now, orgTimezone);
      if (daysSinceCustomerWait > customerWaitNudgeDays) {
        return { status: 'CUSTOMER_NUDGE_DUE', days: daysSinceCustomerWait, relevantAt: waitingSinceAt };
      }
      return { status: 'WAITING_CUSTOMER', days: daysSinceCustomerWait, relevantAt: waitingSinceAt };
    }

    // 4. Waiting on VoltSafe
    if (waitingOn === 'voltsafe') {
      if (dueAt === null) {
        // NULL due_at = immediately due
        return { status: 'DUE', days: 0, relevantAt: null };
      }
      const daysOverdue = calendarDaysBetween(dueAt, now, orgTimezone);
      if (daysOverdue < 0) {
        // due date is in the future
        return { status: 'SCHEDULED', days: -daysOverdue, relevantAt: dueAt };
      }
      // Due today = 0 overdue days → DUE
      // Overdue 1..criticalOverdueDays → DUE
      if (daysOverdue <= criticalOverdueDays) {
        return { status: 'DUE', days: daysOverdue, relevantAt: dueAt };
      }
      // Overdue > criticalOverdueDays → CRITICAL
      return { status: 'CRITICAL', days: daysOverdue, relevantAt: dueAt };
    }
  }

  // ── No open action ────────────────────────────────────────────────────────
  // 5. hasEverContacted = false → never contacted
  if (hasEverContacted === false) {
    return { status: 'NEVER_CONTACTED', days: null, relevantAt: null };
  }

  // 6. hasEverContacted = null → unknown (cannot safely say NO_ACTION)
  if (hasEverContacted === null) {
    return { status: 'UNKNOWN', days: null, relevantAt: null };
  }

  // 7. Has been contacted, no open action
  return { status: 'NO_ACTION', days: null, relevantAt: null };
}

// ── Smart Priority ────────────────────────────────────────────────────────────

/** Ordinal bucket for Smart Priority sorting. Lower bucket = higher priority. */
export const STATUS_BUCKET: Record<NextActionStatus, number> = {
  CRITICAL:           1,
  DUE:                2,
  CUSTOMER_NUDGE_DUE: 3,
  NEVER_CONTACTED:    4,
  SCHEDULED:          5,
  WAITING_CUSTOMER:   6,
  BLOCKED:            7,
  SNOOZED:            8,
  UNKNOWN:            9,
  NO_ACTION:          10,
};

const MANUAL_PRIORITY_RANK: Record<string, number> = {
  high:   1,
  medium: 2,
  low:    3,
};

const FIT_RANK: Record<string, number> = {
  high:   1,
  medium: 2,
  low:    3,
};

export interface SmartPriorityInput {
  status:          NextActionStatus;
  dueAt:           Date | null;
  /**
   * DB column waiting_since_at is NOT NULL (DEFAULT NOW()) — trigger always populates it.
   * Type is Date (non-nullable). No open row can have both dueAt=null AND waitingSinceAt=null.
   */
  waitingSinceAt:  Date;
  /** Retained for backward compat. NOT used in due-date ordering (spec §4). */
  createdAt:       Date;
  manualPriority:  'high' | 'medium' | 'low' | null;
  primaryValue:    number | null;
  fit:             'high' | 'medium' | 'low' | null;
  id:              number;
  /** For overdueCalendarDays computation. Defaults to new Date() if omitted. */
  now?:            Date;
  /** For DST-safe calendar day arithmetic. Defaults to 'America/Vancouver' if omitted. */
  orgTimezone?:    string;
}

export interface SmartPriorityResult {
  /** 1–10 ordinal bucket (1 = highest urgency). */
  bucket:              number;
  /** Timestamp most relevant to this state, for display and tie-breaking. */
  relevantTimestamp:   Date | null;
  /**
   * Effective due timestamp for tie-breaking within DUE bucket.
   * = dueAt ?? waitingSinceAt ?? null
   * createdAt is NOT used (spec §4: "createdAt has no effect on due ordering").
   * null-due action waiting 10 days → effectiveDueAt=10-days-ago → sorts FIRST (most urgent).
   * null-due action waiting 0 days  → effectiveDueAt=today        → sorts LAST within DUE bucket.
   * null means both dueAt and waitingSinceAt are null (treated as Infinity in sort).
   */
  effectiveDueAt:      Date | null;
  /**
   * Which field supplied effectiveDueAt.
   * 'dueAt'        — explicit due date was set
   * 'waitingSinceAt' — no due date; urgency derived from how long it has been waiting
   * null           — both dueAt and waitingSinceAt are null
   */
  effectiveDueSource:  'dueAt' | 'waitingSinceAt' | null;
  /**
   * Positive calendar days since effectiveDueAt; null if not yet due or no effectiveDueAt.
   * Computed using DST-safe calendar arithmetic in orgTimezone.
   */
  overdueCalendarDays: number | null;
  manualPriorityRank:  number;  // 1=high, 2=medium, 3=low, 4=unset
  value:               number;  // higher = higher priority (negated for sort)
  fitRank:             number;  // 1=high, 2=medium, 3=low, 4=unset
  id:                  number;
}

/**
 * Compute the Smart Priority sort key for a single record.
 * Pass all results to sortSmartPriority() to get a deterministic ordered list.
 */
export function computeSmartPriority(input: SmartPriorityInput): SmartPriorityResult {
  const bucket = STATUS_BUCKET[input.status];
  const now         = input.now         ?? new Date();
  const orgTimezone = input.orgTimezone ?? 'America/Vancouver';

  // effectiveDueAt = dueAt ?? waitingSinceAt  (spec §4; DB guarantees waitingSinceAt NOT NULL)
  // createdAt is intentionally NOT used — "createdAt has no effect on due ordering."
  // null-due action waiting 10d → effectiveDueAt=10d-ago → sorts FIRST (most urgent within DUE)
  // null-due action waiting 0d  → effectiveDueAt=today   → sorts LAST within DUE bucket
  // The ?? null fallback is removed: waitingSinceAt is DB NOT NULL, type is Date (never null).
  const effectiveDueAt: Date = input.dueAt ?? input.waitingSinceAt;
  const effectiveDueSource: 'dueAt' | 'waitingSinceAt' =
    input.dueAt !== null ? 'dueAt' : 'waitingSinceAt';

  // overdueCalendarDays: positive integer if effectiveDueAt is in the past; null otherwise.
  let overdueCalendarDays: number | null = null;
  if (effectiveDueAt !== null) {
    const days = calendarDaysBetween(effectiveDueAt, now, orgTimezone);
    overdueCalendarDays = days > 0 ? days : null;
  }

  // Relevant timestamp — the timestamp that most directly drives urgency.
  // For DUE/CRITICAL: use effectiveDueAt (not raw dueAt which may be null).
  // Null dueAt → immediately due → createdAt is used → sorts FIRST within bucket (ascending).
  let relevantTimestamp: Date | null = null;
  if (input.status === 'DUE' || input.status === 'CRITICAL') {
    relevantTimestamp = effectiveDueAt;
  } else if (input.status === 'SCHEDULED') {
    relevantTimestamp = input.dueAt; // always non-null for SCHEDULED
  } else if (input.status === 'WAITING_CUSTOMER' || input.status === 'CUSTOMER_NUDGE_DUE') {
    relevantTimestamp = input.waitingSinceAt;
  } else if (input.status === 'SNOOZED') {
    relevantTimestamp = null; // snoozed_until is not in SmartPriorityInput; caller may add
  }

  return {
    bucket,
    relevantTimestamp,
    effectiveDueAt,
    effectiveDueSource,
    overdueCalendarDays,
    manualPriorityRank: MANUAL_PRIORITY_RANK[input.manualPriority ?? ''] ?? 4,
    value:              input.primaryValue ?? 0,
    fitRank:            FIT_RANK[input.fit ?? ''] ?? 4,
    id:                 input.id,
  };
}

/**
 * Compare two SmartPriorityResult objects.
 * Returns negative if a sorts before b (a is higher priority).
 *
 * Tie-break order:
 *   1. bucket ASC
 *   2. relevant timestamp ASC (null sorts last within bucket)
 *   3. effectiveDueAt ASC (null due → createdAt → sorts first)
 *   4. manualPriorityRank ASC (1=high first)
 *   5. value DESC (higher value first)
 *   6. fitRank ASC (1=high first)
 *   7. id ASC (stable)
 */
export function compareSmartPriority(a: SmartPriorityResult, b: SmartPriorityResult): number {
  if (a.bucket !== b.bucket) return a.bucket - b.bucket;

  // Tie-break 1: relevant timestamp ASC, nulls last
  const aTs = a.relevantTimestamp?.getTime() ?? Infinity;
  const bTs = b.relevantTimestamp?.getTime() ?? Infinity;
  if (aTs !== bTs) return aTs - bTs;

  // Tie-break 2: effectiveDueAt ASC (never null — waitingSinceAt always fills in)
  const aDue = a.effectiveDueAt.getTime();
  const bDue = b.effectiveDueAt.getTime();
  if (aDue !== bDue) return aDue - bDue;

  // Tie-break 3: manual priority rank ASC
  if (a.manualPriorityRank !== b.manualPriorityRank) return a.manualPriorityRank - b.manualPriorityRank;

  // Tie-break 4: value DESC
  if (a.value !== b.value) return b.value - a.value;

  // Tie-break 5: fit rank ASC
  if (a.fitRank !== b.fitRank) return a.fitRank - b.fitRank;

  // Tie-break 6: stable ID ASC
  return a.id - b.id;
}

/** Sort an array of SmartPriorityResult in Smart Priority order (mutates in place). */
export function sortSmartPriority(results: SmartPriorityResult[]): SmartPriorityResult[] {
  return results.sort(compareSmartPriority);
}
