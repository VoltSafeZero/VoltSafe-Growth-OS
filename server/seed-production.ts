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

    // Reply/forward tracking — did the user reply to or forward this inbound thread?
    await db.execute(sql`ALTER TABLE email_threads ADD COLUMN IF NOT EXISTS is_replied_by_user boolean DEFAULT false`);
    await db.execute(sql`ALTER TABLE email_threads ADD COLUMN IF NOT EXISTS is_forwarded_by_user boolean DEFAULT false`);

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

    // Full-text search GIN index v2 — includes all_participants so CC/BCC
    // recipient searches use an index scan instead of a sequential scan.
    // Applied here (startup migration) so production gets it on first boot.
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS idx_email_fts_v2 ON email_messages USING gin (
        to_tsvector('english',
          coalesce(subject, '') || ' ' ||
          coalesce(from_name, '') || ' ' ||
          coalesce(from_email, '') || ' ' ||
          coalesce(snippet, '') || ' ' ||
          coalesce(body_text, '') || ' ' ||
          coalesce(all_participants, '')
        )
      )
    `));

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

export async function migrateCalendarSchema(): Promise<void> {
  try {
    // Add external sync columns to calendar_events
    await db.execute(sql`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS external_id text`);
    await db.execute(sql`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS external_provider text`);
    await db.execute(sql`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS external_calendar_id text`);
    await db.execute(sql`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS external_etag text`);

    // Create calendar_connections table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS calendar_connections (
        id serial PRIMARY KEY,
        user_id integer NOT NULL,
        provider text NOT NULL,
        account_email text,
        display_name text,
        is_active boolean NOT NULL DEFAULT true,
        access_token text,
        refresh_token text,
        token_expires_at timestamp,
        caldav_url text,
        caldav_username text,
        caldav_password text,
        default_calendar_id text,
        default_calendar_name text,
        sync_enabled boolean NOT NULL DEFAULT true,
        sync_direction text DEFAULT 'both',
        sync_frequency_minutes integer DEFAULT 15,
        last_synced_at timestamp,
        sync_token text,
        sync_error text,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);

    // Add new columns to existing tables (idempotent)
    await db.execute(sql`ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS conflict_resolution text DEFAULT 'latest_wins'`);
    await db.execute(sql`ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS calendars_discovered jsonb`);

    // Indexes
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_calendar_connections_user ON calendar_connections(user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_calendar_events_external ON calendar_events(external_id, external_provider)`);

    console.log("[migration] Calendar schema migration complete.");
  } catch (err) {
    console.error("[migration] Calendar schema migration error (non-fatal):", err);
  }
}

export async function migrateExecutionSchema(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at timestamp`);
    await db.execute(sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_reminded_at timestamp`);
    await db.execute(sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminder_count integer NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS escalation_level integer NOT NULL DEFAULT 0`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS task_reminder_logs (
        id serial PRIMARY KEY,
        task_id integer NOT NULL,
        user_id integer NOT NULL,
        reminder_type text NOT NULL,
        channel text NOT NULL DEFAULT 'in_app',
        notification_id integer,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_reminder_logs_task ON task_reminder_logs(task_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_reminder_logs_user ON task_reminder_logs(user_id, created_at)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS task_digests (
        id serial PRIMARY KEY,
        user_id integer NOT NULL,
        digest_type text NOT NULL,
        period_start timestamp NOT NULL,
        period_end timestamp NOT NULL,
        payload jsonb NOT NULL,
        delivered_at timestamp NOT NULL DEFAULT now(),
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_task_digests_user ON task_digests(user_id, digest_type, delivered_at)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS execution_settings (
        id serial PRIMARY KEY,
        user_id integer NOT NULL UNIQUE,
        reminder_hour integer NOT NULL DEFAULT 9,
        overdue_escalation_days integer NOT NULL DEFAULT 3,
        max_reminders_per_day integer NOT NULL DEFAULT 3,
        manager_digest_enabled boolean NOT NULL DEFAULT true,
        suggestions_in_digest boolean NOT NULL DEFAULT true,
        bulk_confirm_enabled boolean NOT NULL DEFAULT true,
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);

    // Unique index on notifications.dedupe_key so ON CONFLICT (dedupe_key) works.
    // Drop any partial version first (idempotent), then ensure full unique index exists.
    await db.execute(sql.raw(`DROP INDEX IF EXISTS idx_notifications_dedupe_key_unique`));
    await db.execute(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe_key_unique
      ON notifications (dedupe_key) NULLS NOT DISTINCT
    `));

    console.log("[migration] Execution schema migration complete.");
  } catch (err) {
    console.error("[migration] Execution schema migration error (non-fatal):", err);
  }
}

export async function migrateSuggestionsSchema(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS task_suggestions (
        id serial PRIMARY KEY,
        object_type text NOT NULL,
        object_id integer NOT NULL,
        signal_type text NOT NULL,
        severity text NOT NULL DEFAULT 'medium',
        title text NOT NULL,
        reason text NOT NULL,
        suggested_action_type text NOT NULL,
        suggested_action_label text NOT NULL,
        priority text NOT NULL DEFAULT 'medium',
        suggested_due_date timestamp,
        status text NOT NULL DEFAULT 'pending',
        snoozed_until timestamp,
        created_task_id integer,
        dismissed_at timestamp,
        accepted_at timestamp,
        source_signals text,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_task_suggestions_object ON task_suggestions(object_type, object_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_task_suggestions_status ON task_suggestions(status, updated_at)`);
    console.log("[migration] Suggestions schema migration complete.");
  } catch (err) {
    console.error("[migration] Suggestions schema migration error (non-fatal):", err);
  }
}

export async function migrateProcurementSchema(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS suppliers (
        id serial PRIMARY KEY,
        name text NOT NULL,
        contact_name text,
        contact_email text,
        phone text,
        country text,
        region text,
        lead_time_days integer,
        status text NOT NULL DEFAULT 'active',
        notes text,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS parts (
        id serial PRIMARY KEY,
        sku text NOT NULL,
        name text NOT NULL,
        description text,
        category text,
        unit text NOT NULL DEFAULT 'each',
        unit_cost real,
        supplier_id integer,
        lead_time_days integer,
        notes text,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id serial PRIMARY KEY,
        po_number text NOT NULL,
        supplier_id integer,
        status text NOT NULL DEFAULT 'draft',
        account_id integer,
        opportunity_id integer,
        install_workflow_id integer,
        owner_user_id integer,
        expected_delivery_date timestamp,
        actual_delivery_date timestamp,
        issued_at timestamp,
        total_amount real,
        currency text NOT NULL DEFAULT 'USD',
        notes text,
        blockers text,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS purchase_order_lines (
        id serial PRIMARY KEY,
        purchase_order_id integer NOT NULL,
        part_id integer,
        description text,
        quantity real NOT NULL DEFAULT 1,
        quantity_received real NOT NULL DEFAULT 0,
        unit_cost real,
        notes text,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS production_batches (
        id serial PRIMARY KEY,
        batch_number text NOT NULL,
        part_id integer,
        part_name text,
        quantity real NOT NULL DEFAULT 1,
        status text NOT NULL DEFAULT 'planned',
        install_workflow_id integer,
        account_id integer,
        owner_user_id integer,
        planned_start_date timestamp,
        actual_start_date timestamp,
        target_completion_date timestamp,
        actual_completion_date timestamp,
        notes text,
        blockers text,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS inventory_allocations (
        id serial PRIMARY KEY,
        part_id integer NOT NULL,
        location text NOT NULL DEFAULT 'warehouse',
        quantity_on_hand real NOT NULL DEFAULT 0,
        quantity_allocated real NOT NULL DEFAULT 0,
        quantity_reserved_cert real NOT NULL DEFAULT 0,
        install_workflow_id integer,
        notes text,
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);

    // Indexes
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_po_lines_po ON purchase_order_lines(purchase_order_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_prod_batches_status ON production_batches(status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_prod_batches_install ON production_batches(install_workflow_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_inventory_part ON inventory_allocations(part_id)`);

    console.log("[migration] Procurement schema migration complete.");
  } catch (err) {
    console.error("[migration] Procurement schema migration error (non-fatal):", err);
  }
}

export async function migrateDeploymentSchema(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS deployments (
        id serial PRIMARY KEY,
        deploy_number text NOT NULL,
        site_name text NOT NULL,
        address text,
        region text,
        account_id integer,
        install_workflow_id integer,
        opportunity_id integer,
        owner_user_id integer,
        status text NOT NULL DEFAULT 'planned',
        planned_start timestamp,
        actual_start timestamp,
        target_go_live timestamp,
        actual_go_live timestamp,
        docks_count integer,
        units_count integer,
        notes text,
        blockers text,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS deployment_hardware_allocations (
        id serial PRIMARY KEY,
        deployment_id integer NOT NULL,
        part_id integer,
        inventory_allocation_id integer,
        description text,
        quantity_required real NOT NULL DEFAULT 1,
        quantity_reserved real NOT NULL DEFAULT 0,
        quantity_shipped real NOT NULL DEFAULT 0,
        quantity_delivered real NOT NULL DEFAULT 0,
        status text NOT NULL DEFAULT 'pending',
        notes text,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS commissioning_checkpoints (
        id serial PRIMARY KEY,
        deployment_id integer NOT NULL,
        name text NOT NULL,
        description text,
        sequence_order integer NOT NULL DEFAULT 0,
        status text NOT NULL DEFAULT 'pending',
        checked_by_user_id integer,
        checked_at timestamp,
        notes text,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS deployment_blockers (
        id serial PRIMARY KEY,
        deployment_id integer NOT NULL,
        title text NOT NULL,
        description text,
        severity text NOT NULL DEFAULT 'medium',
        status text NOT NULL DEFAULT 'open',
        resolved_at timestamp,
        resolved_by_user_id integer,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);

    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_deployments_account ON deployments(account_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_deployments_install ON deployments(install_workflow_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_deploy_hw_deployment ON deployment_hardware_allocations(deployment_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_commissioning_deployment ON commissioning_checkpoints(deployment_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_deploy_blockers_deployment ON deployment_blockers(deployment_id, status)`);

    console.log("[migration] Deployment schema migration complete.");
  } catch (err) {
    console.error("[migration] Deployment schema migration error (non-fatal):", err);
  }
}

export async function migrateProjectCertificationSchema(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS project_certifications (
        id serial PRIMARY KEY,
        project_id integer NOT NULL UNIQUE,
        certification_program text,
        certification_scope text,
        product_name text,
        product_version text,
        product_revision text,
        sku_or_internal_code text,
        certification_priority text DEFAULT 'Medium',
        testing_lab_name text,
        lab_contact_name text,
        lab_contact_email text,
        lab_contact_phone text,
        certification_standard_codes text,
        target_market text,
        application_submission_date timestamp,
        planned_test_start_date timestamp,
        actual_test_start_date timestamp,
        target_completion_date timestamp,
        actual_completion_date timestamp,
        certification_status text DEFAULT 'Planning',
        overall_risk text DEFAULT 'Low',
        launch_blocker boolean DEFAULT false,
        blocker_summary text,
        last_status_update timestamp,
        next_action text,
        next_action_due_date timestamp,
        sample_units_required integer,
        sample_units_built integer,
        sample_units_shipped integer,
        sample_units_received_by_lab integer,
        sample_serial_numbers text,
        sample_notes text,
        failure_found boolean DEFAULT false,
        failure_summary text,
        corrective_action_required boolean DEFAULT false,
        corrective_action_summary text,
        retest_required boolean DEFAULT false,
        retest_date timestamp,
        pass_date timestamp,
        certificate_issue_date timestamp,
        certificate_expiry_date timestamp,
        internal_owner_user_id integer,
        engineering_owner text,
        operations_owner text,
        linked_supplier text,
        linked_production_batch text,
        estimated_certification_cost real,
        actual_certification_cost real,
        budget_status text DEFAULT 'On Budget',
        certification_doc_link text,
        test_report_link text,
        shared_drive_folder_link text,
        certificate_file text,
        compliance_notes text,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_pc_project ON project_certifications(project_id)`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS project_milestones (
      id serial PRIMARY KEY,
      project_id integer NOT NULL,
      title text NOT NULL,
      status text DEFAULT 'pending',
      sort_order integer DEFAULT 0,
      due_date timestamp,
      completed_at timestamp,
      notes text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_pm_project ON project_milestones(project_id)`);
    console.log("[migration] Project certification schema migration complete.");
  } catch (err) {
    console.error("[migration] Project certification schema migration error (non-fatal):", err);
  }
}

export async function migrateProjectOversightSchema(): Promise<void> {
  try {
    // Phase 3 — attachments
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS project_attachments (
        id serial PRIMARY KEY,
        project_id integer NOT NULL,
        filename text NOT NULL,
        original_name text NOT NULL,
        file_path text NOT NULL,
        file_size integer,
        mime_type text,
        uploaded_by_user_id integer,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_pa_project ON project_attachments(project_id)`);

    // Phase 4 — timeline events
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS project_timeline_events (
        id serial PRIMARY KEY,
        project_id integer NOT NULL,
        event_type text NOT NULL,
        description text,
        event_data jsonb,
        actor_user_id integer,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_pte_project ON project_timeline_events(project_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_pte_created ON project_timeline_events(project_id, created_at DESC)`);

    console.log("[migration] Project oversight schema migration complete.");
  } catch (err) {
    console.error("[migration] Project oversight schema migration error (non-fatal):", err);
  }
}

export async function migrateCustomerSuccessSchema(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS customer_subscriptions (
        id serial PRIMARY KEY,
        account_id integer NOT NULL,
        deployment_id integer,
        install_workflow_id integer,
        opportunity_id integer,
        owner_user_id integer,
        status text NOT NULL DEFAULT 'active',
        go_live_date timestamp,
        subscription_start timestamp,
        subscription_end timestamp,
        renewal_date timestamp,
        contract_term_months integer DEFAULT 12,
        mrr real DEFAULT 0,
        arr real DEFAULT 0,
        billing_status text DEFAULT 'current',
        health_score integer DEFAULT 100,
        health_status text DEFAULT 'healthy',
        churn_risk_flags jsonb,
        expansion_potential text DEFAULT 'none',
        expansion_notes text,
        expansion_opportunity_id integer,
        last_checkin_at timestamp,
        renewal_task_created boolean DEFAULT false,
        notes text,
        tags text,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_cs_account ON customer_subscriptions(account_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_cs_status ON customer_subscriptions(status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_cs_renewal ON customer_subscriptions(renewal_date)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_cs_health ON customer_subscriptions(health_status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_cs_owner ON customer_subscriptions(owner_user_id)`);
    console.log("[migration] Customer success schema migration complete.");
  } catch (err) {
    console.error("[migration] Customer success schema migration error (non-fatal):", err);
  }
}

export async function migrateMergeAuditSchema(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS merge_audit_log (
        id serial PRIMARY KEY,
        entity_type text NOT NULL,
        primary_id integer NOT NULL,
        secondary_id integer NOT NULL,
        merged_by_user_id integer NOT NULL,
        merged_at timestamp NOT NULL DEFAULT now(),
        field_resolutions jsonb,
        linked_object_counts jsonb,
        warnings jsonb,
        primary_snapshot_json jsonb,
        secondary_snapshot_json jsonb,
        archived_secondary boolean DEFAULT true
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_merge_audit_entity ON merge_audit_log(entity_type, primary_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_merge_audit_secondary ON merge_audit_log(entity_type, secondary_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_merge_audit_merged_at ON merge_audit_log(merged_at DESC)`);
    console.log("[migration] Merge audit schema migration complete.");
  } catch (err) {
    console.error("[migration] Merge audit schema migration error (non-fatal):", err);
  }
}


export async function migrateCsTimelineSchema(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS cs_timeline_events (
        id serial PRIMARY KEY,
        cs_id integer NOT NULL REFERENCES customer_subscriptions(id) ON DELETE CASCADE,
        event_type text NOT NULL,
        description text NOT NULL,
        event_data jsonb DEFAULT '{}'::jsonb,
        actor_user_id integer,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_cs_events_cs_id ON cs_timeline_events(cs_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_cs_events_type ON cs_timeline_events(event_type)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_cs_events_created ON cs_timeline_events(created_at DESC)`);
    console.log("[migration] CS timeline schema migration complete.");
  } catch (err) {
    console.error("[migration] CS timeline schema migration error (non-fatal):", err);
  }
}

export async function migrateDocumentSchema(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE attachments ADD COLUMN IF NOT EXISTS title text`);
    await db.execute(sql`ALTER TABLE attachments ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'general'`);
    await db.execute(sql`ALTER TABLE attachments ADD COLUMN IF NOT EXISTS notes text`);
    await db.execute(sql`ALTER TABLE attachments ADD COLUMN IF NOT EXISTS tags text[]`);
    await db.execute(sql`ALTER TABLE attachments ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'upload'`);
    await db.execute(sql`ALTER TABLE attachments ADD COLUMN IF NOT EXISTS url text`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_attachments_category ON attachments(category)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_attachments_source ON attachments(source)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_attachments_uploaded_by ON attachments(uploaded_by)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_attachments_object ON attachments(object_type, object_id)`);
    console.log("[migration] Document schema migration complete.");
  } catch (err) {
    console.error("[migration] Document schema migration error (non-fatal):", err);
  }
}

export async function seedSampleProjects(): Promise<void> {
  try {
    const result = await db.execute(sql`SELECT COUNT(*) as cnt FROM projects`);
    const count = Number((result.rows[0] as any).cnt);
    if (count > 0) {
      console.log(`[seed] Projects already seeded (${count} found) — skipping.`);
      return;
    }

    // Get the first available user id as owner
    const userResult = await db.execute(sql`SELECT id FROM users WHERE email = 'trevor@voltsafe.com' LIMIT 1`);
    const ownerId = userResult.rows.length > 0 ? (userResult.rows[0] as any).id : null;

    const samples = [
      { name: "BC Coastal Marina Pilot — Phase 1", type: "pilot", status: "active", phase: "Discovery", description: "Shore power pilot at 3 marinas along Vancouver Island's west coast.", budget: 45000 },
      { name: "Pacific Rim Marina Network — Pilot", type: "pilot", status: "active", phase: "Installation", description: "20-slip pilot deployment in Ucluelet harbour.", budget: 32000 },
      { name: "San Juan Islands Lighthouse Program", type: "lighthouse", status: "active", phase: "Negotiation", description: "Lighthouse customer initiative with Friday Harbor Marina.", budget: 78000 },
      { name: "OEM Licensing Outreach Q2", type: "partnership", status: "active", phase: "Negotiation", description: "Partnership discussions with three marine equipment OEMs.", budget: 5000 },
      { name: "BC Sustainable Marina Grant", type: "grant", status: "planning", phase: "Application", description: "CleanBC grant application for shore power infrastructure.", budget: 120000 },
      { name: "Shore Power ROI Study 2025", type: "research", status: "active", phase: "Data Collection", description: "Internal research project quantifying energy savings across pilot sites.", budget: 18000 },
      { name: "Victoria Boat Show 2025", type: "event", status: "planning", phase: "Logistics", description: "Presence at Victoria Boat Show including demo station.", budget: 12000 },
      { name: "Marina Owner Campaign — Q3", type: "marketing", status: "active", phase: "Content Creation", description: "Email + LinkedIn campaign targeting BC marina operators.", budget: 8500 },
      { name: "CRM Data Cleanup Initiative", type: "internal", status: "active", phase: "In Progress", description: "Standardise account tagging and lead sources across all regions.", budget: null },
      { name: "VoltSafe EV Shore Power — CSA Certification", type: "certification", status: "active", phase: "Testing", description: "CSA Group certification for EV shore power adapter product line.", budget: 65000 },
    ];

    for (const p of samples) {
      await db.execute(sql`
        INSERT INTO projects (name, type, status, phase, description, owner_user_id, budget, currency, created_at, updated_at)
        VALUES (
          ${p.name}, ${p.type}, ${p.status}, ${p.phase}, ${p.description},
          ${ownerId}, ${p.budget ?? null}, 'CAD', now(), now()
        )
      `);
    }

    // For the certification project, add a basic project_certifications row
    const certResult = await db.execute(sql`SELECT id FROM projects WHERE type = 'certification' LIMIT 1`);
    if (certResult.rows.length > 0) {
      const certProjId = (certResult.rows[0] as any).id;
      await db.execute(sql`
        INSERT INTO project_certifications (project_id, certification_program, product_name, certification_status, overall_risk, launch_blocker)
        VALUES (${certProjId}, '["CSA"]', 'VoltSafe EV Shore Power Adapter', 'In Progress', 'medium', false)
        ON CONFLICT (project_id) DO NOTHING
      `);
    }

    console.log(`[seed] Inserted ${samples.length} sample projects.`);
  } catch (err) {
    console.error("[seed] seedSampleProjects error (non-fatal):", err);
  }
}

export async function migrateChangelogSchema(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS app_changelogs (
        id serial PRIMARY KEY,
        version text NOT NULL UNIQUE,
        title text NOT NULL,
        summary text NOT NULL,
        items jsonb NOT NULL DEFAULT '[]',
        published_at timestamptz NOT NULL DEFAULT now(),
        is_published boolean NOT NULL DEFAULT true
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_changelog_acks (
        user_id integer NOT NULL,
        changelog_id integer NOT NULL REFERENCES app_changelogs(id) ON DELETE CASCADE,
        acked_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, changelog_id)
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_changelog_acks_user ON user_changelog_acks(user_id)`);

    // Seed initial changelog entries — ON CONFLICT DO NOTHING so restarts don't duplicate
    const v11Items = JSON.stringify([
      "Meeting recordings are automatically transcribed and summarised — no more manual note-taking.",
      "Key decisions from each meeting are listed clearly so nothing gets missed.",
      "Action items (with owners and due dates) are pulled out and added to your Tasks automatically.",
      "A ready-to-send follow-up email draft is generated from each meeting.",
      "Marina-specific signals such as permits, compliance notes, dock upgrade timing, and buyer readiness are highlighted automatically."
    ]);
    const v12Items = JSON.stringify([
      "Your task board now only shows tasks that are assigned to you — you will no longer see other people's work.",
      "A new 'Delegated to Others' column on your board shows every task you have assigned to a teammate, so you can see when they complete it.",
      "A new 'Delegated' tab in the Tasks Hub gives you a full list of tasks you have handed off to others.",
      "Assigning tasks to teammates works exactly as before — they see and manage their own tasks normally."
    ]);
    await db.execute(sql.raw(`
      INSERT INTO app_changelogs (version, title, summary, items, published_at)
      VALUES (
        'v1.1',
        'AI Meeting Notes',
        'Your meeting recordings are now automatically turned into structured notes, action items, and follow-up emails — no extra work needed.',
        '${v11Items.replace(/'/g, "''")}',
        '2026-05-01 10:00:00+00'
      )
      ON CONFLICT (version) DO NOTHING
    `));
    await db.execute(sql.raw(`
      INSERT INTO app_changelogs (version, title, summary, items, published_at)
      VALUES (
        'v1.2',
        'Task Privacy & Delegation',
        'Your task board is now private to you. You can also track tasks you assign to teammates so you know when they are done.',
        '${v12Items.replace(/'/g, "''")}',
        '2026-05-01 18:00:00+00'
      )
      ON CONFLICT (version) DO NOTHING
    `));
    console.log("[migration] Changelog schema migration complete.");
  } catch (err) {
    console.error("[migration] Changelog schema migration error (non-fatal):", err);
  }
}

export async function migrateProductEngineSchema(): Promise<void> {
  try {
    // Extend price_lists with region and customer_segment
    await db.execute(sql`ALTER TABLE price_lists ADD COLUMN IF NOT EXISTS region text`);
    await db.execute(sql`ALTER TABLE price_lists ADD COLUMN IF NOT EXISTS customer_segment text`);
    // Allow list_price to be NULL (for custom-pricing products)
    await db.execute(sql`ALTER TABLE price_list_items ALTER COLUMN list_price DROP NOT NULL`);
    // Extend price_list_items with Commercial Engine fields
    await db.execute(sql`ALTER TABLE price_list_items ADD COLUMN IF NOT EXISTS industry_code text NOT NULL DEFAULT 'GEN'`);
    await db.execute(sql`ALTER TABLE price_list_items ADD COLUMN IF NOT EXISTS industry_name text NOT NULL DEFAULT 'General'`);
    await db.execute(sql`ALTER TABLE price_list_items ADD COLUMN IF NOT EXISTS commercial_type text NOT NULL DEFAULT 'hardware'`);
    await db.execute(sql`ALTER TABLE price_list_items ADD COLUMN IF NOT EXISTS product_family text`);
    await db.execute(sql`ALTER TABLE price_list_items ADD COLUMN IF NOT EXISTS power_level text`);
    await db.execute(sql`ALTER TABLE price_list_items ADD COLUMN IF NOT EXISTS pricing_model text NOT NULL DEFAULT 'one_time'`);
    await db.execute(sql`ALTER TABLE price_list_items ADD COLUMN IF NOT EXISTS billing_interval text`);
    await db.execute(sql`ALTER TABLE price_list_items ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true`);
    await db.execute(sql`ALTER TABLE price_list_items ADD COLUMN IF NOT EXISTS is_primary_quote_item boolean NOT NULL DEFAULT false`);
    await db.execute(sql`ALTER TABLE price_list_items ADD COLUMN IF NOT EXISTS item_currency text`);
    await db.execute(sql`ALTER TABLE price_list_items ADD COLUMN IF NOT EXISTS notes_internal text`);
    await db.execute(sql`ALTER TABLE price_list_items ADD COLUMN IF NOT EXISTS quote_description text`);
    await db.execute(sql`ALTER TABLE price_list_items ADD COLUMN IF NOT EXISTS usage_unit text`);
    await db.execute(sql`ALTER TABLE price_list_items ADD COLUMN IF NOT EXISTS royalty_type text`);
    await db.execute(sql`ALTER TABLE price_list_items ADD COLUMN IF NOT EXISTS royalty_rate double precision`);
    await db.execute(sql`ALTER TABLE price_list_items ADD COLUMN IF NOT EXISTS minimum_commitment text`);
    await db.execute(sql`ALTER TABLE price_list_items ADD COLUMN IF NOT EXISTS licensing_terms text`);
    await db.execute(sql`ALTER TABLE price_list_items ADD COLUMN IF NOT EXISTS service_scope text`);

    // Seed default VoltSafe product catalog if not already present (check for items, not just list)
    const existing = await db.execute(sql`SELECT id FROM price_lists WHERE name = 'VoltSafe Product Catalog' LIMIT 1`);
    const catalogId = (existing.rows as any[])[0]?.id ?? null;
    const hasItems = catalogId
      ? Number(((await db.execute(sql`SELECT COUNT(*) as cnt FROM price_list_items WHERE price_list_id = ${catalogId}`)).rows[0] as any)?.cnt ?? 0) >= 8
      : false;
    if (!hasItems) {
      let listId = catalogId;
      if (!listId) {
        const listResult = await db.execute(sql`
          INSERT INTO price_lists (name, currency, description, region, customer_segment)
          VALUES ('VoltSafe Product Catalog', 'CAD', 'Default VoltSafe commercial product catalog — systems, hardware, software, services, and licensing.', 'Global', 'All')
          RETURNING id
        `);
        listId = (listResult.rows as any[])[0].id;
      }

      const products = [
        {
          sku: 'VS-MAR-SYS-30A-SLIP', name: 'VoltSafe Marine | 30A Smart Slip Kit',
          description: 'Complete 30A shore power system per slip, combining prongless connection, real-time monitoring, and automated safety control.',
          quote_description: 'Complete 30A smart shore power solution per slip.',
          category: 'System', industry_code: 'MAR', industry_name: 'Marine',
          commercial_type: 'system', product_family: 'Shore Power', power_level: '30A / 125V',
          unit_type: 'per slip', pricing_model: 'one_time', item_currency: 'CAD', list_price: 1650,
          is_primary_quote_item: true, sort_order: 1,
        },
        {
          sku: 'VS-MAR-HW-30A-CONN', name: 'VoltSafe Marine | 30A Smart Connector',
          description: 'Prongless magnetic connector eliminating arcing, corrosion, and exposed live contacts while enabling authenticated power delivery.',
          quote_description: '30A prongless magnetic shore power connector.',
          category: 'Hardware', industry_code: 'MAR', industry_name: 'Marine',
          commercial_type: 'hardware', product_family: 'Shore Power', power_level: '30A / 125V',
          unit_type: 'per connector', pricing_model: 'one_time', item_currency: 'CAD', list_price: 950,
          is_primary_quote_item: false, sort_order: 2,
        },
        {
          sku: 'VS-MAR-HW-30A-CTRL', name: 'VoltSafe Marine | 30A Smart Control Box',
          description: 'Central control system enabling authenticated, safe shore power delivery with integrated monitoring and remote control.',
          quote_description: 'Smart control system for 30A shore power applications.',
          category: 'Hardware', industry_code: 'MAR', industry_name: 'Marine',
          commercial_type: 'hardware', product_family: 'Shore Power', power_level: '30A / 125V',
          unit_type: 'per unit', pricing_model: 'one_time', item_currency: 'CAD', list_price: 1200,
          is_primary_quote_item: false, sort_order: 3,
        },
        {
          sku: 'VS-MAR-SW-CORE', name: 'VoltSafe Marine | Marina OS',
          description: 'Cloud-based marina management platform for real-time power monitoring, automated billing, remote control, alerts, and energy management.',
          quote_description: 'Marina OS subscription for connected slips.',
          category: 'Software', industry_code: 'MAR', industry_name: 'Marine',
          commercial_type: 'software', product_family: 'Marina OS', power_level: 'CORE',
          unit_type: 'per slip / month', pricing_model: 'recurring', item_currency: 'USD', list_price: 15,
          is_recurring: true, billing_interval: 'monthly', is_primary_quote_item: true, sort_order: 4,
        },
        {
          sku: 'VS-GEN-SRV-ENG-HR', name: 'VoltSafe | Engineering Services',
          description: 'Professional engineering support for product design, integration, technical validation, partner enablement, and deployment planning.',
          quote_description: 'VoltSafe engineering services.',
          category: 'Services', industry_code: 'GEN', industry_name: 'General',
          commercial_type: 'service', product_family: 'Professional Services', power_level: 'ENG',
          unit_type: 'per hour', pricing_model: 'one_time', item_currency: 'CAD', list_price: 200,
          is_primary_quote_item: false, sort_order: 5,
        },
        {
          sku: 'VS-GEN-SRV-INTEG-PROJ', name: 'VoltSafe | Integration Package',
          description: 'Custom integration package for partners or customers requiring engineering, technical, deployment, or system integration support.',
          quote_description: 'Custom VoltSafe integration package.',
          category: 'Services', industry_code: 'GEN', industry_name: 'General',
          commercial_type: 'service', product_family: 'Professional Services', power_level: 'INTEG',
          unit_type: 'per project', pricing_model: 'custom', item_currency: 'CAD', list_price: null,
          is_primary_quote_item: false, sort_order: 6,
        },
        {
          sku: 'VS-GEN-LIC-OEM', name: 'VoltSafe | OEM Licensing Program',
          description: 'Licensing framework for partners building products powered by VoltSafe Technology, including commercial rights, technical enablement, and partner support.',
          quote_description: 'OEM licensing program powered by VoltSafe Technology.',
          category: 'Licensing', industry_code: 'GEN', industry_name: 'General',
          commercial_type: 'licensing', product_family: 'Powered by VoltSafe', power_level: 'OEM',
          unit_type: 'custom', pricing_model: 'custom', item_currency: 'CAD', list_price: null,
          is_primary_quote_item: true, sort_order: 7,
        },
        {
          sku: 'VS-GEN-LIC-ROYALTY', name: 'VoltSafe | Per-Unit Royalty',
          description: 'Per-unit royalty for licensed products powered by VoltSafe Technology.',
          quote_description: 'Per-unit royalty for licensed VoltSafe-enabled products.',
          category: 'Licensing', industry_code: 'GEN', industry_name: 'General',
          commercial_type: 'licensing', product_family: 'Powered by VoltSafe', power_level: 'ROYALTY',
          unit_type: 'per licensed unit', pricing_model: 'usage', item_currency: 'CAD', list_price: 50,
          usage_unit: 'licensed unit', is_primary_quote_item: false, sort_order: 8,
        },
      ];

      for (const p of products) {
        await db.execute(sql.raw(`
          INSERT INTO price_list_items (
            price_list_id, sku, name, description, quote_description, category,
            industry_code, industry_name, commercial_type, product_family, power_level,
            unit_type, pricing_model, billing_interval, item_currency,
            list_price, is_recurring, is_primary_quote_item, is_active,
            usage_unit, sort_order
          ) VALUES (
            ${listId},
            ${p.sku ? `'${p.sku.replace(/'/g, "''")}'` : 'NULL'},
            '${p.name.replace(/'/g, "''")}',
            '${p.description.replace(/'/g, "''")}',
            '${(p.quote_description || '').replace(/'/g, "''")}',
            '${(p.category || '').replace(/'/g, "''")}',
            '${p.industry_code}',
            '${p.industry_name}',
            '${p.commercial_type}',
            ${p.product_family ? `'${p.product_family.replace(/'/g, "''")}'` : 'NULL'},
            ${p.power_level ? `'${p.power_level.replace(/'/g, "''")}'` : 'NULL'},
            '${p.unit_type}',
            '${p.pricing_model}',
            ${(p as any).billing_interval ? `'${(p as any).billing_interval}'` : 'NULL'},
            ${p.item_currency ? `'${p.item_currency}'` : 'NULL'},
            ${p.list_price !== null && p.list_price !== undefined ? p.list_price : 'NULL'},
            ${(p as any).is_recurring ? 'true' : 'false'},
            ${p.is_primary_quote_item ? 'true' : 'false'},
            true,
            ${(p as any).usage_unit ? `'${(p as any).usage_unit}'` : 'NULL'},
            ${p.sort_order}
          )
          ON CONFLICT DO NOTHING
        `));
      }
    }
    console.log("[migration] Product engine schema migration complete.");
  } catch (err) {
    console.error("[migration] Product engine schema migration error (non-fatal):", err);
  }
}

export async function migrateTerritorySchema(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS territories (
        id serial PRIMARY KEY,
        name text NOT NULL,
        code text,
        owner_user_id integer,
        status text NOT NULL DEFAULT 'active',
        notes text,
        color text,
        regions text,
        countries text,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_territories_status ON territories(status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_territories_owner ON territories(owner_user_id)`);
    // Add territory_id to accounts
    await db.execute(sql`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS territory_id integer`);
    // Add territory_id and region to leads
    await db.execute(sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS territory_id integer`);
    await db.execute(sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS region text`);
    console.log("[migration] Territory schema migration complete.");
  } catch (err) {
    console.error("[migration] Territory schema migration error (non-fatal):", err);
  }
}

export async function migratePilotLeadSchema(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_pilot boolean NOT NULL DEFAULT false`);
    await db.execute(sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS pilot_project_id integer`);
    console.log("[migration] Pilot lead schema migration complete.");
  } catch (err) {
    console.error("[migration] Pilot lead schema migration error (non-fatal):", err);
  }
}

export async function migrateCrmExpansionSchema(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS primary_industry text`);
    await db.execute(sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS relationship_type text`);
    await db.execute(sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS conversion_target text`);
    console.log("[migration] CRM expansion schema migration complete.");
  } catch (err) {
    console.error("[migration] CRM expansion schema migration error (non-fatal):", err);
  }
}

export async function migrateTradeshowEventsSchema(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS tradeshow_events (
        id SERIAL PRIMARY KEY,
        show_name TEXT NOT NULL,
        vs_lead_name TEXT,
        vs_attendees TEXT,
        show_dates TEXT,
        start_date TIMESTAMPTZ,
        end_date TIMESTAMPTZ,
        year INTEGER DEFAULT 2026,
        venue TEXT,
        city TEXT,
        address TEXT,
        booked_status TEXT DEFAULT 'pending',
        website TEXT,
        audience TEXT,
        booth_number TEXT,
        booth_size TEXT,
        event_contact TEXT,
        event_email TEXT,
        event_fee TEXT,
        show_supplier TEXT,
        speaking_engagement TEXT,
        awards_submission TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    const { rows } = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM tradeshow_events`);
    const cnt = Number((rows as any[])[0]?.cnt ?? 0);
    if (cnt === 0) {
      type EvRow = { n: string; lead: string|null; att: string|null; dates: string|null; sd: string|null; ed: string|null; yr: number; venue: string|null; city: string|null; addr: string|null; status: string; web: string|null; booth: string|null; bsize: string|null; contact: string|null; email: string|null; fee: string|null; supplier: string|null; speaking: string|null; awards: string|null; notes: string|null };
      const rows2: EvRow[] = [
        { n:"ABYC Standards Week", lead:"Sanad", att:"Sanad", dates:"Jan 11 - 15", sd:"2026-01-11", ed:"2026-01-15", yr:2026, venue:"Francis Marion Hotel", city:"Charleston, SC", addr:null, status:"pending", web:null, booth:null, bsize:null, contact:null, email:null, fee:null, supplier:null, speaking:null, awards:null, notes:null },
        { n:"AMI Conference & Expo 2026", lead:"Trevor", att:"Trevor", dates:"Feb 2 - 4", sd:"2026-02-02", ed:"2026-02-04", yr:2026, venue:"Ocean Center", city:"Daytona Beach, FL", addr:"101 North Atlantic Ave, Daytona Beach FL 32118", status:"booked", web:"https://marinaassociation.org/conferenceandexpo", booth:"222", bsize:"10 x 10", contact:"Ray Clark", email:"rgclark68@gmail.com", fee:null, supplier:"Freeman", speaking:"Panelist", awards:null, notes:"Booth 222 next to Suntech marina (218/220). Free 1/4 page ad in Resource Guide." },
        { n:"PCC Spring Conference", lead:null, att:null, dates:"April 20 - 22", sd:"2026-04-20", ed:"2026-04-22", yr:2026, venue:"Hilton Garden Inn SF/Oakland Bay Bridge", city:"Emeryville, CA", addr:"1800 Powell Street, Emeryville, CA 94608", status:"booked", web:null, booth:null, bsize:null, contact:null, email:null, fee:null, supplier:null, speaking:null, awards:null, notes:null },
        { n:"California Boating Congress", lead:null, att:null, dates:"April 28 - 29", sd:"2026-04-28", ed:"2026-04-29", yr:2026, venue:"The Exchange Hotel by Hilton", city:"Sacramento, CA", addr:"1006 4th St, Sacramento CA 95814", status:"pending", web:"https://marina.swoogo.com/cbc2026", booth:null, bsize:null, contact:null, email:null, fee:null, supplier:null, speaking:null, awards:null, notes:null },
        { n:"Washington Public Ports Association Spring Meeting", lead:null, att:null, dates:"May 19 - 21", sd:"2026-05-19", ed:"2026-05-21", yr:2026, venue:"Skamania Lodge", city:"Stevenson, WA", addr:"1131 SW Skamania Lodge Way", status:"pending", web:"https://www.washingtonports.org/2026-spring-meeting-agenda/", booth:null, bsize:null, contact:null, email:null, fee:null, supplier:null, speaking:null, awards:null, notes:null },
        { n:"NMMA Canada 'Day on the Hill'", lead:null, att:"Trevor", dates:"June 9 - 10", sd:"2026-06-09", ed:"2026-06-10", yr:2026, venue:"Parliament Buildings Ottawa", city:"Ottawa, ON", addr:null, status:"booked", web:null, booth:null, bsize:null, contact:null, email:null, fee:null, supplier:null, speaking:null, awards:null, notes:"NMMA Board attends — Trev attends" },
        { n:"Alaska Association of Harbormasters Annual Conference", lead:null, att:null, dates:"Oct 19 - 23", sd:"2026-10-19", ed:"2026-10-23", yr:2026, venue:"TBD", city:"Valdez, AK", addr:null, status:"pending", web:"https://aahpa.wildapricot.org/", booth:null, bsize:null, contact:null, email:null, fee:null, supplier:null, speaking:null, awards:null, notes:"Referred by Kimmy Kruger of Mantle Industries" },
        { n:"ABCMI Business Opportunities Conference & Trade Show", lead:null, att:null, dates:"Oct 20 - 21", sd:"2026-10-20", ed:"2026-10-21", yr:2026, venue:"Vancouver Convention Centre", city:"Vancouver, BC", addr:"1055 Canada Place, Vancouver BC V6C 0C3", status:"pending", web:"https://www.abcmi.ca/cpages/home", booth:null, bsize:null, contact:null, email:null, fee:null, supplier:null, speaking:null, awards:null, notes:null },
        { n:"Best Defence Conference", lead:null, att:null, dates:"Oct 20 - 21", sd:"2026-10-20", ed:"2026-10-21", yr:2026, venue:"RBC Place London", city:"London, ON", addr:null, status:"tbd", web:"https://bestdefenceconference.com/", booth:null, bsize:null, contact:null, email:null, fee:null, supplier:null, speaking:null, awards:null, notes:"Defence, Aerospace & Advanced Manufacturing audience" },
        { n:"IBEX 2026", lead:null, att:null, dates:"Oct 6 - 8", sd:"2026-10-06", ed:"2026-10-08", yr:2026, venue:"Tampa Convention Center", city:"Tampa, FL", addr:"333 Franklin St, Tampa FL 33602", status:"not_attending", web:"https://www.ibexshow.com", booth:null, bsize:null, contact:null, email:null, fee:null, supplier:null, speaking:null, awards:null, notes:"Did not renew for 2026. Booth released Nov 25/25 by Tina Sanderson. Aim to return 2027 with new product launch." },
        { n:"PCC Fall Conference", lead:null, att:null, dates:"TBD", sd:null, ed:null, yr:2026, venue:"TBD", city:"TBD", addr:null, status:"pending", web:null, booth:null, bsize:null, contact:null, email:null, fee:null, supplier:null, speaking:null, awards:null, notes:"Need to book/pay once announced" },
        { n:"Fort Lauderdale International Boat Show (FLIBS)", lead:null, att:null, dates:"Oct 28 - Nov 1", sd:"2026-10-28", ed:"2026-11-01", yr:2026, venue:"Bahia Mar Yachting Center / Broward County Convention Center", city:"Fort Lauderdale, FL", addr:null, status:"not_attending", web:"https://www.flibs.com/en/home.html", booth:null, bsize:null, contact:"Santiago", email:null, fee:"$4800 USD (48/sq ft)", supplier:null, speaking:null, awards:null, notes:"Consumer focused. Consider attending floor (not exhibiting). Ask Jeffrey Poole." },
        { n:"Foresight 50 Celebration", lead:null, att:null, dates:"TBD", sd:null, ed:null, yr:2026, venue:"TBD", city:"TBD", addr:null, status:"pending", web:null, booth:null, bsize:null, contact:null, email:null, fee:null, supplier:null, speaking:null, awards:null, notes:null },
        { n:"VMCC Greenship 2026", lead:null, att:null, dates:"TBD", sd:null, ed:null, yr:2026, venue:"TBD", city:"TBD", addr:null, status:"pending", web:null, booth:null, bsize:null, contact:null, email:null, fee:null, supplier:null, speaking:null, awards:null, notes:null },
        { n:"Boating BC Annual Conference", lead:null, att:null, dates:"TBD", sd:null, ed:null, yr:2026, venue:"TBD", city:"TBD", addr:null, status:"tbd", web:"https://www.boatingbc.ca/events/2025-boating-bc-conference", booth:null, bsize:null, contact:null, email:null, fee:null, supplier:null, speaking:null, awards:null, notes:"Walk through only" },
        { n:"METSTRADE 2026", lead:null, att:null, dates:"Nov 17 - 19", sd:"2026-11-17", ed:"2026-11-19", yr:2026, venue:"RAI Amsterdam Convention Centre", city:"Amsterdam, NL", addr:"Europaplein 1078 GZ Amsterdam", status:"booked", web:"https://www.metstrade.com/", booth:"01.717", bsize:"9m sq", contact:"Jim Wielgosz", email:"jwielgosz@nmma.org", fee:"4300 Euros", supplier:"RAI", speaking:"Need to find speaking engagement — contact Frederike Volmer / Patty Lawrence", awards:"Find out awards submission info", notes:"Booked by Scott. 9m sq confirmed." },
        { n:"Pacific Marine Expo Seattle 2026", lead:null, att:null, dates:"Nov 19 - 21", sd:"2026-11-19", ed:"2026-11-21", yr:2026, venue:"Lumen Field", city:"Seattle, WA", addr:"800 Occidental Ave S, Seattle WA 98134", status:"not_attending", web:"https://www.pacificmarineexpo.com/", booth:null, bsize:null, contact:null, email:null, fee:null, supplier:null, speaking:null, awards:null, notes:null },
        { n:"TMA BlueTech Innovation Day", lead:null, att:null, dates:"TBD", sd:null, ed:null, yr:2026, venue:"Maritime Museum of San Diego", city:"San Diego, CA", addr:"1492 North Harbor Drive, San Diego CA 92101", status:"tbd", web:"https://www.tmabluetech.org/", booth:null, bsize:null, contact:"Sergey Chekov — TMA BlueTech Deputy Director", email:null, fee:"No cost for participating", supplier:null, speaking:null, awards:null, notes:"Email sent to Zach Birmingham (Port of San Diego). Public Innovation Day — tabletop or on-water demo." },
        { n:"Washington Public Ports Association Winter Meeting", lead:null, att:null, dates:"Dec 9 - 11", sd:"2026-12-09", ed:"2026-12-11", yr:2026, venue:"Hilton Vancouver (WA)", city:"Vancouver, WA", addr:"301 W 6th St, Vancouver WA 98660", status:"tbd", web:"https://www.washingtonports.org/event/2026-annual-meeting/", booth:null, bsize:null, contact:null, email:null, fee:null, supplier:null, speaking:null, awards:null, notes:null },
        { n:"BlueTech Week: Ocean Enterprise Reimagined", lead:null, att:null, dates:"TBD", sd:null, ed:null, yr:2026, venue:"TBD", city:"TBD", addr:null, status:"pending", web:null, booth:null, bsize:null, contact:null, email:null, fee:null, supplier:null, speaking:null, awards:null, notes:"As part of Port of San Diego booth — see SD tab" },
        { n:"BOATS — Boating Ontario Annual Trade Show", lead:null, att:null, dates:"Early Dec", sd:"2026-12-01", ed:"2026-12-04", yr:2026, venue:"Sheraton Fallsview Hotel", city:"Niagara Falls, ON", addr:"5875 Falls Ave, Niagara Falls ON L2G 3K7", status:"pending", web:"https://www.boatingontario.ca/events/boating-ontario-conference-2024", booth:null, bsize:null, contact:null, email:null, fee:null, supplier:null, speaking:null, awards:null, notes:"Need to book/pay fee" },
        { n:"Abu Dhabi International Boat Show", lead:null, att:null, dates:"TBD", sd:null, ed:null, yr:2026, venue:"Marina Hall, ADNEC Centre Abu Dhabi", city:"Abu Dhabi, UAE", addr:null, status:"not_attending", web:"https://www.adibs.ae/", booth:"I-C90", bsize:null, contact:null, email:null, fee:null, supplier:null, speaking:null, awards:null, notes:"Yachting Ventures running Innovation Zone at the show." },
        { n:"The DOCKS Expo", lead:null, att:null, dates:"Dec 1 - 3", sd:"2026-12-01", ed:"2026-12-03", yr:2026, venue:"Music City Center", city:"Nashville, TN", addr:"201 Rep. John Lewis Way South, Nashville TN", status:"booked", web:"https://docksexpo.com/", booth:"333", bsize:"10 x 10", contact:"Susie Jensen", email:"susie@wjinc.net", fee:"$2,500 USD (incl table, chairs)", supplier:"Heritage", speaking:"Trevor is a panelist — electric propulsion and marina operations panel", awards:"Young Leader Awards — https://docksexpo.com/young-leader-award/", notes:"Booth #338 (exhibit) and #223 (listed). Similar to AMICE but smaller." },
        { n:"AMI Conference & Expo 2027", lead:"Trevor", att:"Trevor", dates:"Feb 1 - 3", sd:"2027-02-01", ed:"2027-02-03", yr:2027, venue:"Ocean Center", city:"Daytona Beach, FL", addr:"101 North Atlantic Ave, Daytona Beach FL 32118", status:"pending", web:"https://marinaassociation.org/conferenceandexpo", booth:null, bsize:null, contact:"Ray Clark", email:"rgclark68@gmail.com", fee:"2700 USD (member price)", supplier:"Freeman", speaking:"NA", awards:null, notes:"Early bird renew Feb 15/26 with full payment due June 30 2026." },
      ];
      for (const ev of rows2) {
        await db.execute(sql`
          INSERT INTO tradeshow_events (show_name, vs_lead_name, vs_attendees, show_dates, start_date, end_date, year, venue, city, address, booked_status, website, booth_number, booth_size, event_contact, event_email, event_fee, show_supplier, speaking_engagement, awards_submission, notes)
          VALUES (
            ${ev.n}, ${ev.lead}, ${ev.att}, ${ev.dates},
            ${ev.sd ? new Date(ev.sd) : null},
            ${ev.ed ? new Date(ev.ed) : null},
            ${ev.yr}, ${ev.venue}, ${ev.city}, ${ev.addr}, ${ev.status},
            ${ev.web}, ${ev.booth}, ${ev.bsize}, ${ev.contact}, ${ev.email},
            ${ev.fee}, ${ev.supplier}, ${ev.speaking}, ${ev.awards}, ${ev.notes}
          )
        `);
      }
    }
    console.log("[migration] Tradeshow events schema migration complete.");
  } catch (err) {
    console.error("[migration] Tradeshow events schema migration error (non-fatal):", err);
  }
}

export async function migrateScheduledEmailColumns(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE scheduled_emails ADD COLUMN IF NOT EXISTS user_id integer`);
    await db.execute(sql`ALTER TABLE scheduled_emails ADD COLUMN IF NOT EXISTS sent_message_id text`);
    console.log("[migration] scheduled_emails user_id + sent_message_id columns ready.");
  } catch (err) {
    console.error("[migration] scheduled_emails column migration error (non-fatal):", err);
  }
}

export async function migrateLeadWebsiteColumn(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS website TEXT`);
    console.log("[migration] leads.website column ready.");
  } catch (err) {
    console.error("[migration] leads.website column migration error (non-fatal):", err);
  }
}

export async function migrateSpamTrustedSenders(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS spam_trusted_senders (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        added_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log("[migration] spam_trusted_senders table ready.");
  } catch (err) {
    console.error("[migration] spam_trusted_senders migration error (non-fatal):", err);
  }
}

export async function migrateShorePowerColumn(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS shore_power TEXT DEFAULT 'unknown'`);
    console.log("[migration] shore_power column ready.");
  } catch (err) {
    console.error("[migration] shore_power column migration error (non-fatal):", err);
  }
}

// Adds a dedicated contact_id column to tasks so a linked contact can coexist
// with a linked lead (linked_object_type='lead' + linked_object_id) without
// overwriting each other. Backfills existing rows where linked_object_type='contact'.
export async function migrateTaskContactId(): Promise<void> {
  try {
    // Add column without FK constraint — avoids FK validation issues on existing data
    await db.execute(sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS contact_id INTEGER`);
    // Null out any orphaned contact_id values that don't exist in contacts
    await db.execute(sql`
      UPDATE tasks
      SET contact_id = NULL
      WHERE contact_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM contacts WHERE id = tasks.contact_id)
    `);
    // Backfill: tasks with linked_object_type='contact' → move to contact_id
    const backfilled = await db.execute(sql`
      UPDATE tasks
      SET contact_id = linked_object_id,
          linked_object_type = NULL,
          linked_object_id = NULL
      WHERE linked_object_type = 'contact'
        AND linked_object_id IS NOT NULL
        AND contact_id IS NULL
        AND EXISTS (SELECT 1 FROM contacts WHERE id = tasks.linked_object_id)
    `);
    const count = (backfilled as any).rowCount ?? 0;
    if (count > 0) {
      console.log(`[migration] tasks.contact_id: backfilled ${count} contact-linked task(s).`);
    } else {
      console.log("[migration] tasks.contact_id column ready (no backfill needed).");
    }
  } catch (err) {
    console.error("[migration] migrateTaskContactId error (non-fatal):", err);
  }
}

// Removes any crm_auto_link_rules rows that target internal VoltSafe domains
// (voltsafe.com). These rules were never effective (the engine already filtered
// internal domains from earlyDomains) but their presence in the DB was
// confusing and misleading. The API now also blocks creating new rules for
// internal domains. This migration is idempotent.
export async function migrateCleanInternalAutoLinkRules(): Promise<void> {
  try {
    const deleted = await db.execute(sql`
      DELETE FROM crm_auto_link_rules
      WHERE domain IN ('voltsafe.com')
    `);
    const count = (deleted as any).rowCount ?? 0;
    if (count > 0) {
      console.log(`[migration] Removed ${count} internal-domain auto-link rule(s) (voltsafe.com).`);
    } else {
      console.log("[migration] Internal auto-link rule cleanup: nothing to remove.");
    }
  } catch (err) {
    console.error("[migration] migrateCleanInternalAutoLinkRules error (non-fatal):", err);
  }
}

export async function migrateCrmAiSummarySchema(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS crm_ai_summaries (
        id SERIAL PRIMARY KEY,
        entity_type TEXT NOT NULL CHECK (entity_type IN ('lead','account','contact')),
        entity_id INTEGER NOT NULL,
        summary_json JSONB,
        summary_text TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','generating','success','failed','stale')),
        source_hash TEXT,
        generated_at TIMESTAMPTZ,
        stale_at TIMESTAMPTZ,
        last_attempted_at TIMESTAMPTZ,
        retry_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS crm_ai_summaries_entity_idx
      ON crm_ai_summaries (entity_type, entity_id)
    `);
    console.log("[migration] CRM AI Summary schema migration complete.");
  } catch (err) {
    console.error("[migration] CRM AI Summary schema migration error (non-fatal):", err);
  }
}

export async function migrateEmailSignaturesSchema(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS email_signatures (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        html_content TEXT NOT NULL,
        plain_text_content TEXT,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_email_signatures_user_id ON email_signatures(user_id)
    `);
    console.log("[migration] email_signatures schema ready.");
  } catch (err) {
    console.error("[migration] email_signatures migration error (non-fatal):", err);
  }
}

export async function migrateSignatureCtaAssetColumns(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE email_signatures ADD COLUMN IF NOT EXISTS cta_image_url TEXT`);
    await db.execute(sql`ALTER TABLE email_signatures ADD COLUMN IF NOT EXISTS cta_dest_url TEXT`);
    await db.execute(sql`ALTER TABLE email_signatures ADD COLUMN IF NOT EXISTS cta_alt_text TEXT`);
    await db.execute(sql`ALTER TABLE email_signatures ADD COLUMN IF NOT EXISTS cta_width_px INTEGER`);
    console.log("[migration] signature cta asset columns ready.");
  } catch (err) {
    console.error("[migration] signature cta asset columns error (non-fatal):", err);
  }
}

export async function migrateCtaFileData(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE cta_assets ADD COLUMN IF NOT EXISTS file_data BYTEA`);
    console.log("[migration] cta_assets.file_data column ready.");
    // Fire-and-forget backfill: populate file_data from disk for any existing
    // asset rows that don't have bytes stored yet (idempotent on re-run).
    (async () => {
      try {
        const assetsDir = path.resolve("uploads/cta-assets");
        const rows = (await db.execute(sql`
          SELECT id, filename, mime_type FROM cta_assets
          WHERE file_data IS NULL AND is_archived = FALSE
        `)).rows as any[];
        let count = 0;
        for (const row of rows) {
          const fp = path.join(assetsDir, String(row.filename));
          try {
            if (!fs.existsSync(fp)) continue;
            const buf = fs.readFileSync(fp);
            const hex = buf.toString("hex");
            await db.execute(sql.raw(
              `UPDATE cta_assets SET file_data = decode('${hex}', 'hex') WHERE id = ${Number(row.id)}`
            ));
            count++;
          } catch { /* skip individual asset failures */ }
        }
        if (count > 0) {
          console.log(`[migration] cta_assets.file_data backfilled ${count} asset(s) from disk.`);
        }
      } catch (bfErr) {
        console.warn("[migration] cta_assets.file_data disk backfill non-fatal:", bfErr);
      }
    })();
  } catch (err) {
    console.error("[migration] cta_assets.file_data error (non-fatal):", err);
  }
}

export async function migrateCtaOriginalName(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE cta_assets ADD COLUMN IF NOT EXISTS original_name TEXT`);
    // Back-fill: if original_name is null, copy name into it as a best-effort.
    await db.execute(sql`UPDATE cta_assets SET original_name = name WHERE original_name IS NULL AND name IS NOT NULL`);
    console.log("[migration] cta_assets.original_name column ready.");
  } catch (err) {
    console.error("[migration] cta_assets.original_name error (non-fatal):", err);
  }
}

export async function migrateSignatureCtaSchema(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS email_signature_ctas (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL,
        signature_id    INTEGER REFERENCES email_signatures(id) ON DELETE CASCADE,
        name            TEXT NOT NULL,
        type            TEXT NOT NULL DEFAULT 'image',
        destination_url TEXT NOT NULL,
        image_url       TEXT,
        alt_text        TEXT DEFAULT 'Click to learn more',
        width_px        INTEGER DEFAULT 200,
        tracking_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_email_signature_ctas_user_id ON email_signature_ctas(user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_email_signature_ctas_sig_id ON email_signature_ctas(signature_id)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS signature_cta_clicks (
        id               SERIAL PRIMARY KEY,
        token            TEXT NOT NULL UNIQUE,
        signature_cta_id INTEGER REFERENCES email_signature_ctas(id) ON DELETE SET NULL,
        signature_id     INTEGER,
        sent_by_user_id  INTEGER NOT NULL,
        recipient_email  TEXT NOT NULL,
        gmail_message_id TEXT,
        cta_name         TEXT,
        destination_url  TEXT NOT NULL,
        contact_id       INTEGER,
        account_id       INTEGER,
        click_count      INTEGER NOT NULL DEFAULT 0,
        last_clicked_at  TIMESTAMPTZ,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_sig_cta_clicks_token  ON signature_cta_clicks(token)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_sig_cta_clicks_sender ON signature_cta_clicks(sent_by_user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_sig_cta_clicks_cta_id ON signature_cta_clicks(signature_cta_id)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS signature_cta_click_events (
        id           SERIAL PRIMARY KEY,
        token        TEXT NOT NULL,
        ip_hash      TEXT,
        user_agent   TEXT,
        is_bot       BOOLEAN NOT NULL DEFAULT FALSE,
        is_duplicate BOOLEAN NOT NULL DEFAULT FALSE,
        occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_sig_cta_click_events_token ON signature_cta_click_events(token)`);
    console.log("[migration] signature_cta schema ready.");
  } catch (err) {
    console.error("[migration] signature_cta migration error (non-fatal):", err);
  }
}

export async function migrateEmailRecipientsSchema(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS email_recipients (
        id               SERIAL PRIMARY KEY,
        gmail_message_id TEXT NOT NULL,
        gmail_thread_id  TEXT,
        recipient_email  TEXT NOT NULL,
        recipient_name   TEXT,
        recipient_type   TEXT NOT NULL DEFAULT 'to',
        is_primary       BOOLEAN NOT NULL DEFAULT FALSE,
        is_internal      BOOLEAN NOT NULL DEFAULT FALSE,
        tracking_token   TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_email_recipients_message ON email_recipients(gmail_message_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_email_recipients_thread  ON email_recipients(gmail_thread_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_email_recipients_token   ON email_recipients(tracking_token)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_email_recipients_unique ON email_recipients(gmail_message_id, recipient_email)`);
    console.log("[migration] email_recipients schema ready.");
  } catch (err) {
    console.error("[migration] email_recipients migration error (non-fatal):", err);
  }
}

export async function migrateInternalEngagementSchema(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE email_engagement_events ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT FALSE`);
    await db.execute(sql`ALTER TABLE email_engagement_events ADD COLUMN IF NOT EXISTS internal_reason TEXT`);
    await db.execute(sql`ALTER TABLE email_tracking_pixels ADD COLUMN IF NOT EXISTS recipient_type TEXT DEFAULT 'to'`);
    await db.execute(sql`ALTER TABLE email_tracking_pixels ADD COLUMN IF NOT EXISTS engagement_score INTEGER DEFAULT 0`);
    await db.execute(sql`ALTER TABLE email_tracking_pixels ADD COLUMN IF NOT EXISTS signal_level TEXT DEFAULT 'none'`);
    await db.execute(sql`ALTER TABLE email_tracking_pixels ADD COLUMN IF NOT EXISTS is_hot BOOLEAN NOT NULL DEFAULT FALSE`);
    await db.execute(sql`ALTER TABLE email_tracking_pixels ADD COLUMN IF NOT EXISTS last_scored_at TIMESTAMPTZ`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_eee_is_internal ON email_engagement_events(is_internal) WHERE is_internal = TRUE`);
    console.log("[migration] internal engagement schema ready.");
  } catch (err) {
    console.error("[migration] internal engagement migration error (non-fatal):", err);
  }
}

/**
 * Startup guard: ensure derived email label columns are populated.
 *
 * Migration 0016 adds the columns (DDL) via Drizzle schema diff on publish, but
 * the DML backfill (UPDATE … SET is_inbox = …) is not part of the schema diff and
 * therefore never runs in production automatically. This guard runs on every startup
 * and fills any rows that still have NULL derived columns using the canonical formula
 * from inbox-policy.ts. It is idempotent — already-filled rows are not touched.
 *
 * WHY THIS IS A STARTUP MIGRATION NOT A SCRIPT:
 *   Serving the inbox with is_inbox = NULL rows silently hides all historical mail.
 *   The guard ensures the invariant is satisfied before routes are registered.
 */
export async function migrateDerivedLabelColumns(): Promise<void> {
  try {
    // 1. Ensure the columns exist (idempotent DDL — safe if already present).
    await db.execute(sql`
      ALTER TABLE email_messages
        ADD COLUMN IF NOT EXISTS is_inbox       boolean,
        ADD COLUMN IF NOT EXISTS is_unread      boolean,
        ADD COLUMN IF NOT EXISTS is_starred     boolean,
        ADD COLUMN IF NOT EXISTS is_spam        boolean,
        ADD COLUMN IF NOT EXISTS is_trash       boolean,
        ADD COLUMN IF NOT EXISTS is_draft       boolean,
        ADD COLUMN IF NOT EXISTS is_sent        boolean,
        ADD COLUMN IF NOT EXISTS smart_category text
    `);

    // 2. Check how many rows still need filling.
    const countR = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM email_messages
      WHERE is_inbox IS NULL OR is_unread IS NULL OR smart_category IS NULL
    `);
    const nullCount = Number((countR as any).rows?.[0]?.n ?? 0);

    if (nullCount === 0) {
      console.log("[migration] derived label columns: all rows populated — no backfill needed.");
      return;
    }

    console.warn(
      `[migration] derived label columns: ${nullCount} row(s) with NULL derived fields detected — running backfill now. Mail routes will be ready after this completes.`
    );

    // 3. Backfill in batches of 2 000 rows using the canonical formula.
    //    Cursor-based so it is safe to interrupt and re-run.
    const BATCH = 2_000;
    let totalUpdated = 0;
    let cursorId = 0;
    let batchNum = 0;

    while (true) {
      const r = await db.execute(sql`
        WITH batch AS (
          SELECT id FROM email_messages
          WHERE (is_inbox IS NULL OR is_unread IS NULL OR smart_category IS NULL)
            AND id > ${cursorId}
          ORDER BY id
          LIMIT ${BATCH}
        )
        UPDATE email_messages SET
          is_unread      = (label_ids LIKE '%"UNREAD"%'),
          is_starred     = (label_ids LIKE '%"STARRED"%'),
          is_spam        = (label_ids LIKE '%"SPAM"%'),
          is_trash       = (label_ids LIKE '%"TRASH"%'),
          is_draft       = (label_ids LIKE '%"DRAFT"%'),
          is_sent        = (label_ids LIKE '%"SENT"%'),
          is_inbox       = (
            (   label_ids LIKE '%"INBOX"%'
             OR label_ids ILIKE '%CATEGORY_PERSONAL%'
             OR label_ids ILIKE '%CATEGORY_UPDATES%'
             OR label_ids ILIKE '%CATEGORY_PROMOTIONS%'
             OR label_ids ILIKE '%CATEGORY_SOCIAL%'
             OR label_ids ILIKE '%CATEGORY_FORUMS%')
            AND label_ids NOT LIKE '%"SPAM"%'
            AND label_ids NOT LIKE '%"TRASH"%'
            AND label_ids NOT LIKE '%"DRAFT"%'
          ),
          smart_category = CASE
            WHEN label_ids ILIKE '%CATEGORY_UPDATES%'    THEN 'updates'
            WHEN label_ids ILIKE '%CATEGORY_PROMOTIONS%' THEN 'promotions'
            WHEN label_ids ILIKE '%CATEGORY_SOCIAL%'     THEN 'social'
            WHEN label_ids ILIKE '%CATEGORY_FORUMS%'     THEN 'forums'
            ELSE 'people'
          END
        FROM batch
        WHERE email_messages.id = batch.id
        RETURNING email_messages.id
      `);

      const rows = (r as any).rows as Array<{ id: number }>;
      if (rows.length === 0) break;

      totalUpdated += rows.length;
      cursorId = Math.max(...rows.map((rr: { id: number }) => rr.id));
      batchNum++;
      console.log(`[migration] derived label columns: batch ${batchNum} — updated ${rows.length} rows (total ${totalUpdated})`);
    }

    // 4. Final verification.
    const afterR = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM email_messages
      WHERE is_inbox IS NULL OR is_unread IS NULL OR smart_category IS NULL
    `);
    const remaining = Number((afterR as any).rows?.[0]?.n ?? 0);

    if (remaining === 0) {
      console.log(`[migration] derived label columns: backfill complete — ${totalUpdated} row(s) updated, 0 NULLs remaining.`);
    } else {
      console.error(`[migration] derived label columns: backfill finished but ${remaining} row(s) still have NULLs — will retry on next startup.`);
    }

    // 5. Ensure partial indexes exist (idempotent).
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_email_is_inbox
        ON email_messages (source_account_id, sent_at DESC)
        WHERE is_inbox = true
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_email_is_inbox_unread
        ON email_messages (source_account_id, sent_at DESC)
        WHERE is_inbox = true AND is_unread = true
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_email_smart_category
        ON email_messages (smart_category, source_account_id, sent_at DESC)
        WHERE is_inbox = true
    `);
  } catch (err) {
    console.error("[migration] derived label columns error (non-fatal):", err);
  }
}

// Creates the blocked_senders table for exact-email sender blocks.
// Separate from email_filters (which stores domain-level blocks).
// Exact-email blocks are the primary "Block sender" action — they block
// a specific address without affecting other users of the same domain
// (which is important for large consumer domains like gmail.com).
export async function migrateBlockedSenders(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS blocked_senders (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        added_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log("[migration] blocked_senders table ready.");
  } catch (err) {
    console.error("[migration] migrateBlockedSenders error (non-fatal):", err);
  }
}

export async function migrateCampaignTrackingTables(): Promise<void> {
  try {
    // campaign_recipients — one row per (campaign × contact/email) delivery.
    // Required by account-heat-score.ts dimension 2 (campaign engagement).
    // Uses typed Drizzle queries so column renames in shared/schema.ts produce
    // compile errors, not silent wrong numbers.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS campaign_recipients (
        id                SERIAL PRIMARY KEY,
        campaign_draft_id INTEGER NOT NULL REFERENCES campaign_drafts(id) ON DELETE CASCADE,
        contact_id        INTEGER,
        account_id        INTEGER,
        email             TEXT NOT NULL,
        status            TEXT NOT NULL DEFAULT 'pending',
        sent_at           TIMESTAMP,
        created_at        TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_campaign_recipients_account_id
        ON campaign_recipients(account_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign_draft_id
        ON campaign_recipients(campaign_draft_id)
    `);

    // campaign_events — one row per engagement event (open / click / reply…).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS campaign_events (
        id                SERIAL PRIMARY KEY,
        campaign_draft_id INTEGER NOT NULL REFERENCES campaign_drafts(id) ON DELETE CASCADE,
        recipient_id      INTEGER NOT NULL REFERENCES campaign_recipients(id) ON DELETE CASCADE,
        contact_id        INTEGER,
        account_id        INTEGER,
        event_type        TEXT NOT NULL,
        url               TEXT,
        ip_hash           TEXT,
        is_bot            BOOLEAN NOT NULL DEFAULT FALSE,
        occurred_at       TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at        TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_campaign_events_recipient_id
        ON campaign_events(recipient_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_campaign_events_account_id
        ON campaign_events(account_id)
    `);

    console.log("[migration] campaign_recipients + campaign_events tables ready.");
  } catch (err) {
    console.error("[migration] migrateCampaignTrackingTables error (non-fatal):", err);
  }
}
