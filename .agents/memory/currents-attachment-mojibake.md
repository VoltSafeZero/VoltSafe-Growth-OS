---
name: Multipart filename mojibake and chat composer attachment gaps
description: Recurring pattern for garbled upload filenames on multer-based endpoints, and a related class of bug where some composer variants in a multi-surface chat feature don't support attachment-only sends.
---

## Filename mojibake

Multipart/form-data filename decoding libraries commonly default to latin1.
Any non-ASCII byte in the original filename (e.g. a narrow no-break space
some OSes insert before AM/PM in auto-generated screenshot names) survives
the upload but gets corrupted into visible mojibake when displayed, even
though the file content itself is untouched. This is a decoding-layer bug,
not a storage or rendering bug — fix it once at the point the filename is
first persisted, re-decoding latin1 → utf8 with a guard against corrupting
filenames that were genuinely latin1 (e.g. bail out if the replacement
character appears after re-decode).

**Why this matters:** a plausible-looking regex/string fix should be
validated against the actual upload middleware's decoding behavior end to
end, not just unit-tested in isolation — the corruption is a property of
the multipart parser, not of arbitrary string manipulation.

## Multi-surface composer drift

In chat-like features with several composer variants (e.g. DM vs. channel
vs. thread-reply vs. object-linked feed), a capability added to one
variant (such as allowing an attachment-only send with no caption text)
can silently not exist in the others if the guard logic was duplicated
rather than shared. When fixing an attachment/composer bug in one surface,
check the sibling composers for the same guard pattern.

## Testing gotcha: hidden file inputs in Playwright-based e2e tests

Chat/composer UIs commonly trigger a hidden `<input type="file">` via a
visible icon button's `.click()` on a ref, rather than exposing the input
directly. Test plans for browser-automation agents must target the hidden
input's own selector with `setInputFiles` — instructing the agent to click
the visible button and wait for a native OS file dialog will hang/time out,
since headless browser automation cannot interact with native dialogs.
