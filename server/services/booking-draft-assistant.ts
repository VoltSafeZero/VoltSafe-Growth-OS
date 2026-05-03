/**
 * Phase I — Booking Follow-Up Draft Assistant
 *
 * Generates a SAFE follow-up email DRAFT (subject + body + next action) for
 * a Command Center action item. No email is ever sent here — this is a pure
 * draft synthesizer the user will review and personalize.
 *
 * Anti-hallucination policy (deterministic templates only):
 *   - No AI / LLM calls. No external network calls.
 *   - Body never invents prices, dates, or commitments.
 *   - All placeholders (firstName, accountName, etc.) fall back to safe
 *     generics ("there", "your team") when the underlying CRM value is null.
 *   - Quote totals are NEVER included in the body — we only mention "the quote
 *     I sent" without committing to a number, since prices change post-send.
 *   - Booked dates are formatted as ISO date only (YYYY-MM-DD) when present.
 */

import { db } from "../db";
import { eq, and, sql, desc } from "drizzle-orm";
import {
  bookingLinks, bookingLinkRecipients,
  contacts, leads, accounts, quotes,
} from "@shared/schema";
import { CommandActionError, type ActionKind, ALLOWED_KINDS } from "./booking-command-actions";

export type Tone = "short" | "warm" | "direct";
export const ALLOWED_TONES: Tone[] = ["short", "warm", "direct"];

interface DraftInput {
  callerUserId:   number;
  callerIsAdmin:  boolean;
  kind:           ActionKind;
  recipientId:    number;
  bookingLinkId?: number;
  tone?:          Tone;
}

export interface DraftContext {
  recipientEmail:   string;
  firstName:        string | null;
  contactName:      string | null;
  leadName:         string | null;
  accountName:      string | null;
  bookingLinkId:    number;
  bookingLinkName:  string;
  sentAt:           string | null;       // ISO
  viewedAt:         string | null;       // ISO
  bookedAt:         string | null;       // ISO
  daysSinceOpen:    number | null;
  daysSinceBook:    number | null;
  openQuoteCount:   number;              // pending/sent quotes attached to contact
  hasWonQuote:      boolean;             // any accepted quote → suppresses LEAK assumption
}

export interface DraftOutput {
  subject:             string;
  body:                string;
  suggestedNextAction: string;
  context:             DraftContext;
  meta: {
    kind: ActionKind;
    tone: Tone;
    sentEmail: false;                    // explicit guarantee — no send happened
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — pure, no IO
// ─────────────────────────────────────────────────────────────────────────────
function firstNameOf(full?: string | null): string | null {
  if (!full) return null;
  const w = full.trim().split(/\s+/)[0];
  return w && w.length > 0 ? w : null;
}
function isoDate(d: Date | string | null | undefined): string | null {
  if (d == null) return null;
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}
function daysBetween(thenIso: string | null, now = new Date()): number | null {
  if (!thenIso) return null;
  const ms = now.getTime() - new Date(thenIso).getTime();
  if (ms < 0) return 0;
  return Math.round(ms / 86_400_000);
}
function pickGreetingName(ctx: DraftContext): string {
  return ctx.firstName ?? "there";
}

// ─────────────────────────────────────────────────────────────────────────────
// Context loader — owner-scoped, single round-trip + 1 quote tally query
// ─────────────────────────────────────────────────────────────────────────────
async function loadContext(input: DraftInput): Promise<DraftContext> {
  const { callerUserId, callerIsAdmin, recipientId } = input;

  const [rec] = await db
    .select({
      recipientId:     bookingLinkRecipients.id,
      recipientEmail:  bookingLinkRecipients.recipientEmail,
      sentAt:          bookingLinkRecipients.sentAt,
      viewedAt:        bookingLinkRecipients.firstViewedAt,
      bookedAt:        bookingLinkRecipients.bookedAt,
      revokedAt:       bookingLinkRecipients.revokedAt,
      bookingLinkId:   bookingLinks.id,
      bookingLinkName: bookingLinks.name,
      ownerUserId:     bookingLinks.ownerUserId,
    })
    .from(bookingLinkRecipients)
    .innerJoin(bookingLinks, eq(bookingLinks.id, bookingLinkRecipients.bookingLinkId))
    .where(eq(bookingLinkRecipients.id, recipientId))
    .limit(1);

  if (!rec) throw new CommandActionError(404, "Recipient not found");
  if (rec.revokedAt) throw new CommandActionError(400, "Recipient is revoked");
  if (input.bookingLinkId != null && input.bookingLinkId !== rec.bookingLinkId) {
    throw new CommandActionError(400, "bookingLinkId does not match recipient");
  }
  if (!callerIsAdmin && rec.ownerUserId !== callerUserId) {
    throw new CommandActionError(403, "Forbidden: recipient not owned by caller");
  }

  // CRM resolution — same precedence as Phase H (contact > lead by email)
  const lc = rec.recipientEmail.toLowerCase();
  const [c] = await db
    .select({
      id: contacts.id, name: contacts.name, accountId: contacts.accountId,
      accountName: accounts.name,
    })
    .from(contacts)
    .leftJoin(accounts, eq(accounts.id, contacts.accountId))
    .where(sql`LOWER(${contacts.email}) = ${lc}`)
    .limit(1);

  let leadName: string | null = null;
  if (!c) {
    const [l] = await db
      .select({ name: leads.contactName })
      .from(leads)
      .where(sql`LOWER(${leads.contactEmail}) = ${lc}`)
      .limit(1);
    leadName = l?.name ?? null;
  }

  // Quote tally — only for the resolved contact (we never invent quotes for
  // un-CRM'd emails). We separate "open" (sent/draft/pending) from "won".
  let openQuoteCount = 0, hasWonQuote = false;
  if (c?.id != null) {
    const rows = await db
      .select({ status: quotes.status })
      .from(quotes)
      .where(eq(quotes.contactId, c.id))
      .orderBy(desc(quotes.createdAt));
    for (const q of rows) {
      const s = (q.status ?? "").toLowerCase();
      if (s === "accepted" || s === "won") hasWonQuote = true;
      else if (s === "sent" || s === "pending" || s === "draft") openQuoteCount++;
    }
  }

  const sentAt   = isoDate(rec.sentAt as any);
  const viewedAt = isoDate(rec.viewedAt as any);
  const bookedAt = isoDate(rec.bookedAt as any);

  const ctxName = c?.name ?? null;
  return {
    recipientEmail:   rec.recipientEmail,
    firstName:        firstNameOf(ctxName ?? leadName),
    contactName:      ctxName,
    leadName,
    accountName:      c?.accountName ?? null,
    bookingLinkId:    rec.bookingLinkId,
    bookingLinkName:  rec.bookingLinkName,
    sentAt, viewedAt, bookedAt,
    daysSinceOpen:    daysBetween(viewedAt),
    daysSinceBook:    daysBetween(bookedAt),
    openQuoteCount,
    hasWonQuote,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Templates — deterministic; never invent prices/commitments/dates
// ─────────────────────────────────────────────────────────────────────────────
function tmplHotOpened(ctx: DraftContext, tone: Tone): { subject: string; body: string; next: string } {
  const name = pickGreetingName(ctx);
  const link = ctx.bookingLinkName;
  const days = ctx.daysSinceOpen;
  const account = ctx.accountName ? ` for ${ctx.accountName}` : "";

  if (tone === "short") {
    return {
      subject: `Quick nudge — "${link}"`,
      body:
`Hi ${name},

Saw you took a look at "${link}"${days != null ? ` ${days} day${days === 1 ? "" : "s"} ago` : ""}. Anything I can clarify?

Happy to grab a time whenever it suits you.`,
      next: "Personalize the opening line, then send.",
    };
  }
  if (tone === "direct") {
    return {
      subject: `Booking time for "${link}"?`,
      body:
`${name} — you opened "${link}"${days != null ? ` ${days} day${days === 1 ? "" : "s"} ago` : ""} but haven't picked a slot.

Want me to suggest a couple of times that work${account}?`,
      next: "Reply with two or three concrete time windows after sending.",
    };
  }
  // warm (default)
  return {
    subject: `Following up on "${link}"`,
    body:
`Hi ${name},

I noticed you opened the booking link for "${link}"${days != null ? ` about ${days} day${days === 1 ? "" : "s"} ago` : ""}. No pressure at all — just wanted to check whether anything was unclear or if you'd like me to walk you through what to expect on the call.

If now isn't a great time, I'm happy to circle back later in the week.`,
    next: "Add one specific detail you remember about their situation, then send.",
  };
}

function tmplBookedNoQuote(ctx: DraftContext, tone: Tone): { subject: string; body: string; next: string } {
  const name = pickGreetingName(ctx);
  const account = ctx.accountName ? ` for ${ctx.accountName}` : "";
  const meetingDate = ctx.bookedAt ? ` on ${ctx.bookedAt}` : "";

  if (tone === "short") {
    return {
      subject: `Quote for our recent call`,
      body:
`Hi ${name},

Thanks again for the time${meetingDate}. I'm putting the quote together${account} now — anything specific you'd like me to include or call out?`,
      next: "Attach the actual quote PDF before sending; do not commit to pricing in this draft.",
    };
  }
  if (tone === "direct") {
    return {
      subject: `Sending your quote shortly`,
      body:
`${name},

Following up on our meeting${meetingDate}. I'll have the quote${account} over to you shortly. Reply with anything you want adjusted before I finalize.`,
      next: "Confirm scope of work with internal team, then attach quote and send.",
    };
  }
  return {
    subject: `Following up after our meeting`,
    body:
`Hi ${name},

Really appreciated the conversation${meetingDate}. I'm working on the quote${account} now and wanted to flag two things before I send it over:

1. Anything you'd like me to add or remove from what we discussed?
2. Is the email I have the best one to send the quote to, or should I copy anyone else?

I'll have it in your inbox as soon as we line that up.`,
    next: "Confirm scope items 1–2 with the customer, then attach quote PDF and send.",
  };
}

function tmplRevenueLeak(ctx: DraftContext, tone: Tone): { subject: string; body: string; next: string } {
  const name = pickGreetingName(ctx);
  const account = ctx.accountName ? ` for ${ctx.accountName}` : "";
  const qCount = ctx.openQuoteCount;

  if (tone === "short") {
    return {
      subject: `Checking in on the quote`,
      body:
`Hi ${name},

Just bumping the quote I sent${account}. Where do things stand on your end?`,
      next: "Reference the quote number manually before sending; do not restate any pricing.",
    };
  }
  if (tone === "direct") {
    return {
      subject: `Decision on the quote?`,
      body:
`${name},

Following up on the quote I sent${account}. ${qCount > 1 ? `I have ${qCount} open quotes on file for you — happy to consolidate or revise.` : "Happy to revise it if anything has changed on your side."} What's the next step?`,
      next: "Pull up the actual quote(s) and reference the quote number(s) before sending.",
    };
  }
  return {
    subject: `Following up on your quote`,
    body:
`Hi ${name},

I wanted to circle back on the quote I sent over${account}. I know these things can sit while priorities shift, so I'm not chasing — just want to make sure you have what you need to make a call.

A couple of ways I can help:

- Walk through any of the line items again
- Adjust the scope if something's changed
- Hold the quote pricing for a bit longer if you need internal sign-off

Just let me know what would be most useful.`,
    next: "Look up the actual quote(s) on file and reference the quote number(s) before sending.",
  };
}

function buildDraft(kind: ActionKind, tone: Tone, ctx: DraftContext): DraftOutput {
  let parts: { subject: string; body: string; next: string };
  switch (kind) {
    case "HOT_OPENED_NOT_BOOKED": parts = tmplHotOpened(ctx, tone);     break;
    case "BOOKED_NO_QUOTE":        parts = tmplBookedNoQuote(ctx, tone); break;
    case "REVENUE_LEAK":           parts = tmplRevenueLeak(ctx, tone);   break;
  }
  return {
    subject:             parts.subject,
    body:                parts.body,
    suggestedNextAction: parts.next,
    context:             ctx,
    meta: { kind, tone, sentEmail: false },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry
// ─────────────────────────────────────────────────────────────────────────────
export async function generateFollowupDraft(input: DraftInput): Promise<DraftOutput> {
  if (!ALLOWED_KINDS.includes(input.kind)) {
    throw new CommandActionError(400, `Unsupported kind: ${input.kind}`);
  }
  if (!Number.isInteger(input.recipientId) || input.recipientId <= 0) {
    throw new CommandActionError(400, "recipientId must be a positive integer");
  }
  if (input.bookingLinkId != null
      && (!Number.isInteger(input.bookingLinkId) || input.bookingLinkId <= 0)) {
    throw new CommandActionError(400, "bookingLinkId must be a positive integer");
  }
  const tone: Tone = input.tone ?? "warm";
  if (!ALLOWED_TONES.includes(tone)) {
    throw new CommandActionError(400, `Unsupported tone: ${input.tone}`);
  }

  const ctx = await loadContext(input);
  return buildDraft(input.kind, tone, ctx);
}
