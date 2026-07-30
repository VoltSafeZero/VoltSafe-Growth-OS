---
name: Smart Inbox Auto-loader All-mode Guard
description: PART B auto-loader must be gated on crmFilter==="unread" or it spins in All mode
---

## Rule
The PART B smart inbox auto-loader (`gmail-inbox.tsx`, `smartUnreadLoaderRef` useEffect) **must** return early when `crmFilter !== "unread"`. Without this guard it fires on every cycle in All mode, keeping `loadingMoreInbox = true` and showing the "Loading remaining unread emails…" spinner persistently.

**Why:** In All mode the user sees both read and unread messages via normal scroll pagination — forced convergence on the unread count is unnecessary. The PART C status strip condition was already gated on `crmFilter === "unread"` for its second clause, but `loadingMoreInbox` (set by the auto-loader) can still trigger the spinner's first clause without the PART B guard.

**How to apply:** At the very top of the PART B useEffect, before any other condition checks, add:
```typescript
if (crmFilter !== "unread") return;
```
This is line 7919 in the current codebase.

## Related: sales@voltsafe.com transient empty state
Production account 3 (sales, `team_shared`) has only 1 inbox_unread message. When TanStack serves a stale empty cache entry while the fresh fetch is in flight, `crmFilteredMessages.length === 0` and the empty state briefly shows. The PART C stall safety-net (`_unreadStallRefetchRef`) already handles this: when `serverInboxUnreadCount > 0 && crmFilteredMessages.length === 0 && !isLoading`, it fires one `inboxQuery.refetch()`. No separate fix needed.

## Production account structure note
Production has duplicate account rows for team inboxes:
- Account 3 (sales, `team_shared`, `is_shared=true`) — visible in sidebar, 1 inbox_unread
- Account 6 (sales, `company_managed`, `is_shared=false`) — NOT in accessible list, 38 inbox_unread

`getAccessibleAccountIds` only includes `is_shared=true` accounts (for non-owners). Account 6's messages are invisible to Trevor unless account 6 is made shared or its messages are merged into account 3.
