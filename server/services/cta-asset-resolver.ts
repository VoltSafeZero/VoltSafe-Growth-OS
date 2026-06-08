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
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import * as path from "path";
import * as fs from "fs";

const CTA_ASSETS_DIR = path.resolve("uploads/cta-assets");

export interface ResolvedCtaAsset {
  data: Buffer;
  mimeType: string;
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

export async function resolveCtaAsset(
  filename: string,
): Promise<ResolvedCtaAsset | null> {
  const safeFilename = filename.replace(/'/g, "''");

  // 1. DB file_data — persistent, survives production disk wipes
  try {
    const rows = (await db.execute(sql.raw(
      `SELECT file_data, mime_type FROM cta_assets WHERE filename = '${safeFilename}' AND is_archived = FALSE LIMIT 1`,
    ))).rows as any[];
    if (rows[0]?.file_data) {
      const buf = Buffer.isBuffer(rows[0].file_data)
        ? rows[0].file_data
        : Buffer.from(rows[0].file_data);
      const mime = rows[0].mime_type || mimeFromFilename(filename);
      console.log(`[cta-resolver] DB file_data hit filename="${filename}" bytes=${buf.byteLength}`);
      return { data: buf, mimeType: mime };
    }
  } catch (e: any) {
    console.warn(`[cta-resolver] DB lookup error for "${filename}":`, e?.message);
  }

  // 2. Disk
  const diskPath = path.join(CTA_ASSETS_DIR, filename);
  try {
    if (fs.existsSync(diskPath)) {
      const buf = fs.readFileSync(diskPath);
      console.log(`[cta-resolver] disk hit filename="${filename}" bytes=${buf.byteLength}`);
      return { data: buf, mimeType: mimeFromFilename(filename) };
    }
  } catch (e: any) {
    console.warn(`[cta-resolver] disk read error for "${filename}":`, e?.message);
  }

  // 3. Localhost HTTP (same process — hits the Express /assets/cta/:file static route)
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
      console.log(`[cta-resolver] localhost hit filename="${filename}" bytes=${buf.byteLength}`);
      return { data: buf, mimeType: mime };
    }
    console.warn(`[cta-resolver] localhost miss status=${resp.status} filename="${filename}"`);
  } catch (e: any) {
    console.warn(`[cta-resolver] localhost fetch error for "${filename}":`, e?.message);
  }

  // 4. Stored public_url from DB (external HTTP, absolute last resort)
  try {
    const rows = (await db.execute(sql.raw(
      `SELECT public_url FROM cta_assets WHERE filename = '${safeFilename}' LIMIT 1`,
    ))).rows as any[];
    const pubUrl = rows[0]?.public_url;
    if (pubUrl && String(pubUrl).startsWith("http")) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const resp = await fetch(String(pubUrl), { signal: ctrl.signal });
      clearTimeout(t);
      if (resp.ok) {
        const buf = Buffer.from(await resp.arrayBuffer());
        const mime = (resp.headers.get("content-type") || mimeFromFilename(filename)).split(";")[0].trim();
        console.log(`[cta-resolver] public_url hit filename="${filename}" url="${String(pubUrl).slice(0, 80)}" bytes=${buf.byteLength}`);
        return { data: buf, mimeType: mime };
      }
      console.error(`[cta-resolver] public_url miss status=${resp.status} filename="${filename}" url="${String(pubUrl).slice(0, 80)}"`);
    }
  } catch (e: any) {
    console.error(`[cta-resolver] public_url fetch error for "${filename}":`, e?.message);
  }

  console.error(`[cta-resolver] ALL 4 methods failed for filename="${filename}" — CTA image will be missing`);
  return null;
}
