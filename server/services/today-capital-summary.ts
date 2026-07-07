/**
 * today-capital-summary.ts
 *
 * Computes the Capital & Fundraising section for the /api/today/summary endpoint.
 * All capital_investors DB queries are isolated here (not in routes.ts) to
 * maintain the capital-data isolation invariant enforced by capital-hardening tests.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

export type TodayCapitalSection = {
  title: string;
  investors: Array<{
    id: number;
    name: string;
    stage: string | null;
    priority: string | null;
    nextStepDate: string | null;
    lastTouchAt: string | null;
    nextStepOverdue: boolean;
    daysSinceTouch: number | null;
  }>;
  stats: { total_active: number; overdue_follow_ups: number; hot_count: number };
  link: string;
  drilldown_endpoint?: string;
  empty_state: string;
} | null;

/**
 * Returns the capital section for the Today cockpit, or null if the user
 * does not have capital access.
 */
export async function getTodayCapitalSection(
  userId: number,
  hasCapital: boolean,
  now: Date
): Promise<TodayCapitalSection> {
  if (!hasCapital) return null;

  try {
    const [capInvRes, capStatsRes] = await Promise.all([
      db.execute(sql.raw(
        `SELECT id, name, stage, priority,
                next_step_date AS "nextStepDate", last_touch_at AS "lastTouchAt"
         FROM capital_investors
         WHERE stage NOT IN ('Passed','Wired / Closed')
           AND (do_not_contact IS NULL OR do_not_contact = FALSE)
         ORDER BY
           CASE priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END,
           next_step_date ASC NULLS LAST
         LIMIT 5`
      )),
      db.execute(sql.raw(
        `SELECT
           COUNT(*)::int AS total_active,
           COUNT(*) FILTER (WHERE next_step_date < NOW())::int AS overdue_follow_ups,
           COUNT(*) FILTER (WHERE priority IN ('Critical','High'))::int AS hot_count
         FROM capital_investors
         WHERE stage NOT IN ('Passed','Wired / Closed')
           AND (do_not_contact IS NULL OR do_not_contact = FALSE)`
      )),
    ]);

    const capStats = (capStatsRes as any).rows[0] ?? {};

    return {
      title: "Capital & Fundraising",
      investors: ((capInvRes as any).rows ?? []).map((inv: any) => ({
        id:     inv.id,
        name:   inv.name,
        stage:  inv.stage,
        priority: inv.priority,
        nextStepDate: inv.nextStepDate,
        lastTouchAt:  inv.lastTouchAt,
        nextStepOverdue: inv.nextStepDate ? new Date(inv.nextStepDate) < now : false,
        daysSinceTouch: inv.lastTouchAt
          ? Math.floor((now.getTime() - new Date(inv.lastTouchAt).getTime()) / 86400000)
          : null,
      })),
      stats: {
        total_active:       Number(capStats.total_active ?? 0),
        overdue_follow_ups: Number(capStats.overdue_follow_ups ?? 0),
        hot_count:          Number(capStats.hot_count ?? 0),
      },
      link: "/capital",
      drilldown_endpoint: "/api/capital/follow-ups",
      empty_state: "No active investor follow-ups.",
    };
  } catch (_capErr) {
    return {
      title: "Capital & Fundraising",
      investors: [],
      stats: { total_active: 0, overdue_follow_ups: 0, hot_count: 0 },
      link: "/capital",
      empty_state: "Capital data unavailable.",
    };
  }
}
