/**
 * email-format.ts — VoltSafe Mail outbound formatting utilities.
 *
 * Single source of truth for how emails are formatted before sending.
 * Used by every compose/reply/forward/follow-up send path.
 *
 * Primary exports (rich-text editor path):
 *   buildEmailHtml(html, appendHtml?)  — sanitize editor HTML + wrap for Gmail
 *   htmlToCleanHtml(html)              — normalize pasted HTML for the editor (browser)
 *   normalizeUrl(url)                  — ensure a URL has a protocol prefix
 *
 * Legacy export (still used by paste-normalizer layer 2 tests):
 *   htmlToEditorText(html)             — clipboard HTML → plain text (browser only)
 */

import { VOLTSAFE_BODY_STYLE, VOLTSAFE_LINK_COLOR } from "@shared/email-style";

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Normalize a user-entered URL to include a protocol.
 *   "voltsafe.com"          → "https://voltsafe.com"
 *   "https://voltsafe.com"  → "https://voltsafe.com" (unchanged)
 */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (
    /^https?:\/\//i.test(trimmed) ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("tel:")
  ) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

/**
 * Sanitize and wrap rich-text HTML from the contenteditable editor for Gmail.
 *
 * The editor produces native browser HTML (bold, italic, links, lists, etc.).
 * This function:
 *   1. Strips browser-injected inline styles and class attributes
 *   2. Unwraps bare <span> tags added by execCommand
 *   3. Normalizes link attributes (target, rel, VoltSafe link colour)
 *   4. Converts Chrome's <div>-per-line structure to <br> line breaks
 *   5. Wraps the result in the VoltSafe body style div
 *
 * Regex-based so it works in both browser and Node.js (tests).
 *
 * @param html       HTML string from the contenteditable editor
 * @param appendHtml Optional raw HTML appended after the body block
 *                   (e.g. signature + quoted-message block)
 */
export function buildEmailHtml(html: string, appendHtml = ""): string {
  const body = sanitizeEditorHtml(html);
  return `<div style="${VOLTSAFE_BODY_STYLE}">${body}</div>${appendHtml}`;
}

/**
 * Normalize pasted HTML for insertion into the rich-text editor.
 * Strips external fonts / colours / sizes while preserving semantic structure
 * (bold, italic, underline, links, lists, paragraphs).
 *
 * Returns clean HTML suitable for `document.execCommand("insertHTML", …)`.
 * Browser-only — uses DOMParser.
 */
export function htmlToCleanHtml(html: string): string {
  if (typeof DOMParser === "undefined") return "";
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  // Trim trailing <br> produced by block→br conversion at the root level
  const raw = nodeToCleanHtml(doc.body);
  return raw.replace(/(<br\s*\/?>\s*)+$/i, "").trim();
}

/**
 * Legacy: convert clipboard HTML to plain text with markdown markers.
 * Kept for backward compatibility (paste-normalizer tests, inbox-snippets).
 * Browser-only — uses DOMParser.
 */
export function htmlToEditorText(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const raw = nodeToText(doc.body).replace(/\n{3,}/g, "\n\n").trim();
  return raw;
}

// ── sanitizeEditorHtml ────────────────────────────────────────────────────────

/**
 * Strip browser-added styling from editor HTML and normalise structure.
 * Handles the predictable flat HTML that Chrome's contenteditable produces.
 */
function sanitizeEditorHtml(html: string): string {
  if (!html) return "";

  let out = html;

  // 1. Strip all style= attributes (execCommand adds these, e.g. on lists)
  out = out.replace(/\s+style="[^"]*"/gi, "");

  // 2. Strip all class= attributes
  out = out.replace(/\s+class="[^"]*"/gi, "");

  // 3. Strip data-* attributes
  out = out.replace(/\s+data-[a-z][a-z0-9-]*="[^"]*"/gi, "");

  // 4. Unwrap bare <span> tags — execCommand may inject these when formatting
  out = out.replace(/<span>([\s\S]*?)<\/span>/gi, "$1");

  // 5. Rebuild <a> tags with proper attributes and VoltSafe link colour.
  //    Match href first, handle any extra attributes before/after.
  out = out.replace(
    /<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_, href, label) => {
      const safe = href.replace(/"/g, "&quot;");
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer" style="color:${VOLTSAFE_LINK_COLOR};">${label}</a>`;
    },
  );

  // 6. Empty paragraph: <div><br[/]></div> → <br>
  out = out.replace(/<div>\s*<br\s*\/?>\s*<\/div>/gi, "<br>");

  // 7. Non-empty Chrome line-divs: process inner-to-outer so nested divs are
  //    handled correctly. Each pass replaces a <div> whose content has no
  //    further <div> tags (innermost first).
  let prev = "";
  while (out !== prev) {
    prev = out;
    // Match a <div> that contains no nested <div>
    out = out.replace(/<div>((?:(?!<\/?div)[\s\S])*?)<\/div>/gi, "$1<br>");
  }

  // 8. Strip trailing <br> / whitespace
  out = out.replace(/(<br\s*\/?>\s*)+$/i, "");

  // 9. Collapse 3+ consecutive <br> to a double break
  out = out.replace(/(<br\s*\/?>\s*){3,}/gi, "<br><br>");

  return out.trim();
}

// ── nodeToCleanHtml ───────────────────────────────────────────────────────────
// Used by htmlToCleanHtml (paste normalisation for contenteditable).

function nodeToCleanHtml(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node.textContent ?? "";
    return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (tag === "style" || tag === "script" || tag === "head" || tag === "meta") return "";

  const childHtml = () => Array.from(el.childNodes).map(nodeToCleanHtml).join("");

  switch (tag) {
    case "b":
    case "strong":
      return `<b>${childHtml()}</b>`;
    case "i":
    case "em":
      return `<i>${childHtml()}</i>`;
    case "u":
      return `<u>${childHtml()}</u>`;
    case "s":
    case "del":
    case "strike":
      return `<s>${childHtml()}</s>`;
    case "br":
      return "<br>";
    case "p":
    case "div": {
      const inner = childHtml();
      if (!inner.trim() || inner === "<br>") return "<br>";
      return inner.endsWith("<br>") ? inner : inner + "<br>";
    }
    case "ul":
      return `<ul>${childHtml()}</ul>`;
    case "ol":
      return `<ol>${childHtml()}</ol>`;
    case "li":
      return `<li>${childHtml()}</li>`;
    case "a": {
      const href = el.getAttribute("href") ?? "";
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) {
        return childHtml();
      }
      const safe = href.replace(/"/g, "&quot;");
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer" style="color:${VOLTSAFE_LINK_COLOR};">${childHtml()}</a>`;
    }
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return `<b>${childHtml()}</b><br>`;
    case "img": {
      const alt = (el.getAttribute("alt") ?? "").trim();
      if (el.getAttribute("width") === "1" || el.getAttribute("height") === "1") return "";
      return alt ? `[image: ${alt}]` : "";
    }
    default:
      return childHtml();
  }
}

// ── nodeToText ────────────────────────────────────────────────────────────────
// Legacy — used by htmlToEditorText (kept for paste-normalizer layer 2 tests).

function nodeToText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (tag === "style" || tag === "script" || tag === "head" || tag === "meta") return "";

  if (tag === "img") {
    const alt = (el.getAttribute("alt") ?? "").trim();
    const src = el.getAttribute("src") ?? "";
    if (el.getAttribute("width") === "1" || el.getAttribute("height") === "1") return "";
    if (src.includes("tracking") || src.includes("pixel") || src.includes("open.php")) return "";
    return alt ? `[image: ${alt}]` : "";
  }

  const childText = () => Array.from(el.childNodes).map(nodeToText).join("");

  switch (tag) {
    case "br":
      return " ";
    case "p":
    case "section":
    case "article":
    case "main":
    case "header":
    case "footer":
    case "blockquote": {
      const inner = childText().trim();
      return inner ? inner + "\n" : "\n";
    }
    case "div": {
      const inner = childText();
      if (!inner.trim()) return "";
      return inner.endsWith("\n") ? inner : inner + "\n";
    }
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return childText().trim() + "\n";
    case "b":
    case "strong": {
      const inner = childText().trim();
      return inner ? `**${inner}**` : "";
    }
    case "i":
    case "em": {
      const inner = childText().trim();
      return inner ? `*${inner}*` : "";
    }
    case "s":
    case "del":
    case "strike":
      return childText();
    case "u": {
      const inner = childText().trim();
      return inner ? `<u>${inner}</u>` : "";
    }
    case "a": {
      const href = el.getAttribute("href") ?? "";
      const inner = childText().trim();
      if (!href || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("#")) {
        return inner;
      }
      return `[${inner || href}](${href})`;
    }
    case "li":
      return childText().trim();
    case "ul": {
      const items = Array.from(el.querySelectorAll(":scope > li"));
      if (!items.length) return childText();
      return items.map((li) => `- ${nodeToText(li).trim()}`).join("\n") + "\n";
    }
    case "ol": {
      const items = Array.from(el.querySelectorAll(":scope > li"));
      if (!items.length) return childText();
      return items.map((li, idx) => `${idx + 1}. ${nodeToText(li).trim()}`).join("\n") + "\n";
    }
    case "table": {
      const rows = Array.from(el.querySelectorAll("tr"));
      return (
        rows
          .map((row) => {
            const cells = Array.from(row.querySelectorAll("td,th")).map((c) =>
              nodeToText(c).trim(),
            );
            return cells.join(" | ");
          })
          .filter(Boolean)
          .join("\n") + "\n"
      );
    }
    case "tr":
    case "td":
    case "th":
      return childText();
    case "pre":
    case "code":
      return childText();
    case "hr":
      return "\n---\n";
    default:
      return childText();
  }
}
