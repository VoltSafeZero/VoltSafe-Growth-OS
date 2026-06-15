---
name: Inbox Category Visibility
description: Gmail skip-inbox delivers CATEGORY_* emails without INBOX label; how to guard and backfill.
---

## Rule

Every inbound email — including those Gmail auto-categorizes to Promotions, Updates, Social, or Forums — must appear in the VoltSafe inbox. Categories are metadata tags, not destination folders.

**Why:** Gmail's "skip inbox" category-tab setting delivers messages with only `CATEGORY_*` labels and no `INBOX` label. Without a guard, those emails are invisible unless the user clicks the category sidebar tab, making categories behave like folders.

## Key implementation pieces

- **`ensureInboxForCategoryLabels(labels, requireUnread?)`** — exported from `server/services/gmail-incremental.ts`. Appends `"INBOX"` when: has CATEGORY_* + no INBOX + not SENT/DRAFT/SPAM/TRASH. `requireUnread=true` skips already-archived (read) messages in the label-change path to respect explicit user archiving.

- **Applied in two places in `gmail-incremental.ts`:**
  1. `upsertMessageById` — on new message insertion, `requireUnread=false` (unconditional for new inbound mail)
  2. `syncIncremental` label-change path — `requireUnread=true` (preserves archiving behavior)

- **`move-to-primary` route** (`server/routes.ts`): `removeLabelIds` must be `[]`. It historically stripped CATEGORY_* labels — this was wrong. Only INBOX should be added; categories are preserved.

- **Backfill script:** `scripts/inbox-visibility-backfill.ts` — idempotent, scopes to UNREAD + not SENT/SPAM/TRASH/DRAFT. Run once to repair existing rows.

- **Tests:** `tests/inbox-visibility.test.cjs` (22 checks) — registered as `inbox-visibility` workflow.

## How to apply

- Any future change that modifies label handling in `upsertMessageById` or the label-change path must preserve this guard.
- Any route that calls `threads.modify` with `removeLabelIds` must NOT include CATEGORY_* labels.
- If new category labels are added (CATEGORY_PERSONAL etc.), update `CATEGORY_LABEL_SET` in `gmail-incremental.ts` and the inbox query in `local-mailbox.ts`.
