/**
 * Canonical mailbox health service.
 *
 * ONE shared function — computeMailboxHealth() — is the single source of
 * truth for mailbox status across:
 *   • GET /api/gmail/accounts/health   (inbox sidebar + settings UI)
 *   • GET /api/admin/mailbox/diagnostics
 *   • GET /api/admin/mailbox/integrity-audit
 *   • Gmail sync worker (used to gate incremental sync calls)
 *   • Background reconciliation jobs
 *
 * Rules (evaluated in priority order):
 *   1. is_active=false OR sync_enabled=false → Disabled
 *   2. auth_status ∉ {active}               → OAuthReconnectRequired
 *   3. Watch expired > 7 days ago            → ReconciliationRequired (push dead, history gap risk)
 *   4. No sync in > 24 h                     → SyncDelayed
 *   5. Watch expires in < 24 h               → SyncDelayed (watch about to die)
 *   6. No push webhook in > 6 h              → SyncDelayed (push stalled)
 *   7. Any sync_error_message present        → SyncDelayed
 *   8. Otherwise                             → Healthy
 *
 * The function is pure (no DB calls) so it can be called cheaply anywhere.
 */

export type MailboxHealthStatus =
  | "Healthy"
  | "SyncDelayed"
  | "ReconciliationRequired"
  | "OAuthReconnectRequired"
  | "Disabled"
  | "Failed";

export type MailboxHealthDot = "green" | "amber" | "red";

export interface MailboxHealthResult {
  status: MailboxHealthStatus;
  dot: MailboxHealthDot;
  reason: string;
}

export interface MailboxHealthInput {
  authStatus: string | null;
  isActive: boolean | null;
  syncEnabled: boolean | null;
  syncErrorMessage: string | null;
  watchExpirationAt: Date | string | null;
  lastIncrementalSyncAt: Date | string | null;
  lastSyncAt: Date | string | null;
  lastWebhookAt: Date | string | null;
}

function toMs(v: Date | string | null | undefined): number | null {
  if (!v) return null;
  const d = typeof v === "string" ? new Date(v) : v;
  return isNaN(d.getTime()) ? null : d.getTime();
}

export function computeMailboxHealth(acct: MailboxHealthInput): MailboxHealthResult {
  const now = Date.now();

  if (!acct.isActive || acct.syncEnabled === false) {
    return { status: "Disabled", dot: "red", reason: "Mailbox is inactive or sync is paused." };
  }

  if (acct.authStatus !== "active") {
    return {
      status: "OAuthReconnectRequired",
      dot: "red",
      reason: acct.syncErrorMessage
        ? acct.syncErrorMessage
        : `Gmail OAuth token is ${acct.authStatus ?? "unknown"} — please reconnect.`,
    };
  }

  const watchExpMs = toMs(acct.watchExpirationAt);
  const lastSyncMs = toMs(acct.lastIncrementalSyncAt ?? acct.lastSyncAt);
  const lastWebhookMs = toMs(acct.lastWebhookAt);

  const watchExpiredSevenDaysAgo =
    watchExpMs !== null && watchExpMs < now - 7 * 24 * 3_600_000;
  const watchExpiresSoon =
    watchExpMs !== null && watchExpMs > now && watchExpMs < now + 24 * 3_600_000;
  const noSyncIn24h = lastSyncMs === null || lastSyncMs < now - 24 * 3_600_000;
  const pushStaledIn6h = lastWebhookMs !== null && lastWebhookMs < now - 6 * 3_600_000;
  const hasError = !!acct.syncErrorMessage;

  if (watchExpiredSevenDaysAgo) {
    return {
      status: "ReconciliationRequired",
      dot: "red",
      reason: "Gmail push watch expired > 7 days ago — incremental history may have gaps. Run reconciliation.",
    };
  }

  if (noSyncIn24h || watchExpiresSoon || pushStaledIn6h || hasError) {
    const reasons: string[] = [];
    if (noSyncIn24h) reasons.push("No successful sync in > 24 h.");
    if (watchExpiresSoon) reasons.push("Gmail push watch expires in < 24 h.");
    if (pushStaledIn6h) reasons.push("No push notification received in > 6 h.");
    if (hasError) reasons.push(acct.syncErrorMessage!);
    return { status: "SyncDelayed", dot: "amber", reason: reasons.join(" ") };
  }

  return { status: "Healthy", dot: "green", reason: "Syncing normally." };
}

/**
 * Map the canonical MailboxHealthStatus to the legacy three-value dot used by
 * older components that have not yet migrated to the full status string.
 */
export function healthStatusToDot(status: MailboxHealthStatus): MailboxHealthDot {
  switch (status) {
    case "Healthy":      return "green";
    case "SyncDelayed":  return "amber";
    default:             return "red";
  }
}
