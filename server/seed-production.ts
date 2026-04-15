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
