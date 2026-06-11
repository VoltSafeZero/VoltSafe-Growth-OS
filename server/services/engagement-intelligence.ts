/**
 * engagement-intelligence.ts
 *
 * Computed engagement summaries from existing tracking tables.
 * No new tables — pure SQL queries over:
 *   - signature_cta_clicks / signature_cta_click_events
 *   - email_tracking_pixels / email_engagement_events
 *   - contacts / accounts / activities
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { esc } from "../tracking";

export type IntentLevel =
  | "none"
  | "interested"
  | "high_intent"
  | "very_high_intent"
  | "follow_up_recommended";

export interface ContactEngagementSummary {
  contactId: number;
  accountId: number | null;
  contactName: string;
  contactEmail: string | null;
  // CTA signals
  totalCtaClicks: number;
  uniqueCtasClicked: number;
  demoClickCount: number;
  demoClicksIn7d: number;
  lastCtaClickedAt: string | null;
  lastCtaName: string | null;
  lastCtaDestination: string | null;
  // Email open signals
  totalOpens: number;
  uniqueOpens: number;
  lastOpenAt: string | null;
  isReplied: boolean;
  lastReplyAt: string | null;
  // Computed
  intentLevel: IntentLevel;
  suggestedAction: string | null;
  updatedAt: string;
}

export interface AccountEngagementSummary {
  accountId: number;
  accountName: string;
  totalCtaClicks: number;
  demoClickCount: number;
  engagedContactCount: number;
  demoCtickerContactCount: number;
  mostClickedCtaName: string | null;
  lastCtaClickedAt: string | null;
  intentLevel: IntentLevel;
  suggestedAction: string | null;
  contacts: ContactEngagementSummary[];
}

export interface ThreadEngagementSummary {
  threadId: string;
  ctaClicks: Array<{
    recipientEmail: string;
    contactId: number | null;
    ctaName: string | null;
    clickCount: number;
    lastClickedAt: string | null;
    intentLevel: IntentLevel;
  }>;
  totalCtaClicks: number;
  uniqueCtaRecipients: number;
  hasHighIntent: boolean;
  bannerText: string | null;
  suggestedAction: string | null;
}

// ── Normalized activity rows (Phase 2) ────────────────────────────────────

export type ActivityType =
  | "email_open"
  | "email_link_click"
  | "signature_cta_click"
  | "video_click"
  | "reply";

export interface ActivityRow {
  recipientEmail: string;
  contactId: number | null;
  contactName: string | null;
  accountId: number | null;
  activityType: ActivityType;
  label: string;
  ctaName: string | null;
  url: string | null;
  count: number;
  firstAt: string | null;
  lastAt: string | null;
  intentLevel: IntentLevel;
  suggestedAction: string | null;
  relatedEmailId: string | null;
  threadId: string | null;
}

export interface EngagementSummary {
  opens: number;
  emailLinkClicks: number;
  signatureCtaClicks: number;
  videoClicks: number;
  replies: number;
  lastActivityAt: string | null;
  highestIntentLevel: IntentLevel;
}

export interface RecipientBreakdown {
  recipientEmail: string;
  recipientName: string | null;
  recipientType: "to" | "cc" | "bcc";
  isPrimary: boolean;
  isInternal: boolean;
  openCount: number;
  clickCount: number;
  ctaClickCount: number;
  lastActivityAt: string | null;
  intentScore: number;
  confidence?: "high" | "low";
}

export interface RawOpenEvent {
  id: number;
  occurredAt: string;
  eventType: "open" | "click";
  url: string | null;
  userAgent: string | null;
  recipientEmail: string;
  isBot: boolean;
  isDuplicate: boolean;
  isInternal: boolean;
  confidence: "high" | "low";
}

export interface ThreadEngagementFull {
  threadId: string;
  summary: EngagementSummary;
  activities: ActivityRow[];
  recipientBreakdown: RecipientBreakdown[];
  // backward-compat fields for CtaEngagementBanner
  ctaClicks: ThreadEngagementSummary["ctaClicks"];
  totalCtaClicks: number;
  uniqueCtaRecipients: number;
  hasHighIntent: boolean;
  bannerText: string | null;
  suggestedAction: string | null;
  rawOpenEvents: RawOpenEvent[];
}

export interface RecentHighIntentRecord {
  contactId: number;
  accountId: number | null;
  contactName: string;
  contactEmail: string | null;
  accountName: string | null;
  intentLevel: IntentLevel;
  demoClickCount: number;
  lastCtaClickedAt: string | null;
  lastCtaName: string | null;
  suggestedAction: string | null;
}

// ── Intent scoring ─────────────────────────────────────────────────────────

/**
 * "Demo CTA" = name/destination contains "demo" or "watch".
 */
function isDemoCtaName(name: string | null, dest: string | null): boolean {
  const n = (name ?? "").toLowerCase();
  const d = (dest ?? "").toLowerCase();
  return n.includes("demo") || n.includes("watch") || d.includes("demo");
}

/**
 * Pure scoring function — no I/O.
 */
export function computeIntentLevel(opts: {
  demoClickCount: number;
  demoClicksIn7d: number;
  lastCtaClickedAt: string | null;
  isReplied: boolean;
  demoCtickerContactCount?: number; // how many contacts from same account clicked demo
}): IntentLevel {
  const {
    demoClickCount,
    demoClicksIn7d,
    lastCtaClickedAt,
    isReplied,
    demoCtickerContactCount = 0,
  } = opts;

  if (demoClickCount === 0) return "none";

  const lastClickMs = lastCtaClickedAt ? new Date(lastCtaClickedAt).getTime() : 0;
  const nowMs = Date.now();
  const clickedIn24h = lastClickMs > nowMs - 24 * 60 * 60 * 1000;

  // very_high_intent: 3+ demo clicks in 7 days OR 2+ contacts from same account
  if (demoClicksIn7d >= 3 || demoCtickerContactCount >= 2) {
    if (!isReplied && clickedIn24h) return "follow_up_recommended";
    return "very_high_intent";
  }

  // high_intent: 2+ demo clicks OR any click in last 24h
  if (demoClickCount >= 2 || (demoClickCount >= 1 && clickedIn24h)) {
    if (!isReplied && clickedIn24h) return "follow_up_recommended";
    return "high_intent";
  }

  // interested: 1 demo click
  return "interested";
}

function suggestedActionFor(level: IntentLevel): string | null {
  switch (level) {
    case "follow_up_recommended": return "Follow up now";
    case "very_high_intent":      return "Send demo booking link";
    case "high_intent":           return "Follow up now";
    case "interested":            return "Send demo booking link";
    default:                      return null;
  }
}

// ── Contact engagement ─────────────────────────────────────────────────────

export async function getContactEngagement(
  contactId: number,
): Promise<ContactEngagementSummary | null> {
  const id = Number(contactId);
  if (!id) return null;

  // Fetch contact
  const [contact] = (await db.execute(sql.raw(`
    SELECT id, account_id, name, email FROM contacts WHERE id = ${id} LIMIT 1
  `))).rows as any[];
  if (!contact) return null;

  const email = contact.email as string | null;
  const emailEsc = email ? `'${esc(email.toLowerCase())}'` : "NULL";

  // CTA click aggregates
  const [ctaSummary] = (await db.execute(sql.raw(`
    SELECT
      COALESCE(SUM(s.click_count), 0)                        AS total_cta_clicks,
      COUNT(DISTINCT s.signature_cta_id)                     AS unique_ctas_clicked,
      COALESCE(SUM(
        CASE WHEN (
          lower(s.cta_name) LIKE '%demo%'
          OR lower(s.cta_name) LIKE '%watch%'
          OR lower(s.destination_url) LIKE '%demo%'
        ) THEN s.click_count ELSE 0 END
      ), 0)                                                  AS demo_click_count,
      MAX(s.last_clicked_at)                                 AS last_cta_clicked_at
    FROM signature_cta_clicks s
    WHERE ${email ? `LOWER(s.recipient_email) = ${emailEsc}` : "FALSE"}
  `))).rows as any[];

  // Demo clicks within last 7 days
  const [demo7d] = (await db.execute(sql.raw(`
    SELECT COALESCE(SUM(e.non_bot_events), 0) AS demo_clicks_7d
    FROM signature_cta_clicks s
    JOIN LATERAL (
      SELECT COUNT(*) AS non_bot_events
      FROM signature_cta_click_events ev
      WHERE ev.token = s.token
        AND ev.is_bot = FALSE AND ev.is_duplicate = FALSE
        AND ev.occurred_at > NOW() - INTERVAL '7 days'
    ) e ON TRUE
    WHERE ${email ? `LOWER(s.recipient_email) = ${emailEsc}` : "FALSE"}
      AND (
        lower(s.cta_name) LIKE '%demo%'
        OR lower(s.cta_name) LIKE '%watch%'
        OR lower(s.destination_url) LIKE '%demo%'
      )
  `))).rows as any[];

  // Most recent CTA clicked info
  const [lastCta] = (await db.execute(sql.raw(`
    SELECT cta_name, destination_url
    FROM signature_cta_clicks
    WHERE ${email ? `LOWER(recipient_email) = ${emailEsc}` : "FALSE"}
      AND last_clicked_at IS NOT NULL
    ORDER BY last_clicked_at DESC LIMIT 1
  `))).rows as any[];

  // Email open aggregates (via tracking pixels linked by recipient_email)
  const [openSummary] = (await db.execute(sql.raw(`
    SELECT
      COALESCE(SUM(CASE WHEN e.event_type='open' THEN 1 ELSE 0 END), 0) AS total_opens,
      COALESCE(SUM(CASE WHEN e.event_type='open' AND e.is_bot=FALSE AND e.is_duplicate=FALSE THEN 1 ELSE 0 END), 0) AS unique_opens,
      MAX(CASE WHEN e.event_type='open' AND e.is_bot=FALSE THEN e.occurred_at ELSE NULL END) AS last_open_at
    FROM email_tracking_pixels p
    JOIN email_engagement_events e ON e.tracking_id = p.tracking_id
    WHERE ${email ? `LOWER(p.recipient_email) = ${emailEsc}` : "FALSE"}
  `))).rows as any[];

  // Reply signal
  const [replySig] = (await db.execute(sql.raw(`
    SELECT
      BOOL_OR(p.is_replied) AS is_replied,
      MAX(CASE WHEN p.is_replied THEN p.updated_at ELSE NULL END) AS last_reply_at
    FROM email_tracking_pixels p
    WHERE ${email ? `LOWER(p.recipient_email) = ${emailEsc}` : "FALSE"}
  `))).rows as any[];

  const demoClickCount  = Number(ctaSummary?.demo_click_count  ?? 0);
  const demoClicksIn7d  = Number(demo7d?.demo_clicks_7d        ?? 0);
  const lastCtaClickedAt = ctaSummary?.last_cta_clicked_at ? String(ctaSummary.last_cta_clicked_at) : null;
  const isReplied = Boolean(replySig?.is_replied);

  const intentLevel = computeIntentLevel({
    demoClickCount,
    demoClicksIn7d,
    lastCtaClickedAt,
    isReplied,
  });

  return {
    contactId: id,
    accountId: contact.account_id as number | null,
    contactName: contact.name as string,
    contactEmail: email,
    totalCtaClicks:    Number(ctaSummary?.total_cta_clicks   ?? 0),
    uniqueCtasClicked: Number(ctaSummary?.unique_ctas_clicked ?? 0),
    demoClickCount,
    demoClicksIn7d,
    lastCtaClickedAt,
    lastCtaName:        lastCta?.cta_name        ? String(lastCta.cta_name)        : null,
    lastCtaDestination: lastCta?.destination_url ? String(lastCta.destination_url) : null,
    totalOpens:  Number(openSummary?.total_opens  ?? 0),
    uniqueOpens: Number(openSummary?.unique_opens ?? 0),
    lastOpenAt:  openSummary?.last_open_at ? String(openSummary.last_open_at) : null,
    isReplied,
    lastReplyAt: replySig?.last_reply_at ? String(replySig.last_reply_at) : null,
    intentLevel,
    suggestedAction: suggestedActionFor(intentLevel),
    updatedAt: new Date().toISOString(),
  };
}

// ── Account engagement ─────────────────────────────────────────────────────

export async function getAccountEngagement(
  accountId: number,
): Promise<AccountEngagementSummary | null> {
  const id = Number(accountId);
  if (!id) return null;

  // Fetch account
  const [account] = (await db.execute(sql.raw(`
    SELECT id, name FROM accounts WHERE id = ${id} LIMIT 1
  `))).rows as any[];
  if (!account) return null;

  // Get all contacts for this account
  const contacts = (await db.execute(sql.raw(`
    SELECT id, name, email FROM contacts WHERE account_id = ${id}
  `))).rows as any[];

  // Build per-contact summaries
  const contactSummaries: ContactEngagementSummary[] = [];
  for (const c of contacts) {
    const summary = await getContactEngagement(c.id);
    if (summary) contactSummaries.push(summary);
  }

  // Compute account-level stats
  const totalCtaClicks = contactSummaries.reduce((s, c) => s + c.totalCtaClicks, 0);
  const demoClickCount  = contactSummaries.reduce((s, c) => s + c.demoClickCount,  0);
  const engagedContacts = contactSummaries.filter(c => c.totalCtaClicks > 0);
  const demoCtickerContactCount = contactSummaries.filter(c => c.demoClickCount > 0).length;

  const lastClicks = contactSummaries
    .map(c => c.lastCtaClickedAt)
    .filter(Boolean)
    .map(d => new Date(d!).getTime());
  const lastCtaClickedAt = lastClicks.length > 0
    ? new Date(Math.max(...lastClicks)).toISOString()
    : null;

  // Most clicked CTA name across contacts
  const ctaNameCounts: Record<string, number> = {};
  for (const c of contactSummaries) {
    if (c.lastCtaName) {
      ctaNameCounts[c.lastCtaName] = (ctaNameCounts[c.lastCtaName] ?? 0) + c.totalCtaClicks;
    }
  }
  const mostClickedCtaName = Object.entries(ctaNameCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // Account intent level — elevates if multiple demo-clickers
  const isReplied = contactSummaries.some(c => c.isReplied);
  const maxDemoClicksIn7d = Math.max(0, ...contactSummaries.map(c => c.demoClicksIn7d));
  const intentLevel = computeIntentLevel({
    demoClickCount,
    demoClicksIn7d: maxDemoClicksIn7d,
    lastCtaClickedAt,
    isReplied,
    demoCtickerContactCount,
  });

  return {
    accountId: id,
    accountName: account.name as string,
    totalCtaClicks,
    demoClickCount,
    engagedContactCount: engagedContacts.length,
    demoCtickerContactCount,
    mostClickedCtaName,
    lastCtaClickedAt,
    intentLevel,
    suggestedAction: suggestedActionFor(intentLevel),
    contacts: contactSummaries,
  };
}

// ── Thread engagement ──────────────────────────────────────────────────────

export async function getThreadEngagement(
  threadId: string,
): Promise<ThreadEngagementSummary> {
  const tEsc = esc(threadId);

  // Find signature CTA clicks for messages in this thread (via email_messages)
  const rows = (await db.execute(sql.raw(`
    SELECT
      s.recipient_email,
      s.cta_name,
      s.destination_url,
      s.click_count,
      s.last_clicked_at,
      s.contact_id,
      c.id AS matched_contact_id
    FROM signature_cta_clicks s
    JOIN email_messages m ON m.gmail_message_id = s.gmail_message_id
    LEFT JOIN contacts c ON LOWER(c.email) = LOWER(s.recipient_email)
    WHERE m.gmail_thread_id = '${tEsc}'
      AND s.click_count > 0
    ORDER BY s.last_clicked_at DESC NULLS LAST
  `))).rows as any[];

  const ctaClicks = rows.map((r: any) => {
    const demoClick = isDemoCtaName(r.cta_name, r.destination_url);
    const clickCount = Number(r.click_count ?? 0);
    const lastClickedAt = r.last_clicked_at ? String(r.last_clicked_at) : null;

    const level = computeIntentLevel({
      demoClickCount:  demoClick ? clickCount : 0,
      demoClicksIn7d:  demoClick ? clickCount : 0,
      lastCtaClickedAt: lastClickedAt,
      isReplied: false,
    });

    return {
      recipientEmail: String(r.recipient_email),
      contactId:      r.matched_contact_id ? Number(r.matched_contact_id) : null,
      ctaName:        r.cta_name ? String(r.cta_name) : null,
      clickCount,
      lastClickedAt,
      intentLevel:    level,
    };
  });

  const totalCtaClicks      = ctaClicks.reduce((s, r) => s + r.clickCount, 0);
  const uniqueCtaRecipients = new Set(ctaClicks.map(r => r.recipientEmail)).size;
  const hasHighIntent       = ctaClicks.some(r =>
    r.intentLevel === "high_intent" || r.intentLevel === "very_high_intent" || r.intentLevel === "follow_up_recommended"
  );

  // Build banner text for the top-ranked signal
  let bannerText: string | null = null;
  let suggestedAction: string | null = null;

  if (ctaClicks.length > 0) {
    const top = ctaClicks[0];
    const name = top.ctaName ?? "a CTA";
    if (top.clickCount >= 3) {
      bannerText = `Recipient clicked "${name}" ${top.clickCount} times — follow-up recommended.`;
      suggestedAction = "Follow up now";
    } else if (top.clickCount === 2) {
      bannerText = `Recipient clicked "${name}" twice — high intent signal.`;
      suggestedAction = "Send demo booking link";
    } else if (top.clickCount === 1) {
      bannerText = `Recipient clicked "${name}".`;
      suggestedAction = "Send demo booking link";
    }
    if (uniqueCtaRecipients > 1) {
      bannerText = `${uniqueCtaRecipients} recipients clicked your signature CTA — account is heating up.`;
      suggestedAction = "Follow up now";
    }
  }

  return {
    threadId,
    ctaClicks,
    totalCtaClicks,
    uniqueCtaRecipients,
    hasHighIntent,
    bannerText,
    suggestedAction,
  };
}

// ── Thread engagement (full — Phase 2) ────────────────────────────────────

const INTENT_ORDER: IntentLevel[] = [
  "none", "interested", "high_intent", "very_high_intent", "follow_up_recommended",
];

function higherIntent(a: IntentLevel, b: IntentLevel): IntentLevel {
  return INTENT_ORDER.indexOf(a) >= INTENT_ORDER.indexOf(b) ? a : b;
}

export async function getThreadEngagementFull(
  threadId: string,
): Promise<ThreadEngagementFull> {
  const tEsc = esc(threadId);

  // ── Email opens — mirrors the inbox thread-signals query exactly ─────────
  // Uses is_duplicate IS NOT TRUE + is_bot = false to match the badge counts.
  const openRows = (await db.execute(sql.raw(`
    SELECT
      p.recipient_email,
      p.gmail_message_id,
      COUNT(*) FILTER (WHERE ee.is_bot = FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE) AS open_count,
      MIN(ee.occurred_at) FILTER (WHERE ee.is_bot = FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE) AS first_at,
      MAX(ee.occurred_at) FILTER (WHERE ee.is_bot = FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE) AS last_at
    FROM email_tracking_pixels p
    JOIN email_messages m ON m.gmail_message_id = p.gmail_message_id
    JOIN email_engagement_events ee ON ee.tracking_id = p.tracking_id
      AND ee.event_type = 'open'
    WHERE m.gmail_thread_id = '${tEsc}'
      AND m.direction = 'outbound'
    GROUP BY p.recipient_email, p.gmail_message_id
    HAVING COUNT(*) FILTER (WHERE ee.is_bot = FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE) > 0
  `))).rows as any[];

  // ── Email link clicks ─────────────────────────────────────────────────────
  const linkRows = (await db.execute(sql.raw(`
    SELECT
      p.recipient_email,
      p.gmail_message_id,
      ee.url,
      COUNT(*) FILTER (WHERE ee.is_bot = FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE) AS click_count,
      MIN(ee.occurred_at) FILTER (WHERE ee.is_bot = FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE) AS first_at,
      MAX(ee.occurred_at) FILTER (WHERE ee.is_bot = FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE) AS last_at
    FROM email_tracking_pixels p
    JOIN email_messages m ON m.gmail_message_id = p.gmail_message_id
    JOIN email_engagement_events ee ON ee.tracking_id = p.tracking_id
      AND ee.event_type = 'click'
    WHERE m.gmail_thread_id = '${tEsc}'
      AND m.direction = 'outbound'
    GROUP BY p.recipient_email, p.gmail_message_id, ee.url
    HAVING COUNT(*) FILTER (WHERE ee.is_bot = FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE) > 0
  `))).rows as any[];

  // ── Pixel pre-computed scores (fallback when no live events yet) ──────────
  // Reads signal_level / is_hot / engagement_score / is_replied set by the
  // scoring pipeline. These match the InboxSignalBadge source exactly.
  const pixelScoreRows = (await db.execute(sql.raw(`
    SELECT
      p.recipient_email,
      p.gmail_message_id,
      p.signal_level,
      p.is_hot,
      p.engagement_score,
      p.is_replied
    FROM email_tracking_pixels p
    JOIN email_messages m ON m.gmail_message_id = p.gmail_message_id
    WHERE m.gmail_thread_id = '${tEsc}'
      AND m.direction = 'outbound'
      AND (
        (p.signal_level IS NOT NULL AND p.signal_level != 'none')
        OR p.is_hot = TRUE
        OR p.is_replied = TRUE
        OR COALESCE(p.engagement_score, 0) > 0
      )
  `))).rows as any[];

  // ── Signature CTA clicks ─────────────────────────────────────────────────
  const ctaRows = (await db.execute(sql.raw(`
    SELECT
      s.recipient_email,
      s.cta_name,
      s.destination_url,
      s.click_count,
      s.last_clicked_at,
      s.contact_id,
      m.gmail_message_id,
      c.id AS matched_contact_id,
      c.name AS contact_name,
      c.account_id
    FROM signature_cta_clicks s
    JOIN email_messages m ON m.gmail_message_id = s.gmail_message_id
    LEFT JOIN contacts c ON LOWER(c.email) = LOWER(s.recipient_email)
    WHERE m.gmail_thread_id = '${tEsc}'
      AND s.click_count > 0
    ORDER BY s.last_clicked_at DESC NULLS LAST
  `))).rows as any[];

  // ── Replies ──────────────────────────────────────────────────────────────
  const replyRows = (await db.execute(sql.raw(`
    SELECT
      p.recipient_email,
      p.gmail_message_id,
      p.updated_at AS replied_at
    FROM email_tracking_pixels p
    JOIN email_messages m ON m.gmail_message_id = p.gmail_message_id
    WHERE m.gmail_thread_id = '${tEsc}'
      AND p.is_replied = TRUE
  `))).rows as any[];

  // ── Contact lookup for opens / link clicks / pixel scores ────────────────
  const allEmails = Array.from(new Set([
    ...openRows.map((r: any) => String(r.recipient_email ?? "").toLowerCase()),
    ...linkRows.map((r: any) => String(r.recipient_email ?? "").toLowerCase()),
    ...replyRows.map((r: any) => String(r.recipient_email ?? "").toLowerCase()),
    ...pixelScoreRows.map((r: any) => String(r.recipient_email ?? "").toLowerCase()),
  ].filter(Boolean)));

  let contactMap: Record<string, { id: number; name: string; accountId: number | null }> = {};
  if (allEmails.length > 0) {
    const escaped = allEmails.map(e => `'${esc(e)}'`).join(",");
    const contacts = (await db.execute(sql.raw(`
      SELECT id, name, email, account_id FROM contacts
      WHERE LOWER(email) IN (${escaped})
    `))).rows as any[];
    for (const c of contacts) {
      contactMap[String(c.email ?? "").toLowerCase()] = {
        id: Number(c.id),
        name: String(c.name),
        accountId: c.account_id ? Number(c.account_id) : null,
      };
    }
  }

  // ── Build normalized ActivityRow[] ───────────────────────────────────────
  const activities: ActivityRow[] = [];

  for (const r of openRows) {
    const email = String(r.recipient_email ?? "").toLowerCase();
    const ct = contactMap[email];
    activities.push({
      recipientEmail: String(r.recipient_email ?? ""),
      contactId: ct?.id ?? null,
      contactName: ct?.name ?? null,
      accountId: ct?.accountId ?? null,
      activityType: "email_open",
      label: "Email Open",
      ctaName: null,
      url: null,
      count: Number(r.open_count ?? 0),
      firstAt: r.first_at ? String(r.first_at) : null,
      lastAt: r.last_at ? String(r.last_at) : null,
      intentLevel: Number(r.open_count ?? 0) >= 3 ? "interested" : "interested",
      suggestedAction: null,
      relatedEmailId: r.gmail_message_id ? String(r.gmail_message_id) : null,
      threadId,
    });
  }

  for (const r of linkRows) {
    const email = String(r.recipient_email ?? "").toLowerCase();
    const ct = contactMap[email];
    activities.push({
      recipientEmail: String(r.recipient_email ?? ""),
      contactId: ct?.id ?? null,
      contactName: ct?.name ?? null,
      accountId: ct?.accountId ?? null,
      activityType: "email_link_click",
      label: "Link Click",
      ctaName: null,
      url: r.url ? String(r.url) : null,
      count: Number(r.click_count ?? 0),
      firstAt: r.first_at ? String(r.first_at) : null,
      lastAt: r.last_at ? String(r.last_at) : null,
      intentLevel: "interested",
      suggestedAction: suggestedActionFor("interested"),
      relatedEmailId: r.gmail_message_id ? String(r.gmail_message_id) : null,
      threadId,
    });
  }

  for (const r of ctaRows) {
    const isDemo = isDemoCtaName(r.cta_name, r.destination_url);
    const clickCount = Number(r.click_count ?? 0);
    const lastAt = r.last_clicked_at ? String(r.last_clicked_at) : null;
    const level = computeIntentLevel({
      demoClickCount: isDemo ? clickCount : 0,
      demoClicksIn7d: isDemo ? clickCount : 0,
      lastCtaClickedAt: lastAt,
      isReplied: replyRows.some((rr: any) =>
        String(rr.recipient_email ?? "").toLowerCase() ===
        String(r.recipient_email ?? "").toLowerCase()
      ),
    });
    const activityType: ActivityType = isDemo ? "video_click" : "signature_cta_click";
    activities.push({
      recipientEmail: String(r.recipient_email ?? ""),
      contactId: r.matched_contact_id ? Number(r.matched_contact_id) : null,
      contactName: r.contact_name ? String(r.contact_name) : null,
      accountId: r.account_id ? Number(r.account_id) : null,
      activityType,
      label: isDemo ? "Demo/Video Click" : "Signature CTA Click",
      ctaName: r.cta_name ? String(r.cta_name) : null,
      url: r.destination_url ? String(r.destination_url) : null,
      count: clickCount,
      firstAt: null,
      lastAt,
      intentLevel: level,
      suggestedAction: suggestedActionFor(level),
      relatedEmailId: r.gmail_message_id ? String(r.gmail_message_id) : null,
      threadId,
    });
  }

  for (const r of replyRows) {
    const email = String(r.recipient_email ?? "").toLowerCase();
    const ct = contactMap[email];
    activities.push({
      recipientEmail: String(r.recipient_email ?? ""),
      contactId: ct?.id ?? null,
      contactName: ct?.name ?? null,
      accountId: ct?.accountId ?? null,
      activityType: "reply",
      label: "Reply",
      ctaName: null,
      url: null,
      count: 1,
      firstAt: r.replied_at ? String(r.replied_at) : null,
      lastAt: r.replied_at ? String(r.replied_at) : null,
      intentLevel: "none",
      suggestedAction: null,
      relatedEmailId: r.gmail_message_id ? String(r.gmail_message_id) : null,
      threadId,
    });
  }

  // ── Pixel pre-computed score fallback ────────────────────────────────────
  // Surface signal_level / is_hot from the scoring pipeline when there are
  // no live events yet — ensures the widget matches the InboxSignalBadge.
  const seenMsgIds = new Set([
    ...openRows.map((r: any) => String(r.gmail_message_id)),
    ...linkRows.map((r: any) => String(r.gmail_message_id)),
    ...replyRows.map((r: any) => String(r.gmail_message_id)),
  ]);
  for (const r of pixelScoreRows) {
    const msgId = String(r.gmail_message_id ?? "");
    if (seenMsgIds.has(msgId)) continue; // already covered by live events
    const email = String(r.recipient_email ?? "").toLowerCase();
    const ct = contactMap[email];
    const signalLevel = String(r.signal_level ?? "none");
    const isHot = r.is_hot === true || r.is_hot === "true";
    const isReplied = r.is_replied === true || r.is_replied === "true";
    const score = Number(r.engagement_score ?? 0);
    // Map signal_level to intent
    const intentLevel: IntentLevel =
      signalLevel === "hot" || isHot ? "very_high_intent"
      : signalLevel === "high"       ? "high_intent"
      : signalLevel === "medium"     ? "interested"
      : signalLevel === "low"        ? "interested"
      : score > 0                    ? "interested"
      : "none";
    const label = isHot
      ? "Hot Lead (scored)"
      : signalLevel !== "none"
      ? `Tracked — signal: ${signalLevel}`
      : "Tracked";
    activities.push({
      recipientEmail: String(r.recipient_email ?? ""),
      contactId: ct?.id ?? null,
      contactName: ct?.name ?? null,
      accountId: ct?.accountId ?? null,
      activityType: isReplied ? "reply" : "email_open",
      label,
      ctaName: null,
      url: null,
      count: score > 0 ? score : 1,
      firstAt: null,
      lastAt: null,
      intentLevel,
      suggestedAction: suggestedActionFor(intentLevel),
      relatedEmailId: msgId || null,
      threadId,
    });
  }

  // ── Summary counts ───────────────────────────────────────────────────────
  const opens     = openRows.reduce((s: number, r: any) => s + Number(r.open_count ?? 0), 0);
  const emailLinkClicks = linkRows.reduce((s: number, r: any) => s + Number(r.click_count ?? 0), 0);
  const signatureCtaClicks = ctaRows
    .filter((r: any) => !isDemoCtaName(r.cta_name, r.destination_url))
    .reduce((s: number, r: any) => s + Number(r.click_count ?? 0), 0);
  const videoClicks = ctaRows
    .filter((r: any) => isDemoCtaName(r.cta_name, r.destination_url))
    .reduce((s: number, r: any) => s + Number(r.click_count ?? 0), 0);
  const replies = replyRows.length;

  const allTimestamps = activities
    .map(a => a.lastAt)
    .filter(Boolean)
    .map(d => new Date(d!).getTime());
  const lastActivityAt = allTimestamps.length > 0
    ? new Date(Math.max(...allTimestamps)).toISOString()
    : null;

  const highestIntentLevel = activities.reduce<IntentLevel>(
    (best, a) => higherIntent(best, a.intentLevel),
    "none",
  );

  const summary: EngagementSummary = {
    opens, emailLinkClicks, signatureCtaClicks, videoClicks, replies, lastActivityAt, highestIntentLevel,
  };

  // ── Build backward-compat ctaClicks shape ────────────────────────────────
  const ctaClicks = ctaRows.map((r: any) => {
    const isDemo = isDemoCtaName(r.cta_name, r.destination_url);
    const clickCount = Number(r.click_count ?? 0);
    const lastAt = r.last_clicked_at ? String(r.last_clicked_at) : null;
    const level = computeIntentLevel({
      demoClickCount: isDemo ? clickCount : 0,
      demoClicksIn7d: isDemo ? clickCount : 0,
      lastCtaClickedAt: lastAt,
      isReplied: false,
    });
    return {
      recipientEmail: String(r.recipient_email ?? ""),
      contactId: r.matched_contact_id ? Number(r.matched_contact_id) : null,
      ctaName: r.cta_name ? String(r.cta_name) : null,
      clickCount,
      lastClickedAt: lastAt,
      intentLevel: level,
    };
  });

  const totalCtaClicks      = ctaClicks.reduce((s, r) => s + r.clickCount, 0);
  const uniqueCtaRecipients = new Set(ctaClicks.map(r => r.recipientEmail)).size;
  const hasHighIntent       = ctaClicks.some(r =>
    r.intentLevel === "high_intent" || r.intentLevel === "very_high_intent" || r.intentLevel === "follow_up_recommended"
  );

  let bannerText: string | null = null;
  let bannerSuggestedAction: string | null = null;

  if (ctaClicks.length > 0) {
    const top = ctaClicks[0];
    const name = top.ctaName ?? "a CTA";
    if (top.clickCount >= 3) {
      bannerText = `Recipient clicked "${name}" ${top.clickCount} times — follow-up recommended.`;
      bannerSuggestedAction = "Follow up now";
    } else if (top.clickCount === 2) {
      bannerText = `Recipient clicked "${name}" twice — high intent signal.`;
      bannerSuggestedAction = "Send demo booking link";
    } else if (top.clickCount === 1) {
      bannerText = `Recipient clicked "${name}".`;
      bannerSuggestedAction = "Send demo booking link";
    }
    if (uniqueCtaRecipients > 1) {
      bannerText = `${uniqueCtaRecipients} recipients clicked your signature CTA — account is heating up.`;
      bannerSuggestedAction = "Follow up now";
    }
  } else if (opens > 0) {
    bannerText = `Opened ${opens} time${opens !== 1 ? "s" : ""}${lastActivityAt ? ` · ${new Date(Date.now() - new Date(lastActivityAt).getTime()) < new Date(24 * 3600 * 1000) ? "today" : ""}` : ""}.`;
  }

  // ── Recipient-level breakdown ──────────────────────────────────────────────
  // Reads from email_recipients (populated at send time for new messages) and
  // falls back to pixel-based data for historical threads without recipient rows.
  let recipientBreakdown: RecipientBreakdown[] = [];
  try {
    const recipRows = (await db.execute(sql.raw(`
      SELECT
        er.recipient_email,
        er.recipient_name,
        er.recipient_type,
        er.is_primary,
        er.is_internal,
        er.tracking_token,
        COALESCE((
          SELECT COUNT(*) FROM email_engagement_events ee
          WHERE ee.tracking_id = er.tracking_token
            AND ee.event_type = 'open'
            AND ee.is_bot = FALSE
            AND ee.is_duplicate IS NOT TRUE
            AND ee.is_internal IS NOT TRUE
        ), 0) AS open_count,
        COALESCE((
          SELECT COUNT(*) FROM email_engagement_events ee
          WHERE ee.tracking_id = er.tracking_token
            AND ee.event_type = 'click'
            AND ee.is_bot = FALSE
            AND ee.is_duplicate IS NOT TRUE
            AND ee.is_internal IS NOT TRUE
        ), 0) AS click_count,
        COALESCE((
          SELECT COALESCE(SUM(s.click_count), 0)
          FROM signature_cta_clicks s
          WHERE LOWER(s.recipient_email) = LOWER(er.recipient_email)
            AND s.gmail_message_id IN (
              SELECT gmail_message_id FROM email_messages
              WHERE gmail_thread_id = '${tEsc}'
            )
        ), 0) AS cta_click_count,
        (
          SELECT MAX(ee.occurred_at) FROM email_engagement_events ee
          WHERE ee.tracking_id = er.tracking_token
            AND ee.is_bot = FALSE
            AND ee.is_internal IS NOT TRUE
        ) AS last_activity_at
      FROM email_recipients er
      WHERE er.gmail_thread_id = '${tEsc}'
      ORDER BY er.is_primary DESC, er.recipient_type, er.recipient_email
    `))).rows as any[];

    if (recipRows.length > 0) {
      recipientBreakdown = recipRows.map((r: any) => {
        const opens  = Number(r.open_count  ?? 0);
        const clicks = Number(r.click_count ?? 0);
        const cta    = Number(r.cta_click_count ?? 0);
        const score  = Math.min(100, opens * 10 + clicks * 20 + cta * 30);
        return {
          recipientEmail: String(r.recipient_email),
          recipientName:  r.recipient_name ? String(r.recipient_name) : null,
          recipientType:  (r.recipient_type as "to" | "cc" | "bcc") || "to",
          isPrimary:      Boolean(r.is_primary),
          isInternal:     Boolean(r.is_internal),
          openCount:      opens,
          clickCount:     clicks,
          ctaClickCount:  cta,
          lastActivityAt: r.last_activity_at ? String(r.last_activity_at) : null,
          intentScore:    score,
          confidence:     r.tracking_token ? "high" as const : "low" as const,
        };
      });
    } else {
      // Fallback: derive from tracking pixels for historical threads
      const pixelRows = (await db.execute(sql.raw(`
        SELECT
          p.recipient_email,
          COALESCE((
            SELECT COUNT(*) FROM email_engagement_events ee
            WHERE ee.tracking_id = p.tracking_id AND ee.event_type = 'open'
              AND ee.is_bot = FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE
          ), 0) AS open_count,
          COALESCE((
            SELECT COUNT(*) FROM email_engagement_events ee
            WHERE ee.tracking_id = p.tracking_id AND ee.event_type = 'click'
              AND ee.is_bot = FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE
          ), 0) AS click_count,
          (SELECT MAX(ee.occurred_at) FROM email_engagement_events ee
           WHERE ee.tracking_id = p.tracking_id AND ee.is_bot = FALSE AND ee.is_internal IS NOT TRUE
          ) AS last_activity_at
        FROM email_tracking_pixels p
        JOIN email_messages m ON m.gmail_message_id = p.gmail_message_id
        WHERE m.gmail_thread_id = '${tEsc}' AND m.direction = 'outbound'
        ORDER BY p.recipient_email
      `))).rows as any[];

      recipientBreakdown = pixelRows.map((r: any) => {
        const opens  = Number(r.open_count  ?? 0);
        const clicks = Number(r.click_count ?? 0);
        const score  = Math.min(100, opens * 10 + clicks * 20);
        return {
          recipientEmail: String(r.recipient_email),
          recipientName:  null,
          recipientType:  "to" as const,
          isPrimary:      true,
          isInternal:     false,
          openCount:      opens,
          clickCount:     clicks,
          ctaClickCount:  0,
          lastActivityAt: r.last_activity_at ? String(r.last_activity_at) : null,
          intentScore:    score,
          confidence:     "low" as const,
        };
      });
    }
  } catch (rbErr) {
    console.warn("[engagement] recipientBreakdown query non-fatal:", rbErr);
  }

  // ── Raw event-level timeline ─────────────────────────────────────────────
  // Individual events with exact timestamps — powers the EventTimeline UI.
  let rawOpenEvents: RawOpenEvent[] = [];
  try {
    const rawRows = (await db.execute(sql.raw(`
      SELECT
        ee.id,
        ee.occurred_at,
        ee.event_type,
        ee.url,
        ee.user_agent,
        COALESCE(ee.is_bot, FALSE)       AS is_bot,
        COALESCE(ee.is_duplicate, FALSE) AS is_duplicate,
        COALESCE(ee.is_internal, FALSE)  AS is_internal,
        COALESCE(p.recipient_email, '')  AS recipient_email,
        CASE WHEN EXISTS (
          SELECT 1 FROM email_recipients er3 WHERE er3.tracking_token = p.tracking_id
        ) THEN 'high' ELSE 'low' END     AS confidence
      FROM email_tracking_pixels p
      JOIN email_messages m ON m.gmail_message_id = p.gmail_message_id
      JOIN email_engagement_events ee ON ee.tracking_id = p.tracking_id
      WHERE m.gmail_thread_id = '${tEsc}'
        AND m.direction = 'outbound'
      ORDER BY ee.occurred_at ASC
      LIMIT 500
    `))).rows as any[];
    rawOpenEvents = rawRows.map((r: any) => ({
      id:            Number(r.id),
      occurredAt:    String(r.occurred_at),
      eventType:     String(r.event_type) as "open" | "click",
      url:           r.url         ? String(r.url)          : null,
      userAgent:     r.user_agent  ? String(r.user_agent)   : null,
      recipientEmail: String(r.recipient_email ?? ""),
      isBot:         r.is_bot       === true || r.is_bot       === "true",
      isDuplicate:   r.is_duplicate === true || r.is_duplicate === "true",
      isInternal:    r.is_internal  === true || r.is_internal  === "true",
      confidence:    r.confidence === "high" ? "high" : "low" as "high" | "low",
    }));
  } catch (evErr) {
    console.warn("[engagement] rawOpenEvents query non-fatal:", evErr);
  }

  return {
    threadId,
    summary,
    activities,
    recipientBreakdown,
    ctaClicks,
    totalCtaClicks,
    uniqueCtaRecipients,
    hasHighIntent,
    bannerText,
    suggestedAction: bannerSuggestedAction,
    rawOpenEvents,
  };
}

// ── Recent high-intent ─────────────────────────────────────────────────────

export async function getRecentHighIntent(
  sentByUserId?: number,
  limit = 20,
): Promise<RecentHighIntentRecord[]> {
  const userFilter = sentByUserId
    ? `AND s.sent_by_user_id = ${Number(sentByUserId)}`
    : "";

  const rows = (await db.execute(sql.raw(`
    SELECT
      s.recipient_email,
      s.cta_name,
      s.destination_url,
      SUM(s.click_count)                             AS total_clicks,
      SUM(CASE WHEN (
        lower(s.cta_name) LIKE '%demo%'
        OR lower(s.cta_name) LIKE '%watch%'
        OR lower(s.destination_url) LIKE '%demo%'
      ) THEN s.click_count ELSE 0 END)               AS demo_clicks,
      MAX(s.last_clicked_at)                         AS last_cta_clicked_at,
      c.id                                           AS contact_id,
      c.name                                         AS contact_name,
      c.account_id,
      a.name                                         AS account_name
    FROM signature_cta_clicks s
    LEFT JOIN contacts c ON LOWER(c.email) = LOWER(s.recipient_email)
    LEFT JOIN accounts a ON a.id = c.account_id
    WHERE s.click_count > 0
      AND s.last_clicked_at > NOW() - INTERVAL '30 days'
      ${userFilter}
    GROUP BY s.recipient_email, s.cta_name, s.destination_url,
             c.id, c.name, c.account_id, a.name
    ORDER BY last_cta_clicked_at DESC NULLS LAST
    LIMIT ${Math.min(Number(limit) || 20, 100)}
  `))).rows as any[];

  return rows.map((r: any) => {
    const demoClickCount   = Number(r.demo_clicks        ?? 0);
    const lastCtaClickedAt = r.last_cta_clicked_at ? String(r.last_cta_clicked_at) : null;
    const intentLevel      = computeIntentLevel({
      demoClickCount,
      demoClicksIn7d: demoClickCount,
      lastCtaClickedAt,
      isReplied: false,
    });

    return {
      contactId:       r.contact_id   ? Number(r.contact_id)   : 0,
      accountId:       r.account_id   ? Number(r.account_id)   : null,
      contactName:     r.contact_name ? String(r.contact_name) : String(r.recipient_email),
      contactEmail:    String(r.recipient_email),
      accountName:     r.account_name ? String(r.account_name) : null,
      intentLevel,
      demoClickCount,
      lastCtaClickedAt,
      lastCtaName:     r.cta_name ? String(r.cta_name) : null,
      suggestedAction: suggestedActionFor(intentLevel),
    };
  }).filter(r => r.intentLevel !== "none");
}
