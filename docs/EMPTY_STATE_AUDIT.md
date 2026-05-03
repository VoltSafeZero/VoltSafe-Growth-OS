# Empty / Loading / Error State Audit

**Scope**: Top-level routes in `client/src/pages` — Inbox, Calendar, Tasks, Contacts, Accounts, Opportunities, Quotes, Pipeline, Profiles, Admin pages.
**Method**: Static read of each page's primary `useQuery` consumers and JSX render branches. No runtime walkthrough.
**Status**: Read-only — recommendations only.

---

## 1. Gmail Inbox — `client/src/pages/gmail-inbox.tsx`

| State    | Behavior                                                                                  |
| -------- | ----------------------------------------------------------------------------------------- |
| Loading  | `Skeleton` rows for the message list (line 6102), `Loader2` for thread detail (6852), separate skeletons for folders (5344) and search (2325). |
| Empty    | "No messages" handled per tab — `crmFilteredMessages?.length === 0` (6226), `inboxOther.length === 0` (6272). Folders show italic "No folders yet" (5345). |
| Error    | Error card / alert when `query.error` set (6113).                                         |
| Dead-end | Low. `InboxFullScreenShell` keeps the sidebar + "New Message" trigger always reachable.   |

**Recommendations**
- None blocking. The inbox is the most defensively-coded page in the app — use it as the reference pattern for other list pages.

---

## 2. Calendar — `client/src/pages/calendar.tsx`

| State    | Behavior                                                                                  |
| -------- | ----------------------------------------------------------------------------------------- |
| Loading  | Single full-grid `Skeleton` (line 611). Sync button shows `Loader2` (534).                |
| Empty    | **No dedicated empty state for the grid itself** — empty days simply render with no chips. A first-time user with zero events sees only the empty grid scaffolding with no call-to-action. |
| Error    | `error` block rendered at line 1943.                                                      |
| Dead-end | Low. "New Event" button (553) is always visible.                                          |

**Recommendations**
- Add a small overlay / hint card on the calendar when `events.length === 0` for the visible window — e.g., "No events this week. Click 'New Event' to schedule one or connect a calendar integration in Settings."

---

## 3. Tasks Hub — `client/src/pages/tasks-hub.tsx`

| State    | Behavior                                                                                  |
| -------- | ----------------------------------------------------------------------------------------- |
| Loading  | `Skeleton` rows at line 616.                                                              |
| Empty    | Dedicated `EmptyState` component (556–580). Message adapts to active view ("Nothing due today", "No team tasks", etc.). |
| Error    | **Not handled in render**. If the tasks query fails, the page either falls back to the empty state silently or renders blank. |
| Dead-end | None. "New Task" CTA always present.                                                      |

**Recommendations**
- Add `if (tasksQuery.isError) { ... }` branch before the empty-state branch so users see "Couldn't load tasks — try refreshing" instead of silently empty UI.

---

## 4. Contacts — `client/src/pages/contacts.tsx`

| State    | Behavior                                                                                  |
| -------- | ----------------------------------------------------------------------------------------- |
| Loading  | 6 `Skeleton` cards (250–254).                                                             |
| Empty    | `filtered.length === 0` (255) → `UserCircle2` icon + "No contacts found" + guidance to add via Account (256–262). |
| Error    | **Not handled** in the main list view.                                                    |
| Dead-end | Low — search bar always visible. Slight ambiguity: empty state instructs "add from within an Account" but there's no inline link to navigate there. |

**Recommendations**
- Add an `isError` branch matching the loading-skeleton placement.
- Make the "add from within an Account" guidance clickable — wire it to `/accounts`.

---

## 5. Accounts — `client/src/pages/accounts.tsx`

| State    | Behavior                                                                                  |
| -------- | ----------------------------------------------------------------------------------------- |
| Loading  | `Skeleton` (567, 580); `Loader2` for mutations.                                           |
| Empty    | `allAccounts.length === 0` (645) → "No organizations found" + "Reset Filters" action. Pipeline view also handles empty stages (767, 770). |
| Error    | **Not handled** in primary list render.                                                   |
| Dead-end | None. "New Organization" (324) and filter resets (184, 348) always available.             |

**Recommendations**
- Add `isError` branch.
- The "Reset Filters" CTA should be visually distinct from "New Organization" so users in a true empty state aren't tempted to click Reset.

---

## 6. Opportunities — `client/src/pages/opportunities.tsx`

| State    | Behavior                                                                                  |
| -------- | ----------------------------------------------------------------------------------------- |
| Loading  | 6 column-shaped `Skeleton`s (371–372).                                                    |
| Empty    | Per-column "No deals" dashed box (411–413) when stage is empty. No global empty state if zero opportunities exist anywhere. |
| Error    | **Not handled**.                                                                          |
| Dead-end | None. "New Deal" CTA (305) globally accessible.                                           |

**Recommendations**
- Add a global empty state when ALL stages are empty (first-run users see 6 empty columns with no orientation).
- Add `isError` branch.

---

## 7. Quotes — `client/src/pages/quotes.tsx`

| State    | Behavior                                                                                  |
| -------- | ----------------------------------------------------------------------------------------- |
| Loading  | 5 `Skeleton` rows (402).                                                                  |
| Empty    | KPI cards hide if `allQuotes.length === 0` (315). The table itself shows only headers and no row — **no message at all**. |
| Error    | **Not handled**.                                                                          |
| Dead-end | None. "New Quote" CTA (302) prominent.                                                    |

**Recommendations**
- Add an explicit empty state row in the table body: "No quotes yet — click New Quote to create your first."
- Add `isError` branch.

---

## 8. Pipeline — `client/src/pages/pipeline.tsx`

| State    | Behavior                                                                                  |
| -------- | ----------------------------------------------------------------------------------------- |
| Loading  | `if (isLoading) return ...` (253) — proper guard.                                         |
| Empty    | Handled.                                                                                  |
| Error    | `if (isError) return ...` (262) — proper guard.                                           |
| Dead-end | None.                                                                                     |

**Recommendations**
- None — Pipeline is the model implementation. Use it as a reference when adding `isError` branches to the other list pages above.

---

## 9. Profile pages (Account / Contact / Opportunity)

`account-profile.tsx`, `contact-profile.tsx` (line 173), `opportunity-profile.tsx`

| State    | Behavior                                                                                  |
| -------- | ----------------------------------------------------------------------------------------- |
| Loading  | `Skeleton` blocks for header + tabs.                                                      |
| Empty    | N/A — profile pages always have a record (404 if not).                                    |
| Error    | Generally handles `isError` (e.g., `contact-profile.tsx:173`) and shows "Couldn't load."  |
| Dead-end | If a profile 404s, user is left with an error message and no "Back to list" link — they must rely on browser back or sidebar. |

**Recommendations**
- Add an explicit "← Back to Contacts / Accounts / Opportunities" link in the error state of each profile page.

---

## 10. Admin / Settings pages

`admin-users.tsx`, `admin-integrations.tsx`, `mailbox-settings.tsx`, `settings.tsx`

| State    | Behavior                                                                                  |
| -------- | ----------------------------------------------------------------------------------------- |
| Loading  | Some return `null` (e.g., `settings.tsx:669`); others use Skeleton.                       |
| Empty    | Sparse — most admin lists are not designed for true empty cases (assume at least one user / integration). |
| Error    | Often unhandled — page just renders blank or a half-loaded shell.                         |
| Dead-end | Possible: a non-admin who lands on an admin route via direct URL sees a blank page rather than "You don't have access to this page." |

**Recommendations**
- Standardize a `<RoleGuard requireAdmin>` wrapper that renders an "Access denied — contact your administrator" panel instead of `null`.
- Replace `return null` on error/loading with at least a `Skeleton` so the page doesn't appear blank/broken.

---

## 11. Sparsely-audited pages worth a future pass

These were not deeply inspected in this 30-min window but warrant attention before resuming feature work:

- `dashboard.tsx`, `executive-dashboard.tsx`, `command-center.tsx`, `daily-command-center.tsx` — heavy widget composition; widgets that fail individually should not break the whole grid.
- `revenue.tsx`, `revenue-ops.tsx`, `revenue-sim.tsx`, `renewals.tsx` — number-heavy pages where missing data could produce confusing zeros / NaN.
- `meeting-notes-detail.tsx`, `notes-page.tsx` — error state if a note is deleted while open.
- `booking-public.tsx` — public-facing route; empty/error states matter most for first impressions.

---

## Cross-cutting recommendations

1. **Adopt a project-wide convention**: Every `useQuery` in a top-level page must render either a `Skeleton`, an empty-state component, OR an error message — never `null` or blank.
2. **Reuse the `EmptyState` pattern from `tasks-hub.tsx`** across Quotes, Accounts (zero-records case), Opportunities (all-stages-empty case), Contacts (zero-records case).
3. **Add a single `<QueryErrorBoundary>` wrapper** that wraps each page's main query consumer. This avoids the repeated `if (isError)` boilerplate and ensures no page silently swallows fetch failures.
4. **No code changes were made.** All findings here are recommendations only.
