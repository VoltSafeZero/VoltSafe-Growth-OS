/**
 * tests/signature-cta-tracking.test.js
 *
 * Regression suite for signature CTA tracking.
 * Source-grep approach: checks structural invariants without hitting the network.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function check(description, condition) {
  if (condition) {
    console.log(`  ✓ ${description}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${description}`);
    failed++;
  }
}

// ── Helper: read file contents ────────────────────────────────────────────────

function read(relPath) {
  return readFileSync(join(__dirname, "..", relPath), "utf8");
}

// ── 1. email-format.ts: buildEmailHtml adds sig markers ───────────────────────

console.log("\n[1] email-format.ts — sig section markers");
{
  const src = read("client/src/lib/email-format.ts");
  check("buildEmailHtml wraps appendHtml with vs-sig-start marker",
    src.includes("vs-sig-start") && src.includes("vs-sig-end"));
  check("markers are added only when appendHtml is non-empty",
    /appendHtml\s*\?/.test(src) || /appendHtml &&/.test(src));
}

// ── 2. signature-cta-tracker.ts: service invariants ──────────────────────────

console.log("\n[2] server/services/signature-cta-tracker.ts — service");
{
  const src = read("server/services/signature-cta-tracker.ts");
  check("exports wrapSignatureCtaLinks",     src.includes("export async function wrapSignatureCtaLinks"));
  check("exports updateSignatureCtaMessageIds", src.includes("export async function updateSignatureCtaMessageIds"));
  check("exports recordSignatureCtaClick",   src.includes("export async function recordSignatureCtaClick"));
  check("uses vs-sig-start marker constant", src.includes("vs-sig-start"));
  check("uses vs-sig-end marker constant",   src.includes("vs-sig-end"));
  check("generates UUIDs for tokens",        src.includes("randomUUID"));
  check("inserts into signature_cta_clicks", src.includes("signature_cta_clicks"));
  check("uses isBotUserAgent for bot check", src.includes("isBotUserAgent"));
  check("uses hashIp for privacy",           src.includes("hashIp"));
  check("writes CRM activity on real click", src.includes("email_cta_click"));
  check("non-fatal on CTA insert error",     src.includes("non-fatal"));
  check("isSafeCtaUrl guards against non-http", src.includes("isSafeCtaUrl"));
}

// ── 3. SQL migration: tables exist ───────────────────────────────────────────

console.log("\n[3] migrations/0010_signature_cta_tracking.sql — schema");
{
  const sql = read("migrations/0010_signature_cta_tracking.sql");
  check("email_signature_ctas table created", sql.includes("CREATE TABLE IF NOT EXISTS email_signature_ctas"));
  check("signature_cta_clicks table created", sql.includes("CREATE TABLE IF NOT EXISTS signature_cta_clicks"));
  check("signature_cta_click_events table created", sql.includes("CREATE TABLE IF NOT EXISTS signature_cta_click_events"));
  check("token column is UNIQUE",             sql.includes("UNIQUE"));
  check("tracking_enabled column present",    sql.includes("tracking_enabled"));
  check("destination_url column present",     sql.includes("destination_url"));
  check("user_id indexed",                    sql.includes("idx_email_signature_ctas_user_id"));
  check("token indexed",                      sql.includes("idx_signature_cta_clicks_token"));
}

// ── 4. seed-production.ts: migration function present ────────────────────────

console.log("\n[4] server/seed-production.ts — migration function");
{
  const src = read("server/seed-production.ts");
  check("migrateSignatureCtaSchema function defined",
    src.includes("migrateSignatureCtaSchema"));
  check("creates email_signature_ctas table",
    src.includes("email_signature_ctas"));
}

// ── 5. server/index.ts: migration called on startup ──────────────────────────

console.log("\n[5] server/index.ts — migration startup call");
{
  const src = read("server/index.ts");
  check("migrateSignatureCtaSchema imported", src.includes("migrateSignatureCtaSchema"));
  check("migrateSignatureCtaSchema called",   src.includes("await migrateSignatureCtaSchema()"));
}

// ── 6. server/routes.ts: endpoints and send-pipeline wiring ──────────────────

console.log("\n[6] server/routes.ts — CTA endpoints and send pipeline");
{
  const src = read("server/routes.ts");
  check("imports wrapSignatureCtaLinks",      src.includes("wrapSignatureCtaLinks"));
  check("imports updateSignatureCtaMessageIds", src.includes("updateSignatureCtaMessageIds"));
  check("imports recordSignatureCtaClick",    src.includes("recordSignatureCtaClick"));
  check("GET /track/signature-click/:token endpoint defined",
    src.includes("/track/signature-click/:token"));
  check("GET /api/signature-ctas endpoint defined",
    src.includes("/api/signature-ctas"));
  check("POST /api/signature-ctas endpoint defined",
    src.includes('app.post("/api/signature-ctas"') ||
    src.includes("app.post('/api/signature-ctas'"));
  check("DELETE /api/signature-ctas/:id endpoint defined",
    src.includes("/api/signature-ctas/:id"));
  check("wrapSignatureCtaLinks called in send pipeline",
    src.includes("wrapSignatureCtaLinks(cleanBody"));
  check("send pipeline uses ctaWrappedBody instead of cleanBody for injectTracking",
    src.includes("injectTracking(ctaWrappedBody") || src.includes("ctaWrappedBody"));
  check("updateSignatureCtaMessageIds called after send",
    src.includes("updateSignatureCtaMessageIds"));
  check("redirect to destination_url on click",
    src.includes("destination_url"));
  check("public redirect endpoint has no requireAuth",
    !/requireAuth[^;]*track\/signature-click/.test(src));
}

// ── 7. signature-settings.tsx: CTA management UI ─────────────────────────────

console.log("\n[7] client/src/pages/signature-settings.tsx — CTA UI");
{
  const src = read("client/src/pages/signature-settings.tsx");
  check("SignatureCta type defined",          src.includes("SignatureCta"));
  check("CtaSection component defined",       src.includes("CtaSection") || src.includes("function Cta"));
  check("CtaDialog component defined",        src.includes("CtaDialog") || src.includes("dialog-cta"));
  check("/api/signature-ctas query used",     src.includes("/api/signature-ctas"));
  check("Watch a Demo preset available",
    src.includes("Watch a Demo") || src.includes("watch-a-demo") || src.includes("voltsafemarine"));
  check("tracking_enabled toggle in UI",
    src.includes("tracking_enabled") || src.includes("trackingEnabled"));
  check("destination_url field in CTA form",
    src.includes("destination_url") || src.includes("destinationUrl"));
}

// ── 8. injectTracking: double-wrap protection ─────────────────────────────────

console.log("\n[8] server/tracking.ts — double-wrap protection");
{
  const src = read("server/tracking.ts");
  check("injectTracking skips URLs already containing /track/",
    src.includes('url.includes("/track/")'));
  check("skip check fires before rewriting the href",
    src.indexOf('url.includes("/track/")') < src.indexOf("encodeURIComponent(url)"));
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
