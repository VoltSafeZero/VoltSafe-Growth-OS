---
name: CSP and mail-team data-minimization audit
description: How CSP was re-enabled and inbox-summary scoping was fixed during a production security audit.
---

Helmet's CSP was previously fully disabled (`contentSecurityPolicy: false`) rather than tuned — a "disable now, fix later" shortcut that persisted. When re-enabling, split directives by `NODE_ENV`: dev needs `unsafe-inline`/`unsafe-eval`/`ws:` for Vite HMR, production can be strict (`'self'`-only default/script/connect-src, `object-src 'none'`).

**Why:** no nonce/hash infra exists for inline scripts, so production strictness had to come from removing `unsafe-inline` for script-src while still allowing it for style-src (React inline styles/Radix have no nonce path either, so style-src keeps `unsafe-inline`).

**How to apply:** verify CSP via a live HTTP request to a real API route (not `/health` — routes registered before helmet middleware won't show the header), not just by reading config.

A separate finding: any endpoint aggregating "team" data (e.g. team inbox summaries) must be re-checked against the actual per-resource ACL table (here `users.permissions.mail_team`), not just a broad section permission like `crm:view` — broad section permissions are for feature access, not row-level visibility across other users' resources. This pattern recurs anywhere a "team view" is bolted onto a per-user resource.
