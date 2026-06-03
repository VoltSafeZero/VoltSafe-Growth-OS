---
name: Reply/Forward Thread History Fix
description: Why quoted thread history was missing from outbound reply and forward emails, and how it was fixed.
---

## The bug

`sendMutation` (and `scheduleMutation`) in `ComposeDialog` only appended `buildForwardedBlockHtml` when `isForward === true`. For replies, `defaultQuotedHtml` was populated and rendered in the UI preview but **never appended to the outbound body**. Recipients received new reply text + signature only — no quoted history.

`handleForward` also only passed `msg.body` (focused single message) as `quotedHtml`, losing prior messages in multi-message threads.

## Fix

1. **`buildReplyQuoteBlockHtml(from, date, bodyHtml)`** — new helper in `gmail-inbox.tsx` that wraps quoted content in a `<blockquote style="border-left:3px solid #ccc;padding-left:16px">` block with an "On {date}, {from} wrote:" header.

2. **`sendMutation` and `scheduleMutation`** — both now use the same ternary:
   - `isForward && quotedHtml` → `buildForwardedBlockHtml(...)`
   - `!isForward && threadId && quotedHtml` → `buildReplyQuoteBlockHtml(...)`
   - else → `""`

3. **`handleForward`** — now reads `threadQuery.data?.messages` (same data as `selectedMessages`). Single-message thread: uses `msg.body` directly. Multi-message: concatenates all messages oldest-first with sender/date headers and `border-top` dividers.

4. **`normalizeOutboundHtml`** — added `border-left`, `padding-left:16px`, and `padding-left:1ex` to the style whitelist so Gmail/Outlook native blockquote styles survive the normalizer pass.

**Why:** `draftMutation` was NOT updated — `stripEmailWrapper` already correctly strips everything outside the first VoltSafe wrapper div, so saving drafts with or without the quote block is harmless; the quote is re-appended at send time.
