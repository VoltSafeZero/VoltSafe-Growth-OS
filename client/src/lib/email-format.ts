/**
 * email-format.ts — VoltSafe Mail outbound formatting utilities.
 *
 * Single source of truth for how emails are formatted before sending.
 * Used by every compose/reply/forward/follow-up send path.
 *
 * Two main exports:
 *   buildEmailHtml(text, appendHtml?)  — editor text → styled HTML for sending
 *   htmlToEditorText(html)             — clipboard HTML → editor markdown text (browser only)
 */

const BODY_STYLE =
  "font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111111;" +
  "line-height:1.6;margin-bottom:24px;";

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Convert editor plain text (with markdown-style markers inserted by the
 * format toolbar) into VoltSafe-styled HTML ready for Gmail.
 *
 * Handles:
 *   **bold**  →  <b>bold</b>
 *   *italic*  →  <i>italic</i>
 *   <u>…</u>  →  <u>…</u>   (format toolbar inserts these directly)
 *   ~~text~~  →  <s>text</s>
 *   [label](url)  →  <a href="url">label</a>
 *   - item / * item  →  <ul><li>…</li></ul>
 *   1. item          →  <ol><li>…</li></ol>
 *   blank lines  →  visual spacing
 *   all other text   →  escaped + <br/> separated
 *
 * @param text      Plain text from the composer textarea
 * @param appendHtml  Optional raw HTML appended after the body block
 *                    (e.g. signature + quoted-message block)
 */
export function buildEmailHtml(text: string, appendHtml = ""): string {
  const body = markdownToHtml(text);
  return `<div style="${BODY_STYLE}">${body}</div>${appendHtml}`;
}

/**
 * Convert clipboard HTML to editor-native plain text with markdown markers.
 * Called by the onPaste handler so pasted content immediately matches the
 * surrounding typed text.
 *
 * Runs in the browser — uses DOMParser.
 *
 * Preserved structure:
 *   bold / strong → **text**
 *   italic / em   → *text*
 *   underline     → <u>text</u>   (format toolbar native)
 *   ordered list  → 1. 2. 3. prefixes
 *   unordered list → - prefixes
 *   links         → [label](url)
 *   paragraphs / divs / headings → separated by \n
 *
 * Stripped:
 *   all inline styles, font-family, font-size, color, background-color,
 *   class attributes, Word/Google Docs markup, nested spans, tables (text only).
 */
export function htmlToEditorText(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const raw = nodeToText(doc.body).replace(/\n{3,}/g, "\n\n").trim();
  return raw;
}

// ── Internal: editor text → HTML ─────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Apply inline markdown markers on an already HTML-escaped line.
 * Order matters: links → restore <u> → bold → italic → strikethrough.
 */
function inlineMarkdown(escaped: string): string {
  let out = escaped;

  // 1. Markdown links [label](url) — must run before bold/italic so nested
  //    *'s inside link labels don't confuse the bold/italic regex.
  out = out.replace(
    /\[([^\]]*)\]\((https?:\/\/[^)]*)\)/g,
    (_, label, url) => `<a href="${url}" style="color:#00C1DE;">${label}</a>`,
  );

  // 2. Restore <u>…</u> that the format toolbar inserted as literal text.
  //    After escapeHtml they look like &lt;u&gt;…&lt;/u&gt;.
  out = out.replace(/&lt;u&gt;(.*?)&lt;\/u&gt;/g, "<u>$1</u>");

  // 3. Bold: **text** (non-greedy, must not start/end with space)
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, "<b>$1</b>");

  // 4. Italic: *text* — only after bold so ** isn't consumed as two *
  out = out.replace(/(?<!\*)\*(?!\*)([^*\n]+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");

  // 5. Strikethrough: ~~text~~
  out = out.replace(/~~([^~\n]+?)~~/g, "<s>$1</s>");

  return out;
}

function markdownToHtml(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];

    // ── Unordered list block ────────────────────────────────────────────────
    if (/^[-*+]\s+/.test(raw)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
        const content = lines[i].replace(/^[-*+]\s+/, "");
        items.push(inlineMarkdown(escapeHtml(content)));
        i++;
      }
      result.push(
        `<ul style="margin:4px 0;padding-left:24px;">${items.map((t) => `<li>${t}</li>`).join("")}</ul>`,
      );
      continue;
    }

    // ── Ordered list block ──────────────────────────────────────────────────
    if (/^\d+\.\s+/.test(raw)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        const content = lines[i].replace(/^\d+\.\s+/, "");
        items.push(inlineMarkdown(escapeHtml(content)));
        i++;
      }
      result.push(
        `<ol style="margin:4px 0;padding-left:24px;">${items.map((t) => `<li>${t}</li>`).join("")}</ol>`,
      );
      continue;
    }

    // ── Blank line → spacer ─────────────────────────────────────────────────
    if (raw.trim() === "") {
      result.push("<br/>");
      i++;
      continue;
    }

    // ── Regular text line ───────────────────────────────────────────────────
    result.push(inlineMarkdown(escapeHtml(raw)) + "<br/>");
    i++;
  }

  // Remove trailing <br/> spacers
  while (result.length > 0 && result[result.length - 1] === "<br/>") {
    result.pop();
  }

  return result.join("");
}

// ── Internal: HTML → editor text (browser only) ───────────────────────────────

function nodeToText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  // Skip non-content elements
  if (tag === "style" || tag === "script" || tag === "head" || tag === "meta") return "";

  // Tracking pixels and decorative images — skip entirely
  if (tag === "img") {
    const alt = (el.getAttribute("alt") ?? "").trim();
    const src = el.getAttribute("src") ?? "";
    // Skip 1×1 tracking pixels
    if (el.getAttribute("width") === "1" || el.getAttribute("height") === "1") return "";
    if (src.includes("tracking") || src.includes("pixel") || src.includes("open.php")) return "";
    return alt ? `[image: ${alt}]` : "";
  }

  const childText = () => Array.from(el.childNodes).map(nodeToText).join("");

  switch (tag) {
    case "br":
      return "\n";

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

    // Divs: only add a newline when they enclose block-level content
    case "div": {
      const inner = childText();
      // If the inner content already ends with a newline, don't double it
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

    case "u": {
      const inner = childText().trim();
      return inner ? `<u>${inner}</u>` : "";
    }

    case "s":
    case "del":
    case "strike": {
      const inner = childText().trim();
      return inner ? `~~${inner}~~` : "";
    }

    case "a": {
      const href = el.getAttribute("href") ?? "";
      const inner = childText().trim();
      // Skip mailto/tel/anchor links — just show the label
      if (!href || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("#")) {
        return inner;
      }
      return `[${inner || href}](${href})`;
    }

    // List items: content only (parent ul/ol adds the prefix)
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

    // Tables: collapse to text rows
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

    // Spans and other inline wrappers: just return children (strip all styling)
    default:
      return childText();
  }
}
