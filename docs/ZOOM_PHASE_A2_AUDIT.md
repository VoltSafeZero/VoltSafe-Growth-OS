# Zoom / Booking — Phase A.2 Audit

Verdict: **Implementation already complete on `main`.** Phase A.2's deliverable
(public booking confirmation auto-creates a calendar event and attaches a Zoom
meeting when the link owner has Zoom connected) is wired end-to-end in
`server/services/booking-link-service.ts` and exposed via the existing public
routes in `server/routes.ts`. Only test coverage was missing; this audit
documents the surface and an accompanying regression suite
(`tests/zoom-phase-a2.test.js`) verifies all acceptance criteria.

No code, schema, or dependency changes were made. No `db:push`. No new packages.

## Surface inventory

### Public routes (`server/routes.ts`, around L24187–L24226)

| Method | Path | Handler | Auth |
| ------ | ---- | ------- | ---- |
| GET    | `/api/booking-links/public/:token`         | `resolvePublicToken` | none — public |
| POST   | `/api/booking-links/public/:token/confirm` | `confirmBooking`     | none — public |

Both endpoints are guarded only by token possession. Tokens are 32-byte
URL-safe base64 (`crypto.randomBytes(32).toString("base64url")`,
`booking-link-service.ts:208`).

### `confirmBooking()` flow (`server/services/booking-link-service.ts:404–505`)

1. **Resolve recipient** by token (returns `null` → 404 if revoked or unknown).
2. **Idempotency guard (L417-435)** — if `recipient.bookedAt` is set, returns
   the existing `calendarEvent` data with `alreadyBooked: true` (route maps
   to **HTTP 409**). **Crucially, no second Zoom meeting is requested.**
3. **Resolve active link** (`bookingLinks.active = true`); returns null → 404.
4. **Compute** `startTime` from `slotStart`, `endTime = startTime + slotMinutes`.
5. **Best-effort Zoom create** via `createZoomMeetingForBooking(link.ownerUserId, …)`.
   - Owner-scoped — uses `link.ownerUserId`, never the public caller.
   - Returns `null` if owner has no active connection, env vars missing, or
     the Zoom API errors (the underlying `createZoomMeeting` is wrapped in
     a try/catch that **never throws**, see `zoom-service.ts:362–416`).
   - Note: `BookingZoomOptions.timezone` is currently accepted by the wrapper
     but **not forwarded** to the Zoom API payload — `createZoomMeeting`
     sends only `start_time` as a UTC ISO-8601 string and Zoom interprets it
     in UTC. The bookingLink's `timeZone` is used to compute the slot's UTC
     instant before the call, so the meeting starts at the correct moment;
     however, Zoom will display "(GMT+0)" rather than the link's local TZ.
     Tracked as a follow-up; not in scope for A.2.
6. **Insert calendar_event** with:
   - `userId = link.ownerUserId`
   - `meetingUrl = location = zoom?.joinUrl ?? null`
   - `bookingLinkRecipientId = recipient.id` (audit traceback)
   - `invitees = [recipient.recipientEmail]`
7. **Mark recipient booked** — sets `bookedAt = now`,
   `bookedCalendarEventId = calEvent.id`. This closes idempotency: any
   future POST hits step 2.

### Public response shape (returned by both 201 and 409 paths)

```ts
{
  calendarEventId: number,
  startTime:       Date,
  endTime:         Date,
  zoomJoinUrl:     string | null,   // join_url ONLY
  zoomMeetingId:   string | null,   // null on 409 retries (audit trail; existing event has no separate persisted id)
  zoomPassword:    string | null,
  alreadyBooked:   boolean,
}
```

`startUrl` is **never** projected into the response. The Zoom service returns
it internally (`ZoomMeetingResult.startUrl`, `zoom-service.ts:353`) but the
booking layer ignores it entirely. No access/refresh tokens or owner IDs
are returned.

## Schema usage — no changes required

`calendar_events` already has:

| Column | Used for |
| ------ | -------- |
| `meeting_url` | Zoom join URL |
| `location` | Zoom join URL (mirrored, for calendar UI clients) |
| `booking_link_recipient_id` | Traceback to the booking that created the event |
| `user_id` | Owner-scoped; equals `bookingLinks.owner_user_id` |
| `invitees` (text[]) | Recipient email |
| `start_time`, `end_time` | Computed from slotStart + slotMinutes |
| `time_zone` | Available on the column but not currently set by `confirmBooking`; the calendar event stores UTC `start_time`/`end_time` instants. The display timezone is held on `bookingLinks.time_zone` for the booking page UI. |

`calendar_events` does **not** have a dedicated `zoom_meeting_id` column, and
Phase A.2 does **not** add one. The Zoom meeting ID is returned in the public
confirm response (for the client to display) but is intentionally not
persisted; the join URL alone is sufficient for re-rendering the calendar
event, and idempotency is handled via `bookingLinkRecipients.bookedAt` /
`bookedCalendarEventId`. Should a future phase need server-side resolution of
"which Zoom meeting belongs to this calendar event", a new column or a side
table can be added at that time. **No schema change is in scope for A.2.**

## Security analysis

### Token leakage

- Public GET response keys: `bookingLink, recipientEmail, alreadyBooked,
  bookedAt`. The `bookingLink` subobject explicitly excludes `id`,
  `ownerUserId`, `createdAt`, `updatedAt` (projected manually at
  `booking-link-service.ts:355–367`).
- Public POST response keys: `calendarEventId, startTime, endTime,
  zoomJoinUrl, zoomMeetingId, zoomPassword, alreadyBooked`.
- The raw `recipient.token` is **never echoed** in either response.
- `ZoomMeetingResult.startUrl` is **never** included in the public response
  (host-only credential).

### Cross-user isolation

- Zoom is created with `link.ownerUserId`. The public caller's identity is
  irrelevant. There is no path where a recipient could choose which user's
  Zoom account is consumed.
- `calendar_events.user_id` always equals `link.ownerUserId`.
- A booking link owned by user A cannot create a calendar_event under user B,
  and cannot trigger a Zoom meeting on B's account. Verified by test [5].

### Idempotency

- **Sequential**: enforced by the `bookedAt` short-circuit at L417 and by the
  unique mapping of one `bookingLinkRecipients` row to at most one
  `calendar_events` row (via `booked_calendar_event_id`). Verified by tests
  [3] and [4] (no duplicate `calendar_events` row, second response surfaces
  the existing `meetingUrl`).
- **Concurrent (race window — known limitation, deferred)**: the
  read-then-write sequence in `confirmBooking` is not transactional or
  row-locked. Two simultaneous first-time POSTs for the same token *could*
  both pass the L425 guard, both create a calendar_events row, and both
  call Zoom — the second `UPDATE bookingLinkRecipients SET bookedAt`
  would simply overwrite the first. This pre-existed Phase A.2 and is
  out of scope for this audit (would require either a SELECT … FOR
  UPDATE or a compare-and-set `WHERE booked_at IS NULL` UPDATE; both are
  code changes that the standing brief excludes). Tracked as a Phase A.3
  follow-up.

### Failure handling

- Zoom-create failure (auth expired, API down, rate limit, env vars missing)
  → service returns `null`, booking still completes successfully with
  `meeting_url = null`. Confirmed by test [2].
- Owner-disconnected Zoom (`disconnectedAt != null`) → `createZoomMeeting`
  short-circuits at `zoom-service.ts:373`, returns `null`. Same path.
- Invalid/revoked token → 404, no event row created. Confirmed by tests [6][7].

## Deliverables

| File | Purpose |
| ---- | ------- |
| `docs/ZOOM_PHASE_A2_AUDIT.md` | this document |
| `tests/zoom-phase-a2.test.js` | 37-assertion regression suite (all green) |

## Acceptance-criteria mapping

| Requirement | Where covered |
| ----------- | ------------- |
| On confirm, create/update calendar event with Zoom details | `confirmBooking` step 5–7 |
| Use connected owner's Zoom only | `createZoomMeetingForBooking(link.ownerUserId, …)` |
| If owner has no Zoom, booking still succeeds | `zoom = null` → `meeting_url = null` (test [2]) |
| Store join_url only if schema supports it | `meeting_url` reused; no schema change; `start_url` never persisted |
| Expose join URL in confirmation response | `zoomJoinUrl` in 201/409 body |
| Prevent public users from seeing host start_url | `start_url` never projected (tests [2][4][5]) |
| Idempotency / no duplicate Zoom on retry | `bookedAt` short-circuit (test [3][4]); **sequential only** — concurrent first-time race deferred, see Idempotency note |
| Booking does not fail if Zoom fails | `createZoomMeeting` catches all errors → `null` (test [2]) |
| Public booking token only public path | Routes audited; no other unauthenticated entry points |
| No schema changes / no new dependencies | Confirmed |
