---
name: Compose Send Pipeline Fixes
description: Key patterns for the gmail-inbox.tsx sendMutation, CTA image URL rewriting, and send route error handling.
---

## Safe JSON parse in sendMutation

`await res.json()` unconditionally throws "Unexpected token '<'" when the server returns HTML. Always guard:
```ts
const ct = res.headers.get("content-type") ?? "";
let data: any;
if (ct.includes("application/json")) {
  data = await res.json();
} else {
  const text = await res.text();
  throw new Error(`Send failed (${res.status}): ${text.slice(0, 140)}`);
}
```

**Why:** Express middleware errors (session lookup, resolveAccount failures) reach the error handler before the route's try/catch fires and may produce HTML pages.

## CTA image URL host rewriting

CTA asset `image_url` is stored as an absolute URL at upload time (e.g. `http://localhost:5000/assets/cta/uuid.png`). When the app moves to a different host (dev → prod, Replit URL change), stored URLs break.

Fix applied in both `GET /api/signatures` and `GET /api/signature-ctas`: extract just the filename from the path and reconstruct with the current request's base URL:
```ts
const baseUrl = `${req.headers["x-forwarded-proto"] || req.protocol || "https"}://${req.headers["x-forwarded-host"] || req.headers.host || "localhost:5000"}`;
const fixImgUrl = (u: string | null) => {
  if (!u) return u;
  const m = u.match(/\/assets\/cta\/([^/?#\s]+)$/);
  return m ? `${baseUrl}/assets/cta/${m[1]}` : u;
};
```

**Why:** `/assets/cta/:filename` is served statically from `uploads/cta-assets/` by the public file route (no auth). Rewriting to current host makes thumbnails load regardless of where the file was uploaded.

## Send route pre-try wrapping

`getSessionUserAccess` + `resolveAccount` were outside the route's try/catch. Wrap them in their own try/catch that returns JSON 500:
```ts
let resolved: ... | null = null;
try {
  const { isAdmin: _ia, mailTeamPerms: _mtp } = await getSessionUserAccess(req.session);
  resolved = await resolveAccount(userId, asAccountId, _ia, _mtp);
} catch (_e: any) {
  return res.status(500).json({ message: "Account lookup failed: " + _e?.message });
}
```

In the inner catch (draft fallback), use `resolved?.userId ?? userId` since `resolved` is now typed as nullable (though it's always non-null when the inner catch fires).

## Signatures endpoint: include ctas[]

`GET /api/signatures` now fetches `email_signature_ctas WHERE user_id = userId` and groups them by `signature_id`, returning `{ ...sig, ctas: [...] }`. The compose dialog `EmailSig` type was updated to include `ctas: SigCta[]`.

`activeSignatureHtml` is now computed as `sig.htmlContent + CTA block HTML` rather than just `sig.htmlContent`.
