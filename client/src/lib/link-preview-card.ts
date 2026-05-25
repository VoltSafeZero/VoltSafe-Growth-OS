/**
 * link-preview-card.ts — VoltSafe Mail link-preview card HTML generator.
 *
 * Generates two flavors of preview card HTML:
 *
 *   buildLinkPreviewCardHtml(meta)     — the finalized card, using a
 *     <table data-link-preview="url"> structure so it:
 *       (a) survives sanitizeEditorHtml (pre/post extraction pass)
 *       (b) renders correctly in email clients (inline styles, table layout)
 *       (c) works in the contenteditable editor on dark backgrounds
 *
 *   buildLinkPreviewLoadingHtml(url)   — a transient loading placeholder
 *     that the paste handler inserts immediately, then replaces once the
 *     /api/link-preview fetch resolves.
 *
 * Security: all user-supplied strings are HTML-escaped before insertion.
 * No scripts, no iframes, no external CSS.
 */

export interface LinkPreviewMeta {
  url: string;
  title: string;
  description: string;
  image: string;
  favicon: string;
  siteName: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Validate that an image URL uses http or https (no data URIs, javascript:, etc.)
 * and is reasonably well-formed before inserting it into an <img src>.
 */
function safeImageUrl(url: string): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return "";
  // Basic length guard — real image URLs are rarely > 400 chars
  if (trimmed.length > 500) return "";
  return trimmed.replace(/"/g, "&quot;");
}

// ── Card HTML ─────────────────────────────────────────────────────────────────

/**
 * Build the finalized link-preview card HTML.
 *
 * Uses a table-based layout so it renders correctly across email clients.
 * The outer <table> carries `data-link-preview="<url>"` so the sanitizer
 * extraction pre-pass can identify and preserve it (with its inline styles)
 * during the send / draft-save path.
 *
 * `contenteditable="false"` lets users position the cursor before/after the
 * card and delete it as a unit (standard browser UX for non-editable islands
 * inside a contenteditable container).
 */
export function buildLinkPreviewCardHtml(meta: LinkPreviewMeta): string {
  const safeUrl  = esc(meta.url || "#");
  const title    = esc((meta.title    || "").slice(0, 120));
  const desc     = esc((meta.description || "").slice(0, 200));
  const siteName = esc((meta.siteName || "").slice(0, 60));
  const imgSrc   = safeImageUrl(meta.image || "");

  const imageCol = imgSrc
    ? `<td width="120" style="width:120px;min-width:120px;padding:0;vertical-align:top;">` +
      `<img src="${imgSrc}" alt="${title}" width="120" height="90" ` +
      `style="display:block;width:120px;height:90px;object-fit:cover;" /></td>`
    : "";

  const descRow = desc
    ? `<div style="font-size:13px;color:#94a3b8;line-height:1.4;margin-top:4px;">${desc}</div>`
    : "";

  return (
    `<table data-link-preview="${safeUrl}" width="100%" cellpadding="0" cellspacing="0" ` +
    `border="0" contenteditable="false" ` +
    `style="display:table;max-width:540px;border-radius:8px;border:1px solid #334155;` +
    `font-family:Arial,Helvetica,sans-serif;margin:12px 0;background:#1e293b;` +
    `overflow:hidden;table-layout:fixed;">` +
    `<tbody><tr><td style="padding:0;">` +
    `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" ` +
    `style="text-decoration:none;color:inherit;display:block;">` +
    `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;">` +
    `<tbody><tr>` +
    `<td style="padding:12px 16px;vertical-align:top;">` +
    `<div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">${siteName}</div>` +
    `<div style="font-size:15px;font-weight:bold;color:#f1f5f9;line-height:1.3;">${title}</div>` +
    descRow +
    `</td>` +
    imageCol +
    `</tr></tbody></table>` +
    `</a>` +
    `</td></tr></tbody></table>`
  );
}

/**
 * A transient loading-state placeholder inserted immediately after a URL is
 * pasted. Carries `data-link-preview-loading` so the paste handler can find
 * and replace it once the /api/link-preview fetch resolves.
 */
export function buildLinkPreviewLoadingHtml(url: string): string {
  const safeUrl = esc(url.slice(0, 500));
  return (
    `<table data-link-preview-loading="${safeUrl}" width="100%" cellpadding="0" ` +
    `cellspacing="0" border="0" contenteditable="false" ` +
    `style="display:table;max-width:540px;border-radius:8px;border:1px solid #334155;` +
    `font-family:Arial,Helvetica,sans-serif;margin:12px 0;background:#1e293b;">` +
    `<tbody><tr><td style="padding:12px 16px;color:#64748b;font-size:13px;">` +
    `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;` +
    `background:#334155;margin-right:8px;"></span>` +
    `Loading preview…` +
    `</td></tr></tbody></table>`
  );
}
