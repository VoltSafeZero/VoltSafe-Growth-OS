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
