---
name: Smart Inbox Flip-Back Fix
description: Why the PEOPLE unread dot briefly re-appeared after clicking, and the fix pattern to prevent it.
---

## Rule
Never call `queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] })` inside the mark-read `.then()` callback. Use `setQueriesData` re-patches + `invalidateBadgeQueries()` instead.

## Why
The 1-part prefix `["/api/gmail/messages"]` invalidation triggers an immediate background refetch of `inboxQuery`. The refetch response can arrive before (or race) the `mirrorLabelChangeForMessages` DB write that removes UNREAD from `label_ids`. When the refetch result lands, it overwrites the optimistic `setQueriesData` patch, putting UNREAD back into `labelIds` in the cache — the dot/bold re-appears for ~1-2 s.

PEOPLE messages are disproportionately affected because they are fresh/human-sender emails that land in the top-50 first-page results of the refetch. Newsletter/Notification messages tend to be loaded via `loadMoreInbox` (into `inboxExtra`), and `dedupById` never replaces `inboxExtra` entries from a first-page refetch, so they don't flip back.

## How to apply
In `handleSelectMessage`'s fire-and-forget mark-read fetch callback:
```typescript
.then(() => {
  invalidateBadgeQueries();                                                    // badge counts only
  queryClient.setQueriesData({ queryKey: ["/api/gmail/messages", "inbox"] }, removeUnread);  // re-assert patch
  queryClient.setQueriesData({ queryKey: ["/api/gmail/messages", "sent"]  }, removeUnread);  // re-assert patch
})
```
The 15s `inboxQuery` `refetchInterval` handles eventual consistency for the full message list.

Also: if the grep context window for MR-11 in `mark-read-derived-columns.test.cjs` needs to be widened, change `-A15` to `-A35` (the explanatory comment block is ~10 lines, pushing `.then()` beyond the original 15-line window).

**Local-first extension (Option B + A):**
The `.then()` now receives the `resp` object. `resp.ok` (200) = local write succeeded, re-apply patch + invalidate badges. `!resp.ok` (non-200) = local DB write failed, restore UNREAD in all four stores (inbox cache, sent cache, inboxExtra, sentExtra), no badge invalidation. The rollback guard `!m.labelIds.includes("UNREAD")` prevents duplicate UNREAD. A Gmail-only failure returns 200 (`gmailSynced: false`) so it never triggers rollback. `.catch()` = network error, leave optimistic patch, 15s poll corrects.

Backend reorder (all four routes): mirror + is_unread=false written BEFORE Gmail call. Gmail is best-effort. Route returns non-200 only if the local is_unread=false UPDATE fails. Response shape: `{ success: true, gmailSynced: bool }` for single-message; bulk unchanged (success/failed counts).

Test file: `tests/local-first-mark-read.test.cjs` (27 checks, B1–B8, FE1–FE6, REG1–REG4).

**Test locator pitfalls:**
- B5a fan-out locator: anchor on `app.post("/api/gmail/bulk-mark-read"` first, THEN find `rawAcc === "all"` within that block — earlier routes also use that string.
- B8/REG4 spam locator: start at `app.post("...not-spam"`, end at `app.post("...mark-read"` — ending at `mark-all-inbox-read` includes mark-read routes that do contain `SET is_unread`.
- Flip-back test `.then()` locator: accept both `() => {` and `(resp) => {` forms with `Math.min(a, b)`.

**Bulk mark-read (fan-out and single-account) and mark-all-inbox-read:** No longer uses `succeededIds` to gate local writes. Local writes happen for ALL requested IDs. Outer `getGmailClient` failure no longer 503s — logs "local writes committed" and counts all as gmail-failed.
