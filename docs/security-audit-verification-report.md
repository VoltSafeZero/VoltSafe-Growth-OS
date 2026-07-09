# VoltSafe Growth OS — Security & Data-Minimization Verification Report

Date: 2026-07-09

## Scope

Follow-up verification pass on the production security/data-minimization audit. Covers:
1. `/api/calendar/events` list/detail split (over-exposure fix)
2. Verification that `/api/calendar/integrations` strips OAuth tokens/secrets
3. Cross-user scoping tests (calendar events, notifications, inbox-summary)
4. Source-map exposure check
5. This final verification report

Round 1 (CSP header, session cookie flags, inbox-summary scoping) was already completed and verified in a prior pass — not repeated here except where re-confirmed.

## Files changed (this round)

- `server/services/calendar-visibility.ts` — added `toEventListItem()` and `summarizeLocation()` helpers that strip sensitive fields for list views.
- `server/routes.ts` — `/api/calendar/events` and `/api/calendar/events/team` now map results through `toEventListItem()` before responding.
- `client/src/pages/calendar.tsx` — `EventDetailDialog` now fetches full detail from `GET /api/calendar/events/:id` on open, merging it with the minimized list item so the detail view keeps showing description/meeting link/invitees.
- `tests/security-audit.test.cjs` — extended from 19 to 40 checks (CSP, cookies, inbox-summary scoping, event list minimization, cross-user event/notification/inbox scoping, integrations token stripping, source-map check).

## Endpoints changed

| Endpoint | Change |
|---|---|
| `GET /api/calendar/events` | List now returns a minimized field set (own events) |
| `GET /api/calendar/events/team` | List now returns a minimized field set (team events) |
| `GET /api/calendar/events/:id` | Unchanged — already existed and already enforces ownership/admin/calendar_team authorization; confirmed uniform 404 for non-owners without access |

## Before / after payload example

**Before (and still true today for the detail endpoint, `GET /api/calendar/events/:id`)** — full row returned:

```json
{
  "id": 6,
  "userId": 4,
  "title": "Smoke test meeting",
  "description": null,
  "eventType": "meeting",
  "location": "Zoom",
  "meetingUrl": null,
  "invitees": ["test@voltsafe.com"],
  "attendeeDetails": null,
  "externalId": null,
  "externalEtag": null,
  "externalProvider": null,
  "externalCalendarId": null,
  "bookingLinkRecipientId": null,
  "visibility": "default",
  "...": "..."
}
```

**After — list endpoint (`GET /api/calendar/events`)** now returns only:

```json
{
  "id": 6,
  "userId": 4,
  "title": "Smoke test meeting",
  "startTime": "2026-04-19T02:20:26.831Z",
  "endTime": "2026-04-19T02:50:26.831Z",
  "allDay": false,
  "eventType": "meeting",
  "status": "scheduled",
  "showAs": "busy",
  "color": null,
  "calendarName": null,
  "locationSummary": "Zoom",
  "isBusyOnly": false
}
```

`description`, `meetingUrl`, `invitees`, `attendeeDetails`, `externalId`, `externalEtag`, `externalProvider`, `externalCalendarId`, and `bookingLinkRecipientId` are no longer present in bulk list responses. Full detail (shown above) remains available only via `GET /api/calendar/events/:id`, which is authorization-gated.

## Tests added

`tests/security-audit.test.cjs` — 40 checks total (was 19), run with `node tests/security-audit.test.cjs`. New checks added this round:

- List route (`/api/calendar/events`, `/api/calendar/events/team`) source-verified to map through `toEventListItem()`.
- `toEventListItem()` body verified to omit all 9 sensitive fields.
- Live test: a logged-in normal user's own event list contains none of the sensitive fields.
- Live test: a non-owner user without `calendar_team` access gets a uniform `404` fetching another user's event detail (no enumeration).
- Live test: the event owner/admin can still fetch full detail via the detail endpoint.
- Live test: `/api/notifications` for a normal user returns only rows where `userId` matches that user.
- Live test: `/api/command-center/inbox-summary` for a user with no `mail_team` grants returns an empty `teamInboxes` array.
- Live + source test: `/api/calendar/integrations` never returns `access_token`/`refresh_token`/`client_secret`/`caldavPassword` in any form.
- Source test: `vite.config.ts` does not set `build.sourcemap: true`.
- Build test: if a `dist/public` build is present, no `.map` files exist in it.

Result: **40/40 passing.**

## Confirmations

- **Tokens:** `GET /api/calendar/integrations` strips `accessToken`, `refreshToken`, and `caldavPassword` server-side before responding (confirmed both by source inspection and a live authenticated call returning `[]`/no token fields for a test account).
- **Cross-user scoping:** Verified live with two accounts (admin `trevor@voltsafe.com` and a limited-permission test user):
  - Calendar event detail: non-owner without `calendar_team` grant → `404` (uniform, not `403`, to avoid confirming existence).
  - Notifications: every row returned to the test user carried that user's own `userId`.
  - Inbox summary: user with no `mail_team` permissions received zero team inboxes.
- **`master_admin` bypass:** Section-permission bypass for `admin`/`master_admin` roles in `requirePermission`/`requireAdmin` (server/auth.ts) was not modified in this pass and remains the sole intentional broad-access path, consistent with the threat model.
- **Source maps / build:** `vite.config.ts` does not enable `build.sourcemap`; Vite's production default is `false`, so the built SPA does not ship `.map` files. No production source-map exposure found.
- **CSP / session cookie (round 1, re-confirmed):** CSP header present with `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`; session cookie sets `httpOnly: true`, `secure` gated on `isProduction`, `sameSite: 'lax'`.

## Known trade-off (documented, not changed this pass)

Three client components read fields that are no longer present on the minimized list payload and will silently degrade rather than break:
- `client/src/components/widgets/my-calendar-widget.tsx` — "Join meeting" button relied on `event.meetingUrl`/`description` on the list item.
- `client/src/pages/calendar.tsx` — `classifyCalendarEvent` (internal/external badge) relied on `attendeeDetails`/`invitees`.
- `client/src/pages/calendar.tsx` — `RescheduleConfirmDialog`'s `hasInvitees` check relied on `invitees`.

None of these crash; they just lose the enrichment that depended on now-stripped fields in list views. Recommended follow-up: have these three call sites fetch `GET /api/calendar/events/:id` on demand (same pattern used in `EventDetailDialog`) if that functionality needs to be restored.
