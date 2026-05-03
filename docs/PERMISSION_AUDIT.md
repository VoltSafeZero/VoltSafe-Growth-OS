# Permission Boundary Audit — Multi-Account Email System

**Scope**: Server-side permission gates on `/api/gmail/*`, `/api/inbox/*`, `/api/admin/*`, attachment download, and `/api/assets/*`.
**Method**: Static read of each route handler in `server/routes.ts`. Cross-checked subagent findings against the actual source.
**Status**: Read-only — recommendations only. No code changes.

---

## TL;DR

| # | Finding                                                                  | Severity |
| - | ------------------------------------------------------------------------ | -------- |
| 1 | `/api/assets/:id/file` and `/api/assets/:id/download` have **no object-level ACL** — any authenticated user can read any asset by guessing/iterating the integer ID. | **P1**   |
| 2 | Gmail attachment download blocks legitimate shared-mailbox teammates (`view: true`) — owner-or-admin only, doesn't honor `mail_team` grants. | P2 — usability bug |
| 3 | Scheduled email queue (`/api/gmail/schedule`) is `master_admin` only and stores `to/subject/body` with no `userId` — single workspace queue. By design, but worth confirming intent. | P3 — design note |
| 4 | All Gmail mutation routes (`send`, `drafts` POST/DELETE, `messages/:id/mark-read`, `toggle-star`, `bulk-archive`, `bulk-mark-read`, `thread-record`, `inbox/threads/:id/assign`) **DO** call `requireAccountEditAccess` — verified directly. | OK ✓     |
| 5 | All `/api/admin/*` routes correctly gated by `requireAdmin` server-side. | OK ✓     |
| 6 | Bulk operations correctly fan out per-account permission checks and route forbidden IDs into a `forbiddenIds` bucket rather than executing them. | OK ✓     |

---

## 1. View-only mail_team grants — verified safe ✓

The grant model `mail_team[X] = { view: true, edit: false }` is enforced via `requireAccountEditAccess` (`server/routes.ts:11813–11840`).

I verified directly that the following mutation routes call this gate:

| Route                                       | Line  | Gate present?                          |
| ------------------------------------------- | ----- | -------------------------------------- |
| `POST /api/gmail/send`                      | 11432 | ✓ `requireAccountEditAccess`           |
| `POST /api/gmail/drafts`                    | 10650 | ✓ `requireAccountEditAccess`           |
| `DELETE /api/gmail/drafts/:id`              | 10666 | ✓ `requireAccountEditAccess`           |
| `POST /api/gmail/messages/:id/mark-read`    | 10735 | ✓ `requireAccountEditAccess`           |
| `POST /api/gmail/messages/:id/toggle-star`  | ~10750| ✓ `requireAccountEditAccess`           |
| `POST /api/gmail/bulk-mark-read`            | 10797 | ✓ Single-account: `requireAccountEditAccess`. Multi-account: per-account fan-out check at 10827–10832. |
| `POST /api/gmail/bulk-archive`              | 10973 | ✓ Same pattern.                        |
| `PATCH /api/gmail/thread-record/:threadId`  | 9205  | ✓ `requireAccountEditAccess` (when thread is indexed). |
| `PATCH /api/inbox/threads/:threadId/assign` | 9341  | ✓ `requireAccountEditAccess`           |

**Conclusion**: A view-only mail_team grantee cannot send, draft, mark-read, star, archive, or assign on a shared mailbox via the API. The earlier "Phase 4" hardening (visible in code comments) appears complete and correct.

**Recommendation**: Add an automated regression test (`tests/mail-permissions.test.js` already exists but is currently failing — see workflows). When the QA pause ends, re-enable that workflow as the canary for this guarantee.

---

## 2. Bulk operation fan-out — verified safe ✓

`groupMessageIdsByAccount` / `groupThreadIdsByAccount` resolves each ID to its home account, then filters against the user's `editableIds` set (lines 10832, 10999). IDs the user can't edit are moved to a `forbiddenIds` bucket (10896, 11057) and reported back without being acted upon.

**Recommendation**: None — this is correctly implemented. Worth keeping the fan-out test (`tests/mail-permissions.test.js`) green going forward.

---

## 3. Admin diagnostic endpoints — verified safe ✓

| Route                                          | Line  | Gate                            |
| ---------------------------------------------- | ----- | ------------------------------- |
| `GET /api/admin/users`                         | 5273  | `requireAdmin`                  |
| `GET /api/admin/mailbox/diagnostics`           | 5480  | `requireAdmin`                  |
| `GET /api/admin/mailbox/:id/diagnostics`       | 5574  | `requireAdmin`                  |
| `POST /api/admin/mailbox/:id/trigger-backfill` | 5657  | `requireAdmin`                  |
| `POST /api/gmail/sync` (global)                | 12160 | `requireAdminOnly` (stricter — master_admin)|

**Conclusion**: All admin diagnostics enforce server-side. No client-only hiding.

**Recommendation**: None.

---

## 4. **REAL P1 RISK: `/api/assets/:id/file` and `/api/assets/:id/download` have no object-level ACL**

**Code**, `server/routes.ts:13267` and `13277`:

```ts
app.get("/api/assets/:id/file", requireAuth, async (req, res) => {
  const [asset] = await db.select().from(assets).where(eq(assets.id, Number(req.params.id)));
  if (!asset) return res.status(404).json({ message: "Asset not found" });
  sendAssetFile(asset, res, "inline");
});

app.get("/api/assets/:id/download", requireAuth, async (req, res) => { /* same shape */ });
```

**Problem**: Any authenticated user (regardless of role, account scope, or relationship to the underlying record) can fetch any asset by integer ID. IDs are sequential. Assets in this app include email attachments saved into the local DB, contract uploads attached to opportunities, and quote PDFs.

**Exploitability**: Trivial — `for (let i = 1; i < 100000; i++) GET /api/assets/${i}/download`. Only `requireAuth` stands between an internal user and every uploaded file in the workspace.

**Severity**: **P1 — broken access control (IDOR)**. Not P0 because the workspace is single-tenant per workspace and only seated users can authenticate. But for any workspace with more than one user, it is a real horizontal privilege escalation.

**Recommendation (no code change made)**:
- Add an `assets.uploadedByUserId` and/or `assets.scopeAccountId` check inside `sendAssetFile`. At minimum, deny if the asset's owning record (e.g., its quote / opportunity / message) is not visible to the requester. If the asset has no owner, fall back to `uploadedByUserId === req.session.userId` OR `isAdmin`.
- Consider rotating the URL scheme to use UUIDs instead of integers as defense-in-depth.

---

## 5. P2 usability bug: Gmail attachment download blocks legitimate shared-mailbox teammates

**Code**, `server/routes.ts:8924` and `8953` (`/api/gmail/attachments/:id/calendar-invite` and `/api/gmail/attachments/:id/download`):

```ts
if (owner.ownerUserId !== userId && !isAdmin) {
  return res.status(403).json({ error: "Not allowed" });
}
```

**Problem**: This check requires the requester to either own the mailbox OR be a global admin. It does NOT consult `mail_team` grants. So a colleague with a legitimate `view: true` shared grant on the mailbox cannot open or download attachments on messages they can otherwise read in the inbox.

**Exploitability**: None — this is over-restrictive, not under-restrictive. Pure usability bug.

**Severity**: P2 — confusing UX for the people most likely to use shared inboxes (BD reps, support team).

**Recommendation (no code change made)**:
- Update both attachment routes to also accept callers with any `mail_team[X]` grant (view OR edit) on the owning mailbox account. Same `getSessionUserAccess` helper already used elsewhere can supply the grant set.

---

## 6. P3 design note: scheduled email queue is workspace-global

`POST /api/gmail/schedule` (line 10693) is gated to `master_admin` only and the `scheduledEmails` table has no per-user / per-account scoping column. The `GET` endpoint silently returns `[]` for non-admins to avoid client errors.

**Severity**: P3 — by design today, but worth flagging that:
- Cancellation by ID (`DELETE /api/gmail/scheduled/:id`) is also `master_admin` only.
- If shared-mailbox teammates ever need to schedule sends on shared accounts, the queue model needs a `accountId` column and per-account ACL.

**Recommendation (no code change made)**:
- Document the workspace-global scope in the route comment so future contributors don't assume per-user scoping.
- If multi-account scheduling is on the roadmap, plan the schema change before it ships.

---

## What I did NOT audit (out of scope, time-boxed)

- CSRF protection on POST/DELETE endpoints (the app uses session cookies — worth a separate pass).
- Rate limiting on `/api/gmail/send` (could enable spam if a user account is compromised).
- Input validation on `req.body` for the email send route — Zod schemas not consistently applied.
- Webhook authentication (`/api/webhooks/gmail` — relies on `GMAIL_WEBHOOK_TOKEN` query param; sufficient for Pub/Sub but worth confirming token is HMAC-validated).

These are explicitly deferred. Re-open in a future audit pass.
