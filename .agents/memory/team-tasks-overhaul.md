---
name: Team Tasks flag-scoped board
description: How the Team Tasks board is scoped (is_team_task flag, not "everyone's tasks") and where the audit trail lives.
---

Team Tasks is a single shared board filtered purely by `tasks.is_team_task = true`,
independent of `owner_user_id`, `board_column`, or admin status. It intentionally
does NOT reuse the old "admin sees everyone's tasks" pattern — that was the bug.
Any new "team-wide" board/view must filter by an explicit flag column, never by
role, or personal tasks silently leak in for admins.

**Why:** the original Team Tasks view showed all tasks system-wide to admins,
conflating "team-flagged" with "everyone's". Two call sites had to be fixed in
lockstep (`GET /api/tasks/board?view=team` and `GET /api/tasks/hub?view=team`),
plus a duplicated counts-query formula (`team_count` was copy-pasted from
`my_count` instead of counting the flag).

**How to apply:** when adding a new cross-user "shared" view, grep every route
that branches on `view === "<name>"` — hub, board, and any counts/summary query
each need their own WHERE clause updated; they don't share one code path.

Audit trail reuses the existing generic `task_activity` table + `logActivity()`
helper (no new table). Assignment/reassignment on a team task also force
`board_column='backlog'` for the new assignee, so "created → lands in
assignee's Backlog" and "reassigned → back to Backlog" are the same code path.
