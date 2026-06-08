import path from "path";
import fs from "fs";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const CTA_ASSETS_DIR = path.resolve("uploads/cta-assets");

async function main() {
  console.log("=== CID Pipeline Diagnostic ===\n");

  // 1. Raw DB lookup — see exactly what type file_data returns as
  const rawRows = (await db.execute(sql.raw(
    "SELECT file_data, mime_type FROM cta_assets WHERE filename = 'WatchDemo_Thumbnail_200.png' AND is_archived = FALSE LIMIT 1"
  ))).rows;
  const row = rawRows[0] as any;
  console.log("[1] DB raw row:", {
    found: !!row,
    fileDataType: row?.file_data ? typeof row.file_data : "missing",
    isBuffer: row?.file_data ? Buffer.isBuffer(row.file_data) : false,
    isUint8Array: row?.file_data instanceof Uint8Array,
    constructorName: row?.file_data?.constructor?.name ?? "none",
    byteLength: row?.file_data
      ? Buffer.isBuffer(row.file_data)
        ? row.file_data.byteLength
        : Buffer.from(row.file_data).length
      : 0,
    mimeType: row?.mime_type,
  });

  // 2. Disk check
  const diskPath = path.join(CTA_ASSETS_DIR, "WatchDemo_Thumbnail_200.png");
  console.log("\n[2] Disk:", { exists: fs.existsSync(diskPath), path: diskPath });

  // 3. Full resolveCtaAsset
  const { resolveCtaAsset } = await import("../server/services/cta-asset-resolver");
  const r1 = await resolveCtaAsset("WatchDemo_Thumbnail_200.png");
  const r2 = await resolveCtaAsset("WatchDemo_Thumbnail_600.png");
  console.log("\n[3] resolveCtaAsset(WatchDemo_Thumbnail_200.png):", r1 ? `OK bytes=${r1.data.byteLength} mime=${r1.mimeType}` : "RETURNED NULL ← BUG");
  console.log("[3] resolveCtaAsset(WatchDemo_Thumbnail_600.png):", r2 ? `OK bytes=${r2.data.byteLength} mime=${r2.mimeType}` : "RETURNED NULL ← BUG");

  // 4. extractCtaInlineImages — sig marker path
  const { extractCtaInlineImages } = await import("../server/gmail");
  const html = [
    "<html><body><p>Hello world</p>",
    "<!--vs-sig-start-->",
    "<table><tr><td>",
    '<a href="#"><img src="https://myhost.replit.app/assets/cta/WatchDemo_Thumbnail_200.png" width="200"/></a>',
    '<a href="#"><img src="https://myhost.replit.app/assets/cta/WatchDemo_Thumbnail_600.png" width="200"/></a>',
    "</td></tr></table>",
    "<!--vs-sig-end-->",
    "</body></html>",
  ].join("");

  console.log("\n[4] extractCtaInlineImages (sig-marker path)...");
  const res = await extractCtaInlineImages(html, CTA_ASSETS_DIR);
  console.log("[4] result:", {
    inlineImagesCount: res.inlineImages.length,
    cids: res.inlineImages.map((i) => `${i.cid} (${i.data.byteLength}B mime=${i.mimeType})`),
    htmlHasCidRef: /src="cid:/.test(res.html),
    htmlStillHasOrigUrlInSrc: /<img[^>]*src="[^"]*\/assets\/cta\//.test(res.html),
  });

  // 5. extractCtaInlineImages — legacy path (no sig markers)
  const htmlLegacy = html.replace("<!--vs-sig-start-->", "").replace("<!--vs-sig-end-->", "");
  console.log("\n[5] extractCtaInlineImages (legacy path, no sig markers)...");
  const resLegacy = await extractCtaInlineImages(htmlLegacy, CTA_ASSETS_DIR);
  console.log("[5] result:", {
    inlineImagesCount: resLegacy.inlineImages.length,
    cids: resLegacy.inlineImages.map((i) => `${i.cid} (${i.data.byteLength}B)`),
    htmlHasCidRef: /src="cid:/.test(resLegacy.html),
  });

  console.log("\n=== Done ===");
  process.exit(0);
}

main().catch((e) => {
  console.error("[FATAL]", e.message, e.stack);
  process.exit(1);
});
