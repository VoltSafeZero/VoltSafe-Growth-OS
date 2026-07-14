import { pool } from "../db";

const BATCH_SIZE = 1000;

// Comm status CASE expression (used in queries)
// Priority: voltSafe_owes_reply > no_response > waiting_for_lead > dormant > recently_contacted > never_contacted
export const COMM_STATUS_CASE = `CASE
  WHEN lcs.last_incoming_at IS NOT NULL AND (lcs.last_outgoing_at IS NULL OR lcs.last_incoming_at > lcs.last_outgoing_at)
    THEN 'voltSafe_owes_reply'
  WHEN lcs.outgoing_count > 0 AND lcs.incoming_count = 0 AND lcs.last_outgoing_at < NOW() - INTERVAL '30 days'
    THEN 'no_response'
  WHEN lcs.last_outgoing_at IS NOT NULL AND (lcs.last_incoming_at IS NULL OR lcs.last_outgoing_at > lcs.last_incoming_at) AND lcs.last_outgoing_at >= NOW() - INTERVAL '30 days'
    THEN 'waiting_for_lead'
  WHEN lcs.last_comm_at IS NOT NULL AND lcs.last_comm_at < NOW() - INTERVAL '60 days'
    THEN 'dormant'
  WHEN lcs.last_comm_at IS NOT NULL
    THEN 'recently_contacted'
  ELSE 'never_contacted'
END`;

const UPSERT_SQL = `
  INSERT INTO lead_comms_summary (
    lead_id, last_outgoing_at, last_incoming_at, last_comm_at,
    outgoing_count, incoming_count, updated_at
  )
  SELECT
    l.id,
    MAX(CASE WHEN em.direction = 'outbound' THEN em.sent_at END),
    MAX(CASE WHEN em.direction = 'inbound' THEN em.sent_at END),
    MAX(em.sent_at),
    COUNT(CASE WHEN em.direction = 'outbound' THEN 1 END)::INTEGER,
    COUNT(CASE WHEN em.direction = 'inbound' THEN 1 END)::INTEGER,
    NOW()
  FROM leads l
  INNER JOIN email_messages em ON (
    (em.direction = 'outbound' AND em.to_emails ILIKE '%' || l.contact_email || '%')
    OR
    (em.direction = 'inbound' AND LOWER(em.from_email) = LOWER(l.contact_email))
  )
  WHERE l.id = ANY($1::int[])
    AND l.contact_email IS NOT NULL
    AND l.contact_email != ''
  GROUP BY l.id
  ON CONFLICT (lead_id) DO UPDATE SET
    last_outgoing_at = EXCLUDED.last_outgoing_at,
    last_incoming_at = EXCLUDED.last_incoming_at,
    last_comm_at = EXCLUDED.last_comm_at,
    outgoing_count = EXCLUDED.outgoing_count,
    incoming_count = EXCLUDED.incoming_count,
    updated_at = EXCLUDED.updated_at
`;

// Backfill all leads that have a contact_email.
// Runs as a fire-and-forget background job on startup.
export async function backfillLeadComms(): Promise<void> {
  try {
    const { rows } = await pool.query<{ id: number }>(`
      SELECT id FROM leads
      WHERE contact_email IS NOT NULL AND contact_email != ''
      ORDER BY id
    `);

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
