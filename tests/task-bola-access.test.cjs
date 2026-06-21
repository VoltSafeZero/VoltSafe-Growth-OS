#!/usr/bin/env node
/**
 * Task Hub — Broken Object-Level Authorization (BOLA) security test
 *
 * Source-grep invariants that verify every direct-task endpoint enforces
 * per-task object-level access via requireTaskAccess() before operating on
 * the record. Any endpoint that regresses to operating without this check
 * would re-open the BOLA vulnerability described in Task #34.
 *
 * Run: node tests/task-bola-access.test.cjs
 */

const fs = require("fs");
const src = fs.readFileSync("server/routes-tasks.ts", "utf8");

let passed = 0, failed = 0;
const ok  = (l)    => { console.log(`  ✓ ${l}`); passed++; };
const bad = (l, d) => { console.error(`  ✗ ${l}${d ? ` — ${d}` : ""}`); failed++; };

// ── 1. requireTaskAccess helper is defined ─────────────────────────────────
console.log("── 1. requireTaskAccess helper is defined ──");
{
  if (/async function requireTaskAccess/.test(src))
    ok("requireTaskAccess async function defined in routes-tasks.ts");
  else
    bad("requireTaskAccess async function defined", "not found");

  if (/SELECT owner_user_id, created_by_user_id FROM tasks WHERE id/.test(src))
    ok("requireTaskAccess fetches owner_user_id + created_by_user_id");
  else
    bad("requireTaskAccess fetches ownership columns", "query not found");

  if (/task\.owner_user_id === userId.*task\.created_by_user_id === userId.*isAdmin/.test(src.replace(/\n/g, " ")))
    ok("requireTaskAccess grants access to owner, creator, and admin");
  else
    bad("requireTaskAccess owner/creator/admin fast-path", "not found");

  if (/readOnly && level !== null/.test(src))
    ok("requireTaskAccess accepts view hub-grant for read-only access");
  else
    bad("requireTaskAccess read-only hub-grant branch", "not found");

  if (/level === "edit"/.test(src))
    ok("requireTaskAccess requires edit hub-grant for write access");
  else
    bad("requireTaskAccess edit grant check", "not found");

  if (/res\.status\(403\).*Access denied/.test(src.replace(/\n/g, " ")))
    ok("requireTaskAccess returns 403 on access denied");
  else
    bad("requireTaskAccess 403 response", "not found");
}

// ── 2. GET /api/tasks/:id/full enforces read access ───────────────────────
console.log("\n── 2. GET /api/tasks/:id/full ──");
{
  const block = src.match(/app\.get\("\/api\/tasks\/:id\/full"[\s\S]{0,600}/)?.[0] ?? "";
  if (/requireTaskAccess\(req, res, id, true\)/.test(block))
    ok("GET /tasks/:id/full calls requireTaskAccess(readOnly=true)");
  else
    bad("GET /tasks/:id/full access check", "requireTaskAccess(req,res,id,true) not found in route block");
}

// ── 3. PATCH /api/tasks/:id/board enforces write access ───────────────────
console.log("\n── 3. PATCH /api/tasks/:id/board ──");
{
  const block = src.match(/app\.patch\("\/api\/tasks\/:id\/board"[\s\S]{0,800}/)?.[0] ?? "";
  if (/requireTaskAccess\(req, res, id\)/.test(block))
    ok("PATCH /tasks/:id/board calls requireTaskAccess(write)");
  else
    bad("PATCH /tasks/:id/board access check", "requireTaskAccess not found in route block");
}

// ── 4. PATCH /api/tasks/:id enforces write access ─────────────────────────
console.log("\n── 4. PATCH /api/tasks/:id ──");
{
  const block = src.match(/app\.patch\("\/api\/tasks\/:id"[^/][\s\S]{0,500}/)?.[0] ?? "";
  if (/requireTaskAccess\(req, res, id\)/.test(block))
    ok("PATCH /tasks/:id calls requireTaskAccess(write)");
  else
    bad("PATCH /tasks/:id access check", "requireTaskAccess not found in route block");
}

// ── 5. POST /api/tasks/:id/complete enforces write access ─────────────────
console.log("\n── 5. POST /api/tasks/:id/complete ──");
{
  const block = src.match(/app\.post\("\/api\/tasks\/:id\/complete"[\s\S]{0,500}/)?.[0] ?? "";
  if (/requireTaskAccess\(req, res, id\)/.test(block))
    ok("POST /tasks/:id/complete calls requireTaskAccess");
  else
    bad("POST /tasks/:id/complete access check", "requireTaskAccess not found");
}

// ── 6. POST /api/tasks/:id/reopen enforces write access ───────────────────
console.log("\n── 6. POST /api/tasks/:id/reopen ──");
{
  const block = src.match(/app\.post\("\/api\/tasks\/:id\/reopen"[\s\S]{0,500}/)?.[0] ?? "";
  if (/requireTaskAccess\(req, res, id\)/.test(block))
    ok("POST /tasks/:id/reopen calls requireTaskAccess");
  else
    bad("POST /tasks/:id/reopen access check", "requireTaskAccess not found");
}

// ── 7. POST /api/tasks/:id/dependencies enforces write access ─────────────
console.log("\n── 7. POST /api/tasks/:id/dependencies ──");
{
  const block = src.match(/app\.post\("\/api\/tasks\/:id\/dependencies"[\s\S]{0,600}/)?.[0] ?? "";
  if (/requireTaskAccess\(req, res, id\)/.test(block))
    ok("POST /tasks/:id/dependencies calls requireTaskAccess");
  else
    bad("POST /tasks/:id/dependencies access check", "requireTaskAccess not found");
}

// ── 8. DELETE /api/tasks/:id/dependencies/:depId enforces write access ────
console.log("\n── 8. DELETE /api/tasks/:id/dependencies/:depId ──");
{
  const block = src.match(/app\.delete\("\/api\/tasks\/:id\/dependencies\/:depId"[\s\S]{0,500}/)?.[0] ?? "";
  if (/requireTaskAccess\(req, res, id\)/.test(block))
    ok("DELETE /tasks/:id/dependencies/:depId calls requireTaskAccess");
  else
    bad("DELETE /tasks/:id/dependencies/:depId access check", "requireTaskAccess not found");
}

// ── 9. Label assignment endpoints enforce write access ────────────────────
console.log("\n── 9. Label assignment ──");
{
  const addBlock  = src.match(/app\.post\("\/api\/tasks\/:id\/labels\/:labelId"[\s\S]{0,500}/)?.[0] ?? "";
  const delBlock  = src.match(/app\.delete\("\/api\/tasks\/:id\/labels\/:labelId"[\s\S]{0,500}/)?.[0] ?? "";
  if (/requireTaskAccess\(req, res, id\)/.test(addBlock))
    ok("POST /tasks/:id/labels/:labelId calls requireTaskAccess");
  else
    bad("POST /tasks/:id/labels/:labelId access check", "requireTaskAccess not found");
  if (/requireTaskAccess\(req, res, id\)/.test(delBlock))
    ok("DELETE /tasks/:id/labels/:labelId calls requireTaskAccess");
  else
    bad("DELETE /tasks/:id/labels/:labelId access check", "requireTaskAccess not found");
}

// ── 10. Checklist endpoints enforce write access ───────────────────────────
console.log("\n── 10. Checklist endpoints ──");
{
  const createCl  = src.match(/app\.post\("\/api\/tasks\/:id\/checklists"[\s\S]{0,500}/)?.[0] ?? "";
  const deleteCl  = src.match(/app\.delete\("\/api\/task-checklists\/:id"[\s\S]{0,600}/)?.[0] ?? "";
  const createItem = src.match(/app\.post\("\/api\/task-checklists\/:id\/items"[\s\S]{0,700}/)?.[0] ?? "";
  const patchItem  = src.match(/app\.patch\("\/api\/task-checklist-items\/:id"[\s\S]{0,700}/)?.[0] ?? "";
  const deleteItem = src.match(/app\.delete\("\/api\/task-checklist-items\/:id"[\s\S]{0,700}/)?.[0] ?? "";

  if (/requireTaskAccess\(req, res, id\)/.test(createCl))
    ok("POST /tasks/:id/checklists calls requireTaskAccess");
  else
    bad("POST /tasks/:id/checklists access check", "requireTaskAccess not found");

  if (/requireTaskAccess\(req, res, row\.task_id\)/.test(deleteCl))
    ok("DELETE /task-checklists/:id calls requireTaskAccess via row.task_id");
  else
    bad("DELETE /task-checklists/:id access check", "requireTaskAccess(req,res,row.task_id) not found");

  if (/requireTaskAccess\(req, res, taskId\)/.test(createItem))
    ok("POST /task-checklists/:id/items calls requireTaskAccess via taskId");
  else
    bad("POST /task-checklists/:id/items access check", "requireTaskAccess(req,res,taskId) not found");

  if (/requireTaskAccess\(req, res, row\.task_id\)/.test(patchItem))
    ok("PATCH /task-checklist-items/:id calls requireTaskAccess via row.task_id");
  else
    bad("PATCH /task-checklist-items/:id access check", "requireTaskAccess(req,res,row.task_id) not found");

  if (/requireTaskAccess\(req, res, taskId\)/.test(deleteItem))
    ok("DELETE /task-checklist-items/:id calls requireTaskAccess via taskId");
  else
    bad("DELETE /task-checklist-items/:id access check", "requireTaskAccess(req,res,taskId) not found");

  // DELETE /task-checklist-items/:id must load task_id via JOIN before checking
  if (/SELECT c\.task_id FROM task_checklist_items i[\s\S]{0,400}requireTaskAccess/.test(deleteItem))
    ok("DELETE /task-checklist-items/:id fetches task_id via JOIN before access check");
  else
    bad("DELETE /task-checklist-items/:id JOIN+access order", "task_id JOIN before requireTaskAccess not found");
}

// ── 11. Watcher endpoints enforce write access ────────────────────────────
console.log("\n── 11. Watcher endpoints ──");
{
  const addW = src.match(/app\.post\("\/api\/tasks\/:id\/watchers\/:userId"[\s\S]{0,500}/)?.[0] ?? "";
  const delW = src.match(/app\.delete\("\/api\/tasks\/:id\/watchers\/:userId"[\s\S]{0,500}/)?.[0] ?? "";
  if (/requireTaskAccess\(req, res, id\)/.test(addW))
    ok("POST /tasks/:id/watchers/:userId calls requireTaskAccess");
  else
    bad("POST /tasks/:id/watchers/:userId access check", "requireTaskAccess not found");
  if (/requireTaskAccess\(req, res, id\)/.test(delW))
    ok("DELETE /tasks/:id/watchers/:userId calls requireTaskAccess");
  else
    bad("DELETE /tasks/:id/watchers/:userId access check", "requireTaskAccess not found");
}

// ── 12. Comment endpoints enforce access ──────────────────────────────────
console.log("\n── 12. Comment endpoints ──");
{
  const getC  = src.match(/app\.get\("\/api\/tasks\/:id\/comments"[\s\S]{0,500}/)?.[0] ?? "";
  const postC = src.match(/app\.post\("\/api\/tasks\/:id\/comments"[\s\S]{0,500}/)?.[0] ?? "";
  if (/requireTaskAccess\(req, res, id, true\)/.test(getC))
    ok("GET /tasks/:id/comments calls requireTaskAccess(readOnly=true)");
  else
    bad("GET /tasks/:id/comments access check", "requireTaskAccess(req,res,id,true) not found");
  if (/requireTaskAccess\(req, res, id\)/.test(postC))
    ok("POST /tasks/:id/comments calls requireTaskAccess(write)");
  else
    bad("POST /tasks/:id/comments access check", "requireTaskAccess not found");
}

// ── 13. Search scoped to caller's visible tasks ───────────────────────────
console.log("\n── 13. GET /api/tasks/search scoping ──");
{
  const block = src.match(/app\.get\("\/api\/tasks\/search"[\s\S]{0,1200}/)?.[0] ?? "";
  if (/visibilityClause/.test(block))
    ok("GET /tasks/search uses a visibilityClause variable to scope results");
  else
    bad("GET /tasks/search scoping", "visibilityClause not found");

  if (/owner_user_id = \$\{userId\}/.test(block))
    ok("search scoping includes own tasks (owner_user_id filter)");
  else
    bad("search scoping — own tasks filter", "owner_user_id = userId not found");

  if (/created_by_user_id = \$\{userId\}/.test(block))
    ok("search scoping includes tasks created by caller (created_by_user_id filter)");
  else
    bad("search scoping — creator filter", "created_by_user_id = userId not found");

  if (/SELECT target_user_id FROM task_hub_access_permissions/.test(block))
    ok("search scoping includes tasks from hub-access-granted users");
  else
    bad("search scoping — hub-access subquery", "task_hub_access_permissions subquery not found");

  if (/admin[\s\S]{0,50}sql``/.test(block.replace(/\n/g, " ")) || /admin.*visibilityClause.*sql``/.test(block.replace(/\n/g, " ")))
    ok("admin bypasses visibility restriction (sees all tasks)");
  else if (/\(admin.*\).*\? sql``/.test(block.replace(/\n/g, " ")))
    ok("admin bypasses visibility restriction (ternary guard)");
  else
    bad("search scoping — admin bypass", "admin bypass not found");
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
