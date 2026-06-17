import { db } from "../db";
import { emailMessages, emailAccounts } from "../../shared/schema";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { parseGmailMessage } from "./email-parser";
import { insertAttachmentsForMessage } from "./email-attachments";
import { runAssociationEngine } from "./association-engine";
import { routeEmailToFolders } from "./email-folder-router";
import { deriveEmailLabels, toDrizzleLabels, parseLabelArray } from "./inbox-policy";
// Local logger. Avoids importing from ../index (which boots the entire express
// server) so this service can be used from one-shot tsx scripts as well as
// from within the running app. Output format mirrors the express log() helper
// closely enough for grep-friendliness.
const log = (message: string, _source = "backfill") => {
  const t = new Date().toLocaleTimeString("en-US", { hour12: true });
  console.log(`${t} [${_source}] ${message}`);
};

type BackfillOptions = {
  jobId: number;
  accountId: number;
  userId: number;
  dateFrom?: string;
  dateTo?: string;
};

// Convert YYYY-MM-DD to Gmail query date format YYYY/MM/DD
function toGmailDate(d: string): string {
  return d.replace(/-/g, "/");
}

// Build Gmail query string for date range
function buildQuery(dateFrom?: string, dateTo?: string): string {
  const parts: string[] = ["(in:inbox OR in:sent)"];
  if (dateFrom) parts.push(`after:${toGmailDate(dateFrom)}`);
  if (dateTo) parts.push(`before:${toGmailDate(dateTo)}`);
  return parts.join(" ");
}

// ── Main backfill worker ──────────────────────────────────────────────────────
// Runs asynchronously. Updates backfill_jobs row with progress.
// Resumable: if last_page_token is set, picks up from where it left off.
export async function runBackfillJob(opts: BackfillOptions): Promise<void> {
  const { jobId, accountId, userId, dateFrom, dateTo } = opts;

  const updateJob = async (fields: Record<string, any>) => {
    const sets = Object.entries(fields)
      .map(([k, v]) => {
        if (v === null) return `${k} = NULL`;
        if (typeof v === "number") return `${k} = ${v}`;
        if (typeof v === "boolean") return `${k} = ${v}`;
        if (v instanceof Date) return `${k} = '${v.toISOString()}'`;
        return `${k} = '${String(v).replace(/'/g, "''")}'`;
      })
      .join(", ");
    await db.execute(sql.raw(`UPDATE backfill_jobs SET ${sets}, updated_at = NOW() WHERE id = ${jobId}`));
  };

  try {
    await updateJob({ status: "running" });

    // Load account
    const [account] = await db
      .select()
      .from(emailAccounts)
      .where(eq(emailAccounts.id, accountId))
      .limit(1);

    if (!account || !account.refreshToken) {
      await updateJob({ status: "failed", error_message: "Account not found or no token" });
      return;
    }

    const myEmail = account.emailAddress;

    const { getGmailClient } = await import("../gmail-oauth");
    const gmailClient = await getGmailClient(userId, accountId);

    const query = buildQuery(dateFrom, dateTo);
    log(`[backfill] job=${jobId} account=${account.emailAddress} query="${query}"`);

    // Check existing page token + total_estimate + processed from DB
    // (resumable). total_estimate is captured once on the first page from
    // Gmail's resultSizeEstimate (Commit 7 — drives the visible progress
    // banner). `processed` is read here so resumed jobs continue counting
    // from where they left off — without this read, every resume rewinds
    // the banner counter to "0 of ~5,000" even though the underlying work
    // was preserved by last_page_token.
    // (Architect-flagged SEV-MED — processed-continuity fix.)
    const jobRowRes = await db.execute(sql.raw(
      `SELECT last_page_token, total_estimate, processed FROM backfill_jobs WHERE id = ${jobId}`
    )) as any;
    const jobRow = jobRowRes?.rows?.[0];
    let pageToken: string | undefined = jobRow?.last_page_token ?? undefined;
    let totalEstimate: number | null = jobRow?.total_estimate ?? null;
    // Track first-iteration so we know when to capture resultSizeEstimate.
    // Resumed jobs (pageToken already set OR totalEstimate already set) skip
    // the capture; the original first-page estimate stays authoritative.
    let isFirstIteration = !pageToken && totalEstimate === null;

    // Resume-aware: pick up the persisted processed count if any.
    let processed = Number(jobRow?.processed ?? 0) || 0;
    let newMessages = 0;
    let hasMore = true;

    while (hasMore) {
      // ── Cancel check (Commit 7) ────────────────────────────────────────
      // Re-read the job's status BEFORE making another expensive Gmail
      // page call. If the user clicked Stop in the inbox banner, the
      // /backfill/cancel endpoint will have set status='cancelling'. We
      // exit cleanly, persist status='cancelled', and leave last_page_token
      // populated so the resume endpoint can pick up exactly where we
      // stopped. Per-page granularity (not per-message) is intentional —
      // each Gmail page is up to 100 messages, so worst-case the user
      // waits one batch (~5–15s) for the stop to take effect, but we
      // avoid hammering the database with a status SELECT per message.
      const cancelCheckRes = await db.execute(sql.raw(
        `SELECT status FROM backfill_jobs WHERE id = ${jobId}`
      )) as any;
      const liveStatus = cancelCheckRes?.rows?.[0]?.status;
      if (liveStatus === "cancelling" || liveStatus === "cancelled") {
        await db.execute(sql.raw(
          `UPDATE backfill_jobs SET status='cancelled', processed=${processed}, updated_at=NOW() WHERE id=${jobId}`
        ));
        log(`[backfill] job=${jobId} cancelled mid-run — processed=${processed}, last_page_token preserved for resume`);
        return;
      }

      const listRes = await gmailClient.users.messages.list({
        userId: "me",
        maxResults: 100,
        q: query,
        ...(pageToken ? { pageToken } : {}),
      });

      const messages = listRes.data.messages || [];
      pageToken = listRes.data.nextPageToken ?? undefined;
      hasMore = !!pageToken && messages.length > 0;

      // Capture Gmail's resultSizeEstimate on the very first page only.
      // Gmail's estimate is approximate (often off by ±20%) but it's the
      // right starting point for a progress bar — better than nothing.
      // Only persist if non-null and > 0 to avoid wiping a useful estimate
      // with a zero from an empty mailbox edge case.
      if (isFirstIteration) {
        isFirstIteration = false;
        const est = Number(listRes.data.resultSizeEstimate ?? 0);
        if (Number.isFinite(est) && est > 0) {
          totalEstimate = est;
          await updateJob({ total_estimate: est, status: "running" });
        }
      }

      // Save page token for resumability
      if (pageToken) {
        await updateJob({ last_page_token: pageToken, processed, status: "running" });
      }

      for (const { id } of messages) {
        if (!id) continue;
        // Dedupe: skip if already in DB
        const existing = await db
          .select({ id: emailMessages.id })
          .from(emailMessages)
          .where(eq(emailMessages.gmailMessageId, id))
          .limit(1);

        if (existing.length > 0) {
          processed++;
          continue;
        }

        try {
          const msgRes = await gmailClient.users.messages.get({
            userId: "me", id, format: "full",
          });
          const parsed = parseGmailMessage(msgRes.data as any, myEmail);
          const { attachments, ...emailData } = parsed;
          // Phase 2 wiring: populate all 8 derived label columns at insert time.
          const derivedLabels = toDrizzleLabels(deriveEmailLabels(parseLabelArray(emailData.labelIds)));
          const [inserted] = await db
            .insert(emailMessages)
            .values({ ...emailData, ...derivedLabels, ownerUserId: userId, sourceAccountId: accountId })
            .onConflictDoNothing()
            .returning();

          if (inserted) {
            if (attachments.length) await insertAttachmentsForMessage(inserted.id, attachments);
            await runAssociationEngine(inserted.id);
            await routeEmailToFolders(inserted.id, userId, inserted.fromEmail ?? "");
            newMessages++;
          }
        } catch (msgErr: any) {
          log(`[backfill] job=${jobId} message ${id} error: ${msgErr.message}`);
        }
        processed++;
      }

      // Update progress every batch
      await updateJob({ processed, status: "running" });
    }

    // Done — clear page token and mark complete
    await db.execute(sql.raw(
      `UPDATE backfill_jobs SET status='completed', processed=${processed}, last_page_token=NULL, completed_at=NOW(), updated_at=NOW() WHERE id=${jobId}`
    ));
    log(`[backfill] job=${jobId} done — processed=${processed}, new=${newMessages}`);

  } catch (err: any) {
    log(`[backfill] job=${jobId} fatal: ${err.message}`);
    await db.execute(sql.raw(
      `UPDATE backfill_jobs SET status='failed', error_message='${String(err.message).replace(/'/g, "''")}', updated_at=NOW() WHERE id=${jobId}`
    ));
  }
}

// ── Compute warmness scores ───────────────────────────────────────────────────
// Called after a backfill or on demand. Upserts contact_relationships rows.
export async function computeWarmness(userId?: number): Promise<number> {
  const userFilter = userId ? `AND em.owner_user_id = ${userId}` : "";

  // Build relationship stats from email_messages
  await db.execute(sql.raw(`
    INSERT INTO contact_relationships (email_address, domain, first_seen, last_seen, total_sent, total_received, warmness_score, mailbox_sources, computed_at)
    SELECT
      ext_email,
      LOWER(SPLIT_PART(ext_email, '@', 2)) AS domain,
      MIN(sent_at) AS first_seen,
      MAX(sent_at) AS last_seen,
      COUNT(*) FILTER (WHERE direction = 'sent') AS total_sent,
      COUNT(*) FILTER (WHERE direction = 'received') AS total_received,
      LEAST(100, GREATEST(0,
        100
        - GREATEST(0, EXTRACT(DAY FROM NOW() - MAX(sent_at))::int) / 2
        + LEAST(30, (COUNT(*)::int / 3))
      ))::int AS warmness_score,
      '[]'::jsonb AS mailbox_sources,
      NOW() AS computed_at
    FROM (
      SELECT
        CASE WHEN direction = 'sent' THEN to_email ELSE from_email END AS ext_email,
        direction,
        sent_at,
        owner_user_id
      FROM email_messages
      WHERE sent_at IS NOT NULL
        AND (from_email NOT ILIKE '%voltsafe.com%' OR to_email NOT ILIKE '%voltsafe.com%')
        ${userFilter}
    ) raw
    WHERE ext_email IS NOT NULL AND ext_email NOT ILIKE '%voltsafe.com%'
    GROUP BY ext_email
    ON CONFLICT (email_address) DO UPDATE SET
      first_seen = LEAST(contact_relationships.first_seen, EXCLUDED.first_seen),
      last_seen = GREATEST(contact_relationships.last_seen, EXCLUDED.last_seen),
      total_sent = EXCLUDED.total_sent,
      total_received = EXCLUDED.total_received,
      warmness_score = EXCLUDED.warmness_score,
      computed_at = NOW()
  `));

  // Link to contacts where email matches
  await db.execute(sql.raw(`
    UPDATE contact_relationships cr
    SET contact_id = c.id
    FROM contacts c
    WHERE LOWER(c.email) = LOWER(cr.email_address)
      AND cr.contact_id IS NULL
  `));

  const [row] = await db.execute(sql.raw(`SELECT COUNT(*) AS cnt FROM contact_relationships`)) as any;
  return Number((row as any)?.cnt ?? 0);
}
