#!/usr/bin/env node
/**
 * Lead → Organization Conversion Test Suite
 * Tests the full Phase 2 conversion API: convert-check, convert (create/link), unconvert.
 * Run with: node tests/conversion.test.js
 * Requires: server running at localhost:5000
 */

const BASE = "http://localhost:5000";
let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✓ ${label}`);
  passed++;
}

function fail(label, detail) {
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  failed++;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`);
  const cookie = res.headers.get("set-cookie")?.match(/(connect\.sid=[^;]+)/)?.[1];
  if (!cookie) throw new Error(`No session cookie for ${email}`);
  await sleep(400);
  return cookie;
}

function authed(cookie) {
  return async (url, opts = {}) => {
    const res = await fetch(`${BASE}${url}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        ...(opts.headers || {}),
      },
    });
    return res;
  };
}

async function check(label, resFn, expectedStatus) {
  const res = await resFn;
  if (res.status === expectedStatus) {
    ok(`${label} → ${res.status}`);
  } else {
    const body = await res.text().catch(() => "");
    fail(`${label} → expected ${expectedStatus}, got ${res.status}`, body.slice(0, 160));
  }
  return res;
}

async function checkBody(label, resFn, expectedStatus, bodyFn) {
  const res = await resFn;
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }

  if (res.status !== expectedStatus) {
    fail(`${label} → expected ${expectedStatus}, got ${res.status}`, text.slice(0, 160));
    return null;
  }
  if (bodyFn) {
    const err = bodyFn(json);
    if (err) {
      fail(`${label} body check`, err);
      return null;
    }
  }
  ok(`${label} → ${res.status}`);
  return json;
}

async function run() {
  console.log("=== VoltSafe Cortex — Conversion Test Suite ===\n");

  // ── ADMIN (Trevor — master_admin, crm=edit) ───────────────────────────────
  const adminCookie = await login("trevor@voltsafe.com", "alberni1444");
  const admin = authed(adminCookie);

  // ── VIEWER (crm=view only) ─────────────────────────────────────────────────
  const viewerCookie = await login("viewer@voltsafe.com", "testpass1234");
  const viewer = authed(viewerCookie);

  // ── MIXED (crm=edit on some sections; used for supplemental checks) ────────
  const mixedCookie = await login("mixed@voltsafe.com", "testpass1234");
  const mixed = authed(mixedCookie);

  // ── Setup: find a fresh unconverted lead ──────────────────────────────────
  console.log("── Setup: Finding unconverted test lead ──");
  const leadsRes = await admin("/api/leads?page=1&limit=200");
  const leadsBody = await leadsRes.json();
  const allLeads = leadsBody.data || [];
  const freshLead = allLeads.find((l) => l.status !== "converted" && l.status !== "lost" && l.company?.trim());
  if (!freshLead) {
    fail("Setup: find unconverted lead", "No eligible lead found in first 200 results");
    console.log(`\nResult: 0 passed, 1 failed — cannot continue without test lead\n`);
    process.exit(1);
  }
  const LEAD_ID = freshLead.id;
  console.log(`  → Using lead #${LEAD_ID}: "${freshLead.company}" (status=${freshLead.status})\n`);

  // ── Test 1: GET /api/leads/:id/convert-check (admin) ─────────────────────
  console.log("── T1: convert-check returns matches array ──");
  await checkBody(
    `GET /api/leads/${LEAD_ID}/convert-check [admin → 200, has matches array]`,
    admin(`/api/leads/${LEAD_ID}/convert-check`),
    200,
    (body) => {
      if (!Array.isArray(body?.matches)) return `Expected body.matches array, got: ${JSON.stringify(body)}`;
      return null;
    }
  );

  // ── Test 2: POST convert — crm=view → 403 ────────────────────────────────
  console.log("\n── T2: crm=view cannot convert ──");
  await check(
    `POST /api/leads/${LEAD_ID}/convert [crm=view → 403]`,
    viewer(`/api/leads/${LEAD_ID}/convert`, {
      method: "POST",
      body: JSON.stringify({ orgType: "marina_prospect" }),
    }),
    403
  );

  // ── Test 3: POST unconvert — crm=view → 403 ──────────────────────────────
  console.log("\n── T3: crm=view cannot unconvert ──");
  await check(
    `POST /api/leads/${LEAD_ID}/unconvert [crm=view → 403]`,
    viewer(`/api/leads/${LEAD_ID}/unconvert`, { method: "POST" }),
    403
  );

  // ── Test 4: POST convert — create new organization ────────────────────────
  console.log("\n── T4: admin converts lead → creates new organization ──");
  const convertResult = await checkBody(
    `POST /api/leads/${LEAD_ID}/convert [admin, create new → 200]`,
    admin(`/api/leads/${LEAD_ID}/convert`, {
      method: "POST",
      body: JSON.stringify({ orgType: "marina_prospect" }),
    }),
    200,
    (body) => {
      if (!body?.account?.id) return `No account.id in response: ${JSON.stringify(body)}`;
      if (body?.action !== "created") return `Expected action="created", got "${body?.action}"`;
      return null;
    }
  );

  if (!convertResult?.account?.id) {
    fail("T4 followup — cannot continue without account ID");
    console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
    process.exit(1);
  }

  const NEW_ACCOUNT_ID = convertResult.account.id;
  console.log(`  → Created Organization #${NEW_ACCOUNT_ID}: "${convertResult.account.name}"`);

  // Verify lead status is now "converted"
  const leadAfterConvert = await (await admin(`/api/leads/${LEAD_ID}`)).json();
  if (leadAfterConvert?.status === "converted") {
    ok(`Lead #${LEAD_ID} status is "converted" after convert`);
  } else {
    fail(`Lead #${LEAD_ID} status check`, `Expected "converted", got "${leadAfterConvert?.status}"`);
  }

  // Verify convertedFromLeadId on the new account
  const accountAfterConvert = await (await admin(`/api/accounts/${NEW_ACCOUNT_ID}`)).json();
  if (accountAfterConvert?.convertedFromLeadId === LEAD_ID) {
    ok(`Account #${NEW_ACCOUNT_ID} has convertedFromLeadId=${LEAD_ID}`);
  } else {
    fail(`Account #${NEW_ACCOUNT_ID} convertedFromLeadId check`, `Got ${accountAfterConvert?.convertedFromLeadId}`);
  }

  // ── Test 5: Double-convert → 400 ─────────────────────────────────────────
  console.log("\n── T5: double-convert already-converted lead → 400 ──");
  await check(
    `POST /api/leads/${LEAD_ID}/convert again [→ 400]`,
    admin(`/api/leads/${LEAD_ID}/convert`, {
      method: "POST",
      body: JSON.stringify({ orgType: "marina_prospect" }),
    }),
    400
  );

  // ── Test 6: POST unconvert — restores status, preserves organization ──────
  console.log("\n── T6: unconvert restores status, does NOT delete organization ──");
  const priorStatus = freshLead.status;
  const unconvertResult = await checkBody(
    `POST /api/leads/${LEAD_ID}/unconvert [admin → 200]`,
    admin(`/api/leads/${LEAD_ID}/unconvert`, { method: "POST" }),
    200,
    (body) => {
      if (!body?.leadId && !body?.lead) return `No leadId/lead in response: ${JSON.stringify(body)}`;
      return null;
    }
  );

  if (unconvertResult) {
    const restoredStatus = unconvertResult.lead?.status ?? unconvertResult.status;
    const expectedStatus = priorStatus || "contacted";
    if (restoredStatus === expectedStatus || restoredStatus === "contacted") {
      ok(`Lead #${LEAD_ID} status restored to "${restoredStatus}" (was "${priorStatus}")`);
    } else {
      fail(`Lead #${LEAD_ID} status restore`, `Expected "${expectedStatus}", got "${restoredStatus}"`);
    }

    // Verify organization still exists
    const accountStillExists = await admin(`/api/accounts/${NEW_ACCOUNT_ID}`);
    if (accountStillExists.status === 200) {
      ok(`Organization #${NEW_ACCOUNT_ID} still exists after unconvert (not deleted)`);
    } else {
      fail(`Organization #${NEW_ACCOUNT_ID} should still exist`, `Got status ${accountStillExists.status}`);
    }
  }

  // ── Test 7: POST convert — link to existing organization (Path A) ─────────
  console.log("\n── T7: admin converts lead → links to existing organization ──");
  const linkResult = await checkBody(
    `POST /api/leads/${LEAD_ID}/convert [link existingAccountId=${NEW_ACCOUNT_ID} → 200]`,
    admin(`/api/leads/${LEAD_ID}/convert`, {
      method: "POST",
      body: JSON.stringify({ existingAccountId: NEW_ACCOUNT_ID, orgType: "marina_prospect" }),
    }),
    200,
    (body) => {
      if (!body?.account?.id) return `No account.id in response: ${JSON.stringify(body)}`;
      if (body?.action !== "linked") return `Expected action="linked", got "${body?.action}"`;
      if (body?.account?.id !== NEW_ACCOUNT_ID) return `Expected account id ${NEW_ACCOUNT_ID}, got ${body?.account?.id}`;
      return null;
    }
  );

  if (linkResult) {
    console.log(`  → Lead linked to existing Organization #${NEW_ACCOUNT_ID}`);

    // Clean up — unconvert
    await admin(`/api/leads/${LEAD_ID}/unconvert`, { method: "POST" });
    console.log(`  → Cleanup: unconverted lead #${LEAD_ID}`);
  }

  // ── Test 8: Convert lead with no company name → 400 ──────────────────────
  console.log("\n── T8: empty company name blocked at convert ──");
  const noNameLead = await (await admin("/api/leads", {
    method: "POST",
    body: JSON.stringify({ company: "", contactName: "Test User", contactEmail: "test@voltsafe.com", source: "manual" }),
  })).json();
  if (noNameLead?.id) {
    await check(
      `POST /api/leads/${noNameLead.id}/convert [no company name → 400]`,
      admin(`/api/leads/${noNameLead.id}/convert`, {
        method: "POST",
        body: JSON.stringify({ orgType: "marina_prospect" }),
      }),
      400
    );
    // cleanup
    await admin(`/api/leads/${noNameLead.id}`, { method: "DELETE" });
    console.log(`  → Cleanup: deleted no-name lead #${noNameLead.id}`);
  } else {
    fail("T8 setup — could not create no-name lead", JSON.stringify(noNameLead));
  }

  // ── Test 9: GET /api/leads/:id/linked-org (converted lead → returns account) ──
  console.log("\n── T9: linked-org endpoint returns account after conversion ──");
  const freshForT9 = (await (await admin("/api/leads?page=1&limit=200")).json()).data
    ?.find((l) => l.status !== "converted" && l.status !== "lost" && l.company?.trim());
  if (freshForT9) {
    await admin(`/api/leads/${freshForT9.id}/convert`, {
      method: "POST",
      body: JSON.stringify({ orgType: "marina_prospect" }),
    });
    const linkedOrgRes = await (await admin(`/api/leads/${freshForT9.id}/linked-org`)).json();
    if (linkedOrgRes?.account?.id) {
      ok(`GET /api/leads/${freshForT9.id}/linked-org → account ${linkedOrgRes.account.id}: "${linkedOrgRes.account.name}"`);
    } else {
      fail(`GET /api/leads/${freshForT9.id}/linked-org`, `Expected account, got: ${JSON.stringify(linkedOrgRes)}`);
    }
    // cleanup
    await admin(`/api/leads/${freshForT9.id}/unconvert`, { method: "POST" });
    const linkedAcctId = linkedOrgRes?.account?.id;
    if (linkedAcctId) await admin(`/api/accounts/${linkedAcctId}`, { method: "DELETE" });
    console.log(`  → Cleanup: unconverted lead #${freshForT9.id}, removed org #${linkedAcctId}`);
  } else {
    fail("T9 setup — no eligible lead found");
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(52)}`);
  console.log(`Result: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("\nFATAL:", err.message);
  process.exit(1);
});
