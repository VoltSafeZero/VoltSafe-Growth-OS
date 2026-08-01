/**
 * ceo-cockpit.ts
 *
 * CEO Cockpit data service — Team Communication Radar + 1:1 Operating System.
 * All data sourced from local database only. No external API calls.
 * Gated by requireAuth + requireAdmin in routes.ts.
 * Capital section excluded unless hasCapital = true.
 * No keystroke tracking, no invasive productivity scoring, no auto-send actions.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SignalLabel =
  | "Active"
  | "Blocked"
  | "Overloaded"
  | "Needs follow-up"
  | "Quiet"
  | "No current signals"
  | "Waiting on CEO";

export type TeamMember = {
  id: number;
  name: string;
  email: string;
  role: string;
  department: string | null;
  jobTitle: string | null;
  activeTasks: number;
  overdueTasks: number;
  blockedTasks: number;
  ownedProjects: number;
  lastSignalAt: string | null;
  signal: { label: SignalLabel; reason: string };
  openCommitments: number;
  link: string;
};

export type BlockerItem = {
  id: string;
  title: string;
  ownerName: string | null;
  ownerId: number | null;
  source: "task" | "deployment" | "install" | "support" | "procurement";
  severity: "critical" | "high" | "medium" | "low";
  ageHours: number;
  ageDays: number;
  link: string;
  nextAction: string | null;
  askForUpdateText: string;
};

export type SilenceItem = {
  id: string;
  title: string;
  type: "task" | "opportunity" | "project" | "support_ticket" | "team_member";
  ownerName: string | null;
  ownerId: number | null;
  staleDays: number;
  reason: string;
  link: string;
  askForUpdateText: string;
};

export type CommitmentItem = {
  id: string;
  title: string;
  ownerName: string | null;
  ownerId: number | null;
  dueDate: string | null;
  source: string;
  status: string;
  daysOverdue: number;
  link: string;
};

export type OneOnOneItem = {
  userId: number;
  userName: string;
  nextScheduled: string | null;
  lastMeeting: string | null;
  openActionItems: number;
  overdueCommitments: number;
  suggestedAgenda: string[];
  link: string;
};

export type CeoAttentionItem = {
  id: string;
  title: string;
  reason: string;
  source: string;
  ageHours: number;
  ownerName: string | null;
  link: string;
};

export type HotspotChannel = {
  id: number;
  name: string;
  slug: string;
  messageCount7d: number;
  lastMessageAt: string | null;
  isQuiet: boolean;
};

export type CeoCockpitData = {
  generated_at: string;
  user: { id: number };
  sections: {
    team_pulse: {
      title: string;
      members: TeamMember[];
      source_counts: { total: number; blocked: number; quiet: number; overloaded: number };
      empty_state: string;
    };
    blockers: {
      title: string;
      count: number;
      items: BlockerItem[];
      empty_state: string;
    };
    silence_watch: {
      title: string;
      count: number;
      items: SilenceItem[];
      empty_state: string;
    };
    commitments: {
      title: string;
      count: number;
      overdue: number;
      items: CommitmentItem[];
      empty_state: string;
    };
    one_on_ones: {
      title: string;
      items: OneOnOneItem[];
      empty_state: string;
    };
    ceo_attention: {
      title: string;
      count: number;
      items: CeoAttentionItem[];
      empty_state: string;
    };
    communication_hotspots: {
      title: string;
      active_channels: HotspotChannel[];
      quiet_channels: HotspotChannel[];
      unanswered_mentions: number;
      empty_state: string;
    };
  };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function subtractBusinessDays(date: Date, days: number): Date {
  const result = new Date(date);
  let count = 0;
  while (count < days) {
    result.setDate(result.getDate() - 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return result;
}

function ageHours(ts: string | Date | null, now: Date): number {
  if (!ts) return 0;
  return Math.floor((now.getTime() - new Date(ts).getTime()) / (1000 * 60 * 60));
}

function computeSignal(
  activeTasks: number,
  overdueTasks: number,
  blockedTasks: number,
  lastSignalAt: Date | null,
  now: Date,
): { label: SignalLabel; reason: string } {
  const fiveBizDaysAgo = subtractBusinessDays(now, 5);

  if (blockedTasks > 0) {
    return { label: "Blocked", reason: `${blockedTasks} blocked task(s) need resolution` };
  }
  if (overdueTasks >= 5) {
    return { label: "Overloaded", reason: `${overdueTasks} overdue tasks — may need prioritization help` };
  }
  if (overdueTasks > 0) {
    return { label: "Needs follow-up", reason: `${overdueTasks} overdue task(s)` };
  }
  if (activeTasks === 0 && !lastSignalAt) {
    return { label: "No current signals", reason: "No active tasks or recent activity detected" };
  }
  if (!lastSignalAt || lastSignalAt < fiveBizDaysAgo) {
    return { label: "Quiet", reason: "No task/project/message activity in 5+ business days" };
  }
  return { label: "Active", reason: "Recent task or project activity" };
}

function buildAskForUpdate(title: string, ownerName: string | null): string {
  const who = ownerName ? ownerName.split(" ")[0] : "team";
  return `Hi ${who}, quick check-in on "${title}" — can you share a brief status update? Current state, any blockers, and next step would be helpful.`;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function getCeoCockpitData(
  ceoUserId: number,
  hasCapital: boolean,
): Promise<CeoCockpitData> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fiveBizDaysAgo = subtractBusinessDays(now, 5);
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const ceoId = Number(ceoUserId);

  // ── 1. Team Pulse ───────────────────────────────────────────────────────────
  let teamMembers: TeamMember[] = [];
  try {
    const teamRows = await db.execute(sql.raw(`
      SELECT
        u.id, u.name, u.email, u.role, u.global_role, u.department, u.job_title, u.last_login,
        COALESCE(COUNT(t.id) FILTER (
          WHERE t.status NOT IN ('complete','cancelled','done') AND t.archived = false
        ), 0)::int AS active_tasks,
        COALESCE(COUNT(t.id) FILTER (
          WHERE t.status NOT IN ('complete','cancelled','done')
            AND t.due_date < NOW() AND t.archived = false
        ), 0)::int AS overdue_tasks,
        COALESCE(COUNT(t.id) FILTER (
          WHERE t.board_column = 'blocked' AND t.archived = false
            AND t.status NOT IN ('complete','cancelled','done')
        ), 0)::int AS blocked_tasks,
        COALESCE(COUNT(DISTINCT p.id) FILTER (
          WHERE p.status NOT IN ('complete','cancelled','archived')
        ), 0)::int AS owned_projects,
        MAX(GREATEST(
          COALESCE(t.updated_at, '1970-01-01'::timestamptz),
          COALESCE(p.updated_at, '1970-01-01'::timestamptz)
        )) AS last_signal_at,
        COALESCE(COUNT(t.id) FILTER (
          WHERE t.source IN ('meeting_note','follow_up','action_item')
            AND t.status NOT IN ('complete','cancelled','done')
            AND t.archived = false
        ), 0)::int AS open_commitments
      FROM users u
      LEFT JOIN tasks t ON t.owner_user_id = u.id
      LEFT JOIN projects p ON p.owner_user_id = u.id
      WHERE u.status = 'active' AND u.user_type = 'internal' AND u.id != ${ceoId}
      GROUP BY u.id
      ORDER BY u.name
      LIMIT 30
    `));

    teamMembers = (teamRows.rows as any[]).map((r) => {
      const lastSignalAt = r.last_signal_at && r.last_signal_at > new Date("1971-01-01")
        ? new Date(r.last_signal_at) : null;
      const sig = computeSignal(
        Number(r.active_tasks), Number(r.overdue_tasks),
        Number(r.blocked_tasks), lastSignalAt, now,
      );
      return {
        id: Number(r.id),
        name: String(r.name),
        email: String(r.email),
        role: String(r.role || r.global_role || ""),
        department: r.department ?? null,
        jobTitle: r.job_title ?? null,
        activeTasks: Number(r.active_tasks),
        overdueTasks: Number(r.overdue_tasks),
        blockedTasks: Number(r.blocked_tasks),
        ownedProjects: Number(r.owned_projects),
        lastSignalAt: lastSignalAt ? lastSignalAt.toISOString() : null,
        signal: sig,
        openCommitments: Number(r.open_commitments),
        link: `/tasks?userId=${r.id}`,
      };
    });
  } catch (e) {
    console.error("[ceo-cockpit] team_pulse error:", (e as Error).message);
  }

  const teamSourceCounts = {
    total: teamMembers.length,
    blocked: teamMembers.filter(m => m.signal.label === "Blocked").length,
    quiet: teamMembers.filter(m => m.signal.label === "Quiet" || m.signal.label === "No current signals").length,
    overloaded: teamMembers.filter(m => m.signal.label === "Overloaded").length,
  };

  // ── 2. Blockers ─────────────────────────────────────────────────────────────
  let blockerItems: BlockerItem[] = [];
  try {
    const [blockedTasks, blockedInstalls, blockedDeploys] = await Promise.all([
      db.execute(sql.raw(`
        SELECT t.id, t.title, t.priority, t.updated_at, t.due_date,
          u.name AS owner_name, u.id AS owner_id
        FROM tasks t
        LEFT JOIN users u ON t.owner_user_id = u.id
        WHERE t.board_column = 'blocked' AND t.archived = false
          AND t.status NOT IN ('complete','cancelled','done')
        ORDER BY CASE t.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
          t.updated_at ASC
        LIMIT 10
      `)),
      db.execute(sql.raw(`
        SELECT iw.id, iw.title, iw.blockers, iw.updated_at, u.name AS owner_name, u.id AS owner_id
        FROM install_workflows iw
        LEFT JOIN users u ON iw.owner_user_id = u.id
        WHERE iw.blockers IS NOT NULL AND iw.blockers != ''
          AND iw.status NOT IN ('complete','cancelled')
        ORDER BY iw.updated_at ASC
        LIMIT 5
      `)),
      db.execute(sql.raw(`
        SELECT d.id, d.site_name AS title, d.blockers, d.updated_at, u.name AS owner_name, u.id AS owner_id
        FROM deployments d
        LEFT JOIN users u ON d.owner_user_id = u.id
        WHERE d.blockers IS NOT NULL AND d.blockers != ''
          AND d.status NOT IN ('complete','cancelled')
        ORDER BY d.updated_at ASC
        LIMIT 5
      `)),
    ]);

    const taskBlockers: BlockerItem[] = (blockedTasks.rows as any[]).map((r) => ({
      id: `task-${r.id}`,
      title: String(r.title),
      ownerName: r.owner_name ?? null,
      ownerId: r.owner_id ? Number(r.owner_id) : null,
      source: "task" as const,
      severity: (r.priority === "critical" ? "critical" : r.priority === "high" ? "high" : r.priority === "low" ? "low" : "medium") as any,
      ageHours: ageHours(r.updated_at, now),
      ageDays: Math.floor(ageHours(r.updated_at, now) / 24),
      link: `/tasks?id=${r.id}`,
      nextAction: null,
      askForUpdateText: buildAskForUpdate(r.title, r.owner_name),
    }));

    const installBlockers: BlockerItem[] = (blockedInstalls.rows as any[]).map((r) => ({
      id: `install-${r.id}`,
      title: String(r.title),
      ownerName: r.owner_name ?? null,
      ownerId: r.owner_id ? Number(r.owner_id) : null,
      source: "install" as const,
      severity: "high" as const,
      ageHours: ageHours(r.updated_at, now),
      ageDays: Math.floor(ageHours(r.updated_at, now) / 24),
      link: `/install-workflows?id=${r.id}`,
      nextAction: r.blockers ? String(r.blockers).slice(0, 200) : null,
      askForUpdateText: buildAskForUpdate(r.title, r.owner_name),
    }));

    const deployBlockers: BlockerItem[] = (blockedDeploys.rows as any[]).map((r) => ({
      id: `deploy-${r.id}`,
      title: String(r.title),
      ownerName: r.owner_name ?? null,
      ownerId: r.owner_id ? Number(r.owner_id) : null,
      source: "deployment" as const,
      severity: "high" as const,
      ageHours: ageHours(r.updated_at, now),
      ageDays: Math.floor(ageHours(r.updated_at, now) / 24),
      link: `/deployments?id=${r.id}`,
      nextAction: r.blockers ? String(r.blockers).slice(0, 200) : null,
      askForUpdateText: buildAskForUpdate(r.title, r.owner_name),
    }));

    blockerItems = [...taskBlockers, ...installBlockers, ...deployBlockers]
      .sort((a, b) => {
        const sev = { critical: 0, high: 1, medium: 2, low: 3 };
        return (sev[a.severity] ?? 2) - (sev[b.severity] ?? 2) || b.ageHours - a.ageHours;
      })
      .slice(0, 20);
  } catch (e) {
    console.error("[ceo-cockpit] blockers error:", (e as Error).message);
  }

  // ── 3. Silence Watch ────────────────────────────────────────────────────────
  let silenceItems: SilenceItem[] = [];
  try {
    const fiveBizDaysIso = fiveBizDaysAgo.toISOString();
    const sevenDaysIso = sevenDaysAgo.toISOString();
    const threeDaysIso = threeDaysAgo.toISOString();

    const [staleTaskRows, staleOppRows, staleProjectRows] = await Promise.all([
      // Stale overdue tasks (no update in 3+ days)
      db.execute(sql.raw(`
        SELECT t.id, t.title, t.updated_at, t.due_date, u.name AS owner_name, u.id AS owner_id
        FROM tasks t
        LEFT JOIN users u ON t.owner_user_id = u.id
        WHERE t.status NOT IN ('complete','cancelled','done')
          AND t.archived = false
          AND t.due_date < NOW()
          AND t.updated_at < '${threeDaysIso}'
        ORDER BY t.due_date ASC
        LIMIT 10
      `)),
      // Stale open opportunities (no update in 7+ days)
      db.execute(sql.raw(`
        SELECT o.id, o.name AS title, o.updated_at, u.name AS owner_name, u.id AS owner_id
        FROM opportunities o
        LEFT JOIN users u ON o.owner_user_id = u.id
        WHERE o.status NOT IN ('closed_won','closed_lost','inactive')
          AND o.updated_at < '${sevenDaysIso}'
        ORDER BY o.updated_at ASC
        LIMIT 8
      `)),
      // Stale projects (no update in 7+ days)
      db.execute(sql.raw(`
        SELECT p.id, p.name AS title, p.updated_at, u.name AS owner_name, u.id AS owner_id
        FROM projects p
        LEFT JOIN users u ON p.owner_user_id = u.id
        WHERE p.status NOT IN ('complete','cancelled','archived')
          AND p.updated_at < '${sevenDaysIso}'
        ORDER BY p.updated_at ASC
        LIMIT 8
      `)),
    ]);

    const staleTaskItems: SilenceItem[] = (staleTaskRows.rows as any[]).map((r) => {
      const staleDays = Math.floor((now.getTime() - new Date(r.updated_at).getTime()) / (1000 * 60 * 60 * 24));
      return {
        id: `task-${r.id}`,
        title: String(r.title),
        type: "task" as const,
        ownerName: r.owner_name ?? null,
        ownerId: r.owner_id ? Number(r.owner_id) : null,
        staleDays,
        reason: `Overdue task — no update in ${staleDays} day(s)`,
        link: `/tasks?id=${r.id}`,
        askForUpdateText: buildAskForUpdate(r.title, r.owner_name),
      };
    });

    const staleOppItems: SilenceItem[] = (staleOppRows.rows as any[]).map((r) => {
      const staleDays = Math.floor((now.getTime() - new Date(r.updated_at).getTime()) / (1000 * 60 * 60 * 24));
      return {
        id: `opp-${r.id}`,
        title: String(r.title),
        type: "opportunity" as const,
        ownerName: r.owner_name ?? null,
        ownerId: r.owner_id ? Number(r.owner_id) : null,
        staleDays,
        reason: `Open opportunity — no visible movement in ${staleDays} day(s)`,
        link: `/opportunities?id=${r.id}`,
        askForUpdateText: buildAskForUpdate(r.title, r.owner_name),
      };
    });

    const staleProjectItems: SilenceItem[] = (staleProjectRows.rows as any[]).map((r) => {
      const staleDays = Math.floor((now.getTime() - new Date(r.updated_at).getTime()) / (1000 * 60 * 60 * 24));
      return {
        id: `project-${r.id}`,
        title: String(r.title),
        type: "project" as const,
        ownerName: r.owner_name ?? null,
        ownerId: r.owner_id ? Number(r.owner_id) : null,
        staleDays,
        reason: `Active project — no update in ${staleDays} day(s)`,
        link: `/projects?id=${r.id}`,
        askForUpdateText: buildAskForUpdate(r.title, r.owner_name),
      };
    });

    silenceItems = [...staleTaskItems, ...staleOppItems, ...staleProjectItems]
      .sort((a, b) => b.staleDays - a.staleDays)
      .slice(0, 20);
  } catch (e) {
    console.error("[ceo-cockpit] silence_watch error:", (e as Error).message);
  }

  // ── 4. Commitments ──────────────────────────────────────────────────────────
  let commitmentItems: CommitmentItem[] = [];
  try {
    const commitmentRows = await db.execute(sql.raw(`
      SELECT t.id, t.title, t.due_date, t.status, t.source, t.source_label, t.updated_at,
        u.name AS owner_name, u.id AS owner_id
      FROM tasks t
      LEFT JOIN users u ON t.owner_user_id = u.id
      WHERE t.source IN ('meeting_note','follow_up','action_item','commitment')
        AND t.status NOT IN ('complete','cancelled','done')
        AND t.archived = false
      ORDER BY t.due_date ASC NULLS LAST
      LIMIT 20
    `));

    commitmentItems = (commitmentRows.rows as any[]).map((r) => {
      const due = r.due_date ? new Date(r.due_date) : null;
      const daysOverdue = due && due < now
        ? Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24))
        : 0;
      return {
        id: `task-${r.id}`,
        title: String(r.title),
        ownerName: r.owner_name ?? null,
        ownerId: r.owner_id ? Number(r.owner_id) : null,
        dueDate: due ? due.toISOString() : null,
        source: r.source_label ?? String(r.source ?? "task"),
        status: String(r.status ?? "pending"),
        daysOverdue,
        link: `/tasks?id=${r.id}`,
      };
    });
  } catch (e) {
    console.error("[ceo-cockpit] commitments error:", (e as Error).message);
  }

  const overdueCommitments = commitmentItems.filter(c => c.daysOverdue > 0).length;

  // ── 5. 1:1 Operating System ─────────────────────────────────────────────────
  let oneOnOneItems: OneOnOneItem[] = [];
  try {
    // Calendar Privacy Visibility Policy: this cross-user view must never
    // surface titles/details from a private_personal or external_calendar
    // connection (admin/exec cannot override private-calendar privacy — see
    // server/services/calendar-visibility.ts). Native events (connection_id
    // IS NULL) default to the owner's company_managed work calendar and stay
    // eligible for this detection.
    const PRIVACY_JOIN = `
      LEFT JOIN calendar_connections cc ON cc.id = ce.connection_id
    `;
    const PRIVACY_FILTER = `
      AND COALESCE(cc.visibility_type, 'company_managed') NOT IN ('private_personal', 'external_calendar')
    `;

    // Upcoming calendar events with 1:1 in title
    const upcoming1on1Rows = await db.execute(sql.raw(`
      SELECT ce.id, ce.title, ce.start_time, ce.end_time, ce.user_id, ce.invitees,
        u.name AS user_name
      FROM calendar_events ce
      JOIN users u ON ce.user_id = u.id
      ${PRIVACY_JOIN}
      WHERE (LOWER(ce.title) LIKE '%1:1%' OR LOWER(ce.title) LIKE '%one-on-one%' OR LOWER(ce.title) LIKE '%1 on 1%')
        AND ce.start_time > NOW()
        AND ce.start_time < NOW() + INTERVAL '14 days'
        AND u.status = 'active'
        ${PRIVACY_FILTER}
      ORDER BY ce.start_time ASC
      LIMIT 20
    `));

    // Past 1:1 meetings (last 30 days)
    const past1on1Rows = await db.execute(sql.raw(`
      SELECT ce.id, ce.title, ce.start_time, ce.user_id, ce.invitees,
        u.name AS user_name
      FROM calendar_events ce
      JOIN users u ON ce.user_id = u.id
      ${PRIVACY_JOIN}
      WHERE (LOWER(ce.title) LIKE '%1:1%' OR LOWER(ce.title) LIKE '%one-on-one%' OR LOWER(ce.title) LIKE '%1 on 1%')
        AND ce.start_time < NOW()
        AND ce.start_time > '${thirtyDaysAgo.toISOString()}'
        AND u.status = 'active'
        ${PRIVACY_FILTER}
      ORDER BY ce.start_time DESC
      LIMIT 20
    `));

    // Build map: team member → next 1:1 and last 1:1
    const oneOnOneMap = new Map<number, {
      userId: number; userName: string;
      nextScheduled: string | null; lastMeeting: string | null;
    }>();

    for (const row of upcoming1on1Rows.rows as any[]) {
      if (!oneOnOneMap.has(row.user_id)) {
        oneOnOneMap.set(row.user_id, {
          userId: Number(row.user_id),
          userName: String(row.user_name),
          nextScheduled: row.start_time ? new Date(row.start_time).toISOString() : null,
          lastMeeting: null,
        });
      }
    }
    for (const row of past1on1Rows.rows as any[]) {
      if (oneOnOneMap.has(row.user_id)) {
        const entry = oneOnOneMap.get(row.user_id)!;
        if (!entry.lastMeeting) {
          entry.lastMeeting = row.start_time ? new Date(row.start_time).toISOString() : null;
        }
      } else {
        oneOnOneMap.set(row.user_id, {
          userId: Number(row.user_id),
          userName: String(row.user_name),
          nextScheduled: null,
          lastMeeting: row.start_time ? new Date(row.start_time).toISOString() : null,
        });
      }
    }

    // For each 1:1 participant, compute open action items and overdue commitments
    for (const [uid, entry] of oneOnOneMap) {
      const memberData = teamMembers.find(m => m.id === uid);
      const overdueCount = memberData?.overdueTasks ?? 0;
      const openActionItems = memberData?.openCommitments ?? 0;

      // Suggested agenda based on real signals
      const suggestedAgenda: string[] = [];
      if (overdueCount > 0) suggestedAgenda.push(`${overdueCount} overdue task(s) — status update`);
      if (memberData?.blockedTasks ?? 0 > 0) suggestedAgenda.push(`${memberData!.blockedTasks} blocked task(s) — unblock decisions`);
      if (openActionItems > 0) suggestedAgenda.push(`${openActionItems} open commitment(s) from prior meetings`);
      if (suggestedAgenda.length === 0) suggestedAgenda.push("Priorities this week", "Support needed", "Wins and progress");

      oneOnOneItems.push({
        userId: entry.userId,
        userName: entry.userName,
        nextScheduled: entry.nextScheduled,
        lastMeeting: entry.lastMeeting,
        openActionItems,
        overdueCommitments: overdueCount,
        suggestedAgenda: suggestedAgenda.slice(0, 5),
        link: `/tasks?userId=${uid}`,
      });
    }

    // Fill in team members with no 1:1 data (no scheduled 1:1 detected)
    for (const member of teamMembers) {
      if (!oneOnOneMap.has(member.id)) {
        oneOnOneItems.push({
          userId: member.id,
          userName: member.name,
          nextScheduled: null,
          lastMeeting: null,
          openActionItems: member.openCommitments,
          overdueCommitments: member.overdueTasks,
          suggestedAgenda: ["No recurring 1:1 detected — consider scheduling"],
          link: `/tasks?userId=${member.id}`,
        });
      }
    }

    oneOnOneItems = oneOnOneItems.slice(0, 15);
  } catch (e) {
    console.error("[ceo-cockpit] one_on_ones error:", (e as Error).message);
  }

  // ── 6. CEO Attention ────────────────────────────────────────────────────────
  let ceoAttentionItems: CeoAttentionItem[] = [];
  try {
    const [ceoTaskRows, mentionRows] = await Promise.all([
      // Tasks assigned to CEO that are overdue or high priority
      db.execute(sql.raw(`
        SELECT t.id, t.title, t.priority, t.due_date, t.updated_at, t.source,
          u.name AS assigner_name
        FROM tasks t
        LEFT JOIN users u ON t.created_by_user_id = u.id
        WHERE t.owner_user_id = ${ceoId}
          AND t.status NOT IN ('complete','cancelled','done')
          AND t.archived = false
          AND (t.due_date < NOW() OR t.priority IN ('critical','high'))
        ORDER BY CASE t.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,
          t.due_date ASC NULLS LAST
        LIMIT 10
      `)),
      // Unread CURRENTS mentions of CEO
      db.execute(sql.raw(`
        SELECT cm.id, cm.body, cm.created_at, u.name AS sender_name,
          cc.name AS channel_name, cc.slug AS channel_slug
        FROM current_mentions mn
        JOIN current_messages cm ON cm.id = mn.message_id
        JOIN users u ON cm.user_id = u.id
        LEFT JOIN current_channels cc ON cm.channel_id = cc.id
        WHERE mn.mentioned_user_id = ${ceoId}
          AND cm.created_at > '${sevenDaysAgo.toISOString()}'
        ORDER BY cm.created_at DESC
        LIMIT 5
      `)),
    ]);

    const taskAttention: CeoAttentionItem[] = (ceoTaskRows.rows as any[]).map((r) => ({
      id: `task-${r.id}`,
      title: String(r.title),
      reason: r.priority === "critical" || r.priority === "high"
        ? `${r.priority} priority task assigned to you`
        : "Overdue task assigned to you",
      source: "task",
      ageHours: ageHours(r.due_date || r.updated_at, now),
      ownerName: r.assigner_name ?? null,
      link: `/tasks?id=${r.id}`,
    }));

    const mentionAttention: CeoAttentionItem[] = (mentionRows.rows as any[]).map((r) => ({
      id: `mention-${r.id}`,
      title: `Mention from ${r.sender_name ?? "teammate"}${r.channel_name ? ` in #${r.channel_name}` : ""}`,
      reason: "You were mentioned in CURRENTS",
      source: "currents",
      ageHours: ageHours(r.created_at, now),
      ownerName: r.sender_name ?? null,
      link: r.channel_slug ? `/current?channel=${r.channel_slug}` : "/current",
    }));

    ceoAttentionItems = [...taskAttention, ...mentionAttention]
      .sort((a, b) => b.ageHours - a.ageHours)
      .slice(0, 15);
  } catch (e) {
    console.error("[ceo-cockpit] ceo_attention error:", (e as Error).message);
  }

  // ── 7. Communication Hotspots ───────────────────────────────────────────────
  let activeChannels: HotspotChannel[] = [];
  let quietChannels: HotspotChannel[] = [];
  let unansweredMentions = 0;
  try {
    const [channelRows, unansweredRows] = await Promise.all([
      db.execute(sql.raw(`
        SELECT cc.id, cc.name, cc.slug,
          COUNT(cm.id) FILTER (WHERE cm.created_at > '${sevenDaysAgo.toISOString()}')::int AS message_count_7d,
          MAX(cm.created_at) AS last_message_at,
          cc.is_private
        FROM current_channels cc
        LEFT JOIN current_messages cm ON cm.channel_id = cc.id AND cm.conversation_id IS NULL
        WHERE cc.archived_at IS NULL
          AND cc.is_private = false
        GROUP BY cc.id
        ORDER BY message_count_7d DESC
        LIMIT 20
      `)),
      db.execute(sql.raw(`
        SELECT COUNT(*)::int AS cnt
        FROM current_mentions mn
        JOIN current_messages cm ON cm.id = mn.message_id
        WHERE mn.mentioned_user_id = ${ceoId}
          AND cm.created_at > '${sevenDaysAgo.toISOString()}'
      `)),
    ]);

    const channelData = channelRows.rows as any[];
    activeChannels = channelData
      .filter(r => Number(r.message_count_7d) > 0)
      .slice(0, 5)
      .map(r => ({
        id: Number(r.id),
        name: String(r.name),
        slug: String(r.slug),
        messageCount7d: Number(r.message_count_7d),
        lastMessageAt: r.last_message_at ? new Date(r.last_message_at).toISOString() : null,
        isQuiet: false,
      }));

    quietChannels = channelData
      .filter(r => Number(r.message_count_7d) === 0)
      .slice(0, 5)
      .map(r => ({
        id: Number(r.id),
        name: String(r.name),
        slug: String(r.slug),
        messageCount7d: 0,
        lastMessageAt: r.last_message_at ? new Date(r.last_message_at).toISOString() : null,
        isQuiet: true,
      }));

    unansweredMentions = Number((unansweredRows.rows as any[])[0]?.cnt ?? 0);
  } catch (e) {
    console.error("[ceo-cockpit] communication_hotspots error:", (e as Error).message);
  }

  return {
    generated_at: now.toISOString(),
    user: { id: ceoId },
    sections: {
      team_pulse: {
        title: "Team Pulse",
        members: teamMembers,
        source_counts: teamSourceCounts,
        empty_state: "No active team members found.",
      },
      blockers: {
        title: "Blockers",
        count: blockerItems.length,
        items: blockerItems,
        empty_state: "No blockers detected across tasks, installs, or deployments.",
      },
      silence_watch: {
        title: "Silence Watch",
        count: silenceItems.length,
        items: silenceItems,
        empty_state: "No stale items detected. Everything looks active.",
      },
      commitments: {
        title: "Commitments",
        count: commitmentItems.length,
        overdue: overdueCommitments,
        items: commitmentItems,
        empty_state: "No open commitments or follow-ups found.",
      },
      one_on_ones: {
        title: "1:1s",
        items: oneOnOneItems,
        empty_state: "No 1:1 meetings detected in the next 14 days.",
      },
      ceo_attention: {
        title: "CEO Attention",
        count: ceoAttentionItems.length,
        items: ceoAttentionItems,
        empty_state: "Nothing currently waiting on you.",
      },
      communication_hotspots: {
        title: "Communication Hotspots",
        active_channels: activeChannels,
        quiet_channels: quietChannels,
        unanswered_mentions: unansweredMentions,
        empty_state: "No communication hotspots detected.",
      },
    },
  };
}
