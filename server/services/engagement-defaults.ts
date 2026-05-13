/**
 * Default B2B Sales Engagement Rules
 * Seeded at startup if no rules exist. All editable via the rules API.
 *
 * Philosophy: lightweight, high-signal, low-noise defaults for B2B outbound.
 * Opens are soft signals; clicks and repeated opens are actionable.
 */
import { db } from "../db";
import { sql } from "drizzle-orm";
import { esc } from "../tracking";

/**
 * DEFAULT POLICY: Tracking only — no tasks, no notifications.
 * All rules are seeded as DISABLED (is_enabled: false).
 * Users must explicitly enable rules via Settings → Mail → Tracking & Automation.
 * Do NOT change is_enabled to true here — that would re-enable tasks on every
 * fresh deploy / database reset, violating the opt-in policy.
 */
const DEFAULTS = [
  {
    name: "Email opened — first time",
    trigger_type: "first_open",
    min_events: 1,
    action_type: "create_notification",
    action_config: {
      title: "Email opened: {subject}",
      body: "{recipient} opened your email for the first time (soft signal — image load)",
    },
    cooldown_hours: 72,
    trigger_config: {},
    is_enabled: false,  // opt-in only
  },
  {
    name: "Email opened 3+ times — follow up",
    trigger_type: "repeated_open",
    min_events: 3,
    action_type: "create_task",
    action_config: {
      taskTitle: "Follow up — opened multiple times: {subject}",
      dueDays: 1,
      priority: "high",
    },
    cooldown_hours: 48,
    trigger_config: {},
    is_enabled: false,  // opt-in only
  },
  {
    name: "Link clicked — create follow-up task",
    trigger_type: "first_click",
    min_events: 1,
    action_type: "create_task",
    action_config: {
      taskTitle: "Follow up — link clicked in: {subject}",
      dueDays: 1,
      priority: "high",
    },
    cooldown_hours: 24,
    trigger_config: {},
    is_enabled: false,  // opt-in only
  },
  {
    name: "Pricing / quote / spec link clicked — high priority task",
    trigger_type: "pricing_link_clicked",
    min_events: 1,
    action_type: "create_task",
    action_config: {
      taskTitle: "High priority: pricing/spec link clicked — {subject}",
      dueDays: 0,
      priority: "high",
    },
    cooldown_hours: 24,
    trigger_config: { urlPattern: "pric|spec|quot|proposa|order|buy|shop" },
    is_enabled: false,  // opt-in only
  },
  {
    name: "No open after 5 days — suggest re-engagement",
    trigger_type: "no_open_after_days",
    min_events: 0,
    action_type: "create_notification",
    action_config: {
      title: "No engagement after 5 days: {subject}",
      body: "{recipient} hasn't opened your email in 5 days — consider a follow-up or alternate approach",
    },
    cooldown_hours: 120,
    trigger_config: { days: 5 },
    is_enabled: false,  // opt-in only
  },
  {
    name: "Opened but no reply after 3 days — reminder",
    trigger_type: "opened_no_reply_after_days",
    min_events: 1,
    action_type: "create_task",
    action_config: {
      taskTitle: "Reach out — opened but no reply for 3 days: {subject}",
      dueDays: 0,
      priority: "medium",
    },
    cooldown_hours: 72,
    trigger_config: { days: 3 },
    is_enabled: false,  // opt-in only
  },
] as const;

export async function seedDefaultRules(): Promise<void> {
  try {
    const [countRow] = (await db.execute(sql.raw(
      `SELECT COUNT(*)::int AS cnt FROM email_engagement_rules`
    ))).rows as any[];

    if (Number(countRow?.cnt || 0) > 0) {
      return; // Already seeded
    }

    for (const rule of DEFAULTS) {
      await db.execute(sql.raw(`
        INSERT INTO email_engagement_rules
          (name, trigger_type, min_events, action_type, action_config,
           cooldown_hours, trigger_config, is_enabled, created_at, updated_at)
        VALUES (
          '${esc(rule.name)}',
          '${esc(rule.trigger_type)}',
          ${rule.min_events},
          '${esc(rule.action_type)}',
          '${esc(JSON.stringify(rule.action_config))}'::jsonb,
          ${rule.cooldown_hours},
          '${esc(JSON.stringify(rule.trigger_config))}'::jsonb,
          ${rule.is_enabled},
          NOW(), NOW()
        )
      `));
    }
    console.log(`[engagement-defaults] Seeded ${DEFAULTS.length} default engagement rules`);
  } catch (err) {
    console.error("[engagement-defaults] seed error:", err);
  }
}
