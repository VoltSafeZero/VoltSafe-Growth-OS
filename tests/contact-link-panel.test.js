#!/usr/bin/env node
/**
 * Regression tests — Bug 2: Add Existing Contact to Lead / Account
 *
 * C1/C3. getLeadContacts() returns linked contact immediately after POST
 *         (proves inArray() fix works — old ANY($1) could return empty rows).
 * C2/C4. getAccountContacts() returns linked contact immediately after POST.
 * C5.    Duplicate contact link attempt does not 500 / break subsequent GET.
 * C6.    Lead contact persists on simulated page refresh (2nd GET).
 * C7.    Account contact persists on simulated page refresh (2nd GET).
 *
 * All rows inserted by this test are cleaned up in the finally block.
 * Run: node tests/contact-link-panel.test.js
 */
import pg from "pg";

const BASE        = "http://localhost:5000";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PWD   = "alberni1444";

// Clean leads/accounts confirmed to have no pre-existing contact links.
// Contacts confirmed to exist in the DB.
const LEAD_ID    = 11071;  // Big Marina 1776559350612
const ACCOUNT_ID = 10999;  // Don's Dock in
const CONTACT_ID = 488;    // Sarah Johnson

let passed = 0, failed = 0;
const ok  = (l)    => { console.log(`  \u2713 ${l}`); passed++; };
const bad = (l, d) => { console.error(`  \u2717 ${l}${d ? ` \u2014 ${d}` : ""}`); failed++; };
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

// Helper: check if a contact row with CONTACT_ID is in the response array,
// and that its `.contact` sub-object is populated (not undefined/null).
function hasContact(rows, contactId) {
  if (!Array.isArray(rows)) return false;
  return rows.some(r => (r.contactId === contactId || r.contact_id === contactId) && r.contact?.id === contactId);
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  console.log(`=== Contact Link Panel Regression ===`);
  console.log(`  lead=${LEAD_ID}  account=${ACCOUNT_ID}  contact=${CONTACT_ID}\n`);

  try {
    const cookie = await login();
    console.log("  authenticated as admin");

    // Pre-clean: remove any leftover rows from previous test runs
    await pool.query(
      `DELETE FROM lead_contacts    WHERE lead_id=$1    AND contact_id=$2`, [LEAD_ID, CONTACT_ID]);
    await pool.query(
      `DELETE FROM account_contacts WHERE account_id=$1 AND contact_id=$2`, [ACCOUNT_ID, CONTACT_ID]);
    console.log("  pre-cleaned any leftover test rows\n");

    // ─── C1 / C3: Lead contact link ─────────────────────────────────────
    console.log("── C1/C3: Lead — POST link → immediate GET returns contact ──");
    {
      // Before: contact must not be linked
      const preR  = await api(cookie, `/api/leads/${LEAD_ID}/contacts`);
      const pre   = await preR.json();
      console.log(`  before: GET status=${preR.status}, count=${Array.isArray(pre) ? pre.length : "?"}`);
      if (preR.status === 200) ok("C1/C3-pre: GET /api/leads/:id/contacts returns 200");
      else                      bad("C1/C3-pre: GET returns 200", `got ${preR.status}`);
      if (!hasContact(pre, CONTACT_ID)) ok(`C1/C3-pre: contact ${CONTACT_ID} not yet linked`);
      else                               bad("C1/C3-pre: clean state", "contact already linked");

      // POST to link
      const linkR    = await api(cookie, `/api/leads/${LEAD_ID}/contacts`, {
        method: "POST",
        body: JSON.stringify({ contactId: CONTACT_ID }),
      });
      const linkBody = await linkR.json();
      console.log(`  POST status=${linkR.status}, body=${JSON.stringify(linkBody)}`);
      if (linkR.status === 201 || linkR.status === 200)
        ok(`C3: POST /api/leads/:id/contacts returns ${linkR.status}`);
      else
        bad("C3: POST /api/leads/:id/contacts returns 2xx", `got ${linkR.status}: ${JSON.stringify(linkBody)}`);

      // Immediate GET — must include the new contact with populated .contact object
      const afterR = await api(cookie, `/api/leads/${LEAD_ID}/contacts`);
      const after  = await afterR.json();
      console.log(`  after:  GET status=${afterR.status}, count=${Array.isArray(after) ? after.length : "?"}`);
      console.log(`  rows:   ${JSON.stringify(after)}`);

      if (afterR.status === 200) ok("C3: GET /api/leads/:id/contacts returns 200 after link");
      else                        bad("C3: GET returns 200 after link", `got ${afterR.status}`);

      if (hasContact(after, CONTACT_ID))
        ok(`C1: contact ${CONTACT_ID} present with populated .contact data (inArray works)`);
      else
        bad(`C1: contact ${CONTACT_ID} present with .contact data`,
          `rows=${JSON.stringify(after)} — inArray may still be broken`);

      // Also confirm contactId field is present at all
      const row = Array.isArray(after) && after.find(r =>
        r.contactId === CONTACT_ID || r.contact_id === CONTACT_ID || r.contact?.id === CONTACT_ID);
      if (row) ok("C1: contact row found in response");
      else      bad("C1: contact row found", `got ${JSON.stringify(after)}`);

      // Verify DB row was actually written
      const { rowCount } = await pool.query(
        `SELECT 1 FROM lead_contacts WHERE lead_id=$1 AND contact_id=$2`, [LEAD_ID, CONTACT_ID]);
      if (rowCount > 0) ok("C1: lead_contacts row exists in DB");
      else               bad("C1: lead_contacts row in DB", "row not found");
    }

    // ─── C6: Lead page-refresh simulation ───────────────────────────────
    console.log("\n── C6: Lead contact persists on simulated page refresh ──");
    {
      const r1   = await api(cookie, `/api/leads/${LEAD_ID}/contacts`);
      const rows1 = await r1.json();
      console.log(`  2nd GET: status=${r1.status}, count=${Array.isArray(rows1) ? rows1.length : "?"}`);
      if (hasContact(rows1, CONTACT_ID)) ok("C6: contact present on 2nd GET (page-refresh simulation)");
      else                                bad("C6: contact present on 2nd GET", JSON.stringify(rows1));
    }

    // ─── C5: Duplicate link does not break the panel ─────────────────────
    console.log("\n── C5: Duplicate lead contact link does not crash or break GET ──");
    {
      const dupR    = await api(cookie, `/api/leads/${LEAD_ID}/contacts`, {
        method: "POST",
        body: JSON.stringify({ contactId: CONTACT_ID }),
      });
      const dupBody = await dupR.json();
      console.log(`  duplicate POST status=${dupR.status}, body=${JSON.stringify(dupBody)}`);
      // Any non-500 status is acceptable (201 / 200 if idempotent, 409 if unique constraint)
      if (dupR.status !== 500) ok(`C5: duplicate POST does not 500 (got ${dupR.status})`);
      else                      bad("C5: duplicate POST does not 500", `got 500: ${JSON.stringify(dupBody)}`);

      // GET must still work and return the contact
      const afterDupR = await api(cookie, `/api/leads/${LEAD_ID}/contacts`);
      const afterDup  = await afterDupR.json();
      console.log(`  GET after dup: status=${afterDupR.status}, count=${Array.isArray(afterDup) ? afterDup.length : "?"}`);
      if (afterDupR.status === 200)      ok("C5: GET still returns 200 after duplicate POST");
      else                                bad("C5: GET returns 200 after dup", `got ${afterDupR.status}`);
      const found = Array.isArray(afterDup) && afterDup.some(r =>
        r.contactId === CONTACT_ID || r.contact_id === CONTACT_ID || r.contact?.id === CONTACT_ID);
      if (found) ok("C5: contact still in GET after duplicate link attempt");
      else        bad("C5: contact in GET after dup", JSON.stringify(afterDup));
    }

    // ─── C2 / C4: Account contact link ──────────────────────────────────
    console.log("\n── C2/C4: Account — POST link → immediate GET returns contact ──");
    {
      // Before
      const preR = await api(cookie, `/api/accounts/${ACCOUNT_ID}/contacts`);
      const pre  = await preR.json();
      console.log(`  before: GET status=${preR.status}, count=${Array.isArray(pre) ? pre.length : "?"}`);
      if (preR.status === 200) ok("C2/C4-pre: GET /api/accounts/:id/contacts returns 200");
      else                      bad("C2/C4-pre: GET returns 200", `got ${preR.status}`);

      // POST
      const linkR    = await api(cookie, `/api/accounts/${ACCOUNT_ID}/contacts`, {
        method: "POST",
        body: JSON.stringify({ contactId: CONTACT_ID }),
      });
      const linkBody = await linkR.json();
      console.log(`  POST status=${linkR.status}, body=${JSON.stringify(linkBody)}`);
      if (linkR.status === 201 || linkR.status === 200)
        ok(`C4: POST /api/accounts/:id/contacts returns ${linkR.status}`);
      else
        bad("C4: POST returns 2xx", `got ${linkR.status}: ${JSON.stringify(linkBody)}`);

      // Immediate GET — must include contact with populated .contact object
      const afterR = await api(cookie, `/api/accounts/${ACCOUNT_ID}/contacts`);
      const after  = await afterR.json();
      console.log(`  after:  GET status=${afterR.status}, count=${Array.isArray(after) ? after.length : "?"}`);
      console.log(`  rows:   ${JSON.stringify(after?.slice?.(0, 3))}`);

      if (afterR.status === 200) ok("C4: GET /api/accounts/:id/contacts returns 200 after link");
      else                        bad("C4: GET returns 200", `got ${afterR.status}`);

      // getAccountContacts synthesizes "primary" rows for contacts whose home account matches.
      // So we look for either a join row (contactId) or a primary row (contact.id).
      const found = Array.isArray(after) && after.some(r =>
        r.contactId === CONTACT_ID || r.contact_id === CONTACT_ID || r.contact?.id === CONTACT_ID);
      if (found)
        ok(`C2: contact ${CONTACT_ID} present in GET immediately after account link (inArray works)`);
      else
        bad(`C2: contact ${CONTACT_ID} present in account GET`, `rows=${JSON.stringify(after?.slice?.(0, 5))}`);

      // Verify DB row
      const { rowCount } = await pool.query(
        `SELECT 1 FROM account_contacts WHERE account_id=$1 AND contact_id=$2`, [ACCOUNT_ID, CONTACT_ID]);
      if (rowCount > 0) ok("C2: account_contacts row exists in DB");
      else               bad("C2: account_contacts row in DB", "row not found");
    }

    // ─── C7: Account page-refresh simulation ────────────────────────────
    console.log("\n── C7: Account contact persists on simulated page refresh ──");
    {
      const r2   = await api(cookie, `/api/accounts/${ACCOUNT_ID}/contacts`);
      const rows2 = await r2.json();
      console.log(`  2nd GET: status=${r2.status}, count=${Array.isArray(rows2) ? rows2.length : "?"}`);
      const found = Array.isArray(rows2) && rows2.some(r =>
        r.contactId === CONTACT_ID || r.contact_id === CONTACT_ID || r.contact?.id === CONTACT_ID);
      if (found) ok("C7: account contact present on 2nd GET (page-refresh simulation)");
      else        bad("C7: account contact on 2nd GET", JSON.stringify(rows2?.slice?.(0, 3)));
    }

  } catch (err) {
    console.error("FATAL:", err.message, err.stack?.split("\n")[1]);
    failed++;
  } finally {
    // Cleanup test rows
    await pool.query(
      `DELETE FROM lead_contacts    WHERE lead_id=$1    AND contact_id=$2`,
      [LEAD_ID, CONTACT_ID]).catch(() => {});
    await pool.query(
      `DELETE FROM account_contacts WHERE account_id=$1 AND contact_id=$2`,
      [ACCOUNT_ID, CONTACT_ID]).catch(() => {});
    await pool.end();

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) process.exit(1);
  }
}

main();
