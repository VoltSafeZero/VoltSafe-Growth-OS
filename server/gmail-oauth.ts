// Gmail OAuth2 using Google Cloud credentials (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET)
// Per-user tokens stored in email_accounts.refresh_token / access_token (Phase 2).
import { google } from "googleapis";
import { db } from "./db";
import { systemSettings, emailAccounts, users } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

// Auto-backfill on new mailbox connect.
// - Default: last 365 days / 1 year (today minus 365 days → today) for any
//   newly connected user mailbox. Originally 90 days in Commit 7; widened
//   to 1 year on 2026-04-28 per product decision so brand-new OAuth users
//   land on a meaningfully populated inbox (a quarter of history is too
//   short for a CRM-grade unified inbox where renewal cycles, project
//   timelines, and customer threads routinely span 6–12 months).
// - Special override: trevor/sales/support @voltsafe.com get 2020-01-01 → today
//   (per ops policy — these mailboxes need the longer history regardless).
// Only fires the first time an account row is INSERTED. Reconnects that go
// through the UPDATE path are not re-enqueued unless the previous job was
// cancelled and the user explicitly resumes it via the UI banner / endpoint.
const SPECIAL_2020_ADDRESSES = new Set([
  "trevor@voltsafe.com",
  "sales@voltsafe.com",
  "support@voltsafe.com",
]);

const DEFAULT_BACKFILL_DAYS = 365;

function computeDefaultBackfillFrom(): string {
  // today - 365 days (1 year), formatted YYYY-MM-DD (Gmail accepts this;
  // the backfill service converts to YYYY/MM/DD for the Gmail q= parameter).
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - DEFAULT_BACKFILL_DAYS);
  return d.toISOString().slice(0, 10);
}

/**
 * Enqueue a backfill job for a Gmail account. Single canonical entry point
 * used by both the OAuth-completion auto-enqueue path AND the Commit 8
 * admin "trigger fresh backfill" recovery endpoint — keeping behavior
 * identical so an admin-triggered backfill is indistinguishable from a
 * fresh-OAuth one (same 365-day / 1-year default, same special-address
 * override, same idempotency guard, same fire-and-forget worker invocation).
 *
 * Optional overrides:
 *   - dateFromOverride: bypass the 365-day default + special-address rule
 *     and use the caller's explicit start date (still YYYY-MM-DD).
 *   - dateToOverride: end the backfill at a specific date (default = today).
 *   - skipIdempotencyCheck: if true, allow enqueueing even when a
 *     pending/running job already exists for this account. Reserved for
 *     admin "force re-run" flows; the OAuth-completion path NEVER sets it.
 *
 * Returns:
 *   - { enqueued: true, jobId, dateFrom, dateTo } on success
 *   - { enqueued: false, reason } on idempotency-block or insert failure
 */
export async function autoEnqueueBackfillForNewAccount(opts: {
  accountId: number;
  userId: number;
  emailAddress: string | null;
  dateFromOverride?: string;
  dateToOverride?: string;
  skipIdempotencyCheck?: boolean;
}): Promise<{ enqueued: boolean; jobId?: number; dateFrom?: string; dateTo?: string; reason?: string }> {
  const { accountId, userId, emailAddress, dateFromOverride, dateToOverride, skipIdempotencyCheck } = opts;
  try {
    const dateFrom = dateFromOverride
      ?? (emailAddress && SPECIAL_2020_ADDRESSES.has(emailAddress.toLowerCase())
        ? "2020-01-01"
        : computeDefaultBackfillFrom());
    const today = dateToOverride ?? new Date().toISOString().slice(0, 10);

    // Idempotency: don't double-enqueue if a pending/running job already
    // exists. The OAuth-completion path always honors this; admin-triggered
    // re-runs may opt out via skipIdempotencyCheck=true.
    //
    // Architect-flagged SEV-HIGH (Commit 8): the original SELECT-then-INSERT
    // pattern was a classic TOCTOU race — two concurrent OAuth callbacks
    // (or two trigger-backfill clicks within the same millisecond) could
    // both pass the check and both INSERT a pending job, spawning two
    // parallel runBackfillJob workers for the same mailbox.
    //
    // Fix: collapse the check + insert into a single SQL statement using
    // INSERT...SELECT...WHERE NOT EXISTS. The DB enforces mutual exclusion
    // — the WHERE NOT EXISTS clause is evaluated as part of the INSERT, so
    // at most ONE of two concurrent statements actually inserts a row.
    // The losing statement's RETURNING comes back empty and we report
    // "in-flight job already exists" exactly the same way the old guard did.
    //
    // The skipIdempotencyCheck=true path uses an unconditional INSERT — by
    // design (admin "force" override). It can still spawn duplicate workers;
    // that's intentional and documented at the route level.
    const insertSql = skipIdempotencyCheck
      ? `INSERT INTO backfill_jobs (user_id, email_account_id, status, date_from, date_to)
           VALUES (${userId}, ${accountId}, 'pending', '${dateFrom}', '${today}')
           RETURNING id`
      : `INSERT INTO backfill_jobs (user_id, email_account_id, status, date_from, date_to)
           SELECT ${userId}, ${accountId}, 'pending', '${dateFrom}', '${today}'
            WHERE NOT EXISTS (
              SELECT 1 FROM backfill_jobs
               WHERE email_account_id = ${accountId}
                 AND status IN ('pending','running','cancelling')
            )
           RETURNING id`;
    const inserted = await db.execute(sql.raw(insertSql));
    const jobId = Number((inserted as any).rows?.[0]?.id);
    if (!jobId) {
      return {
        enqueued: false,
        reason: skipIdempotencyCheck ? "insert returned no id" : "in-flight job already exists",
      };
    }

    console.log(`[auto-backfill] enqueued job ${jobId} for account ${accountId} (${emailAddress ?? "?"}) ${dateFrom}→${today}`);

    // Fire-and-forget. The backfill service updates job status as it runs.
    const { runBackfillJob } = await import("./services/backfill-service");
    runBackfillJob({ jobId, accountId, userId, dateFrom, dateTo: today })
      .catch(err => console.error(`[auto-backfill] job ${jobId} error:`, err));

    return { enqueued: true, jobId, dateFrom, dateTo: today };
  } catch (err: any) {
    // Never block the OAuth callback on backfill enqueue failures.
    console.error("[auto-backfill] enqueue failed:", err);
    return { enqueued: false, reason: err?.message ?? String(err) };
  }
}

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
];

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ||
    (process.env.NODE_ENV === "production"
      ? "https://image-linker-burgesstrevor76.replit.app/api/auth/google/callback"
      : `https://${process.env.REPLIT_DOMAINS}/api/auth/google/callback`);

  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set");
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// getAuthUrl — generates the Google OAuth consent URL.
// Pass state="shared" to flag this as a shared workspace inbox connection.
export function getAuthUrl(state?: string): string {
  const oauth2Client = getOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    ...(state ? { state } : {}),
  });
}

// exchangeCodeForTokens — handles the OAuth callback.
// When isShared=true (state="shared" in the callback), the account is upserted by
// emailAddress so a single admin can hold multiple shared accounts without overwriting
// their personal account. The isShared flag makes it accessible workspace-wide.
export async function exchangeCodeForTokens(
  code: string,
  userId: number,
  isShared = false,
  visibilityType = 'private_personal'
): Promise<{ emailAddress: string; accountId: number | null; isNewAccount: boolean }> {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error("No refresh token returned. Try revoking access at myaccount.google.com/permissions and reconnecting.");
  }

  // Get Gmail profile for the connecting account
  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  let emailAddress = "";
  try {
    const profile = await gmail.users.getProfile({ userId: "me" });
    emailAddress = profile.data.emailAddress || "";
  } catch {}

  const displayName = emailAddress; // for shared accounts, use email as display name

  // Track which account row was upserted and whether it's brand-new.
  // Returned to the callback so it can trigger post-reconnect tasks
  // (incremental sync + watch renewal) for reconnects vs backfill for new accounts.
  let resultAccountId: number | null = null;
  let isNewAccount = false;

  if (isShared) {
    // Shared workspace inbox: upsert by emailAddress so the admin can connect
    // multiple shared accounts without overwriting their personal record.
    const [existing] = await db
      .select({ id: emailAccounts.id })
      .from(emailAccounts)
      .where(eq(emailAccounts.emailAddress, emailAddress))
      .limit(1);

    if (existing) {
      await db.update(emailAccounts)
        .set({
          authStatus: "active",
          refreshToken: tokens.refresh_token,
          accessToken: tokens.access_token || null,
          isShared: true,
          syncEnabled: true,
          disconnectedAt: null,
          syncErrorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(emailAccounts.id, existing.id));
      resultAccountId = existing.id;
    } else {
      const [inserted] = await db.insert(emailAccounts).values({
        workspaceId: 1,
        userId, // connected-by user id (admin)
        provider: "gmail",
        emailAddress: emailAddress || `shared_${Date.now()}@unknown`,
        displayName,
        authStatus: "active",
        isActive: true,
        isShared: true,
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token || null,
        syncEnabled: true,
      }).returning({ id: emailAccounts.id });
      if (inserted?.id) {
        resultAccountId = inserted.id;
        isNewAccount = true;
        await autoEnqueueBackfillForNewAccount({
          accountId: inserted.id,
          userId,
          emailAddress: emailAddress || null,
        });
      }
    }
    // Persist visibility_type (additive column, not in Drizzle schema)
    if (resultAccountId) {
      const vt = visibilityType || (isShared ? 'team_shared' : 'private_personal');
      await db.execute(sql.raw(`UPDATE email_accounts SET visibility_type = '${vt}' WHERE id = ${resultAccountId}`));
    }
  } else {
    // Personal account: upsert by userId (original behaviour)
    let displayNamePersonal = emailAddress;
    try {
      const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
      if (user?.name) displayNamePersonal = user.name;
    } catch {}

    // Multi-mailbox Phase 1: key personal accounts by (userId, emailAddress) so a single
    // user can connect multiple personal Gmail addresses. Old behaviour upserted by userId
    // alone, which silently overwrote your primary account when adding a second. If we have
    // an emailAddress from Gmail profile, match on it; otherwise fall back to legacy lookup.
    const [existing] = emailAddress
      ? await db.select({ id: emailAccounts.id })
          .from(emailAccounts)
          .where(and(
            eq(emailAccounts.userId, userId),
            eq(emailAccounts.isShared, false),
            eq(emailAccounts.emailAddress, emailAddress),
          ))
          .limit(1)
      : await db.select({ id: emailAccounts.id })
          .from(emailAccounts)
          .where(and(eq(emailAccounts.userId, userId), eq(emailAccounts.isShared, false)))
          .limit(1);

    if (existing) {
      await db.update(emailAccounts)
        .set({
          emailAddress: emailAddress || undefined,
          displayName: displayNamePersonal,
          authStatus: "active",
          refreshToken: tokens.refresh_token,
          accessToken: tokens.access_token || null,
          syncEnabled: true,
          disconnectedAt: null,
          syncErrorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(emailAccounts.id, existing.id));
      resultAccountId = existing.id;
    } else {
      const inserted = await db.insert(emailAccounts)
        .values({
          workspaceId: 1,
          userId,
          provider: "gmail",
          emailAddress: emailAddress || `user_${userId}@unknown`,
          displayName: displayNamePersonal,
          authStatus: "active",
          isActive: true,
          isShared: false,
          refreshToken: tokens.refresh_token,
          accessToken: tokens.access_token || null,
          syncEnabled: true,
        })
        .onConflictDoNothing()
        .returning({ id: emailAccounts.id });
      const newId = inserted?.[0]?.id;
      if (newId) {
        resultAccountId = newId;
        isNewAccount = true;
        await autoEnqueueBackfillForNewAccount({
          accountId: newId,
          userId,
          emailAddress: emailAddress || null,
        });
      }
    }

    // Persist visibility_type for personal accounts (additive column)
    if (resultAccountId) {
      const vt = visibilityType || 'private_personal';
      await db.execute(sql.raw(`UPDATE email_accounts SET visibility_type = '${vt}' WHERE id = ${resultAccountId}`)).catch(() => {});
    }

    // Legacy compat: also mirror tokens into system_settings under the original
    // single-user keys. Harmless for multi-user setups (just a constant overwrite
    // by whoever last connected); kept until the last legacy reader is removed.
    if (tokens.refresh_token) {
      await db.insert(systemSettings)
        .values({ key: "gmail_refresh_token", value: tokens.refresh_token })
        .onConflictDoUpdate({ target: systemSettings.key, set: { value: tokens.refresh_token, updatedAt: new Date() } });
    }
    if (tokens.access_token) {
      await db.insert(systemSettings)
        .values({ key: "gmail_access_token", value: tokens.access_token })
        .onConflictDoUpdate({ target: systemSettings.key, set: { value: tokens.access_token!, updatedAt: new Date() } });
    }
    if (emailAddress) {
      await db.insert(systemSettings)
        .values({ key: "gmail_address", value: emailAddress })
        .onConflictDoUpdate({ target: systemSettings.key, set: { value: emailAddress, updatedAt: new Date() } });
    }
  }

  return { emailAddress, accountId: resultAccountId, isNewAccount };
}

// getGmailClient resolves a Gmail API client for either a userId or a specific accountId.
// When accountId is provided (for shared mailbox access), it looks up by accountId directly,
// bypassing the userId constraint so any workspace user can access shared inboxes.
//
// Multi-user note: when no accountId is given, we prefer the user's PERSONAL account
// (is_shared=false) so that admins who also connected team inboxes don't accidentally
// pick up a shared mailbox token. This mirrors getUserGmailAccount in routes.ts.
export async function getGmailClient(userId: number, accountId?: number) {
  let refreshToken: string | null = null;

  if (accountId !== undefined) {
    // Shared account access — look up by specific accountId
    const [acct] = await db
      .select({ refreshToken: emailAccounts.refreshToken })
      .from(emailAccounts)
      .where(eq(emailAccounts.id, accountId))
      .limit(1);
    refreshToken = acct?.refreshToken ?? null;
    if (!refreshToken) throw new Error("Account has no token — please reconnect it.");
  } else {
    // Standard: per-user PERSONAL token from email_accounts.
    // is_shared=false avoids returning a team-inbox token when the same user
    // owns both. Deterministic ordering by id for stability.
    const [acct] = await db
      .select({ refreshToken: emailAccounts.refreshToken })
      .from(emailAccounts)
      .where(and(
        eq(emailAccounts.userId, userId),
        eq(emailAccounts.isActive, true),
        eq(emailAccounts.isShared, false),
      ))
      .orderBy(emailAccounts.id)
      .limit(1);
    refreshToken = acct?.refreshToken ?? null;

    // Legacy single-user migration aid: only adopt the legacy
    // system_settings.gmail_refresh_token when system_settings.gmail_address
    // matches THIS user's account email. That ensures the legacy token is only
    // ever assigned back to its original owner, never to a different user who
    // happens to be missing a token. After backfill the branch is dead.
    if (!refreshToken && acct) {
      const [acctRow] = await db
        .select({ emailAddress: emailAccounts.emailAddress })
        .from(emailAccounts)
        .where(and(
          eq(emailAccounts.userId, userId),
          eq(emailAccounts.isShared, false),
        ))
        .orderBy(emailAccounts.id)
        .limit(1);
      const myEmail = (acctRow?.emailAddress || "").toLowerCase();
      const [tokenRow] = await db.select().from(systemSettings).where(eq(systemSettings.key, "gmail_refresh_token"));
      const [addrRow]  = await db.select().from(systemSettings).where(eq(systemSettings.key, "gmail_address"));
      const legacyAddr = (addrRow?.value || "").toLowerCase();
      if (tokenRow?.value && legacyAddr && myEmail && legacyAddr === myEmail) {
        refreshToken = tokenRow.value;
        await db.update(emailAccounts)
          .set({ refreshToken, updatedAt: new Date() })
          .where(and(eq(emailAccounts.userId, userId), eq(emailAccounts.isShared, false)));
      }
    }
  }

  if (!refreshToken) {
    throw new Error("Gmail not connected for this user");
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  let credentials: any;
  try {
    const result = await oauth2Client.refreshAccessToken();
    credentials = result.credentials;
  } catch (err: any) {
    const msg = (err?.message || "").toLowerCase();
    if (
      msg.includes("invalid_grant") ||
      msg.includes("token has been expired") ||
      msg.includes("token has been revoked")
    ) {
      const e = new Error("Gmail connection expired — please reconnect Gmail to continue sending mail.");
      (e as any).code = "gmail_reauth_required";
      throw e;
    }
    throw err;
  }
  oauth2Client.setCredentials(credentials);

  return google.gmail({ version: "v1", auth: oauth2Client });
}

export async function isGmailConnected(userId: number): Promise<{ connected: boolean; tokenValid: boolean; apiEnabled: boolean }> {
  try {
    // Check if this user has an active PERSONAL email_accounts record with a token.
    // is_shared=false ensures we don't report "connected" just because the user has
    // access to a team inbox.
    const [acct] = await db
      .select({ refreshToken: emailAccounts.refreshToken, authStatus: emailAccounts.authStatus })
      .from(emailAccounts)
      .where(and(
        eq(emailAccounts.userId, userId),
        eq(emailAccounts.isActive, true),
        eq(emailAccounts.isShared, false),
      ))
      .orderBy(emailAccounts.id)
      .limit(1);

    let hasToken = !!acct?.refreshToken;

    // Legacy single-user migration aid (mirror of getGmailClient): only count
    // the legacy system_settings token as "connected" when the legacy
    // gmail_address matches THIS user's account email — never cross-assign.
    if (!hasToken && acct) {
      const [acctRow] = await db
        .select({ emailAddress: emailAccounts.emailAddress })
        .from(emailAccounts)
        .where(and(eq(emailAccounts.userId, userId), eq(emailAccounts.isShared, false)))
        .orderBy(emailAccounts.id)
        .limit(1);
      const myEmail = (acctRow?.emailAddress || "").toLowerCase();
      const [tokenRow] = await db.select().from(systemSettings).where(eq(systemSettings.key, "gmail_refresh_token"));
      const [addrRow]  = await db.select().from(systemSettings).where(eq(systemSettings.key, "gmail_address"));
      const legacyAddr = (addrRow?.value || "").toLowerCase();
      hasToken = !!(tokenRow?.value && legacyAddr && myEmail && legacyAddr === myEmail);
    }

    if (!hasToken) return { connected: false, tokenValid: false, apiEnabled: true };

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return { connected: true, tokenValid: false, apiEnabled: true };

    try {
      const gmail = await getGmailClient(userId);
      await gmail.users.getProfile({ userId: "me" });
      return { connected: true, tokenValid: true, apiEnabled: true };
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.includes("API has not been used") || msg.includes("disabled")) {
        return { connected: true, tokenValid: true, apiEnabled: false };
      }
      if (msg.includes("unauthorized_client") || msg.includes("invalid_grant") || msg.includes("Token has been expired") || msg.includes("not connected")) {
        return { connected: false, tokenValid: false, apiEnabled: true };
      }
      return { connected: true, tokenValid: false, apiEnabled: true };
    }
  } catch {
    return { connected: false, tokenValid: false, apiEnabled: true };
  }
}
