/**
 * Campaign Sender Service — Phase 3
 *
 * Handles send-preview, eligibility checking, email personalization,
 * and safe sending (live Gmail or dev-safe mode when no connection exists).
 */

import { db } from "../db";
import { sql, eq } from "drizzle-orm";
import {
  marketingCampaigns,
  campaignEmails,
  campaignRecipients,
  campaignEvents,
  campaignSuppression,
} from "../../shared/schema";

const VOLTSAFE_DOMAINS = ["voltsafe.com", "voltsafe.test"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecipientData {
  id: number;
  contactId: number | null;
  accountId: number | null;
  email: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
  marinaPersona: string | null;
  adoptionStage: string | null;
  primaryPain: string | null;
  accountName: string | null;
  currentStep: number;
  status: string;
}

export interface EligibilityRow extends RecipientData {
  sendStatus: "eligible" | "excluded";
  exclusionReason: string | null;
}

export interface RenderResult {
  subject: string;
  bodyHtml: string;
  bodyText: string;
  unresolvedPlaceholders: string[];
}

export interface SenderInfo {
  mode: "live" | "dev_safe";
  senderEmail: string | null;
  userId: number | null;
  reason: string;
}

export interface SendPreviewResult {
  campaign: { id: number; name: string; status: string };
  step: {
    id: number;
    stepNumber: number;
    subject: string;
    delayDays: number;
    bodyText: string | null;
  };
  eligibleCount: number;
  excludedCount: number;
  exclusionBreakdown: Record<string, number>;
  sampleEligible: EligibilityRow[];
  sampleExcluded: EligibilityRow[];
  subjectPreview: string;
  senderInfo: SenderInfo;
  warnings: string[];
}

export interface SendStepResult {
  attempted_count: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  dev_safe_mode: boolean;
  exclusion_breakdown: Record<string, number>;
  failures: Array<{ email: string; error: string }>;
  campaign_totals: {
    total_recipients: number;
    sent_count: number;
    enrolled_count: number;
  };
}

// ─── Email personalization ────────────────────────────────────────────────────

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

const SAFE_FALLBACKS: Record<string, string> = {
  first_name: "",
  last_name: "",
  contact_name: "",
  email: "",
  role: "",
  account_name: "your marina",
  marina_name: "your marina",
  marina_persona: "",
  adoption_stage: "",
  primary_pain: "",
};

function resolveVar(varName: string, r: RecipientData): string | undefined {
  const parts = (r.name || "").trim().split(/\s+/);
  switch (varName) {
    case "first_name":
      return r.firstName || parts[0] || r.email.split("@")[0] || "";
    case "last_name":
      return r.lastName || parts.slice(1).join(" ") || "";
    case "contact_name":
      return r.name || r.email.split("@")[0] || "";
    case "email":
      return r.email;
    case "role":
      return r.role || "";
    case "account_name":
    case "marina_name":
      return r.accountName || "your marina";
    case "marina_persona":
      return r.marinaPersona || "";
    case "adoption_stage":
      return r.adoptionStage || "";
    case "primary_pain":
      return r.primaryPain || "";
    default:
      return undefined;
  }
}

export interface TrackingConfig {
  pixelUrl: string;
  unsubscribeUrl: string;
  compliantFooterHtml?: string;
  compliantFooterText?: string;
}

export function renderCampaignEmail(
  subject: string,
  bodyHtml: string | null,
  bodyText: string | null,
  recipient: RecipientData,
  tracking?: TrackingConfig
): RenderResult {
  const unresolved: string[] = [];

  const replace = (tmpl: string): string =>
    tmpl.replace(PLACEHOLDER_RE, (_match, varName) => {
      if (varName === "unsubscribe_url") {
        return tracking?.unsubscribeUrl ?? "";
      }
      const val = resolveVar(varName, recipient);
      if (val !== undefined) return val;
      const fallback = SAFE_FALLBACKS[varName];
      if (fallback !== undefined) return fallback;
      if (!unresolved.includes(varName)) unresolved.push(varName);
      return "";
    });

  // Auto-append compliant footer to HTML if template doesn't include it
  let rawHtml = bodyHtml ?? "";
  if (tracking && rawHtml && !rawHtml.includes("{{unsubscribe_url}}")) {
    // Prefer jurisdiction-aware compliant footer if provided, otherwise fall back to minimal footer
    const footer = tracking.compliantFooterHtml ??
      `\n<div style="margin-top:32px;padding-top:12px;border-top:1px solid #e0e0e0;font-size:11px;color:#888;text-align:center;">You are receiving this because your marina may be a fit for VoltSafe shore power modernization.<br><a href="${tracking.unsubscribeUrl}" style="color:#888;">Unsubscribe</a></div>`;
    if (rawHtml.includes("</body>")) {
      rawHtml = rawHtml.replace("</body>", `${footer}</body>`);
    } else {
      rawHtml = rawHtml + footer;
    }
  }

  let renderedHtml = rawHtml ? replace(rawHtml) : "";

  // Inject tracking pixel at end of HTML body
  if (tracking?.pixelUrl && renderedHtml) {
    const pixel = `<img src="${tracking.pixelUrl}" width="1" height="1" alt="" style="display:none;" />`;
    if (renderedHtml.includes("</body>")) {
      renderedHtml = renderedHtml.replace("</body>", `${pixel}</body>`);
    } else {
      renderedHtml = renderedHtml + pixel;
    }
  }

  return {
    subject: replace(subject),
    bodyHtml: renderedHtml,
    bodyText: bodyText ? replace(bodyText) : "",
    unresolvedPlaceholders: unresolved,
  };
}

// ─── Suppression helpers ──────────────────────────────────────────────────────

async function loadSuppression(): Promise<{
  emails: Set<string>;
  domains: Set<string>;
}> {
  const rows = await db
    .select({ email: campaignSuppression.email, domain: campaignSuppression.domain })
    .from(campaignSuppression);
  const emails = new Set<string>();
  const domains = new Set<string>();
  for (const r of rows) {
    if (r.email) emails.add(r.email.toLowerCase().trim());
    if (r.domain) domains.add(r.domain.toLowerCase().trim());
  }
  return { emails, domains };
}

function emailDomain(email: string): string {
  return (email.split("@")[1] || "").toLowerCase();
}

// ─── Eligibility check ────────────────────────────────────────────────────────

export async function checkSendEligibility(
  campaignId: number,
  campaignEmailId: number
): Promise<EligibilityRow[]> {
  const recipRes = await db.execute(sql.raw(`
    SELECT
      cr.id, cr.contact_id, cr.account_id, cr.email, cr.name, cr.role,
      cr.marina_persona, cr.adoption_stage, cr.current_step, cr.status,
      cr.bounced_at, cr.unsubscribed_at,
      c.first_name, c.last_name, c.do_not_email, c.email_bounced, c.email_unsubscribed,
      a.name AS account_name, a.primary_pain
    FROM campaign_recipients cr
    LEFT JOIN contacts c ON c.id = cr.contact_id
    LEFT JOIN accounts a ON a.id = cr.account_id
    WHERE cr.campaign_id = ${campaignId}
      AND cr.status NOT IN ('bounced', 'unsubscribed', 'completed', 'suppressed')
  `));

  const alreadySentRes = await db.execute(sql.raw(`
    SELECT DISTINCT recipient_id
    FROM campaign_events
    WHERE campaign_id = ${campaignId}
      AND event_type = 'sent'
      AND (metadata->>'campaign_email_id')::int = ${campaignEmailId}
  `));
  const alreadySentIds = new Set<number>(
    (alreadySentRes.rows as any[]).map((r) => Number(r.recipient_id)).filter(Boolean)
  );

  const { emails: suppEmails, domains: suppDomains } = await loadSuppression();

  const result: EligibilityRow[] = [];

  for (const raw of recipRes.rows as any[]) {
    const email = (raw.email || "").toLowerCase().trim();

    const data: RecipientData = {
      id: raw.id,
      contactId: raw.contact_id ?? null,
      accountId: raw.account_id ?? null,
      email,
      name: raw.name || "",
      firstName: raw.first_name || null,
      lastName: raw.last_name || null,
      role: raw.role || null,
      marinaPersona: raw.marina_persona || null,
      adoptionStage: raw.adoption_stage || null,
      primaryPain: raw.primary_pain || null,
      accountName: raw.account_name || null,
      currentStep: raw.current_step || 0,
      status: raw.status || "enrolled",
    };

    let exclusionReason: string | null = null;

    if (!email) {
      exclusionReason = "missing_email";
    } else if (!EMAIL_RE.test(email)) {
      exclusionReason = "invalid_email";
    } else if (VOLTSAFE_DOMAINS.some((d) => emailDomain(email) === d)) {
      exclusionReason = "internal_voltsafe_email";
    } else if (raw.do_not_email) {
      exclusionReason = "do_not_email";
    } else if (raw.bounced_at || raw.email_bounced) {
      exclusionReason = "bounced";
    } else if (raw.unsubscribed_at || raw.email_unsubscribed) {
      exclusionReason = "unsubscribed";
    } else if (suppEmails.has(email)) {
      exclusionReason = "suppressed_email";
    } else if (suppDomains.has(emailDomain(email))) {
      exclusionReason = "suppressed_domain";
    } else if (alreadySentIds.has(raw.id)) {
      exclusionReason = "already_sent_step";
    }

    result.push({
      ...data,
      sendStatus: exclusionReason ? "excluded" : "eligible",
      exclusionReason,
    });
  }

  return result;
}

// ─── Sender info ──────────────────────────────────────────────────────────────

export async function getSenderInfo(userId: number): Promise<SenderInfo> {
  try {
    const { isGmailConnected, getGmailClient } = await import("../gmail-oauth");
    const status = await isGmailConnected(userId);
    if (status.connected && status.tokenValid) {
      let senderEmail: string | null = null;
      try {
        const gmail = await getGmailClient(userId, undefined);
        const profile = await gmail.users.getProfile({ userId: "me" });
        senderEmail = profile.data.emailAddress ?? null;
      } catch { /* non-critical */ }
      return {
        mode: "live",
        senderEmail,
        userId,
        reason: "Active Gmail connection found",
      };
    }
  } catch { /* no gmail-oauth */ }

  return {
    mode: "dev_safe",
    senderEmail: null,
    userId: null,
    reason:
      "No active Gmail connection for this user — events will be recorded but emails will not be sent",
  };
}

// ─── Build send preview ───────────────────────────────────────────────────────

export async function buildSendPreview(
  campaignId: number,
  campaignEmailId: number,
  userId: number
): Promise<SendPreviewResult> {
  const [campaign] = await db
    .select({
      id: marketingCampaigns.id,
      name: marketingCampaigns.campaignName,
      status: marketingCampaigns.status,
    })
    .from(marketingCampaigns)
    .where(eq(marketingCampaigns.id, campaignId));

  if (!campaign) throw Object.assign(new Error("Campaign not found"), { statusCode: 404 });
  if (campaign.status === "archived")
    throw Object.assign(new Error("Campaign is archived"), { statusCode: 409 });

  const [step] = await db
    .select()
    .from(campaignEmails)
    .where(eq(campaignEmails.id, campaignEmailId));
  if (!step)
    throw Object.assign(new Error("Email step not found"), { statusCode: 404 });
  if (step.campaignId !== campaignId)
    throw Object.assign(new Error("Step does not belong to this campaign"), { statusCode: 400 });
  if (!step.subject?.trim())
    throw Object.assign(new Error("Email step has no subject"), { statusCode: 422 });

  const eligibility = await checkSendEligibility(campaignId, campaignEmailId);
  const eligible = eligibility.filter((r) => r.sendStatus === "eligible");
  const excluded = eligibility.filter((r) => r.sendStatus === "excluded");

  const breakdown: Record<string, number> = {};
  for (const r of excluded) {
    const k = r.exclusionReason || "unknown";
    breakdown[k] = (breakdown[k] || 0) + 1;
  }

  const warnings: string[] = [];
  // Render a subject preview — use a real recipient if available, otherwise use fallback values
  const previewRecipient: RecipientData = eligible.length > 0
    ? eligible[0]
    : {
        id: 0,
        contactId: null,
        accountId: null,
        email: "preview@example.com",
        name: "Sample Contact",
        firstName: "Sample",
        lastName: "Contact",
        role: null,
        marinaPersona: null,
        adoptionStage: null,
        primaryPain: null,
        accountName: "your marina",
        currentStep: 1,
        status: "enrolled",
      };

  const rendered = renderCampaignEmail(
    step.subject,
    step.bodyHtml,
    step.bodyText,
    previewRecipient
  );
  let subjectPreview = rendered.subject;
  if (rendered.unresolvedPlaceholders.length > 0) {
    warnings.push(
      `Unresolved placeholders detected: ${rendered.unresolvedPlaceholders.map((p) => `{{${p}}}`).join(", ")}`
    );
  }

  if (!step.bodyHtml?.trim() && !step.bodyText?.trim()) {
    warnings.push("Email step has no body content — add a body before sending.");
  }

  const senderInfo = await getSenderInfo(userId);
  if (senderInfo.mode === "dev_safe") {
    warnings.push(
      "Dev-safe mode: this environment has no active Gmail connection. Send events will be recorded but no real emails will be delivered."
    );
  }

  warnings.push(
    "Recipients are re-checked against suppression and internal email rules immediately before sending."
  );

  return {
    campaign: { id: campaign.id, name: campaign.name, status: campaign.status },
    step: {
      id: step.id,
      stepNumber: step.stepNumber,
      subject: step.subject,
      delayDays: step.delayDays,
      bodyText: step.bodyText,
    },
    eligibleCount: eligible.length,
    excludedCount: excluded.length,
    exclusionBreakdown: breakdown,
    sampleEligible: eligible.slice(0, 10),
    sampleExcluded: excluded.slice(0, 10),
    subjectPreview,
    senderInfo,
    warnings,
  };
}

// ─── Execute send step ────────────────────────────────────────────────────────

export async function executeSendStep(
  campaignId: number,
  campaignEmailId: number,
  userId: number,
  baseUrl?: string
): Promise<SendStepResult> {
  const [campaign] = await db
    .select({
      id: marketingCampaigns.id,
      status: marketingCampaigns.status,
      sentCount: marketingCampaigns.sentCount,
      targetJurisdiction: (marketingCampaigns as any).targetJurisdiction,
      senderName: (marketingCampaigns as any).senderName,
      senderLegalEntity: (marketingCampaigns as any).senderLegalEntity,
      physicalMailingAddress: (marketingCampaigns as any).physicalMailingAddress,
      contactEmail: (marketingCampaigns as any).contactEmail,
      commercialDisclosureIncluded: (marketingCampaigns as any).commercialDisclosureIncluded,
    })
    .from(marketingCampaigns)
    .where(eq(marketingCampaigns.id, campaignId));

  if (!campaign)
    throw Object.assign(new Error("Campaign not found"), { statusCode: 404 });
  if (campaign.status === "archived" || campaign.status === "completed")
    throw Object.assign(
      new Error(`Cannot send for a ${campaign.status} campaign`),
      { statusCode: 409 }
    );

  const [step] = await db
    .select()
    .from(campaignEmails)
    .where(eq(campaignEmails.id, campaignEmailId));
  if (!step)
    throw Object.assign(new Error("Email step not found"), { statusCode: 404 });
  if (step.campaignId !== campaignId)
    throw Object.assign(new Error("Step does not belong to this campaign"), { statusCode: 400 });
  if (!step.subject?.trim())
    throw Object.assign(new Error("Email step has no subject"), { statusCode: 422 });
  if (!step.bodyHtml?.trim() && !step.bodyText?.trim())
    throw Object.assign(new Error("Email step has no body content"), { statusCode: 422 });

  const eligibility = await checkSendEligibility(campaignId, campaignEmailId);
  const eligible = eligibility.filter((r) => r.sendStatus === "eligible");
  const excluded = eligibility.filter((r) => r.sendStatus === "excluded");

  if (eligible.length === 0)
    throw Object.assign(
      new Error("No eligible recipients for this step — all are excluded or already sent"),
      { statusCode: 422 }
    );

  const exclusionBreakdown: Record<string, number> = {};
  for (const r of excluded) {
    const k = r.exclusionReason || "unknown";
    exclusionBreakdown[k] = (exclusionBreakdown[k] || 0) + 1;
  }

  for (const r of excluded) {
    try {
      await db.insert(campaignEvents).values({
        campaignId,
        recipientId: r.id,
        contactId: r.contactId,
        accountId: r.accountId,
        eventType: "skipped_at_send",
        metadata: {
          campaign_email_id: campaignEmailId,
          step_number: step.stepNumber,
          exclusion_reason: r.exclusionReason,
        },
      } as any);

      if (r.exclusionReason === "suppressed_email" || r.exclusionReason === "suppressed_domain") {
        await db
          .update(campaignRecipients)
          .set({ status: "suppressed", updatedAt: new Date() })
          .where(eq(campaignRecipients.id, r.id));
      }
    } catch { /* non-critical */ }
  }

  const senderInfo = await getSenderInfo(userId);
  const now = new Date();
  let sentCount = 0;
  let failedCount = 0;
  const failures: Array<{ email: string; error: string }> = [];

  const maxStepRes = await db.execute(sql.raw(`
    SELECT MAX(step_number) AS max_step FROM campaign_emails WHERE campaign_id = ${campaignId}
  `));
  const maxStep = Number((maxStepRes.rows[0] as any)?.max_step ?? 1);
  const isLastStep = step.stepNumber >= maxStep;

  const effectiveBaseUrl = baseUrl || "http://localhost:5000";

  // Build jurisdiction-aware compliant footer once per campaign send (outside per-recipient loop)
  let campaignCompliantFooterHtml: string | undefined;
  let campaignCompliantFooterText: string | undefined;
  try {
    const { buildCompliantFooter } = await import("./compliance-preflight");
    const preferencesUrl = `${effectiveBaseUrl}/preferences`;
    const footerResult = buildCompliantFooter({
      unsubscribeUrl: `${effectiveBaseUrl}/unsubscribe/__UNSUB_TOKEN__`,
      preferencesUrl,
      jurisdiction: (campaign as any).targetJurisdiction ?? "unknown",
      senderName: (campaign as any).senderName ?? null,
      senderLegalEntity: (campaign as any).senderLegalEntity ?? null,
      physicalMailingAddress: (campaign as any).physicalMailingAddress ?? null,
      contactEmail: (campaign as any).contactEmail ?? null,
      commercialDisclosureIncluded: (campaign as any).commercialDisclosureIncluded ?? false,
    });
    // Template marker is swapped per-recipient with real unsubscribe URL
    campaignCompliantFooterHtml = footerResult.html;
    campaignCompliantFooterText = footerResult.text;
  } catch { /* non-critical — fall back to minimal footer in renderCampaignEmail */ }

  for (const r of eligible) {
    // Generate (or retrieve) unsubscribe token — idempotent
    let unsubscribeToken = "";
    try {
      const { ensureUnsubscribeToken } = await import("./campaign-tracking");
      unsubscribeToken = await ensureUnsubscribeToken(r.id);
    } catch { /* non-critical — send will still proceed */ }

    // Swap the template marker with this recipient's real unsubscribe URL
    const recipUnsubUrl = unsubscribeToken
      ? `${effectiveBaseUrl}/unsubscribe/${unsubscribeToken}`
      : `${effectiveBaseUrl}/unsubscribe/`;
    const recipFooterHtml = campaignCompliantFooterHtml?.replace(
      "__UNSUB_TOKEN__",
      unsubscribeToken || ""
    ).replace(
      `${effectiveBaseUrl}/unsubscribe/__UNSUB_TOKEN__`,
      recipUnsubUrl
    );
    const recipFooterText = campaignCompliantFooterText?.replace(
      "__UNSUB_TOKEN__",
      unsubscribeToken || ""
    ).replace(
      `${effectiveBaseUrl}/unsubscribe/__UNSUB_TOKEN__`,
      recipUnsubUrl
    );

    const tracking = unsubscribeToken
      ? {
          pixelUrl: `${effectiveBaseUrl}/api/marketing/track/open/${unsubscribeToken}.gif`,
          unsubscribeUrl: recipUnsubUrl,
          compliantFooterHtml: recipFooterHtml,
          compliantFooterText: recipFooterText,
        }
      : undefined;

    const rendered = renderCampaignEmail(
      step.subject,
      step.bodyHtml,
      step.bodyText,
      r,
      tracking
    );

    // Rewrite links through click tracker (non-critical — original HTML used as fallback)
    if (unsubscribeToken && rendered.bodyHtml) {
      try {
        const { createTrackedLinks } = await import("./campaign-tracking");
        rendered.bodyHtml = await createTrackedLinks(
          campaignId,
          campaignEmailId,
          r.id,
          rendered.bodyHtml,
          effectiveBaseUrl
        );
      } catch { /* non-critical */ }
    }

    if (rendered.unresolvedPlaceholders.length > 0) {
      const errMsg = `Unresolved placeholders: ${rendered.unresolvedPlaceholders.map((p) => `{{${p}}}`).join(", ")}`;
      failedCount++;
      failures.push({ email: r.email, error: errMsg });
      try {
        await db.insert(campaignEvents).values({
          campaignId,
          recipientId: r.id,
          contactId: r.contactId,
          accountId: r.accountId,
          eventType: "send_failed",
          metadata: {
            campaign_email_id: campaignEmailId,
            step_number: step.stepNumber,
            error: errMsg,
          },
        } as any);
      } catch { /* non-critical */ }
      continue;
    }

    try {
      await db.insert(campaignEvents).values({
        campaignId,
        recipientId: r.id,
        contactId: r.contactId,
        accountId: r.accountId,
        eventType: "send_attempted",
        metadata: {
          campaign_email_id: campaignEmailId,
          step_number: step.stepNumber,
          subject: rendered.subject,
          dev_safe: senderInfo.mode === "dev_safe",
        },
      } as any);
    } catch { /* non-critical */ }

    let sendOk = false;
    let errorMsg: string | null = null;

    if (senderInfo.mode === "live" && senderInfo.userId) {
      try {
        const { sendEmail } = await import("../gmail");
        const body = rendered.bodyHtml || `<p>${rendered.bodyText}</p>`;
        await sendEmail(senderInfo.userId, r.email, rendered.subject, body);
        sendOk = true;
      } catch (err: any) {
        errorMsg = err?.message ?? "Send failed";
      }
    } else {
      sendOk = true;
    }

    if (sendOk) {
      sentCount++;
      try {
        await db.insert(campaignEvents).values({
          campaignId,
          recipientId: r.id,
          contactId: r.contactId,
          accountId: r.accountId,
          eventType: "sent",
          metadata: {
            campaign_email_id: campaignEmailId,
            step_number: step.stepNumber,
            subject: rendered.subject,
            dev_safe: senderInfo.mode === "dev_safe",
          },
        } as any);
      } catch { /* non-critical */ }

      const newStatus = isLastStep ? "completed" : "in_sequence";
      try {
        await db
          .update(campaignRecipients)
          .set({
            currentStep: step.stepNumber + 1,
            status: newStatus,
            lastSentAt: now,
            updatedAt: now,
          })
          .where(eq(campaignRecipients.id, r.id));
      } catch { /* non-critical */ }
    } else {
      failedCount++;
      if (errorMsg) failures.push({ email: r.email, error: errorMsg });
      try {
        await db.insert(campaignEvents).values({
          campaignId,
          recipientId: r.id,
          contactId: r.contactId,
          accountId: r.accountId,
          eventType: "send_failed",
          metadata: {
            campaign_email_id: campaignEmailId,
            step_number: step.stepNumber,
            safe_error_message: errorMsg || "Unknown error",
          },
        } as any);
        await db
          .update(campaignRecipients)
          .set({ status: "failed", updatedAt: now })
          .where(eq(campaignRecipients.id, r.id));
      } catch { /* non-critical */ }
    }
  }

  if (sentCount > 0) {
    try {
      await db
        .update(marketingCampaigns)
        .set({
          sentCount: (campaign.sentCount ?? 0) + sentCount,
          updatedAt: now,
        })
        .where(eq(marketingCampaigns.id, campaignId));

      await db.insert(campaignEvents).values({
        campaignId,
        eventType: "step_completed",
        metadata: {
          campaign_email_id: campaignEmailId,
          step_number: step.stepNumber,
          sent_count: sentCount,
          failed_count: failedCount,
          skipped_count: excluded.length,
          dev_safe: senderInfo.mode === "dev_safe",
        },
      } as any);
    } catch { /* non-critical */ }
  }

  const totalsRes = await db.execute(sql.raw(`
    SELECT
      COUNT(*)::int AS total_recipients,
      COUNT(*) FILTER (WHERE status IN ('sent','in_sequence','completed'))::int AS sent_count,
      COUNT(*) FILTER (WHERE status = 'enrolled')::int AS enrolled_count
    FROM campaign_recipients
    WHERE campaign_id = ${campaignId}
  `));
  const totals = (totalsRes.rows[0] as any) ?? {};

  return {
    attempted_count: eligible.length,
    sent_count: sentCount,
    failed_count: failedCount,
    skipped_count: excluded.length,
    dev_safe_mode: senderInfo.mode === "dev_safe",
    exclusion_breakdown: exclusionBreakdown,
    failures,
    campaign_totals: {
      total_recipients: totals.total_recipients ?? 0,
      sent_count: totals.sent_count ?? 0,
      enrolled_count: totals.enrolled_count ?? 0,
    },
  };
}
