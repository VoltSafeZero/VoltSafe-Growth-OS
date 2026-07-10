---
name: Calendar source-checkbox visibility bug
description: Root cause and fix for other users' calendar events showing regardless of checkbox state.
---

## The bug

`toEventListItem()` in `server/services/calendar-visibility.ts` stripped `externalCalendarId`
from the list response. The client-side filter in `calendar.tsx` (`visibleOwnEvents` useMemo)
checks `externalCalendarId` to decide which events to show based on the "My Calendars"
source-checkbox state. Because the field was always `undefined`, the guard
`if (!extCalId) return true` always fired — treating every synced event as an "app-created"
event and bypassing all source filtering.

Result: events from delegated/subscribed calendars (scott@, sanad@, Terri Breker) stored
under Trevor's userId appeared regardless of which checkboxes were checked.

## The fix

1. **`toEventListItem`** — added `externalCalendarId: event.isBusyOnly ? null : (event.externalCalendarId ?? null)`.
   Busy-only events (privacy-sanitized team events) get null so no source info leaks.

2. **`/api/calendar/events` route** — added server-side pre-filter using `selectedCalendarIds`
   from the user's calendar connection. Defense-in-depth so even if client-side filter regresses,
   the server never sends down events from unchecked calendars.
   - `null` selectedCalIds (never configured) → return all events
   - `[]` (all unchecked) → only app-created events (no externalCalendarId)
   - `["cal-id-1", ...]` → filter to matching + app-created

## Architecture

- People Calendars overlay (scott, sanad) → separate `useTeamCalendarEvents` hook; already
  correctly gated by `enabledIds.length > 0`. NOT the source of the bug.
- The leaking calendars came through `ownEvents` (Trevor's own DB rows) because Google
  Calendar syncs delegated/subscribed calendars under the connected user's userId.

**Why:** externalCalendarId must always be included in list responses for the filtering layer
to work. Future list-endpoint changes MUST NOT strip this field.
