/**
 * signature-normalizer.ts
 *
 * Strips HTML document-level wrapper tags from signature HTML, converting
 * a full HTML document into a safe, embeddable HTML fragment.
 *
 * Root cause this file fixes:
 *   Signatures stored in the DB (or pasted by users from email clients like
 *   Gmail / Outlook) can arrive as a complete HTML document:
 *
 *     <!DOCTYPE html><html><head>...</head><body>
 *       <table>...signature content...</table>
 *     </body></html>
 *
 *   When this is embedded inside the POST /api/gmail/send request body the
 *   Replit production proxy/WAF detects a "full HTML document upload" and
 *   rejects the request with 403 Forbidden BEFORE Express ever sees it.
 *
 * Applied at:
 *   1. Signature CREATE / UPDATE  — before writing to DB (server/routes.ts)
 *   2. POST /api/gmail/send       — on the full body, strips any doc tags
 *                                   that snuck through from stored signatures
 *   3. Frontend send assembly     — client/src/lib/email-format.ts
 *
 * Strips:
 *   <!DOCTYPE ...>
 *   <html ...>  /  </html>
 *   <head>...</head>  (including all content inside)
 *   <body ...>  /  </body>  (open/close tags only — content preserved)
 *   Stray <meta ...>  tags surviving outside <head>
 *   Stray <title>...</title> blocks
 *
 * Preserves:
 *   Tables, divs, spans, inline styles, links, safe HTTPS images,
 *   HTML comments, all formatting and layout.
 */

export function normalizeSignatureHtml(html: string): string {
  if (!html || !html.trim()) return html;
  let out = html;

  // 1. Strip <!DOCTYPE ...> (case-insensitive)
  out = out.replace(/<!DOCTYPE\b[^>]*>/gi, "");

  // 2. Strip <head>...</head> block (including scripts, styles, metas inside)
  out = out.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "");

  // 3. Strip <html ...> opening and </html> closing tags; content is preserved
  out = out.replace(/<html\b[^>]*>/gi, "");
  out = out.replace(/<\/html\s*>/gi, "");

  // 4. Strip <body ...> opening and </body> closing tags; content is preserved
  out = out.replace(/<body\b[^>]*>/gi, "");
  out = out.replace(/<\/body\s*>/gi, "");

  // 5. Strip stray <meta ...> tags that survived outside of a <head> block
  out = out.replace(/<meta\b[^>]*\/?>/gi, "");

  // 6. Strip stray <title>...</title> blocks
  out = out.replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, "");

  return out.trim();
}

/**
 * Detect which document-level wrapper tags are present in an HTML string.
 * Used for diagnostic logging at save time and at send time.
 */
export function detectDocumentTags(html: string): {
  hasDoctype:  boolean;
  hasHtmlTag:  boolean;
  hasHeadTag:  boolean;
  hasBodyTag:  boolean;
  any:         boolean;
} {
  const hasDoctype = /<!DOCTYPE\b/i.test(html);
  const hasHtmlTag = /<html\b/i.test(html);
  const hasHeadTag = /<head\b/i.test(html);
  const hasBodyTag = /<body\b/i.test(html);
  return {
    hasDoctype,
    hasHtmlTag,
    hasHeadTag,
    hasBodyTag,
    any: hasDoctype || hasHtmlTag || hasHeadTag || hasBodyTag,
  };
}
