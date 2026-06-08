/** Canonical CTA image width — the ONLY place this constant lives. */
export const CTA_IMAGE_WIDTH = 200;

export interface CtaAssetConfig {
  imageUrl: string;
  destUrl: string;
  altText?: string | null;
  widthPx?: number | null;
}

export function wrapHtmlWithCtaAsset(
  baseHtml: string,
  cta: CtaAssetConfig,
  baseUrl?: string,
): string {
  if (!cta.imageUrl || !cta.destUrl) return baseHtml;

  let src = cta.imageUrl;
  if (baseUrl) {
    const m = src.match(/\/assets\/cta\/([^/?#\s]+)$/);
    if (m) src = `${baseUrl}/assets/cta/${m[1]}`;
  }

  const alt = (cta.altText || "Watch a Demo").replace(/"/g, "&quot;");
  const dest = cta.destUrl.replace(/"/g, "&quot;");
  const safeSrc = src.replace(/"/g, "&quot;");

  const ctaLink = `<a href="${dest}" target="_blank" rel="noopener noreferrer" style="display:block;text-decoration:none;border:0;"><img src="${safeSrc}" alt="${alt}" width="200" border="0" style="display:block;width:200px;max-width:200px;min-width:200px;height:auto;border:0;outline:none;text-decoration:none;border-radius:4px;-ms-interpolation-mode:bicubic;"></a>`;

  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="620" style="width:620px;max-width:620px;border-collapse:collapse;table-layout:fixed;"><tr><td width="396" valign="top" style="width:396px;max-width:396px;vertical-align:top;">${baseHtml}</td><td width="224" valign="middle" align="right" style="width:224px;min-width:224px;vertical-align:middle;padding-left:24px;text-align:right;">${ctaLink}</td></tr></table>`;
}

/**
 * Returns true if sigHtml already contains an <img> whose src references
 * the same /assets/cta/<filename> as ctaImageUrl.
 * Used at send time to avoid injecting a duplicate CTA image alongside a
 * signature whose html_content already embeds the same asset.
 */
export function sigHtmlAlreadyContainsCta(sigHtml: string, ctaImageUrl: string): boolean {
  if (!sigHtml || !ctaImageUrl) return false;
  const fnMatch = ctaImageUrl.match(/\/assets\/cta\/([^/?#\s]+)$/);
  if (!fnMatch) return false;
  const filename = fnMatch[1].toLowerCase();
  const imgRe = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(sigHtml)) !== null) {
    const src = m[1].toLowerCase();
    if (src.includes(filename)) return true;
    // data: URI — if the sig HTML has a data: URI in this slot it was already
    // pre-resolved from the same file; treat any data: img in the sig section
    // as a potential match only when cta_image_url is clearly the same asset
    // (covered by filename match above for common path).
  }
  return false;
}

/**
 * Strips every <a href="..."><img src="...filename..."></a> (or bare <img>)
 * that references the given CTA filename from the HTML string.
 * Used by the admin dedup-html repair endpoint.
 */
export function stripCtaImgFromHtml(html: string, filename: string): string {
  if (!html || !filename) return html;
  const safeFn = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Remove <a ...><img src="...filename..."></a> (most common wrapping)
  html = html.replace(
    new RegExp(`<a\\b[^>]*>\\s*<img\\b[^>]*\\bsrc=["'][^"']*${safeFn}[^"']*["'][^>]*/?>[\\s\\S]*?<\\/a>`, "gi"),
    "",
  );
  // Remove bare <img src="...filename..."> not already removed
  html = html.replace(
    new RegExp(`<img\\b[^>]*\\bsrc=["'][^"']*${safeFn}[^"']*["'][^>]*/?>`, "gi"),
    "",
  );
  return html;
}
