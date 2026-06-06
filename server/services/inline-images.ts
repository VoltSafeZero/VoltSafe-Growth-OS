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
 *   src="https://host/assets/cta/filename" → same disk fast path
 *   src="https://..."                      → server-side HTTP fetch
 *   src="data:..."                         → already inlined, leave unchanged
 *
 * Logs every conversion attempt with: original src, resolved path/url,
 * bytes loaded, mime type, and final data URI length.
 *
 * Throws a descriptive Error if any image cannot be loaded so the caller
 * can fail the send rather than deliver a broken image.
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
      log.push({ originalSrc: src, resolvedFrom: "skipped", byteSize: 0, mimeType: "", dataUriLen: src.length });
      continue;
    }

    // ── Resolve: /assets/cta/ path (fast path — read from disk) ──────────────
    const ctaMatch = src.match(/\/assets\/cta\/([A-Za-z0-9_][A-Za-z0-9_ .\-]*)(?:[?#]|$)/);

    let imageBuffer: Buffer;
    let mimeType: string;
    let resolvedFrom: "disk" | "http";
    let localPath: string | undefined;
    let fetchUrl: string | undefined;

    if (ctaMatch) {
      const filename = decodeURIComponent(ctaMatch[1]);
      localPath = path.join(ctaAssetsDir, filename);
      if (!fs.existsSync(localPath)) {
        const available = fs.existsSync(ctaAssetsDir) ? fs.readdirSync(ctaAssetsDir).join(", ") : "(dir missing)";
        throw new Error(
          `Signature image not found on disk: "${filename}" (src="${src}")\n` +
          `Expected at: ${localPath}\nAvailable: ${available}`,
        );
      }
      imageBuffer = fs.readFileSync(localPath);
      mimeType = extToMime(filename.split(".").pop() ?? "png");
      resolvedFrom = "disk";
    } else if (/^https?:\/\//i.test(src)) {
      // ── HTTP fetch ──────────────────────────────────────────────────────────
      fetchUrl = src;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const resp = await fetch(src, { signal: controller.signal });
        clearTimeout(timer);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
        }
        const ct = resp.headers.get("content-type") ?? "image/png";
        mimeType = ct.split(";")[0].trim();
        imageBuffer = Buffer.from(await resp.arrayBuffer());
      } catch (e: any) {
        clearTimeout(timer);
        throw new Error(`Could not fetch signature image "${src}": ${e?.message}`);
      }
      resolvedFrom = "http";
    } else {
      // Relative URL that's not /assets/cta/ — skip (e.g. internal API or tracking paths)
      console.log(`[inline-img] SKIP unrecognized src="${src}"`);
      log.push({ originalSrc: src, resolvedFrom: "skipped", byteSize: 0, mimeType: "", dataUriLen: 0 });
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
