---
name: Currents InlineEditRow edit-mode raw token bug
description: The InlineEditRow edit overlay in current.tsx had raw token display + missing serializeForSave bugs.
---

## Rule
Any textarea that loads *existing* stored content (token format) into edit mode MUST:
1. Show `tokensToCleanText(stored)` — never raw `stored` in the textarea value
2. Call `initFromTokenText(stored)` on mount to populate mention position registry
3. Call `serializeForSave(cleanText)` before submitting to the API
4. Call `updateEntryPositions(oldText, newText)` in the onChange handler

**Why:** `InlineEditRow` in `current.tsx` violated all four rules — users saw raw
`@[Scott](user:138)` in the edit box and saves silently dropped user ID associations.

**How to apply:** Every "edit existing item" flow that uses a textarea or MentionInput
with pre-loaded content is a potential violation point. Check: is initial state from
`tokensToCleanText()`? Is save via `serializeForSave()`? Is mount via `initFromTokenText()`?

## Solution added to useComposerMentions hook (current.tsx)
```js
initFromTokenText: (stored: string) => {
  const TOKEN_RE = /@\[([^\]]+)\]\(user:(\d+)\)/g;
  const entries = [];
  let lastIndex = 0, cleanPos = 0, match;
  while ((match = TOKEN_RE.exec(stored)) !== null) {
    cleanPos += match.index - lastIndex;
    lastIndex = match.index + match[0].length;
    const name = match[1], userId = parseInt(match[2], 10), atPos = cleanPos;
    entries.push({ name, userId, isAll: false, atPos, end: atPos + 1 + name.length });
    cleanPos = atPos + 1 + name.length;
  }
  mentionEntriesRef.current = entries;
}
```
