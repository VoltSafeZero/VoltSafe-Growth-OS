import { db } from "../db";
import { sql } from "drizzle-orm";

export type DigestSection =
  | "topPriorities"
  | "overdueTasks"
  | "hotLeads"
  | "hotOpportunities"
  | "quotesFollowUp"
  | "blockedInstalls"
  | "certBlockers"
  | "revenueAtRisk"
  | "mrrSummary"
  | "renewalRisks"
  | "churnRisks"
  | "territoryWhitespace"
  | "pipelineMovement"
  | "procurementBlockers";

export interface DigestSectionResult {
  key: DigestSection;
  label: string;
  bullets: string[];
  count: number;
  severity: "low" | "medium" | "high";
}

export interface ComposedDigest {
  userId: number;
  role: string;
  generatedAt: Date;
  title: string;
  summary: string;
  sections: DigestSectionResult[];
  totalSignals: number;
  highSeverityCount: number;
}

// Role-based default sections
const ROLE_SECTION_DEFAULTS: Record<string, DigestSection[]> = {
  ceo: ["topPriorities", "revenueAtRisk", "blockedInstalls", "certBlockers", "pipelineMovement", "renewalRisks", "churnRisks"],
  cfo: ["mrrSummary", "revenueAtRisk", "renewalRisks", "procurementBlockers", "quotesFollowUp"],
  cto: ["certBlockers", "blockedInstalls", "procurementBlockers", "overdueTasks"],
  cmo: ["hotLeads", "territoryWhitespace", "pipelineMovement", "quotesFollowUp"],
  sales: ["topPriorities", "hotLeads", "hotOpportunities", "overdueTasks", "quotesFollowUp", "pipelineMovement"],
  cs: ["renewalRisks", "churnRisks", "overdueTasks", "topPriorities"],
  ops: ["blockedInstalls", "procurementBlockers", "certBlockers", "overdueTasks"],
  admin: ["topPriorities", "overdueTasks", "hotLeads", "hotOpportunities", "blockedInstalls", "revenueAtRisk", "mrrSummary"],
  master_admin: ["topPriorities", "overdueTasks", "hotLeads", "hotOpportunities", "blockedInstalls", "revenueAtRisk", "mrrSummary"],
};

export function getSectionsForRole(role: string): DigestSection[] {
  const key = role.toLowerCase().replace(/-/g, "_");
  return ROLE_SECTION_DEFAULTS[key] ?? ROLE_SECTION_DEFAULTS["sales"];
}

export function getRoleTitle(role: string): string {
  const map: Record<string, string> = {
    ceo: "CEO Executive",
    cfo: "CFO Financial",
    cto: "CTO Technical",
    cmo: "CMO Marketing",
    sales: "Sales",
    cs: "Customer Success",
    ops: "Operations",
    admin: "Admin",
    master_admin: "Admin",
  };
  return map[role.toLowerCase()] ?? "Executive";
}

async function fetchTopPriorities(userId: number): Promise<DigestSectionResult> {
  const res = await db.execute(sql.raw(
    `SELECT t.id, t.title, t.priority, t.due_date FROM tasks t
     WHERE t.owner_user_id = ${userId} AND t.status NOT IN ('done','completed')
       AND t.priority IN ('urgent','high')
     ORDER BY t.priority = 'urgent' DESC, t.due_date ASC NULLS LAST LIMIT 5`
  ));
  const rows: any[] = (res as any).rows ?? [];
  const bullets = rows.map(r => {
    const due = r.due_date ? ` (due ${new Date(r.due_date).toLocaleDateString()})` : "";
    return `[${r.priority.toUpperCase()}] ${r.title}${due}`;
  });
  return {
    key: "topPriorities", label: "Top Priorities",
    bullets: bullets.length ? bullets : ["No urgent priorities — all clear."],
    count: rows.length,
    severity: rows.length > 0 ? "high" : "low",
  };
}

async function fetchOverdueTasks(userId: number): Promise<DigestSectionResult> {
  const res = await db.execute(sql.raw(
    `SELECT id, title, due_date FROM tasks
     WHERE owner_user_id = ${userId} AND status NOT IN ('done','completed') AND due_date < NOW()
     ORDER BY due_date ASC LIMIT 8`
  ));
  const rows: any[] = (res as any).rows ?? [];
  const bullets = rows.map(r => {
    const days = Math.floor((Date.now() - new Date(r.due_date).getTime()) / 86400000);
    return `${r.title} — ${days}d overdue`;
  });
  return {
    key: "overdueTasks", label: "Overdue Tasks",
    bullets: bullets.length ? bullets : ["No overdue tasks — great execution."],
    count: rows.length,
    severity: rows.length >= 3 ? "high" : rows.length > 0 ? "medium" : "low",
  };
}

async function fetchHotLeads(_userId: number): Promise<DigestSectionResult> {
  const res = await db.execute(sql.raw(
    `SELECT l.id, l.marina_name, l.score, l.status FROM leads l
     WHERE l.score >= 70 AND l.status NOT IN ('converted','disqualified')
     ORDER BY l.score DESC LIMIT 5`
  ));
  const rows: any[] = (res as any).rows ?? [];
  const bullets = rows.map(r => `${r.marina_name} — score ${r.score} (${r.status})`);
  return {
    key: "hotLeads", label: "Hot Leads",
    bullets: bullets.length ? bullets : ["No hot leads above threshold."],
    count: rows.length,
    severity: rows.length > 0 ? "high" : "low",
  };
}

async function fetchHotOpportunities(userId: number): Promise<DigestSectionResult> {
  const res = await db.execute(sql.raw(
    `SELECT o.id, o.title, o.amount, o.stage, o.score FROM opportunities o
     WHERE o.owner_user_id = ${userId} AND o.stage NOT IN ('closed_won','closed_lost')
       AND (o.score >= 70 OR o.amount >= 50000)
     ORDER BY o.score DESC NULLS LAST, o.amount DESC NULLS LAST LIMIT 5`
  ));
  const rows: any[] = (res as any).rows ?? [];
  const bullets = rows.map(r => {
    const amt = r.amount ? ` — $${Number(r.amount).toLocaleString()}` : "";
    const sc = r.score ? ` (score ${r.score})` : "";
    return `${r.title}${amt}${sc} [${r.stage}]`;
  });
  return {
    key: "hotOpportunities", label: "Hot Opportunities",
    bullets: bullets.length ? bullets : ["No high-priority open opportunities."],
    count: rows.length,
    severity: rows.length > 0 ? "high" : "low",
  };
}

async function fetchQuotesFollowUp(_userId: number): Promise<DigestSectionResult> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const res = await db.execute(sql.raw(
    `SELECT q.id, q.title, q.total_amount, q.status, q.created_at, a.name AS account_name
     FROM quotes q LEFT JOIN accounts a ON a.id = q.account_id
     WHERE q.status IN ('sent','pending') AND q.created_at <= '${sevenDaysAgo}'
     ORDER BY q.total_amount DESC NULLS LAST LIMIT 6`
  ));
  const rows: any[] = (res as any).rows ?? [];
  const bullets = rows.map(r => {
    const days = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000);
    const amt = r.total_amount ? ` $${Number(r.total_amount).toLocaleString()}` : "";
    return `${r.account_name ?? r.title}${amt} — ${days}d unanswered`;
  });
  return {
    key: "quotesFollowUp", label: "Quotes Needing Follow-Up",
    bullets: bullets.length ? bullets : ["All quotes have been responded to."],
    count: rows.length,
    severity: rows.length >= 3 ? "high" : rows.length > 0 ? "medium" : "low",
  };
}

async function fetchBlockedInstalls(_userId: number): Promise<DigestSectionResult> {
  const res = await db.execute(sql.raw(
    `SELECT iw.id, iw.marina_name, iw.status, iw.blocker_reason, iw.target_install_date
     FROM install_workflows iw
     WHERE iw.status IN ('blocked','on_hold') OR (iw.blocker_reason IS NOT NULL AND iw.blocker_reason != '')
     ORDER BY iw.target_install_date ASC NULLS LAST LIMIT 6`
  ));
  const rows: any[] = (res as any).rows ?? [];
  const bullets = rows.map(r => {
    const reason = r.blocker_reason ? `: ${r.blocker_reason}` : "";
    return `${r.marina_name} [${r.status}]${reason}`;
  });
  return {
    key: "blockedInstalls", label: "Blocked Installs",
    bullets: bullets.length ? bullets : ["No blocked installations — projects on track."],
    count: rows.length,
    severity: rows.length >= 2 ? "high" : rows.length > 0 ? "medium" : "low",
  };
}

async function fetchCertBlockers(_userId: number): Promise<DigestSectionResult> {
  const thirtyDaysAhead = new Date(Date.now() + 30 * 86400000).toISOString();
  const res = await db.execute(sql.raw(
    `SELECT ct.id, ct.name, ct.status, ct.expiry_date, ct.assigned_to_user_id
     FROM cert_trackers ct
     WHERE ct.status IN ('blocked','expired','expiring_soon') OR (ct.expiry_date IS NOT NULL AND ct.expiry_date <= '${thirtyDaysAhead}' AND ct.status != 'active')
     ORDER BY ct.expiry_date ASC NULLS LAST LIMIT 5`
  ));
  const rows: any[] = (res as any).rows ?? [];
  const bullets = rows.map(r => {
    const exp = r.expiry_date ? ` (expires ${new Date(r.expiry_date).toLocaleDateString()})` : "";
    return `${r.name} [${r.status}]${exp}`;
  });
  return {
    key: "certBlockers", label: "Certification Blockers",
    bullets: bullets.length ? bullets : ["No certification issues — all compliant."],
    count: rows.length,
    severity: rows.length > 0 ? "high" : "low",
  };
}

async function fetchRevenueAtRisk(_userId: number): Promise<DigestSectionResult> {
  const res = await db.execute(sql.raw(
    `SELECT r.id, r.account_name, r.mrr, r.churn_risk_score, r.renewal_date
     FROM renewals r
     WHERE r.status NOT IN ('renewed','cancelled') AND (r.churn_risk_score >= 60 OR r.renewal_date <= NOW() + INTERVAL '30 days')
     ORDER BY r.churn_risk_score DESC NULLS LAST, r.mrr DESC NULLS LAST LIMIT 6`
  ));
  const rows: any[] = (res as any).rows ?? [];
  const bullets = rows.map(r => {
    const mrr = r.mrr ? ` $${Number(r.mrr).toLocaleString()}/mo` : "";
    const risk = r.churn_risk_score ? ` churn risk ${r.churn_risk_score}` : "";
    const due = r.renewal_date ? ` due ${new Date(r.renewal_date).toLocaleDateString()}` : "";
    return `${r.account_name}${mrr}${risk}${due}`;
  });
  return {
    key: "revenueAtRisk", label: "Revenue at Risk",
    bullets: bullets.length ? bullets : ["No accounts flagged at significant churn risk."],
    count: rows.length,
    severity: rows.length >= 2 ? "high" : rows.length > 0 ? "medium" : "low",
  };
}

async function fetchMrrSummary(_userId: number): Promise<DigestSectionResult> {
  const res = await db.execute(sql.raw(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'active' THEN mrr ELSE 0 END), 0) AS current_mrr,
       COALESCE(SUM(CASE WHEN status = 'pending' THEN mrr ELSE 0 END), 0) AS pending_mrr,
       COUNT(*) FILTER (WHERE status = 'active') AS active_count,
       COUNT(*) FILTER (WHERE status = 'cancelled') AS churned_count
     FROM renewals`
  ));
  const row: any = (res as any).rows?.[0] ?? {};
  const curr = Number(row.current_mrr ?? 0);
  const pend = Number(row.pending_mrr ?? 0);
  const bullets = [
    `Current MRR: $${curr.toLocaleString()}/mo (${row.active_count ?? 0} active accounts)`,
    `Pending / future MRR: $${pend.toLocaleString()}/mo`,
    row.churned_count > 0 ? `Churned this period: ${row.churned_count} accounts` : "No churn recorded this period.",
  ];
  return {
    key: "mrrSummary", label: "MRR Summary",
    bullets,
    count: 1,
    severity: "medium",
  };
}

async function fetchRenewalRisks(_userId: number): Promise<DigestSectionResult> {
  const sixtyDaysAhead = new Date(Date.now() + 60 * 86400000).toISOString();
  const res = await db.execute(sql.raw(
    `SELECT r.id, r.account_name, r.mrr, r.renewal_date, r.status
     FROM renewals r
     WHERE r.status NOT IN ('renewed','cancelled') AND r.renewal_date <= '${sixtyDaysAhead}'
     ORDER BY r.renewal_date ASC LIMIT 6`
  ));
  const rows: any[] = (res as any).rows ?? [];
  const bullets = rows.map(r => {
    const days = Math.floor((new Date(r.renewal_date).getTime() - Date.now()) / 86400000);
    const mrr = r.mrr ? ` ($${Number(r.mrr).toLocaleString()}/mo)` : "";
    const when = days < 0 ? `${Math.abs(days)}d OVERDUE` : `in ${days}d`;
    return `${r.account_name}${mrr} — renewal ${when}`;
  });
  return {
    key: "renewalRisks", label: "Renewal Risks",
    bullets: bullets.length ? bullets : ["No renewals due in the next 60 days."],
    count: rows.length,
    severity: rows.length >= 3 ? "high" : rows.length > 0 ? "medium" : "low",
  };
}

async function fetchChurnRisks(_userId: number): Promise<DigestSectionResult> {
  const res = await db.execute(sql.raw(
    `SELECT r.id, r.account_name, r.mrr, r.churn_risk_score
     FROM renewals r
     WHERE r.churn_risk_score >= 70 AND r.status NOT IN ('renewed','cancelled')
     ORDER BY r.churn_risk_score DESC NULLS LAST LIMIT 5`
  ));
  const rows: any[] = (res as any).rows ?? [];
  const bullets = rows.map(r => {
    const mrr = r.mrr ? ` $${Number(r.mrr).toLocaleString()}/mo` : "";
    return `${r.account_name}${mrr} — churn score ${r.churn_risk_score}`;
  });
  return {
    key: "churnRisks", label: "Churn Risks",
    bullets: bullets.length ? bullets : ["No accounts at high churn risk."],
    count: rows.length,
    severity: rows.length > 0 ? "high" : "low",
  };
}

async function fetchTerritoryWhitespace(_userId: number): Promise<DigestSectionResult> {
  const res = await db.execute(sql.raw(
    `SELECT territory, COUNT(*) AS lead_count, AVG(score)::int AS avg_score
     FROM leads WHERE status NOT IN ('converted','disqualified') AND territory IS NOT NULL
     GROUP BY territory ORDER BY lead_count DESC LIMIT 5`
  ));
  const rows: any[] = (res as any).rows ?? [];
  const bullets = rows.map(r => `${r.territory}: ${r.lead_count} leads (avg score ${r.avg_score ?? "N/A"})`);
  return {
    key: "territoryWhitespace", label: "Territory & Source Highlights",
    bullets: bullets.length ? bullets : ["No territory data available."],
    count: rows.length,
    severity: "medium",
  };
}

async function fetchPipelineMovement(_userId: number): Promise<DigestSectionResult> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const res = await db.execute(sql.raw(
    `SELECT stage, COUNT(*) AS n, SUM(amount)::bigint AS total
     FROM opportunities
     WHERE owner_user_id = ${_userId} AND stage NOT IN ('closed_won','closed_lost')
       AND last_activity_date >= '${sevenDaysAgo}'
     GROUP BY stage ORDER BY total DESC NULLS LAST LIMIT 6`
  ));
  const rows: any[] = (res as any).rows ?? [];
  const bullets = rows.map(r => {
    const total = r.total ? ` ($${Number(r.total).toLocaleString()})` : "";
    return `${r.stage}: ${r.n} deals${total} moved`;
  });

  const stalledRes = await db.execute(sql.raw(
    `SELECT COUNT(*) AS n FROM opportunities
     WHERE owner_user_id = ${_userId} AND stage NOT IN ('closed_won','closed_lost')
       AND (last_activity_date IS NULL OR last_activity_date < '${sevenDaysAgo}')`
  ));
  const stalled = Number((stalledRes as any).rows?.[0]?.n ?? 0);
  if (stalled > 0) bullets.push(`${stalled} deal${stalled > 1 ? "s" : ""} stalled — no activity in 7+ days`);

  return {
    key: "pipelineMovement", label: "Pipeline Movement",
    bullets: bullets.length ? bullets : ["No pipeline activity in the last 7 days."],
    count: rows.length,
    severity: stalled > 3 ? "high" : stalled > 0 ? "medium" : "low",
  };
}

async function fetchProcurementBlockers(_userId: number): Promise<DigestSectionResult> {
  const res = await db.execute(sql.raw(
    `SELECT pb.id, pb.batch_name, pb.status, pb.blocker_reason
     FROM procurement_batches pb
     WHERE pb.status IN ('blocked','on_hold') OR (pb.blocker_reason IS NOT NULL AND pb.blocker_reason != '')
     ORDER BY pb.created_at DESC LIMIT 5`
  ));
  const rows: any[] = (res as any).rows ?? [];
  const bullets = rows.map(r => {
    const reason = r.blocker_reason ? `: ${r.blocker_reason}` : "";
    return `${r.batch_name} [${r.status}]${reason}`;
  });
  return {
    key: "procurementBlockers", label: "Procurement Blockers",
    bullets: bullets.length ? bullets : ["No blocked procurement batches."],
    count: rows.length,
    severity: rows.length > 0 ? "high" : "low",
  };
}

const SECTION_FETCHERS: Record<DigestSection, (userId: number) => Promise<DigestSectionResult>> = {
  topPriorities: fetchTopPriorities,
  overdueTasks: fetchOverdueTasks,
  hotLeads: fetchHotLeads,
  hotOpportunities: fetchHotOpportunities,
  quotesFollowUp: fetchQuotesFollowUp,
  blockedInstalls: fetchBlockedInstalls,
  certBlockers: fetchCertBlockers,
  revenueAtRisk: fetchRevenueAtRisk,
  mrrSummary: fetchMrrSummary,
  renewalRisks: fetchRenewalRisks,
  churnRisks: fetchChurnRisks,
  territoryWhitespace: fetchTerritoryWhitespace,
  pipelineMovement: fetchPipelineMovement,
  procurementBlockers: fetchProcurementBlockers,
};

export async function composeDigest(
  userId: number,
  role: string,
  enabledSections: DigestSection[],
  severityThreshold: "low" | "medium" | "high" = "medium"
): Promise<ComposedDigest> {
  const generatedAt = new Date();
  const thresholdRank = { low: 0, medium: 1, high: 2 };
  const minRank = thresholdRank[severityThreshold];

  const results = await Promise.allSettled(
    enabledSections.map(s => SECTION_FETCHERS[s]?.(userId))
  );

  const sections: DigestSectionResult[] = results
    .map((r, i) => r.status === "fulfilled" ? r.value : null)
    .filter((s): s is DigestSectionResult => s !== null && thresholdRank[s.severity] >= minRank);

  const highSeverityCount = sections.filter(s => s.severity === "high").length;
  const totalSignals = sections.reduce((sum, s) => sum + s.count, 0);

  const roleTitle = getRoleTitle(role);
  const title = `${roleTitle} Digest — ${generatedAt.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}`;

  let summary: string;
  if (totalSignals === 0) {
    summary = "All clear — no critical items require your attention today.";
  } else if (highSeverityCount === 0) {
    summary = `${totalSignals} item${totalSignals > 1 ? "s" : ""} to review. No critical issues.`;
  } else {
    summary = `${highSeverityCount} critical signal${highSeverityCount > 1 ? "s" : ""} and ${totalSignals - highSeverityCount} other item${totalSignals - highSeverityCount !== 1 ? "s" : ""} need your attention.`;
  }

  return { userId, role, generatedAt, title, summary, sections, totalSignals, highSeverityCount };
}

export function formatDigestAsHtml(digest: ComposedDigest): string {
  const sectionHtml = digest.sections.map(s => {
    const color = s.severity === "high" ? "#ef4444" : s.severity === "medium" ? "#f59e0b" : "#22d3ee";
    const bulletList = s.bullets.map(b => `<li style="margin: 4px 0; color: #cbd5e1;">${b}</li>`).join("");
    return `
      <div style="margin-bottom: 20px; border-left: 3px solid ${color}; padding-left: 14px;">
        <div style="font-weight: 600; font-size: 14px; color: #f1f5f9; margin-bottom: 6px;">${s.label}</div>
        <ul style="margin: 0; padding-left: 16px; font-size: 13px; line-height: 1.6;">${bulletList}</ul>
      </div>`;
  }).join("");

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1e293b; border-radius: 12px; overflow: hidden;">
    <div style="background: linear-gradient(135deg, #22d3ee22, #0f172a); padding: 28px 32px; border-bottom: 1px solid #334155;">
      <div style="color: #22d3ee; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 6px;">VoltSafe Growth OS</div>
      <div style="color: #f1f5f9; font-size: 20px; font-weight: 700;">${digest.title}</div>
      <div style="color: #94a3b8; font-size: 13px; margin-top: 8px;">${digest.summary}</div>
    </div>
    <div style="padding: 28px 32px;">
      ${sectionHtml || '<p style="color: #64748b; font-size: 13px;">Nothing to report right now.</p>'}
    </div>
    <div style="padding: 16px 32px; border-top: 1px solid #334155; text-align: center; color: #475569; font-size: 11px;">
      VoltSafe Growth OS · Digest generated ${digest.generatedAt.toLocaleString()}
    </div>
  </div>
</body>
</html>`.trim();
}

export function formatDigestAsText(digest: ComposedDigest): string {
  const lines: string[] = [
    `=== ${digest.title} ===`,
    digest.summary,
    "",
  ];
  for (const s of digest.sections) {
    lines.push(`── ${s.label} ──`);
    s.bullets.forEach(b => lines.push(`  • ${b}`));
    lines.push("");
  }
  lines.push("VoltSafe Growth OS");
  return lines.join("\n");
}
