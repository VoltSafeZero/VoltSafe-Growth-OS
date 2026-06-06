import DOMPurify from "dompurify";

/**
 * Centralised HTML sanitisation for any user/3rd-party HTML the app renders.
 *
 * Two surfaces are supported:
 *   - sanitizeEmailHtml(html): for content rendered inside a *sandboxed* iframe
 *     srcDoc (the Gmail/email reader). Slightly looser because <style> tags
 *     are scoped to the iframe document and cannot affect the parent app.
 *   - sanitizeRichText(html): for content rendered inline in the main app DOM
 *     (Confluence pages, etc.). Stricter — <style> is forbidden because it
 *     would otherwise leak into the parent's CSS scope.
 *
 * Plus a script-execution-free plain-text extractor (htmlToPlainText) that
 * uses DOMParser instead of innerHTML (DOMParser per spec does not execute
 * scripts and does not fire <img onerror> / <body onload> handlers).
 *
 * All anchors get target="_blank" rel="noopener noreferrer nofollow" via a
 * single global hook — installed once on first use.
 */

let hookInstalled = false;
function ensureAnchorHook() {
  if (hookInstalled) return;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    // Only HTMLAnchorElement-shaped nodes need rewriting.
    if (node.nodeName === "A" && node instanceof HTMLAnchorElement) {
      node.setAttribute("target", "_blank");
      // noopener: drop window.opener handle to the destination.
      // noreferrer: also no Referer header.
      // nofollow: don't lend SEO weight to attacker-controlled emails.
      node.setAttribute("rel", "noopener noreferrer nofollow");
    }
  });
  hookInstalled = true;
}
ensureAnchorHook();

// Tags whose presence in untrusted HTML enables phishing UI (forms),
// frame-busting / clickjacking (iframe/object/embed), or document-level
// hijacking (meta/link/base). Forbidden in BOTH profiles.
const FORBID_TAGS_BASE = [
  "form", "input", "button", "select", "textarea",
  "iframe", "object", "embed",
  "meta", "link", "base",
];

// Attributes that can re-open script-execution or alter form targets even
// when scripts are otherwise neutered.
const FORBID_ATTR_BASE = [
  "srcdoc", "sandbox", "formaction", "action",
  "ping", "background", "autofocus",
];

/**
 * URI allowlist for email bodies.
 *
 * Extends DOMPurify's default pattern to additionally allow
 * `data:image/(png|jpeg|jpg|gif|webp|svg+xml)` URIs that the send pipeline
 * inlines as base64.  All other `data:` schemes (data:text/html, etc.) remain
 * blocked — only the image subtypes listed here pass through.
 *
 * Default (from DOMPurify source):
 *   /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
 */
const EMAIL_ALLOWED_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp):|data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml)[;,]|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

/** For email body rendered inside a sandboxed iframe srcDoc. */
export function sanitizeEmailHtml(html: string): string {
  if (!html) return "";
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: FORBID_TAGS_BASE,
    FORBID_ATTR: FORBID_ATTR_BASE,
    // Email layout depends heavily on inline `style` *attributes* — those
    // remain allowed by the html profile. We only strip <style> *tags*?
    // No — inline <style> tags are SAFE in this case because the iframe's
    // CSS scope is its own document. Keep them so newsletter rendering
    // doesn't degrade.
    ADD_ATTR: ["target", "rel"],
    ALLOW_DATA_ATTR: false,
    // Allow data:image/... URIs so signature/CTA images inlined as base64
    // survive the sanitizer.  All other data: schemes remain blocked.
    ALLOWED_URI_REGEXP: EMAIL_ALLOWED_URI_REGEXP,
  });
}

/** For rich text rendered INLINE in the main app DOM (Confluence, etc.). */
export function sanitizeRichText(html: string): string {
  if (!html) return "";
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    // Stricter: forbid <style> tag too, otherwise an attacker-controlled
    // Confluence page could inject CSS that overrides the app's chrome.
    FORBID_TAGS: [...FORBID_TAGS_BASE, "style"],
    FORBID_ATTR: FORBID_ATTR_BASE,
    ADD_ATTR: ["target", "rel"],
    ALLOW_DATA_ATTR: false,
  });
}

/**
 * HTML-attribute / text-content escaper for the rare cases where the app must
 * inject user-controlled values into a template-literal HTML string (e.g. a
 * Leaflet popup's `bindPopup(htmlString)`, where the third-party library
 * insists on an HTML string rather than a DOM node).
 *
 * Prefer building DOM nodes with document.createElement + textContent whenever
 * possible — that path requires no escaping. Use escapeHtml only when a string
 * sink is forced on you by the API.
 *
 * Escapes the five HTML-significant characters plus the forward slash (defends
 * against premature tag-context exit on broken input).
 */
export function escapeHtml(input: unknown): string {
  if (input === null || input === undefined) return "";
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\//g, "&#x2F;");
}

/**
 * Convert a plain-text email body into safe, presentation-grade HTML so that
 * the same sandboxed-iframe reader that renders text/html emails can also
 * render text/plain ones.
 *
 * Why this exists:
 *   Gmail's API returns either text/plain or text/html (or both) for a given
 *   message. For emails that arrive plain-text-only — or whose multipart
 *   structure makes the HTML alternative unreachable — the previous reader
 *   dumped the raw text into a <pre> block. That made:
 *     - URLs unclickable and visually noisy ("<https://very-long...>")
 *     - Markdown-style asterisks render literally ("*Beki Kabanzira*"
 *       instead of "Beki Kabanzira" in bold)
 *     - Quoted reply chains a wall of "> > >" prefixes
 *     - Inline-image placeholders ("[image: https://example.com/]") just
 *       sit there as confusing dead text
 *
 * What this does (in order, each step assumes the previous output):
 *   1. HTML-escape every character first so user content can NEVER inject
 *      tags. Every subsequent step ONLY adds tags around already-escaped
 *      content.
 *   2. Replace `[image: …]` placeholders with a short muted "[image]" tag.
 *      The bracketed URL inside is the *source page* of the image (e.g. a
 *      company website), not the actual image file — there's nothing to
 *      render even if we tried.
 *   3. Linkify URLs wrapped in Gmail's RFC-3676 `<URL>` plain-text format
 *      (the screenshot's "<https://laincubator-dot-yamm-track.appspot.com/…>"
 *      case). The angle brackets are stripped from the visible text.
 *   4. Linkify bare http(s) URLs that aren't already inside an <a> tag.
 *      The look-behind class avoids re-wrapping URLs we just linked.
 *   5. Linkify bare email addresses as `mailto:` so a recipient address in
 *      a forwarded header is one click to compose.
 *   6. Markdown-style emphasis: `**bold**` then `*bold*` (Gmail signature
 *      style) then `_italic_`. Order matters — `**` must run first so it
 *      isn't half-eaten by the single-asterisk pass.
 *   7. Group consecutive lines starting with `>` (now `&gt;` after step 1)
 *      into a single <blockquote> with line breaks preserved. Mirrors how
 *      Gmail/Outlook render quoted reply chains visually instead of as raw
 *      "> > >" prefixes.
 *   8. Split into paragraphs on blank lines; preserve single newlines as
 *      <br>. Skips already-block-level <blockquote> chunks.
 *
 * Safety: the result is sanitised again by sanitizeEmailHtml() before it
 * reaches the iframe srcDoc — so a regression in any of the above can never
 * smuggle a <script>, <iframe>, javascript: URI, or onerror handler past
 * DOMPurify. This function's correctness only affects *visual* quality,
 * never security.
 */
export function plainTextToEmailHtml(text: string): string {
  if (!text) return "";

  // 1. Escape HTML special chars FIRST so user content cannot inject tags.
  let s = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  // 2. Tame [image: URL] placeholders — they're descriptions of where an
  //    inline image WAS in the HTML version, not real image URLs. Replace
  //    with a tiny muted marker so the line doesn't shift but the noise is
  //    gone.
  s = s.replace(
    /\[image:\s*[^\]]+\]/gi,
    '<span style="display:inline-block;padding:1px 6px;border-radius:4px;background:#eef2f7;color:#7d8590;font-size:11px;">[image]</span>',
  );

  // 3. Gmail's `<URL>` plain-text URL wrapping → clickable link with the
  //    angle brackets stripped from the visible text. We match `&lt;…&gt;`
  //    because step 1 already escaped the original `<…>`.
  s = s.replace(
    /&lt;(https?:\/\/[^\s&<>"']+)&gt;/gi,
    (_m, url) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${url}</a>`,
  );

  // 4. Bare http(s) URLs not already inside an <a href="…">. The look-behind
  //    class `[^"'>]` rejects URLs immediately preceded by `"` (inside an
  //    href attribute) or `>` (inside the visible text of an <a> we just
  //    created). The trailing-char class drops common sentence-ending
  //    punctuation so "see https://example.com." doesn't link the period.
  s = s.replace(
    /(^|[^"'>])((?:https?:\/\/)[^\s<>"']+[^\s<>"'.,;:!?)\]}])/gi,
    (_m, pre, url) =>
      `${pre}<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${url}</a>`,
  );

  // 5. Bare email addresses → mailto:. Same look-behind trick as URLs.
  s = s.replace(
    /(^|[^"'>])([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/g,
    (_m, pre, email) =>
      `${pre}<a href="mailto:${email}">${email}</a>`,
  );

  // 6. Markdown emphasis. **bold** first so the single-* pass doesn't eat it.
  //    Inner content forbids \n and `*` so we don't accidentally span across
  //    paragraphs or chew through asterisks inside a URL.
  s = s.replace(/\*\*([^\s*][^*\n]*?[^\s*]|[^\s*])\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^\s*][^*\n]*?[^\s*]|[^\s*])\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|\s)_([^\s_][^_\n]*?[^\s_]|[^\s_])_(?=\s|$|[.,;:!?)])/g, "$1<em>$2</em>");

  // 7. Quote lines: collapse runs of "&gt; " prefixes into a single
  //    <blockquote>. Multiple-level quotes (>>, >>>) all collapse into the
  //    same block — visual nesting of reply-of-reply-of-reply is rarely
  //    helpful in the reader and adds horizontal width pressure.
  const lines = s.split("\n");
  const out: string[] = [];
  let bqBuf: string[] = [];
  const flushBQ = () => {
    if (bqBuf.length === 0) return;
    out.push(
      `<blockquote>${bqBuf.join("<br>")}</blockquote>`,
    );
    bqBuf = [];
  };
  for (const line of lines) {
    const m = /^(\s*(?:&gt;\s?)+)(.*)$/.exec(line);
    if (m) {
      bqBuf.push(m[2]);
    } else {
      flushBQ();
      out.push(line);
    }
  }
  flushBQ();
  s = out.join("\n");

  // 8. Paragraph breaks on blank lines; single newlines → <br>. Already
  //    block-level <blockquote> chunks pass through untouched.
  const paragraphs = s
    .split(/\n{2,}/)
    .map((p) => {
      const trimmed = p.trim();
      if (!trimmed) return "";
      if (/^<blockquote>/.test(trimmed)) return trimmed;
      return `<p>${p.replace(/\n/g, "<br>")}</p>`;
    })
    .filter(Boolean);

  return paragraphs.join("\n");
}

/**
 * Extract visible text from HTML without ever assigning innerHTML.
 *
 * DOMParser.parseFromString(..., "text/html") creates an inert document:
 * per the HTML spec it must NOT execute <script>, must NOT fire
 * <img onerror>, must NOT fire <body onload>, etc. This avoids the
 * detached-div + innerHTML XSS gadget chain.
 */
export function htmlToPlainText(html: string): string {
  if (!html) return "";
  if (typeof DOMParser === "undefined") {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, head, noscript").forEach((n) => n.remove());
  doc.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
  doc.querySelectorAll("p, div, li, tr, h1, h2, h3, h4, blockquote").forEach((b) => b.append("\n"));
  return (doc.body?.textContent || "")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
