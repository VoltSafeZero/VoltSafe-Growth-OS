# VoltSafe Growth OS — Portability Fix Plan

**Status:** Planning only. No code has been changed.  
**Source:** Derived from the portability audit conducted 2026-05-07.  
**Goal:** Make the application fully deployable on any standard Linux host, PaaS (Render, Railway, Fly.io), or VPS with zero Replit dependencies.

---

## Task Index (Ranked by Blocking Severity)

| # | Task | Priority | Blocks deployment? | Effort |
|---|---|---|---|---|
| T1 | Replace hardcoded `replit.app` fallback URLs | P0 — Critical | Yes — OAuth and email links break | 30 min |
| T2 | Rewrite Jira + Confluence connector auth | P0 — Critical | Yes — both integrations fail completely | 3–4 hours |
| T3 | Add startup validation for required env vars | P0 — Critical | Yes — silent failures in production | 1 hour |
| T4 | Create `.env.example` | P1 — High | Yes — operators cannot configure without it | 45 min |
| T5 | Gate / remove Replit-only Vite plugins | P1 — High | Partial — runtime error overlay ships to production unnecessarily | 20 min |
| T6 | Fix CSRF host allowlist for non-Replit hosts | P1 — High | Yes — all API mutations return 403 if hosts not set | 20 min |
| T7 | Document database export / import | P2 — Medium | No — but data is lost without it | 30 min |
| T8 | Document uploads folder backup / restore | P2 — Medium | No — but file attachments are lost without it | 20 min |
| T9 | Resolve UNKNOWN package licenses | P2 — Medium | No — legal / compliance risk only | 1 hour |
| T10 | Mark Jira / Confluence as optional integrations | P3 — Low | No — graceful degradation already exists | 30 min |
| T11 | Write VPS deployment runbook | P3 — Low | No — documentation | 2 hours |
| T12 | Write Render / Railway / Fly.io runbooks | P3 — Low | No — documentation | 2 hours |

---

## T1 — Replace Hardcoded `replit.app` Fallback URLs

**Priority: P0 — Critical**

### Problem

Four files contain `https://image-linker-burgesstrevor76.replit.app` as a hard-coded fallback. These are reached whenever the corresponding env var is absent. On any non-Replit host the env var _will_ be absent, causing:
- Gmail OAuth redirects to fail (Google rejects the redirect URI as unregistered)
- Calendar OAuth redirects to fail
- Booking link emails to carry the wrong domain
- Login email links to carry the wrong domain

### Files to change

| File | Lines | Variable needed | Fallback today |
|---|---|---|---|
| `server/gmail-oauth.ts` | 137–140 | `GOOGLE_REDIRECT_URI` | Hardcoded replit.app |
| `server/calendar-sync.ts` | 65–69 | `GOOGLE_CALENDAR_REDIRECT_URI` | Hardcoded replit.app |
| `server/routes.ts` | 924 | `APP_URL` | Hardcoded replit.app |
| `server/routes.ts` | 6077, 6100 | `APP_URL` | Hardcoded replit.app |
| `server/services/booking-link-distribution.ts` | 91–95 | `APP_URL` | Hardcoded replit.app |

### Implementation plan

1. In **`server/gmail-oauth.ts`** and **`server/calendar-sync.ts`**: remove the `replit.app` string from the ternary. Replace with a pattern that throws a clear startup error if `GOOGLE_REDIRECT_URI` is not set in production.

   ```
   Before:
     process.env.GOOGLE_REDIRECT_URI
       || (isProduction ? "https://image-linker-burgesstrevor76.replit.app/..."
                       : `https://${process.env.REPLIT_DOMAINS}/...`)

   After:
     process.env.GOOGLE_REDIRECT_URI
       || (isDev ? `http://localhost:5000/api/auth/google/callback`
                 : (() => { throw new Error("GOOGLE_REDIRECT_URI must be set in production"); })())
   ```

2. In **`server/routes.ts`** and **`server/services/booking-link-distribution.ts`**: same pattern for `APP_URL`. The dev fallback can be `http://localhost:5000`.

3. Move the validation into the startup env check added in T3 so the application refuses to start before any request reaches the broken code path.

### Test after change

- In development: `GOOGLE_REDIRECT_URI` unset → should default to `localhost:5000` path cleanly.
- In production with `GOOGLE_REDIRECT_URI` unset → process should exit at startup with a clear message.
- In production with `GOOGLE_REDIRECT_URI` set → Gmail OAuth flow should reach the correct callback.

---

## T2 — Rewrite Jira + Confluence Connector Auth

**Priority: P0 — Critical**

### Problem

`server/jira-client.ts` and `server/confluence-client.ts` authenticate by calling Replit's internal connector sidecar:

```
GET https://<REPLIT_CONNECTORS_HOSTNAME>/api/v2/connection?...
  X-Replit-Token: repl <REPL_IDENTITY>
```

`REPLIT_CONNECTORS_HOSTNAME`, `REPL_IDENTITY`, and `WEB_REPL_RENEWAL` are injected automatically by Replit. They do not exist anywhere else. Both files will throw `"X-Replit-Token not found"` on every Jira/Confluence API call outside Replit.

### Decision to make first

Before writing any code, decide: **Are Jira and Confluence actively used by VoltSafe today?**

- If **yes**: complete T2 in full.
- If **no**: implement T10 first (mark as optional with graceful degradation), and defer T2 until the integrations are actually needed.

### Implementation plan (if proceeding)

**Step 1 — Create an Atlassian OAuth 2.0 app**
1. Go to https://developer.atlassian.com/console/myapps/
2. Create a new OAuth 2.0 (3LO) app.
3. Add the required scopes (same ones currently granted via the Replit connector):
   - Jira: `read:jira-work`, `write:jira-work`, `read:jira-user`
   - Confluence: `read:confluence-content.all`, `write:confluence-content`, `read:confluence-space.summary`
4. Set the redirect URI to `https://yourdomain.com/api/auth/atlassian/callback` (a new route to add).
5. Note your `CLIENT_ID` and `CLIENT_SECRET`.

**Step 2 — Add new env vars**
```
ATLASSIAN_CLIENT_ID=...
ATLASSIAN_CLIENT_SECRET=...
ATLASSIAN_REDIRECT_URI=https://yourdomain.com/api/auth/atlassian/callback
```
Optionally store the refresh token in the database (`atlassian_connections` table — one row per user) to avoid requiring manual re-auth after deployment.

**Step 3 — Rewrite `server/jira-client.ts`**
Replace the Replit sidecar fetch with a standard OAuth 2.0 token refresh:
- Read `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET` from env.
- Store refresh tokens in a DB table (or env var for a single-user setup).
- Exchange refresh token for access token at `https://auth.atlassian.com/oauth/token`.
- Cloud ID resolution via `https://api.atlassian.com/oauth/token/accessible-resources` is already in the existing code — keep that logic unchanged.

**Step 4 — Rewrite `server/confluence-client.ts`** — identical pattern to Jira.

**Step 5 — Add an OAuth callback route** at `POST /api/auth/atlassian/callback` to receive the initial authorization code and exchange it for tokens, storing the refresh token.

**Step 6 — Add an admin UI page** (or a one-time CLI script) that lets an admin user initiate the Atlassian OAuth flow to generate the initial refresh token after deployment.

### Files affected
- `server/jira-client.ts` — full rewrite
- `server/confluence-client.ts` — full rewrite
- `server/routes.ts` — add Atlassian OAuth callback route
- `shared/schema.ts` — optionally add `atlassian_connections` table (or store tokens in env)

---

## T3 — Add Startup Validation for Required Production Env Vars

**Priority: P0 — Critical**

### Problem

Today, only `SESSION_SECRET` and `DATABASE_URL` are validated at startup. The following vars are silently missing until the first request that needs them:
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` → Gmail/Calendar connect crashes at runtime
- `GMAIL_PUBSUB_TOPIC` / `GMAIL_WEBHOOK_TOKEN` → push silently disabled, no warning
- `AI_INTEGRATIONS_OPENAI_API_KEY` → AI features crash at first call with an unclear OpenAI SDK error
- `APP_URL` → booking links and login emails silently point to the wrong host
- `GOOGLE_REDIRECT_URI` → OAuth crash at first connection attempt

### Implementation plan

Add a `validateProductionEnv()` function called early in `server/index.ts`, immediately after the existing `SESSION_SECRET` check. Structure:

```
interface EnvCheck {
  name: string;
  required: boolean;          // fail-close on missing
  warning?: string;           // message printed but process continues
  fatal?: string;             // message printed then process.exit(1)
}

const PRODUCTION_ENV_CHECKS: EnvCheck[] = [
  { name: "DATABASE_URL",                 required: true,  fatal: "PostgreSQL connection string missing." },
  { name: "SESSION_SECRET",               required: true,  fatal: "Must be ≥32 chars." },
  { name: "APP_URL",                      required: true,  fatal: "Required for OAuth callbacks and email links." },
  { name: "GOOGLE_CLIENT_ID",             required: false, warning: "Gmail/Calendar connect will not work." },
  { name: "GOOGLE_CLIENT_SECRET",         required: false, warning: "Gmail/Calendar connect will not work." },
  { name: "GOOGLE_REDIRECT_URI",          required: false, warning: "Gmail OAuth will redirect to wrong URL." },
  { name: "GMAIL_PUBSUB_TOPIC",           required: false, warning: "Gmail push disabled — polling only." },
  { name: "GMAIL_WEBHOOK_TOKEN",          required: false, warning: "Gmail push webhook unauthenticated." },
  { name: "AI_INTEGRATIONS_OPENAI_API_KEY", required: false, warning: "All AI features disabled." },
  { name: "AI_INTEGRATIONS_OPENAI_BASE_URL", required: false, warning: "AI features will use default OpenAI endpoint." },
  { name: "CSRF_ALLOWED_HOSTS",           required: false, warning: "CSRF guard may block requests from custom domains." },
];
```

Only `DATABASE_URL` and `SESSION_SECRET` + `APP_URL` trigger `process.exit(1)`. The rest emit `[startup] WARNING: …` messages that are visible in the host's log stream. This lets the app boot even when optional integrations (Jira, Zoom, etc.) are not configured, while making the operator aware of what is degraded.

### File to change
- `server/index.ts` — add `validateProductionEnv()` after the existing `SESSION_SECRET` block (around line 88).

---

## T4 — Create `.env.example`

**Priority: P1 — High**

### Problem

There is no `.env.example` file. An operator deploying to a new host has no authoritative list of what to set, leading to missed variables and confusing runtime errors.

### Full `.env.example` to create at project root

```bash
# ── Database ──────────────────────────────────────────────────────────────────
DATABASE_URL=postgres://user:password@host:5432/voltsafe

# ── Application ───────────────────────────────────────────────────────────────
NODE_ENV=production
PORT=5000
APP_URL=https://yourdomain.com

# Session — generate with: openssl rand -base64 48
SESSION_SECRET=<random-64-char-string>

# ── CSRF host allowlist ───────────────────────────────────────────────────────
# Comma-separated list of your domain(s).
# On Replit, REPLIT_DOMAINS is injected automatically — set this instead elsewhere.
CSRF_ALLOWED_HOSTS=yourdomain.com,www.yourdomain.com

# ── Google OAuth (Gmail + Calendar) ───────────────────────────────────────────
# Create at: https://console.cloud.google.com → APIs & Services → Credentials
# Authorized redirect URIs must include: APP_URL/api/auth/google/callback
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://yourdomain.com/api/auth/google/callback
GOOGLE_CALENDAR_REDIRECT_URI=https://yourdomain.com/api/auth/google/callback

# ── Gmail Push Notifications (Google Cloud Pub/Sub) ───────────────────────────
# Format: projects/<project-id>/topics/<topic-name>
# Push subscription endpoint: APP_URL/api/webhooks/gmail?token=GMAIL_WEBHOOK_TOKEN
# Generate token with: openssl rand -hex 32
GMAIL_PUBSUB_TOPIC=projects/my-project/topics/gmail-push
GMAIL_WEBHOOK_TOKEN=<random-secret>

# ── AI / OpenAI ───────────────────────────────────────────────────────────────
# Standard OpenAI API key from https://platform.openai.com/api-keys
# On Replit, these are set via the AI Integrations panel.
AI_INTEGRATIONS_OPENAI_API_KEY=sk-...
AI_INTEGRATIONS_OPENAI_BASE_URL=https://api.openai.com/v1

# ── Zoom (optional — meeting link creation) ───────────────────────────────────
# Create at: https://marketplace.zoom.us/develop/create
ZOOM_CLIENT_ID=
ZOOM_CLIENT_SECRET=
ZOOM_REDIRECT_URI=https://yourdomain.com/api/zoom/oauth/callback

# ── Atlassian Jira (optional) ─────────────────────────────────────────────────
# Requires rewrite of server/jira-client.ts (see T2 in PORTABILITY_FIX_PLAN.md).
# On Replit, this is handled by the Replit Connectors sidecar.
ATLASSIAN_CLIENT_ID=
ATLASSIAN_CLIENT_SECRET=
ATLASSIAN_REDIRECT_URI=https://yourdomain.com/api/auth/atlassian/callback
# JIRA_REFRESH_TOKEN — obtained after completing the Atlassian OAuth flow post-deploy

# ── Atlassian Confluence (optional) ───────────────────────────────────────────
# Uses the same Atlassian OAuth app as Jira (same CLIENT_ID / CLIENT_SECRET).
# CONFLUENCE_REFRESH_TOKEN — obtained after completing the Atlassian OAuth flow

# ── Replit-only (DO NOT SET on non-Replit hosts) ─────────────────────────────
# REPLIT_DOMAINS     — injected by Replit; replaced by CSRF_ALLOWED_HOSTS above
# REPLIT_CONNECTORS_HOSTNAME — injected by Replit; replaced by Atlassian env vars above
# REPL_IDENTITY      — injected by Replit; not needed outside Replit
# WEB_REPL_RENEWAL   — injected by Replit; not needed outside Replit
# REPL_ID            — injected by Replit; used only to gate dev-mode Vite plugins
```

### File to create
- `.env.example` at project root.
- Add `.env` to `.gitignore` if not already present.

---

## T5 — Gate / Remove Replit-Only Vite Plugins

**Priority: P1 — High**

### Problem

`vite.config.ts` unconditionally loads `@replit/vite-plugin-runtime-error-modal` and applies it in every build — including production. This plugin ships Replit-specific client-side JavaScript to all users. The `cartographer` and `dev-banner` plugins are already correctly gated by `REPL_ID` and are safe.

```ts
// Current — always active:
runtimeErrorOverlay({ filter: ... })

// Cartographer/banner — already gated (correct):
...(process.env.NODE_ENV !== "production" && process.env.REPL_ID !== undefined ? [...] : [])
```

### Implementation plan

Apply the same `REPL_ID` guard to `runtimeErrorOverlay`:

```ts
// Proposed structure (do not copy verbatim — adjust to match current indentation):
...(process.env.REPL_ID !== undefined
  ? [
      runtimeErrorOverlay({ filter: ... }),
      // cartographer and devBanner already here
    ]
  : [])
```

This means outside Replit (where `REPL_ID` is undefined), the plugin is simply not added. The existing `filter` logic that suppresses extension noise should be preserved inside the guard so it still works on Replit.

### Files to change
- `vite.config.ts` — gate `runtimeErrorOverlay` behind `REPL_ID !== undefined`

### Note on the import
`runtimeErrorOverlay` is currently a top-level static import. If it is moved inside the conditional, the import must also be converted to a dynamic `import()` (consistent with how `cartographer` and `devBanner` are already loaded).

---

## T6 — Fix CSRF Host Allowlist for Non-Replit Hosts

**Priority: P1 — High**

### Problem

`server/csrf.ts` builds its allowed-hosts set from:
1. Two hardcoded production hostnames: `voltsafe.app`, `www.voltsafe.app`
2. `REPLIT_DOMAINS` (injected by Replit — absent on any other host)
3. `CSRF_ALLOWED_HOSTS` (operator-supplied, currently undocumented)
4. `localhost:5000` and `127.0.0.1:5000` in development

On a non-Replit host, `REPLIT_DOMAINS` is empty. Unless `CSRF_ALLOWED_HOSTS` is set to match the actual deployment domain, **every POST/PUT/PATCH/DELETE request returns 403**, breaking the entire application.

### Implementation plan

1. Add `CSRF_ALLOWED_HOSTS` to `.env.example` (done in T4) and to the startup validation in T3 (warn if empty in production).
2. Document this clearly in the deployment runbooks (T11/T12): operators must set `CSRF_ALLOWED_HOSTS=yourdomain.com,www.yourdomain.com`.
3. No code change is technically required — `CSRF_ALLOWED_HOSTS` already exists as an extension point in `server/csrf.ts`. The fix is purely operational.

---

## T7 — Database Export / Import Runbook

**Priority: P2 — Medium**

### Export from Replit (source)

```bash
# 1. Get the Replit DATABASE_URL from the Secrets panel.
# 2. Export schema + data in custom format (recommended — faster restore):
pg_dump "$DATABASE_URL" \
  --no-owner \
  --no-acl \
  --no-privileges \
  -Fc \
  -f voltsafe_$(date +%Y%m%d).dump

# 3. Export as plain SQL (easier to inspect):
pg_dump "$DATABASE_URL" \
  --no-owner \
  --no-acl \
  --no-privileges \
  -f voltsafe_$(date +%Y%m%d).sql
```

### Import to new host

```bash
# Option A — Custom format (fast, recommended for large databases)
createdb voltsafe                          # on the new host
pg_restore \
  --no-owner \
  --no-acl \
  -d "$NEW_DATABASE_URL" \
  voltsafe_20260507.dump

# Option B — Plain SQL
psql "$NEW_DATABASE_URL" -f voltsafe_20260507.sql

# 3. Verify row counts match:
psql "$NEW_DATABASE_URL" -c "
  SELECT schemaname, tablename, n_live_tup
  FROM pg_stat_user_tables
  ORDER BY n_live_tup DESC
  LIMIT 20;
"
```

### Apply pending migrations after import

```bash
psql "$NEW_DATABASE_URL" -f migrations/0001_zoom_and_booking_links.sql
psql "$NEW_DATABASE_URL" -f migrations/0002_meeting_notes.sql
# Apply any future migrations in numeric order.
```

### Schema-only export (for fresh database setup without data)

```bash
npx drizzle-kit generate       # generates SQL DDL from shared/schema.ts
psql "$NEW_DATABASE_URL" -f <generated-file>.sql
# Then apply migrations on top.
```

### Note on sessions table

`connect-pg-simple` creates the `session` table automatically on first startup (`createTableIfMissing: true`). No manual step needed.

---

## T8 — Uploads Folder Backup / Restore Runbook

**Priority: P2 — Medium**

### What is stored

Three subdirectories under `./uploads/` (project root):

| Directory | Content | Approx. size risk |
|---|---|---|
| `uploads/` (root) | Email attachment downloads (UUID filenames) | Can be large — one file per email attachment opened |
| `uploads/assets/` | CRM asset uploads (PDFs, images, docs) | Moderate |
| `uploads/cert-attachments/` | Safety certification project attachments | Small |

Files are stored under UUID filenames for security. The original filename and MIME type are recorded in the database (`attachments` table). **If the uploads directory is lost, the file records remain in the DB but the files themselves are unrecoverable.**

### Export from Replit

**Via Replit shell:**
```bash
tar -czf uploads_backup_$(date +%Y%m%d).tar.gz uploads/
```

Then download the archive through the Replit file panel or use `scp` / `rsync` if a key is configured.

**Via rsync from a remote machine (if Replit SSH is enabled):**
```bash
rsync -avz --progress \
  replit-user@replit-host:/home/runner/workspace/uploads/ \
  ./uploads_backup/
```

### Restore to new host

```bash
# On the new server, in the app's working directory:
tar -xzf uploads_backup_20260507.tar.gz

# Verify directory structure:
ls uploads/
ls uploads/assets/
ls uploads/cert-attachments/

# Verify a known attachment is present:
psql "$DATABASE_URL" \
  -c "SELECT file_name FROM attachments LIMIT 5;" \
  | while read fname; do
      [ -f "uploads/$fname" ] && echo "OK: $fname" || echo "MISSING: $fname"
    done
```

### On multi-instance deployments (Railway, Fly.io with multiple machines)

Local disk is **not shared between instances**. Choose one of:
- **Fly.io / Railway**: Mount a persistent volume at `/app/uploads`. Ensure all instances share the same mount (Fly.io volumes are single-machine by default — use a single machine for uploads or switch to S3).
- **S3 / Cloudflare R2 / GCS**: Replace multer `diskStorage` with multer-s3 or a custom storage engine. This is a code change beyond the scope of this plan.

---

## T9 — Resolve UNKNOWN Package Licenses

**Priority: P2 — Medium**

### Packages flagged as UNKNOWN by `license-checker`

The tool flags packages as `UNKNOWN` when the `license` field in `package.json` uses a non-standard SPDX string or is absent. The actual license files were inspected:

| Package | Actual license | Commercially safe? | Notes |
|---|---|---|---|
| `motion-dom` | MIT (Framer B.V.) | ✅ Yes | License file present, MIT confirmed |
| `motion-utils` | MIT (Framer B.V.) | ✅ Yes | Same package family |
| `traverse` | MIT/X11 (James Halliday) | ✅ Yes | Non-SPDX string — same as MIT |
| `chainsaw` | MIT/X11 (James Halliday) | ✅ Yes | Same |
| `jsuri` | MIT/X11 (Derek Watson) | ✅ Yes | Package.json uses "MIT/X11" string |
| `pause` | MIT (TJ Holowaychuk) | ✅ Yes | Inferred from author and `package.json` pattern |
| `url-template` | BSD-3-Clause | ✅ Yes | Bram Stein; BSD-3 confirmed in LICENSE file |
| `telemetry.jira.js` | Unknown (MrRefactoring) | ⚠️ Verify | Transitive dep of `jira.js`. No LICENSE file found by checker. Inspect manually. |

### Action required

1. **`telemetry.jira.js`** — inspect `node_modules/telemetry.jira.js/` manually:
   ```bash
   cat node_modules/telemetry.jira.js/package.json | grep -i license
   ls node_modules/telemetry.jira.js/
   ```
   If the license cannot be confirmed, raise this with the `jira.js` maintainer (https://github.com/MrRefactoring/jira.js) or replace the package with a direct Atlassian REST API wrapper (which also resolves T2).

2. All other UNKNOWN packages are confirmed commercially safe — no further action needed.

3. Add `license-checker --production --failOn "GPL;AGPL;SSPL"` to the CI pipeline to catch future risky additions automatically.

---

## T10 — Mark Jira / Confluence as Optional Integrations

**Priority: P3 — Low**

### Current state

Both integrations fail silently (throw at runtime, not startup). Users see a 500 error when they open the Jira or Confluence panels if the connector is unconfigured.

### What "optional" means here

- If `ATLASSIAN_CLIENT_ID` (or the equivalent credential after T2) is not set, routes under `/api/jira/*` and `/api/confluence/*` should return a consistent `503 { message: "Jira integration not configured" }` instead of throwing.
- The frontend already conditionally renders these panels — it just needs a stable, predictable error response rather than a 500.

### Implementation plan

1. Add a `isJiraConfigured()` helper that checks whether the required Atlassian credentials exist in the environment (or database).
2. Add a guard at the top of each `/api/jira/*` and `/api/confluence/*` route handler:
   ```ts
   if (!isJiraConfigured()) {
     return res.status(503).json({ message: "Jira integration not configured for this deployment." });
   }
   ```
3. Document in `.env.example` (done in T4) that both integrations are optional.
4. Do this after T2 (the rewrite) since the current Replit-sidecar code will be replaced anyway.

---

## T11 — VPS Deployment Runbook

**Priority: P3 — Low**

### Target: Ubuntu 22.04 / Debian 12 single-server VPS

### Prerequisites

- Node.js 20 LTS (`apt install nodejs` or via `nvm`)
- PostgreSQL 15+ (local or remote)
- A domain name with DNS pointed at the server
- Nginx (reverse proxy + TLS)
- Certbot (Let's Encrypt TLS)
- `pm2` (process manager)

### Step 1 — Server setup

```bash
# Install Node 20 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20

# Install pm2 globally
npm install -g pm2

# Install PostgreSQL
apt install -y postgresql postgresql-contrib

# Create database and user
sudo -u postgres psql -c "CREATE USER voltsafe WITH PASSWORD 'strongpassword';"
sudo -u postgres psql -c "CREATE DATABASE voltsafe OWNER voltsafe;"
```

### Step 2 — Clone and configure

```bash
git clone <your-repo> /opt/voltsafe
cd /opt/voltsafe
npm install

# Create env file from template
cp .env.example .env
nano .env       # fill in all required values — see T4 above
```

### Step 3 — Database setup

**Fresh install (no existing data):**
```bash
npx drizzle-kit generate
psql "$DATABASE_URL" -f <generated-migration>.sql
psql "$DATABASE_URL" -f migrations/0001_zoom_and_booking_links.sql
psql "$DATABASE_URL" -f migrations/0002_meeting_notes.sql
```

**Migrating from Replit:**
```bash
# On Replit first: export
pg_dump "$REPLIT_DATABASE_URL" --no-owner --no-acl -Fc -f /tmp/voltsafe.dump

# Transfer to VPS
scp /tmp/voltsafe.dump user@yourserver:/opt/voltsafe/

# On VPS: import
pg_restore --no-owner --no-acl -d "$DATABASE_URL" /opt/voltsafe/voltsafe.dump
```

### Step 4 — Restore uploads

```bash
# Transfer uploads from Replit (if migrating)
rsync -avz replit-user@replit:/home/runner/workspace/uploads/ /opt/voltsafe/uploads/
chmod -R 755 /opt/voltsafe/uploads/
```

### Step 5 — Build

```bash
cd /opt/voltsafe
tsx script/build.ts
# Output: dist/public/ and dist/index.cjs
```

### Step 6 — Start with pm2

```bash
pm2 start dist/index.cjs --name voltsafe --env production
pm2 save
pm2 startup    # follow the printed command to enable on system boot

# Verify
pm2 logs voltsafe --lines 50
curl http://localhost:5000/health    # should return {"status":"ok"}
```

### Step 7 — Nginx reverse proxy

```nginx
# /etc/nginx/sites-available/voltsafe
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    client_max_body_size 55M;    # matches multer 50MB limit

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/voltsafe /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Add TLS
certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

### Step 8 — Post-deploy: reconfigure webhooks

```bash
# Trigger Gmail watch re-registration for each connected mailbox
curl -X POST https://yourdomain.com/api/gmail/watch/renew \
  -H "Cookie: connect.sid=<admin-session-cookie>"

# Update Google Cloud Pub/Sub subscription push endpoint:
# Google Cloud Console → Pub/Sub → <your-topic> → Subscriptions → Edit
# New endpoint: https://yourdomain.com/api/webhooks/gmail?token=<GMAIL_WEBHOOK_TOKEN>
```

### Step 9 — Smoke test

```bash
curl https://yourdomain.com/health
# Open browser → https://yourdomain.com → confirm login works
# Open Inbox → confirm Gmail messages load
# Create a test contact → confirm CRM writes work
```

---

## T12 — Render / Railway / Fly.io Runbooks

**Priority: P3 — Low**

### Shared setup for all PaaS platforms

```
Build command:   npm install && tsx script/build.ts
Start command:   NODE_ENV=production node dist/index.cjs
Health check:    GET /health → 200
Port:            5000 (or set PORT env var to whatever the platform assigns)
```

Set all env vars from T4's `.env.example` in the platform's environment variables panel.

---

### Render

1. **New Web Service** → connect GitHub repo.
2. Set Build Command and Start Command as above.
3. Add **PostgreSQL** from the Render dashboard → copy the connection string to `DATABASE_URL`.
4. Add a **Persistent Disk** mounted at `/opt/render/project/src/uploads` (the app's working directory) — required for file attachments.
5. Set all env vars in the **Environment** tab.
6. After first deploy, apply migrations:
   ```bash
   # Via Render Shell (available in the dashboard)
   psql "$DATABASE_URL" -f migrations/0001_zoom_and_booking_links.sql
   psql "$DATABASE_URL" -f migrations/0002_meeting_notes.sql
   ```
7. Render automatically provisions TLS for `.onrender.com` domains and custom domains.
8. Set `APP_URL` to your Render URL. Set `CSRF_ALLOWED_HOSTS` to the Render hostname.

**Limitation:** Render persistent disks are single-instance only. Scaling to multiple instances requires migrating file storage to S3/R2 (a future code change).

---

### Railway

1. **New Project** → Deploy from GitHub.
2. Add a **PostgreSQL** plugin — Railway injects `DATABASE_URL` automatically.
3. Set Build and Start commands in service settings.
4. Add a **Volume** mounted at `/app/uploads` for file persistence.
5. Set all remaining env vars in the **Variables** tab.
6. Railway auto-generates a public HTTPS URL (e.g. `voltsafe.up.railway.app`) — set this as `APP_URL`.
7. Set `CSRF_ALLOWED_HOSTS=voltsafe.up.railway.app` (or your custom domain).
8. Apply migrations via Railway's shell plugin or by running `npx tsx scripts/run-migration-pipeline.js` (it reads `DATABASE_URL` from the environment).

---

### Fly.io

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# In project root
fly launch --name voltsafe --region ord    # creates fly.toml
```

`fly.toml` additions:
```toml
[build]
  [build.args]
    NODE_VERSION = "20"

[[services]]
  internal_port = 5000
  protocol = "tcp"
  [[services.http_checks]]
    path = "/health"

[mounts]
  source = "voltsafe_uploads"
  destination = "/app/uploads"
```

```bash
# Create persistent volume
fly volumes create voltsafe_uploads --size 10     # GB

# Set secrets
fly secrets set DATABASE_URL="postgres://..." \
  SESSION_SECRET="..." \
  APP_URL="https://voltsafe.fly.dev" \
  GOOGLE_CLIENT_ID="..." \
  # ... all other vars from .env.example

# Deploy
fly deploy

# Apply migrations via SSH
fly ssh console -C "psql \$DATABASE_URL -f migrations/0001_zoom_and_booking_links.sql"
fly ssh console -C "psql \$DATABASE_URL -f migrations/0002_meeting_notes.sql"
```

**Note on Fly.io multi-region:** If deploying to multiple regions, the Fly volume is region-local. Either pin the app to a single region (`fly scale count 1`) or use Fly's Tigris (S3-compatible) object storage for uploads.

---

## Execution Order Summary

For a team executing this plan cold:

```
Week 1 (unblock deployment):
  T3 → T1 → T4 → T5 → T6
  (startup validation, fix URLs, .env.example, Vite plugins, CSRF)

Week 2 (data + storage):
  T7 → T8 → T9
  (db export/import, uploads backup, license resolution)

Week 3 (integrations):
  T10 → T2
  (mark Jira/Confluence optional, then rewrite connectors)

Week 4 (documentation):
  T11 → T12
  (VPS runbook, PaaS runbooks)
```

Total estimated effort: **~14–16 engineering hours**, excluding T2 (Jira/Confluence rewrite) which depends on whether those integrations are actively used.
