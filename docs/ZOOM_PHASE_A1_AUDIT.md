# Zoom / Booking — Phase A.1 Audit

**Date**: 2026-05-03
**Scope**: Connect Zoom from Settings; persist identity/status; show connected/disconnected state; allow disconnect; ensure only the owning user (or themselves as admin) can connect/disconnect.
**Method**: Read-only static analysis + DB introspection.
**Constraints honored**: No `db:push`, no schema changes, no new dependencies, no workflow restarts of the 5 known-failed test workflows (`mail-permissions`, `mailbox-switching`, `permissions`, `tracking-multi-proof`, `tracking-proof`).

---

## TL;DR

**Phase A.1 backend + frontend is already implemented.** All five acceptance criteria are met. The only remaining gap is **regression test coverage** (none of `tests/*.test.js` exercises the Zoom routes). This audit documents the existing wiring, confirms the security posture, and is paired with a new `tests/zoom-phase-a1.test.js` regression suite.

| Acceptance criterion | Status | Evidence |
| -------------------- | :----: | -------- |
| Connect Zoom account from Settings | ✅ | `client/src/pages/settings.tsx` L825–L840 + L1124–L1130; calls `GET /api/zoom/oauth/start` then full-page redirect to `authUrl`. |
| Persist Zoom identity/status | ✅ | `zoom_connections` table (DB-confirmed: 15 columns, unique index on `user_id`); `upsertZoomConnection()` in `server/services/zoom-service.ts` L190–L239. |
| Show connected/disconnected state | ✅ | `settings.tsx` L1074–L1131 — three states: loading / not-configured / connected (badge + email + acct type + relative timestamp) / disconnected. |
| Allow disconnect | ✅ | `POST /api/zoom/disconnect` (`server/routes.ts` L24026); UI button at `settings.tsx` L1107 (`button-zoom-disconnect`). |
| Only owning user/admin can connect/disconnect | ✅ | All 4 mutating endpoints scope by `req.session.userId`; no cross-user disconnect endpoint exists. See §4 below. |

---

## 1. Schema state (verified against live DB)

```
                                          Table "public.zoom_connections"
      Column       |            Type             | Nullable |                   Default
-------------------+-----------------------------+----------+----------------------------------------------
 id                | integer                     | not null | nextval('zoom_connections_id_seq'::regclass)
 user_id           | integer                     | not null |
 zoom_user_id      | text                        |          |
 zoom_email        | text                        |          |
 zoom_account_type | text                        |          |
 zoom_pmi          | text                        |          |
 zoom_pmi_url      | text                        |          |
 access_token      | text                        | not null |
 refresh_token     | text                        | not null |
 token_expires_at  | timestamp without time zone | not null |
 scope             | text                        |          |
 connected_at      | timestamp without time zone | not null | now()
 disconnected_at   | timestamp without time zone |          |
 created_at        | timestamp without time zone | not null | now()
 updated_at        | timestamp without time zone | not null | now()

Indexes:
    "zoom_connections_pkey"        PRIMARY KEY     btree (id)
    "idx_zoom_connections_user_id" btree           (user_id)
    "zoom_connections_user_id_key" UNIQUE          btree (user_id)
```

The unique constraint on `user_id` enforces **one Zoom connection per user**, which makes the per-user model structurally safe — `disconnect` cannot accidentally clear someone else's row.

`shared/schema.ts` L2441–L2461 matches the live DB. **No `db:push` required.** No schema changes are part of this phase.

---

## 2. Server surface

### Routes (`server/routes.ts`)

| Method | Path | Line | Gate | Purpose |
| ------ | ---- | ---: | ---- | ------- |
| GET  | `/api/zoom/oauth/start`     | 23902 | `requireAuth` | Returns `{ authUrl }` for the SPA to redirect to; CSRF state stored on session. Returns **503** if env vars missing. |
| GET  | `/api/zoom/oauth/callback`  | 23941 | inline session check | Validates state from session (CSRF), exchanges code for tokens, fetches Zoom profile, upserts connection, redirects `/settings?zoom={connected\|cancelled\|error}`. |
| GET  | `/api/zoom/connection`      | 24011 | `requireAuth` | Returns `{ connected, configured, zoomEmail, zoomAccountType, zoomPmi, zoomPmiUrl, connectedAt, disconnectedAt, tokenExpiresAt, zoomUserId }` for the **session user only**. |
| POST | `/api/zoom/disconnect`      | 24026 | `requireAuth` | Marks the **session user's** row as disconnected; clears tokens to empty strings; row retained for audit. |
| POST | `/api/zoom/meetings`        | 24039 | `requireAuth` | Creates a Zoom meeting using the **session user's** connection. (Out of A.1 scope — for compose dialog.) |
| POST | `/api/calendar/events/:id/add-zoom` | 6331  | `requireAuth` | Adds a Zoom URL to a calendar event using the **session user's** connection. (Out of A.1 scope.) |

### Service (`server/services/zoom-service.ts`)

| Function | Notes |
| -------- | ----- |
| `getZoomClientId/Secret/RedirectUri()` | Reads `process.env.ZOOM_CLIENT_ID/SECRET/REDIRECT_URI`. |
| `isZoomConfigured()` | True iff all three env vars are present. **Verified set in this environment.** |
| `buildZoomAuthorizationUrl(state)` | Builds `https://zoom.us/oauth/authorize?...` with `scope=meeting:write:meeting meeting:read:meeting user:read:user`. |
| `exchangeZoomCodeForTokens(code)` | POSTs to `https://zoom.us/oauth/token` with HTTP Basic auth; returns `{accessToken, refreshToken, tokenExpiresAt, scope}`. **Tokens are never logged.** |
| `fetchZoomUserProfile(accessToken)` | GETs `https://api.zoom.us/v2/users/me`; maps Zoom `type` integer (1/2/3) → `basic`/`pro`/`corp`. |
| `lookupZoomConnection(userId)` | Selects the (at most one) row for that user. |
| `upsertZoomConnection(userId, payload)` | Insert-or-update on `user_id`; clears `disconnectedAt` on reconnect; preserves original `connectedAt`. |
| `disconnectZoom(userId)` | Sets `disconnectedAt = now`, `accessToken = ""`, `refreshToken = ""`. Row preserved for audit. |
| `refreshZoomTokenIfNeeded(userId)` | Refreshes when token has < 5 min remaining; gracefully returns existing row on failure. |
| `createZoomMeeting(userId, opts)` | Calls Zoom API `POST /v2/users/me/meetings`; returns `null` on failure (never throws). |
| `toPublicZoomConnection(row)` | **Strips `accessToken` / `refreshToken`** before returning to the client. |

### Frontend (`client/src/pages/settings.tsx`)

- **Type** L42–L48: `ZoomConnection` matches the public projection.
- **Query** L800–L804: `useQuery` against `/api/zoom/connection` (30 s stale). Loading via `isLoading`.
- **OAuth-callback toast handler** L807–L823: reads `?zoom=` query param, strips from URL, surfaces toast for `connected` / `cancelled` / `error&reason=...`.
- **Connect handler** L825–L840: `fetch('/api/zoom/oauth/start')` → on 200 redirect to `data.authUrl`; on 503 toast the configured-message.
- **Disconnect mutation** L842–L849: `apiRequest('POST', '/api/zoom/disconnect')` → invalidates `['/api/zoom/connection']`.
- **UI states** L1074–L1131:
  - Loading: spinner + "Checking connection…".
  - `!configured`: amber banner "Zoom OAuth is not configured on this server. Add ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET / ZOOM_REDIRECT_URI to Replit Secrets."
  - `connected`: blue avatar + email + account type + "Connected N {ago}" + Disconnect button (`data-testid="button-zoom-disconnect"`).
  - else (configured but not connected): "Not connected — bookings will not create Zoom meetings." + Connect button (`data-testid="button-zoom-connect"`).

---

## 3. Existing tests for Zoom

`rg "zoom" tests/` returns **only** two unrelated matches in `tests/calendar-invite.unit.ts` (regex on iCal `LOCATION:Join Zoom: ...`). No `/api/zoom/*` route is currently covered by an automated test. **This is the only gap** — closed by this phase's new `tests/zoom-phase-a1.test.js`.

---

## 4. Permission / ACL analysis — "owner OR admin"

The project's standing rules require that "only the owning user/admin can connect or disconnect". The current implementation satisfies this through **structural per-user scoping** rather than an explicit owner-vs-admin branch:

| Operation | How "owner" is enforced |
| --------- | ----------------------- |
| Connect (`/api/zoom/oauth/start`) | The state token + the upsert in the callback both key off `req.session.userId`. There is **no** way to start an OAuth flow on behalf of another user. |
| OAuth callback (`/api/zoom/oauth/callback`) | Reads `req.session.userId`; if absent → redirects with `reason=not_authenticated`. If state token doesn't match the session-stored state → redirects with `reason=state_mismatch`. The connection is upserted against `req.session.userId` only. |
| Read connection (`/api/zoom/connection`) | `lookupZoomConnection(req.session.userId)` — returns the **session user's** row only. There is **no** route that returns another user's connection. |
| Disconnect (`/api/zoom/disconnect`) | `disconnectZoom(req.session.userId)` — UPDATE WHERE `user_id = req.session.userId`. Cannot affect another user's row. |

**Net effect**: the "owner-only" guarantee is enforced by the route handlers themselves (no `:userId` path parameter exists on any of these endpoints, so there is no IDOR surface). An admin acting on **their own** Zoom connection works identically to a non-admin acting on theirs. There is no "admin disconnects user X" endpoint — and the audit explicitly does **not** add one in Phase A.1, since the requirement is only that admins can manage **their own** Zoom; cross-user admin override is out of scope for A.1.

✅ The model satisfies "only owning user/admin can connect/disconnect".

### Token-handling hygiene

- `accessToken` / `refreshToken` are **never logged** (verified by reading `zoom-service.ts` and the route file).
- `accessToken` / `refreshToken` are **never returned to the client** (`toPublicZoomConnection()` strips them).
- The OAuth state token is stored in `req.session.zoomOAuthState` (httpOnly + signed via the existing `express-session` setup) and is **consumed once** (set to `undefined` immediately after match) to prevent replay.
- `disconnectZoom()` sets the stored token columns to empty strings — a stolen DB snapshot cannot be used to call the Zoom API on behalf of a disconnected user.

---

## 5. Booking-link & calendar surfaces — context only (out of A.1 scope, included for completeness)

`server/routes.ts` exposes:

| Method | Path | Line | Gate |
| ------ | ---- | ---: | ---- |
| GET    | `/api/booking-links` | 24090 | `requireAuth` |
| POST   | `/api/booking-links` | 24102 | `requireAuth` |
| GET    | `/api/booking-links/:id` | 24118 | `requireAuth` |
| PATCH  | `/api/booking-links/:id` | 24135 | `requireAuth` |
| POST   | `/api/booking-links/:id/recipients` | 24154 | `requireAuth` |
| POST   | `/api/booking-links/recipients/:id/revoke` | 24173 | `requireAuth` |
| GET    | `/api/booking-links/public/:token` | 24189 | **public** (token-gated) |
| POST   | `/api/booking-links/public/:token/confirm` | 24205 | **public** (token-gated) |

These are not in scope for A.1. Per `docs/SECURITY_FREEZE_AUDIT.md` §10 P2 #5, the per-row defensive ownership precheck on the authenticated booking-link writes is a future hardening item.

`/api/calendar/integrations*` (L6430–L6635) are all `requireAuth`-gated and per-user.

---

## 6. Implementation conclusion

**No code or schema changes are required for Phase A.1.** The only deliverable is a regression test suite covering:

1. Anonymous access denied for all `/api/zoom/*` mutations and reads.
2. Authenticated `GET /api/zoom/connection` returns the documented public shape.
3. Authenticated `GET /api/zoom/oauth/start` returns an `authUrl` that points to `zoom.us` (when env configured).
4. Cross-user isolation: user A and user B see only their own connection; user A's disconnect does not affect user B.
5. Tokens are never present in any client-facing response.

This is implemented in `tests/zoom-phase-a1.test.js`.

---

## 7. Behavioral notes for product

- The OAuth callback redirects to `/settings?zoom={connected|cancelled|error}&reason=...`. The SPA's `useEffect` (settings.tsx L807) **strips this param** from the URL via `history.replaceState` so a refresh doesn't re-fire the toast.
- `GET /api/zoom/oauth/start` returns **503** with `{configured: false, message}` when env vars are missing — the SPA does not currently surface this gracefully (it shows a generic toast). Acceptable for A.1; refine in A.2 if desired.
- The `disconnectedAt` row is preserved after disconnect — re-connecting via OAuth rehydrates the same row (preserving original `connectedAt`). The UI shows "connected N ago" using the original timestamp.

---

## 8. Risk register

| Risk | Severity | Mitigation |
| ---- | -------: | ---------- |
| Stored access/refresh tokens are at-rest plaintext in `zoom_connections`. | Low | Per repo convention (matches `gmail` and other OAuth tables). DB is single-tenant. Encryption-at-rest is a platform concern. |
| OAuth state stored on session — relies on `express-session` cookie integrity. | Low | Cookie is httpOnly + signed (existing config). State is consumed once. |
| If a user is deleted, their `zoom_connections` row is orphaned (no FK). | Low | Matches existing pattern across other per-user tables. Out of scope for A.1. |
| There is no "admin disconnects user X" endpoint. | None (by design) | A.1 requires only "owning user/admin" — admin manages their own. Cross-user admin override is out of scope. |

---

**End of audit. No code or schema changes were made by this audit pass.** Tests added in a separate file: `tests/zoom-phase-a1.test.js`.
