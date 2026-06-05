/**
 * Diagnostic: dump signature HTML, image URLs, and href URLs.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const rows = (await db.execute(sql.raw(
    "SELECT id, name, user_id, html_body FROM email_signatures ORDER BY user_id, id LIMIT 10"
  ))).rows as any[];

  for (const r of rows) {
    console.log(`\n=== SIG #${r.id} user=${r.user_id} "${r.name}" ===`);
    const html: string = r.html_body || "";
    console.log("Length:", html.length);

    const imgs = [...html.matchAll(/src="([^"]+)"/g)].map(m => m[1]);
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);

    console.log("IMG srcs:", imgs);
    console.log("HREFs:", hrefs.slice(0, 5));

    const hasRelative = imgs.some(u => !u.startsWith("http") && !u.startsWith("data:"));
    const hasLocalhost = imgs.some(u => u.includes("localhost") || u.includes("127.0.0.1"));
    const hasOldReplit = imgs.some(u => u.includes("replit") && !u.includes(".app"));
    const hasScript = html.toLowerCase().includes("<script");
    const hasDataUri = imgs.some(u => u.startsWith("data:"));

    console.log("Relative img?", hasRelative);
    console.log("Localhost img?", hasLocalhost);
    console.log("Old Replit img?", hasOldReplit);
    console.log("data: URI?", hasDataUri);
    console.log("<script> present?", hasScript);
    console.log("Has <!--vs-sig:", html.includes("<!--vs-sig"));

    // Show first 800 chars
    console.log("\nHTML preview:", html.slice(0, 800));
  }

  // Also check CTAs
  console.log("\n=== EMAIL_SIGNATURE_CTAS ===");
  const ctas = (await db.execute(sql.raw(
    "SELECT id, user_id, name, type, image_url, destination_url FROM email_signature_ctas LIMIT 10"
  ))).rows as any[];
  for (const c of ctas) {
    console.log(`CTA #${c.id}: user=${c.user_id} type=${c.type} img=${c.image_url} dest=${c.destination_url}`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
