/**
 * Phase E — Booking Conversion Intelligence
 *
 * Pure analytics over booking_link_recipients × booking_links × users
 * (+ contacts/leads for segment classification). No new tables, no schema
 * changes, no new dependencies — every metric is derived from data already
 * captured by Phases B, C, and D.
 *
 * Owner scoping: every list/summary takes (callerUserId, callerIsAdmin) and
 * forces non-admins to their own owner_user_id at the SQL layer regardless of
 * any `ownerUserId` filter the caller passed (mirrors Phase C).
 *
 * Definitions used everywhere:
 *   sent     = recipients where sent_at IS NOT NULL AND revoked_at IS NULL
 *   opened   = sent AND first_viewed_at IS NOT NULL
 *   booked   = sent AND booked_at      IS NOT NULL
 *   openRate    = opened / sent  (0 when sent=0)
 *   bookingRate = booked / sent  (0 when sent=0)
 *
 * Time-to-convert is reported in seconds (avg). Null when sample is empty.
 *
 * Leaderboard ranking uses a min-sent threshold (default 3) so a 1/1 link
 * doesn't trump a 12/30 link — the latter is the better signal.
 */

import { db } from "../db";
import {
  bookingLinks, bookingLinkRecipients, users, contacts, leads,
} from "@shared/schema";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// Tunable constants
// ─────────────────────────────────────────────────────────────────────────────
export const LEADERBOARD_MIN_SENT             = 3;
export const UNDERPERFORMING_MIN_SENT         = 5;
export const UNDERPERFORMING_MAX_BOOKING_RATE = 0.10;
export const TOP_N_DEFAULT                    = 10;

// ─────────────────────────────────────────────────────────────────────────────
// Filters
// ─────────────────────────────────────────────────────────────────────────────
export interface AnalyticsFilters {
  ownerUserId?:   number;       // ignored for non-admins; forced to caller
  bookingLinkId?: number;
  dateFrom?:      Date;         // recipient.created_at >=
  dateTo?:        Date;         // recipient.created_at <
}

export function parseAnalyticsFilters(q: any): AnalyticsFilters {
  const out: AnalyticsFilters = {};
  if (q.ownerUserId   != null) {
    const n = parseInt(String(q.ownerUserId), 10);
    if (!Number.isFinite(n) || n <= 0) throw new Error("ownerUserId must be a positive integer");
    out.ownerUserId = n;
  }
  if (q.bookingLinkId != null) {
    const n = parseInt(String(q.bookingLinkId), 10);
    if (!Number.isFinite(n) || n <= 0) throw new Error("bookingLinkId must be a positive integer");
    out.bookingLinkId = n;
  }
  for (const k of ["dateFrom", "dateTo"] as const) {
    if (q[k] != null) {
      const d = new Date(String(q[k]));
      if (Number.isNaN(d.getTime())) throw new Error(`${k} must be a valid date`);
      out[k] = d;
    }
  }
  return out;
}

function rate(num: number, den: number) { return den > 0 ? num / den : 0; }

/** Build the WHERE clause shared by every analytics query (owner-forced). */
function baseWhere(callerUserId: number, callerIsAdmin: boolean, f: AnalyticsFilters) {
  const conds: any[] = [];
  // Non-admins are LOCKED to their own owner_user_id, ignoring any caller-supplied filter.
  if (!callerIsAdmin) {
    conds.push(eq(bookingLinks.ownerUserId, callerUserId));
  } else if (f.ownerUserId != null) {
    conds.push(eq(bookingLinks.ownerUserId, f.ownerUserId));
  }
  if (f.bookingLinkId != null) conds.push(eq(bookingLinks.id, f.bookingLinkId));
  if (f.dateFrom)              conds.push(sql`${bookingLinkRecipients.createdAt} >= ${f.dateFrom}`);
  if (f.dateTo)                conds.push(sql`${bookingLinkRecipients.createdAt} <  ${f.dateTo}`);
  return conds.length ? and(...conds) : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) Per-link metrics
// ─────────────────────────────────────────────────────────────────────────────
export interface LinkMetrics {
  bookingLinkId: number;
  bookingLinkName: string;
  ownerUserId: number;
  ownerName: string | null;
  sent: number;
  opened: number;
  booked: number;
  openRate: number;
  bookingRate: number;
  underperforming: boolean;
}

export async function metricsPerLink(
  callerUserId: number, callerIsAdmin: boolean, f: AnalyticsFilters,
): Promise<LinkMetrics[]> {
  const where = baseWhere(callerUserId, callerIsAdmin, f);
  const rows = await db
    .select({
      bookingLinkId:   bookingLinks.id,
      bookingLinkName: bookingLinks.name,
      ownerUserId:     bookingLinks.ownerUserId,
      ownerName:       users.name,
      sent:    sql<number>`COUNT(*) FILTER (WHERE ${bookingLinkRecipients.sentAt} IS NOT NULL AND ${bookingLinkRecipients.revokedAt} IS NULL)`,
      opened:  sql<number>`COUNT(*) FILTER (WHERE ${bookingLinkRecipients.sentAt} IS NOT NULL AND ${bookingLinkRecipients.revokedAt} IS NULL AND ${bookingLinkRecipients.firstViewedAt} IS NOT NULL)`,
      booked:  sql<number>`COUNT(*) FILTER (WHERE ${bookingLinkRecipients.sentAt} IS NOT NULL AND ${bookingLinkRecipients.revokedAt} IS NULL AND ${bookingLinkRecipients.bookedAt}      IS NOT NULL)`,
    })
    .from(bookingLinks)
    .leftJoin(bookingLinkRecipients, eq(bookingLinkRecipients.bookingLinkId, bookingLinks.id))
    .leftJoin(users, eq(users.id, bookingLinks.ownerUserId))
    .where(where)
    .groupBy(bookingLinks.id, bookingLinks.name, bookingLinks.ownerUserId, users.name);

  return rows.map((r) => {
    const sent   = Number(r.sent   ?? 0);
    const opened = Number(r.opened ?? 0);
    const booked = Number(r.booked ?? 0);
    const bookingRate = rate(booked, sent);
    return {
      bookingLinkId:   r.bookingLinkId,
      bookingLinkName: r.bookingLinkName,
      ownerUserId:     r.ownerUserId,
      ownerName:       r.ownerName,
      sent, opened, booked,
      openRate:    rate(opened, sent),
      bookingRate,
      underperforming: sent >= UNDERPERFORMING_MIN_SENT && bookingRate < UNDERPERFORMING_MAX_BOOKING_RATE,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) Per-owner metrics  (admin only — non-admin sees only their own row)
// ─────────────────────────────────────────────────────────────────────────────
export interface OwnerMetrics {
  ownerUserId: number;
  ownerName: string | null;
  sent: number;
  opened: number;
  booked: number;
  openRate: number;
  bookingRate: number;
}

export async function metricsPerOwner(
  callerUserId: number, callerIsAdmin: boolean, f: AnalyticsFilters,
): Promise<OwnerMetrics[]> {
  const where = baseWhere(callerUserId, callerIsAdmin, f);
  const rows = await db
    .select({
      ownerUserId: bookingLinks.ownerUserId,
      ownerName:   users.name,
      sent:    sql<number>`COUNT(*) FILTER (WHERE ${bookingLinkRecipients.sentAt} IS NOT NULL AND ${bookingLinkRecipients.revokedAt} IS NULL)`,
      opened:  sql<number>`COUNT(*) FILTER (WHERE ${bookingLinkRecipients.sentAt} IS NOT NULL AND ${bookingLinkRecipients.revokedAt} IS NULL AND ${bookingLinkRecipients.firstViewedAt} IS NOT NULL)`,
      booked:  sql<number>`COUNT(*) FILTER (WHERE ${bookingLinkRecipients.sentAt} IS NOT NULL AND ${bookingLinkRecipients.revokedAt} IS NULL AND ${bookingLinkRecipients.bookedAt}      IS NOT NULL)`,
    })
    .from(bookingLinks)
    .leftJoin(bookingLinkRecipients, eq(bookingLinkRecipients.bookingLinkId, bookingLinks.id))
    .leftJoin(users, eq(users.id, bookingLinks.ownerUserId))
    .where(where)
    .groupBy(bookingLinks.ownerUserId, users.name);

  return rows.map((r) => {
    const sent = Number(r.sent ?? 0), opened = Number(r.opened ?? 0), booked = Number(r.booked ?? 0);
    return {
      ownerUserId: r.ownerUserId,
      ownerName:   r.ownerName,
      sent, opened, booked,
      openRate:    rate(opened, sent),
      bookingRate: rate(booked, sent),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) Per-segment metrics (contact / lead / orphan)
// ─────────────────────────────────────────────────────────────────────────────
export interface SegmentMetrics {
  segment: "contact" | "lead" | "orphan";
  sent: number;
  opened: number;
  booked: number;
  openRate: number;
  bookingRate: number;
}

export async function metricsPerSegment(
  callerUserId: number, callerIsAdmin: boolean, f: AnalyticsFilters,
): Promise<SegmentMetrics[]> {
  const where = baseWhere(callerUserId, callerIsAdmin, f);
  // Pull recipient rows (capped to keep memory bounded), enrich, then aggregate.
  const recips = await db
    .select({
      id:             bookingLinkRecipients.id,
      email:          bookingLinkRecipients.recipientEmail,
      sentAt:         bookingLinkRecipients.sentAt,
      firstViewedAt:  bookingLinkRecipients.firstViewedAt,
      bookedAt:       bookingLinkRecipients.bookedAt,
      revokedAt:      bookingLinkRecipients.revokedAt,
    })
    .from(bookingLinkRecipients)
    .innerJoin(bookingLinks, eq(bookingLinks.id, bookingLinkRecipients.bookingLinkId))
    .where(where)
    .limit(20_000);

  const emails = Array.from(new Set(recips.map((r) => (r.email || "").toLowerCase()).filter(Boolean)));
  const contactSet = new Set<string>();
  const leadSet    = new Set<string>();
  if (emails.length) {
    const cs = await db.select({ email: contacts.email }).from(contacts).where(inArray(sql`LOWER(${contacts.email})`, emails));
    cs.forEach((c) => c.email && contactSet.add(c.email.toLowerCase()));
    const ls = await db.select({ email: leads.contactEmail }).from(leads).where(inArray(sql`LOWER(${leads.contactEmail})`, emails));
    ls.forEach((l) => l.email && leadSet.add(l.email.toLowerCase()));
  }

  const acc: Record<"contact" | "lead" | "orphan", { sent: number; opened: number; booked: number }> = {
    contact: { sent: 0, opened: 0, booked: 0 },
    lead:    { sent: 0, opened: 0, booked: 0 },
    orphan:  { sent: 0, opened: 0, booked: 0 },
  };

  for (const r of recips) {
    if (!r.sentAt || r.revokedAt) continue;
    const e = (r.email || "").toLowerCase();
    const seg: "contact" | "lead" | "orphan" =
      contactSet.has(e) ? "contact" :
      leadSet.has(e)    ? "lead"    : "orphan";
    acc[seg].sent++;
    if (r.firstViewedAt) acc[seg].opened++;
    if (r.bookedAt)      acc[seg].booked++;
  }

  return (["contact", "lead", "orphan"] as const).map((segment) => {
    const { sent, opened, booked } = acc[segment];
    return {
      segment, sent, opened, booked,
      openRate:    rate(opened, sent),
      bookingRate: rate(booked, sent),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) Time-to-convert
// ─────────────────────────────────────────────────────────────────────────────
export interface TimingMetrics {
  sentToOpenedSec:  number | null; sentToOpenedSamples:  number;
  openedToBookedSec: number | null; openedToBookedSamples: number;
  sentToBookedSec:  number | null; sentToBookedSamples:  number;
}

export async function metricsTiming(
  callerUserId: number, callerIsAdmin: boolean, f: AnalyticsFilters,
): Promise<TimingMetrics> {
  const where = baseWhere(callerUserId, callerIsAdmin, f);
  const [row] = await db
    .select({
      s2oAvg:  sql<string | null>`AVG(EXTRACT(EPOCH FROM (${bookingLinkRecipients.firstViewedAt} - ${bookingLinkRecipients.sentAt})))         FILTER (WHERE ${bookingLinkRecipients.sentAt} IS NOT NULL AND ${bookingLinkRecipients.firstViewedAt} IS NOT NULL AND ${bookingLinkRecipients.revokedAt} IS NULL)`,
      s2oN:    sql<number>`COUNT(*)                                                                                                            FILTER (WHERE ${bookingLinkRecipients.sentAt} IS NOT NULL AND ${bookingLinkRecipients.firstViewedAt} IS NOT NULL AND ${bookingLinkRecipients.revokedAt} IS NULL)`,
      o2bAvg:  sql<string | null>`AVG(EXTRACT(EPOCH FROM (${bookingLinkRecipients.bookedAt}     - ${bookingLinkRecipients.firstViewedAt})))    FILTER (WHERE ${bookingLinkRecipients.firstViewedAt} IS NOT NULL AND ${bookingLinkRecipients.bookedAt} IS NOT NULL AND ${bookingLinkRecipients.revokedAt} IS NULL)`,
      o2bN:    sql<number>`COUNT(*)                                                                                                            FILTER (WHERE ${bookingLinkRecipients.firstViewedAt} IS NOT NULL AND ${bookingLinkRecipients.bookedAt} IS NOT NULL AND ${bookingLinkRecipients.revokedAt} IS NULL)`,
      s2bAvg:  sql<string | null>`AVG(EXTRACT(EPOCH FROM (${bookingLinkRecipients.bookedAt}     - ${bookingLinkRecipients.sentAt})))           FILTER (WHERE ${bookingLinkRecipients.sentAt} IS NOT NULL AND ${bookingLinkRecipients.bookedAt} IS NOT NULL AND ${bookingLinkRecipients.revokedAt} IS NULL)`,
      s2bN:    sql<number>`COUNT(*)                                                                                                            FILTER (WHERE ${bookingLinkRecipients.sentAt} IS NOT NULL AND ${bookingLinkRecipients.bookedAt} IS NOT NULL AND ${bookingLinkRecipients.revokedAt} IS NULL)`,
    })
    .from(bookingLinkRecipients)
    .innerJoin(bookingLinks, eq(bookingLinks.id, bookingLinkRecipients.bookingLinkId))
    .where(where);

  const num = (v: any) => (v == null ? null : Number(v));
  return {
    sentToOpenedSec:   num(row?.s2oAvg),  sentToOpenedSamples:   Number(row?.s2oN ?? 0),
    openedToBookedSec: num(row?.o2bAvg),  openedToBookedSamples: Number(row?.o2bN ?? 0),
    sentToBookedSec:   num(row?.s2bAvg),  sentToBookedSamples:   Number(row?.s2bN ?? 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5) Leaderboard — top N links by booking rate, with min-sent floor
// ─────────────────────────────────────────────────────────────────────────────
export interface LeaderboardEntry extends LinkMetrics { rank: number }

export async function leaderboard(
  callerUserId: number, callerIsAdmin: boolean, f: AnalyticsFilters,
  opts: { minSent?: number; topN?: number } = {},
): Promise<{ top: LeaderboardEntry[]; underperforming: LinkMetrics[]; minSent: number }> {
  const minSent = Math.max(1, opts.minSent ?? LEADERBOARD_MIN_SENT);
  const topN    = Math.max(1, opts.topN    ?? TOP_N_DEFAULT);
  const all = await metricsPerLink(callerUserId, callerIsAdmin, f);
  const eligible = all.filter((r) => r.sent >= minSent);
  const sorted = [...eligible].sort((a, b) =>
    b.bookingRate - a.bookingRate || b.booked - a.booked || b.sent - a.sent
  );
  const top = sorted.slice(0, topN).map((r, i) => ({ ...r, rank: i + 1 }));
  const underperforming = all.filter((r) => r.underperforming)
    .sort((a, b) => a.bookingRate - b.bookingRate);
  return { top, underperforming, minSent };
}
