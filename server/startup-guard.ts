/**
 * server/startup-guard.ts
 *
 * Central read-only validation gate for the rollback candidate.
 *
 * When ROLLBACK_VALIDATION_READ_ONLY=true every startup write path
 * (DDL, DML, backfills, seeding, cleanup) is suppressed and a log line
 * is emitted naming the skipped function.  Read paths and API serving
 * continue normally so the rollback candidate can be verified against
 * a production-clone database without risk of mutation.
 *
 * This flag is for isolated staging validation ONLY.
 * Never set it in normal production or development boots.
 */

export function isRollbackReadOnly(): boolean {
  return process.env.ROLLBACK_VALIDATION_READ_ONLY === "true";
}

/**
 * Log a skipped startup writer and return true when the gate is active.
 * Usage:
 *   if (skipInReadOnlyMode("backfillAccountsForLeads")) return;
 */
export function skipInReadOnlyMode(writerName: string): boolean {
  if (process.env.ROLLBACK_VALIDATION_READ_ONLY === "true") {
    console.log(`[rollback-gate] startup write SKIPPED: ${writerName} (ROLLBACK_VALIDATION_READ_ONLY=true)`);
    return true;
  }
  return false;
}
