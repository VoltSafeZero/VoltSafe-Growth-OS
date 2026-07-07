# VoltSafe Growth OS — Production Security Launch Monitoring Plan

**Phase 18 | Production Security Launch, Monitoring, and Final Verification**
*Created July 2026 — update after each major security-related deploy.*

---

## Context

This document covers the post-deploy monitoring plan for the security hardening work completed in Phases 15–17:

- **Phase 15** — Full-app security and permissions audit, route-guard hardening, client-storage safety, access-control matrix.
- **Phase 16** — High-risk audit event framework (`security_audit_events` table, `ConfirmHighRiskAction` component, `recordHighRiskAction` service).
- **Phase 17** — Wired 16 audit calls and 6+ frontend confirmation dialogs into live production routes and actions.

---

## A. First-24-Hour Monitoring Checklist

### Errors to watch for

| Signal | Threshold for action | Where to look |
|---|---|---|
| 500 errors on high-risk routes | >2 errors in 1 hour | Server logs, `/api/board-packs/*`, `/api/admin/users/*`, `/api/capital/*`, `/api/gmail/*/disconnect`, `/api/current/channels/*` |
| 401/403 spike | >10x normal rate in any 15-min window | Server logs, auth middleware |
| Failed audit inserts (`security_audit_events`) | Any write-failure log lines | Server error log: grep `[audit]` |
| Migration errors on startup | Any | Startup log: migration batch output |
| Failed confirmation requests | Any 422 from high-risk routes | Server logs |
| Unexpected send/export/delete spike | Volume >3x normal | `/api/gmail/send`, `/api/board-packs/:id/markdown`, `/api/capital/portal-access/*` |
| Gmail disconnect errors | Any 5xx on disconnect route | Server logs: `gmail_account_disconnect` / `gmail_disconnect` |
| Board Pack access denials | >5 in 1 hour from legitimate users | Server logs: `requireBoardPackAccess` 403 |
| Capital portal token errors | Any 5xx on token routes | Server logs: `investor_portal_*` audit events |
| Currents membership errors | Any 5xx on membership routes | Server logs: `currents_member_*` |

### What to check on first login after deploy

1. Application loads and session is valid
2. No startup migration errors in server log
3. `security_audit_events` table exists (run: `SELECT COUNT(*) FROM security_audit_events`)
4. At least one test event present after performing a high-risk action
5. No unexpected admin-level alerts in the UI

---

## B. Audit Event Review Checklist

After each of these actions is performed in production, confirm the event appears in `security_audit_events`:

### Confirm events are being written

Run after performing each high-risk action:
```sql
SELECT action, actor_user_id, target_type, target_id, severity, metadata, created_at
FROM security_audit_events
ORDER BY created_at DESC
LIMIT 20;
```

### Required event presence

| Action | Category | Severity | Check |
|---|---|---|---|
| `board_pack_finalize` | `board_pack_action` | critical | ☐ |
| `board_pack_archive` | `board_pack_action` | critical | ☐ |
| `board_pack_markdown_export` | `board_pack_action` | high | ☐ |
| `board_pack_investor_draft` | `board_pack_action` | high | ☐ |
| `user_permissions_change` | `permission_change` | critical | ☐ |
| `user_suspend` | `user_management` | critical | ☐ |
| `user_delete` | `user_management` | critical | ☐ |
| `currents_channel_archive` | `currents_membership` | critical | ☐ |
| `currents_member_add` | `currents_membership` | critical | ☐ |
| `currents_member_remove` | `currents_membership` | critical | ☐ |
| `gmail_account_disconnect` | `integration_change` | critical | ☐ |
| `gmail_disconnect` | `integration_change` | critical | ☐ |
| `investor_portal_access_create` | `token_action` | critical | ☐ |
| `investor_portal_token_revoke` | `token_action` | critical | ☐ |
| `investor_portal_access_delete` | `capital_action` | critical | ☐ |
| `investor_portal_token_regenerate` | `token_action` | critical | ☐ |

### Confirm metadata is safe

For each recent event, verify:
- `metadata` contains only IDs, counts, and status labels
- No email body text is present
- No token or secret value is present
- No Capital memo text is present
- No Board Pack section content is present
- No private Currents message body is present

Quick SQL check:
```sql
SELECT id, action, metadata
FROM security_audit_events
WHERE metadata::text ILIKE '%token%'
   OR metadata::text ILIKE '%password%'
   OR metadata::text ILIKE '%body%'
   OR metadata::text ILIKE '%memo%'
   OR metadata::text ILIKE '%secret%';
-- Should return 0 rows
```

### Confirm denied/failed events (where implemented)

The Phase 16 framework logs `result: "denied"` rows for voice assistant blocks. For direct high-risk routes, denied events are logged before the 403 is returned where the route emits one. Monitor:
```sql
SELECT action, result, COUNT(*) FROM security_audit_events
WHERE result IN ('denied', 'failed')
GROUP BY action, result
ORDER BY COUNT(*) DESC;
```

---

## C. Rollback Triggers

### Rollback if any of the following occur

| Trigger | Reason |
|---|---|
| Today or core CRM fails to load after deploy | Regression in core routes |
| Login or session is broken | Auth middleware regression |
| High-risk routes produce widespread 5xx errors | Security middleware or audit service blocking responses |
| Permissions are exposing restricted data | Route guard weakened |
| `security_audit_events` migration blocks startup | Schema migration failure |
| Confirmation layer prevents critical admin operations entirely | Broken onConfirm callback |
| Board Pack or Capital module is inaccessible to authorized users | Guard regression |

### Do NOT rollback for

| Non-trigger | Notes |
|---|---|
| One harmless missing audit event on a non-critical route | Fire-and-forget by design |
| Cosmetic confirmation dialog issue | Fix forward |
| Expected 403s for unauthorized users | Working as intended |
| Copy button UX issue | Not a security regression |
| `security_audit_events` table already exists (idempotent) | Expected on re-deploy |

### Rollback procedure

1. Revert to previous Replit checkpoint via dashboard
2. Run `npm run dev` to confirm restored server boots
3. Verify `security_audit_events` table state is intact (data is append-only, safe to keep)
4. Verify session table and user data are unaffected
5. File incident report noting which trigger fired

---

## D. Manual Smoke Checklist

Run in order after each production deploy. Check the box only when verified.

### Authentication and roles

| Step | Check |
|---|---|
| Login as CEO (Trevor) | ☐ App loads, dashboard shows CEO-specific widgets |
| Login as CFO (Scott Carlson) | ☐ Capital module visible, Board Pack accessible |
| Login as normal admin | ☐ Admin panel accessible, Capital NOT visible |
| Login as standard user | ☐ Dashboard loads, no Capital or Board Pack tab |

### Board Pack access

| Step | Check |
|---|---|
| CEO: Navigate to Board Pack | ☐ Loads without error |
| CEO: Click Finalize | ☐ ConfirmHighRiskAction dialog appears with "high" risk badge |
| CEO: Click Archive | ☐ ConfirmHighRiskAction dialog appears |
| CEO: Cancel a confirmation | ☐ Dialog closes, no mutation fires |
| Normal admin: Navigate to Board Pack URL directly | ☐ Receives 403/redirect |

### Capital portal access

| Step | Check |
|---|---|
| CEO/CFO: Navigate to Capital → Investors | ☐ Loads without error |
| CEO/CFO: Click Revoke on a portal link | ☐ ConfirmHighRiskAction dialog appears |
| CEO/CFO: Click Delete on a portal link | ☐ Dialog requires typing DELETE before button enables |
| CEO/CFO: Click Regenerate token | ☐ ConfirmHighRiskAction dialog appears |
| Normal admin: Access Capital page directly | ☐ 403 or not visible |

### Admin user management

| Step | Check |
|---|---|
| Admin: Navigate to Admin → Users | ☐ Loads without error |
| Admin: Click Delete on a user | ☐ ConfirmHighRiskAction dialog with irreversible warning |
| Admin: Confirm requires typing DELETE | ☐ Confirm button disabled until "DELETE" is typed |
| Admin: Click Suspend on a user | ☐ Custom dialog with reason textarea appears |
| Admin: Cancel delete | ☐ Dialog closes, no user deleted |

### Gmail disconnect

| Step | Check |
|---|---|
| User with connected Gmail: View Gmail settings | ☐ Disconnect option present |
| Disconnect flow: Confirm or cancel | ☐ Audit event written on disconnect; cancel aborts |

### Currents private channel access

| Step | Check |
|---|---|
| Standard user: Access a private channel they are not a member of | ☐ Receives 403 |
| Admin: Archive a channel | ☐ Archive fires, audit event written |
| Admin: Add/remove a member | ☐ Fires correctly, audit event written |

### Audit event verification

| Step | Check |
|---|---|
| After performing ≥1 finalize/archive/delete above | ☐ `SELECT * FROM security_audit_events ORDER BY created_at DESC LIMIT 5` shows the events |
| Metadata spot check | ☐ No sensitive payload in any metadata column |

---

## E. Known Remaining Security Limitations

These are tracked, non-blocking items that were out of scope for Phases 15–18:

| Limitation | Risk | Mitigation in place |
|---|---|---|
| No real-time alert for `security_audit_events` rows | Low — internal-only tool | Operators can query the table on demand |
| Audit events are not streamed to external SIEM | Low — no SIEM configured | Table is queryable via prod DB |
| Suspend reason not stored in `security_audit_events` | Low — suspend reason goes to `activities` table | Covered by existing audit trail |
| Voice assistant `result: "denied"` rows are not surfaced in the Security UI | Low — readable via SQL | `SELECT * FROM security_audit_events WHERE result='denied'` |
| Attachment IDOR fix (F-09) is enforced but not tested with live uploads | Medium | Test scripts in `scripts/security-attachment-idor.test.ts` |
| No per-row audit for bulk CRM field edits | Low | Standard `activities` table covers CRM mutations |

---

## References

- `docs/security-high-risk-actions.md` — Risk tier model, Phase 17 applied controls table
- `docs/security-access-control-matrix.md` — Full route-level access control matrix
- `docs/security-client-storage.md` — localStorage key audit
- `threat_model.md` — Threat categories, assets, trust boundaries, scan anchors
- `server/services/security-audit.ts` — Audit service, BLOCKED_METADATA_KEYS
- `client/src/components/security/confirm-high-risk-action.tsx` — Confirmation dialog component
- `migrations/0025_security_audit_events.sql` — Idempotent DB migration
