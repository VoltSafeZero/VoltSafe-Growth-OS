/**
 * Source-grep tests for timezone detection system.
 * Verifies routes, session augmentation, frontend integration, and
 * admin debug section are all correctly wired together.
 */

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function readFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

// ─── seed-production.ts ────────────────────────────────────────────────────────
console.log("\n[1] DB migration in seed-production.ts");
const seed = readFile("server/seed-production.ts");
assert(seed.includes("migrateTimezoneColumns"), "exports migrateTimezoneColumns function");
assert(seed.includes("last_detected_timezone"), "adds last_detected_timezone column");
assert(seed.includes("last_detected_timezone_at"), "adds last_detected_timezone_at column");
assert(seed.includes("last_detected_timezone_offset_minutes"), "adds last_detected_timezone_offset_minutes column");
assert(seed.includes("ADD COLUMN IF NOT EXISTS"), "uses IF NOT EXISTS (idempotent)");

// ─── server/index.ts ──────────────────────────────────────────────────────────
console.log("\n[2] Migration wired into startup in server/index.ts");
const idx = readFile("server/index.ts");
assert(idx.includes("migrateTimezoneColumns"), "imports migrateTimezoneColumns");
assert(idx.match(/await migrateTimezoneColumns\(\)/), "awaits migrateTimezoneColumns()");

// ─── server/auth.ts ───────────────────────────────────────────────────────────
console.log("\n[3] Session type augmented in server/auth.ts");
const authTs = readFile("server/auth.ts");
assert(authTs.includes("detectedTimezone"), "SessionData has detectedTimezone field");
assert(authTs.includes("detectedTimezone?: string"), "detectedTimezone is optional string");

// ─── server/routes.ts ─────────────────────────────────────────────────────────
console.log("\n[4] Backend routes in server/routes.ts");
const routes = readFile("server/routes.ts");

assert(routes.includes("POST /api/session/timezone"), "has POST /api/session/timezone comment");
assert(routes.includes("/api/session/timezone"), "registers /api/session/timezone route");
assert(routes.includes("Intl.DateTimeFormat(undefined, { timeZone: timezone })"), "validates IANA timezone via Intl");
assert(routes.includes("Invalid IANA timezone"), "returns 400 for invalid timezone");
assert(routes.includes("last_detected_timezone = "), "writes timezone to DB");
assert(routes.includes("last_detected_timezone_at = NOW()"), "writes last_detected_timezone_at");
assert(routes.includes("last_detected_timezone_offset_minutes = "), "writes offset to DB");
assert(routes.includes("detectedTimezone: (req.session as any).detectedTimezone"), "/api/auth/me returns detectedTimezone from session");
assert(routes.includes("(req.session as any).detectedTimezone = timezone"), "stores timezone in session");
assert(routes.includes("ok: true, timezone, offsetMinutes, detectedAt"), "timezone response includes expected fields");
assert(routes.includes(".catch((err: unknown) =>"), "DB write is fire-and-forget (non-blocking)");

// ─── client/src/lib/timezone.ts ───────────────────────────────────────────────
console.log("\n[5] Frontend timezone utility in client/src/lib/timezone.ts");
const tzLib = readFile("client/src/lib/timezone.ts");
assert(tzLib.includes("detectBrowserTimezone"), "exports detectBrowserTimezone function");
assert(tzLib.includes("getDateGroupLabelInTz"), "exports getDateGroupLabelInTz function");
assert(tzLib.includes("useTimezone"), "exports useTimezone hook");
assert(tzLib.includes("TimezoneContext"), "exports TimezoneContext");
assert(tzLib.includes("TimezoneContextValue"), "exports TimezoneContextValue type");
assert(tzLib.includes("Intl.DateTimeFormat().resolvedOptions().timeZone"), "uses Intl API for detection (no external dep)");
assert(tzLib.includes("createContext"), "uses React createContext");
assert(tzLib.includes("useContext"), "uses useContext");
assert(tzLib.includes('"Today"'), 'getDateGroupLabelInTz returns "Today"');
assert(tzLib.includes('"Yesterday"'), 'getDateGroupLabelInTz returns "Yesterday"');
assert(tzLib.includes('"This Week"'), 'getDateGroupLabelInTz returns "This Week"');
assert(tzLib.includes("formatDateInTz"), "exports formatDateInTz helper");
assert(tzLib.includes("getDayBucket"), "exports getDayBucket for AI context");
assert(tzLib.includes("86_400_000"), "uses ms constant for day arithmetic");

// ─── client/src/App.tsx ───────────────────────────────────────────────────────
console.log("\n[6] App.tsx integration");
const app = readFile("client/src/App.tsx");
assert(app.includes("TimezoneContext"), "imports TimezoneContext");
assert(app.includes("detectBrowserTimezone"), "imports detectBrowserTimezone");
assert(app.includes("TimezoneContextValue"), "imports TimezoneContextValue");
assert(app.includes("detectedTimezone?: string | null"), "AuthUser type has detectedTimezone");
assert(app.includes("TimezoneContext.Provider"), "wraps app with TimezoneContext.Provider");
assert(app.includes("/api/session/timezone"), "posts to /api/session/timezone after auth");
assert(app.includes("method: \"POST\""), "uses POST method for timezone endpoint");
assert(app.includes("user?.id"), "timezone effect re-runs on user.id change (not every render)");
assert(app.includes("cancelled = true"), "timezone effect has cleanup / cancellation guard");
assert(app.includes("setUser(u => u ? { ...u, detectedTimezone: data.timezone } : u)"), "updates user state with confirmed timezone");

// ─── client/src/pages/meeting-notes-index.tsx ─────────────────────────────────
console.log("\n[7] Meeting notes date grouping uses detected timezone");
const mtg = readFile("client/src/pages/meeting-notes-index.tsx");
assert(mtg.includes("useTimezone"), "imports useTimezone hook");
assert(mtg.includes("getDateGroupLabelInTz"), "imports getDateGroupLabelInTz");
assert(mtg.includes("const { timezone } = useTimezone()"), "destructures timezone from context");
assert(mtg.includes("groupNotes(visible, timezone)"), "passes detected timezone to groupNotes");
assert(mtg.includes("groupNotes(notes: MeetingNoteSummary[], timezone: string)"), "groupNotes accepts timezone parameter");
assert(!mtg.includes("getDateGroupLabel(date)"), "no longer uses un-timezone-aware getDateGroupLabel");

// ─── client/src/pages/settings.tsx ────────────────────────────────────────────
console.log("\n[8] Admin timezone debug section in settings.tsx");
const settings = readFile("client/src/pages/settings.tsx");
assert(settings.includes("useTimezone"), "imports useTimezone");
assert(settings.includes("TimezoneDebugSection"), "has TimezoneDebugSection component");
assert(settings.includes("timezone-debug-section"), "has data-testid for timezone debug section");
assert(settings.includes("tz-detected-value"), "has data-testid for detected timezone value");
assert(settings.includes("tz-offset-value"), "has data-testid for offset value");
assert(settings.includes("tz-detected-at"), "has data-testid for detected-at time");
assert(settings.includes("master_admin"), "guards section behind master_admin check");
assert(settings.includes("<TimezoneDebugSection />"), "renders TimezoneDebugSection in JSX");
assert(settings.includes("Globe"), "uses Globe icon");

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
