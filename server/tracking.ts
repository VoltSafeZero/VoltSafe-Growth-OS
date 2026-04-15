/**
 * Email Engagement Tracking Service
 * Privacy-safe: IPs are hashed, bot detection filters prefetchers
 */
import crypto from "crypto";
import { db } from "./db";
import { sql } from "drizzle-orm";

// ── Constants ─────────────────────────────────────────────────────────────────
const IP_HASH_SALT = process.env.TRACKING_SALT || "vs_tracking_salt_2026";

const BOT_UA_PATTERNS = [
  /googleimageproxy/i,
  /yahoo.*mail/i,
  /outlook.*safelin/i,
  /applemail.*prefetch/i,
  /thunderbird/i,
  /mailtrack/i,
  /litmus/i,
  /email.*preview/i,
  /preview.*email/i,
  /hubspot.*bot/i,
  /marketo/i,
  /mailchimp/i,
  /sendgrid/i,
  /^\s*$/,
  /bot\b/i,
  /spider\b/i,
  /crawler\b/i,
  /\bscan\b/i,
  /HeadlessChrome/i,
  /Slackbot/i,
  /Twitterbot/i,
  /facebookexternalhit/i,
];

// ── Helpers ───────────────────────────────────────────────────────────────────

export function generateTrackingId(): string {
  return crypto.randomUUID();
}

export function hashIp(ip: string): string {
  return crypto.createHmac("sha256", IP_HASH_SALT).update(ip).digest("hex").slice(0, 16);
}

export function isBotUserAgent(ua: string | undefined | null): boolean {
  if (!ua) return true;
  return BOT_UA_PATTERNS.some(pattern => pattern.test(ua));
}

/**
 * Inject tracking pixel and rewrite links in HTML body.
 * Returns the modified HTML. Fails silently if something goes wrong.
 */
export function injectTracking(html: string, trackingId: string, baseUrl: string): string {
  try {
    // 1. Rewrite <a href="..."> links → tracked redirect
    const tracked = html.replace(
      /<a\s+([^>]*?)href=["'](https?:\/\/[^"']+)["']([^>]*)>/gi,
      (match, pre, url, post) => {
        if (url.includes("/track/")) return match; // already tracked
        const encoded = encodeURIComponent(url);
        const trackedUrl = `${baseUrl}/track/click/${trackingId}?url=${encoded}`;
        return `<a ${pre}href="${trackedUrl}"${post}>`;
      }
    );

    // 2. Append tracking pixel before </body> or at end
    const pixel = `<img src="${baseUrl}/track/open/${trackingId}.gif" width="1" height="1" style="display:none;border:0;outline:none;text-decoration:none" alt="" />`;

    if (/<\/body>/i.test(tracked)) {
      return tracked.replace(/<\/body>/i, `${pixel}</body>`);
    }
    return tracked + pixel;
  } catch {
    return html; // fail safe — return original
  }
}

/**
 * Record an open event. Returns the event ID.
 * Automatically detects bots and fires downstream effects for real opens.
 */
export async function recordOpen(
  trackingId: string,
  ip: string | undefined,
  userAgent: string | undefined
): Promise<void> {
  const bot = isBotUserAgent(userAgent);
  const ipHash = ip ? hashIp(ip) : null;

  try {
    await db.execute(sql.raw(`
      INSERT INTO email_engagement_events (tracking_id, event_type, ip_hash, user_agent, is_bot, timeline_created)
      VALUES (
        '${esc(trackingId)}',
        'open',
        ${ipHash ? `'${esc(ipHash)}'` : "NULL"},
        ${userAgent ? `'${esc(userAgent.slice(0, 500))}'` : "NULL"},
        ${bot},
        false
      )
    `));

    if (!bot) {
      await fireEngagementEffects(trackingId, "open");
    }
  } catch (err) {
    console.error("[tracking] recordOpen error:", err);
  }
}

/**
 * Record a click event.
 */
export async function recordClick(
  trackingId: string,
  url: string | undefined,
  ip: string | undefined,
  userAgent: string | undefined
): Promise<void> {
  const bot = isBotUserAgent(userAgent);
  const ipHash = ip ? hashIp(ip) : null;

  try {
    await db.execute(sql.raw(`
      INSERT INTO email_engagement_events (tracking_id, event_type, url, ip_hash, user_agent, is_bot, timeline_created)
      VALUES (
        '${esc(trackingId)}',
        'click',
        ${url ? `'${esc(url.slice(0, 2000))}'` : "NULL"},
        ${ipHash ? `'${esc(ipHash)}'` : "NULL"},
        ${userAgent ? `'${esc(userAgent.slice(0, 500))}'` : "NULL"},
        ${bot},
        false
      )
    `));

    if (!bot) {
      await fireEngagementEffects(trackingId, "click", url);
    }
  } catch (err) {
    console.error("[tracking] recordClick error:", err);
  }
}

/** Get engagement summary for a tracking ID */
export async function getEngagementStats(trackingId: string): Promise<{
  opens: number; uniqueOpens: number; clicks: number; uniqueClicks: number;
  firstOpenAt: string | null; lastOpenAt: string | null;
  events: Array<{ eventType: string; url: string | null; isBot: boolean; occurredAt: string }>;
}> {
  const [stats] = (await db.execute(sql.raw(`
    SELECT
      COUNT(*) FILTER (WHERE event_type = 'open') AS opens,
      COUNT(*) FILTER (WHERE event_type = 'open' AND is_bot = false) AS unique_opens,
      COUNT(*) FILTER (WHERE event_type = 'click') AS clicks,
      COUNT(*) FILTER (WHERE event_type = 'click' AND is_bot = false) AS unique_clicks,
      MIN(occurred_at) FILTER (WHERE event_type = 'open' AND is_bot = false) AS first_open_at,
      MAX(occurred_at) FILTER (WHERE event_type = 'open' AND is_bot = false) AS last_open_at
    FROM email_engagement_events
    WHERE tracking_id = '${esc(trackingId)}'
  `))).rows as any[];

  const eventRows = (await db.execute(sql.raw(`
    SELECT event_type, url, is_bot, occurred_at
    FROM email_engagement_events
    WHERE tracking_id = '${esc(trackingId)}'
    ORDER BY occurred_at DESC
    LIMIT 50
  `))).rows as any[];

  return {
    opens: Number(stats?.opens || 0),
    uniqueOpens: Number(stats?.unique_opens || 0),
    clicks: Number(stats?.clicks || 0),
    uniqueClicks: Number(stats?.unique_clicks || 0),
    firstOpenAt: stats?.first_open_at ?? null,
    lastOpenAt: stats?.last_open_at ?? null,
    events: eventRows.map(e => ({
      eventType: e.event_type,
      url: e.url,
      isBot: e.is_bot,
      occurredAt: e.occurred_at,
    })),
  };
}

// ── Internal: downstream effects ──────────────────────────────────────────────

async function fireEngagementEffects(trackingId: string, eventType: "open" | "click", url?: string): Promise<void> {
  try {
    // Load the tracking pixel record
    const [pixel] = (await db.execute(sql.raw(`
      SELECT * FROM email_tracking_pixels WHERE tracking_id = '${esc(trackingId)}' LIMIT 1
    `))).rows as any[];

    if (!pixel) return;

    // Count real events of this type so far (including the one just written)
    const [countRow] = (await db.execute(sql.raw(`
      SELECT COUNT(*) AS cnt FROM email_engagement_events
      WHERE tracking_id = '${esc(trackingId)}' AND event_type = '${eventType}' AND is_bot = false
    `))).rows as any[];
    const eventCount = Number(countRow?.cnt || 0);

    const isFirst = eventCount === 1;

    // Create timeline activity on all linked CRM records (only for first real event)
    if (isFirst) {
      await createEngagementTimelineEvents(pixel, eventType, url);
    }

    // Check automation rules (non-fatal)
    await processEngagementRules(pixel, eventType, url, eventCount);
  } catch (err) {
    console.error("[tracking] fireEngagementEffects error:", err);
  }
}

async function createEngagementTimelineEvents(
  pixel: any, eventType: "open" | "click", url?: string
): Promise<void> {
  // Find linked CRM records via email_associations
  if (!pixel.gmail_message_id) return;

  // Look up the email message
  const [msg] = (await db.execute(sql.raw(`
    SELECT id FROM email_messages WHERE gmail_message_id = '${esc(pixel.gmail_message_id)}' LIMIT 1
  `))).rows as any[];

  const messageDbId = msg?.id;

  let summary: string;
  if (eventType === "open") {
    summary = `Email opened: "${pixel.subject || "(no subject)"}" — sent to ${pixel.recipient_email || "unknown"}`;
  } else {
    summary = `Link clicked in "${pixel.subject || "(no subject)"}"${url ? ` · ${url.slice(0, 80)}` : ""}`;
  }

  // Create activity on each linked record
  let linkedObjects: Array<{ objectType: string; objectId: number }> = [];

  if (messageDbId) {
    const assocRows = (await db.execute(sql.raw(`
      SELECT DISTINCT object_type, object_id FROM email_associations
      WHERE email_message_id = ${messageDbId}
      AND object_type IN ('account', 'contact', 'lead', 'opportunity')
      LIMIT 10
    `))).rows as any[];
    linkedObjects = assocRows.map(r => ({ objectType: r.object_type, objectId: Number(r.object_id) }));
  }

  // Create activity on linked objects
  for (const obj of linkedObjects) {
    await db.execute(sql.raw(`
      INSERT INTO activities (linked_object_type, linked_object_id, type, summary, created_by, created_at)
      VALUES (
        '${esc(obj.objectType)}',
        ${obj.objectId},
        'email_engagement',
        '${esc(summary)}',
        ${pixel.sent_by_user_id ?? "NULL"},
        NOW()
      )
    `));
  }

  // Mark timeline_created on the earliest unprocessed event of this type
  await db.execute(sql.raw(`
    UPDATE email_engagement_events
    SET timeline_created = true
    WHERE id = (
      SELECT id FROM email_engagement_events
      WHERE tracking_id = '${esc(pixel.tracking_id)}'
        AND event_type = '${eventType}'
        AND timeline_created = false
        AND is_bot = false
      ORDER BY occurred_at ASC
      LIMIT 1
    )
  `));
}

async function processEngagementRules(
  pixel: any, eventType: "open" | "click", url: string | undefined, eventCount: number
): Promise<void> {
  const rules = (await db.execute(sql.raw(`
    SELECT * FROM email_engagement_rules
    WHERE is_enabled = true
      AND trigger_type = '${eventType}'
      AND min_events <= ${eventCount}
    ORDER BY min_events ASC
    LIMIT 20
  `))).rows as any[];

  for (const rule of rules) {
    if (rule.action_type === "create_notification" && pixel.sent_by_user_id) {
      const subject = pixel.subject || "(no subject)";
      const dedupeKey = `engagement_${pixel.tracking_id}_${eventType}_rule_${rule.id}_${eventCount}`;

      // Check if we already created this notification
      const [exists] = (await db.execute(sql.raw(`
        SELECT id FROM notifications WHERE dedupe_key = '${esc(dedupeKey)}' LIMIT 1
      `))).rows as any[];
      if (exists) continue;

      const title = eventType === "open"
        ? `Email opened: ${subject}`
        : `Link clicked in: ${subject}`;
      const body = eventType === "open"
        ? `${pixel.recipient_email || "Recipient"} opened your email (${eventCount === 1 ? "first open" : `open #${eventCount}`})`
        : `${pixel.recipient_email || "Recipient"} clicked a link${url ? `: ${url.slice(0, 80)}` : ""}`;

      await db.execute(sql.raw(`
        INSERT INTO notifications (user_id, type, title, body, severity, action_url, is_read, dedupe_key, created_at)
        VALUES (
          ${pixel.sent_by_user_id},
          'email_engagement',
          '${esc(title)}',
          '${esc(body)}',
          '${eventType === "click" ? "high" : "medium"}',
          '/inbox',
          false,
          '${esc(dedupeKey)}',
          NOW()
        )
      `));
    }

    if (rule.action_type === "create_task" && pixel.sent_by_user_id) {
      const config = rule.action_config as any || {};
      const taskTitle = config.taskTitle
        ? config.taskTitle.replace("{subject}", pixel.subject || "email")
        : `Follow up on: ${pixel.subject || "email"}`;
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + (config.dueDays || 1));

      const dedupeKey = `engagement_task_${pixel.tracking_id}_${eventType}_rule_${rule.id}`;
      const [exists] = (await db.execute(sql.raw(`
        SELECT id FROM tasks WHERE title = '${esc(taskTitle)}' AND assigned_to_user_id = ${pixel.sent_by_user_id}
          AND created_at > NOW() - INTERVAL '1 day' LIMIT 1
      `))).rows as any[];
      if (exists) continue;

      await db.execute(sql.raw(`
        INSERT INTO tasks (title, status, priority, assigned_to_user_id, due_date, source, source_label, created_at)
        VALUES (
          '${esc(taskTitle)}',
          'pending',
          '${config.priority || "medium"}',
          ${pixel.sent_by_user_id},
          '${dueDate.toISOString()}',
          'automation',
          'Email Engagement Rule',
          NOW()
        )
      `));
    }
  }
}

// SQL string escape helper
function esc(s: string): string {
  return String(s).replace(/'/g, "''");
}
