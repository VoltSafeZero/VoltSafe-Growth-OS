/**
 * account-heat-score.ts
 *
 * Computes a composite 0-100 heat score for CRM accounts from five engagement
 * dimensions:
 *   1. Email engagement    (emailTrackingPixels / emailEngagementEvents)
 *   2. Campaign engagement (campaignRecipients / campaignEvents)
 *   3. Activity recency    (activities)
 *   4. Opportunity momentum (opportunities)
 *   5. Composite heat score (weighted blend of the above)
 *
 * ── Safety guarantee ──────────────────────────────────────────────────────────
 * All queries use Drizzle ORM typed selects — NOT db.execute(sql.raw(...)).
 * Any column rename in shared/schema.ts causes a TypeScript compile error here
 * rather than silently returning wrong numbers at runtime.
 *
 * Call validateHeatScoreSchema() once at server startup (see routes.ts).
 * If a required table is absent from the live database the affected dimension
 * is marked unavailable and excluded from the composite with an explicit
 * console.error — it is never silently zeroed.
 */

import { db } from "../db";
import { eq, and, gte, inArray } from "drizzle-orm";
import {
  contacts,
  activities,
  opportunities,
  emailTrackingPixels,
  emailEngagementEvents,
  campaignRecipients,
  campaignEvents,
} from "@shared/schema";

// ─── Scoring weights ─────────────────────────────────────────────────────────
const W_EMAIL_OPEN   = 2;
const W_EMAIL_CLICK  = 5;
const W_EMAIL_REPLY  = 10;
const W_CAMP_OPEN    = 1;
const W_CAMP_CLICK   = 3;
const W_ACTIVITY     = 4;
const W_OPP_ACTIVE   = 15;
const W_OPP_ADVANCED = 10; // stage ≥ proposal

const MAX_SCORE = 100;
const DEFAULT_WINDOW_DAYS = 90;

// Opportunity stages that earn the W_OPP_ADVANCED bonus
const ADVANCED_STAGES = new Set([
  "proposal",
  "negotiation",
  "closing",
  "won",
  "closed_won",
]);

// ─── Schema availability flags (populated by validateHeatScoreSchema) ─────────
const available: Record<
  "emailEngagement" | "campaignEngagement" | "activityRecency" | "opportunityMomentum",
  boolean
> = {
  emailEngagement:     true,
  campaignEngagement:  true,
  activityRecency:     true,
  opportunityMomentum: true,
};

// ─── Public types ─────────────────────────────────────────────────────────────

export interface DimensionScore {
  /** 0-100 normalised contribution to the composite */
  value: number;
  /** Raw weighted sum before normalisation */
  rawPoints: number;
  /** false when the underlying table was missing at startup or query failed */
  available: boolean;
  /** Set whenever available === false; explains why */
  unavailableReason?: string;
}

export interface AccountHeatScore {
  accountId: number;
  /** 0-100 composite */
  heatScore: number;
  band: "cold" | "warm" | "hot" | "critical";
  dimensions: {
    emailEngagement:     DimensionScore;
    campaignEngagement:  DimensionScore;
    activityRecency:     DimensionScore;
    opportunityMomentum: DimensionScore;
  };
  windowDays: number;
  computedAt: string;
}

// ─── Startup schema validation ────────────────────────────────────────────────

/**
 * Run once at server startup.
 *
 * Issues a LIMIT 0 Drizzle probe against each required table. Any table absent
 * from the live database causes a clear console.error and marks that dimension
 * unavailable for all subsequent computeAccountHeatScore calls.
 *
 * Safe to call multiple times; re-validates on every call.
 */
export async function validateHeatScoreSchema(): Promise<void> {
  type DimKey = keyof typeof available;

  const probes: Array<{
    dim: DimKey;
    label: string;
    probe: () => Promise<unknown>;
  }> = [
    {
      dim: "emailEngagement",
      label: "emailTrackingPixels + emailEngagementEvents",
      probe: async () => {
        // Typed selects — column renames break compilation before they break runtime
        await db
          .select({ id: emailTrackingPixels.id })
          .from(emailTrackingPixels)
          .limit(0);
        await db
          .select({ id: emailEngagementEvents.id })
          .from(emailEngagementEvents)
          .limit(0);
      },
    },
    {
      dim: "campaignEngagement",
      label: "campaignRecipients + campaignEvents",
      probe: async () => {
        await db
          .select({ id: campaignRecipients.id })
          .from(campaignRecipients)
          .limit(0);
        await db
          .select({ id: campaignEvents.id })
          .from(campaignEvents)
          .limit(0);
      },
    },
    {
      dim: "activityRecency",
      label: "activities",
      probe: async () => {
        await db
          .select({ id: activities.id })
          .from(activities)
          .limit(0);
      },
    },
    {
      dim: "opportunityMomentum",
      label: "opportunities",
      probe: async () => {
        await db
          .select({ id: opportunities.id })
          .from(opportunities)
          .limit(0);
      },
    },
  ];

  for (const { dim, label, probe } of probes) {
    try {
      await probe();
      available[dim] = true;
      console.log(`[heat-score] schema OK — dimension "${dim}" (${label})`);
    } catch (err: unknown) {
      available[dim] = false;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[heat-score] SCHEMA ERROR — dimension "${dim}" DISABLED. ` +
          `Required table(s) [${label}] not accessible in the live DB: ${msg}. ` +
          `Heat scores will exclude this dimension rather than returning silent zeros.`,
      );
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(n: number): number {
  return Math.max(0, Math.min(MAX_SCORE, Math.round(n)));
}

function windowStart(days: number): Date {
  return new Date(Date.now() - days * 24 * 3600 * 1000);
}

function toBand(score: number): AccountHeatScore["band"] {
  if (score >= 75) return "critical";
  if (score >= 50) return "hot";
  if (score >= 25) return "warm";
  return "cold";
}

function unavailableDimension(reason: string): DimensionScore {
  return { value: 0, rawPoints: 0, available: false, unavailableReason: reason };
}

// ─── Dimension 1: Email engagement ───────────────────────────────────────────

/**
 * Scores tracked email opens, clicks, and replies sent to contacts belonging to
 * this account within the window.
 *
 * Uses typed Drizzle selects — column renames in emailTrackingPixels or
 * emailEngagementEvents cause a TS compile error, not a silent wrong number.
 */
async function scoreEmailEngagement(
  accountId: number,
  windowDays: number,
): Promise<DimensionScore> {
  if (!available.emailEngagement) {
    return unavailableDimension(
      "emailTrackingPixels or emailEngagementEvents table missing at startup",
    );
  }

  try {
    const accountContacts = await db
      .select({ email: contacts.email })
      .from(contacts)
      .where(eq(contacts.accountId, accountId));

    const contactEmails = accountContacts
      .map((c) => c.email)
      .filter((e): e is string => !!e);

    if (contactEmails.length === 0) {
      return { value: 0, rawPoints: 0, available: true };
    }

    const since = windowStart(windowDays);

    const pixels = await db
      .select({
        trackingId: emailTrackingPixels.trackingId,
        isReplied:  emailTrackingPixels.isReplied,
      })
      .from(emailTrackingPixels)
      .where(
        and(
          inArray(emailTrackingPixels.recipientEmail, contactEmails),
          gte(emailTrackingPixels.createdAt, since),
        ),
      );

    if (pixels.length === 0) {
      return { value: 0, rawPoints: 0, available: true };
    }

    const trackingIds = pixels.map((p) => p.trackingId);
    const repliedCount = pixels.filter((p) => p.isReplied).length;

    const events = await db
      .select({ eventType: emailEngagementEvents.eventType })
      .from(emailEngagementEvents)
      .where(
        and(
          inArray(emailEngagementEvents.trackingId, trackingIds),
          eq(emailEngagementEvents.isBot, false),
          gte(emailEngagementEvents.occurredAt, since),
        ),
      );

    let rawPoints = repliedCount * W_EMAIL_REPLY;
    for (const ev of events) {
      if (ev.eventType === "open")  rawPoints += W_EMAIL_OPEN;
      if (ev.eventType === "click") rawPoints += W_EMAIL_CLICK;
    }

    // Normalise: 100 raw points maps to max score
    const value = clamp((rawPoints / 100) * MAX_SCORE);
    return { value, rawPoints, available: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[heat-score] emailEngagement query failed for account ${accountId}: ${msg}`,
    );
    return unavailableDimension(`query error: ${msg}`);
  }
}

// ─── Dimension 2: Campaign engagement ────────────────────────────────────────

/**
 * Scores campaign open/click events for this account's contacts within the window.
 *
 * Uses typed Drizzle selects on campaignRecipients + campaignEvents — both
 * defined in shared/schema.ts so any column rename is a TS compile error.
 */
async function scoreCampaignEngagement(
  accountId: number,
  windowDays: number,
): Promise<DimensionScore> {
  if (!available.campaignEngagement) {
    return unavailableDimension(
      "campaignRecipients or campaignEvents table missing at startup",
    );
  }

  try {
    const since = windowStart(windowDays);

    const recipients = await db
      .select({ id: campaignRecipients.id })
      .from(campaignRecipients)
      .where(
        and(
          eq(campaignRecipients.accountId, accountId),
          gte(campaignRecipients.createdAt, since),
        ),
      );

    if (recipients.length === 0) {
      return { value: 0, rawPoints: 0, available: true };
    }

    const recipientIds = recipients.map((r) => r.id);

    const events = await db
      .select({ eventType: campaignEvents.eventType })
      .from(campaignEvents)
      .where(
        and(
          inArray(campaignEvents.recipientId, recipientIds),
          gte(campaignEvents.occurredAt, since),
        ),
      );

    let rawPoints = 0;
    for (const ev of events) {
      if (ev.eventType === "open")  rawPoints += W_CAMP_OPEN;
      if (ev.eventType === "click") rawPoints += W_CAMP_CLICK;
    }

    // 50 raw points = max score
    const value = clamp((rawPoints / 50) * MAX_SCORE);
    return { value, rawPoints, available: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[heat-score] campaignEngagement query failed for account ${accountId}: ${msg}`,
    );
    return unavailableDimension(`query error: ${msg}`);
  }
}

// ─── Dimension 3: Activity recency ───────────────────────────────────────────

/**
 * Scores how recently and frequently activities have been logged for this account.
 */
async function scoreActivityRecency(
  accountId: number,
  windowDays: number,
): Promise<DimensionScore> {
  if (!available.activityRecency) {
    return unavailableDimension("activities table missing at startup");
  }

  try {
    const since = windowStart(windowDays);

    const rows = await db
      .select({ id: activities.id })
      .from(activities)
      .where(
        and(
          eq(activities.linkedObjectType, "account"),
          eq(activities.linkedObjectId, accountId),
          gte(activities.createdAt, since),
        ),
      );

    const rawPoints = rows.length * W_ACTIVITY;
    // 20 activities (80 pts) = max score
    const value = clamp((rawPoints / 80) * MAX_SCORE);
    return { value, rawPoints, available: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[heat-score] activityRecency query failed for account ${accountId}: ${msg}`,
    );
    return unavailableDimension(`query error: ${msg}`);
  }
}

// ─── Dimension 4: Opportunity momentum ───────────────────────────────────────

/**
 * Scores based on the presence and deal stage of open opportunities.
 */
async function scoreOpportunityMomentum(accountId: number): Promise<DimensionScore> {
  if (!available.opportunityMomentum) {
    return unavailableDimension("opportunities table missing at startup");
  }

  try {
    const opps = await db
      .select({ stage: opportunities.stage })
      .from(opportunities)
      .where(eq(opportunities.accountId, accountId));

    let rawPoints = 0;
    for (const opp of opps) {
      rawPoints += W_OPP_ACTIVE;
      if (ADVANCED_STAGES.has((opp.stage ?? "").toLowerCase())) {
        rawPoints += W_OPP_ADVANCED;
      }
    }

    // 75 raw points = max score (5 advanced opps)
    const value = clamp((rawPoints / 75) * MAX_SCORE);
    return { value, rawPoints, available: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[heat-score] opportunityMomentum query failed for account ${accountId}: ${msg}`,
    );
    return unavailableDimension(`query error: ${msg}`);
  }
}

// ─── Dimension 5 / Public API: Composite heat score ──────────────────────────

/**
 * Computes a composite 0-100 heat score for an account.
 *
 * Only available dimensions contribute to the composite weight pool, so adding
 * or removing tables never silently deflates scores — the remaining dimensions
 * are re-weighted proportionally.
 *
 * @param accountId   CRM account id
 * @param windowDays  Look-back window for time-bounded dimensions (default 90)
 */
export async function computeAccountHeatScore(
  accountId: number,
  windowDays = DEFAULT_WINDOW_DAYS,
): Promise<AccountHeatScore> {
  const [emailEngage, campaignEngage, activityRecency, oppMomentum] =
    await Promise.all([
      scoreEmailEngagement(accountId, windowDays),
      scoreCampaignEngagement(accountId, windowDays),
      scoreActivityRecency(accountId, windowDays),
      scoreOpportunityMomentum(accountId),
    ]);

  // Proportional weights — unavailable dimensions are excluded entirely so a
  // missing table never silently drags every account score toward zero.
  const weightMap: Array<[DimensionScore, number]> = [
    [emailEngage,     0.30],
    [campaignEngage,  0.20],
    [activityRecency, 0.25],
    [oppMomentum,     0.25],
  ];

  let weightedSum  = 0;
  let totalWeight  = 0;
  for (const [dim, w] of weightMap) {
    if (dim.available) {
      weightedSum += dim.value * w;
      totalWeight += w;
    }
  }

  const heatScore = totalWeight > 0 ? clamp(weightedSum / totalWeight) : 0;

  return {
    accountId,
    heatScore,
    band: toBand(heatScore),
    dimensions: {
      emailEngagement:     emailEngage,
      campaignEngagement:  campaignEngage,
      activityRecency:     activityRecency,
      opportunityMomentum: oppMomentum,
    },
    windowDays,
    computedAt: new Date().toISOString(),
  };
}
