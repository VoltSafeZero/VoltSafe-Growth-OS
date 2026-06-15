---
name: Forward/Reply Body Truncation — Root Causes & Fixes
description: Why Reply/Reply-All/Forward email bodies are truncated in the live app, and the complete fix applied.
---

## Root Causes (all four confirmed)

1. **`body_text` stored at 4 KB cap** — `email-parser.ts` line ~244: `bodyText.slice(0, 4000)`.
   Plain-text emails and unbackfilled messages fall back to `body_text`, causing severe truncation in quoted blocks.
   **Fixed**: raised to 50,000 chars.

2. **`body_html` stored at 200 KB cap** — `email-parser.ts` line ~245: `bodyHtml.slice(0, 200000)`.
   Very large HTML newsletters could be truncated.
   **Fixed**: raised to 500,000 chars.

3. **On-demand backfill capped at 10 messages** — `routes.ts` line ~11953: `.slice(0, 10)`.
   Threads with 11+ messages never got HTML backfilled on thread open — messages 11+ fall back to truncated `body_text`.
   **Fixed**: raised cap to 25.

4. **Reply/Reply-All used only focused message body** — `handleReply`/`handleReplyAll` passed `msg.body` directly.
   If the focused message had no `body_html` (empty/null), the 4 KB `body_text` was used as the quoted block.
   **Fixed**: handlers are now async; when `msg.isHtml=false`, they call the new `/api/gmail/messages/:msgId/full-body` endpoint to fetch the complete HTML on-demand, with fallback to full thread context.

## New endpoint: `GET /api/gmail/messages/:msgId/full-body`

- Fast path: returns `body_html` from DB (cached, ~0ms).
- Slow path: fetches live from Gmail API, updates DB cache, returns full HTML.
- Auth: same ACL as `/cid-image` endpoint (owner + shared access + admin).
- Response: `{ bodyHtml, bodyText, isHtml, source, bodyHtmlLength, bodyTextLength }`

## How `handleForward` was updated

`handleForward` is now async. It calls `fetchFullMessageBody(m.id)` for every thread message that lacks `body_html`, resolving all in parallel via `Promise.all`. This ensures the full body is used for every message in the forwarded chain regardless of backfill state.

## FORWARD_REPLY_TRACE logging

- Frontend: always on in dev (`import.meta.env.DEV`) or set `localStorage.setItem('FORWARD_REPLY_TRACE','true')`.
  Logs `[FRT:reply:start]`, `[FRT:reply:full-body-fetch]`, `[FRT:reply:final]`, `[FRT:send:step1-input]`, `[FRT:send:step1-quotedBlock]`.
- Backend: logs `[FRT-SEND:pre-sig]` and `[FRT-SEND:post-sig]` in dev or when `FORWARD_REPLY_TRACE=true`.

## Stage-C Multi-Message Override Fix (plain-text threads)

**Root cause:** For multi-message threads where the focused msg is `isHtml=false`, `handleReply`/`handleReplyAll` fetched the full body (10 K+) but still called `buildThreadQuoteBlock(allMsgs)` which used the 4 K–cached Stage-B values. The full-fetch result was fetched but discarded.

**Fix:** New `buildThreadQuoteBlockWithOverrides(msgs, overridesMap)` helper. On reply/replyAll, after the full-body fetch, the focused message's entry is added to an override `Map<msgId, {body, isHtml, source}>` and passed to the new builder. Override log: `C:reply:override-applied` / `C:replyAll:override-applied`.

**End-to-end validation (IRAP thread `18bedd09d2968ac8`, account 93 = sales@voltsafe.com):**

| Stage | Length | Canary ✓ |
|-------|--------|----------|
| B cached (old) | 4,000 | ✗ truncated |
| A full-body | 10,410 | ✓ |
| C override applied | 33,146 | ✓ |
| E reply wrapping | 33,449 | ✓ |
| F normalizeSignatureHtml | 31,848 | ✓ |
| F normalizeOutboundHtml | 25,948 | ✓ |
| F applySignatureSendSanitizer (mimeFinal) | 25,948 | ✓ |

All three flows (reply / replyAll / forward) confirmed. Regression test: `tests/forward-reply-body-hydration.test.cjs` (49 tests).

## Structural test update

`tests/forward-reply-sig-isolation.test.cjs` section 5 was updated to handle both sync and async handler signatures (`async (msg: ThreadMessage)` vs `(msg: ThreadMessage)`) and to allow `resolvedMsgs.map(` as an alternative to `allMsgs.map(`.

**Why:** Source-grep tests must be flexible about implementation details (sync vs async) while pinning the invariants that matter (no sig markers in quoted content, quotedHtml sourced from msg.body).
