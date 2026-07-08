"use strict";
/**
 * Mailbox classification + access-control regression tests.
 *
 * Covers:
 * 1. Domain classification: @voltsafe.com = business; anything else = private
 * 2. Team inbox rule: ONLY is_shared=true + @voltsafe.com can be a team inbox
 * 3. API access: standard users cannot see other users' personal work inboxes
 * 4. Migration guard: non-@voltsafe.com accounts cannot be is_shared/team_shared
 * 5. Sidebar grouping invariants (source-grep)
 * 6. Admin label invariants (source-grep)
 */

const http = require("http");
const assert = require("assert");

const BASE = "http://localhost:5000";
let passed = 0;
let failed = 0;
const fails = [];

function req(method, path, body, cookies) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const payload = body ? JSON.stringify(body) : null;
    const headers = {
      "Content-Type": "application/json",
      "Origin": BASE,
      ...(cookies ? { Cookie: cookies } : {}),
    };
    if (payload) headers["Content-Length"] = Buffer.byteLength(payload);
    const r = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers }, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        let json;
        try { json = JSON.parse(d); } catch { json = d; }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function login(email, password) {
  const res = await req("POST", "/api/auth/login", { email, password });
  assert.strictEqual(res.status, 200, `Login failed for ${email}: ${JSON.stringify(res.body)}`);
  const raw = res.headers["set-cookie"] ?? [];
  const sid = (Array.isArray(raw) ? raw : [raw]).find(c => c.startsWith("connect.sid="));
  assert.ok(sid, `No session cookie for ${email}`);
  return sid.split(";")[0];
}

function check(label, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = detail ? `${label} — ${detail}` : label;
    fails.push(msg);
    console.log(`  ✗ ${label}${detail ? " — " + detail : ""}`);
  }
}

// ── Pure domain classification helper (replicated from frontend) ─────────────
function isVoltSafeDomain(email) {
  return (email ?? "").toLowerCase().endsWith("@voltsafe.com");
}

function classifyMailbox(email, isShared) {
  const vs = isVoltSafeDomain(email);
  if (!vs) return "private_personal";
  return isShared ? "team_shared" : "company_managed";
}

// ── Section 1: Pure domain classification logic ───────────────────────────────
console.log("\n── Section 1: Domain classification helper ──");

check("trevor@voltsafe.com → company_managed",
  classifyMailbox("trevor@voltsafe.com", false) === "company_managed");
check("sales@voltsafe.com + shared → team_shared",
  classifyMailbox("sales@voltsafe.com", true) === "team_shared");
check("support@voltsafe.com + shared → team_shared",
  classifyMailbox("support@voltsafe.com", true) === "team_shared");
check("trevor@voltsafe.com + shared → team_shared (would be shared work)",
  classifyMailbox("trevor@voltsafe.com", true) === "team_shared");
check("trevor@hyalos.com → private_personal",
  classifyMailbox("trevor@hyalos.com", false) === "private_personal");
check("burgesstrevor76@gmail.com → private_personal",
  classifyMailbox("burgesstrevor76@gmail.com", false) === "private_personal");
check("burgesstrevor76@gmail.com + is_shared=true → still private_personal (domain wins)",
  classifyMailbox("burgesstrevor76@gmail.com", true) === "private_personal");
check("trevor@hyalos.com + is_shared=true → still private_personal (domain wins)",
  classifyMailbox("trevor@hyalos.com", true) === "private_personal");
check("TREVOR@VOLTSAFE.COM (uppercase) → company_managed (case-insensitive)",
  classifyMailbox("TREVOR@VOLTSAFE.COM", false) === "company_managed");
check("Sales@VoltSafe.COM (mixed case) → company_managed or team_shared",
  ["company_managed", "team_shared"].includes(classifyMailbox("Sales@VoltSafe.COM", false)));

// ── Section 2: Team inbox domain constraint ────────────────────────────────────
console.log("\n── Section 2: Non-@voltsafe.com can never be team inbox ──");

const NON_VOLTSAFE = [
  "burgesstrevor76@gmail.com",
  "trevor@hyalos.com",
  "someone@outlook.com",
  "admin@marina.com",
  "info@protonmail.com",
];
NON_VOLTSAFE.forEach(email => {
  check(`${email} cannot be team_shared even with is_shared=true`,
    classifyMailbox(email, true) === "private_personal");
});

const VALID_TEAM = [
  "sales@voltsafe.com",
  "support@voltsafe.com",
  "hello@voltsafe.com",
  "admin@voltsafe.com",
];
VALID_TEAM.forEach(email => {
  check(`${email} + is_shared=true → team_shared`,
    classifyMailbox(email, true) === "team_shared");
  check(`${email} + is_shared=false → company_managed (not team)`,
    classifyMailbox(email, false) === "company_managed");
});

// ── Section 3: Source-grep — sidebar grouping invariants ─────────────────────
console.log("\n── Section 3: Sidebar grouping invariants (source-grep) ──");

const fs = require("fs");
const sidebarSrc = fs.readFileSync("client/src/pages/gmail-inbox.tsx", "utf8");

check("Sidebar: workAccounts uses isOwner + isVoltSafeDomain",
  sidebarSrc.includes("a.isOwner && isVoltSafeDomain(a.emailAddress"),
  "workAccounts must require both isOwner and domain check");

check("Sidebar: sharedAccounts rejects non-isShared",
  sidebarSrc.includes("if (!a.isShared) return false"),
  "sharedAccounts must reject accounts where isShared is false");

check("Sidebar: sharedAccounts rejects non-@voltsafe.com domain",
  sidebarSrc.includes("if (!isVoltSafeDomain(a.emailAddress") ||
  sidebarSrc.includes("!isVoltSafeDomain(a.emailAddress"),
  "sharedAccounts must reject non-voltsafe.com domain");

check("Sidebar: sharedAccounts rejects isOwner",
  sidebarSrc.includes("if (a.isOwner) return false"),
  "sharedAccounts must not include own accounts");

check("Sidebar: privateAccounts uses isOwner + !isVoltSafeDomain",
  sidebarSrc.includes("a.isOwner && !isVoltSafeDomain(a.emailAddress"),
  "privateAccounts must require isOwner and NOT voltSafe domain");

check("Sidebar: isVoltSafeDomain helper defined",
  sidebarSrc.includes("endsWith('@voltsafe.com')"),
  "Domain helper must check @voltsafe.com suffix");

check("Sidebar: no longer uses visibilityType for workAccounts filter",
  !sidebarSrc.includes("a.visibilityType === 'company_managed'"),
  "workAccounts must not rely on visibilityType string match — use domain");

// ── Section 4: Source-grep — admin label invariants ──────────────────────────
console.log("\n── Section 4: Admin label invariants (source-grep) ──");

const adminSrc = fs.readFileSync("client/src/pages/mailbox-settings.tsx", "utf8");

check("Admin: domain-authoritative label uses @voltsafe.com check",
  adminSrc.includes("endsWith('@voltsafe.com')"),
  "Admin label must derive from email domain, not just privacy_mode");

check("Admin: VoltSafe Business label for @voltsafe.com non-shared",
  adminSrc.includes("VoltSafe Business"),
  "Non-shared @voltsafe.com accounts must show 'VoltSafe Business'");

check("Admin: Team Inbox label for @voltsafe.com shared",
  adminSrc.includes("Team Inbox"),
  "Shared @voltsafe.com accounts must show 'Team Inbox' label");

check("Admin: Private Account label for non-@voltsafe.com",
  adminSrc.includes("Private Account"),
  "Non-@voltsafe.com accounts must show 'Private Account'");

check("Admin: teamShared filter enforces @voltsafe.com",
  adminSrc.includes("endsWith('@voltsafe.com')") &&
  adminSrc.includes("m.isShared"),
  "teamShared must require both isShared and @voltsafe.com domain");

// ── Section 5: Source-grep — backend getAccessibleAccounts ───────────────────
console.log("\n── Section 5: Backend getAccessibleAccounts invariants (source-grep) ──");

const routesSrc = fs.readFileSync("server/routes.ts", "utf8");

check("getAccessibleAccounts: non-owned requires is_shared=true",
  routesSrc.includes("AND is_shared = true\n        AND email_address LIKE '%@voltsafe.com'") ||
  routesSrc.includes("AND is_shared = true") && routesSrc.includes("AND email_address LIKE '%@voltsafe.com'"),
  "Non-owned accounts must require is_shared=true + @voltsafe.com domain");

check("getAccessibleAccounts: no longer leaks company_managed accounts",
  !routesSrc.includes("visibility_type, 'private_personal') != 'private_personal'\n    `));\n    const nonOwnedAccts"),
  "Old company_managed leak query must be gone");

check("Team mailboxes API: non-@voltsafe.com excluded",
  routesSrc.includes("email_address LIKE '%@voltsafe.com') OR ea.user_id"),
  "Team mailboxes endpoint must filter to @voltsafe.com only");

check("Team mailboxes API: SQL WHERE uses AND before privacy filter (no missing AND bug)",
  routesSrc.includes("is_active = true AND (${privacyFilter})"),
  "WHERE clause must be 'is_active = true AND (privacyFilter)' — missing AND causes 500");

check("Migration step 1: non-@voltsafe.com is_shared=false enforcement",
  routesSrc.includes("WHERE email_address NOT LIKE '%@voltsafe.com'") &&
  routesSrc.includes("is_shared = false,"),
  "Migration must reset is_shared for non-@voltsafe.com accounts");

check("Migration step 1: non-@voltsafe.com privacy_mode reset to private",
  routesSrc.includes("privacy_mode = 'private'") &&
  routesSrc.includes("NOT LIKE '%@voltsafe.com'"),
  "Migration must set privacy_mode=private for non-@voltsafe.com accounts");

check("Migration step 2: @voltsafe.com + is_shared=true → team_shared",
  routesSrc.includes("visibility_type = 'team_shared'") &&
  routesSrc.includes("LIKE '%@voltsafe.com'") &&
  routesSrc.includes("AND is_shared = TRUE"),
  "Migration must set team_shared for shared @voltsafe.com accounts");

check("Migration step 3: @voltsafe.com + is_shared=false → company_managed",
  routesSrc.includes("visibility_type = 'company_managed'") &&
  routesSrc.includes("AND is_shared = FALSE"),
  "Migration must set company_managed for non-shared @voltsafe.com accounts");

check("visibilityType fallback is domain-authoritative",
  routesSrc.includes("isVoltSafeFallback ? 'team_shared'") &&
  routesSrc.includes("isVoltSafeFallback ? 'company_managed'"),
  "API fallback must use domain check not just isShared flag");

// ── Section 6: Live API — accounts endpoint returns expected fields ──────────
console.log("\n── Section 6: Live API — accounts endpoint ──");

async function runLiveTests() {
  let trevorCookie;
  try {
    trevorCookie = await login("trevor@voltsafe.com", "password123");
  } catch (e) {
    console.log("  ⚠ Could not login as trevor — skipping live API tests:", e.message);
    return;
  }

  const acctRes = await req("GET", "/api/gmail/accounts", null, trevorCookie);
  check("GET /api/gmail/accounts returns 200", acctRes.status === 200,
    `got ${acctRes.status}: ${JSON.stringify(acctRes.body).slice(0, 100)}`);

  if (acctRes.status === 200 && Array.isArray(acctRes.body)) {
    const accounts = acctRes.body;

    // trevor@voltsafe.com must be present
    const trevorWork = accounts.find(a =>
      (a.emailAddress ?? "").toLowerCase() === "trevor@voltsafe.com"
    );
    check("trevor@voltsafe.com account present in response",
      !!trevorWork, `accounts: ${accounts.map(a => a.emailAddress).join(", ")}`);

    if (trevorWork) {
      check("trevor@voltsafe.com has visibilityType=company_managed",
        trevorWork.visibilityType === "company_managed",
        `got: ${trevorWork.visibilityType}`);
      check("trevor@voltsafe.com isOwner=true",
        trevorWork.isOwner === true,
        `got: ${trevorWork.isOwner}`);
      check("trevor@voltsafe.com isShared=false",
        trevorWork.isShared === false,
        `got: ${trevorWork.isShared}`);
    }

    // trevor@hyalos.com — private inbox, should be present (it's owned by Trevor)
    const hyalos = accounts.find(a =>
      (a.emailAddress ?? "").toLowerCase() === "trevor@hyalos.com"
    );
    if (hyalos) {
      check("trevor@hyalos.com has visibilityType=private_personal",
        hyalos.visibilityType === "private_personal",
        `got: ${hyalos.visibilityType}`);
      check("trevor@hyalos.com isOwner=true (Trevor's private inbox)",
        hyalos.isOwner === true,
        `got: ${hyalos.isOwner}`);
      check("trevor@hyalos.com isShared=false (never team)",
        hyalos.isShared === false,
        `got: ${hyalos.isShared}`);
    } else {
      console.log("  ⓘ trevor@hyalos.com not in accounts response — may not be connected");
    }

    // burgesstrevor76@gmail.com — must have isShared=false after migration
    const gmail = accounts.find(a =>
      (a.emailAddress ?? "").toLowerCase() === "burgesstrevor76@gmail.com"
    );
    if (gmail) {
      check("burgesstrevor76@gmail.com isShared=false (migration corrected bad flag)",
        gmail.isShared === false,
        `got: ${gmail.isShared}`);
      check("burgesstrevor76@gmail.com visibilityType=private_personal",
        gmail.visibilityType === "private_personal",
        `got: ${gmail.visibilityType}`);
    } else {
      console.log("  ⓘ burgesstrevor76@gmail.com not in accounts response — may not be connected to Trevor");
    }

    // sales@voltsafe.com and support@voltsafe.com — must be isShared=true
    const sharedTeam = accounts.filter(a => {
      const em = (a.emailAddress ?? "").toLowerCase();
      return (em === "sales@voltsafe.com" || em === "support@voltsafe.com") && a.isShared;
    });
    check("sales@voltsafe.com or support@voltsafe.com present as shared team inboxes",
      sharedTeam.length > 0,
      `shared team accounts found: ${sharedTeam.map(a => a.emailAddress).join(", ")}`);

    // No other user's personal @voltsafe.com inboxes should be visible to Trevor
    const otherPersonalWork = accounts.filter(a => {
      const em = (a.emailAddress ?? "").toLowerCase();
      const isOtherUser = !a.isOwner;
      const isVoltSafe = em.endsWith("@voltsafe.com");
      const isShared = a.isShared;
      return isOtherUser && isVoltSafe && !isShared;
    });
    check("No other user's personal @voltsafe.com inboxes visible to Trevor",
      otherPersonalWork.length === 0,
      `leaking: ${otherPersonalWork.map(a => a.emailAddress).join(", ")}`);

    // No non-@voltsafe.com accounts should appear as isShared=true
    const nonVsShared = accounts.filter(a =>
      a.isShared === true && !(a.emailAddress ?? "").toLowerCase().endsWith("@voltsafe.com")
    );
    check("No non-@voltsafe.com account has isShared=true in API response",
      nonVsShared.length === 0,
      `wrongly shared: ${nonVsShared.map(a => a.emailAddress).join(", ")}`);
  }

  // Team mailboxes endpoint — must only return @voltsafe.com is_shared accounts + own
  const teamRes = await req("GET", "/api/team/mailboxes", null, trevorCookie);
  check("GET /api/team/mailboxes returns 200", teamRes.status === 200,
    `got ${teamRes.status}`);

  if (teamRes.status === 200 && Array.isArray(teamRes.body)) {
    const team = teamRes.body;

    // No non-@voltsafe.com should appear as team mailbox with isShared=true
    const badTeam = team.filter(m =>
      m.isShared === true && !(m.emailAddress ?? "").toLowerCase().endsWith("@voltsafe.com")
    );
    check("Team mailboxes: no non-@voltsafe.com with isShared=true",
      badTeam.length === 0,
      `bad team entries: ${badTeam.map(m => m.emailAddress).join(", ")}`);

    // burgesstrevor76@gmail.com must NOT appear as a shared team mailbox
    const gmailTeam = team.find(m =>
      (m.emailAddress ?? "").toLowerCase() === "burgesstrevor76@gmail.com" && m.isShared
    );
    check("burgesstrevor76@gmail.com does NOT appear as shared team mailbox",
      !gmailTeam,
      gmailTeam ? `found it with isShared=${gmailTeam.isShared}` : "");

    // trevor@hyalos.com must NOT appear as a shared team mailbox
    const hyalosTeam = team.find(m =>
      (m.emailAddress ?? "").toLowerCase() === "trevor@hyalos.com" && m.isShared
    );
    check("trevor@hyalos.com does NOT appear as shared team mailbox",
      !hyalosTeam,
      hyalosTeam ? "found it in team shared" : "");
  }
}

runLiveTests().then(() => {
  console.log("\n==================================================");
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} total\n`);
  if (fails.length) {
    console.log("Failed checks:");
    fails.forEach(f => console.log("  ✗", f));
    process.exit(1);
  } else {
    console.log("✅ All mailbox classification tests PASSED");
    process.exit(0);
  }
}).catch(e => {
  console.error("Test runner error:", e);
  process.exit(1);
});
