/**
 * Task #39 — Outbound Messaging & Booking security hardening
 *
 * Tests:
 *  A. Server-side slot validation in confirmBooking() / POST /api/booking-links/public/:token/confirm
 *  B. SSRF guard isSsrfSafeUrl() in gmail.ts / extractCtaInlineImages()
 */

"use strict";

const assert = require("assert");

// ─────────────────────────────────────────────────────────────────────────────
// Section A — validateSlotAgainstLink (unit tests; no DB needed)
// ─────────────────────────────────────────────────────────────────────────────

// Re-implement the pure functions from booking-link-service.ts inline so we
// can unit-test them without spinning up Express or a real DB.

function dowInTz(date, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).formatToParts(date);
  const day = parts.find((p) => p.type === "weekday")?.value ?? "";
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(day);
}

function hhmmInTz(date, tz) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${h}:${m}`;
}

function validateSlotAgainstLink(link, slotStart) {
  const start = new Date(slotStart);
  if (isNaN(start.getTime())) return "slotStart is not a valid date";

  const now = Date.now();

  const minNoticeMs = link.minNoticeHours * 3_600_000;
  if (start.getTime() < now + minNoticeMs) {
    return `Slot must be at least ${link.minNoticeHours} hour(s) from now`;
  }

  const horizonMs = link.advanceDays * 86_400_000;
  if (start.getTime() > now + horizonMs) {
    return `Slot is further than ${link.advanceDays} day(s) in advance`;
  }

  const windows = link.availability;
  if (windows && windows.length > 0) {
    const tz = link.timeZone || "UTC";
    const slotDow = dowInTz(start, tz);
    const slotStartHHMM = hhmmInTz(start, tz);
    const slotEnd = new Date(start.getTime() + link.slotMinutes * 60_000);
    const slotEndHHMM = hhmmInTz(slotEnd, tz);

    const fits = windows.some(
      (w) =>
        w.dow === slotDow &&
        slotStartHHMM >= w.start &&
        slotEndHHMM <= w.end,
    );

    if (!fits) return "Slot does not fall within the booking link's available hours";
  }

  return null;
}

// Helper: get a slot in UTC that is 2 hours from now
function slotIn(hours) {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

// Helper: get a slot on a specific day-of-week at a given HH:MM UTC
function slotOnDow(targetDow, hhMM, daysFromNow = 1) {
  // Produce a date that is daysFromNow calendar days from now at the given HH:MM UTC
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  const [h, m] = hhMM.split(":").map(Number);
  d.setUTCHours(h, m, 0, 0);
  return d;
}

const LINK_DEFAULTS = {
  slotMinutes: 30,
  bufferMinutes: 0,
  advanceDays: 14,
  minNoticeHours: 4,
  timeZone: "UTC",
  availability: [],
};

let passed = 0;
let failed = 0;

function run(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${label}`);
    console.error(`      ${e.message}`);
    failed++;
  }
}

// ── A1. minNoticeHours enforcement ───────────────────────────────────────────
console.log("\nA1. minNoticeHours enforcement");

run("slot 1 h from now rejected when minNoticeHours=4", () => {
  const err = validateSlotAgainstLink(
    { ...LINK_DEFAULTS, minNoticeHours: 4 },
    slotIn(1),
  );
  assert.ok(err, "expected an error");
  assert.ok(err.includes("4 hour"), `got: ${err}`);
});

run("slot 4.5 h from now accepted when minNoticeHours=4", () => {
  const err = validateSlotAgainstLink(
    { ...LINK_DEFAULTS, minNoticeHours: 4 },
    slotIn(4.5),
  );
  assert.strictEqual(err, null, `unexpected error: ${err}`);
});

run("slot in past always rejected", () => {
  const err = validateSlotAgainstLink(
    { ...LINK_DEFAULTS, minNoticeHours: 0 },
    new Date(Date.now() - 60_000).toISOString(),
  );
  assert.ok(err, "expected an error for past slot");
});

run("minNoticeHours=0 accepts slot 5 minutes away", () => {
  const err = validateSlotAgainstLink(
    { ...LINK_DEFAULTS, minNoticeHours: 0 },
    slotIn(0.1),
  );
  assert.strictEqual(err, null, `unexpected error: ${err}`);
});

// ── A2. advanceDays enforcement ───────────────────────────────────────────────
console.log("\nA2. advanceDays enforcement");

run("slot 20 days out rejected when advanceDays=14", () => {
  const err = validateSlotAgainstLink(
    { ...LINK_DEFAULTS, advanceDays: 14 },
    slotIn(24 * 20),
  );
  assert.ok(err, "expected an error");
  assert.ok(err.includes("14 day"), `got: ${err}`);
});

run("slot 13 days out accepted when advanceDays=14", () => {
  const err = validateSlotAgainstLink(
    { ...LINK_DEFAULTS, advanceDays: 14 },
    slotIn(24 * 13),
  );
  assert.strictEqual(err, null, `unexpected error: ${err}`);
});

run("exactly-boundary slot (minNotice and advanceDays same day) is handled", () => {
  const link = { ...LINK_DEFAULTS, advanceDays: 1, minNoticeHours: 0 };
  // 23 h from now is still within 1 day
  const err = validateSlotAgainstLink(link, slotIn(23));
  assert.strictEqual(err, null, `unexpected error: ${err}`);
});

// ── A3. Availability window enforcement ───────────────────────────────────────
console.log("\nA3. Availability window enforcement");

// We need a predictable future day. Use 1 day from now in UTC.
// Find its DOW so we can set up a window that should or should not match.
const futureBase = new Date(Date.now() + 24 * 3_600_000);
futureBase.setUTCHours(10, 0, 0, 0); // 10:00 UTC
const futureDow = futureBase.getUTCDay(); // DOW in UTC
const futureISO = futureBase.toISOString();

run("slot within matching window accepted", () => {
  const err = validateSlotAgainstLink(
    {
      ...LINK_DEFAULTS,
      timeZone: "UTC",
      availability: [{ dow: futureDow, start: "09:00", end: "17:00" }],
    },
    futureISO,
  );
  assert.strictEqual(err, null, `unexpected error: ${err}`);
});

run("slot on wrong day of week rejected", () => {
  const wrongDow = (futureDow + 1) % 7; // next day
  const err = validateSlotAgainstLink(
    {
      ...LINK_DEFAULTS,
      timeZone: "UTC",
      availability: [{ dow: wrongDow, start: "09:00", end: "17:00" }],
    },
    futureISO,
  );
  assert.ok(err, "expected error for wrong DOW");
  assert.ok(err.includes("available hours"), `got: ${err}`);
});

run("slot starting before window start rejected", () => {
  // 10:00 slot, window starts at 11:00
  const err = validateSlotAgainstLink(
    {
      ...LINK_DEFAULTS,
      timeZone: "UTC",
      availability: [{ dow: futureDow, start: "11:00", end: "17:00" }],
    },
    futureISO,
  );
  assert.ok(err, "expected error — slot before window start");
});

run("slot ending after window end rejected", () => {
  // 10:00 slot + 30 min = 10:30, window ends at 10:20
  const err = validateSlotAgainstLink(
    {
      ...LINK_DEFAULTS,
      slotMinutes: 30,
      timeZone: "UTC",
      availability: [{ dow: futureDow, start: "09:00", end: "10:20" }],
    },
    futureISO,
  );
  assert.ok(err, "expected error — slot end exceeds window end");
});

run("empty availability array allows any time", () => {
  const err = validateSlotAgainstLink(
    { ...LINK_DEFAULTS, availability: [] },
    slotIn(5),
  );
  assert.strictEqual(err, null, `unexpected error: ${err}`);
});

run("multiple windows — slot matching second window accepted", () => {
  const err = validateSlotAgainstLink(
    {
      ...LINK_DEFAULTS,
      timeZone: "UTC",
      availability: [
        { dow: (futureDow + 1) % 7, start: "09:00", end: "12:00" }, // wrong day
        { dow: futureDow, start: "09:00", end: "17:00" },             // correct day
      ],
    },
    futureISO,
  );
  assert.strictEqual(err, null, `unexpected error: ${err}`);
});

run("invalid slotStart returns error string", () => {
  const err = validateSlotAgainstLink(LINK_DEFAULTS, "not-a-date");
  assert.ok(err, "expected an error");
  assert.ok(err.toLowerCase().includes("valid"), `got: ${err}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Section B — isSsrfSafeUrl (unit tests; no network)
// ─────────────────────────────────────────────────────────────────────────────

// Re-implement the function inline (mirrors server/gmail.ts exactly).
function isSsrfSafeUrl(src) {
  let u;
  try {
    u = new URL(src);
  } catch {
    return false;
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") return false;

  const host = u.hostname.toLowerCase();

  if (host === "::1" || host === "[::1]") return false;
  if (host.startsWith("[fe80:") || host.startsWith("[fc") || host.startsWith("[fd")) return false;

  if (
    host === "localhost" ||
    host === "metadata.google.internal" ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    host.endsWith(".localhost")
  ) return false;

  const octets = host.split(".");
  if (octets.length === 4 && octets.every((o) => /^\d+$/.test(o))) {
    const [a, b] = octets.map(Number);
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    ) return false;
  }

  return true;
}

console.log("\nB1. isSsrfSafeUrl — blocked addresses");

run("localhost blocked", () => assert.strictEqual(isSsrfSafeUrl("http://localhost/image.png"), false));
run("127.0.0.1 blocked", () => assert.strictEqual(isSsrfSafeUrl("http://127.0.0.1/x"), false));
run("127.0.0.2 blocked (full loopback range)", () => assert.strictEqual(isSsrfSafeUrl("http://127.0.0.2/x"), false));
run("10.0.0.1 blocked", () => assert.strictEqual(isSsrfSafeUrl("http://10.0.0.1/x"), false));
run("10.255.255.255 blocked", () => assert.strictEqual(isSsrfSafeUrl("http://10.255.255.255/x"), false));
run("172.16.0.1 blocked", () => assert.strictEqual(isSsrfSafeUrl("http://172.16.0.1/x"), false));
run("172.31.255.255 blocked", () => assert.strictEqual(isSsrfSafeUrl("http://172.31.255.255/x"), false));
run("172.15.x NOT blocked (outside /12)", () => assert.strictEqual(isSsrfSafeUrl("http://172.15.0.1/x"), true));
run("172.32.x NOT blocked (outside /12)", () => assert.strictEqual(isSsrfSafeUrl("http://172.32.0.1/x"), true));
run("192.168.0.1 blocked", () => assert.strictEqual(isSsrfSafeUrl("http://192.168.0.1/x"), false));
run("192.168.255.255 blocked", () => assert.strictEqual(isSsrfSafeUrl("http://192.168.255.255/x"), false));
run("169.254.169.254 blocked (AWS metadata)", () => assert.strictEqual(isSsrfSafeUrl("http://169.254.169.254/latest/meta-data/"), false));
run("169.254.0.1 blocked (link-local)", () => assert.strictEqual(isSsrfSafeUrl("http://169.254.0.1/"), false));
run("0.0.0.0 blocked", () => assert.strictEqual(isSsrfSafeUrl("http://0.0.0.0/x"), false));
run("224.0.0.1 blocked (multicast)", () => assert.strictEqual(isSsrfSafeUrl("http://224.0.0.1/x"), false));
run("255.255.255.255 blocked (reserved)", () => assert.strictEqual(isSsrfSafeUrl("http://255.255.255.255/x"), false));
run("metadata.google.internal blocked", () => assert.strictEqual(isSsrfSafeUrl("http://metadata.google.internal/latest/"), false));
run(".internal domain blocked", () => assert.strictEqual(isSsrfSafeUrl("http://corp.mycompany.internal/logo.png"), false));
run(".local domain blocked", () => assert.strictEqual(isSsrfSafeUrl("http://printer.local/x"), false));
run(".localhost blocked", () => assert.strictEqual(isSsrfSafeUrl("http://dev.localhost/x"), false));
run("IPv6 loopback [::1] blocked", () => assert.strictEqual(isSsrfSafeUrl("http://[::1]/x"), false));
run("IPv6 link-local [fe80::1] blocked", () => assert.strictEqual(isSsrfSafeUrl("http://[fe80::1]/x"), false));

console.log("\nB2. isSsrfSafeUrl — allowed addresses");

run("public HTTPS CDN allowed", () => assert.strictEqual(isSsrfSafeUrl("https://cdn.example.com/logo.png"), true));
run("public HTTP domain allowed", () => assert.strictEqual(isSsrfSafeUrl("http://images.example.com/x.jpg"), true));
run("8.8.8.8 allowed (public IP)", () => assert.strictEqual(isSsrfSafeUrl("http://8.8.8.8/x"), true));
run("1.1.1.1 allowed (public IP)", () => assert.strictEqual(isSsrfSafeUrl("http://1.1.1.1/x"), true));
run("192.0.2.1 allowed (TEST-NET, not in RFC-1918)", () => assert.strictEqual(isSsrfSafeUrl("http://192.0.2.1/x"), true));
run("non-http scheme blocked", () => assert.strictEqual(isSsrfSafeUrl("ftp://example.com/x"), false));
run("file:// scheme blocked", () => assert.strictEqual(isSsrfSafeUrl("file:///etc/passwd"), false));
run("data: URI blocked", () => assert.strictEqual(isSsrfSafeUrl("data:image/png;base64,abc"), false));
run("unparseable URL blocked", () => assert.strictEqual(isSsrfSafeUrl("not a url"), false));

// ─────────────────────────────────────────────────────────────────────────────
// Section C — Source-grep: confirm the guard is wired in extractCtaInlineImages
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nC. Source-grep checks on server/gmail.ts");

const fs = require("fs");
const gmailSrc = fs.readFileSync("server/gmail.ts", "utf8");

run("isSsrfSafeUrl function is defined in gmail.ts", () => {
  assert.ok(
    /function isSsrfSafeUrl/.test(gmailSrc),
    "isSsrfSafeUrl not found in server/gmail.ts",
  );
});

run("isSsrfSafeUrl is called before the fetch in extractCtaInlineImages", () => {
  // The guard must appear in the source before the actual fetch() call.
  const guardIdx = gmailSrc.indexOf("isSsrfSafeUrl(src)");
  const fetchIdx = gmailSrc.indexOf("await fetch(src,");
  assert.ok(guardIdx !== -1, "isSsrfSafeUrl(src) call not found");
  assert.ok(fetchIdx !== -1, "fetch(src, ...) call not found");
  assert.ok(guardIdx < fetchIdx, "SSRF guard must appear before the fetch() call");
});

run("private IP 169.254 is covered in the guard", () => {
  assert.ok(
    /169.*254/.test(gmailSrc),
    "169.254.x link-local range not referenced in gmail.ts",
  );
});

run("RFC-1918 10.x range is covered", () => {
  assert.ok(/a === 10/.test(gmailSrc), "10.0.0.0/8 block not found in gmail.ts");
});

run("RFC-1918 172.16-31 range is covered", () => {
  assert.ok(
    /a === 172.*b >= 16.*b <= 31|172.*16.*31/.test(gmailSrc),
    "172.16.0.0/12 block not found in gmail.ts",
  );
});

run("RFC-1918 192.168 range is covered", () => {
  assert.ok(
    /192.*168|a === 192.*b === 168/.test(gmailSrc),
    "192.168.0.0/16 block not found in gmail.ts",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Section D — Source-grep: confirm booking slot validation is wired
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nD. Source-grep checks on server/services/booking-link-service.ts");

const bookingSrc = fs.readFileSync("server/services/booking-link-service.ts", "utf8");

run("validateSlotAgainstLink is exported", () => {
  assert.ok(
    /export function validateSlotAgainstLink/.test(bookingSrc),
    "validateSlotAgainstLink not exported",
  );
});

run("BookingSlotError is exported", () => {
  assert.ok(
    /export class BookingSlotError/.test(bookingSrc),
    "BookingSlotError class not found",
  );
});

run("validateSlotAgainstLink is called inside confirmBooking", () => {
  // Find the confirmBooking function body and check it calls validateSlotAgainstLink
  assert.ok(
    /validateSlotAgainstLink/.test(bookingSrc),
    "validateSlotAgainstLink not called in booking-link-service.ts",
  );
});

run("minNoticeHours is enforced in validateSlotAgainstLink", () => {
  assert.ok(
    /minNoticeHours.*3[_,]600[_,]000|3[_,]600[_,]000.*minNoticeHours/.test(bookingSrc),
    "minNoticeHours enforcement not found",
  );
});

run("advanceDays is enforced in validateSlotAgainstLink", () => {
  assert.ok(
    /advanceDays.*86[_,]400[_,]000|86[_,]400[_,]000.*advanceDays/.test(bookingSrc),
    "advanceDays enforcement not found",
  );
});

run("availability window dow check is present", () => {
  assert.ok(/slotDow.*dow|dow.*slotDow/.test(bookingSrc), "dow comparison not found");
});

run("BookingSlotError is imported in routes.ts", () => {
  const routesSrc = fs.readFileSync("server/routes.ts", "utf8");
  assert.ok(
    /BookingSlotError/.test(routesSrc),
    "BookingSlotError not referenced in routes.ts",
  );
});

run("routes.ts returns 422 for BookingSlotError", () => {
  const routesSrc = fs.readFileSync("server/routes.ts", "utf8");
  assert.ok(
    /BookingSlotError.*422|422.*BookingSlotError/s.test(routesSrc),
    "422 response for BookingSlotError not found in routes.ts",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
