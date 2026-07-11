---
name: Calendar externalCalendarId → calendarSourceKey
description: Raw Google Calendar IDs (can be email addresses) are replaced with opaque SHA-256 hashes in API list responses.
---

# Problem
`/api/calendar/events` (and team variant) returned `externalCalendarId` which for primary Google
Calendars equals the user's email address (e.g. "trevor@voltsafe.com"). This is PII leakage.

# Fix
`server/services/calendar-visibility.ts` exports `calendarSourceKey(rawId)` = SHA-256(rawId).slice(0,12).
`toEventListItem()` returns `calendarSourceKey` instead of `externalCalendarId`.
`GET /api/calendar/sources` returns `calendarSourceKey` per source and opaque keys in `selectedIds`.
`POST /api/calendar/sources/select` accepts opaque keys and translates back to raw IDs via
the `calendarsDiscovered` JSON column before storing in `selectedCalendarIds`.

# Client
`calendar.tsx`: `visibleOwnEvents` reads `e.calendarSourceKey`, `toggleCalendarSource(sourceKey)`,
panel checkboxes use `src.calendarSourceKey`. The raw `src.id` is still present for `key={src.id}`.

# Tests
- `tests/security-audit.test.cjs`: `externalCalendarId` is in `SENSITIVE_EVENT_FIELDS` (source + live API check).
- `tests/calendar-source-visibility.test.cjs`: Layer 1 checks `calendarSourceKey` in service; Layer 3 checks `sourceKey` in client.

**Why:** externalCalendarId = raw Google Calendar ID = user email for primary calendar = PII.
**How to apply:** Any new endpoint that lists calendar events MUST use `toEventListItem()` or manually call `calendarSourceKey()`.
