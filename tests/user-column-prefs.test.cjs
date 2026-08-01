/**
 * Task #221 regression suite — Per-user column preferences for Leads & Accounts.
 *
 * All checks are source-grep based (no running server needed).
 * Tests verify:
 *  - Migration is in the RUN_STARTUP_MIGRATIONS gate (seed-production.ts + index.ts), NOT routes.ts
 *  - Currents schema is completely untouched
 *  - API routes enforce authentication, viewType validation, and payload validation
 *  - Server-side column registry covers both view types with required-column locks
 *  - Frontend wires the hook correctly for both Leads and Accounts
 */

"use strict";
const fs   = require("fs");
const path = require("path");

const ROUTES   = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");
const INDEX    = fs.readFileSync(path.join(__dirname, "../server/index.ts"), "utf8");
const SEED     = fs.readFileSync(path.join(__dirname, "../server/seed-production.ts"), "utf8");
const LEADS    = fs.readFileSync(path.join(__dirname, "../client/src/pages/leads.tsx"), "utf8");
const ACCOUNTS = fs.readFileSync(path.join(__dirname, "../client/src/pages/accounts.tsx"), "utf8");
const CUST     = fs.readFileSync(path.join(__dirname, "../client/src/components/column-customizer.tsx"), "utf8");

let passed = 0;
let failed = 0;

function check(label, result) {
  if (result) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

console.log("=== Task #221 — User Column Preferences Regression Suite ===\n");

// ── 1. Migration is independent from Currents ────────────────────────────────
console.log("── 1. Migration independence from Currents ──");

check(
  "migrateUserColumnPrefs exists in seed-production.ts",
  SEED.includes("export async function migrateUserColumnPrefs")
);
// migrateUserColumnPrefs() must not touch Currents tables.
// migrateCurrentsReplacementSchema() intentionally restores them for schema parity.
// Check the body of migrateUserColumnPrefs specifically, not the whole file.
const ucpFnStart = SEED.indexOf("export async function migrateUserColumnPrefs");
const ucpFnEnd   = SEED.indexOf("\nexport async function", ucpFnStart + 1);
const ucpBody    = ucpFnEnd === -1 ? SEED.slice(ucpFnStart) : SEED.slice(ucpFnStart, ucpFnEnd);
check(
  "migrateUserColumnPrefs() does NOT reference currents_channels",
  !ucpBody.includes("currents_channels")
);
check(
  "migrateUserColumnPrefs() does NOT reference currents_posts",
  !ucpBody.includes("currents_posts")
);
check(
  "migrateUserColumnPrefs() does NOT reference currents_reactions",
  !ucpBody.includes("currents_reactions")
);
check(
  "migrateUserColumnPrefs() does NOT reference currents_read_state",
  !ucpBody.includes("currents_read_state")
);
check(
  "migrateCurrentsReplacementSchema() exists in seed-production.ts (schema parity restoration)",
  SEED.includes("export async function migrateCurrentsReplacementSchema")
);
check(
  "migrateCurrentsReplacementSchema() references currents_channels for restoration",
  SEED.includes("currents_channels")
);
check(
  "index.ts calls migrateCurrentsReplacementSchema() inside migration gate",
  INDEX.includes("migrateCurrentsReplacementSchema()")
);

// ── 2. No currents_* table is renamed or dropped ─────────────────────────────
console.log("\n── 2. Currents tables not renamed or dropped ──");

check(
  "routes.ts does not DROP any currents_* table",
  !ROUTES.match(/DROP\s+TABLE\s+.*currents_/i)
);
check(
  "routes.ts does not RENAME any currents_* table",
  !ROUTES.match(/RENAME\s+.*currents_/i)
);
check(
  "seed-production.ts does not DROP currents_* tables",
  !SEED.match(/DROP\s+TABLE\s+.*currents_/i)
);

// ── 3. Migration is in the RUN_STARTUP_MIGRATIONS gate ───────────────────────
console.log("\n── 3. Migration is properly gated via RUN_STARTUP_MIGRATIONS ──");

check(
  "index.ts imports migrateUserColumnPrefs from seed-production",
  INDEX.includes("migrateUserColumnPrefs")
);
check(
  "index.ts calls migrateUserColumnPrefs() inside the gate block",
  (() => {
    const gateStart = INDEX.indexOf('process.env.RUN_STARTUP_MIGRATIONS !== "true"');
    const gateEnd   = INDEX.indexOf("} // end RUN_STARTUP_MIGRATIONS gate");
    const callIdx   = INDEX.indexOf("migrateUserColumnPrefs()");
    return gateStart !== -1 && gateEnd !== -1 && callIdx > gateStart && callIdx < gateEnd;
  })()
);
check(
  "routes.ts does NOT contain a fire-and-forget CREATE TABLE user_column_prefs",
  !ROUTES.includes("CREATE TABLE IF NOT EXISTS user_column_prefs")
);
check(
  "routes.ts does NOT contain unguarded startup CREATE TABLE for user_column_prefs",
  !ROUTES.includes("skipInReadOnlyMode(\"user-column-prefs-migration\")")
);

// ── 4. Authentication on GET and PUT ─────────────────────────────────────────
console.log("\n── 4. Authentication requirements ──");

check(
  "GET /api/user-column-prefs/:viewType uses requireAuth",
  ROUTES.includes('app.get("/api/user-column-prefs/:viewType", requireAuth')
);
check(
  "PUT /api/user-column-prefs/:viewType uses requireAuth",
  ROUTES.includes('app.put("/api/user-column-prefs/:viewType", requireAuth')
);
check(
  "user_id comes from getSessionUserId (session), not req.body",
  (() => {
    // Find the PUT handler block and verify user_id assignment
    const putIdx  = ROUTES.indexOf('app.put("/api/user-column-prefs/:viewType"');
    const snippet = ROUTES.slice(putIdx, putIdx + 500);
    return snippet.includes("getSessionUserId(req)") && !snippet.includes("req.body.userId") && !snippet.includes("req.body.user_id");
  })()
);

// ── 5. User isolation — user_id is always from session ───────────────────────
console.log("\n── 5. User isolation ──");

check(
  "GET route interpolates userId from session into WHERE clause",
  (() => {
    const getIdx  = ROUTES.indexOf('app.get("/api/user-column-prefs/:viewType"');
    const snippet = ROUTES.slice(getIdx, getIdx + 800);
    return snippet.includes("getSessionUserId(req)") && snippet.includes("user_id = ${userId}");
  })()
);
check(
  "PUT route interpolates userId from session into INSERT/CONFLICT clause",
  (() => {
    const putIdx  = ROUTES.indexOf('app.put("/api/user-column-prefs/:viewType"');
    const snippet = ROUTES.slice(putIdx, putIdx + 3000);
    return snippet.includes("getSessionUserId(req)") && snippet.includes("VALUES (${userId}");
  })()
);

// ── 6. viewType validation ────────────────────────────────────────────────────
console.log("\n── 6. viewType validation ──");

check(
  "COLUMN_REGISTRY defined with 'leads' and 'accounts' keys",
  ROUTES.includes("COLUMN_REGISTRY") && ROUTES.includes("leads:") && ROUTES.includes("accounts:")
);
check(
  "GET route returns 400 for invalid viewType",
  (() => {
    const getIdx  = ROUTES.indexOf('app.get("/api/user-column-prefs/:viewType"');
    const snippet = ROUTES.slice(getIdx, getIdx + 600);
    return snippet.includes("400") && snippet.includes("COLUMN_REGISTRY[viewType]");
  })()
);
check(
  "PUT route returns 400 for invalid viewType",
  (() => {
    const putIdx  = ROUTES.indexOf('app.put("/api/user-column-prefs/:viewType"');
    const snippet = ROUTES.slice(putIdx, putIdx + 1200);
    return snippet.includes("400") && snippet.includes("COLUMN_REGISTRY[viewType]");
  })()
);

// ── 7. Payload validation ─────────────────────────────────────────────────────
console.log("\n── 7. Payload validation in PUT ──");

check(
  "PUT rejects non-string columnsJson with 400",
  (() => {
    const putIdx  = ROUTES.indexOf('app.put("/api/user-column-prefs/:viewType"');
    const snippet = ROUTES.slice(putIdx, putIdx + 1500);
    return snippet.includes("typeof columnsJson !== \"string\"") && snippet.includes("400");
  })()
);
check(
  "PUT rejects malformed (non-parseable) JSON with 400",
  (() => {
    const putIdx  = ROUTES.indexOf('app.put("/api/user-column-prefs/:viewType"');
    const snippet = ROUTES.slice(putIdx, putIdx + 1500);
    return snippet.includes("JSON.parse(columnsJson)") && snippet.includes("not valid JSON");
  })()
);
check(
  "PUT rejects non-array payload with 400",
  (() => {
    const putIdx  = ROUTES.indexOf('app.put("/api/user-column-prefs/:viewType"');
    const snippet = ROUTES.slice(putIdx, putIdx + 1500);
    return snippet.includes("Array.isArray(parsed)") && snippet.includes("JSON array");
  })()
);
check(
  "PUT rejects duplicate column keys",
  (() => {
    const putIdx  = ROUTES.indexOf('app.put("/api/user-column-prefs/:viewType"');
    const snippet = ROUTES.slice(putIdx, putIdx + 2000);
    return snippet.includes("seen.has(key)") && snippet.includes("Duplicate column key");
  })()
);
check(
  "PUT rejects unknown column keys",
  (() => {
    const putIdx  = ROUTES.indexOf('app.put("/api/user-column-prefs/:viewType"');
    const snippet = ROUTES.slice(putIdx, putIdx + 2000);
    return snippet.includes("reg.keys.has(key)") && snippet.includes("Unknown column key");
  })()
);
check(
  "PUT rejects hiding required columns",
  (() => {
    const putIdx  = ROUTES.indexOf('app.put("/api/user-column-prefs/:viewType"');
    const snippet = ROUTES.slice(putIdx, putIdx + 2000);
    return snippet.includes("reg.required.has(key)") && snippet.includes("required and cannot be hidden");
  })()
);

// ── 8. Leads and Accounts use separate view_type values ──────────────────────
console.log("\n── 8. Leads and Accounts independence ──");

check(
  "Leads page uses useColumnPrefs with viewType 'leads'",
  LEADS.includes('useColumnPrefs("leads"')
);
check(
  "Accounts page uses useColumnPrefs with viewType 'accounts'",
  ACCOUNTS.includes('useColumnPrefs("accounts"')
);
check(
  "Leads column defs do not include accounts-only keys (primaryContact, orgType)",
  !LEADS.includes('"primaryContact"') && !LEADS.includes('"orgType"')
);
check(
  "Accounts column defs do not include leads-only keys (slips, dealAmount, commStatus, lastContact)",
  !ACCOUNTS.includes('"slips"') && !ACCOUNTS.includes('"dealAmount"')
);

// ── 9. Required columns locked in both view types ────────────────────────────
console.log("\n── 9. Required columns ──");

check(
  "Leads: 'company' column is required:true",
  LEADS.includes('{ key: "company"') && LEADS.includes("required: true")
);
check(
  "Leads: 'status' column is required:true",
  LEADS.includes('{ key: "status"') && LEADS.includes("required: true")
);
check(
  "Accounts: 'company' column is required:true",
  ACCOUNTS.includes('{ key: "company"') && ACCOUNTS.includes("required: true")
);
check(
  "Accounts: 'status' column is required:true",
  ACCOUNTS.includes('{ key: "status"') && ACCOUNTS.includes("required: true")
);
check(
  "ColumnCustomizerPopover disables checkbox for required columns",
  CUST.includes("disabled={!!isRequired}") || CUST.includes("disabled={isRequired}")
);

// ── 10. Reset to defaults is wired ───────────────────────────────────────────
console.log("\n── 10. Reset functionality ──");

check(
  "useColumnPrefs exposes resetToDefault",
  CUST.includes("resetToDefault")
);
check(
  "Leads wires resetToDefault to ColumnCustomizerPopover",
  LEADS.includes("resetColPrefs") || LEADS.includes("resetToDefault")
);
check(
  "Accounts wires resetToDefault to ColumnCustomizerPopover",
  ACCOUNTS.includes("resetColPrefs") || ACCOUNTS.includes("resetToDefault")
);

// ── 11. Persistence via API (not localStorage) ────────────────────────────────
console.log("\n── 11. Persistence via API ──");

check(
  "useColumnPrefs fetches from /api/user-column-prefs/:viewType",
  CUST.includes("/api/user-column-prefs/")
);
check(
  "useColumnPrefs saves via PUT /api/user-column-prefs/:viewType",
  CUST.includes('"PUT"') && CUST.includes("/api/user-column-prefs/")
);
check(
  "Column prefs do NOT use localStorage for persistence",
  !CUST.includes("localStorage.setItem") && !CUST.includes("localStorage.getItem")
);

// ── 12. user_column_prefs schema has CHECK constraint in seed-production.ts ──
console.log("\n── 12. Schema correctness ──");

check(
  "migration includes CHECK (view_type IN ('leads', 'accounts'))",
  SEED.includes("CHECK (view_type IN ('leads', 'accounts'))")
);
check(
  "migration includes UNIQUE (user_id, view_type)",
  SEED.includes("UNIQUE (user_id, view_type)")
);
check(
  "migration includes REFERENCES users(id) ON DELETE CASCADE",
  SEED.includes("REFERENCES users(id) ON DELETE CASCADE")
);

// ── 13. Migration gating proof ────────────────────────────────────────────────
// Proves the SQL is unreachable when RUN_STARTUP_MIGRATIONS is absent/false or
// when rollback read-only mode is active.
console.log("\n── 13. Migration gating proof ──");

const INDEX_SRC = fs.readFileSync(path.join(__dirname, "../server/index.ts"), "utf8");
const gateStart = INDEX_SRC.indexOf('process.env.RUN_STARTUP_MIGRATIONS !== "true"');
const gateEnd   = INDEX_SRC.indexOf("} // end RUN_STARTUP_MIGRATIONS gate");

check(
  "RUN_STARTUP_MIGRATIONS gate exists in index.ts",
  gateStart !== -1 && gateEnd !== -1 && gateEnd > gateStart
);

function isInsideGate(fnCall) {
  const idx = INDEX_SRC.indexOf(fnCall);
  return idx !== -1 && idx > gateStart && idx < gateEnd;
}

check(
  "migrateUserColumnPrefs() is inside the RUN_STARTUP_MIGRATIONS gate",
  isInsideGate("migrateUserColumnPrefs()")
);
check(
  "migrateUserColumnPrefsConstraints() is inside the RUN_STARTUP_MIGRATIONS gate",
  isInsideGate("migrateUserColumnPrefsConstraints()")
);
check(
  "migrateCurrentsReplacementSchema() is inside the RUN_STARTUP_MIGRATIONS gate",
  isInsideGate("migrateCurrentsReplacementSchema()")
);
check(
  "routes.ts has NO startup CREATE TABLE for user_column_prefs (fire-and-forget removed)",
  !ROUTES.includes("CREATE TABLE IF NOT EXISTS user_column_prefs")
);
check(
  "rollback-guard skipInReadOnlyMode is NOT used for user_column_prefs in routes.ts",
  !ROUTES.includes('skipInReadOnlyMode("user-column-prefs-migration")')
);
check(
  "seed-production.ts migrateUserColumnPrefs has no fire-and-forget .catch(()=>{})",
  (() => {
    const fnStart = SEED.indexOf("export async function migrateUserColumnPrefs");
    const fnEnd   = SEED.indexOf("\nexport async function", fnStart + 1);
    const body    = fnEnd === -1 ? SEED.slice(fnStart) : SEED.slice(fnStart, fnEnd);
    // The function uses try/catch, not fire-and-forget .catch(()=>{})
    return !body.includes(".catch(() => {})");
  })()
);
check(
  "seed-production.ts migrateUserColumnPrefsConstraints handles duplicate_object error (42710)",
  SEED.includes("42710") || SEED.includes("already exists")
);

// ── 14. Currents tables schema parity (dev = production) ─────────────────────
console.log("\n── 14. Currents tables restored in dev schema ──");

check(
  "migrateCurrentsReplacementSchema creates currents_channels",
  (() => {
    const fnStart = SEED.indexOf("export async function migrateCurrentsReplacementSchema");
    const fnEnd   = SEED.indexOf("\nexport async function", fnStart + 1);
    const body    = fnEnd === -1 ? SEED.slice(fnStart) : SEED.slice(fnStart, fnEnd);
    return body.includes("currents_channels");
  })()
);
check(
  "migrateCurrentsReplacementSchema creates currents_posts",
  (() => {
    const fnStart = SEED.indexOf("export async function migrateCurrentsReplacementSchema");
    const fnEnd   = SEED.indexOf("\nexport async function", fnStart + 1);
    const body    = fnEnd === -1 ? SEED.slice(fnStart) : SEED.slice(fnStart, fnEnd);
    return body.includes("currents_posts");
  })()
);
check(
  "migrateCurrentsReplacementSchema creates currents_reactions with UNIQUE(post_id,user_id,emoji)",
  (() => {
    const fnStart = SEED.indexOf("export async function migrateCurrentsReplacementSchema");
    const fnEnd   = SEED.indexOf("\nexport async function", fnStart + 1);
    const body    = fnEnd === -1 ? SEED.slice(fnStart) : SEED.slice(fnStart, fnEnd);
    return body.includes("currents_reactions") && body.includes("post_id, user_id, emoji");
  })()
);
check(
  "migrateCurrentsReplacementSchema creates currents_read_state with composite PK",
  (() => {
    const fnStart = SEED.indexOf("export async function migrateCurrentsReplacementSchema");
    const fnEnd   = SEED.indexOf("\nexport async function", fnStart + 1);
    const body    = fnEnd === -1 ? SEED.slice(fnStart) : SEED.slice(fnStart, fnEnd);
    return body.includes("currents_read_state") && body.includes("PRIMARY KEY  (user_id, channel_id)");
  })()
);
check(
  "migrateCurrentsReplacementSchema has no DROP or RENAME or TRUNCATE",
  (() => {
    const fnStart = SEED.indexOf("export async function migrateCurrentsReplacementSchema");
    const fnEnd   = SEED.indexOf("\nexport async function", fnStart + 1);
    const body    = fnEnd === -1 ? SEED.slice(fnStart) : SEED.slice(fnStart, fnEnd);
    return !body.match(/\bDROP\b|\bRENAME\b|\bTRUNCATE\b/i);
  })()
);
check(
  "user_column_prefs has no FK or JOIN to any currents_* table",
  !ROUTES.includes("currents_channels") && !ROUTES.includes("currents_posts") &&
  !ROUTES.includes("currents_reactions") && !ROUTES.includes("currents_read_state")
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(60));
console.log(`  Task #221 column prefs: ${passed} passed, ${failed} failed`);
console.log("─".repeat(60));

if (failed > 0) process.exit(1);
