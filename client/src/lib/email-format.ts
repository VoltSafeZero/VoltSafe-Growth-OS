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

// Email-safe paragraph style used for every body paragraph in outbound mail.
// margin-bottom provides consistent paragraph spacing across Gmail, Outlook,
// Apple Mail, Spark, and mobile clients without relying on <br><br> chains
// (which Gmail can collapse or misinterpret, causing bold to "leak").
const EMAIL_P_STYLE = "margin:0 0 16px 0;line-height:1.6;";

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Normalize a user-entered URL to include a protocol.
 *   "voltsafe.com"          → "https://voltsafe.com"
 *   "https://voltsafe.com"  → "https://voltsafe.com" (unchanged)
 */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  // If the URL already carries any protocol (http:, https:, mailto:, tel:,
  // javascript:, data:, etc.) leave it unchanged so the href sanitizer in
  // sanitizeEditorHtml / nodeToCleanHtml can decide whether to allow or block it.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

/**
 * Returns true when the editor HTML is functionally empty (blank, `<br>`,
 * `<div><br></div>`, etc.). Used to decide placeholder visibility and
 * disabled states without being fooled by Chrome's empty-div artifacts.
 */
export function isBodyEmpty(html: string | undefined): boolean {
  if (!html) return true;
  const stripped = html
    .replace(/<br\s*\/?>/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim();
  return stripped === "";
}

/**
 * Strip the VoltSafe body wrapper (and any appended signature/quoted-block)
 * from a full outbound email HTML string so the editor only shows the user's
 * own content. Used when seeding the contenteditable from a saved draft.
 *
 * Returns the original string unchanged if it doesn't match the wrapper
 * pattern (e.g. raw editor HTML from a fresh compose session).
 *
 * Browser-only — uses DOMParser.
 */
export function stripEmailWrapper(html: string): string {
  if (!html) return "";
  if (typeof DOMParser === "undefined") return html;
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const first = doc.body.firstElementChild;
    if (
      first &&
      first.tagName === "DIV" &&
      /font-family\s*:\s*Arial/i.test(first.getAttribute("style") ?? "")
    ) {
      return first.innerHTML;
    }
  } catch {
    // Fallback: return as-is
  }
  return html;
}

/**
 * Convert plain text (with \n line breaks) to safe HTML for insertion into
 * the rich-text editor. Escapes &, <, > and converts newlines to <br>.
 * Used when inserting snippets or Zoom links that originate as plain text.
 */
export function plainTextToHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n\n+/g, "<br><br>")
    .replace(/\n/g, "<br>");
}

/**
 * Sanitize and wrap rich-text HTML from the contenteditable editor for Gmail.
 *
 * The editor produces native browser HTML (bold, italic, links, lists, etc.).
 * This function:
 *   1. Strips browser-injected inline styles and class attributes
 *   2. Unwraps bare <span> tags added by execCommand
 *   3. Normalizes link attributes (target, rel, VoltSafe link colour)
 *   4. Converts Chrome's <div>/<p>-per-line structure to <p> paragraph blocks
 *      with explicit email-safe inline styles — prevents bold/italic/underline
 *      from leaking across paragraph boundaries in Gmail, Outlook, Apple Mail,
 *      Spark, and mobile clients
 *   5. Closes any still-open inline formatting tags at paragraph boundaries
 *   6. Wraps the result in the VoltSafe body style div
 *
 * Regex-based so it works in both browser and Node.js (tests).
 *
 * @param html       HTML string from the contenteditable editor
 * @param appendHtml Optional raw HTML appended after the body block
 *                   (e.g. signature + quoted-message block)
 */
export function buildEmailHtml(html: string, appendHtml = ""): string {
  const body = sanitizeEditorHtml(html);
  const sigSection = appendHtml
    ? `<!--vs-sig-start-->${appendHtml}<!--vs-sig-end-->`
    : "";
  return `<div style="${VOLTSAFE_BODY_STYLE}">${body}</div>${sigSection}`;
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

// ── Link-preview block extraction ────────────────────────────────────────────
//
// Link-preview cards are rendered as <table data-link-preview="url" …> with
// inline styles and a nested-table image layout.  The sanitizeEditorHtml
// function strips ALL style= attributes and collapses <div> blocks into <br>
// tags — both of which would destroy the card.
//
// Solution: extract preview-card blocks BEFORE sanitisation, replace them
// with null-byte sentinel tokens (safe — never present in HTML), run the
// normal sanitisation on the remaining HTML, then re-insert the preserved
// blocks (with only their href attributes checked for safe protocols).

const PREVIEW_TOKEN_RE = /\x00LPREVIEW(\d+)\x00/g;

/**
 * Walk `html` and extract every top-level <table data-link-preview="…"> …
 * </table> block (including its nested inner tables), replacing each with a
 * unique sentinel token.  Returns the modified string and the extracted blocks.
 *
 * Uses a depth-counter walk rather than a regex so nested <table> tags are
 * counted correctly.
 */
function extractPreviewBlocks(html: string): { out: string; blocks: string[] } {
  const blocks: string[] = [];
  let out = html;
  let guard = 0;

  while (guard++ < 100) {
    // Locate the start of the next preview-marked outer table.
    const startMatch = /<table\b[^>]*\bdata-link-preview(?:=["'][^"']*["']|\b)[^>]*>/i.exec(out);
    if (!startMatch) break;

    const startIdx = startMatch.index;
    let depth = 0;
    let i = startIdx;

    // Walk characters, counting <table …> and </table> to find the matching
    // closing tag for the outermost element.
    while (i < out.length) {
      if (/^<table\b/i.test(out.slice(i))) {
        depth++;
        // Skip to end of this opening tag.
        const gt = out.indexOf(">", i);
        i = gt === -1 ? out.length : gt + 1;
      } else if (/^<\/table/i.test(out.slice(i))) {
        depth--;
        const gt = out.indexOf(">", i);
        i = gt === -1 ? out.length : gt + 1;
        if (depth === 0) break;
      } else {
        i++;
      }
    }

    if (depth !== 0) break; // Unbalanced HTML — bail to avoid infinite loop.

    const block = out.slice(startIdx, i);
    const token = `\x00LPREVIEW${blocks.length}\x00`;
    blocks.push(block);
    out = out.slice(0, startIdx) + token + out.slice(i);
  }

  return { out, blocks };
}

// ── sanitizeEditorHtml helpers ────────────────────────────────────────────────

/**
 * Close any still-open inline formatting tags at double-<br> paragraph
 * boundaries, and at the end of the string, so bold/italic/underline never
 * bleeds into the next paragraph in Gmail or other clients.
 *
 * Chrome's contentEditable can produce <b> openers inside one <div> that are
 * closed inside a different <div>. After div-collapsing both become part of a
 * flat <br>-chain, leaving the <b> spanning across what should be a paragraph
 * boundary. Gmail in particular does not reset inline formatting at <br> tags,
 * so the bold "leaks" into every subsequent line until a real block boundary.
 *
 * This function inserts the missing closing tags before each double-<br> and
 * re-opens them after so the formatting intent (bold this phrase) is preserved
 * without leaking into the next paragraph.
 *
 * Regex-based / works in Node.js.
 */
function closeInlineTagsAtBoundaries(html: string): string {
  const OPEN_RE = /^<(b|strong|i|em|u|s)>/i;
  const CLOSE_RE = /^<\/(b|strong|i|em|u|s)>/i;
  // Two consecutive <br> = paragraph separator (optional whitespace between)
  const DBL_BR_RE = /^(<br\s*\/?>)(\s*)(<br\s*\/?>)/i;

  const stack: string[] = [];
  let result = "";
  let i = 0;

  while (i < html.length) {
    // Check for double-<br> paragraph boundary
    const dblBr = DBL_BR_RE.exec(html.slice(i));
    if (dblBr) {
      // Close all open inline tags (reverse order = proper LIFO close)
      for (let j = stack.length - 1; j >= 0; j--) {
        result += `</${stack[j]}>`;
      }
      result += dblBr[0]; // the two <br> (including any whitespace between)
      i += dblBr[0].length;
      // Re-open the same inline tags (in original order)
      for (const t of stack) result += `<${t}>`;
      continue;
    }

    // Opening inline tag
    const open = OPEN_RE.exec(html.slice(i));
    if (open) {
      stack.push(open[1].toLowerCase());
      result += open[0];
      i += open[0].length;
      continue;
    }

    // Closing inline tag — pop from stack
    const close = CLOSE_RE.exec(html.slice(i));
    if (close) {
      const tag = close[1].toLowerCase();
      const idx = stack.lastIndexOf(tag);
      if (idx !== -1) stack.splice(idx, 1);
      result += close[0];
      i += close[0].length;
      continue;
    }

    result += html[i];
    i++;
  }

  // Close any unclosed inline tags at end of the string
  for (let j = stack.length - 1; j >= 0; j--) {
    result += `</${stack[j]}>`;
  }

  return result;
}

/**
 * Convert a flat <br>-chain into email-safe <p> paragraph blocks.
 *
 * Using <p> block elements guarantees each paragraph is visually independent
 * regardless of inline formatting state.  A <p> boundary resets rendering
 * context in every major email client — Gmail, Outlook, Apple Mail, Spark,
 * and mobile clients all treat <p> as a hard paragraph reset, so bold/italic
 * that opens in one <p> cannot bleed into the next one.
 *
 * Rules:
 *  • Double-<br> (paragraph separator) → paragraph break between <p> blocks
 *  • Single <br> within a chunk → preserved as a soft line break inside <p>
 *  • Chunks that are or start with a block element (<ul>,<ol>) → emitted as-is
 *    (wrapping <ul>/<ol> inside <p> is invalid HTML and breaks email clients)
 *  • Empty / whitespace-only chunks → dropped (paragraph margin handles spacing)
 *  • Trailing <br> at the end of each chunk is stripped (prevents double-spacing
 *    inside the <p>)
 *
 * Regex-based / works in Node.js.
 */
function convertBrChainToParagraphs(html: string): string {
  // Normalise 3+ consecutive <br> → exactly two (one paragraph boundary)
  html = html.replace(/(<br\s*\/?>[\s]*){3,}/gi, "<br><br>");

  // Split on paragraph boundary: two consecutive <br> (with optional whitespace)
  const chunks = html.split(/(?:<br\s*\/?>)\s*(?:<br\s*\/?>)/i);

  const parts: string[] = [];
  for (const chunk of chunks) {
    // Strip leading/trailing whitespace and trailing <br>
    const trimmed = chunk.replace(/(<br\s*\/?>)+$/i, "").trim();
    if (!trimmed) continue;

    // Block elements (<ul>, <ol>, <table>) must NOT be wrapped in <p> —
    // that is invalid HTML and some clients refuse to render it correctly.
    if (/^<(?:ul|ol|table)\b/i.test(trimmed)) {
      parts.push(trimmed);
    } else {
      parts.push(`<p style="${EMAIL_P_STYLE}">${trimmed}</p>`);
    }
  }

  return parts.join("");
}

// ── sanitizeEditorHtml ────────────────────────────────────────────────────────

/**
 * Strip browser-added styling from editor HTML and normalise structure for
 * email delivery. Handles the predictable flat HTML that Chrome's
 * contenteditable produces, plus <p>-based HTML reloaded from saved drafts.
 *
 * Link-preview card blocks (<table data-link-preview="…">) are extracted
 * before sanitisation and re-inserted afterwards so their inline styles and
 * table structure are preserved in both the editor and outbound email.
 *
 * Output: email-safe <p> blocks with explicit margin/line-height styles so
 * bold/italic/underline formatting can never leak across paragraph boundaries
 * in Gmail, Outlook, Apple Mail, Spark, or mobile clients.
 */
function sanitizeEditorHtml(html: string): string {
  if (!html) return "";

  // Pre-pass: extract link-preview blocks to protect them from the style-
  // stripping and div-collapsing passes below.
  const { out: extracted, blocks: previewBlocks } = extractPreviewBlocks(html);
  let out = extracted;

  // 1. Strip all style= attributes (execCommand adds these, e.g. on lists)
  out = out.replace(/\s+style="[^"]*"/gi, "");
  out = out.replace(/\s+style='[^']*'/gi, "");

  // 2. Strip all class= attributes
  out = out.replace(/\s+class="[^"]*"/gi, "");
  out = out.replace(/\s+class='[^']*'/gi, "");

  // 3. Strip data-* attributes (preserve data-vs-cta-id used for body CTA tracking)
  out = out.replace(/\s+data-(?!vs-cta-id=)[a-z][a-z0-9-]*="[^"]*"/gi, "");

  // 4. Unwrap bare <span> tags — execCommand may inject these when formatting
  out = out.replace(/<span>([\s\S]*?)<\/span>/gi, "$1");

  // 5. Rebuild <a> tags with proper attributes and VoltSafe link colour.
  //    SECURITY: only allow safe protocols — strip javascript:, data:, vbscript:, etc.
  //    NOTE: data-vs-cta-id is preserved because it is needed for body-CTA click-tracking.
  out = out.replace(
    /<a\b([^>]*)\bhref="([^"]*)"([^>]*)>([\s\S]*?)<\/a>/gi,
    (_full, pre, href, post, label) => {
      const safe = href.replace(/"/g, "&quot;").trim();
      // Block non-safe protocols (XSS guard)
      if (safe && !/^(https?:|mailto:|tel:|\/[^/]|#)/i.test(safe)) {
        return label; // strip anchor, keep visible text
      }
      // Preserve data-vs-cta-id if present (body CTA tracking marker)
      const allAttrs = pre + " " + post;
      const ctaIdMatch = /data-vs-cta-id="(\d+)"/.exec(allAttrs);
      const ctaAttr = ctaIdMatch ? ` data-vs-cta-id="${ctaIdMatch[1]}"` : "";
      return `<a href="${safe}"${ctaAttr} target="_blank" rel="noopener noreferrer" style="color:${VOLTSAFE_LINK_COLOR};">${label}</a>`;
    },
  );

  // 5b. Final XSS safety net: strip any remaining href="javascript:…" / "data:…" /
  //     "vbscript:…" attributes that survived the first anchor-rebuild pass.
  out = out.replace(/\bhref="(?:javascript|vbscript|data):[^"]*"/gi, "");

  // 6. Collapse empty block elements (div or p with only whitespace/br) to a
  //    double-<br> paragraph separator.  Chrome produces <div><br></div> for
  //    blank lines; saved drafts may have <p style="..."></p> or similar.
  out = out.replace(/<(?:div|p)\b[^>]*>\s*<br\s*\/?>\s*<\/(?:div|p)>/gi, "<br><br>");
  out = out.replace(/<(?:div|p)\b[^>]*>\s*<\/(?:div|p)>/gi, "");

  // 7. Non-empty block elements (div, p): process inner-to-outer so nested
  //    elements are handled correctly before their parents.  Each pass replaces
  //    the innermost <div> or <p> that contains no further block tags with its
  //    content followed by <br> (soft line break within the flat chain).
  let prev = "";
  while (out !== prev) {
    prev = out;
    out = out.replace(
      /<(?:div|p)\b[^>]*>((?:(?!<\/?\s*(?:div|p)\b)[\s\S])*?)<\/(?:div|p)>/gi,
      "$1<br>",
    );
  }

  // 8. Repair: close inline formatting tags (b, strong, i, em, u, s) at every
  //    double-<br> paragraph boundary so they never bleed into the next
  //    paragraph in Gmail or other clients that don't reset inline formatting
  //    at <br> tags.  Also closes any unclosed tags at the end of the string.
  out = closeInlineTagsAtBoundaries(out);

  // 9. Convert the flat <br>-chain to email-safe <p> paragraph blocks.
  //    Block-level elements (<p>) prevent Gmail from extending bold/italic
  //    across paragraph boundaries regardless of inline tag state.
  out = convertBrChainToParagraphs(out);

  // Post-pass: re-insert the link-preview blocks.  Apply a narrow href-safety
  // check inside each block so we never re-insert a javascript: href.
  if (previewBlocks.length > 0) {
    out = out.replace(PREVIEW_TOKEN_RE, (_m, idx) => {
      const block = previewBlocks[Number(idx)] ?? "";
      // Strip any non-https? hrefs inside the preview block as a safety net.
      return block.replace(
        /\bhref="([^"]*)"/gi,
        (_tag, href) => {
          const safe = href.trim();
          if (!safe || !/^https?:/i.test(safe)) return 'href="#"';
          return `href="${safe.replace(/"/g, "&quot;")}"`;
        },
      );
    });
  }

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
      // SECURITY: only allow safe protocols — strip javascript:, data:, vbscript:, etc.
      if (!href || !/^(https?:|mailto:|tel:|\/[^/]|#)/i.test(href.trim())) {
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
