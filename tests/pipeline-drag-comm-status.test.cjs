#!/usr/bin/env node
/**
 * Task 135 — Confirm commStatus dot stays visible on pipeline cards
 *             after dragging a lead to a new stage.
 *
 * Dragging a card calls onUpdateStatus → PUT /api/leads/:id { status }
 * → onSuccess invalidates ["/api/leads"] → full re-fetch of the board.
 * If commStatus is lost or reset during that cycle the dot disappears.
 *
 * D1. recently_contacted lead dragged to a new stage
 *     → commStatus still "recently_contacted" in re-fetch
 * D2. stale lead dragged to a new stage
 *     → commStatus still "stale" in re-fetch
 * D3. never_contacted lead dragged to a new stage
 *     → commStatus still "never_contacted" in re-fetch
 * D4. PUT /api/leads/:id returns commStatus in the response body
 *     (so optimistic-update callers also see the right value)
 * D5. commStatus is present on every row of GET /api/leads after drag
 *     (no row silently drops the field to null / undefined)
 * D6. Stage field is updated correctly after the drag (sanity check)
 * D7. commStatus filter still works after a drag
 *     (the status column change must not invalidate the filter index)
 *
 * All rows are synthetic and cleaned up in the finally block.
 * Run: node tests/pipeline-drag-comm-status.test.cjs
 */
"use strict";
const pg = require("pg");

const BASE        = "http://localhost:5000";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PWD   = "alberni1444";

// Unique prefix scopes every INSERT/search to this test run only
const PREFIX = `__pdc_${Date.now()}__`;

// Pipeline stages used for the drag (start → target)
const STAGE_FROM = "new";
const STAGE_TO   = "contacted";

const VALID_COMM_STATUSES = new Set(["recently_contacted", "stale", "never_contacted"]);

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
  if (!cookie) throw new Error("No session cookie");
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

  let leadRecentId   = null;  // recently_contacted: recent thread
  let leadStaleId    = null;  // stale: old thread
  let leadNeverId    = null;  // never_contacted: no thread
  const threadGuids  = [];
  let contactId      = null;

  console.log("=== Pipeline Drag commStatus Persistence ===");
  console.log(`  prefix=${PREFIX}\n`);

  try {
    const cookie = await login();
    console.log("  authenticated as admin\n");

    // ── Insert synthetic leads ──────────────────────────────────────────────
    const ins = async (suffix) => {
      const r = await pool.query(
        `INSERT INTO leads (company, contact_name, source, status, country)
         VALUES ($1, 'Test', 'test', $2, 'US') RETURNING id`,
        [`${PREFIX}${suffix}`, STAGE_FROM]
      );
      return r.rows[0].id;
    };

    [leadRecentId, leadStaleId, leadNeverId] = await Promise.all([
      ins("recent"),
      ins("stale"),
      ins("never"),
    ]);

    // Contact linked to leadRecentId (recent thread via contact-path)
    const ctRow = await pool.query(
      `INSERT INTO contacts (account_id, name, email)
       VALUES (1, '${PREFIX}ct', '${PREFIX}@drag.invalid') RETURNING id`
    );
    contactId = ctRow.rows[0].id;

    await pool.query(
      `INSERT INTO lead_contacts (lead_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [leadRecentId, contactId]
    );

    // Recent thread (< 30 days) → recently_contacted
    const gRecent = `${PREFIX}t_recent`;
    threadGuids.push(gRecent);
    await pool.query(
      `INSERT INTO email_threads (gmail_thread_id, primary_contact_id, primary_lead_id,
                                   last_outbound_at, created_at, updated_at)
       VALUES ($1, $2, NULL, NOW() - INTERVAL '5 days', NOW(), NOW())
       ON CONFLICT (gmail_thread_id) DO NOTHING`,
      [gRecent, contactId]
    );

    // Stale thread (> 30 days) → stale
    const gStale = `${PREFIX}t_stale`;
    threadGuids.push(gStale);
    await pool.query(
      `INSERT INTO email_threads (gmail_thread_id, primary_lead_id,
                                   last_outbound_at, created_at, updated_at)
       VALUES ($1, $2, NOW() - INTERVAL '60 days', NOW() - INTERVAL '60 days', NOW() - INTERVAL '60 days')
       ON CONFLICT (gmail_thread_id) DO NOTHING`,
      [gStale, leadStaleId]
    );

    // No thread for leadNeverId → never_contacted

    console.log(`  leads: recent=${leadRecentId} stale=${leadStaleId} never=${leadNeverId}`);
    console.log(`  contact=${contactId}  threads: ${threadGuids.join(", ")}\n`);

    // ── Helper: fetch leads scoped to PREFIX ────────────────────────────────
    async function fetchLeads(extraParams = "") {
      const url = `/api/leads?search=${encodeURIComponent(PREFIX)}&limit=20${extraParams}`;
      const r   = await api(cookie, url);
      if (!r.ok) throw new Error(`GET ${url} → ${r.status}: ${await r.text()}`);
      const body = await r.json();
      return body.data ?? body;
    }

    // ── Helper: simulate drag (PUT /api/leads/:id { status }) ──────────────
    async function drag(id, newStage) {
      const r = await api(cookie, `/api/leads/${id}`, {
        method: "PUT",
        body: JSON.stringify({ status: newStage }),
      });
      if (!r.ok) throw new Error(`PUT /api/leads/${id} → ${r.status}: ${await r.text()}`);
      return r.json();
    }

    // ════════════════════════════════════════════════════════════════════════
    // D1 — recently_contacted survives drag
    // ════════════════════════════════════════════════════════════════════════
    console.log("── D1: recently_contacted survives drag ──");
    {
      const putBody = await drag(leadRecentId, STAGE_TO);

      // D4 (checked here for recently_contacted): PUT response includes commStatus
      if (VALID_COMM_STATUSES.has(putBody.commStatus)) {
        ok(`D4a: PUT response includes commStatus="${putBody.commStatus}" (recently_contacted lead)`);
      } else {
        bad("D4a: PUT response includes commStatus", `got "${putBody.commStatus}"`);
      }

      const rows = await fetchLeads();
      const lead = rows.find(l => l.id === leadRecentId);

      if (!lead) {
        bad("D1a: lead still appears in list after drag", `id=${leadRecentId} missing`);
      } else if (lead.commStatus === "recently_contacted") {
        ok("D1a: commStatus === recently_contacted after drag");
      } else {
        bad("D1a: commStatus === recently_contacted after drag", `got "${lead.commStatus}"`);
      }

      // D6: stage updated correctly
      if (!lead) {
        bad("D6a: stage updated to contacted", "lead missing");
      } else if (lead.status === STAGE_TO) {
        ok("D6a: stage updated to contacted after drag");
      } else {
        bad("D6a: stage updated to contacted after drag", `got "${lead.status}"`);
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // D2 — stale survives drag
    // ════════════════════════════════════════════════════════════════════════
    console.log("\n── D2: stale survives drag ──");
    {
      const putBody = await drag(leadStaleId, STAGE_TO);

      if (VALID_COMM_STATUSES.has(putBody.commStatus)) {
        ok(`D4b: PUT response includes commStatus="${putBody.commStatus}" (stale lead)`);
      } else {
        bad("D4b: PUT response includes commStatus", `got "${putBody.commStatus}"`);
      }

      const rows = await fetchLeads();
      const lead = rows.find(l => l.id === leadStaleId);

      if (!lead) {
        bad("D2a: stale lead still appears in list after drag", `id=${leadStaleId} missing`);
      } else if (lead.commStatus === "stale") {
        ok("D2a: commStatus === stale after drag");
      } else {
        bad("D2a: commStatus === stale after drag", `got "${lead.commStatus}"`);
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // D3 — never_contacted survives drag
    // ════════════════════════════════════════════════════════════════════════
    console.log("\n── D3: never_contacted survives drag ──");
    {
      const putBody = await drag(leadNeverId, STAGE_TO);

      if (VALID_COMM_STATUSES.has(putBody.commStatus)) {
        ok(`D4c: PUT response includes commStatus="${putBody.commStatus}" (never_contacted lead)`);
      } else {
        bad("D4c: PUT response includes commStatus", `got "${putBody.commStatus}"`);
      }

      const rows = await fetchLeads();
      const lead = rows.find(l => l.id === leadNeverId);

      if (!lead) {
        bad("D3a: never_contacted lead still appears in list after drag", `id=${leadNeverId} missing`);
      } else if (lead.commStatus === "never_contacted") {
        ok("D3a: commStatus === never_contacted after drag");
      } else {
        bad("D3a: commStatus === never_contacted after drag", `got "${lead.commStatus}"`);
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // D5 — every row in post-drag list has a valid commStatus
    // ════════════════════════════════════════════════════════════════════════
    console.log("\n── D5: all rows carry commStatus after drag ──");
    {
      const rows = await fetchLeads();
      const missing = rows.filter(l => !VALID_COMM_STATUSES.has(l.commStatus));
      if (missing.length === 0) {
        ok(`D5: all ${rows.length} test rows have a valid commStatus field`);
      } else {
        bad(
          "D5: every test row has valid commStatus",
          `${missing.length} row(s) missing/invalid: ${missing.map(l => `id=${l.id} val="${l.commStatus}"`).join(", ")}`
        );
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // D7 — commStatus filter still returns the right rows after drag
    // ════════════════════════════════════════════════════════════════════════
    console.log("\n── D7: commStatus filter works after drag ──");
    {
      // recently_contacted filter must include leadRecentId
      const recentRows  = await fetchLeads("&commStatus=recently_contacted");
      const recentIds   = new Set(recentRows.map(l => l.id));
      if (recentIds.has(leadRecentId)) {
        ok("D7a: recently_contacted filter still includes recently-contacted lead after drag");
      } else {
        bad("D7a: recently_contacted filter includes recently-contacted lead after drag",
          `id=${leadRecentId} not in set; set=${[...recentIds]}`);
      }

      // stale filter must include leadStaleId
      const staleRows = await fetchLeads("&commStatus=stale");
      const staleIds  = new Set(staleRows.map(l => l.id));
      if (staleIds.has(leadStaleId)) {
        ok("D7b: stale filter still includes stale lead after drag");
      } else {
        bad("D7b: stale filter includes stale lead after drag",
          `id=${leadStaleId} not in set; set=${[...staleIds]}`);
      }

      // never_contacted filter must include leadNeverId
      const neverRows = await fetchLeads("&commStatus=never_contacted");
      const neverIds  = new Set(neverRows.map(l => l.id));
      if (neverIds.has(leadNeverId)) {
        ok("D7c: never_contacted filter still includes never-contacted lead after drag");
      } else {
        bad("D7c: never_contacted filter includes never-contacted lead after drag",
          `id=${leadNeverId} not in set; set=${[...neverIds]}`);
      }

      // Cross-check: recently_contacted filter must NOT include the stale lead
      if (!recentIds.has(leadStaleId)) {
        ok("D7d: stale lead absent from recently_contacted filter after drag");
      } else {
        bad("D7d: stale lead absent from recently_contacted filter after drag",
          `id=${leadStaleId} incorrectly present`);
      }
    }

  } catch (err) {
    console.error("FATAL:", err.message, err.stack?.split("\n")[1]);
    failed++;
  } finally {
    // Clean up in reverse dependency order
    for (const g of threadGuids) {
      await pool.query(`DELETE FROM email_threads WHERE gmail_thread_id = $1`, [g]).catch(() => {});
    }
    if (contactId) {
      await pool.query(`DELETE FROM lead_contacts WHERE contact_id = $1`, [contactId]).catch(() => {});
      await pool.query(`DELETE FROM contacts WHERE id = $1`, [contactId]).catch(() => {});
    }
    for (const id of [leadRecentId, leadStaleId, leadNeverId].filter(Boolean)) {
      await pool.query(`DELETE FROM leads WHERE id = $1`, [id]).catch(() => {});
    }
    await pool.end();

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) process.exit(1);
  }
}

main();
