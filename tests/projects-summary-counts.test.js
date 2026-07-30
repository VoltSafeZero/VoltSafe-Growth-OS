#!/usr/bin/env node
/**
 * Task 144 — projects/summary stat counts stay accurate after edits/deletes
 *
 * C1. Create overdue project → summary.overdue increases → mark completed → overdue decreases
 * C2. Create no-owner project → summary.missing_owner increases → assign owner → count decreases
 * C3. Delete an overdue project → overdue count decreases
 * C4. Delete a no-owner project → missing_owner count decreases
 * C5. Completed / cancelled projects are excluded from both counts
 * C6. summary always returns numeric fields (never null / undefined)
 *
 * Note: endDate is a timestamp column; we create projects via API (no end date),
 * then set end_date to a past value directly via SQL to make them overdue.
 *
 * Run: node tests/projects-summary-counts.test.js
 */
import pg from "pg";

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
  await sleep(300);
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

async function getSummary(cookie) {
  const r = await api(cookie, "/api/projects/summary");
  if (!r.ok) throw new Error(`GET /api/projects/summary → ${r.status}`);
  return r.json();
}

async function createProject(cookie, body) {
  const r = await api(cookie, "/api/projects", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`POST /api/projects → ${r.status}: ${t}`);
  }
  return r.json();
}

async function updateProject(cookie, id, body) {
  const r = await api(cookie, `/api/projects/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`PUT /api/projects/${id} → ${r.status}: ${t}`);
  }
  return r.json();
}

async function deleteProject(cookie, id) {
  const r = await api(cookie, `/api/projects/${id}`, { method: "DELETE" });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`DELETE /api/projects/${id} → ${r.status}: ${t}`);
  }
}

// Set end_date to a past value directly in DB (API passes timestamp through
// Drizzle which requires a Date object, not a JSON string — easiest to bypass).
async function makeOverdue(pool, id) {
  await pool.query(
    `UPDATE projects SET end_date = NOW() - INTERVAL '2 days' WHERE id = $1`,
    [id]
  );
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const createdIds = [];

  console.log("=== Projects Summary Counts Regression ===\n");

  try {
    const cookie = await login();
    console.log("  authenticated as admin\n");

    // Owner user id — trevor's user id; find from DB
    const ownerRows = await pool.query(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      [ADMIN_EMAIL]
    );
    const ownerId = ownerRows.rows[0]?.id;
    if (!ownerId) throw new Error("Could not find admin user id");

    // ────────────────────────────────────────────────────────────────────────
    // C6 — baseline: summary fields are always numeric
    // ────────────────────────────────────────────────────────────────────────
    console.log("── C6: summary fields are numeric ──");
    {
      const s = await getSummary(cookie);
      const allNumeric =
        typeof s.active === "number" &&
        typeof s.overdue === "number" &&
        typeof s.missing_owner === "number";
      if (allNumeric) ok("overdue, missing_owner, active are all numbers");
      else bad("summary fields should be numbers", JSON.stringify(s));
    }

    // ────────────────────────────────────────────────────────────────────────
    // C1 — overdue: create → set past end_date → verify → complete → verify decrease
    // ────────────────────────────────────────────────────────────────────────
    console.log("\n── C1: overdue count decreases after project is marked completed ──");
    {
      const before = await getSummary(cookie);

      const p = await createProject(cookie, {
        name: `[TEST-144] Overdue ${Date.now()}`,
        type: "pilot",
        status: "active",
        ownerUserId: ownerId,
      });
      createdIds.push(p.id);

      // Set past end_date via SQL to make it overdue
      await makeOverdue(pool, p.id);

      const after = await getSummary(cookie);
      if (after.overdue > before.overdue)
        ok(`overdue increased from ${before.overdue} → ${after.overdue} after creating overdue project`);
      else
        bad("overdue should increase after creating an overdue active project", `before=${before.overdue} after=${after.overdue}`);

      // Mark it completed — should drop out of overdue count
      await updateProject(cookie, p.id, { status: "completed" });

      const resolved = await getSummary(cookie);
      if (resolved.overdue <= before.overdue)
        ok(`overdue returned to ${resolved.overdue} (≤ baseline ${before.overdue}) after marking completed`);
      else
        bad("overdue should decrease after project is marked completed", `baseline=${before.overdue} after=${resolved.overdue}`);
    }

    // ────────────────────────────────────────────────────────────────────────
    // C2 — missing_owner: create no-owner → verify → assign owner → verify decrease
    // ────────────────────────────────────────────────────────────────────────
    console.log("\n── C2: missing_owner count decreases after owner is assigned ──");
    {
      const before = await getSummary(cookie);

      const p = await createProject(cookie, {
        name: `[TEST-144] NoOwner ${Date.now()}`,
        type: "pilot",
        status: "active",
        // deliberately no ownerUserId
      });
      createdIds.push(p.id);

      const after = await getSummary(cookie);
      if (after.missing_owner > before.missing_owner)
        ok(`missing_owner increased from ${before.missing_owner} → ${after.missing_owner}`);
      else
        bad("missing_owner should increase after creating a no-owner project", `before=${before.missing_owner} after=${after.missing_owner}`);

      // Assign an owner via PUT
      await updateProject(cookie, p.id, { ownerUserId: ownerId });

      const resolved = await getSummary(cookie);
      if (resolved.missing_owner <= before.missing_owner)
        ok(`missing_owner returned to ${resolved.missing_owner} (≤ baseline ${before.missing_owner}) after owner assigned`);
      else
        bad("missing_owner should decrease after owner is assigned", `baseline=${before.missing_owner} after=${resolved.missing_owner}`);
    }

    // ────────────────────────────────────────────────────────────────────────
    // C3 — delete overdue project → overdue decreases
    // ────────────────────────────────────────────────────────────────────────
    console.log("\n── C3: overdue count decreases after overdue project is deleted ──");
    {
      const before = await getSummary(cookie);

      const p = await createProject(cookie, {
        name: `[TEST-144] DeleteOverdue ${Date.now()}`,
        type: "pilot",
        status: "active",
        ownerUserId: ownerId,
      });
      createdIds.push(p.id);
      await makeOverdue(pool, p.id);

      const after = await getSummary(cookie);
      if (after.overdue > before.overdue)
        ok(`overdue increased from ${before.overdue} → ${after.overdue} before delete`);
      else
        bad("overdue should increase after creating overdue project", `before=${before.overdue} after=${after.overdue}`);

      await deleteProject(cookie, p.id);
      const idx = createdIds.indexOf(p.id);
      if (idx !== -1) createdIds.splice(idx, 1);

      const resolved = await getSummary(cookie);
      if (resolved.overdue <= before.overdue)
        ok(`overdue back to ${resolved.overdue} after delete`);
      else
        bad("overdue should decrease after overdue project is deleted", `baseline=${before.overdue} after=${resolved.overdue}`);
    }

    // ────────────────────────────────────────────────────────────────────────
    // C4 — delete no-owner project → missing_owner decreases
    // ────────────────────────────────────────────────────────────────────────
    console.log("\n── C4: missing_owner count decreases after no-owner project is deleted ──");
    {
      const before = await getSummary(cookie);

      const p = await createProject(cookie, {
        name: `[TEST-144] DeleteNoOwner ${Date.now()}`,
        type: "pilot",
        status: "active",
      });
      createdIds.push(p.id);

      const after = await getSummary(cookie);
      if (after.missing_owner > before.missing_owner)
        ok(`missing_owner increased from ${before.missing_owner} → ${after.missing_owner} before delete`);
      else
        bad("missing_owner should increase", `before=${before.missing_owner} after=${after.missing_owner}`);

      await deleteProject(cookie, p.id);
      const idx = createdIds.indexOf(p.id);
      if (idx !== -1) createdIds.splice(idx, 1);

      const resolved = await getSummary(cookie);
      if (resolved.missing_owner <= before.missing_owner)
        ok(`missing_owner back to ${resolved.missing_owner} after delete`);
      else
        bad("missing_owner should decrease after no-owner project is deleted", `baseline=${before.missing_owner} after=${resolved.missing_owner}`);
    }

    // ────────────────────────────────────────────────────────────────────────
    // C5 — completed / cancelled projects are excluded from overdue + missing_owner
    // ────────────────────────────────────────────────────────────────────────
    console.log("\n── C5: completed / cancelled projects are excluded from overdue and missing_owner ──");
    {
      const before = await getSummary(cookie);

      // overdue-but-completed — should NOT appear in overdue count
      const pCompleted = await createProject(cookie, {
        name: `[TEST-144] CompletedOverdue ${Date.now()}`,
        type: "pilot",
        status: "completed",
        ownerUserId: ownerId,
      });
      createdIds.push(pCompleted.id);
      await makeOverdue(pool, pCompleted.id);

      // cancelled + no owner — should NOT appear in missing_owner count
      const pCancelled = await createProject(cookie, {
        name: `[TEST-144] CancelledNoOwner ${Date.now()}`,
        type: "pilot",
        status: "cancelled",
      });
      createdIds.push(pCancelled.id);

      const after = await getSummary(cookie);

      if (after.overdue === before.overdue)
        ok("completed overdue project does NOT inflate overdue count");
      else
        bad("completed project should be excluded from overdue", `before=${before.overdue} after=${after.overdue}`);

      if (after.missing_owner === before.missing_owner)
        ok("cancelled no-owner project does NOT inflate missing_owner count");
      else
        bad("cancelled project should be excluded from missing_owner", `before=${before.missing_owner} after=${after.missing_owner}`);
    }

  } catch (err) {
    bad("unexpected error", err.message);
    console.error(err);
  } finally {
    // Cleanup all projects created during this test
    if (createdIds.length > 0) {
      try {
        await pool.query(
          `DELETE FROM projects WHERE id = ANY($1::int[])`,
          [createdIds]
        );
        console.log(`\n  [cleanup] deleted test project ids: ${createdIds.join(", ")}`);
      } catch (e) {
        console.warn(`  [cleanup] warning: ${e.message}`);
      }
    }
    await pool.end();

    console.log(`\n${"─".repeat(48)}`);
    console.log(`  passed: ${passed}  failed: ${failed}`);
    console.log(`${"─".repeat(48)}`);
    process.exit(failed > 0 ? 1 : 0);
  }
}

main();
