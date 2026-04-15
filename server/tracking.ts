/**
 * Email Engagement Tracking Service
 *
 * Privacy-safe architecture:
 *  - IP addresses are HMAC-SHA256 hashed (16 hex chars), never stored raw
 *  - Bot detection filters prefetchers, crawlers, mail proxies
 *  - Rapid duplicate opens (same ip_hash within DEDUPE_WINDOW_SECS) are
 *    recorded but flagged is_duplicate=true — not counted as meaningful opens
 *  - Opens are treated as soft signals (email image loads, not guaranteed reads)
 */
import crypto from "crypto";
import { db } from "./db";
import { sql } from "drizzle-orm";

// ── Configuration ──────────────────────────────────────────────────────────────
const IP_HASH_SALT = process.env.TRACKING_SALT || "vs_tracking_salt_2026";

/**
 * If the same ip_hash opens the same pixel within this window (seconds)
 * we flag the new event as is_duplicate=true.
 * "Clearly separate" opens (e.g. opened tomorrow) are still counted.
 */
const DEDUPE_WINDOW_SECS = 60;

// ── Bot user-agent patterns ────────────────────────────────────────────────────
const BOT_UA_PATTERNS: RegExp[] = [
  // Mail proxy / image pre-fetchers (biggest source of false opens)
  /googleimageproxy/i,
  /yahoo.*mail/i,
  /yahooysmtp/i,
  /outlook.*safelin/i,
  /safelinks\.protection\.outlook/i,
  /applemail.*prefetch/i,
  /apple.*mail/i,         // Apple MPP privacy relay (iOS 15+)
  /thunderbird/i,
  /mailtrack/i,
  /litmus/i,
  /email.*preview/i,
  /preview.*email/i,
  /returnpath/i,
  // Marketing / ESP crawlers
  /hubspot.*bot/i,
  /marketo/i,
  /mailchimp/i,
  /sendgrid/i,
  /constantcontact/i,
  // Generic crawlers
  /bot\b/i,
  /spider\b/i,
  /crawler\b/i,
  /\bscan\b/i,
  // Headless / automation
  /HeadlessChrome/i,
  /Puppeteer/i,
  /Playwright/i,
  /PhantomJS/i,
  // Social media link previews
  /Slackbot/i,
  /Twitterbot/i,
  /facebookexternalhit/i,
  /LinkedInBot/i,
  /WhatsApp/i,
  // Empty UA
  /^\s*$/,
];

// ── Public Helpers ─────────────────────────────────────────────────────────────

/** Generate a unique tracking token (UUID v4) */
export function generateTrackingId(): string {
  return crypto.randomUUID();
}

/**
 * Hash an IP address using HMAC-SHA256 with a server-side salt.
 * Returns 16 hex chars — enough for same-source deduplication, not
 * re-identifiable without the salt.
 */
export function hashIp(ip: string): string {
  return crypto.createHmac("sha256", IP_HASH_SALT).update(ip).digest("hex").slice(0, 16);
}

/** Returns true if the user-agent belongs to a known bot / mail proxy */
export function isBotUserAgent(ua: string | undefined | null): boolean {
  if (!ua || ua.trim() === "") return true;
  return BOT_UA_PATTERNS.some(pattern => pattern.test(ua));
}

/**
 * Inject tracking pixel and rewrite external links in an HTML email body.
 * Always non-fatal — returns original HTML on any error.
 *
 * What it does:
 *  1. Rewrites <a href="https://..."> → tracked redirect /track/click/:id?url=...
 *     (skips already-tracked links and internal anchors)
 *  2. Appends a 1×1 GIF tracking pixel before </body> (or at the end)
 */
export function injectTracking(html: string, trackingId: string, baseUrl: string): string {
  try {
    // 1. Rewrite outbound links
    const tracked = html.replace(
      /<a\s+([^>]*?)href=["'](https?:\/\/[^"']+)["']([^>]*)>/gi,
      (match, pre, url, post) => {
        if (url.includes("/track/")) return match; // already tracked
        const encoded = encodeURIComponent(url);
        const trackedUrl = `${baseUrl}/track/click/${trackingId}?url=${encoded}`;
        return `<a ${pre}href="${trackedUrl}"${post}>`;
      }
    );

    // 2. Append 1x1 pixel
    const pixel = `<img src="${baseUrl}/track/open/${trackingId}" width="1" height="1" `
      + `style="display:none;border:0;outline:none;text-decoration:none" alt="" />`;

    if (/<\/body>/i.test(tracked)) {
      return tracked.replace(/<\/body>/i, `${pixel}</body>`);
    }
    return tracked + pixel;
  } catch {
    return html; // fail-safe
  }
}

// ── Event Recording ────────────────────────────────────────────────────────────

/**
 * Record an open event from a tracking pixel load.
 * - Detects bots (is_bot=true)
 * - Detects rapid duplicates within DEDUPE_WINDOW_SECS from same ip_hash (is_duplicate=true)
 * - Fires downstream effects only for first meaningful open (not bot, not duplicate)
 */
export async function recordOpen(
  trackingId: string,
  ip: string | undefined,
  userAgent: string | undefined
): Promise<void> {
  const bot = isBotUserAgent(userAgent);
  const ipHash = ip ? hashIp(ip) : null;

  try {
    // Look up pixel record (non-fatal if missing — token may be unknown)
    const pixel = await getPixel(trackingId);
    const emailMessageId = pixel?.email_message_id_fk ?? null;
    const recipientEmail = pixel?.recipient_email ?? null;

    // Metadata
    const meta: Record<string, unknown> = {};
    if (userAgent) meta.uaParsed = classifyUa(userAgent);

    // Insert first, then post-insert dedupe (race-safe: no TOCTOU window)
    await db.execute(sql.raw(`
      INSERT INTO email_engagement_events
        (tracking_id, event_type, ip_hash, user_agent, is_bot, is_duplicate,
         email_message_id, recipient_email, metadata, occurred_at, timeline_created)
      VALUES (
        '${esc(trackingId)}',
        'open',
        ${ipHash ? `'${esc(ipHash)}'` : "NULL"},
        ${userAgent ? `'${esc(userAgent.slice(0, 500))}'` : "NULL"},
        ${bot},
        false,
        ${emailMessageId ?? "NULL"},
        ${recipientEmail ? `'${esc(recipientEmail)}'` : "NULL"},
        ${Object.keys(meta).length ? `'${esc(JSON.stringify(meta))}'::jsonb` : "NULL"},
        NOW(),
        false
      )
    `));

    // Post-insert: mark all events for this source+window EXCEPT the earliest as duplicates.
    // This is atomic (UPDATE affects already-committed rows) and handles concurrent inserts.
    if (!bot && ipHash) {
      await db.execute(sql.raw(`
        UPDATE email_engagement_events
        SET is_duplicate = true
        WHERE tracking_id = '${esc(trackingId)}'
          AND event_type = 'open'
          AND ip_hash = '${esc(ipHash)}'
          AND is_bot = false
          AND occurred_at > NOW() - INTERVAL '${DEDUPE_WINDOW_SECS} seconds'
          AND id != (
            SELECT id FROM email_engagement_events
            WHERE tracking_id = '${esc(trackingId)}'
              AND event_type = 'open'
              AND ip_hash = '${esc(ipHash)}'
              AND is_bot = false
              AND occurred_at > NOW() - INTERVAL '${DEDUPE_WINDOW_SECS} seconds'
            ORDER BY occurred_at ASC, id ASC
            LIMIT 1
          )
      `));
    }

    // Fire downstream for real opens only — check after dedupe marking
    if (!bot) {
      const [dupeFlag] = (await db.execute(sql.raw(`
        SELECT is_duplicate FROM email_engagement_events
        WHERE tracking_id = '${esc(trackingId)}'
          AND event_type = 'open'
          AND ip_hash = ${ipHash ? `'${esc(ipHash)}'` : "NULL"}
          AND is_bot = false
        ORDER BY occurred_at DESC, id DESC
        LIMIT 1
      `))).rows as any[];
      if (!dupeFlag?.is_duplicate) {
        await fireEngagementEffects(trackingId, "open");
      }
    }
  } catch (err) {
    console.error("[tracking] recordOpen error:", err);
  }
}

/**
 * Record a click event from a tracked link redirect.
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
    const pixel = await getPixel(trackingId);
    const emailMessageId = pixel?.email_message_id_fk ?? null;
    const recipientEmail = pixel?.recipient_email ?? null;

    const meta: Record<string, unknown> = {};
    if (url) {
      try {
        const parsed = new URL(url);
        meta.domain = parsed.hostname;
        meta.path = parsed.pathname;
      } catch { /* ignore */ }
    }

    // Insert first (race-safe), then post-insert dedupe
    await db.execute(sql.raw(`
      INSERT INTO email_engagement_events
        (tracking_id, event_type, url, ip_hash, user_agent, is_bot, is_duplicate,
         email_message_id, recipient_email, metadata, occurred_at, timeline_created)
      VALUES (
        '${esc(trackingId)}',
        'click',
        ${url ? `'${esc(url.slice(0, 2000))}'` : "NULL"},
        ${ipHash ? `'${esc(ipHash)}'` : "NULL"},
        ${userAgent ? `'${esc(userAgent.slice(0, 500))}'` : "NULL"},
        ${bot},
        false,
        ${emailMessageId ?? "NULL"},
        ${recipientEmail ? `'${esc(recipientEmail)}'` : "NULL"},
        ${Object.keys(meta).length ? `'${esc(JSON.stringify(meta))}'::jsonb` : "NULL"},
        NOW(),
        false
      )
    `));

    // Post-insert: mark same source+url click duplicates within the window
    if (!bot && ipHash && url) {
      await db.execute(sql.raw(`
        UPDATE email_engagement_events
        SET is_duplicate = true
        WHERE tracking_id = '${esc(trackingId)}'
          AND event_type = 'click'
          AND ip_hash = '${esc(ipHash)}'
          AND url = '${esc(url.slice(0, 2000))}'
          AND is_bot = false
          AND occurred_at > NOW() - INTERVAL '${DEDUPE_WINDOW_SECS} seconds'
          AND id != (
            SELECT id FROM email_engagement_events
            WHERE tracking_id = '${esc(trackingId)}'
              AND event_type = 'click'
              AND ip_hash = '${esc(ipHash)}'
              AND url = '${esc(url.slice(0, 2000))}'
              AND is_bot = false
              AND occurred_at > NOW() - INTERVAL '${DEDUPE_WINDOW_SECS} seconds'
            ORDER BY occurred_at ASC, id ASC
            LIMIT 1
          )
      `));
    }

    // Fire downstream only for real, non-duplicate clicks
    if (!bot) {
      const [dupeFlag] = (await db.execute(sql.raw(`
        SELECT is_duplicate FROM email_engagement_events
        WHERE tracking_id = '${esc(trackingId)}'
          AND event_type = 'click'
          AND ip_hash = ${ipHash ? `'${esc(ipHash)}'` : "NULL"}
          AND is_bot = false
        ORDER BY occurred_at DESC, id DESC
        LIMIT 1
      `))).rows as any[];
      if (!dupeFlag?.is_duplicate) {
        await fireEngagementEffects(trackingId, "click", url);
      }
    }
  } catch (err) {
    console.error("[tracking] recordClick error:", err);
  }
}

// ── Stats ──────────────────────────────────────────────────────────────────────

export type EngagementStats = {
  opens: number;
  /** Non-bot, non-duplicate opens — the meaningful signal */
  uniqueOpens: number;
  clicks: number;
  uniqueClicks: number;
  firstOpenAt: string | null;
  lastOpenAt: string | null;
  events: Array<{
    eventType: string;
    url: string | null;
    isBot: boolean;
    isDuplicate: boolean;
    occurredAt: string;
    metadata: Record<string, unknown> | null;
  }>;
};

/** Get engagement summary for a given tracking token */
export async function getEngagementStats(trackingId: string): Promise<EngagementStats> {
  const [stats] = (await db.execute(sql.raw(`
    SELECT
      COUNT(*)                                                              AS opens_total,
      COUNT(*) FILTER (WHERE event_type = 'open'
                         AND is_bot = false AND is_duplicate = false)      AS unique_opens,
      COUNT(*) FILTER (WHERE event_type = 'click')                        AS clicks_total,
      COUNT(*) FILTER (WHERE event_type = 'click'
                         AND is_bot = false AND is_duplicate = false)      AS unique_clicks,
      MIN(occurred_at) FILTER (WHERE event_type = 'open'
                                 AND is_bot = false AND is_duplicate = false) AS first_open_at,
      MAX(occurred_at) FILTER (WHERE event_type = 'open'
                                 AND is_bot = false AND is_duplicate = false) AS last_open_at
    FROM email_engagement_events
    WHERE tracking_id = '${esc(trackingId)}'
      AND event_type = 'open'
  `))).rows as any[];

  // Clicks are counted separately for the totals
  const [clickStats] = (await db.execute(sql.raw(`
    SELECT
      COUNT(*)                                                              AS clicks_total,
      COUNT(*) FILTER (WHERE is_bot = false AND is_duplicate = false)      AS unique_clicks
    FROM email_engagement_events
    WHERE tracking_id = '${esc(trackingId)}'
      AND event_type = 'click'
  `))).rows as any[];

  const eventRows = (await db.execute(sql.raw(`
    SELECT event_type, url, is_bot, is_duplicate, metadata, occurred_at
    FROM email_engagement_events
    WHERE tracking_id = '${esc(trackingId)}'
    ORDER BY occurred_at DESC
    LIMIT 50
  `))).rows as any[];

  return {
    opens: Number(stats?.opens_total || 0),
    uniqueOpens: Number(stats?.unique_opens || 0),
    clicks: Number(clickStats?.clicks_total || 0),
    uniqueClicks: Number(clickStats?.unique_clicks || 0),
    firstOpenAt: stats?.first_open_at ?? null,
    lastOpenAt: stats?.last_open_at ?? null,
    events: eventRows.map(e => ({
      eventType: e.event_type,
      url: e.url ?? null,
      isBot: Boolean(e.is_bot),
      isDuplicate: Boolean(e.is_duplicate),
      occurredAt: e.occurred_at,
      metadata: e.metadata ?? null,
    })),
  };
}

// ── Internal helpers ───────────────────────────────────────────────────────────

async function getPixel(trackingId: string): Promise<{
  tracking_id: string;
  gmail_message_id: string | null;
  email_message_id_fk: number | null;
  subject: string | null;
  recipient_email: string | null;
  sent_by_user_id: number | null;
} | null> {
  // Join with email_messages to get internal DB id
  const [row] = (await db.execute(sql.raw(`
    SELECT
      p.tracking_id,
      p.gmail_message_id,
      p.subject,
      p.recipient_email,
      p.sent_by_user_id,
      m.id AS email_message_id_fk
    FROM email_tracking_pixels p
    LEFT JOIN email_messages m ON m.gmail_message_id = p.gmail_message_id
    WHERE p.tracking_id = '${esc(trackingId)}'
    LIMIT 1
  `))).rows as any[];
  return row ?? null;
}

function classifyUa(ua: string): string {
  if (/mobile|android|iphone|ipad/i.test(ua)) return "mobile";
  if (/windows|macintosh|linux/i.test(ua)) return "desktop";
  return "unknown";
}

async function fireEngagementEffects(
  trackingId: string, eventType: "open" | "click", url?: string
): Promise<void> {
  try {
    const pixel = await getPixel(trackingId);
    if (!pixel) return;

    // Count meaningful events of this type (bot=false, duplicate=false)
    const [countRow] = (await db.execute(sql.raw(`
      SELECT COUNT(*) AS cnt FROM email_engagement_events
      WHERE tracking_id = '${esc(trackingId)}'
        AND event_type = '${eventType}'
        AND is_bot = false
        AND is_duplicate = false
    `))).rows as any[];
    const eventCount = Number(countRow?.cnt || 0);

    const isFirst = eventCount === 1;

    // Create timeline activities on linked CRM records (first event only)
    if (isFirst) {
      await createEngagementTimelineEvents(pixel, eventType, url);
    }

    // Table-driven automation rules (non-fatal)
    await processEngagementRules(pixel, eventType, url, eventCount);
  } catch (err) {
    console.error("[tracking] fireEngagementEffects error:", err);
  }
}

async function createEngagementTimelineEvents(
  pixel: NonNullable<Awaited<ReturnType<typeof getPixel>>>,
  eventType: "open" | "click",
  url?: string
): Promise<void> {
  if (!pixel.gmail_message_id) return;

  const messageDbId = pixel.email_message_id_fk;

  let summary: string;
  if (eventType === "open") {
    summary = `Email opened — "${pixel.subject || "(no subject)"}" sent to ${pixel.recipient_email || "unknown"} (soft signal: image loaded)`;
  } else {
    summary = `Link clicked in "${pixel.subject || "(no subject)"}"${url ? ` → ${url.slice(0, 80)}` : ""}`;
  }

  // Find all CRM records linked to this email message
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
        AND is_duplicate = false
      ORDER BY occurred_at ASC
      LIMIT 1
    )
  `));
}

async function processEngagementRules(
  pixel: NonNullable<Awaited<ReturnType<typeof getPixel>>>,
  eventType: "open" | "click",
  url: string | undefined,
  eventCount: number
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
      const dedupeKey = `eng_${pixel.tracking_id}_${eventType}_rule${rule.id}_n${eventCount}`;

      // ON CONFLICT DO NOTHING for idempotency
      await db.execute(sql.raw(`
        INSERT INTO notifications
          (user_id, type, title, body, severity, action_url, is_read, dedupe_key, created_at)
        VALUES (
          ${pixel.sent_by_user_id},
          'email_engagement',
          '${esc(eventType === "open"
            ? `Email opened: ${subject}`
            : `Link clicked in: ${subject}`)}',
          '${esc(eventType === "open"
            ? `${pixel.recipient_email || "Recipient"} opened your email (open #${eventCount} — soft signal)`
            : `${pixel.recipient_email || "Recipient"} clicked a link${url ? `: ${url.slice(0, 80)}` : ""}`)}',
          '${eventType === "click" ? "high" : "medium"}',
          '/inbox',
          false,
          '${esc(dedupeKey)}',
          NOW()
        )
        ON CONFLICT (dedupe_key) DO NOTHING
      `));
    }

    if (rule.action_type === "create_task" && pixel.sent_by_user_id) {
      const config = (rule.action_config as any) || {};
      const taskTitle = config.taskTitle
        ? String(config.taskTitle).replace("{subject}", pixel.subject || "email")
        : `Follow up on: ${pixel.subject || "email"}`;
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + (Number(config.dueDays) || 1));

      // Simple existence check to prevent duplicates
      const [exists] = (await db.execute(sql.raw(`
        SELECT id FROM tasks
        WHERE title = '${esc(taskTitle)}'
          AND assigned_to_user_id = ${pixel.sent_by_user_id}
          AND created_at > NOW() - INTERVAL '1 day'
        LIMIT 1
      `))).rows as any[];
      if (exists) continue;

      await db.execute(sql.raw(`
        INSERT INTO tasks (title, status, priority, assigned_to_user_id, due_date, source, source_label, created_at)
        VALUES (
          '${esc(taskTitle)}',
          'pending',
          '${esc(String(config.priority || "medium"))}',
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

// ── SQL string escape helper ───────────────────────────────────────────────────
function esc(s: string): string {
  return String(s).replace(/'/g, "''");
}
