---
name: Private Inbox Sidebar Grouping
description: Three-section sidebar grouping for VoltSafe Mail; root cause of migration IS NULL bug; how to classify email_accounts.
---

## The Bug
`email_accounts.visibility_type` was added as `NOT NULL DEFAULT 'private_personal'`.
The migration's follow-up UPDATEs used `WHERE visibility_type IS NULL` — a condition that
could never be true after the ALTER TABLE, so team/company accounts were never reclassified.

## The Classification Rules
- `company_managed`: user's @voltsafe.com work email — must go to WORK INBOX
- `team_shared`: is_shared=true shared inboxes — must go to TEAM INBOXES
- `private_personal`: privately-owned Gmail (hyalos.com, gmail.com, etc.) — PRIVATE INBOXES

## Migration Fix
```sql
UPDATE email_accounts SET visibility_type = 'team_shared'
  WHERE is_shared = TRUE AND (visibility_type IS NULL OR visibility_type = 'private_personal');
UPDATE email_accounts SET visibility_type = 'company_managed'
  WHERE is_shared = FALSE AND (visibility_type IS NULL OR visibility_type = 'private_personal')
    AND (email_address LIKE '%@voltsafe.com' OR ...);
```

## Sidebar Grouping (gmail-inbox.tsx)
```typescript
const workAccounts    = allAccounts.filter(a => a.visibilityType === 'company_managed');
const sharedAccounts  = allAccounts.filter(a => !a.isOwner && a.visibilityType !== 'private_personal' && ...);
const privateAccounts = allAccounts.filter(a => a.visibilityType === 'private_personal' && a.isOwner);
const personalAccount = workAccounts[0] ?? allAccounts.find(a => a.isOwner) ?? null;
```

**Why:** `find(a => a.isOwner)` only picks ONE owned account — others are silently dropped.
`filter()` into three buckets ensures all accounts appear in exactly one section.

**How to apply:** Any time a new account type is added, classify it in the migration SQL
AND ensure the three-bucket filter covers it. Never rely on `is_shared` alone.

## Production Crash: camelCase vs snake_case Mixed Array

`getAccessibleAccounts()` merges TWO sources:
1. Own accounts via `db.select().from(emailAccounts)` → **Drizzle ORM → camelCase** (`emailAddress`, `isShared`, `userId`)
2. Non-owned accounts via `db.execute(sql.raw(...))` → **raw SQL → snake_case** (`email_address`, `is_shared`, `user_id`)

When the API spreads `...a` without normalizing, team accounts have `email_address` but `emailAddress` is undefined.
Any render code doing `acct.emailAddress[0]` crashes: `TypeError: Cannot read properties of undefined (reading '0')`.

**Fix pattern — normalize at the API boundary before res.json():**
```typescript
const emailAddress = a.emailAddress ?? a.email_address ?? '';
const isShared = a.isShared ?? a.is_shared ?? false;
const userId2 = a.userId ?? a.user_id ?? null;
// ... etc for all camelCase fields
```

**Also add defensive fallbacks in render paths:**
```tsx
const letter = (acct.emailAddress || acct.displayName || "?")[0].toUpperCase();
```

**Why this only failed in production:** Dev had 3 all-owned accounts (all Drizzle camelCase); production had 5 accounts including sales@/support@ owned by other users (raw SQL snake_case), so dev never exercised the mixed array path.
