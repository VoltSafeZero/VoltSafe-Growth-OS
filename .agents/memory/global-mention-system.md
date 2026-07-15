---
name: Global @mention system
description: Architecture and key decisions for the CMS-wide @mention system (global_mentions table, saveMentions service, API routes, MentionInput component).
---

## Token format
`@[Name](user:ID)` stored verbatim in any text field. `@[all](user:0)` for team-wide. Parsed server-side by `parseMentionTokens()` in `server/services/mention-service.ts`.

## @all expansion
`getAllActiveUserIds()` in mention-service caches active user IDs for 60s. Virtual @all user has `id: 0` — prepended by `/api/current/users` when query matches "all"/"everyone"/"team" or is empty.

## Fire-and-forget pattern
`saveMentions()` must always be called with `.catch(() => {})` — it is fire-and-forget; caller must not await it in hot paths. This is intentional so a mention failure never breaks the primary write.

## Author exclusion
`saveMentions()` deletes `opts.authorId` from `mentionedUserIds` before inserting — author never gets their own mention notification.

## Status lifecycle
`unread` → `viewed` (auto on fetch) → `acknowledged` / `completed` / `dismissed`. `GET /api/mentions` auto-marks `unread` rows as `viewed` in a fire-and-forget UPDATE after returning results.

## ACL on PATCH
`PATCH /api/mentions/:id` verifies `mentioned_user_id = userId` — users can only act on their own mentions.

## Integration points
- CURRENTS: `syncCurrentMentions()` in routes.ts calls saveMentions fire-and-forget at the top
- Tasks: comment POST in routes-tasks.ts calls saveMentions fire-and-forget
- More surfaces: call `saveMentions({ body, entityType, entityId, moduleKey, moduleLabel, authorId, deepLinkUrl? })` anywhere text with @tokens is persisted

## Deep link URL convention
- Task comment: `/execution/tasks?task=ID`
- CURRENTS channel: `/current?channel=SLUG&message=ID`
- CURRENTS with linked object: `/accounts/ID?tab=current&message=ID`

## Frontend hook
`useMentionComposer` in `client/src/hooks/use-mention-composer.ts` handles dropdown state + keyboard nav. Wraps `/api/current/users?q=` (which includes virtual @all). `MentionInput` + `renderMentionBody` are the shared UI primitives in `client/src/components/shared/mention-input.tsx`.

**Why:** Single-token format avoids a separate mentions resolve step at render time; renderMentionBody is a pure regex transform (no async).
