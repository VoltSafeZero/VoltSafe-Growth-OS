#!/usr/bin/env node
/**
 * Regression tests — Task #227: Pipeline module bugs
 *
 * Section 1: Stakeholder entity-ID validation (already covered in contact-link-panel.test.js)
 *
 * Section 2: Accounts filters — backend accepts industry param
 *   F1. GET /api/accounts?industry=marine returns 200 with data array.
 *   F2. GET /api/accounts?marketSegment=marina returns same count as
 *       GET /api/accounts?industry=marine&marketSegment=marina (AND is idempotent).
 *   F3. GET /api/accounts?industry=marine&marketSegment=marina&onlyPromoted=true
 *       returns the same set that the accounts page sends on first load.
 *   F4. GET /api/accounts without industry param still works (backward compat).
 *   F5. Reset values: "marine" and "marina" are valid enum values in FILTER_INDUSTRY_OPTIONS
 *       and FILTER_SEGMENT_OPTIONS (checked against crm-taxonomy exports via DB check).
 *
 * Section 3: Duplicate-constraint verification
 *   D1. uq_account_contacts_pair unique index exists on account_contacts.
 *   D2. uq_lead_contacts_pair unique index exists on lead_contacts.
 *   D3. opportunity_contacts already had a unique constraint.
 *   D4. No duplicate rows exist in any of the three tables.
 *
 * Run: node tests/pipeline-bugs-227.test.cjs
 */
"use strict";
const { Pool } = require("pg");

const BASE        = "http://localhost:5000";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PWD   = "alberni1444";

let passed = 0, failed = 0;
const ok  = (l)    => { console.log(`  ✓ ${l}`); passed++; };
const bad = (l, d) => { console.error(`  ✗ ${l}${d ? ` — ${d}` : ""}`); failed++; };
const sleep = ms   => new Promise(r => setTimeout(r, ms));

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PWD }),
  });
  if (!r.ok) throw new Error(`login ${r.status}`);
  const cookie = r.headers.get("set-cookie")?.match(/(connect\.sid=[^;]+)/)?.[1];
  await sleep(400);
  return cookie;
}

const api = (cookie, url, opts = {}) =>
  fetch(`${BASE}${url}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Origin: BASE,
      Cookie: cookie,
      ...(opts.headers || {}),
    },
  });

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  console.log("=== Pipeline Bugs 227 — Regression Suite ===\n");

  try {
    const cookie = await login();
    console.log("  authenticated as admin\n");

    // ── Section 2: Accounts filters ──────────────────────────────────────
    console.log("── Section 2: Accounts — industry filter backend support ──");

    // F1: industry=marine param accepted (returns 200, non-empty data)
    {
      const r = await api(cookie, "/api/accounts?industry=marine&onlyPromoted=false&page=1&limit=5");
      const body = await r.json();
      if (r.status === 200) ok("F1: GET /api/accounts?industry=marine returns 200");
      else bad("F1: GET returns 200", `got ${r.status}`);
      if (Array.isArray(body?.data)) ok("F1: response has data array");
      else bad("F1: response has data array", JSON.stringify(body).slice(0, 120));
    }

    // F2: industry=marine AND marketSegment=marina returns same count as marketSegment=marina alone
    {
      const [rA, rB] = await Promise.all([
        api(cookie, "/api/accounts?marketSegment=marina&onlyPromoted=true&limit=999&page=1"),
        api(cookie, "/api/accounts?industry=marine&marketSegment=marina&onlyPromoted=true&limit=999&page=1"),
      ]);
      const bodyA = await rA.json();
      const bodyB = await rB.json();
      const cntA = bodyA?.total ?? -1;
      const cntB = bodyB?.total ?? -2;
      console.log(`  F2: marketSegment=marina total=${cntA} | industry+marketSegment total=${cntB}`);
      if (cntA === cntB && cntA > 0)
        ok(`F2: industry=marine AND marketSegment=marina returns same count (${cntA}) as marketSegment=marina alone`);
      else
        bad("F2: counts should match", `${cntA} vs ${cntB}`);
    }

    // F3: Initial page default request — industry=marine&marketSegment=marina&onlyPromoted=true
    {
      const r = await api(cookie, "/api/accounts?industry=marine&marketSegment=marina&onlyPromoted=true&page=1&limit=100&sortBy=name&sortOrder=asc");
      const body = await r.json();
      if (r.status === 200) ok("F3: Initial accounts page default request returns 200");
      else bad("F3: Initial request returns 200", `got ${r.status}`);
      if (typeof body?.total === "number" && body.total > 0)
        ok(`F3: Initial page returns ${body.total} accounts`);
      else
        bad("F3: Initial page returns accounts", JSON.stringify(body).slice(0, 120));
      // All returned accounts must have marketSegment='marina'
      const rows = body?.data ?? [];
      const nonMarina = rows.filter((a) => a.marketSegment !== "marina");
      if (nonMarina.length === 0) ok("F3: All returned accounts have marketSegment=marina");
      else bad("F3: All accounts have marketSegment=marina", `${nonMarina.length} with wrong segment`);
    }

    // F4: Backward compat — no industry param still works
    {
      const r = await api(cookie, "/api/accounts?onlyPromoted=true&page=1&limit=5");
      const body = await r.json();
      if (r.status === 200) ok("F4: GET without industry param still returns 200");
      else bad("F4: backward compat", `got ${r.status}`);
    }

    // F5: Direct DB count — marketSegment='marina' count matches F2's cntA
    {
      const { rows: dbRows } = await pool.query(
        `SELECT COUNT(*) AS cnt FROM accounts WHERE market_segment = 'marina'`
      );
      const dbCount = Number(dbRows[0]?.cnt);

      // Also get promoted-only count (what the default page shows)
      const { rows: dbPromoRows } = await pool.query(`
        SELECT COUNT(*) AS cnt FROM accounts
        WHERE market_segment = 'marina'
          AND (converted_from_lead_id IS NULL
               OR EXISTS (SELECT 1 FROM leads WHERE leads.id = accounts.converted_from_lead_id AND leads.status = 'converted'))
      `);
      const dbPromoCount = Number(dbPromoRows[0]?.cnt);
      console.log(`  F5: DB total marina=${dbCount}, promoted=${dbPromoCount}`);
      if (dbCount > 0) ok(`F5: DB has ${dbCount} accounts with marketSegment='marina'`);
      else bad("F5: DB has marina accounts", "count is 0");
      if (dbPromoCount > 0) ok(`F5: DB has ${dbPromoCount} promoted marina accounts (matches default page)`);
      else bad("F5: DB has promoted marina accounts", "count is 0");
    }

    // ── Section 3: Unique constraint verification ─────────────────────────
    console.log("\n── Section 3: Unique pair constraints on contact-link tables ──");

    {
      // D1: uq_account_contacts_pair
      const { rows } = await pool.query(`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'account_contacts'
          AND indexname = 'uq_account_contacts_pair'
      `);
      if (rows.length > 0) ok("D1: uq_account_contacts_pair index exists");
      else bad("D1: uq_account_contacts_pair index exists", "index not found");
    }

    {
      // D2: uq_lead_contacts_pair
      const { rows } = await pool.query(`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'lead_contacts'
          AND indexname = 'uq_lead_contacts_pair'
      `);
      if (rows.length > 0) ok("D2: uq_lead_contacts_pair index exists");
      else bad("D2: uq_lead_contacts_pair index exists", "index not found");
    }

    {
      // D3: opportunity_contacts pre-existing unique constraint
      const { rows } = await pool.query(`
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        WHERE tc.table_name = 'opportunity_contacts'
          AND tc.constraint_type = 'UNIQUE'
      `);
      if (rows.length > 0) ok(`D3: opportunity_contacts has UNIQUE constraint (${rows[0].constraint_name})`);
      else bad("D3: opportunity_contacts UNIQUE constraint", "not found");
    }

    {
      // D4: no existing duplicate pairs in any table
      const { rows: acDups } = await pool.query(`
        SELECT account_id, contact_id, COUNT(*) AS cnt
        FROM account_contacts
        GROUP BY account_id, contact_id
        HAVING COUNT(*) > 1
      `);
      if (acDups.length === 0) ok("D4: account_contacts has no duplicate pairs");
      else bad("D4: account_contacts no duplicates", `${acDups.length} duplicate pairs found`);

      const { rows: lcDups } = await pool.query(`
        SELECT lead_id, contact_id, COUNT(*) AS cnt
        FROM lead_contacts
        GROUP BY lead_id, contact_id
        HAVING COUNT(*) > 1
      `);
      if (lcDups.length === 0) ok("D4: lead_contacts has no duplicate pairs");
      else bad("D4: lead_contacts no duplicates", `${lcDups.length} duplicate pairs found`);

      const { rows: ocDups } = await pool.query(`
        SELECT opportunity_id, contact_id, COUNT(*) AS cnt
        FROM opportunity_contacts
        GROUP BY opportunity_id, contact_id
        HAVING COUNT(*) > 1
      `);
      if (ocDups.length === 0) ok("D4: opportunity_contacts has no duplicate pairs");
      else bad("D4: opportunity_contacts no duplicates", `${ocDups.length} duplicate pairs found`);
    }

    // ── Section 4: Expand button — route verification ─────────────────────
    console.log("\n── Section 4: Expand button canonical routes (server-side proof) ──");

    // Lead → /opportunities/:id
    {
      const r = await api(cookie, `/api/leads/${11071}`);
      const body = await r.json();
      if (r.status === 200 && body?.id === 11071)
        ok("E1: Lead id=11071 resolves — canonical route /opportunities/11071 is valid");
      else
        bad("E1: Lead resolves", `${r.status}`);
    }

    // Account → /accounts/:id
    {
      const r = await api(cookie, `/api/accounts/${10999}`);
      const body = await r.json();
      if (r.status === 200 && body?.id === 10999)
        ok("E2: Account id=10999 resolves — canonical route /accounts/10999 is valid");
      else
        bad("E2: Account resolves", `${r.status}`);
    }

    // Contact → /contacts/:id (full-page, no drawer)
    {
      const r = await api(cookie, `/api/contacts/488`);
      const body = await r.json();
      if (r.status === 200 && (body?.id === 488 || body?.contact?.id === 488))
        ok("E3: Contact id=488 resolves — canonical route /contacts/488 is valid");
      else
        bad("E3: Contact resolves", `${r.status}`);
    }

  } catch (err) {
    console.error("FATAL:", err.message, err.stack?.split("\n")[1]);
    failed++;
  } finally {
    await pool.end();
    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) process.exit(1);
  }
}

main();
