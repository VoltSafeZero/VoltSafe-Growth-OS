# RBAC Fix Report — "Advisor Test" Role-Visibility Audit

## Summary

Restricted access to Revenue Simulator ("Simulators & Feedback"), the
"Single-day visits" travel option, and the `Leads Nearby` / `My Travel`
dashboard widgets to `master_admin`, `admin`, `manager`, `exec`, and `sales`
globalRoles. All three surfaces are now enforced **server-side** — the
frontend hiding is a UX convenience only, not the security boundary.

## New shared helper (single source of truth)

- **`shared/rbac.ts`** (new)
  - `PRIVILEGED_SALES_ROLES = [master_admin, admin, manager, exec, sales]`
  - `isPrivilegedSalesRole(globalRole)`
  - `canAccessRevenueSimulator` — alias of `isPrivilegedSalesRole`, used for (A)
  - `canUseSalesTravelTools` — alias of `isPrivilegedSalesRole`, used for (B) and (C)

Both client and server import from this one file, so the allowlist cannot
drift between the two layers.

## A) Simulators & Feedback / Revenue Simulator

| Layer | File | Change |
|---|---|---|
| Server middleware | `server/auth.ts` | Added `requirePrivilegedSalesRole` (imports `isPrivilegedSalesRole`) |
| Server routes | `server/routes.ts` | `/api/revenue-sim*` now gated by `requirePrivilegedSalesRole` (replaced the old advisor-only `requireNotAdvisor` check, which allowed everyone except advisors — e.g. support/engineering/analyst/read_only could previously reach it) |
| Client route guard | `client/src/App.tsx` | New `simulatorBlock()` helper using `canAccessRevenueSimulator(role)`; applied to `/revenue-sim` and `/insights/simulators-feedback` (previously both used the advisor-only `advisorBlock()`) |
| Client nav | `client/src/lib/nav-config.ts` | Added `allowedGlobalRoles?: string[]` to `NavItem`/`DesktopNavItem`/`MobileNavItem`; set on the `simulators-feedback` nav entry; propagated through `getDesktopSections()` / `getMobileNavGroups()` |
| Client nav rendering | `client/src/components/dashboard/app-sidebar.tsx`, `client/src/components/dashboard/mobile-nav.tsx` | Filtering respects `allowedGlobalRoles` (admin/master_admin bypass) |

Unauthorized users hitting the route directly now see the existing
`<AccessDenied />` component (same pattern already used for advisor-blocked
routes) instead of the simulator. Unauthorized API calls return `401/403`
via the existing `requireAuth`/role-gate middleware chain.

## B) Plan My Travel Day — "Single-day visits"

| Layer | File | Change |
|---|---|---|
| Server routes | `server/routes.ts` | `/api/leads/nearby` and `/api/travel/my-day` gated by `requirePrivilegedSalesRole` |
| Dialog component | `client/src/components/travel/plan-day-chooser-dialog.tsx` | New `userGlobalRole?: string` prop (defaults to `"sales"` for untouched call sites); "Single-day visits" button is now conditionally rendered (`{canPlanSingleDay && (...)}`) — fully removed from the DOM for unauthorized roles, never shown disabled |
| Caller | `client/src/pages/role-command-center.tsx` | Passes `userGlobalRole={profile?.globalRole}` |
| Caller | `client/src/components/leads/leads-mission-control-widget.tsx` | New `userGlobalRole?: string` prop; when not supplied by a parent (e.g. mounted standalone in the draggable dashboard grid), falls back to its own `/api/users/me/profile` query so the gate still works correctly |

"Multi-day trip" remains visible to everyone; only the single-day
marina/sales-visit option is role-gated, matching the spec.

## C) Widget visibility — Leads Nearby / My Travel

| Layer | File | Change |
|---|---|---|
| Widget registry | `client/src/lib/dashboard-config.ts` | Added `visibility: { allowedGlobalRoles: PRIVILEGED_SALES_ROLES }` to the `leads_nearby` and `my_travel` widget defs |
| Central enforcement | `client/src/lib/dashboard-config.ts` → `canUserSeeWidget()` | Already-existing centralized visibility gate; extended to check `rule.allowedGlobalRoles` (admins bypass, as they do for every other rule type) |

`canUserSeeWidget()` is the single choke point already used by
`buildDashboardConfig()`, which is the only source `role-command-center.tsx`
uses for the dashboard grid, the Widget Settings picker, "New Widgets" counts,
and the "Reset Visible Widgets" default set (`config.widgets` /
`config.visibleWidgets` all flow through it). No separate picker/reset code
paths existed to patch — one visibility rule change covers dashboard
rendering, the widget picker, and reset-to-default simultaneously, and also
means a previously-saved `widgetVisibility: { leads_nearby: true }`
preference from an ineligible role is silently ignored (the widget is
filtered out of `config.widgets` before visibility preferences are even
applied).

## D) Role-aware widget registry field / new widget groups (partial — deferred)

`WidgetVisibilityRule` already supported `permKey`, `minAccessLevel`,
`managerOnly`, `allowedUserTypes`, and now `allowedGlobalRoles` — sufficient
to express every rule needed for (A)–(C). The full spec'd catalog of new stub
widgets (Forecast Gap, Board Pack, SLA Watch, Bug Queue, Cash Pulse, etc. —
~30 additional widgets across Exec/Sales/Support/Ops/Engineering/Finance/
General groups) was **not built out** in this pass; it's a larger, separable
feature addition rather than a security fix, and is called out here as scope
deferred rather than silently dropped. Recommended as a follow-up task.

## E) Regression tests

New file: **`tests/rbac-role-permissions.test.cjs`** (source-grep style, run
with `node tests/rbac-role-permissions.test.cjs`) — pins:
- `shared/rbac.ts` role list and exported helpers
- Server-side gating of `/api/revenue-sim`, `/api/leads/nearby`, `/api/travel/my-day`
- Client route guards for `/revenue-sim` and `/insights/simulators-feedback`
- Nav-config `allowedGlobalRoles` support
- "Single-day visits" is conditionally rendered, not just `disabled`
- `leads_nearby`/`my_travel` widget defs carry `allowedGlobalRoles`
- `canUserSeeWidget()` enforces it and `buildDashboardConfig()` filters every widget through it

Result: 26/26 checks passing. Live-browser/API-call regression tests (login as
each role and hit the endpoints directly) were not added — recommended as a
follow-up using the `testing` skill or an extension of `tests/permissions.test.js`'s
seed-and-login pattern.

## Files changed

- `shared/rbac.ts` (new)
- `server/auth.ts`
- `server/routes.ts`
- `client/src/App.tsx`
- `client/src/lib/dashboard-config.ts`
- `client/src/lib/nav-config.ts`
- `client/src/components/dashboard/app-sidebar.tsx`
- `client/src/components/dashboard/mobile-nav.tsx`
- `client/src/components/travel/plan-day-chooser-dialog.tsx`
- `client/src/pages/role-command-center.tsx`
- `client/src/components/leads/leads-mission-control-widget.tsx`
- `tests/rbac-role-permissions.test.cjs` (new)
- `docs/rbac-advisor-test-fix-report.md` (this file, new)

## Permissions now controlling each area

- **Revenue Simulator / Simulators & Feedback**: `requirePrivilegedSalesRole` (server) + `canAccessRevenueSimulator()` (client nav + route guard)
- **Single-day visits / sales travel planning**: `requirePrivilegedSalesRole` (server, on `/api/leads/nearby` and `/api/travel/my-day`) + `canUseSalesTravelTools()` (client dialog)
- **Leads Nearby / My Travel widgets**: `allowedGlobalRoles` visibility rule in `dashboard-config.ts`, enforced by `canUserSeeWidget()`

All three ultimately resolve to the same allowlist:
`master_admin, admin, manager, exec, sales` (`PRIVILEGED_SALES_ROLES` in `shared/rbac.ts`).

Note: `exec` is included per the explicit task spec even though it is not
currently one of the assignable `globalRole` enum values in
`client/src/pages/admin-users.tsx` — harmless (unused) today, and
forward-compatible if an `exec` role is added later.
