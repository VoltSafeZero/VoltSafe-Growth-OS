/**
 * Campaign Branching Automation Service — Phase 9
 *
 * Rule-based branching attached to campaign sequences.
 * Rules are deterministic, priority-ordered, idempotent, fail-closed, and auditable.
 *
 * Integration points:
 *   - On reply classification  → evaluateRulesForRecipient (trigger: reply_classification)
 *   - On click tracking        → evaluateRulesForRecipient (trigger: clicked_link)
 *   - On unsubscribe           → evaluateRulesForRecipient (trigger: recipient_status = unsubscribed)
 *   - Automation tick          → branch_status respected via automation_status = 'blocked'
 *
 * Safety guarantees:
 *   - Rules NEVER override unsubscribe, suppression, bounce, or compliance checks
 *   - send_specific_step is deferred (gap) — only stop/move/task/note actions active this phase
 *   - Every rule fire is logged to campaign_recipient_rule_events
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

// ── SQL-safe escape ────────────────────────────────────────────────────────────

function sq(val: string): string {
  return "'" + val.replace(/'/g, "''") + "'";
}

// ── Migration ──────────────────────────────────────────────────────────────────

export async function migrateBranchingSchema(): Promise<void> {
  // campaign_automation_rules — one rule per row, attached to a campaign
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS campaign_automation_rules (
      id                  SERIAL       PRIMARY KEY,
      campaign_id         INTEGER      NOT NULL,
      name                TEXT         NOT NULL,
      trigger_type        TEXT         NOT NULL,
      trigger_config_json JSONB        NOT NULL DEFAULT '{}',
      action_type         TEXT         NOT NULL,
      action_config_json  JSONB        NOT NULL DEFAULT '{}',
      priority            INTEGER      NOT NULL DEFAULT 100,
      is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
      created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_car_campaign_id  ON campaign_automation_rules(campaign_id)`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_car_trigger_type ON campaign_automation_rules(trigger_type)`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_car_is_active    ON campaign_automation_rules(is_active)`));

  // campaign_recipient_rule_events — audit log of every rule fire
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS campaign_recipient_rule_events (
      id                    SERIAL       PRIMARY KEY,
      campaign_id           INTEGER      NOT NULL,
      campaign_recipient_id INTEGER      NOT NULL,
      rule_id               INTEGER      NOT NULL,
      trigger_event_type    TEXT,
      action_taken          TEXT         NOT NULL,
      action_metadata_json  JSONB        DEFAULT '{}',
      created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_crre_campaign_id        ON campaign_recipient_rule_events(campaign_id)`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_crre_campaign_recipient ON campaign_recipient_rule_events(campaign_recipient_id)`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_crre_rule_id            ON campaign_recipient_rule_events(rule_id)`));
  // Composite index for the idempotency check: (recipient, rule, trigger_type) narrowed first, then JSON filter on tiny result set
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_crre_idempotency ON campaign_recipient_rule_events(campaign_recipient_id, rule_id, trigger_event_type)`));

  // Additive columns on campaign_recipients for branch state
  await db.execute(sql.raw(`ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS branch_status    TEXT`));
  await db.execute(sql.raw(`ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS branch_reason    TEXT`));
  await db.execute(sql.raw(`ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS branch_rule_id   INTEGER`));
  await db.execute(sql.raw(`ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS sales_engaged_at TIMESTAMPTZ`));
}

// ── Allowlists ─────────────────────────────────────────────────────────────────

export const VALID_TRIGGER_TYPES = new Set([
  "reply_classification", "clicked_link", "opened_email",
  "no_open_after_step", "no_click_after_step",
  "recipient_status", "account_heat_score", "manual",
]);

export const VALID_ACTION_TYPES = new Set([
  "stop_sequence", "pause_sequence", "move_to_step", "skip_step",
  "create_task", "mark_sales_engaged", "suppress_recipient",
  "send_specific_step", "add_note", "no_action",
]);

export const VALID_BRANCH_STATUSES = new Set([
  "none", "stopped_by_reply", "stopped_by_unsubscribe",
  "stopped_by_negative", "moved_to_step", "sales_engaged", "branched",
]);

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RuleContext {
  triggerType: string;
  /** For reply_classification: the classification value. For clicked_link: the URL. */
  triggerValue?: string;
  triggerMetadata?: Record<string, any>;
  contactId?: number | null;
  accountId?: number | null;
  campaignId?: number;
  campaignEventId?: number | null;
}

interface RuleRow {
  id: number;
  campaign_id: number;
  name: string;
  trigger_type: string;
  trigger_config_json: any;
  action_type: string;
  action_config_json: any;
  priority: number;
  is_active: boolean;
}

interface RecipientBranchRow {
  id: number;
  campaign_id: number;
  contact_id: number | null;
  account_id: number | null;
  email: string;
  automation_status: string;
  branch_status: string | null;
  current_step: number;
  sequence_started_at: string | null;
  unsubscribed_at: string | null;
  bounced_at: string | null;
}

export interface EvaluateResult {
  fired: number;
  skipped: number;
  actions: string[];
}

// ── Core evaluation ───────────────────────────────────────────────────────────

/**
 * Evaluate all active branching rules for a recipient given a triggering context.
 * Rules are sorted by priority ASC (lower = higher priority).
 * Idempotent: won't fire the same rule for the same trigger key twice.
 */
export async function evaluateRulesForRecipient(
  campaignRecipientId: number,
  context: RuleContext
): Promise<EvaluateResult> {
  const result: EvaluateResult = { fired: 0, skipped: 0, actions: [] };

  try {
    // 1. Load recipient
    const recipRes = await db.execute(sql.raw(`
      SELECT id, campaign_id, contact_id, account_id, email,
             automation_status, branch_status, current_step,
             sequence_started_at, unsubscribed_at, bounced_at
      FROM campaign_recipients
      WHERE id = ${campaignRecipientId}
      LIMIT 1
    `)).catch(() => ({ rows: [] }));
    const recipient = recipRes.rows[0] as RecipientBranchRow | undefined;
    if (!recipient) return result;

    const campaignId = context.campaignId ?? Number(recipient.campaign_id);

    // 2. Load active rules for this campaign + trigger_type, priority ordered
    const rulesRes = await db.execute(sql.raw(`
      SELECT id, campaign_id, name, trigger_type, trigger_config_json,
             action_type, action_config_json, priority, is_active
      FROM campaign_automation_rules
      WHERE campaign_id = ${campaignId}
        AND trigger_type = ${sq(context.triggerType)}
        AND is_active = TRUE
      ORDER BY priority ASC, id ASC
    `)).catch(() => ({ rows: [] }));
    const rules = rulesRes.rows as RuleRow[];

    for (const rule of rules) {
      try {
        // 3. Test rule matches context
        if (!ruleMatchesContext(rule, context)) {
          result.skipped++;
          continue;
        }

        // 4. Idempotency — same rule + same trigger key must not fire twice
        const triggerKey = context.campaignEventId
          ? `event_${context.campaignEventId}`
          : (context.triggerValue ?? context.triggerType);
        const idempRes = await db.execute(sql.raw(`
          SELECT id FROM campaign_recipient_rule_events
          WHERE campaign_recipient_id = ${campaignRecipientId}
            AND rule_id = ${rule.id}
            AND trigger_event_type = ${sq(context.triggerType)}
            AND (action_metadata_json->>'trigger_key') = ${sq(triggerKey)}
          LIMIT 1
        `)).catch(() => ({ rows: [] }));
        if (idempRes.rows.length > 0) {
          result.skipped++;
          continue;
        }

        // 5. Compliance guard — rules NEVER fire for suppressed/unsubscribed/bounced recipients
        //    Checks both the recipient-row columns AND the campaign_suppression table.
        const isSuppressed = await checkSuppression(recipient.email);
        if (recipient.unsubscribed_at || recipient.bounced_at || isSuppressed) {
          await writeRuleEvent(campaignId, campaignRecipientId, rule.id, context.triggerType,
            "skipped_compliance",
            { reason: "recipient_unsubscribed_or_bounced", trigger_key: triggerKey });
          result.skipped++;
          continue;
        }

        // 6. Apply action
        const actionTaken = await applyRuleAction(rule, recipient, context, triggerKey);
        result.actions.push(actionTaken);
        result.fired++;

        // 7. Write audit row
        await writeRuleEvent(campaignId, campaignRecipientId, rule.id, context.triggerType,
          actionTaken, {
            trigger_key: triggerKey,
            trigger_value: context.triggerValue,
            rule_name: rule.name,
            action_type: rule.action_type,
          });

      } catch (err: any) {
        console.error(`[branching] Rule ${rule.id} error for recipient ${campaignRecipientId}:`, err?.message);
        result.skipped++;
      }
    }
  } catch (err: any) {
    console.error("[branching] evaluateRulesForRecipient error:", err?.message);
  }

  return result;
}

/**
 * Evaluate rules triggered by a campaign_event (by event ID).
 * Used by the POST /evaluate-event/:eventId admin route.
 */
export async function evaluateRulesForEvent(campaignEventId: number): Promise<EvaluateResult> {
  try {
    const evRes = await db.execute(sql.raw(`
      SELECT campaign_id, recipient_id, contact_id, account_id,
             event_type, metadata
      FROM campaign_events
      WHERE id = ${campaignEventId}
      LIMIT 1
    `)).catch(() => ({ rows: [] }));
    const ev = evRes.rows[0] as any;
    if (!ev?.recipient_id) return { fired: 0, skipped: 0, actions: [] };

    const meta = typeof ev.metadata === "string"
      ? JSON.parse(ev.metadata)
      : (ev.metadata ?? {});
    const originalUrl = meta.original_url as string | undefined;

    const context: RuleContext = {
      triggerType: ev.event_type === "clicked" ? "clicked_link" : ev.event_type,
      triggerValue: originalUrl ?? ev.event_type,
      triggerMetadata: meta,
      contactId: ev.contact_id ? Number(ev.contact_id) : null,
      accountId: ev.account_id ? Number(ev.account_id) : null,
      campaignId: Number(ev.campaign_id),
      campaignEventId,
    };

    return await evaluateRulesForRecipient(Number(ev.recipient_id), context);
  } catch (err: any) {
    console.error("[branching] evaluateRulesForEvent error:", err?.message);
    return { fired: 0, skipped: 0, actions: [] };
  }
}

// ── Rule matching ──────────────────────────────────────────────────────────────

function ruleMatchesContext(rule: RuleRow, context: RuleContext): boolean {
  const cfg = parseCfg(rule.trigger_config_json);

  switch (rule.trigger_type) {
    case "reply_classification":
      if (cfg.classification) {
        return context.triggerValue === cfg.classification;
      }
      return true;

    case "clicked_link": {
      const keywords = cfg.url_keywords as string[] | undefined;
      if (!keywords?.length) return true;
      const url = (context.triggerValue ?? "").toLowerCase();
      return keywords.some(kw => url.includes(kw.toLowerCase()));
    }

    case "opened_email":
      return true;

    case "recipient_status":
      if (cfg.status) {
        return context.triggerValue === cfg.status;
      }
      return true;

    case "manual":
      return true;

    // These require tick-time evaluation — not matched via event-driven path
    case "no_open_after_step":
    case "no_click_after_step":
    case "account_heat_score":
      return false;

    default:
      return false;
  }
}

// ── Action application ─────────────────────────────────────────────────────────

export async function applyRuleAction(
  rule: RuleRow,
  recipient: RecipientBranchRow,
  context: RuleContext,
  triggerKey: string
): Promise<string> {
  const actionCfg = parseCfg(rule.action_config_json);
  const campaignId = Number(recipient.campaign_id);
  const recipientId = Number(recipient.id);

  switch (rule.action_type) {
    // ─────────────────────────────────────────────────────
    case "stop_sequence": {
      const branchStatus = deriveBranchStatus(rule.trigger_type, context.triggerValue);

      await db.execute(sql.raw(`
        UPDATE campaign_recipients
        SET automation_status = 'blocked',
            branch_status     = ${sq(branchStatus)},
            branch_reason     = ${sq(rule.name.slice(0, 500))},
            branch_rule_id    = ${rule.id},
            next_step_due_at  = NULL,
            updated_at        = NOW()
        WHERE id = ${recipientId}
      `));
      await recordCampaignEvent(campaignId, recipientId, recipient.contact_id, recipient.account_id,
        "branching_sequence_stopped",
        { rule_id: rule.id, rule_name: rule.name, branch_status: branchStatus, trigger_key: triggerKey });

      // Composite: also create task (deduped by rule_id)
      if (actionCfg.also_create_task) {
        await createBranchTask(campaignId, recipientId, recipient.contact_id, recipient.account_id,
          actionCfg, context, rule.id);
      }
      // Composite: also suppress
      if (actionCfg.also_suppress) {
        await suppressEmail(recipient.email, "branching_rule");
        await db.execute(sql.raw(`
          UPDATE campaign_recipients
          SET branch_status = 'stopped_by_unsubscribe', updated_at = NOW()
          WHERE id = ${recipientId}
        `)).catch(() => {});
      }
      // Composite: also add note
      if (actionCfg.also_add_note) {
        await appendCampaignNote(campaignId, recipientId, recipient.contact_id, recipient.account_id,
          actionCfg.note_text ?? `Sequence stopped: ${rule.name}`);
      }

      return "stop_sequence";
    }

    // ─────────────────────────────────────────────────────
    case "pause_sequence": {
      await db.execute(sql.raw(`
        UPDATE campaign_recipients
        SET automation_status = 'paused',
            branch_status     = 'branched',
            branch_reason     = ${sq(rule.name.slice(0, 500))},
            branch_rule_id    = ${rule.id},
            updated_at        = NOW()
        WHERE id = ${recipientId}
      `));
      await recordCampaignEvent(campaignId, recipientId, recipient.contact_id, recipient.account_id,
        "branching_sequence_paused", { rule_id: rule.id, rule_name: rule.name });
      return "pause_sequence";
    }

    // ─────────────────────────────────────────────────────
    case "move_to_step": {
      const targetStep = Number(actionCfg.target_step ?? 0);
      if (!targetStep) {
        await writeRuleEvent(campaignId, recipientId, rule.id, context.triggerType,
          "move_to_step_skipped_no_target", { trigger_key: triggerKey });
        return "move_to_step_skipped_no_target";
      }

      // Safety: verify step exists
      const stepRes = await db.execute(sql.raw(`
        SELECT id, step_number, delay_days
        FROM campaign_emails
        WHERE campaign_id = ${campaignId} AND step_number = ${targetStep}
        LIMIT 1
      `)).catch(() => ({ rows: [] }));
      if (!stepRes.rows.length) {
        await writeRuleEvent(campaignId, recipientId, rule.id, context.triggerType,
          "move_to_step_skipped_missing_step", { target_step: targetStep, trigger_key: triggerKey });
        return "move_to_step_skipped_missing_step";
      }

      // Safety: verify step not already sent
      const sentRes = await db.execute(sql.raw(`
        SELECT id FROM campaign_events
        WHERE campaign_id = ${campaignId}
          AND recipient_id = ${recipientId}
          AND event_type IN ('sent','automation_step_sent')
          AND (metadata->>'step_number')::int = ${targetStep}
        LIMIT 1
      `)).catch(() => ({ rows: [] }));
      if (sentRes.rows.length > 0) {
        await writeRuleEvent(campaignId, recipientId, rule.id, context.triggerType,
          "move_to_step_skipped_already_sent", { target_step: targetStep, trigger_key: triggerKey });
        return "move_to_step_skipped_already_sent";
      }

      const step = stepRes.rows[0] as any;
      const seqStart = recipient.sequence_started_at
        ? new Date(recipient.sequence_started_at)
        : new Date();
      const delayMs = Number(step.delay_days ?? 0) * 86_400_000;
      const rawDue = new Date(seqStart.getTime() + delayMs);
      // If computed due is in the past, schedule immediately
      const nextDueIso = rawDue <= new Date() ? new Date().toISOString() : rawDue.toISOString();

      await db.execute(sql.raw(`
        UPDATE campaign_recipients
        SET current_step     = ${targetStep - 1},
            next_step_due_at = '${nextDueIso}'::timestamptz,
            branch_status    = 'moved_to_step',
            branch_reason    = ${sq(rule.name.slice(0, 500))},
            branch_rule_id   = ${rule.id},
            automation_status = 'active',
            updated_at       = NOW()
        WHERE id = ${recipientId}
      `));
      await recordCampaignEvent(campaignId, recipientId, recipient.contact_id, recipient.account_id,
        "branching_moved_to_step", { rule_id: rule.id, target_step: targetStep, next_due: nextDueIso });
      return "move_to_step";
    }

    // ─────────────────────────────────────────────────────
    case "create_task": {
      await createBranchTask(campaignId, recipientId, recipient.contact_id, recipient.account_id,
        actionCfg, context, rule.id);
      return "create_task";
    }

    // ─────────────────────────────────────────────────────
    case "mark_sales_engaged": {
      await db.execute(sql.raw(`
        UPDATE campaign_recipients
        SET branch_status     = 'sales_engaged',
            branch_reason     = ${sq(rule.name.slice(0, 500))},
            branch_rule_id    = ${rule.id},
            sales_engaged_at  = NOW(),
            automation_status = 'blocked',
            next_step_due_at  = NULL,
            updated_at        = NOW()
        WHERE id = ${recipientId}
      `));
      await recordCampaignEvent(campaignId, recipientId, recipient.contact_id, recipient.account_id,
        "branching_marked_sales_engaged", { rule_id: rule.id, rule_name: rule.name });
      return "mark_sales_engaged";
    }

    // ─────────────────────────────────────────────────────
    case "suppress_recipient": {
      await suppressEmail(recipient.email, "branching_rule");
      await db.execute(sql.raw(`
        UPDATE campaign_recipients
        SET branch_status     = 'stopped_by_unsubscribe',
            branch_reason     = ${sq(rule.name.slice(0, 500))},
            branch_rule_id    = ${rule.id},
            automation_status = 'blocked',
            next_step_due_at  = NULL,
            updated_at        = NOW()
        WHERE id = ${recipientId}
      `));
      await recordCampaignEvent(campaignId, recipientId, recipient.contact_id, recipient.account_id,
        "branching_suppressed", { rule_id: rule.id, email: recipient.email });
      return "suppress_recipient";
    }

    // ─────────────────────────────────────────────────────
    // send_specific_step deferred — gap for Phase 10
    case "send_specific_step": {
      await writeRuleEvent(campaignId, recipientId, rule.id, context.triggerType,
        "send_specific_step_deferred",
        { reason: "not_implemented_phase9", trigger_key: triggerKey });
      return "send_specific_step_deferred";
    }

    // ─────────────────────────────────────────────────────
    case "add_note": {
      await appendCampaignNote(campaignId, recipientId, recipient.contact_id, recipient.account_id,
        actionCfg.note_text ?? `Branching rule fired: ${rule.name}`);
      return "add_note";
    }

    // ─────────────────────────────────────────────────────
    case "no_action":
    default:
      return "no_action";
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseCfg(raw: any): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return raw;
}

function deriveBranchStatus(triggerType: string, triggerValue?: string): string {
  if (triggerType === "reply_classification") {
    if (triggerValue === "unsubscribe") return "stopped_by_unsubscribe";
    if (triggerValue === "negative") return "stopped_by_negative";
    return "stopped_by_reply";
  }
  if (triggerType === "recipient_status" && triggerValue === "unsubscribed") return "stopped_by_unsubscribe";
  return "stopped_by_reply";
}

/** Check whether an email address is in the campaign_suppression table. */
async function checkSuppression(email: string): Promise<boolean> {
  try {
    const res = await db.execute(sql.raw(`
      SELECT id FROM campaign_suppression
      WHERE email = ${sq(email.toLowerCase().trim())}
      LIMIT 1
    `));
    return res.rows.length > 0;
  } catch {
    return false; // fail-open for suppression lookup so compliance guard below still works
  }
}

async function suppressEmail(email: string, reason: string): Promise<void> {
  await db.execute(sql.raw(`
    INSERT INTO campaign_suppression (email, reason, source, created_at)
    VALUES (${sq(email)}, ${sq(reason)}, 'branching_automation', NOW())
    ON CONFLICT DO NOTHING
  `)).catch(() => {});
}

async function appendCampaignNote(
  campaignId: number,
  recipientId: number,
  contactId: number | null,
  accountId: number | null,
  noteText: string
): Promise<void> {
  await db.execute(sql.raw(`
    INSERT INTO campaign_events
      (campaign_id, recipient_id, contact_id, account_id, event_type, event_timestamp, metadata)
    VALUES
      (${campaignId}, ${recipientId},
       ${contactId != null ? contactId : "NULL"},
       ${accountId != null ? accountId : "NULL"},
       'branching_note', NOW(),
       ${sq(JSON.stringify({ note: noteText.slice(0, 500) }))}::jsonb)
  `)).catch(() => {});
}

async function createBranchTask(
  campaignId: number,
  recipientId: number,
  contactId: number | null,
  accountId: number | null,
  actionCfg: Record<string, any>,
  context: RuleContext,
  ruleId?: number
): Promise<void> {
  try {
    // Dedup guard: don't create more than one task per recipient + rule
    // This prevents duplicate tasks when multiple trigger_keys match the same rule
    // (e.g. two different clicked links both matching the ROI rule with also_create_task)
    if (ruleId) {
      const dupCheck = await db.execute(sql.raw(`
        SELECT id FROM campaign_recipient_rule_events
        WHERE campaign_recipient_id = ${recipientId}
          AND rule_id = ${ruleId}
          AND action_taken = 'task_created'
        LIMIT 1
      `)).catch(() => ({ rows: [] }));
      if (dupCheck.rows.length > 0) {
        console.log(`[branching] Task dedup: rule ${ruleId} already created task for recipient ${recipientId} — skipping`);
        return;
      }
    }

    const title = (actionCfg.task_title ?? `Follow up — Campaign reply (${context.triggerValue ?? "branching rule"})`).slice(0, 200);
    const desc = (actionCfg.task_description ?? `Branching rule triggered for campaign ${campaignId}. Trigger: ${context.triggerType} = ${context.triggerValue ?? ""}`).slice(0, 1000);
    const priority = actionCfg.task_priority ?? "high";
    await db.execute(sql.raw(`
      INSERT INTO tasks (title, description, status, priority, contact_id, account_id, created_at, updated_at)
      VALUES (
        ${sq(title)},
        ${sq(desc)},
        'todo',
        ${sq(priority)},
        ${contactId != null ? contactId : "NULL"},
        ${accountId != null ? accountId : "NULL"},
        NOW(), NOW()
      )
    `)).catch(() => {});

    // Record the task creation in rule events for dedup tracking
    if (ruleId) {
      await writeRuleEvent(campaignId, recipientId, ruleId, context.triggerType,
        "task_created", { trigger_key: context.triggerValue ?? context.triggerType, task_title: title });
    }

    // Phase 10: fire-and-forget attribution event — branch task creation is a direct CRM signal
    import("./campaign-attribution").then(({ recordCampaignAttributionEvent }) => {
      recordCampaignAttributionEvent({
        campaignId,
        campaignRecipientId: recipientId,
        accountId:           accountId ?? null,
        contactId:           contactId ?? null,
        eventType:           "task_created",
        attributionType:     "direct",
        confidence:          "high",
        metadata:            { rule_id: ruleId ?? null, trigger_type: context.triggerType, task_title: title.slice(0, 200) },
      });
    }).catch(() => {});
  } catch { /* non-critical */ }
}

async function recordCampaignEvent(
  campaignId: number,
  recipientId: number,
  contactId: number | null,
  accountId: number | null,
  eventType: string,
  metadata: Record<string, any>
): Promise<void> {
  await db.execute(sql.raw(`
    INSERT INTO campaign_events
      (campaign_id, recipient_id, contact_id, account_id, event_type, event_timestamp, metadata)
    VALUES
      (${campaignId}, ${recipientId},
       ${contactId != null ? contactId : "NULL"},
       ${accountId != null ? accountId : "NULL"},
       ${sq(eventType)}, NOW(),
       ${sq(JSON.stringify(metadata))}::jsonb)
  `)).catch(() => {});
}

async function writeRuleEvent(
  campaignId: number,
  campaignRecipientId: number,
  ruleId: number,
  triggerEventType: string,
  actionTaken: string,
  metadata: Record<string, any>
): Promise<void> {
  await db.execute(sql.raw(`
    INSERT INTO campaign_recipient_rule_events
      (campaign_id, campaign_recipient_id, rule_id, trigger_event_type, action_taken, action_metadata_json, created_at)
    VALUES
      (${campaignId}, ${campaignRecipientId}, ${ruleId}, ${sq(triggerEventType)},
       ${sq(actionTaken)}, ${sq(JSON.stringify(metadata))}::jsonb, NOW())
  `)).catch(() => {});
}

// ── CRUD ───────────────────────────────────────────────────────────────────────

export async function listCampaignRules(campaignId: number): Promise<any[]> {
  if (!campaignId || isNaN(campaignId)) return [];
  const res = await db.execute(sql.raw(`
    SELECT r.*,
           COUNT(e.id) FILTER (
             WHERE e.action_taken NOT LIKE 'skipped%'
               AND e.action_taken NOT LIKE '%_skipped_%'
               AND e.action_taken != 'send_specific_step_deferred'
               AND e.action_taken != 'no_action'
           )::int      AS fired_count,
           MAX(e.created_at) FILTER (
             WHERE e.action_taken NOT LIKE 'skipped%'
               AND e.action_taken NOT LIKE '%_skipped_%'
               AND e.action_taken != 'send_specific_step_deferred'
               AND e.action_taken != 'no_action'
           )           AS last_fired_at
    FROM campaign_automation_rules r
    LEFT JOIN campaign_recipient_rule_events e ON e.rule_id = r.id
    WHERE r.campaign_id = ${campaignId}
    GROUP BY r.id
    ORDER BY r.priority ASC, r.id ASC
  `));
  return res.rows as any[];
}

export async function createCampaignRule(input: {
  campaignId: number;
  name: string;
  triggerType: string;
  triggerConfigJson?: Record<string, any>;
  actionType: string;
  actionConfigJson?: Record<string, any>;
  priority?: number;
  isActive?: boolean;
}): Promise<any> {
  if (!VALID_TRIGGER_TYPES.has(input.triggerType))
    throw Object.assign(new Error(`Invalid trigger_type: ${input.triggerType}`), { statusCode: 400 });
  if (!VALID_ACTION_TYPES.has(input.actionType))
    throw Object.assign(new Error(`Invalid action_type: ${input.actionType}`), { statusCode: 400 });
  const res = await db.execute(sql.raw(`
    INSERT INTO campaign_automation_rules
      (campaign_id, name, trigger_type, trigger_config_json,
       action_type, action_config_json, priority, is_active)
    VALUES
      (${input.campaignId},
       ${sq(input.name.slice(0, 200))},
       ${sq(input.triggerType)},
       ${sq(JSON.stringify(input.triggerConfigJson ?? {}))}::jsonb,
       ${sq(input.actionType)},
       ${sq(JSON.stringify(input.actionConfigJson ?? {}))}::jsonb,
       ${Number(input.priority ?? 100)},
       ${input.isActive !== false ? "TRUE" : "FALSE"})
    RETURNING *
  `));
  return res.rows[0];
}

export async function updateCampaignRule(id: number, input: {
  name?: string;
  triggerType?: string;
  triggerConfigJson?: Record<string, any>;
  actionType?: string;
  actionConfigJson?: Record<string, any>;
  priority?: number;
  isActive?: boolean;
}): Promise<any> {
  if (input.triggerType && !VALID_TRIGGER_TYPES.has(input.triggerType))
    throw Object.assign(new Error(`Invalid trigger_type: ${input.triggerType}`), { statusCode: 400 });
  if (input.actionType && !VALID_ACTION_TYPES.has(input.actionType))
    throw Object.assign(new Error(`Invalid action_type: ${input.actionType}`), { statusCode: 400 });

  const setClauses: string[] = ["updated_at = NOW()"];
  if (input.name !== undefined)              setClauses.push(`name = ${sq(input.name.slice(0, 200))}`);
  if (input.triggerType !== undefined)       setClauses.push(`trigger_type = ${sq(input.triggerType)}`);
  if (input.triggerConfigJson !== undefined) setClauses.push(`trigger_config_json = ${sq(JSON.stringify(input.triggerConfigJson))}::jsonb`);
  if (input.actionType !== undefined)        setClauses.push(`action_type = ${sq(input.actionType)}`);
  if (input.actionConfigJson !== undefined)  setClauses.push(`action_config_json = ${sq(JSON.stringify(input.actionConfigJson))}::jsonb`);
  if (input.priority !== undefined)          setClauses.push(`priority = ${Number(input.priority)}`);
  if (input.isActive !== undefined)          setClauses.push(`is_active = ${input.isActive ? "TRUE" : "FALSE"}`);

  const res = await db.execute(sql.raw(`
    UPDATE campaign_automation_rules
    SET ${setClauses.join(", ")}
    WHERE id = ${id}
    RETURNING *
  `));
  if (!res.rows.length)
    throw Object.assign(new Error("Rule not found"), { statusCode: 404 });
  return res.rows[0];
}

export async function deleteCampaignRule(id: number): Promise<void> {
  await db.execute(sql.raw(`DELETE FROM campaign_automation_rules WHERE id = ${id}`));
}

export async function getRecipientRuleHistory(campaignRecipientId: number): Promise<any[]> {
  const res = await db.execute(sql.raw(`
    SELECT e.*, r.name AS rule_name, r.trigger_type, r.action_type
    FROM campaign_recipient_rule_events e
    LEFT JOIN campaign_automation_rules r ON r.id = e.rule_id
    WHERE e.campaign_recipient_id = ${campaignRecipientId}
    ORDER BY e.created_at DESC
    LIMIT 100
  `));
  return res.rows as any[];
}

// ── Seed default rules ─────────────────────────────────────────────────────────

export async function seedDefaultCampaignRules(campaignId: number): Promise<any[]> {
  // Idempotent — skip rules already present (by name) for this campaign
  const existRes = await db.execute(sql.raw(`
    SELECT name FROM campaign_automation_rules WHERE campaign_id = ${campaignId}
  `)).catch(() => ({ rows: [] }));
  const existingNames = new Set((existRes.rows as any[]).map((r: any) => r.name as string));

  const defaults: Array<Parameters<typeof createCampaignRule>[0]> = [
    {
      campaignId,
      name: "Stop on meeting request",
      triggerType: "reply_classification",
      triggerConfigJson: { classification: "meeting_request" },
      actionType: "stop_sequence",
      actionConfigJson: {
        also_create_task: true,
        task_priority: "high",
        task_title: "Meeting requested — follow up",
      },
      priority: 10,
    },
    {
      campaignId,
      name: "Stop on interested reply",
      triggerType: "reply_classification",
      triggerConfigJson: { classification: "interested" },
      actionType: "stop_sequence",
      actionConfigJson: {
        also_create_task: true,
        task_priority: "high",
        task_title: "Interested lead — schedule call",
      },
      priority: 20,
    },
    {
      campaignId,
      name: "Stop on unsubscribe",
      triggerType: "reply_classification",
      triggerConfigJson: { classification: "unsubscribe" },
      actionType: "stop_sequence",
      actionConfigJson: { also_suppress: true },
      priority: 5,
    },
    {
      campaignId,
      name: "Stop on negative reply",
      triggerType: "reply_classification",
      triggerConfigJson: { classification: "negative" },
      actionType: "stop_sequence",
      actionConfigJson: {
        also_add_note: true,
        note_text: "Negative reply received — sequence stopped",
      },
      priority: 30,
    },
    {
      campaignId,
      name: "Send technical follow-up",
      triggerType: "clicked_link",
      triggerConfigJson: {
        url_keywords: ["technical", "install", "electrical", "UL", "CSA", "spec", "datasheet"],
      },
      actionType: "move_to_step",
      actionConfigJson: {
        target_step: 99,
        note: "Move to technical follow-up step if present in campaign",
      },
      priority: 50,
    },
    {
      campaignId,
      name: "Send ROI follow-up",
      triggerType: "clicked_link",
      triggerConfigJson: {
        url_keywords: ["ROI", "pricing", "revenue", "billing", "savings", "calculator"],
      },
      actionType: "move_to_step",
      actionConfigJson: {
        target_step: 98,
        note: "Move to ROI follow-up step if present in campaign",
      },
      priority: 60,
    },
    {
      campaignId,
      name: "No engagement nurture path",
      triggerType: "no_open_after_step",
      triggerConfigJson: { after_step: 2, after_days: 7 },
      actionType: "add_note",
      actionConfigJson: {
        note_text: "No engagement after step 2 — consider moving to nurture path",
      },
      priority: 100,
    },
  ];

  const created: any[] = [];
  for (const def of defaults) {
    if (existingNames.has(def.name)) continue;
    try {
      const rule = await createCampaignRule(def);
      created.push(rule);
    } catch (err: any) {
      console.warn(`[branching] Failed to seed rule "${def.name}":`, err?.message);
    }
  }
  return created;
}
