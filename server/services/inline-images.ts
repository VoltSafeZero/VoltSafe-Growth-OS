import fs from "fs";
import path from "path";

const FETCH_TIMEOUT_MS = 10_000;

export interface InlinedImageLog {
  originalSrc: string;
  resolvedFrom: "disk" | "http" | "skipped";
  localPath?: string;
  fetchUrl?: string;
  byteSize: number;
  mimeType: string;
  dataUriLen: number;
  skipReason?: string;
}

function extToMime(ext: string): string {
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    svg: "image/svg+xml",
  };
  return map[ext.toLowerCase()] ?? "image/png";
}

/**
 * Convert all <img src="..."> in the HTML to base64 data URIs.
 *
 * Sources (in priority order):
 *   src="/assets/cta/filename"             → read ctaAssetsDir/filename from disk
 *   src="https://host/assets/cta/filename" → same disk fast path, HTTP fallback
 *   src="https://..."                      → server-side HTTP fetch
 *   src="data:..."                         → already inlined, leave unchanged
 *
 * NON-FATAL: if an image cannot be loaded (disk miss + HTTP fail), it is
 * skipped with a warning log — the email is still sent with the original src.
 * This prevents a disk-unavailable image (e.g. ephemeral production storage)
 * from blocking every send that uses a signature.
 *
 * The PREFERRED fix is to store images as data URIs at upload/signature-creation
 * time so no runtime disk or network access is ever needed at send time.
 */
export async function inlineImagesAsBase64(
  html: string,
  ctaAssetsDir: string,
  baseUrl?: string,
): Promise<{ html: string; log: InlinedImageLog[] }> {
  // Collect unique src values from <img> tags only
  const seen = new Set<string>();
  const imgRe = /<img\b[^>]*\bsrc="([^"]+)"[^>]*/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    if (m[1]) seen.add(m[1]);
  }

  if (seen.size === 0) {
    console.log("[inline-img] no <img src> found — nothing to inline");
    return { html, log: [] };
  }

  console.log(`[inline-img] found ${seen.size} unique img src(s): ${[...seen].map(s => `"${s.slice(0, 60)}"`).join(", ")}`);

  const replacements = new Map<string, string>(); // original src → data URI
  const log: InlinedImageLog[] = [];

  for (const src of seen) {
    // ── Already a data URI ────────────────────────────────────────────────────
    if (/^data:/i.test(src)) {
      console.log(`[inline-img] SKIP already-data-uri len=${src.length}`);
      log.push({ originalSrc: src, resolvedFrom: "skipped", byteSize: 0, mimeType: "", dataUriLen: src.length, skipReason: "already-data-uri" });
      continue;
    }

    // ── Resolve: /assets/cta/ path (fast path — read from disk) ──────────────
    const ctaMatch = src.match(/\/assets\/cta\/([A-Za-z0-9_][A-Za-z0-9_ .\-]*)(?:[?#]|$)/);

    let imageBuffer: Buffer | null = null;
    let mimeType = "image/png";
    let resolvedFrom: "disk" | "http" | "skipped" = "skipped";
    let localPath: string | undefined;
    let fetchUrl: string | undefined;
    let skipReason: string | undefined;

    if (ctaMatch) {
      const filename = decodeURIComponent(ctaMatch[1]);
      localPath = path.join(ctaAssetsDir, filename);
      mimeType = extToMime(filename.split(".").pop() ?? "png");

      if (fs.existsSync(localPath)) {
        try {
          imageBuffer = fs.readFileSync(localPath);
          resolvedFrom = "disk";
          console.log(`[inline-img] disk hit: "${filename}" (${imageBuffer.length} bytes)`);
        } catch (diskErr: any) {
          console.warn(`[inline-img] disk read failed for "${filename}": ${diskErr?.message} — will try HTTP`);
        }
      } else {
        console.warn(`[inline-img] disk miss for "${filename}" (dir: ${ctaAssetsDir}) — will try HTTP fetch`);
      }

      // Fall back to HTTP fetch if disk is unavailable
      if (!imageBuffer) {
        const httpSrc = /^https?:\/\//i.test(src)
          ? src
          : baseUrl ? `${baseUrl}/assets/cta/${filename}` : null;
        if (httpSrc) {
          fetchUrl = httpSrc;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
          try {
            const resp = await fetch(httpSrc, { signal: controller.signal });
            clearTimeout(timer);
            if (resp.ok) {
              imageBuffer = Buffer.from(await resp.arrayBuffer());
              resolvedFrom = "http";
              console.log(`[inline-img] HTTP fallback OK for "${filename}" (${imageBuffer.length} bytes)`);
            } else {
              clearTimeout(timer);
              skipReason = `disk-miss + HTTP ${resp.status}`;
              console.warn(`[inline-img] HTTP fallback ${resp.status} for "${filename}" — skipping (original src kept)`);
            }
          } catch (fetchErr: any) {
            clearTimeout(timer);
            skipReason = `disk-miss + fetch-error: ${fetchErr?.message}`;
            console.warn(`[inline-img] HTTP fallback failed for "${filename}": ${fetchErr?.message} — skipping (original src kept)`);
          }
        } else {
          skipReason = "disk-miss + no-http-url";
          console.warn(`[inline-img] disk miss for "${filename}" and no HTTP URL available — skipping`);
        }
      }
    } else if (/^https?:\/\//i.test(src)) {
      // ── HTTP fetch for non-CTA external images ───────────────────────────────
      fetchUrl = src;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const resp = await fetch(src, { signal: controller.signal });
        clearTimeout(timer);
        if (resp.ok) {
          const ct = resp.headers.get("content-type") ?? "image/png";
          mimeType = ct.split(";")[0].trim();
          imageBuffer = Buffer.from(await resp.arrayBuffer());
          resolvedFrom = "http";
        } else {
          clearTimeout(timer);
          skipReason = `HTTP ${resp.status}`;
          console.warn(`[inline-img] HTTP ${resp.status} for "${src.slice(0, 80)}" — skipping (original src kept)`);
        }
      } catch (e: any) {
        clearTimeout(timer);
        skipReason = `fetch-error: ${e?.message}`;
        console.warn(`[inline-img] fetch failed for "${src.slice(0, 80)}": ${e?.message} — skipping (original src kept)`);
      }
    } else {
      // Relative URL that's not /assets/cta/ — skip
      skipReason = "unrecognized-relative-url";
      console.log(`[inline-img] SKIP unrecognized src="${src}"`);
    }

    if (!imageBuffer) {
      log.push({ originalSrc: src, resolvedFrom: "skipped", localPath, fetchUrl, byteSize: 0, mimeType: "", dataUriLen: 0, skipReason });
      continue;
    }

    const dataUri = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
    replacements.set(src, dataUri);
    log.push({ originalSrc: src, resolvedFrom, localPath, fetchUrl, byteSize: imageBuffer.length, mimeType, dataUriLen: dataUri.length });

    console.log(
      `[inline-img] OK from=${resolvedFrom} mime=${mimeType} bytes=${imageBuffer.length} ` +
      `dataUriLen=${dataUri.length} src="${src.slice(0, 80)}"`,
    );
  }

  if (replacements.size === 0) {
    const skippedCount = log.filter(l => l.resolvedFrom === "skipped" && l.skipReason !== "already-data-uri").length;
    if (skippedCount > 0) {
      console.warn(`[inline-img] ${skippedCount} image(s) could not be inlined — email will be sent with original src URLs`);
    }
    return { html, log };
  }

  // Replace all occurrences of each src="<original>" → src="<dataUri>" in img tags
  let rewritten = html;
  for (const [src, dataUri] of replacements) {
    const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    rewritten = rewritten.replace(new RegExp(`src="${escaped}"`, "g"), `src="${dataUri}"`);
  }

  return { html: rewritten, log };
}
