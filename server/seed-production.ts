import { db } from "./db";
import { sql } from "drizzle-orm";
import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";

const EXPECTED_LEAD_COUNT = 10871;

export async function seedProductionData(): Promise<void> {
  try {
    const result = await db.execute(sql`SELECT COUNT(*) as cnt FROM leads`);
    const count = Number((result.rows[0] as any).cnt);

    if (count >= EXPECTED_LEAD_COUNT) {
      console.log(`Database has ${count} leads — seed not needed.`);
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
}
