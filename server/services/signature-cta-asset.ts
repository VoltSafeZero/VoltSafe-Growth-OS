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

  const w = Math.max(80, Math.min(240, cta.widthPx || 180));
  const alt = (cta.altText || "Watch a Demo").replace(/"/g, "&quot;");
  const dest = cta.destUrl.replace(/"/g, "&quot;");
  const safeSrc = src.replace(/"/g, "&quot;");

  const ctaCell = `<a href="${dest}" target="_blank" rel="noopener noreferrer" style="display:inline-block;"><img src="${safeSrc}" alt="${alt}" width="${w}" style="display:block;border:0;outline:none;text-decoration:none;max-width:${w}px;height:auto;border-radius:4px;"></a>`;

  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;"><tr><td style="vertical-align:top;">${baseHtml}</td><td style="vertical-align:middle;padding-left:24px;">${ctaCell}</td></tr></table>`;
}
