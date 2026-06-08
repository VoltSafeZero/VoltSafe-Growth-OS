/**
 * cta-asset-resolver — DB-backed 4-step resolver for CTA asset image bytes.
 *
 * Resolution order:
 *   1. DB  — cta_assets.file_data BYTEA (persistent across deploys)
 *   2. Disk — uploads/cta-assets/<filename>
 *   3. Localhost HTTP — Express /assets/cta/:file static route
 *   4. public_url HTTP — canonical stored URL (external, last resort)
 *
 * Every resolved buffer is validated against magic bytes. Buffers that fail
 * are REJECTED and the resolver falls through to the next step.
 * selfHeal() also validates before writing to DB — wrong bytes can never be
 * written back.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";

const CTA_ASSETS_DIR = path.resolve("uploads/cta-assets");

export interface ResolvedCtaAsset {
  data: Buffer;
  mimeType: string;
  // Forensic / identity fields
  source: "db" | "disk" | "localhost" | "public_url";
  dbId?: number;
  dbFilename?: string;
  dbOriginalName?: string;
  dbPublicUrl?: string;
  sha256: string;
  first32hex: string;
  magicOk: boolean;
  detectedMime: string;
  // Image dimensions (null if not decodable or not an image)
  width: number | null;
  height: number | null;
}

function mimeFromFilename(filename: string): string {
  const ext = (filename.split(".").pop() ?? "png").toLowerCase();
  const map: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    webp: "image/webp", gif: "image/gif",
  };
  return map[ext] ?? "image/png";
}

/**
 * Validate magic bytes and determine the actual MIME type.
 */
function checkMagicBytes(buf: Buffer, claimedMime: string): {
  valid: boolean; detected: string; first32hex: string;
} {
  const first32hex = buf.slice(0, 32).toString("hex");
  if (buf.byteLength < 4) return { valid: false, detected: "too_short", first32hex };
  const h = buf.slice(0, 12);
  const isPng  = h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4E && h[3] === 0x47;
  const isJpeg = h[0] === 0xFF && h[1] === 0xD8 && h[2] === 0xFF;
  const isGif  = buf.byteLength >= 6 && buf.slice(0, 6).toString("ascii").startsWith("GIF8");
  const isWebp = buf.byteLength >= 12
    && h.slice(0, 4).toString("ascii") === "RIFF"
    && buf.slice(8, 12).toString("ascii") === "WEBP";
  const detected = isPng ? "image/png" : isJpeg ? "image/jpeg"
                 : isGif ? "image/gif" : isWebp ? "image/webp" : "unknown";
  const cm = claimedMime.toLowerCase();
  const valid = detected !== "unknown" && (
    (detected === "image/png"  && cm.includes("png")) ||
    (detected === "image/jpeg" && (cm.includes("jpeg") || cm.includes("jpg"))) ||
    (detected === "image/gif"  && cm.includes("gif")) ||
    (detected === "image/webp" && cm.includes("webp"))
  );
  return { valid, detected, first32hex };
}

function sha256hex(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * Extract image dimensions from raw bytes.
 * Returns { width, height } or null if format is unknown/unreadable.
 */
function getImageDimensions(buf: Buffer, detectedMime: string): { width: number; height: number } | null {
  try {
    if (detectedMime === "image/png" && buf.byteLength >= 24) {
      // PNG: 8-byte sig + 4-byte IHDR length + 4-byte "IHDR" = 16 bytes offset
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      if (w > 0 && w < 100000 && h > 0 && h < 100000) return { width: w, height: h };
    }
    if (detectedMime === "image/jpeg" && buf.byteLength >= 10) {
      // JPEG: scan for SOF markers (0xFFC0–0xFFC3, 0xFFC5–0xFFC7, 0xFFC9–0xFFCB, 0xFFCD–0xFFCF)
      let offset = 2; // skip SOI
      while (offset < buf.byteLength - 8) {
        if (buf[offset] !== 0xFF) break;
        const marker = buf[offset + 1];
        if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2 || marker === 0xC3
          || marker === 0xC5 || marker === 0xC6 || marker === 0xC7
          || marker === 0xC9 || marker === 0xCA || marker === 0xCB
          || marker === 0xCD || marker === 0xCE || marker === 0xCF) {
          const h = buf.readUInt16BE(offset + 5);
          const w = buf.readUInt16BE(offset + 7);
          if (w > 0 && w < 100000 && h > 0 && h < 100000) return { width: w, height: h };
        }
        if (offset + 3 >= buf.byteLength) break;
        const segLen = buf.readUInt16BE(offset + 2);
        if (segLen < 2) break;
        offset += 2 + segLen;
      }
    }
    if (detectedMime === "image/gif" && buf.byteLength >= 10) {
      // GIF: bytes 6-7 = width LE, 8-9 = height LE
      const w = buf.readUInt16LE(6);
      const h = buf.readUInt16LE(8);
      if (w > 0 && w < 100000 && h > 0 && h < 100000) return { width: w, height: h };
    }
    if (detectedMime === "image/webp" && buf.byteLength >= 30) {
      const type = buf.slice(12, 16).toString("ascii");
      if (type === "VP8 " && buf.byteLength >= 34) {
        // VP8 lossy: bitstream starts at byte 20 (after chunk header); skip 3-byte frame tag + 3-byte start code
        const w = (buf.readUInt16LE(26) & 0x3FFF) + 1;
        const h = (buf.readUInt16LE(28) & 0x3FFF) + 1;
        if (w > 0 && w < 100000 && h > 0 && h < 100000) return { width: w, height: h };
      }
      if (type === "VP8L" && buf.byteLength >= 25) {
        // VP8L: after 4-byte chunk size, signature byte 0x2F, then 14+14 bits
        const bits = buf.readUInt32LE(21);
        const w = (bits & 0x3FFF) + 1;
        const h = ((bits >> 14) & 0x3FFF) + 1;
        if (w > 0 && w < 100000 && h > 0 && h < 100000) return { width: w, height: h };
      }
      if (type === "VP8X" && buf.byteLength >= 30) {
        const w = (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1;
        const h = (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1;
        if (w > 0 && w < 100000 && h > 0 && h < 100000) return { width: w, height: h };
      }
    }
  } catch { /* ignore parse errors */ }
  return null;
}

export interface CtaAssetHealth {
  exists: boolean;
  is_archived: boolean;
  has_file_data: boolean;
  id?: number;
  filename?: string;
  original_name?: string;
}

/** Quick DB-only check — does NOT load bytes. Used for pre-send validation. */
export async function getCtaAssetHealth(filename: string): Promise<CtaAssetHealth> {
  try {
    const safeF = filename.replace(/'/g, "''");
    const rows = (await db.execute(sql.raw(
      `SELECT id, filename, original_name, is_archived, ` +
      `(file_data IS NOT NULL AND octet_length(file_data) > 0) AS has_file_data ` +
      `FROM cta_assets WHERE filename = '${safeF}' OR public_url LIKE '%/${safeF}' LIMIT 1`,
    ))).rows as any[];
    if (!rows.length) return { exists: false, is_archived: false, has_file_data: false };
    const r = rows[0];
    return {
      exists: true,
      is_archived: !!r.is_archived,
      has_file_data: !!r.has_file_data,
      id: Number(r.id),
      filename: String(r.filename),
      original_name: r.original_name ? String(r.original_name) : undefined,
    };
  } catch (e: any) {
    console.warn(`[cta-health-check] DB error for "${filename}":`, e?.message);
    return { exists: false, is_archived: false, has_file_data: false };
  }
}

export async function resolveCtaAsset(
  filename: string,
): Promise<ResolvedCtaAsset | null> {
  const safeFilename = filename.replace(/'/g, "''");
  console.log("[CID-RESOLVE-START]", { filename });

  // ── Helper: persist valid bytes to file_data (validates magic first) ──────
  async function selfHeal(buf: Buffer, mime: string): Promise<void> {
    const { valid, detected } = checkMagicBytes(buf, mime);
    if (!valid) {
      console.error(`[CID-MAGIC-FAIL] selfHeal BLOCKED — would poison DB ` +
        `filename="${filename}" claimedMime=${mime} detectedMime=${detected} bytes=${buf.byteLength}`);
      return;
    }
    try {
      const hexStr = buf.toString("hex");
      await db.execute(sql.raw(
        `UPDATE cta_assets SET file_data = decode('${hexStr}', 'hex') ` +
        `WHERE (filename = '${safeFilename}' OR public_url LIKE '%/${safeFilename}') ` +
        `AND is_archived = FALSE AND (file_data IS NULL OR octet_length(file_data) = 0)`,
      ));
      console.log(`[cta-resolver] self-healed file_data filename="${filename}" bytes=${buf.byteLength}`);
    } catch (e: any) {
      console.warn(`[cta-resolver] self-heal error:`, e?.message);
    }
  }

  // ── STEP 1: DB file_data ──────────────────────────────────────────────────
  try {
    const rows = (await db.execute(sql.raw(
      `SELECT id, filename, original_name, public_url, file_data, mime_type FROM cta_assets ` +
      `WHERE (filename = '${safeFilename}' OR public_url LIKE '%/${safeFilename}') ` +
      `AND is_archived = FALSE LIMIT 1`,
    ))).rows as any[];
    const row = rows[0];
    const foundFileData = !!row?.file_data;
    const fileDataBytes = foundFileData
      ? (Buffer.isBuffer(row.file_data) ? row.file_data.byteLength : Buffer.from(row.file_data).length)
      : 0;
    console.log("[CID-RESOLVE-DB]", {
      filename, foundRow: !!row, dbId: row?.id,
      dbFilename: row?.filename, dbOriginalName: row?.original_name,
      dbPublicUrl: String(row?.public_url || "").slice(0, 80),
      dbMimeType: row?.mime_type, foundFileData, fileDataBytes,
    });
    if (row?.file_data) {
      const buf = Buffer.isBuffer(row.file_data) ? row.file_data : Buffer.from(row.file_data);
      const claimedMime = row.mime_type || mimeFromFilename(filename);
      const sha256 = sha256hex(buf);
      const { valid, detected, first32hex } = checkMagicBytes(buf, claimedMime);
      const dims = valid ? getImageDimensions(buf, detected) : null;
      console.log("[CID-FORENSIC-DB]", {
        filename, source: "db", dbId: row.id, dbFilename: row.filename,
        dbOriginalName: row.original_name,
        dbPublicUrl: String(row.public_url || "").slice(0, 80),
        claimedMime, sha256, first32hex, detectedMime: detected, magicOk: valid,
        bytes: buf.byteLength, width: dims?.width ?? null, height: dims?.height ?? null,
      });
      if (!valid) {
        console.error(`[CID-MAGIC-FAIL] source=db filename="${filename}" ` +
          `claimedMime=${claimedMime} detectedMime=${detected} first32hex=${first32hex} ` +
          `sha256=${sha256} bytes=${buf.byteLength} — REJECTING, trying fallback steps`);
      } else {
        return {
          data: buf, mimeType: claimedMime, source: "db",
          dbId: Number(row.id), dbFilename: String(row.filename),
          dbOriginalName: row.original_name ? String(row.original_name) : undefined,
          dbPublicUrl: String(row.public_url || ""),
          sha256, first32hex, magicOk: true, detectedMime: detected,
          width: dims?.width ?? null, height: dims?.height ?? null,
        };
      }
    }
  } catch (e: any) {
    console.warn(`[cta-resolver] DB lookup error for "${filename}":`, e?.message);
  }

  // ── STEP 2: Disk ──────────────────────────────────────────────────────────
  const diskPath = path.join(CTA_ASSETS_DIR, filename);
  try {
    const diskExists = fs.existsSync(diskPath);
    console.log("[CID-RESOLVE-DISK]", { filename, diskPath, exists: diskExists });
    if (diskExists) {
      const buf = fs.readFileSync(diskPath);
      const mime = mimeFromFilename(filename);
      const sha256 = sha256hex(buf);
      const { valid, detected, first32hex } = checkMagicBytes(buf, mime);
      const dims = valid ? getImageDimensions(buf, detected) : null;
      console.log("[CID-FORENSIC-DISK]", {
        filename, source: "disk", sha256, first32hex, detectedMime: detected, magicOk: valid,
        bytes: buf.byteLength, width: dims?.width ?? null, height: dims?.height ?? null,
      });
      if (!valid) {
        console.error(`[CID-MAGIC-FAIL] source=disk filename="${filename}" claimedMime=${mime} detectedMime=${detected} first32hex=${first32hex} — REJECTING`);
      } else {
        await selfHeal(buf, mime);
        return {
          data: buf, mimeType: mime, source: "disk",
          sha256, first32hex, magicOk: true, detectedMime: detected,
          width: dims?.width ?? null, height: dims?.height ?? null,
        };
      }
    }
  } catch (e: any) {
    console.warn(`[cta-resolver] disk read error for "${filename}":`, e?.message);
  }

  // ── STEP 3: Localhost HTTP ─────────────────────────────────────────────────
  try {
    const port = process.env.PORT || 5000;
    const localUrl = `http://127.0.0.1:${port}/assets/cta/${encodeURIComponent(filename)}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const resp = await fetch(localUrl, { signal: ctrl.signal });
    clearTimeout(t);
    if (resp.ok) {
      const buf = Buffer.from(await resp.arrayBuffer());
      const mime = (resp.headers.get("content-type") || mimeFromFilename(filename)).split(";")[0].trim();
      const sha256 = sha256hex(buf);
      const { valid, detected, first32hex } = checkMagicBytes(buf, mime);
      const dims = valid ? getImageDimensions(buf, detected) : null;
      console.log("[CID-FORENSIC-HTTP]", {
        filename, source: "localhost", sha256, first32hex, detectedMime: detected, magicOk: valid,
        bytes: buf.byteLength, width: dims?.width ?? null, height: dims?.height ?? null,
      });
      if (!valid) {
        console.error(`[CID-MAGIC-FAIL] source=localhost filename="${filename}" claimedMime=${mime} detectedMime=${detected} first32hex=${first32hex} — REJECTING`);
      } else {
        await selfHeal(buf, mime);
        return {
          data: buf, mimeType: mime, source: "localhost",
          sha256, first32hex, magicOk: true, detectedMime: detected,
          width: dims?.width ?? null, height: dims?.height ?? null,
        };
      }
    } else {
      console.warn(`[cta-resolver] localhost miss status=${resp.status} filename="${filename}"`);
    }
  } catch (e: any) {
    console.warn(`[cta-resolver] localhost fetch error for "${filename}":`, e?.message);
  }

  // ── STEP 4: public_url from DB ─────────────────────────────────────────────
  try {
    const rows = (await db.execute(sql.raw(
      `SELECT id, original_name, public_url, mime_type FROM cta_assets ` +
      `WHERE (filename = '${safeFilename}' OR public_url LIKE '%/${safeFilename}') LIMIT 1`,
    ))).rows as any[];
    const row = rows[0];
    const rawPubUrl = row?.public_url;
    console.log("[CID-RESOLVE-STEP4]", {
      filename, dbId: row?.id, dbOriginalName: row?.original_name,
      rawPubUrl: String(rawPubUrl || "").slice(0, 80), dbMime: row?.mime_type,
    });
    if (rawPubUrl) {
      const port = process.env.PORT || 5000;
      const absUrl = String(rawPubUrl).startsWith("http")
        ? String(rawPubUrl)
        : `http://127.0.0.1:${port}${rawPubUrl}`;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const resp = await fetch(absUrl, { signal: ctrl.signal });
      clearTimeout(t);
      if (resp.ok) {
        const buf = Buffer.from(await resp.arrayBuffer());
        const mime = (row?.mime_type || resp.headers.get("content-type") || mimeFromFilename(filename)).split(";")[0].trim();
        const sha256 = sha256hex(buf);
        const { valid, detected, first32hex } = checkMagicBytes(buf, mime);
        const dims = valid ? getImageDimensions(buf, detected) : null;
        console.log("[CID-FORENSIC-PUBURL]", {
          filename, source: "public_url", dbId: row?.id,
          dbOriginalName: row?.original_name,
          absUrl: absUrl.slice(0, 100), sha256, first32hex, detectedMime: detected,
          magicOk: valid, bytes: buf.byteLength,
          width: dims?.width ?? null, height: dims?.height ?? null,
        });
        if (!valid) {
          console.error(`[CID-MAGIC-FAIL] source=public_url filename="${filename}" claimedMime=${mime} detectedMime=${detected} first32hex=${first32hex} sha256=${sha256} — REJECTING`);
        } else {
          await selfHeal(buf, mime);
          return {
            data: buf, mimeType: mime, source: "public_url",
            dbId: row?.id ? Number(row.id) : undefined,
            dbOriginalName: row?.original_name ? String(row.original_name) : undefined,
            dbPublicUrl: absUrl,
            sha256, first32hex, magicOk: true, detectedMime: detected,
            width: dims?.width ?? null, height: dims?.height ?? null,
          };
        }
      } else {
        console.error(`[cta-resolver] public_url miss status=${resp.status} filename="${filename}" url="${absUrl.slice(0, 80)}"`);
      }
    }
  } catch (e: any) {
    console.error(`[cta-resolver] public_url fetch error for "${filename}":`, e?.message);
  }

  console.log("[CID-RESOLVE-FAIL]", { filename });
  console.error(`[cta-resolver] ALL 4 steps failed (or all returned invalid/wrong bytes) for filename="${filename}"`);
  return null;
}
