# CONTROLLED VOLTSAFE CMS RECOVERY
# Gate 1 Complete — Gate 2 Blocked — Human Action Required

**Document:** CONTROLLED-VOLTSAFE-CMS-RECOVERY-VALIDATE-0dc8f604  
**Branch:** `recovery/pre-mail-stable-staging`  
**Report date:** 2026-08-01  
**Status:** GATE 1 PASS — GATE 2 BLOCKED (Neon credentials not in workspace) — STOPPED per document instructions

---

## GATE 1 — PERMANENTLY TAG AND PRESERVE THE BASELINE ✅ PASS

### Step 1: Commit and branch reachability

All four required commits verified reachable via `git cat-file -t`:

| Commit | Type | Short message | Reachable |
|--------|------|---------------|-----------|
| `0dc8f604` | commit | Published your App | ✅ YES |
| `e71a0d20` | commit | step5: gate all startup writers behind ROLLBACK_VALIDATION_READ_ONLY | ✅ YES |
| `7f401925` | commit | Add incident correction forensic documentation | ✅ YES |
| `18a59dbe` | commit | Fix inboxCategoryQ: bare tokens only; is:unread appended at call site | ✅ YES |

### Step 2: Branch verification

| Branch | Status |
|--------|--------|
| `recovery/pre-mail-stable-staging` | ✅ Present (current branch) |
| `recovery/pre-mail-stable` | ✅ Present |
| `incident-contaminated-workspace-2026-07-31` | ✅ Present at `7f401925` |
| `origin/main` | ✅ Remote confirmed at `18a59dbe` |

`origin/main` confirmed via `git ls-remote origin main`:
```
18a59dbe3d2405b400dc455376e3a485e165504f  refs/heads/main
```

### Step 3: Annotated tags created

All four annotated local tags created successfully. Not pushed (per document instructions).

| Tag | Target commit (full SHA) | Annotation summary |
|-----|--------------------------|-------------------|
| `pre-mail-stable-2026-07-27` | `0dc8f60462135e58f7c0d13d42a521a0f40a4224` | Stable VoltSafe CMS baseline — last known-good published application before the five-day Mail repair campaign. Original Currents (current.tsx, /api/current/*, current_* tables) intact. No replacement Currents contamination. Published to production 2026-07-27T08:05:24Z. |
| `pre-mail-stable-hardened-staging` | `e71a0d206fc552c4ab3b5a95b02220bebd1b924a` | Hardened rollback candidate built on pre-mail-stable-2026-07-27 baseline. Adds two-layer production seed kill-switch, RUN_STARTUP_MIGRATIONS gate, and ROLLBACK_VALIDATION_READ_ONLY gate covering all 27 unconditional startup writers. Original Currents intact. Replacement Currents absent. Tested: 36/36 gate tests + 31/31 seed kill-switch tests pass. |
| `incident-preserved-2026-07-31` | `7f4019254b2b36517b38b6335d8019f196675032` | Preserved contaminated workspace state as of 2026-07-31 SEV-1 incident. Contains replacement Currents implementation (currents.tsx, /api/currents/*, currents_* schema) which must not be merged into mainline. Also present on branch incident-contaminated-workspace-2026-07-31. DO NOT DEPLOY. |
| `pre-recovery-github-main` | `18a59dbe3d2405b400dc455376e3a485e165504f` | State of origin/main immediately before the controlled recovery operation began. Corresponds to GitHub main SHA 18a59dbe (Fix inboxCategoryQ). Preserved for reference and potential rollback if the recovery operation must be undone. |

### Step 4: Git status

```
On branch recovery/pre-mail-stable-staging
Untracked files:
  attached_assets/Pasted-CONTROLLED-VOLTSAFE-CMS-RECOVERY-VALIDATE-0dc8f604-AND-_1785544406695.txt

nothing added to commit but untracked files present
```

Working tree is clean. No uncommitted changes.

### Note on staging branch HEAD

The current HEAD of `recovery/pre-mail-stable-staging` is `02788b2e`, which is a direct descendant of the tagged `e71a0d20`. The two commits between them are documentation-only additions (validation reports written to `attached_assets/`). No code changes. This satisfies Gate 5's requirement of "e71a0d20 or a direct descendant containing only approved rollback-safety work."

**GATE 1: PASS.** All four targets reachable. All four annotated tags created correctly. Tags not yet pushed.

---

## GATE 2 — CREATE A REAL PRODUCTION DATABASE CLONE ❌ BLOCKED

### Investigation result

The following environment variables were checked for Neon API credentials:

| Variable | Status |
|----------|--------|
| `NEON_API_KEY` | NOT SET |
| `NEON_API_TOKEN` | NOT SET |
| `NEON_PROJECT_ID` | NOT SET |
| `DATABASE_URL` | Present — points to dev database (not Neon production) |
| `PROD_DATABASE_URL` | Present (Replit secret) — not a direct psql connection string usable for Neon API calls |
| `PGHOST` | `localhost` (dev DB) |

**The Neon API key and project ID are not available in this workspace.** Programmatic branch creation is not possible.

Per document instructions: "If Neon credentials or permissions are unavailable: do not improvise, do not use production directly, output the exact human steps Trevor must perform in Neon, STOP before Gate 3."

---

## EXACT HUMAN STEPS FOR TREVOR — NEON BRANCH CLONE

Perform these steps yourself in the Neon console. Do not share credentials with the agent.

### Step 1 — Log in to Neon

1. Go to `https://console.neon.tech`
2. Sign in with the account that owns the VoltSafe project

### Step 2 — Locate the VoltSafe project

1. In the project list, find the VoltSafe project
2. Note the **Project ID** (format: `prj-XXXXXX-XXXXXX-XXXXXX`) — you will need this if using the API
3. Note the **primary branch name** (usually `main` or `production`)
4. Confirm the primary branch size reads approximately **1,511 MB**

### Step 3 — Create the validation clone branch

**Option A — Neon Console UI (recommended):**

1. Click **Branches** in the left sidebar
2. Click **New Branch**
3. Configure the branch:
   - **Branch name:** `rollback-validation-2026-07-31`
   - **Branch from:** the primary/main production branch
   - **Branch point:** select "Head" (latest commit) — this clones the current production state
   - **Compute:** create a new compute endpoint (leave defaults)
   - **Access:** do NOT check "Allow direct connections from outside Neon" if avoidable
4. Click **Create Branch**
5. Wait for creation to complete (usually 10–30 seconds for a 1.5 GB database)

**Option B — Neon CLI:**
```bash
neon branches create \
  --project-id <your-project-id> \
  --name rollback-validation-2026-07-31 \
  --parent main
```

**Option C — Neon API:**
```bash
curl -X POST https://console.neon.tech/api/v2/projects/<project-id>/branches \
  -H "Authorization: Bearer <neon-api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "branch": {
      "name": "rollback-validation-2026-07-31",
      "parent_id": "<main-branch-id>"
    },
    "endpoints": [{"type": "read_write"}]
  }'
```

### Step 4 — Create a read-only database role on the clone

After the branch is created:

1. In the Neon console, click the new `rollback-validation-2026-07-31` branch
2. Click **Roles** → **New Role**
3. Create a role named `rollback_readonly`
4. Run the following SQL against the **clone branch** (not production) via the Neon console SQL editor:

```sql
-- Grant read-only access to the rollback_readonly role
GRANT CONNECT ON DATABASE neondb TO rollback_readonly;
GRANT USAGE ON SCHEMA public TO rollback_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO rollback_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO rollback_readonly;

-- Verify it cannot write (test — should fail with permission denied):
-- SET ROLE rollback_readonly;
-- INSERT INTO leads (full_name) VALUES ('test'); -- should fail
-- RESET ROLE;
```

5. Copy the **connection string** for the `rollback_readonly` role on the `rollback-validation-2026-07-31` branch. It will look like:
   ```
   postgresql://rollback_readonly:<password>@ep-<endpoint-id>.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
   **Do not share this in chat.** Add it to the Replit workspace as a secret named `ROLLBACK_CLONE_DB_URL`.

### Step 5 — Record and report back

After completing the above, report back to the agent with:

1. Neon project identifier (not the API key — just the project slug/name)
2. Source production branch name
3. Clone branch name: `rollback-validation-2026-07-31`
4. Clone database name (should be `neondb`)
5. Clone creation timestamp (shown in Neon console)
6. Source timestamp / LSN (the "Parent LSN" shown in branch details)
7. Clone endpoint ID (format `ep-XXXXXX-XXXXXX`) — this is not a credential
8. Clone size as shown in Neon console
9. Confirmation that the production branch was not modified

**Do not share:**
- Neon API key
- Connection strings / passwords
- Session tokens

### Step 6 — Add secret to Replit workspace

In the Replit workspace:
1. Click the lock icon (Secrets) in the sidebar
2. Add a new secret:
   - **Key:** `ROLLBACK_CLONE_DB_URL`
   - **Value:** the connection string for `rollback_readonly` on the clone branch
3. Confirm it is saved

### Step 7 — Also investigate the 40+ GB database

While in the Neon console:

1. Click **Branches** and review **ALL** branches, including any shown as deleted or archived
2. For any branch sized ≥ 5 GB, note:
   - Branch name
   - Size
   - Created at timestamp
   - Parent branch
   - Whether it can be recovered (if deleted, whether it is within the retention window)
3. Check **Project Settings → Backups / PITR** to see:
   - Whether Point-in-Time Recovery is enabled
   - The retention window
   - The oldest recoverable point
4. Check **Project Audit Log** for branch creation and deletion events
5. Report all findings (no credentials needed — just names, sizes, timestamps)

---

## STOPPED — GATE 3 NOT ENTERED

Per document instructions: "If Neon credentials or permissions are unavailable — STOP before Gate 3."

Gates 3 through 10 cannot proceed until Trevor completes the Neon branch creation steps above and adds `ROLLBACK_CLONE_DB_URL` to the Replit workspace secrets.

---

## PARTIAL GATE 10 — FINAL REPORT (current state)

```
Stable baseline tag created:         YES — pre-mail-stable-2026-07-27 → 0dc8f604
Hardened baseline tag created:       YES — pre-mail-stable-hardened-staging → e71a0d20
Incident preservation tag created:   YES — incident-preserved-2026-07-31 → 7f401925
Pre-recovery main tag created:       YES — pre-recovery-github-main → 18a59dbe

Production clone created:            NO — BLOCKED (Neon API key not in workspace secrets)
Clone name:                          (pending: rollback-validation-2026-07-31)
Clone source timestamp:              (pending)
Clone matches production:            (pending)

Database-level read-only enforced:   (pending clone creation)
Rejected write tests:                (pending)
Startup writers skipped:             27/27 (proven in prior Step 5 validation)
Unexpected writes:                   0 (proven in prior Step 5 validation)

Functional verdict:                  PENDING — Gate 6 not entered
Original Currents:                   (pending authenticated walkthrough)
Currents production data visible:    (pending)
VoltSafe Mail basic behavior:        (pending)
Core CMS modules:                    (pending)
Permission isolation:                (pending)
Schema compatibility:                CLEAN — no schema incompatibilities found

New mainline branch created:         NO (Gate 8 not reached)
Recovery commit SHA:                 (pending)
Build:                               (pending)
Tests:                               (pending)
Diff reviewed:                       (pending)

Recovery branch pushed:              NO
GitHub PR created:                   NO
GitHub main updated:                 NO
Force-push used:                     NO

Production deployed:                 NO

Current origin/main SHA:             18a59dbe
Contaminated branch preserved:       YES — incident-contaminated-workspace-2026-07-31 at 7f401925
Tags pushed:                         NO (not yet — per document instructions, push after recovery branch lands)

Ready for production deployment:
  NO — a separate production deployment approval from Trevor is required.
```

---

## WAITING FOR

1. Trevor to create the Neon branch clone (`rollback-validation-2026-07-31`)
2. Trevor to add `ROLLBACK_CLONE_DB_URL` to Replit workspace secrets
3. Trevor to report: clone timestamp, source LSN, endpoint ID, clone size, any 40+ GB branches found in Neon console

Once those three items are provided, gates 3–10 can proceed sequentially.
