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
    // DOMPurify's default URI regex already blocks javascript:, data:, and
    // vbscript: in URL attributes — leave it untouched.
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
