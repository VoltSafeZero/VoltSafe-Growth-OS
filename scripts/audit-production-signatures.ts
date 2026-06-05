/**
 * audit-production-signatures.ts
 *
 * Connects to the production database (prefers PROD_DATABASE_URL, falls back to
 * DATABASE_URL) and inspects all email_signatures + signature_cta_items records
 * for content that causes the production proxy to reject a send with 403.
 *
 * Uses the `pg` package (already a project dependency — no additional installs).
 *
 * Usage:
 *   npx tsx scripts/audit-production-signatures.ts
 *   npx tsx scripts/audit-production-signatures.ts --user=trevor@voltsafe.com
 *   npx tsx scripts/audit-production-signatures.ts --user=trevor@voltsafe.com --fix-preview
 *
 *   With production DB:
 *   PROD_DATABASE_URL=postgresql://... npx tsx scripts/audit-production-signatures.ts
 *
 * Flags:
 *   --user=EMAIL    Only audit signatures for this email address.
 *   --fix-preview   Write a sanitized HTML preview to /tmp/sig-preview-<id>.html
 *
 * Does NOT log raw signature HTML or any credentials.
 */

import pg from "pg";
import fs from "fs";
import path from "path";
import { sanitizeSignatureHtml, auditSignatureHtml } from "../server/services/signature-html-sanitizer";

const { Pool } = pg;

const DB_URL = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("ERROR: Set PROD_DATABASE_URL or DATABASE_URL before running this script.");
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

  const pool = new Pool({
    connectionString: DB_URL!,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: DB_URL!.includes("localhost") || DB_URL!.includes("127.0.0.1")
      ? undefined
      : { rejectUnauthorized: false },
  });

  try {
    // ── Fetch signatures ──────────────────────────────────────────────────────
    const sigParams: string[] = [];
    let sigWhere = "";
    if (FILTER_USER) {
      sigParams.push(FILTER_USER);
      sigWhere = `AND u.email = $1`;
    }

    const sigResult = await pool.query(
      `SELECT s.id, s.name, u.email AS user_email, s.is_default,
              LENGTH(s.html_content) AS html_length,
              s.html_content
       FROM   email_signatures s
       JOIN   users u ON u.id = s.user_id
       WHERE  1=1 ${sigWhere}
       ORDER  BY u.email, s.id`,
      sigParams,
    );

    const sigs = sigResult.rows as {
      id: number; name: string; user_email: string; is_default: boolean;
      html_length: number; html_content: string;
    }[];

    if (!sigs.length) {
      console.log("No signatures found.");
      return;
    }

    // ── Fetch CTA items ───────────────────────────────────────────────────────
    const sigIds = sigs.map((s) => s.id);
    const ctaResult = await pool.query(
      `SELECT id, signature_id, name, type, image_url, destination_url
       FROM   signature_cta_items
       WHERE  signature_id = ANY($1::int[])`,
      [sigIds],
    );
    const ctasBySig = new Map<number, typeof ctaResult.rows>();
    for (const c of ctaResult.rows) {
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
          else {
            const oldHost = (() => { try { return /\.(replit\.dev|repl\.co|repl\.it)$/.test(new URL(cta.image_url!).hostname); } catch { return false; } })();
            if (oldHost) ctaIssues.push(`CTA "${cta.name}" (id=${cta.id}): old Replit host image_url → ${cta.image_url}`);
          }
        }
      }

      const allIssues = [...audit.issues, ...ctaIssues];
      totalIssues += allIssues.length;

      console.log(`─────────────────────────────────────────────────`);
      console.log(`Sig #${sig.id}  user=${sig.user_email}  name="${sig.name}"`);
      console.log(`  default=${sig.is_default}  html_length=${sig.html_length} bytes`);

      console.log(`  img srcs (${audit.imgSrcs.length}):${audit.imgSrcs.length ? "" : " (none)"}`);
      for (const src of audit.imgSrcs) {
        const preview = src.startsWith("data:") ? `${src.slice(0, 60)}... [BASE64 — ${src.length} chars]` : src.slice(0, 120);
        console.log(`    • ${preview}`);
      }

      console.log(`  hrefs (${audit.hrefs.length}): ${audit.hrefs.slice(0, 3).map((h) => h.slice(0, 60)).join(" | ") || "(none)"}`);

      if (allIssues.length) {
        console.log(`  ⚠  ISSUES (${allIssues.length}):`);
        for (const iss of allIssues) console.log(`    ✗ ${iss}`);
      } else {
        console.log(`  ✓  No issues found`);
      }

      if (audit.hasDataUri) {
        console.log(`  → FIX: data-URI images cause 403 (proxy body-size limit).`);
        console.log(`    Replace with an absolute HTTPS URL served from /assets/cta/<uuid>.png.`);
      }
      if (audit.hasOldReplitHost) {
        console.log(`  → FIX: Update old Replit host URLs to https://voltsafe.app/assets/cta/<file>.`);
      }
      if (audit.hasApiRoute) {
        console.log(`  → FIX: Replace /api/ image src with a public /assets/cta/ path.`);
      }
      if (audit.hasLocalhost) {
        console.log(`  → FIX: Remove localhost image src (unreachable in email clients).`);
      }
      if (ctaIssues.length) {
        console.log(`  → FIX: Update CTA image_url values in signature_cta_items table.`);
      }

      if (FIX_PREVIEW && allIssues.length > 0) {
        const sanitized = sanitizeSignatureHtml(sig.html_content, BASE_URL);
        const previewPath = path.join("/tmp", `sig-preview-${sig.id}.html`);
        fs.writeFileSync(previewPath, `<!doctype html><html><body>${sanitized}</body></html>`);
        console.log(`  → Sanitized preview written to ${previewPath}`);
      }

      console.log(`  CTA items: ${sigCtas.length}`);
      for (const c of sigCtas) {
        console.log(`    CTA id=${c.id} name="${c.name}" type=${c.type} dest=${String(c.destination_url).slice(0, 60)}`);
        if (c.image_url) console.log(`         image_url=${String(c.image_url).slice(0, 80)}`);
      }
    }

    console.log(`\n=== Summary ===`);
    console.log(`Signatures audited: ${sigs.length}`);
    console.log(`Total issues:       ${totalIssues}`);
    if (totalIssues === 0) {
      console.log("✓ All signatures look safe for sending.");
    } else {
      console.log("✗ Issues found — the send-time sanitizer will auto-fix these.");
      console.log("  For permanent fixes, update the stored signature HTML in email_signatures.");
    }

  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Audit failed:", err.message);
  process.exit(1);
});
