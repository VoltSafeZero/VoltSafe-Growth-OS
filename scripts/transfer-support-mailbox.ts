import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Aborting.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });

  try {
    const before = await pool.query(
      `SELECT id, email_address, user_id, auth_status, updated_at
         FROM email_accounts
        WHERE id = 4 AND email_address = 'support@voltsafe.com'`
    );
    if (before.rowCount === 0) {
      console.error("No matching row (id=4, email_address='support@voltsafe.com'). Aborting — nothing to update.");
      process.exit(2);
    }
    console.log("BEFORE:", before.rows[0]);

    const wattson = await pool.query(
      `SELECT id, name, email FROM users WHERE id = 7`
    );
    if (wattson.rowCount === 0) {
      console.error("Target owner user_id=7 (Wattson) does not exist. Aborting.");
      process.exit(3);
    }
    console.log("TARGET OWNER:", wattson.rows[0]);

    const result = await pool.query(
      `UPDATE email_accounts
          SET user_id = 7,
              updated_at = NOW()
        WHERE id = 4
          AND email_address = 'support@voltsafe.com'
      RETURNING id, email_address, user_id, is_shared, auth_status, updated_at`
    );

    console.log(`Rows affected: ${result.rowCount}`);
    console.log("AFTER:", result.rows[0]);
  } catch (err) {
    console.error("UPDATE failed:", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
