/**
 * email-html-normalizer.ts — Server-side safety net for outbound email HTML.
 *
 * Applied in POST /api/gmail/send, POST /api/gmail/drafts, and the booking
 * draft assistant path before handing the body to the Gmail API. This is the
 * last line of defence against mixed fonts, external color overrides,
 * Word/Docs junk, and AI-copied formatting leaking into recipients' inboxes.
 *
 * Uses a WHITELIST approach — all styling is stripped unless it belongs to
 * our known, controlled markup (the VoltSafe body wrapper, the signature
 * block, link colors, and our paragraph style).
 *
 * Safe preserved elements:
 *   <div style="font-family:Arial…">  — VoltSafe body wrapper
 *   <p style="margin:0 0 16px 0;…">  — VoltSafe paragraph blocks (body)
 *   <b>, <strong>, <i>, <em>, <u>, <s>  — semantic inline formatting
 *   <ul>, <ol>, <li>  — lists (with our margin/padding style preserved)
 *   <a href="…" style="color:#00C1DE;">  — links
 *   <br/>, <br>  — line breaks
 *   All signature-block elements (identified by presence of #787f84 or voltsafe.com)
 */

import {
  VOLTSAFE_BODY_STYLE,
  VOLTSAFE_FONT_FAMILY,
  VOLTSAFE_LINK_COLOR,
} from "@shared/email-style";

// The paragraph style produced by the client-side sanitizer.
// Must be kept in sync with EMAIL_P_STYLE in client/src/lib/email-format.ts.
const EMAIL_P_STYLE_FINGERPRINT = "margin:0 0 16px 0";

/**
 * Normalise outbound email HTML. Returns a sanitised version of `html` that:
 *   1. Strips Microsoft Word conditional comments, mso-* CSS, and o:p tags.
 *   2. Strips Google Docs class attributes (c0, c1, c2… pattern) and guid attrs.
 *   3. Strips Gmail compose class attributes (gmail_default, gmail_attr, etc.).
 *   4. Strips Apple Mail and other client-specific markup.
 *   5. Unwraps <span> and <font> elements carrying only styling.
 *   6. Strips font-family / font-size / color / background overrides from
 *      non-VoltSafe elements (preserves our own known styles by fingerprint).
 *   7. Ensures the body content is wrapped in the VoltSafe style div.
 */
export function normalizeOutboundHtml(html: string): string {
  if (!html || !html.trim()) return html;

  let out = html;

  // ── 1. Microsoft Word junk ─────────────────────────────────────────────────
  // Conditional comments: <!--[if gte mso 9]>…<![endif]-->
  out = out.replace(/<!--\[if[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, "");
  // Word namespace tags: <o:p>, <w:…>, <m:…>
  out = out.replace(/<\/?o:[a-z]+[^>]*>/gi, "");
  out = out.replace(/<\/?w:[a-z]+[^>]*>/gi, "");
  out = out.replace(/<\/?m:[a-z]+[^>]*>/gi, "");
  // mso-* CSS properties inside style attributes
  out = out.replace(/\s*mso-[a-z-]+:[^;}"]+;?/gi, "");
  // Word class names like MsoNormal, MsoBodyText
  out = out.replace(/\s+class="Mso[^"]*"/gi, "");
  out = out.replace(/\s+class='Mso[^']*'/gi, "");

  // ── 2. Google Docs junk ────────────────────────────────────────────────────
  // GDocs uses class="c0 c5" patterns and id="docs-internal-guid-…"
  out = out.replace(/\s+id="docs-internal-guid-[^"]*"/gi, "");
  out = out.replace(/\s+class="[^"]*\bc\d+\b[^"]*"/gi, "");
  // GDocs sometimes wraps everything in a <b> tag with font-weight:normal —
  // turn those into harmless <span> elements to prevent fake bold.
  // Fix: use two independent replacements (the original lookahead was fragile).
  out = out.replace(/<b\s+style="font-weight:\s*normal[^"]*">/gi, "<span>");
  out = out.replace(/<\/b>/gi, (match, offset) => {
    // Only convert </b> to </span> if there is a matching <span> still open
    // from the GDocs <b style="font-weight:normal"> pass above.
    // Simple heuristic: count unmatched <span> vs </span> up to this offset.
    const before = out.slice(0, offset);
    const openSpans = (before.match(/<span>/gi) || []).length;
    const closeSpans = (before.match(/<\/span>/gi) || []).length;
    return openSpans > closeSpans ? "</span>" : match;
  });

  // ── 3. Gmail compose junk ─────────────────────────────────────────────────
  // Gmail adds class="gmail_default", "gmail_attr", "gmail_extra", "gmail_quote"
  // Strip class attrs that are Gmail-origin; preserve the content.
  out = out.replace(/\s+class="gmail_[a-z_]+"/gi, "");
  // Gmail wraps reply content in <div dir="ltr"> — strip the dir attribute
  out = out.replace(/\s+dir="(?:ltr|rtl)"/gi, "");
  // Gmail-injected data-* attributes
  out = out.replace(/\s+data-[a-z][a-z0-9-]*="[^"]*"/gi, "");

  // ── 4. Apple Mail / other client junk ─────────────────────────────────────
  out = out.replace(/\s+apple-[a-z-]+="[^"]*"/gi, "");
  // Outlook-specific class="OutlookMessageHeader"
  out = out.replace(/\s+class="Outlook[^"]*"/gi, "");
  // Yahoo Mail: class="yiv…" patterns
  out = out.replace(/\s+class="yi[a-z0-9]*"/gi, "");
  // LinkedIn / AI tool data attributes
  out = out.replace(/\s+x-[a-z][a-z0-9-]*="[^"]*"/gi, "");

  // ── 5. AI tool / web page style noise ─────────────────────────────────────
  // ChatGPT / Claude output: <p data-pm-slice="…"> and similar ProseMirror attrs
  out = out.replace(/\s+data-pm-[a-z-]+="[^"]*"/gi, "");
  // Notion exports: notion-specific class patterns
  out = out.replace(/\s+class="notion-[^"]*"/gi, "");
  // Substack, Medium, Ghost: class="[A-Z][a-z]+-[a-z]+" module patterns
  out = out.replace(/\s+class="[A-Za-z]+-[A-Za-z0-9_-]+"/g, "");

  // ── 6. Unwrap <span> elements carrying only style/class info ───────────────
  // Multi-pass: nested spans need multiple rounds
  for (let pass = 0; pass < 4; pass++) {
    // <span style="…">content</span> → content
    out = out.replace(/<span\b(?:\s+[^>]*)?\s*style="[^"]*"(?:\s+[^>]*)?>([^<]*(?:<(?!\/span)[^<]*)*)<\/span>/gi, "$1");
    // <span class="…">content</span> → content
    out = out.replace(/<span\b(?:\s+[^>]*)?\s*class="[^"]*"(?:\s+[^>]*)?>([^<]*(?:<(?!\/span)[^<]*)*)<\/span>/gi, "$1");
    // Any remaining bare <span> opener/closer
    out = out.replace(/<span\b[^>]*>/gi, "").replace(/<\/span>/gi, "");
  }

  // ── 7. Unwrap <font> elements ──────────────────────────────────────────────
  out = out.replace(/<font\b[^>]*>/gi, "").replace(/<\/font>/gi, "");

  // ── 8a. Normalize <a> link styles — dedicated pass before general strip ──────
  // External email clients (Gmail, GDocs, Word) write their own link colors
  // onto <a> tags. We strip those and replace with the VoltSafe link color so
  // every outbound link looks consistent in recipients' inboxes.
  // Rule: if an <a> already carries our color → leave it. Otherwise replace
  // the whole style attribute with just our color (preserving href and other attrs).
  out = out.replace(
    /(<a\b[^>]*?)\s+style="([^"]*)"/gi,
    (match, tagHead, styleVal) => {
      if (styleVal.includes(VOLTSAFE_LINK_COLOR)) return match; // already ours
      return `${tagHead} style="color:${VOLTSAFE_LINK_COLOR};"`;
    },
  );

  // ── 8b. Strip rogue style attributes from block/inline elements ───────────
  // Preserve style only when it:
  //   (a) contains our font family + "line-height" → our body wrapper
  //   (b) contains our paragraph fingerprint      → our <p> paragraph blocks
  //   (c) contains "#787f84"                       → signature text color
  //   (d) contains "border-top"                    → our forwarded-block separator
  //   (e) contains "padding-left:24px"             → our list indent
  //   (f) fine-print sizes combined with signature color (11px, 12px, 13px)
  //   (g) contains "font-weight" on signature name elements (bold name)
  //   (h) contains "letter-spacing"                → our name element
  //   (i) contains "margin: 0 0 20px"              → "Regards," paragraph in sig
  out = out.replace(
    /(<(?:p|h[1-6]|li|blockquote|table|tr|td|th|div|b|i|u|s|ul|ol|strong|em)\b[^>]*?)\s+style="([^"]*)"/gi,
    (match, tag, styleVal) => {
      const isSignatureColor = styleVal.includes("#787f84");
      const isOurParagraph = styleVal.includes(EMAIL_P_STYLE_FINGERPRINT);
      const keep =
        (styleVal.includes(VOLTSAFE_FONT_FAMILY.split(",")[0]) && styleVal.includes("line-height")) ||
        isOurParagraph ||
        isSignatureColor ||
        styleVal.includes("border-top") ||
        styleVal.includes("padding-left:24px") ||
        styleVal.includes("font-weight") ||
        styleVal.includes("letter-spacing") ||
        styleVal.includes("margin: 0 0 20px") ||
        styleVal.includes("margin:0 0 20px") ||
        (isSignatureColor && (styleVal.includes("font-size:11px") || styleVal.includes("font-size:12px") || styleVal.includes("font-size:13px")));
      return keep ? match : tag;
    },
  );

  // ── 9. Ensure body is wrapped in the VoltSafe style block ─────────────────
  const trimmed = out.trim();
  const hasWrapper = new RegExp(`^<div\\s[^>]*font-family:${VOLTSAFE_FONT_FAMILY.split(",")[0]}`, "i").test(trimmed);
  if (!hasWrapper) {
    out = `<div style="${VOLTSAFE_BODY_STYLE}">${out}</div>`;
  }

  // ── 10. Final cleanup: collapse excessive whitespace between tags ───────────
  out = out.replace(/>\s{2,}</g, "> <").replace(/\s{2,}(?=[^<])/g, " ");

  return out;
}
