# VoltSafe Growth OS — Client Storage Security Audit
**Phase 15 | Full-App Security & Permissions Audit**
*Generated July 2026 — update whenever new localStorage usage is added.*

---

## Policy Summary

**Permitted in localStorage:**
- User ID–scoped UI preferences (layout, density, column order)
- Boolean flags (focus mode, demo mode, banner-dismissed)
- Numeric IDs for dismissed/snoozed items
- Timestamps for UI state (snooze `until`, prefs `updatedAt`)
- Page navigation history (page path strings only)
- User-authored template text (email snippets, travel plans)
- Debug/diagnostic flags (developer-use only)

**Prohibited in localStorage:**
- Capital / investor / funding record content
- Board pack content or summaries
- Email bodies fetched from server (Gmail API content)
- Currents private channel or DM message bodies
- Authentication tokens, OAuth tokens, session cookies
- User passwords or password hints
- Server-sourced PII (customer emails, deal amounts, contact data)
- Permission decisions (always re-fetch from server)

---

## Inventory of All localStorage Keys

### 1. Inbox Actions Store
**File:** `client/src/components/inbox/inbox-actions-store.ts`
**Key pattern:** `voltsafe.inbox.actions.${userId}` (user-scoped)

| Stored value | Type | Sensitive? |
|---|---|---|
| Snoozed message IDs | `{ id, type, until }` array | No — IDs + timestamps only |

✅ **Compliant** — stores message IDs and snooze timestamps only; no message content.

---

### 2. Today / My Day Preferences
**File:** `client/src/hooks/use-today-prefs.ts`
**Key pattern:** `voltsafe.today.prefs.v1.${userId}` (user-scoped)

| Stored value | Type | Sensitive? |
|---|---|---|
| View preferences | booleans, layout mode strings | No |
| Panel collapsed states | booleans | No |
| Last updated timestamp | ISO timestamp | No |

✅ **Compliant** — layout/view preferences only; user-scoped.

---

### 3. Travel / My Travel
**File:** `client/src/lib/travel-storage.ts`
**Key:** `voltsafe.travel.trips.v1`

| Stored value | Type | Sensitive? |
|---|---|---|
| Trip title, purpose, destination | strings | Low — user-authored |
| Start/end dates | ISO date strings | Low |
| Transport legs (mode, carrier, reference, from/to) | strings | Low — user-authored |
| Notes | free text | Low — user-authored |
| `published` flag | boolean | No |

⚠️ **Note:** Contains user-authored trip planning data (e.g., flight references, hotel destinations). This data is:
- Created and owned by the current user
- Stored **client-side only** — not synced to the server database
- Not sourced from any CRM, Capital, or mail API response
- Not associated with any customer PII

**Acceptable** for user-authored planning content. No customer records, no capital data, no email bodies.

---

### 4. Gmail Inbox UI State
**File:** `client/src/pages/gmail-inbox.tsx`
**Key patterns:** `voltsafe.inbox.${userId}.*` (user-scoped)

| Stored value | Key suffix | Type | Sensitive? |
|---|---|---|---|
| CRM panel expanded state | `crm-panel-expanded` | boolean | No |
| Focus mode | `inbox.focusMode` | boolean (0/1) | No |
| Inbox density | `inbox.density` | string enum | No |
| Demo mode flag | `voltSafeDemoMode` | boolean (0/1) | No |
| Forward/reply trace (debug) | `FORWARD_REPLY_TRACE` | boolean | No |
| Mail source indicator | `voltsafe.mailSource` | cleared on send | No |

✅ **Compliant** — UI preference flags only. `voltSafeDemoMode` is a developer/demo toggle. No email bodies, no message content, no customer data stored.

---

### 5. Task Board Column Order
**File:** `client/src/components/tasks/task-board.tsx`
**Key pattern:** `task-col-order-${userId}` (user-scoped)

| Stored value | Type | Sensitive? |
|---|---|---|
| Column ordering array | string[] (column slugs) | No |

✅ **Compliant** — column slug names only; user-scoped by user ID.

---

### 6. Email Snippets
**File:** `client/src/hooks/use-snippets.ts`
**Key:** `voltsafe_mail_snippets_v1`

| Stored value | Type | Sensitive? |
|---|---|---|
| Snippet title, category | strings | No |
| Snippet subject | string | No |
| Snippet body text (template) | string with `{{placeholders}}` | Low — user-authored |

⚠️ **Note:** Stores user-authored email template text with `{{firstName}}`, `{{marinaName}}` style placeholders. This is:
- Template content authored by the user (not pulled from CRM or customer records)
- Not actual sent email bodies
- Not fetched from the server — created locally in the UI
- The default snippets are bundled in-code; user edits are saved locally

**Acceptable** for user-authored template text. No customer PII, no server-fetched content.

---

### 7. Recent Pages Navigation
**File:** `client/src/hooks/use-recent-pages.ts`
**Key:** `voltsafe.recent.pages.v1`

| Stored value | Type | Sensitive? |
|---|---|---|
| Array of `{ path, label, icon }` | strings | No |

✅ **Compliant** — page path strings only (e.g., `/crm/leads`, `/mail`). No record content.

---

### 8. Page Favorites
**File:** `client/src/hooks/use-page-favorites.ts`
**Key:** `voltsafe.page.favorites.v1`

| Stored value | Type | Sensitive? |
|---|---|---|
| Array of `{ path, label }` | strings | No |

✅ **Compliant** — page path strings only. No record content.

---

### 9. AI Email — Voice Profile & Influence
**File:** `client/src/components/crm/suggested-next-email-modal.tsx`
**Key patterns:** `voltsafe.voiceProfileId`, `voltsafe.influenceLevel`

| Stored value | Type | Sensitive? |
|---|---|---|
| Voice profile ID | integer (database ID) | No |
| Influence level | integer enum | No |

✅ **Compliant** — integer IDs only; no profile content stored locally.

---

### 10. Demo Mode
**File:** `client/src/lib/demo-mode.ts`
**Key:** `voltsafe.demoMode`

| Stored value | Type | Sensitive? |
|---|---|---|
| Demo mode active | boolean (0/1) | No |

✅ **Compliant** — single boolean flag.

---

### 11. Calendar Date/View State
**File:** `client/src/pages/calendar.tsx`
**Key pattern:** `voltsafe.cal.${userId}.${dateKey}`

| Stored value | Type | Sensitive? |
|---|---|---|
| Calendar view preferences | strings/booleans | No |

✅ **Compliant** — view state only.

---

### 12. Zoom Personal Room URL
**File:** `client/src/pages/calendar.tsx`
**Key:** `voltsafe.zoom.personalRoomUrl`

| Stored value | Type | Sensitive? |
|---|---|---|
| Zoom personal room URL | string (URL) | Low — user's own meeting link |

⚠️ **Note:** Stores the user's own Zoom personal room meeting URL (e.g., `https://zoom.us/j/1234567890`). This is:
- A meeting link the user manually entered or pasted
- Not a token or OAuth credential — it is a public-facing meeting link
- Equivalent in sensitivity to a user storing their own calendar link

**Acceptable** as it is a user-supplied public meeting link, not an OAuth token.

---

### 13. Work Calendar Launch Banner
**File:** `client/src/pages/team-work-calendar.tsx`
**Key pattern:** `wc_launch_banner_v1_${userId}` (user-scoped)

| Stored value | Type | Sensitive? |
|---|---|---|
| Banner dismissed | boolean (0/1) | No |

✅ **Compliant** — dismissed-state flag only.

---

### 14. Dashboard / Map Preferences
**Files:** `client/src/components/dashboard/dashboard-map.tsx`, `client/src/components/dashboard/header.tsx`, `client/src/components/nearby-marinas-map.tsx`, `client/src/components/leads/leads-mission-control-widget.tsx`

| Stored value | Type | Sensitive? |
|---|---|---|
| Map zoom/position preferences | numbers/strings | No |
| Dashboard header state | booleans | No |

✅ **Compliant** — view/UI state preferences only.

---

## Prohibited Patterns — Verification

| Prohibited item | Checked | Result |
|---|---|---|
| Capital record content | Grep: `capital` in localStorage keys | ✅ None found |
| Investor/funding data | Grep: `investor`, `funding` in localStorage | ✅ None found |
| Email bodies from server | No localStorage writes from Gmail API responses | ✅ None found |
| Currents message content | No localStorage writes from Currents API | ✅ None found |
| OAuth tokens / refresh tokens | No token writes to localStorage | ✅ None found |
| Session cookie values | httpOnly — browser blocks JS access | ✅ Protected |
| Permission decisions | Session fetched from `/api/auth/me` on load | ✅ Server-authoritative |
| Password/hash | Never in any response | ✅ Confirmed |
| Board pack content | No localStorage writes from board pack routes | ✅ None found |

---

## Allowed Key Registry

The following localStorage keys are the **complete approved list** as of Phase 15:

| Key Pattern | Owner | Content |
|---|---|---|
| `voltsafe.inbox.actions.${userId}` | Inbox | Snooze IDs + timestamps |
| `voltsafe.today.prefs.v1.${userId}` | Today | UI preferences |
| `voltsafe.travel.trips.v1` | Travel | User-authored trip plans |
| `voltsafe.inbox.${userId}.crm-panel-expanded` | Inbox | Boolean |
| `voltsafe.inbox.${userId}.inbox.focusMode` | Inbox | Boolean |
| `voltsafe.inbox.${userId}.inbox.density` | Inbox | String enum |
| `voltSafeDemoMode` | Dev/Demo | Boolean |
| `FORWARD_REPLY_TRACE` | Debug | Boolean |
| `voltsafe.mailSource` | Inbox | Transient — cleared on send |
| `task-col-order-${userId}` | Tasks | Column slug order array |
| `voltsafe_mail_snippets_v1` | Mail | User-authored email templates |
| `voltsafe.recent.pages.v1` | Nav | Page path strings |
| `voltsafe.page.favorites.v1` | Nav | Page path strings |
| `voltsafe.voiceProfileId` | AI Email | Integer ID |
| `voltsafe.influenceLevel` | AI Email | Integer enum |
| `voltsafe.demoMode` | Dev/Demo | Boolean |
| `voltsafe.cal.${userId}.*` | Calendar | View state |
| `voltsafe.zoom.personalRoomUrl` | Calendar | User's own Zoom URL |
| `wc_launch_banner_v1_${userId}` | Work Calendar | Dismissed flag |

---

## Recommendations

1. **travel-storage.ts** — Consider migrating trip data to server-side storage in a future phase so it persists across devices and browsers. Currently client-only.
2. **use-snippets.ts** — Consider migrating snippets to server-side storage for team sharing and cross-device access. Currently client-only.
3. **FORWARD_REPLY_TRACE** — Remove or gate behind `NODE_ENV !== "production"` check in a future cleanup phase.
4. **voltSafeDemoMode** — Gate behind admin/dev role check or remove from production build in a future phase.
