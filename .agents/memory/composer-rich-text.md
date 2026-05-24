---
name: Composer Rich-Text Editor
description: How the email compose dialog's rich-text editor works — key decisions, flow, and gotchas.
---

## Rule
The compose dialog body is a `<div contentEditable>`, not a `<textarea>`. All formatting goes through `document.execCommand` (in `applyFormatToEditor`). Never revert to textarea/markdown approach.

**Why:** The old textarea + markdown-marker approach inserted `**text**` literal strings into the email body. Recipients saw raw markdown in the sent email.

## Key files
- `client/src/components/inbox/inbox-actions-store.ts` — `applyFormatToEditor(div, cmd, value, savedRange)`
- `client/src/lib/email-format.ts` — `buildEmailHtml(html)` (HTML in, styled HTML out), `normalizeUrl()`, `htmlToCleanHtml()` (paste normalization)
- `client/src/components/inbox/email-format-toolbar.tsx` — `onBeforeLinkOpen` prop fires before URL popover opens
- `client/src/pages/gmail-inbox.tsx` — `bodyRef: useRef<HTMLDivElement>`, `savedRangeRef: useRef<Range|null>`, `handleBeforeLinkOpen`

## Link selection flow
1. User selects text in editor
2. User clicks the link button in toolbar
3. `onBeforeLinkOpen` fires → composer saves `window.getSelection().getRangeAt(0).cloneRange()` into `savedRangeRef`
4. URL popover opens (steals focus, clearing the browser selection)
5. User types URL and submits
6. `applyFormat({cmd:"link", value:normalizedUrl})` called
7. `applyFormatToEditor` receives `savedRangeRef.current`, restores the range, then calls `execCommand("createLink", ...)`
8. DOM walker adds `target="_blank" rel="noopener noreferrer"` to the new `<a>`

## Placeholder
A sibling `<span aria-hidden>` is absolutely positioned over the empty editor and hidden via `{!body && ...}` conditional render.

## State sync
`onInput` handler calls `setBody(div.innerHTML)` so React state stays in sync. The `body` string is now HTML (not plain text).

## Paste
`handleBodyPaste` intercepts `text/html` clipboard data, runs it through `htmlToCleanHtml()` (strips external fonts/styles), inserts via `execCommand("insertHTML")`. Plain-text fallback via `execCommand("insertText")`.

## Tests
- `tests/composer-rich-text.test.js` — 17 structural + 22 unit tests (normalizeUrl, buildEmailHtml)
- `tests/email-html-sanitize.test.js` — 30 unit tests (buildEmailHtml + normalizeOutboundHtml + full pipeline)
