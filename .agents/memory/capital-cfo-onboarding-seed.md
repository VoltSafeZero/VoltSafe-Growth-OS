---
name: Capital CFO onboarding sample-data seed
description: How the idempotent Capital module seed package works, and the email-allowlist bug it uncovered.
---

The Capital module was already fully gated by `requireCapitalAccess`
(`server/routes-capital.ts`) to Trevor + Scott only, so a CFO onboarding
sample-data package didn't need any new per-row ACL — just an `is_sample`
flag on rows plus an idempotency guard.

**Idempotency pattern:** a dedicated `capital_seed_log` table with a
`UNIQUE seed_key` column, checked before any insert. Re-running the seed
(including on every server boot) is a no-op once the key is present. This is
a reusable pattern for any future one-time sample/demo data package — don't
gate idempotency on "does row X exist", gate it on a seed-log key.

**Real bug found while building this:** the Capital email allowlist had
`scott.carlson@voltsafe.com` hardcoded in three places (`routes-capital.ts`
+ two spots in `routes.ts`) instead of Scott's actual login email
`scott@voltsafe.com` (per `server/auth.ts`). Scott had zero Capital access
until this was fixed. When adding a new user to any hardcoded email
allowlist, always cross-check against the real `users` table email, not an
assumed/legacy alias.

**Learn tab access restriction:** `client/src/data/training-hub.ts`
playlists/videos didn't have any visibility restriction concept. Added an
optional `restrictedToEmails?: string[]` field on both `TrainingPlaylist`
and `TrainingVideo`; filtering happens client-side in `training-hub.tsx`
against `/api/auth/me`'s `email` field. This is a lightweight pattern for
role/person-restricting Learn-tab content without a DB migration — fine for
non-sensitive content like training video metadata, not a substitute for
real server-side ACLs on actual data.
