import { db } from "../db";
import { sql } from "drizzle-orm";

const sqlStr = (s: string | null | undefined): string => {
  if (s == null) return "NULL";
  return `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
};

export type DigestType = "morning_personal" | "evening_unresolved" | "manager_team";

export interface DigestPayload {
  type: DigestType;
  userId: number;
  generatedAt: string;
  mustDoToday: DigestTask[];
  overdue: DigestTask[];
  recentlyCompleted: DigestTask[];
  pendingSuggestions: number;
  stats: {
    totalOpen: number;
    dueToday: number;
    overdueCount: number;
    completedLast7d: number;
  };
  teamAtRisk?: TeamRiskRow[];
}

export interface DigestTask {
  id: number;
  title: string;
  priority: string;
  daysOverdue: number;
  accountName: string | null;
  ownerName: string | null;
}

export interface TeamRiskRow {
  ownerName: string;
  overdueCount: number;
  topTask: string | null;
}

async function getTasksForDigest(userId: number, includeTeam = false): Promise<{
  mustDoToday: DigestTask[];
  overdue: DigestTask[];
  recentlyCompleted: DigestTask[];
  stats: { totalOpen: number; dueToday: number; overdueCount: number; completedLast7d: number };
}> {
  const scopeClause = includeTeam ? "" : `AND t.owner_user_id = ${userId}`;

  const overdueSql = `
    SELECT t.id, t.title, t.priority, t.due_date, t.owner_user_id,
      a.name AS account_name,
      u.name AS owner_name
    FROM tasks t
    LEFT JOIN accounts a ON a.id = t.account_id
    LEFT JOIN users u ON u.id = t.owner_user_id
    WHERE t.status NOT IN ('completed','cancelled')
      AND t.due_date < NOW()
      ${scopeClause}
    ORDER BY t.due_date ASC NULLS LAST
    LIMIT 10
  `;

  const todaySql = `
    SELECT t.id, t.title, t.priority, t.due_date, t.owner_user_id,
      a.name AS account_name,
      u.name AS owner_name
    FROM tasks t
    LEFT JOIN accounts a ON a.id = t.account_id
    LEFT JOIN users u ON u.id = t.owner_user_id
    WHERE t.status NOT IN ('completed','cancelled')
      AND t.due_date >= CURRENT_DATE
      AND t.due_date < CURRENT_DATE + INTERVAL '1 day'
      ${scopeClause}
    ORDER BY t.priority DESC, t.due_date ASC
    LIMIT 10
  `;

  const completedSql = `
    SELECT t.id, t.title, t.priority, t.completed_at,
      a.name AS account_name,
      u.name AS owner_name
    FROM tasks t
    LEFT JOIN accounts a ON a.id = t.account_id
    LEFT JOIN users u ON u.id = t.owner_user_id
    WHERE t.status = 'completed'
      AND t.completed_at >= NOW() - INTERVAL '7 days'
      ${scopeClause}
    ORDER BY t.completed_at DESC
    LIMIT 5
  `;

  const statsSql = `
    SELECT
      COUNT(*) FILTER (WHERE status NOT IN ('completed','cancelled')) AS total_open,
      COUNT(*) FILTER (WHERE status NOT IN ('completed','cancelled') AND due_date >= CURRENT_DATE AND due_date < CURRENT_DATE + INTERVAL '1 day') AS due_today,
      COUNT(*) FILTER (WHERE status NOT IN ('completed','cancelled') AND due_date < NOW()) AS overdue_count,
      COUNT(*) FILTER (WHERE status = 'completed' AND completed_at >= NOW() - INTERVAL '7 days') AS completed_last7d
    FROM tasks
    WHERE 1=1 ${includeTeam ? "" : `AND owner_user_id = ${userId}`}
  `;

  const [overdueRes, todayRes, completedRes, statsRes] = await Promise.all([
    db.execute(sql.raw(overdueSql)),
    db.execute(sql.raw(todaySql)),
    db.execute(sql.raw(completedSql)),
    db.execute(sql.raw(statsSql)),
  ]);

  const toDigestTask = (row: any, showDaysOverdue = false): DigestTask => ({
    id: Number(row.id),
    title: String(row.title || ""),
    priority: String(row.priority || "medium"),
    daysOverdue: showDaysOverdue && row.due_date
      ? Math.max(0, Math.floor((Date.now() - new Date(row.due_date).getTime()) / 86_400_000))
      : 0,
    accountName: row.account_name || null,
    ownerName: row.owner_name || null,
  });

  const statsRow = statsRes.rows[0] as any || {};

  return {
    mustDoToday: (todayRes.rows as any[]).map((r) => toDigestTask(r)),
    overdue: (overdueRes.rows as any[]).map((r) => toDigestTask(r, true)),
    recentlyCompleted: (completedRes.rows as any[]).map((r) => toDigestTask(r)),
    stats: {
      totalOpen: Number(statsRow.total_open) || 0,
      dueToday: Number(statsRow.due_today) || 0,
      overdueCount: Number(statsRow.overdue_count) || 0,
      completedLast7d: Number(statsRow.completed_last7d) || 0,
    },
  };
}

async function getTeamAtRisk(): Promise<TeamRiskRow[]> {
  const result = await db.execute(sql.raw(`
    SELECT
      u.name AS owner_name,
      COUNT(*) FILTER (WHERE t.due_date < NOW()) AS overdue_count,
      MIN(t.title) AS top_task
    FROM tasks t
    JOIN users u ON u.id = t.owner_user_id
    WHERE t.status NOT IN ('completed','cancelled')
    GROUP BY u.id, u.name
    HAVING COUNT(*) FILTER (WHERE t.due_date < NOW()) > 0
    ORDER BY overdue_count DESC
    LIMIT 5
  `));

  return (result.rows as any[]).map((r) => ({
    ownerName: String(r.owner_name),
    overdueCount: Number(r.overdue_count),
    topTask: r.top_task || null,
  }));
}

async function getPendingSuggestionsCount(userId: number): Promise<number> {
  const result = await db.execute(sql.raw(`
    SELECT COUNT(*) AS cnt FROM task_suggestions
    WHERE status = 'pending'
      AND (snoozed_until IS NULL OR snoozed_until < NOW())
  `));
  return Number((result.rows[0] as any)?.cnt) || 0;
}

async function alreadyDeliveredToday(userId: number, digestType: DigestType): Promise<boolean> {
  const result = await db.execute(sql.raw(`
    SELECT 1 FROM task_digests
    WHERE user_id = ${userId}
      AND digest_type = '${digestType}'
      AND delivered_at >= CURRENT_DATE
    LIMIT 1
  `));
  return result.rows.length > 0;
}

export async function generateDigest(
  userId: number,
  digestType: DigestType,
  isManager = false,
  force = false
): Promise<DigestPayload | null> {
  if (!force && await alreadyDeliveredToday(userId, digestType)) {
    return null;
  }

  const includeTeam = digestType === "manager_team" || isManager;
  const { mustDoToday, overdue, recentlyCompleted, stats } = await getTasksForDigest(userId, includeTeam);
  const pendingSuggestions = await getPendingSuggestionsCount(userId);

  const payload: DigestPayload = {
    type: digestType,
    userId,
    generatedAt: new Date().toISOString(),
    mustDoToday,
    overdue,
    recentlyCompleted,
    pendingSuggestions,
    stats,
  };

  if (digestType === "manager_team") {
    payload.teamAtRisk = await getTeamAtRisk();
  }

  const now = new Date();
  const periodStart = new Date(now);
  periodStart.setHours(0, 0, 0, 0);

  await db.execute(sql.raw(`
    INSERT INTO task_digests (user_id, digest_type, period_start, period_end, payload)
    VALUES (
      ${userId},
      '${digestType}',
      '${periodStart.toISOString()}',
      '${now.toISOString()}',
      '${JSON.stringify(payload).replace(/'/g, "''")}'
    )
  `));

  const title =
    digestType === "morning_personal" ? "Your Morning Task Digest"
    : digestType === "evening_unresolved" ? "Evening: Tasks Still Open"
    : "Team Task Summary";

  const body =
    digestType === "morning_personal"
      ? `${stats.dueToday} due today, ${stats.overdueCount} overdue. ${pendingSuggestions > 0 ? `${pendingSuggestions} suggestions waiting.` : ""}`
      : digestType === "evening_unresolved"
      ? `${stats.totalOpen} tasks still open. ${overdue.length > 0 ? `${overdue.length} overdue.` : "Good progress today!"}`
      : `Team: ${stats.overdueCount} overdue tasks across ${payload.teamAtRisk?.length ?? 0} owners.`;

  const dedupeKey = `digest-${userId}-${digestType}-${now.toISOString().slice(0, 10)}`;

  await db.execute(sql.raw(`
    INSERT INTO notifications (user_id, type, title, body, severity, action_url, is_read, dedupe_key)
    VALUES (
      ${userId},
      'digest',
      ${sqlStr(title)},
      ${sqlStr(body)},
      'low',
      '/execution/daily',
      false,
      ${sqlStr(dedupeKey)}
    )
    ON CONFLICT (dedupe_key) DO NOTHING
  `));

  return payload;
}
