import { db } from "../db";
import { emailMessages, emailAccounts } from "../../shared/schema";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { parseGmailMessage } from "./email-parser";
import { runAssociationEngine } from "./association-engine";
import { routeEmailToFolders } from "./email-folder-router";
import { log } from "../index";

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

    const myDomain = account.emailAddress.split("@")[1] || "voltsafe.com";

    const { getGmailClient } = await import("../gmail-oauth");
    const gmailClient = await getGmailClient(userId, accountId);

    const query = buildQuery(dateFrom, dateTo);
    log(`[backfill] job=${jobId} account=${account.emailAddress} query="${query}"`);

    // Check existing page token from DB (resumable)
    const [jobRow] = await db.execute(sql.raw(
      `SELECT last_page_token FROM backfill_jobs WHERE id = ${jobId}`
    )) as any;
    let pageToken: string | undefined = (jobRow as any)?.last_page_token ?? undefined;

    let processed = 0;
    let newMessages = 0;
    let hasMore = true;

    while (hasMore) {
      const listRes = await gmailClient.users.messages.list({
        userId: "me",
        maxResults: 100,
        q: query,
        ...(pageToken ? { pageToken } : {}),
      });

      const messages = listRes.data.messages || [];
      pageToken = listRes.data.nextPageToken ?? undefined;
      hasMore = !!pageToken && messages.length > 0;

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
          const parsed = parseGmailMessage(msgRes.data as any, myDomain);
          const [inserted] = await db
            .insert(emailMessages)
            .values({ ...parsed, ownerUserId: userId, sourceAccountId: accountId })
            .onConflictDoNothing()
            .returning();

          if (inserted) {
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
