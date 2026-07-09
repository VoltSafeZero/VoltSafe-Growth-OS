#!/usr/bin/env node
/**
 * Team Tasks overhaul — source-grep regression suite.
 *
 * Verifies:
 *   (A) shared/schema.ts has an additive isTeamTask/assignedAt/assignedByUserId
 *       column set on `tasks` (no retroactive default besides false).
 *   (B) server startup runs an idempotent ADD COLUMN IF NOT EXISTS migration
 *       for the new columns.
 *   (C) GET /api/tasks/board?view=team is scoped purely to is_team_task=true
 *       for every user (no admin "sees everyone" bypass, no viewingUserId
 *       leakage), and never filters by owner_user_id.
 *   (D) GET /api/tasks/hub?view=team uses the same is_team_task=true scoping.
 *   (E) The hub counts query counts team_count from is_team_task, not a
 *       copy-pasted my_count formula.
 *   (F) POST /api/tasks stamps assignedByUserId/assignedAt and forces
 *       boardColumn="backlog" when isTeamTask is set, and writes audit rows.
 *   (G) PATCH /api/tasks/:id detects owner reassignment on a team task and
 *       re-stamps assigned_at/assigned_by_user_id + logs a "reassigned" activity.
 *   (H) Frontend: create-task form has a Team Task toggle; task card shows a
 *       Team badge; humanizeActivity understands assigned/reassigned actions.
 *
 * Run: node tests/team-tasks.test.cjs
 */

const fs = require("fs");

let passed = 0, failed = 0;
const ok  = (l)    => { console.log(`  ✓ ${l}`); passed++; };
const bad = (l, d) => { console.error(`  ✗ ${l}${d ? ` — ${d}` : ""}`); failed++; };

const schema = fs.readFileSync("shared/schema.ts", "utf8");
const routesTasks = fs.readFileSync("server/routes-tasks.ts", "utf8");
const routes = fs.readFileSync("server/routes.ts", "utf8");
const taskBoard = fs.readFileSync("client/src/components/tasks/task-board.tsx", "utf8");
const taskDrawer = fs.readFileSync("client/src/components/tasks/task-detail-drawer.tsx", "utf8");

console.log("── A. Schema: additive isTeamTask columns ──");
{
  if (/isTeamTask:\s*boolean\(["']is_team_task["']\)/.test(schema.replace(/\s+/g, " ")) || /is_team_task/.test(schema))
    ok("tasks table has an is_team_task column");
  else
    bad("is_team_task column in shared/schema.ts", "not found");

  if (/assigned_at/.test(schema))
    ok("tasks table has an assigned_at column");
  else
    bad("assigned_at column in shared/schema.ts", "not found");

  if (/assigned_by_user_id/.test(schema))
    ok("tasks table has an assigned_by_user_id column");
  else
    bad("assigned_by_user_id column in shared/schema.ts", "not found");
}

console.log("\n── B. Idempotent additive migration ──");
{
  if (/ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_team_task/.test(routesTasks))
    ok("bootstrap migration adds is_team_task with IF NOT EXISTS");
  else
    bad("is_team_task ADD COLUMN IF NOT EXISTS", "not found");

  if (/ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_team_task BOOLEAN NOT NULL DEFAULT false/.test(routesTasks))
    ok("is_team_task defaults to false (no retroactive flagging)");
  else
    bad("is_team_task DEFAULT false", "not found — must not retroactively flag existing tasks");
}

console.log("\n── C. GET /api/tasks/board?view=team scoping ──");
{
  if (/view === "team"/.test(routesTasks) && /WHERE t\.archived = false AND t\.is_team_task = true/.test(routesTasks))
    ok("board team branch filters strictly on is_team_task=true");
  else
    bad("board team branch is_team_task filter", "not found");

  const teamBranchMatch = routesTasks.match(/if \(view === "team"\) \{[\s\S]*?return res\.json\(\{ columns: colValues, grouped, total: tasks\.length \}\);\s*\}/);
  if (teamBranchMatch) {
    const block = teamBranchMatch[0];
    if (!/owner_user_id = \$\{/.test(block) && !/viewingUserId/.test(block))
      ok("board team branch does not scope by owner_user_id or viewingUserId");
    else
      bad("board team branch leak", "found owner_user_id/viewingUserId scoping inside team branch");
  } else {
    bad("locate board team branch block", "regex did not match");
  }
}

console.log("\n── D. GET /api/tasks/hub?view=team scoping ──");
{
  if (/whereClause = `t\.is_team_task = true AND t\.status NOT IN \('done','completed'\)`/.test(routes))
    ok("hub team view WHERE clause scoped to is_team_task=true only");
  else
    bad("hub team WHERE clause", "not found or not scoped correctly");

  if (!/isAdminUser \? "" : `t\.owner_user_id/.test(routes.split('case "team":')[1]?.slice(0, 400) || ""))
    ok("hub team view no longer has the old admin 'sees everyone' owner-scoped branch");
  else
    bad("stale admin owner-scoped team branch", "still present");
}

console.log("\n── E. Hub counts: team_count from is_team_task ──");
{
  if (/COUNT\(\*\) FILTER \(WHERE is_team_task = true AND status NOT IN \('done','completed'\)\)::int AS team_count/.test(routes))
    ok("team_count aggregates is_team_task=true rows");
  else
    bad("team_count formula", "not scoped to is_team_task");
}

console.log("\n── F. POST /api/tasks: assignment stamping + audit ──");
{
  if (/if \(body\.isTeamTask\) \{[\s\S]*?body\.assignedByUserId = userId;[\s\S]*?body\.assignedAt = new Date\(\);[\s\S]*?body\.boardColumn = "backlog";/.test(routes))
    ok("creating a team task stamps assignedByUserId/assignedAt and forces boardColumn=backlog");
  else
    bad("team task creation stamping", "not found");

  if (/INSERT INTO task_activity[\s\S]{0,120}'created'/.test(routes))
    ok("POST /api/tasks writes a 'created' audit row");
  else
    bad("'created' audit row on task creation", "not found");

  if (/INSERT INTO task_activity[\s\S]{0,200}'assigned'/.test(routes))
    ok("POST /api/tasks writes an 'assigned' audit row for team tasks");
  else
    bad("'assigned' audit row on team task creation", "not found");
}

console.log("\n── G. PATCH /api/tasks/:id: reassignment audit ──");
{
  if (/isTeamTaskAfter/.test(routesTasks))
    ok("PATCH handler computes isTeamTaskAfter to detect team-task reassignment");
  else
    bad("isTeamTaskAfter detection", "not found");

  if (/assigned_at\s*=\s*NOW\(\)/.test(routesTasks) && /assigned_by_user_id\s*=/.test(routesTasks))
    ok("reassignment re-stamps assigned_at/assigned_by_user_id");
  else
    bad("reassignment re-stamping", "not found");

  if (/logActivity\([\s\S]{0,200}"reassigned"/.test(routesTasks))
    ok("reassignment writes a 'reassigned' activity row via logActivity");
  else
    bad("'reassigned' logActivity call", "not found");

  if (/board_column\s*=\s*'backlog'/.test(routesTasks))
    ok("reassignment moves the task back to the Backlog column for the new assignee");
  else
    bad("reassignment board_column reset to backlog", "not found");
}

console.log("\n── H. Frontend: toggle, badge, audit copy ──");
{
  if (/checkbox-new-task-team-task/.test(taskDrawer) && /isTeamTask/.test(taskDrawer))
    ok("New Task form has a Team Task checkbox wired to isTeamTask state");
  else
    bad("Team Task checkbox in NewTaskForm", "not found");

  if (/isTeamTask,/.test(taskDrawer.match(/mutationFn: async \(\) => \{[\s\S]*?\}\);/)?.[0] || "") ||
      /isTeamTask,\s*\n\s*\.\.\.\(linkedContact/.test(taskDrawer))
    ok("create-task mutation body includes isTeamTask");
  else
    bad("isTeamTask included in create payload", "not found");

  if (/task\.isTeamTask/.test(taskBoard) && /badge-team-task-/.test(taskBoard))
    ok("board card renders a Team Task badge when task.isTeamTask is set");
  else
    bad("Team badge on task card", "not found");

  if (/case "assigned": return/.test(taskDrawer) && /case "reassigned": return/.test(taskDrawer))
    ok("humanizeActivity understands 'assigned' and 'reassigned' actions");
  else
    bad("humanizeActivity assigned/reassigned cases", "not found");
}

console.log("\n" + "─".repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\n❌ Some tests FAILED");
  process.exit(1);
} else {
  console.log("\n✅ All tests PASSED");
}
