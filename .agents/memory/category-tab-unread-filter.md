---
name: Category Tab Unread Filter
description: Badge counts unread; category list must also filter to unread — three-part fix in gmail-inbox.tsx
---

## Rule
Category sidebar tabs (Social, People, Updates, Promotions, Forums) must send `is:unread` in their query so the list matches the badge count.

## Why
Badge SQL uses `is_unread=true AND smart_category=<cat>`. Old `inboxCategoryQ` sent bare `"in:social"` → backend returned 50 newest Social (all read, since unread ones were older). Result: badge=14, list showed "SEEN 1". Social has 611 total threads but only 14 unread — the 14 are not in the first 50 newest.

## How to apply
Three changes required in `client/src/pages/gmail-inbox.tsx`:

1. **`inboxCategoryQ`** — all 5 categories return `"in:<cat> is:unread"`:
   ```
   "in:people is:unread", "in:updates is:unread", "in:promotions is:unread",
   "in:social is:unread", "in:forums is:unread"
   ```
   Default ("all", "priority") stays `"in:inbox"` (no is:unread).

2. **`loadMoreInbox`** — use `inboxCategoryQ` as base (not hardcoded `"in:inbox"`):
   ```js
   const pageQ = crmFilter === "unread"
     ? (searchQuery ? `${searchQuery} is:unread` : "in:inbox is:unread")
     : (searchQuery || inboxCategoryQ);
   ```
   crmFilter==="unread" stays pinned to "in:inbox is:unread" (wide partition, category done client-side).

3. **Effect A deps** — add `inboxCategory` to reset cursor + extras on category switch:
   ```js
   }, [searchQuery, activeAccountId, crmFilter, inboxCategory]);
   ```
   Without this, Effect B can't adopt the new category cursor (only adopts when prev===null), causing page 2+ to use the wrong partition's cursor.

## Test file
`tests/inbox-category-unread-filter.test.cjs` — 25 checks covering all 3 changes plus badge SQL and SECTION_FETCH_QUERIES.
