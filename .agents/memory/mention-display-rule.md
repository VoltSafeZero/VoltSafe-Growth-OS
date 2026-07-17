---
name: @mention clean-text display rule
description: Architecture for @mention tokens — DB stores token format, textarea always shows clean text; serialization pattern for all compose surfaces.
---

## The Rule

**Textarea ALWAYS shows clean text. Token format is for DB storage only.**

- User types `@scott`, selects Scott → textarea shows `@Scott ` (clean)
- DB stores `@[Scott](user:138)` (token format)
- Read mode: `renderMentionBody(storedText)` → styled chips — never raw tokens in DOM

## Conversion points

| Direction | Function | When |
|-----------|----------|------|
| DB → editor | `tokensToCleanText(initial)` | Before `useState(initial)` or `setVal(initial)` |
| editor init | `mentionRef.current.initFromTokenText(initial)` | After editor mounts / edit mode opens |
| editor → DB | `mentionRef.current.getTokenizedValue(val)` | Immediately before every API save call |

## Position tracking

`mentionEntriesRef` tracks `{ name, userId, atPos, end }` in clean-text coordinates.
`updateEntryPositions(oldVal, newVal)` must be called on every onChange keystroke.
`serializeForSave(cleanText)` replaces `@Name` spans back to `@[Name](user:ID)` tokens.

## Files changed

- `client/src/hooks/use-mention-composer.ts` — core hook; exports `tokensToCleanText`, `parseTokensToEntries`, `serializeToTokens`, `extractMentionedIds`, `MentionEntry`
- `client/src/components/shared/mention-input.tsx` — `MentionInputHandle { getTokenizedValue, initFromTokenText }` via `forwardRef` + `useImperativeHandle`; display guard converts any token-format value prop to clean text at render time
- `client/src/components/tasks/task-detail-drawer.tsx` — DescriptionEditor, CompletionNotes, CommentsBlock, NewTaskForm all wired
- `client/src/components/comments-feed.tsx` — ref + serialize on submit
- `client/src/components/notes-panel.tsx` — two refs (new + edit); startEdit converts to clean text
- `client/src/pages/current.tsx` — duplicate inline system: `insertMentionToken` → clean text; `useComposerMentions` gains `mentionEntriesRef`, `serializeForSave`, `clearEntries`; all 3 send handlers serialize

## CURRENTS-specific notes

`current.tsx` has its own duplicate `insertMentionToken` + `useComposerMentions` (not using the shared hook). The 3 send paths (`handleReplySend`, `handleSend`, `handleDmSend`) call `xMention.serializeForSave(trimmed)` and `xMention.clearEntries()` after each successful send.

## Regression test

`tests/mention-display-rule.test.cjs` — 66 source-grep checks pinning: no raw token literals in JSX value props, `getTokenizedValue` called before every save, `tokensToCleanText` used on every edit-mode open, `renderMentionBody` used in all read-mode locations.

**Why:** Without this discipline, token strings like `@[Scott](user:138)` would flash in the textarea during autocomplete selection and persist visibly until the next render cycle, breaking the UX contract.
