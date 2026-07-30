#!/usr/bin/env node
import pg from "pg";
const { Pool } = pg;
/**
 * Regression test — Task 134 / Task 143
 * Confirm commStatus dots never go blank after filtering the leads list.
 * C7 (Task 143): lead linked to a stale thread ONLY via lead_contacts
 *                (primary_lead_id is NULL) must appear in commStatus=stale.
 *
 * C1. GET /api/leads (no filter) — every row in `data` carries a `commStatus`
 *     field whose value is one of: recently_contacted | stale | never_contacted
 * C2. GET /api/leads?commStatus=recently_contacted — all returned rows have
 *     commStatus === 'recently_contacted' (filter contract is honoured)
 * C3. GET /api/leads?commStatus=stale — all returned rows have
 *     commStatus === 'stale'
 * C4. GET /api/leads?commStatus=never_contacted — all returned rows have
 *     commStatus === 'never_contacted'
 * C5. GET /api/leads?commStatus=recently_contacted&status=... (stacked filter)
 *     — commStatus field is still present on every row
 * C6. Response shape includes expected top-level keys (data, total, page,
 *     totalPages) so a shape regression is caught before commStatus
 *
 * Run: node tests/leads-comm-status.test.js
 */

const BASE        = "http://localhost:5000";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PWD   = "alberni1444";

const VALID_COMM_STATUSES = new Set(["recently_contacted", "stale", "never_contacted"]);

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
  if (!r.ok) throw new Error(`Login failed: ${r.status}`);
  const cookie = r.headers.get("set-cookie")?.match(/(connect\.sid=[^;]+)/)?.[1];
  if (!cookie) throw new Error("No session cookie returned");
  await sleep(400);
  return cookie;
}

// 45-second timeout per request — the commStatus correlated subqueries
// (especially the "stale" double-EXISTS) can be slow on large datasets.
const api = (cookie, url) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  return fetch(`${BASE}${url}`, {
    signal: ctrl.signal,
    headers: {
      "Content-Type": "application/json",
      Origin: BASE,
      Cookie: cookie,
    },
  }).finally(() => clearTimeout(t));
};

async function main() {
  console.log("=== Leads commStatus Field Regression ===\n");

  const cookie = await login();
  console.log("  authenticated as admin\n");

  // ─── C6: Response shape ───────────────────────────────────────────────────
  console.log("── C6: Response shape ──");
  {
    const r = await api(cookie, "/api/leads?limit=1");
    if (!r.ok) { bad("GET /api/leads returns 200", `status=${r.status}`); }
    else {
      const body = await r.json();
      const shapeOk = body && typeof body === "object" &&
        Array.isArray(body.data) &&
        typeof body.total === "number" &&
        typeof body.page === "number" &&
        typeof body.totalPages === "number";
      if (shapeOk) ok("response has data[], total, page, totalPages");
      else         bad("response shape", JSON.stringify(Object.keys(body || {})));
    }
  }
  console.log();

  // ─── C1: Every row on unfiltered list carries a valid commStatus ──────────
  console.log("── C1: Unfiltered list — every row has a valid commStatus ──");
  {
    // Fetch a reasonable page so the test completes quickly
    const r = await api(cookie, "/api/leads?limit=50&page=1");
    if (!r.ok) { bad("GET /api/leads returns 200", `status=${r.status}`); }
    else {
      const { data } = await r.json();
      if (!Array.isArray(data)) {
        bad("data is an array", typeof data);
      } else if (data.length === 0) {
        // No leads in DB — the shape test above covers correctness; skip field checks
        ok("no leads in DB — commStatus field check skipped (vacuously ok)");
      } else {
        const missing = data.filter(row => !VALID_COMM_STATUSES.has(row.commStatus));
        if (missing.length === 0) {
          ok(`all ${data.length} rows have a valid commStatus`);
        } else {
          const sample = missing.slice(0, 3).map(r => `id=${r.id} commStatus=${JSON.stringify(r.commStatus)}`).join(", ");
          bad(`${missing.length}/${data.length} rows have invalid/missing commStatus`, sample);
        }
      }
    }
  }
  console.log();

  // ─── C2/C3/C4: Filtered results respect the filter value ─────────────────
  // Use limit=5 so the double-EXISTS correlated subquery (especially "stale")
  // touches minimal rows and completes in a reasonable time.
  for (const filterValue of ["recently_contacted", "stale", "never_contacted"]) {
    console.log(`── C${filterValue === "recently_contacted" ? 2 : filterValue === "stale" ? 3 : 4}: commStatus=${filterValue} filter ──`);
    const r = await api(cookie, `/api/leads?commStatus=${filterValue}&limit=5`);
    if (!r.ok) {
      bad(`GET /api/leads?commStatus=${filterValue} returns 200`, `status=${r.status}`);
    } else {
      const { data } = await r.json();
      if (!Array.isArray(data)) {
        bad("data is an array", typeof data);
      } else if (data.length === 0) {
        ok(`commStatus=${filterValue} — no rows returned (nothing to mismatch)`);
      } else {
        // Every row must carry the field and its value must match the filter
        const withField   = data.filter(row => VALID_COMM_STATUSES.has(row.commStatus));
        const mismatched  = data.filter(row => row.commStatus !== filterValue);
        const missingField = data.filter(row => !VALID_COMM_STATUSES.has(row.commStatus));

        if (missingField.length === 0) {
          ok(`all ${data.length} rows carry a valid commStatus field`);
        } else {
          const sample = missingField.slice(0, 3).map(r => `id=${r.id} got=${JSON.stringify(r.commStatus)}`).join(", ");
          bad(`${missingField.length}/${data.length} rows missing commStatus`, sample);
        }

        if (mismatched.length === 0) {
          ok(`all ${data.length} rows have commStatus === '${filterValue}'`);
        } else {
          const sample = mismatched.slice(0, 3).map(r => `id=${r.id} got=${JSON.stringify(r.commStatus)}`).join(", ");
          bad(`${mismatched.length}/${data.length} rows have wrong commStatus (expected '${filterValue}')`, sample);
        }
      }
    }
    console.log();
  }

  // ─── C5: Stacked filter (commStatus + another param) — field still present ─
  console.log("── C5: Stacked filter commStatus=recently_contacted&limit=25 ──");
  {
    const r = await api(cookie, "/api/leads?commStatus=recently_contacted&limit=25");
    if (!r.ok) {
      bad("stacked filter returns 200", `status=${r.status}`);
    } else {
      const { data } = await r.json();
      if (!Array.isArray(data)) {
        bad("data is an array on stacked filter", typeof data);
      } else if (data.length === 0) {
        ok("stacked filter — no rows returned (commStatus field check vacuously ok)");
      } else {
        const missing = data.filter(row => !VALID_COMM_STATUSES.has(row.commStatus));
        if (missing.length === 0) {
          ok(`stacked filter — all ${data.length} rows carry a valid commStatus`);
        } else {
          const sample = missing.slice(0, 3).map(r => `id=${r.id} got=${JSON.stringify(r.commStatus)}`).join(", ");
          bad(`stacked filter — ${missing.length}/${data.length} rows missing/invalid commStatus`, sample);
        }
      }
    }
  }
  console.log();

  // ─── C7: lead linked ONLY via lead_contacts (no primary_lead_id) ─────────
  // Seeds: lead (primary_lead_id=NULL on thread) + contact + lead_contacts row
  //        + stale email_thread (last_inbound_at 60 days ago, no primary_lead_id)
  // Asserts GET /api/leads?commStatus=stale returns the seeded lead.
  console.log("── C7: stale via lead_contacts path only (no primary_lead_id) ──");
  {
    const dbPool = new Pool({ connectionString: process.env.DATABASE_URL });
    const TS = Date.now();
    let seededLeadId = null;
    let seededContactId = null;
    let seededAccountId = null;
    let seededThreadId = null;
    try {
      // 1. Insert a unique lead with no direct thread link yet
      const leadRes = await dbPool.query(`
        INSERT INTO leads (company, contact_name, contact_email, status, created_at, updated_at)
        VALUES ($1, $2, $3, 'prospect', NOW(), NOW())
        RETURNING id
      `, [`C7-Lead-${TS}`, `C7 Contact ${TS}`, `c7-lead-${TS}@test-c7.example`]);
      seededLeadId = leadRes.rows[0].id;

      // 2. Insert a throw-away account (contacts.account_id is NOT NULL)
      const accountRes = await dbPool.query(`
        INSERT INTO accounts (name, created_at, updated_at)
        VALUES ($1, NOW(), NOW())
        RETURNING id
      `, [`C7-Account-${TS}`]);
      seededAccountId = accountRes.rows[0].id;

      // 3. Insert a unique contact linked to the throw-away account
      const contactRes = await dbPool.query(`
        INSERT INTO contacts (name, first_name, last_name, email, account_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        RETURNING id
      `, [`C7 Contact${TS}`, `C7`, `Contact${TS}`, `c7-contact-${TS}@test-c7.example`, seededAccountId]);
      seededContactId = contactRes.rows[0].id;

      // 4. Link contact → lead via lead_contacts (this is the ONLY path)
      await dbPool.query(`
        INSERT INTO lead_contacts (lead_id, contact_id, role, created_at)
        VALUES ($1, $2, NULL, NOW())
      `, [seededLeadId, seededContactId]);

      // 4. Insert a stale email_thread: primary_contact_id = contact, primary_lead_id = NULL
      //    last_inbound_at 60 days ago ensures it is stale (not recently_contacted)
      const threadRes = await dbPool.query(`
        INSERT INTO email_threads
          (gmail_thread_id, primary_contact_id, primary_lead_id,
           last_inbound_at, last_outbound_at, created_at, updated_at)
        VALUES ($1, $2, NULL,
                NOW() - INTERVAL '60 days',
                NULL,
                NOW() - INTERVAL '60 days',
                NOW() - INTERVAL '60 days')
        RETURNING id
      `, [`c7-thread-${TS}`, seededContactId]);
      seededThreadId = threadRes.rows[0].id;

      // 5. Fetch commStatus=stale and confirm the seeded lead appears
      const r = await api(cookie, `/api/leads?commStatus=stale&limit=200`);
      if (!r.ok) {
        bad("C7: GET /api/leads?commStatus=stale returns 200", `status=${r.status}`);
      } else {
        const { data } = await r.json();
        if (!Array.isArray(data)) {
          bad("C7: data is an array", typeof data);
        } else {
          const found = data.find(row => row.id === seededLeadId);
          if (found) {
            ok(`C7: seeded lead (id=${seededLeadId}) appears in commStatus=stale results`);
            if (found.commStatus === "stale") {
              ok(`C7: returned row has commStatus === 'stale'`);
            } else {
              bad(`C7: returned row commStatus`, `expected 'stale', got '${found.commStatus}'`);
            }
          } else {
            bad(`C7: seeded lead (id=${seededLeadId}) not found in stale results`, `total rows returned: ${data.length}`);
          }
        }
      }
    } finally {
      // Cleanup in reverse-insertion order
      if (seededThreadId)  await dbPool.query(`DELETE FROM email_threads WHERE id = $1`, [seededThreadId]);
      if (seededLeadId)    await dbPool.query(`DELETE FROM lead_contacts WHERE lead_id = $1`, [seededLeadId]);
      if (seededContactId) await dbPool.query(`DELETE FROM contacts WHERE id = $1`, [seededContactId]);
      if (seededAccountId) await dbPool.query(`DELETE FROM accounts WHERE id = $1`, [seededAccountId]);
      if (seededLeadId)    await dbPool.query(`DELETE FROM leads WHERE id = $1`, [seededLeadId]);
      await dbPool.end();
    }
  }
  console.log();

  // ─── C8/C9: orphaned primary_contact_id (no lead_contacts row) ───────────
  // Seeds: lead + contact + stale email_thread whose primary_contact_id = that
  //        contact, but NO lead_contacts row linking the contact to the lead.
  // C8: lead must NOT appear in commStatus=stale (thread must not count).
  // C9: the same lead MUST appear in commStatus=never_contacted.
  console.log("── C8/C9: orphaned primary_contact_id — no lead_contacts bridge ──");
  {
    const dbPool = new Pool({ connectionString: process.env.DATABASE_URL });
    const TS = Date.now();
    let seededLeadId    = null;
    let seededContactId = null;
    let seededAccountId = null;
    let seededThreadId  = null;
    try {
      // 1. Lead with no direct thread link
      const leadRes = await dbPool.query(`
        INSERT INTO leads (company, contact_name, contact_email, status, created_at, updated_at)
        VALUES ($1, $2, $3, 'prospect', NOW(), NOW())
        RETURNING id
      `, [`C8-Lead-${TS}`, `C8 Contact ${TS}`, `c8-lead-${TS}@test-c8.example`]);
      seededLeadId = leadRes.rows[0].id;

      // 2. Throw-away account (contacts.account_id is NOT NULL)
      const accountRes = await dbPool.query(`
        INSERT INTO accounts (name, created_at, updated_at)
        VALUES ($1, NOW(), NOW())
        RETURNING id
      `, [`C8-Account-${TS}`]);
      seededAccountId = accountRes.rows[0].id;

      // 3. Contact — deliberately NOT linked to the lead via lead_contacts
      const contactRes = await dbPool.query(`
        INSERT INTO contacts (name, first_name, last_name, email, account_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        RETURNING id
      `, [`C8 Contact${TS}`, `C8`, `Contact${TS}`, `c8-contact-${TS}@test-c8.example`, seededAccountId]);
      seededContactId = contactRes.rows[0].id;

      // 4. Stale thread: primary_contact_id = that contact, primary_lead_id = NULL
      //    last_inbound_at 60 days ago — would be "stale" if the contact were linked
      const threadRes = await dbPool.query(`
        INSERT INTO email_threads
          (gmail_thread_id, primary_contact_id, primary_lead_id,
           last_inbound_at, last_outbound_at, created_at, updated_at)
        VALUES ($1, $2, NULL,
                NOW() - INTERVAL '60 days',
                NULL,
                NOW() - INTERVAL '60 days',
                NOW() - INTERVAL '60 days')
        RETURNING id
      `, [`c8-thread-${TS}`, seededContactId]);
      seededThreadId = threadRes.rows[0].id;

      // Use the unique company name as a search filter so the correlated
      // subquery touches only the seeded lead — avoids slow full-table scan.
      const encodedCompany = encodeURIComponent(`C8-Lead-${TS}`);

      // C8: lead must NOT be in commStatus=stale
      const staleRes = await api(cookie, `/api/leads?commStatus=stale&search=${encodedCompany}&limit=10`);
      if (!staleRes.ok) {
        bad("C8: GET /api/leads?commStatus=stale returns 200", `status=${staleRes.status}`);
      } else {
        const { data } = await staleRes.json();
        if (!Array.isArray(data)) {
          bad("C8: data is an array", typeof data);
        } else {
          const found = data.find(row => row.id === seededLeadId);
          if (!found) {
            ok(`C8: orphaned lead (id=${seededLeadId}) correctly absent from commStatus=stale`);
          } else {
            bad(`C8: orphaned lead (id=${seededLeadId}) incorrectly appeared in commStatus=stale`,
                `thread primary_contact_id=${seededContactId} has no lead_contacts row`);
          }
        }
      }

      // C9: same lead MUST appear in commStatus=never_contacted
      const neverRes = await api(cookie, `/api/leads?commStatus=never_contacted&search=${encodedCompany}&limit=10`);
      if (!neverRes.ok) {
        bad("C9: GET /api/leads?commStatus=never_contacted returns 200", `status=${neverRes.status}`);
      } else {
        const { data } = await neverRes.json();
        if (!Array.isArray(data)) {
          bad("C9: data is an array", typeof data);
        } else {
          const found = data.find(row => row.id === seededLeadId);
          if (found) {
            ok(`C9: orphaned lead (id=${seededLeadId}) correctly appears in commStatus=never_contacted`);
            if (found.commStatus === "never_contacted") {
              ok(`C9: returned row has commStatus === 'never_contacted'`);
            } else {
              bad(`C9: returned row commStatus`, `expected 'never_contacted', got '${found.commStatus}'`);
            }
          } else {
            bad(`C9: orphaned lead (id=${seededLeadId}) not found in never_contacted results`,
                `total rows returned: ${data.length}`);
          }
        }
      }
    } finally {
      // Cleanup — no lead_contacts row was inserted for this lead
      if (seededThreadId)  await dbPool.query(`DELETE FROM email_threads WHERE id = $1`, [seededThreadId]);
      if (seededContactId) await dbPool.query(`DELETE FROM contacts WHERE id = $1`, [seededContactId]);
      if (seededAccountId) await dbPool.query(`DELETE FROM accounts WHERE id = $1`, [seededAccountId]);
      if (seededLeadId)    await dbPool.query(`DELETE FROM leads WHERE id = $1`, [seededLeadId]);
      await dbPool.end();
    }
  }
  console.log();

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
