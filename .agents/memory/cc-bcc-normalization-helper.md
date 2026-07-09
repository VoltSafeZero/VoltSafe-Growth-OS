---
name: Shared CC/BCC recipient normalization
description: Root cause and fix pattern for "Invalid Cc header" send failures; use whenever touching recipient parsing on send/draft/reply-all paths.
---

"Send failed — saved as draft: Invalid Cc header" was caused by naive `str.split(",")`/`split(/,\s*/)` on raw address-list strings, which fragments whenever a display name itself contains a comma (e.g. `"Doe, Jane" <jane@x.com>`), producing malformed pieces that corrupt the Cc/Bcc MIME header Gmail's API then rejects.

**Fix:** `shared/recipients.ts` extracts addresses with a bracket-aware regex (`<addr>` or bare `addr@domain` tokens) instead of splitting on commas, then `normalizeRecipients()` trims/lowercases/dedupes/validates and can strip the sender's own address (needed for reply-all). Invalid entries are returned in a separate `invalid[]` array and must be surfaced as a 400 — never silently dropped.

**Why:** Any address-list field (To/Cc/Bcc) reachable from more than one surface (compose send, draft save/reload, reply-all) needs identical parsing on client and server, or a value normalized on one path can still corrupt a header on another (e.g. a draft saved with a raw cc string reloads that same broken string into reply-all later).

**How to apply:** Route every place that builds a Cc/Bcc header — send, draft-save, reply-all — through `normalizeRecipients`/`normalizeRecipientListString` from `shared/recipients.ts`. Never re-introduce a bare `.split(",")` on a display-name-bearing address string.

**Second, subtler bug in the same family (found during live verification):** `normalizeRecipients(rawEntries, opts)` expects an already-split array of individual address entries. Calling it as `normalizeRecipients([cc], opts)` — wrapping the whole raw comma-joined string in a single-element array — makes it treat the entire string as ONE entry. It then extracts only the first bracketed address via regex and silently drops every other recipient, with no error and no `invalid[]` entry (the multi-recipient value never fails validation, it just vanishes). This is a call-site bug, not a parsing bug in `recipients.ts` itself, and unit tests that only check "the file imports `normalizeRecipients`" will not catch it. For a raw string, always call `normalizeRecipientListString(str, opts)` directly instead.

**Also watch for collateral-damage reauth handling:** a `catch` block that reacts to one mailbox's OAuth failure by doing `db.update(emailAccounts).set({isActive:false}).where(eq(emailAccounts.userId, userId))` deactivates every non-shared mailbox the user owns, not just the one that failed. Scope any auth-failure account mutation to the specific resolved account id, not the broader userId.
