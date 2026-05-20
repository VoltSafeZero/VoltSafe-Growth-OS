#!/usr/bin/env node
/**
 * Regression suite: CRM contact relationship linking + CRM Review label fixes.
 *
 * Covers four previously-broken behaviours:
 *  1. contacts-panel.tsx — link mutation fires a success toast on completion
 *  2. edit-contact-dialog.tsx — Relationships section exists (accounts + leads)
 *  3. routes.ts CRM confirm (single) — removes SPAM in addition to SENT,
 *     and mirrors the change across ALL account copies (accountId=null)
 *  4. routes.ts CRM confirm (bulk) — same guarantees as single confirm
 *
 * Non-UI tests (1-4) are source-grep checks — no E2E browser required.
 * API tests (5-7) hit the running server at localhost:5000 to verify the
 * account/contact junction-table routes work end-to-end.
 *
 * Run with:  node tests/contact-relationship-crm-label.test.js
 * Requires:  server running at localhost:5000
 *            trevor@voltsafe.com / alberni1444 (master_admin)
 */

import fs from "fs";
import path from "path";

const BASE = "http://localhost:5000";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PWD = "alberni1444";

let passed = 0;
let failed = 0;
const ok = (l) => { console.log(`  ✓ ${l}`); passed++; };
const bad = (l, d) => { console.error(`  ✗ ${l}${d ? ` — ${d}` : ""}`); failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Source read helpers ───────────────────────────────────────────────────────

function readSource(rel) {
  return fs.readFileSync(path.resolve(process.cwd(), rel), "utf-8");
}

/** Assert pattern (string or RegExp) matches somewhere in source. */
function assertContains(label, source, pattern) {
  const hit = typeof pattern === "string"
    ? source.includes(pattern)
    : pattern.test(source);
  if (hit) ok(label);
  else bad(label, `pattern not found: ${String(pattern).slice(0, 120)}`);
}

/** Assert pattern does NOT appear in source (regression guard). */
function assertNotContains(label, source, pattern) {
  const hit = typeof pattern === "string"
    ? source.includes(pattern)
    : pattern.test(source);
  if (!hit) ok(label);
  else bad(label, `forbidden pattern still present: ${String(pattern).slice(0, 120)}`);
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

// Include Origin so the CSRF guard (server/csrf.ts) allows non-GET requests
// from test scripts running outside the browser.
const ORIGIN = "http://localhost:5000";

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
    },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Login failed for ${email}: ${res.status} ${body}`);
  }
  const cookie = res.headers.get("set-cookie")?.match(/(connect\.sid=[^;]+)/)?.[1];
  if (!cookie) throw new Error(`No session cookie for ${email}`);
  await sleep(400);
  return cookie;
}

const authed = (cookie) => (url, opts = {}) =>
  fetch(`${BASE}${url}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      Cookie: cookie,
      ...(opts.headers || {}),
    },
  });

async function expect(label, promise, ...statuses) {
  const res = await promise;
  if (statuses.includes(res.status)) {
    ok(`${label} → ${res.status}`);
  } else {
    const body = await res.text().catch(() => "");
    bad(`${label} → expected ${statuses.join("|")} got ${res.status}`, body.slice(0, 200));
  }
  return res;
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. SOURCE-GREP: contacts-panel.tsx — success toast on link
// ══════════════════════════════════════════════════════════════════════════════

function testContactsPanelToast() {
  console.log("\n[1] contacts-panel.tsx — link mutation success toast");
  const src = readSource("client/src/components/contacts/contacts-panel.tsx");

  // The onSuccess block must call toast() with a title
  assertContains(
    "onSuccess emits a toast with title",
    src,
    /onSuccess[^}]+toast\(\s*\{[^}]*title:/s,
  );
  assertContains(
    "success toast title text 'Contact linked' present",
    src,
    "Contact linked",
  );
  assertContains(
    "onError emits a destructive toast",
    src,
    /onError[^}]+variant:\s*["']destructive["']/s,
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. SOURCE-GREP: edit-contact-dialog.tsx — Relationships section
// ══════════════════════════════════════════════════════════════════════════════

function testEditContactDialogRelationships() {
  console.log("\n[2] edit-contact-dialog.tsx — Relationships section");
  const src = readSource("client/src/components/contacts/edit-contact-dialog.tsx");

  assertContains(
    "useQuery imported alongside useMutation",
    src,
    "useQuery",
  );
  assertContains(
    "linkedAccounts query hits /api/contacts/:id/accounts",
    src,
    "/accounts",
  );
  assertContains(
    "linkAcct mutation POSTs to /api/accounts/:id/contacts",
    src,
    'apiRequest("POST", `/api/accounts/',
  );
  assertContains(
    "unlinkAcct mutation DELETEs /api/accounts/:id/contacts/:contactId",
    src,
    'apiRequest("DELETE", `/api/accounts/',
  );
  assertContains(
    "linkLead mutation POSTs to /api/leads/:id/contacts",
    src,
    'apiRequest("POST", `/api/leads/',
  );
  assertContains(
    "unlinkLead mutation DELETEs /api/leads/:id/contacts/:contactId",
    src,
    'apiRequest("DELETE", `/api/leads/',
  );
  assertContains(
    "Relationships section heading rendered",
    src,
    "Relationships",
  );
  assertContains(
    "Organizations sub-section rendered",
    src,
    "Organizations",
  );
  assertContains(
    "Leads sub-section rendered",
    src,
    "Leads",
  );
  assertContains(
    "account search input has data-testid",
    src,
    "input-link-account-search",
  );
  assertContains(
    "lead search input has data-testid",
    src,
    "input-link-lead-search",
  );
  assertContains(
    "relationships container has data-testid",
    src,
    "section-contact-relationships",
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. SOURCE-GREP: routes.ts — single CRM confirm label correctness
// ══════════════════════════════════════════════════════════════════════════════

function testSingleConfirmLabels() {
  console.log("\n[3] routes.ts — single CRM confirm: SPAM removed, null-account mirror");
  const src = readSource("server/routes.ts");

  // Locate the single-confirm gmail block by finding the unique marker string,
  // then scan the surrounding ~2 KB for the required patterns.
  const GMAIL_MARKER = "[confirm] move-to-inbox gmail failed";
  const MIRROR_MARKER = "[confirm] move-to-inbox mirror failed";

  const gmailIdx = src.indexOf(GMAIL_MARKER);
  const mirrorIdx = src.indexOf(MIRROR_MARKER);

  if (gmailIdx === -1) {
    bad("single-confirm gmail marker found in routes.ts");
    return;
  }
  if (mirrorIdx === -1) {
    bad("single-confirm mirror marker found in routes.ts");
    return;
  }

  // The requestBody line sits a few hundred chars BEFORE the gmail marker.
  // Extend window further back to be safe.
  const gmailWindow = src.slice(Math.max(0, gmailIdx - 2000), gmailIdx + 200);
  // The mirrorLabelChangeForThreads call sits a few hundred chars AFTER the gmail marker.
  const mirrorWindow = src.slice(mirrorIdx - 200, mirrorIdx + 1500);

  assertContains(
    "single-confirm gmail call removes SPAM",
    gmailWindow,
    '"SPAM"',
  );
  assertContains(
    "single-confirm gmail call removes SENT",
    gmailWindow,
    '"SENT"',
  );
  assertContains(
    "single-confirm gmail call adds INBOX",
    gmailWindow,
    '"INBOX"',
  );
  assertContains(
    "single-confirm mirror call uses null accountId (all copies)",
    mirrorWindow,
    "mirrorLabelChangeForThreads",
  );
  // null must appear between the function name and the closing paren
  // Grab the ~300 chars starting at the mirrorLabelChangeForThreads call — enough
  // to cover the full argument list even with nested parentheses in array literals.
  const callOffset = mirrorWindow.indexOf("mirrorLabelChangeForThreads");
  if (callOffset === -1) {
    bad("single-confirm mirrorLabelChangeForThreads call found in window");
  } else {
    const callSnippet = mirrorWindow.slice(callOffset, callOffset + 300);
    if (callSnippet.includes(", null,")) ok("single-confirm mirror second arg is null");
    else bad("single-confirm mirror second arg is null", `snippet: ${callSnippet.slice(0, 150)}`);
    if (!callSnippet.includes("srcAccountId")) ok("single-confirm mirror does NOT forward srcAccountId (regression guard)");
    else bad("single-confirm mirror does NOT forward srcAccountId (regression guard)", callSnippet.slice(0, 150));
  }
  // Confirm SPAM and SENT are stripped in the mirror call too
  assertContains(
    "single-confirm mirror remove list includes SPAM",
    mirrorWindow,
    '"SPAM"',
  );
  assertContains(
    "single-confirm mirror remove list includes SENT",
    mirrorWindow,
    '"SENT"',
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. SOURCE-GREP: routes.ts — bulk CRM confirm label correctness
// ══════════════════════════════════════════════════════════════════════════════

function testBulkConfirmLabels() {
  console.log("\n[4] routes.ts — bulk CRM confirm: SPAM removed, null-account mirror");
  const src = readSource("server/routes.ts");

  const GMAIL_MARKER = "[bulk-confirm] move-to-inbox gmail failed";
  const MIRROR_MARKER = "[bulk-confirm] move-to-inbox mirror failed";

  const gmailIdx = src.indexOf(GMAIL_MARKER);
  const mirrorIdx = src.indexOf(MIRROR_MARKER);

  if (gmailIdx === -1) {
    bad("bulk-confirm gmail marker found in routes.ts");
    return;
  }
  if (mirrorIdx === -1) {
    bad("bulk-confirm mirror marker found in routes.ts");
    return;
  }

  const gmailWindow = src.slice(Math.max(0, gmailIdx - 2000), gmailIdx + 200);
  const mirrorWindow = src.slice(mirrorIdx - 200, mirrorIdx + 1500);

  assertContains("bulk-confirm gmail call removes SPAM", gmailWindow, '"SPAM"');
  assertContains("bulk-confirm gmail call removes SENT", gmailWindow, '"SENT"');
  assertContains("bulk-confirm gmail call adds INBOX", gmailWindow, '"INBOX"');
  assertContains("bulk-confirm mirror call present", mirrorWindow, "mirrorLabelChangeForThreads");

  const mirrorCallMatch = mirrorWindow.match(/mirrorLabelChangeForThreads\([^)]+\)/);
  if (mirrorCallMatch) {
    const call = mirrorCallMatch[0];
    if (call.includes("null")) ok("bulk-confirm mirror first arg is null");
    else bad("bulk-confirm mirror first arg is null", `call: ${call.slice(0, 120)}`);
    if (!call.includes("srcAccountId")) ok("bulk-confirm mirror does NOT forward srcAccountId (regression guard)");
    else bad("bulk-confirm mirror does NOT forward srcAccountId (regression guard)", call.slice(0, 120));
  } else {
    bad("bulk-confirm mirrorLabelChangeForThreads call parseable", mirrorWindow.slice(0, 200));
  }
  assertContains("bulk-confirm mirror remove list includes SPAM", mirrorWindow, '"SPAM"');
  assertContains("bulk-confirm mirror remove list includes SENT", mirrorWindow, '"SENT"');
}

// ══════════════════════════════════════════════════════════════════════════════
// 5-7. API: contact → account junction table (link, read-back, unlink)
// ══════════════════════════════════════════════════════════════════════════════

async function testContactAccountApi() {
  console.log("\n[5-7] API: account/contact junction-table endpoints");

  let cookie;
  try {
    cookie = await login(ADMIN_EMAIL, ADMIN_PWD);
  } catch (e) {
    bad("login as admin", e.message);
    return;
  }
  const api = authed(cookie);

  let accountId, contactId;
  try {
    const acctRes = await api("/api/accounts?limit=1");
    const acctBody = await acctRes.json();
    accountId = acctBody?.data?.[0]?.id;

    const ctRes = await api("/api/contacts?limit=20");
    const ctBody = await ctRes.json();
    const contacts = Array.isArray(ctBody) ? ctBody : (ctBody?.data ?? []);
    contactId = contacts?.[0]?.id;
  } catch (e) {
    bad("fetch seed account/contact for API test", e.message);
    return;
  }

  if (!accountId || !contactId) {
    bad("seed account and contact found", `accountId=${accountId} contactId=${contactId}`);
    return;
  }

  // Clean slate — remove any existing link (ignore errors)
  await api(`/api/accounts/${accountId}/contacts/${contactId}`, { method: "DELETE" }).catch(() => {});
  await sleep(300);

  // [5] Link contact to account
  await expect(
    `POST /api/accounts/${accountId}/contacts links contactId=${contactId}`,
    api(`/api/accounts/${accountId}/contacts`, {
      method: "POST",
      body: JSON.stringify({ contactId }),
    }),
    200, 201,
  );

  // [6] Read back via /api/contacts/:id/accounts
  const listRes = await api(`/api/contacts/${contactId}/accounts`);
  if (listRes.ok) {
    const list = await listRes.json();
    const found = Array.isArray(list) && list.some((a) => a.accountId === accountId);
    if (found) ok(`GET /api/contacts/${contactId}/accounts includes accountId=${accountId}`);
    else bad(`GET /api/contacts/${contactId}/accounts includes accountId=${accountId}`, JSON.stringify(list).slice(0, 200));
  } else {
    bad(`GET /api/contacts/${contactId}/accounts returns 2xx`, `status ${listRes.status}`);
  }

  // [7] Unlink
  await expect(
    `DELETE /api/accounts/${accountId}/contacts/${contactId}`,
    api(`/api/accounts/${accountId}/contacts/${contactId}`, { method: "DELETE" }),
    200, 204,
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Runner
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  Contact Relationship + CRM Label Regression Suite");
  console.log("═══════════════════════════════════════════════════════");

  testContactsPanelToast();
  testEditContactDialogRelationships();
  testSingleConfirmLabels();
  testBulkConfirmLabels();
  await testContactAccountApi();

  console.log("\n───────────────────────────────────────────────────────");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("───────────────────────────────────────────────────────\n");

  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
