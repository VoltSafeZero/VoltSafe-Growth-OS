---
name: Composer XSS Hardening
description: Three-layer XSS defense for sanitizeEditorHtml; normalizeUrl protocol handling; nested-link attack pattern and fix.
---

## Rule
`sanitizeEditorHtml` in `client/src/lib/email-format.ts` uses three sequential defenses against XSS via malicious `href` values:

1. **Anchor rebuild (pass 1)** — regex replaces every `<a href="...">` with a clean rebuilt tag; any href whose protocol is not `https?:`, `mailto:`, `tel:`, `/` (relative), or `#` has its href dropped and only the label text is kept.
2. **Final attribute strip (5b)** — after the rebuild, a targeted `href="javascript:…"` / `data:…` / `vbscript:…` attribute regex runs unconditionally. This catches inner anchors that survive as label text of the outer anchor in pass 1 (the nested-link attack pattern).
3. **`nodeToCleanHtml` paste path** — applies the same protocol allowlist to `href` attributes when pasting HTML.

## normalizeUrl protocol handling
`normalizeUrl` uses `/^[a-z][a-z0-9+.-]*:/i` to detect any existing protocol (including `javascript:`, `vbscript:`, `data:`). If a protocol is present, the URL is returned unchanged so the sanitizer can block it. Only truly protocol-less strings (e.g. `"voltsafe.com"`) get `https://` prepended.

**Why:** Previous implementation only checked for `https?://`, `mailto:`, `tel:`. Anything else — including `javascript:` — got `https://` prepended, turning `javascript:alert(1)` into `https://javascript:alert(1)`, which then slipped past the protocol allowlist check.

## Nested-link attack pattern
`<a href="https://ok.com"><a href="javascript:evil()">label</a></a>` — the lazy regex in pass 1 matches the outer anchor first. The inner `<a href="javascript:...">` is captured as the label and rebuilt into the output. Pass 1 alone cannot block this. The attribute-level strip in step 5b is required as a final safety net.

**How to apply:** Any new HTML sanitization path that rebuilds anchors must include both steps or risk nested-link bypass.

## Tests
`tests/composer-rich-text-hardening.test.js` covers all three layers (41 tests). Must stay green after any future changes to `sanitizeEditorHtml` or `normalizeUrl`.
