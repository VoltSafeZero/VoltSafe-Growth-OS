/**
 * revenue-intelligence.ts
 *
 * Revenue Intelligence engine — identifies champions, buying committees,
 * account engagement scores, momentum, and follow-up opportunities.
 *
 * All scoring is computed from existing tables:
 *   email_tracking_pixels / email_engagement_events / email_recipients /
 *   email_threads / email_messages / contacts / accounts /
 *   signature_cta_clicks / calendar_events
 *
 * No new tables required — pure computation layer.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { esc } from "../tracking";

// ─── Scoring weights ────────────────────────────────────────────────────────
const W_OPEN     = 1;
const W_CLICK    = 3;
const W_DEMO     = 8;   // replaces W_CLICK for demo/video links
const W_CTA      = 5;
const W_REPLY    = 10;
const W_MEETING  = 20;

const M_TO       = 1.5;
const M_CC       = 1.0;
const M_BCC      = 0.8;
const M_7D       = 1.5;
const M_30D      = 1.2;

// ─── Public Types ────────────────────────────────────────────────────────────

export type BuyingRole =
  | "champion"
  | "emerging_champion"
  | "decision_maker"
  | "stakeholder"
  | "observer"
  | "internal";

export type MomentumStatus = "accelerating" | "stable" | "cooling" | "dormant";

export interface ChampionContact {
  email: string;
  name: string | null;
  contactId: number | null;
  title: string | null;
  avatarUrl: string | null;
  role: BuyingRole;
  recipientType: "to" | "cc" | "bcc";
  isPrimary: boolean;
  championScore: number;
  opens: number;
  clicks: number;
  demoClicks: number;
  ctaClicks: number;
  replies: number;
  recency7d: number;
  recency30d: number;
  lastActivityAt: string | null;
}

export interface BuyingCommittee {
  accountId: number;
  accountName: string;
  members: ChampionContact[];
  champion: ChampionContact | null;
  decisionMaker: ChampionContact | null;
  committeeSize: number;
  externalCount: number;
  confidenceScore: number;
}

export interface AccountEngagement {
  accountId: number;
  accountName: string;
  engagementScore: number;
  trend: MomentumStatus;
  trendPct: number;
  champion: ChampionContact | null;
  committeeSize: number;
  lastEngagementAt: string | null;
  totalOpens: number;
  totalClicks: number;
  opens7d: number;
  opens30d: number;
}

export interface FollowUpOpportunity {
  accountId: number;
  accountName: string;
  champion: ChampionContact | null;
  lastActivityAt: string | null;
  daysSilent: number;
  score: number;
  totalOpens: number;
  totalClicks: number;
  lastThreadId: string | null;
  lastSubject: string | null;
}

export interface AccountMomentum {
  last7d:  number;
  last30d: number;
  last90d: number;
  prev7d:  number;
  prev30d: number;
  prev90d: number;
  status:  MomentumStatus;
  trendPct: number;
}

export interface AccountInsight {
  type: "champion_active" | "engagement_rising" | "decision_maker_needed"
      | "cooling" | "dormant" | "committee_incomplete" | "high_intent"
      | "needs_follow_up";
  severity: "info" | "warning" | "success";
  text: string;
}

export interface AccountIntelligence {
  accountId: number;
  accountName: string;
  engagementScore: number;
  committee: BuyingCommittee;
  mostEngaged: ChampionContact | null;
  momentum: AccountMomentum;
  insights: AccountInsight[];
  lastEngagementAt: string | null;
}

export interface ChampionLeader {
  accountId:      number;
  accountName:    string;
  email:          string;
  name:           string | null;
  title:          string | null;
  championScore:  number;
  opens:          number;
  clicks:         number;
  lastActivityAt: string | null;
}

export interface ActivityEvent {
  type:         "open" | "click" | "demo" | "reply" | "meeting";
  at:           string;
  contactName:  string | null;
  contactEmail: string | null;
  subject:      string | null;
  url:          string | null;
}

export interface AccountOpportunity {
  id:               number;
  title:            string;
  stage:            string;
  amount:           number;
  currency:         string;
  estCloseDate:     string | null;
  forecastCategory: string;
}

export interface CommandCenterData {
  hotAccounts:          AccountEngagement[];
  accelerating:         AccountEngagement[];
  followUpOpportunities: FollowUpOpportunity[];
  atRisk:               AccountEngagement[];
  heatmap:              AccountEngagement[];
  champions:            ChampionLeader[];
  summary: {
    hotCount: number;
    totalActiveAccounts: number;
    avgScore: number;
  };
}

export interface ThreadMostEngaged {
  email: string;
  name: string | null;
  contactId: number | null;
  avatarUrl: string | null;
  title: string | null;
  score: number;
  opens: number;
  clicks: number;
  ctaClicks: number;
  lastActivityAt: string | null;
}

// ─── Role classification ─────────────────────────────────────────────────────

const DECISION_MAKER_TITLES = new Set([
  "ceo","cto","coo","cfo","owner","president","founder","managing director",
  "general manager","vice president","vp","director","principal","partner",
  "head of","chief",
]);

function isDecisionMakerTitle(title: string | null): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  for (const kw of DECISION_MAKER_TITLES) {
    if (t.includes(kw)) return true;
  }
  return false;
}

function classifyRole(
  contact: { championScore: number; opens: number; clicks: number; replies: number; title: string | null; recipientType: string; recency7d: number; recency30d: number },
  maxScore: number,
): BuyingRole {
  const { championScore, opens, clicks, replies, title, recency7d } = contact;
  const isDecMaker = isDecisionMakerTitle(title);
  const relScore = maxScore > 0 ? championScore / maxScore : 0;

  // Decision maker by title (even with low engagement)
  if (isDecMaker && (opens > 0 || clicks > 0 || replies > 0)) return "decision_maker";

  // Champion: top scorer, high activity, recent
  if (relScore >= 0.7 && championScore >= 15 && (opens >= 3 || replies >= 1)) return "champion";

  // Emerging champion: solid score but not top-tier
  if (relScore >= 0.4 && championScore >= 8 && (opens >= 2 || clicks >= 1 || recency7d > 0)) return "emerging_champion";

  // Decision maker by title even without enough score
  if (isDecMaker) return "decision_maker";

  // Stakeholder: some meaningful engagement
  if (championScore >= 4 || (opens >= 2 && clicks >= 1)) return "stakeholder";

  // Observer: minimal engagement
  if (opens >= 1 || clicks >= 1) return "observer";

  return "observer";
}

// ─── Account engagement score (0-100) ────────────────────────────────────────

function computeAccountScore(contacts: ChampionContact[]): number {
  if (contacts.length === 0) return 0;
  // Sublinear aggregation — prevents one superstar from saturating the score
  const aggregate = contacts.reduce((sum, c) => sum + Math.sqrt(c.championScore), 0);
  // Scale: sqrt(100) * 3 contacts ≈ 30 → score 100
  return Math.min(100, Math.round(aggregate * 4));
}

// ─── Champion score formula ────────────────────────────────────────────────

function calcChampionScore(r: {
  opens: number; clicks: number; demoClicks: number;
  ctaClicks: number; replies: number;
  recency7d: number; recency30d: number; recipientType: string;
}): number {
  const linkClicks = r.clicks - r.demoClicks;
  const base = r.opens * W_OPEN
             + linkClicks * W_CLICK
             + r.demoClicks * W_DEMO
             + r.ctaClicks * W_CTA
             + r.replies * W_REPLY;
  const recencyMult = r.recency7d > 0 ? M_7D : r.recency30d > 0 ? M_30D : 1.0;
  const typeMult = r.recipientType === "to" ? M_TO : r.recipientType === "bcc" ? M_BCC : M_CC;
  return Math.round(base * recencyMult * typeMult);
}

// ─── SQL helpers ─────────────────────────────────────────────────────────────

const SAFE_INT = (n: unknown) => Math.floor(Number(n));

// ─── Core query: champion scores per account ─────────────────────────────────

async function fetchChampionRows(accountId: number): Promise<any[]> {
  const id = SAFE_INT(accountId);
  if (!id) return [];

  try {
    const rows = (await db.execute(sql.raw(`
      WITH account_threads AS (
        SELECT DISTINCT gmail_thread_id
        FROM email_threads
        WHERE primary_account_id = ${id}
      ),
      contact_emails AS (
        SELECT LOWER(email) AS email, id AS contact_id, name, title, role_type, avatar_url, is_primary
        FROM contacts
        WHERE account_id = ${id} AND email IS NOT NULL AND TRIM(email) != ''
      ),
      recipient_eng AS (
        SELECT
          LOWER(er.recipient_email) AS email,
          CASE WHEN MAX(CASE er.recipient_type WHEN 'to' THEN 2 WHEN 'cc' THEN 1 ELSE 0 END) = 2 THEN 'to'
               WHEN MAX(CASE er.recipient_type WHEN 'to' THEN 2 WHEN 'cc' THEN 1 ELSE 0 END) = 1 THEN 'cc'
               ELSE 'bcc' END AS best_type,
          COUNT(DISTINCT CASE WHEN ee.event_type='open' AND ee.is_bot=FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE THEN ee.id END) AS opens,
          COUNT(DISTINCT CASE WHEN ee.event_type='click' AND ee.is_bot=FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE THEN ee.id END) AS clicks,
          COUNT(DISTINCT CASE WHEN ee.event_type='click' AND ee.is_bot=FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE
              AND (LOWER(COALESCE(ee.url,'')) LIKE '%demo%' OR LOWER(COALESCE(ee.url,'')) LIKE '%watch%' OR LOWER(COALESCE(ee.url,'')) LIKE '%video%') THEN ee.id END) AS demo_clicks,
          COUNT(DISTINCT CASE WHEN ee.occurred_at > NOW() - INTERVAL '7 days' AND ee.is_bot=FALSE AND ee.is_internal IS NOT TRUE THEN ee.id END) AS recency_7d,
          COUNT(DISTINCT CASE WHEN ee.occurred_at > NOW() - INTERVAL '30 days' AND ee.is_bot=FALSE AND ee.is_internal IS NOT TRUE THEN ee.id END) AS recency_30d,
          MAX(ee.occurred_at) FILTER (WHERE ee.is_bot=FALSE AND ee.is_internal IS NOT TRUE) AS last_event_at
        FROM account_threads t
        JOIN email_recipients er ON er.gmail_thread_id = t.gmail_thread_id AND er.is_internal IS NOT TRUE
        LEFT JOIN email_engagement_events ee ON ee.tracking_id = er.tracking_token
        GROUP BY LOWER(er.recipient_email)
      ),
      pixel_eng AS (
        SELECT
          LOWER(p.recipient_email) AS email,
          'to' AS best_type,
          COUNT(DISTINCT CASE WHEN ee.event_type='open' AND ee.is_bot=FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE THEN ee.id END) AS opens,
          COUNT(DISTINCT CASE WHEN ee.event_type='click' AND ee.is_bot=FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE THEN ee.id END) AS clicks,
          0 AS demo_clicks, 0 AS recency_7d, 0 AS recency_30d,
          MAX(ee.occurred_at) FILTER (WHERE ee.is_bot=FALSE AND ee.is_internal IS NOT TRUE) AS last_event_at
        FROM account_threads t
        JOIN email_messages em ON em.gmail_thread_id = t.gmail_thread_id AND em.direction = 'outbound'
        JOIN email_tracking_pixels p ON p.gmail_message_id = em.gmail_message_id
        LEFT JOIN email_engagement_events ee ON ee.tracking_id = p.tracking_id
        WHERE p.recipient_email IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM email_recipients er2 WHERE er2.gmail_thread_id = t.gmail_thread_id LIMIT 1
          )
        GROUP BY LOWER(p.recipient_email)
      ),
      all_eng AS (
        SELECT * FROM recipient_eng
        UNION ALL
        SELECT * FROM pixel_eng
        WHERE email NOT IN (SELECT email FROM recipient_eng)
      ),
      reply_data AS (
        SELECT LOWER(em.from_email) AS email, COUNT(*) AS replies
        FROM account_threads t
        JOIN email_messages em ON em.gmail_thread_id = t.gmail_thread_id AND em.direction = 'inbound'
        WHERE LOWER(em.from_email) IN (SELECT email FROM contact_emails)
        GROUP BY LOWER(em.from_email)
      ),
      cta_data AS (
        SELECT LOWER(s.recipient_email) AS email, SUM(s.click_count) AS cta_clicks
        FROM account_threads t
        JOIN email_messages em ON em.gmail_thread_id = t.gmail_thread_id
        JOIN signature_cta_clicks s ON s.gmail_message_id = em.gmail_message_id
        GROUP BY LOWER(s.recipient_email)
      ),
      meetings AS (
        SELECT COALESCE(COUNT(*), 0) AS cnt
        FROM calendar_events
        WHERE linked_object_type = 'account'
          AND linked_object_id = ${id}
          AND status != 'cancelled'
      )
      SELECT
        ae.email,
        ae.best_type AS recipient_type,
        COALESCE(ce.name, ae.email) AS name,
        ce.contact_id,
        ce.title,
        ce.role_type,
        ce.avatar_url,
        COALESCE(ce.is_primary, FALSE) AS is_primary,
        ae.opens,
        ae.clicks,
        ae.demo_clicks,
        COALESCE(rd.replies, 0) AS replies,
        COALESCE(cd.cta_clicks, 0) AS cta_clicks,
        ae.recency_7d,
        ae.recency_30d,
        ae.last_event_at,
        (SELECT cnt FROM meetings) AS account_meetings
      FROM all_eng ae
      LEFT JOIN contact_emails ce ON ce.email = ae.email
      LEFT JOIN reply_data rd ON rd.email = ae.email
      LEFT JOIN cta_data cd ON cd.email = ae.email
      WHERE ae.opens > 0 OR ae.clicks > 0 OR COALESCE(rd.replies, 0) > 0 OR COALESCE(cd.cta_clicks, 0) > 0
      ORDER BY ae.opens DESC, ae.last_event_at DESC NULLS LAST
    `))).rows as any[];

    return rows;
  } catch (err) {
    console.warn("[ri] fetchChampionRows error (non-fatal):", err);
    return [];
  }
}

function mapChampionContact(r: any, maxScore: number): ChampionContact {
  const opens      = Number(r.opens      ?? 0);
  const clicks     = Number(r.clicks     ?? 0);
  const demoClicks = Number(r.demo_clicks ?? 0);
  const ctaClicks  = Number(r.cta_clicks ?? 0);
  const replies    = Number(r.replies    ?? 0);
  const recency7d  = Number(r.recency_7d ?? 0);
  const recency30d = Number(r.recency_30d ?? 0);
  const recipientType = (r.recipient_type || "to") as "to" | "cc" | "bcc";

  const championScore = calcChampionScore({ opens, clicks, demoClicks, ctaClicks, replies, recency7d, recency30d, recipientType });
  const role = classifyRole({ championScore, opens, clicks, replies, title: r.title, recipientType, recency7d, recency30d }, maxScore);

  return {
    email:          String(r.email),
    name:           r.name ? String(r.name) : null,
    contactId:      r.contact_id ? Number(r.contact_id) : null,
    title:          r.title ? String(r.title) : null,
    avatarUrl:      r.avatar_url ? String(r.avatar_url) : null,
    role,
    recipientType,
    isPrimary:      Boolean(r.is_primary),
    championScore,
    opens,
    clicks,
    demoClicks,
    ctaClicks,
    replies,
    recency7d,
    recency30d,
    lastActivityAt: r.last_event_at ? String(r.last_event_at) : null,
  };
}

// ─── Momentum ────────────────────────────────────────────────────────────────

export async function getAccountMomentum(accountId: number): Promise<AccountMomentum> {
  const id = SAFE_INT(accountId);
  try {
    const [row] = (await db.execute(sql.raw(`
      SELECT
        COUNT(DISTINCT CASE WHEN ee.occurred_at > NOW() - INTERVAL  '7 days' AND ee.is_bot=FALSE AND ee.is_internal IS NOT TRUE AND ee.event_type='open' THEN ee.id END) AS opens_7d,
        COUNT(DISTINCT CASE WHEN ee.occurred_at BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '7 days' AND ee.is_bot=FALSE AND ee.is_internal IS NOT TRUE AND ee.event_type='open' THEN ee.id END) AS opens_prev7d,
        COUNT(DISTINCT CASE WHEN ee.occurred_at > NOW() - INTERVAL '30 days' AND ee.is_bot=FALSE AND ee.is_internal IS NOT TRUE AND ee.event_type='open' THEN ee.id END) AS opens_30d,
        COUNT(DISTINCT CASE WHEN ee.occurred_at BETWEEN NOW() - INTERVAL '60 days' AND NOW() - INTERVAL '30 days' AND ee.is_bot=FALSE AND ee.is_internal IS NOT TRUE AND ee.event_type='open' THEN ee.id END) AS opens_prev30d,
        COUNT(DISTINCT CASE WHEN ee.occurred_at > NOW() - INTERVAL '90 days' AND ee.is_bot=FALSE AND ee.is_internal IS NOT TRUE AND ee.event_type='open' THEN ee.id END) AS opens_90d,
        COUNT(DISTINCT CASE WHEN ee.occurred_at BETWEEN NOW() - INTERVAL '180 days' AND NOW() - INTERVAL '90 days' AND ee.is_bot=FALSE AND ee.is_internal IS NOT TRUE AND ee.event_type='open' THEN ee.id END) AS opens_prev90d,
        MAX(ee.occurred_at) FILTER (WHERE ee.is_bot=FALSE AND ee.is_internal IS NOT TRUE) AS last_at
      FROM email_threads et
      JOIN email_messages em ON em.gmail_thread_id = et.gmail_thread_id AND em.direction = 'outbound'
      JOIN email_tracking_pixels p ON p.gmail_message_id = em.gmail_message_id
      LEFT JOIN email_engagement_events ee ON ee.tracking_id = p.tracking_id
      WHERE et.primary_account_id = ${id}
    `))).rows as any[];

    const last30d    = Number(row?.opens_30d    ?? 0);
    const prev30d    = Number(row?.opens_prev30d ?? 0);
    const last7d     = Number(row?.opens_7d      ?? 0);
    const prev7d     = Number(row?.opens_prev7d  ?? 0);
    const last90d    = Number(row?.opens_90d     ?? 0);
    const prev90d    = Number(row?.opens_prev90d ?? 0);
    const lastAt     = row?.last_at ? new Date(row.last_at) : null;
    const dormant    = !lastAt || (Date.now() - lastAt.getTime()) > 30 * 86400_000;

    let status: MomentumStatus;
    let trendPct = 0;
    if (dormant && last30d === 0) {
      status = "dormant";
    } else {
      trendPct = prev30d > 0 ? Math.round(((last30d - prev30d) / prev30d) * 100) : (last30d > 0 ? 100 : 0);
      status = trendPct >= 25 ? "accelerating" : trendPct <= -25 ? "cooling" : "stable";
      if (last30d === 0 && prev30d > 0) status = "cooling";
    }

    return { last7d, last30d, last90d, prev7d, prev30d, prev90d, status, trendPct };
  } catch (err) {
    console.warn("[ri] getAccountMomentum error:", err);
    return { last7d: 0, last30d: 0, last90d: 0, prev7d: 0, prev30d: 0, prev90d: 0, status: "dormant", trendPct: 0 };
  }
}

// ─── Buying Committee ─────────────────────────────────────────────────────────

export async function getBuyingCommittee(accountId: number, accountName = ""): Promise<BuyingCommittee> {
  const rows = await fetchChampionRows(accountId);
  if (rows.length === 0) {
    return { accountId, accountName, members: [], champion: null, decisionMaker: null, committeeSize: 0, externalCount: 0, confidenceScore: 0 };
  }

  // First pass — compute raw scores to find max (for relative classification)
  const rawScores = rows.map(r => calcChampionScore({
    opens: Number(r.opens ?? 0), clicks: Number(r.clicks ?? 0), demoClicks: Number(r.demo_clicks ?? 0),
    ctaClicks: Number(r.cta_clicks ?? 0), replies: Number(r.replies ?? 0),
    recency7d: Number(r.recency_7d ?? 0), recency30d: Number(r.recency_30d ?? 0),
    recipientType: r.recipient_type || "to",
  }));
  const maxScore = Math.max(...rawScores, 1);

  const members = rows.map((r, i) => mapChampionContact({ ...r, _rawScore: rawScores[i] }, maxScore));
  members.sort((a, b) => b.championScore - a.championScore);

  const champion     = members.find(m => m.role === "champion") ?? members.find(m => m.role === "emerging_champion") ?? null;
  const decisionMaker = members.find(m => m.role === "decision_maker") ?? null;
  const externalCount = members.filter(m => m.role !== "internal").length;

  // Confidence: higher when both champion + DM identified + recent activity
  let confidence = 40;
  if (champion) confidence += 25;
  if (decisionMaker) confidence += 20;
  if (champion && decisionMaker) confidence += 10;
  if (champion?.recency7d && champion.recency7d > 0) confidence += 5;
  confidence = Math.min(98, confidence);

  return {
    accountId,
    accountName,
    members,
    champion,
    decisionMaker,
    committeeSize: externalCount,
    externalCount,
    confidenceScore: confidence,
  };
}

// ─── Account Intelligence (full) ─────────────────────────────────────────────

export async function getAccountIntelligence(accountId: number): Promise<AccountIntelligence | null> {
  const id = SAFE_INT(accountId);
  if (!id) return null;

  try {
    // Get account name
    const [acct] = (await db.execute(sql.raw(`SELECT id, name FROM accounts WHERE id = ${id} LIMIT 1`))).rows as any[];
    if (!acct) return null;

    const [committee, momentum] = await Promise.all([
      getBuyingCommittee(id, acct.name),
      getAccountMomentum(id),
    ]);

    const members = committee.members;
    const engagementScore = computeAccountScore(members);
    const mostEngaged = members[0] ?? null;

    // Build insights
    const insights: AccountInsight[] = [];

    if (committee.champion) {
      const c = committee.champion;
      insights.push({
        type: "champion_active",
        severity: "success",
        text: `${c.name ?? c.email} has opened ${c.opens} email${c.opens !== 1 ? "s" : ""} and clicked ${c.clicks} link${c.clicks !== 1 ? "s" : ""}${c.recency7d > 0 ? " in the last 7 days" : ""}. Engagement is ${momentum.status}.`,
      });
    }

    if (momentum.status === "accelerating") {
      insights.push({
        type: "engagement_rising",
        severity: "success",
        text: `${acct.name} engagement increased ${Math.abs(momentum.trendPct)}% over the last 30 days.`,
      });
    } else if (momentum.status === "cooling") {
      insights.push({
        type: "cooling",
        severity: "warning",
        text: `${acct.name} engagement has dropped ${Math.abs(momentum.trendPct)}% vs the prior 30 days.`,
      });
    } else if (momentum.status === "dormant") {
      insights.push({
        type: "dormant",
        severity: "warning",
        text: `No engagement from ${acct.name} in the last 30 days. May need a touch-base.`,
      });
    }

    if (!committee.decisionMaker && members.length > 0) {
      insights.push({
        type: "decision_maker_needed",
        severity: "info",
        text: `Account appears to have a champion but no identified decision maker.`,
      });
    }

    if (members.some(m => m.demoClicks > 0 || m.ctaClicks > 0)) {
      insights.push({
        type: "high_intent",
        severity: "success",
        text: `${members.filter(m => m.demoClicks > 0).map(m => m.name ?? m.email).join(", ")} viewed a demo link — high purchase intent signal.`,
      });
    }

    const lastEngagementAt = members.reduce((latest, m) => {
      if (!m.lastActivityAt) return latest;
      if (!latest) return m.lastActivityAt;
      return m.lastActivityAt > latest ? m.lastActivityAt : latest;
    }, null as string | null);

    return {
      accountId: id,
      accountName: String(acct.name),
      engagementScore,
      committee,
      mostEngaged,
      momentum,
      insights,
      lastEngagementAt,
    };
  } catch (err) {
    console.error("[ri] getAccountIntelligence error:", err);
    return null;
  }
}

// ─── Heatmap (all accounts, lightweight) ─────────────────────────────────────

export async function getEngagementHeatmap(limit = 50): Promise<AccountEngagement[]> {
  const lim = Math.min(Number(limit) || 50, 200);
  try {
    const rows = (await db.execute(sql.raw(`
      WITH
      top_champion AS (
        SELECT DISTINCT ON (et2.primary_account_id)
          et2.primary_account_id                                  AS account_id,
          COALESCE(c2.name, er2.recipient_email)                  AS champion_name,
          LOWER(er2.recipient_email)                              AS champion_email
        FROM email_threads et2
        JOIN email_recipients er2
          ON er2.gmail_thread_id = et2.gmail_thread_id
          AND er2.is_internal IS NOT TRUE
        LEFT JOIN email_engagement_events ee2
          ON ee2.tracking_id = er2.tracking_token
          AND ee2.is_bot=FALSE AND ee2.is_internal IS NOT TRUE
        LEFT JOIN contacts c2 ON LOWER(c2.email) = LOWER(er2.recipient_email)
        WHERE et2.primary_account_id IS NOT NULL
        GROUP BY et2.primary_account_id, LOWER(er2.recipient_email),
                 COALESCE(c2.name, er2.recipient_email)
        ORDER BY et2.primary_account_id, COUNT(DISTINCT ee2.id) DESC
      ),
      committee_counts AS (
        SELECT
          et3.primary_account_id                                  AS account_id,
          COUNT(DISTINCT LOWER(er3.recipient_email))              AS size
        FROM email_threads et3
        JOIN email_recipients er3
          ON er3.gmail_thread_id = et3.gmail_thread_id
          AND er3.is_internal IS NOT TRUE
        JOIN email_engagement_events ee3
          ON ee3.tracking_id = er3.tracking_token
          AND ee3.is_bot=FALSE AND ee3.is_internal IS NOT TRUE
        WHERE et3.primary_account_id IS NOT NULL
        GROUP BY et3.primary_account_id
      ),
      main_data AS (
        SELECT
          et.primary_account_id                                   AS account_id,
          a.name                                                  AS account_name,
          COUNT(DISTINCT CASE WHEN ee.event_type='open'  AND ee.is_bot=FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE THEN ee.id END) AS total_opens,
          COUNT(DISTINCT CASE WHEN ee.event_type='click' AND ee.is_bot=FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE THEN ee.id END) AS total_clicks,
          COUNT(DISTINCT CASE WHEN ee.event_type='open'  AND ee.is_bot=FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE
              AND ee.occurred_at > NOW() - INTERVAL '7 days'  THEN ee.id END) AS opens_7d,
          COUNT(DISTINCT CASE WHEN ee.event_type='open'  AND ee.is_bot=FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE
              AND ee.occurred_at > NOW() - INTERVAL '30 days' THEN ee.id END) AS opens_30d,
          COUNT(DISTINCT CASE WHEN ee.event_type='open'  AND ee.is_bot=FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE
              AND ee.occurred_at BETWEEN NOW() - INTERVAL '60 days' AND NOW() - INTERVAL '30 days' THEN ee.id END) AS opens_prev30d,
          MAX(ee.occurred_at) FILTER (WHERE ee.is_bot=FALSE AND ee.is_internal IS NOT TRUE) AS last_engagement_at
        FROM email_threads et
        JOIN accounts a ON a.id = et.primary_account_id
        JOIN email_messages em ON em.gmail_thread_id = et.gmail_thread_id AND em.direction = 'outbound'
        JOIN email_tracking_pixels p ON p.gmail_message_id = em.gmail_message_id
        LEFT JOIN email_engagement_events ee ON ee.tracking_id = p.tracking_id
        WHERE et.primary_account_id IS NOT NULL
        GROUP BY et.primary_account_id, a.name
        HAVING COUNT(DISTINCT CASE WHEN ee.event_type='open' AND ee.is_bot=FALSE AND ee.is_internal IS NOT TRUE THEN ee.id END) > 0
      )
      SELECT
        md.*,
        tc.champion_name,
        tc.champion_email,
        COALESCE(cc.size, 0) AS committee_size
      FROM main_data md
      LEFT JOIN top_champion tc ON tc.account_id = md.account_id
      LEFT JOIN committee_counts cc ON cc.account_id = md.account_id
      ORDER BY md.total_opens DESC
      LIMIT ${lim}
    `))).rows as any[];

    return rows.map((r: any) => {
      const totalOpens = Number(r.total_opens  ?? 0);
      const opens30d   = Number(r.opens_30d    ?? 0);
      const prev30d    = Number(r.opens_prev30d ?? 0);
      const lastAt     = r.last_engagement_at ? new Date(r.last_engagement_at) : null;
      const dormant    = !lastAt || (Date.now() - lastAt.getTime()) > 30 * 86400_000;
      const trendPct   = prev30d > 0 ? Math.round(((opens30d - prev30d) / prev30d) * 100) : (opens30d > 0 ? 100 : 0);
      let trend: MomentumStatus = dormant ? "dormant"
        : opens30d === 0 && prev30d > 0 ? "cooling"
        : trendPct >= 25 ? "accelerating"
        : trendPct <= -25 ? "cooling"
        : "stable";
      const engagementScore = Math.min(100, Math.round(Math.sqrt(totalOpens) * 12 + Number(r.total_clicks ?? 0) * 3));
      return {
        accountId:        Number(r.account_id),
        accountName:      String(r.account_name),
        engagementScore,
        trend,
        trendPct,
        champion: r.champion_name ? {
          email: String(r.champion_email ?? ""), name: String(r.champion_name),
          contactId: null, title: null, avatarUrl: null,
          role: "champion" as BuyingRole, recipientType: "to" as const,
          isPrimary: false, championScore: 0, opens: 0, clicks: 0,
          demoClicks: 0, ctaClicks: 0, replies: 0, recency7d: 0, recency30d: 0,
          lastActivityAt: null,
        } : null,
        committeeSize:    Number(r.committee_size ?? 0),
        lastEngagementAt: r.last_engagement_at ? String(r.last_engagement_at) : null,
        totalOpens,
        totalClicks:      Number(r.total_clicks ?? 0),
        opens7d:          Number(r.opens_7d  ?? 0),
        opens30d,
      };
    });
  } catch (err) {
    console.error("[ri] getEngagementHeatmap error:", err);
    return [];
  }
}

// ─── Follow-up opportunities ──────────────────────────────────────────────────

export async function getFollowUpOpportunities(limit = 20): Promise<FollowUpOpportunity[]> {
  const lim = Math.min(Number(limit) || 20, 100);
  try {
    const rows = (await db.execute(sql.raw(`
      SELECT
        et.primary_account_id                                                                           AS account_id,
        a.name                                                                                          AS account_name,
        MAX(ee.occurred_at) FILTER (WHERE ee.is_bot=FALSE AND ee.is_internal IS NOT TRUE)               AS last_activity_at,
        EXTRACT(EPOCH FROM (NOW() - MAX(ee.occurred_at) FILTER (WHERE ee.is_bot=FALSE AND ee.is_internal IS NOT TRUE))) / 86400 AS days_silent,
        COUNT(DISTINCT CASE WHEN ee.event_type='open'  AND ee.is_bot=FALSE AND ee.is_internal IS NOT TRUE THEN ee.id END) AS total_opens,
        COUNT(DISTINCT CASE WHEN ee.event_type='click' AND ee.is_bot=FALSE AND ee.is_internal IS NOT TRUE THEN ee.id END) AS total_clicks,
        et.gmail_thread_id                                                                              AS last_thread_id,
        (
          SELECT em2.subject FROM email_messages em2
          WHERE em2.gmail_thread_id = et.gmail_thread_id AND em2.direction = 'outbound'
          ORDER BY em2.created_at DESC LIMIT 1
        )                                                                                               AS last_subject,
        (
          SELECT LOWER(p2.recipient_email) FROM email_tracking_pixels p2
          JOIN email_engagement_events ee2 ON ee2.tracking_id = p2.tracking_id
          WHERE p2.gmail_message_id IN (
            SELECT em3.gmail_message_id FROM email_messages em3
            WHERE em3.gmail_thread_id = et.gmail_thread_id AND em3.direction = 'outbound'
          )
          AND ee2.is_bot=FALSE AND ee2.is_internal IS NOT TRUE
          GROUP BY LOWER(p2.recipient_email)
          ORDER BY COUNT(*) DESC LIMIT 1
        )                                                                                               AS champion_email,
        (
          SELECT COALESCE(c3.name, iq.ce)
          FROM (
            SELECT LOWER(p2b.recipient_email) AS ce FROM email_tracking_pixels p2b
            JOIN email_engagement_events ee2b ON ee2b.tracking_id = p2b.tracking_id
            WHERE p2b.gmail_message_id IN (
              SELECT em3b.gmail_message_id FROM email_messages em3b
              WHERE em3b.gmail_thread_id = et.gmail_thread_id AND em3b.direction = 'outbound'
            )
            AND ee2b.is_bot=FALSE AND ee2b.is_internal IS NOT TRUE
            GROUP BY LOWER(p2b.recipient_email)
            ORDER BY COUNT(*) DESC LIMIT 1
          ) iq
          LEFT JOIN contacts c3 ON LOWER(c3.email) = iq.ce
        )                                                                                               AS champion_name
      FROM email_threads et
      JOIN accounts a ON a.id = et.primary_account_id
      JOIN email_messages em ON em.gmail_thread_id = et.gmail_thread_id AND em.direction = 'outbound'
      JOIN email_tracking_pixels p ON p.gmail_message_id = em.gmail_message_id
      LEFT JOIN email_engagement_events ee ON ee.tracking_id = p.tracking_id
      WHERE et.primary_account_id IS NOT NULL
      GROUP BY et.primary_account_id, a.name, et.gmail_thread_id
      HAVING
        COUNT(DISTINCT CASE WHEN ee.event_type='open' AND ee.is_bot=FALSE AND ee.is_internal IS NOT TRUE THEN ee.id END) >= 3
        AND MAX(ee.occurred_at) FILTER (WHERE ee.is_bot=FALSE AND ee.is_internal IS NOT TRUE) < NOW() - INTERVAL '7 days'
        AND MAX(ee.occurred_at) FILTER (WHERE ee.is_bot=FALSE AND ee.is_internal IS NOT TRUE) > NOW() - INTERVAL '90 days'
      ORDER BY
        (COUNT(DISTINCT CASE WHEN ee.event_type='open' AND ee.is_bot=FALSE AND ee.is_internal IS NOT TRUE THEN ee.id END) *
         EXTRACT(EPOCH FROM (NOW() - MAX(ee.occurred_at) FILTER (WHERE ee.is_bot=FALSE AND ee.is_internal IS NOT TRUE))) / 86400) DESC
      LIMIT ${lim}
    `))).rows as any[];

    // Dedupe by accountId (keep highest scoring thread per account)
    const seen = new Set<number>();
    const result: FollowUpOpportunity[] = [];
    for (const r of rows) {
      const acctId = Number(r.account_id);
      if (seen.has(acctId)) continue;
      seen.add(acctId);
      const totalOpens = Number(r.total_opens ?? 0);
      const days = Math.round(Number(r.days_silent ?? 0));
      const score = Math.round(totalOpens * Math.sqrt(days + 1));
      result.push({
        accountId:     acctId,
        accountName:   String(r.account_name),
        champion:      r.champion_email
          ? { email: String(r.champion_email),
              name: r.champion_name ? String(r.champion_name) : null,
              contactId: null, title: null, avatarUrl: null,
              role: "champion" as BuyingRole, recipientType: "to" as const, isPrimary: false, championScore: 0,
              opens: totalOpens, clicks: 0, demoClicks: 0, ctaClicks: 0, replies: 0, recency7d: 0, recency30d: 0,
              lastActivityAt: r.last_activity_at ? String(r.last_activity_at) : null }
          : null,
        lastActivityAt: r.last_activity_at ? String(r.last_activity_at) : null,
        daysSilent:    days,
        score,
        totalOpens,
        totalClicks:   Number(r.total_clicks ?? 0),
        lastThreadId:  r.last_thread_id ? String(r.last_thread_id) : null,
        lastSubject:   r.last_subject   ? String(r.last_subject)   : null,
      });
    }
    return result.slice(0, lim);
  } catch (err) {
    console.error("[ri] getFollowUpOpportunities error:", err);
    return [];
  }
}

// ─── Thread: most engaged contact ────────────────────────────────────────────

export async function getThreadMostEngaged(threadId: string): Promise<ThreadMostEngaged | null> {
  const tEsc = esc(threadId);
  try {
    const rows = (await db.execute(sql.raw(`
      SELECT
        LOWER(er.recipient_email)                                                                       AS email,
        COALESCE(c.name, er.recipient_email)                                                            AS name,
        c.id                                                                                            AS contact_id,
        c.avatar_url,
        c.title,
        COUNT(DISTINCT CASE WHEN ee.event_type='open'  AND ee.is_bot=FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE THEN ee.id END) AS opens,
        COUNT(DISTINCT CASE WHEN ee.event_type='click' AND ee.is_bot=FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE THEN ee.id END) AS clicks,
        COALESCE((
          SELECT SUM(s.click_count) FROM signature_cta_clicks s
          WHERE LOWER(s.recipient_email) = LOWER(er.recipient_email)
            AND s.gmail_message_id IN (
              SELECT em2.gmail_message_id FROM email_messages em2 WHERE em2.gmail_thread_id = '${tEsc}'
            )
        ), 0) AS cta_clicks,
        MAX(ee.occurred_at) FILTER (WHERE ee.is_bot=FALSE AND ee.is_internal IS NOT TRUE)               AS last_at
      FROM email_recipients er
      LEFT JOIN email_engagement_events ee ON ee.tracking_id = er.tracking_token
      LEFT JOIN contacts c ON LOWER(c.email) = LOWER(er.recipient_email)
      WHERE er.gmail_thread_id = '${tEsc}'
        AND er.is_internal IS NOT TRUE
      GROUP BY LOWER(er.recipient_email), c.name, c.id, c.avatar_url, c.title
      ORDER BY
        (COUNT(DISTINCT CASE WHEN ee.event_type='open' AND ee.is_bot=FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE THEN ee.id END) * 1 +
         COUNT(DISTINCT CASE WHEN ee.event_type='click' AND ee.is_bot=FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE THEN ee.id END) * 3) DESC
      LIMIT 1
    `))).rows as any[];

    if (!rows[0]) return null;
    const r = rows[0] as any;
    const opens  = Number(r.opens      ?? 0);
    const clicks = Number(r.clicks     ?? 0);
    const cta    = Number(r.cta_clicks ?? 0);
    const score  = opens * W_OPEN + clicks * W_CLICK + cta * W_CTA;
    if (score === 0) return null;
    return {
      email:          String(r.email),
      name:           r.name ? String(r.name) : null,
      contactId:      r.contact_id ? Number(r.contact_id) : null,
      avatarUrl:      r.avatar_url ? String(r.avatar_url) : null,
      title:          r.title ? String(r.title) : null,
      score,
      opens,
      clicks,
      ctaClicks:      cta,
      lastActivityAt: r.last_at ? String(r.last_at) : null,
    };
  } catch (err) {
    console.warn("[ri] getThreadMostEngaged error:", err);
    return null;
  }
}

// ─── Revenue Command Center ───────────────────────────────────────────────────

export async function getCommandCenterData(): Promise<CommandCenterData> {
  const [heatmap, followUpOpportunities, champions] = await Promise.all([
    getEngagementHeatmap(100),
    getFollowUpOpportunities(20),
    getChampionsLeaderboard(20),
  ]);

  const hotAccounts     = heatmap.filter(a => a.engagementScore >= 50).slice(0, 10);
  const accelerating    = heatmap.filter(a => a.trend === "accelerating").slice(0, 10);
  const cooling         = heatmap.filter(a => a.trend === "cooling" || a.trend === "dormant");
  const atRisk          = cooling.filter(a => a.engagementScore >= 20).slice(0, 10);

  const avgScore = heatmap.length > 0
    ? Math.round(heatmap.reduce((s, a) => s + a.engagementScore, 0) / heatmap.length)
    : 0;

  return {
    hotAccounts,
    accelerating,
    followUpOpportunities,
    atRisk,
    heatmap: heatmap.slice(0, 50),
    champions,
    summary: {
      hotCount:            hotAccounts.length,
      totalActiveAccounts: heatmap.length,
      avgScore,
    },
  };
}

// ─── Champions Leaderboard ────────────────────────────────────────────────────

export async function getChampionsLeaderboard(limit = 20): Promise<ChampionLeader[]> {
  const lim = Math.min(Number(limit) || 20, 100);
  try {
    const rows = (await db.execute(sql.raw(`
      WITH per_contact AS (
        SELECT
          et.primary_account_id                                                          AS account_id,
          a.name                                                                         AS account_name,
          LOWER(er.recipient_email)                                                      AS email,
          COALESCE(c.name, er.recipient_email)                                           AS name,
          c.title,
          COUNT(DISTINCT CASE WHEN ee.event_type='open'  AND ee.is_bot=FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE THEN ee.id END) AS opens,
          COUNT(DISTINCT CASE WHEN ee.event_type='click' AND ee.is_bot=FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE THEN ee.id END) AS clicks,
          COUNT(DISTINCT CASE WHEN ee.is_bot=FALSE AND ee.is_internal IS NOT TRUE AND ee.occurred_at > NOW()-INTERVAL'7 days'  THEN ee.id END) AS recency7d,
          COUNT(DISTINCT CASE WHEN ee.is_bot=FALSE AND ee.is_internal IS NOT TRUE AND ee.occurred_at > NOW()-INTERVAL'30 days' THEN ee.id END) AS recency30d,
          MAX(ee.occurred_at) FILTER (WHERE ee.is_bot=FALSE AND ee.is_internal IS NOT TRUE) AS last_at
        FROM email_threads et
        JOIN accounts a ON a.id = et.primary_account_id
        JOIN email_recipients er ON er.gmail_thread_id = et.gmail_thread_id AND er.is_internal IS NOT TRUE
        LEFT JOIN email_engagement_events ee ON ee.tracking_id = er.tracking_token
        LEFT JOIN contacts c ON LOWER(c.email) = LOWER(er.recipient_email)
        WHERE et.primary_account_id IS NOT NULL
        GROUP BY et.primary_account_id, a.name, LOWER(er.recipient_email), c.name, c.title
        HAVING COUNT(DISTINCT CASE WHEN ee.is_bot=FALSE AND ee.is_internal IS NOT TRUE THEN ee.id END) > 0
      ),
      ranked AS (
        SELECT *,
          ROUND((opens * 1.0 + clicks * 3.0) *
            (CASE WHEN recency7d > 0 THEN 1.5 WHEN recency30d > 0 THEN 1.2 ELSE 1.0 END)) AS champion_score,
          ROW_NUMBER() OVER (
            PARTITION BY account_id
            ORDER BY (opens * 1.0 + clicks * 3.0) *
              (CASE WHEN recency7d > 0 THEN 1.5 WHEN recency30d > 0 THEN 1.2 ELSE 1.0 END) DESC
          ) AS rn
        FROM per_contact
      )
      SELECT account_id, account_name, email, name, title, opens, clicks, champion_score, last_at
      FROM ranked
      WHERE rn = 1 AND champion_score >= 3
      ORDER BY champion_score DESC
      LIMIT ${lim}
    `))).rows as any[];

    return rows.map((r: any) => ({
      accountId:     Number(r.account_id),
      accountName:   String(r.account_name),
      email:         String(r.email),
      name:          r.name  ? String(r.name)  : null,
      title:         r.title ? String(r.title) : null,
      championScore: Number(r.champion_score ?? 0),
      opens:         Number(r.opens  ?? 0),
      clicks:        Number(r.clicks ?? 0),
      lastActivityAt: r.last_at ? String(r.last_at) : null,
    }));
  } catch (err) {
    console.error("[ri] getChampionsLeaderboard error:", err);
    return [];
  }
}

// ─── Account Activity Timeline ────────────────────────────────────────────────

export async function getAccountActivityTimeline(accountId: number): Promise<ActivityEvent[]> {
  const id = SAFE_INT(accountId);
  if (!id) return [];
  try {
    const rows = (await db.execute(sql.raw(`
      SELECT * FROM (
        SELECT
          CASE WHEN (LOWER(COALESCE(ee.url,'')) LIKE '%demo%' OR LOWER(COALESCE(ee.url,'')) LIKE '%video%' OR LOWER(COALESCE(ee.url,'')) LIKE '%watch%')
               THEN 'demo' ELSE 'open' END                             AS type,
          ee.occurred_at                                               AS at,
          COALESCE(c.name, er.recipient_email)                         AS contact_name,
          LOWER(er.recipient_email)                                    AS contact_email,
          NULL::text                                                   AS subject,
          NULL::text                                                   AS url
        FROM email_threads et
        JOIN email_recipients er ON er.gmail_thread_id = et.gmail_thread_id AND er.is_internal IS NOT TRUE
        JOIN email_engagement_events ee ON ee.tracking_id = er.tracking_token
          AND ee.event_type='open' AND ee.is_bot=FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE
        LEFT JOIN contacts c ON LOWER(c.email) = LOWER(er.recipient_email)
        WHERE et.primary_account_id = ${id}

        UNION ALL

        SELECT
          CASE WHEN (LOWER(COALESCE(ee.url,'')) LIKE '%demo%' OR LOWER(COALESCE(ee.url,'')) LIKE '%video%' OR LOWER(COALESCE(ee.url,'')) LIKE '%watch%')
               THEN 'demo' ELSE 'click' END                            AS type,
          ee.occurred_at                                               AS at,
          COALESCE(c.name, er.recipient_email)                         AS contact_name,
          LOWER(er.recipient_email)                                    AS contact_email,
          NULL::text                                                   AS subject,
          ee.url
        FROM email_threads et
        JOIN email_recipients er ON er.gmail_thread_id = et.gmail_thread_id AND er.is_internal IS NOT TRUE
        JOIN email_engagement_events ee ON ee.tracking_id = er.tracking_token
          AND ee.event_type='click' AND ee.is_bot=FALSE AND ee.is_duplicate IS NOT TRUE AND ee.is_internal IS NOT TRUE
        LEFT JOIN contacts c ON LOWER(c.email) = LOWER(er.recipient_email)
        WHERE et.primary_account_id = ${id}

        UNION ALL

        SELECT
          'reply'                                                      AS type,
          em.sent_at                                                   AS at,
          COALESCE(c.name, em.from_email)                              AS contact_name,
          LOWER(em.from_email)                                         AS contact_email,
          em.subject,
          NULL::text                                                   AS url
        FROM email_threads et
        JOIN email_messages em ON em.gmail_thread_id = et.gmail_thread_id AND em.direction='inbound'
        LEFT JOIN contacts c ON LOWER(c.email) = LOWER(em.from_email)
        WHERE et.primary_account_id = ${id}

        UNION ALL

        SELECT
          'meeting'                                                    AS type,
          ce.start_time                                                AS at,
          NULL::text                                                   AS contact_name,
          NULL::text                                                   AS contact_email,
          ce.title                                                     AS subject,
          NULL::text                                                   AS url
        FROM calendar_events ce
        WHERE ce.linked_object_type='account' AND ce.linked_object_id=${id}
          AND ce.status != 'cancelled' AND ce.start_time IS NOT NULL
      ) events
      ORDER BY at DESC NULLS LAST
      LIMIT 20
    `))).rows as any[];

    return rows.map((r: any) => ({
      type:         String(r.type) as ActivityEvent["type"],
      at:           String(r.at),
      contactName:  r.contact_name  ? String(r.contact_name)  : null,
      contactEmail: r.contact_email ? String(r.contact_email) : null,
      subject:      r.subject       ? String(r.subject)       : null,
      url:          r.url           ? String(r.url)           : null,
    }));
  } catch (err) {
    console.warn("[ri] getAccountActivityTimeline error:", err);
    return [];
  }
}

// ─── Account Open Opportunities ───────────────────────────────────────────────

export async function getAccountOpenOpportunities(accountId: number): Promise<AccountOpportunity[]> {
  const id = SAFE_INT(accountId);
  if (!id) return [];
  try {
    const rows = (await db.execute(sql.raw(`
      SELECT id, title, stage, COALESCE(amount, 0) AS amount, currency,
             est_close_date, forecast_category
      FROM opportunities
      WHERE account_id = ${id}
        AND stage NOT IN ('closed_won', 'closed_lost')
      ORDER BY COALESCE(amount, 0) DESC, created_at DESC
      LIMIT 10
    `))).rows as any[];

    return rows.map((r: any) => ({
      id:               Number(r.id),
      title:            String(r.title),
      stage:            String(r.stage),
      amount:           Number(r.amount ?? 0),
      currency:         String(r.currency ?? "USD"),
      estCloseDate:     r.est_close_date ? String(r.est_close_date) : null,
      forecastCategory: String(r.forecast_category ?? "pipeline"),
    }));
  } catch (err) {
    console.warn("[ri] getAccountOpenOpportunities error:", err);
    return [];
  }
}

// ─── Thread Account Momentum ──────────────────────────────────────────────────

export async function getThreadAccountMomentum(threadId: string): Promise<AccountMomentum | null> {
  const tEsc = esc(threadId);
  try {
    const [row] = (await db.execute(sql.raw(
      `SELECT primary_account_id FROM email_threads WHERE gmail_thread_id='${tEsc}' AND primary_account_id IS NOT NULL LIMIT 1`
    ))).rows as any[];
    if (!row?.primary_account_id) return null;
    return await getAccountMomentum(Number(row.primary_account_id));
  } catch (err) {
    console.warn("[ri] getThreadAccountMomentum error:", err);
    return null;
  }
}
