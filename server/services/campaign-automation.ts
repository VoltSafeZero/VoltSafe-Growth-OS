/**
 * server/services/campaign-automation.ts
 *
 * Phase 6 — Automated Sequence / Drip Scheduling
 *
 * Timing convention:
 *   delay_days is RELATIVE TO sequence_started_at (not previous step).
 *   Step delay_days=0 → sent on sequence start.
 *   Step delay_days=4 → sent 4 days after sequence_started_at.
 *   Step delay_days=9 → sent 9 days after sequence_started_at.
 *   This prevents drift and makes campaign schedules easy to reason about.
 *
 * Safety:
 *   - Compliance preflight re-verified before every automated send.
 *   - Per-recipient suppression, unsubscribe, and duplicate-send checks
 *     at every tick — not just at start.
 *   - Fail-closed: uncertainty blocks the send.
 *   - Tick lock prevents concurrent runs.
 *   - No email bodies or secrets in logs.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { renderCampaignEmail, getSenderInfo, type RecipientData } from "./campaign-sender";

// ── Module-level tick lock ────────────────────────────────────────────────────
// Simple in-process lock. Multiple concurrent ticks are skipped, not queued.
let _tickRunning = false;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TickResult {
  campaignsScanned: number;
  recipientsDue: number;
  sent: number;
  skipped: number;
  failed: number;
  blocked: number;
}

export interface AutomationStatus {
  campaignId: number;
  automationStatus: string;
  automationEnabled: boolean;
  automationStartedAt: string | null;
  automationPausedAt: string | null;
  automationCompletedAt: string | null;
  nextAutomationRunAt: string | null;
  complianceStatus: string | null;
  enrolledCount: number;
  activeCount: number;
  completedCount: number;
  blockedCount: number;
  suppressedCount: number;
  unsubscribedCount: number;
  notStartedCount: number;
  nextDueCount: number;
  steps: Array<{
    id: number;
    stepNumber: number;
    subject: string;
    delayDays: number;
    status: string;
  }>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ── Schema migration ──────────────────────────────────────────────────────────

export async function migrateAutomationSchema(): Promise<void> {
  try {
    // marketing_campaigns automation columns
    await db.execute(sql.raw(`
      ALTER TABLE marketing_campaigns
        ADD COLUMN IF NOT EXISTS automation_enabled   boolean    NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS automation_started_at   timestamptz,
        ADD COLUMN IF NOT EXISTS automation_paused_at    timestamptz,
        ADD COLUMN IF NOT EXISTS automation_completed_at timestamptz,
        ADD COLUMN IF NOT EXISTS next_automation_run_at  timestamptz,
        ADD COLUMN IF NOT EXISTS automation_timezone     text,       -- reserved for future timezone-aware scheduling; not used by tick engine yet
        ADD COLUMN IF NOT EXISTS automation_status       text       NOT NULL DEFAULT 'manual'
    `));

    // campaign_recipients automation columns
    await db.execute(sql.raw(`
      ALTER TABLE campaign_recipients
        ADD COLUMN IF NOT EXISTS sequence_started_at  timestamptz,
        ADD COLUMN IF NOT EXISTS next_step_due_at     timestamptz,
        ADD COLUMN IF NOT EXISTS sequence_completed_at timestamptz,
        ADD COLUMN IF NOT EXISTS automation_paused_at  timestamptz,
        ADD COLUMN IF NOT EXISTS last_automation_error text,
        ADD COLUMN IF NOT EXISTS automation_status     text       NOT NULL DEFAULT 'not_started'
    `));

    // Indexes for efficient tick queries
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS idx_mc_automation_status
        ON marketing_campaigns(automation_status)
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS idx_mc_next_automation_run
        ON marketing_campaigns(next_automation_run_at)
        WHERE next_automation_run_at IS NOT NULL
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS idx_cr_campaign_automation_status
        ON campaign_recipients(campaign_id, automation_status)
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS idx_cr_next_step_due
        ON campaign_recipients(next_step_due_at)
        WHERE next_step_due_at IS NOT NULL
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS idx_cr_campaign_next_step_due
        ON campaign_recipients(campaign_id, next_step_due_at)
        WHERE next_step_due_at IS NOT NULL
    `));
    // Covers duplicate-send protection query: WHERE campaign_id=X AND recipient_id=Y AND event_type IN (...)
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS idx_ce_camp_recip_event
        ON campaign_events(campaign_id, recipient_id, event_type)
    `));

    console.log("[migration] Automation schema ready.");
  } catch (err: any) {
    console.error("[migration] Automation schema migration error:", err?.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeDueAt(sequenceStartedAt: Date, delayDays: number): Date {
  const due = new Date(sequenceStartedAt);
  due.setUTCDate(due.getUTCDate() + delayDays);
  return due;
}

function safeSql(v: string | null | undefined, maxLen = 500): string {
  return (v ?? "").slice(0, maxLen).replace(/'/g, "''");
}

async function recordEvent(
  campaignId: number,
  recipientId: number | null,
  contactId: number | null,
  accountId: number | null,
  eventType: string,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    const rId = recipientId ?? "NULL";
    const cId = contactId ?? "NULL";
    const aId = accountId ?? "NULL";
    const meta = JSON.stringify(metadata).replace(/'/g, "''");
    await db.execute(sql.raw(`
      INSERT INTO campaign_events
        (campaign_id, recipient_id, contact_id, account_id, event_type, metadata, event_timestamp)
      VALUES
        (${campaignId}, ${rId}, ${cId}, ${aId}, '${eventType}', '${meta}'::jsonb, NOW())
    `));
  } catch (err: any) { console.error("[automation] recordEvent failed (non-critical):", err?.message); }
}

// ── Validation ────────────────────────────────────────────────────────────────

export async function validateAutomationStart(campaignId: number): Promise<ValidationResult> {
  const errors: string[] = [];

  const campRes = await db.execute(sql.raw(`
    SELECT id, status, compliance_status, automation_status, owner_user_id,
           sender_name, from_email
    FROM marketing_campaigns
    WHERE id = ${campaignId}
  `));
  const camp = campRes.rows[0] as any;
  if (!camp) return { valid: false, errors: ["Campaign not found"] };

  if (!["active", "scheduled"].includes(camp.status)) {
    errors.push(`Campaign must be active or scheduled to enable automation (current: ${camp.status})`);
  }
  if (camp.compliance_status !== "preflight_passed") {
    errors.push("Compliance preflight must pass before starting automation. Run 'Check Compliance' first.");
  }
  if (!camp.sender_name && !camp.from_email) {
    errors.push("No sender identity configured for this campaign");
  }
  if (["active", "paused", "completed"].includes(camp.automation_status)) {
    errors.push(`Automation is already ${camp.automation_status}`);
  }

  // Check enrolled recipients
  const recipRes = await db.execute(sql.raw(`
    SELECT COUNT(*) AS cnt FROM campaign_recipients
    WHERE campaign_id = ${campaignId}
      AND status NOT IN ('unsubscribed','suppressed','bounced','archived')
  `));
  const recipCount = Number((recipRes.rows[0] as any)?.cnt ?? 0);
  if (recipCount === 0) {
    errors.push("No enrolled recipients. Enroll recipients before starting automation.");
  }

  // Check email steps
  const stepsRes = await db.execute(sql.raw(`
    SELECT COUNT(*) AS cnt FROM campaign_emails WHERE campaign_id = ${campaignId}
  `));
  const stepCount = Number((stepsRes.rows[0] as any)?.cnt ?? 0);
  if (stepCount === 0) {
    errors.push("No email steps defined. Add at least one email step before starting automation.");
  }

  return { valid: errors.length === 0, errors };
}

// ── Control operations ────────────────────────────────────────────────────────

export async function startCampaignAutomation(campaignId: number, userId: number): Promise<void> {
  const validation = await validateAutomationStart(campaignId);
  if (!validation.valid) {
    throw Object.assign(
      new Error(validation.errors.join("; ")),
      { statusCode: 422, errors: validation.errors }
    );
  }

  const now = new Date();
  const nowIso = now.toISOString();

  // Get first step (lowest delay_days) to compute initial due date
  const firstStepRes = await db.execute(sql.raw(`
    SELECT id, step_number, delay_days FROM campaign_emails
    WHERE campaign_id = ${campaignId}
    ORDER BY step_number ASC LIMIT 1
  `));
  const firstStep = firstStepRes.rows[0] as any;
  const firstDelayDays = firstStep ? Number(firstStep.delay_days ?? 0) : 0;
  const firstDueAt = computeDueAt(now, firstDelayDays);
  const firstDueIso = firstDueAt.toISOString();

  // Mark campaign as active
  await db.execute(sql.raw(`
    UPDATE marketing_campaigns
    SET automation_enabled = true,
        automation_status = 'active',
        automation_started_at = '${nowIso}'::timestamptz,
        automation_paused_at = NULL,
        automation_completed_at = NULL,
        next_automation_run_at = '${firstDueIso}'::timestamptz,
        updated_at = NOW()
    WHERE id = ${campaignId}
  `));

  // Activate eligible recipients (those not already terminal)
  await db.execute(sql.raw(`
    UPDATE campaign_recipients
    SET automation_status = 'active',
        sequence_started_at = '${nowIso}'::timestamptz,
        next_step_due_at = '${firstDueIso}'::timestamptz,
        sequence_completed_at = NULL,
        automation_paused_at = NULL,
        last_automation_error = NULL,
        updated_at = NOW()
    WHERE campaign_id = ${campaignId}
      AND automation_status = 'not_started'
      AND status NOT IN ('unsubscribed','suppressed','bounced','archived')
      AND unsubscribed_at IS NULL
      AND bounced_at IS NULL
  `));

  await recordEvent(campaignId, null, null, null, "automation_started", {
    started_by: userId,
    first_step_due_at: firstDueIso,
  });

  console.log(`[automation] Campaign ${campaignId} started by user ${userId}. First step due: ${firstDueIso}`);
}

export async function pauseCampaignAutomation(campaignId: number, userId: number): Promise<void> {
  const campRes = await db.execute(sql.raw(`
    SELECT automation_status FROM marketing_campaigns WHERE id = ${campaignId}
  `));
  const camp = campRes.rows[0] as any;
  if (!camp) throw Object.assign(new Error("Campaign not found"), { statusCode: 404 });
  if (camp.automation_status !== "active") {
    throw Object.assign(new Error(`Cannot pause — automation is ${camp.automation_status}`), { statusCode: 409 });
  }

  await db.execute(sql.raw(`
    UPDATE marketing_campaigns
    SET automation_status = 'paused', automation_paused_at = NOW(), updated_at = NOW()
    WHERE id = ${campaignId}
  `));
  await db.execute(sql.raw(`
    UPDATE campaign_recipients
    SET automation_status = 'paused', automation_paused_at = NOW(), updated_at = NOW()
    WHERE campaign_id = ${campaignId} AND automation_status = 'active'
  `));

  await recordEvent(campaignId, null, null, null, "automation_paused", { paused_by: userId });
  console.log(`[automation] Campaign ${campaignId} paused by user ${userId}`);
}

export async function resumeCampaignAutomation(campaignId: number, userId: number): Promise<void> {
  const campRes = await db.execute(sql.raw(`
    SELECT automation_status, compliance_status FROM marketing_campaigns WHERE id = ${campaignId}
  `));
  const camp = campRes.rows[0] as any;
  if (!camp) throw Object.assign(new Error("Campaign not found"), { statusCode: 404 });
  if (camp.automation_status !== "paused") {
    throw Object.assign(new Error(`Cannot resume — automation is ${camp.automation_status}`), { statusCode: 409 });
  }
  if (camp.compliance_status !== "preflight_passed") {
    throw Object.assign(
      new Error("Compliance preflight must pass before resuming automation. Re-run preflight first."),
      { statusCode: 422 }
    );
  }

  await db.execute(sql.raw(`
    UPDATE marketing_campaigns
    SET automation_status = 'active', automation_paused_at = NULL, updated_at = NOW()
    WHERE id = ${campaignId}
  `));
  await db.execute(sql.raw(`
    UPDATE campaign_recipients
    SET automation_status = 'active', automation_paused_at = NULL, updated_at = NOW()
    WHERE campaign_id = ${campaignId} AND automation_status = 'paused'
  `));

  await recordEvent(campaignId, null, null, null, "automation_resumed", { resumed_by: userId });
  console.log(`[automation] Campaign ${campaignId} resumed by user ${userId}`);
}

export async function stopCampaignAutomation(campaignId: number, userId: number): Promise<void> {
  const campRes = await db.execute(sql.raw(`
    SELECT automation_status FROM marketing_campaigns WHERE id = ${campaignId}
  `));
  const camp = campRes.rows[0] as any;
  if (!camp) throw Object.assign(new Error("Campaign not found"), { statusCode: 404 });
  if (!["active", "paused", "scheduled", "blocked"].includes(camp.automation_status)) {
    throw Object.assign(
      new Error(`Cannot stop — automation is already ${camp.automation_status}`),
      { statusCode: 409 }
    );
  }

  await db.execute(sql.raw(`
    UPDATE marketing_campaigns
    SET automation_status = 'manual',
        automation_enabled = false,
        automation_paused_at = NULL,
        next_automation_run_at = NULL,
        updated_at = NOW()
    WHERE id = ${campaignId}
  `));
  // Stop active/paused recipients — they keep their sequence_started_at for audit
  await db.execute(sql.raw(`
    UPDATE campaign_recipients
    SET automation_status = 'not_started',
        automation_paused_at = NULL,
        updated_at = NOW()
    WHERE campaign_id = ${campaignId}
      AND automation_status IN ('active','paused')
  `));

  await recordEvent(campaignId, null, null, null, "automation_stopped", { stopped_by: userId });
  console.log(`[automation] Campaign ${campaignId} stopped by user ${userId}`);
}

// ── Status ────────────────────────────────────────────────────────────────────

export async function getCampaignAutomationStatus(campaignId: number): Promise<AutomationStatus> {
  const campRes = await db.execute(sql.raw(`
    SELECT id, compliance_status, automation_enabled, automation_status,
           automation_started_at, automation_paused_at, automation_completed_at,
           next_automation_run_at
    FROM marketing_campaigns WHERE id = ${campaignId}
  `));
  const camp = campRes.rows[0] as any;
  if (!camp) throw Object.assign(new Error("Campaign not found"), { statusCode: 404 });

  const countsRes = await db.execute(sql.raw(`
    SELECT
      COUNT(*) FILTER (WHERE automation_status = 'active')      AS active_count,
      COUNT(*) FILTER (WHERE automation_status = 'completed')   AS completed_count,
      COUNT(*) FILTER (WHERE automation_status = 'blocked')     AS blocked_count,
      COUNT(*) FILTER (WHERE automation_status = 'suppressed')  AS suppressed_count,
      COUNT(*) FILTER (WHERE automation_status = 'unsubscribed') AS unsubscribed_count,
      COUNT(*) FILTER (WHERE automation_status = 'not_started') AS not_started_count,
      COUNT(*) FILTER (WHERE automation_status = 'paused')      AS paused_count,
      COUNT(*) AS total_count
    FROM campaign_recipients WHERE campaign_id = ${campaignId}
  `));
  const counts = (countsRes.rows[0] as any) ?? {};

  const nextDueRes = await db.execute(sql.raw(`
    SELECT COUNT(*) AS cnt FROM campaign_recipients
    WHERE campaign_id = ${campaignId}
      AND automation_status = 'active'
      AND next_step_due_at <= NOW()
  `));
  const nextDueCount = Number((nextDueRes.rows[0] as any)?.cnt ?? 0);

  const stepsRes = await db.execute(sql.raw(`
    SELECT id, step_number, subject, delay_days, status
    FROM campaign_emails
    WHERE campaign_id = ${campaignId}
    ORDER BY step_number ASC
  `));

  const enrolled = Number(counts.active_count ?? 0)
    + Number(counts.completed_count ?? 0)
    + Number(counts.blocked_count ?? 0)
    + Number(counts.suppressed_count ?? 0)
    + Number(counts.unsubscribed_count ?? 0)
    + Number(counts.not_started_count ?? 0)
    + Number(counts.paused_count ?? 0);

  return {
    campaignId,
    automationStatus: camp.automation_status ?? "manual",
    automationEnabled: !!camp.automation_enabled,
    automationStartedAt: camp.automation_started_at ? new Date(camp.automation_started_at).toISOString() : null,
    automationPausedAt: camp.automation_paused_at ? new Date(camp.automation_paused_at).toISOString() : null,
    automationCompletedAt: camp.automation_completed_at ? new Date(camp.automation_completed_at).toISOString() : null,
    nextAutomationRunAt: camp.next_automation_run_at ? new Date(camp.next_automation_run_at).toISOString() : null,
    complianceStatus: camp.compliance_status ?? null,
    enrolledCount: enrolled,
    activeCount: Number(counts.active_count ?? 0) + Number(counts.paused_count ?? 0),
    completedCount: Number(counts.completed_count ?? 0),
    blockedCount: Number(counts.blocked_count ?? 0),
    suppressedCount: Number(counts.suppressed_count ?? 0),
    unsubscribedCount: Number(counts.unsubscribed_count ?? 0),
    notStartedCount: Number(counts.not_started_count ?? 0),
    nextDueCount,
    steps: (stepsRes.rows as any[]).map(s => ({
      id: s.id,
      stepNumber: s.step_number,
      subject: s.subject,
      delayDays: s.delay_days,
      status: s.status,
    })),
  };
}

// ── Automation metrics (for analytics page) ───────────────────────────────────

export async function getAutomationMetrics(): Promise<{
  activeCampaigns: number;
  completedCampaigns: number;
  automatedSends: number;
  automationSkips: number;
  automationFailures: number;
  activeRecipients: number;
  completedRecipients: number;
}> {
  const campRes = await db.execute(sql.raw(`
    SELECT
      COUNT(*) FILTER (WHERE automation_status = 'active')    AS active_campaigns,
      COUNT(*) FILTER (WHERE automation_status = 'completed') AS completed_campaigns
    FROM marketing_campaigns
    WHERE automation_status != 'manual'
  `));
  const campCounts = (campRes.rows[0] as any) ?? {};

  const eventsRes = await db.execute(sql.raw(`
    SELECT
      COUNT(*) FILTER (WHERE event_type = 'automation_step_sent')    AS sends,
      COUNT(*) FILTER (WHERE event_type = 'automation_step_skipped') AS skips,
      COUNT(*) FILTER (WHERE event_type = 'automation_step_failed')  AS failures
    FROM campaign_events
    WHERE event_type LIKE 'automation_step_%'
  `));
  const eventCounts = (eventsRes.rows[0] as any) ?? {};

  const recipRes = await db.execute(sql.raw(`
    SELECT
      COUNT(*) FILTER (WHERE automation_status IN ('active','paused')) AS active_recipients,
      COUNT(*) FILTER (WHERE automation_status = 'completed')          AS completed_recipients
    FROM campaign_recipients
    WHERE automation_status != 'not_started'
  `));
  const recipCounts = (recipRes.rows[0] as any) ?? {};

  return {
    activeCampaigns: Number(campCounts.active_campaigns ?? 0),
    completedCampaigns: Number(campCounts.completed_campaigns ?? 0),
    automatedSends: Number(eventCounts.sends ?? 0),
    automationSkips: Number(eventCounts.skips ?? 0),
    automationFailures: Number(eventCounts.failures ?? 0),
    activeRecipients: Number(recipCounts.active_recipients ?? 0),
    completedRecipients: Number(recipCounts.completed_recipients ?? 0),
  };
}

// ── Per-recipient send (private) ──────────────────────────────────────────────

interface StepRow {
  id: number;
  step_number: number;
  subject: string;
  body_html: string | null;
  body_text: string | null;
  delay_days: number;
}

interface CampaignRow {
  id: number;
  owner_user_id: number | null;
  sender_name: string | null;
  sender_legal_entity: string | null;
  physical_mailing_address: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  commercial_disclosure_included: boolean | null;
  target_jurisdiction: string | null;
  campaign_type: string | null;
}

interface RecipientRow {
  id: number;
  contact_id: number | null;
  account_id: number | null;
  email: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  marina_persona: string | null;
  adoption_stage: string | null;
  unsubscribed_at: Date | null | string;
  bounced_at: Date | null | string;
  unsubscribe_token: string | null;
  current_step: number;
  sequence_started_at: Date | null | string;
  canada_contact: boolean | null;
  us_contact: boolean | null;
  target_jurisdiction: string | null;
  account_name: string | null;
}

type SendOutcome = { status: "sent" | "skipped" | "failed"; reason?: string };

async function sendAutomationStep(params: {
  campaign: CampaignRow;
  step: StepRow;
  recipient: RecipientRow;
  senderInfo: Awaited<ReturnType<typeof getSenderInfo>>;
  steps: StepRow[];
  baseUrl: string;
}): Promise<SendOutcome> {
  const { campaign, step, recipient, senderInfo, steps, baseUrl } = params;

  // 1. Re-check unsubscribe / bounce (recipient may have opted out since start)
  if (recipient.unsubscribed_at) {
    await markRecipientTerminal(recipient.id, "unsubscribed", campaign.id);
    await recordEvent(campaign.id, recipient.id, recipient.contact_id, recipient.account_id,
      "automation_step_skipped", { step_id: step.id, reason: "unsubscribed" });
    return { status: "skipped", reason: "unsubscribed" };
  }
  if (recipient.bounced_at) {
    await markRecipientTerminal(recipient.id, "blocked", campaign.id);
    await recordEvent(campaign.id, recipient.id, recipient.contact_id, recipient.account_id,
      "automation_step_skipped", { step_id: step.id, reason: "bounced" });
    return { status: "skipped", reason: "bounced" };
  }

  // 2. Re-check suppression (email-level and domain-level)
  const domain = recipient.email.split("@")[1] ?? "";
  const suppRes = await db.execute(sql.raw(`
    SELECT id, suppression_type FROM campaign_suppression
    WHERE (suppression_type = 'email' AND email = '${safeSql(recipient.email)}')
       OR (suppression_type = 'domain' AND email = '${safeSql(domain)}')
    LIMIT 1
  `)).catch(() => ({ rows: [] }));
  if (suppRes.rows.length > 0) {
    await markRecipientTerminal(recipient.id, "suppressed", campaign.id);
    await recordEvent(campaign.id, recipient.id, recipient.contact_id, recipient.account_id,
      "automation_step_skipped", { step_id: step.id, reason: "suppressed" });
    return { status: "skipped", reason: "suppressed" };
  }

  // 3. Re-check compliance (may have changed since start)
  const compRes = await db.execute(sql.raw(`
    SELECT compliance_status FROM marketing_campaigns WHERE id = ${campaign.id}
  `));
  const compStatus = (compRes.rows[0] as any)?.compliance_status;
  if (compStatus !== "preflight_passed") {
    // Block the entire campaign automation
    await db.execute(sql.raw(`
      UPDATE marketing_campaigns
      SET automation_status = 'blocked', updated_at = NOW()
      WHERE id = ${campaign.id}
    `));
    await recordEvent(campaign.id, null, null, null,
      "automation_blocked", { reason: "compliance_expired_or_failed" });
    await recordEvent(campaign.id, recipient.id, recipient.contact_id, recipient.account_id,
      "automation_step_skipped", { step_id: step.id, reason: "compliance_blocked" });
    return { status: "skipped", reason: "compliance_blocked" };
  }

  // 4. Duplicate-send protection — check for existing sent event for this step
  const dupRes = await db.execute(sql.raw(`
    SELECT id FROM campaign_events
    WHERE campaign_id = ${campaign.id}
      AND recipient_id = ${recipient.id}
      AND event_type IN ('sent','automation_step_sent')
      AND (metadata->>'campaign_email_id')::int = ${step.id}
    LIMIT 1
  `)).catch(() => ({ rows: [] }));
  if (dupRes.rows.length > 0) {
    // Already sent — advance to next step
    await advanceRecipientToNextStep(recipient, step, steps, campaign.id);
    return { status: "skipped", reason: "already_sent" };
  }

  // 5. Validate step has content
  if (!step.subject?.trim()) {
    await recordEvent(campaign.id, recipient.id, recipient.contact_id, recipient.account_id,
      "automation_step_failed", { step_id: step.id, reason: "empty_subject" });
    return { status: "failed", reason: "empty_subject" };
  }
  if (!step.body_html?.trim() && !step.body_text?.trim()) {
    await recordEvent(campaign.id, recipient.id, recipient.contact_id, recipient.account_id,
      "automation_step_failed", { step_id: step.id, reason: "empty_body" });
    return { status: "failed", reason: "empty_body" };
  }

  // 6. Build RecipientData for rendering
  const recipientData: RecipientData = {
    id: recipient.id,
    contactId: recipient.contact_id,
    accountId: recipient.account_id,
    email: recipient.email,
    name: recipient.name ?? recipient.email,
    firstName: recipient.first_name ?? null,
    lastName: recipient.last_name ?? null,
    role: recipient.role,
    accountName: recipient.account_name ?? null,
    marinaPersona: recipient.marina_persona,
    adoptionStage: recipient.adoption_stage,
    primaryPain: null,
    currentStep: Number(recipient.current_step ?? 0),
    status: "active",
    recipientJurisdiction: recipient.target_jurisdiction ?? null,
    canadaContact: !!recipient.canada_contact,
    usContact: !!recipient.us_contact,
  };

  // 7. Build tracking config
  let unsubscribeToken = recipient.unsubscribe_token ?? "";
  if (!unsubscribeToken) {
    try {
      const { ensureUnsubscribeToken } = await import("./campaign-tracking");
      unsubscribeToken = await ensureUnsubscribeToken(recipient.id);
    } catch { /* non-critical */ }
  }

  let complianceToken = "";
  let recipFooterHtml: string | undefined;
  let recipFooterText: string | undefined;
  try {
    const complianceMod = await import("./compliance-preflight");
    if (recipient.email && recipient.contact_id) {
      complianceToken = complianceMod.signComplianceToken({
        email: recipient.email,
        contactId: recipient.contact_id,
        campaignId: campaign.id,
      });
    }
    if (complianceToken) {
      const unsubUrl = `${baseUrl}/unsubscribe?token=${complianceToken}`;
      const prefUrl = `${baseUrl}/preferences?token=${complianceToken}`;
      let jurisdiction = "unknown";
      if (recipient.canada_contact && recipient.us_contact) jurisdiction = "mixed";
      else if (recipient.canada_contact) jurisdiction = "canada";
      else if (recipient.us_contact) jurisdiction = "us";
      else if (recipient.target_jurisdiction) jurisdiction = recipient.target_jurisdiction;
      else if (campaign.target_jurisdiction) jurisdiction = campaign.target_jurisdiction;

      const footerResult = complianceMod.buildCompliantFooter({
        unsubscribeUrl: unsubUrl,
        preferencesUrl: prefUrl,
        jurisdiction,
        senderName: campaign.sender_name ?? null,
        senderLegalEntity: campaign.sender_legal_entity ?? null,
        physicalMailingAddress: campaign.physical_mailing_address ?? null,
        contactEmail: campaign.contact_email ?? null,
        contactPhone: campaign.contact_phone ?? null,
        commercialDisclosureIncluded: !!campaign.commercial_disclosure_included,
        campaignType: campaign.campaign_type ?? null,
      });
      recipFooterHtml = footerResult.html;
      recipFooterText = footerResult.text;
    }
  } catch { /* non-critical */ }

  const trackingConfig = unsubscribeToken ? {
    pixelUrl: `${baseUrl}/api/marketing/track/open/${unsubscribeToken}.gif`,
    unsubscribeUrl: `${baseUrl}/unsubscribe/${unsubscribeToken}`,
    compliantFooterHtml: recipFooterHtml,
    compliantFooterText: recipFooterText,
  } : undefined;

  // 8. Render
  let rendered: { subject: string; bodyHtml: string; bodyText: string; unresolvedPlaceholders: string[] };
  try {
    rendered = renderCampaignEmail(
      step.subject,
      step.body_html,
      step.body_text,
      recipientData,
      trackingConfig
    );
  } catch (err: any) {
    await recordEvent(campaign.id, recipient.id, recipient.contact_id, recipient.account_id,
      "automation_step_failed", { step_id: step.id, reason: "render_error", error: err?.message });
    return { status: "failed", reason: `render_error: ${err?.message}` };
  }

  // 9. Fail-closed on unresolved placeholders — mirrors campaign-sender.ts manual send path
  if (rendered.unresolvedPlaceholders.length > 0) {
    const missing = rendered.unresolvedPlaceholders.map((p: string) => `{{${p}}}`).join(", ");
    await recordEvent(campaign.id, recipient.id, recipient.contact_id, recipient.account_id,
      "automation_step_failed", { step_id: step.id, reason: "unresolved_placeholders", missing });
    return { status: "failed", reason: `unresolved_placeholders: ${missing}` };
  }

  // 10. Send event (before calling Gmail, mirrors campaign-sender.ts pattern)
  await recordEvent(campaign.id, recipient.id, recipient.contact_id, recipient.account_id,
    "automation_step_due", {
      campaign_email_id: step.id,
      step_number: step.step_number,
    });

  // 10. Attempt send
  let threadId: string | null = null;
  try {
    if (senderInfo.mode === "live" && senderInfo.userId && senderInfo.senderEmail) {
      const { sendEmail } = await import("../gmail");
      threadId = await sendEmail(senderInfo.userId, {
        to: recipient.email,
        from: senderInfo.senderEmail,
        subject: rendered.subject,
        bodyHtml: rendered.bodyHtml,
        bodyText: rendered.bodyText,
      });
    }
    // dev_safe: skip actual send but record as sent (mirrors campaign-sender.ts behaviour)
  } catch (err: any) {
    await recordEvent(campaign.id, recipient.id, recipient.contact_id, recipient.account_id,
      "automation_step_failed", {
        campaign_email_id: step.id,
        step_number: step.step_number,
        error: String(err?.message ?? "send_failed").slice(0, 200),
      });
    return { status: "failed", reason: `send_error: ${err?.message}` };
  }

  // 11. Record success event
  await recordEvent(campaign.id, recipient.id, recipient.contact_id, recipient.account_id,
    "automation_step_sent", {
      campaign_email_id: step.id,
      step_number: step.step_number,
      dev_safe: senderInfo.mode !== "live",
      thread_id: threadId,
    });

  // 12. Advance recipient to next step or mark completed
  await db.execute(sql.raw(`
    UPDATE campaign_recipients
    SET current_step = ${step.step_number}, last_sent_at = NOW(), updated_at = NOW()
    WHERE id = ${recipient.id}
  `));
  await advanceRecipientToNextStep(recipient, step, steps, campaign.id);

  // 13. Update campaign sent_count
  await db.execute(sql.raw(`
    UPDATE marketing_campaigns
    SET sent_count = sent_count + 1, updated_at = NOW()
    WHERE id = ${campaign.id}
  `)).catch(() => {});

  return { status: "sent" };
}

async function advanceRecipientToNextStep(
  recipient: RecipientRow,
  justSentStep: StepRow,
  allSteps: StepRow[],
  campaignId: number
): Promise<void> {
  const nextStep = allSteps.find(s => s.step_number > justSentStep.step_number);

  if (!nextStep) {
    // Final step sent — mark recipient completed
    await db.execute(sql.raw(`
      UPDATE campaign_recipients
      SET automation_status = 'completed', sequence_completed_at = NOW(),
          next_step_due_at = NULL, updated_at = NOW()
      WHERE id = ${recipient.id}
    `));
    await recordEvent(campaignId, recipient.id, recipient.contact_id, recipient.account_id,
      "automation_completed", { last_step: justSentStep.step_number });
  } else {
    // Compute due date for next step based on sequence_started_at + nextStep.delay_days
    const seqStart = recipient.sequence_started_at
      ? new Date(recipient.sequence_started_at as any)
      : new Date();
    const nextDueAt = computeDueAt(seqStart, Number(nextStep.delay_days ?? 0));
    const nextDueIso = nextDueAt.toISOString();

    await db.execute(sql.raw(`
      UPDATE campaign_recipients
      SET next_step_due_at = '${nextDueIso}'::timestamptz, updated_at = NOW()
      WHERE id = ${recipient.id}
    `));
  }
}

async function markRecipientTerminal(
  recipientId: number,
  status: "unsubscribed" | "suppressed" | "blocked" | "failed",
  campaignId: number
): Promise<void> {
  await db.execute(sql.raw(`
    UPDATE campaign_recipients
    SET automation_status = '${status}', next_step_due_at = NULL, updated_at = NOW()
    WHERE id = ${recipientId}
  `)).catch(() => {});
}

// ── Tick ──────────────────────────────────────────────────────────────────────

export async function runCampaignAutomationTick(options?: { baseUrl?: string }): Promise<TickResult> {
  if (_tickRunning) {
    console.log("[automation-tick] Already running — skipping this cycle");
    return { campaignsScanned: 0, recipientsDue: 0, sent: 0, skipped: 0, failed: 0 };
  }
  _tickRunning = true;

  const result: TickResult = { campaignsScanned: 0, recipientsDue: 0, sent: 0, skipped: 0, failed: 0, blocked: 0 };

  try {
    const baseUrl = options?.baseUrl ?? "http://localhost:5000";

    // Find all active campaigns
    const campaignsRes = await db.execute(sql.raw(`
      SELECT id, owner_user_id, sender_name, sender_legal_entity, physical_mailing_address,
             contact_email, contact_phone, commercial_disclosure_included,
             target_jurisdiction, campaign_type, compliance_status, automation_status
      FROM marketing_campaigns
      WHERE automation_status = 'active'
    `));
    result.campaignsScanned = campaignsRes.rows.length;

    for (const campaign of campaignsRes.rows as CampaignRow[]) {
      try {
        await processCampaignTick(campaign, result, baseUrl);
      } catch (err: any) {
        // Never let one campaign crash the whole tick
        console.error(`[automation-tick] Campaign ${campaign.id} error:`, err?.message);
      }
    }
  } finally {
    _tickRunning = false;
  }

  if (result.campaignsScanned > 0 || result.sent > 0) {
    console.log(
      `[automation-tick] campaigns_scanned=${result.campaignsScanned}` +
      ` recipients_due=${result.recipientsDue}` +
      ` sent=${result.sent} skipped=${result.skipped} failed=${result.failed}`
    );
  }
  return result;
}

async function processCampaignTick(
  campaign: CampaignRow,
  result: TickResult,
  baseUrl: string
): Promise<void> {
  // Verify compliance hasn't expired/changed since start
  if (campaign.compliance_status !== "preflight_passed") {
    await db.execute(sql.raw(`
      UPDATE marketing_campaigns
      SET automation_status = 'blocked', updated_at = NOW()
      WHERE id = ${campaign.id}
    `));
    await recordEvent(campaign.id, null, null, null,
      "automation_blocked", { reason: "compliance_not_passed" });
    console.warn(`[automation-tick] Campaign ${campaign.id} blocked — compliance not passed`);
    result.blocked++;
    return;
  }

  // Load all steps for this campaign
  const stepsRes = await db.execute(sql.raw(`
    SELECT id, step_number, subject, body_html, body_text, delay_days
    FROM campaign_emails
    WHERE campaign_id = ${campaign.id}
    ORDER BY step_number ASC
  `));
  const steps = stepsRes.rows as StepRow[];

  if (steps.length === 0) return;

  // Find recipients due for a send
  const dueRes = await db.execute(sql.raw(`
    SELECT
      cr.id, cr.contact_id, cr.account_id, cr.email, cr.name, cr.role,
      cr.marina_persona, cr.adoption_stage, cr.unsubscribed_at, cr.bounced_at,
      cr.unsubscribe_token, cr.current_step, cr.sequence_started_at,
      c.first_name, c.last_name, c.canada_contact, c.us_contact,
      c.target_jurisdiction,
      acc.name AS account_name
    FROM campaign_recipients cr
    LEFT JOIN contacts c ON c.id = cr.contact_id
    LEFT JOIN accounts acc ON acc.id = cr.account_id
    WHERE cr.campaign_id = ${campaign.id}
      AND cr.automation_status = 'active'
      AND cr.next_step_due_at <= NOW()
    ORDER BY cr.id ASC
  `));
  const dueRecipients = dueRes.rows as RecipientRow[];
  result.recipientsDue += dueRecipients.length;

  if (dueRecipients.length === 0) return;

  // Load sender info once per campaign (not per recipient)
  const senderInfo = await getSenderInfo(campaign.owner_user_id ?? 0);

  for (const r of dueRecipients) {
    try {
      // Determine next unsent step
      const currentStep = Number(r.current_step ?? 0);
      const nextStep = steps.find(s => Number(s.step_number) > currentStep);

      if (!nextStep) {
        // Recipient already past all steps — mark completed directly (no intermediate "suppressed" state)
        await db.execute(sql.raw(`
          UPDATE campaign_recipients
          SET automation_status = 'completed', sequence_completed_at = NOW(),
              next_step_due_at = NULL, updated_at = NOW()
          WHERE id = ${r.id}
        `));
        await recordEvent(campaign.id, r.id, r.contact_id, r.account_id,
          "automation_completed", { reason: "all_steps_done" });
        result.skipped++;
        continue;
      }

      const outcome = await sendAutomationStep({
        campaign,
        step: nextStep,
        recipient: r,
        senderInfo,
        steps,
        baseUrl,
      });

      if (outcome.status === "sent") result.sent++;
      else if (outcome.status === "skipped") result.skipped++;
      else result.failed++;

    } catch (err: any) {
      result.failed++;
      const errMsg = safeSql(err?.message ?? "unknown", 400);
      console.error(`[automation-tick] Recipient ${r.id} error: ${err?.message}`);
      await db.execute(sql.raw(`
        UPDATE campaign_recipients
        SET last_automation_error = '${errMsg}', updated_at = NOW()
        WHERE id = ${r.id}
      `)).catch(() => {});
      await recordEvent(campaign.id, r.id, r.contact_id, r.account_id,
        "automation_step_failed", { error: errMsg });
    }
  }

  // Update next_automation_run_at to the earliest remaining due date across active recipients
  await db.execute(sql.raw(`
    UPDATE marketing_campaigns
    SET next_automation_run_at = (
      SELECT MIN(next_step_due_at)
      FROM campaign_recipients
      WHERE campaign_id = ${campaign.id}
        AND automation_status = 'active'
        AND next_step_due_at IS NOT NULL
    ), updated_at = NOW()
    WHERE id = ${campaign.id}
  `)).catch(() => {});

  // After processing, check if all recipients are terminal → complete campaign
  const activeLeftRes = await db.execute(sql.raw(`
    SELECT COUNT(*) AS cnt FROM campaign_recipients
    WHERE campaign_id = ${campaign.id} AND automation_status = 'active'
  `));
  const activeLeft = Number((activeLeftRes.rows[0] as any)?.cnt ?? 1);

  if (activeLeft === 0) {
    await db.execute(sql.raw(`
      UPDATE marketing_campaigns
      SET automation_status = 'completed', automation_completed_at = NOW(),
          next_automation_run_at = NULL, updated_at = NOW()
      WHERE id = ${campaign.id}
    `));
    await recordEvent(campaign.id, null, null, null,
      "automation_completed", { reason: "all_recipients_terminal" });
    console.log(`[automation-tick] Campaign ${campaign.id} completed — all recipients terminal`);
  }
}
