#!/usr/bin/env node
/**
 * Regression tests — Contact Link Panel (Task #227 hardened)
 *
 * C1/C3.  getLeadContacts() returns linked contact immediately after POST.
 * C2/C4.  getAccountContacts() returns linked contact immediately after POST.
 * C5.     Duplicate contact link attempt does not 500; returns alreadyLinked.
 * C6.     Lead contact persists on simulated page refresh (2nd GET).
 * C7.     Account contact persists on simulated page refresh (2nd GET).
 * C8.     Invalid entity ID (0) is rejected with 400.
 * C9.     Missing contactId is rejected with 400.
 * C10.    First link returns created:true; second returns alreadyLinked:true.
 * C11.    Only one DB row exists after two identical POST attempts.
 * C12.    Opportunity contact link works (POST + GET + duplicate).
 *
 * All rows inserted by this test are cleaned up in the finally block.
 * Run: node tests/contact-link-panel.test.js
 */
import pg from "pg";

const BASE        = "http://localhost:5000";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PWD   = "alberni1444";

// Clean leads/accounts confirmed to have no pre-existing contact links.
const LEAD_ID         = 11071;  // Big Marina 1776559350612
const ACCOUNT_ID      = 10999;  // Don's Dock in
const OPPORTUNITY_ID  = 1;      // First opportunity (or nearest available)
const CONTACT_ID      = 488;    // Sarah Johnson

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

function hasContact(rows, contactId) {
  if (!Array.isArray(rows)) return false;
  return rows.some(r => (r.contactId === contactId || r.contact_id === contactId) && r.contact?.id === contactId);
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  console.log(`=== Contact Link Panel Regression (Task #227) ===`);
  console.log(`  lead=${LEAD_ID}  account=${ACCOUNT_ID}  contact=${CONTACT_ID}\n`);

  // Resolve the nearest valid opportunity id
  let OPP_ID = OPPORTUNITY_ID;
  try {
    const { rows } = await pool.query(`SELECT id FROM opportunities LIMIT 1`);
    if (rows.length > 0) OPP_ID = rows[0].id;
  } catch {}

  try {
    const cookie = await login();
    console.log("  authenticated as admin");

    // Pre-clean
    await pool.query(`DELETE FROM lead_contacts    WHERE lead_id=$1    AND contact_id=$2`, [LEAD_ID, CONTACT_ID]);
    await pool.query(`DELETE FROM account_contacts WHERE account_id=$1 AND contact_id=$2`, [ACCOUNT_ID, CONTACT_ID]);
    await pool.query(`DELETE FROM opportunity_contacts WHERE opportunity_id=$1 AND contact_id=$2`, [OPP_ID, CONTACT_ID]).catch(() => {});
    console.log("  pre-cleaned any leftover test rows\n");

    // ── C8: Invalid entity ID (0) rejected with 400 ─────────────────────
    console.log("── C8: Invalid entity ID = 0 → 400 ──");
    {
      for (const [label, url] of [
        ["lead",        `/api/leads/0/contacts`],
        ["account",     `/api/accounts/0/contacts`],
        ["opportunity", `/api/opportunities/0/contacts`],
      ]) {
        const r = await api(cookie, url, {
          method: "POST",
          body: JSON.stringify({ contactId: CONTACT_ID }),
        });
        if (r.status === 400)
          ok(`C8-${label}: POST to /0 returns 400`);
        else
          bad(`C8-${label}: POST to /0 returns 400`, `got ${r.status}`);
      }
    }

    // ── C9: Missing contactId rejected with 400 ─────────────────────────
    console.log("\n── C9: Missing contactId → 400 ──");
    {
      for (const [label, url] of [
        ["lead",        `/api/leads/${LEAD_ID}/contacts`],
        ["account",     `/api/accounts/${ACCOUNT_ID}/contacts`],
        ["opportunity", `/api/opportunities/${OPP_ID}/contacts`],
      ]) {
        const r = await api(cookie, url, {
          method: "POST",
          body: JSON.stringify({}),
        });
        if (r.status === 400)
          ok(`C9-${label}: POST without contactId returns 400`);
        else
          bad(`C9-${label}: POST without contactId returns 400`, `got ${r.status}`);
      }
    }

    // ── C1/C3: Lead contact link ─────────────────────────────────────────
    console.log("\n── C1/C3: Lead — POST link → immediate GET → created:true ──");
    {
      const preR = await api(cookie, `/api/leads/${LEAD_ID}/contacts`);
      const pre  = await preR.json();
      if (preR.status === 200) ok("C1/C3-pre: GET /api/leads/:id/contacts returns 200");
      else bad("C1/C3-pre: GET returns 200", `got ${preR.status}`);
      if (!hasContact(pre, CONTACT_ID)) ok(`C1/C3-pre: contact ${CONTACT_ID} not yet linked`);
      else bad("C1/C3-pre: clean state", "contact already linked");

      const linkR    = await api(cookie, `/api/leads/${LEAD_ID}/contacts`, {
        method: "POST",
        body: JSON.stringify({ contactId: CONTACT_ID }),
      });
      const linkBody = await linkR.json();
      console.log(`  POST status=${linkR.status}, body=${JSON.stringify(linkBody)}`);

      // C10: first link must return 201 + created:true
      if (linkR.status === 201) ok("C10-lead: first link returns 201");
      else bad("C10-lead: first link returns 201", `got ${linkR.status}`);
      if (linkBody.created === true) ok("C10-lead: response has created:true");
      else bad("C10-lead: response has created:true", JSON.stringify(linkBody));
      if (linkBody.alreadyLinked === false) ok("C10-lead: alreadyLinked:false on first link");
      else bad("C10-lead: alreadyLinked:false", JSON.stringify(linkBody));

      const afterR = await api(cookie, `/api/leads/${LEAD_ID}/contacts`);
      const after  = await afterR.json();
      if (afterR.status === 200) ok("C3: GET /api/leads/:id/contacts returns 200 after link");
      else bad("C3: GET returns 200 after link", `got ${afterR.status}`);
      if (hasContact(after, CONTACT_ID)) ok(`C1: contact ${CONTACT_ID} present with populated .contact`);
      else bad(`C1: contact present with .contact`, JSON.stringify(after));

      const { rowCount } = await pool.query(
        `SELECT 1 FROM lead_contacts WHERE lead_id=$1 AND contact_id=$2`, [LEAD_ID, CONTACT_ID]);
      if (rowCount > 0) ok("C1: lead_contacts row exists in DB");
      else bad("C1: lead_contacts row in DB", "row not found");
    }

    // ── C6: Lead page-refresh simulation ───────────────────────────────
    console.log("\n── C6: Lead contact persists on simulated page refresh ──");
    {
      const r1    = await api(cookie, `/api/leads/${LEAD_ID}/contacts`);
      const rows1 = await r1.json();
      if (hasContact(rows1, CONTACT_ID)) ok("C6: contact present on 2nd GET");
      else bad("C6: contact present on 2nd GET", JSON.stringify(rows1));
    }

    // ── C5/C10/C11: Duplicate lead link ─────────────────────────────────
    console.log("\n── C5/C10/C11: Duplicate lead contact link ──");
    {
      const dupR    = await api(cookie, `/api/leads/${LEAD_ID}/contacts`, {
        method: "POST",
        body: JSON.stringify({ contactId: CONTACT_ID }),
      });
      const dupBody = await dupR.json();
      console.log(`  duplicate POST status=${dupR.status}, body=${JSON.stringify(dupBody)}`);

      if (dupR.status !== 500) ok(`C5-lead: duplicate does not 500 (got ${dupR.status})`);
      else bad("C5-lead: duplicate does not 500", `got 500`);
      if (dupBody.alreadyLinked === true) ok("C10-lead: second link returns alreadyLinked:true");
      else bad("C10-lead: second link alreadyLinked:true", JSON.stringify(dupBody));

      // C11: only one DB row
      const { rows: dbRows } = await pool.query(
        `SELECT id FROM lead_contacts WHERE lead_id=$1 AND contact_id=$2`, [LEAD_ID, CONTACT_ID]);
      if (dbRows.length === 1) ok("C11-lead: exactly 1 DB row after 2 POSTs");
      else bad("C11-lead: exactly 1 DB row", `found ${dbRows.length} rows`);

      // GET must still work
      const afterDupR = await api(cookie, `/api/leads/${LEAD_ID}/contacts`);
      const afterDup  = await afterDupR.json();
      if (afterDupR.status === 200) ok("C5-lead: GET still returns 200 after duplicate");
      else bad("C5-lead: GET returns 200 after dup", `got ${afterDupR.status}`);
      if (hasContact(afterDup, CONTACT_ID)) ok("C5-lead: contact still present after dup");
      else bad("C5-lead: contact present after dup", JSON.stringify(afterDup));
    }

    // ── C2/C4: Account contact link ──────────────────────────────────────
    console.log("\n── C2/C4: Account — POST link → immediate GET → created:true ──");
    {
      const preR = await api(cookie, `/api/accounts/${ACCOUNT_ID}/contacts`);
      const pre  = await preR.json();
      if (preR.status === 200) ok("C2/C4-pre: GET /api/accounts/:id/contacts returns 200");
      else bad("C2/C4-pre: GET returns 200", `got ${preR.status}`);

      const linkR    = await api(cookie, `/api/accounts/${ACCOUNT_ID}/contacts`, {
        method: "POST",
        body: JSON.stringify({ contactId: CONTACT_ID }),
      });
      const linkBody = await linkR.json();
      console.log(`  POST status=${linkR.status}, body=${JSON.stringify(linkBody)}`);

      if (linkR.status === 201) ok("C10-account: first link returns 201");
      else bad("C10-account: first link returns 201", `got ${linkR.status}`);
      if (linkBody.created === true) ok("C10-account: created:true on first link");
      else bad("C10-account: created:true", JSON.stringify(linkBody));

      const afterR = await api(cookie, `/api/accounts/${ACCOUNT_ID}/contacts`);
      const after  = await afterR.json();
      if (afterR.status === 200) ok("C4: GET /api/accounts/:id/contacts returns 200 after link");
      else bad("C4: GET returns 200", `got ${afterR.status}`);

      const found = Array.isArray(after) && after.some(r =>
        r.contactId === CONTACT_ID || r.contact_id === CONTACT_ID || r.contact?.id === CONTACT_ID);
      if (found) ok(`C2: contact ${CONTACT_ID} present in account GET`);
      else bad(`C2: contact ${CONTACT_ID} in account GET`, JSON.stringify(after?.slice?.(0, 3)));

      const { rowCount } = await pool.query(
        `SELECT 1 FROM account_contacts WHERE account_id=$1 AND contact_id=$2`, [ACCOUNT_ID, CONTACT_ID]);
      if (rowCount > 0) ok("C2: account_contacts row exists in DB");
      else bad("C2: account_contacts row in DB", "row not found");
    }

    // ── C7: Account page-refresh simulation ─────────────────────────────
    console.log("\n── C7: Account contact persists on simulated page refresh ──");
    {
      const r2    = await api(cookie, `/api/accounts/${ACCOUNT_ID}/contacts`);
      const rows2 = await r2.json();
      const found = Array.isArray(rows2) && rows2.some(r =>
        r.contactId === CONTACT_ID || r.contact_id === CONTACT_ID || r.contact?.id === CONTACT_ID);
      if (found) ok("C7: account contact present on 2nd GET");
      else bad("C7: account contact on 2nd GET", JSON.stringify(rows2?.slice?.(0, 3)));
    }

    // ── C5/C10/C11: Duplicate account link ──────────────────────────────
    console.log("\n── C5/C10/C11: Duplicate account contact link ──");
    {
      const dupR    = await api(cookie, `/api/accounts/${ACCOUNT_ID}/contacts`, {
        method: "POST",
        body: JSON.stringify({ contactId: CONTACT_ID }),
      });
      const dupBody = await dupR.json();
      console.log(`  duplicate POST status=${dupR.status}, body=${JSON.stringify(dupBody)}`);

      if (dupR.status !== 500) ok(`C5-account: duplicate does not 500 (got ${dupR.status})`);
      else bad("C5-account: duplicate does not 500", `got 500`);
      if (dupBody.alreadyLinked === true) ok("C10-account: second link returns alreadyLinked:true");
      else bad("C10-account: second link alreadyLinked:true", JSON.stringify(dupBody));

      const { rows: dbRows } = await pool.query(
        `SELECT id FROM account_contacts WHERE account_id=$1 AND contact_id=$2`, [ACCOUNT_ID, CONTACT_ID]);
      if (dbRows.length === 1) ok("C11-account: exactly 1 DB row after 2 POSTs");
      else bad("C11-account: exactly 1 DB row", `found ${dbRows.length} rows`);
    }

    // ── C12: Opportunity contact link ─────────────────────────────────────
    console.log(`\n── C12: Opportunity (id=${OPP_ID}) contact link ──`);
    {
      const preR = await api(cookie, `/api/opportunities/${OPP_ID}/contacts`);
      if (preR.status === 200) ok("C12-pre: GET /api/opportunities/:id/contacts returns 200");
      else { bad("C12-pre: GET returns 200", `got ${preR.status}`); }

      const linkR    = await api(cookie, `/api/opportunities/${OPP_ID}/contacts`, {
        method: "POST",
        body: JSON.stringify({ contactId: CONTACT_ID }),
      });
      const linkBody = await linkR.json();
      console.log(`  POST status=${linkR.status}, body=${JSON.stringify(linkBody)}`);

      if (linkR.status === 201 || linkR.status === 200)
        ok(`C12: POST /api/opportunities/:id/contacts returns ${linkR.status}`);
      else bad("C12: POST returns 2xx", `got ${linkR.status}: ${JSON.stringify(linkBody)}`);
      if (typeof linkBody.created === "boolean") ok("C12: response has created field");
      else bad("C12: response has created field", JSON.stringify(linkBody));

      // Duplicate opp link
      const dup2R    = await api(cookie, `/api/opportunities/${OPP_ID}/contacts`, {
        method: "POST",
        body: JSON.stringify({ contactId: CONTACT_ID }),
      });
      const dup2Body = await dup2R.json();
      if (dup2R.status !== 500) ok(`C12-dup: duplicate opp link does not 500 (got ${dup2R.status})`);
      else bad("C12-dup: duplicate does not 500", `got 500`);
      if (dup2Body.alreadyLinked === true) ok("C12-dup: alreadyLinked:true on 2nd opp link");
      else bad("C12-dup: alreadyLinked:true", JSON.stringify(dup2Body));

      const { rows: dbRows } = await pool.query(
        `SELECT id FROM opportunity_contacts WHERE opportunity_id=$1 AND contact_id=$2`, [OPP_ID, CONTACT_ID]);
      if (dbRows.length === 1) ok("C12: exactly 1 DB row after 2 opp POSTs");
      else bad("C12: exactly 1 DB row for opp", `found ${dbRows.length}`);
    }

  } catch (err) {
    console.error("FATAL:", err.message, err.stack?.split("\n")[1]);
    failed++;
  } finally {
    await pool.query(`DELETE FROM lead_contacts    WHERE lead_id=$1    AND contact_id=$2`,
      [LEAD_ID, CONTACT_ID]).catch(() => {});
    await pool.query(`DELETE FROM account_contacts WHERE account_id=$1 AND contact_id=$2`,
      [ACCOUNT_ID, CONTACT_ID]).catch(() => {});
    await pool.query(`DELETE FROM opportunity_contacts WHERE opportunity_id=$1 AND contact_id=$2`,
      [OPP_ID, CONTACT_ID]).catch(() => {});
    await pool.end();

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) process.exit(1);
  }
}

main();
