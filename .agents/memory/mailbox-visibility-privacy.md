---
name: Mailbox Visibility Privacy
description: private_personal visibility_type blocks ALL non-owners including admins — the core rule and how it's enforced.
---

## The Rule

`visibility_type = 'private_personal'` means the mailbox is **owner-only with zero exceptions**. Not even `master_admin` can see it. This is a hard security boundary enforced at every access point.

**Why:** Private personal mail is a personal privacy guarantee, not a data-access tier. An admin reading a staff member's personal Gmail is a trust violation. The feature was designed to make this technically impossible, not just policy-enforced.

**How to apply:** Any new route or helper that reads email_accounts or gmail_messages for a non-owner context MUST run the visibility_type check before returning data.

## Enforcement Points

All four enforcement points use `COALESCE(visibility_type, 'private_personal')` so that accounts without the column set fall back to the safest value:

1. **`getAccessibleAccountIds`** — raw SQL `WHERE COALESCE(visibility_type, 'private_personal') != 'private_personal'` filters at query time
2. **`getAccessibleAccounts`** — same raw SQL guard on non-owned accounts
3. **`resolveAccount`** — fetches vt after `isOwner` check, returns `null` if `private_personal`
4. **`requireAccountEditAccess`** — returns 403 before the admin bypass for `private_personal`

## Schema Note

`visibility_type` is NOT in the Drizzle schema (`shared/schema.ts`). All reads/writes use `db.execute(sql.raw(...))`. This follows the project's "additive SQL migration, no Drizzle schema churn" rule.

## Three Levels

- `private_personal` — default; owner-only; no admin bypass
- `team_shared` — shared team inboxes; admin sees all; non-admins need `mail_team` permission grant
- `company_managed` — org inboxes (sales@, support@); same access rules as team_shared

## Migration

`migrations/0027_mailbox_visibility.sql` + startup idempotent migration block in `routes.ts` (after `current_channel_preferences` block). Classifies existing accounts: `is_shared=TRUE` → `team_shared`; `@voltsafe.com` / role-address patterns → `company_managed`; everything else stays `private_personal`.

## Connect Flow

`/api/my/mailbox/connect?visibilityType=private_personal|team_shared|company_managed`  
`team_shared` and `company_managed` require `master_admin`; `private_personal` is open to any user.  
`exchangeCodeForTokens` in `server/gmail-oauth.ts` accepts a 4th `visibilityType` parameter and persists it via raw SQL `UPDATE` after INSERT.
