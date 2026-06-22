/**
 * Email Engagement Tracking — Core Service
 *
 * Privacy-safe:  IPs are HMAC-SHA256 hashed (16 hex), never stored raw.
 * Bot detection: 30+ UA patterns (mail proxies, crawlers, social previews).
 * Dedupe:        Post-insert atomic UPDATE; rapid same-source events flagged
 *                is_duplicate=true without TOCTOU races.
 * Scoring:       Deterministic, explainable signal scoring stored on pixel row.
 */
import crypto from "crypto";
import { db } from "./db";
import { sql } from "drizzle-orm";

// ── Configuration ──────────────────────────────────────────────────────────────
const IP_HASH_SALT    = process.env.TRACKING_SALT || "vs_tracking_salt_2026";
const DEDUPE_WINDOW   = 60;   // seconds — rapid same-source events within this window = duplicate

// ── Internal domain filter ─────────────────────────────────────────────────────
// Domains whose recipients' opens/clicks must NOT count as customer engagement.
// Override via comma-separated env var: INTERNAL_EMAIL_DOMAINS
export const INTERNAL_DOMAINS: Set<string> = new Set(
  (process.env.INTERNAL_EMAIL_DOMAINS ?? "voltsafe.com,voltsafemarine.com")
    .split(",").map(d => d.trim().toLowerCase()).filter(Boolean)
);

/**
 * Returns true when the given email address belongs to an internal VoltSafe domain.
 * Internal opens/clicks are stored (not deleted) but excluded from all engagement
 * counts, widgets, badges, and scoring via `is_internal IS NOT TRUE` SQL filters.
 */
export function isInternalEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  return INTERNAL_DOMAINS.has(email.slice(at + 1).toLowerCase());
}

/**
 * Returns true when the user-agent string indicates a VoltSafe CMS internal
 * request (e.g. the proxy-image handler fetching a tracking pixel on behalf of
 * an authenticated team member viewing the email in VoltSafe CMS).
 *
 * These events must be stored as is_internal=true so they are excluded from all
 * engagement counts, scores, and "last seen" timestamps.
 */
export function isCmsProxyUserAgent(ua: string | undefined | null): boolean {
  if (!ua) return false;
  return /VoltSafeMailViewer/i.test(ua);
}

// ── Bot UA patterns ────────────────────────────────────────────────────────────
const BOT_UA: RegExp[] = [
  /googleimageproxy/i, /yahoo.*mail/i, /yahooysmtp/i, /yahoo.*slurp/i,
  /outlook.*safelin/i, /safelinks\.protection\.outlook/i,
  /applemail.*prefetch/i, /apple.*mail/i,   // Apple MPP privacy relay
  /thunderbird/i, /mailtrack/i, /litmus/i,
  /email.*preview/i, /preview.*email/i, /returnpath/i,
  /hubspot.*bot/i, /marketo/i, /mailchimp/i, /sendgrid/i, /constantcontact/i,
  /bot\b/i, /spider\b/i, /crawler\b/i, /\bscan\b/i,
  /HeadlessChrome/i, /Puppeteer/i, /Playwright/i, /PhantomJS/i,
  /Slackbot/i, /Twitterbot/i, /facebookexternalhit/i, /LinkedInBot/i, /WhatsApp/i,
  /^\s*$/,
];

// ── Exports ────────────────────────────────────────────────────────────────────

export function generateTrackingId(): string {
  return crypto.randomUUID();
}

export function hashIp(ip: string): string {
  return crypto.createHmac("sha256", IP_HASH_SALT).update(ip).digest("hex").slice(0, 16);
}

export function isBotUserAgent(ua: string | undefined | null): boolean {
  if (!ua || ua.trim() === "") return true;
  return BOT_UA.some(p => p.test(ua));
}

/**
 * Inject tracking pixel + rewrite external links in an HTML email body.
 * Non-fatal — returns original HTML on any error.
 */
export function injectTracking(html: string, trackingId: string, baseUrl: string): string {
  try {
    const tracked = html.replace(
      /<a\s+([^>]*?)href=["'](https?:\/\/[^"']+)["']([^>]*)>/gi,
      (match, pre, url, post) => {
        if (url.includes("/track/")) return match;
        return `<a ${pre}href="${baseUrl}/track/click/${trackingId}?url=${encodeURIComponent(url)}"${post}>`;
      }
    );
    const pixel = `<img src="${baseUrl}/track/open/${trackingId}" `
      + `width="1" height="1" style="display:none;border:0;outline:none;text-decoration:none" alt="" />`;
    return /<\/body>/i.test(tracked)
      ? tracked.replace(/<\/body>/i, `${pixel}</body>`)
      : tracked + pixel;
  } catch {
    return html;
  }
}

// ── Recording ──────────────────────────────────────────────────────────────────

export async function recordOpen(
  trackingId: string,
  ip: string | undefined,
  userAgent: string | undefined,
  opts?: { cmsSession?: boolean }
): Promise<void> {
  const bot    = isBotUserAgent(userAgent);
  const ipHash = ip ? hashIp(ip) : null;

  try {
    const pixel = await getPixel(trackingId);
    const meta: Record<string, unknown> = {};
    if (userAgent) meta.uaParsed = classifyUa(userAgent);

    const isCmsProxy  = isCmsProxyUserAgent(userAgent);
    const isCmsDirect = opts?.cmsSession === true;
    const internal = isInternalEmail(pixel?.recipient_email) || isCmsProxy || isCmsDirect;
    const internalReason = isInternalEmail(pixel?.recipient_email)
      ? `internal_domain:${String(pixel!.recipient_email!).split("@")[1]}`
      : isCmsProxy  ? "cms_proxy_image"
      : isCmsDirect ? "cms_authenticated_session"
      : null;

    // Insert first, then post-insert dedupe (no TOCTOU race)
    await db.execute(sql.raw(`
      INSERT INTO email_engagement_events
        (tracking_id, event_type, ip_hash, user_agent, is_bot, is_duplicate,
         email_message_id, recipient_email, metadata, occurred_at, timeline_created,
         is_internal, internal_reason)
      VALUES (
        '${esc(trackingId)}', 'open',
        ${ipHash ? `'${esc(ipHash)}'` : "NULL"},
        ${userAgent ? `'${esc(userAgent.slice(0, 500))}'` : "NULL"},
        ${bot}, false,
        ${pixel?.email_message_id_fk ?? "NULL"},
        ${pixel?.recipient_email ? `'${esc(pixel.recipient_email)}'` : "NULL"},
        ${Object.keys(meta).length ? `'${esc(JSON.stringify(meta))}'::jsonb` : "NULL"},
        NOW(), false,
        ${internal}, ${internalReason ? `'${esc(internalReason)}'` : "NULL"}
      )
    `));

    if (!bot && !internal && ipHash) {
      await markDuplicates(trackingId, "open", ipHash);
    }

    if (!bot && !internal) {
      const isDupe = await justInsertedIsDuplicate(trackingId, "open", ipHash);
      if (!isDupe) {
        await updateScore(trackingId);
        const { processEngagementRules } = await import("./services/engagement-rules");
        await processEngagementRules(trackingId, "open", undefined, pixel);
      }
    }
  } catch (err) {
    console.error("[tracking] recordOpen error:", err);
  }
}

export async function recordClick(
  trackingId: string,
  url: string | undefined,
  ip: string | undefined,
  userAgent: string | undefined,
  opts?: { cmsSession?: boolean }
): Promise<void> {
  const bot    = isBotUserAgent(userAgent);
  const ipHash = ip ? hashIp(ip) : null;

  try {
    const pixel = await getPixel(trackingId);
    const meta: Record<string, unknown> = {};
    if (url) {
      try { const p = new URL(url); meta.domain = p.hostname; meta.path = p.pathname; } catch { /* */ }
    }

    const isCmsProxy  = isCmsProxyUserAgent(userAgent);
    const isCmsDirect = opts?.cmsSession === true;
    const internal = isInternalEmail(pixel?.recipient_email) || isCmsProxy || isCmsDirect;
    const internalReason = isInternalEmail(pixel?.recipient_email)
      ? `internal_domain:${String(pixel!.recipient_email!).split("@")[1]}`
      : isCmsProxy  ? "cms_proxy_image"
      : isCmsDirect ? "cms_authenticated_session"
      : null;

    await db.execute(sql.raw(`
      INSERT INTO email_engagement_events
        (tracking_id, event_type, url, ip_hash, user_agent, is_bot, is_duplicate,
         email_message_id, recipient_email, metadata, occurred_at, timeline_created,
         is_internal, internal_reason)
      VALUES (
        '${esc(trackingId)}', 'click',
        ${url ? `'${esc(url.slice(0, 2000))}'` : "NULL"},
        ${ipHash ? `'${esc(ipHash)}'` : "NULL"},
        ${userAgent ? `'${esc(userAgent.slice(0, 500))}'` : "NULL"},
        ${bot}, false,
        ${pixel?.email_message_id_fk ?? "NULL"},
        ${pixel?.recipient_email ? `'${esc(pixel.recipient_email)}'` : "NULL"},
        ${Object.keys(meta).length ? `'${esc(JSON.stringify(meta))}'::jsonb` : "NULL"},
        NOW(), false,
        ${internal}, ${internalReason ? `'${esc(internalReason)}'` : "NULL"}
      )
    `));

    if (!bot && !internal && ipHash && url) {
      await markDuplicatesClick(trackingId, ipHash, url);
    }

    if (!bot && !internal) {
      const isDupe = await justInsertedIsDuplicate(trackingId, "click", ipHash);
      if (!isDupe) {
        await updateScore(trackingId);
        const { processEngagementRules } = await import("./services/engagement-rules");
        await processEngagementRules(trackingId, "click", url, pixel);
      }
    }
  } catch (err) {
    console.error("[tracking] recordClick error:", err);
  }
}

// ── Scoring ────────────────────────────────────────────────────────────────────

/**
 * Deterministic scoring model (B2B sales focus):
 *
 * Opens (soft signal — image loads, not guaranteed reads):
 *   1 unique open   →  10 pts  (low signal)
 *   2 unique opens  →  20 pts  (medium signal)
 *   3+ unique opens →  30 pts  (stronger interest)
 *
 * Clicks (strong signal — deliberate action):
 *   1 unique click  →  +40 pts
 *   2+ unique clicks → +55 pts  (very high intent)
 *
 * Signal levels:
 *   0       → 'none'
 *   1–15    → 'low'     (opened once)
 *   16–35   → 'medium'  (opened multiple times)
 *   36–74   → 'high'    (clicked)
 *   75+     → 'hot'     (clicked + multiple opens)
 *
 * is_hot  → score ≥ 70  OR  (uniqueOpens ≥ 3 AND uniqueClicks ≥ 1)
 */
export function computeScore(uniqueOpens: number, uniqueClicks: number): {
  score: number; signalLevel: "none" | "low" | "medium" | "high" | "hot"; isHot: boolean;
} {
  let score = 0;
  if (uniqueOpens === 1)      score += 10;
  else if (uniqueOpens === 2) score += 20;
  else if (uniqueOpens >= 3)  score += 30;

  if (uniqueClicks === 1)      score += 40;
  else if (uniqueClicks >= 2)  score += 55;

  const isHot = score >= 70 || (uniqueOpens >= 3 && uniqueClicks >= 1);
  let signalLevel: "none" | "low" | "medium" | "high" | "hot";
  if (score === 0)      signalLevel = "none";
  else if (score <= 15) signalLevel = "low";
  else if (score <= 35) signalLevel = "medium";
  else if (score <= 74) signalLevel = "high";
  else                  signalLevel = "hot";

  if (isHot && signalLevel !== "hot") signalLevel = "hot";

  return { score, signalLevel, isHot };
}

export async function updateScore(trackingId: string): Promise<void> {
  try {
    const [counts] = (await db.execute(sql.raw(`
      SELECT
        COUNT(*) FILTER (WHERE event_type='open'  AND is_bot=false AND is_duplicate=false AND is_internal IS NOT TRUE) AS u_opens,
        COUNT(*) FILTER (WHERE event_type='click' AND is_bot=false AND is_duplicate=false AND is_internal IS NOT TRUE) AS u_clicks
      FROM email_engagement_events
      WHERE tracking_id = '${esc(trackingId)}'
    `))).rows as any[];

    const { score, signalLevel, isHot } = computeScore(
      Number(counts?.u_opens || 0), Number(counts?.u_clicks || 0)
    );

    // Preserve 'replied' signal level if the thread already has a reply — it outranks all
    await db.execute(sql.raw(`
      UPDATE email_tracking_pixels
      SET engagement_score = ${score},
          signal_level     = CASE WHEN is_replied = true THEN 'replied' ELSE '${signalLevel}' END,
          is_hot           = ${isHot},
          last_scored_at   = NOW()
      WHERE tracking_id = '${esc(trackingId)}'
    `));
  } catch (err) {
    console.error("[tracking] updateScore error:", err);
  }
}

// ── Stats ──────────────────────────────────────────────────────────────────────

export type EngagementStats = {
  opens: number;
  uniqueOpens: number;
  clicks: number;
  uniqueClicks: number;
  firstOpenAt: string | null;
  lastOpenAt: string | null;
  score: number;
  signalLevel: string;
  isHot: boolean;
  isReplied: boolean;
  events: Array<{
    eventType: string; url: string | null;
    isBot: boolean; isDuplicate: boolean;
    occurredAt: string; metadata: Record<string, unknown> | null;
  }>;
};

export async function getEngagementStats(trackingId: string): Promise<EngagementStats> {
  const [opens] = (await db.execute(sql.raw(`
    SELECT
      COUNT(*)                                                                                          AS opens_total,
      COUNT(*) FILTER (WHERE is_bot=false AND is_duplicate=false AND is_internal IS NOT TRUE)          AS unique_opens,
      MIN(occurred_at) FILTER (WHERE is_bot=false AND is_duplicate=false AND is_internal IS NOT TRUE)  AS first_open_at,
      MAX(occurred_at) FILTER (WHERE is_bot=false AND is_duplicate=false AND is_internal IS NOT TRUE)  AS last_open_at
    FROM email_engagement_events
    WHERE tracking_id='${esc(trackingId)}' AND event_type='open'
  `))).rows as any[];

  const [clicks] = (await db.execute(sql.raw(`
    SELECT
      COUNT(*)                                                                                          AS clicks_total,
      COUNT(*) FILTER (WHERE is_bot=false AND is_duplicate=false AND is_internal IS NOT TRUE)          AS unique_clicks
    FROM email_engagement_events
    WHERE tracking_id='${esc(trackingId)}' AND event_type='click'
  `))).rows as any[];

  const [pixel] = (await db.execute(sql.raw(`
    SELECT engagement_score, signal_level, is_hot, is_replied
    FROM email_tracking_pixels
    WHERE tracking_id='${esc(trackingId)}'
    LIMIT 1
  `))).rows as any[];

  const evRows = (await db.execute(sql.raw(`
    SELECT event_type, url, is_bot, is_duplicate, metadata, occurred_at
    FROM email_engagement_events
    WHERE tracking_id='${esc(trackingId)}'
    ORDER BY occurred_at DESC LIMIT 50
  `))).rows as any[];

  return {
    opens:        Number(opens?.opens_total  || 0),
    uniqueOpens:  Number(opens?.unique_opens || 0),
    clicks:       Number(clicks?.clicks_total  || 0),
    uniqueClicks: Number(clicks?.unique_clicks || 0),
    firstOpenAt:  opens?.first_open_at  ?? null,
    lastOpenAt:   opens?.last_open_at   ?? null,
    score:        Number(pixel?.engagement_score || 0),
    signalLevel:  pixel?.signal_level || "none",
    isHot:        Boolean(pixel?.is_hot),
    isReplied:    Boolean(pixel?.is_replied),
    events: evRows.map(e => ({
      eventType:   e.event_type,
      url:         e.url ?? null,
      isBot:       Boolean(e.is_bot),
      isDuplicate: Boolean(e.is_duplicate),
      occurredAt:  e.occurred_at,
      metadata:    e.metadata ?? null,
    })),
  };
}

// ── Reply detection ────────────────────────────────────────────────────────────
/**
 * Mark tracking pixels as replied when a thread receives a real inbound reply.
 * Called by computeAwaitingReply for all threads that have a last_inbound_at.
 * The "replied" signal level outranks all other signals.
 */
export async function processReplyForThread(gmailThreadId: string): Promise<void> {
  try {
    // Find outbound tracking pixels for messages in this thread
    const pixels = (await db.execute(sql.raw(`
      SELECT p.tracking_id, p.created_at AS pixel_created_at
      FROM email_tracking_pixels p
      JOIN email_messages m ON m.gmail_message_id = p.gmail_message_id
      WHERE m.gmail_thread_id = '${esc(gmailThreadId)}'
        AND m.direction = 'outbound'
        AND p.is_replied = false
    `))).rows as any[];

    if (pixels.length === 0) return;

    // Get the earliest inbound message sent AFTER the pixel's created_at
    for (const pixel of pixels) {
      const [inbound] = (await db.execute(sql.raw(`
        SELECT sent_at FROM email_messages
        WHERE gmail_thread_id = '${esc(gmailThreadId)}'
          AND direction = 'inbound'
          AND from_email NOT ILIKE '%voltsafe.com%'
          AND from_email NOT ILIKE '%noreply%'
          AND from_email NOT ILIKE '%no-reply%'
          AND sent_at > '${esc(String(pixel.pixel_created_at))}'
        ORDER BY sent_at ASC LIMIT 1
      `))).rows as any[];

      if (!inbound) continue;

      // Mark as replied and elevate signal to 'replied'
      await db.execute(sql.raw(`
        UPDATE email_tracking_pixels
        SET is_replied = true, signal_level = 'replied', last_scored_at = NOW()
        WHERE tracking_id = '${esc(pixel.tracking_id)}'
      `));

      // Fire replied-trigger rules
      const fullPixel = await getPixel(pixel.tracking_id);
      if (fullPixel) {
        const { processRepliedEvent } = await import("./services/engagement-rules");
        await processRepliedEvent(pixel.tracking_id, fullPixel);
      }
    }
  } catch (err) {
    console.error("[tracking] processReplyForThread error:", err);
  }
}

// ── Pixel lookup (shared across recording + rules) ─────────────────────────────
export async function getPixel(trackingId: string): Promise<{
  tracking_id: string;
  gmail_message_id: string | null;
  email_message_id_fk: number | null;
  subject: string | null;
  recipient_email: string | null;
  sent_by_user_id: number | null;
  engagement_score: number;
  signal_level: string;
  is_hot: boolean;
} | null> {
  const [row] = (await db.execute(sql.raw(`
    SELECT p.tracking_id, p.gmail_message_id, p.subject,
           p.recipient_email, p.sent_by_user_id,
           p.engagement_score, p.signal_level, p.is_hot,
           m.id AS email_message_id_fk
    FROM email_tracking_pixels p
    LEFT JOIN email_messages m ON m.gmail_message_id = p.gmail_message_id
    WHERE p.tracking_id = '${esc(trackingId)}' LIMIT 1
  `))).rows as any[];
  return row ?? null;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

async function markDuplicates(trackingId: string, eventType: string, ipHash: string) {
  await db.execute(sql.raw(`
    UPDATE email_engagement_events
    SET is_duplicate = true
    WHERE tracking_id='${esc(trackingId)}' AND event_type='${esc(eventType)}'
      AND ip_hash='${esc(ipHash)}' AND is_bot=false
      AND occurred_at > NOW() - INTERVAL '${DEDUPE_WINDOW} seconds'
      AND id != (
        SELECT id FROM email_engagement_events
        WHERE tracking_id='${esc(trackingId)}' AND event_type='${esc(eventType)}'
          AND ip_hash='${esc(ipHash)}' AND is_bot=false
          AND occurred_at > NOW() - INTERVAL '${DEDUPE_WINDOW} seconds'
        ORDER BY occurred_at ASC, id ASC LIMIT 1
      )
  `));
}

async function markDuplicatesClick(trackingId: string, ipHash: string, url: string) {
  const urlEsc = esc(url.slice(0, 2000));
  await db.execute(sql.raw(`
    UPDATE email_engagement_events
    SET is_duplicate = true
    WHERE tracking_id='${esc(trackingId)}' AND event_type='click'
      AND ip_hash='${esc(ipHash)}' AND url='${urlEsc}' AND is_bot=false
      AND occurred_at > NOW() - INTERVAL '${DEDUPE_WINDOW} seconds'
      AND id != (
        SELECT id FROM email_engagement_events
        WHERE tracking_id='${esc(trackingId)}' AND event_type='click'
          AND ip_hash='${esc(ipHash)}' AND url='${urlEsc}' AND is_bot=false
          AND occurred_at > NOW() - INTERVAL '${DEDUPE_WINDOW} seconds'
        ORDER BY occurred_at ASC, id ASC LIMIT 1
      )
  `));
}

async function justInsertedIsDuplicate(
  trackingId: string, eventType: string, ipHash: string | null
): Promise<boolean> {
  const [row] = (await db.execute(sql.raw(`
    SELECT is_duplicate FROM email_engagement_events
    WHERE tracking_id='${esc(trackingId)}' AND event_type='${esc(eventType)}'
      ${ipHash ? `AND ip_hash='${esc(ipHash)}'` : ""}
      AND is_bot=false
    ORDER BY occurred_at DESC, id DESC LIMIT 1
  `))).rows as any[];
  return Boolean(row?.is_duplicate);
}

function classifyUa(ua: string): string {
  if (/mobile|android|iphone|ipad/i.test(ua)) return "mobile";
  if (/windows|macintosh|linux/i.test(ua))      return "desktop";
  return "unknown";
}

export function esc(s: string): string {
  return String(s).replace(/'/g, "''");
}
