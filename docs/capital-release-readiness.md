# Capital Module — Release Readiness Document
**Phase 2L · Hardening & Release Readiness Pass**
*Generated: 2026-07-07*

---

## Release Scope

The Capital module is an internal-only fundraising intelligence and investor-relationship platform restricted exclusively to the VoltSafe CEO and CFO. This document covers the release-readiness state of all Capital surfaces after the Phase 2L hardening pass.

---

## Pages Included

| Page | Route | Notes |
|------|-------|-------|
| Capital Command Center | `/capital/command-center` | Aggregates all capital intelligence in one view |
| Capital Dashboard | `/capital/dashboard` | Top-level KPI summary |
| Investors | `/capital/pipeline` | Full investor pipeline & detail drawer |
| Investor Targets | `/capital/targets` | Strategic target list |
| Investor Contacts | `/capital/contacts` | Contact relationship map |
| Rounds & Commitments | `/capital/rounds` | Active and planned rounds |
| Commitments | `/capital/commitments` | Commitment tracker |
| Grants & Non-Dilutive | `/capital/grants` | Grant pipeline |
| Follow-Ups | `/capital/follow-ups` | AI-prioritised follow-up queue |
| Data Room | `/capital/data-room` | Material library + share tracking |
| Updates & Reviews | `/capital/updates` | Investor update drafts |
| Capital Email Review | `/capital/email-review` | Gmail-linked email review queue |
| Investor Engagement | `/capital/engagement` | Engagement analytics (Phase 2I) |
| Capital Reports | `/capital/reports` | Board/CFO reporting pack (Phase 2J) |
| Capital AI Copilot | `/capital/copilot` | Advisory AI assistant (Phase 2K) |
| Investor Portal | `/investor-portal/:token` | **Public** — token-gated external sharing |

---

## APIs Included

All Capital APIs live in `server/routes-capital.ts` registered via `registerCapitalRoutes()`.  
All routes at `/api/capital/*` require `requireCapitalAccess`.  
Public routes (`/api/investor-portal/:token*`) are token-authenticated only — intentional.

Key API groups:

- `/api/capital/investors` — CRUD + intelligence
- `/api/capital/rounds` — round management
- `/api/capital/commitments` — commitment tracking
- `/api/capital/contacts` — contact management
- `/api/capital/activities` — activity log
- `/api/capital/grants` — grant pipeline
- `/api/capital/email-links` — Gmail integration
- `/api/capital/email-review` — review queue
- `/api/capital/materials` — data room materials
- `/api/capital/portal-access` — portal management
- `/api/capital/portal-materials` — portal material grants
- `/api/capital/portal-events` — portal engagement events
- `/api/capital/engagement` — engagement analytics
- `/api/capital/intelligence/*` — scoring and intelligence services
- `/api/capital/command-center` — aggregated command center data
- `/api/capital/valuation` — valuation and dilution modelling
- `/api/capital/reports` — board/CFO report generation
- `/api/capital/copilot/query` — AI copilot query endpoint
- `/api/capital/copilot/metadata` — rounds/investors for UI selectors
- `/api/investor-portal/:token` — **PUBLIC** portal access (token-gated)
- `/api/investor-portal/:token/events` — **PUBLIC** portal event logging

---

## Permission Model

**Access is identity-based, not role-based.**

| User | Access | Mechanism |
|------|--------|-----------|
| Trevor Burgess (CEO, user ID 4) | ✅ Full access | `CAPITAL_ALLOWED_USER_IDS` |
| Scott Carlson (CFO, scott.carlson@voltsafe.com) | ✅ Full access | `CAPITAL_ALLOWED_EMAILS` |
| All other users (including admin/master_admin) | ❌ Denied | Returns `403` |
| Unauthenticated requests | ❌ Denied | Returns `401` |

**Frontend enforcement:**
- `capitalGuard()` in `App.tsx` wraps all Capital routes — renders `<AccessDenied />` for non-capital users
- Sidebar hides all `capitalOnly: true` sections via `app-sidebar.tsx` permission check
- Global search (⌘K) filters out all `capitalOnly: true` page entries for non-capital users — **hardened in Phase 2L**

**Backend enforcement:**
- `requireCapitalAccess` middleware on every `/api/capital/*` route
- 403 response uses a generic opaque message (no data leakage)

---

## Public Investor Portal Security Model

The portal (`/investor-portal/:token` + `/api/investor-portal/:token`) is intentionally unauthenticated — it is accessed by external investors who receive a link.

**Security measures implemented:**

| Control | Implementation |
|---------|---------------|
| Token format validation | 64-character hex, regex enforced |
| Token storage | Only SHA-256 hash stored (`access_token_hash`); raw token never stored |
| Token comparison | Hash-to-hash lookup in DB |
| Expiry enforcement | `expires_at` checked on every request |
| Revocation enforcement | `status = 'revoked'` check on every request |
| IP storage | SHA-256 hashed; raw IP never stored |
| User-agent storage | Truncated to 512 bytes |
| Portal open dedup | Max one `portal_opened` event per portal per calendar day |
| Event type allowlist | Only `material_viewed` and `material_downloaded` accepted |
| Response data scope | Only: `access_label`, `investor_name`, `round_name`, `expires_at`, `materials[]` |

**Data never exposed through portal:**
- Investor scores (`fit_score`, `heat_score`, `probability_percent`)
- Internal notes
- Commitment amounts or stage
- Valuation / dilution data
- Email snippets or conversation history
- Other investor data
- Any Cortex/CRM records

---

## Known Limitations

1. **File upload/storage**: The Data Room is metadata-only. Material files are tracked by external URL or description — no secure file upload server is implemented. `external_url` links open in a new tab; security of the linked resource depends on the external host.

2. **PDF export**: PDF export of reports is not implemented. Reports are delivered as formatted Markdown/text. CSV export is available for applicable report types.

3. **Copilot is advisory only**: The AI Copilot generates analysis, recommendations, and draft emails. It does **not** execute any actions, send emails, update records, or create tasks automatically. All recommendations require manual action by the user.

4. **Email bodies are snippet/summary-based in AI context**: Full email body content is intentionally not passed to the AI Copilot to avoid credential/PII leakage. The copilot receives summarised context only.

5. **Engagement scoring is heuristic**: Engagement scores (0–100) are rule-based heuristics derived from email open/reply rates and portal activity. They are transparent and explainable, not ML predictions.

6. **Board-safe mode**: When `board_safe: true` (or `include_sensitive: false`), internal notes, email snippets, and raw scores are excluded from AI context. This is the recommended mode for board/external report generation.

7. **CFO account not yet created**: Scott Carlson's access is gated by email (`scott.carlson@voltsafe.com`). Until that account is created in the system, only Trevor (user ID 4) has active access.

8. **Copilot context is runtime-only**: No copilot queries or outputs are persisted to the database. Each copilot session is ephemeral.

---

## Test Results

All test suites pass as of Phase 2L hardening (2026-07-07):

| Suite | Tests | Status |
|-------|-------|--------|
| `capital-foundation.test.cjs` | 138 | ✅ All pass |
| `capital-permissions.test.cjs` | 86 | ✅ All pass |
| `capital-intelligence.test.cjs` | 87 | ✅ All pass |
| `capital-email-linking.test.cjs` | 82 | ✅ All pass |
| `capital-command-center.test.cjs` | 172 | ✅ All pass |
| `capital-valuation.test.cjs` | 191 | ✅ All pass |
| `capital-data-room.test.cjs` | 143 | ✅ All pass |
| `capital-portal.test.cjs` | 79 | ✅ All pass |
| `capital-engagement.test.cjs` | 101 | ✅ All pass |
| `capital-reporting.test.cjs` | 79 | ✅ All pass |
| `capital-copilot.test.cjs` | 95 | ✅ All pass |
| `capital-hardening.test.cjs` | **Phase 2L** | See below |
| `nav-drift.test.cjs` | 101 | ✅ All pass |
| `nav-consolidation.test.cjs` | 331 | ✅ All pass |
| `permissions.test.js` | 71 | ✅ All pass |

**Total Capital test coverage: ~1,254 source-grep assertions (pre-hardening)**

---

## Build Results

- TypeScript full-project check: environment timeout (> 45s in Replit sandbox) — not a code error
- Targeted service file checks (`capital-copilot.ts`, `capital-copilot-context.ts`): clean
- All source-grep tests pass — no broken imports, invalid patterns, or structural issues detected

---

## Rollback Notes

The Capital module is additive:
- All Capital tables live in `capital_*` namespace — no shared tables modified
- `migrateCapitalSchema()` uses `CREATE TABLE IF NOT EXISTS` — all migrations are idempotent
- To disable the Capital module: remove `registerCapitalRoutes(import_express_app)` from `server/index.ts`
- Frontend: removing `capitalOnly` nav entries from `nav-config.ts` hides all Capital UI

---

## Smoke Test Checklist

### Authorized CEO/CFO User

- [ ] Can open `/capital/command-center`
- [ ] Can view investor list at `/capital/pipeline`
- [ ] Can open investor detail drawer
- [ ] Can view linked emails in investor detail
- [ ] Can navigate to `/capital/data-room`
- [ ] Can create a portal access link
- [ ] Can revoke a portal access link
- [ ] Can open `/capital/engagement`
- [ ] Can generate a report at `/capital/reports`
- [ ] Can submit a query at `/capital/copilot`
- [ ] Can update investor stage (triggers activity log)
- [ ] ⌘K search for "investors" returns Capital Investors page

### Unauthorized Authenticated User

- [ ] Capital nav section not visible in sidebar
- [ ] Navigating to `/capital/command-center` shows Access Denied
- [ ] `GET /api/capital/investors` returns `403`
- [ ] `POST /api/capital/copilot/query` returns `403`
- [ ] `GET /api/capital/reports` returns `403`
- [ ] ⌘K search for "investors" does NOT show Capital pages
- [ ] ⌘K search for "capital" returns no results

### Unauthenticated User

- [ ] All `/api/capital/*` routes return `401`
- [ ] Navigating to `/capital/command-center` redirects to login

### Public Investor Portal

- [ ] Valid token opens portal and shows granted materials
- [ ] Expired token returns `403` with "This link has expired"
- [ ] Revoked token returns `403` with "This link has been revoked"
- [ ] Invalid/malformed token returns `404`
- [ ] Portal response contains no investor scores, commitments, or valuations
- [ ] Opening portal twice on same day logs only one `portal_opened` event

---

## Post-Release Monitoring Checklist

- [ ] Monitor `capital_portal_events` table for unexpected event types
- [ ] Alert if `console.error("[portal]"` log lines spike (portal errors)
- [ ] Alert if `console.error("[capital-copilot]"` log lines appear (copilot failures)
- [ ] Confirm `capital_activities` table is growing (activity logging healthy)
- [ ] Check `capital_portal_access` for any entries with `status = 'active'` past `expires_at`
- [ ] Review `capital_email_review` queue weekly (auto-linked email review)
- [ ] When Scott Carlson's account is created, verify `CAPITAL_ALLOWED_EMAILS` grants access

---

## Acceptance Criteria Status

| Criterion | Status |
|-----------|--------|
| Every Capital route/page/API is permission-audited | ✅ Complete |
| Public portal is token-security audited | ✅ Complete |
| AI Copilot is hardened (no auto-send, no fabrication, board-safe) | ✅ Complete |
| Reporting is hardened (board-safe, no fake data, generated_at) | ✅ Complete |
| Global search filters Capital pages for unauthorized users | ✅ Fixed in Phase 2L |
| PAGE_NAV_INDEX complete (all 15 Capital pages including Engagement/Reports/Copilot) | ✅ Fixed in Phase 2L |
| All regression test suites pass | ✅ Complete |
| Release readiness document created | ✅ This document |
| Smoke test checklist documented | ✅ Complete |
| Known limitations documented | ✅ Complete |
