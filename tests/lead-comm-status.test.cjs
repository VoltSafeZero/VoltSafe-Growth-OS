#!/usr/bin/env node
/**
 * §L — Lead commStatus contact-path expansion
 *
 * Verifies that a lead reachable only via a linked contact's thread
 * (NOT via primary_lead_id) still appears under the "recently_contacted"
 * commStatus filter and is excluded from "never_contacted".
 *
 * Uses a unique search prefix so queries are scoped to test rows only,
 * avoiding full-table scans on the large leads table.
 *
 * L1. Lead with NO thread, no contacts → appears under never_contacted,
 *     absent from recently_contacted
 * L2. Lead whose linked contact owns a recent thread (contact-path only) →
 *     appears under recently_contacted, absent from never_contacted
 * L3. Lead with a direct thread (primary_lead_id) →
 *     appears under recently_contacted, absent from never_contacted
 * L4. Lead with a stale thread → appears under stale, absent from recently_contacted
 *
 * All rows are synthetic and cleaned up in the finally block.
 * Run: node tests/lead-comm-status.test.cjs
 */
"use strict";
const pg = require("pg");

const BASE        = "http://localhost:5000";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PWD   = "alberni1444";

// Unique prefix so we can search only our test leads
const PREFIX = `__tcs_${Date.now()}__`;

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
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  // Track inserted IDs for cleanup
  let leadNoneId    = null;   // no thread, no contacts
  let leadViaCtId   = null;   // thread via contact only (contact-path)
  let leadDirectId  = null;   // thread via primary_lead_id (direct path)
  let leadStaleId   = null;   // stale thread (> 30 days)
  let leadMultiA    = null;   // L5: first lead linked to shared contact
  let leadMultiB    = null;   // L5: second lead linked to same shared contact
  let leadUnlinkId  = null;   // L6: lead whose contact link will be removed mid-test
  let contactId     = null;
  let contactMultiId = null;  // L5: contact shared across two leads
  let contactUnlinkId = null; // L6: contact that will be unlinked from the lead
  const threadGuids = [];

  console.log(`=== Lead commStatus contact-path expansion ===`);
  console.log(`  prefix=${PREFIX}\n`);

  try {
    const cookie = await login();
    console.log("  authenticated as admin\n");

    // ── Insert synthetic leads ────────────────────────────────────────────

    const ins = async (suffix) => {
      const r = await pool.query(
        `INSERT INTO leads (company, contact_name, source, status, country)
         VALUES ($1, 'Test', 'test', 'new', 'US') RETURNING id`,
        [`${PREFIX}${suffix}`]
      );
      return r.rows[0].id;
    };

    [leadNoneId, leadViaCtId, leadDirectId, leadStaleId] = await Promise.all([
      ins("none"), ins("via_ct"), ins("direct"), ins("stale"),
    ]);

    // Contact linked to leadViaCtId
    const ctRow = await pool.query(
      `INSERT INTO contacts (account_id, name, email)
       VALUES (1, '${PREFIX}contact', '${PREFIX}@testlead.invalid') RETURNING id`
    );
    contactId = ctRow.rows[0].id;

    await pool.query(
      `INSERT INTO lead_contacts (lead_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [leadViaCtId, contactId]
    );

    // Thread for contact-path lead (primary_contact_id set, primary_lead_id NULL)
    const g1 = `${PREFIX}t_ct`;
    threadGuids.push(g1);
    await pool.query(
      `INSERT INTO email_threads (gmail_thread_id, primary_contact_id, primary_lead_id,
                                   last_outbound_at, created_at, updated_at)
       VALUES ($1, $2, NULL, NOW(), NOW(), NOW()) ON CONFLICT (gmail_thread_id) DO NOTHING`,
      [g1, contactId]
    );

    // Thread for direct lead (primary_lead_id set)
    const g2 = `${PREFIX}t_direct`;
    threadGuids.push(g2);
    await pool.query(
      `INSERT INTO email_threads (gmail_thread_id, primary_lead_id,
                                   last_outbound_at, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW(), NOW()) ON CONFLICT (gmail_thread_id) DO NOTHING`,
      [g2, leadDirectId]
    );

    // Stale thread (60 days ago)
    const g3 = `${PREFIX}t_stale`;
    threadGuids.push(g3);
    await pool.query(
      `INSERT INTO email_threads (gmail_thread_id, primary_lead_id,
                                   last_outbound_at, created_at, updated_at)
       VALUES ($1, $2, NOW() - INTERVAL '60 days', NOW() - INTERVAL '60 days', NOW() - INTERVAL '60 days')
       ON CONFLICT (gmail_thread_id) DO NOTHING`,
      [g3, leadStaleId]
    );

    // ── L6 setup: lead whose contact will be unlinked mid-test ───────────
    leadUnlinkId = await ins("unlink");

    const ctUnlinkRow = await pool.query(
      `INSERT INTO contacts (account_id, name, email)
       VALUES (1, '${PREFIX}unlink_contact', '${PREFIX}unlink@testlead.invalid') RETURNING id`
    );
    contactUnlinkId = ctUnlinkRow.rows[0].id;

    await pool.query(
      `INSERT INTO lead_contacts (lead_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [leadUnlinkId, contactUnlinkId]
    );

    const gUnlink = `${PREFIX}t_unlink`;
    threadGuids.push(gUnlink);
    await pool.query(
      `INSERT INTO email_threads (gmail_thread_id, primary_contact_id, primary_lead_id,
                                   last_outbound_at, created_at, updated_at)
       VALUES ($1, $2, NULL, NOW(), NOW(), NOW()) ON CONFLICT (gmail_thread_id) DO NOTHING`,
      [gUnlink, contactUnlinkId]
    );

    // ── L5 setup: two leads sharing one contact, one thread ──────────────
    [leadMultiA, leadMultiB] = await Promise.all([ins("multi_a"), ins("multi_b")]);

    const ctMultiRow = await pool.query(
      `INSERT INTO contacts (account_id, name, email)
       VALUES (1, '${PREFIX}multi_contact', '${PREFIX}multi@testlead.invalid') RETURNING id`
    );
    contactMultiId = ctMultiRow.rows[0].id;

    await pool.query(
      `INSERT INTO lead_contacts (lead_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [leadMultiA, contactMultiId]
    );
    await pool.query(
      `INSERT INTO lead_contacts (lead_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [leadMultiB, contactMultiId]
    );

    // Single thread whose primary_contact_id is the shared contact
    const gMulti = `${PREFIX}t_multi`;
    threadGuids.push(gMulti);
    await pool.query(
      `INSERT INTO email_threads (gmail_thread_id, primary_contact_id, primary_lead_id,
                                   last_outbound_at, created_at, updated_at)
       VALUES ($1, $2, NULL, NOW(), NOW(), NOW()) ON CONFLICT (gmail_thread_id) DO NOTHING`,
      [gMulti, contactMultiId]
    );

    console.log(`  leads: none=${leadNoneId} via_ct=${leadViaCtId} direct=${leadDirectId} stale=${leadStaleId}`);
    console.log(`  multi leads: a=${leadMultiA} b=${leadMultiB} contact=${contactMultiId}`);
    console.log(`  unlink lead: id=${leadUnlinkId} contact=${contactUnlinkId}`);
    console.log(`  contact=${contactId}  threads: ${threadGuids.join(", ")}\n`);

    // ── Helper: fetch lead IDs for a commStatus, scoped to our PREFIX ─────
    async function fetchIds(commStatus) {
      // search param scopes to our test rows; limit=20 is plenty
      const url = `/api/leads?search=${encodeURIComponent(PREFIX)}&commStatus=${commStatus}&limit=20`;
      const r   = await api(cookie, url);
      if (!r.ok) throw new Error(`GET ${url} → ${r.status}: ${await r.text()}`);
      const body = await r.json();
      const rows = body.data ?? body;
      return new Set(rows.map(l => l.id));
    }

    // ── L1: Lead with no thread and no contacts → never_contacted ─────────
    console.log("── L1: no-thread / no-contact lead ──");
    {
      const neverIds  = await fetchIds("never_contacted");
      const recentIds = await fetchIds("recently_contacted");

      if (neverIds.has(leadNoneId))
        ok("L1a: no-thread lead appears in never_contacted");
      else
        bad("L1a: no-thread lead in never_contacted", `id=${leadNoneId} not found; set=${[...neverIds]}`);

      if (!recentIds.has(leadNoneId))
        ok("L1b: no-thread lead absent from recently_contacted");
      else
        bad("L1b: no-thread lead absent from recently_contacted", `id=${leadNoneId} incorrectly present`);
    }

    // ── L2: Contact-path thread (THE CORE FIX) ───────────────────────────
    console.log("\n── L2: contact-path thread (core fix) ──");
    {
      const recentIds = await fetchIds("recently_contacted");
      const neverIds  = await fetchIds("never_contacted");

      if (recentIds.has(leadViaCtId))
        ok("L2a: contact-path lead appears in recently_contacted ← core fix");
      else
        bad("L2a: contact-path lead in recently_contacted", `id=${leadViaCtId}; set=${[...recentIds]}`);

      if (!neverIds.has(leadViaCtId))
        ok("L2b: contact-path lead absent from never_contacted");
      else
        bad("L2b: contact-path lead absent from never_contacted", `id=${leadViaCtId} incorrectly present`);
    }

    // ── L3: Direct-path thread ───────────────────────────────────────────
    console.log("\n── L3: direct-path thread ──");
    {
      const recentIds = await fetchIds("recently_contacted");
      const neverIds  = await fetchIds("never_contacted");

      if (recentIds.has(leadDirectId))
        ok("L3a: direct-path lead in recently_contacted");
      else
        bad("L3a: direct-path lead in recently_contacted", `id=${leadDirectId}`);

      if (!neverIds.has(leadDirectId))
        ok("L3b: direct-path lead absent from never_contacted");
      else
        bad("L3b: direct-path lead absent from never_contacted", `id=${leadDirectId}`);
    }

    // ── L4: Stale thread ─────────────────────────────────────────────────
    console.log("\n── L4: stale thread ──");
    {
      const staleIds  = await fetchIds("stale");
      const recentIds = await fetchIds("recently_contacted");

      if (staleIds.has(leadStaleId))
        ok("L4a: stale-thread lead appears in stale filter");
      else
        bad("L4a: stale-thread lead in stale filter", `id=${leadStaleId}; set=${[...staleIds]}`);

      if (!recentIds.has(leadStaleId))
        ok("L4b: stale-thread lead absent from recently_contacted");
      else
        bad("L4b: stale-thread lead absent from recently_contacted", `id=${leadStaleId}`);
    }

    // ── L5: One contact linked to two leads — both must appear ───────────
    // This pins the behavior that the contact-path subquery has no LIMIT,
    // so ALL leads that share a contacted contact are correctly surfaced.
    console.log("\n── L5: one contact linked to two leads (multi-lead contact-path) ──");
    {
      const recentIds = await fetchIds("recently_contacted");
      const neverIds  = await fetchIds("never_contacted");

      if (recentIds.has(leadMultiA))
        ok("L5a: first lead (multi_a) appears in recently_contacted via shared contact");
      else
        bad("L5a: first lead (multi_a) in recently_contacted", `id=${leadMultiA}; set=${[...recentIds]}`);

      if (recentIds.has(leadMultiB))
        ok("L5b: second lead (multi_b) appears in recently_contacted via shared contact");
      else
        bad("L5b: second lead (multi_b) in recently_contacted", `id=${leadMultiB}; set=${[...recentIds]}`);

      if (!neverIds.has(leadMultiA))
        ok("L5c: first lead (multi_a) absent from never_contacted");
      else
        bad("L5c: first lead (multi_a) absent from never_contacted", `id=${leadMultiA} incorrectly present`);

      if (!neverIds.has(leadMultiB))
        ok("L5d: second lead (multi_b) absent from never_contacted");
      else
        bad("L5d: second lead (multi_b) absent from never_contacted", `id=${leadMultiB} incorrectly present`);
    }

    // ── L6: Remove contact from lead mid-session → reverts to never_contacted
    // Pins the delete-path: once lead_contacts row is removed, the contact-path
    // subquery finds no matching threads and commStatus must drop to never_contacted.
    console.log("\n── L6: unlink contact from lead (mid-session delete) ──");
    {
      // Pre-unlink: lead should appear under recently_contacted via contact path
      const recentBefore = await fetchIds("recently_contacted");
      const neverBefore  = await fetchIds("never_contacted");

      if (recentBefore.has(leadUnlinkId))
        ok("L6a: pre-unlink lead appears in recently_contacted");
      else
        bad("L6a: pre-unlink lead in recently_contacted", `id=${leadUnlinkId}; set=${[...recentBefore]}`);

      if (!neverBefore.has(leadUnlinkId))
        ok("L6b: pre-unlink lead absent from never_contacted");
      else
        bad("L6b: pre-unlink lead absent from never_contacted", `id=${leadUnlinkId} incorrectly present`);

      // Simulate mid-session removal: delete the lead_contacts row
      await pool.query(
        `DELETE FROM lead_contacts WHERE lead_id = $1 AND contact_id = $2`,
        [leadUnlinkId, contactUnlinkId]
      );

      // Post-unlink: lead has no linked threads → must appear under never_contacted
      const recentAfter = await fetchIds("recently_contacted");
      const neverAfter  = await fetchIds("never_contacted");

      if (neverAfter.has(leadUnlinkId))
        ok("L6c: post-unlink lead appears in never_contacted");
      else
        bad("L6c: post-unlink lead in never_contacted", `id=${leadUnlinkId}; set=${[...neverAfter]}`);

      if (!recentAfter.has(leadUnlinkId))
        ok("L6d: post-unlink lead absent from recently_contacted");
      else
        bad("L6d: post-unlink lead absent from recently_contacted", `id=${leadUnlinkId} incorrectly present`);
    }

  } catch (err) {
    console.error("FATAL:", err.message, err.stack?.split("\n")[1]);
    failed++;
  } finally {
    // Clean up in reverse dependency order
    for (const g of threadGuids) {
      await pool.query(`DELETE FROM email_threads WHERE gmail_thread_id = $1`, [g]).catch(() => {});
    }
    if (contactId)       await pool.query(`DELETE FROM lead_contacts WHERE contact_id = $1`, [contactId]).catch(() => {});
    if (contactId)       await pool.query(`DELETE FROM contacts WHERE id = $1`, [contactId]).catch(() => {});
    if (contactMultiId)  await pool.query(`DELETE FROM lead_contacts WHERE contact_id = $1`, [contactMultiId]).catch(() => {});
    if (contactMultiId)  await pool.query(`DELETE FROM contacts WHERE id = $1`, [contactMultiId]).catch(() => {});
    // L6: lead_contacts row may already be gone (deleted by the test itself); contact + lead still need cleanup
    if (contactUnlinkId) await pool.query(`DELETE FROM lead_contacts WHERE contact_id = $1`, [contactUnlinkId]).catch(() => {});
    if (contactUnlinkId) await pool.query(`DELETE FROM contacts WHERE id = $1`, [contactUnlinkId]).catch(() => {});
    for (const id of [leadNoneId, leadViaCtId, leadDirectId, leadStaleId, leadMultiA, leadMultiB, leadUnlinkId].filter(Boolean)) {
      await pool.query(`DELETE FROM leads WHERE id = $1`, [id]).catch(() => {});
    }
    await pool.end();

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) process.exit(1);
  }
}

main();
