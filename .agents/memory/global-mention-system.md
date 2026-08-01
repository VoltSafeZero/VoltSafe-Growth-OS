---
name: Global @mention system
description: Token format, saveMentions/refreshMentions, current_mentions, syncCurrentMentions — all mention persistence patterns
---

## Token format (shared everywhere)
`@[Name](user:ID)` — regular user. `@[all](user:0)` — broadcast.

## saveMentions() — server/services/mention-service.ts
- Parses tokens, expands @all via getAllActiveUserIds() (60s LRU cache)
- Upserts to global_mentions with UNIQUE constraint: (entity_type, entity_id, mentioned_user_id)
- ON CONFLICT (entity_type, entity_id, mentioned_user_id) DO UPDATE SET source_preview/deep_link_url/updated_at
- Safe to call fire-and-forget (all errors caught + logged)

## refreshMentions() — mention-service.ts
- Diff-based: dismisses stale mentions (users removed from body → status='dismissed')
- Then calls saveMentions() for remaining/new users
- Use on edit routes, not on initial create

## syncCurrentMentions() — server/routes.ts (~line 38180)
- Called for every channel/DM/record-current message (new + edit)
- Uses parseCurrentMentionTokens() → returns { directIds, hasAll }
- @all expands to all active users at runtime
- MUTE RULE: @all-expanded targets respect muted-channel prefs; direct @user mentions ALWAYS notify (bypass mute)
- Edit resync: DELETEs current_mention rows for users removed from message body
- Self-mentions excluded
- Notification: dedupe_key = `current_mention:${messageId}:${userId}` prevents re-notify on edit
- Thread deep-link: includes both &thread=parentId and &message=msgId

## global_mentions unique constraint
- Migration: migrateGlobalMentionsUniqueConstraint() in seed-production.ts
- Wired in server/index.ts Batch 2 (parallel)
- Applied to dev DB on 2026-08-01
- Idempotent: 42710 guard + dedup step before ADD CONSTRAINT

## Canonical client hook
- client/src/hooks/use-current-users.ts — useCurrentUsers(rawQuery, enabled, includeAll)
- normalizeUserQuery() strips leading @ (belt+suspenders; server also strips it)
- includeAll=false for DM/Add Member pickers (no @all broadcast in 1:1 context)
- @all virtual entry is client-side only (useMentionComposer prepends it, server doesn't return it)

## CMS field inventory (Part 5 — as of 2026-08-01)
Mention-enabled: Leads (Notes/Competitors/ROI Story), Tasks (description/completion notes/comments), notes-panel.tsx, comments-feed.tsx, timeline-tab.tsx, quick-log-modal.tsx

Plain (no mention yet — candidates for future wiring):
- Accounts: notes textarea
- Calendar: meeting notes, outcome notes
- Projects: description, compliance notes
- Quotes: customer notes, assumptions, exclusions
- Marketing: campaign notes, template body, audience description
- Tickets: description/comments

NEVER mention: email, phone, search/filter inputs, numeric fields, API keys, dates, IDs

## @mention notification surface — saveMentions vs. syncCurrentMentions
- global_mentions (CMS-wide feed) ← saveMentions()
- current_mentions (Currents Mentions panel) ← syncCurrentMentions()
- notifications (bell dropdown) ← syncCurrentMentions() only
- saveMentions does NOT create notifications rows — that's intentional
