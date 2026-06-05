---
name: CTA Asset URL Rewriting
description: GET /api/cta-assets must rewrite public_url to current host; every other CTA route does this but cta-assets was the exception that caused broken images.
---

## Rule
`GET /api/cta-assets` MUST rewrite `public_url` from the DB to the current request host before returning. Do not trust the stored absolute URL.

**Why:** `cta_assets.public_url` is stored as an absolute URL at upload time. When the app moves hosts (dev → prod, workspace URL → .replit.app), the stored URL becomes stale and images break. Every other CTA route (`GET /api/signatures`, `GET /api/signature-ctas`, send route, schedule route) already does this rewrite — `cta-assets` was accidentally omitted and caused all CTA images to show as broken.

**How to apply:** Use the same pattern as all other CTA routes:
```js
const baseUrl = `${req.headers["x-forwarded-proto"] || req.protocol || "https"}://${req.headers["x-forwarded-host"] || req.headers.host || "localhost:5000"}`;
const m = String(r.public_url).match(/\/assets\/cta\/([^/?#\s]+)$/);
return m ? { ...r, public_url: `${baseUrl}/assets/cta/${m[1]}` } : r;
```

The `scripts/fix-cta-image-urls.ts` script repairs stale URLs in the DB (`--dry-run` / `--apply`).

## File locations note
- PNG files are stored in `uploads/cta-assets/` which is ephemeral on Replit.
- If files disappear (container restart/redeploy), users must re-upload via Email Signatures → CTA Assets.
- The `CtaAssetImg` component in `signature-settings.tsx` shows "Missing — re-upload" when the file 404s.
