import { db } from "./db";
import { sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

export async function seedProductionData(): Promise<void> {
  try {
    const result = await db.execute(sql`SELECT COUNT(*) as cnt FROM leads`);
    const count = Number((result.rows[0] as any).cnt);
    if (count > 0) {
      console.log(`Production database already has ${count} leads — skipping seed.`);
      return;
    }

    const seedFile = path.join(process.cwd(), "server", "seed-data.sql");
    if (!fs.existsSync(seedFile)) {
      console.log("No seed-data.sql file found — skipping production seed.");
      return;
    }

    console.log("Production database is empty — seeding with development data...");
    const sqlContent = fs.readFileSync(seedFile, "utf-8");
    const statements = sqlContent
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith("--"));

    let inserted = 0;
    let errors = 0;

    for (const stmt of statements) {
      try {
        await db.execute(sql.raw(stmt));
        inserted++;
      } catch (err: any) {
        if (err.message?.includes("duplicate key") || err.message?.includes("already exists")) {
          continue;
        }
        errors++;
        if (errors <= 5) {
          console.error(`Seed error: ${err.message?.substring(0, 120)}`);
        }
      }
    }

    console.log(`Production seed complete: ${inserted} statements executed, ${errors} errors.`);
  } catch (err) {
    console.error("Error during production seed:", err);
  }
}
