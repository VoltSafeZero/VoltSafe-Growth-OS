/**
 * cta-asset-resolver — DB-backed 4-step resolver for CTA asset image bytes.
 *
 * Used by extractCtaInlineImages() in gmail.ts so the FINAL-CID-GATE inside
 * sendEmail() can convert /assets/cta/:filename src values to CID MIME parts
 * even when the server's ephemeral disk has been wiped on a production restart.
 *
 * Resolution order:
 *   1. DB  — cta_assets.file_data BYTEA column (persistent across deploys)
 *   2. Disk — uploads/cta-assets/<filename> (fast when available)
 *   3. Localhost HTTP — same process Express /assets/cta/:file static route
 *   4. public_url HTTP — canonical stored URL (external, last resort)
 *
 * Every resolved result is validated against the claimed MIME type using magic
 * bytes.  Bytes that fail validation are REJECTED — they are never returned to
 * the caller and are never written to the DB via selfHeal().
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
  // Forensic fields — logged by callers, checked in FINAL-CID-GATE.
  source: "db" | "disk" | "localhost" | "public_url";
  dbId?: number;
  dbFilename?: string;
  dbPublicUrl?: string;
  sha256: string;
  first32hex: string;
  magicOk: boolean;
  detectedMime: string;
}

function mimeFromFilename(filename: string): string {
  const ext = (filename.split(".").pop() ?? "png").toLowerCase();
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
  };
  return map[ext] ?? "image/png";
}

/**
 * Inspect magic bytes and determine if they match the claimed MIME type.
 * Returns { valid, detected, first32hex } — valid is TRUE only when the
 * bytes are a real image AND match the claimed MIME type.
 */
function checkMagicBytes(buf: Buffer, claimedMime: string): {
  valid: boolean;
  detected: string;
  first32hex: string;
} {
  const first32hex = buf.slice(0, 32).toString("hex");
  if (buf.byteLength < 4) {
    return { valid: false, detected: "too_short", first32hex };
  }
  const h = buf.slice(0, 12);
  const isPng  = h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4E && h[3] === 0x47;
  const isJpeg = h[0] === 0xFF && h[1] === 0xD8 && h[2] === 0xFF;
  const isGif  = buf.byteLength >= 6 && buf.slice(0, 6).toString("ascii").startsWith("GIF8");
  const isWebp = buf.byteLength >= 12
    && h.slice(0, 4).toString("ascii") === "RIFF"
    && buf.slice(8, 12).toString("ascii") === "WEBP";

  const detected = isPng  ? "image/png"
                 : isJpeg ? "image/jpeg"
                 : isGif  ? "image/gif"
                 : isWebp ? "image/webp"
                 : "unknown";

  const cm = claimedMime.toLowerCase();
  const valid = detected !== "unknown" && (
    (detected === "image/png"  && (cm.includes("png"))) ||
    (detected === "image/jpeg" && (cm.includes("jpeg") || cm.includes("jpg"))) ||
    (detected === "image/gif"  && cm.includes("gif")) ||
    (detected === "image/webp" && cm.includes("webp"))
  );
  return { valid, detected, first32hex };
}

function sha256hex(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export async function resolveCtaAsset(
  filename: string,
): Promise<ResolvedCtaAsset | null> {
  const safeFilename = filename.replace(/'/g, "''");
  console.log("[CID-RESOLVE-START]", { filename });

  // ── STEP 1: DB file_data ─────────────────────────────────────────────────
  // Persistent across deploys. Also tries public_url LIKE so UUID-named rows
  // are found when public_url ends with the UUID even if filename differs.
  try {
    const rows = (await db.execute(sql.raw(
      `SELECT id, filename, public_url, file_data, mime_type FROM cta_assets ` +
      `WHERE (filename = '${safeFilename}' OR public_url LIKE '%/${safeFilename}') ` +
      `AND is_archived = FALSE LIMIT 1`,
    ))).rows as any[];
    const row = rows[0];
    const foundDb = !!row?.file_data;
    const fileDataBytes = foundDb
      ? (Buffer.isBuffer(row.file_data) ? row.file_data.byteLength : Buffer.from(row.file_data).length)
      : 0;
    console.log("[CID-RESOLVE-DB]", {
      filename,
      foundRow: !!row,
      dbId: row?.id,
      dbFilename: row?.filename,
      dbPublicUrl: String(row?.public_url || "").slice(0, 80),
      dbMimeType: row?.mime_type,
      foundFileData: foundDb,
      fileDataBytes,
    });
    if (row?.file_data) {
      const buf = Buffer.isBuffer(row.file_data) ? row.file_data : Buffer.from(row.file_data);
      const claimedMime = row.mime_type || mimeFromFilename(filename);
      const sha256 = sha256hex(buf);
      const { valid, detected, first32hex } = checkMagicBytes(buf, claimedMime);
      console.log("[CID-FORENSIC-DB]", {
        filename,
        source: "db",
        dbId: row.id,
        dbFilename: row.filename,
        dbPublicUrl: String(row.public_url || "").slice(0, 80),
        claimedMime,
        sha256,
        first32hex,
        detectedMime: detected,
        magicOk: valid,
        bytes: buf.byteLength,
      });
      if (!valid) {
        console.error(`[CID-MAGIC-FAIL] source=db filename="${filename}" ` +
          `claimedMime=${claimedMime} detectedMime=${detected} first32hex=${first32hex} ` +
          `sha256=${sha256} bytes=${buf.byteLength} — REJECTING, trying fallback steps`);
        // Do NOT return these bytes; fall through to disk/HTTP steps.
      } else {
        return {
          data: buf,
          mimeType: claimedMime,
          source: "db",
          dbId: Number(row.id),
          dbFilename: String(row.filename),
          dbPublicUrl: String(row.public_url || ""),
          sha256,
          first32hex,
          magicOk: true,
          detectedMime: detected,
        };
      }
    }
  } catch (e: any) {
    console.warn(`[cta-resolver] DB lookup error for "${filename}":`, e?.message);
  }

  // ── Helper: persist bytes to file_data ONLY when magic bytes are valid ───
  async function selfHeal(buf: Buffer, mime: string): Promise<void> {
    const { valid, detected } = checkMagicBytes(buf, mime);
    if (!valid) {
      console.error(`[CID-MAGIC-FAIL] selfHeal BLOCKED — would have poisoned DB ` +
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
      console.log(`[cta-resolver] self-healed file_data filename="${filename}" bytes=${buf.byteLength} mime=${mime}`);
    } catch (healErr: any) {
      console.warn(`[cta-resolver] self-heal error filename="${filename}":`, healErr?.message);
    }
  }

  // ── STEP 2: Disk ─────────────────────────────────────────────────────────
  const diskPath = path.join(CTA_ASSETS_DIR, filename);
  try {
    const diskExists = fs.existsSync(diskPath);
    console.log("[CID-RESOLVE-DISK]", { filename, diskPath, exists: diskExists });
    if (diskExists) {
      const buf = fs.readFileSync(diskPath);
      const mime = mimeFromFilename(filename);
      const sha256 = sha256hex(buf);
      const { valid, detected, first32hex } = checkMagicBytes(buf, mime);
      console.log("[CID-FORENSIC-DISK]", { filename, source: "disk", sha256, first32hex, detectedMime: detected, magicOk: valid, bytes: buf.byteLength });
      if (!valid) {
        console.error(`[CID-MAGIC-FAIL] source=disk filename="${filename}" claimedMime=${mime} detectedMime=${detected} first32hex=${first32hex} — REJECTING`);
      } else {
        await selfHeal(buf, mime);
        return { data: buf, mimeType: mime, source: "disk", sha256, first32hex, magicOk: true, detectedMime: detected };
      }
    }
  } catch (e: any) {
    console.warn(`[cta-resolver] disk read error for "${filename}":`, e?.message);
  }

  // ── STEP 3: Localhost HTTP ────────────────────────────────────────────────
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
      console.log("[CID-FORENSIC-HTTP]", { filename, source: "localhost", url: localUrl, sha256, first32hex, detectedMime: detected, magicOk: valid, bytes: buf.byteLength });
      if (!valid) {
        console.error(`[CID-MAGIC-FAIL] source=localhost filename="${filename}" claimedMime=${mime} detectedMime=${detected} first32hex=${first32hex} — REJECTING`);
      } else {
        await selfHeal(buf, mime);
        return { data: buf, mimeType: mime, source: "localhost", sha256, first32hex, magicOk: true, detectedMime: detected };
      }
    } else {
      console.warn(`[cta-resolver] localhost miss status=${resp.status} filename="${filename}"`);
    }
  } catch (e: any) {
    console.warn(`[cta-resolver] localhost fetch error for "${filename}":`, e?.message);
  }

  // ── STEP 4: public_url from DB ────────────────────────────────────────────
  // Handles both absolute (https://…) and relative (/assets/cta/…) values.
  try {
    const rows = (await db.execute(sql.raw(
      `SELECT id, public_url, mime_type FROM cta_assets ` +
      `WHERE (filename = '${safeFilename}' OR public_url LIKE '%/${safeFilename}') LIMIT 1`,
    ))).rows as any[];
    const row = rows[0];
    const rawPubUrl = row?.public_url;
    console.log("[CID-RESOLVE-STEP4]", {
      filename,
      dbId: row?.id,
      rawPubUrl: String(rawPubUrl || "").slice(0, 80),
      dbMime: row?.mime_type,
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
        console.log("[CID-FORENSIC-PUBURL]", {
          filename,
          source: "public_url",
          dbId: row?.id,
          absUrl: absUrl.slice(0, 100),
          sha256,
          first32hex,
          detectedMime: detected,
          magicOk: valid,
          bytes: buf.byteLength,
        });
        if (!valid) {
          console.error(`[CID-MAGIC-FAIL] source=public_url filename="${filename}" claimedMime=${mime} detectedMime=${detected} first32hex=${first32hex} sha256=${sha256} — REJECTING`);
        } else {
          await selfHeal(buf, mime);
          return {
            data: buf,
            mimeType: mime,
            source: "public_url",
            dbId: row?.id ? Number(row.id) : undefined,
            dbPublicUrl: absUrl,
            sha256,
            first32hex,
            magicOk: true,
            detectedMime: detected,
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
  console.error(`[cta-resolver] ALL 4 steps failed (or all returned invalid magic bytes) for filename="${filename}"`);
  return null;
}
