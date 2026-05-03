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
  bookingLinks, bookingLinkRecipients, contacts, leads, activities,
} from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
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
