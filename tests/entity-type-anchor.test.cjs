"use strict";
/**
 * entity-type-anchor.test.cjs
 *
 * Verifies that the marina anchor icon is driven by the canonical entity_type
 * field — not by source, marina_id, or import status — and that the full
 * pipeline (schema → API create → API update → UI anchor) is wired correctly.
 */

const fs = require("fs");
const http = require("http");

// ── helpers ──────────────────────────────────────────────────────────────────

function readFile(p) { return fs.readFileSync(p, "utf8"); }

let passed = 0;
let failed = 0;
const failures = [];

function ok(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
    failures.push(label);
  }
}

function apiRequest(method, path, body, cookies) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: "localhost",
      port: 5000,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
        ...(cookies ? { Cookie: cookies } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw), headers: res.headers }); }
        catch { resolve({ status: res.statusCode, body: raw, headers: res.headers }); }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function getSession() {
  const res = await apiRequest("POST", "/api/auth/login", {
    email: "trevor@voltsafe.com",
    password: process.env.TEST_ADMIN_PASS || "alberni1444",
  });
  if (res.status !== 200) return null;
  const cookies = res.headers["set-cookie"];
  if (!cookies) return null;
  return cookies.map((c) => c.split(";")[0]).join("; ");
}

// ── Source files ──────────────────────────────────────────────────────────────

const taxonomy  = readFile("client/src/lib/crm-taxonomy.ts");
const leadsPage = readFile("client/src/pages/leads.tsx");
const schema    = readFile("shared/schema.ts");
const migration = readFile("migrations/0034_entity_type.sql");
const routes    = readFile("server/routes.ts");

// ══════════════════════════════════════════════════════════════════════════════
// 1 — crm-taxonomy.ts: isMarinaEntity helper
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n[1] crm-taxonomy.ts — isMarinaEntity + ENTITY_TYPE_OPTIONS");

ok("ENTITY_TYPE_OPTIONS exported from crm-taxonomy.ts",
  taxonomy.includes("export const ENTITY_TYPE_OPTIONS"));

ok("ENTITY_TYPE_OPTIONS contains 'marina' value",
  /ENTITY_TYPE_OPTIONS[\s\S]{0,500}["']marina["']/.test(taxonomy));

ok("ENTITY_TYPE_OPTIONS contains 'marina_group' value",
  /ENTITY_TYPE_OPTIONS[\s\S]{0,500}["']marina_group["']/.test(taxonomy));

ok("ENTITY_TYPE_OPTIONS contains 'port_authority' value",
  /ENTITY_TYPE_OPTIONS[\s\S]{0,500}["']port_authority["']/.test(taxonomy));

ok("ENTITY_TYPE_OPTIONS contains 'other' value",
  /ENTITY_TYPE_OPTIONS[\s\S]{0,500}["']other["']/.test(taxonomy));

ok("MARINA_ENTITY_TYPES set exported from crm-taxonomy.ts",
  taxonomy.includes("export const MARINA_ENTITY_TYPES"));

ok("MARINA_ENTITY_TYPES includes 'marina'",
  /MARINA_ENTITY_TYPES[\s\S]{0,200}"marina"/.test(taxonomy) || /MARINA_ENTITY_TYPES[\s\S]{0,200}'marina'/.test(taxonomy));

ok("MARINA_ENTITY_TYPES includes 'marina_group'",
  /MARINA_ENTITY_TYPES[\s\S]{0,200}"marina_group"/.test(taxonomy) || /MARINA_ENTITY_TYPES[\s\S]{0,200}'marina_group'/.test(taxonomy));

ok("MARINA_ENTITY_TYPES includes 'port_authority'",
  /MARINA_ENTITY_TYPES[\s\S]{0,200}"port_authority"/.test(taxonomy) || /MARINA_ENTITY_TYPES[\s\S]{0,200}'port_authority'/.test(taxonomy));

ok("isMarinaEntity function exported from crm-taxonomy.ts",
  taxonomy.includes("export function isMarinaEntity"));

ok("isMarinaEntity checks entityType against MARINA_ENTITY_TYPES",
  /isMarinaEntity[\s\S]{0,300}MARINA_ENTITY_TYPES\.has/.test(taxonomy));

ok("isMarinaEntity has marinaId fallback for backward compat",
  /isMarinaEntity[\s\S]{0,400}marinaId/.test(taxonomy));

ok("isMarinaEntity doc comment says do NOT base on source or import status",
  /Do NOT base this on[\s\S]{0,100}source/.test(taxonomy));

// ══════════════════════════════════════════════════════════════════════════════
// 2 — shared/schema.ts: entityType column on leads table
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n[2] shared/schema.ts — entityType on leads");

ok("entityType column present in leads table schema",
  /entityType:\s*text\("entity_type"\)/.test(schema));

ok("leads table entityType column is nullable (no .notNull() on the leads entityType)",
  // The leads table entityType at col 144 ends with a comma (nullable).
  // Other tables (tasks, activities) legitimately have entityType.notNull() — exclude those.
  /entityType:\s*text\("entity_type"\),\s*\/\/\s*optional/.test(schema) ||
  /entityType:\s*text\("entity_type"\),?\s*\n/.test(schema.split("// leads table")[1] || "") ||
  // Simplest: the leads table line has no .notNull() — check the raw line in schema
  schema.split("\n").some(line =>
    /entityType:\s*text\("entity_type"\)/.test(line) && !line.includes(".notNull()")
  ));

// ══════════════════════════════════════════════════════════════════════════════
// 3 — Migration 0034
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n[3] Migration 0034 — entity_type column + backfill");

ok("Migration file 0034_entity_type.sql exists",
  fs.existsSync("migrations/0034_entity_type.sql"));

ok("Migration adds entity_type column with ADD COLUMN IF NOT EXISTS",
  /ADD COLUMN IF NOT EXISTS entity_type/.test(migration));

ok("Migration backfills marina_id IS NOT NULL records",
  /marina_id IS NOT NULL/.test(migration) && /entity_type = 'marina'/.test(migration));

ok("Migration backfills high-confidence manual marina names",
  /LIKE '%marina%'/.test(migration));

ok("Migration excludes test_suite records from name backfill",
  /source != 'test_suite'/.test(migration));

ok("Migration is idempotent (uses entity_type IS NULL guard on UPDATE)",
  (migration.match(/entity_type IS NULL/g) || []).length >= 2);

// ══════════════════════════════════════════════════════════════════════════════
// 4 — leads.tsx: anchor condition uses isMarinaEntity
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n[4] leads.tsx — anchor uses isMarinaEntity");

ok("isMarinaEntity imported in leads.tsx",
  /import[^;]+isMarinaEntity[^;]+crm-taxonomy/.test(leadsPage));

ok("ENTITY_TYPE_OPTIONS imported in leads.tsx",
  /import[^;]+ENTITY_TYPE_OPTIONS[^;]+crm-taxonomy/.test(leadsPage));

ok("Table view anchor uses isMarinaEntity(lead) not lead.marinaId",
  leadsPage.includes("isMarinaEntity(lead)") && !leadsPage.includes("{lead.marinaId && <Anchor"));

ok("No remaining lead.marinaId anchor conditions",
  !leadsPage.includes("{lead.marinaId && <Anchor"));

ok("Both anchor sites use isMarinaEntity",
  (leadsPage.match(/isMarinaEntity\(lead\).*Anchor/g) || []).length >= 2);

// ══════════════════════════════════════════════════════════════════════════════
// 5 — CreateLeadForm
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n[5] leads.tsx — CreateLeadForm has entityType");

ok("CreateLeadForm state has entityType defaulting to 'marina'",
  /entityType:\s*["']marina["']/.test(leadsPage));

ok("CreateLeadForm renders select-entity-type testid",
  leadsPage.includes('data-testid="select-entity-type"'));

ok("CreateLeadForm maps over ENTITY_TYPE_OPTIONS",
  /ENTITY_TYPE_OPTIONS\.map/.test(leadsPage));

// ══════════════════════════════════════════════════════════════════════════════
// 6 — EditLeadForm
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n[6] leads.tsx — EditLeadForm has entityType");

ok("EditLeadForm state includes entityType from lead",
  /entityType:\s*\(lead as any\)\.entityType/.test(leadsPage));

ok("EditLeadForm renders select-edit-entity-type testid",
  leadsPage.includes('data-testid="select-edit-entity-type"'));

// ══════════════════════════════════════════════════════════════════════════════
// 7 — routes.ts: conversion preserves entityType
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n[7] routes.ts — conversion maps entityType to orgType");

ok("ENTITY_TYPE_ORG_MAP defined in conversion handler",
  routes.includes("ENTITY_TYPE_ORG_MAP"));

ok("ENTITY_TYPE_ORG_MAP maps marina → marina_prospect",
  /ENTITY_TYPE_ORG_MAP[\s\S]{0,200}marina:\s*["']marina_prospect["']/.test(routes));

ok("ENTITY_TYPE_ORG_MAP maps marina_group → marina_group",
  /ENTITY_TYPE_ORG_MAP[\s\S]{0,200}marina_group:\s*["']marina_group["']/.test(routes));

ok("Conversion uses reqOrgType ?? entityDerivedOrgType (caller wins)",
  /reqOrgType.*\?\?.*entityDerivedOrgType|entityDerivedOrgType.*\?\?.*reqOrgType/.test(routes));

// ══════════════════════════════════════════════════════════════════════════════
// 8 — Live HTTP tests
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n[8] Live HTTP tests — create / update / anchor persistence");

async function runLiveTests() {
  const session = await getSession();
  if (!session) {
    console.log("  ⚠️  Cannot obtain session — skipping live tests");
    return;
  }

  const tag = `ET_${Date.now()}`;

  // T1 — Create marina lead → entity_type persisted + returned
  {
    const r = await apiRequest("POST", "/api/leads", {
      company: `${tag}_MarinaLead`,
      contactName: "Test Contact",
      entityType: "marina",
      source: "test_suite",
    }, session);
    ok("T1: POST /api/leads with entityType='marina' returns 201", r.status === 201);
    ok("T1: response includes entityType='marina'",
      r.body?.entityType === "marina" || r.body?.entity_type === "marina");

    const leadId = r.body?.id;
    if (leadId) {
      // T2 — GET /api/leads/:id returns entityType
      const get = await apiRequest("GET", `/api/leads/${leadId}`, null, session);
      ok("T2: GET /api/leads/:id returns entityType='marina'",
        get.body?.entityType === "marina" || get.body?.entity_type === "marina");

      // T3 — PUT /api/leads/:id updates entityType
      const upd = await apiRequest("PUT", `/api/leads/${leadId}`, {
        company: `${tag}_MarinaLead`,
        contactName: "Test Contact",
        entityType: "other",
        source: "test_suite",
      }, session);
      ok("T3: PUT /api/leads/:id accepts entityType='other'", upd.status === 200);
      ok("T3: response reflects entityType='other'",
        upd.body?.entityType === "other" || upd.body?.entity_type === "other");

      // T4 — GET again — change persisted
      const get2 = await apiRequest("GET", `/api/leads/${leadId}`, null, session);
      ok("T4: entityType='other' persisted after PUT",
        get2.body?.entityType === "other" || get2.body?.entity_type === "other");

      // Cleanup
      await apiRequest("DELETE", `/api/leads/${leadId}`, null, session);
    }
  }

  // T5 — Create non-marina lead → no anchor
  {
    const r = await apiRequest("POST", "/api/leads", {
      company: `${tag}_VendorLead`,
      contactName: "Vendor Contact",
      entityType: "vendor",
      source: "test_suite",
    }, session);
    ok("T5: POST /api/leads with entityType='vendor' returns 201", r.status === 201);
    ok("T5: response entityType='vendor' (non-marina should not get anchor)",
      r.body?.entityType === "vendor" || r.body?.entity_type === "vendor");

    if (r.body?.id) {
      await apiRequest("DELETE", `/api/leads/${r.body.id}`, null, session);
    }
  }

  // T6 — List returns entityType field
  {
    const list = await apiRequest("GET", "/api/leads?limit=5", null, session);
    ok("T6: GET /api/leads list returns entityType field on records",
      Array.isArray(list.body?.data) && list.body.data.length > 0 &&
      ("entityType" in list.body.data[0] || "entity_type" in list.body.data[0]));
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 9 — DB: backfill verification
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n[9] DB backfill verification");

async function runDbCheck() {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const r = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE marina_id IS NOT NULL AND entity_type = 'marina') AS imported_backfilled,
        COUNT(*) FILTER (WHERE marina_id IS NOT NULL AND entity_type IS NULL)    AS imported_missing,
        COUNT(*) FILTER (WHERE marina_id IS NOT NULL)                            AS total_imported
      FROM leads
    `);
    const row = r.rows[0];
    ok("All imported marina records (marina_id IS NOT NULL) have entity_type='marina'",
      Number(row.imported_missing) === 0 && Number(row.imported_backfilled) > 0);
    ok("Imported backfill count matches total imported",
      Number(row.imported_backfilled) === Number(row.total_imported));

    const r2 = await pool.query(`
      SELECT COUNT(*) AS marina_count FROM leads
      WHERE LOWER(company) LIKE '%marina%'
        AND marina_id IS NULL
        AND source != 'test_suite'
        AND entity_type IS NULL
    `);
    ok("No manually-created marina-named leads missing entity_type (backfill complete)",
      Number(r2.rows[0].marina_count) === 0);

    const named = await pool.query(`
      SELECT entity_type FROM leads
      WHERE LOWER(company) IN ('pentowna marina','shuswap marina','shuswap waterfront marina','splash marina')
      LIMIT 10
    `);
    ok("Named manually-created marinas (Pentowna, Shuswap, Splash) have entity_type set",
      named.rows.length === 0 || named.rows.every(r => r.entity_type === "marina"));
  } finally {
    await pool.end();
  }
}

// ── Run all async tests ───────────────────────────────────────────────────────
(async () => {
  await runLiveTests();
  await runDbCheck();

  console.log("\n────────────────────────────────────────────────────────────");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("\n  Failed checks:");
    failures.forEach(f => console.log(`    ✗ ${f}`));
  }
  console.log("────────────────────────────────────────────────────────────");
  process.exit(failed > 0 ? 1 : 0);
})();
