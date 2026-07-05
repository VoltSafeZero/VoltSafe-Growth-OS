#!/usr/bin/env node
/**
 * CASL/CAN-SPAM Compliance Schema — source-grep tests
 *
 * Pins the structure of the compliance migration, API routes, and UI
 * without spinning up a live server or browser.
 */

"use strict";
const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

function readFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Migration in seed-production.ts
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[1] Migration — seed-production.ts");
{
  const src = readFile("server/seed-production.ts");

  check("migrateComplianceSchema exported", src.includes("export async function migrateComplianceSchema"));

  // contacts columns
  const contactCols = [
    "recipient_country", "province_state", "jurisdiction",
    "canada_contact", "us_contact",
    "consent_status", "consent_type", "consent_source", "consent_timestamp",
    "consent_capture_method", "consent_language_version", "consent_language_text",
    "consent_form_url", "consent_ip_address", "consent_user_agent", "consent_referrer",
    "related_business_relationship_type", "related_business_relationship_date",
    "implied_consent_expiry_date",
    "unsubscribe_status", "unsubscribe_timestamp", "unsubscribe_source",
    "suppression_status", "suppression_reason",
    "email_valid", "lead_source", "lead_source_detail",
    "public_business_email_url", "event_source", "first_contact_reason", "last_outreach_date",
  ];
  for (const col of contactCols) {
    check(`contacts column: ${col}`, src.includes(col));
  }

  // marketing_campaigns columns
  const campaignCols = [
    "target_jurisdiction", "sender_name", "sender_legal_entity",
    "physical_mailing_address", "unsubscribe_link_included",
    "commercial_disclosure_included", "preference_center_link_included",
    "compliance_status", "compliance_errors", "approved_by_user_id",
    "recipient_count_before_preflight", "recipient_count_after_suppression",
    "blocked_recipient_count",
  ];
  for (const col of campaignCols) {
    check(`campaigns column: ${col}`, src.includes(col));
  }

  // compliance_audit_log table
  check("compliance_audit_log table created", src.includes("CREATE TABLE IF NOT EXISTS compliance_audit_log"));
  check("compliance_audit_log event_type column", src.includes("event_type"));
  check("compliance_audit_log contact_id column", src.includes("contact_id"));
  check("compliance_audit_log performed_by column", src.includes("performed_by"));
  check("compliance_audit_log old_values JSONB", src.includes("old_values") && src.includes("JSONB"));
  check("compliance_audit_log new_values JSONB", src.includes("new_values"));
  check("compliance_audit_log index on contact_id", src.includes("idx_compliance_audit_contact"));

  // contact_topic_preferences table
  check("contact_topic_preferences table created", src.includes("CREATE TABLE IF NOT EXISTS contact_topic_preferences"));
  check("contact_topic_preferences unique constraint", src.includes("UNIQUE(contact_id, topic)"));
  check("contact_topic_preferences index", src.includes("idx_contact_topic_prefs_contact"));

  check("migration log message", src.includes("CASL/CAN-SPAM compliance schema ready"));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Registration in server/index.ts
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[2] Migration registration — server/index.ts");
{
  const src = readFile("server/index.ts");
  check("migrateComplianceSchema imported", src.includes("migrateComplianceSchema"));
  check("migrateComplianceSchema called", src.includes("await migrateComplianceSchema()"));
  // Must come after migrateCampaignTrackingSchema
  const campaignIdx = src.indexOf("await migrateCampaignTrackingSchema()");
  const complianceIdx = src.indexOf("await migrateComplianceSchema()");
  check("compliance migration runs after campaign tracking", complianceIdx > campaignIdx);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. API routes in server/routes.ts
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[3] API routes — server/routes.ts");
{
  const src = readFile("server/routes.ts");

  // GET compliance
  check("GET /api/contacts/:id/compliance route", src.includes('app.get("/api/contacts/:id/compliance"'));
  check("GET compliance requires crm view permission", src.includes('app.get("/api/contacts/:id/compliance", requirePermission("crm", "view")'));

  // PATCH compliance
  check("PATCH /api/contacts/:id/compliance route", src.includes('app.patch("/api/contacts/:id/compliance"'));
  check("PATCH compliance requires crm edit permission", src.includes('app.patch("/api/contacts/:id/compliance", requirePermission("crm", "edit")'));

  // ALLOWED_FIELDS guards unsubscribe_status
  check("ALLOWED_FIELDS set excludes unsubscribe_status", (() => {
    const allowed = src.indexOf("ALLOWED_FIELDS");
    const unsubInSet = src.indexOf('"unsubscribe_status"', allowed);
    // Should not appear inside the ALLOWED_FIELDS set definition (only outside in audit reads)
    const setEnd = src.indexOf("]);", allowed);
    return unsubInSet === -1 || unsubInSet > setEnd;
  })());
  check("ALLOWED_FIELDS set excludes suppression_status", (() => {
    const allowed = src.indexOf("ALLOWED_FIELDS");
    const suppInSet = src.indexOf('"suppression_status"', allowed);
    const setEnd = src.indexOf("]);", allowed);
    return suppInSet === -1 || suppInSet > setEnd;
  })());

  // POST unsubscribe
  check("POST /api/contacts/:id/unsubscribe route", src.includes('app.post("/api/contacts/:id/unsubscribe"'));
  check("unsubscribe sets unsubscribe_status = unsubscribed", src.includes("unsubscribe_status = 'unsubscribed'"));
  check("unsubscribe sets consent_status = withdrawn", src.includes("consent_status = 'withdrawn'"));
  check("unsubscribe sets suppression_status = suppressed", src.includes("suppression_status = 'suppressed'"));
  check("unsubscribe writes compliance_audit_log", src.includes("'unsubscribed', ${id}"));

  // POST suppress
  check("POST /api/contacts/:id/suppress route", src.includes('app.post("/api/contacts/:id/suppress"'));
  check("suppress sets suppression_status = suppressed", src.includes("suppression_status = 'suppressed'"));
  check("suppress writes compliance_audit_log", src.includes("'suppressed', ${id}"));

  // GET audit log
  check("GET /api/contacts/:id/compliance/audit route", src.includes('app.get("/api/contacts/:id/compliance/audit"'));
  check("audit log query joins users for performed_by_name", src.includes("performed_by_name"));
  check("audit log orders DESC", src.includes("ORDER BY cal.created_at DESC"));

  // userId sourced from session (not req.user)
  const patchRoute = src.slice(src.indexOf('app.patch("/api/contacts/:id/compliance"'));
  check("PATCH compliance uses req.session.userId", patchRoute.includes("req.session.userId"));
  const unsubRoute = src.slice(src.indexOf('app.post("/api/contacts/:id/unsubscribe"'));
  check("POST unsubscribe uses req.session.userId", unsubRoute.includes("req.session.userId"));
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Contact profile UI — client/src/pages/contact-profile.tsx
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[4] Contact profile UI — client/src/pages/contact-profile.tsx");
{
  const src = readFile("client/src/pages/contact-profile.tsx");

  // Compliance tab trigger
  check("Compliance tab trigger rendered", src.includes('value="compliance"'));
  check("Compliance tab testid", src.includes('data-testid="tab-contact-compliance"'));

  // ComplianceTab component
  check("ComplianceTab component defined", src.includes("function ComplianceTab("));
  check("ComplianceTab queries /api/contacts compliance", src.includes('"/api/contacts", contactId, "compliance"'));
  check("ComplianceTab shows consent status badge", src.includes('data-testid="badge-consent-status"'));
  check("ComplianceTab shows unsubscribe status badge", src.includes('data-testid="badge-unsubscribe-status"'));
  check("ComplianceTab shows suppression status badge", src.includes('data-testid="badge-suppression-status"'));
  check("ComplianceTab shows implied consent expiry", src.includes('data-testid="implied-consent-expiry"'));

  // Admin action buttons
  check("Admin unsubscribe button present", src.includes('data-testid="btn-admin-unsubscribe"'));
  check("Admin suppress button present", src.includes('data-testid="btn-admin-suppress"'));
  check("Admin actions gated by isAdmin", src.includes("{isAdmin && ("));

  // TimelineSection updated with isAdmin
  check("TimelineSection accepts isAdmin prop", src.includes("isAdmin?: boolean"));
  check("TimelineSection passes isAdmin to ComplianceTab", src.includes("isAdmin={isAdmin ?? false}"));
  check("TimelineSection call passes isAdmin", src.includes("isAdmin={true}"));
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Campaign create dialog — client/src/pages/marketing-campaigns.tsx
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[5] Campaign create dialog — client/src/pages/marketing-campaigns.tsx");
{
  const src = readFile("client/src/pages/marketing-campaigns.tsx");

  // Form state
  check("Form includes target_jurisdiction field", src.includes("target_jurisdiction:"));
  check("Form includes sender_name field", src.includes("sender_name:"));
  check("Form includes sender_legal_entity field", src.includes("sender_legal_entity:"));
  check("Form includes physical_mailing_address field", src.includes("physical_mailing_address:"));
  check("Form includes unsubscribe_link_included boolean", src.includes("unsubscribe_link_included: true"));
  check("Form includes commercial_disclosure_included boolean", src.includes("commercial_disclosure_included: false"));
  check("Form includes preference_center_link_included boolean", src.includes("preference_center_link_included: false"));

  // Form reset includes new fields
  const resetIdx = src.indexOf("setForm({ campaignName: \"\", campaignType: \"awareness\"");
  check("Form reset includes target_jurisdiction", src.slice(resetIdx, resetIdx + 500).includes("target_jurisdiction"));

  // UI elements
  check("Compliance section header rendered", src.includes("Compliance (CASL / CAN-SPAM)"));
  check("Target jurisdiction select rendered", src.includes('data-testid="select-target-jurisdiction"'));
  check("Sender name input rendered", src.includes('data-testid="input-sender-name"'));
  check("Sender legal entity input rendered", src.includes('data-testid="input-sender-legal-entity"'));
  check("Physical mailing address input rendered", src.includes('data-testid="input-physical-mailing-address"'));
  check("Jurisdiction options: Canada CASL", src.includes("Canada (CASL)"));
  check("Jurisdiction options: USA CAN-SPAM", src.includes("United States (CAN-SPAM)"));
  // Checkboxes use a mapped template literal: data-testid={`checkbox-${key}`}
  check("Unsubscribe checkbox rendered via template testid", src.includes("checkbox-${key}") || src.includes('checkbox-unsubscribe_link_included'));
  check("Commercial disclosure checkbox rendered via template testid", src.includes("checkbox-${key}") || src.includes('checkbox-commercial_disclosure_included'));
  check("Preference centre checkbox rendered via template testid", src.includes("checkbox-${key}") || src.includes('checkbox-preference_center_link_included'));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
