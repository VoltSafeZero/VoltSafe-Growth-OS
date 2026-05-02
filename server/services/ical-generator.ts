/**
 * ical-generator.ts
 *
 * Generates RFC 5545–compliant iCalendar (VCALENDAR/VEVENT) strings
 * with METHOD:REQUEST so email clients show Accept / Tentative / Decline RSVP
 * buttons (Gmail, Outlook, Apple Mail).
 *
 * Dates are always stored in UTC (DTSTART:…Z / DTEND:…Z) for maximum
 * cross-client compatibility.
 */

export interface ICalAttendee {
  email: string;
  name?: string;
}

export interface ICalEventOptions {
  /** Globally unique ID for this event (e.g. `zoom-123@voltsafe.com`) */
  uid: string;
  summary: string;
  description?: string;
  /** Physical or virtual location — use the Zoom join URL for video calls */
  location?: string;
  startTime: Date;
  endTime: Date;
  organizer: { name: string; email: string };
  attendees: ICalAttendee[];
}

function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  chunks.push(line.slice(0, 75));
  let i = 75;
  while (i < line.length) {
    chunks.push(" " + line.slice(i, i + 74));
    i += 74;
  }
  return chunks.join("\r\n");
}

function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeIcal(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

export function generateICalString(opts: ICalEventOptions): string {
  const now = utcStamp(new Date());
  const start = utcStamp(opts.startTime);
  const end = utcStamp(opts.endTime);

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//VoltSafe Inc//VoltSafe Growth OS//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${opts.uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeIcal(opts.summary)}`,
  ];

  if (opts.description) {
    lines.push(`DESCRIPTION:${escapeIcal(opts.description)}`);
  }
  if (opts.location) {
    lines.push(`LOCATION:${escapeIcal(opts.location)}`);
    lines.push(`URL:${opts.location}`);
  }

  lines.push(
    `ORGANIZER;CN="${escapeIcal(opts.organizer.name)}":mailto:${opts.organizer.email}`,
  );
  lines.push(
    `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=CHAIR;PARTSTAT=ACCEPTED;CN="${escapeIcal(opts.organizer.name)}":mailto:${opts.organizer.email}`,
  );

  for (const att of opts.attendees) {
    const cn = att.name ? `CN="${escapeIcal(att.name)}";` : "";
    lines.push(
      `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;${cn}:mailto:${att.email}`,
    );
  }

  lines.push(
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "X-MICROSOFT-CDO-BUSYSTATUS:BUSY",
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Reminder",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  );

  return lines.map(foldLine).join("\r\n");
}
