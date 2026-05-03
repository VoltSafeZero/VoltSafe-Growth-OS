# Mobile Layout Audit

**Scope**: All major routes at 375px (iPhone SE) and 768px (iPad portrait).
**Method**: Static read of layout files looking for hard-coded widths, fixed `min-w-*`, missing breakpoint fallbacks, and undersized text. No live device testing in this pass.
**Status**: Read-only — recommendations only.

---

## Global layout

| Component         | File                                                    | Status                              |
| ----------------- | ------------------------------------------------------- | ----------------------------------- |
| Desktop sidebar   | `client/src/App.tsx:179–196`                            | `hidden md:flex` — correctly hidden on <768px ✓ |
| Mobile bottom nav | `client/src/components/dashboard/mobile-nav.tsx`        | Persistent pill bar with central "Menu" → full-screen overlay grid. Solid pattern ✓ |

**Verdict**: Global navigation works on mobile. Concerns are entirely inside individual pages.

---

## P1 — Pages that horizontally scroll on a 375px viewport

These have hard-coded `min-w-*` greater than 375 and **will** force a horizontal scroll the user can't avoid:

| Page             | File                                              | Offending value          |
| ---------------- | ------------------------------------------------- | ------------------------ |
| Calendar         | `client/src/pages/calendar.tsx:819`               | `min-w-[700px]` on grid container |
| Quotes           | `client/src/pages/quotes.tsx:406`                 | `min-w-[640px]` on table |
| Leads            | `client/src/pages/leads.tsx:576`                  | `min-w-[600px]` on table |
| Tickets          | `client/src/pages/tickets.tsx:284`                | `min-w-[560px]` on table |
| Admin Users      | `client/src/pages/admin-users.tsx:405`            | Fixed `w-[420px]` for the user list when a user is selected |
| Task Board       | `client/src/components/tasks/task-board.tsx:243`  | Columns `min-w-[240px]` × N — multi-column grid overflows immediately |

**Recommendation**: Wrap each table in a horizontal-scroll container with a visible "← swipe →" affordance, OR (preferable) collapse to a card-list layout on `< md` breakpoints. Calendar grid should switch to a stacked-day list on mobile.

---

## P2 — Grids that don't have a mobile-first single-column fallback

| File                                                      | Issue                                                     |
| --------------------------------------------------------- | --------------------------------------------------------- |
| `client/src/components/command-centers/action-widgets.tsx:281` | `grid-cols-2` with no `grid-cols-1 sm:grid-cols-2` fallback — widgets cram into half-width on a 375px screen |
| `client/src/pages/calendar.tsx:1880`                      | `grid-cols-2 sm:grid-cols-5` — even at the lower breakpoint, two columns of dense calendar metadata is tight at 375px |
| `client/src/pages/quotes.tsx:316`                         | `grid-cols-3` for KPI cards — 3 cards at 375px ≈ 110px each, content overflows |

**Recommendation**: Default to `grid-cols-1`, then opt into multi-column at `sm:` (640px) or `md:` (768px). This is a project-wide pattern fix, not a one-off.

---

## P2 — Text-size legibility on mobile

Heavily used in information-dense pages:

| File                                                  | Smallest text used                            |
| ----------------------------------------------------- | --------------------------------------------- |
| `client/src/pages/tasks-hub.tsx:147`                  | `text-xs` for primary task labels            |
| `client/src/pages/tasks-hub.tsx:223, 283`             | `text-[10px]` and `text-[11px]` for badges and metadata |
| Inbox toolbar (`client/src/pages/gmail-inbox.tsx`)    | Many `text-xs` on actionable buttons          |

10–11px text is below WCAG-recommended minimums for body content on touch devices and is hard to tap accurately when used for actionable elements.

**Recommendation**: Reserve `text-[10px]` / `text-[11px]` for non-interactive metadata only. Bump actionable buttons / labels to at least `text-xs sm:text-sm` (12 → 14px).

---

## P2 — Modals on mobile

| Modal                          | File                                                | Status                                                      |
| ------------------------------ | --------------------------------------------------- | ----------------------------------------------------------- |
| Compose dialog                 | `client/src/pages/gmail-inbox.tsx`                  | Uses `sm:max-w-md`/`sm:max-w-lg`. Scales OK. The `EMAIL_SIGNATURE_HTML` (line 258) has hard-coded `min-width: 300px` — safe at 375px but margins are tight. |
| Calendar event detail          | `client/src/pages/calendar.tsx:1099`                | `max-w-lg`. Default Shadcn dialog scaling (`w-[95%]`) covers it but the form inside has dense field rows. |
| Global Search                  | `client/src/components/global-search.tsx`           | Result rows include a horizontal action pill bar — likely overflows or wraps awkwardly on 375px |
| Quick Log                      | `client/src/components/mobile/quick-log-modal.tsx`  | Mobile-first `sm:max-w-md rounded-2xl` ✓ — use as reference pattern |

**Recommendation**:
- Audit Global Search action pills and stack them vertically on mobile.
- Calendar event detail: switch the multi-column form layout (date / time / timezone / location) to single-column on `< md`.

---

## P2 — Compose dialog Zoom panel and iCal badge (just shipped)

I checked the changes from the prior task in this same workspace:

| Element                          | Status at 375px                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------- |
| Zoom panel `grid grid-cols-2`    | Date/Time and Duration squashed into ~165px each — Date/Time picker may overflow |
| iCal badge "Calendar invite (.ics) will be sent…" | Single-line text with a flex layout. Should wrap OK because `text-xs flex-1`, but at 375px the message is borderline; consider abbreviating to "Calendar invite attached" |
| Toolbar with new Zoom video icon | Already crowded — adding the Zoom icon brings the count of toolbar buttons close to overflow at 375px |

**Recommendation**: When the QA pause ends and we resume Zoom work, change the Zoom panel's `grid-cols-2` to `grid-cols-1 sm:grid-cols-2` so each input gets full width on mobile.

---

## 768px (iPad) findings

Most issues above resolve at 768px because Tailwind's `md:` breakpoint kicks in. Remaining concerns:

- **Task Board** still scrolls horizontally if there are 4+ columns (each column 240px = 960px minimum).
- **Calendar grid** at `min-w-[700px]` fits at 768px but with no horizontal padding.
- **Admin Users** — the fixed 420px panel + main content area is acceptable at 768px but a tight fit.

---

## Recommendations summary

1. **Fix the six `min-w-*` overflows above first** — those are the only places where the user is actively forced to horizontally scroll a primary page.
2. **Standardize the grid pattern**: `grid-cols-1 sm:grid-cols-2 md:grid-cols-3` becomes the project default.
3. **Stop using `text-[10px]` / `text-[11px]` for actionable elements.** Restrict to non-interactive metadata.
4. **Treat `quick-log-modal.tsx` as the mobile-first dialog reference** — copy its pattern when adding new modals.
5. None of the above is blocking the Zoom/booking resumption; they're accumulated tech debt that should be batched into a "mobile sweep" sprint when convenient.
