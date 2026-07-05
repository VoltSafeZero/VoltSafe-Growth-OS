---
name: Campaign Reply Ingestion Phase 8
description: Architecture decisions and gotchas for Phase 8 inbound reply ingestion service.
---

## Key decisions

**inReplyTo column not in Drizzle schema**
`email_messages.in_reply_to` is added via raw SQL migration (ALTER TABLE ADD COLUMN IF NOT EXISTS) rather than the Drizzle schema, following the "additive raw SQL" architecture principle. Because it's not in the Drizzle schema, it cannot be spread into `db.insert(emailMessages).values({...emailData})`. Store it after insert via a separate raw UPDATE: `db.execute(sql.raw("UPDATE email_messages SET in_reply_to = '...' WHERE id = N"))`.

**sendEmail() return value**
`sendEmail()` in `server/gmail.ts` returns `res.data` which contains `{ id, threadId }` from the Gmail API. The campaign-sender was discarding this return. Capture as `const gmailResult = await sendEmail(...)` and cast `(gmailResult as any)?.id` for `providerMessageId`.

**Matching priority (fail-conservative)**
1. gmailThreadId == campaign_sent_messages.provider_thread_id
2. In-Reply-To header == provider_message_id
3. References header (any contained Message-ID) == provider_message_id
4. fromEmail + normalized subject + 30-day window — only when exactly ONE row matches (LIMIT 2, check rows.length === 1)

**Auto-task gate**
Only `meeting_request` and `interested` classifications trigger auto-task creation on inbound ingestion. Unsubscribe, negative, out_of_office, auto_reply all excluded.

**Domain skip list**
Skip processing for fromEmail @voltsafe.com and @voltsafe.test (internal/dev domains). Stored as `const VOLTSAFE_DOMAINS = new Set(["voltsafe.com", "voltsafe.test"])`.

**Why:**
Subject-fallback match is ambiguous if 2+ recipients got the same campaign subject — must reject rather than guess wrong.

**How to apply:**
Any new matching priority should be inserted before subject_fallback. Subject fallback is last resort and always limited to 30 days + single-row unambiguous match.

## Test pattern gotcha
Source-grep tests using `hasPattern(str, "pattern.*with.*regex")` where the second arg is a STRING, not a regex literal, performs a literal substring search — the `.*` won't work. Use `hasPattern(a, "foo") && hasPattern(a, "bar")` for multi-part checks, or pass an actual regex literal `/foo.*bar/s`.

## Audit hardening (applied post-merge)

- `storeSentCampaignMessage` `ON CONFLICT DO NOTHING` was broken — no unique constraint on `provider_message_id` so the conflict clause never fired. Fix: change index to UNIQUE and use `ON CONFLICT (provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING`.
- Thread-ID and References matching initially had no sender email validation. A forwarded email in the same Gmail thread from a 3rd party could match the wrong campaign recipient. Fix: add `AND recipient_email ILIKE ${sq(fromEmail)}` to both queries.
- `campaign_unmatched_replies` was missing `idx_cur_received_at` index.
- Inbound unsubscribe reply did not trigger suppression. Fix: after classification, if `unsubscribe`, UPDATE `campaign_recipients.unsubscribed_at` and INSERT into `campaign_suppression` (reason=unsubscribe_reply, source=inbound_ingestion).
- `getUnmatchedReplies` status filter had no allowlist validation. Fix: `VALID_UNMATCHED_STATUSES` Set gates the filter.

## New tables
- `campaign_sent_messages`: tracks outbound send with provider_message_id + provider_thread_id for reply matching
- `campaign_unmatched_replies`: queue for inbound replies that didn't match any campaign recipient; retried up to 5 times
