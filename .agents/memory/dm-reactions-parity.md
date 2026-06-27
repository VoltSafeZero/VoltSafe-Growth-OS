---
name: DM Reactions Parity Fix
description: Phase 13A — what was wrong with the DM MessageRow call site and the correct props to use.
---

## The Rule
The DM `MessageRow` call inside `dmMessages.map()` in `client/src/pages/current.tsx` must use the **MessageRow's actual prop API**, not an older/different set of props.

## Correct props (as of Phase 13A)
```tsx
<MessageRow
  message={{ ...msg, channelId: 0, replyCount: 0, latestReplyAt: null, structuredItems: [] }}
  currentUserId={currentUserId}
  grouped={isConsecutive}          // ← not "isConsecutive={...}"
  isAdmin={false}
  isArchived={false}               // ← keeps MessageActionBar visible (reactions enabled)
  pinnedMessageIds={new Set()}
  onToggleReaction={(mid, emoji) => dmReactMutation.mutate({ messageId: mid, emoji })}
  onEdit={...}
  onDelete={...}
  onPin={() => {}}
  onOpenThread={() => {}}
  onMarkStructured={() => {}}
  onUnmarkStructured={() => {}}
/>
```

## What was broken
The call site was passing `onReact={(emoji) => ...}` and `isConsecutive={isConsecutive}` — both are **not valid MessageRow props**. `MessageRow` accepts `grouped` (not `isConsecutive`) and `onToggleReaction(messageId, emoji)` (not `onReact(emoji)`). The wrong props were silently ignored, so reaction clicks did nothing in DMs.

**Why:** MessageRow's prop interface was updated during the channel reactions implementation (Phase 8–9 range) but the DM call site was never updated in sync.

## Backend was already complete
No backend changes were needed for Phase 13A. The route `POST /api/current/messages/:id/reactions` already:
- Checks `current_conversation_members` for DM membership
- Blocks `deleted_at IS NOT NULL` messages
- Blocks archived channels
- Validates emoji against ALLOWED list
- Works identically for channel messages and DM messages

## Source-grep window sizes (measured)
- `dmMessages.map(` → `onToggleReaction`: **1343 chars** — use window ≥ **2000**
- `function MessageRow(` → `onToggle={onToggleReaction}`: **4429 chars** — use window ≥ **5000**

## Non-member test setup
- conv_id=4 = trevor (id=4) + viewer (id=6) 1:1 DM
- conv_id=3 = group_dm that viewer IS in (do NOT use viewer as non-member against conv_id=3)
- conv_id=5 = trevor (id=4) + lowperm (id=8) 1:1 DM — **viewer is not in this**, use for 403 non-member test
