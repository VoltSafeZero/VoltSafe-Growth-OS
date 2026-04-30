// Calendar-invite (.ics) parser + Gmail attachment proxy.
//
// Two responsibilities:
//   1. parseCalendarInviteForAttachment(attachmentDbId)
//      - Resolves the email_attachments row -> parent email_messages row
//      - Fetches the raw attachment bytes from Gmail's REST API using the
//        owner's OAuth token (refreshed transparently by getGmailClient)
//      - Decodes base64url -> UTF-8 text -> parses with node-ical
//      - Normalises the first VEVENT into a flat shape that the React
//        CalendarInviteCard can render directly
//
//   2. downloadGmailAttachment(attachmentDbId)
//      - Same lookup + auth chain, returns the raw bytes + filename + mime
//        for the HTTP route to stream back to the browser as a download
//
// Both helpers throw on missing/inaccessible records; the route wraps them
// in try/catch and converts to 404/500.
import * as ical from "node-ical";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { emailAttachments, emailMessages } from "../../shared/schema";
import { getGmailClient } from "../gmail-oauth";

export interface CalendarAttendee {
  name: string | null;
  email: string;
  role: string | null;       // CHAIR | REQ-PARTICIPANT | OPT-PARTICIPANT
  partstat: string | null;   // ACCEPTED | DECLINED | TENTATIVE | NEEDS-ACTION
  rsvp: boolean;
}

export interface CalendarEventDetails {
  uid: string | null;
  summary: string;
  description: string | null;
  location: string | null;
  joinUrl: string | null;     // Best-effort conference URL (Teams/Zoom/Meet/etc)
  start: string | null;       // ISO-8601
  end: string | null;         // ISO-8601
  allDay: boolean;
  organizer: { name: string | null; email: string | null } | null;
  attendees: CalendarAttendee[];
  status: string | null;      // CONFIRMED | CANCELLED | TENTATIVE
  sequence: number;
  method: string | null;      // REQUEST | REPLY | CANCEL
  rrule: string | null;
}

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

// Lightweight helpers for converting node-ical's polymorphic shape into our
// flat schema. node-ical's organizer/attendee can be either a plain string
// like "MAILTO:foo@bar.com" or a richer object with `params` and `val`.
function readAddressNode(node: any): CalendarAttendee | null {
  if (!node) return null;
  let raw = "";
  let params: Record<string, any> = {};
  if (typeof node === "string") {
    raw = node;
  } else if (typeof node === "object") {
    raw = String(node.val ?? node);
    params = node.params || {};
  }
  const email = raw.replace(/^MAILTO:/i, "").trim().toLowerCase();
  if (!email) return null;
  return {
    name: typeof params.CN === "string" ? params.CN : null,
    email,
    role: typeof params.ROLE === "string" ? params.ROLE : null,
    partstat: typeof params.PARTSTAT === "string" ? params.PARTSTAT : null,
    rsvp: String(params.RSVP || "").toUpperCase() === "TRUE",
  };
}

function extractJoinUrl(event: any): string | null {
  // 1. Microsoft Teams ships X-MICROSOFT-SKYPETEAMSMEETINGURL on the VEVENT.
  //    node-ical historically strips the leading "X-" when surfacing iCal
  //    extension properties, so we probe BOTH the prefixed and non-prefixed
  //    forms (lowercased + uppercased) to be safe across versions.
  const probeKeys = [
    "x-microsoft-skypeteamsmeetingurl",
    "X-MICROSOFT-SKYPETEAMSMEETINGURL",
    "microsoft-skypeteamsmeetingurl",
    "MICROSOFT-SKYPETEAMSMEETINGURL",
    "x-google-conference",
    "X-GOOGLE-CONFERENCE",
    "google-conference",
    "GOOGLE-CONFERENCE",
  ];
  for (const k of probeKeys) {
    const v = event[k];
    if (v && typeof v === "string") return v;
    if (v && typeof v === "object" && typeof v.val === "string") return v.val;
  }
  // 1b. Last-resort fuzzy scan over remaining event keys for any field whose
  //     name mentions teams/meet/zoom/conference and whose value is a URL.
  for (const [key, val] of Object.entries(event)) {
    const lk = key.toLowerCase();
    if (!/(teams|meet|zoom|conference|webex|whereby)/.test(lk)) continue;
    const str = typeof val === "string"
      ? val
      : (val && typeof val === "object" && typeof (val as any).val === "string")
        ? (val as any).val
        : "";
    if (/^https?:\/\//i.test(str)) return str;
  }
  // 2. LOCATION sometimes is the Zoom/Webex URL itself
  const loc = typeof event.location === "string" ? event.location : "";
  const locMatch = loc.match(/https?:\/\/\S+/);
  if (locMatch) return locMatch[0];
  // 3. DESCRIPTION — prefer known conference domains, fall back to first link
  const desc = typeof event.description === "string" ? event.description : "";
  const conf = desc.match(
    /https?:\/\/[^\s"'<>)]*(?:teams\.microsoft\.com|zoom\.us|meet\.google\.com|webex\.com|whereby\.com|jit\.si|gotomeeting\.com)[^\s"'<>)]*/i,
  );
  if (conf) return conf[0];
  const any = desc.match(/https?:\/\/[^\s"'<>)]+/);
  if (any) return any[0];
  return null;
}

/**
 * Parse the calendar invite for a single attachment row.
 * Caller is responsible for verifying the attachment is text/calendar before
 * invoking us.
 */
export async function parseCalendarInviteForAttachment(
  attachmentDbId: number,
): Promise<CalendarEventDetails | null> {
  const lookup = await loadAttachmentWithMessage(attachmentDbId);
  if (!lookup) return null;
  const buf = await fetchAttachmentBytes(lookup);
  if (!buf) return null;
  const text = buf.toString("utf-8");
  if (!/BEGIN:VCALENDAR/i.test(text)) return null;

  let parsed: any;
  try {
    parsed = ical.sync.parseICS(text);
  } catch {
    return null;
  }
  const event = Object.values(parsed).find(
    (v: any) => v && v.type === "VEVENT",
  ) as any;
  if (!event) return null;

  const organizer = readAddressNode(event.organizer);

  const attRaw = event.attendee;
  const attArr = !attRaw
    ? []
    : Array.isArray(attRaw)
    ? attRaw
    : [attRaw];
  const attendees = attArr
    .map(readAddressNode)
    .filter((a: CalendarAttendee | null): a is CalendarAttendee => !!a);

  const startDate: any = event.start;
  const endDate: any = event.end;
  const allDay =
    !!startDate && (startDate.dateOnly === true || /^\d{4}-\d{2}-\d{2}$/.test(String(startDate)));

  const toIso = (d: any): string | null => {
    if (!d) return null;
    try {
      const date = d instanceof Date ? d : new Date(d);
      if (isNaN(date.getTime())) return null;
      return date.toISOString();
    } catch {
      return null;
    }
  };

  return {
    uid: typeof event.uid === "string" ? event.uid : null,
    summary: typeof event.summary === "string" ? event.summary : "(no title)",
    description: typeof event.description === "string" ? event.description : null,
    location: typeof event.location === "string" ? event.location : null,
    joinUrl: extractJoinUrl(event),
    start: toIso(startDate),
    end: toIso(endDate),
    allDay,
    organizer: organizer ? { name: organizer.name, email: organizer.email } : null,
    attendees,
    status: typeof event.status === "string" ? event.status : null,
    sequence: typeof event.sequence === "number" ? event.sequence : 0,
    method: typeof parsed.method === "string"
      ? parsed.method
      : typeof event.method === "string"
      ? event.method
      : null,
    rrule: event.rrule ? String(event.rrule) : null,
  };
}
