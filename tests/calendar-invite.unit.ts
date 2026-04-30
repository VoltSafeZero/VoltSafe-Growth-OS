#!/usr/bin/env tsx
/**
 * Focused unit tests for the calendar-invite feature. Run with:
 *
 *   npx tsx tests/calendar-invite.unit.ts
 *
 * No live server required and NO database touched — these tests import
 * ONLY from pure modules (`calendar-invite-parse-core` + the address-list
 * parser), so they run cleanly in a CI shell with no DATABASE_URL set.
 *
 * Coverage:
 *   1. parseCalendarInviteFromText() — exercises the SAME ical.sync.parseICS
 *      call path the production service uses, locking the node-ical default
 *      import against future regression. (Architect-flagged gap fix.)
 *   2. extractJoinUrl() — Teams / Meet / Zoom / Webex / no-link / fallback.
 *   3. parseAddressList() — quoted display names, embedded commas, lowercase.
 *   4. MAX_ICS_BYTES guard — oversized payloads return null.
 */

import {
  parseCalendarInviteFromText,
  extractJoinUrl,
  MAX_ICS_BYTES,
} from "../server/services/calendar-invite-parse-core";
import { parseAddressList } from "../client/src/components/inbox/parse-address-list";
import ical from "node-ical";

let passed = 0;
let failed = 0;

function ok(label: string) {
  console.log(`  \u2713 ${label}`);
  passed++;
}
function fail(label: string, detail?: string) {
  console.error(`  \u2717 ${label}${detail ? ` \u2014 ${detail}` : ""}`);
  failed++;
}
function eq<T>(label: string, actual: T, expected: T) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok(label);
  else fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ---------- parseCalendarInviteFromText (locks the service ical import) ----

console.log("\nparseCalendarInviteFromText:");

function makeIcs(extraLines: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "PRODID:-//test//",
    "VERSION:2.0",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    "UID:test-uid",
    "DTSTAMP:20260501T100000Z",
    "DTSTART:20260501T140000Z",
    "DTEND:20260501T150000Z",
    "SUMMARY:Quarterly review",
    "ORGANIZER;CN=Trevor:MAILTO:trevor@example.com",
    "ATTENDEE;CN=Alice;PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT;RSVP=TRUE:MAILTO:alice@example.com",
    "ATTENDEE;CN=Bob;PARTSTAT=DECLINED:MAILTO:bob@example.com",
    ...extraLines,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

{
  const ev = parseCalendarInviteFromText(makeIcs([]));
  if (!ev) fail("parses minimal VCALENDAR", "got null");
  else if (ev.summary !== "Quarterly review") fail("summary", ev.summary);
  else if (ev.attendees.length !== 2) fail("attendee count", String(ev.attendees.length));
  else if (ev.attendees[0].partstat !== "ACCEPTED") fail("first attendee PARTSTAT", String(ev.attendees[0].partstat));
  else if (ev.attendees[1].partstat !== "DECLINED") fail("second attendee PARTSTAT", String(ev.attendees[1].partstat));
  else if (ev.organizer?.email !== "trevor@example.com") fail("organizer email", String(ev.organizer?.email));
  else if (ev.method !== "REQUEST") fail("method", String(ev.method));
  else ok("parses minimal VCALENDAR (locks ical.sync.parseICS path)");
}

{
  const ev = parseCalendarInviteFromText(makeIcs(["X-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.microsoft.com/l/meetup/abc"]));
  if (ev?.joinUrl === "https://teams.microsoft.com/l/meetup/abc") ok("end-to-end Teams join URL via service path");
  else fail("end-to-end Teams join URL via service path", String(ev?.joinUrl));
}

{
  const ev = parseCalendarInviteFromText(makeIcs(["STATUS:CANCELLED"]));
  if (ev?.status === "CANCELLED") ok("propagates STATUS:CANCELLED");
  else fail("propagates STATUS:CANCELLED", String(ev?.status));
}

eq("null input → null", parseCalendarInviteFromText(null), null);
eq("empty input → null", parseCalendarInviteFromText(""), null);
eq("non-calendar text → null", parseCalendarInviteFromText("Just an email body."), null);

{
  // MAX_ICS_BYTES guard — synthesise a valid VCALENDAR padded past the cap.
  const padding = "X-PAD:" + "a".repeat(MAX_ICS_BYTES + 1);
  const oversize = makeIcs([padding]);
  const ev = parseCalendarInviteFromText(oversize);
  if (ev === null) ok(`oversized (>${MAX_ICS_BYTES} bytes) → null`);
  else fail(`oversized (>${MAX_ICS_BYTES} bytes) → null`, "did not refuse");
}

// ---------- extractJoinUrl (matrix coverage with synthesised events) ------

console.log("\nextractJoinUrl:");

function makeEvent(extraLines: string[]): any {
  const body = makeIcs(extraLines);
  const parsed = ical.sync.parseICS(body);
  return Object.values(parsed).find((v: any) => v && v.type === "VEVENT");
}

{
  const url = extractJoinUrl(makeEvent(["X-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.microsoft.com/l/meetup/abc"]));
  if (url === "https://teams.microsoft.com/l/meetup/abc") ok("Teams via X-MICROSOFT-SKYPETEAMSMEETINGURL");
  else fail("Teams via X-MICROSOFT-SKYPETEAMSMEETINGURL", String(url));
}
{
  const url = extractJoinUrl(makeEvent(["X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij"]));
  if (url === "https://meet.google.com/abc-defg-hij") ok("Meet via X-GOOGLE-CONFERENCE");
  else fail("Meet via X-GOOGLE-CONFERENCE", String(url));
}
{
  const url = extractJoinUrl(makeEvent(["LOCATION:Join Zoom: https://zoom.us/j/12345"]));
  if (url && url.startsWith("https://zoom.us/j/12345")) ok("Zoom via LOCATION regex");
  else fail("Zoom via LOCATION regex", String(url));
}
{
  const url = extractJoinUrl(makeEvent(["DESCRIPTION:Join via https://acme.webex.com/m/abc-def — see attached."]));
  if (url && url.includes("webex.com/m/abc-def")) ok("Webex via DESCRIPTION known-domain match");
  else fail("Webex via DESCRIPTION known-domain match", String(url));
}
{
  const url = extractJoinUrl(makeEvent(["LOCATION:Conference Room A"]));
  if (url === null) ok("No conference link → null");
  else fail("No conference link → null", String(url));
}
{
  const url = extractJoinUrl(makeEvent(["DESCRIPTION:Agenda at https://wiki.internal/agenda"]));
  if (url === "https://wiki.internal/agenda") ok("First http fallback in DESCRIPTION");
  else fail("First http fallback in DESCRIPTION", String(url));
}

// ---------- parseAddressList ----------

console.log("\nparseAddressList:");

eq("null → []", parseAddressList(null), []);
eq("empty string → []", parseAddressList(""), []);
eq(
  "single bare address",
  parseAddressList("foo@example.com"),
  [{ name: null, email: "foo@example.com" }],
);
eq(
  "name + bracketed address",
  parseAddressList("Foo Bar <foo@example.com>"),
  [{ name: "Foo Bar", email: "foo@example.com" }],
);
eq(
  "two addresses, one with display name",
  parseAddressList("Foo Bar <foo@x.com>, baz@y.com"),
  [
    { name: "Foo Bar", email: "foo@x.com" },
    { name: null, email: "baz@y.com" },
  ],
);
eq(
  "quoted display name with embedded comma",
  parseAddressList('"Quincy, Robert" <qr@example.com>, plain@y.com'),
  [
    { name: "Quincy, Robert", email: "qr@example.com" },
    { name: null, email: "plain@y.com" },
  ],
);
eq(
  "lowercases email side",
  parseAddressList("Mixed <FOO@Example.COM>"),
  [{ name: "Mixed", email: "foo@example.com" }],
);
eq(
  "trailing comma is ignored",
  parseAddressList("a@x.com, b@x.com, "),
  [
    { name: null, email: "a@x.com" },
    { name: null, email: "b@x.com" },
  ],
);

// ---------- Summary ----------

console.log("");
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
