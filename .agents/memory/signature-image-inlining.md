---
name: Signature Image Inlining
description: How CTA images are stored and inlined into outgoing emails; why disk-at-send-time fails in production.
---

## The problem
`uploads/cta-assets/` is ephemeral in Replit Deployments — files are lost after a restart. The original `inlineImagesAsBase64` threw a hard error when the file wasn't on disk, causing the outer send-route catch to return 503 for every email that used a signature with a CTA image.

## The fix (two layers)

### Layer 1 — non-fatal inlining (`server/services/inline-images.ts`)
- Disk miss → fall back to HTTP fetch of the same URL
- HTTP fetch fail → log warning, **skip** (keep original src) — email still sends
- Hard throws are gone; the send is never blocked by an unresolvable image

### Layer 2 — data URI storage (the real fix)
At upload time and when listing assets, the server computes a base64 data URI from the file buffer:
- `POST /api/cta-assets/upload` → returns `{ ...row, data_uri }`
- `GET /api/cta-assets` → each asset includes `data_uri` (null if file missing from disk)

The frontend (`signature-settings.tsx`) stores `asset.data_uri || asset.public_url` in `ctaConfig.imageUrl`, which is then persisted as `email_signatures.cta_image_url`.

At send time:
1. `wrapHtmlWithCtaAsset` puts the stored value into `<img src="...">`.
2. `inlineImagesAsBase64` sees `src="data:..."` → skips immediately (already inlined).
3. Email goes out with base64 image — works in all email clients, no disk/network access needed.

## Why
**Why:** `uploads/` is ephemeral in production Replit Deployments. Any approach that reads files from disk at send time will fail after a restart. Storing the data URI at upload/creation time makes the signature self-contained in the DB.

## How to apply
- New uploads and re-picks from the asset library automatically get data URIs stored.
- Existing signatures with stale public_url in cta_image_url: user must re-edit the signature and re-pick the CTA image to get the data URI stored. Until then, Layer 1 (non-fatal) ensures emails still send.
- Never hard-throw inside inlineImagesAsBase64 — it runs inside the send route's outer try/catch which returns 503 on any error.
