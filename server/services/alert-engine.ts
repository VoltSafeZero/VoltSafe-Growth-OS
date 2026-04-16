import { db } from "../db";
import { sql } from "drizzle-orm";

export interface AlertRule {
  stalledDealDays: number;          // default 7
  quoteUnansweredDays: number;      // default 7
  churnScoreThreshold: number;      // default 70
  deploymentBlockedDays: number;    // default 3
  renewalDueDays: number;           // default 30
  pricingLockExpiryDays: number;    // default 14
  scoreBandChangeSensitive: boolean; // default true
}

export const DEFAULT_ALERT_RULES: AlertRule = {
  stalledDealDays: 7,
  quoteUnansweredDays: 7,
  churnScoreThreshold: 70,
  deploymentBlockedDays: 3,
  renewalDueDays: 30,
  pricingLockExpiryDays: 14,
  scoreBandChangeSensitive: true,
};

interface NotifRow {
  userId: number;
  type: string;
  title: string;
  body: string;
  severity: string;
  linkedObjectType?: string;
  linkedObjectId?: number;
  actionUrl: string;
  dedupeKey: string;
  expiresAt: Date;
}

function esc(s: string) { return s.replace(/'/g, "''"); }

export async function runAlertEngine(userId: number, rules: AlertRule = DEFAULT_ALERT_RULES): Promise<number> {
  const now = new Date();
  const isoNow = now.toISOString();
  const todayKey = now.toISOString().slice(0, 10);
  const weekKey = `${now.getFullYear()}-W${Math.ceil(now.getDate() / 7)}`;
  const expiry = new Date(now.getTime() + 7 * 86400_000);

  const oneDayAgo = new Date(now.getTime() - 86400_000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400_000);

  const existingRes = await db.execute(sql.raw(
    `SELECT dedupe_key FROM notifications WHERE user_id = ${userId} AND dedupe_key IS NOT NULL AND created_at >= '${oneDayAgo.toISOString()}'`
  ));
  const existingKeys = new Set<string>((existingRes as any).rows.map((r: any) => r.dedupe_key));

  const existingWeeklyRes = await db.execute(sql.raw(
    `SELECT dedupe_key FROM notifications WHERE user_id = ${userId} AND dedupe_key IS NOT NULL AND created_at >= '${sevenDaysAgo.toISOString()}'`
  ));
  const existingWeeklyKeys = new Set<string>((existingWeeklyRes as any).rows.map((r: any) => r.dedupe_key));

  const toInsert: NotifRow[] = [];

  const maybeAdd = (key: string, row: Omit<NotifRow, "dedupeKey" | "expiresAt">, weekly = false) => {
    const seen = weekly ? existingWeeklyKeys : existingKeys;
    if (!seen.has(key)) {
      toInsert.push({ ...row, dedupeKey: key, expiresAt: expiry });
      if (weekly) existingWeeklyKeys.add(key);
      else existingKeys.add(key);
    }
  };

  // 1. STALLED DEALS — no activity beyond threshold
  const stalledThreshold = new Date(now.getTime() - rules.stalledDealDays * 86400_000);
  try {
    const stalledRes = await db.execute(sql.raw(
      `SELECT id, title, amount FROM opportunities
       WHERE owner_user_id = ${userId}
         AND stage NOT IN ('closed_won','closed_lost')
         AND (last_activity_date IS NULL OR last_activity_date <= '${stalledThreshold.toISOString()}')
       ORDER BY amount DESC NULLS LAST LIMIT 5`
    ));
    for (const o of (stalledRes as any).rows ?? []) {
      maybeAdd(`stalled-deal-${o.id}-${weekKey}`, {
        userId, type: "stalled_deal", severity: "high",
        title: "Deal Stalled",
        body: `"${o.title}" — no activity in ${rules.stalledDealDays}+ days`,
        linkedObjectType: "opportunity", linkedObjectId: Number(o.id),
        actionUrl: "/opportunities",
      }, true);
    }
  } catch (_) {}

  // 2. QUOTES UNANSWERED — sent but no response
  const quoteThreshold = new Date(now.getTime() - rules.quoteUnansweredDays * 86400_000);
  try {
    const quotesRes = await db.execute(sql.raw(
      `SELECT q.id, q.title, a.name AS account_name
       FROM quotes q LEFT JOIN accounts a ON a.id = q.account_id
       WHERE q.status IN ('sent','pending') AND q.created_at <= '${quoteThreshold.toISOString()}'
       LIMIT 5`
    ));
    for (const q of (quotesRes as any).rows ?? []) {
      maybeAdd(`unanswered-quote-${q.id}-${weekKey}`, {
        userId, type: "unanswered_quote", severity: "medium",
        title: "Quote Unanswered",
        body: `"${q.account_name ?? q.title}" — quote sent ${rules.quoteUnansweredDays}+ days ago with no response`,
        linkedObjectType: "quote", linkedObjectId: Number(q.id),
        actionUrl: "/quoting",
      }, true);
    }
  } catch (_) {}

  // 3. CHURN SCORE THRESHOLD BREACH
  try {
    const churnRes = await db.execute(sql.raw(
      `SELECT r.id, r.account_name, r.churn_risk_score, r.mrr
       FROM renewals r
       WHERE r.churn_risk_score >= ${rules.churnScoreThreshold}
         AND r.status NOT IN ('renewed','cancelled')
       ORDER BY r.churn_risk_score DESC LIMIT 5`
    ));
    for (const r of (churnRes as any).rows ?? []) {
      maybeAdd(`churn-threshold-${r.id}-${weekKey}`, {
        userId, type: "churn_risk", severity: "high",
        title: "High Churn Risk",
        body: `${r.account_name} churn score ${r.churn_risk_score} — above ${rules.churnScoreThreshold} threshold`,
        linkedObjectType: "renewal", linkedObjectId: Number(r.id),
        actionUrl: "/revenue/renewals",
      }, true);
    }
  } catch (_) {}

  // 4. DEPLOYMENT BLOCKED BEYOND THRESHOLD
  const deployBlockedThreshold = new Date(now.getTime() - rules.deploymentBlockedDays * 86400_000);
  try {
    const deployRes = await db.execute(sql.raw(
      `SELECT id, marina_name, status, updated_at
       FROM install_workflows
       WHERE status IN ('blocked','on_hold')
         AND updated_at <= '${deployBlockedThreshold.toISOString()}'
       LIMIT 5`
    ));
    for (const d of (deployRes as any).rows ?? []) {
      const days = Math.floor((now.getTime() - new Date(d.updated_at).getTime()) / 86400_000);
      maybeAdd(`deploy-blocked-${d.id}-${weekKey}`, {
        userId, type: "deployment_blocked", severity: "high",
        title: "Deployment Blocked",
        body: `${d.marina_name} has been ${d.status} for ${days} day${days !== 1 ? "s" : ""}`,
        linkedObjectType: "install_workflow", linkedObjectId: Number(d.id),
        actionUrl: "/deployment",
      }, true);
    }
  } catch (_) {}

  // 5. CERTIFICATION BLOCKER ACTIVE
  try {
    const certRes = await db.execute(sql.raw(
      `SELECT id, name, status FROM cert_trackers
       WHERE status IN ('blocked','expired') LIMIT 5`
    ));
    for (const c of (certRes as any).rows ?? []) {
      maybeAdd(`cert-blocker-${c.id}-${weekKey}`, {
        userId, type: "cert_blocker", severity: "high",
        title: "Certification Blocker",
        body: `${c.name} [${c.status}] — requires immediate action`,
        linkedObjectType: "cert", linkedObjectId: Number(c.id),
        actionUrl: "/compliance",
      }, true);
    }
  } catch (_) {}

  // 6. RENEWAL DUE / OVERDUE
  const renewalWindow = new Date(now.getTime() + rules.renewalDueDays * 86400_000);
  try {
    const renewalRes = await db.execute(sql.raw(
      `SELECT id, account_name, renewal_date, mrr
       FROM renewals
       WHERE status NOT IN ('renewed','cancelled')
         AND renewal_date <= '${renewalWindow.toISOString()}'
       ORDER BY renewal_date ASC LIMIT 5`
    ));
    for (const r of (renewalRes as any).rows ?? []) {
      const days = Math.floor((new Date(r.renewal_date).getTime() - now.getTime()) / 86400_000);
      const overdue = days < 0;
      maybeAdd(`renewal-due-${r.id}-${weekKey}`, {
        userId, type: "renewal_due", severity: overdue ? "high" : "medium",
        title: overdue ? "Renewal Overdue" : "Renewal Due Soon",
        body: `${r.account_name}${r.mrr ? ` ($${Number(r.mrr).toLocaleString()}/mo)` : ""} — ${overdue ? `${Math.abs(days)}d OVERDUE` : `due in ${days} day${days !== 1 ? "s" : ""}`}`,
        linkedObjectType: "renewal", linkedObjectId: Number(r.id),
        actionUrl: "/revenue/renewals",
      }, true);
    }
  } catch (_) {}

  // 7. PRICING LOCK EXPIRY APPROACHING
  const pricingWindow = new Date(now.getTime() + rules.pricingLockExpiryDays * 86400_000);
  try {
    const pricingRes = await db.execute(sql.raw(
      `SELECT q.id, q.title, q.lock_expiry_date, a.name AS account_name
       FROM quotes q LEFT JOIN accounts a ON a.id = q.account_id
       WHERE q.lock_expiry_date IS NOT NULL
         AND q.lock_expiry_date <= '${pricingWindow.toISOString()}'
         AND q.lock_expiry_date >= '${isoNow}'
         AND q.status NOT IN ('accepted','rejected','archived')
       ORDER BY q.lock_expiry_date ASC LIMIT 5`
    ));
    for (const q of (pricingRes as any).rows ?? []) {
      const days = Math.floor((new Date(q.lock_expiry_date).getTime() - now.getTime()) / 86400_000);
      maybeAdd(`pricing-lock-${q.id}-${weekKey}`, {
        userId, type: "pricing_lock_expiry", severity: days <= 3 ? "high" : "medium",
        title: "Pricing Lock Expiring",
        body: `${q.account_name ?? q.title} — pricing lock expires in ${days} day${days !== 1 ? "s" : ""}`,
        linkedObjectType: "quote", linkedObjectId: Number(q.id),
        actionUrl: "/quoting",
      }, true);
    }
  } catch (_) {}

  // 8. MAJOR SCORE BAND CHANGE (score jump ≥ 20 points vs previous snapshot)
  if (rules.scoreBandChangeSensitive) {
    try {
      const scoreRes = await db.execute(sql.raw(
        `SELECT sh.entity_type, sh.entity_id, sh.score, sh.previous_score, sh.entity_name
         FROM score_snapshots sh
         WHERE sh.recorded_at >= '${oneDayAgo.toISOString()}'
           AND ABS(sh.score - COALESCE(sh.previous_score, sh.score)) >= 20
         ORDER BY ABS(sh.score - COALESCE(sh.previous_score, sh.score)) DESC LIMIT 5`
      ));
      for (const s of (scoreRes as any).rows ?? []) {
        const delta = s.score - (s.previous_score ?? s.score);
        const dir = delta > 0 ? "↑" : "↓";
        maybeAdd(`score-change-${s.entity_type}-${s.entity_id}-${todayKey}`, {
          userId, type: "score_change", severity: Math.abs(delta) >= 30 ? "high" : "medium",
          title: "Score Band Change",
          body: `${s.entity_name ?? `${s.entity_type} #${s.entity_id}`} score ${dir}${Math.abs(delta)} points (now ${s.score})`,
          linkedObjectType: s.entity_type, linkedObjectId: Number(s.entity_id),
          actionUrl: "/scores",
        });
      }
    } catch (_) {}
  }

  // Batch insert
  if (toInsert.length > 0) {
    const vals = toInsert.map(n =>
      `(${n.userId}, '${esc(n.type)}', '${esc(n.title)}', '${esc(n.body)}', '${n.severity}', ${n.linkedObjectType ? `'${esc(n.linkedObjectType)}'` : "NULL"}, ${n.linkedObjectId ?? "NULL"}, '${esc(n.actionUrl)}', false, '${esc(n.dedupeKey)}', '${n.expiresAt.toISOString()}', NOW())`
    ).join(",\n");
    await db.execute(sql.raw(
      `INSERT INTO notifications (user_id, type, title, body, severity, linked_object_type, linked_object_id, action_url, is_read, dedupe_key, expires_at, created_at) VALUES ${vals}`
    ));
  }

  return toInsert.length;
}
