/**
 * AI Follow-Up Engine (Phase 3)
 *
 * Builds engagement summaries from real tracking data (opens, CTA clicks, email
 * cadence, reply status) and generates behaviour-driven follow-up suggestions.
 *
 * - No auto-send, no background jobs — all event-driven by explicit user action.
 * - Internal VoltSafe clicks are excluded from all analytics.
 * - Preserves all existing AI email quality rules (formatting, no fake sig, etc.)
 */

import OpenAI from "openai";
import { db } from "../db";
import { sql } from "drizzle-orm";

// ── Types ─────────────────────────────────────────────────────────────────────

export type FollowUpCategory =
  | "hot"        // multiple opens/clicks, no reply
  | "warm"       // opened but no clicks
  | "re-engage"  // recent outbound, no activity
  | "technical"  // clicked spec/cert/install materials
  | "commercial" // clicked pricing/proposal/ROI materials
  | "dormant"    // no activity for 14+ days
  | "neutral";   // default when signals are weak

export interface EngagementSummary {
  entityType: string;
  entityId: number;
  uniqueOpens: number;
  uniqueClicks: number;
  ctaClicks: Array<{ ctaName: string; destinationUrl: string; clickCount: number; lastClickedAt: string | null }>;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  daysSinceLastReply: number | null;
  daysSinceLastOutbound: number | null;
  totalEmails: number;
  hasReplied: boolean;
  insightText: string;
  category: FollowUpCategory;
  /** Human-readable bullets explaining why this category was chosen. */
  whyText: string[];
}

export interface FollowUpInsight {
  category: FollowUpCategory;
  insightText: string;
  whyText: string[];
  summary: EngagementSummary;
  generatedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildOpenAIClient(): OpenAI | null {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
}

async function safeRows(sqlStr: string): Promise<any[]> {
  try {
    const r = await db.execute(sql.raw(sqlStr));
    return (r as any).rows || [];
  } catch { return []; }
}

function daysBetween(dateStr: string | null, now = new Date()): number | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  } catch { return null; }
}

/** URL patterns that suggest technical content. */
const TECHNICAL_PATTERNS = [
  "spec", "pedestal", "shore-power", "shore_power", "cert", "install",
  "compliance", "technical", "datasheet", "data-sheet", "manual", "guide",
  "commissioning", "wiring", "electrical",
];

/** URL patterns that suggest commercial interest. */
const COMMERCIAL_PATTERNS = [
  "pric", "proposal", "quote", "roi", "return-on-investment", "cost",
  "budget", "procurement", "contract", "invest",
];

function categoriseCta(url: string, name: string): "technical" | "commercial" | "other" {
  const hay = `${url} ${name}`.toLowerCase();
  if (TECHNICAL_PATTERNS.some(p => hay.includes(p))) return "technical";
  if (COMMERCIAL_PATTERNS.some(p => hay.includes(p))) return "commercial";
  return "other";
}

// ── Core: engagement summary ──────────────────────────────────────────────────

/**
 * Builds an engagement summary for a given CRM entity.
 * Queries email history + CTA click data. All internal clicks excluded.
 */
export async function buildEngagementSummary(
  entityType: string,
  entityId: number
): Promise<EngagementSummary> {
  const id = Number(entityId);

  // ── Email cadence ──────────────────────────────────────────────────────────
  const emailStats = await safeRows(`
    SELECT
      COUNT(*) AS total,
      MAX(em.sent_at) FILTER (WHERE em.direction = 'inbound')  AS last_inbound_at,
      MAX(em.sent_at) FILTER (WHERE em.direction = 'outbound') AS last_outbound_at,
      COUNT(*) FILTER (WHERE em.direction = 'inbound') AS inbound_count
    FROM email_associations ea
    JOIN email_messages em ON ea.email_message_id = em.id
    WHERE ea.object_type = '${entityType}' AND ea.object_id = ${id}
  `);
  const es = emailStats[0] || {};
  const totalEmails = Number(es.total || 0);
  const lastInboundAt  = es.last_inbound_at  ? String(es.last_inbound_at)  : null;
  const lastOutboundAt = es.last_outbound_at ? String(es.last_outbound_at) : null;
  const hasReplied = Number(es.inbound_count || 0) > 0;

  // ── Email open/click tracking (email_engagement_events, is_internal excluded) ──
  // Joins through email_recipients (tracking_token) → email_engagement_events.
  // Safe try/catch — table may not exist in all environments.
  let uniqueOpens = 0;
  let uniqueClicks = 0;
  try {
    const trackingStats = await safeRows(`
      SELECT
        COUNT(*) FILTER (WHERE ee.event_type = 'open'  AND ee.is_bot = FALSE AND ee.is_duplicate = FALSE AND ee.is_internal IS NOT TRUE) AS unique_opens,
        COUNT(*) FILTER (WHERE ee.event_type = 'click' AND ee.is_bot = FALSE AND ee.is_duplicate = FALSE AND ee.is_internal IS NOT TRUE) AS unique_clicks
      FROM email_associations ea
      JOIN email_messages em ON ea.email_message_id = em.id
      JOIN email_recipients er ON er.gmail_message_id = em.gmail_message_id
      JOIN email_engagement_events ee ON ee.tracking_token = er.tracking_token
      WHERE ea.object_type = '${entityType}' AND ea.object_id = ${id}
    `);
    uniqueOpens  = Number(trackingStats[0]?.unique_opens  || 0);
    uniqueClicks = Number(trackingStats[0]?.unique_clicks || 0);
  } catch { /* tracking tables may differ — proceed with 0 */ }

  // ── CTA clicks (signature_cta_clicks) ─────────────────────────────────────
  // Filter by contact_id / account_id where available, or fall back to no entity link.
  let ctaRows: any[] = [];
  const ctaFilter = entityType === "contact"
    ? `sc.contact_id = ${id}`
    : entityType === "account"
    ? `sc.account_id = ${id}`
    : `FALSE`; // leads don't have direct cta FK — skip

  if (entityType !== "lead") {
    ctaRows = await safeRows(`
      SELECT sc.cta_name, sc.destination_url, SUM(sc.click_count) AS total_clicks,
             MAX(sc.last_clicked_at) AS last_clicked_at
      FROM signature_cta_clicks sc
      WHERE ${ctaFilter} AND sc.click_count > 0
      GROUP BY sc.cta_name, sc.destination_url
      ORDER BY total_clicks DESC
      LIMIT 10
    `);
  }

  const ctaClicks = ctaRows.map((r: any) => ({
    ctaName: String(r.cta_name || ""),
    destinationUrl: String(r.destination_url || ""),
    clickCount: Number(r.total_clicks || 0),
    lastClickedAt: r.last_clicked_at ? String(r.last_clicked_at) : null,
  }));

  // ── Classify ───────────────────────────────────────────────────────────────
  const now = new Date();
  const daysSinceLastReply    = daysBetween(lastInboundAt, now);
  const daysSinceLastOutbound = daysBetween(lastOutboundAt, now);

  const techCtaClicks = ctaClicks.filter(c => categoriseCta(c.destinationUrl, c.ctaName) === "technical");
  const commCtaClicks = ctaClicks.filter(c => categoriseCta(c.destinationUrl, c.ctaName) === "commercial");

  let category: FollowUpCategory;
  const whyText: string[] = [];

  if (techCtaClicks.length > 0) {
    category = "technical";
    whyText.push(`Clicked technical materials: ${techCtaClicks.map(c => c.ctaName || c.destinationUrl).slice(0, 3).join(", ")}`);
  } else if (commCtaClicks.length > 0) {
    category = "commercial";
    whyText.push(`Clicked commercial/pricing materials: ${commCtaClicks.map(c => c.ctaName || c.destinationUrl).slice(0, 3).join(", ")}`);
  } else if (uniqueOpens >= 3 && !hasReplied) {
    category = "hot";
    whyText.push(`Opened email ${uniqueOpens} time${uniqueOpens !== 1 ? "s" : ""} with no reply`);
    if (uniqueClicks > 0) whyText.push(`Clicked links ${uniqueClicks} time${uniqueClicks !== 1 ? "s" : ""}`);
  } else if (uniqueOpens >= 1 && uniqueClicks === 0 && !hasReplied) {
    category = "warm";
    whyText.push(`Opened email but no clicks or reply yet`);
  } else if (daysSinceLastOutbound !== null && daysSinceLastOutbound >= 14 && !hasReplied) {
    category = "dormant";
    whyText.push(`No activity for ${daysSinceLastOutbound} days`);
    if (daysSinceLastOutbound !== null) whyText.push(`Last outbound: ${daysSinceLastOutbound} days ago`);
  } else if (lastOutboundAt && !hasReplied) {
    category = "re-engage";
    whyText.push(`Recent outbound email with no response yet`);
    if (daysSinceLastOutbound !== null) whyText.push(`Sent ${daysSinceLastOutbound} day${daysSinceLastOutbound !== 1 ? "s" : ""} ago`);
  } else {
    category = "neutral";
    if (hasReplied) whyText.push("Has replied to previous emails");
    if (totalEmails > 0) whyText.push(`${totalEmails} email${totalEmails !== 1 ? "s" : ""} exchanged total`);
  }

  // Extra why-text signals
  if (daysSinceLastReply !== null && hasReplied) {
    whyText.push(`Last reply: ${daysSinceLastReply} day${daysSinceLastReply !== 1 ? "s" : ""} ago`);
  }
  if (ctaClicks.length > 0 && category !== "technical" && category !== "commercial") {
    const totalCtaClicks = ctaClicks.reduce((s, c) => s + c.clickCount, 0);
    whyText.push(`${totalCtaClicks} CTA click${totalCtaClicks !== 1 ? "s" : ""} recorded`);
  }

  // Insight text (shown in UI card)
  const categoryLabels: Record<FollowUpCategory, string> = {
    hot:        "🔥 Hot — high intent, no reply yet",
    warm:       "☀️ Warm — opened but no action",
    "re-engage": "🔄 Re-engage — needs follow-up",
    technical:  "🔧 Technical interest — spec/install content clicked",
    commercial: "💰 Commercial interest — pricing/proposal content clicked",
    dormant:    "💤 Dormant — no activity for 14+ days",
    neutral:    "📧 Neutral — general follow-up suggested",
  };
  const insightText = categoryLabels[category];

  return {
    entityType, entityId: id,
    uniqueOpens, uniqueClicks, ctaClicks,
    lastInboundAt, lastOutboundAt,
    daysSinceLastReply, daysSinceLastOutbound,
    totalEmails, hasReplied,
    insightText, category, whyText,
  };
}

// ── Generate follow-up email ──────────────────────────────────────────────────

export interface FollowUpGenerateParams {
  entityType: string;
  entityId: number;
  summary: EngagementSummary;
  callerUserId?: number;
  voiceProfileId?: number;
  callerIsAdmin?: boolean;
  ceoWattsonInfluenceLevel?: number;
}

/**
 * Generates a follow-up email grounded in engagement signals.
 * Uses the same CRM context + voice profile + formatting rules as the main
 * email generator — just adds the engagement summary section.
 */
export async function generateFollowUpEmail(params: FollowUpGenerateParams) {
  const { generateSuggestedNextEmail } = await import("./crm-ai-summary");
  const base = await generateSuggestedNextEmail(
    params.entityType as any,
    params.entityId,
    params.voiceProfileId,
    params.callerUserId,
    params.callerIsAdmin,
    params.ceoWattsonInfluenceLevel ?? 75,
    params.summary, // engagement context injected here
  );
  return base;
}

// ── Dismissed insights (in-memory, per session) ───────────────────────────────
// A lightweight dismiss store so the UI can hide cards without a DB migration.
// Resets on server restart — acceptable for a "don't show again this session" UX.

const dismissedInsights = new Map<string, boolean>();

export function dismissInsight(entityType: string, entityId: number): void {
  dismissedInsights.set(`${entityType}:${entityId}`, true);
}

export function isInsightDismissed(entityType: string, entityId: number): boolean {
  return dismissedInsights.get(`${entityType}:${entityId}`) === true;
}
