import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const result = await db.execute(sql`
    UPDATE email_messages
    SET label_ids = (
      SELECT COALESCE(jsonb_agg(lbl), '[]'::jsonb)
      FROM jsonb_array_elements_text(label_ids::jsonb) AS lbl
      WHERE lbl != 'UNREAD'
    )
    WHERE sent_at < '2026-05-01'
      AND label_ids::text ILIKE '%UNREAD%'
  `);
  console.log(`Stripped UNREAD from ${result.rowCount} local emails before 2026-05-01`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
