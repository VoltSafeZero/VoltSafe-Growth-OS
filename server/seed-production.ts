import { db } from "./db";
import { sql } from "drizzle-orm";
import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";

const EXPECTED_LEAD_COUNT = 10871;

export async function migrateUserSchema(): Promise<void> {
  try {
    // Ensure new user management columns exist (idempotent)
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS global_role text NOT NULL DEFAULT 'sales'`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS user_type text NOT NULL DEFAULT 'internal'`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS department text`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title text`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by integer`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at timestamp`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_reason text`);

    // Add password reset token columns
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token text`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires timestamp`);

    // Add permissions column for granular access control
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{"crm":"edit","partnerships":"edit","projects":"edit","communications":"edit","team_workload":"edit","knowledge":"edit","support":"edit","quoting":"edit","calendar":"edit","mail_team":{},"calendar_team":[]}'::jsonb`);

    // Set correct roles for known users (idempotent — only sets if still default 'sales')
    await db.execute(sql`UPDATE users SET global_role = 'master_admin', status = 'active' WHERE email = 'trevor@voltsafe.com' AND global_role != 'master_admin'`);
    await db.execute(sql`UPDATE users SET global_role = 'admin', status = 'active' WHERE email = 'terri@voltsafe.com' AND global_role = 'sales'`);
    await db.execute(sql`UPDATE users SET status = 'active' WHERE status = ''`);

    console.log("[migration] User schema migration complete.");
  } catch (err) {
    console.error("[migration] User schema migration error (non-fatal):", err);
  }
}

export async function migrateEmailSchema(): Promise<void> {
  try {
    // Add ownership columns to email_messages
    await db.execute(sql`ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS owner_user_id integer`);
    await db.execute(sql`ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS source_account_id integer`);

    // Add workflow / snooze / CRM-partner columns to email_threads
    await db.execute(sql`ALTER TABLE email_threads ADD COLUMN IF NOT EXISTS primary_partner_id integer`);
    await db.execute(sql`ALTER TABLE email_threads ADD COLUMN IF NOT EXISTS workflow_state text`);
    await db.execute(sql`ALTER TABLE email_threads ADD COLUMN IF NOT EXISTS snoozed_until timestamp`);
    await db.execute(sql`ALTER TABLE email_threads ADD COLUMN IF NOT EXISTS follow_up_at timestamp`);
    await db.execute(sql`ALTER TABLE email_threads ADD COLUMN IF NOT EXISTS assigned_user_id integer`);

    // email_accounts table — one row per connected Gmail account per user
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS email_accounts (
        id serial PRIMARY KEY,
        user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider text NOT NULL DEFAULT 'gmail',
        email_address text NOT NULL,
        is_active boolean DEFAULT true,
        created_at timestamp DEFAULT now() NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL
      )
    `);

    // mail_folders table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS mail_folders (
        id serial PRIMARY KEY,
        owner_user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name text NOT NULL,
        color text NOT NULL DEFAULT 'teal',
        source_account_id integer,
        created_at timestamp DEFAULT now() NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL
      )
    `);

    // mail_folder_domains — domain rules per folder
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS mail_folder_domains (
        id serial PRIMARY KEY,
        folder_id integer NOT NULL REFERENCES mail_folders(id) ON DELETE CASCADE,
        domain text NOT NULL,
        match_type text NOT NULL DEFAULT 'ends_with',
        created_at timestamp DEFAULT now() NOT NULL,
        UNIQUE(folder_id, domain)
      )
    `);

    // email_folder_assignments — which emails belong to which folders
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS email_folder_assignments (
        id serial PRIMARY KEY,
        email_id integer NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
        folder_id integer NOT NULL REFERENCES mail_folders(id) ON DELETE CASCADE,
        owner_user_id integer NOT NULL,
        assigned_by text NOT NULL DEFAULT 'system',
        assignment_reason text,
        created_at timestamp DEFAULT now() NOT NULL,
        UNIQUE(email_id, folder_id)
      )
    `);

    // Indexes for performance
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_email_messages_owner ON email_messages(owner_user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_email_folder_assignments_folder ON email_folder_assignments(folder_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_email_folder_assignments_email ON email_folder_assignments(email_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_mail_folder_domains_folder ON mail_folder_domains(folder_id)`);

    // Backfill: assign all existing emails to Trevor (user_id = 4)
    await db.execute(sql`
      UPDATE email_messages SET owner_user_id = 4 WHERE owner_user_id IS NULL
    `);

    // ── Step 1 (S1) — Expand email_accounts with tracking fields ─────────────
    await db.execute(sql`ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS workspace_id integer NOT NULL DEFAULT 1`);
    await db.execute(sql`ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS display_name text`);
    await db.execute(sql`ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS auth_status text NOT NULL DEFAULT 'active'`);
    await db.execute(sql`ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS scopes_json text`);
    await db.execute(sql`ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS sync_enabled boolean NOT NULL DEFAULT true`);
    await db.execute(sql`ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS last_sync_at timestamp`);
    await db.execute(sql`ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS last_history_id text`);
    await db.execute(sql`ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS sync_error_message text`);
    await db.execute(sql`ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS disconnected_at timestamp`);

    // ── S1 — workspace_id sentinels on mail tables (= 1, single-tenant now) ──
    await db.execute(sql`ALTER TABLE mail_folders ADD COLUMN IF NOT EXISTS workspace_id integer NOT NULL DEFAULT 1`);
    await db.execute(sql`ALTER TABLE email_folder_assignments ADD COLUMN IF NOT EXISTS workspace_id integer NOT NULL DEFAULT 1`);

    // ── Shared mailbox support ────────────────────────────────────────────────
    await db.execute(sql`ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS is_shared boolean NOT NULL DEFAULT false`);

    // ── S1 — Indexes for isolation queries ───────────────────────────────────
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_email_accounts_workspace_user ON email_accounts(workspace_id, user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_email_accounts_auth_status ON email_accounts(auth_status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_mail_folders_owner ON mail_folders(workspace_id, owner_user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_efa_workspace_owner ON email_folder_assignments(workspace_id, owner_user_id)`);

    // ── S1 — Create Trevor's email_accounts record if missing ────────────────
    const existing = await db.execute(sql`SELECT id FROM email_accounts WHERE user_id = 4 LIMIT 1`);
    if ((existing.rows as any[]).length === 0) {
      let trevorsEmail = "trevor@voltsafe.com";
      try {
        const ss = await db.execute(sql`SELECT value FROM system_settings WHERE key = 'gmail_address' LIMIT 1`);
        if ((ss.rows as any[]).length > 0) trevorsEmail = (ss.rows[0] as any).value;
      } catch {}
      await db.execute(sql`
        INSERT INTO email_accounts (workspace_id, user_id, provider, email_address, display_name, auth_status, is_active, sync_enabled)
        VALUES (1, 4, 'gmail', ${trevorsEmail}, 'Trevor Burgess', 'active', true, true)
        ON CONFLICT DO NOTHING
      `);
    } else {
      // Ensure Trevor's existing record has the new fields populated
      await db.execute(sql`
        UPDATE email_accounts
        SET workspace_id = 1,
            auth_status = COALESCE(auth_status, 'active'),
            sync_enabled = COALESCE(sync_enabled, true),
            display_name = COALESCE(display_name, 'Trevor Burgess')
        WHERE user_id = 4
      `);
    }

    // ── Phase 2: Per-user token storage in email_accounts ────────────────────
    await db.execute(sql`ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS refresh_token text`);
    await db.execute(sql`ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS access_token text`);
    // Backfill Trevor's refresh token from system_settings (Phase 1→2 migration)
    await db.execute(sql`
      UPDATE email_accounts
      SET refresh_token = (SELECT value FROM system_settings WHERE key = 'gmail_refresh_token' LIMIT 1)
      WHERE user_id = 4 AND refresh_token IS NULL
        AND EXISTS (SELECT 1 FROM system_settings WHERE key = 'gmail_refresh_token')
    `);

    // ── S1 — Backfill source_account_id on all Trevor's emails ───────────────
    await db.execute(sql`
      UPDATE email_messages
      SET source_account_id = (
        SELECT id FROM email_accounts WHERE user_id = 4 ORDER BY id ASC LIMIT 1
      )
      WHERE source_account_id IS NULL
        AND owner_user_id = 4
    `);
    // Also catch any that still have no owner (belt + suspenders)
    await db.execute(sql`
      UPDATE email_messages
      SET owner_user_id = 4,
          source_account_id = (
            SELECT id FROM email_accounts WHERE user_id = 4 ORDER BY id ASC LIMIT 1
          )
      WHERE owner_user_id IS NULL
    `);

    // ── Partnerships: add industry_types array column ─────────────────────────
    await db.execute(sql`ALTER TABLE partnerships ADD COLUMN IF NOT EXISTS industry_types text[]`);

    console.log("[migration] Email schema migration complete (Step 1: data model + backfill).");
  } catch (err) {
    console.error("[migration] Email schema migration error (non-fatal):", err);
  }
}

export async function seedProductionData(): Promise<void> {
  try {
    const result = await db.execute(sql`SELECT COUNT(*) as cnt FROM leads`);
    const count = Number((result.rows[0] as any).cnt);

    if (count >= EXPECTED_LEAD_COUNT) {
      console.log(`Database has ${count} leads — seed not needed.`);
      await patchMissingMexicoLeads();
      return;
    }

    const dumpFile = path.join(process.cwd(), "server", "seed-data.dump");
    if (!fs.existsSync(dumpFile)) {
      console.log("No seed-data.dump file found — skipping seed.");
      return;
    }

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      console.log("No DATABASE_URL — skipping seed.");
      return;
    }

    if (count > 0) {
      console.log(`Database has ${count}/${EXPECTED_LEAD_COUNT} leads — incomplete data, clearing and re-seeding...`);
      const tables = [
        "messages", "conversations", "comments", "attachments", "activities",
        "tasks", "calendar_events", "webauthn_credentials",
        "ecosystem_relationships", "ecosystem_events", "ecosystem_people",
        "ecosystem_organizations", "ecosystem_regions",
        "partnerships", "contacts", "tickets", "quotes",
        "leads", "accounts", "users", "metrics", "sales"
      ];
      for (const table of tables) {
        try {
          await db.execute(sql`TRUNCATE TABLE ${sql.identifier(table)} CASCADE`);
        } catch {}
      }
      console.log("Tables cleared.");
    } else {
      console.log("Database is empty — seeding with data...");
    }

    try {
      execSync(
        `pg_restore --no-owner --no-privileges --data-only --disable-triggers -d "${dbUrl}" "${dumpFile}"`,
        { stdio: "pipe", timeout: 120000 }
      );
      console.log("Seed complete via pg_restore.");
    } catch (restoreErr: any) {
      const stderr = restoreErr.stderr?.toString() || "";
      if (stderr.includes("errors ignored") || restoreErr.status === 1) {
        console.log("Seed complete (some non-critical warnings).");
      } else {
        console.error("pg_restore issue:", stderr.substring(0, 500));
      }
    }

    const afterCount = await db.execute(sql`SELECT COUNT(*) as cnt FROM leads`);
    console.log(`Seed verification: ${(afterCount.rows[0] as any).cnt} leads in database.`);
  } catch (err) {
    console.error("Error during seed:", err);
  }

  await patchMissingMexicoLeads();
}

async function patchMissingMexicoLeads(): Promise<void> {
  const missing = [
    { company: "Marina Puerto de la Navidad Isla Navidad", contactName: "Marina Contact", source: "marina_directory", status: "new", slips: "207", segment: "marina", state: "Colima", country: "MX", dealCurrency: "USD" },
    { company: "Hotel Coral and Marina", contactName: "Marina Contact", source: "marina_directory", status: "new", slips: "350", segment: "marina", state: "Baja California", country: "MX", dealCurrency: "USD" },
    { company: "Marina Riviera", contactName: "Marina Contact", source: "marina_directory", status: "new", segment: "marina", city: "Punta de Mita", state: "Nayarit", country: "MX", dealCurrency: "USD" },
    { company: "Pemex Fuel Dock", contactName: "Marina Contact", source: "marina_directory", status: "new", segment: "marina", city: "Santa Maria Huatulco", state: "Oaxaca", country: "MX", dealCurrency: "USD" },
    { company: "Marina Fonatur", contactName: "Marina Contact", source: "marina_directory", status: "new", segment: "marina", city: "Q.R.", state: "Quintana Roo", country: "MX", dealCurrency: "USD" },
    { company: "Paradise Village Hotel", contactName: "Marina Contact", source: "marina_directory", status: "new", segment: "marina", city: "Nuevo Vallarta", state: "Mexico", country: "MX", dealCurrency: "USD" },
    { company: "Puerto de Abrigo", contactName: "Marina Contact", source: "marina_directory", status: "new", segment: "marina", city: "Cozumel", state: "Quintana Roo", country: "MX", dealCurrency: "USD" },
    { company: "Marina Fonatur", contactName: "Marina Contact", source: "marina_directory", status: "new", slips: "294", segment: "marina", city: "Heroica Guaymas", state: "Sonora", country: "MX", dealCurrency: "USD" },
    { company: "Marina Real", contactName: "Marina Contact", source: "marina_directory", status: "new", slips: "220", segment: "marina", city: "San Carlos", state: "Sonora", country: "MX", dealCurrency: "USD" },
  ];

  let inserted = 0;
  for (const lead of missing) {
    try {
      const existing = await db.execute(
        sql`SELECT id FROM leads WHERE company = ${lead.company} AND country = ${lead.country} AND state = ${lead.state ?? null} AND city IS NOT DISTINCT FROM ${lead.city ?? null} LIMIT 1`
      );
      if ((existing.rows as any[]).length > 0) continue;

      await db.execute(sql`
        INSERT INTO leads (company, contact_name, source, status, slips, segment, city, state, country, deal_currency, tags)
        VALUES (
          ${lead.company}, ${lead.contactName}, ${lead.source}, ${lead.status},
          ${lead.slips ?? null}, ${lead.segment}, ${lead.city ?? null}, ${lead.state ?? null},
          ${lead.country}, ${lead.dealCurrency}, ''
        )
      `);
      inserted++;
    } catch {}
  }

  if (inserted > 0) {
    console.log(`[patch] Inserted ${inserted} missing Mexico marina lead(s).`);
  }
}
