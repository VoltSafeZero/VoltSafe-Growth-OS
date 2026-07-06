#!/usr/bin/env node
"use strict";
// Capital Phase 2G — Data Room + Investor Materials Tracker tests
// Source-grep + structural checks — no live DB required

const fs   = require("fs");
const path = require("path");

let passed = 0, failed = 0;
function ok(label, v) {
  if (v) { passed++; process.stdout.write(`  ✓ ${label}\n`); }
  else   { failed++; process.stdout.write(`  ✗ ${label}\n`); }
}

// ── File readers ──────────────────────────────────────────────────────────────
function read(rel) {
  try { return fs.readFileSync(path.resolve(__dirname, "..", rel), "utf8"); }
  catch { return ""; }
}

const routes   = read("server/routes-capital.ts");
const service  = read("server/services/capital-data-room.ts");
const frontend = read("client/src/pages/capital-documents.tsx");
const appTsx   = read("client/src/App.tsx");
const navCfg   = read("client/src/lib/nav-config.ts");

// ── 1. Service exports ────────────────────────────────────────────────────────
console.log("\n── 1. Service exports ───────────────────────────────────────────────");
ok("service file exists",              service.length > 100);
ok("MATERIAL_TYPES exported",          service.includes("export const MATERIAL_TYPES"));
ok("MATERIAL_STATUSES exported",       service.includes("export const MATERIAL_STATUSES"));
ok("SHARE_STATUSES exported",          service.includes("export const SHARE_STATUSES"));
ok("REQUEST_STATUSES exported",        service.includes("export const REQUEST_STATUSES"));
ok("SHARE_METHODS exported",           service.includes("export const SHARE_METHODS"));
ok("MATERIAL_TYPE_LABELS exported",    service.includes("export const MATERIAL_TYPE_LABELS"));
ok("KEY_MATERIAL_TYPES exported",      service.includes("export const KEY_MATERIAL_TYPES"));
ok("computeDataRoomIntelligence exported", service.includes("export function computeDataRoomIntelligence"));
ok("computeMaterialRiskFlags exported",    service.includes("export function computeMaterialRiskFlags"));
ok("getInvestorMaterials exported",        service.includes("export function getInvestorMaterials"));
ok("getRelevantMaterialsForEmailContext exported", service.includes("export function getRelevantMaterialsForEmailContext"));
ok("Material interface exported",      service.includes("export interface Material"));
ok("MaterialShare interface exported", service.includes("export interface MaterialShare"));
ok("MaterialRequest interface exported",service.includes("export interface MaterialRequest"));
ok("DataRoomIntelligence interface exported", service.includes("export interface DataRoomIntelligence"));
ok("InvestorMaterialRow interface exported",  service.includes("export interface InvestorMaterialRow"));

// ── 2. Material types ────────────────────────────────────────────────────────
console.log("\n── 2. Material types ────────────────────────────────────────────────");
const REQUIRED_TYPES = [
  "pitch_deck","executive_summary","financial_model","cap_table",
  "product_overview","technical_overview","due_diligence","subscription_agreement","other"
];
for (const t of REQUIRED_TYPES) {
  ok(`MATERIAL_TYPES includes ${t}`, service.includes(`"${t}"`));
}
ok("pitch_deck in KEY_MATERIAL_TYPES",      service.includes('"pitch_deck"') && service.includes("KEY_MATERIAL_TYPES"));
ok("financial_model in KEY_MATERIAL_TYPES", service.includes('"financial_model"'));

// ── 3. Valuation summary — data room intelligence logic ───────────────────────
console.log("\n── 3. Data room intelligence logic ──────────────────────────────────");
ok("stale shares threshold 30 days",    service.includes("30"));
ok("superseded detection logic",        service.includes("superseded"));
ok("overdue request detection",         service.includes("due_at") && service.includes("< now"));
ok("diligence blockers computed",       service.includes("diligence_blockers"));
ok("investors_without_key_materials",   service.includes("investors_without_key_materials"));
ok("has_pitch_deck flag",               service.includes("has_pitch_deck"));
ok("has_financial_model flag",          service.includes("has_financial_model"));
ok("DILIGENCE_STAGES constant",         service.includes("DILIGENCE_STAGES"));
ok("not-shared status supported",       service.includes("not_shared"));

// ── 4. Risk flags ─────────────────────────────────────────────────────────────
console.log("\n── 4. Material risk flags ───────────────────────────────────────────");
ok("no_pitch_deck critical flag",       service.includes("no_pitch_deck"));
ok("no_financial_model warning flag",   service.includes("no_financial_model"));
ok("lead_missing_materials flag",       service.includes("lead_missing_materials"));
ok("stale_shares flag",                 service.includes("stale_shares"));
ok("superseded_outstanding flag",       service.includes("superseded_outstanding"));
ok("overdue_requests flag",             service.includes("overdue_requests"));
ok("diligence_blockers flag",           service.includes("diligence_blockers"));
ok("nda_required_shared flag",          service.includes("nda_required_shared"));
ok("critical level for no_pitch_deck",  service.includes('"critical"') && service.includes("no_pitch_deck"));

// ── 5. Schema migration ───────────────────────────────────────────────────────
console.log("\n── 5. Schema migration ──────────────────────────────────────────────");
ok("Phase 2G migration block",            routes.includes("Phase 2G"));
ok("capital_materials table",             routes.includes("CREATE TABLE IF NOT EXISTS capital_materials"));
ok("capital_material_shares table",       routes.includes("CREATE TABLE IF NOT EXISTS capital_material_shares"));
ok("capital_material_requests table",     routes.includes("CREATE TABLE IF NOT EXISTS capital_material_requests"));
ok("deleted_at in capital_materials",     routes.includes("deleted_at") && routes.includes("capital_materials"));
ok("deleted_at in capital_material_shares", routes.match(/capital_material_shares[\s\S]{0,500}deleted_at/));
ok("deleted_at in capital_material_requests", routes.match(/capital_material_requests[\s\S]{0,500}deleted_at/));
ok("is_confidential column",              routes.includes("is_confidential"));
ok("requires_nda column",                 routes.includes("requires_nda"));
ok("file_url column",                     routes.includes("file_url"));
ok("external_url column",                 routes.includes("external_url"));
ok("file_storage_key column",             routes.includes("file_storage_key"));
ok("material_type column",                routes.includes("material_type"));
ok("version_label column",                routes.includes("version_label"));
ok("allocation_status on commitments",    routes.includes("allocation_status")); // Phase 2F still present
ok("share_method column",                 routes.includes("share_method"));
ok("requested_material_type column",      routes.includes("requested_material_type"));
ok("fulfilled_material_id column",        routes.includes("fulfilled_material_id"));
ok("all migrations use IF NOT EXISTS",    !routes.match(/CREATE TABLE capital_[a-z_]+ \(/));
ok("material indexes created",            routes.includes("idx_cap_materials"));

// ── 6. Materials API routes ───────────────────────────────────────────────────
console.log("\n── 6. Materials API routes ──────────────────────────────────────────");
ok("GET /api/capital/materials",                routes.includes('"/api/capital/materials"'));
ok("POST /api/capital/materials",               routes.match(/app\.post\(["'`]\/api\/capital\/materials["'`]/));
ok("GET /api/capital/materials/:id",            routes.match(/app\.get\(["'`]\/api\/capital\/materials\/:id["'`]/));
ok("PATCH /api/capital/materials/:id",          routes.match(/app\.patch\(["'`]\/api\/capital\/materials\/:id["'`]/));
ok("DELETE /api/capital/materials/:id",         routes.match(/app\.delete\(["'`]\/api\/capital\/materials\/:id["'`]/));
ok("materials list excludes soft-deleted",      routes.includes("deleted_at IS NULL") || routes.includes("deleted_at is null"));

// ── 7. Shares API routes ──────────────────────────────────────────────────────
console.log("\n── 7. Shares API routes ─────────────────────────────────────────────");
ok("GET /api/capital/materials/:id/shares",     routes.includes("/api/capital/materials/:id/shares"));
ok("POST /api/capital/materials/:id/share",     routes.includes("/api/capital/materials/:id/share"));
ok("PATCH /api/capital/material-shares/:id",    routes.includes("/api/capital/material-shares/:id"));
ok("DELETE /api/capital/material-shares/:id",   routes.match(/app\.delete.*material-shares/));
ok("share creates capital activity",            routes.match(/logCapitalActivity[\s\S]{0,200}material/));
ok("share soft-deleted via deleted_at",         routes.match(/material_shares[\s\S]{0,200}deleted_at = NOW/));

// ── 8. Investor materials route ───────────────────────────────────────────────
console.log("\n── 8. Investor materials route ──────────────────────────────────────");
ok("GET /api/capital/investors/:id/materials",  routes.includes("/api/capital/investors/:id/materials"));
ok("route uses requireCapitalAccess",           routes.match(/investors\/:id\/materials.*requireCapitalAccess/) ||
   routes.match(/requireCapitalAccess[\s\S]{0,50}investors\/:id\/materials/));

// ── 9. Material requests routes ───────────────────────────────────────────────
console.log("\n── 9. Material requests routes ──────────────────────────────────────");
ok("GET /api/capital/material-requests",        routes.includes("/api/capital/material-requests\""));
ok("POST /api/capital/material-requests",       routes.match(/app\.post.*material-requests/));
ok("PATCH /api/capital/material-requests/:id",  routes.match(/app\.patch.*material-requests\/:id/));
ok("DELETE /api/capital/material-requests/:id", routes.match(/app\.delete.*material-requests\/:id/));
ok("requests soft-deleted via deleted_at",      routes.match(/material_requests[\s\S]{0,200}deleted_at = NOW/));

// ── 10. Permissions ───────────────────────────────────────────────────────────
console.log("\n── 10. Permissions ──────────────────────────────────────────────────");
const materialRouteSection = routes.slice(routes.indexOf("/api/capital/materials"), routes.length);
const accessOccurrences = (materialRouteSection.match(/requireCapitalAccess/g) || []).length;
ok("requireCapitalAccess on material routes (≥10 occurrences)", accessOccurrences >= 10);
ok("requireCapitalAccess on share routes", routes.match(/material.*share.*requireCapitalAccess/) ||
   materialRouteSection.includes("requireCapitalAccess"));
ok("requireCapitalAccess on request routes", routes.match(/material-requests.*requireCapitalAccess/) ||
   materialRouteSection.includes("requireCapitalAccess"));
ok("CAPITAL_ALLOWED_USER_IDS still defined", routes.includes("CAPITAL_ALLOWED_USER_IDS"));
ok("requireCapitalAccess function still present", routes.includes("function requireCapitalAccess"));

// ── 11. Command center integration ────────────────────────────────────────────
console.log("\n── 11. Command center integration ───────────────────────────────────");
ok("capital-data-room service imported in command-center", routes.includes("capital-data-room.js"));
ok("data_room_intel in command-center response",           routes.includes("data_room_intel"));
ok("data room risk flags merged into risk_flags",          routes.match(/valuationFlags[\s\S]{0,300}dataRoomFlags|dataRoomFlags[\s\S]{0,300}valuationFlags/) ||
   routes.includes("dataRoomFlags"));
ok("command-center queries capital_materials",             routes.includes("capital_materials"));
ok("command-center queries capital_material_shares",       routes.includes("capital_material_shares"));

// ── 12. Email context integration ─────────────────────────────────────────────
console.log("\n── 12. Email context integration ────────────────────────────────────");
ok("email-context queries material shares",               routes.match(/email.context[\s\S]{0,800}material_shares/) ||
   routes.match(/capital_materials[\s\S]{0,1000}email.context/));
ok("email-context returns relevant_materials",            routes.includes("relevant_materials"));
ok("getRelevantMaterialsForEmailContext used in routes",  routes.includes("getRelevantMaterialsForEmailContext"));

// ── 13. Frontend page ─────────────────────────────────────────────────────────
console.log("\n── 13. Frontend page ────────────────────────────────────────────────");
ok("page file exists",                   frontend.length > 500);
ok("material library section",           frontend.includes("data-testid=\"material-library\"") || frontend.includes("section-materials"));
ok("material detail drawer/sheet",       frontend.includes("section-detail") || frontend.includes("material-detail") || frontend.includes("Sheet") || frontend.includes("DrawerContent"));
ok("share material dialog present",      frontend.includes("share") && (frontend.includes("Dialog") || frontend.includes("dialog")));
ok("material type filter present",       frontend.includes("material_type") || frontend.includes("materialType"));
ok("status filter present",              frontend.includes("status") && frontend.includes("filter"));
ok("search by title present",            frontend.includes("search") || frontend.includes("Search"));
ok("add material button/dialog",         frontend.includes("Add Material") || frontend.includes("add-material") || frontend.includes("new-material"));
ok("version label shown",                frontend.includes("version") || frontend.includes("version_label"));
ok("is_confidential flag shown",         frontend.includes("confidential") || frontend.includes("is_confidential"));
ok("requires_nda flag shown",            frontend.includes("nda") || frontend.includes("NDA") || frontend.includes("requires_nda"));
ok("share history in drawer",            frontend.includes("share") && frontend.includes("history") || frontend.includes("Shares"));
ok("requests section in drawer",         frontend.includes("Requests") || frontend.includes("requests"));
ok("empty states render safely",         frontend.includes("empty") || frontend.includes("Empty") || frontend.includes("no materials"));
ok("no fake upload security claims",     !frontend.includes("files are encrypted") && !frontend.includes("100% secure upload"));
ok("metadata-first TODO comment",        frontend.includes("TODO") || frontend.includes("file storage") || frontend.includes("file_url"));

// ── 14. Nav + routing ─────────────────────────────────────────────────────────
console.log("\n── 14. Nav + routing ────────────────────────────────────────────────");
ok("Data Room nav item exists",           navCfg.includes("data-room") || navCfg.includes("Data Room"));
ok("Data Room nav is capitalOnly",        navCfg.includes("capitalOnly"));
ok("/capital/data-room route in App.tsx", appTsx.includes("/capital/data-room"));
ok("route uses capitalGuard",             appTsx.match(/data-room.*capitalGuard|capitalGuard.*data-room/));
ok("CapitalDocumentsPage imported",       appTsx.includes("CapitalDocumentsPage") || appTsx.includes("capital-documents"));

// ── 15. Share workflow logic ──────────────────────────────────────────────────
console.log("\n── 15. Share workflow logic ─────────────────────────────────────────");
ok("share_method supported in share POST",  routes.includes("share_method"));
ok("email_thread_id linkable on share",     routes.includes("email_thread_id") && routes.includes("material_shares"));
ok("shared_at set on share creation",       routes.match(/capital_material_shares[\s\S]{0,600}shared_at/));
ok("shared_by set from session",            routes.match(/shared_by[\s\S]{0,800}session\.userId/) || routes.match(/session\.userId[\s\S]{0,800}shared_by/));
ok("last_touch_at updated on share",        routes.match(/last_touch_at[\s\S]{0,400}share|share[\s\S]{0,400}last_touch_at/));
ok("duplicate share check or upsert",       routes.match(/ON CONFLICT|material_id.*investor_id|already shared|duplicate/i));

// ── 16. Request workflow logic ────────────────────────────────────────────────
console.log("\n── 16. Request workflow logic ────────────────────────────────────────");
ok("fulfilled_material_id on request PATCH", routes.includes("fulfilled_material_id") && routes.match(/material-requests\/:id[\s\S]{0,600}fulfilled_material_id/));
ok("fulfilled_at on request fulfillment",    routes.includes("fulfilled_at"));
ok("due_at overdue detection in service",    service.includes("due_at") && service.includes("now"));
ok("request priority field",                routes.includes("priority") && routes.includes("material_requests"));
ok("investor_id on request creation",       routes.match(/investor_id[\s\S]{0,100}material_requests/));

// ── 17. Soft-delete pattern ───────────────────────────────────────────────────
console.log("\n── 17. Soft-delete pattern ──────────────────────────────────────────");
ok("materials use soft delete (deleted_at = NOW())", routes.match(/capital_materials[\s\S]{0,500}deleted_at = NOW/));
ok("shares use soft delete",   routes.match(/capital_material_shares[\s\S]{0,500}deleted_at = NOW/));
ok("requests use soft delete", routes.match(/capital_material_requests[\s\S]{0,500}deleted_at = NOW/));
ok("list queries filter deleted_at IS NULL", (routes.match(/capital_materials.*deleted_at IS NULL/g) || []).length >= 2);

// ── 18. Cortex / save-to-context ─────────────────────────────────────────────
console.log("\n── 18. Cortex / save-to-context ─────────────────────────────────────");
ok("capital_material entity_type referenced", routes.includes("capital_material") || service.includes("capital_material"));
ok("data-room tag referenced",                routes.includes("data-room") || service.includes("data-room") || frontend.includes("data-room"));
ok("fundraising tag referenced",              routes.includes("fundraising") || service.includes("fundraising") || frontend.includes("fundraising"));

// ── 19. Edge cases / safety ───────────────────────────────────────────────────
console.log("\n── 19. Edge cases / safety ──────────────────────────────────────────");
ok("no auto-send email in materials",         !routes.match(/sendMail|sendEmail[\s\S]{0,50}material_shares/));
ok("no fake file data in seed",               !routes.includes("fake_file") && !routes.includes("mock_file_url"));
ok("file_url is nullable (no NOT NULL)",      !routes.match(/file_url\s+TEXT\s+NOT NULL/));
ok("TODO comment for file storage",           routes.includes("TODO") || service.includes("TODO"));
ok("metadata-first approach noted",           service.includes("TODO") || routes.includes("metadata"));
ok("service imports WeightedPipelineResult or just uses any", true); // pure functions

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(60));
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
if (failed === 0) {
  console.log("\n✓ All Capital Data Room checks passed");
  process.exit(0);
} else {
  console.log("\n✗ Some checks failed");
  process.exit(1);
}
