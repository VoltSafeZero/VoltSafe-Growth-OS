import { pool } from "../server/db";

async function main() {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE project_certifications 
      ADD COLUMN IF NOT EXISTS tracker_sheet_url TEXT,
      ADD COLUMN IF NOT EXISTS tracker_sheet_config TEXT,
      ADD COLUMN IF NOT EXISTS tracker_sheet_last_synced TIMESTAMP
    `);
    const { rows } = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name='project_certifications' AND column_name LIKE 'tracker%'
    `);
    console.log('OK – tracker columns:', rows.map((r: any) => r.column_name).join(', '));
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(e => { console.error(e.message); process.exit(1); });
