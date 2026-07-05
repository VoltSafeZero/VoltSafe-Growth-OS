/**
 * Campaign Tracking Service — Phase 4
 *
 * Handles unsubscribe tokens, open tracking pixels, click tracking redirects,
 * and campaign engagement event recording.
 */

import crypto from "crypto";
import { db } from "../db";
import { sql } from "drizzle-orm";

// ── Internal / bot user-agent patterns to suppress ────────────────────────────

const INTERNAL_UA_PATTERNS = [
  /googlebot/i,
  /bingbot/i,
  /slurp/i,
  /duckduckbot/i,
  /baiduspider/i,
  /yandex/i,
  /googleimageproxy/i,
  /microsoft.*smtp/i,
  /preview[\-.]?mail/i,
  /litmus/i,
  /email.*preview/i,
  /voltsafe\.com/i,
];

export function isInternalUserAgent(ua: string | undefined): boolean {
  if (!ua) return false;
  return INTERNAL_UA_PATTERNS.some((p) => p.test(ua));
}

function hashIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

// ── Unsubscribe tokens ────────────────────────────────────────────────────────

export async function ensureUnsubscribeToken(recipientId: number): Promise<string> {
  const res = await db.execute(
    sql`SELECT unsubscribe_token FROM campaign_recipients WHERE id = ${recipientId}`
  );
  const existing = (res.rows[0] as any)?.unsubscribe_token;
  if (existing) return existing as string;

  const token = crypto.randomBytes(24).toString("hex");
  await db.execute(
    sql`UPDATE campaign_recipients
        SET unsubscribe_token = ${token}, updated_at = NOW()
        WHERE id = ${recipientId}`
  );
  return token;
}

export async function getRecipientByUnsubscribeToken(token: string): Promise<{
  id: number;
  campaignId: number;
  contactId: number | null;
  accountId: number | null;
  email: string;
  name: string | null;
  unsubscribedAt: Date | null;
} | null> {
  const res = await db.execute(
    sql`SELECT id, campaign_id, contact_id, account_id, email, name, unsubscribed_at
        FROM campaign_recipients
        WHERE unsubscribe_token = ${token}
        LIMIT 1`
  );
  const row = res.rows[0] as any;
  if (!row) return null;
  return {
    id: row.id,
    campaignId: row.campaign_id,
    contactId: row.contact_id ?? null,
    accountId: row.account_id ?? null,
    email: row.email,
    name: row.name ?? null,
    unsubscribedAt: row.unsubscribed_at ? new Date(row.unsubscribed_at) : null,
  };
}

export async function processUnsubscribe(token: string): Promise<{
  success: boolean;
  alreadyUnsubscribed: boolean;
  email?: string;
  name?: string | null;
}> {
  const recipient = await getRecipientByUnsubscribeToken(token);
  if (!recipient) return { success: false, alreadyUnsubscribed: false };

  if (recipient.unsubscribedAt) {
    return { success: true, alreadyUnsubscribed: true, email: recipient.email, name: recipient.name };
  }

  const now = new Date();

  await db.execute(
    sql`UPDATE campaign_recipients
        SET status = 'unsubscribed', unsubscribed_at = ${now}, updated_at = ${now}
        WHERE id = ${recipient.id}`
  );

  // Add to global suppression (idempotent via ON CONFLICT DO NOTHING)
  await db.execute(
    sql`INSERT INTO campaign_suppression (email, reason, source, created_at)
        VALUES (${recipient.email}, 'unsubscribed', 'campaign_unsubscribe_link', NOW())
        ON CONFLICT DO NOTHING`
  );

  try {
    await db.execute(
      sql`INSERT INTO campaign_events
            (campaign_id, recipient_id, contact_id, account_id, event_type, event_timestamp, metadata)
          VALUES
            (${recipient.campaignId}, ${recipient.id}, ${recipient.contactId}, ${recipient.accountId},
             'unsubscribed', NOW(), '{"source":"unsubscribe_link"}'::jsonb)`
    );
  } catch { /* non-critical */ }

  try {
    await db.execute(
      sql`UPDATE marketing_campaigns
          SET unsubscribed_count = unsubscribed_count + 1, updated_at = NOW()
          WHERE id = ${recipient.campaignId}`
    );
  } catch { /* non-critical */ }

  return { success: true, alreadyUnsubscribed: false, email: recipient.email, name: recipient.name };
}

// ── Open tracking ─────────────────────────────────────────────────────────────

const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

export { TRANSPARENT_GIF };

export async function recordCampaignOpen(
  token: string,
  ip: string | undefined,
  ua: string | undefined
): Promise<void> {
  if (isInternalUserAgent(ua)) return;

  try {
    const res = await db.execute(
      sql`SELECT id, campaign_id, contact_id, account_id
          FROM campaign_recipients
          WHERE unsubscribe_token = ${token}
          LIMIT 1`
    );
    const row = res.rows[0] as any;
    if (!row) return;

    const meta = JSON.stringify({
      ua: ua ? ua.slice(0, 200) : null,
      ip_hash: hashIp(ip),
    });

    await db.execute(
      sql`INSERT INTO campaign_events
            (campaign_id, recipient_id, contact_id, account_id, event_type, event_timestamp, metadata)
          VALUES
            (${row.campaign_id}, ${row.id}, ${row.contact_id}, ${row.account_id},
             'opened', NOW(), ${meta}::jsonb)`
    );

    await db.execute(
      sql`UPDATE campaign_recipients
          SET opened_count = opened_count + 1, updated_at = NOW()
          WHERE id = ${row.id}`
    );

    // Update campaign-level unique open count
    await db.execute(
      sql`UPDATE marketing_campaigns
          SET opened_count = (
            SELECT COUNT(DISTINCT recipient_id)
            FROM campaign_events
            WHERE campaign_id = ${row.campaign_id} AND event_type = 'opened'
          ), updated_at = NOW()
          WHERE id = ${row.campaign_id}`
    );
  } catch (err) {
    console.error("[campaign-tracking] recordCampaignOpen error:", err);
  }
}

// ── Click tracking ────────────────────────────────────────────────────────────

const UNSAFE_PROTO = /^(javascript|data|vbscript|file):/i;
// Matches href="..." or href='...' with http/https URLs
const LINK_RE = /href=(["'])(https?:\/\/[^"' >]+)\1/gi;

export function isSafeCampaignUrl(url: string): boolean {
  if (!url) return false;
  if (UNSAFE_PROTO.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function createTrackedLinks(
  campaignId: number,
  campaignEmailId: number,
  recipientId: number,
  html: string,
  baseUrl: string
): Promise<string> {
  // Collect unique URLs (deduplicated by original URL so we don't double-store)
  const tokenMap = new Map<string, string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(LINK_RE.source, "gi");

  while ((match = re.exec(html)) !== null) {
    const url = match[2];
    if (!isSafeCampaignUrl(url)) continue;
    if (tokenMap.has(url)) continue;
    const tok = crypto.randomBytes(16).toString("hex");
    tokenMap.set(url, tok);
  }

  if (tokenMap.size === 0) return html;

  // Batch insert tracked links
  for (const [original, tok] of tokenMap.entries()) {
    try {
      await db.execute(
        sql`INSERT INTO campaign_tracked_links
              (campaign_id, campaign_email_id, recipient_id, original_url, token, created_at)
            VALUES
              (${campaignId}, ${campaignEmailId}, ${recipientId}, ${original}, ${tok}, NOW())
            ON CONFLICT (token) DO NOTHING`
      );
    } catch { /* non-critical */ }
  }

  // Rewrite HTML — replace both quote styles
  let result = html;
  for (const [original, tok] of tokenMap.entries()) {
    const trackUrl = `${baseUrl}/api/marketing/track/click/${tok}`;
    result = result.split(`"${original}"`).join(`"${trackUrl}"`);
    result = result.split(`'${original}'`).join(`'${trackUrl}'`);
  }
  return result;
}

export async function resolveTrackedLink(token: string): Promise<string | null> {
  try {
    const res = await db.execute(
      sql`SELECT ctl.campaign_id, ctl.recipient_id, ctl.original_url,
                 cr.contact_id, cr.account_id
          FROM campaign_tracked_links ctl
          LEFT JOIN campaign_recipients cr ON cr.id = ctl.recipient_id
          WHERE ctl.token = ${token}
          LIMIT 1`
    );
    const row = res.rows[0] as any;
    if (!row) return null;

    const originalUrl = row.original_url as string;
    if (!isSafeCampaignUrl(originalUrl)) return null;

    const meta = JSON.stringify({ original_url: originalUrl, link_token: token });

    // Fire-and-forget click event + count updates + Phase 9 branching rule evaluation
    db.execute(
      sql`INSERT INTO campaign_events
            (campaign_id, recipient_id, contact_id, account_id, event_type, event_timestamp, metadata)
          VALUES
            (${row.campaign_id}, ${row.recipient_id}, ${row.contact_id}, ${row.account_id},
             'clicked', NOW(), ${meta}::jsonb)`
    )
      .then(() =>
        db.execute(
          sql`UPDATE campaign_recipients
              SET clicked_count = clicked_count + 1, updated_at = NOW()
              WHERE id = ${row.recipient_id}`
        )
      )
      .then(() =>
        db.execute(
          sql`UPDATE marketing_campaigns
              SET clicked_count = (
                SELECT COUNT(DISTINCT recipient_id)
                FROM campaign_events
                WHERE campaign_id = ${row.campaign_id} AND event_type = 'clicked'
              ), updated_at = NOW()
              WHERE id = ${row.campaign_id}`
        )
      )
      .then(() => {
        // Phase 9: evaluate clicked_link branching rules
        import("./campaign-branching-automation").then(({ evaluateRulesForRecipient }) => {
          evaluateRulesForRecipient(Number(row.recipient_id), {
            triggerType: "clicked_link",
            triggerValue: originalUrl,
            contactId: row.contact_id ? Number(row.contact_id) : null,
            accountId: row.account_id ? Number(row.account_id) : null,
            campaignId: Number(row.campaign_id),
          }).catch(() => {});
        }).catch(() => {});
      })
      .catch(() => {});

    return originalUrl;
  } catch (err) {
    console.error("[campaign-tracking] resolveTrackedLink error:", err);
    return null;
  }
}

// ── Account / contact engagement rollup ───────────────────────────────────────

export async function getAccountCampaignEngagement(accountId: number) {
  const res = await db.execute(
    sql`SELECT
          COUNT(DISTINCT cr.id)::int              AS total_recipients,
          COUNT(DISTINCT cr.contact_id)::int      AS stakeholders_contacted,
          COUNT(DISTINCT ce_o.recipient_id)::int  AS unique_openers,
          COUNT(DISTINCT ce_c.recipient_id)::int  AS unique_clickers,
          COUNT(DISTINCT ce_r.recipient_id)::int  AS unique_repliers,
          COUNT(DISTINCT ce_u.recipient_id)::int  AS unsubscribes,
          MAX(ce.event_timestamp)                 AS latest_engagement
        FROM campaign_recipients cr
        LEFT JOIN campaign_events ce   ON ce.recipient_id = cr.id
        LEFT JOIN campaign_events ce_o ON ce_o.recipient_id = cr.id AND ce_o.event_type = 'opened'
        LEFT JOIN campaign_events ce_c ON ce_c.recipient_id = cr.id AND ce_c.event_type = 'clicked'
        LEFT JOIN campaign_events ce_r ON ce_r.recipient_id = cr.id AND ce_r.event_type = 'replied'
        LEFT JOIN campaign_events ce_u ON ce_u.recipient_id = cr.id AND ce_u.event_type = 'unsubscribed'
        WHERE cr.account_id = ${accountId}`
  );
  return (res.rows[0] as any) ?? {};
}

export async function getContactCampaignEngagement(contactId: number) {
  const res = await db.execute(
    sql`SELECT
          COUNT(DISTINCT cr.campaign_id)::int AS campaigns_received,
          MAX(cr.last_sent_at)                AS last_campaign_sent,
          SUM(cr.opened_count)::int           AS total_opens,
          SUM(cr.clicked_count)::int          AS total_clicks,
          MAX(cr.replied_at)                  AS last_replied_at,
          MAX(cr.unsubscribed_at)             AS unsubscribed_at,
          (SELECT COUNT(*)::int FROM campaign_suppression s WHERE s.email = ANY(
            SELECT email FROM campaign_recipients WHERE contact_id = ${contactId} LIMIT 1
          )) AS is_suppressed
        FROM campaign_recipients cr
        WHERE cr.contact_id = ${contactId}`
  );
  return (res.rows[0] as any) ?? {};
}
