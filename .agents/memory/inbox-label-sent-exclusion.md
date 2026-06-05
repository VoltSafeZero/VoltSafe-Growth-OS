---
name: Inbox SENT label exclusion bug
description: Self-sent emails (trevor@voltsafe.com → trevor@voltsafe.com) have BOTH SENT+INBOX labels; the inbox query's NOT ILIKE SENT filter wrongly hides them.
---

## Rule
Never add `label_ids NOT ILIKE '%"SENT"%'` to the INBOX label filter in `buildQClauses` (`server/services/local-mailbox.ts`). Self-addressed emails from Gmail carry BOTH `SENT` and `INBOX` labels simultaneously.

**Why:** When a user sends an email to themselves via any Gmail client (Spark, web, VoltSafe Mail), Gmail stores a single message with labelIds = `["SENT", "INBOX", "UNREAD"]`. Adding a SENT exclusion hides these messages from the inbox view entirely, making it appear the sync is broken when in fact the messages are in the DB.

**How to apply:** The INBOX label condition `(label_ids ILIKE '%"INBOX"%' OR ...)` already excludes pure-outbound messages — they only have `["SENT"]` and won't match the INBOX/CATEGORY conditions. The SENT exclusion is redundant and harmful.
