import { pool } from "../db";

const BATCH_SIZE = 500;

// Display-only CASE for badge rendering (mutually exclusive, priority order).
// Filters use independent predicates — see storage.ts commStatus section.
// Priority: voltSafe_owes_reply > waiting_for_lead > dormant > never_contacted
export const COMM_STATUS_CASE = `CASE
  WHEN lcs.last_incoming_at IS NOT NULL AND (lcs.last_outgoing_at IS NULL OR lcs.last_incoming_at > lcs.last_outgoing_at)
    THEN 'voltSafe_owes_reply'
  WHEN lcs.last_outgoing_at IS NOT NULL AND (lcs.last_incoming_at IS NULL OR lcs.last_outgoing_at >= lcs.last_incoming_at)
    THEN 'waiting_for_lead'
  WHEN lcs.last_comm_at IS NOT NULL AND lcs.last_comm_at < NOW() - INTERVAL '60 days'
    THEN 'dormant'
  ELSE 'never_contacted'
END`;

// Unified UPSERT: aggregates from two sources via UNION so the same email
// is never double-counted.
//   Source A — email_messages matched via lead.contact_email (existing logic)
//   Source B — email_messages in threads directly linked to the lead
//              via email_threads.primary_lead_id
//
// Spam / trash messages are excluded from both sources.
// Draft / failed messages are excluded via the existing direction field
// (only 'inbound' / 'outbound' rows count; drafts are not flagged as either).
const UPSERT_SQL = `
WITH
email_matched AS (
  SELECT DISTINCT
    l.id   AS lead_id,
    em.id  AS msg_id,
    em.direction,
    em.sent_at
  FROM leads l
  INNER JOIN email_messages em ON (
    l.contact_email IS NOT NULL
    AND l.contact_email <> ''
    AND NOT COALESCE(em.is_spam,  false)
    AND NOT COALESCE(em.is_trash, false)
    AND (
      (em.direction = 'outbound' AND em.to_emails ILIKE '%' || l.contact_email || '%')
      OR
      (em.direction = 'inbound'  AND LOWER(em.from_email) = LOWER(l.contact_email))
    )
  )
  WHERE l.id = ANY($1::int[])
),
thread_linked AS (
  SELECT DISTINCT
    et.primary_lead_id AS lead_id,
    em.id              AS msg_id,
    em.direction,
    em.sent_at
  FROM email_threads et
  INNER JOIN email_messages em ON em.gmail_thread_id = et.gmail_thread_id
  WHERE et.primary_lead_id = ANY($1::int[])
    AND NOT COALESCE(em.is_spam,  false)
    AND NOT COALESCE(em.is_trash, false)
),
unified AS (
  SELECT lead_id, msg_id, direction, sent_at FROM email_matched
  UNION
  SELECT lead_id, msg_id, direction, sent_at FROM thread_linked
),
aggregated AS (
  SELECT
    lead_id,
    MAX(CASE WHEN direction = 'outbound' THEN sent_at END) AS last_outgoing_at,
    MAX(CASE WHEN direction = 'inbound'  THEN sent_at END) AS last_incoming_at,
    MAX(sent_at)                                           AS last_comm_at,
    COUNT(CASE WHEN direction = 'outbound' THEN 1 END)::INTEGER AS outgoing_count,
    COUNT(CASE WHEN direction = 'inbound'  THEN 1 END)::INTEGER AS incoming_count
  FROM unified
  GROUP BY lead_id
)
INSERT INTO lead_comms_summary
  (lead_id, last_outgoing_at, last_incoming_at, last_comm_at, outgoing_count, incoming_count, updated_at)
SELECT
  lead_id, last_outgoing_at, last_incoming_at, last_comm_at,
  outgoing_count, incoming_count, NOW()
FROM aggregated
ON CONFLICT (lead_id) DO UPDATE SET
  last_outgoing_at = EXCLUDED.last_outgoing_at,
  last_incoming_at = EXCLUDED.last_incoming_at,
  last_comm_at     = EXCLUDED.last_comm_at,
  outgoing_count   = EXCLUDED.outgoing_count,
  incoming_count   = EXCLUDED.incoming_count,
  updated_at       = EXCLUDED.updated_at
`;

// Backfill all leads. Runs as a fire-and-forget background job on startup.
export async function backfillLeadComms(): Promise<void> {
  try {
    const { rows } = await pool.query<{ id: number }>(`SELECT id FROM leads ORDER BY id`);
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return;

    console.log(`[lead-comms-sync] Backfilling ${ids.length} leads…`);
    let processed = 0;

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      await pool.query(UPSERT_SQL, [batch]);
      processed += batch.length;
    }

    console.log(`[lead-comms-sync] Backfill done — ${processed} leads processed.`);
  } catch (err) {
    console.error("[lead-comms-sync] Backfill error:", err);
  }
}

// Refresh the comm summary for a single lead (call after a new email is sent/received).
export async function refreshLeadComms(leadId: number): Promise<void> {
  try {
    await pool.query(UPSERT_SQL, [[leadId]]);
  } catch (err) {
    console.error(`[lead-comms-sync] Refresh error for lead ${leadId}:`, err);
  }
}

// ─── Admin rebuild endpoint helper ───────────────────────────────────────────
// Idempotent full rebuild from authoritative source data.
// Returns a progress/summary object. Safe to repeat.
export async function rebuildAllLeadComms(opts: { dryRun?: boolean; batchSize?: number } = {}): Promise<{
  total: number; withComms: number; neverContacted: number;
  changed: number; unchanged: number; failed: number; elapsedMs: number;
}> {
  const t0 = Date.now();
  const bsz = opts.batchSize ?? BATCH_SIZE;

  const { rows } = await pool.query<{ id: number }>(`SELECT id FROM leads ORDER BY id`);
  const ids = rows.map((r) => r.id);
  let withComms = 0; let failed = 0; let changed = 0;

  for (let i = 0; i < ids.length; i += bsz) {
    const batch = ids.slice(i, i + bsz);
    try {
      if (!opts.dryRun) {
        const result = await pool.query(UPSERT_SQL, [batch]);
        changed += result.rowCount ?? 0;
      }
    } catch (err) {
      console.error("[lead-comms-sync] Rebuild batch error:", err);
      failed += batch.length;
    }
  }

  const { rows: cRows } = await pool.query<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM lead_comms_summary WHERE last_comm_at IS NOT NULL`);
  withComms = parseInt(cRows[0]?.cnt ?? "0", 10);

  return {
    total: ids.length,
    withComms,
    neverContacted: ids.length - withComms,
    changed,
    unchanged: ids.length - changed - failed,
    failed,
    elapsedMs: Date.now() - t0,
  };
}
