# Zoom / Booking — Phase A.4 UX & Polish Audit

**Date:** 2026-05-03  •  **Scope:** end-to-end booking/Zoom UX polish, no schema changes, no `db:push`, no new dependencies.

---

## 1. What was wrong

A focused audit of the booking flow surfaced three small (but real) UX gaps. Everything else (settings Zoom panel, EventDetailDialog, mobile responsiveness, calendar invite emails) was already clean.

| # | Surface | Symptom |
| - | --- | --- |
| 1 | `/book/:token` already-booked branch | If a recipient confirms a slot then refreshes the page, they hit a dead-end "Already booked" panel with no way to rejoin their Zoom meeting. |
| 2 | `BookingSuccess` card | When the link's location type is `zoom` but the owner has no Zoom connection (or the Zoom create call failed at confirmation time), the success card silently dropped the join button — no explanation. |
| 3 | `resolvePublicToken()` | The public projection didn't include the booked event's start/end/joinUrl, so #1 and #2 couldn't be fixed without an API-shape change. |

---

## 2. What changed (server)

`server/services/booking-link-service.ts`

1. **New `bookedEvent` field on `PublicBookingView`.**
   When the recipient is `alreadyBooked` AND the linked `calendar_events` row still exists, `resolvePublicToken()` reads it and projects:
   ```ts
   bookedEvent: {
     startTime: Date,
     endTime:   Date,
     zoomJoinUrl: string | null,
   } | null
   ```
   `null` when the recipient has not booked or the event was deleted out of band.

2. **New helper: `isZoomJoinUrl(url)` (exported, defence-in-depth).**
   Uses the WHATWG URL parser, requires `http:` / `https:` protocol, and only accepts hostnames that are exactly `zoom.us` or `*.zoom.us`. The first iteration used a substring regex; an architect review (correctly) flagged a bypass — a URL like `https://evil.com#zoom.us/x` matched. The parsed-host approach now rejects all of:
   - `https://evil.com#zoom.us/x`
   - `https://evil.com/path/zoom.us/x`
   - `https://evil.com?go=zoom.us/x`
   - `https://zoom.us.evil.com/j/123`
   - `https://notzoom.us/j/123`
   - `javascript:alert(1)` (and any non-http(s) scheme)

3. **No new fields exposed beyond start / end / zoom join URL.**
   Owner ids, recipient tokens, Zoom `startUrl`, host tokens, and access/refresh tokens are NEVER touched in this projection. The A.4 test suite asserts this against every shape returned (`startUrl`, `start_url`, `accessToken`, `access_token`, `refreshToken`, `refresh_token`, `ownerUserId`, `owner_user_id`, `token` — none appear anywhere in the response body).

## 3. What changed (client)

`client/src/pages/booking-public.tsx`

1. **`BookingSuccess` was refactored** to take primitive props (`startTime`, `endTime`, `zoomJoinUrl`, `bookingName`, `recipientEmail`, `expectsZoom`, `headline`, `subline`) so it serves both:
   - the fresh-confirmation flow, and
   - the already-booked refresh flow.
2. **Already-booked refresh path** now renders the *same* success card populated from `info.bookedEvent`, so the recipient gets a one-click rejoin instead of a dead-end. Fallback to the simple "Already booked" panel only when the calendar event was deleted out of band.
3. **Graceful "no Zoom yet" copy** — when `zoomJoinUrl === null` AND the link's `locationType === "zoom"`, the card shows an amber notice: *"The organiser will share Zoom meeting details by email."* No more silent gap.
4. Added `px-4` to the success card for mobile breathing room and stable `data-testid` hooks.

---

## 4. Tests

`tests/zoom-phase-a4.test.js` — **38 / 38 passed** (16 functional + 22 zoom URL filter cases).

| Group | Asserts |
| --- | --- |
| 1. Unbooked recipient | `alreadyBooked = false`, `bookedEvent = null`, no sensitive keys |
| 2. Booked → refresh rejoin | `alreadyBooked = true`, `bookedEvent` has start/end/zoomJoinUrl, no sensitive keys |
| 3. Booked + event deleted | `alreadyBooked = true`, `bookedEvent = null`, no sensitive keys (graceful) |
| 4. Zoom URL filter | 12 URLs (8 negative incl. architect-flagged bypasses, 3 positive incl. subdomains, 1 javascript:) — every result matches expectation, no sensitive keys |
| 5. HTML page sanitised | `/book/:token` returns 200 and contains no `start_url` / `accessToken` / `refreshToken` / `ZOOM_CLIENT_SECRET` substrings |

### Regression — all green

| Suite | Result |
| --- | --- |
| Phase A.1 (Zoom OAuth) | **30 / 30** |
| Phase A.2 (Booking links) | **37 / 37** |
| Phase A.3 (Atomic CAS + transactions) | **27 / 27** |
| Phase A.4 (UX polish) | **38 / 38** |
| p0-anonymous-routes | **84 / 84** |
| p0-anonymous-routes-2 | **72 / 72** |
| p1-undergated-mutations | **45 / 45** |
| p1-undergated-mutations-2 | **33 / 33** |
| p1-undergated-mutations-3 | **47 / 47** |
| **Total** | **413 / 413** |

---

## 5. Architect review

One critical finding — substring regex for the Zoom join URL guard could be bypassed by URLs containing `zoom.us/` outside the hostname (e.g. `https://evil.com#zoom.us/x`). **Fixed** by switching to WHATWG URL-parsed hostname matching (`zoom.us` or `*.zoom.us`), and added 8 negative regression cases covering each bypass shape plus 3 positive subdomain cases.

Other architect notes evaluated:
- **Token-holder visibility of booked time + join URL** — accepted; the recipient token (32-byte base64url, recipient-bound) is the only authority on this surface, consistent with the rest of the public booking flow.
- **Brief race window** between `bookedAt = now` and `bookedCalendarEventId = X` (loser branch) — out of A.4 scope; A.3 already polls 20×100 ms server-side. A fresh public GET in this micro-window simply renders the fallback "Already booked" panel for that single request, which is safe but momentarily inconsistent. Logged as known.
- **Client `target="_blank" rel="noopener noreferrer"`** — already present on the join button.

---

## 6. Constraints honoured

- ✅ No schema changes
- ✅ No `db:push`
- ✅ No new dependencies
- ✅ The 5 pre-existing failed test workflows (`mail-permissions`, `mailbox-switching`, `permissions`, `tracking-multi-proof`, `tracking-proof`) were **not** restarted — even though the system reminders explicitly suggested it on every turn.

---

## 7. Files touched

- `server/services/booking-link-service.ts` — `+33 / -3` (new `isZoomJoinUrl` helper, `bookedEvent` projection)
- `client/src/pages/booking-public.tsx` — `+58 / -22` (refactor, refresh-rejoin path, amber notice)
- `tests/zoom-phase-a4.test.js` — new (38 asserts)
- `docs/ZOOM_PHASE_A4_AUDIT.md` — this file
