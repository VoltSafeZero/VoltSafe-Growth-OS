/**
 * email-html-normalizer.ts — Server-side safety net for outbound email HTML.
 *
 * Applied in POST /api/gmail/send and POST /api/gmail/drafts before handing
 * the body to the Gmail API. This is the last line of defence against mixed
 * fonts, external color overrides, Word/Docs junk, and AI-copied formatting
 * leaking into recipients' inboxes.
 *
 * Uses a WHITELIST approach — all styling is stripped unless it belongs to
 * our known, controlled markup (the VoltSafe body wrapper, the signature
 * block, and link colors).
 *
 * Safe preserved elements:
 *   <div style="font-family:Arial…">  — VoltSafe body wrapper
 *   <b>, <strong>, <i>, <em>, <u>, <s>  — semantic inline formatting
 *   <ul>, <ol>, <li>  — lists (with our margin/padding style preserved)
 *   <a href="…" style="color:#00C1DE;">  — links
 *   <br/>, <br>  — line breaks
 *   All signature-block elements (identified by presence of #787f84 or voltsafe.com)
 */

const BODY_STYLE =
  "font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111111;" +
  "line-height:1.6;margin-bottom:24px;";

/**
 * Normalise outbound email HTML. Returns a sanitised version of `html` that:
 *   1. Strips Microsoft Word conditional comments, mso-* CSS, and o:p tags.
 *   2. Strips Google Docs class attributes (c0, c1, c2… pattern).
 *   3. Unwraps <span> and <font> elements carrying only styling.
 *   4. Strips font-family / font-size / color / background overrides from
 *      non-VoltSafe elements (preserves our own known styles by fingerprint).
 *   5. Ensures the body content is wrapped in the VoltSafe style div.
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
  // mso-* CSS properties inside style attributes
  out = out.replace(/\s*mso-[a-z-]+:[^;}"]+;?/gi, "");
  // Word class names like MsoNormal, MsoBodyText
  out = out.replace(/\s+class="Mso[^"]*"/gi, "");
  out = out.replace(/\s+class='Mso[^']*'/gi, "");

  // ── 2. Google Docs junk ────────────────────────────────────────────────────
  // GDocs uses class="c0 c5" patterns and id="docs-internal-guid-…"
  out = out.replace(/\s+id="docs-internal-guid-[^"]*"/gi, "");
  out = out.replace(/\s+class="[^"]*\bc\d+\b[^"]*"/gi, "");
  // GDocs sometimes wraps everything in a <b> tag with font-weight:normal
  // Turn those into harmless spans by stripping their style
  out = out.replace(/<b\s+style="font-weight:\s*normal[^"]*">/gi, "<span>");
  out = out.replace(/<\/b>(?=[\s\S]*?<\/span>)/gi, "</span>");

  // ── 3. Unwrap <span> elements carrying only style/class info ───────────────
  // Multi-pass: nested spans need multiple rounds
  for (let pass = 0; pass < 3; pass++) {
    // <span style="…">content</span> → content
    out = out.replace(/<span\b(?:\s+[^>]*)?\s*style="[^"]*"(?:\s+[^>]*)?>([^<]*(?:<(?!\/span)[^<]*)*)<\/span>/gi, "$1");
    // <span class="…">content</span> → content
    out = out.replace(/<span\b(?:\s+[^>]*)?\s*class="[^"]*"(?:\s+[^>]*)?>([^<]*(?:<(?!\/span)[^<]*)*)<\/span>/gi, "$1");
    // Any remaining bare <span> opener/closer
    out = out.replace(/<span\b[^>]*>/gi, "").replace(/<\/span>/gi, "");
  }

  // ── 4. Unwrap <font> elements ──────────────────────────────────────────────
  out = out.replace(/<font\b[^>]*>/gi, "").replace(/<\/font>/gi, "");

  // ── 5. Strip rogue style attributes from known block/inline elements ───────
  // Preserve style only when it:
  //   (a) contains "Arial" + "line-height" → our body wrapper
  //   (b) contains "#787f84" or "#00C1DE"  → signature or link colors
  //   (c) contains "border-top"            → our forwarded-block separator
  //   (d) contains "padding-left:24px"     → our list indent
  out = out.replace(
    /(<(?:p|h[1-6]|li|blockquote|table|tr|td|th|div|a|b|i|u|s|ul|ol|strong|em)\b[^>]*?)\s+style="([^"]*)"/gi,
    (match, tag, styleVal) => {
      const keep =
        (styleVal.includes("Arial") && styleVal.includes("line-height")) ||
        styleVal.includes("#787f84") ||
        styleVal.includes("#00C1DE") ||
        styleVal.includes("border-top") ||
        styleVal.includes("padding-left:24px") ||
        styleVal.includes("color:#00C1DE") ||
        styleVal.includes("text-decoration") ||
        styleVal.includes("font-size:11px") || // signature fine print
        styleVal.includes("font-size:12px") || // signature name
        styleVal.includes("font-size:13px");   // forwarded-block header
      return keep ? match : tag;
    },
  );

  // ── 6. Ensure body is wrapped in the VoltSafe style block ─────────────────
  const trimmed = out.trim();
  const hasWrapper = /^<div\s[^>]*font-family:Arial/i.test(trimmed);
  if (!hasWrapper) {
    // Only wrap the "user body" portion — don't re-wrap if it looks like
    // a full email with signature already present.
    const hasSignature =
      trimmed.includes("voltsafe.com") || trimmed.includes("#787f84");
    if (hasSignature) {
      // Already a full email — prefix with wrapper if the first element isn't it
      out = `<div style="${BODY_STYLE}">${out}</div>`;
    } else {
      out = `<div style="${BODY_STYLE}">${out}</div>`;
    }
  }

  // ── 7. Final cleanup: collapse excessive whitespace between tags ───────────
  out = out.replace(/>\s{2,}</g, "> <").replace(/\s{2,}(?=[^<])/g, " ");

  return out;
}
