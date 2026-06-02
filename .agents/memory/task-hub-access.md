---
name: Task Hub Access
description: Cross-user Tasks Hub access system — how master admins grant other users permission to view/edit someone else's task hub.
---

## The rule

`task_hub_access_permissions` table (no FK constraints): `id`, `grantor_user_id`, `target_user_id`, `viewer_user_id`, `permission_level` ("view"|"edit"), `created_at`.

**Why:** Admins can delegate task oversight to non-admin users without giving them full admin rights. Only master_admin or admin can grant access to any user's hub; non-admins can only view hubs they were explicitly granted.

## How to apply

- Backend routes in `server/routes-tasks.ts`: `GET /api/tasks/hub-access/my-access`, `GET /api/admin/task-hub-access`, `POST /api/admin/task-hub-access`, `DELETE /api/admin/task-hub-access/:id`.
- `GET /api/tasks/board` and `GET /api/tasks/hub` both accept `?viewingUserId=N` — server checks access before substituting the effective user.
- Admin UI: `client/src/pages/admin-task-access.tsx` (route `/admin/task-hub-access`, nav entry `admin-task-access`).
- Frontend switcher: `tasks-hub.tsx` `viewingUserId` state → user switcher dropdown in header → context banner below tabs → `readOnly={isViewOnly}` passed to GroupSection/TaskRow → `viewingUserId` passed to TaskBoard.
- TaskBoard (`task-board.tsx`) accepts optional `viewingUserId?: number | null` and passes it into the board query URL.

## Email domain fix (CRM Review Auto button)

`extractEmailDomain` helper in `gmail-inbox.tsx` strips display names from `"Name <email@domain>"` format before domain extraction. Both `,` and `;` delimiters handled. Server-side `cleanDomain` in `routes.ts` also strips leading `<` and trailing `>`.
