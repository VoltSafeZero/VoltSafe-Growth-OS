// Pure, IO-free portion of the calendar-invite parser.
//
// Lives in its own module so it can be imported by:
//   1. server/services/calendar-invite-parser.ts (the IO-bound surface that
//      adds DB lookups + Gmail attachment fetch on top)
//   2. tests/calendar-invite.unit.ts (which must NOT pull in server/db,
//      because importing db throws when DATABASE_URL is not set in a CI
//      shell where we want to run the unit test in isolation)
//
// Anything that touches the database, Gmail, or the network MUST stay in
// calendar-invite-parser.ts — keep this file dependency-free apart from
// node-ical.
//
// Note on the import: node-ical is CJS and under tsx/ESM the namespace
// import (`import * as ical`) returns a module where `.sync` is undefined.
// The default import (with esModuleInterop) gives us the actual exports
// object where `.sync.parseICS` lives.
import ical from "node-ical";

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

// Defensive size cap before we attempt UTF-8 decode + ICS parse. Real-world
// calendar invites are ~2-15 KB; anything past this cap is almost certainly
// either an embedded attachment train or a malformed/abusive payload.
// Skipping the parse keeps a runaway invite from blocking the event loop.
export const MAX_ICS_BYTES = 512 * 1024;

// ---------- helpers ----------

// node-ical's organizer/attendee can be either a plain string like
// "MAILTO:foo@bar.com" or a richer object with `params` and `val`.
export function readAddressNode(node: any): CalendarAttendee | null {
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

/**
 * Best-effort extraction of a video/conference URL from a parsed VEVENT.
 * Pure derivation — no IO, no side effects.
 */
export function extractJoinUrl(event: any): string | null {
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
 * Parse a raw .ics text payload into our flat CalendarEventDetails shape.
 *
 * Returns null when:
 *   - the input is empty
 *   - the input exceeds MAX_ICS_BYTES (after utf-8 round-trip; we measure
 *     the byte length of the input string here for safety)
 *   - the input is not a VCALENDAR
 *   - node-ical throws while parsing
 *   - the calendar contains no VEVENT
 *
 * IMPORTANT: this is the function that exercises `ical.sync.parseICS`, so
 * a unit test that calls it locks the node-ical import shape against
 * future regressions of the namespace-vs-default import gotcha.
 */
export function parseCalendarInviteFromText(
  text: string | null | undefined,
): CalendarEventDetails | null {
  if (!text) return null;
  if (Buffer.byteLength(text, "utf-8") > MAX_ICS_BYTES) return null;
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
