---
name: Composer Link Flow Fix
description: Why hyperlink insertion silently failed and the fix applied.
---

## The bug

`handleInsertLink` in `email-format-toolbar.tsx` was calling `dispatchFormat("link", url)` synchronously, then `setLinkOpen(false)`. At the moment `dispatchFormat` fired, the Radix Popover was still open and held the browser's focus trap. Inside `applyFormatToEditor`, `div.focus()` was silently blocked by that trap — so `document.execCommand("createLink")` ran without the editor having focus and did nothing.

## The fix

Close the popover first, then dispatch after a short delay so Radix's focus trap has released:

```typescript
setLinkOpen(false);
setLinkUrl("");
setTimeout(() => dispatchFormat("link", urlToInsert), 20);
```

**Why:** Radix focus traps redirect any `focus()` call that targets an element outside the open Popover back to the last focused element inside the Popover. This silently no-ops `div.focus()` and leaves `execCommand` without a focused contenteditable target.

**How to apply:** Any time a format command needs to be dispatched from a button inside a Radix Popover/Dialog, always close the overlay first and delay the dispatch by at least one macrotask (setTimeout 0–50ms).
