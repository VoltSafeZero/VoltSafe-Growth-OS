import { db } from "./db";
import { sql } from "drizzle-orm";
import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";

export async function seedProductionData(): Promise<void> {
  try {
    const result = await db.execute(sql`SELECT COUNT(*) as cnt FROM leads`);
    const count = Number((result.rows[0] as any).cnt);
    if (count > 0) {
      console.log(`Database already has ${count} leads — skipping seed.`);
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

    console.log("Database is empty — seeding with data...");

    try {
      execSync(
        `pg_restore --no-owner --no-privileges --data-only --disable-triggers -d "${dbUrl}" "${dumpFile}"`,
        { stdio: "pipe", timeout: 120000 }
      );
      console.log("Seed complete via pg_restore.");
    } catch (restoreErr: any) {
      const stderr = restoreErr.stderr?.toString() || "";
      if (stderr.includes("errors ignored")) {
        console.log("Seed complete with some warnings (duplicate keys ignored).");
      } else {
        console.error("pg_restore stderr:", stderr.substring(0, 500));
      }
    }

    const afterCount = await db.execute(sql`SELECT COUNT(*) as cnt FROM leads`);
    console.log(`Seed verification: ${(afterCount.rows[0] as any).cnt} leads in database.`);
  } catch (err) {
    console.error("Error during seed:", err);
  }
}
