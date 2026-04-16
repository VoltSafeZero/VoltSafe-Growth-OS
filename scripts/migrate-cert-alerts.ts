import { pool } from "../server/db";

async function main() {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE project_certifications 
      ADD COLUMN IF NOT EXISTS tracker_alert_state TEXT
    `);
    const { rows } = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name='project_certifications' AND column_name = 'tracker_alert_state'
    `);
    if (rows.length > 0) {
      console.log("OK – tracker_alert_state column present");
    } else {
      console.error("ERROR – column not found after migration");
      process.exit(1);
    }
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(e => { console.error(e.message); process.exit(1); });
