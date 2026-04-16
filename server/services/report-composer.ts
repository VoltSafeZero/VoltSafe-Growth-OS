/**
 * Report Composer — assembles board-ready data from all VoltSafe modules.
 * Uses direct DB queries to avoid HTTP round-trips.
 */
import { db } from "../db";
import { sql } from "drizzle-orm";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReportFilters = {
  dateFrom?: string;
  dateTo?: string;
  ownerUserId?: number;
  region?: string;
  sections?: string[];  // if empty/absent, include all sections
};

export type SectionKey =
  | "kpi_summary"
  | "pipeline_forecast"
  | "quote_snapshot"
  | "installs_deployments"
  | "procurement_risks"
  | "certification_oversight"
  | "customer_success"
  | "geography_territory"
  | "source_attribution"
  | "risk_blockers"
  | "narrative_bullets";

export const ALL_SECTION_KEYS: SectionKey[] = [
  "kpi_summary",
  "pipeline_forecast",
  "quote_snapshot",
  "installs_deployments",
  "procurement_risks",
  "certification_oversight",
  "customer_success",
  "geography_territory",
  "source_attribution",
  "risk_blockers",
  "narrative_bullets",
];

export type ReportData = {
  meta: {
    generatedAt: string;
    reportType: string;
    dateFrom: string | null;
    dateTo: string | null;
    ownerUserId: number | null;
    region: string | null;
    sectionsIncluded: SectionKey[];
  };
  kpiSummary?: KpiSummary;
  pipelineForecast?: PipelineForecast;
  quoteSnapshot?: QuoteSnapshot;
  installsDeployments?: InstallsDeployments;
  procurementRisks?: ProcurementRisks;
  certificationOversight?: CertificationOversight;
  customerSuccess?: CustomerSuccess;
  geographyTerritory?: GeographyTerritory;
  sourceAttribution?: SourceAttribution;
  riskBlockers?: RiskBlockers;
  narrativeBullets?: string[];
};

// ── Section sub-types ─────────────────────────────────────────────────────────

export type KpiSummary = {
  totalPipeline: number;
  weightedPipeline: number;
  commitAmount: number;
  closedWonAmount: number;
  totalOpps: number;
  stalledCount: number;
  acceptedRevenue: number;
  winRate: number;
  avgAcceptedValue: number;
  totalLeads: number;
  convertedLeads: number;
  conversionRate: number;
  newLeadsMonth: number;
  installsInProgress: number;
  installsComplete: number;
  installBlockers: number;
  overdueTasks: number;
  unownedLeads: number;
};

export type PipelineForecast = {
  periods: Array<{
    month: string;
    label: string;
    commitAmount: number;
    bestCaseAmount: number;
    pipelineAmount: number;
    closedWonAmount: number;
    totalWeighted: number;
  }>;
  totalWeightedForecast: number;
  totalCommit: number;
  totalBestCase: number;
};

export type QuoteSnapshot = {
  total: number;
  sent: number;
  accepted: number;
  declined: number;
  expired: number;
  awaitingResponse: number;
  acceptedRevenue: number;
  avgAcceptedValue: number;
  winRate: number;
  recentQuotes: Array<{ id: number; quoteNumber: string; status: string; total: number; companyName: string }>;
};

export type InstallsDeployments = {
  total: number;
  inProgress: number;
  pendingKickoff: number;
  complete: number;
  onHold: number;
  withBlockers: number;
  overdue: number;
  completedThisMonth: number;
  recentBlockers: Array<{ id: number; accountName: string; blockers: string; status: string }>;
};

export type ProcurementRisks = {
  lowStockItems: number;
  pendingPOs: number;
  blockedInstalls: number;
  criticalItems: Array<{ partName: string; currentStock: number; reorderPoint: number }>;
};

export type CertificationOversight = {
  total: number;
  certified: number;
  blocked: number;
  atRisk: number;
  onTrack: number;
  retestRequired: number;
  certExpiring90d: number;
  nextDueItems: Array<{ projectName: string; certType: string; dueDate: string | null }>;
};

export type CustomerSuccess = {
  healthy: number;
  atRisk: number;
  critical: number;
  renewalValue30d: number;
  renewalValue60d: number;
  renewalValue90d: number;
  totalRenewalExposure: number;
  highRiskAccounts: Array<{ accountName: string; healthStatus: string; renewalDate: string | null; mrr: number }>;
};

export type GeographyTerritory = {
  regions: Array<{ region: string; leadCount: number; accountCount: number; oppCount: number; pipelineValue: number }>;
  topRegion: string | null;
  whitespaceCount: number;
};

export type SourceAttribution = {
  sources: Array<{
    source: string;
    totalLeads: number;
    convertedLeads: number;
    totalOpps: number;
    wonOpps: number;
    totalRevenue: number;
    conversionRate: number;
  }>;
  topSource: string | null;
  strongestConvertingSource: string | null;
};

export type RiskBlockers = {
  stalledOpps: Array<{ id: number; title: string; amount: number; stage: string; daysSinceActivity: number }>;
  awaitingQuotes: Array<{ id: number; quoteNumber: string; companyName: string; daysSinceSent: number; total: number }>;
  installBlockers: Array<{ id: number; accountName: string; blockers: string }>;
  overdueTasks: Array<{ id: number; title: string; dueDate: string; assignedUserName: string | null }>;
  unownedLeads: number;
  dqRisks: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function rows(res: any): any[] {
  return (res as any).rows ?? [];
}

function n(val: any): number {
  return Number(val ?? 0);
}

function resolveRange(filters: ReportFilters): { dateFrom: Date | null; dateTo: Date | null } {
  const now = new Date();
  if (filters.dateFrom || filters.dateTo) {
    return {
      dateFrom: filters.dateFrom ? new Date(filters.dateFrom) : null,
      dateTo: filters.dateTo ? new Date(filters.dateTo) : null,
    };
  }
  return { dateFrom: null, dateTo: null };
}

function ownerWhere(col: string, uid?: number): string {
  return uid ? `AND ${col} = ${uid}` : "";
}

function dateFromWhere(col: string, d: Date | null): string {
  return d ? `AND ${col} >= '${d.toISOString()}'` : "";
}

function dateToWhere(col: string, d: Date | null): string {
  return d ? `AND ${col} <= '${d.toISOString()}'` : "";
}

// ── Section composers ─────────────────────────────────────────────────────────

async function composeKpiSummary(f: ReportFilters): Promise<KpiSummary> {
  const { dateFrom, dateTo } = resolveRange(f);
  const ow = ownerWhere("owner_user_id", f.ownerUserId);
  const owO = ownerWhere("o.owner_user_id", f.ownerUserId);
  const dfL = dateFromWhere("created_at", dateFrom);
  const dtL = dateToWhere("created_at", dateTo);

  const [pipeR, quotR, leadR, instR, taskR, noOwnerR] = await Promise.all([
    db.execute(sql.raw(`
      SELECT
        SUM(amount) AS total_pipeline,
        SUM(amount * CASE stage
          WHEN 'inbound_new' THEN 0.10 WHEN 'qualifying' THEN 0.20 WHEN 'discovery' THEN 0.30
          WHEN 'proposal' THEN 0.40 WHEN 'negotiation' THEN 0.65 WHEN 'verbal_commit' THEN 0.85
          WHEN 'closed_won' THEN 1.0 ELSE 0.20 END) AS weighted_pipeline,
        SUM(amount) FILTER (WHERE forecast_category='commit') AS commit_amount,
        SUM(amount) FILTER (WHERE stage='closed_won') AS closed_won_amount,
        count(*) AS total_opps,
        count(*) FILTER (WHERE stage NOT IN ('closed_won','closed_lost')
          AND COALESCE(last_activity_date, created_at) < NOW() - INTERVAL '21 days') AS stalled_count
      FROM opportunities o WHERE stage NOT IN ('closed_lost') ${owO} ${dateFromWhere("o.created_at", dateFrom)} ${dateToWhere("o.created_at", dateTo)}`)),
    db.execute(sql.raw(`
      SELECT
        count(*) FILTER (WHERE status='accepted') AS accepted,
        count(*) FILTER (WHERE status NOT IN ('draft')) AS total,
        SUM(total) FILTER (WHERE status='accepted') AS accepted_revenue,
        ROUND(AVG(total) FILTER (WHERE status='accepted'))::float AS avg_val
      FROM quotes WHERE 1=1 ${ow}`)),
    db.execute(sql.raw(`
      SELECT count(*) AS total, count(*) FILTER (WHERE status='converted') AS converted,
             count(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS new_month
      FROM leads WHERE 1=1 ${ow} ${dfL} ${dtL}`)),
    db.execute(sql.raw(`
      SELECT count(*) AS total, count(*) FILTER (WHERE status='in_progress') AS in_progress,
             count(*) FILTER (WHERE status='complete') AS complete,
             count(*) FILTER (WHERE blockers IS NOT NULL AND blockers != '' AND status NOT IN ('complete','cancelled')) AS with_blockers
      FROM install_workflows`)),
    db.execute(sql.raw(`
      SELECT count(*) AS overdue FROM tasks
      WHERE status NOT IN ('done','cancelled') AND due_date < NOW() ${ow}`)),
    db.execute(sql.raw(`SELECT count(*) AS no_owner FROM leads WHERE owner_user_id IS NULL AND status NOT IN ('converted','disqualified')`)),
  ]);

  const p = rows(pipeR)[0] ?? {};
  const q = rows(quotR)[0] ?? {};
  const l = rows(leadR)[0] ?? {};
  const i = rows(instR)[0] ?? {};
  const t = rows(taskR)[0] ?? {};
  const nol = rows(noOwnerR)[0] ?? {};

  const totalQ = n(q.total);
  const accepted = n(q.accepted);
  const totalL = n(l.total);
  const converted = n(l.converted);

  return {
    totalPipeline: n(p.total_pipeline),
    weightedPipeline: n(p.weighted_pipeline),
    commitAmount: n(p.commit_amount),
    closedWonAmount: n(p.closed_won_amount),
    totalOpps: n(p.total_opps),
    stalledCount: n(p.stalled_count),
    acceptedRevenue: n(q.accepted_revenue),
    winRate: totalQ > 0 ? Math.round((accepted / totalQ) * 100) : 0,
    avgAcceptedValue: n(q.avg_val),
    totalLeads: totalL,
    convertedLeads: converted,
    conversionRate: totalL > 0 ? Math.round((converted / totalL) * 100) : 0,
    newLeadsMonth: n(l.new_month),
    installsInProgress: n(i.in_progress),
    installsComplete: n(i.complete),
    installBlockers: n(i.with_blockers),
    overdueTasks: n(t.overdue),
    unownedLeads: n(nol.no_owner),
  };
}

async function composePipelineForecast(f: ReportFilters): Promise<PipelineForecast> {
  const { dateFrom } = resolveRange(f);
  const owO = ownerWhere("o.owner_user_id", f.ownerUserId);

  const since = dateFrom ?? new Date(Date.now() - 90 * 86400000);
  const until = new Date(Date.now() + 180 * 86400000);

  const res = await db.execute(sql.raw(`
    SELECT o.id, o.stage, o.amount, o.forecast_category AS forecast_cat,
           COALESCE(o.est_close_date, o.updated_at) AS close_date
    FROM opportunities o
    WHERE o.stage NOT IN ('closed_lost')
      AND COALESCE(o.est_close_date, o.updated_at) >= '${since.toISOString()}'
      AND COALESCE(o.est_close_date, o.updated_at) <= '${until.toISOString()}'
      ${owO}
    ORDER BY close_date`));

  const PROB: Record<string, number> = {
    inbound_new: 10, qualifying: 20, discovery: 30, proposal: 40,
    negotiation: 65, verbal_commit: 85, closed_won: 100,
  };

  const periodMap = new Map<string, {
    month: string; label: string;
    commitAmount: number; bestCaseAmount: number; pipelineAmount: number;
    closedWonAmount: number; totalWeighted: number;
  }>();

  for (const opp of rows(res)) {
    const d = new Date(opp.close_date);
    const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    if (!periodMap.has(mKey)) {
      periodMap.set(mKey, { month: mKey, label, commitAmount: 0, bestCaseAmount: 0, pipelineAmount: 0, closedWonAmount: 0, totalWeighted: 0 });
    }
    const p = periodMap.get(mKey)!;
    const amt = n(opp.amount);
    const prob = PROB[opp.stage] ?? 20;
    const weighted = Math.round(amt * prob / 100);

    if (opp.stage === "closed_won") {
      p.closedWonAmount += amt;
      p.totalWeighted += amt;
    } else {
      const cat = opp.forecast_cat ?? "pipeline";
      if (cat === "commit") p.commitAmount += amt;
      else if (cat === "best_case") p.bestCaseAmount += amt;
      else p.pipelineAmount += amt;
      p.totalWeighted += weighted;
    }
  }

  const periods = [...periodMap.values()].sort((a, b) => a.month.localeCompare(b.month));
  const totalWeightedForecast = periods.reduce((s, p) => s + p.totalWeighted, 0);
  const totalCommit = periods.reduce((s, p) => s + p.commitAmount, 0);
  const totalBestCase = periods.reduce((s, p) => s + p.bestCaseAmount, 0);

  return { periods, totalWeightedForecast, totalCommit, totalBestCase };
}

async function composeQuoteSnapshot(f: ReportFilters): Promise<QuoteSnapshot> {
  const ow = ownerWhere("q.owner_user_id", f.ownerUserId);
  const [quotR, recentR] = await Promise.all([
    db.execute(sql.raw(`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE status='sent') AS sent,
             count(*) FILTER (WHERE status='accepted') AS accepted,
             count(*) FILTER (WHERE status='declined') AS declined,
             count(*) FILTER (WHERE status='expired') AS expired,
             count(*) FILTER (WHERE status='sent' AND sent_at < NOW() - INTERVAL '14 days') AS awaiting,
             SUM(total) FILTER (WHERE status='accepted') AS accepted_revenue,
             ROUND(AVG(total) FILTER (WHERE status='accepted'))::float AS avg_val
      FROM quotes q WHERE 1=1 ${ow}`)),
    db.execute(sql.raw(`
      SELECT q.id, q.quote_number, q.status, q.total,
             COALESCE(a.name, q.customer_name, '') AS company_name
      FROM quotes q LEFT JOIN accounts a ON q.account_id = a.id
      WHERE q.status IN ('sent','accepted','declined')
      ORDER BY q.updated_at DESC LIMIT 8`)),
  ]);

  const qt = rows(quotR)[0] ?? {};
  const total = n(qt.total);
  const accepted = n(qt.accepted);

  return {
    total,
    sent: n(qt.sent),
    accepted,
    declined: n(qt.declined),
    expired: n(qt.expired),
    awaitingResponse: n(qt.awaiting),
    acceptedRevenue: n(qt.accepted_revenue),
    avgAcceptedValue: n(qt.avg_val),
    winRate: total > 0 ? Math.round((accepted / total) * 100) : 0,
    recentQuotes: rows(recentR).map(r => ({ id: r.id, quoteNumber: r.quote_number, status: r.status, total: n(r.total), companyName: r.company_name })),
  };
}

async function composeInstallsDeployments(f: ReportFilters): Promise<InstallsDeployments> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [instR, blockersR, monthR] = await Promise.all([
    db.execute(sql.raw(`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE status='in_progress') AS in_progress,
             count(*) FILTER (WHERE status='pending_kickoff') AS pending_kickoff,
             count(*) FILTER (WHERE status='complete') AS complete,
             count(*) FILTER (WHERE status='on_hold') AS on_hold,
             count(*) FILTER (WHERE blockers IS NOT NULL AND blockers != '' AND status NOT IN ('complete','cancelled')) AS with_blockers,
             count(*) FILTER (WHERE status NOT IN ('complete','cancelled') AND target_completion_date < NOW()) AS overdue
      FROM install_workflows`)),
    db.execute(sql.raw(`
      SELECT iw.id, COALESCE(a.name,'') AS account_name, iw.blockers, iw.status
      FROM install_workflows iw LEFT JOIN accounts a ON iw.account_id = a.id
      WHERE iw.blockers IS NOT NULL AND iw.blockers != '' AND iw.status NOT IN ('complete','cancelled')
      ORDER BY iw.updated_at DESC LIMIT 6`)),
    db.execute(sql.raw(`
      SELECT count(*) AS completed_month FROM install_workflows
      WHERE status='complete' AND actual_completion_date >= '${monthStart}'`)),
  ]);

  const i = rows(instR)[0] ?? {};
  return {
    total: n(i.total),
    inProgress: n(i.in_progress),
    pendingKickoff: n(i.pending_kickoff),
    complete: n(i.complete),
    onHold: n(i.on_hold),
    withBlockers: n(i.with_blockers),
    overdue: n(i.overdue),
    completedThisMonth: n((rows(monthR)[0] ?? {}).completed_month),
    recentBlockers: rows(blockersR).map(r => ({ id: r.id, accountName: r.account_name, blockers: r.blockers, status: r.status })),
  };
}

async function composeProcurementRisks(_f: ReportFilters): Promise<ProcurementRisks> {
  const [lowR, poR, blockedR, critR] = await Promise.all([
    db.execute(sql.raw(`SELECT count(*) AS low_stock FROM inventory WHERE current_stock <= reorder_point`)).catch(() => ({ rows: [{ low_stock: 0 }] })),
    db.execute(sql.raw(`SELECT count(*) AS pending FROM purchase_orders WHERE status IN ('draft','submitted','approved')`)).catch(() => ({ rows: [{ pending: 0 }] })),
    db.execute(sql.raw(`
      SELECT count(*) AS blocked FROM install_workflows
      WHERE blockers ILIKE '%parts%' OR blockers ILIKE '%inventory%' OR blockers ILIKE '%procurement%'
         OR blockers ILIKE '%waiting%' AND status NOT IN ('complete','cancelled')`)).catch(() => ({ rows: [{ blocked: 0 }] })),
    db.execute(sql.raw(`
      SELECT part_name, current_stock, reorder_point FROM inventory
      WHERE current_stock <= reorder_point ORDER BY (reorder_point - current_stock) DESC LIMIT 5`)).catch(() => ({ rows: [] })),
  ]);

  return {
    lowStockItems: n((rows(lowR)[0] ?? {}).low_stock),
    pendingPOs: n((rows(poR)[0] ?? {}).pending),
    blockedInstalls: n((rows(blockedR)[0] ?? {}).blocked),
    criticalItems: rows(critR).map(r => ({ partName: r.part_name, currentStock: n(r.current_stock), reorderPoint: n(r.reorder_point) })),
  };
}

async function composeCertificationOversight(_f: ReportFilters): Promise<CertificationOversight> {
  const [sumR, nextR] = await Promise.all([
    db.execute(sql.raw(`
      SELECT
        count(*) AS total,
        count(*) FILTER (WHERE cert_status = 'certified') AS certified,
        count(*) FILTER (WHERE cert_status = 'blocked') AS blocked,
        count(*) FILTER (WHERE cert_status = 'at_risk') AS at_risk,
        count(*) FILTER (WHERE cert_status = 'on_track') AS on_track,
        count(*) FILTER (WHERE cert_status = 'retest_required') AS retest_required,
        count(*) FILTER (WHERE cert_expiry_date IS NOT NULL AND cert_expiry_date BETWEEN NOW() AND NOW() + INTERVAL '90 days') AS cert_expiring_90d
      FROM project_certifications`)).catch(() => ({ rows: [{}] })),
    db.execute(sql.raw(`
      SELECT p.name AS project_name, pc.cert_type, pc.target_cert_date AS due_date
      FROM project_certifications pc JOIN projects p ON pc.project_id = p.id
      WHERE pc.cert_status NOT IN ('certified') AND pc.target_cert_date IS NOT NULL
      ORDER BY pc.target_cert_date LIMIT 5`)).catch(() => ({ rows: [] })),
  ]);

  const s = rows(sumR)[0] ?? {};
  return {
    total: n(s.total),
    certified: n(s.certified),
    blocked: n(s.blocked),
    atRisk: n(s.at_risk),
    onTrack: n(s.on_track),
    retestRequired: n(s.retest_required),
    certExpiring90d: n(s.cert_expiring_90d),
    nextDueItems: rows(nextR).map(r => ({ projectName: r.project_name, certType: r.cert_type, dueDate: r.due_date })),
  };
}

async function composeCustomerSuccess(_f: ReportFilters): Promise<CustomerSuccess> {
  const [healthR, renewalR, highRiskR] = await Promise.all([
    db.execute(sql.raw(`
      SELECT
        count(*) FILTER (WHERE health_status = 'healthy') AS healthy,
        count(*) FILTER (WHERE health_status = 'at_risk') AS at_risk,
        count(*) FILTER (WHERE health_status = 'critical') AS critical
      FROM customer_subscriptions`)).catch(() => ({ rows: [{}] })),
    db.execute(sql.raw(`
      SELECT
        SUM(mrr) FILTER (WHERE renewal_date BETWEEN NOW() AND NOW() + INTERVAL '30 days') AS val_30d,
        SUM(mrr) FILTER (WHERE renewal_date BETWEEN NOW() AND NOW() + INTERVAL '60 days') AS val_60d,
        SUM(mrr) FILTER (WHERE renewal_date BETWEEN NOW() AND NOW() + INTERVAL '90 days') AS val_90d
      FROM customer_subscriptions WHERE status = 'active'`)).catch(() => ({ rows: [{}] })),
    db.execute(sql.raw(`
      SELECT a.name AS account_name, cs.health_status, cs.renewal_date, cs.mrr
      FROM customer_subscriptions cs JOIN accounts a ON cs.account_id = a.id
      WHERE cs.health_status IN ('at_risk','critical')
      ORDER BY cs.mrr DESC LIMIT 6`)).catch(() => ({ rows: [] })),
  ]);

  const h = rows(healthR)[0] ?? {};
  const r = rows(renewalR)[0] ?? {};
  const val90 = n(r.val_90d);

  return {
    healthy: n(h.healthy),
    atRisk: n(h.at_risk),
    critical: n(h.critical),
    renewalValue30d: n(r.val_30d),
    renewalValue60d: n(r.val_60d),
    renewalValue90d: val90,
    totalRenewalExposure: val90,
    highRiskAccounts: rows(highRiskR).map(r2 => ({
      accountName: r2.account_name,
      healthStatus: r2.health_status,
      renewalDate: r2.renewal_date,
      mrr: n(r2.mrr),
    })),
  };
}

async function composeGeographyTerritory(f: ReportFilters): Promise<GeographyTerritory> {
  const regionFilter = f.region ? `AND (l.region ILIKE '%${f.region}%' OR a.region ILIKE '%${f.region}%' OR a.state_province ILIKE '%${f.region}%')` : "";

  const [regR, wsR] = await Promise.all([
    db.execute(sql.raw(`
      SELECT
        COALESCE(NULLIF(l.region, ''), a.state_province, 'Unknown') AS region,
        count(DISTINCT l.id) AS lead_count,
        count(DISTINCT a.id) AS account_count,
        count(DISTINCT o.id) AS opp_count,
        COALESCE(SUM(o.amount), 0) AS pipeline_value
      FROM leads l
      LEFT JOIN accounts a ON l.converted_account_id = a.id
      LEFT JOIN opportunities o ON o.account_id = a.id AND o.stage NOT IN ('closed_lost')
      WHERE 1=1 ${regionFilter}
      GROUP BY COALESCE(NULLIF(l.region, ''), a.state_province, 'Unknown')
      ORDER BY pipeline_value DESC
      LIMIT 10`)).catch(() => ({ rows: [] })),
    db.execute(sql.raw(`SELECT count(*) AS cnt FROM accounts WHERE assigned_to_user_id IS NULL`)).catch(() => ({ rows: [{ cnt: 0 }] })),
  ]);

  const regions = rows(regR).map(r => ({
    region: r.region,
    leadCount: n(r.lead_count),
    accountCount: n(r.account_count),
    oppCount: n(r.opp_count),
    pipelineValue: n(r.pipeline_value),
  }));

  return {
    regions,
    topRegion: regions.length > 0 ? regions[0].region : null,
    whitespaceCount: n((rows(wsR)[0] ?? {}).cnt),
  };
}

async function composeSourceAttribution(f: ReportFilters): Promise<SourceAttribution> {
  const ow = ownerWhere("l.owner_user_id", f.ownerUserId);
  const { dateFrom } = resolveRange(f);
  const dfL = dateFrom ? `AND l.created_at >= '${dateFrom.toISOString()}'` : "";

  const res = await db.execute(sql.raw(`
    SELECT
      COALESCE(NULLIF(TRIM(l.source), ''), 'Unknown') AS source,
      count(DISTINCT l.id) AS total_leads,
      count(DISTINCT l.id) FILTER (WHERE l.status = 'converted') AS converted_leads,
      count(DISTINCT o.id) AS total_opps,
      count(DISTINCT o.id) FILTER (WHERE o.stage = 'closed_won') AS won_opps,
      COALESCE(SUM(q.total) FILTER (WHERE q.status = 'accepted'), 0) AS total_revenue
    FROM leads l
    LEFT JOIN accounts a ON a.id = l.converted_account_id
    LEFT JOIN opportunities o ON o.id = l.converted_opportunity_id
    LEFT JOIN quotes q ON q.opportunity_id = o.id
    WHERE 1=1 ${ow} ${dfL}
    GROUP BY COALESCE(NULLIF(TRIM(l.source), ''), 'Unknown')
    ORDER BY total_leads DESC
    LIMIT 10`));

  const sources = rows(res).map(r => {
    const tl = n(r.total_leads);
    const cl = n(r.converted_leads);
    return {
      source: r.source,
      totalLeads: tl,
      convertedLeads: cl,
      totalOpps: n(r.total_opps),
      wonOpps: n(r.won_opps),
      totalRevenue: n(r.total_revenue),
      conversionRate: tl > 0 ? Math.round((cl / tl) * 100) : 0,
    };
  });

  const topByVolume = sources.length > 0 ? sources[0].source : null;
  const topByConversion = [...sources].sort((a, b) => b.conversionRate - a.conversionRate)[0]?.source ?? null;

  return { sources, topSource: topByVolume, strongestConvertingSource: topByConversion };
}

async function composeRiskBlockers(f: ReportFilters): Promise<RiskBlockers> {
  const owO = ownerWhere("o.owner_user_id", f.ownerUserId);
  const owQ = ownerWhere("q.owner_user_id", f.ownerUserId);

  const [stalledR, quotesR, installR, tasksR, noOwnerR, dqR] = await Promise.all([
    db.execute(sql.raw(`
      SELECT o.id, o.title, o.amount, o.stage,
             EXTRACT(DAY FROM NOW() - COALESCE(o.last_activity_date, o.created_at))::int AS days_since_activity
      FROM opportunities o
      WHERE o.stage NOT IN ('closed_won','closed_lost')
        AND COALESCE(o.last_activity_date, o.created_at) < NOW() - INTERVAL '21 days'
        ${owO}
      ORDER BY days_since_activity DESC LIMIT 8`)),
    db.execute(sql.raw(`
      SELECT q.id, q.quote_number, COALESCE(a.name, q.customer_name, '') AS company_name,
             EXTRACT(DAY FROM NOW() - q.sent_at)::int AS days_since_sent, q.total
      FROM quotes q LEFT JOIN accounts a ON q.account_id = a.id
      WHERE q.status = 'sent' AND q.sent_at < NOW() - INTERVAL '14 days'
        ${owQ}
      ORDER BY days_since_sent DESC LIMIT 6`)),
    db.execute(sql.raw(`
      SELECT iw.id, COALESCE(a.name,'') AS account_name, iw.blockers
      FROM install_workflows iw LEFT JOIN accounts a ON iw.account_id = a.id
      WHERE iw.blockers IS NOT NULL AND iw.blockers != '' AND iw.status NOT IN ('complete','cancelled')
      LIMIT 6`)),
    db.execute(sql.raw(`
      SELECT t.id, t.title, t.due_date, u.name AS assigned_user_name
      FROM tasks t LEFT JOIN users u ON t.owner_user_id = u.id
      WHERE t.status NOT IN ('done','cancelled') AND t.due_date < NOW()
      ORDER BY t.due_date LIMIT 6`)),
    db.execute(sql.raw(`SELECT count(*) AS cnt FROM leads WHERE owner_user_id IS NULL AND status NOT IN ('converted','disqualified')`)),
    db.execute(sql.raw(`SELECT count(*) AS cnt FROM accounts WHERE website IS NULL AND assigned_to_user_id IS NULL`)),
  ]);

  return {
    stalledOpps: rows(stalledR).map(r => ({ id: r.id, title: r.title, amount: n(r.amount), stage: r.stage, daysSinceActivity: n(r.days_since_activity) })),
    awaitingQuotes: rows(quotesR).map(r => ({ id: r.id, quoteNumber: r.quote_number, companyName: r.company_name, daysSinceSent: n(r.days_since_sent), total: n(r.total) })),
    installBlockers: rows(installR).map(r => ({ id: r.id, accountName: r.account_name, blockers: r.blockers })),
    overdueTasks: rows(tasksR).map(r => ({ id: r.id, title: r.title, dueDate: r.due_date, assignedUserName: r.assigned_user_name })),
    unownedLeads: n((rows(noOwnerR)[0] ?? {}).cnt),
    dqRisks: n((rows(dqR)[0] ?? {}).cnt),
  };
}

// ── Phase 5: Narrative Bullets ────────────────────────────────────────────────

function generateNarrativeBullets(data: ReportData): string[] {
  const bullets: string[] = [];
  const fmt = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(0)}k` : `$${n.toFixed(0)}`;

  if (data.kpiSummary) {
    const k = data.kpiSummary;
    bullets.push(`Pipeline stands at ${fmt(k.totalPipeline)} total (${fmt(k.weightedPipeline)} weighted), with ${k.totalOpps} active opportunities.`);
    if (k.stalledCount > 0) {
      bullets.push(`${k.stalledCount} opportunit${k.stalledCount === 1 ? "y" : "ies"} stalled with no activity in 21+ days — representing potential forecast risk.`);
    }
    if (k.conversionRate > 0) {
      bullets.push(`Lead-to-opportunity conversion rate is ${k.conversionRate}% from ${k.totalLeads} leads tracked this period.`);
    }
    if (k.winRate > 0) {
      bullets.push(`Quote win rate is ${k.winRate}% with ${fmt(k.acceptedRevenue)} in accepted revenue.`);
    }
    if (k.installBlockers > 0) {
      bullets.push(`${k.installBlockers} active install${k.installBlockers === 1 ? "" : "s"} have blockers requiring attention; ${k.overdueTasks} tasks are past due.`);
    }
    if (k.unownedLeads > 0) {
      bullets.push(`${k.unownedLeads} unowned lead${k.unownedLeads === 1 ? "" : "s"} require owner assignment to prevent leakage.`);
    }
  }

  if (data.sourceAttribution) {
    const s = data.sourceAttribution;
    if (s.topSource) bullets.push(`Top lead source by volume: ${s.topSource}.`);
    if (s.strongestConvertingSource && s.strongestConvertingSource !== s.topSource) {
      bullets.push(`Strongest converting source: ${s.strongestConvertingSource} — prioritize for outbound investment.`);
    }
  }

  if (data.customerSuccess) {
    const cs = data.customerSuccess;
    if (cs.totalRenewalExposure > 0) {
      bullets.push(`${fmt(cs.totalRenewalExposure)} in renewal value due in next 90 days; ${cs.atRisk + cs.critical} account${cs.atRisk + cs.critical === 1 ? "" : "s"} at risk.`);
    }
  }

  if (data.certificationOversight) {
    const c = data.certificationOversight;
    if (c.blocked > 0) {
      bullets.push(`${c.blocked} certification${c.blocked === 1 ? "" : "s"} blocked — may delay product launch timelines.`);
    }
    if (c.certExpiring90d > 0) {
      bullets.push(`${c.certExpiring90d} certification${c.certExpiring90d === 1 ? "" : "s"} expiring within 90 days.`);
    }
  }

  if (data.geographyTerritory && data.geographyTerritory.topRegion) {
    bullets.push(`Strongest territory by pipeline: ${data.geographyTerritory.topRegion}.`);
  }

  if (bullets.length === 0) {
    bullets.push("No significant alerts this period. All key metrics within normal range.");
  }

  return bullets;
}

// ── Main Composer ─────────────────────────────────────────────────────────────

export async function composeReport(
  reportType: string,
  filters: ReportFilters,
): Promise<ReportData> {
  const requestedSections = filters.sections && filters.sections.length > 0
    ? filters.sections as SectionKey[]
    : ALL_SECTION_KEYS;

  const has = (k: SectionKey) => requestedSections.includes(k);

  const { dateFrom, dateTo } = resolveRange(filters);

  const meta = {
    generatedAt: new Date().toISOString(),
    reportType,
    dateFrom: dateFrom ? dateFrom.toISOString() : null,
    dateTo: dateTo ? dateTo.toISOString() : null,
    ownerUserId: filters.ownerUserId ?? null,
    region: filters.region ?? null,
    sectionsIncluded: requestedSections,
  };

  // Compose all requested sections concurrently
  const [
    kpiSummary,
    pipelineForecast,
    quoteSnapshot,
    installsDeployments,
    procurementRisks,
    certificationOversight,
    customerSuccess,
    geographyTerritory,
    sourceAttribution,
    riskBlockers,
  ] = await Promise.all([
    has("kpi_summary") ? composeKpiSummary(filters) : Promise.resolve(undefined),
    has("pipeline_forecast") ? composePipelineForecast(filters) : Promise.resolve(undefined),
    has("quote_snapshot") ? composeQuoteSnapshot(filters) : Promise.resolve(undefined),
    has("installs_deployments") ? composeInstallsDeployments(filters) : Promise.resolve(undefined),
    has("procurement_risks") ? composeProcurementRisks(filters) : Promise.resolve(undefined),
    has("certification_oversight") ? composeCertificationOversight(filters) : Promise.resolve(undefined),
    has("customer_success") ? composeCustomerSuccess(filters) : Promise.resolve(undefined),
    has("geography_territory") ? composeGeographyTerritory(filters) : Promise.resolve(undefined),
    has("source_attribution") ? composeSourceAttribution(filters) : Promise.resolve(undefined),
    has("risk_blockers") ? composeRiskBlockers(filters) : Promise.resolve(undefined),
  ]);

  const data: ReportData = {
    meta,
    kpiSummary,
    pipelineForecast,
    quoteSnapshot,
    installsDeployments,
    procurementRisks,
    certificationOversight,
    customerSuccess,
    geographyTerritory,
    sourceAttribution,
    riskBlockers,
  };

  if (has("narrative_bullets")) {
    data.narrativeBullets = generateNarrativeBullets(data);
  }

  return data;
}
