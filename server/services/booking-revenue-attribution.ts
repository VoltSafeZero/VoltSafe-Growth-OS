/**
 * Phase F — Booking Revenue Attribution
 *
 * Pure derivation. Given the data already captured by Phases B–E, attribute
 * actual commercial outcomes (quotes, won deals) back to the booking link
 * and owner that produced the meeting.
 *
 * Attribution model (recipient → revenue):
 *   1. recipient must have booked_at set, revoked_at null
 *   2. recipient.recipient_email is matched against contacts.email (preferred)
 *      then leads.contact_email (fallback). orphan recipients = no attribution.
 *   3. quotes attributed when: quotes.created_at > recipient.booked_at AND
 *      (quotes.contact_id = matched contact OR quotes.account_id = contact's
 *      account_id). Lead-only recipients have no quote attribution path
 *      (leads aren't quoted in this CRM until promoted to a contact/account).
 *   4. quoted value  = SUM(quotes.total)                              (any status)
 *      won value     = SUM(quotes.total) WHERE quotes.status='accepted'
 *                                          OR quotes.accepted_at IS NOT NULL
 *
 * Owner scoping: every query is forced through `baseWhere(callerId, isAdmin)`
 * — non-admins are LOCKED to their own booking_links.owner_user_id at the SQL
 * layer regardless of any caller-supplied ownerUserId filter.
 *
 * No new tables, no schema changes, no new dependencies.
 */

import { db } from "../db";
import {
  bookingLinks, bookingLinkRecipients, contacts, leads, quotes, tasks, users,
} from "@shared/schema";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// Tunable constants
// ─────────────────────────────────────────────────────────────────────────────
export const MAX_RECIPIENTS_PER_QUERY = 20_000;
export const ATTRIBUTION_TOP_N        = 10;
export const ACTION_LIST_LIMIT        = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Filters (mirrors Phase E)
// ─────────────────────────────────────────────────────────────────────────────
export interface RevenueFilters {
  ownerUserId?:   number;       // ignored for non-admins
  bookingLinkId?: number;
  dateFrom?:      Date;         // recipient.booked_at >=
  dateTo?:        Date;         // recipient.booked_at <
}

export function parseRevenueFilters(q: any): RevenueFilters {
  const out: RevenueFilters = {};
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

function safeRate(num: number, den: number) { return den > 0 ? num / den : 0; }

// ─────────────────────────────────────────────────────────────────────────────
// Internal — pull the in-scope recipients (owner-forced) and enrich with CRM
// ─────────────────────────────────────────────────────────────────────────────
export interface ScopedRecipient {
  recipientId:    number;
  recipientEmail: string;
  bookingLinkId:  number;
  bookingLinkName: string;
  ownerUserId:    number;
  ownerName:      string | null;
  sentAt:         Date | null;
  firstViewedAt:  Date | null;
  bookedAt:       Date | null;
  // enriched
  contactId?:     number | null;
  accountId?:     number | null;
  leadId?:        number | null;
}

export async function loadScopedRecipients(
  callerUserId: number, callerIsAdmin: boolean, f: RevenueFilters,
  opts: { onlyBooked?: boolean; onlyOpenedNotBooked?: boolean } = {},
): Promise<ScopedRecipient[]> {
  const conds: any[] = [];
  if (!callerIsAdmin) {
    conds.push(eq(bookingLinks.ownerUserId, callerUserId));
  } else if (f.ownerUserId != null) {
    conds.push(eq(bookingLinks.ownerUserId, f.ownerUserId));
  }
  if (f.bookingLinkId != null) conds.push(eq(bookingLinks.id, f.bookingLinkId));
  conds.push(isNull(bookingLinkRecipients.revokedAt));
  if (opts.onlyBooked) {
    conds.push(isNotNull(bookingLinkRecipients.bookedAt));
    if (f.dateFrom) conds.push(sql`${bookingLinkRecipients.bookedAt} >= ${f.dateFrom}`);
    if (f.dateTo)   conds.push(sql`${bookingLinkRecipients.bookedAt} <  ${f.dateTo}`);
  } else if (opts.onlyOpenedNotBooked) {
    conds.push(isNotNull(bookingLinkRecipients.firstViewedAt));
    conds.push(isNull(bookingLinkRecipients.bookedAt));
    if (f.dateFrom) conds.push(sql`${bookingLinkRecipients.firstViewedAt} >= ${f.dateFrom}`);
    if (f.dateTo)   conds.push(sql`${bookingLinkRecipients.firstViewedAt} <  ${f.dateTo}`);
  } else {
    if (f.dateFrom) conds.push(sql`${bookingLinkRecipients.createdAt} >= ${f.dateFrom}`);
    if (f.dateTo)   conds.push(sql`${bookingLinkRecipients.createdAt} <  ${f.dateTo}`);
  }
  const rows = await db
    .select({
      recipientId:     bookingLinkRecipients.id,
      recipientEmail:  bookingLinkRecipients.recipientEmail,
      bookingLinkId:   bookingLinkRecipients.bookingLinkId,
      bookingLinkName: bookingLinks.name,
      ownerUserId:     bookingLinks.ownerUserId,
      ownerName:       users.name,
      sentAt:          bookingLinkRecipients.sentAt,
      firstViewedAt:   bookingLinkRecipients.firstViewedAt,
      bookedAt:        bookingLinkRecipients.bookedAt,
    })
    .from(bookingLinkRecipients)
    .innerJoin(bookingLinks, eq(bookingLinks.id, bookingLinkRecipients.bookingLinkId))
    .leftJoin(users,         eq(users.id,        bookingLinks.ownerUserId))
    .where(and(...conds))
    .limit(MAX_RECIPIENTS_PER_QUERY);

  // Enrich: contact (preferred) → account; lead fallback.
  const emails = Array.from(new Set(rows.map((r) => (r.recipientEmail || "").toLowerCase()).filter(Boolean)));
  const contactByEmail = new Map<string, { id: number; accountId: number | null }>();
  const leadByEmail    = new Map<string, { id: number }>();
  if (emails.length) {
    const cs = await db
      .select({ id: contacts.id, email: contacts.email, accountId: contacts.accountId })
      .from(contacts)
      .where(inArray(sql`LOWER(${contacts.email})`, emails));
    cs.forEach((c) => c.email && contactByEmail.set(c.email.toLowerCase(), { id: c.id, accountId: c.accountId ?? null }));
    const ls = await db
      .select({ id: leads.id, email: leads.contactEmail })
      .from(leads)
      .where(inArray(sql`LOWER(${leads.contactEmail})`, emails));
    ls.forEach((l) => l.email && leadByEmail.set(l.email.toLowerCase(), { id: l.id }));
  }

  return rows.map((r) => {
    const e = (r.recipientEmail || "").toLowerCase();
    const c = contactByEmail.get(e) ?? null;
    const l = !c ? (leadByEmail.get(e) ?? null) : null;
    return {
      ...r,
      contactId: c?.id ?? null,
      accountId: c?.accountId ?? null,
      leadId:    l?.id ?? null,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal — fetch in-scope quotes for the matched contacts/accounts.
// Bounded by the recipient set (which is itself owner-scoped), so this never
// reveals quotes outside the caller's universe.
// ─────────────────────────────────────────────────────────────────────────────
export interface QuoteRow {
  id: number;
  contactId: number | null;
  accountId: number | null;
  total: number;
  status: string;
  acceptedAt: Date | null;
  createdAt: Date;
}

export async function loadQuotesFor(contactIds: number[], accountIds: number[]): Promise<QuoteRow[]> {
  if (!contactIds.length && !accountIds.length) return [];
  const conds: any[] = [];
  if (contactIds.length) conds.push(inArray(quotes.contactId, contactIds));
  if (accountIds.length) conds.push(inArray(quotes.accountId, accountIds));
  const rows = await db
    .select({
      id:         quotes.id,
      contactId:  quotes.contactId,
      accountId:  quotes.accountId,
      total:      quotes.total,
      status:     quotes.status,
      acceptedAt: quotes.acceptedAt,
      createdAt:  quotes.createdAt,
    })
    .from(quotes)
    .where(conds.length === 1 ? conds[0] : sql`${conds[0]} OR ${conds[1]}`);
  return rows.map((r) => ({ ...r, total: Number(r.total ?? 0) }));
}

export function isQuoteWon(q: QuoteRow): boolean {
  return q.status === "accepted" || q.acceptedAt != null;
}

/**
 * For one booked recipient, find quotes attributable to it:
 *   - quote.created_at must be strictly AFTER recipient.booked_at
 *   - quote must match recipient.contactId OR recipient.accountId
 */
export function attributeQuotes(rec: ScopedRecipient, allQuotes: QuoteRow[]): QuoteRow[] {
  if (!rec.bookedAt) return [];
  const bookedTime = rec.bookedAt.getTime();
  return allQuotes.filter((q) => {
    if (q.createdAt.getTime() <= bookedTime) return false;
    if (rec.contactId != null && q.contactId === rec.contactId) return true;
    if (rec.accountId != null && q.accountId === rec.accountId) return true;
    return false;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API — 3 endpoints
// ─────────────────────────────────────────────────────────────────────────────

export interface RevenueSummary {
  bookedMeetings:      number;
  bookedAttributable:  number;       // booked recipients with a CRM match (contact|lead)
  bookedOrphan:        number;       // booked recipients with no CRM match
  quotesGenerated:     number;
  quotedValue:         number;
  wonQuotes:           number;
  wonValue:            number;
  bookingToQuoteRate:  number;       // quotesGenerated / bookedMeetings
  quoteToWinRate:      number;       // wonQuotes       / quotesGenerated
}

export async function revenueSummary(
  callerUserId: number, callerIsAdmin: boolean, f: RevenueFilters,
): Promise<RevenueSummary> {
  const recips = await loadScopedRecipients(callerUserId, callerIsAdmin, f, { onlyBooked: true });
  const contactIds = Array.from(new Set(recips.map((r) => r.contactId).filter((x): x is number => x != null)));
  const accountIds = Array.from(new Set(recips.map((r) => r.accountId).filter((x): x is number => x != null)));
  const allQuotes  = await loadQuotesFor(contactIds, accountIds);

  let quotesGenerated = 0, quotedValue = 0, wonQuotes = 0, wonValue = 0;
  let bookedAttributable = 0, bookedOrphan = 0;
  const seenQuoteIds = new Set<number>(); // a single quote might attribute to >1 booked recipient on the same account; dedup at the totals
  for (const rec of recips) {
    if (rec.contactId != null || rec.accountId != null || rec.leadId != null) bookedAttributable++;
    else bookedOrphan++;
    const q = attributeQuotes(rec, allQuotes);
    for (const quote of q) {
      if (seenQuoteIds.has(quote.id)) continue;
      seenQuoteIds.add(quote.id);
      quotesGenerated++;
      quotedValue += quote.total;
      if (isQuoteWon(quote)) { wonQuotes++; wonValue += quote.total; }
    }
  }
  return {
    bookedMeetings:     recips.length,
    bookedAttributable, bookedOrphan,
    quotesGenerated, quotedValue,
    wonQuotes,       wonValue,
    bookingToQuoteRate: safeRate(quotesGenerated, recips.length),
    quoteToWinRate:     safeRate(wonQuotes,       quotesGenerated),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
export interface AttributionRow {
  bookingLinkId:   number;
  bookingLinkName: string;
  ownerUserId:     number;
  ownerName:       string | null;
  bookedMeetings:  number;
  quotesGenerated: number;
  quotedValue:     number;
  wonQuotes:       number;
  wonValue:        number;
  bookingToQuoteRate: number;
  quoteToWinRate:     number;
}

export interface AttributionResult {
  perLink:         AttributionRow[];
  perOwner:        Omit<AttributionRow, "bookingLinkId" | "bookingLinkName">[];
  topRevenueLinks: (AttributionRow & { rank: number })[];
}

export async function revenueAttribution(
  callerUserId: number, callerIsAdmin: boolean, f: RevenueFilters,
): Promise<AttributionResult> {
  const recips = await loadScopedRecipients(callerUserId, callerIsAdmin, f, { onlyBooked: true });
  const contactIds = Array.from(new Set(recips.map((r) => r.contactId).filter((x): x is number => x != null)));
  const accountIds = Array.from(new Set(recips.map((r) => r.accountId).filter((x): x is number => x != null)));
  const allQuotes  = await loadQuotesFor(contactIds, accountIds);

  // Aggregate per link, deduping quotes within a single link so one quote
  // attributed to two booked recipients on the same account counts once.
  const perLinkAcc = new Map<number, AttributionRow & { _seen: Set<number> }>();
  const perOwnerAcc = new Map<number, { ownerUserId: number; ownerName: string | null;
    bookedMeetings: number; quotesGenerated: number; quotedValue: number;
    wonQuotes: number; wonValue: number; _seen: Set<number> }>();

  for (const rec of recips) {
    let lk = perLinkAcc.get(rec.bookingLinkId);
    if (!lk) {
      lk = {
        bookingLinkId: rec.bookingLinkId, bookingLinkName: rec.bookingLinkName,
        ownerUserId:   rec.ownerUserId,   ownerName:       rec.ownerName,
        bookedMeetings: 0, quotesGenerated: 0, quotedValue: 0, wonQuotes: 0, wonValue: 0,
        bookingToQuoteRate: 0, quoteToWinRate: 0, _seen: new Set(),
      };
      perLinkAcc.set(rec.bookingLinkId, lk);
    }
    let ow = perOwnerAcc.get(rec.ownerUserId);
    if (!ow) {
      ow = { ownerUserId: rec.ownerUserId, ownerName: rec.ownerName,
        bookedMeetings: 0, quotesGenerated: 0, quotedValue: 0, wonQuotes: 0, wonValue: 0,
        _seen: new Set() };
      perOwnerAcc.set(rec.ownerUserId, ow);
    }
    lk.bookedMeetings++; ow.bookedMeetings++;
    for (const q of attributeQuotes(rec, allQuotes)) {
      if (!lk._seen.has(q.id)) {
        lk._seen.add(q.id);
        lk.quotesGenerated++; lk.quotedValue += q.total;
        if (isQuoteWon(q)) { lk.wonQuotes++; lk.wonValue += q.total; }
      }
      if (!ow._seen.has(q.id)) {
        ow._seen.add(q.id);
        ow.quotesGenerated++; ow.quotedValue += q.total;
        if (isQuoteWon(q)) { ow.wonQuotes++; ow.wonValue += q.total; }
      }
    }
  }

  const perLink: AttributionRow[] = Array.from(perLinkAcc.values()).map((r) => {
    const { _seen, ...rest } = r;
    return {
      ...rest,
      bookingToQuoteRate: safeRate(rest.quotesGenerated, rest.bookedMeetings),
      quoteToWinRate:     safeRate(rest.wonQuotes,       rest.quotesGenerated),
    };
  });
  const perOwner = Array.from(perOwnerAcc.values()).map((r) => {
    const { _seen, ...rest } = r;
    return {
      ...rest,
      bookingToQuoteRate: safeRate(rest.quotesGenerated, rest.bookedMeetings),
      quoteToWinRate:     safeRate(rest.wonQuotes,       rest.quotesGenerated),
    };
  });
  const topRevenueLinks = [...perLink]
    .filter((r) => r.wonValue > 0 || r.quotedValue > 0)
    .sort((a, b) =>
      b.wonValue - a.wonValue ||
      b.quotedValue - a.quotedValue ||
      b.quotesGenerated - a.quotesGenerated)
    .slice(0, ATTRIBUTION_TOP_N)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  return { perLink, perOwner, topRevenueLinks };
}

// ─────────────────────────────────────────────────────────────────────────────
export interface BookedNoActionRow {
  recipientId:     number;
  recipientEmail:  string;
  bookingLinkId:   number;
  bookingLinkName: string;
  ownerUserId:     number;
  ownerName:       string | null;
  bookedAt:        Date;
  crm: { type: "contact" | "lead" | null; id: number | null; accountId: number | null };
}
export interface OpenedNotBookedRow {
  recipientId:     number;
  recipientEmail:  string;
  bookingLinkId:   number;
  bookingLinkName: string;
  ownerUserId:     number;
  ownerName:       string | null;
  firstViewedAt:   Date;
  daysSinceOpen:   number;
  crm: { type: "contact" | "lead" | null; id: number | null; accountId: number | null };
}
export interface ActionListResult {
  bookedNoNextAction: BookedNoActionRow[];
  openedNotBooked:    OpenedNotBookedRow[];
}

export async function actionLists(
  callerUserId: number, callerIsAdmin: boolean, f: RevenueFilters,
): Promise<ActionListResult> {
  const [bookedRecips, openedRecips] = await Promise.all([
    loadScopedRecipients(callerUserId, callerIsAdmin, f, { onlyBooked: true }),
    loadScopedRecipients(callerUserId, callerIsAdmin, f, { onlyOpenedNotBooked: true }),
  ]);

  // For booked recipients, "no next action" = no quote created after bookedAt
  // AND no pending/in_progress task with source='booking_followup' targeting
  // this recipient. (Phase D auto-creates such tasks 2h after meeting end —
  // dismissal/completion still satisfies our check via status, so the list
  // reflects "nobody is currently planning to act".)
  const contactIds = Array.from(new Set(bookedRecips.map((r) => r.contactId).filter((x): x is number => x != null)));
  const accountIds = Array.from(new Set(bookedRecips.map((r) => r.accountId).filter((x): x is number => x != null)));
  const allQuotes  = await loadQuotesFor(contactIds, accountIds);

  const recipientIds = bookedRecips.map((r) => String(r.recipientId));
  const pendingTaskRecipientIds = new Set<number>();
  if (recipientIds.length) {
    const t = await db
      .select({ rid: sql<string>`${tasks.sourceMeta}->>'recipientId'` })
      .from(tasks)
      .where(and(
        eq(tasks.source, "booking_followup"),
        inArray(tasks.status, ["pending", "in_progress"]),
        inArray(sql`${tasks.sourceMeta}->>'recipientId'`, recipientIds),
      ));
    t.forEach((row) => { const n = parseInt(String(row.rid), 10); if (Number.isFinite(n)) pendingTaskRecipientIds.add(n); });
  }

  const bookedNoNextAction: BookedNoActionRow[] = [];
  for (const rec of bookedRecips) {
    if (!rec.bookedAt) continue;
    if (pendingTaskRecipientIds.has(rec.recipientId)) continue;
    if (attributeQuotes(rec, allQuotes).length > 0) continue;
    bookedNoNextAction.push({
      recipientId:     rec.recipientId,
      recipientEmail:  rec.recipientEmail,
      bookingLinkId:   rec.bookingLinkId,
      bookingLinkName: rec.bookingLinkName,
      ownerUserId:     rec.ownerUserId,
      ownerName:       rec.ownerName,
      bookedAt:        rec.bookedAt,
      crm: {
        type: rec.contactId != null ? "contact" : (rec.leadId != null ? "lead" : null),
        id:   rec.contactId ?? rec.leadId ?? null,
        accountId: rec.accountId ?? null,
      },
    });
  }
  bookedNoNextAction.sort((a, b) => b.bookedAt.getTime() - a.bookedAt.getTime());

  const now = Date.now();
  const openedNotBooked: OpenedNotBookedRow[] = openedRecips
    .filter((r) => r.firstViewedAt != null)
    .map((r) => ({
      recipientId:     r.recipientId,
      recipientEmail:  r.recipientEmail,
      bookingLinkId:   r.bookingLinkId,
      bookingLinkName: r.bookingLinkName,
      ownerUserId:     r.ownerUserId,
      ownerName:       r.ownerName,
      firstViewedAt:   r.firstViewedAt!,
      daysSinceOpen:   Math.floor((now - r.firstViewedAt!.getTime()) / 86400_000),
      crm: {
        type: r.contactId != null ? "contact" : (r.leadId != null ? "lead" : null),
        id:   r.contactId ?? r.leadId ?? null,
        accountId: r.accountId ?? null,
      },
    }))
    .sort((a, b) => b.firstViewedAt.getTime() - a.firstViewedAt.getTime());

  return {
    bookedNoNextAction: bookedNoNextAction.slice(0, ACTION_LIST_LIMIT),
    openedNotBooked:    openedNotBooked.slice(0, ACTION_LIST_LIMIT),
  };
}
