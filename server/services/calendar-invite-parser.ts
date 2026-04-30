// Calendar-invite (.ics) Gmail attachment proxy + IO surface.
//
// This module owns the database lookup + Gmail OAuth fetch chain. The pure
// parsing logic (node-ical decode, VEVENT normalisation, joinUrl extraction)
// lives in `./calendar-invite-parse-core` so it can be unit-tested without
// pulling in `server/db` (which would explode in a DATABASE_URL-less shell).
//
// Two responsibilities:
//   1. parseCalendarInviteForAttachment(attachmentDbId)
//      - Resolves the email_attachments row -> parent email_messages row
//      - Fetches the raw attachment bytes from Gmail's REST API using the
//        owner's OAuth token (refreshed transparently by getGmailClient)
//      - Decodes UTF-8 and hands off to parseCalendarInviteFromText()
//
//   2. downloadGmailAttachment(attachmentDbId)
//      - Same lookup + auth chain, returns the raw bytes + filename + mime
//        for the HTTP route to stream back to the browser as a download
//
// Both helpers throw on missing/inaccessible records; the route wraps them
// in try/catch and converts to 404/500.
import { eq } from "drizzle-orm";
import { db } from "../db";
import { emailAttachments, emailMessages } from "../../shared/schema";
import { getGmailClient } from "../gmail-oauth";
import {
  parseCalendarInviteFromText,
  MAX_ICS_BYTES,
  type CalendarAttendee,
  type CalendarEventDetails,
} from "./calendar-invite-parse-core";

// Re-export the shape definitions and the pure helper so existing callers
// (and future ones) can import everything from a single module.
export { parseCalendarInviteFromText, MAX_ICS_BYTES };
export type { CalendarAttendee, CalendarEventDetails };
// Also re-export extractJoinUrl for any caller that wants the pure helper
// directly without going through the IO chain.
export { extractJoinUrl, readAddressNode } from "./calendar-invite-parse-core";

interface AttachmentLookup {
  attachment: {
    id: number;
    messageId: number;
    gmailAttachmentId: string | null;
    filename: string | null;
    mimeType: string | null;
  };
  message: {
    id: number;
    gmailMessageId: string | null;
    ownerUserId: number | null;
    sourceAccountId: number | null;
  };
}

async function loadAttachmentWithMessage(
  attachmentDbId: number,
): Promise<AttachmentLookup | null> {
  const [att] = await db
    .select({
      id: emailAttachments.id,
      messageId: emailAttachments.messageId,
      gmailAttachmentId: emailAttachments.gmailAttachmentId,
      filename: emailAttachments.filename,
      mimeType: emailAttachments.mimeType,
    })
    .from(emailAttachments)
    .where(eq(emailAttachments.id, attachmentDbId))
    .limit(1);
  if (!att) return null;

  const [msg] = await db
    .select({
      id: emailMessages.id,
      gmailMessageId: emailMessages.gmailMessageId,
      ownerUserId: emailMessages.ownerUserId,
      sourceAccountId: emailMessages.sourceAccountId,
    })
    .from(emailMessages)
    .where(eq(emailMessages.id, att.messageId))
    .limit(1);
  if (!msg) return null;

  return { attachment: att, message: msg };
}

/**
 * Lookup helper exposed for the route layer to do its own authorization
 * (caller compares msg.ownerUserId to the session's userId before calling
 * the heavy fetch helpers below).
 */
export async function getAttachmentOwner(
  attachmentDbId: number,
): Promise<{ ownerUserId: number | null; sourceAccountId: number | null; mimeType: string | null; filename: string | null } | null> {
  const lookup = await loadAttachmentWithMessage(attachmentDbId);
  if (!lookup) return null;
  return {
    ownerUserId: lookup.message.ownerUserId,
    sourceAccountId: lookup.message.sourceAccountId,
    mimeType: lookup.attachment.mimeType,
    filename: lookup.attachment.filename,
  };
}

async function fetchAttachmentBytes(
  lookup: AttachmentLookup,
): Promise<Buffer | null> {
  const { attachment, message } = lookup;
  if (!attachment.gmailAttachmentId) return null;
  if (!message.gmailMessageId) return null;
  if (message.ownerUserId == null) return null;

  const gmail = await getGmailClient(
    message.ownerUserId,
    message.sourceAccountId ?? undefined,
  );

  const attRes = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId: message.gmailMessageId,
    id: attachment.gmailAttachmentId,
  });
  const data = (attRes.data as any)?.data;
  if (!data) return null;
  // Gmail returns base64url-encoded bytes
  return Buffer.from(data, "base64url");
}

/**
 * Download the raw bytes for any Gmail attachment by its DB id.
 * Returns null if the attachment / message can't be located or has no
 * fetchable id (e.g. body-inline only, no Gmail attachmentId).
 */
export async function downloadGmailAttachment(
  attachmentDbId: number,
): Promise<{ data: Buffer; filename: string; mimeType: string } | null> {
  const lookup = await loadAttachmentWithMessage(attachmentDbId);
  if (!lookup) return null;
  const buf = await fetchAttachmentBytes(lookup);
  if (!buf) return null;
  return {
    data: buf,
    filename: lookup.attachment.filename || "attachment",
    mimeType: lookup.attachment.mimeType || "application/octet-stream",
  };
}

/**
 * Parse the calendar invite for a single attachment row.
 * Caller is responsible for verifying the attachment is text/calendar before
 * invoking us.
 *
 * The hard work (UTF-8 decode + node-ical parse + VEVENT normalisation) is
 * delegated to parseCalendarInviteFromText() in the pure-helper module.
 */
export async function parseCalendarInviteForAttachment(
  attachmentDbId: number,
): Promise<CalendarEventDetails | null> {
  const lookup = await loadAttachmentWithMessage(attachmentDbId);
  if (!lookup) return null;
  const buf = await fetchAttachmentBytes(lookup);
  if (!buf) return null;
  // Cheap byte-level guard before we even allocate a JS string.
  if (buf.length > MAX_ICS_BYTES) return null;
  const text = buf.toString("utf-8");
  return parseCalendarInviteFromText(text);
}
