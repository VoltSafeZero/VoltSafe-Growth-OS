/**
 * Executive AI Copilot — Daily Decisions Engine
 * Scans live CRM, revenue ops, tasks, email signals, and board pack data
 * to surface the few actions that matter most today.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { computeGapToPlan } from "./revenue-operating-system";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AlertType =
  | "stalled_deal"
  | "commit_off_track"
  | "critical_task_overdue"
  | "no_new_leads"
  | "awaiting_reply"
  | "churn_risk"
  | "board_pack_stale"
  | "pipeline_drop"
  | "expansion_idle"
  | "open_ticket_high";

export type AlertSeverity = "low" | "medium" | "high" | "critical";

export interface ExecutiveAlert {
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  description: string;
  linkedObjectType?: string;
  linkedObjectId?: number;
  score: number;
  suggestedMove: string;
}

export interface DailyBriefSignal {
  type: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  suggestedMove: string;
  linkedObjectType?: string;
  linkedObjectId?: number;
}

export interface DailyBrief {
  briefDate: string;
  headline: string;
  summary: string;
  topSignals: DailyBriefSignal[];
  radar: RadarMetrics;
  generatedAt: string;
}

export interface RadarMetrics {
  gapStatus: string;
  gapPercent: number;
  committedRevenue: number;
  projectedRevenue: number;
  overdueTasks: number;
  criticalOverdue: number;
  newLeadsThisMonth: number;
  stalledDeals: number;
  stalledValue: number;
  awaitingReplyThreads: number;
  boardPackLastRunDays: number | null;
  openHighTickets: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

function rows(result: any): any[] {
  return (result?.rows ?? []) as any[];
}

function num(v: any): number {
  const n = parseFloat(String(v ?? 0));
  return isNaN(n) ? 0 : n;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(Math.abs(n)).toLocaleString()}`;
}

/** Escape a string as a PostgreSQL single-quoted literal. */
function sqlStr(s: string): string {
  return "'" + String(s ?? "").replace(/\\/g, "\\\\").replace(/'/g, "''") + "'";
}

/** Embed an object as a PostgreSQL JSONB literal. */
function sqlJson(obj: any): string {
  return "'" + JSON.stringify(obj).replace(/\\/g, "\\\\").replace(/'/g, "''") + "'::jsonb";
}

// ── Scoring logic ─────────────────────────────────────────────────────────────

/**
 * rankPriorities — score each alert by revenue impact, urgency, and severity
 * Returns sorted descending by score.
 */
export function rankPriorities(alerts: ExecutiveAlert[]): ExecutiveAlert[] {
  const severityScore: Record<AlertSeverity, number> = {
    critical: 40, high: 25, medium: 12, low: 4,
  };
  return alerts
    .map(a => ({ ...a, score: a.score + severityScore[a.severity] }))
    .sort((a, b) => b.score - a.score);
}

// ── generateSuggestedMoves ────────────────────────────────────────────────────

/**
 * generateSuggestedMoves — for each alert type, return a specific next action.
 * This is deterministic and data-grounded, not AI-generated text.
 */
export function generateSuggestedMoves(alert: ExecutiveAlert): string {
  const moves: Record<AlertType, string> = {
    stalled_deal: "Call the champion — confirm timeline, remove blockers, and reset next step.",
    commit_off_track: "Open Revenue Ops, generate gap-closure actions, and assign the top two as tasks this week.",
    critical_task_overdue: "Open the task, reassign if blocked, or close it with a note — no ambiguity.",
    no_new_leads: "Run a targeted outreach campaign or ask the team for three referral intros today.",
    awaiting_reply: "Send a 2-line follow-up: one question, one clear ask.",
    churn_risk: "Schedule a QBR with the account — review value delivered and roadmap alignment.",
    board_pack_stale: "Trigger a fresh board pack run before your next investor or exec meeting.",
    pipeline_drop: "Audit your ICP filters and open three new prospecting accounts this week.",
    expansion_idle: "Send a usage summary and propose an upsell conversation.",
    open_ticket_high: "Assign the ticket to a senior rep and set an SLA resolution target.",
  };
  return moves[alert.type] ?? alert.suggestedMove ?? "Review and take immediate action.";
}

// ── Live data queries ──────────────────────────────────────────────────────────

async function fetchRadar(): Promise<RadarMetrics> {
  const mk = monthKey();

  const [gap, taskRes, leadRes, dealRes, emailRes, bpRes, ticketRes] = await Promise.all([
    computeGapToPlan(mk).catch(() => null),

    db.execute(sql.raw(`
      SELECT
        COUNT(*) FILTER (WHERE status != 'done' AND due_date < NOW()) AS overdue,
        COUNT(*) FILTER (WHERE status != 'done' AND due_date < NOW() AND priority = 'critical') AS critical_overdue
      FROM tasks
      WHERE status != 'done' AND (dismissed_at IS NULL OR dismissed_at > NOW())
    `)),

    db.execute(sql.raw(`
      SELECT COUNT(*) AS cnt
      FROM leads
      WHERE created_at >= date_trunc('month', NOW())
        AND status NOT IN ('disqualified','closed_lost')
    `)),

    db.execute(sql.raw(`
      SELECT
        COUNT(*) FILTER (WHERE is_stalled = true) AS stalled_count,
        COALESCE(SUM(amount) FILTER (WHERE is_stalled = true), 0) AS stalled_value
      FROM opportunities
      WHERE stage NOT IN ('closed_won','closed_lost')
    `)),

    db.execute(sql.raw(`
      SELECT COUNT(*) AS cnt
      FROM email_threads
      WHERE reply_status = 'awaiting_reply'
        AND awaiting_reply_since < NOW() - INTERVAL '48 hours'
    `)),

    db.execute(sql.raw(`
      SELECT
        EXTRACT(EPOCH FROM (NOW() - MAX(created_at))) / 86400 AS days_since
      FROM board_pack_runs
      WHERE status = 'success'
    `)),

    db.execute(sql.raw(`
      SELECT COUNT(*) AS cnt
      FROM tickets
      WHERE status NOT IN ('resolved','closed')
        AND (severity = 'high' OR priority = 'high' OR severity = 'critical' OR priority = 'critical')
    `)),
  ]);

  const taskRow = rows(taskRes)[0] ?? {};
  const leadRow = rows(leadRes)[0] ?? {};
  const dealRow = rows(dealRes)[0] ?? {};
  const emailRow = rows(emailRes)[0] ?? {};
  const bpRow = rows(bpRes)[0] ?? {};
  const ticketRow = rows(ticketRes)[0] ?? {};

  return {
    gapStatus: gap?.status ?? "no_commit",
    gapPercent: num(gap?.gapPercent),
    committedRevenue: num(gap?.committedRevenue),
    projectedRevenue: num(gap?.projectedMonthEndRevenue),
    overdueTasks: num(taskRow.overdue),
    criticalOverdue: num(taskRow.critical_overdue),
    newLeadsThisMonth: num(leadRow.cnt),
    stalledDeals: num(dealRow.stalled_count),
    stalledValue: num(dealRow.stalled_value),
    awaitingReplyThreads: num(emailRow.cnt),
    boardPackLastRunDays: bpRow.days_since != null ? Math.round(num(bpRow.days_since)) : null,
    openHighTickets: num(ticketRow.cnt),
  };
}

// ── detectExecutiveAlerts ─────────────────────────────────────────────────────

export async function detectExecutiveAlerts(): Promise<ExecutiveAlert[]> {
  const alerts: ExecutiveAlert[] = [];
  const mk = monthKey();

  // ── 1. Large deal stalled 14+ days ──────────────────────────────────────────
  const stalledDealsRes = await db.execute(sql.raw(`
    SELECT o.id, o.title, o.amount,
      EXTRACT(EPOCH FROM (NOW() - COALESCE(o.last_activity_date, o.updated_at))) / 86400 AS stalled_days,
      a.name AS account_name
    FROM opportunities o
    LEFT JOIN accounts a ON a.id = o.account_id
    WHERE o.is_stalled = true
      AND o.stage NOT IN ('closed_won','closed_lost')
      AND COALESCE(o.last_activity_date, o.updated_at) < NOW() - INTERVAL '14 days'
    ORDER BY o.amount DESC NULLS LAST
    LIMIT 5
  `));
  for (const deal of rows(stalledDealsRes)) {
    const days = Math.round(num(deal.stalled_days));
    const value = num(deal.amount);
    const revenueScore = Math.min(60, Math.round(value / 5000));
    alerts.push({
      type: "stalled_deal",
      severity: value > 50000 ? "critical" : value > 20000 ? "high" : "medium",
      title: `${deal.title} stalled ${days} days`,
      description: `${deal.account_name || "Unknown account"} — ${fmt(value)} opportunity with no activity for ${days} days. Stage movement is blocked.`,
      linkedObjectType: "opportunity",
      linkedObjectId: num(deal.id),
      score: revenueScore + Math.min(20, days),
      suggestedMove: "Call the champion — confirm timeline, remove blockers, and reset next step.",
    });
  }

  // ── 2. Commit off-track > 15% ────────────────────────────────────────────────
  try {
    const gap = await computeGapToPlan(mk);
    if (gap.status === "off_track" || gap.status === "at_risk") {
      const severity: AlertSeverity = gap.status === "off_track" ? "critical" : "high";
      alerts.push({
        type: "commit_off_track",
        severity,
        title: `Revenue ${gap.status === "off_track" ? "off track" : "at risk"} — ${Math.abs(gap.gapPercent).toFixed(1)}% gap`,
        description: `Committed ${fmt(gap.committedRevenue)} for ${mk}. Currently projecting ${fmt(gap.projectedMonthEndRevenue)} — ${fmt(Math.abs(gap.gapAmount))} ${gap.gapAmount < 0 ? "short" : "ahead"} of plan.`,
        linkedObjectType: "revenue_commit",
        linkedObjectId: gap.commitId ?? undefined,
        score: Math.round(Math.abs(gap.gapPercent) * 2),
        suggestedMove: "Open Revenue Ops, generate gap-closure actions, and assign the top two as tasks this week.",
      });
    }
  } catch {}

  // ── 3. Critical tasks overdue ─────────────────────────────────────────────────
  const critTaskRes = await db.execute(sql.raw(`
    SELECT id, title, due_date,
      EXTRACT(EPOCH FROM (NOW() - due_date)) / 86400 AS days_overdue
    FROM tasks
    WHERE status != 'done'
      AND priority = 'critical'
      AND due_date < NOW()
      AND (dismissed_at IS NULL OR dismissed_at > NOW())
    ORDER BY due_date ASC
    LIMIT 3
  `));
  for (const t of rows(critTaskRes)) {
    const days = Math.round(num(t.days_overdue));
    alerts.push({
      type: "critical_task_overdue",
      severity: "critical",
      title: `Critical task overdue ${days}d: ${t.title}`,
      description: `This task was due ${days} day${days !== 1 ? "s" : ""} ago and is still open. Critical tasks unblocked equals blocked revenue.`,
      linkedObjectType: "task",
      linkedObjectId: num(t.id),
      score: 30 + Math.min(30, days * 3),
      suggestedMove: "Open the task, reassign if blocked, or close it with a note — no ambiguity.",
    });
  }

  // ── 4. No new qualified leads in 7 days ──────────────────────────────────────
  const leadCheckRes = await db.execute(sql.raw(`
    SELECT COUNT(*) AS cnt
    FROM leads
    WHERE created_at > NOW() - INTERVAL '7 days'
      AND status NOT IN ('disqualified','closed_lost')
  `));
  const recentLeads = num(rows(leadCheckRes)[0]?.cnt);
  if (recentLeads === 0) {
    alerts.push({
      type: "no_new_leads",
      severity: "high",
      title: "No new qualified leads in 7 days",
      description: "The top of your funnel has been empty for a week. This will compound into a pipeline gap in 30–60 days if unaddressed.",
      score: 28,
      suggestedMove: "Run a targeted outreach campaign or ask the team for three referral intros today.",
    });
  }

  // ── 5. Threads awaiting reply > 48h ─────────────────────────────────────────
  const awaitingRes = await db.execute(sql.raw(`
    SELECT COUNT(*) AS cnt,
      MAX(EXTRACT(EPOCH FROM (NOW() - awaiting_reply_since)) / 3600) AS max_hours
    FROM email_threads
    WHERE reply_status = 'awaiting_reply'
      AND awaiting_reply_since < NOW() - INTERVAL '48 hours'
  `));
  const awaitingRow = rows(awaitingRes)[0] ?? {};
  const awaitingCount = num(awaitingRow.cnt);
  if (awaitingCount > 0) {
    const maxH = Math.round(num(awaitingRow.max_hours));
    alerts.push({
      type: "awaiting_reply",
      severity: awaitingCount >= 5 ? "high" : "medium",
      title: `${awaitingCount} email thread${awaitingCount !== 1 ? "s" : ""} awaiting reply (oldest: ${maxH}h)`,
      description: `${awaitingCount} conversation${awaitingCount !== 1 ? "s need" : " needs"} a reply. The oldest has been waiting ${maxH} hours — silence signals disinterest to prospects.`,
      score: Math.min(30, awaitingCount * 4) + Math.min(10, Math.floor(maxH / 24)),
      suggestedMove: "Send a 2-line follow-up: one question, one clear ask.",
    });
  }

  // ── 6. Board pack stale (no run in 7+ days) ──────────────────────────────────
  const bpStalenessRes = await db.execute(sql.raw(`
    SELECT
      EXISTS(SELECT 1 FROM board_pack_schedules WHERE enabled = true) AS has_active_schedule,
      MAX(r.created_at) AS last_run
    FROM board_pack_runs r
    WHERE r.status = 'success'
  `));
  const bpRow = rows(bpStalenessRes)[0] ?? {};
  const hasSchedule = bpRow.has_active_schedule;
  const lastRunDays = bpRow.last_run
    ? Math.round((Date.now() - new Date(bpRow.last_run).getTime()) / 86_400_000)
    : null;
  if (hasSchedule && (lastRunDays === null || lastRunDays >= 7)) {
    alerts.push({
      type: "board_pack_stale",
      severity: "medium",
      title: lastRunDays === null ? "Board pack has never run" : `Board pack last ran ${lastRunDays} days ago`,
      description: "Your board pack schedule is active but the report is stale. Investors and executives expect fresh data.",
      score: 15,
      suggestedMove: "Trigger a fresh board pack run before your next investor or exec meeting.",
    });
  }

  // ── 7. Open high-severity support tickets ────────────────────────────────────
  const ticketRes = await db.execute(sql.raw(`
    SELECT COUNT(*) AS cnt
    FROM tickets
    WHERE status NOT IN ('resolved','closed')
      AND (severity IN ('high','critical') OR priority IN ('high','critical'))
  `));
  const highTickets = num(rows(ticketRes)[0]?.cnt);
  if (highTickets > 0) {
    alerts.push({
      type: "open_ticket_high",
      severity: highTickets >= 3 ? "high" : "medium",
      title: `${highTickets} high-priority support ticket${highTickets !== 1 ? "s" : ""} open`,
      description: `Unresolved high-severity tickets damage retention. ${highTickets} ${highTickets !== 1 ? "are" : "is"} currently open and unresolved.`,
      score: highTickets * 5,
      suggestedMove: "Assign the ticket to a senior rep and set an SLA resolution target.",
    });
  }

  return rankPriorities(alerts);
}

// ── generateDailyBrief ────────────────────────────────────────────────────────

export async function generateDailyBrief(): Promise<DailyBrief> {
  const today = todayKey();

  const [alerts, radar] = await Promise.all([
    detectExecutiveAlerts(),
    fetchRadar(),
  ]);

  // Take top 5 by score
  const top5 = alerts.slice(0, 5);

  const topSignals: DailyBriefSignal[] = top5.map(a => ({
    type: a.type,
    severity: a.severity,
    title: a.title,
    detail: a.description,
    suggestedMove: generateSuggestedMoves(a),
    linkedObjectType: a.linkedObjectType,
    linkedObjectId: a.linkedObjectId,
  }));

  // Build headline — pick the single most urgent signal
  let headline = "Operations look stable — no critical signals today.";
  if (top5.length > 0) {
    const top = top5[0];
    if (top.severity === "critical") {
      headline = `Critical: ${top.title}`;
    } else if (top.severity === "high") {
      headline = `Attention needed: ${top.title}`;
    } else {
      headline = top.title;
    }
  }

  // Build summary from radar + top signals
  const summaryParts: string[] = [];
  if (radar.gapStatus !== "no_commit") {
    const gapLine = radar.gapStatus === "on_track"
      ? `Revenue is on track for ${monthKey()} (${fmt(radar.committedRevenue)} committed, ${fmt(radar.projectedRevenue)} projected).`
      : `Revenue is ${radar.gapStatus.replace("_", " ")} — ${Math.abs(radar.gapPercent).toFixed(1)}% gap vs ${fmt(radar.committedRevenue)} commit.`;
    summaryParts.push(gapLine);
  }
  if (radar.criticalOverdue > 0) {
    summaryParts.push(`${radar.criticalOverdue} critical task${radar.criticalOverdue !== 1 ? "s are" : " is"} overdue.`);
  } else if (radar.overdueTasks > 0) {
    summaryParts.push(`${radar.overdueTasks} task${radar.overdueTasks !== 1 ? "s are" : " is"} overdue.`);
  }
  if (radar.stalledDeals > 0) {
    summaryParts.push(`${radar.stalledDeals} stalled deal${radar.stalledDeals !== 1 ? "s" : ""} (${fmt(radar.stalledValue)} at risk).`);
  }
  if (radar.awaitingReplyThreads > 0) {
    summaryParts.push(`${radar.awaitingReplyThreads} email thread${radar.awaitingReplyThreads !== 1 ? "s need" : " needs"} a reply.`);
  }
  if (summaryParts.length === 0) {
    summaryParts.push("All systems nominal. No immediate action required.");
  }
  const summary = summaryParts.join(" ");

  // Persist to DB (upsert by brief_date)
  await db.execute(sql.raw(`
    INSERT INTO executive_briefs (brief_date, headline, summary, payload_json)
    VALUES (
      '${today}',
      ${sqlStr(headline)},
      ${sqlStr(summary)},
      ${sqlJson({ topSignals, radar })}
    )
    ON CONFLICT (brief_date) DO UPDATE SET
      headline = EXCLUDED.headline,
      summary = EXCLUDED.summary,
      payload_json = EXCLUDED.payload_json
  `));

  // Persist top alerts
  if (top5.length > 0) {
    await db.execute(sql.raw(`DELETE FROM executive_alerts WHERE brief_date = '${today}'`));
    const values = top5.map(a => `(
      '${a.type}',
      '${a.severity}',
      ${sqlStr(a.title)},
      ${sqlStr(a.description)},
      ${a.linkedObjectType ? sqlStr(a.linkedObjectType) : "NULL"},
      ${a.linkedObjectId ?? "NULL"},
      'open',
      ${a.score},
      '${today}',
      ${sqlStr(generateSuggestedMoves(a))}
    )`).join(",");
    await db.execute(sql.raw(`
      INSERT INTO executive_alerts
        (type, severity, title, description, linked_object_type, linked_object_id, status, score, brief_date, suggested_move)
      VALUES ${values}
    `));
  }

  return {
    briefDate: today,
    headline,
    summary,
    topSignals,
    radar,
    generatedAt: new Date().toISOString(),
  };
}

// ── getTodaysBrief ─────────────────────────────────────────────────────────────

export async function getTodaysBrief(): Promise<DailyBrief | null> {
  const today = todayKey();
  const res = await db.execute(sql.raw(`
    SELECT brief_date, headline, summary, payload_json, created_at
    FROM executive_briefs
    WHERE brief_date = '${today}'
    LIMIT 1
  `));
  const row = rows(res)[0];
  if (!row) return null;
  const payload = (row.payload_json ?? {}) as any;
  return {
    briefDate: row.brief_date as string,
    headline: row.headline as string,
    summary: row.summary as string,
    topSignals: payload.topSignals ?? [],
    radar: payload.radar ?? null,
    generatedAt: row.created_at as string,
  };
}

// ── getAlerts ────────────────────────────────────────────────────────────────

export async function getAlerts(status = "open"): Promise<any[]> {
  const res = await db.execute(sql.raw(`
    SELECT id, type, severity, title, description, linked_object_type, linked_object_id,
      status, score, brief_date, suggested_move, created_at
    FROM executive_alerts
    WHERE status = '${status}'
    ORDER BY score DESC, created_at DESC
    LIMIT 50
  `));
  return rows(res);
}

// ── updateAlertStatus ─────────────────────────────────────────────────────────

export async function updateAlertStatus(id: number, status: string): Promise<any> {
  const valid = ["open", "dismissed", "resolved"];
  if (!valid.includes(status)) throw new Error(`Invalid status: ${status}`);
  const res = await db.execute(sql.raw(`
    UPDATE executive_alerts SET status = '${status}' WHERE id = ${id}
    RETURNING *
  `));
  return rows(res)[0] ?? null;
}
