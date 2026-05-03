/**
 * booking-link-distribution.ts — Phase B
 *
 * Distribution & tracking layer on top of booking-link-service.
 *
 * Responsibilities:
 *  - Send a booking link to a CRM contact / lead via the existing Gmail
 *    integration (server/gmail.ts → sendEmail). Reuses booking-link-service
 *    for recipient creation & token generation. Idempotent on (link, email).
 *  - Mark recipients as "sent" by writing booking_link_recipients.sentAt.
 *  - Compute end-to-end status (Not sent / Sent / Opened / Booked) for any
 *    CRM object by joining booking_link_recipients.recipient_email with
 *    contacts.email or leads.contact_email, scoped to the owner's links.
 *  - Resolve the recipient's CRM object (contact / lead) for resends.
 *
 * Design notes:
 *  - NO schema changes. The (owner_user_id on booking_links, recipient_email
 *    on booking_link_recipients) pair is the natural key — we look up the
 *    CRM object by email under the caller's ownership.
 *  - "Opened" reuses the existing firstViewedAt / viewCount that
 *    resolvePublicToken() already increments when the recipient opens the
 *    public booking page. No new tracking pixel.
 *  - Activities are logged ('booking_link_sent') so the CRM timeline shows
 *    outreach for free.
 */

import { db } from "../db";
import {
  bookingLinks, bookingLinkRecipients, contacts, leads, accounts, users, activities,
} from "@shared/schema";
import { and, eq, gte, lte, sql, inArray, isNull, isNotNull } from "drizzle-orm";
import { addRecipient, getBookingLink, type BookingLinkRecipientRow } from "./booking-link-service";
import { sendEmail } from "../gmail";

export type CrmObjectType = "contact" | "lead";
export type RecipientStatus = "not_sent" | "sent" | "opened" | "booked";

// ─────────────────────────────────────────────────────────────────────────────
// Status derivation
// ─────────────────────────────────────────────────────────────────────────────

export function deriveRecipientStatus(r: {
  sentAt: Date | null;
  firstViewedAt: Date | null;
  bookedAt: Date | null;
  revokedAt: Date | null;
}): RecipientStatus {
  if (r.bookedAt) return "booked";
  if (r.firstViewedAt) return "opened";
  if (r.sentAt) return "sent";
  return "not_sent";
}

// ─────────────────────────────────────────────────────────────────────────────
// CRM lookup helpers (owner-scoped)
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the email + name for a CRM object the caller has access to. */
export async function resolveCrmRecipient(
  objectType: CrmObjectType,
  objectId: number,
): Promise<{ email: string; name: string | null } | null> {
  if (objectType === "contact") {
    const [row] = await db
      .select({ email: contacts.email, name: contacts.name })
      .from(contacts)
      .where(eq(contacts.id, objectId))
      .limit(1);
    if (!row || !row.email) return null;
    return { email: row.email, name: row.name ?? null };
  }
  if (objectType === "lead") {
    const [row] = await db
      .select({ email: leads.contactEmail, name: leads.contactName })
      .from(leads)
      .where(eq(leads.id, objectId))
      .limit(1);
    if (!row || !row.email) return null;
    return { email: row.email, name: row.name ?? null };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public URL builder
// ─────────────────────────────────────────────────────────────────────────────

function getAppBaseUrl(): string {
  // Same precedence used elsewhere in routes.ts (L896, L5975, L5998).
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.REPLIT_DOMAINS) {
    const first = process.env.REPLIT_DOMAINS.split(",")[0].trim();
    return `https://${first}`;
  }
  return "https://image-linker-burgesstrevor76.replit.app";
}

export function buildPublicBookingUrl(token: string): string {
  return `${getAppBaseUrl()}/book/${token}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Email composition
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface BookingEmailInput {
  recipientName: string | null;
  senderName: string;
  bookingLinkName: string;
  bookingLinkDescription: string | null;
  publicUrl: string;
  customMessage?: string;
}

export function buildBookingEmail(input: BookingEmailInput): { subject: string; html: string } {
  const greeting = input.recipientName
    ? `Hi ${escapeHtml(input.recipientName.split(" ")[0])},`
    : "Hi,";
  const customBlock = input.customMessage
    ? `<p style="margin:0 0 16px;color:#374151;">${escapeHtml(input.customMessage)}</p>`
    : "";
  const descBlock = input.bookingLinkDescription
    ? `<p style="margin:0 0 16px;color:#6b7280;font-size:14px;">${escapeHtml(input.bookingLinkDescription)}</p>`
    : "";
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;">
      <tr><td>
        <p style="margin:0 0 16px;color:#111827;font-size:16px;">${greeting}</p>
        ${customBlock}
        <p style="margin:0 0 8px;color:#111827;font-size:16px;font-weight:600;">${escapeHtml(input.bookingLinkName)}</p>
        ${descBlock}
        <table cellpadding="0" cellspacing="0" style="margin:24px 0;">
          <tr><td style="background:#0d9488;border-radius:8px;">
            <a href="${input.publicUrl}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-weight:600;text-decoration:none;font-size:15px;">Book a time</a>
          </td></tr>
        </table>
        <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">Or copy and paste this link into your browser:</p>
        <p style="margin:0 0 24px;color:#0d9488;font-size:13px;word-break:break-all;"><a href="${input.publicUrl}" style="color:#0d9488;text-decoration:none;">${input.publicUrl}</a></p>
        <p style="margin:0;color:#6b7280;font-size:13px;">Thanks,<br>${escapeHtml(input.senderName)}</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
  return { subject: input.bookingLinkName, html };
}

// ─────────────────────────────────────────────────────────────────────────────
// Send / Resend
// ─────────────────────────────────────────────────────────────────────────────

export interface SendBookingLinkInput {
  ownerUserId: number;
  ownerName: string;
  bookingLinkId: number;
  objectType: CrmObjectType;
  objectId: number;
  customMessage?: string;
  /** When provided, overrides the CRM record's email (rare). */
  recipientEmailOverride?: string;
  recipientNameOverride?: string;
}

export interface SendBookingLinkResult {
  recipient: BookingLinkRecipientRow;
  publicUrl: string;
  emailedAt: Date;
}

/**
 * Sends (or re-sends if already created) a booking link to the recipient
 * email of the given CRM object. Idempotent on (booking_link_id, email):
 * if a recipient row already exists we reuse its token so refreshes don't
 * fragment the audit trail.
 *
 * Throws Error("OWNER_NOT_AUTHORIZED") if the booking link isn't owned by
 * `ownerUserId`. Throws Error("CRM_OBJECT_NO_EMAIL") if the CRM object
 * doesn't exist or has no email on file.
 */
export async function sendBookingLink(
  input: SendBookingLinkInput,
): Promise<SendBookingLinkResult> {
  const link = await getBookingLink(input.bookingLinkId, input.ownerUserId);
  if (!link) throw new Error("OWNER_NOT_AUTHORIZED");

  let email = input.recipientEmailOverride;
  let name: string | null = input.recipientNameOverride ?? null;
  if (!email) {
    const crm = await resolveCrmRecipient(input.objectType, input.objectId);
    if (!crm) throw new Error("CRM_OBJECT_NO_EMAIL");
    email = crm.email;
    name = name ?? crm.name;
  }

  const recipient = await addRecipient(input.bookingLinkId, input.ownerUserId, email);
  if (!recipient) throw new Error("OWNER_NOT_AUTHORIZED");

  const publicUrl = buildPublicBookingUrl(recipient.token);
  const { subject, html } = buildBookingEmail({
    recipientName: name,
    senderName: input.ownerName,
    bookingLinkName: link.name,
    bookingLinkDescription: link.description,
    publicUrl,
    customMessage: input.customMessage,
  });

  // Send via Gmail. If sending fails we DO NOT mark sentAt — UI surfaces
  // the failure so the user can fix and retry. The recipient row stays so
  // the token is reusable.
  await sendEmail(input.ownerUserId, email, subject, html);

  const emailedAt = new Date();
  await db
    .update(bookingLinkRecipients)
    .set({ sentAt: emailedAt })
    .where(eq(bookingLinkRecipients.id, recipient.id));

  // Log activity for CRM timeline (best-effort; never blocks send).
  try {
    await db.insert(activities).values({
      linkedObjectType: input.objectType,
      linkedObjectId:   input.objectId,
      type:             "booking_link_sent",
      subject:          link.name,
      summary:          `Sent booking link "${link.name}" to ${email}`,
      createdBy:        input.ownerUserId,
    });
  } catch { /* swallow */ }

  return {
    recipient: { ...recipient, sentAt: emailedAt },
    publicUrl,
    emailedAt,
  };
}

/**
 * Re-sends the email for an existing recipient row. Owner-scoped via
 * the parent booking link. Returns null if not found / wrong owner.
 */
export async function resendBookingLink(
  recipientId: number,
  ownerUserId: number,
  ownerName: string,
): Promise<SendBookingLinkResult | null> {
  const [recipient] = await db
    .select()
    .from(bookingLinkRecipients)
    .where(eq(bookingLinkRecipients.id, recipientId))
    .limit(1);
  if (!recipient) return null;
  if (recipient.revokedAt) return null;

  const link = await getBookingLink(recipient.bookingLinkId, ownerUserId);
  if (!link) return null;

  const publicUrl = buildPublicBookingUrl(recipient.token);
  const { subject, html } = buildBookingEmail({
    recipientName: null,
    senderName: ownerName,
    bookingLinkName: link.name,
    bookingLinkDescription: link.description,
    publicUrl,
  });
  await sendEmail(ownerUserId, recipient.recipientEmail, subject, html);

  const emailedAt = new Date();
  await db
    .update(bookingLinkRecipients)
    .set({ sentAt: emailedAt })
    .where(eq(bookingLinkRecipients.id, recipient.id));

  return { recipient: { ...recipient, sentAt: emailedAt }, publicUrl, emailedAt };
}

// ─────────────────────────────────────────────────────────────────────────────
// Status query
// ─────────────────────────────────────────────────────────────────────────────

export interface RecipientStatusRow {
  recipientId: number;
  bookingLinkId: number;
  bookingLinkName: string;
  recipientEmail: string;
  status: RecipientStatus;
  sentAt: Date | null;
  firstViewedAt: Date | null;
  viewCount: number;
  bookedAt: Date | null;
  bookedCalendarEventId: number | null;
  revokedAt: Date | null;
  publicUrl: string;
  createdAt: Date;
}

/**
 * Lists all booking-link recipients the caller has sent (or seeded) to a
 * given CRM object's email address, with derived status. Owner-scoped:
 * only links the caller owns are considered, so this never leaks another
 * user's outreach to the same email.
 */
export async function listSentForCrmObject(
  ownerUserId: number,
  objectType: CrmObjectType,
  objectId: number,
): Promise<RecipientStatusRow[]> {
  const crm = await resolveCrmRecipient(objectType, objectId);
  if (!crm) return [];
  const email = crm.email.toLowerCase().trim();

  const rows = await db
    .select({
      r_id:             bookingLinkRecipients.id,
      r_link_id:        bookingLinkRecipients.bookingLinkId,
      r_email:          bookingLinkRecipients.recipientEmail,
      r_token:          bookingLinkRecipients.token,
      r_sent:           bookingLinkRecipients.sentAt,
      r_first_viewed:   bookingLinkRecipients.firstViewedAt,
      r_view_count:     bookingLinkRecipients.viewCount,
      r_booked:         bookingLinkRecipients.bookedAt,
      r_booked_event:   bookingLinkRecipients.bookedCalendarEventId,
      r_revoked:        bookingLinkRecipients.revokedAt,
      r_created:        bookingLinkRecipients.createdAt,
      l_name:           bookingLinks.name,
    })
    .from(bookingLinkRecipients)
    .innerJoin(bookingLinks, eq(bookingLinks.id, bookingLinkRecipients.bookingLinkId))
    .where(and(
      eq(bookingLinks.ownerUserId, ownerUserId),
      eq(bookingLinkRecipients.recipientEmail, email),
    ))
    .orderBy(sql`${bookingLinkRecipients.createdAt} DESC`);

  return rows.map((r) => ({
    recipientId:           r.r_id,
    bookingLinkId:         r.r_link_id,
    bookingLinkName:       r.l_name,
    recipientEmail:        r.r_email,
    status: deriveRecipientStatus({
      sentAt:        r.r_sent,
      firstViewedAt: r.r_first_viewed,
      bookedAt:      r.r_booked,
      revokedAt:     r.r_revoked,
    }),
    sentAt:                r.r_sent,
    firstViewedAt:         r.r_first_viewed,
    viewCount:             r.r_view_count,
    bookedAt:              r.r_booked,
    bookedCalendarEventId: r.r_booked_event,
    revokedAt:             r.r_revoked,
    publicUrl:             buildPublicBookingUrl(r.r_token),
    createdAt:             r.r_created,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase C — Booking Outreach Dashboard
//
// listOutreach() returns a flat, dashboard-shaped list of all recipients the
// caller is allowed to see (their own links; admins can see all and may
// filter by ownerUserId), enriched with the best-effort CRM record link
// (lead or contact resolved by recipient_email).
//
// Owner-scoping: regular users always see ONLY booking_links.owner_user_id =
// callerId. Admins (master_admin / admin) see everything; if they pass
// ownerUserId we narrow to that user.
// ─────────────────────────────────────────────────────────────────────────────

export interface OutreachFilters {
  status?:        RecipientStatus | "revoked";
  ownerUserId?:   number;
  bookingLinkId?: number;
  dateFrom?:      Date;
  dateTo?:        Date;
  /** Free-text search on recipient_email (substring, case-insensitive). */
  search?:        string;
}

export interface OutreachRow {
  recipientId:     number;
  recipientEmail:  string;
  bookingLinkId:   number;
  bookingLinkName: string;
  ownerUserId:     number;
  ownerName:       string | null;
  status:          RecipientStatus | "revoked";
  sentAt:          Date | null;
  firstViewedAt:   Date | null;
  viewCount:       number;
  bookedAt:        Date | null;
  bookedCalendarEventId: number | null;
  revokedAt:       Date | null;
  createdAt:       Date;
  publicUrl:       string;
  /** Best-effort CRM resolution by email. May be null. */
  crmRecord: null | {
    type: "contact" | "lead";
    id:   number;
    name: string | null;
    accountId?: number | null;
    accountName?: string | null;
  };
}

function applyFilters(rows: any[], filters: OutreachFilters): any[] {
  let out = rows;
  if (filters.dateFrom) out = out.filter((r) => new Date(r.r_created) >= filters.dateFrom!);
  if (filters.dateTo)   out = out.filter((r) => new Date(r.r_created) <= filters.dateTo!);
  if (filters.search) {
    const q = filters.search.toLowerCase();
    out = out.filter((r) => r.r_email.toLowerCase().includes(q));
  }
  if (filters.status) {
    out = out.filter((r) => {
      if (filters.status === "revoked") return r.r_revoked != null;
      const s = deriveRecipientStatus({
        sentAt: r.r_sent, firstViewedAt: r.r_first_viewed,
        bookedAt: r.r_booked, revokedAt: r.r_revoked,
      });
      return s === filters.status;
    });
  }
  return out;
}

/**
 * Fetch all outreach rows visible to the caller, with filters & CRM enrichment.
 * Owner-scope: non-admins are forced to ownerUserId = callerId.
 */
export async function listOutreach(
  callerUserId: number,
  callerIsAdmin: boolean,
  filters: OutreachFilters = {},
): Promise<OutreachRow[]> {
  // Build owner predicate. Non-admins ignore filters.ownerUserId.
  const ownerPredicate = callerIsAdmin
    ? (filters.ownerUserId ? eq(bookingLinks.ownerUserId, filters.ownerUserId) : undefined)
    : eq(bookingLinks.ownerUserId, callerUserId);

  const linkPredicate = filters.bookingLinkId
    ? eq(bookingLinkRecipients.bookingLinkId, filters.bookingLinkId)
    : undefined;

  const conditions = [ownerPredicate, linkPredicate].filter(Boolean) as any[];

  const baseRows = await db
    .select({
      r_id:           bookingLinkRecipients.id,
      r_link_id:      bookingLinkRecipients.bookingLinkId,
      r_email:        bookingLinkRecipients.recipientEmail,
      r_token:        bookingLinkRecipients.token,
      r_sent:         bookingLinkRecipients.sentAt,
      r_first_viewed: bookingLinkRecipients.firstViewedAt,
      r_view_count:   bookingLinkRecipients.viewCount,
      r_booked:       bookingLinkRecipients.bookedAt,
      r_booked_event: bookingLinkRecipients.bookedCalendarEventId,
      r_revoked:      bookingLinkRecipients.revokedAt,
      r_created:      bookingLinkRecipients.createdAt,
      l_name:         bookingLinks.name,
      l_owner:        bookingLinks.ownerUserId,
      o_name:         users.name,
    })
    .from(bookingLinkRecipients)
    .innerJoin(bookingLinks, eq(bookingLinks.id, bookingLinkRecipients.bookingLinkId))
    .leftJoin(users, eq(users.id, bookingLinks.ownerUserId))
    .where(conditions.length ? and(...conditions) : sql`TRUE`)
    .orderBy(sql`${bookingLinkRecipients.createdAt} DESC`)
    .limit(2000);

  const filtered = applyFilters(baseRows, filters);
  if (filtered.length === 0) return [];

  // CRM enrichment: bulk-fetch contacts + leads by the set of emails.
  const emails = Array.from(new Set(filtered.map((r) => r.r_email.toLowerCase())));
  const [contactRows, leadRows] = await Promise.all([
    db.select({
        id: contacts.id, name: contacts.name, email: contacts.email,
        accountId: contacts.accountId,
      })
      .from(contacts)
      .where(inArray(sql`LOWER(${contacts.email})`, emails)),
    db.select({
        id: leads.id, name: leads.contactName, email: leads.contactEmail,
      })
      .from(leads)
      .where(inArray(sql`LOWER(${leads.contactEmail})`, emails)),
  ]);

  const accountIds = Array.from(new Set(contactRows.map((c) => c.accountId).filter(Boolean) as number[]));
  const accountRows = accountIds.length
    ? await db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(inArray(accounts.id, accountIds))
    : [];
  const accountMap = new Map(accountRows.map((a) => [a.id, a.name]));

  const contactByEmail = new Map<string, { id: number; name: string | null; accountId: number | null }>();
  for (const c of contactRows) {
    if (c.email) contactByEmail.set(c.email.toLowerCase(), { id: c.id, name: c.name ?? null, accountId: c.accountId ?? null });
  }
  const leadByEmail = new Map<string, { id: number; name: string | null }>();
  for (const l of leadRows) {
    if (l.email) leadByEmail.set(l.email.toLowerCase(), { id: l.id, name: l.name ?? null });
  }

  return filtered.map((r) => {
    const e = r.r_email.toLowerCase();
    let crmRecord: OutreachRow["crmRecord"] = null;
    const c = contactByEmail.get(e);
    if (c) {
      crmRecord = {
        type: "contact", id: c.id, name: c.name,
        accountId: c.accountId,
        accountName: c.accountId ? (accountMap.get(c.accountId) ?? null) : null,
      };
    } else {
      const l = leadByEmail.get(e);
      if (l) crmRecord = { type: "lead", id: l.id, name: l.name };
    }

    const status: OutreachRow["status"] = r.r_revoked
      ? "revoked"
      : deriveRecipientStatus({
          sentAt: r.r_sent, firstViewedAt: r.r_first_viewed,
          bookedAt: r.r_booked, revokedAt: r.r_revoked,
        });

    return {
      recipientId:     r.r_id,
      recipientEmail:  r.r_email,
      bookingLinkId:   r.r_link_id,
      bookingLinkName: r.l_name,
      ownerUserId:     r.l_owner,
      ownerName:       r.o_name ?? null,
      status,
      sentAt:          r.r_sent,
      firstViewedAt:   r.r_first_viewed,
      viewCount:       r.r_view_count,
      bookedAt:        r.r_booked,
      bookedCalendarEventId: r.r_booked_event,
      revokedAt:       r.r_revoked,
      createdAt:       r.r_created,
      publicUrl:       buildPublicBookingUrl(r.r_token),
      crmRecord,
    };
  });
}

export interface OutreachSummary {
  total:        number;   // distinct recipient rows in scope
  notSent:      number;
  sent:         number;   // sent_at IS NOT NULL (incl. opened + booked)
  opened:       number;   // first_viewed_at IS NOT NULL (incl. booked)
  booked:       number;
  revoked:      number;
  openRate:     number;   // opened / sent (0..1, NaN-safe → 0)
  bookingRate:  number;   // booked / sent (0..1, NaN-safe → 0)
}

/**
 * Aggregate counts / rates for the dashboard summary cards. Same scoping
 * rules as listOutreach. Computed in JS for filter symmetry — outreach
 * volume is small (capped at 2000 rows above).
 */
export async function summarizeOutreach(
  callerUserId: number,
  callerIsAdmin: boolean,
  filters: OutreachFilters = {},
): Promise<OutreachSummary> {
  const rows = await listOutreach(callerUserId, callerIsAdmin, filters);
  const total = rows.length;
  let notSent = 0, sent = 0, opened = 0, booked = 0, revoked = 0;
  for (const r of rows) {
    if (r.revokedAt) revoked++;
    if (r.bookedAt) booked++;
    if (r.firstViewedAt) opened++;
    if (r.sentAt) sent++;
    else if (!r.revokedAt) notSent++;
  }
  return {
    total, notSent, sent, opened, booked, revoked,
    openRate:    sent > 0 ? opened / sent : 0,
    bookingRate: sent > 0 ? booked / sent : 0,
  };
}

/** List of distinct booking-link owners (for admin filter dropdowns). */
export async function listOutreachOwners(): Promise<{ id: number; name: string }[]> {
  const rows = await db
    .selectDistinct({ id: users.id, name: users.name })
    .from(bookingLinks)
    .innerJoin(users, eq(users.id, bookingLinks.ownerUserId));
  return rows
    .filter((r): r is { id: number; name: string } => r.id != null && r.name != null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

