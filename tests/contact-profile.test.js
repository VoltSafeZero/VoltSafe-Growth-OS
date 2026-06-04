#!/usr/bin/env node
/**
 * Contact Profile Page — regression tests
 *
 * Covers:
 *  1. /contacts page component exists and links to /contacts/:id
 *  2. ContactEngagementWidget receives `id` (not the undefined `contactId`)
 *  3. All optional fields guarded before access
 *  4. isError / !data / !data.contact guard renders a safe fallback
 *  5. ChunkErrorBoundary resets on navigation (key={appLocation})
 *
 * Source-grep strategy — no server or browser required.
 * Run with: node tests/contact-profile.test.js
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function src(relPath) {
  return readFileSync(resolve(root, relPath), "utf8");
}

function has(text, pattern) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  return re.test(text);
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    passed++;
  } catch (e) {
    console.error(`  \u2717 ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const profile  = src("client/src/pages/contact-profile.tsx");
const contacts = src("client/src/pages/contacts.tsx");
const app      = src("client/src/App.tsx");
const boundary = src("client/src/components/chunk-error-boundary.tsx");

// ── /contacts list page ───────────────────────────────────────────────────────
console.log("\n[Contacts list page]");

test("/contacts route registered in App.tsx", () =>
  assert(has(app, /path="\/contacts"/), "/contacts route missing"));

test("/contacts/:id route registered in App.tsx", () =>
  assert(has(app, /path="\/contacts\/:id"/), "/contacts/:id route missing"));

test("ContactProfilePage lazy-imported in App.tsx", () =>
  assert(has(app, /ContactProfilePage.*contact-profile/), "ContactProfilePage lazy import missing"));

test("contacts list links to /contacts/:id", () =>
  assert(has(contacts, /\/contacts\/\$\{|\/contacts\/\${/), "no /contacts/${id} link in contacts list"));

// ── ContactProfilePage — null-safety ─────────────────────────────────────────
console.log("\n[ContactProfilePage null-safety]");

test("isLoading guard renders skeleton before data arrives", () =>
  assert(has(profile, /isLoading.*return|if.*isLoading/), "isLoading early-return guard missing"));

test("isError guard renders fallback when API fails", () =>
  assert(has(profile, /isError.*data\.contact|isError.*!data/), "isError guard missing"));

test("!data guard in error fallback", () =>
  assert(has(profile, /!data/), "!data null-check missing"));

test("!data.contact guard in error fallback", () =>
  assert(has(profile, /!data\.contact/), "!data.contact null-check missing"));

test("optional contact.email guarded before use", () =>
  assert(has(profile, /contact\.email &&|contact\.email\?/), "contact.email not guarded"));

test("optional contact.phone guarded before use", () =>
  assert(has(profile, /contact\.phone &&|contact\.phone\?/), "contact.phone not guarded"));

test("optional contact.title guarded before use", () =>
  assert(has(profile, /contact\.title &&|contact\.title\?/), "contact.title not guarded"));

test("optional contact.account_name guarded before use", () =>
  assert(has(profile, /contact\.account_name &&/), "contact.account_name not guarded"));

test("contact.name falls back safely for initials", () =>
  assert(has(profile, /contact\.name \|\| "?"/), "initials fallback missing"));

// ── ContactEngagementWidget wired to correct variable ────────────────────────
console.log("\n[ContactEngagementWidget variable]");

test("ContactEngagementWidget receives `id`, not undefined `contactId`", () => {
  const widget = profile.match(/ContactEngagementWidget[^/\n]+contactId=\{([^}]+)\}/);
  assert(widget, "ContactEngagementWidget not found");
  assert(widget[1].trim() === "id", `Expected contactId={id} but got contactId={${widget[1].trim()}}`);
});

test("no bare `contactId` variable reference in ContactProfilePage body", () => {
  // Only scan the main export function, NOT the helper TimelineSection at the bottom
  const start = profile.indexOf("export default function ContactProfilePage");
  const end = profile.indexOf("\nfunction TimelineSection");
  const pageBody = profile.slice(start, end > start ? end : undefined);
  const bareRefs = [...pageBody.matchAll(/\bcontactId\b/g)].map(m => ({
    idx: m.index,
    ctx: pageBody.slice(Math.max(0, m.index - 30), m.index + 40),
  }));
  const illegalRefs = bareRefs.filter(r =>
    !r.ctx.includes("contactId:") &&
    !r.ctx.includes("contactId }") &&
    !r.ctx.includes("{ contactId") &&
    !r.ctx.includes("contactId={id}")
  );
  assert(illegalRefs.length === 0,
    `Found ${illegalRefs.length} bare 'contactId' reference(s) in ContactProfilePage — should be 'id':\n` +
    illegalRefs.map(r => `    …${r.ctx.trim()}…`).join("\n")
  );
});

// ── Error boundary reset on navigation ───────────────────────────────────────
console.log("\n[Error boundary — navigation reset]");

test("ChunkErrorBoundary used in App.tsx", () =>
  assert(has(app, /ChunkErrorBoundary/), "ChunkErrorBoundary not imported/used in App.tsx"));

test("ChunkErrorBoundary key resets on location change", () =>
  assert(has(app, /ChunkErrorBoundary\s+key=\{appLocation\}/), "ChunkErrorBoundary missing key={appLocation}"));

test("appLocation tracked in AuthenticatedRouter", () =>
  assert(has(app, /appLocation.*useLocation|useLocation.*appLocation/), "appLocation not tracked"));

test("error boundary renders fallback UI for non-chunk errors", () =>
  assert(has(boundary, /Something went wrong/), "error fallback UI missing"));

test("error boundary renders chunk-update fallback separately", () =>
  assert(has(boundary, /App updated|Hard refresh/), "chunk-update fallback missing"));

// ── Not-found / invalid id state ─────────────────────────────────────────────
console.log("\n[Not-found / invalid id state]");

test("profile API throws on non-ok response (invalid id → not-found)", () =>
  assert(has(profile, /throw new Error\("Not found"\)|!r\.ok.*throw/), "no throw on non-ok response"));

test("not-found renders Back to contacts button", () =>
  assert(has(profile, /Back to contacts/), "Back to contacts button missing in error state"));

test("not-found renders Retry button", () =>
  assert(has(profile, /Retry/), "Retry button missing in error state"));

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n───────────────────────────────────────────────────────");
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log("───────────────────────────────────────────────────────");
if (failed > 0) process.exit(1);
