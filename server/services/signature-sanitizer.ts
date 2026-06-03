/**
 * sanitizeSignatureHtml
 *
 * Strips dangerous HTML before storing or rendering a user-supplied email
 * signature. Runs server-side on every POST/PUT to /api/signatures.
 *
 * Threat coverage:
 *  - <script>, <iframe>, <object>, <embed>, <applet>, <form>, <noscript>
 *  - Inline event handlers  (on*)
 *  - javascript:, vbscript:, data:  in href/src (quoted AND unquoted)
 *
 * Safe-listed / preserved:
 *  - Tables, inline styles, safe https:// links, hosted images (<img>), <br>
 */
export function sanitizeSignatureHtml(html: string): string {
  if (!html) return "";
  let out = html;

  // Strip dangerous tag types (with their content)
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "");
  out = out.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "");
  out = out.replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, "");
  out = out.replace(/<embed\b[^>]*\/?>/gi, "");
  out = out.replace(/<applet\b[^>]*>[\s\S]*?<\/applet>/gi, "");
  out = out.replace(/<form\b[^>]*>[\s\S]*?<\/form>/gi, "");

  // Strip inline event handlers (on*=... with or without surrounding whitespace,
  // quoted or unquoted values)
  out = out.replace(/[\s]on\w+\s*=\s*["'][^"']*["']/gi, "");
  out = out.replace(/[\s]on\w+\s*=\s*[^\s>]*/gi, "");
  out = out.replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, "");

  // Strip dangerous protocols in quoted href/src attributes
  out = out.replace(/href\s*=\s*["'](?:javascript|vbscript|data):[^"']*["']/gi, 'href="#"');
  out = out.replace(/src\s*=\s*["'](?:javascript|vbscript|data):[^"']*["']/gi, 'src=""');

  // Strip dangerous protocols in unquoted href/src attributes
  out = out.replace(/href\s*=\s*(?:javascript|vbscript|data):[^\s>"]*/gi, 'href="#"');
  out = out.replace(/src\s*=\s*(?:javascript|vbscript|data):[^\s>"]*/gi, 'src=""');

  return out;
}
