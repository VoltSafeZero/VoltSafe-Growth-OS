---
name: Signature CID inline images — Content-Disposition
description: Apple Mail requires Content-Disposition: inline on CID MIME parts; without it, images appear both inline AND as attachments.
---

## Rule
CID inline image MIME parts in `inlineParts()` (server/gmail.ts) MUST include
`Content-Disposition: inline` (no filename parameter).

## Why
Apple Mail 16+ (Ventura/Sonoma) treats CID MIME parts WITHOUT
Content-Disposition as both inline (rendered at the <img> position) AND as an
attachment. On desktop this shows as a download card named after the alt text;
on mobile it renders the image again at full size below the email body.

`Content-Disposition: inline` (no filename) suppresses the attachment
rendering without giving the image a user-visible filename.

A previous concern that adding Content-Disposition would CAUSE named attachment
listing was based on an undocumented test with `Content-Disposition: attachment`
— not `inline`. The `inline` variant is safe.

## How to apply
When generating MIME inline image parts (any multipart/related construction),
always emit:
```
Content-Type: image/png
Content-Transfer-Encoding: base64
Content-ID: <cid>
Content-Disposition: inline
```
The Gmail has_attachments flag will remain false for properly structured emails.

## srcdoc iframe base URL
CID proxy URLs are relative (/api/gmail/messages/…). srcdoc iframes need
`<base href="/">` in their <head> to resolve these correctly. Added to the
srcDoc template in gmail-inbox.tsx MessageBody component.
