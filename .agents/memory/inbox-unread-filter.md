---
name: Inbox Unread Filter Server-Side
description: How the Unread filter pill was fixed to send is:unread to the backend instead of doing client-side filtering only.
---

## The Rule
When `crmFilter === "unread"`, the backend MUST receive `is:unread` in the `q` parameter. Client-side filtering alone is insufficient for large inboxes.

**Why:** trevor's inbox had 51,466 messages (99% read). First 50 fetched messages (sorted by date DESC) yielded only ~8 unread threads after `dedupByThread`. The unread filter pill was purely client-side — filtering already-fetched messages. Auto-chain could theoretically load more pages, but each page of 50 had ~42 read messages, making progress extremely slow.

**How to apply:**
1. `buildQClauses` in `server/services/local-mailbox.ts` handles `is:unread` → adds `label_ids ILIKE '%"UNREAD"%'` WHERE clause.
2. `inboxQuery` queryKey includes `crmFilter === "unread" ? "unread" : "all"` as 6th element — creates a separate cache partition so switching the filter triggers a fresh fetch.
3. `inboxQuery` params: `params.set("q", crmFilter === "unread" ? \`${inboxCategoryQ} is:unread\` : inboxCategoryQ)`.
4. `loadMoreInbox` params mirrors the same conditional — critical for pagination coherence (page 2+ must use the same filter as page 1).
5. Effect A reset (`setInboxExtra`, `setInboxNextToken`) includes `crmFilter` in deps — stale extra pages from the previous filter must not bleed into the new view.

**Regression test:** `tests/unread-filter-server-side.test.cjs` — 14 structural checks pinning all 5 invariants above.

**Pre-existing unrelated failure:** `inbox-count-reconciliation.test.cjs` reports `missing_inbox: 28` — CATEGORY_* messages lacking INBOX label. Fix by running `scripts/inbox-visibility-backfill.ts`. Unrelated to the unread filter fix.
