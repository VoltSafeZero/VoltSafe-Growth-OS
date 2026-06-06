---
name: CID MIME Structure
description: Correct RFC 2387 MIME tree for inline-image emails; CID format rules; diagnostic tools.
---

## The Rule

`buildMimeRaw` in `server/gmail.ts` must produce this structure when inline images are present:

```
multipart/alternative [altBnd]
  text/plain
  multipart/related [relBnd]   ← text/html is the ROOT of related
    text/html                  ← DIRECT first child of related (not alt inside related)
    image/png Content-ID: <cid>
```

When attachments are also present, wrap the above in `multipart/mixed`.

**The old (wrong) structure was:**
```
multipart/related
  multipart/alternative      ← WRONG: alt was root of related
    text/plain
    text/html
  image/png
```

**Why:** Spark Mail, Outlook, and Apple Mail only resolve `cid:` references when `text/html` is the **direct first child** (root) of `multipart/related`. If `multipart/alternative` is the root, clients can't correlate the CID references in the nested `text/html` with the sibling image parts.

**How to apply:** Any future edit to `buildMimeRaw` that changes the MIME structure must maintain: `text/html` → direct peer of inline images inside `multipart/related`; `multipart/related` → second alternative inside `multipart/alternative`; `multipart/alternative` → top level (or inside `multipart/mixed` if attachments exist).

## CID Format

CID values must be **purely alphanumeric** — no `@`, no file extensions, no slashes, no spaces.

Current format: `vsig${cidIndex}${Date.now().toString(36)}` (e.g., `vsig0lbtykq94j`)

**Why:** Some clients (Spark, older Outlook) misparse CIDs containing `.` or `@`, treating the `@domain` part as an email address or the `.ext` as a file extension hint, which breaks the lookup.

## Diagnostics

- `buildMimeRawDebug(from, to, subject, body, ...)` — exported from `server/gmail.ts`; returns raw decoded MIME string (not base64url) for inspection.
- `POST /api/dev/mime-tree` (admin, dev-only) — accepts `{ body, subject }` and returns `{ mimeTree, rawMime, inlineImageCount }` without sending.
- `sendEmail` logs `[mime-tree]` with the Content-Type/boundary structure for every outgoing email with inline images (dev only).
- `[sig-cid]` console.error fired when a signature image fails to load from disk or fetch.
