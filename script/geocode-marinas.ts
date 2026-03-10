import pg from "pg";
const { Pool } = pg;

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const RATE_LIMIT_MS = 1050;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function geocodeAddress(query: string): Promise<{ lat: number; lng: number } | null> {
  const url = `${NOMINATIM_URL}?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=ca`;
  const res = await fetch(url, {
    headers: { "User-Agent": "VoltSafeCortex/1.0 (batch-geocode)" },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Array<{ lat: string; lon: string }>;
  if (!data.length) return null;
  const lat = parseFloat(data[0].lat);
  const lng = parseFloat(data[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

async function main() {
  const batchSize = parseInt(process.argv[2] || "90", 10);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const { rows } = await pool.query(`
    SELECT id, name, street_address, city, state
    FROM marinas
    WHERE (latitude IS NULL OR longitude IS NULL)
      AND (city IS NOT NULL OR street_address IS NOT NULL)
    ORDER BY id
    LIMIT $1
  `, [batchSize]);

  console.log(`Found ${rows.length} marinas to geocode`);

  let success = 0;
  let failed = 0;
  const failedIds: number[] = [];

  for (let i = 0; i < rows.length; i++) {
    const marina = rows[i];
    const isRegionalDistrict = marina.city?.startsWith("Regional District");

    try {
      let result: { lat: number; lng: number } | null = null;

      if (marina.street_address && !isRegionalDistrict) {
        result = await geocodeAddress(
          [marina.street_address, marina.city, marina.state, "Canada"].filter(Boolean).join(", ")
        );
      }

      if (!result) {
        await sleep(RATE_LIMIT_MS);
        if (isRegionalDistrict) {
          result = await geocodeAddress(`${marina.name}, ${marina.state}, Canada`);
        } else {
          result = await geocodeAddress(
            [marina.name, marina.city, marina.state, "Canada"].filter(Boolean).join(", ")
          );
        }
      }

      if (!result && !isRegionalDistrict && marina.city) {
        await sleep(RATE_LIMIT_MS);
        result = await geocodeAddress([marina.city, marina.state, "Canada"].filter(Boolean).join(", "));
      }

      if (result) {
        await pool.query(
          "UPDATE marinas SET latitude = $1, longitude = $2 WHERE id = $3",
          [result.lat, result.lng, marina.id]
        );
        success++;
      } else {
        failed++;
        failedIds.push(marina.id);
      }
    } catch (err) {
      failed++;
      failedIds.push(marina.id);
    }

    if ((i + 1) % 25 === 0 || i === rows.length - 1) {
      console.log(`Progress: ${i + 1}/${rows.length} | OK: ${success} | Failed: ${failed}`);
    }

    await sleep(RATE_LIMIT_MS);
  }

  const { rows: remaining } = await pool.query(`
    SELECT COUNT(*) as c FROM marinas 
    WHERE (latitude IS NULL OR longitude IS NULL)
      AND (city IS NOT NULL OR street_address IS NOT NULL)
  `);

  console.log(`\nDone! Success: ${success}, Failed: ${failed}, Remaining: ${remaining[0].c}`);
  if (failedIds.length > 0) {
    console.log(`Failed marina IDs: ${failedIds.join(", ")}`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
