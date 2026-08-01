/**
 * ceo-briefing.ts
 * CEO Cockpit Phase 7 — Daily Briefing, Weekly Review, Team Member Briefing, Leadership Agenda
 *
 * All functions are deterministic. No AI calls. No external API calls.
 * No auto-send. No email. No messaging. Never sends.
 * Returns copyable text / structured data only.
 * Capital data only included when hasCapital = true.
 * Private Currents channels are always excluded.
 * Team member briefing uses neutral operational language only — no shaming.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

// ── Types ─────────────────────────────────────────────────────────────────────

export type BriefingSeverity = "info" | "watch" | "urgent" | "critical";

export interface BriefingSection {
  title: string;
  severity: BriefingSeverity;
  items: BriefingItem[];
  empty_state: string;
  reason: string;
}

export interface BriefingItem {
  id: string;
  title: string;
  owner?: string | null;
  ownerId?: number | null;
  source?: string | null;
  dueDate?: string | null;
  ageHours?: number;
  ageDays?: number;
  severity?: BriefingSeverity;
  status?: string | null;
  link?: string;
  metadata?: Record<string, any>;
}

export interface DailyCeoBriefing {
  generated_at: string;
  date: string;
  sections: {
    new_blockers: BriefingSection;
    unresolved_actions: BriefingSection;
    overdue_tasks: BriefingSection;
    stale_opportunities: BriefingSection;
    commitments_due_soon: BriefingSection;
    one_on_ones_today: BriefingSection;
    currents_hotspots: BriefingSection;
    ceo_owned_items: BriefingSection;
    capital_summary?: BriefingSection;
  };
  top_priorities: TopPriority[];
}

export interface TopPriority {
  rank: number;
  title: string;
  reason: string;
  source: string;
  sourceId?: string | null;
  link?: string;
  actionId?: number | null;
}

export interface WeeklyCeoReview {
  generated_at: string;
  start_date: string;
  end_date: string;
  action_summary: {
    completed: number;
    dismissed: number;
    snoozed: number;
    unresolved: number;
    items: BriefingItem[];
  };
  blockers_summary: {
    opened: number;
    resolved: number;
    still_open: number;
  };
  tasks_summary: {
    completed: number;
    overdue: number;
    overdue_by_owner: { ownerName: string; ownerId: number | null; count: number }[];
  };
  commitments_summary: {
    created: number;
    completed: number;
    missed: number;
  };
  team_pulse: {
    blocked: number;
    quiet: number;
    needs_followup: number;
    total: number;
  };
  opportunity_movement: {
    new_deals: number;
    stage_changes: number;
    total_pipeline: number;
    won_this_week: number;
    lost_this_week: number;
  };
  capital_movement?: {
    permitted: false;
  } | {
    permitted: true;
    total_raises: number;
    total_investors: number;
    recent_updates: BriefingItem[];
  };
  top_wins: BriefingItem[];
  top_risks: BriefingItem[];
  leadership_agenda_preview: AgendaSection[];
}

export interface TeamMemberBriefing {
  generated_at: string;
  member: { id: number; name: string; email: string; role: string };
  signal: { label: string; reason: string };
  active_tasks: number;
  overdue_tasks: number;
  blocked_tasks: number;
  commitments_open: number;
  commitments_overdue: number;
  open_actions: BriefingItem[];
  recent_wins: BriefingItem[];
  talking_points: string[];
  support_questions: string[];
  operational_status: "Check-in needed" | "Blocked" | "On track" | "Needs follow-up" | "Quiet" | "Momentum";
}

export interface AgendaItem {
  title: string;
  owner: string | null;
  source: string;
  why_it_matters: string;
  suggested_prompt: string;
  linked_id?: string | null;
  linked_type?: string | null;
  priority: "must_discuss" | "if_time" | "fyi";
}

export interface AgendaSection {
  key: string;
  title: string;
  items: AgendaItem[];
}

export interface LeadershipMeetingAgenda {
  generated_at: string;
  sections: AgendaSection[];
  copy_text: string;
}

export interface BriefingActorUser {
  id: number;
  name: string;
  hasCapital: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function ageHours(ts: string | Date | null, now: Date): number {
  if (!ts) return 0;
  return Math.floor((now.getTime() - new Date(ts).getTime()) / (1000 * 60 * 60));
}

function ageDays(ts: string | Date | null, now: Date): number {
  return Math.floor(ageHours(ts, now) / 24);
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function severityFromAge(hours: number): BriefingSeverity {
  if (hours > 72) return "critical";
  if (hours > 48) return "urgent";
  if (hours > 24) return "watch";
  return "info";
}

// Neutral language map — no shaming words.
// Use: "Needs check-in", "Blocked", "Quiet", "Momentum", "Follow-up suggested"
function neutralSignal(overdue: number, blocked: number, lastActivityDays: number): {
  label: string;
  status: TeamMemberBriefing["operational_status"];
  reason: string;
} {
  if (blocked > 0) return { label: "Blocked", status: "Blocked", reason: `${blocked} item(s) need resolution to continue` };
  if (overdue >= 5) return { label: "Check-in needed", status: "Check-in needed", reason: `${overdue} items past due — check if prioritization support would help` };
  if (overdue > 0) return { label: "Needs follow-up", status: "Needs follow-up", reason: `${overdue} overdue item(s)` };
  if (lastActivityDays > 7) return { label: "Quiet", status: "Quiet", reason: `No recent activity signals in ${lastActivityDays} days` };
  if (lastActivityDays < 2) return { label: "Momentum", status: "Momentum", reason: "Recent activity detected" };
  return { label: "On track", status: "On track", reason: "Active and on schedule" };
}

// ── buildDailyCeoBriefing ─────────────────────────────────────────────────────

export async function buildDailyCeoBriefing(
  actorUser: BriefingActorUser,
  options: { date?: string } = {},
): Promise<DailyCeoBriefing> {
  const now = new Date();
  const dateStr = options.date ?? fmtDate(now);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const threeDaysOut = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const tomorrowEnd = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // 1. New blockers (tasks with status = 'blocked' OR non-empty blockers text, created in last 24h)
  const newBlockersRaw = await db.execute(sql.raw(`
    SELECT t.id, t.title, t.priority, t.created_at, t.updated_at,
           u.name AS owner_name, t.owner_user_id
    FROM tasks t
    LEFT JOIN users u ON u.id = t.owner_user_id
    WHERE t.archived = false
      AND t.created_at >= '${oneDayAgo.toISOString()}'
      AND (t.status = 'blocked' OR (t.blockers IS NOT NULL AND t.blockers <> ''))
    ORDER BY t.created_at DESC
    LIMIT 20
  `));

  // 2. Unresolved critical/high actions from Phase 6 queue
  const unresolvedActionsRaw = await db.execute(sql.raw(`
    SELECT q.id, q.title, q.priority, q.type, q.source_section,
           q.created_at, u.name AS assigned_name, q.assigned_to_user_id
    FROM ceo_action_queue q
    LEFT JOIN users u ON u.id = q.assigned_to_user_id
    WHERE q.created_by_user_id = ${actorUser.id}
      AND q.status NOT IN ('completed', 'dismissed')
      AND q.priority IN ('critical', 'high')
      AND (q.snoozed_until IS NULL OR q.snoozed_until <= NOW())
    ORDER BY CASE q.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
             q.created_at DESC
    LIMIT 10
  `));

  // 3. Overdue tasks (not completed, past due date)
  const overdueTasksRaw = await db.execute(sql.raw(`
    SELECT t.id, t.title, t.priority, t.due_date, t.status,
           u.name AS owner_name, t.owner_user_id
    FROM tasks t
    LEFT JOIN users u ON u.id = t.owner_user_id
    WHERE t.archived = false
      AND t.status NOT IN ('done', 'completed')
      AND t.due_date IS NOT NULL
      AND t.due_date < NOW()
    ORDER BY t.due_date ASC
    LIMIT 15
  `));

  // 4. Stale opportunities (not updated in 14+ days, not closed)
  const staleOppsRaw = await db.execute(sql.raw(`
    SELECT o.id, o.name, o.stage, o.updated_at,
           COALESCE(o.deal_value_hardware, 0) + COALESCE(o.deal_value_software, 0) + COALESCE(o.deal_value_services, 0) AS total_value,
           u.name AS owner_name, o.assigned_to_user_id
    FROM opportunities o
    LEFT JOIN users u ON u.id = o.assigned_to_user_id
    WHERE o.stage NOT IN ('closed_won', 'closed_lost')
      AND o.updated_at < '${fourteenDaysAgo.toISOString()}'
    ORDER BY o.updated_at ASC
    LIMIT 10
  `));

  // 5. Commitments due soon (from meeting_notes Phase 5 JSONB)
  const commitmentsDueRaw = await db.execute(sql.raw(`
    SELECT mn.id, mn.meeting_date, mn.ceo_user_id,
           mn.one_on_one_sections, u.name AS member_name, u.id AS member_id
    FROM meeting_notes mn
    LEFT JOIN users u ON u.id = mn.team_member_user_id
    WHERE mn.one_on_one_sections IS NOT NULL
      AND mn.meeting_date >= NOW() - INTERVAL '30 days'
    ORDER BY mn.meeting_date DESC
    LIMIT 20
  `));

  // 6. 1:1s today and tomorrow (users who have meeting_notes around today)
  const oneOnOnesTodayRaw = await db.execute(sql.raw(`
    SELECT u.id, u.name, u.email, u.role,
           MAX(mn.meeting_date) AS last_meeting
    FROM users u
    LEFT JOIN meeting_notes mn ON mn.team_member_user_id = u.id
    WHERE u.is_active = true
      AND u.role NOT IN ('admin', 'master_admin')
      AND (mn.meeting_date >= '${fmtDate(now)}'::date
           AND mn.meeting_date < '${fmtDate(tomorrowEnd)}'::date)
    GROUP BY u.id, u.name, u.email, u.role
    LIMIT 10
  `));

  // 7. Currents hotspots (public channels only — private excluded)
  const currentsHotspotsRaw = await db.execute(sql.raw(`
    SELECT cc.id, cc.name, cc.slug,
           COUNT(cm.id) FILTER (WHERE cm.created_at >= NOW() - INTERVAL '24 hours') AS messages_24h,
           MAX(cm.created_at) AS last_message_at
    FROM current_channels cc
    LEFT JOIN current_messages cm ON cm.channel_id = cc.id
    WHERE cc.is_private = false
      AND cc.type != 'dm'
    GROUP BY cc.id, cc.name, cc.slug
    HAVING COUNT(cm.id) FILTER (WHERE cm.created_at >= NOW() - INTERVAL '24 hours') > 0
    ORDER BY messages_24h DESC
    LIMIT 5
  `));

  // 8. CEO-owned items (tasks/actions assigned to or created by CEO)
  const ceoOwnedRaw = await db.execute(sql.raw(`
    SELECT t.id, t.title, t.status, t.priority, t.due_date, t.updated_at
    FROM tasks t
    WHERE t.owner_user_id = ${actorUser.id}
      AND t.archived = false
      AND t.status NOT IN ('done', 'completed')
    ORDER BY t.due_date ASC NULLS LAST
    LIMIT 10
  `));

  // 9. Capital section (only if hasCapital)
  let capitalItems: BriefingItem[] = [];
  if (actorUser.hasCapital) {
    const capitalRaw = await db.execute(sql.raw(`
      SELECT ci.id, ci.investor_name AS title, ci.commitment_amount,
             ci.stage, ci.updated_at
      FROM capital_raises cr
      JOIN capital_investors ci ON ci.raise_id = cr.id
      WHERE ci.updated_at >= NOW() - INTERVAL '7 days'
      ORDER BY ci.updated_at DESC
      LIMIT 5
    `));
    capitalItems = (capitalRaw.rows as any[]).map((r: any) => ({
      id: String(r.id),
      title: r.title || "Investor update",
      status: r.stage || null,
      metadata: { commitment_amount: r.commitment_amount },
    }));
  }

  // 10. Top 5 priority actions from queue
  const topActionsRaw = await db.execute(sql.raw(`
    SELECT q.id, q.title, q.priority, q.type, q.source_section, q.created_at
    FROM ceo_action_queue q
    WHERE q.created_by_user_id = ${actorUser.id}
      AND q.status NOT IN ('completed', 'dismissed')
      AND (q.snoozed_until IS NULL OR q.snoozed_until <= NOW())
    ORDER BY CASE q.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
             q.created_at ASC
    LIMIT 5
  `));

  // ── Assemble sections ──────────────────────────────────────────────────────

  const newBlockers = (newBlockersRaw.rows as any[]).map((r: any) => ({
    id: String(r.id),
    title: r.title,
    owner: r.owner_name ?? null,
    ownerId: r.owner_user_id ? Number(r.owner_user_id) : null,
    ageHours: ageHours(r.created_at, now),
    severity: severityFromAge(ageHours(r.created_at, now)),
    link: `/tasks/${r.id}`,
  }));

  const unresolvedActions = (unresolvedActionsRaw.rows as any[]).map((r: any) => ({
    id: String(r.id),
    title: r.title,
    owner: r.assigned_name ?? null,
    ownerId: r.assigned_to_user_id ? Number(r.assigned_to_user_id) : null,
    source: r.source_section ?? null,
    severity: (r.priority === "critical" ? "critical" : "urgent") as BriefingSeverity,
    ageHours: ageHours(r.created_at, now),
    link: `/today`,
    metadata: { actionId: r.id, type: r.type },
  }));

  const overdueTasks = (overdueTasksRaw.rows as any[]).map((r: any) => ({
    id: String(r.id),
    title: r.title,
    owner: r.owner_name ?? null,
    ownerId: r.owner_user_id ? Number(r.owner_user_id) : null,
    dueDate: r.due_date ? new Date(r.due_date).toISOString() : null,
    ageDays: r.due_date ? ageDays(r.due_date, now) : 0,
    severity: severityFromAge(r.due_date ? ageHours(r.due_date, now) : 0),
    link: `/tasks/${r.id}`,
  }));

  const staleOpps = (staleOppsRaw.rows as any[]).map((r: any) => ({
    id: String(r.id),
    title: r.name,
    owner: r.owner_name ?? null,
    ownerId: r.assigned_to_user_id ? Number(r.assigned_to_user_id) : null,
    status: r.stage ?? null,
    ageDays: ageDays(r.updated_at, now),
    severity: "watch" as BriefingSeverity,
    link: `/opportunities/${r.id}`,
    metadata: { totalValue: r.total_value },
  }));

  // Parse commitments from Phase 5 JSONB — due within 3 days
  const commitmentsDueSoon: BriefingItem[] = [];
  for (const row of commitmentsDueRaw.rows as any[]) {
    if (!row.one_on_one_sections) continue;
    try {
      const sections = typeof row.one_on_one_sections === "string"
        ? JSON.parse(row.one_on_one_sections)
        : row.one_on_one_sections;
      const commitments = sections.commitments ?? sections.action_items ?? [];
      for (const c of Array.isArray(commitments) ? commitments : []) {
        if (c.due_date && new Date(c.due_date) <= threeDaysOut && c.status !== "completed") {
          commitmentsDueSoon.push({
            id: `commitment-${row.id}-${c.id ?? Math.random()}`,
            title: c.title ?? c.text ?? String(c),
            owner: row.member_name ?? null,
            ownerId: row.member_id ? Number(row.member_id) : null,
            dueDate: c.due_date,
            severity: new Date(c.due_date) < now ? "urgent" : "watch",
            link: `/today`,
          });
        }
      }
    } catch { /* skip malformed JSONB */ }
  }

  const oneOnOnesToday = (oneOnOnesTodayRaw.rows as any[]).map((r: any) => ({
    id: String(r.id),
    title: `1:1 with ${r.name}`,
    owner: r.name,
    ownerId: Number(r.id),
    link: `/today`,
  }));

  const currentsHotspots = (currentsHotspotsRaw.rows as any[]).map((r: any) => ({
    id: String(r.id),
    title: `#${r.slug || r.name} — ${r.messages_24h} messages in 24h`,
    source: "currents",
    severity: Number(r.messages_24h) > 20 ? "urgent" as BriefingSeverity : "watch" as BriefingSeverity,
    link: `/current?channel=${r.slug}`,
    metadata: { messages24h: r.messages_24h },
  }));

  const ceoOwned = (ceoOwnedRaw.rows as any[]).map((r: any) => ({
    id: String(r.id),
    title: r.title,
    status: r.status ?? null,
    dueDate: r.due_date ? new Date(r.due_date).toISOString() : null,
    severity: r.due_date && new Date(r.due_date) < now ? "urgent" as BriefingSeverity : "info" as BriefingSeverity,
    link: `/tasks/${r.id}`,
  }));

  // Top 5 priorities
  const topPriorities: TopPriority[] = (topActionsRaw.rows as any[]).map((r: any, idx) => ({
    rank: idx + 1,
    title: r.title,
    reason: `${r.priority} priority action from ${r.source_section ?? "cockpit"}`,
    source: r.source_section ?? "ceo_action_queue",
    sourceId: String(r.id),
    actionId: Number(r.id),
    link: `/today`,
  }));

  const result: DailyCeoBriefing = {
    generated_at: now.toISOString(),
    date: dateStr,
    sections: {
      new_blockers: {
        title: "New Blockers (Last 24h)",
        severity: newBlockers.some(b => b.severity === "critical") ? "critical" : newBlockers.length > 0 ? "urgent" : "info",
        items: newBlockers,
        empty_state: "No new blockers in the last 24 hours.",
        reason: newBlockers.length > 0
          ? `${newBlockers.length} new blocker(s) opened since yesterday`
          : "No new blockers to review.",
      },
      unresolved_actions: {
        title: "Unresolved High-Priority Actions",
        severity: unresolvedActions.some(a => a.severity === "critical") ? "critical" : unresolvedActions.length > 0 ? "urgent" : "info",
        items: unresolvedActions,
        empty_state: "No unresolved critical or high actions.",
        reason: unresolvedActions.length > 0
          ? `${unresolvedActions.length} critical/high action(s) still open in the queue`
          : "Queue is clear of critical/high items.",
      },
      overdue_tasks: {
        title: "Overdue Tasks",
        severity: overdueTasks.length >= 10 ? "critical" : overdueTasks.length >= 5 ? "urgent" : overdueTasks.length > 0 ? "watch" : "info",
        items: overdueTasks,
        empty_state: "No overdue tasks. All tasks are on schedule.",
        reason: overdueTasks.length > 0
          ? `${overdueTasks.length} task(s) past due date`
          : "All tasks are on schedule.",
      },
      stale_opportunities: {
        title: "Stale Opportunities",
        severity: staleOpps.length >= 5 ? "urgent" : staleOpps.length > 0 ? "watch" : "info",
        items: staleOpps,
        empty_state: "All active opportunities have recent updates.",
        reason: staleOpps.length > 0
          ? `${staleOpps.length} deal(s) with no update in 14+ days`
          : "Pipeline is moving — no stale deals.",
      },
      commitments_due_soon: {
        title: "Commitments Due Soon",
        severity: commitmentsDueSoon.some(c => c.severity === "urgent") ? "urgent" : commitmentsDueSoon.length > 0 ? "watch" : "info",
        items: commitmentsDueSoon,
        empty_state: "No commitments due in the next 3 days.",
        reason: commitmentsDueSoon.length > 0
          ? `${commitmentsDueSoon.length} commitment(s) due within 3 days`
          : "No imminent commitment deadlines.",
      },
      one_on_ones_today: {
        title: "1:1s Today & Tomorrow",
        severity: "info",
        items: oneOnOnesToday,
        empty_state: "No 1:1s scheduled today or tomorrow.",
        reason: oneOnOnesToday.length > 0
          ? `${oneOnOnesToday.length} 1:1(s) on the calendar`
          : "No 1:1s coming up in the next 48 hours.",
      },
      currents_hotspots: {
        title: "Currents Hotspots (Public Channels Only)",
        severity: currentsHotspots.some(h => h.severity === "urgent") ? "urgent" : "info",
        items: currentsHotspots,
        empty_state: "No high-activity channels in the last 24 hours.",
        reason: "Private channels excluded. Shows channels with elevated message volume.",
      },
      ceo_owned_items: {
        title: "CEO-Owned Items",
        severity: ceoOwned.some(c => c.severity === "urgent") ? "urgent" : "info",
        items: ceoOwned,
        empty_state: "No open items assigned to you.",
        reason: ceoOwned.length > 0
          ? `${ceoOwned.length} open item(s) owned by you`
          : "No open CEO-owned items.",
      },
      ...(actorUser.hasCapital && {
        capital_summary: {
          title: "Capital Activity (Last 7 Days)",
          severity: "info",
          items: capitalItems,
          empty_state: "No capital activity in the last 7 days.",
          reason: "Capital section visible to permitted users only.",
        },
      }),
    },
    top_priorities: topPriorities,
  };

  return result;
}

// ── buildWeeklyCeoReview ───────────────────────────────────────────────────────

export async function buildWeeklyCeoReview(
  actorUser: BriefingActorUser,
  options: { startDate?: string; endDate?: string } = {},
): Promise<WeeklyCeoReview> {
  const now = new Date();
  const endDate = options.endDate ? new Date(options.endDate) : now;
  const startDate = options.startDate
    ? new Date(options.startDate)
    : new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

  const startIso = startDate.toISOString();
  const endIso = endDate.toISOString();

  // Action summary for the week
  const actionSummaryRaw = await db.execute(sql.raw(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE status = 'dismissed') AS dismissed,
      COUNT(*) FILTER (WHERE status = 'snoozed') AS snoozed,
      COUNT(*) FILTER (WHERE status NOT IN ('completed','dismissed')) AS unresolved
    FROM ceo_action_queue
    WHERE created_by_user_id = ${actorUser.id}
      AND created_at >= '${startIso}' AND created_at <= '${endIso}'
  `));

  const actionItemsRaw = await db.execute(sql.raw(`
    SELECT q.id, q.title, q.status, q.priority, q.type, q.source_section,
           q.created_at, q.completed_at, u.name AS assigned_name
    FROM ceo_action_queue q
    LEFT JOIN users u ON u.id = q.assigned_to_user_id
    WHERE q.created_by_user_id = ${actorUser.id}
      AND q.created_at >= '${startIso}' AND q.created_at <= '${endIso}'
    ORDER BY q.created_at DESC
    LIMIT 30
  `));

  const actionSummary = actionSummaryRaw.rows[0] as any ?? {};

  // Blockers summary
  const blockersSummaryRaw = await db.execute(sql.raw(`
    SELECT
      COUNT(*) FILTER (WHERE created_at >= '${startIso}') AS opened,
      COUNT(*) FILTER (WHERE status NOT IN ('done','completed') AND created_at < '${startIso}') AS still_open,
      COUNT(*) FILTER (WHERE status IN ('done','completed') AND updated_at >= '${startIso}') AS resolved
    FROM tasks
    WHERE archived = false
      AND (status = 'blocked' OR (blockers IS NOT NULL AND blockers <> ''))
  `));
  const blockersSummary = blockersSummaryRaw.rows[0] as any ?? {};

  // Tasks summary
  const tasksSummaryRaw = await db.execute(sql.raw(`
    SELECT
      COUNT(*) FILTER (WHERE status IN ('done','completed') AND updated_at >= '${startIso}') AS completed,
      COUNT(*) FILTER (WHERE status NOT IN ('done','completed') AND due_date < '${endIso}') AS overdue
    FROM tasks WHERE archived = false
  `));
  const tasksSummary = tasksSummaryRaw.rows[0] as any ?? {};

  const overdueByOwnerRaw = await db.execute(sql.raw(`
    SELECT u.name AS owner_name, t.owner_user_id,
           COUNT(*) AS overdue_count
    FROM tasks t
    LEFT JOIN users u ON u.id = t.owner_user_id
    WHERE t.archived = false
      AND t.status NOT IN ('done','completed')
      AND t.due_date < '${endIso}'
    GROUP BY u.name, t.owner_user_id
    ORDER BY overdue_count DESC
    LIMIT 10
  `));

  // Commitments summary — from Phase 5 notes created this week
  const commitmentsSummaryRaw = await db.execute(sql.raw(`
    SELECT one_on_one_sections
    FROM meeting_notes
    WHERE one_on_one_sections IS NOT NULL
      AND meeting_date >= '${startIso}'
      AND meeting_date <= '${endIso}'
  `));

  let commitmentsCreated = 0;
  let commitmentsCompleted = 0;
  let commitmentsMissed = 0;
  for (const row of commitmentsSummaryRaw.rows as any[]) {
    try {
      const sections = typeof row.one_on_one_sections === "string"
        ? JSON.parse(row.one_on_one_sections)
        : row.one_on_one_sections;
      const list = sections.commitments ?? sections.action_items ?? [];
      for (const c of Array.isArray(list) ? list : []) {
        commitmentsCreated++;
        if (c.status === "completed") commitmentsCompleted++;
        else if (c.due_date && new Date(c.due_date) < now && c.status !== "completed") commitmentsMissed++;
      }
    } catch { /* skip */ }
  }

  // Team pulse snapshot
  const teamPulseRaw = await db.execute(sql.raw(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'blocked' OR (blockers IS NOT NULL AND blockers <> '')) AS blocked_tasks,
      COUNT(DISTINCT owner_user_id) AS total_owners
    FROM tasks WHERE archived = false
  `));
  const teamPulseRow = teamPulseRaw.rows[0] as any ?? {};

  const teamPulseUserRaw = await db.execute(sql.raw(`
    SELECT u.id, u.name,
      COUNT(t.id) FILTER (WHERE t.status = 'blocked') AS blocked_count,
      COUNT(t.id) FILTER (WHERE t.status NOT IN ('done','completed') AND t.due_date < NOW()) AS overdue_count,
      MAX(t.updated_at) AS last_activity
    FROM users u
    LEFT JOIN tasks t ON t.owner_user_id = u.id AND t.archived = false
    WHERE u.is_active = true AND u.role NOT IN ('admin','master_admin')
    GROUP BY u.id, u.name
    HAVING COUNT(t.id) > 0
  `));

  const teamPulse = {
    blocked: (teamPulseUserRaw.rows as any[]).filter((r: any) => Number(r.blocked_count) > 0).length,
    quiet: (teamPulseUserRaw.rows as any[]).filter((r: any) =>
      !r.last_activity || new Date(r.last_activity) < new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000)
    ).length,
    needs_followup: (teamPulseUserRaw.rows as any[]).filter((r: any) => Number(r.overdue_count) > 0).length,
    total: (teamPulseUserRaw.rows as any[]).length,
  };

  // Opportunity movement
  const oppMovementRaw = await db.execute(sql.raw(`
    SELECT
      COUNT(*) FILTER (WHERE created_at >= '${startIso}') AS new_deals,
      COUNT(*) FILTER (WHERE updated_at >= '${startIso}' AND stage = 'closed_won') AS won_this_week,
      COUNT(*) FILTER (WHERE updated_at >= '${startIso}' AND stage = 'closed_lost') AS lost_this_week,
      SUM(COALESCE(deal_value_hardware,0)+COALESCE(deal_value_software,0)+COALESCE(deal_value_services,0))
        FILTER (WHERE stage NOT IN ('closed_won','closed_lost')) AS total_pipeline
    FROM opportunities
  `));

  const oppRow = oppMovementRaw.rows[0] as any ?? {};
  const stageChangesRaw = await db.execute(sql.raw(`
    SELECT COUNT(*) AS stage_changes
    FROM deal_stage_history
    WHERE changed_at >= '${startIso}' AND changed_at <= '${endIso}'
  `));
  const stageChanges = Number((stageChangesRaw.rows[0] as any)?.stage_changes ?? 0);

  // Capital movement (only if hasCapital)
  let capitalMovement: WeeklyCeoReview["capital_movement"] = { permitted: false };
  if (actorUser.hasCapital) {
    const capRaw = await db.execute(sql.raw(`
      SELECT
        COUNT(DISTINCT cr.id) AS total_raises,
        COUNT(DISTINCT ci.id) AS total_investors,
        ci.id, ci.investor_name, ci.stage, ci.updated_at
      FROM capital_raises cr
      LEFT JOIN capital_investors ci ON ci.raise_id = cr.id
      WHERE ci.updated_at >= '${startIso}'
      GROUP BY ci.id, ci.investor_name, ci.stage, ci.updated_at
      LIMIT 5
    `));
    capitalMovement = {
      permitted: true,
      total_raises: (capRaw.rows as any[]).length > 0 ? Number((capRaw.rows[0] as any).total_raises ?? 0) : 0,
      total_investors: (capRaw.rows as any[]).length > 0 ? Number((capRaw.rows[0] as any).total_investors ?? 0) : 0,
      recent_updates: (capRaw.rows as any[]).map((r: any) => ({
        id: String(r.id),
        title: r.investor_name ?? "Investor update",
        status: r.stage ?? null,
      })),
    };
  }

  // Top wins: completed tasks or won opportunities this week
  const topWinsRaw = await db.execute(sql.raw(`
    (SELECT 'task' AS source, id::text, title, completed_at AS win_date
     FROM tasks WHERE status IN ('done','completed') AND completed_at >= '${startIso}' AND archived = false ORDER BY completed_at DESC LIMIT 5)
    UNION ALL
    (SELECT 'opportunity' AS source, id::text, name AS title, updated_at AS win_date
     FROM opportunities WHERE stage = 'closed_won' AND updated_at >= '${startIso}' ORDER BY updated_at DESC LIMIT 5)
    ORDER BY win_date DESC LIMIT 10
  `));

  // Top risks: critical actions + overdue tasks with high priority
  const topRisksRaw = await db.execute(sql.raw(`
    (SELECT 'action' AS source, id::text, title, created_at AS risk_date
     FROM ceo_action_queue
     WHERE created_by_user_id = ${actorUser.id}
       AND priority = 'critical'
       AND status NOT IN ('completed','dismissed')
     ORDER BY created_at DESC LIMIT 5)
    UNION ALL
    (SELECT 'task' AS source, id::text, title, due_date AS risk_date
     FROM tasks
     WHERE priority = 'critical' AND status NOT IN ('done','completed') AND archived = false
       AND due_date < NOW()
     ORDER BY due_date ASC LIMIT 5)
    ORDER BY risk_date DESC LIMIT 10
  `));

  // Preview leadership agenda
  const agendaPreview = await _buildAgendaSections(actorUser, now);

  return {
    generated_at: now.toISOString(),
    start_date: fmtDate(startDate),
    end_date: fmtDate(endDate),
    action_summary: {
      completed: Number(actionSummary.completed ?? 0),
      dismissed: Number(actionSummary.dismissed ?? 0),
      snoozed: Number(actionSummary.snoozed ?? 0),
      unresolved: Number(actionSummary.unresolved ?? 0),
      items: (actionItemsRaw.rows as any[]).map((r: any) => ({
        id: String(r.id),
        title: r.title,
        status: r.status,
        severity: (r.priority === "critical" ? "critical" : "watch") as BriefingSeverity,
        owner: r.assigned_name ?? null,
        metadata: { type: r.type, section: r.source_section },
      })),
    },
    blockers_summary: {
      opened: Number(blockersSummary.opened ?? 0),
      resolved: Number(blockersSummary.resolved ?? 0),
      still_open: Number(blockersSummary.still_open ?? 0),
    },
    tasks_summary: {
      completed: Number(tasksSummary.completed ?? 0),
      overdue: Number(tasksSummary.overdue ?? 0),
      overdue_by_owner: (overdueByOwnerRaw.rows as any[]).map((r: any) => ({
        ownerName: r.owner_name ?? "Unassigned",
        ownerId: r.owner_user_id ? Number(r.owner_user_id) : null,
        count: Number(r.overdue_count ?? 0),
      })),
    },
    commitments_summary: {
      created: commitmentsCreated,
      completed: commitmentsCompleted,
      missed: commitmentsMissed,
    },
    team_pulse: teamPulse,
    opportunity_movement: {
      new_deals: Number(oppRow.new_deals ?? 0),
      stage_changes: stageChanges,
      total_pipeline: Number(oppRow.total_pipeline ?? 0),
      won_this_week: Number(oppRow.won_this_week ?? 0),
      lost_this_week: Number(oppRow.lost_this_week ?? 0),
    },
    capital_movement: capitalMovement,
    top_wins: (topWinsRaw.rows as any[]).map((r: any) => ({
      id: String(r.id),
      title: r.title,
      source: r.source,
      severity: "info" as BriefingSeverity,
    })),
    top_risks: (topRisksRaw.rows as any[]).map((r: any) => ({
      id: String(r.id),
      title: r.title,
      source: r.source,
      severity: "critical" as BriefingSeverity,
    })),
    leadership_agenda_preview: agendaPreview,
  };
}

// ── buildTeamMemberBriefing ────────────────────────────────────────────────────

export async function buildTeamMemberBriefing(
  memberUserId: number,
  actorUser: BriefingActorUser,
): Promise<TeamMemberBriefing> {
  const now = new Date();

  // Member info
  const memberRaw = await db.execute(sql.raw(`
    SELECT id, name, email, role, department, job_title
    FROM users WHERE id = ${memberUserId} AND is_active = true LIMIT 1
  `));
  const member = memberRaw.rows[0] as any;
  if (!member) throw new Error("Team member not found");

  // Task counts
  const taskCountsRaw = await db.execute(sql.raw(`
    SELECT
      COUNT(*) FILTER (WHERE status NOT IN ('done','completed')) AS active,
      COUNT(*) FILTER (WHERE status NOT IN ('done','completed') AND due_date < NOW()) AS overdue,
      COUNT(*) FILTER (WHERE status = 'blocked' OR (blockers IS NOT NULL AND blockers <> '')) AS blocked,
      MAX(updated_at) AS last_activity
    FROM tasks
    WHERE owner_user_id = ${memberUserId} AND archived = false
  `));
  const taskCounts = taskCountsRaw.rows[0] as any ?? {};
  const activeTasks = Number(taskCounts.active ?? 0);
  const overdueTasks = Number(taskCounts.overdue ?? 0);
  const blockedTasks = Number(taskCounts.blocked ?? 0);
  const lastActivityDays = taskCounts.last_activity ? ageDays(taskCounts.last_activity, now) : 99;

  // Commitments from 1:1 notes
  const notesRaw = await db.execute(sql.raw(`
    SELECT one_on_one_sections, meeting_date
    FROM meeting_notes
    WHERE (team_member_user_id = ${memberUserId} OR ceo_user_id = ${memberUserId})
      AND one_on_one_sections IS NOT NULL
    ORDER BY meeting_date DESC LIMIT 5
  `));

  let commitmentsOpen = 0;
  let commitmentsOverdue = 0;
  const recentCommitments: string[] = [];
  for (const row of notesRaw.rows as any[]) {
    try {
      const sections = typeof row.one_on_one_sections === "string"
        ? JSON.parse(row.one_on_one_sections)
        : row.one_on_one_sections;
      const list = sections.commitments ?? sections.action_items ?? [];
      for (const c of Array.isArray(list) ? list : []) {
        if (c.status !== "completed") {
          commitmentsOpen++;
          if (c.due_date && new Date(c.due_date) < now) commitmentsOverdue++;
          if (recentCommitments.length < 3 && (c.title || c.text)) {
            recentCommitments.push(c.title ?? c.text);
          }
        }
      }
    } catch { /* skip */ }
  }

  // Open CEO actions involving this person
  const openActionsRaw = await db.execute(sql.raw(`
    SELECT q.id, q.title, q.priority, q.type, q.status, q.source_section, q.created_at
    FROM ceo_action_queue q
    WHERE q.assigned_to_user_id = ${memberUserId}
      AND q.status NOT IN ('completed','dismissed')
      AND (q.snoozed_until IS NULL OR q.snoozed_until <= NOW())
    ORDER BY CASE q.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END
    LIMIT 5
  `));

  // Recent wins (completed tasks in last 14 days)
  const recentWinsRaw = await db.execute(sql.raw(`
    SELECT id, title, completed_at
    FROM tasks
    WHERE owner_user_id = ${memberUserId}
      AND status IN ('done','completed')
      AND completed_at >= NOW() - INTERVAL '14 days'
      AND archived = false
    ORDER BY completed_at DESC LIMIT 5
  `));

  const { label, status, reason } = neutralSignal(overdueTasks, blockedTasks, lastActivityDays);

  // Neutral talking points — no shaming language
  const talkingPoints: string[] = [];
  if (blockedTasks > 0) talkingPoints.push(`Check in on ${blockedTasks} blocked item(s) — what would help move these forward?`);
  if (commitmentsOverdue > 0) talkingPoints.push(`Review ${commitmentsOverdue} commitment(s) that are past their target date.`);
  if (overdueTasks > 0 && !blockedTasks) talkingPoints.push(`${overdueTasks} item(s) past due — check if any have dependencies or need prioritization.`);
  if (recentCommitments.length > 0) {
    talkingPoints.push(`Follow up on commitments: ${recentCommitments.slice(0, 2).join(", ")}`);
  }
  if (lastActivityDays > 7) talkingPoints.push("Check in on current focus — has anything shifted?");
  if (talkingPoints.length === 0) talkingPoints.push("Quick pulse check — anything coming up that needs support?");

  // Neutral support questions
  const supportQuestions = [
    "Is there anything I can unblock for you this week?",
    "Are you getting the context you need from other teams?",
    "What would make your work easier right now?",
  ];
  if (blockedTasks > 0) supportQuestions.unshift("What's blocking these items, and how can I help resolve it?");
  if (lastActivityDays > 7) supportQuestions.push("Is there a shift in priorities I should know about?");

  return {
    generated_at: now.toISOString(),
    member: { id: memberUserId, name: member.name, email: member.email, role: member.role },
    signal: { label, reason },
    active_tasks: activeTasks,
    overdue_tasks: overdueTasks,
    blocked_tasks: blockedTasks,
    commitments_open: commitmentsOpen,
    commitments_overdue: commitmentsOverdue,
    open_actions: (openActionsRaw.rows as any[]).map((r: any) => ({
      id: String(r.id),
      title: r.title,
      status: r.status,
      severity: r.priority === "critical" ? "critical" as BriefingSeverity : "watch" as BriefingSeverity,
      source: r.source_section ?? null,
      link: `/today`,
      metadata: { actionId: r.id, type: r.type },
    })),
    recent_wins: (recentWinsRaw.rows as any[]).map((r: any) => ({
      id: String(r.id),
      title: r.title,
      source: "task",
      severity: "info" as BriefingSeverity,
    })),
    talking_points: talkingPoints,
    support_questions: supportQuestions.slice(0, 4),
    operational_status: status,
  };
}

// ── _buildAgendaSections (shared helper) ──────────────────────────────────────

async function _buildAgendaSections(
  actorUser: BriefingActorUser,
  now: Date,
): Promise<AgendaSection[]> {

  // Decisions needed: critical unresolved actions
  const decisionsRaw = await db.execute(sql.raw(`
    SELECT q.id, q.title, q.type, q.source_section, u.name AS assigned_name, q.assigned_to_user_id
    FROM ceo_action_queue q
    LEFT JOIN users u ON u.id = q.assigned_to_user_id
    WHERE q.created_by_user_id = ${actorUser.id}
      AND q.priority = 'critical'
      AND q.status NOT IN ('completed','dismissed')
      AND (q.snoozed_until IS NULL OR q.snoozed_until <= NOW())
    ORDER BY q.created_at ASC LIMIT 5
  `));

  // Blockers to clear
  const blockersRaw = await db.execute(sql.raw(`
    SELECT t.id, t.title, u.name AS owner_name, t.owner_user_id,
           t.due_date, t.created_at
    FROM tasks t
    LEFT JOIN users u ON u.id = t.owner_user_id
    WHERE t.archived = false
      AND (t.status = 'blocked' OR (t.blockers IS NOT NULL AND t.blockers <> ''))
    ORDER BY t.due_date ASC NULLS LAST, t.created_at ASC
    LIMIT 5
  `));

  // Commitments due this week
  const commitsDueRaw = await db.execute(sql.raw(`
    SELECT mn.one_on_one_sections, u.name AS member_name
    FROM meeting_notes mn
    LEFT JOIN users u ON u.id = mn.team_member_user_id
    WHERE mn.one_on_one_sections IS NOT NULL
      AND mn.meeting_date >= NOW() - INTERVAL '30 days'
    LIMIT 10
  `));

  const commitmentItems: AgendaItem[] = [];
  for (const row of commitsDueRaw.rows as any[]) {
    try {
      const sections = typeof row.one_on_one_sections === "string"
        ? JSON.parse(row.one_on_one_sections)
        : row.one_on_one_sections;
      const list = sections.commitments ?? sections.action_items ?? [];
      for (const c of (Array.isArray(list) ? list : []).slice(0, 3)) {
        if (c.status !== "completed" && (c.title || c.text)) {
          commitmentItems.push({
            title: c.title ?? c.text,
            owner: row.member_name ?? null,
            source: "one_on_one_note",
            why_it_matters: "Outstanding commitment from 1:1",
            suggested_prompt: `Has this been completed? If not, what's the current status and next step?`,
            priority: c.due_date && new Date(c.due_date) < now ? "must_discuss" : "if_time",
          });
        }
      }
    } catch { /* skip */ }
  }

  // Customer / revenue movement
  const revenueRaw = await db.execute(sql.raw(`
    SELECT o.id, o.name, o.stage, u.name AS owner_name,
           COALESCE(o.deal_value_hardware,0)+COALESCE(o.deal_value_software,0)+COALESCE(o.deal_value_services,0) AS total_value,
           o.updated_at
    FROM opportunities o
    LEFT JOIN users u ON u.id = o.assigned_to_user_id
    WHERE o.stage NOT IN ('closed_won','closed_lost')
      AND o.updated_at >= NOW() - INTERVAL '7 days'
    ORDER BY total_value DESC LIMIT 5
  `));

  // Capital movement (only if hasCapital)
  const capitalItems: AgendaItem[] = [];
  if (actorUser.hasCapital) {
    const capRaw = await db.execute(sql.raw(`
      SELECT ci.id, ci.investor_name, ci.stage, ci.commitment_amount, ci.updated_at
      FROM capital_investors ci
      JOIN capital_raises cr ON cr.id = ci.raise_id
      WHERE ci.updated_at >= NOW() - INTERVAL '7 days'
      ORDER BY ci.updated_at DESC LIMIT 3
    `));
    for (const r of capRaw.rows as any[]) {
      capitalItems.push({
        title: `Capital update: ${r.investor_name}`,
        owner: actorUser.name,
        source: "capital_investors",
        why_it_matters: `Investor in ${r.stage ?? "active"} stage with recent activity`,
        suggested_prompt: "What is the latest status and next step with this investor?",
        priority: "must_discuss",
      });
    }
  }

  // Product / ops risks (high-priority overdue tasks)
  const risksRaw = await db.execute(sql.raw(`
    SELECT t.id, t.title, u.name AS owner_name, t.due_date, t.priority
    FROM tasks t
    LEFT JOIN users u ON u.id = t.owner_user_id
    WHERE t.archived = false
      AND t.priority IN ('critical','high')
      AND t.status NOT IN ('done','completed')
      AND t.due_date < NOW()
    ORDER BY t.due_date ASC LIMIT 5
  `));

  // Wins this week
  const winsRaw = await db.execute(sql.raw(`
    (SELECT 'task' AS source, id::text, title, completed_at AS ts, NULL::text AS owner_name FROM tasks WHERE status IN ('done','completed') AND completed_at >= NOW() - INTERVAL '7 days' AND archived = false ORDER BY completed_at DESC LIMIT 3)
    UNION ALL
    (SELECT 'opportunity' AS source, id::text, name AS title, updated_at AS ts, NULL::text AS owner_name FROM opportunities WHERE stage = 'closed_won' AND updated_at >= NOW() - INTERVAL '7 days' ORDER BY updated_at DESC LIMIT 3)
    LIMIT 5
  `));

  const sections: AgendaSection[] = [
    {
      key: "decisions_needed",
      title: "Decisions Needed",
      items: (decisionsRaw.rows as any[]).map((r: any) => ({
        title: r.title,
        owner: r.assigned_name ?? actorUser.name,
        source: r.source_section ?? "ceo_action_queue",
        why_it_matters: "Critical-priority unresolved action requiring a decision",
        suggested_prompt: "What decision is needed here, and who owns the next step?",
        linked_id: String(r.id),
        linked_type: "ceo_action",
        priority: "must_discuss" as const,
      })),
    },
    {
      key: "blockers_to_clear",
      title: "Blockers to Clear",
      items: (blockersRaw.rows as any[]).map((r: any) => ({
        title: r.title,
        owner: r.owner_name ?? null,
        source: "tasks",
        why_it_matters: "Unresolved blocker preventing team progress",
        suggested_prompt: "What is blocking this, and what does resolution look like?",
        linked_id: String(r.id),
        linked_type: "task",
        priority: "must_discuss" as const,
      })),
    },
    {
      key: "commitments_due",
      title: "Commitments Due",
      items: commitmentItems.slice(0, 5),
    },
    {
      key: "customer_revenue",
      title: "Customer & Revenue Movement",
      items: (revenueRaw.rows as any[]).map((r: any) => ({
        title: `${r.name} — ${r.stage}`,
        owner: r.owner_name ?? null,
        source: "opportunities",
        why_it_matters: `Active deal with recent movement — $${Math.round(Number(r.total_value ?? 0)).toLocaleString()} total value`,
        suggested_prompt: "What is the current status and most important next step to advance this deal?",
        linked_id: String(r.id),
        linked_type: "opportunity",
        priority: "if_time" as const,
      })),
    },
    ...(actorUser.hasCapital && capitalItems.length > 0 ? [{
      key: "capital_funding",
      title: "Capital & Funding",
      items: capitalItems,
    }] : []),
    {
      key: "product_ops_risks",
      title: "Product & Operations Risks",
      items: (risksRaw.rows as any[]).map((r: any) => ({
        title: r.title,
        owner: r.owner_name ?? null,
        source: "tasks",
        why_it_matters: `High-priority item past due — may need escalation`,
        suggested_prompt: "Is this actively being worked? What is blocking completion?",
        linked_id: String(r.id),
        linked_type: "task",
        priority: "must_discuss" as const,
      })),
    },
    {
      key: "wins",
      title: "Wins",
      items: (winsRaw.rows as any[]).map((r: any) => ({
        title: r.title,
        owner: r.owner_name ?? null,
        source: r.source,
        why_it_matters: "Completed this week — worth acknowledging",
        suggested_prompt: "What made this successful, and can we replicate the approach?",
        priority: "fyi" as const,
      })),
    },
    {
      key: "follow_ups",
      title: "Follow-Ups from Last Meeting",
      items: [],
    },
  ];

  return sections;
}

// ── buildLeadershipMeetingAgenda ──────────────────────────────────────────────

export async function buildLeadershipMeetingAgenda(
  actorUser: BriefingActorUser,
): Promise<LeadershipMeetingAgenda> {
  const now = new Date();
  const sections = await _buildAgendaSections(actorUser, now);

  // Build copyable text — Never sends. Returns copyable text only.
  const lines: string[] = [
    `LEADERSHIP MEETING AGENDA — ${fmtDate(now).toUpperCase()}`,
    `Generated: ${now.toLocaleString()}`,
    "",
  ];
  for (const section of sections) {
    if (section.items.length === 0) continue;
    lines.push(`═══ ${section.title.toUpperCase()} ═══`);
    for (const item of section.items) {
      lines.push(`▸ ${item.title}${item.owner ? ` (Owner: ${item.owner})` : ""}`);
      lines.push(`  Why: ${item.why_it_matters}`);
      lines.push(`  Prompt: ${item.suggested_prompt}`);
      lines.push("");
    }
  }
  const copyText = lines.join("\n");

  return {
    generated_at: now.toISOString(),
    sections,
    copy_text: copyText,
  };
}

// ── buildWeeklyReviewDraft ─────────────────────────────────────────────────────

export async function buildWeeklyReviewDraft(
  actorUser: BriefingActorUser,
  options: { startDate?: string; endDate?: string } = {},
): Promise<{ draftText: string; generated_at: string }> {
  // Returns copyable text only. Never sends. No auto-send.
  const review = await buildWeeklyCeoReview(actorUser, options);
  const lines: string[] = [
    `WEEKLY CEO REVIEW — ${review.start_date} to ${review.end_date}`,
    `Generated: ${review.generated_at}`,
    "",
    `ACTION QUEUE`,
    `  Completed: ${review.action_summary.completed}  |  Dismissed: ${review.action_summary.dismissed}  |  Snoozed: ${review.action_summary.snoozed}  |  Unresolved: ${review.action_summary.unresolved}`,
    "",
    `BLOCKERS`,
    `  Opened: ${review.blockers_summary.opened}  |  Resolved: ${review.blockers_summary.resolved}  |  Still open: ${review.blockers_summary.still_open}`,
    "",
    `TASKS`,
    `  Completed: ${review.tasks_summary.completed}  |  Overdue: ${review.tasks_summary.overdue}`,
    ...(review.tasks_summary.overdue_by_owner.length > 0 ? [
      "",
      "  Overdue by owner:",
      ...review.tasks_summary.overdue_by_owner.map(o => `    - ${o.ownerName}: ${o.count}`)
    ] : []),
    "",
    `COMMITMENTS`,
    `  Created: ${review.commitments_summary.created}  |  Completed: ${review.commitments_summary.completed}  |  Missed: ${review.commitments_summary.missed}`,
    "",
    `TEAM PULSE`,
    `  Blocked: ${review.team_pulse.blocked}  |  Quiet: ${review.team_pulse.quiet}  |  Needs follow-up: ${review.team_pulse.needs_followup}  |  Total: ${review.team_pulse.total}`,
    "",
    `OPPORTUNITY MOVEMENT`,
    `  New deals: ${review.opportunity_movement.new_deals}  |  Stage changes: ${review.opportunity_movement.stage_changes}`,
    `  Won: ${review.opportunity_movement.won_this_week}  |  Lost: ${review.opportunity_movement.lost_this_week}`,
    `  Total pipeline: $${Math.round(review.opportunity_movement.total_pipeline).toLocaleString()}`,
    "",
    `TOP WINS`,
    ...(review.top_wins.length > 0 ? review.top_wins.map(w => `  ✓ ${w.title}`) : ["  (none this week)"]),
    "",
    `TOP RISKS`,
    ...(review.top_risks.length > 0 ? review.top_risks.map(r => `  ⚠ ${r.title}`) : ["  (none flagged)"]),
  ];

  return { draftText: lines.join("\n"), generated_at: review.generated_at };
}
