---
name: Inbox thread canonical category CTE
description: Fix for inbox thread double-count when a thread has messages in two different smart_category values.
---

## Rule
Per-category `COUNT(DISTINCT gmail_thread_id)` in a single SQL query double-counts threads
that have messages in multiple categories (e.g., an update forwarded as a promotion).

## How to apply
For inbox category thread counts, use a two-query pattern:
1. Main query: total `COUNT(DISTINCT gmail_thread_id) FILTER (WHERE is_inbox=true AND is_unread=true)` 
2. Separate canonical query: `DISTINCT ON (gmail_thread_id) ORDER BY sent_at DESC` assigns each thread
   to exactly one category (most recent message's category). Then `COUNT(*)` over that is mutually exclusive.

Applied at: `server/routes.ts` GET `/api/gmail/inbox-debug` handler (~line 20700).
Test: `tests/inbox-count-reconciliation.test.cjs` — checks delta===0 (bucket_sum===inbox_unread_threads).

**Why:** Thread 19f6c84d5e4e8e05 had messages in both 'promotions' and 'updates', causing bucket_sum=286
but inbox_unread_threads=285 (delta=-1), breaking the reconciliation test.
