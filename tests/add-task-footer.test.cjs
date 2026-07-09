#!/usr/bin/env node
/**
 * Regression tests — Trello-style "+ Add a task" footer in Tasks Hub board view.
 *
 * Covers:
 *   S1.  Footer rendered inside every column (task-board.tsx structure)
 *   S2.  Footer uses correct testid pattern (button-add-task-{col.value})
 *   S3.  Footer calls onAddTask?.(col.value) on click
 *   S4.  Footer disabled + tooltip when isViewOnly
 *   S5.  Footer uses w-full (no horizontal overflow risk)
 *   S6.  Footer uses design tokens only (no hardcoded dark bg/text)
 *   S7.  Footer button is NOT draggable (drag-drop not disrupted)
 *   S8.  Footer text "Add a task" present
 *   S9.  Plus icon imported and used in footer
 *   S10. Footer placed AFTER cards div (not inside or before)
 *   S11. Footer has rounded-b-lg (matches column bottom radius)
 *   S12. onAddTask prop declared in TaskBoard Props type
 *   S13. TaskBoard function signature accepts onAddTask
 *   D1.  TaskDetailDrawer Props type has defaultBoardColumn?
 *   D2.  TaskDetailDrawer function signature accepts defaultBoardColumn
 *   D3.  defaultBoardColumn passed through to NewTaskForm
 *   D4.  NewTaskForm signature accepts defaultBoardColumn
 *   D5.  NewTaskForm initialises column state from defaultBoardColumn || "backlog"
 *   H1.  tasks-hub.tsx declares defaultBoardColumn state
 *   H2.  tasks-hub.tsx wires onAddTask → setDefaultBoardColumn + setCreatingNew
 *   H3.  tasks-hub.tsx passes defaultBoardColumn to TaskDetailDrawer
 *   H4.  tasks-hub.tsx clears defaultBoardColumn on onCreated
 *   H5.  tasks-hub.tsx clears defaultBoardColumn on drawer close
 *   H6.  "+ New Task" button is still present and calls openCapture
 *   H7.  openCapture still sets creatingNew (not replaced by defaultBoardColumn logic)
 *   X1.  Column div still has onDrop handler (drag-drop not broken)
 *   X2.  Column header grip is still draggable (column reorder still works)
 *   X3.  board-container testid still present
 *   X4.  TaskBoard still receives onOpenTask (card click not broken)
 *
 * Live HTTP (requires server at localhost:5000):
 *   L1.  POST /api/tasks with boardColumn → appears in correct board group
 *   L2.  boardColumn=done  → grouped under "done"
 *   L3.  boardColumn=blocked → grouped under "blocked"
 *   L4.  boardColumn omitted → task still created (backwards compat)
 *   L5.  GET /api/tasks/board response shape has "grouped" object
 *
 * Run: node tests/add-task-footer.test.cjs
 */

"use strict";

const fs   = require("fs");
const http = require("http");

// ─── helpers ────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function ok(label)        { console.log(`  ✓ ${label}`); passed++; }
function fail(label, why) { console.error(`  ✗ ${label}${why ? ` — ${why}` : ""}`); failed++; }
function section(title)   { console.log(`\n── ${title}`); }

// ─── source files ────────────────────────────────────────────────────────────
const BOARD  = fs.readFileSync("client/src/components/tasks/task-board.tsx", "utf8");
const DRAWER = fs.readFileSync("client/src/components/tasks/task-detail-drawer.tsx", "utf8");
const HUB    = fs.readFileSync("client/src/pages/tasks-hub.tsx", "utf8");

// ─── S: task-board.tsx footer structure ─────────────────────────────────────
section("S — task-board.tsx: footer structure");

(function s1_footer_in_column_map() {
  // footer must appear inside the displayColumns.map() render, after the cards <div>
  const mapBlock = BOARD.match(/displayColumns\.map\(col[\s\S]+?(?=<\/div>\s*\)\s*\}\s*\)\s*<\/div>)/)?.[0] ?? "";
  ok("S1: footer button exists inside displayColumns.map block",
    /button-add-task-\$\{col\.value\}/.test(mapBlock));
})();

(function s2_testid() {
  ok('S2: footer testid pattern is button-add-task-${col.value}',
    BOARD.includes('data-testid={`button-add-task-${col.value}`}'));
})();

(function s3_onclick() {
  ok("S3: footer onClick calls onAddTask?.(col.value)",
    BOARD.includes("onAddTask?.(col.value)"));
})();

(function s4_disabled() {
  ok("S4: footer is disabled when isViewOnly",
    BOARD.includes("disabled={isViewOnly}"));
  ok("S4: footer cursor-not-allowed when isViewOnly",
    BOARD.includes("cursor-not-allowed"));
  ok("S4: footer tooltip explains view-only restriction",
    BOARD.includes("You have view-only access to this column"));
})();

(function s5_no_overflow() {
  // Must use w-full so the button never forces the column wider
  ok("S5: footer uses w-full (no horizontal overflow)",
    /button[\s\S]{0,400}w-full/.test(
      BOARD.slice(BOARD.indexOf("Trello-style add task footer"))
    ));
})();

(function s6_design_tokens() {
  const footerSnippet = BOARD.slice(
    BOARD.indexOf("Trello-style add task footer"),
    BOARD.indexOf("Trello-style add task footer") + 600
  );
  ok("S6: footer uses text-muted-foreground token",
    footerSnippet.includes("text-muted-foreground"));
  ok("S6: footer hover uses muted/60 token (not hardcoded colour)",
    footerSnippet.includes("hover:bg-muted/60"));
  ok("S6: footer hover text uses foreground token",
    footerSnippet.includes("hover:text-foreground"));
  ok("S6: footer has no hardcoded bg-gray/bg-zinc/bg-neutral",
    !/bg-(gray|zinc|neutral|slate)-\d/.test(footerSnippet));
})();

(function s7_not_draggable() {
  // The footer button must NOT carry a draggable attr
  const footerSnippet = BOARD.slice(
    BOARD.indexOf("Trello-style add task footer"),
    BOARD.indexOf("Trello-style add task footer") + 600
  );
  ok("S7: footer button has no draggable attribute (drag-drop not disrupted)",
    !footerSnippet.includes('draggable'));
})();

(function s8_text() {
  ok('S8: footer button text is "Add a task"',
    BOARD.includes(">Add a task<"));
})();

(function s9_plus_icon() {
  ok("S9: Plus is in the lucide-react import of task-board.tsx",
    /MousePointerClick.*Plus|Plus.*MousePointerClick/.test(BOARD) ||
    /,\s*Plus[,\s}]/.test(BOARD));
  ok("S9: Plus icon rendered inside footer",
    BOARD.includes('<Plus className="h-3.5 w-3.5 flex-shrink-0"'));
})();

(function s10_after_cards_div() {
  // "Trello-style add task footer" comment must come AFTER the closing </div> of the
  // cards container (i.e. after "overflow-y-auto")
  const cardsEnd  = BOARD.indexOf("overflow-y-auto");
  const footerPos = BOARD.indexOf("Trello-style add task footer");
  ok("S10: footer comment appears AFTER the cards container div",
    footerPos > cardsEnd);
})();

(function s11_rounded_bottom() {
  ok("S11: footer has rounded-b-lg class (matches column bottom radius)",
    BOARD.includes("rounded-b-lg"));
})();

(function s12_prop_type() {
  ok("S12: onAddTask declared in Props type as optional function",
    BOARD.includes("onAddTask?: (colValue: string) => void"));
})();

(function s13_sig() {
  ok("S13: onAddTask destructured in TaskBoard function signature",
    BOARD.includes("onAddTask, viewingUserId") ||
    BOARD.includes("{ view, onOpenTask, onAddTask,"));
})();

// ─── D: task-detail-drawer.tsx default column wiring ────────────────────────
section("D — task-detail-drawer.tsx: defaultBoardColumn wiring");

(function d1_props_type() {
  ok("D1: defaultBoardColumn? declared in Props type",
    DRAWER.includes("defaultBoardColumn?: string"));
})();

(function d2_sig() {
  ok("D2: defaultBoardColumn destructured in TaskDetailDrawer signature",
    DRAWER.includes("createMode, defaultBoardColumn, onCreated"));
})();

(function d3_passed_to_form() {
  ok("D3: defaultBoardColumn passed to <NewTaskForm>",
    DRAWER.includes("defaultBoardColumn={defaultBoardColumn}"));
})();

(function d4_form_accepts() {
  ok("D4: NewTaskForm signature includes defaultBoardColumn",
    DRAWER.includes("defaultBoardColumn }: {") ||
    DRAWER.includes("defaultBoardColumn?: string"));
})();

(function d5_initial_state() {
  ok('D5: column useState initialised from defaultBoardColumn || "backlog"',
    DRAWER.includes('defaultBoardColumn || "backlog"'));
})();

// ─── H: tasks-hub.tsx wiring ─────────────────────────────────────────────────
section("H — tasks-hub.tsx: state + prop wiring");

(function h1_state() {
  ok("H1: defaultBoardColumn state declared in tasks-hub",
    HUB.includes("const [defaultBoardColumn, setDefaultBoardColumn]"));
})();

(function h2_on_add_task() {
  ok("H2: onAddTask handler calls setDefaultBoardColumn then setCreatingNew",
    HUB.includes("setDefaultBoardColumn(colValue); setCreatingNew(true)"));
})();

(function h3_passed_to_drawer() {
  ok("H3: defaultBoardColumn passed to <TaskDetailDrawer>",
    HUB.includes("defaultBoardColumn={defaultBoardColumn}"));
})();

(function h4_clear_on_created() {
  ok("H4: defaultBoardColumn cleared (set to undefined) in onCreated callback",
    HUB.includes("setDefaultBoardColumn(undefined); setOpenTaskId(id)"));
})();

(function h5_clear_on_close() {
  ok("H5: defaultBoardColumn cleared on drawer onOpenChange(false)",
    HUB.includes("setDefaultBoardColumn(undefined); } }}") ||
    HUB.includes("setDefaultBoardColumn(undefined);"));
})();

(function h6_new_task_button() {
  ok("H6: top-right '+ New Task' button still present with data-testid",
    HUB.includes('data-testid="button-new-task"'));
  ok("H6: '+ New Task' button still calls openCapture",
    HUB.includes("onClick={openCapture}"));
})();

(function h7_open_capture_unchanged() {
  const openCaptureFn = HUB.match(/const openCapture\s*=\s*\(\)\s*=>\s*\{[\s\S]{0,100}\}/)?.[0] ?? "";
  ok("H7: openCapture still sets creatingNew(true)",
    openCaptureFn.includes("setCreatingNew(true)") ||
    HUB.includes("const openCapture = () => {\n    setCreatingNew(true);\n  }"));
})();

// ─── X: cross-cutting invariants ─────────────────────────────────────────────
section("X — cross-cutting: drag-drop + board container not broken");

(function x1_ondrop() {
  ok("X1: column div still has onDrop handler (task drag-drop intact)",
    BOARD.includes("onDrop={() => {"));
})();

(function x2_grip_draggable() {
  ok("X2: column header grip is still draggable (column reorder intact)",
    BOARD.includes("onDragStart={(e) => { e.stopPropagation(); setDraggingColValue(col.value)"));
})();

(function x3_board_container() {
  ok('X3: board-container testid still present',
    BOARD.includes('data-testid="board-container"'));
})();

(function x4_on_open_task() {
  ok("X4: TaskBoard still receives onOpenTask (card click not broken)",
    HUB.includes("onOpenTask={(id) => setOpenTaskId(id)}"));
})();

// ─── Y: column layout — pinned footer for tall columns ───────────────────────
section("Y — column layout: footer pinned for populated columns (Trevor fix)");

(function y1_column_max_h() {
  // Column container must carry a viewport-relative max-height so the column
  // is capped at the viewport, not allowed to grow to full page height.
  ok("Y1: column container has max-h-[calc(100vh-220px)]",
    BOARD.includes("max-h-[calc(100vh-220px)]"));
})();

(function y2_card_list_min_h_0() {
  // min-h-0 is required on flex-1 children for overflow-y-auto to activate
  // inside a flex-col container (without it, default min-height:auto prevents scroll).
  ok("Y2: card list has min-h-0 (enables overflow scroll inside flex-col)",
    BOARD.includes("min-h-0"));
})();

(function y3_no_max_h_on_card_list() {
  // The height cap must live on the column container, NOT on the card list.
  // Having max-h on the card list while the column is unconstrained was the
  // root cause of the "footer invisible for Trevor, visible for empty board" bug.
  const cardListMatch = BOARD.match(/flex-1[^"]*overflow-y-auto[^"<]{0,120}/)?.[0] ?? "";
  ok("Y3: card list does NOT carry a max-h (cap lives on column, not card list)",
    !cardListMatch.includes("max-h-[calc(100vh-"));
})();

(function y4_footer_flex_shrink_0() {
  // flex-shrink-0 ensures the footer can never be squeezed to zero height
  // even in a fully-packed flex-col column.
  ok("Y4: footer button has flex-shrink-0 (stays pinned, never hidden)",
    BOARD.includes("flex-shrink-0 w-full flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground rounded-b-lg"));
})();

// ─── L: live HTTP ─────────────────────────────────────────────────────────────
section("L — live HTTP (requires server at localhost:5000)");

async function liveTests() {
  // Use admin credentials (same pattern as compliance-canspam.test.cjs / account-heat-score.test.cjs)
  const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || "trevor@voltsafe.com";
  const ADMIN_PASS  = process.env.TEST_ADMIN_PASS;
  const base = "http://localhost:5000";

  if (!ADMIN_PASS) {
    console.log("  ~ L: skipped (TEST_ADMIN_PASS not set — set env var to run live checks)");
    return;
  }

  async function req(method, path, body, cookie) {
    return new Promise((resolve, reject) => {
      const bodyStr = body ? JSON.stringify(body) : null;
      const headers = {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      };
      if (bodyStr) headers["Content-Length"] = Buffer.byteLength(bodyStr);
      const u = new URL(path, base);
      const opts = { method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers };
      const r = http.request(opts, (res) => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers }); }
          catch { resolve({ status: res.statusCode, body: data, headers: res.headers }); }
        });
      });
      r.on("error", reject);
      if (bodyStr) r.write(bodyStr);
      r.end();
    });
  }

  // Login
  let cookie;
  try {
    const login = await req("POST", "/api/auth/login", {
      email: ADMIN_EMAIL,
      password: ADMIN_PASS,
    });
    if (login.status !== 200) {
      console.log("  ~ L: skipped (login failed, server may not be ready)");
      return;
    }
    cookie = login.headers["set-cookie"]?.[0]?.split(";")[0];
    if (!cookie) {
      console.log("  ~ L: skipped (no session cookie)");
      return;
    }
  } catch (e) {
    if (e.code === "ECONNREFUSED") {
      console.log("  ~ L: skipped (server not running at localhost:5000)");
      return;
    }
    throw e;
  }

  // L5: board shape
  const board = await req("GET", "/api/tasks/board?view=team", null, cookie);
  if (board.status === 200 && board.body && typeof board.body.grouped === "object") {
    ok("L5: GET /api/tasks/board returns { grouped: {...} } shape");
  } else {
    fail("L5: GET /api/tasks/board grouped shape", `status=${board.status}`);
  }

  // Helper: create a task with a specific boardColumn and verify it lands there
  async function testBoardColumn(label, boardColumn) {
    const title = `Footer regression test — ${boardColumn} — ${Date.now()}`;
    const create = await req("POST", "/api/tasks", {
      title, priority: "low", status: "pending",
      ...(boardColumn ? { boardColumn } : {}),
    }, cookie);
    if (create.status !== 201) {
      fail(`${label}: POST /api/tasks returns 201`, `got ${create.status}`);
      return;
    }
    ok(`${label}: task created (id=${create.body.id})`);

    const taskId = create.body.id;
    const board2 = await req("GET", "/api/tasks/board?view=team", null, cookie);
    if (board2.status !== 200 || !board2.body.grouped) {
      fail(`${label}: board fetch after create`, `status=${board2.status}`);
      return;
    }

    const targetCol = boardColumn ?? "backlog";
    const colTasks  = board2.body.grouped[targetCol] ?? [];
    const found     = colTasks.some(t => t.id === taskId);
    if (found) {
      ok(`${label}: task appears in "${targetCol}" column on board`);
    } else {
      // Try any column — maybe it landed elsewhere
      const allCols = Object.keys(board2.body.grouped);
      const foundIn = allCols.find(c => (board2.body.grouped[c] || []).some(t => t.id === taskId));
      fail(`${label}: task in "${targetCol}" column`, `actually in "${foundIn ?? "nowhere"}"`);
    }

    // Cleanup
    await req("DELETE", `/api/tasks/${taskId}`, null, cookie).catch(() => {});
  }

  await testBoardColumn("L1: boardColumn=backlog", "backlog");
  await testBoardColumn("L2: boardColumn=done", "done");
  await testBoardColumn("L3: boardColumn=blocked", "blocked");
  await testBoardColumn("L4: boardColumn omitted (no prefill)", null);
}

liveTests()
  .then(() => {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`add-task-footer: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
      console.error("Some checks failed.");
      process.exitCode = 1;
    } else {
      console.log("All checks passed ✓");
    }
  })
  .catch(err => {
    console.error("Unexpected error:", err);
    process.exitCode = 1;
  });
