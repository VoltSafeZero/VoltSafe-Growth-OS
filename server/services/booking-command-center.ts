/**
 * Phase G — Booking Command Center
 *
 * Pure orchestration. Composes the analytics surfaces produced by Phases B–F
 * into prioritized, actionable cards. No new tables, no new dependencies, no
 * SQL beyond what the underlying services already issue.
 *
 * Owner scoping is inherited from the underlying services — every helper here
 * passes (callerId, isAdmin, filters) straight through, so non-admins remain
 * locked to their own owner_user_id at the SQL layer.
 *
 * Six action buckets, each with a stable kind, urgency, and recommended copy:
 *   1. HOT_OPENED_NOT_BOOKED — opened ≥2d ago, not booked, ranked contact > lead > orphan, then recency
 *   2. BOOKED_NO_QUOTE       — booked + no quote after booking + no pending followup task
 *   3. REUSE_LINK            — sent ≥5, bookingRate ≥20%, ranked by booked DESC then rate DESC
 *   4. REWRITE_LINK          — sent ≥5, bookingRate <10% (= existing leaderboard underperforming)
 *   5. REVENUE_WINNER        — links with wonValue > 0, ranked by wonValue DESC
 *   6. REVENUE_LEAK          — booked recipients with at least one post-booking quote but zero won
 */

import {
  metricsPerLink, leaderboard as bookingLeaderboard,
  type AnalyticsFilters,
} from "./booking-conversion-analytics";
import {
  revenueAttribution, actionLists,
  loadScopedRecipients, loadQuotesFor, attributeQuotes, isQuoteWon,
  parseRevenueFilters,
  type RevenueFilters,
} from "./booking-revenue-attribution";
import { pendingActionKeysFor } from "./booking-command-actions";

// ─────────────────────────────────────────────────────────────────────────────
// Tunable constants
// ─────────────────────────────────────────────────────────────────────────────
export const HOT_OPENED_MIN_DAYS       = 2;
export const REUSE_MIN_SENT            = 5;
export const REUSE_MIN_BOOKING_RATE    = 0.20;
export const HOT_LIMIT                 = 25;
export const NO_QUOTE_LIMIT            = 25;
export const REUSE_LIMIT               = 10;
export const REWRITE_LIMIT             = 10;
export const WINNER_LIMIT              = 10;
export const LEAK_LIMIT                = 25;

// ─────────────────────────────────────────────────────────────────────────────
// Filters — same shape as Phase F, reuse parser
// ─────────────────────────────────────────────────────────────────────────────
export const parseCommandCenterFilters = parseRevenueFilters;
export type CommandCenterFilters = RevenueFilters;

// CRM type priority for hot-list ranking
const CRM_RANK: Record<string, number> = { contact: 0, lead: 1, orphan: 2 };

// ─────────────────────────────────────────────────────────────────────────────
// Public types — every card has a stable shape so the UI can render uniformly
// ─────────────────────────────────────────────────────────────────────────────
export type CardKind =
  | "HOT_OPENED_NOT_BOOKED"
  | "BOOKED_NO_QUOTE"
  | "REUSE_LINK"
  | "REWRITE_LINK"
  | "REVENUE_WINNER"
  | "REVENUE_LEAK";

export type Urgency = "high" | "medium" | "low";

export interface CardItem {
  kind:           CardKind;
  urgency:        Urgency;
  title:          string;       // primary text (e.g. recipient email or link name)
  subtitle:       string;       // secondary one-liner (e.g. link name + owner)
  recommendation: string;       // recommended action text
  // optional context fields, all kept flat for simple JSON rendering
  recipientId?:   number;
  bookingLinkId?: number;
  bookingLinkName?: string;
  ownerUserId?:   number;
  ownerName?:     string | null;
  daysSinceOpen?: number;
  bookedAt?:      string;       // ISO
  bookedMeetings?: number;
  bookingRate?:   number;
  quotedValue?:   number;
  wonValue?:      number;
  quoteToWinRate?: number;
  crmType?:       "contact" | "lead" | null;
  crmId?:         number | null;
  accountId?:     number | null;
  deepLink?:      string;       // best-effort path into the existing CRM
}

export interface CommandCenterResponse {
  isAdmin: boolean;
  generatedAt: string;
  buckets: {
    HOT_OPENED_NOT_BOOKED: CardItem[];
    BOOKED_NO_QUOTE:       CardItem[];
    REUSE_LINK:            CardItem[];
    REWRITE_LINK:          CardItem[];
    REVENUE_WINNER:        CardItem[];
    REVENUE_LEAK:          CardItem[];
  };
  counts: Record<CardKind, number>;
  totals: {
    highUrgency:   number;
    mediumUrgency: number;
    lowUrgency:    number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal — deep-link helpers (best-effort; safe even if route absent)
// ─────────────────────────────────────────────────────────────────────────────
function crmDeepLink(type: "contact" | "lead" | null, id: number | null, accountId: number | null): string | undefined {
  if (type === "contact" && id != null)         return `/contacts/${id}`;
  if (type === "lead"    && id != null)         return `/leads/${id}`;
  if (accountId != null)                         return `/accounts/${accountId}`;
  return undefined;
}
function linkDeepLink(linkId: number): string { return `/booking-links/${linkId}`; }

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────
export async function commandCenter(
  callerUserId: number, callerIsAdmin: boolean, f: CommandCenterFilters,
): Promise<CommandCenterResponse> {
  // Filters for booking-conversion-analytics share the same shape (subset).
  const baseFilters: AnalyticsFilters = {
    ownerUserId:   f.ownerUserId,
    bookingLinkId: f.bookingLinkId,
    dateFrom:      f.dateFrom,
    dateTo:        f.dateTo,
  };

  // Run the underlying analytics in parallel — each enforces owner scoping at SQL layer.
  const [perLink, lb, attr, lists] = await Promise.all([
    metricsPerLink     (callerUserId, callerIsAdmin, baseFilters),
    bookingLeaderboard (callerUserId, callerIsAdmin, baseFilters, REUSE_MIN_SENT),
    revenueAttribution (callerUserId, callerIsAdmin, f),
    actionLists        (callerUserId, callerIsAdmin, f),
  ]);

  // ─── 1. HOT_OPENED_NOT_BOOKED ─────────────────────────────────────────────
  const hot: CardItem[] = lists.openedNotBooked
    .filter((r) => r.daysSinceOpen >= HOT_OPENED_MIN_DAYS)
    .sort((a, b) => {
      const ar = CRM_RANK[a.crm.type ?? "orphan"] ?? 2;
      const br = CRM_RANK[b.crm.type ?? "orphan"] ?? 2;
      if (ar !== br) return ar - br;
      return new Date(b.firstViewedAt).getTime() - new Date(a.firstViewedAt).getTime();
    })
    .slice(0, HOT_LIMIT)
    .map((r) => ({
      kind: "HOT_OPENED_NOT_BOOKED",
      urgency: r.daysSinceOpen >= 4 ? "high" : "medium",
      title: r.recipientEmail,
      subtitle: `${r.bookingLinkName}${callerIsAdmin && r.ownerName ? ` · ${r.ownerName}` : ""}`,
      recommendation:
        r.crm.type === "contact" ? `Personal nudge — opened ${r.daysSinceOpen}d ago, no booking yet`
      : r.crm.type === "lead"    ? `Lead is warm — send a tailored follow-up (opened ${r.daysSinceOpen}d ago)`
      :                            `Unknown contact — verify identity then send a tailored follow-up`,
      recipientId:    r.recipientId,
      bookingLinkId:  r.bookingLinkId,
      bookingLinkName: r.bookingLinkName,
      ownerUserId:    r.ownerUserId,
      ownerName:      r.ownerName,
      daysSinceOpen:  r.daysSinceOpen,
      crmType:        r.crm.type,
      crmId:          r.crm.id,
      accountId:      r.crm.accountId,
      deepLink:       crmDeepLink(r.crm.type, r.crm.id, r.crm.accountId),
    }));

  // ─── 2. BOOKED_NO_QUOTE ───────────────────────────────────────────────────
  const noQuote: CardItem[] = lists.bookedNoNextAction
    .slice(0, NO_QUOTE_LIMIT)
    .map((r) => {
      const bookedDate = new Date(r.bookedAt);
      const ageDays = Math.floor((Date.now() - bookedDate.getTime()) / 86400_000);
      return {
        kind: "BOOKED_NO_QUOTE",
        urgency: ageDays >= 3 ? "high" : "medium",
        title: r.recipientEmail,
        subtitle: `${r.bookingLinkName}${callerIsAdmin && r.ownerName ? ` · ${r.ownerName}` : ""}`,
        recommendation: ageDays >= 3
          ? `Send a quote NOW — meeting was ${ageDays}d ago and nothing's queued`
          : `Send a quote — meeting happened, no follow-through yet`,
        recipientId:    r.recipientId,
        bookingLinkId:  r.bookingLinkId,
        bookingLinkName: r.bookingLinkName,
        ownerUserId:    r.ownerUserId,
        ownerName:      r.ownerName,
        bookedAt:       bookedDate.toISOString(),
        crmType:        r.crm.type,
        crmId:          r.crm.id,
        accountId:      r.crm.accountId,
        deepLink:       crmDeepLink(r.crm.type, r.crm.id, r.crm.accountId),
      };
    });

  // ─── 3. REUSE_LINK — high-converting (sent ≥5, bookingRate ≥20%) ──────────
  const reuse: CardItem[] = perLink
    .filter((r) => r.sent >= REUSE_MIN_SENT && r.bookingRate >= REUSE_MIN_BOOKING_RATE)
    .sort((a, b) => (b.booked - a.booked) || (b.bookingRate - a.bookingRate))
    .slice(0, REUSE_LIMIT)
    .map((r) => ({
      kind: "REUSE_LINK",
      urgency: "low",
      title: r.bookingLinkName,
      subtitle: `${r.booked} booked from ${r.sent} sent · ${(r.bookingRate * 100).toFixed(1)}%${callerIsAdmin && r.ownerName ? ` · ${r.ownerName}` : ""}`,
      recommendation: `Reuse this template — it's converting ${(r.bookingRate * 100).toFixed(1)}%`,
      bookingLinkId:  r.bookingLinkId,
      bookingLinkName: r.bookingLinkName,
      ownerUserId:    r.ownerUserId,
      ownerName:      r.ownerName,
      bookedMeetings: r.booked,
      bookingRate:    r.bookingRate,
      deepLink:       linkDeepLink(r.bookingLinkId),
    }));

  // ─── 4. REWRITE_LINK — leaderboard already computes underperforming (sent≥5, rate<10%) ──
  const rewrite: CardItem[] = lb.underperforming
    .slice(0, REWRITE_LIMIT)
    .map((r) => ({
      kind: "REWRITE_LINK",
      urgency: "high",
      title: r.bookingLinkName,
      subtitle: `${r.booked} booked from ${r.sent} sent · ${(r.bookingRate * 100).toFixed(1)}%${callerIsAdmin && r.ownerName ? ` · ${r.ownerName}` : ""}`,
      recommendation: `Rewrite or retire this template — only ${(r.bookingRate * 100).toFixed(1)}% conversion across ${r.sent} sends`,
      bookingLinkId:  r.bookingLinkId,
      bookingLinkName: r.bookingLinkName,
      ownerUserId:    r.ownerUserId,
      ownerName:      r.ownerName,
      bookedMeetings: r.booked,
      bookingRate:    r.bookingRate,
      deepLink:       linkDeepLink(r.bookingLinkId),
    }));

  // ─── 5. REVENUE_WINNER — already ranked by topRevenueLinks ────────────────
  const winners: CardItem[] = attr.topRevenueLinks
    .filter((r) => r.wonValue > 0)
    .slice(0, WINNER_LIMIT)
    .map((r) => ({
      kind: "REVENUE_WINNER",
      urgency: "low",
      title: r.bookingLinkName,
      subtitle: `$${r.wonValue.toLocaleString()} won from ${r.bookedMeetings} bookings${callerIsAdmin && r.ownerName ? ` · ${r.ownerName}` : ""}`,
      recommendation: r.quoteToWinRate >= 0.5
        ? `Top performer — ${(r.quoteToWinRate * 100).toFixed(0)}% quote-to-win. Replicate this approach.`
        : `Producing revenue — keep promoting this link`,
      bookingLinkId:  r.bookingLinkId,
      bookingLinkName: r.bookingLinkName,
      ownerUserId:    r.ownerUserId,
      ownerName:      r.ownerName,
      bookedMeetings: r.bookedMeetings,
      quotedValue:    r.quotedValue,
      wonValue:       r.wonValue,
      quoteToWinRate: r.quoteToWinRate,
      deepLink:       linkDeepLink(r.bookingLinkId),
    }));

  // ─── 6. REVENUE_LEAK — booked recipients with quote(s) but zero won ───────
  // Re-derives per-recipient using the scoped helpers (no extra SQL beyond
  // what Phase F already issued for this caller — same recipient + quote sets).
  const bookedRecips = await loadScopedRecipients(callerUserId, callerIsAdmin, f, { onlyBooked: true });
  const cIds = Array.from(new Set(bookedRecips.map((r) => r.contactId).filter((x): x is number => x != null)));
  const aIds = Array.from(new Set(bookedRecips.map((r) => r.accountId).filter((x): x is number => x != null)));
  const quotes = await loadQuotesFor(cIds, aIds);

  const leak: CardItem[] = [];
  const seenRecipients = new Set<number>();
  for (const rec of bookedRecips) {
    if (seenRecipients.has(rec.recipientId)) continue;
    const qs = attributeQuotes(rec, quotes);
    if (qs.length === 0) continue;
    if (qs.some(isQuoteWon)) continue;
    seenRecipients.add(rec.recipientId);
    const totalQuoted = qs.reduce((s, q) => s + q.total, 0);
    leak.push({
      kind: "REVENUE_LEAK",
      urgency: totalQuoted >= 5000 ? "high" : "medium",
      title: rec.recipientEmail,
      subtitle: `${rec.bookingLinkName}${callerIsAdmin && rec.ownerName ? ` · ${rec.ownerName}` : ""}`,
      recommendation: `Quote of $${totalQuoted.toLocaleString()} sent but not won — chase the close`,
      recipientId:    rec.recipientId,
      bookingLinkId:  rec.bookingLinkId,
      bookingLinkName: rec.bookingLinkName,
      ownerUserId:    rec.ownerUserId,
      ownerName:      rec.ownerName,
      bookedAt:       rec.bookedAt ? rec.bookedAt.toISOString() : undefined,
      quotedValue:    totalQuoted,
      wonValue:       0,
      crmType:        rec.contactId != null ? "contact" : (rec.leadId != null ? "lead" : null),
      crmId:          rec.contactId ?? rec.leadId ?? null,
      accountId:      rec.accountId ?? null,
      deepLink:       crmDeepLink(
        rec.contactId != null ? "contact" : (rec.leadId != null ? "lead" : null),
        rec.contactId ?? rec.leadId ?? null,
        rec.accountId ?? null,
      ),
    });
  }
  // Highest-value leaks first
  leak.sort((a, b) => (b.quotedValue ?? 0) - (a.quotedValue ?? 0));
  const leakTrimmed = leak.slice(0, LEAK_LIMIT);

  const buckets = {
    HOT_OPENED_NOT_BOOKED: hot,
    BOOKED_NO_QUOTE:       noQuote,
    REUSE_LINK:            reuse,
    REWRITE_LINK:          rewrite,
    REVENUE_WINNER:        winners,
    REVENUE_LEAK:          leakTrimmed,
  };
  const counts: Record<CardKind, number> = {
    HOT_OPENED_NOT_BOOKED: hot.length,
    BOOKED_NO_QUOTE:       noQuote.length,
    REUSE_LINK:            reuse.length,
    REWRITE_LINK:          rewrite.length,
    REVENUE_WINNER:        winners.length,
    REVENUE_LEAK:          leakTrimmed.length,
  };
  const allCards = [...hot, ...noQuote, ...reuse, ...rewrite, ...winners, ...leakTrimmed];
  const totals = {
    highUrgency:   allCards.filter((c) => c.urgency === "high").length,
    mediumUrgency: allCards.filter((c) => c.urgency === "medium").length,
    lowUrgency:    allCards.filter((c) => c.urgency === "low").length,
  };

  return {
    isAdmin: callerIsAdmin,
    generatedAt: new Date().toISOString(),
    buckets, counts, totals,
  };
}
