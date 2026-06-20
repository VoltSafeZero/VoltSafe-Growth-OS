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
