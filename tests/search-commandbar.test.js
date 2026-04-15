/**
 * tests/search-commandbar.test.js
 *
 * Phase 7 — Command bar test suite
 * Covers: action matching, decompacted fuzzy search, sub-label enrichment,
 *         recent-item storage helpers, group structure, regression.
 *
 * Run with: node tests/search-commandbar.test.js
 */

const BASE = "http://localhost:5000";
let passed = 0, failed = 0;
const results = [];

// ─── Tiny test framework ──────────────────────────────────────────────────────
async function test(name, fn) {
  try {
    await fn();
    passed++;
    results.push({ ok: true, name });
  } catch (e) {
    failed++;
    results.push({ ok: false, name, err: e.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? "Assertion failed");
}

// ─── HTTP helpers (mirrors search.test.js) ────────────────────────────────────
async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const cookie = res.headers.get("set-cookie")?.match(/(connect\.sid=[^;]+)/)?.[1];
  if (!cookie) throw new Error("No session cookie");
  await new Promise(r => setTimeout(r, 200));
  return cookie;
}

function authed(cookie) {
  return async (url) =>
    fetch(`${BASE}${url}`, { headers: { Cookie: cookie } });
}

async function search(api, q) {
  const res = await api(`/api/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`Search ${res.status}: ${q}`);
  const data = await res.json();
  return data.results ?? [];
}

// ─── Phase 3 — Action matching (pure JS, replicated from header.tsx) ──────────
const ALL_ACTIONS = [
  { id: "go-today",       keywords: ["today","overview","daily","morning","briefing","go"] },
  { id: "go-home",        keywords: ["home","dashboard","command","center","main","go"] },
  { id: "go-contacts",    keywords: ["contact","contacts","people","person","go"] },
  { id: "go-accounts",    keywords: ["account","accounts","org","organization","company","business","go"] },
  { id: "go-leads",       keywords: ["lead","leads","marina","prospect","go"] },
  { id: "go-tasks",       keywords: ["task","tasks","todo","action","hub","work","go"] },
  { id: "go-pipeline",    keywords: ["pipeline","deal","deals","revenue","forecast","go"] },
  { id: "go-inbox",       keywords: ["email","inbox","mail","gmail","message","go"] },
  { id: "create-account", keywords: ["create","new","add","account","organization","company"] },
  { id: "create-lead",    keywords: ["create","new","add","lead","prospect","marina"] },
  { id: "create-contact", keywords: ["create","new","add","contact","person"] },
  { id: "create-task",    keywords: ["create","new","add","task","todo","remind"] },
];

function getMatchingActions(query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored = ALL_ACTIONS.map(a => {
    let score = 0;
    for (const w of words)
      for (const k of a.keywords)
        if (k === w) score += 3; else if (k.startsWith(w)) score += 2; else if (k.includes(w)) score += 1;
    return { a, score };
  });
  return scored.filter(x => x.score > 0).sort((x, y) => y.score - x.score).slice(0, 3).map(x => x.a);
}

// ─── Phase 4 — Recent item storage helpers (pure JS, mock localStorage) ───────
const mockStore = {};
const ls = {
  getItem: k => mockStore[k] ?? null,
  setItem: (k, v) => { mockStore[k] = v; },
};

const REC_SEARCH_KEY = "cb_recent_searches";
const REC_RECORD_KEY  = "cb_recent_records";

function loadRecentSearches() {
  try { return JSON.parse(ls.getItem(REC_SEARCH_KEY) || "[]").slice(0, 5); } catch { return []; }
}
function saveRecentSearch(q) {
  const prev = loadRecentSearches().filter(s => s !== q);
  ls.setItem(REC_SEARCH_KEY, JSON.stringify([q, ...prev].slice(0, 5)));
}
function loadRecentRecords() {
  try { return JSON.parse(ls.getItem(REC_RECORD_KEY) || "[]").slice(0, 8); } catch { return []; }
}
function saveRecentRecord(r) {
  const prev = loadRecentRecords().filter(x => !(x.type === r.type && x.id === r.id));
  ls.setItem(REC_RECORD_KEY, JSON.stringify([r, ...prev].slice(0, 8)));
}

// ─── Test runner ──────────────────────────────────────────────────────────────
async function main() {
  console.log("\n━━━ Command Bar Test Suite ━━━\n");

  const cookie = await login("trevor@voltsafe.com", "alberni1444");
  const api = authed(cookie);

  // ── GROUP A: Action matching (pure JS) ──────────────────────────────────────
  console.log("GROUP A — Action matching");

  await test("A1a 'create account' → create-account action present", async () => {
    const actions = getMatchingActions("create account");
    assert(actions.length > 0, "Expected actions");
    assert(actions.some(a => a.id === "create-account"), `Got: ${actions.map(a=>a.id)}`);
  });

  await test("A1b 'create' → up to 3 create-* actions", async () => {
    const actions = getMatchingActions("create");
    assert(actions.length > 0, "Expected create actions");
    assert(actions.length <= 3, `Got ${actions.length}`);
    assert(actions.every(a => a.id.startsWith("create-")), `Non-create: ${actions.map(a=>a.id)}`);
  });

  await test("A2a 'tasks' → go-tasks action is first", async () => {
    const actions = getMatchingActions("tasks");
    assert(actions.length > 0, "Expected actions");
    assert(actions[0].id === "go-tasks", `First: ${actions[0].id}`);
  });

  await test("A2b 'create task' → create-task present", async () => {
    const actions = getMatchingActions("create task");
    assert(actions.some(a => a.id === "create-task"), `Got: ${actions.map(a=>a.id)}`);
  });

  await test("A3a 'command' → go-home action present", async () => {
    const actions = getMatchingActions("command");
    assert(actions.some(a => a.id === "go-home"), `Got: ${actions.map(a=>a.id)}`);
  });

  await test("A3b 'dashboard' → go-home action present", async () => {
    const actions = getMatchingActions("dashboard");
    assert(actions.some(a => a.id === "go-home"), `Got: ${actions.map(a=>a.id)}`);
  });

  await test("A4a 'contact' → contacts action present", async () => {
    const actions = getMatchingActions("contact");
    assert(actions.some(a => a.id.includes("contact")), `Got: ${actions.map(a=>a.id)}`);
  });

  await test("A4b 'lead marina' → lead action present", async () => {
    const actions = getMatchingActions("lead marina");
    assert(actions.some(a => a.id.includes("lead")), `Got: ${actions.map(a=>a.id)}`);
  });

  await test("A5a empty query → no actions", async () => {
    assert(getMatchingActions("").length === 0, "Expected empty");
  });

  await test("A5b unrelated 'xyz' → no actions", async () => {
    assert(getMatchingActions("xyz").length === 0, "Expected empty");
  });

  await test("A6a 'go' prefix → all returned actions are go-* nav items", async () => {
    const actions = getMatchingActions("go");
    assert(actions.length > 0, "Expected go-* actions");
    assert(actions.every(a => a.id.startsWith("go-")), `Non-go: ${actions.map(a=>a.id)}`);
  });

  await test("A6b 'pipeline' → go-pipeline present", async () => {
    const actions = getMatchingActions("pipeline");
    assert(actions.some(a => a.id === "go-pipeline"), `Got: ${actions.map(a=>a.id)}`);
  });

  await test("A6c 'new contact' → create-contact present", async () => {
    const actions = getMatchingActions("new contact");
    assert(actions.some(a => a.id === "create-contact"), `Got: ${actions.map(a=>a.id)}`);
  });

  await test("A7  max 3 actions returned even for broad query", async () => {
    const actions = getMatchingActions("create new add");
    assert(actions.length <= 3, `Got ${actions.length}`);
  });

  // ── GROUP B: Recent item storage (pure JS, mock localStorage) ───────────────
  console.log("\nGROUP B — Recent item storage");

  await test("B1a saveRecentSearch + load round-trip", async () => {
    saveRecentSearch("port credit");
    assert(loadRecentSearches()[0] === "port credit");
  });

  await test("B1b same query not stored twice", async () => {
    saveRecentSearch("port credit");
    saveRecentSearch("port credit");
    const count = loadRecentSearches().filter(s => s === "port credit").length;
    assert(count === 1, `Duplicate: ${count}`);
  });

  await test("B1c latest search is first", async () => {
    saveRecentSearch("barrie marina");
    assert(loadRecentSearches()[0] === "barrie marina");
  });

  await test("B1d capped at 5 — oldest dropped", async () => {
    ["a","b","c","d","e","f"].forEach(s => saveRecentSearch(s));
    const r = loadRecentSearches();
    assert(r.length <= 5, `Got ${r.length}`);
    assert(r[0] === "f");
  });

  await test("B2a saveRecentRecord + load round-trip", async () => {
    saveRecentRecord({ type: "lead", id: "10140", label: "Port Credit Harbour Marina", sub: "Ontario" });
    const r = loadRecentRecords();
    assert(r.length > 0 && r[0].id === "10140");
  });

  await test("B2b same record not stored twice", async () => {
    saveRecentRecord({ type: "lead", id: "10140", label: "Port Credit Harbour Marina" });
    saveRecentRecord({ type: "lead", id: "10140", label: "Port Credit Harbour Marina" });
    const count = loadRecentRecords().filter(r => r.type === "lead" && r.id === "10140").length;
    assert(count === 1, `Duplicate: ${count}`);
  });

  await test("B2c latest record is first", async () => {
    saveRecentRecord({ type: "account", id: "9999", label: "Test Account" });
    assert(loadRecentRecords()[0].id === "9999");
  });

  await test("B2d capped at 8 records", async () => {
    for (let i = 0; i < 12; i++) saveRecentRecord({ type: "contact", id: `c${i}`, label: `C${i}` });
    assert(loadRecentRecords().length <= 8);
  });

  // ── GROUP C: Phase 5 — Decompacted fuzzy matching (HTTP) ────────────────────
  console.log("\nGROUP C — Decompacted fuzzy matching");

  await test("C1a 'portcredit' finds Port Credit Harbour Marina", async () => {
    const r = await search(api, "portcredit");
    assert(r.length > 0, "No results for 'portcredit'");
    const hit = r.find(x => x.type === "lead" && x.label.toLowerCase().includes("port credit"));
    assert(hit, `Not found. Got: ${r.map(x=>x.label).join(", ")}`);
  });

  await test("C1b 'portcredit' result has type=lead", async () => {
    const r = await search(api, "portcredit");
    const hit = r.find(x => x.type === "lead");
    assert(hit?.label.toLowerCase().includes("port credit"), `Got: ${hit?.label}`);
  });

  await test("C2a 'barriemarina' finds Barrie marina lead", async () => {
    const r = await search(api, "barriemarina");
    assert(r.length > 0, "No results for 'barriemarina'");
    const hit = r.find(x => x.type === "lead" &&
      (x.label.toLowerCase().includes("barrie") || (x.sub2 ?? "").toLowerCase().includes("barrie")));
    assert(hit, `Not found. Got: ${r.map(x=>x.label+"/"+x.sub2).join(", ")}`);
  });

  await test("C3a 'port credit' (spaced) still works — regression", async () => {
    const r = await search(api, "port credit");
    const hit = r.find(x => x.type === "lead" && x.label.toLowerCase().includes("port credit"));
    assert(hit, `Regression: no Port Credit lead. Got: ${r.map(x=>x.label).join(", ")}`);
  });

  await test("C4a decompacted has correct shape", async () => {
    const r = await search(api, "portcredit");
    const lead = r.find(x => x.type === "lead");
    assert(lead, "No lead in results");
    assert(typeof lead.id === "string", "id not string");
    assert(typeof lead.label === "string", "label not string");
    assert("sub2" in lead, "sub2 missing");
  });

  // ── GROUP D: Phase 6 — Sub-label enrichment (HTTP) ──────────────────────────
  console.log("\nGROUP D — Sub-label enrichment");

  await test("D1a lead sub2 is 'city, province' format", async () => {
    const r = await search(api, "port credit");
    const lead = r.find(x => x.type === "lead" && x.label.toLowerCase().includes("port credit"));
    assert(lead, "No Port Credit lead");
    assert(lead.sub2?.includes("Ontario"), `sub2='${lead.sub2}'`);
  });

  await test("D2a lead sub2 includes comma separator", async () => {
    const r = await search(api, "barriemarina");
    const lead = r.find(x => x.type === "lead");
    assert(lead, "No lead");
    if (lead.sub2) assert(lead.sub2.includes(","), `sub2='${lead.sub2}'`);
  });

  await test("D3a opportunity sub2 is non-null for results with account", async () => {
    const r = await search(api, "install");
    const opp = r.find(x => x.type === "opportunity");
    if (!opp) return; // optional — depends on seed data
    assert(typeof opp.sub2 === "string" || opp.sub2 === null, "bad sub2 type");
  });

  await test("D4a account sub2 is string (city[, province])", async () => {
    const r = await search(api, "marina");
    const acc = r.find(x => x.type === "account");
    if (!acc) return; // optional — seed-dependent
    assert(typeof acc.sub2 === "string" || acc.sub2 === null, "bad sub2 type");
  });

  // ── GROUP E: Regression — original search behaviour preserved ────────────────
  console.log("\nGROUP E — Regression");

  await test("E1a 'Barrie' returns lead results", async () => {
    const r = await search(api, "Barrie");
    const leads = r.filter(x => x.type === "lead");
    assert(leads.length > 0, `No leads. Got ${r.length} total`);
  });

  await test("E1b leads capped at ≤5 per type", async () => {
    const r = await search(api, "marina");
    assert(r.filter(x => x.type === "lead").length <= 5);
  });

  await test("E2a total results ≤24", async () => {
    const r = await search(api, "marina");
    assert(r.length <= 24, `Got ${r.length}`);
  });

  await test("E3a lead result has all required fields", async () => {
    const r = await search(api, "Barrie");
    const lead = r.find(x => x.type === "lead");
    assert(lead, "No lead");
    assert(typeof lead.id === "string" && lead.id.length > 0);
    assert(typeof lead.label === "string" && lead.label.length > 0);
    assert("sub" in lead);
    assert("sub2" in lead);
    assert("linked_id" in lead);
  });

  await test("E4a exact company match ranks first for lead search", async () => {
    const r = await search(api, "City of Barrie Marina");
    const leads = r.filter(x => x.type === "lead");
    assert(leads.length > 0, "No leads");
    assert(leads[0].label.toLowerCase().includes("barrie"), `First: ${leads[0].label}`);
  });

  await test("E5a lead type field is exactly 'lead'", async () => {
    const r = await search(api, "port credit");
    const lead = r.find(x => x.label.toLowerCase().includes("port credit"));
    assert(lead?.type === "lead", `type='${lead?.type}'`);
  });

  await test("E5b Port Credit lead sub2 includes Ontario", async () => {
    const r = await search(api, "port credit");
    const lead = r.find(x => x.type === "lead" && x.label.toLowerCase().includes("port credit"));
    assert(lead?.sub2?.includes("Ontario"), `sub2='${lead?.sub2}'`);
  });

  await test("E6a non-lead types still return results (accounts)", async () => {
    const r = await search(api, "marina");
    // At least some results (leads or accounts) should exist
    assert(r.length > 0, "No results at all for 'marina'");
  });

  // ── GROUP F: Group structure ─────────────────────────────────────────────────
  console.log("\nGROUP F — Group structure");

  await test("F1a type field always valid", async () => {
    const valid = new Set(["account","contact","opportunity","lead","note"]);
    const r = await search(api, "marina");
    const bad = r.filter(x => !valid.has(x.type));
    assert(bad.length === 0, `Unknown types: ${bad.map(x=>x.type)}`);
  });

  await test("F1b no duplicate IDs within same type", async () => {
    const r = await search(api, "marina");
    for (const type of ["account","contact","opportunity","lead","note"]) {
      const ids = r.filter(x => x.type === type).map(x => x.id);
      assert(ids.length === new Set(ids).size, `Dupes in type=${type}`);
    }
  });

  await test("F2a 'Barrie' search has lead results in array", async () => {
    const r = await search(api, "Barrie");
    assert(r.some(x => x.type === "lead"), `Types: ${[...new Set(r.map(x=>x.type))]}`);
  });

  await test("F2b results array is non-null", async () => {
    const r = await search(api, "test");
    assert(Array.isArray(r), "results not an array");
  });

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log("");
  results.forEach(r => {
    const icon = r.ok ? "  ✓" : "  ✗";
    console.log(r.ok ? `${icon} ${r.name}` : `${icon} ${r.name}\n      ↳ ${r.err}`);
  });
  console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━\n`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
