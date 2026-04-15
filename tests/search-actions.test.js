/**
 * tests/search-actions.test.js
 * Phase 6 — Record Actions Command Bar Tests
 *
 * Covers:
 *  A. getRecordActions() — action sets by type
 *  B. parseSmartAction() — query pattern detection
 *  C. Permission gating — canEdit=false hides write actions
 *  D. Keyboard nav state machine — pure logic tests
 *  E. Backend /api/quick-actions/task endpoint
 *  F. Regression — existing command bar behavior unchanged
 */

import fetch from "node-fetch";

const BASE = "http://localhost:5000";

// ─── Re-implement pure helpers for unit testing ───────────────────────────────

const RECORD_ACTIONS = {
  account:     ["open", "add-note", "create-task", "search-emails", "create-quote"],
  lead:        ["open", "add-note", "create-task", "convert-lead",  "assign-owner"],
  contact:     ["open", "create-task", "compose-email", "add-note"],
  opportunity: ["open", "create-task", "add-note", "create-quote",  "update-stage"],
  note:        ["open-context", "copy-note", "open-linked"],
};

const REQUIRES_EDIT = new Set([
  "add-note", "create-task", "create-quote",
  "convert-lead", "assign-owner", "update-stage",
]);

function getRecordActions(type, canEdit) {
  const ids = RECORD_ACTIONS[type] ?? [];
  return canEdit ? ids : ids.filter(id => !REQUIRES_EDIT.has(id));
}

function parseSmartAction(q) {
  const patterns = [
    { re: /^(?:task|add task|create task|new task)\s+(?:for|on|about|re)\s+(.+)$/i,                 actionId: "create-task",   label: "Create Task for"  },
    { re: /^(?:note|add note|new note)\s+(?:on|for|about|re)\s+(.+)$/i,                             actionId: "add-note",      label: "Add Note for"     },
    { re: /^(?:email|compose|send)(?:\s+(?:email\s+to|email|to))?\s+(.+)$/i,                        actionId: "compose-email", label: "Email"            },
    { re: /^(?:quote|create quote|new quote|draft quote)\s+(?:for|on)\s+(.+)$/i,                     actionId: "create-quote",  label: "Create Quote for" },
  ];
  for (const p of patterns) {
    const m = q.match(p.re);
    if (m) return { actionId: p.actionId, actionLabel: p.label, entityQuery: m[1].trim() };
  }
  return null;
}

// ─── Keyboard nav state machine ───────────────────────────────────────────────

function makeNavState(totalResults) {
  return {
    activeIndex: -1,
    actionMode: false,
    actionIndex: -1,
    totalResults,
    actionsForActive: 0,
  };
}

function applyKey(state, key, { shiftKey = false } = {}) {
  let { activeIndex, actionMode, actionIndex, totalResults, actionsForActive } = state;
  const last = totalResults - 1;

  if (key === "ArrowDown") {
    if (actionMode) { actionMode = false; actionIndex = -1; }
    activeIndex = Math.min(activeIndex + 1, last);
  } else if (key === "ArrowUp") {
    if (actionMode) { actionMode = false; actionIndex = -1; }
    activeIndex = Math.max(activeIndex - 1, -1);
  } else if (key === "Tab" && !shiftKey) {
    if (activeIndex >= 0 && !actionMode && actionsForActive > 0) {
      actionMode = true; actionIndex = 0;
    } else if (actionMode) {
      const next = actionIndex + 1;
      if (next < actionsForActive) { actionIndex = next; }
      else { actionMode = false; actionIndex = -1; activeIndex = Math.min(activeIndex + 1, last); }
    }
  } else if (key === "Tab" && shiftKey) {
    if (actionMode) { actionMode = false; actionIndex = -1; }
  } else if (key === "ArrowRight") {
    if (activeIndex >= 0 && !actionMode && actionsForActive > 0) {
      actionMode = true; actionIndex = 0;
    } else if (actionMode) {
      actionIndex = Math.min(actionIndex + 1, actionsForActive - 1);
    }
  } else if (key === "ArrowLeft") {
    if (actionMode) {
      if (actionIndex > 0) actionIndex--;
      else { actionMode = false; actionIndex = -1; }
    }
  } else if (key === "Escape") {
    if (actionMode) { actionMode = false; actionIndex = -1; }
    else { activeIndex = -1; }
  }

  return { activeIndex, actionMode, actionIndex, totalResults, actionsForActive };
}

// ─── Auth cookie helper ───────────────────────────────────────────────────────

let SESSION_COOKIE = null;

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "trevor@voltsafe.com", password: "alberni1444" }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const setCookie = res.headers.get("set-cookie");
  SESSION_COOKIE = setCookie ? setCookie.split(";")[0] : "";
}

function authHeaders() {
  return { Cookie: SESSION_COOKIE, "Content-Type": "application/json" };
}

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.error(`  ✗ ${name}`);
    failed++;
  }
}

function assertEqual(a, b, name) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) console.error(`    expected: ${JSON.stringify(b)}\n    got:      ${JSON.stringify(a)}`);
  assert(ok, name);
}

// ─── A: getRecordActions() ────────────────────────────────────────────────────

console.log("\n[A] getRecordActions() — action sets by record type");

assert(getRecordActions("account", true).includes("open"),          "account: open present");
assert(getRecordActions("account", true).includes("add-note"),      "account: add-note present");
assert(getRecordActions("account", true).includes("create-task"),   "account: create-task present");
assert(getRecordActions("account", true).includes("search-emails"), "account: search-emails present");
assert(getRecordActions("account", true).includes("create-quote"),  "account: create-quote present");

assert(getRecordActions("lead", true).includes("convert-lead"), "lead: convert-lead present");
assert(getRecordActions("lead", true).includes("assign-owner"), "lead: assign-owner present");
assert(getRecordActions("lead", true).includes("add-note"),     "lead: add-note present");

assert(getRecordActions("contact", true).includes("compose-email"), "contact: compose-email present");
assert(getRecordActions("contact", true).includes("create-task"),   "contact: create-task present");

assert(getRecordActions("opportunity", true).includes("update-stage"), "opportunity: update-stage present");
assert(getRecordActions("opportunity", true).includes("create-quote"), "opportunity: create-quote present");

assert(getRecordActions("note", true).includes("copy-note"),    "note: copy-note present");
assert(getRecordActions("note", true).includes("open-linked"),  "note: open-linked present");
assert(getRecordActions("note", true).includes("open-context"), "note: open-context present");

assertEqual(getRecordActions("unknown_type", true), [], "unknown type returns empty array");

// ─── B: parseSmartAction() ───────────────────────────────────────────────────

console.log("\n[B] parseSmartAction() — query pattern detection");

{
  const r = parseSmartAction("task for barrie marina");
  assert(r !== null,                        "task for X — detected");
  assert(r?.actionId === "create-task",     "task for X — actionId correct");
  assert(r?.entityQuery === "barrie marina","task for X — entityQuery correct");
}
{
  const r = parseSmartAction("note on quay west");
  assert(r !== null,                     "note on X — detected");
  assert(r?.actionId === "add-note",     "note on X — actionId correct");
  assert(r?.entityQuery === "quay west", "note on X — entityQuery correct");
}
{
  const r = parseSmartAction("email greg");
  assert(r !== null,                      "email X — detected");
  assert(r?.actionId === "compose-email", "email X — actionId correct");
  assert(r?.entityQuery === "greg",       "email X — entityQuery correct");
}
{
  const r = parseSmartAction("quote for port credit");
  assert(r !== null,                         "quote for X — detected");
  assert(r?.actionId === "create-quote",     "quote for X — actionId correct");
  assert(r?.entityQuery === "port credit",   "quote for X — entityQuery correct");
}
{
  const r = parseSmartAction("create task for bluewater marina");
  assert(r !== null,                             "create task for X — detected");
  assert(r?.entityQuery === "bluewater marina",  "create task for X — entityQuery correct");
}
{
  const r = parseSmartAction("add note for collingwood");
  assert(r !== null,                      "add note for X — detected");
  assert(r?.actionId === "add-note",      "add note for X — actionId correct");
  assert(r?.entityQuery === "collingwood","add note for X — entityQuery correct");
}
assert(parseSmartAction("barrie marina") === null,    "plain query — no smart action");
assert(parseSmartAction("port") === null,             "short query — no smart action");
assert(parseSmartAction("create") === null,           "verb only — no smart action");
assert(parseSmartAction("email") === null,            "verb only (email) — no smart action");

// ─── C: Permission gating ────────────────────────────────────────────────────

console.log("\n[C] Permission gating — canEdit=false filters write actions");

{
  const noEdit = getRecordActions("account", false);
  assert(noEdit.includes("open"),           "view-only account: open allowed");
  assert(!noEdit.includes("add-note"),      "view-only account: add-note hidden");
  assert(!noEdit.includes("create-task"),   "view-only account: create-task hidden");
  assert(!noEdit.includes("create-quote"),  "view-only account: create-quote hidden");
  assert(noEdit.includes("search-emails"),  "view-only account: search-emails allowed (read)");
}
{
  const noEdit = getRecordActions("lead", false);
  assert(noEdit.includes("open"),           "view-only lead: open allowed");
  assert(!noEdit.includes("convert-lead"),  "view-only lead: convert-lead hidden");
  assert(!noEdit.includes("assign-owner"),  "view-only lead: assign-owner hidden");
  assert(!noEdit.includes("add-note"),      "view-only lead: add-note hidden");
  assert(!noEdit.includes("create-task"),   "view-only lead: create-task hidden");
}
{
  const noEdit = getRecordActions("contact", false);
  assert(noEdit.includes("open"),            "view-only contact: open allowed");
  assert(noEdit.includes("compose-email"),   "view-only contact: compose-email allowed (read)");
  assert(!noEdit.includes("add-note"),       "view-only contact: add-note hidden");
  assert(!noEdit.includes("create-task"),    "view-only contact: create-task hidden");
}
{
  const noEdit = getRecordActions("opportunity", false);
  assert(noEdit.includes("open"),            "view-only opportunity: open allowed");
  assert(!noEdit.includes("update-stage"),   "view-only opportunity: update-stage hidden");
  assert(!noEdit.includes("create-quote"),   "view-only opportunity: create-quote hidden");
}
{
  const noEdit = getRecordActions("note", false);
  assert(noEdit.includes("open-context"),    "view-only note: open-context allowed");
  assert(noEdit.includes("copy-note"),       "view-only note: copy-note allowed (client-only)");
  assert(noEdit.includes("open-linked"),     "view-only note: open-linked allowed (navigation)");
}

// ─── D: Keyboard nav state machine ───────────────────────────────────────────

console.log("\n[D] Keyboard nav state machine");

{
  // Arrow down from -1 → 0
  let s = makeNavState(5);
  s.actionsForActive = 4;
  s = applyKey(s, "ArrowDown");
  assert(s.activeIndex === 0, "ArrowDown from -1 → activeIndex 0");
}
{
  // Tab enters action mode when result is active
  let s = makeNavState(3);
  s.activeIndex = 0;
  s.actionsForActive = 4;
  s = applyKey(s, "Tab");
  assert(s.actionMode === true,  "Tab on result enters actionMode");
  assert(s.actionIndex === 0,    "Tab enters actionIndex 0");
}
{
  // Tab cycles through actions
  let s = makeNavState(3);
  s.activeIndex = 0;
  s.actionsForActive = 4;
  s = applyKey(s, "Tab");     // actionMode, idx 0
  s = applyKey(s, "Tab");     // idx 1
  s = applyKey(s, "Tab");     // idx 2
  s = applyKey(s, "Tab");     // idx 3
  assert(s.actionMode === true,  "Tab cycles within actions");
  assert(s.actionIndex === 3,    "Tab at last action — stays in action mode at 3");
  s = applyKey(s, "Tab");     // exit — move to next result
  assert(s.actionMode === false,          "Tab past last action exits actionMode");
  assert(s.actionIndex === -1,            "Tab past last action clears actionIndex");
  assert(s.activeIndex === 1,             "Tab past last action advances activeIndex");
}
{
  // ArrowRight enters action mode
  let s = makeNavState(3);
  s.activeIndex = 1;
  s.actionsForActive = 3;
  s = applyKey(s, "ArrowRight");
  assert(s.actionMode === true, "→ enters actionMode");
  assert(s.actionIndex === 0,   "→ starts at actionIndex 0");
  s = applyKey(s, "ArrowRight");
  assert(s.actionIndex === 1,   "→ moves to actionIndex 1");
}
{
  // ArrowLeft exits action mode or moves back
  let s = makeNavState(3);
  s.activeIndex = 0;
  s.actionsForActive = 3;
  s = applyKey(s, "ArrowRight"); // enter mode, idx 0
  s = applyKey(s, "ArrowRight"); // idx 1
  s = applyKey(s, "ArrowLeft");  // idx 0
  assert(s.actionMode === true,  "← at idx 1 stays in actionMode");
  assert(s.actionIndex === 0,    "← at idx 1 moves to actionIndex 0");
  s = applyKey(s, "ArrowLeft");  // exit
  assert(s.actionMode === false, "← at idx 0 exits actionMode");
  assert(s.actionIndex === -1,   "← at idx 0 clears actionIndex");
}
{
  // ArrowDown exits action mode
  let s = makeNavState(3);
  s.activeIndex = 0;
  s.actionsForActive = 3;
  s = applyKey(s, "Tab");          // enter action mode
  assert(s.actionMode === true,    "pre-condition: actionMode");
  s = applyKey(s, "ArrowDown");
  assert(s.actionMode === false,   "↓ exits actionMode");
  assert(s.activeIndex === 1,      "↓ advances activeIndex");
}
{
  // Escape in action mode exits (not close)
  let s = makeNavState(3);
  s.activeIndex = 1;
  s.actionsForActive = 2;
  s = applyKey(s, "Tab");
  assert(s.actionMode === true,    "pre-condition: actionMode");
  s = applyKey(s, "Escape");
  assert(s.actionMode === false,   "Esc exits actionMode");
  assert(s.actionIndex === -1,     "Esc clears actionIndex");
  assert(s.activeIndex === 1,      "Esc keeps activeIndex (doesn't close)");
}
{
  // Escape when NOT in action mode resets activeIndex (close dropdown)
  let s = makeNavState(3);
  s.activeIndex = 2;
  s = applyKey(s, "Escape");
  assert(s.activeIndex === -1,     "Esc without actionMode clears activeIndex");
}
{
  // Shift+Tab exits action mode
  let s = makeNavState(3);
  s.activeIndex = 0;
  s.actionsForActive = 3;
  s = applyKey(s, "Tab");
  assert(s.actionMode === true, "pre-condition: actionMode");
  s = applyKey(s, "Tab", { shiftKey: true });
  assert(s.actionMode === false, "Shift+Tab exits actionMode");
}

// ─── E: Backend /api/quick-actions/task ──────────────────────────────────────

console.log("\n[E] Backend /api/quick-actions/task endpoint");

await login();

{
  // Valid request creates task
  const res = await fetch(`${BASE}/api/quick-actions/task`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ linkedObjectType: "account", linkedObjectId: 1, linkedLabel: "Test Marina" }),
  });
  assert(res.status === 201, "POST /api/quick-actions/task — 201 on valid request");
  if (res.status === 201) {
    const task = await res.json();
    assert(task.title?.startsWith("Follow up:"), "quick task — title starts with 'Follow up:'");
    assert(task.title?.includes("Test Marina"),  "quick task — title includes linked label");
    assert(task.linkedObjectType === "account",  "quick task — linkedObjectType correct");
    assert(task.linkedObjectId === 1,            "quick task — linkedObjectId correct");
    assert(task.status === "pending",            "quick task — status is pending");
    assert(task.priority === "medium",           "quick task — priority is medium");
  } else {
    await res.text(); // drain body
  }
}
{
  // Missing linkedObjectType → 400
  const res = await fetch(`${BASE}/api/quick-actions/task`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ linkedLabel: "Test" }),
  });
  assert(res.status === 400, "POST /api/quick-actions/task — 400 when linkedObjectType missing");
  await res.text();
}
{
  // Unauthenticated → 401
  const res = await fetch(`${BASE}/api/quick-actions/task`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ linkedObjectType: "account", linkedObjectId: 1 }),
  });
  assert(res.status === 401, "POST /api/quick-actions/task — 401 when unauthenticated");
  await res.text();
}

// ─── F: Regression — existing command bar search still works ─────────────────

console.log("\n[F] Regression — existing search behavior unchanged");

{
  const res = await fetch(`${BASE}/api/search?q=barrie`, { headers: authHeaders() });
  assert(res.ok, "GET /api/search?q=barrie — 200 OK");
  if (res.ok) {
    const data = await res.json();
    assert(Array.isArray(data.results), "search returns results array");
    assert(data.results.length > 0,     "barrie returns at least 1 result");
  } else {
    await res.text();
  }
}
{
  const res = await fetch(`${BASE}/api/search?q=port+credit`, { headers: authHeaders() });
  assert(res.ok, "GET /api/search?q=port+credit — 200 OK");
  if (res.ok) {
    const data = await res.json();
    const hasPortCredit = data.results.some(r =>
      r.label?.toLowerCase().includes("port credit") || r.label?.toLowerCase().includes("portcredit")
    );
    assert(hasPortCredit, "port credit search finds Port Credit result");
  } else {
    await res.text();
  }
}
{
  // Smart action entityQuery parsing: "task for barrie" should search "barrie"
  const smartInput = parseSmartAction("task for barrie marina");
  assert(smartInput !== null,                       "smart action parses 'task for barrie marina'");
  assert(smartInput?.entityQuery === "barrie marina","entity query is 'barrie marina' (no verb)");

  if (smartInput) {
    const res = await fetch(`${BASE}/api/search?q=${encodeURIComponent(smartInput.entityQuery)}`, { headers: authHeaders() });
    assert(res.ok, "smart action entityQuery is searchable");
    if (res.ok) {
      const data = await res.json();
      assert(data.results.length > 0, "smart action search returns results");
    } else {
      await res.text();
    }
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed}/${total} passed${failed > 0 ? `, ${failed} FAILED` : " ✓"}`);
if (failed > 0) process.exit(1);
