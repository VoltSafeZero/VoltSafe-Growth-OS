/**
 * signature-html-sanitizer.ts — Send-time safety net for signature HTML.
 *
 * Production signatures can contain:
 *   • Large base64 data URIs (logos pasted from email clients) — bloat the
 *     request body past Replit's proxy limit → proxy returns 403 HTML.
 *   • img src values pointing to localhost / private /api routes.
 *   • Old Replit *.replit.dev or *.repl.co host URLs for CTA assets that no
 *     longer resolve.
 *   • Relative src URLs that are meaningless to email recipients.
 *   • Dangerous tags (script, iframe, form, style, svg, object).
 *
 * This module is applied to the signature section only (between
 * <!--vs-sig-start--> and <!--vs-sig-end--> markers) immediately after
 * normalizeOutboundHtml() in the POST /api/gmail/send route.
 */

const SIG_START = "<!--vs-sig-start-->";
const SIG_END   = "<!--vs-sig-end-->";

/**
 * Applied to the full email HTML (body + sig markers).
 * Locates the signature section and sanitizes only that block.
 * Returns the original string unchanged when no markers are found.
 */
export function applySignatureSendSanitizer(html: string, baseUrl: string): string {
  const si = html.indexOf(SIG_START);
  if (si === -1) return html;
  const contentStart = si + SIG_START.length;
  const ei = html.indexOf(SIG_END, contentStart);
  if (ei === -1) return html;

  const before = html.slice(0, contentStart);
  const sigHtml = html.slice(contentStart, ei);
  const after   = html.slice(ei);
  return before + sanitizeSignatureHtml(sigHtml, baseUrl) + after;
}

/**
 * Sanitize a raw signature HTML fragment for safe inclusion in outbound email.
 *
 * Rules applied (in order):
 *  1. Strip dangerous block elements: script, iframe, form, style, svg, object, embed.
 *  2. Strip event-handler attributes (on*="...").
 *  3. Process every <img> tag:
 *       – data:, blob:, file:, cid: src → strip tag (eliminates huge base64 blobs).
 *       – localhost / 127.0.0.1 src → strip tag.
 *       – /api/ routes (absolute or relative) → strip tag.
 *       – Relative /assets/cta/ paths → rewrite to absolute HTTPS.
 *       – Old *.replit.dev or *.repl.co host on a /assets/cta/ path → rewrite to baseUrl.
 *       – Any other relative URL → strip tag.
 *       – Non-HTTPS remaining URL → strip tag.
 *       – Everything else → keep.
 *  4. Convert any <a> tags left with empty bodies (img was stripped) to a
 *     plain-text button fallback so CTA links still work.
 */
export function sanitizeSignatureHtml(html: string, baseUrl: string): string {
  if (!html || !html.trim()) return html;
  let out = html;

  // ── 1. Strip dangerous block elements ──────────────────────────────────────
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "");
  out = out.replace(/<form\b[^>]*>[\s\S]*?<\/form>/gi, "");
  out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  out = out.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "");
  out = out.replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, "");
  out = out.replace(/<embed\b[^>]*\/?>/gi, "");

  // ── 2. Strip event-handler attributes ──────────────────────────────────────
  out = out.replace(/\s+on[a-z]+="[^"]*"/gi, "");
  out = out.replace(/\s+on[a-z]+='[^']*'/gi, "");

  // ── 3. Process <img> tags ───────────────────────────────────────────────────
  out = out.replace(/<img\b([^>]*)>/gi, (match, attrs: string) => {
    const srcMatch = attrs.match(/\bsrc=(?:"([^"]*)"|'([^']*)'|(\S+))/i);
    if (!srcMatch) return ""; // img with no src — strip

    const src = (srcMatch[1] ?? srcMatch[2] ?? srcMatch[3] ?? "").trim();
    if (!src) return "";

    // 3a. Unsafe schemes — strip (data: URIs are the main culprit for 403s)
    if (/^(data:|blob:|file:|cid:)/i.test(src)) {
      console.log(`[sig-sanitizer] stripped data/blob/file/cid img (${src.slice(0, 40)}...)`);
      return "";
    }

    // 3b. Localhost / loopback — strip
    if (/localhost|127\.0\.0\.1|::1/i.test(src)) {
      console.log(`[sig-sanitizer] stripped localhost img: ${src.slice(0, 80)}`);
      return "";
    }

    // 3c. Private API routes — strip
    if (/(?:^|\/)api\//i.test(src)) {
      console.log(`[sig-sanitizer] stripped /api/ img src: ${src.slice(0, 80)}`);
      return "";
    }

    // 3d. Relative URLs
    if (src.startsWith("/")) {
      // Only allow the known safe public CTA asset path
      if (/^\/assets\/cta\/[\w-]+\.(png|jpg|jpeg|webp|gif)$/i.test(src)) {
        return match.replace(src, `${baseUrl}${src}`);
      }
      console.log(`[sig-sanitizer] stripped unsafe relative img src: ${src}`);
      return "";
    }

    // 3e. Old Replit dev domains — rewrite CTA assets to current host, strip rest
    try {
      const u = new URL(src);
      if (/\.(replit\.dev|repl\.co|repl\.it|replit\.app)$/.test(u.hostname)) {
        const p = u.pathname;
        if (/^\/assets\/cta\/[\w-]+\.(png|jpg|jpeg|webp|gif)$/i.test(p)) {
          console.log(`[sig-sanitizer] rewrote old-host CTA img: ${src} → ${baseUrl}${p}`);
          return match.replace(src, `${baseUrl}${p}`);
        }
        console.log(`[sig-sanitizer] stripped old-host non-asset img: ${src.slice(0, 80)}`);
        return "";
      }
    } catch {
      console.log(`[sig-sanitizer] stripped unparseable img src: ${src.slice(0, 80)}`);
      return "";
    }

    // 3f. Must be http(s) at this point
    if (!/^https?:\/\//i.test(src)) {
      console.log(`[sig-sanitizer] stripped non-http img src: ${src.slice(0, 80)}`);
      return "";
    }

    // Safe absolute HTTPS URL — keep unchanged
    return match;
  });

  // ── 4. Convert empty <a> tags (img stripped) to text button fallback ────────
  // Matches <a ...> [whitespace only] </a> after the img-strip pass above.
  out = out.replace(/<a\b([^>]*)>\s*<\/a>/gi, (_match, attrs: string) => {
    const hrefMatch = attrs.match(/\bhref=(?:"([^"]*)"|'([^']*)'|(\S+))/i);
    const href = (hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? "").trim();
    if (!href || !/^https?:\/\//i.test(href)) return ""; // no valid dest — strip entirely
    // Replace with a plain-text button so the CTA still works
    return `<a href="${href.replace(/"/g, "&quot;")}" style="display:inline-block;padding:10px 22px;background:#00C1DE;color:#fff;text-decoration:none;border-radius:4px;font-family:Arial,sans-serif;font-size:14px;">View</a>`;
  });

  return out;
}

/**
 * Audit helper — returns a structured report of unsafe content found in
 * a signature HTML string. Used by scripts/audit-production-signatures.ts.
 */
export function auditSignatureHtml(html: string): {
  hasDataUri: boolean;
  hasLocalhost: boolean;
  hasApiRoute: boolean;
  hasRelativeUrl: boolean;
  hasOldReplitHost: boolean;
  hasDangerousTag: boolean;
  hasEventHandler: boolean;
  imgSrcs: string[];
  hrefs: string[];
  issues: string[];
} {
  const issues: string[] = [];
  const imgSrcs: string[] = [];
  const hrefs: string[] = [];

  for (const m of html.matchAll(/\bsrc=(?:"([^"]*)"|'([^']*)'|(\S+))/gi)) {
    const src = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (src) imgSrcs.push(src);
  }
  for (const m of html.matchAll(/\bhref=(?:"([^"]*)"|'([^']*)'|(\S+))/gi)) {
    const href = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (href) hrefs.push(href);
  }

  const hasDataUri       = imgSrcs.some((s) => /^(data:|blob:|file:|cid:)/i.test(s));
  const hasLocalhost     = imgSrcs.some((s) => /localhost|127\.0\.0\.1/i.test(s));
  const hasApiRoute      = imgSrcs.some((s) => /(?:^|\/)api\//i.test(s));
  const hasRelativeUrl   = imgSrcs.some((s) => s.startsWith("/"));
  const hasOldReplitHost = imgSrcs.some((s) => { try { return /\.(replit\.dev|repl\.co|repl\.it)$/.test(new URL(s).hostname); } catch { return false; } });
  const hasDangerousTag  = /<(script|iframe|form|style|svg|object|embed)\b/i.test(html);
  const hasEventHandler  = /\bon[a-z]+=["']/i.test(html);

  if (hasDataUri)       issues.push("UNSAFE: data:/blob:/file:/cid: image src (likely large base64 — causes 403 on proxy)");
  if (hasLocalhost)     issues.push("UNSAFE: localhost/127.0.0.1 image src");
  if (hasApiRoute)      issues.push("UNSAFE: /api/ image src (auth-protected route)");
  if (hasRelativeUrl)   issues.push("WARN: relative image src (broken in email clients)");
  if (hasOldReplitHost) issues.push("WARN: old *.replit.dev or *.repl.co image src (may be stale)");
  if (hasDangerousTag)  issues.push("UNSAFE: dangerous HTML tag (script/iframe/form/style/svg/object)");
  if (hasEventHandler)  issues.push("UNSAFE: event handler attribute (on*)");

  return { hasDataUri, hasLocalhost, hasApiRoute, hasRelativeUrl, hasOldReplitHost, hasDangerousTag, hasEventHandler, imgSrcs, hrefs, issues };
}
