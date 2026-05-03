# Zoom / Booking — Phase A.3 Audit

**Scope.** Eliminate the concurrent-confirm race in
`server/services/booking-link-service.ts → confirmBooking()` so that two
simultaneous first-time POSTs to the same public booking token cannot
create duplicate calendar events or duplicate Zoom meetings.

**Constraints honoured.**

- No schema changes; no `db:push`; no new dependencies.
- The 5 pre-existing failed test workflows (`mail-permissions`,
  `mailbox-switching`, `permissions`, `tracking-multi-proof`,
  `tracking-proof`) were **not** restarted, regardless of system
  reminders suggesting otherwise.

---

## 1. The race that existed after Phase A.2

Phase A.2's `confirmBooking()` had a TOCTOU window:

1. Read recipient row → `bookedAt` is `NULL`.
2. Guard at L417: `if (recipient.bookedAt) return alreadyBooked` — both
   concurrent requests pass.
3. Call Zoom API (slow; both create a meeting).
4. Insert into `calendar_events` (both inserts succeed; no DB constraint
   blocks a second row).
5. `UPDATE booking_link_recipients SET booked_calendar_event_id = …`
   (last writer wins; the other event is orphaned).

Net result for a 2-way race: 2 Zoom meetings, 2 calendar_events rows, 1
recipient row pointing at one of them.

## 2. Fix — atomic compare-and-set on `booked_at`

`server/services/booking-link-service.ts` (L455-477):

```ts
const reserved = await db
  .update(bookingLinkRecipients)
  .set({ bookedAt: now })
  .where(and(
    eq(bookingLinkRecipients.id, recipient.id),
    isNull(bookingLinkRecipients.bookedAt),
    isNull(bookingLinkRecipients.revokedAt),   // TOCTOU defence: revoked-after-read
  ))
  .returning({ id: bookingLinkRecipients.id });
```

Postgres READ COMMITTED guarantees that of N concurrent UPDATEs with
`WHERE booked_at IS NULL`, exactly one matches a row and the rest
return `rowCount = 0`. (Verified at the DB level by test suite group [5].)

### Loser path — bounded poll

If `reserved.length === 0`, the request lost the race. The winner has
reserved the recipient but may still be mid-flight (Zoom create +
calendar insert). The loser polls `booking_link_recipients` up to 20× at
100 ms intervals (2 s ceiling) to surface the canonical `calendarEventId`
once the winner commits. If the budget expires (rare; only under heavy
contention), the loser returns `calendarEventId: 0` with
`alreadyBooked: true` — this is the documented "if available" contract
in the user brief.

### Live-state revalidation (TOCTOU hardening)

After a successful reservation we re-`SELECT` the booking link with
`active = true`. If it has been deactivated between step 3 and step 5,
we release the reservation and return `null` (route-level → 404).

### Atomic post-reserve writes

`calendar_events` insert + `booking_link_recipients.booked_calendar_event_id`
update now run inside a single `db.transaction(async (tx) => …)`. If
either fails, both roll back, and the `catch` block can safely clear
`booked_at = NULL` for retry **without** the architect-flagged risk of
duplicate calendar events.

The release statement also guards with
`isNull(bookedCalendarEventId)` as belt-and-braces defence-in-depth.

## 3. Test coverage

`tests/zoom-phase-a3.test.js` — **27 / 27 passing.**

| # | Group                                   | Asserts                                                                             |
| - | --------------------------------------- | ----------------------------------------------------------------------------------- |
| 1 | 2 concurrent first-time POSTs           | exactly `[201, 409]`; 1 cal_events row; loser sees winner's id; no leaked secrets   |
| 2 | 5 concurrent first-time POSTs (stress)  | exactly 1 winner / 4 losers; 1 cal_events row; loser ids ∈ `{winnerId, 0}` only     |
| 3 | Sequential pre-booked recipient         | fast-path 409; same `calendarEventId`; no duplicate event                           |
| 4 | Reservation-release semantics           | mid-flight state simulated; release sets `booked_at = NULL`; retry succeeds 201; 1  |
| 5 | DB-level atomic-reserve sanity          | 2 simultaneous CAS UPDATEs across independent connections → exactly 1 matches       |

## 4. Regression baseline

All previously-green suites still green after the fix:

| Suite                                | Before | After   |
| ------------------------------------ | ------ | ------- |
| `zoom-phase-a1.test.js`              | 30/30  | 30/30   |
| `zoom-phase-a2.test.js`              | 37/37  | 37/37   |
| `zoom-phase-a3.test.js` (new)        | —      | 27/27   |
| `p0-anonymous-routes.test.js`        | 84/84  | 84/84   |
| `p0-anonymous-routes-2.test.js`      | 72/72  | 72/72   |
| `p1-undergated-mutations.test.js`    | 45/45  | 45/45   |
| `p1-undergated-mutations-2.test.js`  | 33/33  | 33/33   |
| `p1-undergated-mutations-3.test.js`  | 47/47  | 47/47   |
| **Total**                            |        | **375/375** |

## 5. Architect review — addressed

| Finding                                                              | Resolution                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Catch-block could create duplicate on retry (insert ✓ + link ✗ path) | Wrapped 6b+6c in `db.transaction`; release guarded by `isNull(bookedCalendarEventId)` |
| Revoked-after-read TOCTOU                                            | Added `isNull(revokedAt)` to the CAS predicate                      |
| Link-deactivated-after-read TOCTOU                                   | Added live `SELECT … WHERE active = true` immediately after reserve |
| Bounded-poll loser path                                              | Already safe; no lock retention; ≤ 2 s ceiling; documented          |
| Different-`slotStart` concurrent POSTs                               | Handled by design (first-writer-wins reservation)                   |

## 6. Files touched

- `server/services/booking-link-service.ts` — added `isNull` import;
  rewrote steps 5–6 with atomic CAS, live-state revalidation, transactional
  post-reserve writes, and guarded release.
- `tests/zoom-phase-a3.test.js` — new suite (27 assertions, 5 groups).

No other files modified. No schema migration generated.
