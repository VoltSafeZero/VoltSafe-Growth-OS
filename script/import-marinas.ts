import ExcelJS from "exceljs";
import pg from "pg";

const { Pool } = pg;

async function importMarinas() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const existing = await pool.query("SELECT count(*) FROM marinas");
  if (parseInt(existing.rows[0].count) > 0) {
    console.log(`Marinas table already has ${existing.rows[0].count} rows, skipping import.`);
    await pool.end();
    return;
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile("attached_assets/MARINA_LIST_Full_USA_2024_1771878269076.xlsx");
  const ws = wb.worksheets[0];
  const rows: any[][] = [];
  ws.eachRow((row) => {
    rows.push((row.values as any[]).slice(1));
  });

  const headers = rows[0];
  const dataRows = rows.slice(1).filter((r) => r[0]);

  console.log(`Importing ${dataRows.length} marinas...`);

  const BATCH_SIZE = 200;
  let imported = 0;

  for (let i = 0; i < dataRows.length; i += BATCH_SIZE) {
    const batch = dataRows.slice(i, i + BATCH_SIZE);

    const values: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    for (const row of batch) {
      const name = String(row[0] || "").trim();
      const state = String(row[1] || "").trim();
      const city = String(row[2] || "").trim();
      const slips = row[3] ? String(row[3]).trim() : null;
      const segment = row[4] ? String(row[4]).trim() : null;
      const lat = row[6] != null ? parseFloat(row[6]) : null;
      const lng = row[7] != null ? parseFloat(row[7]) : null;
      const phone = row[8] ? String(row[8]).trim() : null;
      const street = row[9] ? String(row[9]).trim() : null;
      const zip = row[10] ? String(row[10]).trim() : null;

      if (!name || !state || !city) continue;

      values.push(
        `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8}, $${paramIdx + 9})`
      );
      params.push(name, state, city, slips, segment, isNaN(lat!) ? null : lat, isNaN(lng!) ? null : lng, phone, street, zip);
      paramIdx += 10;
    }

    if (values.length > 0) {
      await pool.query(
        `INSERT INTO marinas (name, state, city, slips, segment, latitude, longitude, phone, street_address, zip_code) VALUES ${values.join(", ")}`,
        params
      );
      imported += values.length;
      console.log(`  Imported ${imported} / ${dataRows.length}`);
    }
  }

  console.log(`Done! Imported ${imported} marinas.`);
  await pool.end();
}

importMarinas().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
