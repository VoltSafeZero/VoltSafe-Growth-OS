---
name: Reaction Route channel_id Bug
description: The archived-channel reaction guard was silently unreachable because channel_id was missing from the SELECT — durable pattern for any future route that checks channel properties.
---

## The Rule
Any route that reads a message and then checks a **channel-level** property (archived, private, etc.) must SELECT that channel's FK from `current_messages` first. If you don't select `channel_id`, the column comes back `undefined`, the `Number(undefined)` cast produces `NaN` (falsy), and the guard is silently bypassed.

## What happened
`POST /api/current/messages/:id/reactions` had:
```sql
SELECT id, conversation_id FROM current_messages WHERE id = ... AND deleted_at IS NULL LIMIT 1
```
Then tried to use `msgRows.rows[0].channel_id` — which was `undefined` because it wasn't selected. `reactChannelId` became `null`, so the archived-channel check (`SELECT archived_at FROM current_channels WHERE id = ${reactChannelId}`) was never reached. Any user could react to messages in an archived channel.

**Fix:** `SELECT id, conversation_id, channel_id FROM current_messages ...`

## Pattern to follow
For every route that does "look up a message, then enforce a channel constraint":
1. Include `channel_id` in the initial message SELECT.
2. Derive the channel ID: `const chanId = rows[0].channel_id ? Number(rows[0].channel_id) : null;`
3. Guard only when `chanId` is truthy (DM messages have `channel_id = NULL`).

## How it was hidden
The `channel-readonly.test.cjs` only used source-grep checks (looking for the string `"Cannot react to messages in an archived channel"`). It never called the reaction API against an actual archived channel. The guard text was present; the execution path to it was broken.

**Fix for tests:** Always add a live archived-channel API test alongside the source-grep pin. The live test (create channel → post message → archive → react → expect 403) is the only reliable way to catch this class of bug.

## Related
- See also: `B8. Delete SELECT now includes channel_id column` in `tests/channel-readonly.test.cjs` — the same fix was applied to the delete route in an earlier phase. Reaction route was missed at that time.
