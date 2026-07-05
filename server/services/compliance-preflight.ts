/**
 * Compliance Preflight Service — Task #49
 *
 * CASL/CAN-SPAM enforcement layer for campaign sends.
 * Provides:
 *   - runCampaignPreflight(campaignId) → PreflightResult
 *   - buildCompliantFooter(opts) → { html, text }
 *   - signComplianceToken / verifyComplianceToken (HMAC, 30-day TTL)
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import crypto from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ComplianceError {
  code: string;
  message: string;
  jurisdiction: "casl" | "can_spam" | "general";
  severity: "blocking" | "warning";
}

export interface PreflightResult {
  passed: boolean;
  errors: ComplianceError[];
  canadaCount: number;
  usCount: number;
  otherCount: number;
  blockedCount: number;
  eligibleCount: number;
  totalEnrolled: number;
  warnings: string[];
}

// ─── CASL per-recipient checks ────────────────────────────────────────────────

function checkCaslRecipient(r: any): ComplianceError[] {
  const errors: ComplianceError[] = [];

  const validConsent = ["express_active", "implied_active"];
  if (!validConsent.includes(r.consent_status || "")) {
    errors.push({
      code: "casl_no_consent",
      message: `Recipient ${r.email} has no valid CASL consent (status: ${r.consent_status ?? "unknown"}). Express or implied consent is required.`,
      jurisdiction: "casl",
      severity: "blocking",
    });
  }

  if (r.consent_status === "implied_active" && r.implied_consent_expiry_date) {
    const expiry = new Date(r.implied_consent_expiry_date);
    if (expiry < new Date()) {
      errors.push({
        code: "casl_implied_consent_expired",
        message: `Recipient ${r.email} has expired implied consent (expired ${expiry.toISOString().slice(0, 10)}).`,
        jurisdiction: "casl",
        severity: "blocking",
      });
    }
  }

  if (r.unsubscribe_status === "unsubscribed") {
    errors.push({
      code: "casl_unsubscribed",
      message: `Recipient ${r.email} has unsubscribed.`,
      jurisdiction: "casl",
      severity: "blocking",
    });
  }

  if (r.suppression_status && r.suppression_status !== "none") {
    errors.push({
      code: "casl_suppressed",
      message: `Recipient ${r.email} is suppressed (reason: ${r.suppression_status}).`,
      jurisdiction: "casl",
      severity: "blocking",
    });
  }

  if (r.email_valid === false) {
    errors.push({
      code: "casl_invalid_email",
      message: `Recipient ${r.email} has an invalid email address.`,
      jurisdiction: "casl",
      severity: "blocking",
    });
  }

  return errors;
}

// ─── CASL campaign-level checks ───────────────────────────────────────────────

function checkCampaignCasl(campaign: any): ComplianceError[] {
  const errors: ComplianceError[] = [];

  if (!campaign.sender_name?.trim()) {
    errors.push({
      code: "casl_no_sender_identity",
      message: "Campaign is missing sender identity (sender name). CASL requires clear identification of the sender.",
      jurisdiction: "casl",
      severity: "blocking",
    });
  }

  if (!campaign.physical_mailing_address?.trim()) {
    errors.push({
      code: "casl_no_physical_address",
      message: "Campaign is missing a physical mailing address. CASL requires a valid mailing address.",
      jurisdiction: "casl",
      severity: "blocking",
    });
  }

  if (campaign.unsubscribe_link_included === false) {
    errors.push({
      code: "casl_no_unsubscribe_link",
      message: "Campaign must include an unsubscribe mechanism. CASL requires a functional unsubscribe link.",
      jurisdiction: "casl",
      severity: "blocking",
    });
  }

  return errors;
}

// ─── CAN-SPAM per-recipient checks ────────────────────────────────────────────

function checkCanSpamRecipient(r: any): ComplianceError[] {
  const errors: ComplianceError[] = [];

  if (r.unsubscribe_status === "unsubscribed") {
    errors.push({
      code: "canspam_unsubscribed",
      message: `Recipient ${r.email} has unsubscribed.`,
      jurisdiction: "can_spam",
      severity: "blocking",
    });
  }

  if (r.suppression_status && r.suppression_status !== "none") {
    errors.push({
      code: "canspam_suppressed",
      message: `Recipient ${r.email} is suppressed.`,
      jurisdiction: "can_spam",
      severity: "blocking",
    });
  }

  if (r.email_valid === false) {
    errors.push({
      code: "canspam_invalid_email",
      message: `Recipient ${r.email} has an invalid email address.`,
      jurisdiction: "can_spam",
      severity: "blocking",
    });
  }

  return errors;
}

// ─── CAN-SPAM campaign-level checks ──────────────────────────────────────────

function checkCampaignCanSpam(campaign: any): ComplianceError[] {
  const errors: ComplianceError[] = [];

  if (!campaign.sender_name?.trim()) {
    errors.push({
      code: "canspam_no_sender_identity",
      message: "Campaign must have accurate sender identification. Add sender name.",
      jurisdiction: "can_spam",
      severity: "blocking",
    });
  }

  if (!campaign.physical_mailing_address?.trim()) {
    errors.push({
      code: "canspam_no_physical_address",
      message: "CAN-SPAM requires a valid physical postal address in every commercial email.",
      jurisdiction: "can_spam",
      severity: "blocking",
    });
  }

  if (campaign.unsubscribe_link_included === false) {
    errors.push({
      code: "canspam_no_unsubscribe_link",
      message: "CAN-SPAM requires a clear, conspicuous unsubscribe mechanism in every commercial email.",
      jurisdiction: "can_spam",
      severity: "blocking",
    });
  }

  if (campaign.sending_domain_approved === false) {
    errors.push({
      code: "canspam_unapproved_sending_domain",
      message: "The sending domain has not been approved. CAN-SPAM §15 USC 7704 prohibits deceptive header information and routing.",
      jurisdiction: "can_spam",
      severity: "blocking",
    });
  }

  // CAN-SPAM §15 USC 7704(a)(1): commercial emails must be clearly identified as commercial
  // when cold outreach is involved and no explicit consent on file.
  if (campaign.commercial_disclosure_included === false && campaign.campaign_type === "cold_outreach") {
    errors.push({
      code: "canspam_no_commercial_disclosure",
      message: "CAN-SPAM requires commercial emails to clearly identify themselves as advertisements when no prior consent is established.",
      jurisdiction: "can_spam",
      severity: "blocking",
    });
  }

  // CAN-SPAM §15 USC 7704(a)(2): prohibits deceptive subject lines.
  // If a subject field is blank the email is likely invalid; guard against empty subjects.
  if (campaign.subject !== undefined && !String(campaign.subject ?? "").trim()) {
    errors.push({
      code: "canspam_missing_subject",
      message: "CAN-SPAM prohibits deceptive subject lines. A non-blank, accurate subject is required in every commercial email.",
      jurisdiction: "can_spam",
      severity: "blocking",
    });
  }

  return errors;
}

// ─── Human-readable aggregated recipient error messages ──────────────────────

function recipientErrorMessage(code: string, count: number): string {
  const n = count === 1 ? "1 recipient" : `${count} recipients`;
  switch (code) {
    case "casl_no_consent":
      return `${n} lack valid CASL consent (express or implied).`;
    case "casl_implied_consent_expired":
      return `${n} have expired implied consent under CASL.`;
    case "casl_unsubscribed":
      return `${n} have unsubscribed and cannot receive commercial email under CASL.`;
    case "casl_suppressed":
      return `${n} are on the suppression list and will be blocked.`;
    case "casl_invalid_email":
      return `${n} have invalid email addresses (CASL requires valid contact).`;
    case "canspam_unsubscribed":
      return `${n} have unsubscribed and must be honored within 10 business days under CAN-SPAM.`;
    case "canspam_suppressed":
      return `${n} are suppressed and will be blocked.`;
    case "canspam_invalid_email":
      return `${n} have invalid email addresses.`;
    default:
      return `${n} blocked due to compliance rule: ${code}.`;
  }
}

// ─── Main preflight runner ────────────────────────────────────────────────────

export async function runCampaignPreflight(campaignId: number): Promise<PreflightResult> {
  const campRes = await db.execute(sql.raw(`
    SELECT id, campaign_name, target_jurisdiction, sender_name, sender_legal_entity,
           from_email, sending_domain, sending_domain_approved,
           contact_email, contact_phone, physical_mailing_address,
           unsubscribe_link_included, preference_center_link_included,
           commercial_disclosure_included, compliance_status
    FROM marketing_campaigns WHERE id = ${campaignId}
  `));

  if (!campRes.rows.length) {
    throw Object.assign(new Error("Campaign not found"), { statusCode: 404 });
  }

  const campaign = campRes.rows[0] as any;

  const recipRes = await db.execute(sql.raw(`
    SELECT
      cr.id, cr.email, cr.contact_id,
      c.consent_status, c.implied_consent_expiry_date,
      c.unsubscribe_status, c.suppression_status,
      c.email_valid, c.canada_contact, c.us_contact, c.jurisdiction
    FROM campaign_recipients cr
    LEFT JOIN contacts c ON c.id = cr.contact_id
    WHERE cr.campaign_id = ${campaignId}
      AND cr.status NOT IN ('bounced', 'unsubscribed', 'completed', 'suppressed')
  `));

  const recipients = recipRes.rows as any[];

  const jurisdiction = (campaign.target_jurisdiction || "unknown").toLowerCase();
  const runCasl = jurisdiction === "canada" || jurisdiction === "mixed" || jurisdiction === "unknown";
  const runCanSpam = jurisdiction === "us" || jurisdiction === "mixed" || jurisdiction === "unknown";

  const campaignErrors: ComplianceError[] = [];
  if (runCasl) campaignErrors.push(...checkCampaignCasl(campaign));
  if (runCanSpam) campaignErrors.push(...checkCampaignCanSpam(campaign));

  // Deduplicate campaign-level errors by code
  const seen = new Set<string>();
  const dedupedCampaignErrors = campaignErrors.filter((e) => {
    if (seen.has(e.code)) return false;
    seen.add(e.code);
    return true;
  });

  let canadaCount = 0;
  let usCount = 0;
  let otherCount = 0;
  let blockedCount = 0;
  // Collect per-recipient blocking errors, aggregated by code (not per-email, to avoid PII explosion)
  const recipientErrorCounts: Record<string, number> = {};

  for (const r of recipients) {
    const isCanada = r.canada_contact || r.jurisdiction === "canada";
    const isUs = r.us_contact || r.jurisdiction === "us";

    if (isCanada) canadaCount++;
    else if (isUs) usCount++;
    else otherCount++;

    const recipErrors: ComplianceError[] = [];
    if (isCanada) recipErrors.push(...checkCaslRecipient(r));
    if (isUs || (!isCanada && !isUs)) recipErrors.push(...checkCanSpamRecipient(r));

    const blockingForThisRecip = recipErrors.filter((e) => e.severity === "blocking");
    if (blockingForThisRecip.length > 0) {
      blockedCount++;
      for (const e of blockingForThisRecip) {
        recipientErrorCounts[e.code] = (recipientErrorCounts[e.code] ?? 0) + 1;
      }
    }
  }

  // Build aggregated recipient-level errors with counts (no per-email PII)
  const recipientErrors: ComplianceError[] = Object.entries(recipientErrorCounts).map(([code, count]) => ({
    code,
    message: recipientErrorMessage(code, count),
    jurisdiction: code.startsWith("casl_") ? "casl" : "can_spam",
    severity: "blocking" as const,
  }));

  const allErrors = [...dedupedCampaignErrors, ...recipientErrors];
  const passed = allErrors.filter((e) => e.severity === "blocking").length === 0 && blockedCount === 0;
  const eligibleCount = recipients.length - blockedCount;

  const warnings: string[] = [];
  if (blockedCount > 0) {
    warnings.push(`${blockedCount} recipient${blockedCount !== 1 ? "s" : ""} will be blocked by compliance rules.`);
  }

  return {
    passed,
    errors: allErrors,
    canadaCount,
    usCount,
    otherCount,
    blockedCount,
    eligibleCount,
    totalEnrolled: recipients.length,
    warnings,
  };
}

// ─── Compliant footer builder ─────────────────────────────────────────────────

export interface FooterOptions {
  unsubscribeUrl: string;
  preferencesUrl?: string;
  jurisdiction: string;
  senderName: string | null;
  senderLegalEntity: string | null;
  physicalMailingAddress: string | null;
  contactEmail: string | null;
  commercialDisclosureIncluded: boolean;
}

// Token placeholder — swap per-recipient after building footer template
export const COMPLIANCE_TOKEN_PLACEHOLDER = "__COMPLIANCE_TOKEN__";

export function buildCompliantFooter(opts: FooterOptions): { html: string; text: string } {
  const {
    unsubscribeUrl,
    preferencesUrl,
    jurisdiction,
    senderName,
    senderLegalEntity,
    physicalMailingAddress,
    contactEmail,
    commercialDisclosureIncluded,
  } = opts;

  const displayName = senderLegalEntity || senderName || "VoltSafe";
  const address = physicalMailingAddress || "VoltSafe Marine Technologies";
  const contact = contactEmail || "";

  const isUs = jurisdiction === "us" || jurisdiction === "mixed";
  const isCanada = jurisdiction === "canada" || jurisdiction === "mixed";

  const reason = isCanada
    ? "You are receiving this email because you have an existing business relationship with VoltSafe or have provided consent to receive commercial electronic messages."
    : "You are receiving this email because your marina may be a fit for VoltSafe shore power modernization.";

  let commercialLine = "";
  if (isUs && commercialDisclosureIncluded) {
    commercialLine = `<p style="margin:4px 0;font-size:10px;color:#999;">This is a commercial email message.</p>`;
  }

  const prefLink = preferencesUrl
    ? ` | <a href="${preferencesUrl}" style="color:#aaa;text-decoration:underline;">Manage Preferences</a>`
    : "";

  const html = `
<div style="margin-top:32px;padding-top:12px;border-top:1px solid #e0e0e0;font-size:11px;color:#888;text-align:center;font-family:Arial,sans-serif;">
  ${commercialLine}
  <p style="margin:4px 0;">${reason}</p>
  <p style="margin:4px 0;">${displayName} · ${address}${contact ? ` · ${contact}` : ""}</p>
  <p style="margin:8px 0;">
    <a href="${unsubscribeUrl}" style="color:#aaa;text-decoration:underline;">Unsubscribe</a>${prefLink}
  </p>
</div>`;

  const text = [
    "",
    "---",
    reason,
    `${displayName} · ${address}${contact ? ` · ${contact}` : ""}`,
    `Unsubscribe: ${unsubscribeUrl}`,
    preferencesUrl ? `Manage Preferences: ${preferencesUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { html, text };
}

// ─── HMAC compliance token (30-day TTL) ───────────────────────────────────────

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET must be set and at least 32 characters in production.");
    }
    // Dev-only deterministic fallback — NOT safe for production
    return "dev-compliance-fallback-secret!!";
  }
  return secret;
}

export interface ComplianceTokenPayload {
  email: string;
  contactId: number;
  campaignId?: number;
  exp: number;
}

export function signComplianceToken(
  payload: Omit<ComplianceTokenPayload, "exp">,
  ttlDays = 30
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 86400;
  const data = JSON.stringify({ ...payload, exp });
  const b64 = Buffer.from(data).toString("base64url");
  const sig = crypto
    .createHmac("sha256", getSecret())
    .update(b64)
    .digest("base64url");
  return `${b64}.${sig}`;
}

export function verifyComplianceToken(
  token: string
): ComplianceTokenPayload | null {
  try {
    const dotIdx = token.lastIndexOf(".");
    if (dotIdx < 1) return null;
    const b64 = token.slice(0, dotIdx);
    const sig = token.slice(dotIdx + 1);
    const expected = crypto
      .createHmac("sha256", getSecret())
      .update(b64)
      .digest("base64url");
    const expectedBuf = Buffer.from(expected);
    const sigBuf = Buffer.from(sig);
    if (
      expectedBuf.length !== sigBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, sigBuf)
    )
      return null;
    const payload: ComplianceTokenPayload = JSON.parse(
      Buffer.from(b64, "base64url").toString()
    );
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000))
      return null;
    return payload;
  } catch {
    return null;
  }
}
