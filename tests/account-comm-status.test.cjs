#!/usr/bin/env node
/**
 * §A — Account commStatus contact-path expansion
 *
 * Verifies that an account reachable only via a linked contact's thread
 * (NOT via primary_account_id) still appears under the "recently_contacted"
 * commStatus filter and is excluded from "never_contacted".
 *
 * Mirrors tests/lead-comm-status.test.cjs §L2.
 *
 * A1. Account with NO thread, no contacts → appears under never_contacted,
 *     absent from recently_contacted
 * A2. Account whose linked contact owns a recent thread (contact-path only) →
 *     appears under recently_contacted, absent from never_contacted
 * A3. Account with a direct thread (primary_account_id) →
 *     appears under recently_contacted, absent from never_contacted
 * A4. Account with a stale thread → appears under stale, absent from recently_contacted
 *
 * All rows are synthetic and cleaned up in the finally block.
 * Run: node tests/account-comm-status.test.cjs
 */
"use strict";
const pg = require("pg");

const BASE        = "http://localhost:5000";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PWD   = "alberni1444";

// Unique prefix so we can search only our test accounts
const PREFIX = `__acs_${Date.now()}__`;

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
  let acctNoneId   = null;   // no thread, no contacts
  let acctViaCtId  = null;   // thread via contact only (contact-path)
  let acctDirectId = null;   // thread via primary_account_id (direct path)
  let acctStaleId  = null;   // stale thread (> 30 days)
  let contactId    = null;
  const threadGuids = [];

  console.log(`=== Account commStatus contact-path expansion ===`);
  console.log(`  prefix=${PREFIX}\n`);

  try {
    const cookie = await login();
    console.log("  authenticated as admin\n");

    // ── Insert synthetic accounts ─────────────────────────────────────────

    const ins = async (suffix) => {
      const r = await pool.query(
        `INSERT INTO accounts (name, segment, org_type)
         VALUES ($1, 'test', 'other') RETURNING id`,
        [`${PREFIX}${suffix}`]
      );
      return r.rows[0].id;
    };

    [acctNoneId, acctViaCtId, acctDirectId, acctStaleId] = await Promise.all([
      ins("none"), ins("via_ct"), ins("direct"), ins("stale"),
    ]);

    // Contact linked to acctViaCtId via account_contacts
    const ctRow = await pool.query(
      `INSERT INTO contacts (account_id, name, email)
       VALUES ($1, '${PREFIX}contact', '${PREFIX}@testacct.invalid') RETURNING id`,
      [acctViaCtId]
    );
    contactId = ctRow.rows[0].id;

    await pool.query(
      `INSERT INTO account_contacts (account_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [acctViaCtId, contactId]
    );

    // Thread for contact-path account (primary_contact_id set, primary_account_id NULL)
    const g1 = `${PREFIX}t_ct`;
    threadGuids.push(g1);
    await pool.query(
      `INSERT INTO email_threads (gmail_thread_id, primary_contact_id, primary_account_id,
                                   last_outbound_at, created_at, updated_at)
       VALUES ($1, $2, NULL, NOW(), NOW(), NOW()) ON CONFLICT (gmail_thread_id) DO NOTHING`,
      [g1, contactId]
    );

    // Thread for direct account (primary_account_id set)
    const g2 = `${PREFIX}t_direct`;
    threadGuids.push(g2);
    await pool.query(
      `INSERT INTO email_threads (gmail_thread_id, primary_account_id,
                                   last_outbound_at, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW(), NOW()) ON CONFLICT (gmail_thread_id) DO NOTHING`,
      [g2, acctDirectId]
    );

    // Stale thread (60 days ago)
    const g3 = `${PREFIX}t_stale`;
    threadGuids.push(g3);
    await pool.query(
      `INSERT INTO email_threads (gmail_thread_id, primary_account_id,
                                   last_outbound_at, created_at, updated_at)
       VALUES ($1, $2, NOW() - INTERVAL '60 days', NOW() - INTERVAL '60 days', NOW() - INTERVAL '60 days')
       ON CONFLICT (gmail_thread_id) DO NOTHING`,
      [g3, acctStaleId]
    );

    console.log(`  accounts: none=${acctNoneId} via_ct=${acctViaCtId} direct=${acctDirectId} stale=${acctStaleId}`);
    console.log(`  contact=${contactId}  threads: ${threadGuids.join(", ")}\n`);

    // ── Helper: fetch account IDs for a commStatus, scoped to our PREFIX ──
    async function fetchIds(commStatus) {
      const url = `/api/accounts?search=${encodeURIComponent(PREFIX)}&commStatus=${commStatus}&limit=20`;
      const r   = await api(cookie, url);
      if (!r.ok) throw new Error(`GET ${url} → ${r.status}: ${await r.text()}`);
      const body = await r.json();
      const rows = body.data ?? body;
      return new Set(rows.map(a => a.id));
    }

    // ── A1: Account with no thread and no contacts → never_contacted ──────
    console.log("── A1: no-thread / no-contact account ──");
    {
      const neverIds  = await fetchIds("never_contacted");
      const recentIds = await fetchIds("recently_contacted");

      if (neverIds.has(acctNoneId))
        ok("A1a: no-thread account appears in never_contacted");
      else
        bad("A1a: no-thread account in never_contacted", `id=${acctNoneId} not found; set=${[...neverIds]}`);

      if (!recentIds.has(acctNoneId))
        ok("A1b: no-thread account absent from recently_contacted");
      else
        bad("A1b: no-thread account absent from recently_contacted", `id=${acctNoneId} incorrectly present`);
    }

    // ── A2: Contact-path thread (THE CORE FIX) ────────────────────────────
    console.log("\n── A2: contact-path thread (core fix) ──");
    {
      const recentIds = await fetchIds("recently_contacted");
      const neverIds  = await fetchIds("never_contacted");

      if (recentIds.has(acctViaCtId))
        ok("A2a: contact-path account appears in recently_contacted ← core fix");
      else
        bad("A2a: contact-path account in recently_contacted", `id=${acctViaCtId}; set=${[...recentIds]}`);

      if (!neverIds.has(acctViaCtId))
        ok("A2b: contact-path account absent from never_contacted");
      else
        bad("A2b: contact-path account absent from never_contacted", `id=${acctViaCtId} incorrectly present`);
    }

    // ── A3: Direct-path thread ─────────────────────────────────────────────
    console.log("\n── A3: direct-path thread ──");
    {
      const recentIds = await fetchIds("recently_contacted");
      const neverIds  = await fetchIds("never_contacted");

      if (recentIds.has(acctDirectId))
        ok("A3a: direct-path account in recently_contacted");
      else
        bad("A3a: direct-path account in recently_contacted", `id=${acctDirectId}`);

      if (!neverIds.has(acctDirectId))
        ok("A3b: direct-path account absent from never_contacted");
      else
        bad("A3b: direct-path account absent from never_contacted", `id=${acctDirectId}`);
    }

    // ── A4: Stale thread ───────────────────────────────────────────────────
    console.log("\n── A4: stale thread ──");
    {
      const staleIds  = await fetchIds("stale");
      const recentIds = await fetchIds("recently_contacted");

      if (staleIds.has(acctStaleId))
        ok("A4a: stale-thread account appears in stale filter");
      else
        bad("A4a: stale-thread account in stale filter", `id=${acctStaleId}; set=${[...staleIds]}`);

      if (!recentIds.has(acctStaleId))
        ok("A4b: stale-thread account absent from recently_contacted");
      else
        bad("A4b: stale-thread account absent from recently_contacted", `id=${acctStaleId}`);
    }

  } catch (err) {
    console.error("FATAL:", err.message, err.stack?.split("\n")[1]);
    failed++;
  } finally {
    // Clean up in reverse dependency order
    for (const g of threadGuids) {
      await pool.query(`DELETE FROM email_threads WHERE gmail_thread_id = $1`, [g]).catch(() => {});
    }
    if (contactId) await pool.query(`DELETE FROM account_contacts WHERE contact_id = $1`, [contactId]).catch(() => {});
    if (contactId) await pool.query(`DELETE FROM contacts WHERE id = $1`, [contactId]).catch(() => {});
    for (const id of [acctNoneId, acctViaCtId, acctDirectId, acctStaleId].filter(Boolean)) {
      await pool.query(`DELETE FROM accounts WHERE id = $1`, [id]).catch(() => {});
    }
    await pool.end();

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) process.exit(1);
  }
}

main();
