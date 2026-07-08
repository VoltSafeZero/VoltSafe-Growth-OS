#!/usr/bin/env node
/**
 * Calendar Privacy Visibility Policy — HTTP integration test.
 * Complements tests/calendar-privacy.unit.ts (pure resolver-logic checks) by
 * exercising the real routes.ts endpoints end-to-end against the running
 * server + database.
 *
 * Run with: node tests/calendar-privacy.test.js
 * Requires: server running at localhost:5000
 *
 * Self-seeding: idempotently creates two fixture users and a small set of
 * calendar_connections / calendar_events rows covering company_managed,
 * private_personal, external_calendar, and team_shared, so the suite is not
 * broken by a fresh or reset DB. Cleans up its own fixture rows on exit.
 */
import { execSync } from "child_process";

const BASE = "http://localhost:5000";
let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  \u2713 ${label}`);
  passed++;
}
function fail(label, detail) {
  console.error(`  \u2717 ${label}${detail ? ` \u2014 ${detail}` : ""}`);
  failed++;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`);
  const cookie = res.headers.get("set-cookie")?.match(/(connect\.sid=[^;]+)/)?.[1];
  if (!cookie) throw new Error(`No session cookie for ${email}`);
  await sleep(300);
  return cookie;
}

function authed(cookie) {
  return async (url, opts = {}) => {
    return fetch(`${BASE}${url}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Origin: BASE,
        Cookie: cookie,
        ...(opts.headers || {}),
      },
    });
  };
}

async function main() {
  // ── Fixture setup via a tsx helper (raw SQL, since visibility_type /
  // connection_id are additive columns not present in shared/schema.ts) ──
  execSync("npx tsx tests/helpers/calendar-privacy-seed.ts seed", { stdio: "inherit", timeout: 30_000 });

  const fixtures = JSON.parse(execSync("npx tsx tests/helpers/calendar-privacy-seed.ts ids", { timeout: 15_000 }).toString());
  const { ownerUserId, adminUserId, salesUserId, companyEventId, privateEventId, externalEventId, teamSharedEventId } = fixtures;

  try {
    const ownerCookie = await login("cal-owner@voltsafe.com", "testpass1234");
    const adminCookie = await login("cal-admin@voltsafe.com", "testpass1234");
    const salesCookie = await login("cal-sales@voltsafe.com", "testpass1234");

    const asOwner = authed(ownerCookie);
    const asAdmin = authed(adminCookie);
    const asSales = authed(salesCookie);

    console.log("\n\u2500\u2500 company_managed: elevated role sees full details for another user's work event \u2500\u2500");
    {
      const res = await asAdmin(`/api/calendar/events/${companyEventId}`);
      const body = await res.json();
      if (res.status === 200 && body.title === "VoltSafe Privacy Test — Company Event") ok("admin GET company_managed event -> full title");
      else fail("admin GET company_managed event -> full title", JSON.stringify(body).slice(0, 150));
    }

    console.log("\n\u2500\u2500 private_personal: admin does NOT bypass privacy \u2500\u2500");
    {
      const res = await asAdmin(`/api/calendar/events/${privateEventId}`);
      const body = await res.json();
      if (res.status === 200 && body.title === "Busy" && body.description == null && body.location == null) {
        ok("admin GET private_personal event -> busy-only, no title/description/location leak");
      } else {
        fail("admin GET private_personal event -> busy-only", JSON.stringify(body).slice(0, 150));
      }
    }

    console.log("\n\u2500\u2500 external_calendar: admin does NOT bypass privacy \u2500\u2500");
    {
      const res = await asAdmin(`/api/calendar/events/${externalEventId}`);
      const body = await res.json();
      if (res.status === 200 && body.title === "Busy" && body.attendeeDetails == null && body.meetingUrl == null) {
        ok("admin GET external_calendar event -> busy-only, no attendees/link leak");
      } else {
        fail("admin GET external_calendar event -> busy-only", JSON.stringify(body).slice(0, 150));
      }
    }

    console.log("\n\u2500\u2500 owner always sees full details regardless of visibility_type \u2500\u2500");
    {
      const res = await asOwner(`/api/calendar/events/${privateEventId}`);
      const body = await res.json();
      if (res.status === 200 && body.title === "VoltSafe Privacy Test — Private Event") ok("owner GET private_personal event -> full details");
      else fail("owner GET private_personal event -> full details", JSON.stringify(body).slice(0, 150));
    }

    console.log("\n\u2500\u2500 non-elevated user with no calendar_team grant is denied (404) on private/company events \u2500\u2500");
    {
      const res = await asSales(`/api/calendar/events/${companyEventId}`);
      if (res.status === 404) ok("non-elevated sales user GET company event without grant -> 404 (no enumeration)");
      else fail("non-elevated sales user GET company event without grant -> 404", `got ${res.status}`);
    }
    {
      // Spec requirement (2): private_personal/external_calendar show busy/free
      // to EVERYONE except the owner — not gated by calendar_team permission,
      // since no title/description/etc. is ever exposed either way.
      const res = await asSales(`/api/calendar/events/${privateEventId}`);
      const body = await res.json();
      if (res.status === 200 && body.title === "Busy" && body.description == null) {
        ok("non-elevated sales user GET private event without grant -> 200 busy-only (visible to everyone, no details leak)");
      } else {
        fail("non-elevated sales user GET private event without grant -> 200 busy-only", `got ${res.status} ${JSON.stringify(body).slice(0,120)}`);
      }
    }

    console.log("\n\u2500\u2500 team_shared: any internal user (even non-elevated) sees full details \u2500\u2500");
    {
      const res = await asSales(`/api/calendar/events/${teamSharedEventId}`);
      const body = await res.json();
      if (res.status === 200 && body.title === "VoltSafe Privacy Test — Team Shared Event") ok("non-elevated user GET team_shared event -> full details");
      else fail("non-elevated user GET team_shared event -> full details", JSON.stringify(body).slice(0, 150));
    }

    console.log("\n\u2500\u2500 view-only: elevated role cannot edit another user's company_managed event \u2500\u2500");
    {
      const res = await asAdmin(`/api/calendar/events/${companyEventId}`, {
        method: "PUT",
        body: JSON.stringify({ title: "Hijacked" }),
      });
      if (res.status === 404) ok("admin PUT another user's company_managed event -> 404 (owner-only, view-only enforced)");
      else fail("admin PUT another user's company_managed event -> 404", `got ${res.status}`);
    }
    {
      const res = await asAdmin(`/api/calendar/events/${companyEventId}`, { method: "DELETE" });
      if (res.status === 404) ok("admin DELETE another user's company_managed event -> 404 (owner-only, view-only enforced)");
      else fail("admin DELETE another user's company_managed event -> 404", `got ${res.status}`);
    }

    console.log("\n\u2500\u2500 team endpoint: admin bulk fetch sanitizes private events but keeps company events full \u2500\u2500");
    {
      const start = "2020-01-01T00:00:00.000Z";
      const end = "2035-01-01T00:00:00.000Z";
      const res = await asAdmin(`/api/calendar/events/team?userIds=${ownerUserId}&start=${start}&end=${end}`);
      const body = await res.json();
      const company = body.find((e) => e.id === companyEventId);
      const priv = body.find((e) => e.id === privateEventId);
      const ext = body.find((e) => e.id === externalEventId);
      if (company && company.title === "VoltSafe Privacy Test — Company Event") ok("team endpoint: company_managed event returned in full");
      else fail("team endpoint: company_managed event returned in full", JSON.stringify(company).slice(0, 150));
      if (priv && priv.title === "Busy" && priv.description == null) ok("team endpoint: private_personal event sanitized to Busy");
      else fail("team endpoint: private_personal event sanitized to Busy", JSON.stringify(priv).slice(0, 150));
      if (ext && ext.title === "Busy" && ext.location == null) ok("team endpoint: external_calendar event sanitized to Busy");
      else fail("team endpoint: external_calendar event sanitized to Busy", JSON.stringify(ext).slice(0, 150));
    }

    console.log("\n\u2500\u2500 admin-only PATCH visibility endpoint rejects non-admin \u2500\u2500");
    {
      const fixtureConn = fixtures.privateConnectionId;
      const res = await asSales(`/api/calendar/connections/${fixtureConn}/visibility`, {
        method: "PATCH",
        body: JSON.stringify({ visibilityType: "company_managed" }),
      });
      if (res.status === 403) ok("non-admin PATCH visibility -> 403");
      else fail("non-admin PATCH visibility -> 403", `got ${res.status}`);
    }
  } finally {
    execSync("npx tsx tests/helpers/calendar-privacy-seed.ts cleanup", { stdio: "inherit", timeout: 30_000 });
  }

  console.log("\n" + "=".repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
  if (failed > 0) {
    console.error(`\n\u274c ${failed} test(s) FAILED`);
    process.exit(1);
  } else {
    console.log("\n\u2705 All checks PASSED");
    process.exit(0);
  }
}

main().catch((e) => {
  console.error("Fatal test error:", e);
  process.exit(1);
});
