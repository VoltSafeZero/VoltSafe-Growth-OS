/**
 * audit-production-signatures.ts
 *
 * Connects to the production database (PROD_DATABASE_URL) and inspects all
 * email_signatures + signature_cta_items records for content that would cause
 * the production proxy to reject a send with 403.
 *
 * Usage:
 *   PROD_DATABASE_URL=postgresql://... npx tsx scripts/audit-production-signatures.ts
 *   PROD_DATABASE_URL=postgresql://... npx tsx scripts/audit-production-signatures.ts --user=trevor@voltsafe.com
 *   PROD_DATABASE_URL=postgresql://... npx tsx scripts/audit-production-signatures.ts --fix-preview
 *
 * Flags:
 *   --user=EMAIL    Only audit signatures for this email address.
 *   --fix-preview   Write a sanitized preview of each unsafe signature to /tmp/sig-preview-<id>.html
 *
 * IMPORTANT: Does NOT log email body content or credentials.
 */

import postgres from "postgres";
import { sanitizeSignatureHtml, auditSignatureHtml } from "../server/services/signature-html-sanitizer";
import fs from "fs";
import path from "path";

const DB_URL = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("ERROR: PROD_DATABASE_URL or DATABASE_URL env var is required.");
  process.exit(1);
}

const FILTER_USER  = process.argv.find((a) => a.startsWith("--user="))?.split("=")[1] ?? null;
const FIX_PREVIEW  = process.argv.includes("--fix-preview");
const BASE_URL     = process.env.APP_BASE_URL || "https://voltsafe.app";

async function main() {
  console.log(`\n=== VoltSafe Signature Audit ===`);
  console.log(`Database: ${DB_URL!.replace(/:[^:@]+@/, ":***@")}`);
  console.log(`Filter user: ${FILTER_USER ?? "(all)"}`);
  console.log(`Preview mode: ${FIX_PREVIEW}\n`);

  const sql = postgres(DB_URL!, { max: 1, idle_timeout: 10, connect_timeout: 10 });

  try {
    // ── Fetch signatures ──────────────────────────────────────────────────────
    const userFilter = FILTER_USER
      ? sql` AND u.email = ${FILTER_USER}`
      : sql``;

    const sigs = await sql<{
      id: number; name: string; user_email: string; is_default: boolean;
      html_length: number; html_content: string;
    }[]>`
      SELECT s.id, s.name, u.email AS user_email, s.is_default,
             LENGTH(s.html_content) AS html_length,
             s.html_content
      FROM   email_signatures s
      JOIN   users u ON u.id = s.user_id
      WHERE  1=1 ${userFilter}
      ORDER  BY u.email, s.id
    `;

    if (!sigs.length) {
      console.log("No signatures found.");
      await sql.end();
      return;
    }

    // ── Fetch CTA items for each signature ───────────────────────────────────
    const sigIds = sigs.map((s) => s.id);
    const ctas = await sql<{
      signature_id: number; id: number; name: string; type: string;
      image_url: string | null; destination_url: string;
    }[]>`
      SELECT id, signature_id, name, type, image_url, destination_url
      FROM   signature_cta_items
      WHERE  signature_id = ANY(${sql.array(sigIds)}::int[])
    `;
    const ctasBySig = new Map<number, typeof ctas>();
    for (const c of ctas) {
      if (!ctasBySig.has(c.signature_id)) ctasBySig.set(c.signature_id, []);
      ctasBySig.get(c.signature_id)!.push(c);
    }

    // ── Audit each signature ─────────────────────────────────────────────────
    let totalIssues = 0;
    for (const sig of sigs) {
      const audit = auditSignatureHtml(sig.html_content);
      const sigCtas = ctasBySig.get(sig.id) ?? [];

      // CTA-level checks
      const ctaIssues: string[] = [];
      for (const cta of sigCtas) {
        if (cta.image_url) {
          if (/^(data:|blob:|file:|cid:)/i.test(cta.image_url))
            ctaIssues.push(`CTA "${cta.name}" (id=${cta.id}): unsafe image_url scheme`);
          else if (/localhost|127\.0\.0\.1/.test(cta.image_url))
            ctaIssues.push(`CTA "${cta.name}" (id=${cta.id}): localhost image_url`);
          else if (/(?:^|\/)api\//i.test(cta.image_url))
            ctaIssues.push(`CTA "${cta.name}" (id=${cta.id}): /api/ image_url`);
          else if (/\.(replit\.dev|repl\.co|repl\.it)$/.test((() => { try { return new URL(cta.image_url!).hostname; } catch { return ""; } })()))
            ctaIssues.push(`CTA "${cta.name}" (id=${cta.id}): old Replit host image_url → ${cta.image_url}`);
        }
      }

      const allIssues = [...audit.issues, ...ctaIssues];
      totalIssues += allIssues.length;

      console.log(`─────────────────────────────────────────────────`);
      console.log(`Sig #${sig.id}  user=${sig.user_email}  name="${sig.name}"`);
      console.log(`  default=${sig.is_default}  html_length=${sig.html_length} bytes`);
      console.log(`  img srcs (${audit.imgSrcs.length}):${audit.imgSrcs.length ? "" : " (none)"}`);
      for (const src of audit.imgSrcs) {
        const prefix = src.startsWith("data:") ? src.slice(0, 40) + "..." : src.slice(0, 120);
        console.log(`    • ${prefix}`);
      }
      console.log(`  hrefs (${audit.hrefs.length}): ${audit.hrefs.slice(0, 3).map((h) => h.slice(0, 60)).join(" | ") || "(none)"}`);
      if (allIssues.length) {
        console.log(`  ⚠  ISSUES (${allIssues.length}):`);
        for (const iss of allIssues) console.log(`    ✗ ${iss}`);
      } else {
        console.log(`  ✓  No issues found`);
      }

      // Recommended actions
      if (audit.hasDataUri) {
        console.log(`  → RECOMMENDED: Replace data-URI logo with an absolute HTTPS URL served`);
        console.log(`    from a public route (e.g. https://voltsafe.app/assets/cta/<uuid>.png).`);
        console.log(`    Data URIs in signatures commonly exceed proxy body size limits → 403.`);
      }
      if (audit.hasOldReplitHost) {
        console.log(`  → RECOMMENDED: Update old Replit host URLs to https://voltsafe.app/assets/cta/<file>.`);
      }
      if (audit.hasApiRoute) {
        console.log(`  → RECOMMENDED: Replace /api/ image src with a public /assets/cta/ path.`);
      }
      if (audit.hasLocalhost) {
        console.log(`  → RECOMMENDED: Remove localhost image src (will never work in email clients).`);
      }
      if (ctaIssues.length) {
        console.log(`  → RECOMMENDED: Update CTA image_url values in signature_cta_items table.`);
      }

      // Write sanitized preview if requested
      if (FIX_PREVIEW && allIssues.length > 0) {
        const sanitized = sanitizeSignatureHtml(sig.html_content, BASE_URL);
        const previewPath = path.join("/tmp", `sig-preview-${sig.id}.html`);
        fs.writeFileSync(previewPath, `<!doctype html><html><body>${sanitized}</body></html>`);
        console.log(`  → Sanitized preview written to ${previewPath}`);
      }

      console.log(`  CTA items: ${sigCtas.length}`);
      for (const c of sigCtas) {
        console.log(`    CTA id=${c.id} name="${c.name}" type=${c.type} dest=${c.destination_url.slice(0, 60)}`);
        if (c.image_url) console.log(`         image_url=${c.image_url.slice(0, 80)}`);
      }
    }

    console.log(`\n=== Summary ===`);
    console.log(`Signatures audited: ${sigs.length}`);
    console.log(`Total issues:       ${totalIssues}`);
    if (totalIssues === 0) {
      console.log("✓ All signatures look safe for sending.");
    } else {
      console.log("✗ Issues found — signature sanitizer will auto-fix these at send time.");
      console.log("  For permanent fixes, update the stored signature HTML in email_signatures.");
    }

  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("Audit failed:", err.message);
  process.exit(1);
});
