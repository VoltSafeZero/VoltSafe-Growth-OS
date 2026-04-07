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

    // Set correct roles for known users (idempotent — only sets if still default 'sales')
    await db.execute(sql`UPDATE users SET global_role = 'master_admin', status = 'active' WHERE email = 'trevor@voltsafe.com' AND global_role != 'master_admin'`);
    await db.execute(sql`UPDATE users SET global_role = 'admin', status = 'active' WHERE email = 'terri@voltsafe.com' AND global_role = 'sales'`);
    await db.execute(sql`UPDATE users SET status = 'active' WHERE status = ''`);

    console.log("[migration] User schema migration complete.");
  } catch (err) {
    console.error("[migration] User schema migration error (non-fatal):", err);
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
