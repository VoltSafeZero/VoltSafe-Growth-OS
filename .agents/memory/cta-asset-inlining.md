---
name: CTA Asset Inlining Hardening
description: How CTA images survive production disk wipes and reach Apple Mail as CID parts.
---

## The problem
After a Replit deployment the container disk is wiped. CTA assets uploaded before the
memoryStorage migration had NULL file_data in the DB, so all 4 resolver steps failed
and no CID part was emitted — Apple Mail showed a broken image.

## The fix (resolver v5)
`resolveCtaImagesInHtml` in server/routes.ts runs 5 steps per src URL:
1. DB file_data (exact filename OR public_url LIKE '%/filename')
2. Disk (path.join(CTA_ASSETS_DIR, filename))
3. Localhost HTTP — Express static route
4. public_url from DB — relative (/assets/cta/…) prefixed with http://127.0.0.1:PORT
5. Direct fetch of the original absolute src URL (catches no-DB-row cases)
After any step 2-5 succeeds, selfHeal() UPDATEs file_data so the next send hits step 1.

`resolveCtaAsset` in server/services/cta-asset-resolver.ts mirrors the same relative-URL
fix in step 4, and also calls selfHeal() after steps 2/3/4.

## Upload pipeline (memoryStorage)
ctaUpload was changed from diskStorage to memoryStorage. The handler now:
- Generates the UUID filename itself (crypto.randomUUID() + ext)
- INSERTs file_data in the same statement (decode(hex, 'hex'))
- Writes to disk after DB — non-fatal if disk write fails

**Why:** Replit production disk is ephemeral. file_data in DB is the only durable copy.

## Backfill for existing rows
POST /api/admin/cta-assets/backfill-file-data (requireAdmin) walks all rows with
NULL/empty file_data and tries disk → localhost → public_url, then UPDATEs file_data.
Run once after deploying this version to heal the existing UUID asset.

## Logging markers
- [CTA-CID-LIVE-VERSION-2026-06-08-0435] in POST /api/gmail/send and extractCtaInlineImages
- [CID-RESOLVE-FILENAME] / [CID-RESOLVE-RESULT] per-filename in extractCtaInlineImages
- [CID-RESOLVE-STEP4] in resolveCtaAsset
- [CID-RESOLVE-FAIL] on total failure
