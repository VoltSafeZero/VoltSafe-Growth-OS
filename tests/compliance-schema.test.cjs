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
// 0. Typed data model in shared/schema.ts
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[0] Typed data model — shared/schema.ts");
{
  const src = readFile("shared/schema.ts");

  // contacts compliance columns
  const contactSchemaFields = [
    "recipientCountry", "provinceState", "jurisdiction",
    "canadaContact", "usContact",
    "consentStatus", "consentType", "consentSource", "consentTimestamp",
    "consentCaptureMethod", "consentLanguageVersion", "consentLanguageText",
    "consentFormUrl", "consentIpAddress", "consentUserAgent", "consentReferrer",
    "relatedBusinessRelationshipType", "relatedBusinessRelationshipDate",
    "impliedConsentExpiryDate",
    "unsubscribeStatus", "unsubscribeTimestamp", "unsubscribeSource",
    "suppressionStatus", "suppressionReason",
    "emailValid", "leadSource", "leadSourceDetail",
    "publicBusinessEmailUrl", "eventSource", "firstContactReason", "lastOutreachDate",
  ];
  for (const f of contactSchemaFields) {
    check(`contacts schema field: ${f}`, src.includes(f));
  }

  // marketingCampaigns compliance columns
  const campaignSchemaFields = [
    "targetJurisdiction", "senderName", "senderLegalEntity",
    "physicalMailingAddress", "unsubscribeLinkIncluded",
    "commercialDisclosureIncluded", "preferenceCenterLinkIncluded",
    "complianceStatus", "complianceErrors", "approvedByUserId",
    "recipientCountBeforePreflight", "recipientCountAfterSuppression", "blockedRecipientCount",
  ];
  for (const f of campaignSchemaFields) {
    check(`marketingCampaigns schema field: ${f}`, src.includes(f));
  }
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

  // ALLOWED_FIELDS must NOT contain consent_status, unsubscribe_status, suppression_status
  // (those require dedicated routes to prevent unauthorized resubscribe state changes)
  check("ALLOWED_FIELDS set excludes consent_status", (() => {
    const allowed = src.indexOf("const ALLOWED_FIELDS = new Set");
    const setEnd = src.indexOf("]);", allowed);
    const inSet = src.indexOf('"consent_status"', allowed);
    return inSet === -1 || inSet > setEnd;
  })());
  check("ALLOWED_FIELDS set excludes unsubscribe_status", (() => {
    const allowed = src.indexOf("const ALLOWED_FIELDS = new Set");
    const setEnd = src.indexOf("]);", allowed);
    const inSet = src.indexOf('"unsubscribe_status"', allowed);
    return inSet === -1 || inSet > setEnd;
  })());
  check("ALLOWED_FIELDS set excludes suppression_status", (() => {
    const allowed = src.indexOf("const ALLOWED_FIELDS = new Set");
    const setEnd = src.indexOf("]);", allowed);
    const inSet = src.indexOf('"suppression_status"', allowed);
    return inSet === -1 || inSet > setEnd;
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

  // PUT /api/contacts/:id must reject protected compliance fields
  check("PUT contact route has COMPLIANCE_PROTECTED guard", src.includes("COMPLIANCE_PROTECTED"));
  check("PUT contact blocks consentStatus updates", src.includes('"consentStatus"') && src.includes("COMPLIANCE_PROTECTED"));
  check("PUT contact blocks unsubscribeStatus updates", src.includes('"unsubscribeStatus"') && src.includes("COMPLIANCE_PROTECTED"));
  check("PUT contact blocks suppressionStatus updates", src.includes('"suppressionStatus"') && src.includes("COMPLIANCE_PROTECTED"));
  check("PUT contact returns 400 when protected field attempted", src.includes("must be updated via the compliance endpoints"));

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
  // isAdmin derived from real /api/auth/me query (not hardcoded true)
  check("isAdmin derived from /api/auth/me query", src.includes('queryKey: ["/api/auth/me"]'));
  check("isAdmin checks role master_admin or admin", src.includes("master_admin") && src.includes("currentUserIsAdmin"));
  check("TimelineSection call uses currentUserIsAdmin variable", src.includes("isAdmin={currentUserIsAdmin}"));
  check("TimelineSection call does NOT hardcode isAdmin=true", !src.includes("isAdmin={true}"));
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Campaign create dialog — client/src/pages/marketing-campaigns.tsx
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[5] Campaign create dialog — client/src/pages/marketing-campaigns.tsx");
{
  const src = readFile("client/src/pages/marketing-campaigns.tsx");

  // Form state — must use camelCase to match insertMarketingCampaignSchema in shared/schema.ts
  check("Form includes targetJurisdiction field (camelCase)", src.includes("targetJurisdiction:"));
  check("Form includes senderName field (camelCase)", src.includes("senderName:"));
  check("Form includes senderLegalEntity field (camelCase)", src.includes("senderLegalEntity:"));
  check("Form includes physicalMailingAddress field (camelCase)", src.includes("physicalMailingAddress:"));
  check("Form includes unsubscribeLinkIncluded boolean (camelCase)", src.includes("unsubscribeLinkIncluded: true"));
  check("Form includes commercialDisclosureIncluded boolean (camelCase)", src.includes("commercialDisclosureIncluded: false"));
  check("Form includes preferenceCenterLinkIncluded boolean (camelCase)", src.includes("preferenceCenterLinkIncluded: false"));
  // Must NOT use snake_case (would cause silent data drop on server)
  check("Form does NOT use target_jurisdiction (snake_case)", !src.includes("target_jurisdiction:"));

  // Form reset includes new fields
  const resetIdx = src.indexOf("setForm({ campaignName: \"\", campaignType: \"awareness\"");
  check("Form reset includes targetJurisdiction", src.slice(resetIdx, resetIdx + 500).includes("targetJurisdiction"));

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
