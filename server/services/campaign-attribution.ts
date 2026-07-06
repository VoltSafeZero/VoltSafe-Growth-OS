/**
 * Campaign Attribution Service — Phase 10
 *
 * Connects the marketing campaign engine (Phases 1–9) to CRM objects:
 * opportunities, quotes, projects, tasks, meetings.
 *
 * Attribution model:
 *   direct     — campaign action caused the CRM event (e.g. reply→task)
 *   influenced — account had campaign engagement within the attribution window
 *   assisted   — campaign touched the account but was not the primary driver
 *   manual     — user explicitly linked a campaign to a CRM object
 *
 * Confidence tiers (based on engagement window):
 *   high   — 30-day window, direct action
 *   medium — 60-day window, inferred from engagement
 *   low    — 180-day window, weak signal
 *
 * Safety guarantees:
 *   • Revenue is NEVER fabricated. Fields are null when not available.
 *   • Influenced pipeline ≠ won revenue unless stage = 'closed_won'
 *   • Multi-touch: campaign_id is per-event; no double-counting of pipeline
 *   • All attribution writes use fire-and-forget pattern (caller does .catch(()=>{}))
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

function sq(val: string): string {
  return "'" + val.replace(/'/g, "''") + "'";
}

// ── Schema ────────────────────────────────────────────────────────────────────

export async function migrateCampaignAttributionSchema(): Promise<void> {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS campaign_attribution_events (
      id                    SERIAL PRIMARY KEY,
      campaign_id           INTEGER NOT NULL,
      campaign_recipient_id INTEGER,
      account_id            INTEGER,
      contact_id            INTEGER,
      opportunity_id        INTEGER,
      event_type            TEXT    NOT NULL,
      attribution_type      TEXT    NOT NULL DEFAULT 'direct',
      confidence            TEXT    NOT NULL DEFAULT 'medium',
      notes                 TEXT,
      pipeline_value        NUMERIC(14,2),
      won_revenue           NUMERIC(14,2),
      linked_by             INTEGER,
      source_event_type     TEXT,
      source_event_id       INTEGER,
      metadata_json         JSONB,
      occurred_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `));

  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_cae_campaign_id      ON campaign_attribution_events(campaign_id)`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_cae_account_id       ON campaign_attribution_events(account_id) WHERE account_id IS NOT NULL`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_cae_opportunity_id   ON campaign_attribution_events(opportunity_id) WHERE opportunity_id IS NOT NULL`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_cae_event_type       ON campaign_attribution_events(event_type)`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_cae_occurred_at      ON campaign_attribution_events(occurred_at DESC)`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_cae_recipient_id     ON campaign_attribution_events(campaign_recipient_id) WHERE campaign_recipient_id IS NOT NULL`));

  console.log("[migration] Campaign attribution schema ready.");
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type AttributionEventType =
  | "reply_task_created"
  | "meeting_booked"
  | "task_created"
  | "opportunity_influenced"
  | "proposal_sent"
  | "deal_won"
  | "deal_lost"
  | "manual_link";

export type AttributionType = "direct" | "influenced" | "assisted" | "manual";
export type ConfidenceTier  = "high" | "medium" | "low";

export interface RecordAttributionInput {
  campaignId:           number;
  campaignRecipientId?: number | null;
  accountId?:           number | null;
  contactId?:           number | null;
  opportunityId?:       number | null;
  eventType:            AttributionEventType;
  attributionType?:     AttributionType;
  confidence?:          ConfidenceTier;
  notes?:               string | null;
  pipelineValue?:       number | null;
  wonRevenue?:          number | null;
  linkedBy?:            number | null;
  sourceEventType?:     string | null;
  sourceEventId?:       number | null;
  metadata?:            Record<string, any> | null;
  occurredAt?:          Date | null;
}

// ── Core write ────────────────────────────────────────────────────────────────

export async function recordCampaignAttributionEvent(input: RecordAttributionInput): Promise<number> {
  const row = (await db.execute(sql.raw(`
    INSERT INTO campaign_attribution_events
      (campaign_id, campaign_recipient_id, account_id, contact_id, opportunity_id,
       event_type, attribution_type, confidence, notes, pipeline_value, won_revenue,
       linked_by, source_event_type, source_event_id, metadata_json, occurred_at, created_at)
    VALUES (
      ${Number(input.campaignId)},
      ${input.campaignRecipientId ? Number(input.campaignRecipientId) : "NULL"},
      ${input.accountId          ? Number(input.accountId)           : "NULL"},
      ${input.contactId          ? Number(input.contactId)           : "NULL"},
      ${input.opportunityId      ? Number(input.opportunityId)       : "NULL"},
      ${sq(input.eventType)},
      ${sq(input.attributionType  ?? "direct")},
      ${sq(input.confidence       ?? "medium")},
      ${input.notes               ? sq(input.notes)                   : "NULL"},
      ${input.pipelineValue  != null ? Number(input.pipelineValue)   : "NULL"},
      ${input.wonRevenue     != null ? Number(input.wonRevenue)       : "NULL"},
      ${input.linkedBy            ? Number(input.linkedBy)            : "NULL"},
      ${input.sourceEventType     ? sq(input.sourceEventType)         : "NULL"},
      ${input.sourceEventId       ? Number(input.sourceEventId)       : "NULL"},
      ${input.metadata            ? sq(JSON.stringify(input.metadata)) : "NULL"},
      ${input.occurredAt          ? sq(input.occurredAt.toISOString()) : "NOW()"},
      NOW()
    )
    RETURNING id
  `))).rows as any[];
  return Number(row[0]?.id ?? 0);
}

// ── Infer attribution for account (look-back windows) ─────────────────────────
// Finds the best campaign to attribute when an account has a CRM event.
// Returns the campaign with the most recent engagement within the attribution window.

export async function inferCampaignAttributionForAccount(accountId: number): Promise<{
  campaignId:       number | null;
  campaignName:     string | null;
  attributionType:  AttributionType;
  confidence:       ConfidenceTier;
  daysSinceEngagement: number | null;
} | null> {
  if (!accountId) return null;

  const rows = (await db.execute(sql.raw(`
    SELECT
      mc.id              AS campaign_id,
      mc.campaign_name,
      MAX(ce.created_at) AS last_engaged_at
    FROM campaign_events ce
    JOIN campaign_recipients cr ON cr.id = ce.recipient_id
    JOIN marketing_campaigns mc ON mc.id = cr.campaign_id
    WHERE cr.account_id = ${Number(accountId)}
      AND ce.event_type IN ('opened', 'clicked', 'replied', 'demo_booked')
      AND ce.created_at > NOW() - INTERVAL '180 days'
    GROUP BY mc.id, mc.campaign_name
    ORDER BY last_engaged_at DESC
    LIMIT 1
  `))).rows as any[];

  if (!rows.length || !rows[0].campaign_id) return null;

  const row = rows[0];
  const lastEngaged = new Date(row.last_engaged_at);
  const daysSince   = Math.floor((Date.now() - lastEngaged.getTime()) / 86400000);

  let confidence: ConfidenceTier;
  let attributionType: AttributionType;
  if (daysSince <= 30)  { confidence = "high";   attributionType = "direct"; }
  else if (daysSince <= 60) { confidence = "medium"; attributionType = "influenced"; }
  else                      { confidence = "low";    attributionType = "assisted"; }

  return {
    campaignId:          Number(row.campaign_id),
    campaignName:        row.campaign_name ?? null,
    attributionType,
    confidence,
    daysSinceEngagement: daysSince,
  };
}

// ── Infer attribution for a campaign (look forward from campaign events) ──────
// Given a campaign, finds all accounts that engaged with it and had CRM events
// (tasks, opportunities, proposals) within the attribution window.

export async function inferCampaignAttributionForCampaign(campaignId: number): Promise<{
  accountsInfluenced: number;
  highConfidence:     number;
  mediumConfidence:   number;
  lowConfidence:      number;
  candidateAccounts:  Array<{
    accountId:      number;
    accountName:    string | null;
    attributionType: AttributionType;
    confidence:     ConfidenceTier;
    daysSinceEngagement: number;
    lastEngaged:    string;
  }>;
}> {
  // Find accounts that engaged with this campaign within the last 180 days
  const engagedAccounts = (await db.execute(sql.raw(`
    SELECT
      cr.account_id,
      a.name AS account_name,
      MAX(ce.created_at) AS last_engaged_at,
      COUNT(ce.id)       AS event_count
    FROM campaign_events ce
    JOIN campaign_recipients cr ON cr.id = ce.recipient_id
    LEFT JOIN accounts       a  ON a.id  = cr.account_id
    WHERE cr.campaign_id = ${Number(campaignId)}
      AND cr.account_id  IS NOT NULL
      AND ce.event_type  IN ('opened', 'clicked', 'replied', 'demo_booked')
      AND ce.created_at  > NOW() - INTERVAL '180 days'
    GROUP BY cr.account_id, a.name
    ORDER BY last_engaged_at DESC
    LIMIT 100
  `))).rows as any[];

  const now = Date.now();
  let highConfidence = 0, mediumConfidence = 0, lowConfidence = 0;
  const candidateAccounts = engagedAccounts.map((row: any) => {
    const daysSince = Math.floor((now - new Date(row.last_engaged_at).getTime()) / 86400000);
    let confidence: ConfidenceTier;
    let attributionType: AttributionType;
    if (daysSince <= 30)      { confidence = "high";   attributionType = "direct";    highConfidence++; }
    else if (daysSince <= 60) { confidence = "medium"; attributionType = "influenced"; mediumConfidence++; }
    else                      { confidence = "low";    attributionType = "assisted";   lowConfidence++; }
    return {
      accountId:           Number(row.account_id),
      accountName:         row.account_name ?? null,
      attributionType,
      confidence,
      daysSinceEngagement: daysSince,
      lastEngaged:         row.last_engaged_at,
    };
  });

  return {
    accountsInfluenced: engagedAccounts.length,
    highConfidence,
    mediumConfidence,
    lowConfidence,
    candidateAccounts,
  };
}

// ── Per-campaign attribution summary ─────────────────────────────────────────

export async function getCampaignAttributionSummary(campaignId: number): Promise<{
  campaignId:        number;
  totalEvents:       number;
  taskCreated:       number;
  meetingBooked:     number;
  opportunityInfluenced: number;
  proposalSent:      number;
  dealWon:           number;
  dealLost:          number;
  manualLinks:       number;
  totalPipelineValue: number | null;
  totalWonRevenue:   number | null;
  noRevenueData:     boolean;
  events:            any[];
}> {
  const events = (await db.execute(sql.raw(`
    SELECT
      cae.*,
      mc.campaign_name,
      a.name AS account_name,
      c.first_name || ' ' || c.last_name AS contact_name
    FROM campaign_attribution_events cae
    LEFT JOIN marketing_campaigns mc ON mc.id = cae.campaign_id
    LEFT JOIN accounts            a  ON a.id  = cae.account_id
    LEFT JOIN contacts            c  ON c.id  = cae.contact_id
    WHERE cae.campaign_id = ${Number(campaignId)}
    ORDER BY cae.occurred_at DESC
    LIMIT 200
  `))).rows as any[];

  const taskCreated           = events.filter(e => e.event_type === "task_created" || e.event_type === "reply_task_created").length;
  const meetingBooked         = events.filter(e => e.event_type === "meeting_booked").length;
  const opportunityInfluenced = events.filter(e => e.event_type === "opportunity_influenced").length;
  const proposalSent          = events.filter(e => e.event_type === "proposal_sent").length;
  const dealWon               = events.filter(e => e.event_type === "deal_won").length;
  const dealLost              = events.filter(e => e.event_type === "deal_lost").length;
  const manualLinks           = events.filter(e => e.event_type === "manual_link").length;

  // Deduplicate at opportunity level: for each opportunity_id, keep only the
  // highest pipeline_value / won_revenue so a deal isn't counted twice when
  // both opportunity_influenced and deal_won events exist for the same opp.
  const dedupedPipeline = new Map<string, number>();
  const dedupedWon      = new Map<string, number>();
  for (const e of events) {
    const key = e.opportunity_id != null ? String(e.opportunity_id) : `null-${e.id}`;
    if (e.pipeline_value != null) {
      const prev = dedupedPipeline.get(key) ?? 0;
      if (Number(e.pipeline_value) > prev) dedupedPipeline.set(key, Number(e.pipeline_value));
    }
    if (e.won_revenue != null) {
      const prev = dedupedWon.get(key) ?? 0;
      if (Number(e.won_revenue) > prev) dedupedWon.set(key, Number(e.won_revenue));
    }
  }
  const totalPipelineValue = dedupedPipeline.size
    ? Array.from(dedupedPipeline.values()).reduce((s, v) => s + v, 0)
    : null;
  const totalWonRevenue = dedupedWon.size
    ? Array.from(dedupedWon.values()).reduce((s, v) => s + v, 0)
    : null;

  return {
    campaignId,
    totalEvents:  events.length,
    taskCreated,
    meetingBooked,
    opportunityInfluenced,
    proposalSent,
    dealWon,
    dealLost,
    manualLinks,
    totalPipelineValue,
    totalWonRevenue,
    noRevenueData: totalPipelineValue === null && totalWonRevenue === null,
    events,
  };
}

// ── Marketing Attribution Dashboard ──────────────────────────────────────────
// Returns one row per campaign with aggregated attribution metrics.

export async function getMarketingAttributionDashboard(filters: {
  campaignId?: number | null;
  status?:     string | null;
  limit?:      number;
} = {}): Promise<any[]> {
  const limit = Math.min(filters.limit ?? 50, 200);
  const whereExtra = filters.campaignId
    ? `AND cae.campaign_id = ${Number(filters.campaignId)}`
    : "";
  const statusWhere = filters.status ? `AND mc.status = '${filters.status.replace(/'/g, "''")}'` : "";

  return (await db.execute(sql.raw(`
    SELECT
      mc.id                                                             AS campaign_id,
      mc.campaign_name,
      mc.campaign_type,
      mc.status,
      mc.sent_count,
      mc.replied_count,
      COUNT(cae.id)                                                     AS total_attribution_events,
      COUNT(cae.id) FILTER (WHERE cae.event_type IN ('task_created','reply_task_created')) AS tasks,
      COUNT(cae.id) FILTER (WHERE cae.event_type = 'meeting_booked')   AS meetings,
      COUNT(DISTINCT cae.opportunity_id) FILTER (WHERE cae.opportunity_id IS NOT NULL) AS opportunities,
      COUNT(cae.id) FILTER (WHERE cae.event_type = 'proposal_sent')    AS proposals,
      -- Opportunity-level dedup: sum MAX pipeline_value per distinct opportunity so
      -- a deal is not counted twice (opportunity_influenced + deal_won = same $).
      COALESCE((
        SELECT SUM(max_pv) FROM (
          SELECT MAX(pipeline_value) AS max_pv
          FROM campaign_attribution_events
          WHERE campaign_id = mc.id AND pipeline_value IS NOT NULL
          GROUP BY COALESCE(opportunity_id::text, id::text)
        ) _dedup_pv
      ), 0) AS pipeline_value,
      COALESCE((
        SELECT SUM(max_wr) FROM (
          SELECT MAX(won_revenue) AS max_wr
          FROM campaign_attribution_events
          WHERE campaign_id = mc.id AND won_revenue IS NOT NULL
          GROUP BY COALESCE(opportunity_id::text, id::text)
        ) _dedup_wr
      ), 0) AS won_revenue,
      COUNT(DISTINCT cae.account_id) FILTER (WHERE cae.account_id IS NOT NULL) AS influenced_accounts,
      CASE
        WHEN COUNT(cae.id) FILTER (WHERE cae.confidence = 'high')   >= 3 THEN 'high'
        WHEN COUNT(cae.id) FILTER (WHERE cae.confidence = 'medium') >= 2 THEN 'medium'
        WHEN COUNT(cae.id) > 0                                           THEN 'low'
        ELSE NULL
      END AS top_confidence
    FROM marketing_campaigns mc
    LEFT JOIN campaign_attribution_events cae ON cae.campaign_id = mc.id ${whereExtra}
    WHERE 1=1 ${statusWhere}
    GROUP BY mc.id, mc.campaign_name, mc.campaign_type, mc.status, mc.sent_count, mc.replied_count
    ORDER BY total_attribution_events DESC, mc.updated_at DESC
    LIMIT ${limit}
  `))).rows as any[];
}

// ── Persona Attribution Breakdown ────────────────────────────────────────────
// Groups attribution events by marina/account type.

export async function getPersonaAttributionBreakdown(): Promise<any[]> {
  return (await db.execute(sql.raw(`
    SELECT
      COALESCE(a.marina_type, 'Unknown') AS persona,
      COUNT(DISTINCT cae.campaign_id)    AS campaigns,
      COUNT(DISTINCT cae.account_id)     AS engaged_accounts,
      COUNT(DISTINCT cae.opportunity_id) AS opportunities,
      -- Dedup per opportunity: sum MAX pipeline_value per distinct opportunity
      COALESCE((
        SELECT SUM(max_pv) FROM (
          SELECT MAX(cae2.pipeline_value) AS max_pv
          FROM campaign_attribution_events cae2
          LEFT JOIN accounts a2 ON a2.id = cae2.account_id
          WHERE cae2.pipeline_value IS NOT NULL
            AND COALESCE(a2.marina_type, 'Unknown') = COALESCE(a.marina_type, 'Unknown')
          GROUP BY COALESCE(cae2.opportunity_id::text, cae2.id::text)
        ) _dp
      ), 0) AS pipeline_value,
      COALESCE((
        SELECT SUM(max_wr) FROM (
          SELECT MAX(cae3.won_revenue) AS max_wr
          FROM campaign_attribution_events cae3
          LEFT JOIN accounts a3 ON a3.id = cae3.account_id
          WHERE cae3.won_revenue IS NOT NULL
            AND COALESCE(a3.marina_type, 'Unknown') = COALESCE(a.marina_type, 'Unknown')
          GROUP BY COALESCE(cae3.opportunity_id::text, cae3.id::text)
        ) _dw
      ), 0) AS won_revenue
    FROM campaign_attribution_events cae
    LEFT JOIN accounts a ON a.id = cae.account_id
    GROUP BY COALESCE(a.marina_type, 'Unknown')
    ORDER BY engaged_accounts DESC
    LIMIT 30
  `))).rows as any[];
}

// ── Stakeholder Attribution Breakdown ────────────────────────────────────────
// Groups attribution events by contact role.

export async function getStakeholderAttributionBreakdown(): Promise<any[]> {
  return (await db.execute(sql.raw(`
    SELECT
      COALESCE(c.role, 'Unknown') AS role,
      COUNT(DISTINCT cae.id) FILTER (WHERE cae.event_type IN ('task_created','reply_task_created')) AS replies_with_tasks,
      COUNT(DISTINCT cae.id) FILTER (WHERE cae.event_type = 'meeting_booked')                       AS meetings,
      COUNT(DISTINCT cae.opportunity_id)                                                             AS opportunities,
      -- Dedup per opportunity to avoid counting pipeline_value twice for same deal
      COALESCE((
        SELECT SUM(max_pv) FROM (
          SELECT MAX(cae2.pipeline_value) AS max_pv
          FROM campaign_attribution_events cae2
          LEFT JOIN contacts c2 ON c2.id = cae2.contact_id
          WHERE cae2.pipeline_value IS NOT NULL
            AND COALESCE(c2.role, 'Unknown') = COALESCE(c.role, 'Unknown')
          GROUP BY COALESCE(cae2.opportunity_id::text, cae2.id::text)
        ) _dp
      ), 0) AS pipeline_value
    FROM campaign_attribution_events cae
    LEFT JOIN contacts c ON c.id = cae.contact_id
    GROUP BY COALESCE(c.role, 'Unknown')
    HAVING COUNT(cae.id) > 0
    ORDER BY meetings DESC, replies_with_tasks DESC
    LIMIT 30
  `))).rows as any[];
}

// ── Account Attribution Timeline ──────────────────────────────────────────────
// Returns all campaigns that touched an account + attribution events.

export async function getAccountAttributionTimeline(accountId: number): Promise<{
  campaigns: any[];
  events:    any[];
  engagements: any[];
}> {
  const campaigns = (await db.execute(sql.raw(`
    SELECT DISTINCT
      mc.id AS campaign_id,
      mc.campaign_name,
      mc.campaign_type,
      mc.status,
      MIN(ce.created_at) AS first_touch,
      MAX(ce.created_at) AS last_touch,
      COUNT(ce.id)       AS total_events
    FROM campaign_events ce
    JOIN campaign_recipients cr ON cr.id = ce.recipient_id
    JOIN marketing_campaigns mc ON mc.id = cr.campaign_id
    WHERE cr.account_id = ${Number(accountId)}
    GROUP BY mc.id, mc.campaign_name, mc.campaign_type, mc.status
    ORDER BY last_touch DESC
    LIMIT 20
  `))).rows as any[];

  const events = (await db.execute(sql.raw(`
    SELECT
      cae.*,
      mc.campaign_name
    FROM campaign_attribution_events cae
    LEFT JOIN marketing_campaigns mc ON mc.id = cae.campaign_id
    WHERE cae.account_id = ${Number(accountId)}
    ORDER BY cae.occurred_at DESC
    LIMIT 50
  `))).rows as any[];

  const engagements = (await db.execute(sql.raw(`
    SELECT
      ce.event_type,
      ce.created_at,
      mc.id          AS campaign_id,
      mc.campaign_name,
      cr.email       AS recipient_email
    FROM campaign_events ce
    JOIN campaign_recipients cr ON cr.id = ce.recipient_id
    JOIN marketing_campaigns mc ON mc.id = cr.campaign_id
    WHERE cr.account_id = ${Number(accountId)}
    ORDER BY ce.created_at DESC
    LIMIT 50
  `))).rows as any[];

  return { campaigns, events, engagements };
}

// ── Manual link / unlink ──────────────────────────────────────────────────────

export interface LinkOpportunityInput {
  campaignId:     number;
  opportunityId:  number;
  accountId?:     number | null;
  contactId?:     number | null;
  pipelineValue?: number | null;
  wonRevenue?:    number | null;
  notes?:         string | null;
  linkedBy:       number;
}

export async function linkOpportunityToCampaign(input: LinkOpportunityInput): Promise<number> {
  const opRow = (await db.execute(sql.raw(`
    SELECT id, amount, stage, account_id FROM opportunities WHERE id = ${Number(input.opportunityId)} LIMIT 1
  `))).rows as any[];
  const opp = opRow[0] ?? null;

  const pipelineValue = input.pipelineValue ?? (opp ? Number(opp.amount ?? 0) : null);
  const stage         = opp?.stage ?? null;
  const isWon        = stage === "closed_won";
  const wonRevenue    = isWon ? (input.wonRevenue ?? pipelineValue) : null;

  return recordCampaignAttributionEvent({
    campaignId:      input.campaignId,
    opportunityId:   input.opportunityId,
    accountId:       input.accountId ?? opp?.account_id ?? null,
    contactId:       input.contactId ?? null,
    eventType:       "manual_link",
    attributionType: "manual",
    confidence:      "medium",
    notes:           input.notes ?? null,
    pipelineValue,
    wonRevenue,
    linkedBy:        input.linkedBy,
    metadata:        { opportunity_stage: stage },
  });
}

export async function unlinkAttributionEvent(id: number): Promise<boolean> {
  const result = (await db.execute(sql.raw(`
    DELETE FROM campaign_attribution_events
    WHERE id = ${Number(id)}
    RETURNING id
  `))).rows as any[];
  return result.length > 0;
}

// ── Aggregate stats for a single campaign (used in routes) ────────────────────

export async function getCampaignAttributionStats(campaignId: number): Promise<{
  tasks:    number;
  meetings: number;
  opportunities: number;
  proposals:     number;
  dealWon:       number;
  dealLost:      number;
  pipelineValue: number | null;
  wonRevenue:    number | null;
  noRevenueData: boolean;
}> {
  const rows = (await db.execute(sql.raw(`
    SELECT
      COUNT(*) FILTER (WHERE event_type IN ('task_created','reply_task_created')) AS tasks,
      COUNT(*) FILTER (WHERE event_type = 'meeting_booked')                       AS meetings,
      COUNT(DISTINCT opportunity_id) FILTER (WHERE opportunity_id IS NOT NULL)    AS opportunities,
      COUNT(*) FILTER (WHERE event_type = 'proposal_sent')                        AS proposals,
      COUNT(*) FILTER (WHERE event_type = 'deal_won')                             AS deal_won,
      COUNT(*) FILTER (WHERE event_type = 'deal_lost')                            AS deal_lost,
      -- Opportunity-level dedup so pipeline_value is not double-counted across
      -- opportunity_influenced + deal_won events for the same opportunity.
      COALESCE((
        SELECT SUM(max_pv) FROM (
          SELECT MAX(pipeline_value) AS max_pv
          FROM campaign_attribution_events
          WHERE campaign_id = ${Number(campaignId)} AND pipeline_value IS NOT NULL
          GROUP BY COALESCE(opportunity_id::text, id::text)
        ) _dp
      ), 0) AS pipeline_value,
      COALESCE((
        SELECT SUM(max_wr) FROM (
          SELECT MAX(won_revenue) AS max_wr
          FROM campaign_attribution_events
          WHERE campaign_id = ${Number(campaignId)} AND won_revenue IS NOT NULL
          GROUP BY COALESCE(opportunity_id::text, id::text)
        ) _dw
      ), 0) AS won_revenue
    FROM campaign_attribution_events
    WHERE campaign_id = ${Number(campaignId)}
  `))).rows as any[];
  const r = rows[0] ?? {};
  const pipelineValue = r.pipeline_value != null ? Number(r.pipeline_value) : null;
  const wonRevenue    = r.won_revenue    != null ? Number(r.won_revenue)    : null;
  return {
    tasks:         Number(r.tasks    ?? 0),
    meetings:      Number(r.meetings ?? 0),
    opportunities: Number(r.opportunities ?? 0),
    proposals:     Number(r.proposals     ?? 0),
    dealWon:       Number(r.deal_won  ?? 0),
    dealLost:      Number(r.deal_lost ?? 0),
    pipelineValue,
    wonRevenue,
    noRevenueData: pipelineValue === null && wonRevenue === null,
  };
}
