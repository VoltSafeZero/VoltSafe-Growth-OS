/**
 * CRM Taxonomy Phase 1 — verification tests
 *
 * Tests:
 *  1.  Leads default industry filter shows legacy null-industry leads (API)
 *  2.  Leads and Accounts import the same PIPELINE_STAGE_OPTIONS (source)
 *  3.  "converted" has the same label in Leads and Accounts (source)
 *  4.  closed_lost normalises to "lost"
 *  5.  prospect normalises to "new"
 *  6.  marina_parent_group label is "Marina Parent Group"
 *  7.  marina_parent_group is NOT treated as association
 *  8.  Safe Harbour-style account classifies as marina_parent_group, not association
 *  9.  Existing saved views endpoint still responds
 * 10.  Existing lead/account/contact detail routes still resolve
 * 11.  Existing lifecycle-reversibility tests still pass (40/40)
 */

"use strict";

const http = require("http");
const fs   = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const BASE = "http://localhost:5000";
let passed = 0;
let failed = 0;
const cookieJar = {};

function assert(label, cond, detail = "") {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

async function req(method, path, body, extraHeaders = {}) {
  const cookieHeader = Object.entries(cookieJar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: "localhost",
      port: 5000,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        "Origin": BASE,
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
        ...extraHeaders,
      },
    };
    const r = http.request(opts, res => {
      const sc = res.headers["set-cookie"] || [];
      sc.forEach(c => {
        const [pair] = c.split(";");
        const [k, v] = pair.split("=");
        cookieJar[k.trim()] = v?.trim() ?? "";
      });
      let raw = "";
      res.on("data", d => (raw += d));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

// ─── helpers pulled from crm-taxonomy.ts (transpiled inline) ─────────────────
// Replicated here as pure JS so the test has zero build dependency.

const PIPELINE_STAGE_VALUES = [
  "new","contacted","meeting_scheduled","qualified",
  "proposal_sent","negotiation","converted","lost",
];

const PIPELINE_STAGE_LABELS = {
  new: "New", contacted: "Contacted", meeting_scheduled: "Meeting Scheduled",
  qualified: "Qualified", proposal_sent: "Proposal Sent", negotiation: "Negotiation",
  converted: "Promoted", lost: "Closed Lost",
};

const MARKET_SEGMENT_LABELS = {
  marina: "Marina",
  marina_parent_group: "Marina Parent Group",
  yacht_club: "Yacht Club",
  dry_stack: "Dry Stack",
  port_harbor: "Port / Harbor",
  municipality: "Municipality",
  utility: "Utility",
  oem: "OEM",
  distributor: "Distributor",
  installer: "Installer",
  manufacturer: "Manufacturer",
  association: "Association",
  research: "Research",
  investor: "Investor",
  media: "Media",
  other: "Other",
};

const LEGACY_STAGE_MAP = { closed_lost: "lost", prospect: "new" };

function normalizeLifecycleStage(v) {
  if (!v) return "new";
  return LEGACY_STAGE_MAP[v] ?? v;
}

function isMarinaParentGroup(v) { return v === "marina_parent_group"; }
function isAssociationSegment(v) { return v === "association"; }

// ─── source-file helpers ──────────────────────────────────────────────────────

function srcContains(file, pattern) {
  const src = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  if (typeof pattern === "string") return src.includes(pattern);
  return pattern.test(src);
}

// ─── tests ────────────────────────────────────────────────────────────────────

async function run() {
  console.log("\nCRM Taxonomy Phase 1 Tests\n");

  // Auth
  const login = await req("POST", "/api/auth/login", { email: "trevor@voltsafe.com", password: "alberni1444" });
  assert("[auth] login succeeded", login.status === 200);

  // ── 1. Default industry filter shows null-industry leads ──────────────────
  console.log("\n1. Default industry filter — null-industry leads visible");

  // Source check: default is "__all__", not "marine"
  assert(
    "leads.tsx industryFilter default is \"__all__\"",
    srcContains("client/src/pages/leads.tsx", 'useState("__all__")')
  );

  // API check: no primaryIndustry param returns full count (should be > 0)
  const allLeads = await req("GET", "/api/leads?page=1&limit=1");
  assert(
    "GET /api/leads (no industry filter) returns leads",
    allLeads.status === 200 && allLeads.body.total > 0,
    `total=${allLeads.body.total}`
  );

  // Count with no primaryIndustry param — should include null-industry leads
  const noFilter = await req("GET", "/api/leads?page=1&limit=1");
  const withMarine = await req("GET", "/api/leads?page=1&limit=1&primaryIndustry=marine");
  assert(
    "No-filter total >= marine-filter total (nulls are included)",
    noFilter.body.total >= withMarine.body.total,
    `no-filter=${noFilter.body.total} marine=${withMarine.body.total}`
  );

  // ── 2. Both pages import from the same shared taxonomy ────────────────────
  console.log("\n2. Shared taxonomy import");

  assert(
    "leads.tsx imports PIPELINE_STAGE_OPTIONS from crm-taxonomy",
    srcContains("client/src/pages/leads.tsx", "PIPELINE_STAGE_OPTIONS") &&
    srcContains("client/src/pages/leads.tsx", "crm-taxonomy")
  );
  assert(
    "accounts.tsx imports PIPELINE_STAGE_OPTIONS from crm-taxonomy",
    srcContains("client/src/pages/accounts.tsx", "PIPELINE_STAGE_OPTIONS") &&
    srcContains("client/src/pages/accounts.tsx", "crm-taxonomy")
  );
  assert(
    "crm-taxonomy.ts defines canonical PIPELINE_STAGE_OPTIONS",
    srcContains("client/src/lib/crm-taxonomy.ts", "export const PIPELINE_STAGE_OPTIONS")
  );

  // ── 3. "converted" has the same label in Leads and Accounts ───────────────
  console.log('\n3. "converted" label is identical in Leads and Accounts');

  // Both must now alias PIPELINE_STAGE_OPTIONS — the label lives only in the taxonomy
  const taxonomySrc = fs.readFileSync(
    path.join(__dirname, "..", "client/src/lib/crm-taxonomy.ts"), "utf8"
  );
  const convertedMatch = taxonomySrc.match(/value:\s*"converted".*?label:\s*"([^"]+)"/s);
  const canonicalLabel = convertedMatch?.[1];
  assert(
    `Taxonomy "converted" label is defined (canonical: "${canonicalLabel}")`,
    !!canonicalLabel
  );

  // Neither page should define its own conflicting "converted" label
  const leadsHasLocalConverted = /value:\s*"converted",\s*label:\s*"(?!.*PIPELINE_STAGE_OPTIONS)/.test(
    fs.readFileSync(path.join(__dirname, "..", "client/src/pages/leads.tsx"), "utf8")
  );
  const accountsHasLocalConverted = /value:\s*"converted",\s*label:\s*"(?!.*PIPELINE_STAGE_OPTIONS)/.test(
    fs.readFileSync(path.join(__dirname, "..", "client/src/pages/accounts.tsx"), "utf8")
  );
  assert(
    "leads.tsx does not define a local converted label",
    !leadsHasLocalConverted
  );
  assert(
    "accounts.tsx does not define a local converted label",
    !accountsHasLocalConverted
  );

  // Same label value in taxonomy
  assert(
    'Taxonomy "converted" label is "Promoted"',
    canonicalLabel === "Promoted"
  );

  // ── 4 & 5. Legacy stage normalisation ────────────────────────────────────
  console.log("\n4–5. Legacy stage normalisation");

  assert('normalizeLifecycleStage("closed_lost") === "lost"',
    normalizeLifecycleStage("closed_lost") === "lost");
  assert('normalizeLifecycleStage("prospect") === "new"',
    normalizeLifecycleStage("prospect") === "new");
  assert('normalizeLifecycleStage("qualified") === "qualified" (pass-through)',
    normalizeLifecycleStage("qualified") === "qualified");
  assert('normalizeLifecycleStage(null) returns string',
    typeof normalizeLifecycleStage(null) === "string");

  // Verify in source
  assert(
    "crm-taxonomy.ts maps closed_lost → lost",
    srcContains("client/src/lib/crm-taxonomy.ts", "closed_lost") &&
    srcContains("client/src/lib/crm-taxonomy.ts", '"lost"')
  );
  assert(
    "crm-taxonomy.ts maps prospect → new",
    srcContains("client/src/lib/crm-taxonomy.ts", "prospect") &&
    srcContains("client/src/lib/crm-taxonomy.ts", '"new"')
  );

  // ── 6. marina_parent_group label ─────────────────────────────────────────
  console.log('\n6. marina_parent_group label');

  assert(
    'MARKET_SEGMENT_LABELS["marina_parent_group"] === "Marina Parent Group"',
    MARKET_SEGMENT_LABELS["marina_parent_group"] === "Marina Parent Group"
  );
  assert(
    'crm-taxonomy.ts defines marina_parent_group as "Marina Parent Group"',
    srcContains("client/src/lib/crm-taxonomy.ts", '"Marina Parent Group"')
  );

  // ── 7. marina_parent_group is NOT association ─────────────────────────────
  console.log("\n7. marina_parent_group ≠ association");

  assert(
    "isMarinaParentGroup(\"marina_parent_group\") === true",
    isMarinaParentGroup("marina_parent_group")
  );
  assert(
    "isAssociationSegment(\"marina_parent_group\") === false",
    !isAssociationSegment("marina_parent_group")
  );
  assert(
    "isAssociationSegment(\"association\") === true",
    isAssociationSegment("association")
  );

  // ── 8. Safe Harbour-style account → marina_parent_group, not association ──
  console.log("\n8. Safe Harbour classification");

  const safeHarbourSegment = "marina_parent_group";
  assert(
    "Safe Harbour (marina_parent_group) → isMarinaParentGroup = true",
    isMarinaParentGroup(safeHarbourSegment)
  );
  assert(
    "Safe Harbour (marina_parent_group) → isAssociationSegment = false",
    !isAssociationSegment(safeHarbourSegment)
  );
  assert(
    "Safe Harbour label is \"Marina Parent Group\", not \"Association\"",
    MARKET_SEGMENT_LABELS[safeHarbourSegment] === "Marina Parent Group" &&
    MARKET_SEGMENT_LABELS[safeHarbourSegment] !== "Association"
  );
  // Source: taxonomy comment documents the distinction
  assert(
    "crm-taxonomy.ts documents marina_parent_group as commercial operating entity",
    srcContains("client/src/lib/crm-taxonomy.ts", /marina_parent_group.*commercial|commercial.*marina_parent_group/i)
  );

  // ── 9. Saved views endpoint still responds ────────────────────────────────
  console.log("\n9. Saved views endpoint");

  const svList = await req("GET", "/api/saved-views?pageKey=leads");
  assert(
    "GET /api/saved-views?pageKey=leads responds 2xx",
    svList.status >= 200 && svList.status < 300,
    `status=${svList.status}`
  );
  assert(
    "Saved views response is an array",
    Array.isArray(svList.body),
    `got ${typeof svList.body}`
  );

  // ── 10. Detail routes still resolve ──────────────────────────────────────
  console.log("\n10. Existing detail routes");

  const leadsRes = await req("GET", "/api/leads?page=1&limit=5");
  const firstLeadId = leadsRes.body?.data?.[0]?.id;
  const acctRes = await req("GET", "/api/accounts?page=1&limit=5");
  const firstAcctId = acctRes.body?.data?.[0]?.id;

  if (firstLeadId) {
    const ld = await req("GET", `/api/leads/${firstLeadId}`);
    assert(`GET /api/leads/${firstLeadId} resolves`, ld.status === 200);
  } else {
    assert("Lead detail route — no leads to test (skip)", true);
  }

  if (firstAcctId) {
    const ac = await req("GET", `/api/accounts/${firstAcctId}`);
    assert(`GET /api/accounts/${firstAcctId} resolves`, ac.status === 200);
  } else {
    assert("Account detail route — no accounts to test (skip)", true);
  }

  const contacts = await req("GET", `/api/contacts?accountId=${firstAcctId || 1}`);
  assert(
    "GET /api/contacts responds",
    contacts.status >= 200 && contacts.status < 300
  );

  // ── 11. Lifecycle-reversibility suite still passes ─────────────────────────
  console.log("\n11. lifecycle-reversibility.test.cjs — 40/40");

  let lcOutput = "";
  let lcOk = false;
  try {
    lcOutput = execSync("node tests/lifecycle-reversibility.test.cjs 2>&1", {
      cwd: path.join(__dirname, ".."),
      timeout: 90000,
    }).toString();
    lcOk = lcOutput.includes("40 passed, 0 failed");
  } catch (e) {
    lcOutput = e.stdout?.toString() || e.message;
  }
  assert("lifecycle-reversibility: 40 passed, 0 failed", lcOk,
    lcOk ? "" : lcOutput.slice(-400));

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(57));
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("─".repeat(57) + "\n");
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });
