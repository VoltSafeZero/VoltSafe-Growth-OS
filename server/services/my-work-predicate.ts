/**
 * my-work-predicate.ts
 *
 * Canonical "My Work" queue predicate for the Next Action system.
 *
 * A lead qualifies for the My Work queue when it passes ALL of:
 *   1. source IS DISTINCT FROM 'test_suite'  (exclude automated test fixtures)
 *   2. At least one active-work signal is present:
 *        a. Open next_action (status = 'open')
 *        b. Owner assigned (owner_user_id IS NOT NULL)
 *        c. Meaningful communication (lead_comms_summary: incoming > 0 OR outgoing > 0 OR last_comm_at set)
 *        d. Genuinely open linked task (status IN ('pending','todo','open')
 *                                       AND completed_at IS NULL
 *                                       AND dismissed_at IS NULL
 *                                       AND archived = false)
 *
 * What this predicate intentionally excludes:
 *   - CRM stage alone (status IN ('contacted','qualified',…) is NOT a signal)
 *   - email_threads.primary_lead_id  (lead_comms_summary is the approved comm source of truth)
 *   - done, completed, dismissed, or archived tasks
 *   - test_suite records regardless of other signals
 *
 * What it intentionally includes:
 *   - marina_directory and boating_ontario imported records that have active signals
 *     ("promoted marina-directory records")
 *
 * Usage (raw SQL fragment — safe to embed in parameterized queries):
 *
 *   const { whereSql } = myWorkPredicate();
 *   const rows = await db.execute(sql.raw(`
 *     SELECT id, company FROM leads
 *     ${whereSql}
 *     ORDER BY id LIMIT 50
 *   `));
 *
 * Do not duplicate this SQL across routes.  Import this helper instead.
 */

export const MY_WORK_PREDICATE_SQL = `
  source IS DISTINCT FROM 'test_suite'
  AND (
    EXISTS (
      SELECT 1 FROM next_actions na
      WHERE na.lead_id = leads.id
        AND na.status = 'open'
    )
    OR leads.owner_user_id IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM lead_comms_summary lcs
      WHERE lcs.lead_id = leads.id
        AND (lcs.incoming_count > 0
             OR lcs.outgoing_count > 0
             OR lcs.last_comm_at IS NOT NULL)
    )
    OR EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.linked_object_type = 'lead'
        AND t.linked_object_id = leads.id
        AND t.status IN ('pending', 'todo', 'open')
        AND t.completed_at IS NULL
        AND t.dismissed_at IS NULL
        AND t.archived = false
    )
  )
`.trim();

/** Convenience wrapper — returns the WHERE clause with the `WHERE` keyword. */
export function myWorkPredicate(): { whereSql: string } {
  return { whereSql: `WHERE ${MY_WORK_PREDICATE_SQL}` };
}

/**
 * Signal definitions — documented for callers that need to explain the UI.
 *
 * Each signal is an independent OR branch.  A lead qualifies if ANY fires.
 */
export const MY_WORK_SIGNALS = {
  openNextAction: "Open next_action row with status = 'open'",
  ownerAssigned:  "leads.owner_user_id IS NOT NULL",
  communication:  "lead_comms_summary: incoming_count > 0 OR outgoing_count > 0 OR last_comm_at IS NOT NULL",
  openTask: `tasks: status IN ('pending','todo','open') AND completed_at IS NULL AND dismissed_at IS NULL AND archived = false`,
} as const;
