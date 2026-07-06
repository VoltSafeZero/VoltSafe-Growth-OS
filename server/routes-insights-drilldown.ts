// ── Insights Drilldown Routes — Phase 2 Universal Drilldowns ──────────────────
// GET /api/insights/drilldown
// requireAuth + crm:view — paginated, filtered, safe SQL

import type { Express } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";

const PAGE_DEFAULT = 1;
const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;

function safeInt(v: any, fallback: number): number {
  const n = parseInt(String(v ?? ""), 10);
  return isNaN(n) ? fallback : n;
}

function now(): string {
  return new Date().toISOString();
}

function buildPaginatedResponse(
  metric: string,
  title: string,
  description: string,
  columns: { key: string; label: string }[],
  rows: any[],
  total: number,
  page: number,
  pageSize: number,
  emptyState?: string,
) {
  return {
    metric,
    title,
    description,
    total,
    page,
    page_size: pageSize,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
    columns,
    rows,
    empty_state: emptyState ?? "",
    refreshed_at: now(),
  };
}

function searchClause(search: string, fields: string[]): string {
  if (!search || search.trim().length < 1) return "";
  const escaped = search.replace(/'/g, "''").slice(0, 100);
  const parts = fields.map(f => `${f} ILIKE '%${escaped}%'`);
  return `AND (${parts.join(" OR ")})`;
}

// Shared opportunity columns for insights view
const EXEC_OPP_COLS = [
  { key: "title",              label: "Opportunity" },
  { key: "account_name",       label: "Account" },
  { key: "stage",              label: "Stage" },
  { key: "forecast_category",  label: "Category" },
  { key: "amount",             label: "Amount" },
  { key: "owner_name",         label: "Owner" },
  { key: "est_close_date",     label: "Close Date" },
];

const LEAD_COLS = [
  { key: "company",      label: "Company" },
  { key: "contact_name", label: "Contact" },
  { key: "status",       label: "Status" },
  { key: "source",       label: "Source" },
  { key: "deal_amount",  label: "Deal Value" },
  { key: "owner_name",   label: "Owner" },
  { key: "created_at",   label: "Created" },
];

export function registerInsightsDrilldownRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: (section: string, level: string) => any,
) {
  app.get(
    "/api/insights/drilldown",
    requireAuth,
    requirePermission("crm", "view"),
    async (req: any, res) => {
      try {
        const metric   = String(req.query.metric   ?? "");
        const search   = String(req.query.search   ?? "");
        const page     = Math.max(1, safeInt(req.query.page, PAGE_DEFAULT));
        const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, safeInt(req.query.page_size, PAGE_SIZE_DEFAULT)));
        const offset   = (page - 1) * pageSize;

        const ownerId = safeInt(req.query.owner_id, 0);
        const ownerW  = ownerId > 0 ? `AND o.owner_user_id = ${ownerId}` : "";

        function buildOppQuery(extraWhere: string, sSearch: string) {
          const sc = searchClause(sSearch, ["o.title", "a.name", "u.name"]);
          return sql.raw(`
            SELECT
              o.id AS opp_id, o.title, o.stage, o.forecast_category, o.amount, o.est_close_date,
              a.name AS account_name, a.id AS account_id, u.name AS owner_name
            FROM opportunities o
            LEFT JOIN accounts a ON a.id = o.account_id
            LEFT JOIN users u ON u.id = o.owner_user_id
            WHERE TRUE ${extraWhere} ${ownerW} ${sc}
            ORDER BY o.amount DESC NULLS LAST, o.updated_at DESC
            LIMIT ${pageSize} OFFSET ${offset}
          `);
        }

        function buildOppCount(extraWhere: string, sSearch: string) {
          const sc = searchClause(sSearch, ["o.title", "a.name", "u.name"]);
          return sql.raw(`
            SELECT COUNT(*)::int AS cnt
            FROM opportunities o
            LEFT JOIN accounts a ON a.id = o.account_id
            LEFT JOIN users u ON u.id = o.owner_user_id
            WHERE TRUE ${extraWhere} ${ownerW} ${sc}
          `);
        }

        function buildLeadQuery(extraWhere: string, sSearch: string) {
          const sc = searchClause(sSearch, ["l.company", "l.contact_name", "l.contact_email"]);
          const ownerLW = ownerId > 0 ? `AND l.owner_user_id = ${ownerId}` : "";
          return sql.raw(`
            SELECT l.id AS lead_id, l.company, l.contact_name, l.contact_email,
                   l.status, l.source, l.deal_amount, l.created_at,
                   u.name AS owner_name
            FROM leads l
            LEFT JOIN users u ON u.id = l.owner_user_id
            WHERE TRUE ${extraWhere} ${ownerLW} ${sc}
            ORDER BY l.updated_at DESC
            LIMIT ${pageSize} OFFSET ${offset}
          `);
        }

        function buildLeadCount(extraWhere: string, sSearch: string) {
          const sc = searchClause(sSearch, ["l.company", "l.contact_name", "l.contact_email"]);
          const ownerLW = ownerId > 0 ? `AND l.owner_user_id = ${ownerId}` : "";
          return sql.raw(`
            SELECT COUNT(*)::int AS cnt FROM leads l
            LEFT JOIN users u ON u.id = l.owner_user_id
            WHERE TRUE ${extraWhere} ${ownerLW} ${sc}
          `);
        }

        switch (metric) {

          // ── Pipeline section ─────────────────────────────────────────────────

          case "exec_total_pipeline": {
            const where = `AND o.stage NOT IN ('closed_won','closed_lost')`;
            const [rows, [cnt]] = await Promise.all([
              db.execute(buildOppQuery(where, search)),
              db.execute(buildOppCount(where, search)),
            ]);
            return res.json(buildPaginatedResponse(metric, "Total Pipeline",
              "All active opportunities contributing to the pipeline total.",
              EXEC_OPP_COLS, rows.rows, cnt.cnt as number, page, pageSize,
            ));
          }

          case "exec_weighted_forecast": {
            const where = `AND o.stage NOT IN ('closed_won','closed_lost') AND o.amount > 0`;
            const sc = searchClause(search, ["o.title", "a.name", "u.name"]);
            const qRows = await db.execute(sql.raw(`
              SELECT o.id AS opp_id, o.title, o.stage, o.forecast_category, o.amount,
                     o.est_close_date, a.name AS account_name, a.id AS account_id, u.name AS owner_name,
                     CASE o.stage
                       WHEN 'inbound_new'  THEN o.amount * 0.05
                       WHEN 'qualifying'   THEN o.amount * 0.15
                       WHEN 'discovery'    THEN o.amount * 0.25
                       WHEN 'proposal'     THEN o.amount * 0.40
                       WHEN 'negotiation'  THEN o.amount * 0.60
                       WHEN 'verbal_commit' THEN o.amount * 0.80
                       ELSE o.amount * 0.05
                     END AS weighted_amount
              FROM opportunities o
              LEFT JOIN accounts a ON a.id = o.account_id
              LEFT JOIN users u ON u.id = o.owner_user_id
              WHERE o.stage NOT IN ('closed_won','closed_lost') AND o.amount > 0 ${ownerW} ${sc}
              ORDER BY weighted_amount DESC
              LIMIT ${pageSize} OFFSET ${offset}
            `));
            const [cnt] = (await db.execute(buildOppCount(where, search))).rows;
            return res.json(buildPaginatedResponse(metric, "Weighted Forecast",
              "Opportunities weighted by stage probability — sorted by weighted value.",
              [
                ...EXEC_OPP_COLS,
                { key: "weighted_amount", label: "Weighted" },
              ],
              qRows.rows, cnt.cnt as number, page, pageSize,
            ));
          }

          case "exec_open_opps": {
            const where = `AND o.stage NOT IN ('closed_won','closed_lost')`;
            const [rows, [cnt]] = await Promise.all([
              db.execute(buildOppQuery(where, search)),
              db.execute(buildOppCount(where, search)),
            ]);
            return res.json(buildPaginatedResponse(metric, "Open Opportunities",
              "All open opportunities currently in the pipeline.",
              EXEC_OPP_COLS, rows.rows, cnt.cnt as number, page, pageSize,
              "No open opportunities.",
            ));
          }

          case "exec_closed_won": {
            const where = `AND o.stage = 'closed_won'`;
            const [rows, [cnt]] = await Promise.all([
              db.execute(buildOppQuery(where, search)),
              db.execute(buildOppCount(where, search)),
            ]);
            return res.json(buildPaginatedResponse(metric, "Closed Won",
              "All opportunities that have been closed as won.",
              EXEC_OPP_COLS, rows.rows, cnt.cnt as number, page, pageSize,
              "No closed-won opportunities found.",
            ));
          }

          case "exec_stalled_opps": {
            const where = `AND o.stage NOT IN ('closed_won','closed_lost') AND EXTRACT(EPOCH FROM (NOW() - COALESCE(o.last_activity_date, o.updated_at))) / 86400 >= 7`;
            const [rows, [cnt]] = await Promise.all([
              db.execute(buildOppQuery(where, search)),
              db.execute(buildOppCount(where, search)),
            ]);
            return res.json(buildPaginatedResponse(metric, "Stalled Opportunities",
              "Active deals with no activity in 7+ days — pipeline velocity risk.",
              [
                ...EXEC_OPP_COLS,
                { key: "days_since_activity", label: "Days Inactive" },
              ],
              rows.rows, cnt.cnt as number, page, pageSize,
              "No stalled opportunities — pipeline is moving!",
            ));
          }

          // ── Revenue / Quotes section ─────────────────────────────────────────

          case "exec_accepted_revenue": {
            const sc = searchClause(search, ["q.quote_number", "q.customer_name", "a.name"]);
            const ownerQW = ownerId > 0 ? `AND q.owner_user_id = ${ownerId}` : "";
            const qRows = await db.execute(sql.raw(`
              SELECT q.id AS quote_id, q.quote_number, q.total, q.accepted_at,
                     q.customer_name, a.name AS account_name, a.id AS account_id,
                     u.name AS owner_name
              FROM quotes q
              LEFT JOIN accounts a ON a.id = q.account_id
              LEFT JOIN users u ON u.id = q.owner_user_id
              WHERE q.status = 'accepted' ${ownerQW} ${sc}
              ORDER BY q.accepted_at DESC
              LIMIT ${pageSize} OFFSET ${offset}
            `));
            const [cnt] = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM quotes q WHERE q.status = 'accepted' ${ownerQW}`))).rows;
            return res.json(buildPaginatedResponse(metric, "Accepted Revenue",
              "All accepted quotes contributing to confirmed revenue.",
              [
                { key: "quote_number",  label: "Quote #" },
                { key: "account_name",  label: "Account" },
                { key: "total",         label: "Value" },
                { key: "owner_name",    label: "Owner" },
                { key: "accepted_at",   label: "Accepted" },
              ],
              qRows.rows, cnt.cnt as number, page, pageSize,
              "No accepted quotes found.",
            ));
          }

          case "exec_revenue_month": {
            const sc = searchClause(search, ["q.quote_number", "q.customer_name", "a.name"]);
            const qRows = await db.execute(sql.raw(`
              SELECT q.id AS quote_id, q.quote_number, q.total, q.accepted_at,
                     q.customer_name, a.name AS account_name, a.id AS account_id
              FROM quotes q
              LEFT JOIN accounts a ON a.id = q.account_id
              WHERE q.status = 'accepted' AND DATE_TRUNC('month', q.accepted_at) = DATE_TRUNC('month', NOW()) ${sc}
              ORDER BY q.accepted_at DESC
              LIMIT ${pageSize} OFFSET ${offset}
            `));
            const [cnt] = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM quotes q WHERE q.status = 'accepted' AND DATE_TRUNC('month', q.accepted_at) = DATE_TRUNC('month', NOW())`))).rows;
            return res.json(buildPaginatedResponse(metric, "Revenue This Month",
              "Accepted quotes in the current calendar month.",
              [
                { key: "quote_number",  label: "Quote #" },
                { key: "account_name",  label: "Account" },
                { key: "total",         label: "Value" },
                { key: "accepted_at",   label: "Accepted" },
              ],
              qRows.rows, cnt.cnt as number, page, pageSize,
              "No revenue accepted this month yet.",
            ));
          }

          case "exec_revenue_qtr": {
            const sc = searchClause(search, ["q.quote_number", "q.customer_name", "a.name"]);
            const qRows = await db.execute(sql.raw(`
              SELECT q.id AS quote_id, q.quote_number, q.total, q.accepted_at,
                     q.customer_name, a.name AS account_name, a.id AS account_id
              FROM quotes q
              LEFT JOIN accounts a ON a.id = q.account_id
              WHERE q.status = 'accepted' AND DATE_TRUNC('quarter', q.accepted_at) = DATE_TRUNC('quarter', NOW()) ${sc}
              ORDER BY q.accepted_at DESC
              LIMIT ${pageSize} OFFSET ${offset}
            `));
            const [cnt] = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM quotes q WHERE q.status = 'accepted' AND DATE_TRUNC('quarter', q.accepted_at) = DATE_TRUNC('quarter', NOW())`))).rows;
            return res.json(buildPaginatedResponse(metric, "Revenue This Quarter",
              "Accepted quotes in the current calendar quarter.",
              [
                { key: "quote_number",  label: "Quote #" },
                { key: "account_name",  label: "Account" },
                { key: "total",         label: "Value" },
                { key: "accepted_at",   label: "Accepted" },
              ],
              qRows.rows, cnt.cnt as number, page, pageSize,
              "No revenue accepted this quarter yet.",
            ));
          }

          case "exec_awaiting_response": {
            const sc = searchClause(search, ["q.quote_number", "q.customer_name", "a.name"]);
            const ownerQW = ownerId > 0 ? `AND q.owner_user_id = ${ownerId}` : "";
            const qRows = await db.execute(sql.raw(`
              SELECT q.id AS quote_id, q.quote_number, q.total, q.sent_at,
                     q.customer_name, a.name AS account_name, a.id AS account_id,
                     u.name AS owner_name,
                     GREATEST(0, EXTRACT(EPOCH FROM (NOW() - q.sent_at)) / 86400)::int AS days_waiting
              FROM quotes q
              LEFT JOIN accounts a ON a.id = q.account_id
              LEFT JOIN users u ON u.id = q.owner_user_id
              WHERE q.status = 'sent' ${ownerQW} ${sc}
              ORDER BY q.sent_at ASC
              LIMIT ${pageSize} OFFSET ${offset}
            `));
            const [cnt] = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM quotes q WHERE q.status = 'sent' ${ownerQW}`))).rows;
            return res.json(buildPaginatedResponse(metric, "Awaiting Response",
              "Sent quotes waiting for customer response — sorted oldest first.",
              [
                { key: "quote_number",  label: "Quote #" },
                { key: "account_name",  label: "Account" },
                { key: "total",         label: "Value" },
                { key: "owner_name",    label: "Owner" },
                { key: "days_waiting",  label: "Days Waiting" },
                { key: "sent_at",       label: "Sent" },
              ],
              qRows.rows, cnt.cnt as number, page, pageSize,
              "No quotes awaiting response.",
            ));
          }

          case "exec_win_rate": {
            const sc = searchClause(search, ["q.quote_number", "q.customer_name", "a.name"]);
            const qRows = await db.execute(sql.raw(`
              SELECT q.id AS quote_id, q.quote_number, q.status, q.total, q.sent_at,
                     q.accepted_at, q.declined_at,
                     q.customer_name, a.name AS account_name, a.id AS account_id,
                     u.name AS owner_name
              FROM quotes q
              LEFT JOIN accounts a ON a.id = q.account_id
              LEFT JOIN users u ON u.id = q.owner_user_id
              WHERE q.status IN ('accepted','declined') ${sc}
              ORDER BY COALESCE(q.accepted_at, q.declined_at) DESC
              LIMIT ${pageSize} OFFSET ${offset}
            `));
            const [cnt] = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM quotes q WHERE q.status IN ('accepted','declined')`))).rows;
            return res.json(buildPaginatedResponse(metric, "Win Rate — Quote Outcomes",
              "All closed quotes (accepted or declined) contributing to the win rate calculation.",
              [
                { key: "quote_number",  label: "Quote #" },
                { key: "account_name",  label: "Account" },
                { key: "status",        label: "Outcome" },
                { key: "total",         label: "Value" },
                { key: "owner_name",    label: "Owner" },
                { key: "sent_at",       label: "Sent" },
              ],
              qRows.rows, cnt.cnt as number, page, pageSize,
            ));
          }

          case "exec_avg_deal": {
            const sc = searchClause(search, ["q.quote_number", "q.customer_name", "a.name"]);
            const qRows = await db.execute(sql.raw(`
              SELECT q.id AS quote_id, q.quote_number, q.total, q.accepted_at,
                     q.customer_name, a.name AS account_name, a.id AS account_id
              FROM quotes q
              LEFT JOIN accounts a ON a.id = q.account_id
              WHERE q.status = 'accepted' ${sc}
              ORDER BY q.total DESC
              LIMIT ${pageSize} OFFSET ${offset}
            `));
            const [cnt] = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM quotes q WHERE q.status = 'accepted'`))).rows;
            return res.json(buildPaginatedResponse(metric, "Average Deal Value — All Accepted Quotes",
              "All accepted quotes sorted by deal value — used to calculate the average.",
              [
                { key: "quote_number",  label: "Quote #" },
                { key: "account_name",  label: "Account" },
                { key: "total",         label: "Value" },
                { key: "accepted_at",   label: "Accepted" },
              ],
              qRows.rows, cnt.cnt as number, page, pageSize,
            ));
          }

          // ── Installs section ─────────────────────────────────────────────────

          case "exec_installs_in_progress": {
            const sc = searchClause(search, ["iw.title", "a.name", "u.name"]);
            const ownerIW = ownerId > 0 ? `AND iw.owner_user_id = ${ownerId}` : "";
            const qRows = await db.execute(sql.raw(`
              SELECT iw.id AS install_id, iw.title AS install_title, iw.status AS install_status,
                     iw.total_amount, iw.kickoff_date, iw.target_completion_date AS est_close_date,
                     a.name AS account_name, a.id AS account_id, u.name AS owner_name
              FROM install_workflows iw
              LEFT JOIN accounts a ON a.id = iw.account_id
              LEFT JOIN users u ON u.id = iw.owner_user_id
              WHERE iw.status = 'in_progress' ${ownerIW} ${sc}
              ORDER BY iw.target_completion_date ASC NULLS LAST
              LIMIT ${pageSize} OFFSET ${offset}
            `));
            const [cnt] = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM install_workflows iw WHERE iw.status = 'in_progress' ${ownerIW}`))).rows;
            return res.json(buildPaginatedResponse(metric, "Installs In Progress",
              "Installation workflows currently in progress.",
              [
                { key: "install_title",  label: "Project" },
                { key: "account_name",   label: "Account" },
                { key: "install_status", label: "Status" },
                { key: "total_amount",   label: "Value" },
                { key: "owner_name",     label: "Owner" },
                { key: "est_close_date", label: "Target" },
              ],
              qRows.rows, cnt.cnt as number, page, pageSize,
              "No installs currently in progress.",
            ));
          }

          case "exec_installs_with_blockers": {
            const sc = searchClause(search, ["iw.title", "a.name"]);
            const ownerIW = ownerId > 0 ? `AND iw.owner_user_id = ${ownerId}` : "";
            const qRows = await db.execute(sql.raw(`
              SELECT iw.id AS install_id, iw.title AS install_title, iw.status AS install_status,
                     iw.blockers, iw.total_amount, iw.target_completion_date AS est_close_date,
                     a.name AS account_name, a.id AS account_id, u.name AS owner_name
              FROM install_workflows iw
              LEFT JOIN accounts a ON a.id = iw.account_id
              LEFT JOIN users u ON u.id = iw.owner_user_id
              WHERE iw.blockers IS NOT NULL AND iw.blockers != '' ${ownerIW} ${sc}
              ORDER BY iw.updated_at DESC
              LIMIT ${pageSize} OFFSET ${offset}
            `));
            const [cnt] = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM install_workflows iw WHERE iw.blockers IS NOT NULL AND iw.blockers != '' ${ownerIW}`))).rows;
            return res.json(buildPaginatedResponse(metric, "Installs With Blockers",
              "Installation projects that have active blockers requiring resolution.",
              [
                { key: "install_title",  label: "Project" },
                { key: "account_name",   label: "Account" },
                { key: "install_status", label: "Status" },
                { key: "blockers",       label: "Blocker" },
                { key: "owner_name",     label: "Owner" },
                { key: "est_close_date", label: "Target" },
              ],
              qRows.rows, cnt.cnt as number, page, pageSize,
              "No installs with blockers — execution is unblocked!",
            ));
          }

          case "exec_installs_overdue": {
            const sc = searchClause(search, ["iw.title", "a.name"]);
            const ownerIW = ownerId > 0 ? `AND iw.owner_user_id = ${ownerId}` : "";
            const qRows = await db.execute(sql.raw(`
              SELECT iw.id AS install_id, iw.title AS install_title, iw.status AS install_status,
                     iw.total_amount, iw.target_completion_date AS est_close_date,
                     a.name AS account_name, a.id AS account_id, u.name AS owner_name,
                     GREATEST(0, EXTRACT(EPOCH FROM (NOW() - iw.target_completion_date)) / 86400)::int AS days_overdue
              FROM install_workflows iw
              LEFT JOIN accounts a ON a.id = iw.account_id
              LEFT JOIN users u ON u.id = iw.owner_user_id
              WHERE iw.status NOT IN ('complete','completed','cancelled')
                AND iw.target_completion_date IS NOT NULL
                AND iw.target_completion_date < NOW()
                ${ownerIW} ${sc}
              ORDER BY iw.target_completion_date ASC
              LIMIT ${pageSize} OFFSET ${offset}
            `));
            const [cnt] = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM install_workflows iw WHERE iw.status NOT IN ('complete','completed','cancelled') AND iw.target_completion_date IS NOT NULL AND iw.target_completion_date < NOW() ${ownerIW}`))).rows;
            return res.json(buildPaginatedResponse(metric, "Overdue Installs",
              "Installation projects past their target completion date.",
              [
                { key: "install_title",  label: "Project" },
                { key: "account_name",   label: "Account" },
                { key: "install_status", label: "Status" },
                { key: "owner_name",     label: "Owner" },
                { key: "days_overdue",   label: "Days Overdue" },
                { key: "est_close_date", label: "Was Due" },
              ],
              qRows.rows, cnt.cnt as number, page, pageSize,
              "No overdue installs — execution is on schedule!",
            ));
          }

          // ── Leads section ────────────────────────────────────────────────────

          case "exec_leads_total": {
            const where = `AND l.converted_at IS NULL AND l.status != 'archived'`;
            const [rows, [cnt]] = await Promise.all([
              db.execute(buildLeadQuery(where, search)),
              db.execute(buildLeadCount(where, search)),
            ]);
            return res.json(buildPaginatedResponse(metric, "Total Leads",
              "All active unconverted leads in the CRM.",
              LEAD_COLS, rows.rows, cnt.cnt as number, page, pageSize,
              "No active leads found.",
            ));
          }

          case "exec_leads_new_month": {
            const where = `AND DATE_TRUNC('month', l.created_at) = DATE_TRUNC('month', NOW())`;
            const [rows, [cnt]] = await Promise.all([
              db.execute(buildLeadQuery(where, search)),
              db.execute(buildLeadCount(where, search)),
            ]);
            return res.json(buildPaginatedResponse(metric, "New Leads This Month",
              "Leads created in the current calendar month.",
              LEAD_COLS, rows.rows, cnt.cnt as number, page, pageSize,
              "No new leads this month yet.",
            ));
          }

          case "exec_leads_converted": {
            const where = `AND l.converted_at IS NOT NULL`;
            const cols = [
              { key: "company",      label: "Company" },
              { key: "contact_name", label: "Contact" },
              { key: "source",       label: "Source" },
              { key: "deal_amount",  label: "Deal Value" },
              { key: "owner_name",   label: "Owner" },
              { key: "converted_at", label: "Converted" },
            ];
            const sc = searchClause(search, ["l.company", "l.contact_name"]);
            const qRows = await db.execute(sql.raw(`
              SELECT l.id AS lead_id, l.company, l.contact_name, l.source, l.deal_amount,
                     l.converted_at, u.name AS owner_name
              FROM leads l LEFT JOIN users u ON u.id = l.owner_user_id
              WHERE l.converted_at IS NOT NULL ${sc}
              ORDER BY l.converted_at DESC
              LIMIT ${pageSize} OFFSET ${offset}
            `));
            const [cnt] = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM leads l WHERE l.converted_at IS NOT NULL ${sc}`))).rows;
            return res.json(buildPaginatedResponse(metric, "Converted Leads",
              "Leads that have been successfully converted.",
              cols, qRows.rows, cnt.cnt as number, page, pageSize,
            ));
          }

          case "exec_leads_no_owner": {
            const where = `AND l.owner_user_id IS NULL AND l.converted_at IS NULL AND l.status != 'archived'`;
            const [rows, [cnt]] = await Promise.all([
              db.execute(buildLeadQuery(where, search)),
              db.execute(buildLeadCount(where, search)),
            ]);
            return res.json(buildPaginatedResponse(metric, "Leads Without Owner",
              "Unassigned leads that haven't been routed to a rep.",
              LEAD_COLS, rows.rows, cnt.cnt as number, page, pageSize,
              "All leads have an assigned owner.",
            ));
          }

          // ── Revenue Intelligence ─────────────────────────────────────────────

          case "revint_hot_accounts": {
            const threshold = safeInt(req.query.threshold, 50);
            const sc = searchClause(search, ["a.name"]);
            const qRows = await db.execute(sql.raw(`
              SELECT a.id AS account_id, a.name AS account_name,
                     COALESCE(ae.score, 0) AS engagement_score,
                     COALESCE(ae.tier, 'warm') AS status,
                     ae.last_activity_at AS created_at
              FROM accounts a
              LEFT JOIN account_engagement ae ON ae.account_id = a.id
              WHERE COALESCE(ae.score, 0) >= ${threshold} ${sc}
              ORDER BY ae.score DESC
              LIMIT ${pageSize} OFFSET ${offset}
            `));
            const [cnt] = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM accounts a LEFT JOIN account_engagement ae ON ae.account_id = a.id WHERE COALESCE(ae.score, 0) >= ${threshold}`))).rows;
            return res.json(buildPaginatedResponse(metric, `Hot Accounts (Score ≥ ${threshold})`,
              "Accounts with an engagement score above the hot threshold.",
              [
                { key: "account_name",      label: "Account" },
                { key: "engagement_score",  label: "Score" },
                { key: "status",            label: "Tier" },
                { key: "created_at",        label: "Last Activity" },
              ],
              qRows.rows, cnt.cnt as number, page, pageSize,
              "No hot accounts found at this threshold.",
            ));
          }

          case "revint_stalled_pipeline": {
            const where = `AND o.stage NOT IN ('closed_won','closed_lost') AND EXTRACT(EPOCH FROM (NOW() - COALESCE(o.last_activity_date, o.updated_at))) / 86400 >= 7`;
            const [rows, [cnt]] = await Promise.all([
              db.execute(buildOppQuery(where, search)),
              db.execute(buildOppCount(where, search)),
            ]);
            return res.json(buildPaginatedResponse(metric, "Stalled Pipeline",
              "Active deals with no activity in 7+ days — contributing to stalled pipeline value.",
              [
                ...EXEC_OPP_COLS,
                { key: "days_since_activity", label: "Days Stalled" },
              ],
              rows.rows, cnt.cnt as number, page, pageSize,
              "No stalled pipeline — all deals have recent activity.",
            ));
          }

          case "source_by_channel": {
            const channel = req.query.channel ? String(req.query.channel).replace(/'/g, "''").slice(0, 100) : null;
            const channelW = channel ? `AND COALESCE(l.acquisition_channel, l.source) ILIKE '%${channel}%'` : "";
            const sc = searchClause(search, ["l.company", "l.contact_name"]);
            const qRows = await db.execute(sql.raw(`
              SELECT l.id AS lead_id, l.company, l.contact_name, l.source,
                     COALESCE(l.acquisition_channel, l.source) AS acquisition_channel,
                     l.deal_amount, l.status, l.created_at, u.name AS owner_name
              FROM leads l
              LEFT JOIN users u ON u.id = l.owner_user_id
              WHERE TRUE ${channelW} ${sc}
              ORDER BY l.created_at DESC
              LIMIT ${pageSize} OFFSET ${offset}
            `));
            const [cnt] = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM leads l WHERE TRUE ${channelW}`))).rows;
            const titleStr = channel ? `Leads — ${channel}` : "All Lead Sources";
            return res.json(buildPaginatedResponse(metric, titleStr,
              channel ? `All leads attributed to the "${channel}" acquisition channel.` : "All leads with source attribution.",
              [
                { key: "company",              label: "Company" },
                { key: "contact_name",         label: "Contact" },
                { key: "acquisition_channel",  label: "Channel" },
                { key: "source",               label: "Source" },
                { key: "deal_amount",          label: "Deal Value" },
                { key: "status",               label: "Status" },
                { key: "created_at",           label: "Created" },
              ],
              qRows.rows, cnt.cnt as number, page, pageSize,
              channel ? `No leads found for channel "${channel}".` : "No leads with source data found.",
            ));
          }

          case "relint_stale_contacts": {
            const sc = searchClause(search, ["c.name", "c.email", "c.company"]);
            const qRows = await db.execute(sql.raw(`
              SELECT c.id AS contact_id, c.name AS contact_name, c.email, c.company,
                     c.title, c.updated_at AS created_at,
                     GREATEST(0, EXTRACT(EPOCH FROM (NOW() - c.updated_at)) / 86400)::int AS days_since_activity
              FROM contacts c
              WHERE EXTRACT(EPOCH FROM (NOW() - c.updated_at)) / 86400 >= 30 ${sc}
              ORDER BY c.updated_at ASC
              LIMIT ${pageSize} OFFSET ${offset}
            `));
            const [cnt] = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM contacts c WHERE EXTRACT(EPOCH FROM (NOW() - c.updated_at)) / 86400 >= 30`))).rows;
            return res.json(buildPaginatedResponse(metric, "Stale Relationships (30+ Days)",
              "Contacts with no activity or update in 30+ days — relationships may be cooling.",
              [
                { key: "contact_name",        label: "Contact" },
                { key: "company",             label: "Company" },
                { key: "email",               label: "Email" },
                { key: "title",               label: "Title" },
                { key: "days_since_activity", label: "Days Inactive" },
              ],
              qRows.rows, cnt.cnt as number, page, pageSize,
              "No stale contacts — relationships are being maintained!",
            ));
          }

          case "relint_execs_engaged": {
            const sc = searchClause(search, ["c.name", "c.company"]);
            const qRows = await db.execute(sql.raw(`
              SELECT c.id AS contact_id, c.name AS contact_name, c.email,
                     c.company, c.title, c.updated_at AS created_at
              FROM contacts c
              WHERE LOWER(c.title) SIMILAR TO '%(ceo|cfo|cto|vp|president|director|chief|founder|owner|partner)%' ${sc}
              ORDER BY c.updated_at DESC
              LIMIT ${pageSize} OFFSET ${offset}
            `));
            const [cnt] = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM contacts c WHERE LOWER(c.title) SIMILAR TO '%(ceo|cfo|cto|vp|president|director|chief|founder|owner|partner)%'`))).rows;
            return res.json(buildPaginatedResponse(metric, "Executive Contacts",
              "Senior decision-makers and executives in the CRM.",
              [
                { key: "contact_name", label: "Name" },
                { key: "company",      label: "Company" },
                { key: "title",        label: "Title" },
                { key: "email",        label: "Email" },
                { key: "created_at",   label: "Last Update" },
              ],
              qRows.rows, cnt.cnt as number, page, pageSize,
              "No executive contacts found.",
            ));
          }

          case "cs_at_risk": {
            const sc = searchClause(search, ["cs.company_name"]);
            const qRows = await db.execute(sql.raw(`
              SELECT cs.id AS install_id, cs.company_name AS install_title,
                     cs.health_status AS status, cs.arr_value AS total_amount,
                     cs.renewal_date AS est_close_date, u.name AS owner_name,
                     a.id AS account_id, a.name AS account_name
              FROM customer_subscriptions cs
              LEFT JOIN accounts a ON a.id = cs.account_id
              LEFT JOIN users u ON u.id = cs.owner_user_id
              WHERE cs.health_status IN ('at_risk', 'churned') ${sc}
              ORDER BY cs.arr_value DESC NULLS LAST
              LIMIT ${pageSize} OFFSET ${offset}
            `));
            const [cnt] = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM customer_subscriptions cs WHERE cs.health_status IN ('at_risk','churned')`))).rows;
            return res.json(buildPaginatedResponse(metric, "At-Risk Customers",
              "Customer subscriptions flagged as at-risk or churned.",
              [
                { key: "install_title",  label: "Customer" },
                { key: "account_name",   label: "Account" },
                { key: "status",         label: "Health" },
                { key: "total_amount",   label: "ARR" },
                { key: "owner_name",     label: "Owner" },
                { key: "est_close_date", label: "Renewal" },
              ],
              qRows.rows, cnt.cnt as number, page, pageSize,
              "No at-risk customers — retention is healthy!",
            ));
          }

          case "cs_renewals_due": {
            const sc = searchClause(search, ["cs.company_name"]);
            const qRows = await db.execute(sql.raw(`
              SELECT cs.id AS install_id, cs.company_name AS install_title,
                     cs.health_status AS status, cs.arr_value AS total_amount,
                     cs.renewal_date AS est_close_date, u.name AS owner_name,
                     a.id AS account_id, a.name AS account_name
              FROM customer_subscriptions cs
              LEFT JOIN accounts a ON a.id = cs.account_id
              LEFT JOIN users u ON u.id = cs.owner_user_id
              WHERE cs.renewal_date IS NOT NULL
                AND cs.renewal_date BETWEEN NOW() AND NOW() + INTERVAL '90 days'
                AND cs.status NOT IN ('churned','cancelled')
                ${sc}
              ORDER BY cs.renewal_date ASC
              LIMIT ${pageSize} OFFSET ${offset}
            `));
            const [cnt] = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM customer_subscriptions cs WHERE cs.renewal_date IS NOT NULL AND cs.renewal_date BETWEEN NOW() AND NOW() + INTERVAL '90 days' AND cs.status NOT IN ('churned','cancelled')`))).rows;
            return res.json(buildPaginatedResponse(metric, "Renewals Due (Next 90 Days)",
              "Customer subscriptions with renewals coming up in the next 90 days.",
              [
                { key: "install_title",  label: "Customer" },
                { key: "account_name",   label: "Account" },
                { key: "status",         label: "Health" },
                { key: "total_amount",   label: "ARR" },
                { key: "owner_name",     label: "Owner" },
                { key: "est_close_date", label: "Renewal Due" },
              ],
              qRows.rows, cnt.cnt as number, page, pageSize,
              "No renewals due in the next 90 days.",
            ));
          }

          default:
            return res.status(400).json({ message: `Unknown insights metric: ${metric}` });
        }
      } catch (err: any) {
        console.error("[drilldown] GET /api/insights/drilldown:", err.message);
        res.status(500).json({ message: err.message });
      }
    },
  );
}
