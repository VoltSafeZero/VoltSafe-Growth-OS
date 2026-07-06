// ── Pipeline Drilldown Routes — Phase 2 Universal Drilldowns ──────────────────
// GET /api/pipeline/drilldown
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

export function registerPipelineDrilldownRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: (section: string, level: string) => any,
) {
  app.get(
    "/api/pipeline/drilldown",
    requireAuth,
    requirePermission("crm", "view"),
    async (req: any, res) => {
      try {
        const metric   = String(req.query.metric   ?? "");
        const search   = String(req.query.search   ?? "");
        const page     = Math.max(1, safeInt(req.query.page, PAGE_DEFAULT));
        const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, safeInt(req.query.page_size, PAGE_SIZE_DEFAULT)));
        const offset   = (page - 1) * pageSize;

        // Optional extra filters
        const ownerId    = safeInt(req.query.owner_id, 0);
        const accountId  = safeInt(req.query.account_id, 0);
        const leadId     = safeInt(req.query.lead_id, 0);
        const dateFrom   = req.query.date_from ? String(req.query.date_from).slice(0, 20) : null;
        const dateTo     = req.query.date_to   ? String(req.query.date_to).slice(0, 20) : null;

        // ── Opportunity-based metrics ──────────────────────────────────────────
        const OPP_COLS = [
          { key: "title",                label: "Opportunity" },
          { key: "account_name",         label: "Account" },
          { key: "stage",                label: "Stage" },
          { key: "forecast_category",    label: "Category" },
          { key: "amount",               label: "Amount" },
          { key: "owner_name",           label: "Owner" },
          { key: "days_since_activity",  label: "Last Activity" },
          { key: "est_close_date",       label: "Close Date" },
        ];

        const OPP_SIMPLE_COLS = [
          { key: "title",               label: "Opportunity" },
          { key: "account_name",        label: "Account" },
          { key: "stage",               label: "Stage" },
          { key: "amount",              label: "Amount" },
          { key: "owner_name",          label: "Owner" },
          { key: "est_close_date",      label: "Close Date" },
        ];

        function buildOppQuery(extraWhere: string, sSearch: string) {
          const sc = searchClause(sSearch, ["o.title", "a.name", "u.name"]);
          const ownerW = ownerId > 0 ? `AND o.owner_user_id = ${ownerId}` : "";
          const accW   = accountId > 0 ? `AND o.account_id = ${accountId}` : "";
          return sql.raw(`
            SELECT
              o.id             AS opp_id,
              o.title,
              o.stage,
              o.forecast_category,
              o.amount,
              o.est_close_date,
              o.last_activity_date,
              GREATEST(0, EXTRACT(EPOCH FROM (NOW() - COALESCE(o.last_activity_date, o.updated_at))) / 86400)::int AS days_since_activity,
              a.name           AS account_name,
              a.id             AS account_id,
              u.name           AS owner_name
            FROM opportunities o
            LEFT JOIN accounts a ON a.id = o.account_id
            LEFT JOIN users u ON u.id = o.owner_user_id
            WHERE TRUE ${extraWhere} ${ownerW} ${accW} ${sc}
            ORDER BY o.amount DESC NULLS LAST, o.updated_at DESC
            LIMIT ${pageSize} OFFSET ${offset}
          `);
        }

        function buildOppCount(extraWhere: string, sSearch: string) {
          const sc = searchClause(sSearch, ["o.title", "a.name", "u.name"]);
          const ownerW = ownerId > 0 ? `AND o.owner_user_id = ${ownerId}` : "";
          const accW   = accountId > 0 ? `AND o.account_id = ${accountId}` : "";
          return sql.raw(`
            SELECT COUNT(*)::int AS cnt
            FROM opportunities o
            LEFT JOIN accounts a ON a.id = o.account_id
            LEFT JOIN users u ON u.id = o.owner_user_id
            WHERE TRUE ${extraWhere} ${ownerW} ${accW} ${sc}
          `);
        }

        // ── Lead-based metrics ─────────────────────────────────────────────────
        const LEAD_COLS = [
          { key: "company",            label: "Company" },
          { key: "contact_name",       label: "Contact" },
          { key: "status",             label: "Status" },
          { key: "source",             label: "Source" },
          { key: "deal_amount",        label: "Deal Value" },
          { key: "owner_name",         label: "Owner" },
          { key: "days_since_update",  label: "Last Update" },
          { key: "created_at",         label: "Created" },
        ];

        function buildLeadQuery(extraWhere: string, sSearch: string) {
          const sc = searchClause(sSearch, ["l.company", "l.contact_name", "l.contact_email", "u.name"]);
          const ownerW = ownerId > 0 ? `AND l.owner_user_id = ${ownerId}` : "";
          const dfW = dateFrom ? `AND l.created_at >= '${dateFrom}'` : "";
          const dtW = dateTo   ? `AND l.created_at <= '${dateTo}'` : "";
          return sql.raw(`
            SELECT
              l.id             AS lead_id,
              l.company,
              l.contact_name,
              l.contact_email,
              l.status,
              l.source,
              l.deal_amount,
              l.created_at,
              GREATEST(0, EXTRACT(EPOCH FROM (NOW() - l.updated_at)) / 86400)::int AS days_since_update,
              u.name           AS owner_name
            FROM leads l
            LEFT JOIN users u ON u.id = l.owner_user_id
            WHERE TRUE ${extraWhere} ${ownerW} ${dfW} ${dtW} ${sc}
            ORDER BY l.updated_at DESC
            LIMIT ${pageSize} OFFSET ${offset}
          `);
        }

        function buildLeadCount(extraWhere: string, sSearch: string) {
          const sc = searchClause(sSearch, ["l.company", "l.contact_name", "l.contact_email", "u.name"]);
          const ownerW = ownerId > 0 ? `AND l.owner_user_id = ${ownerId}` : "";
          const dfW = dateFrom ? `AND l.created_at >= '${dateFrom}'` : "";
          const dtW = dateTo   ? `AND l.created_at <= '${dateTo}'` : "";
          return sql.raw(`
            SELECT COUNT(*)::int AS cnt
            FROM leads l
            LEFT JOIN users u ON u.id = l.owner_user_id
            WHERE TRUE ${extraWhere} ${ownerW} ${dfW} ${dtW} ${sc}
          `);
        }

        // ── Route metric switch ────────────────────────────────────────────────

        switch (metric) {

          // ── Pipeline snapshot metrics ────────────────────────────────────────

          case "active_deals": {
            const where = `AND o.stage NOT IN ('closed_won','closed_lost')`;
            const [rows, [cnt]] = await Promise.all([
              db.execute(buildOppQuery(where, search)),
              db.execute(buildOppCount(where, search)),
            ]);
            return res.json(buildPaginatedResponse(
              metric, "Active Deals",
              "All opportunities currently in progress (not closed won or lost).",
              OPP_COLS, rows.rows, cnt.cnt as number, page, pageSize,
              "No active deals found.",
            ));
          }

          case "total_pipeline": {
            const where = `AND o.stage NOT IN ('closed_won','closed_lost') AND o.amount > 0`;
            const [rows, [cnt]] = await Promise.all([
              db.execute(buildOppQuery(where, search)),
              db.execute(buildOppCount(where, search)),
            ]);
            return res.json(buildPaginatedResponse(
              metric, "Total Pipeline",
              "Active deals with a pipeline value — sorted by deal amount.",
              OPP_COLS, rows.rows, cnt.cnt as number, page, pageSize,
              "No pipeline opportunities with a value set.",
            ));
          }

          case "weighted_pipeline": {
            const where = `AND o.stage NOT IN ('closed_won','closed_lost') AND o.amount > 0`;
            const cols = [
              { key: "title",              label: "Opportunity" },
              { key: "account_name",       label: "Account" },
              { key: "stage",              label: "Stage" },
              { key: "forecast_category",  label: "Category" },
              { key: "amount",             label: "Gross Amount" },
              { key: "weighted_amount",    label: "Weighted" },
              { key: "owner_name",         label: "Owner" },
              { key: "est_close_date",     label: "Close Date" },
            ];
            const PROB_MAP: Record<string, number> = {
              inbound_new: 5, qualifying: 15, discovery: 25,
              proposal: 40, negotiation: 60, verbal_commit: 80,
              closed_won: 100, closed_lost: 0,
            };
            const sc = searchClause(search, ["o.title", "a.name", "u.name"]);
            const ownerW = ownerId > 0 ? `AND o.owner_user_id = ${ownerId}` : "";
            const qRows = await db.execute(sql.raw(`
              SELECT
                o.id AS opp_id, o.title, o.stage, o.forecast_category, o.amount, o.est_close_date,
                a.name AS account_name, a.id AS account_id, u.name AS owner_name,
                CASE o.stage
                  WHEN 'inbound_new' THEN o.amount * 0.05
                  WHEN 'qualifying'  THEN o.amount * 0.15
                  WHEN 'discovery'   THEN o.amount * 0.25
                  WHEN 'proposal'    THEN o.amount * 0.40
                  WHEN 'negotiation' THEN o.amount * 0.60
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
            return res.json(buildPaginatedResponse(metric, "Weighted Pipeline",
              "Opportunities weighted by stage probability — sorted by weighted value.",
              cols, qRows.rows, cnt.cnt as number, page, pageSize,
            ));
          }

          case "stalled_deals": {
            const where = `AND o.stage NOT IN ('closed_won','closed_lost') AND EXTRACT(EPOCH FROM (NOW() - COALESCE(o.last_activity_date, o.updated_at))) / 86400 >= 7`;
            const [rows, [cnt]] = await Promise.all([
              db.execute(buildOppQuery(where, search)),
              db.execute(buildOppCount(where, search)),
            ]);
            return res.json(buildPaginatedResponse(
              metric, "Stalled Deals",
              "Active opportunities with no activity in 7+ days.",
              OPP_COLS, rows.rows, cnt.cnt as number, page, pageSize,
              "No stalled deals — pipeline is moving!",
            ));
          }

          case "no_next_step": {
            const where = `AND o.stage NOT IN ('closed_won','closed_lost','verbal_commit') AND EXTRACT(EPOCH FROM (NOW() - COALESCE(o.last_activity_date, o.updated_at))) / 86400 >= 3`;
            const [rows, [cnt]] = await Promise.all([
              db.execute(buildOppQuery(where, search)),
              db.execute(buildOppCount(where, search)),
            ]);
            return res.json(buildPaginatedResponse(
              metric, "No Next Step",
              "Deals with no activity in 3+ days that need attention.",
              OPP_COLS, rows.rows, cnt.cnt as number, page, pageSize,
              "All deals have recent activity — good pipeline hygiene!",
            ));
          }

          case "high_value_inactive": {
            const where = `AND o.stage NOT IN ('closed_won','closed_lost') AND EXTRACT(EPOCH FROM (NOW() - COALESCE(o.last_activity_date, o.updated_at))) / 86400 >= 14 AND o.amount >= (SELECT PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY amount) FROM opportunities WHERE stage NOT IN ('closed_won','closed_lost') AND amount > 0)`;
            const [rows, [cnt]] = await Promise.all([
              db.execute(buildOppQuery(where, search)),
              db.execute(buildOppCount(where, search)),
            ]);
            return res.json(buildPaginatedResponse(
              metric, "High Value Inactive",
              "High-value deals (top 25% by amount) with no activity in 14+ days.",
              OPP_COLS, rows.rows, cnt.cnt as number, page, pageSize,
              "No high-value inactive deals — top deals are being worked!",
            ));
          }

          case "closing_this_month": {
            const where = `AND o.stage NOT IN ('closed_won','closed_lost') AND DATE_TRUNC('month', o.est_close_date) = DATE_TRUNC('month', NOW())`;
            const [rows, [cnt]] = await Promise.all([
              db.execute(buildOppQuery(where, search)),
              db.execute(buildOppCount(where, search)),
            ]);
            return res.json(buildPaginatedResponse(
              metric, "Closing This Month",
              "Active deals with an estimated close date within the current calendar month.",
              OPP_COLS, rows.rows, cnt.cnt as number, page, pageSize,
              "No deals closing this month.",
            ));
          }

          case "no_activity_14d": {
            const where = `AND o.stage NOT IN ('closed_won','closed_lost') AND EXTRACT(EPOCH FROM (NOW() - COALESCE(o.last_activity_date, o.updated_at))) / 86400 >= 14`;
            const [rows, [cnt]] = await Promise.all([
              db.execute(buildOppQuery(where, search)),
              db.execute(buildOppCount(where, search)),
            ]);
            return res.json(buildPaginatedResponse(
              metric, "No Activity 14+ Days",
              "Active opportunities with no recorded activity in 14 or more days.",
              OPP_COLS, rows.rows, cnt.cnt as number, page, pageSize,
              "No deals are sitting inactive for 14+ days.",
            ));
          }

          case "awaiting_quote": {
            const where = `AND o.stage NOT IN ('closed_won','closed_lost') AND EXISTS (SELECT 1 FROM quotes q WHERE q.opportunity_id = o.id AND q.status = 'sent')`;
            const [rows, [cnt]] = await Promise.all([
              db.execute(buildOppQuery(where, search)),
              db.execute(buildOppCount(where, search)),
            ]);
            return res.json(buildPaginatedResponse(
              metric, "Awaiting Quote Response",
              "Opportunities with a sent quote that has not yet received a response.",
              OPP_COLS, rows.rows, cnt.cnt as number, page, pageSize,
              "No deals currently awaiting a quote response.",
            ));
          }

          case "commit_deals": {
            const where = `AND o.stage NOT IN ('closed_won','closed_lost') AND o.forecast_category = 'commit'`;
            const [rows, [cnt]] = await Promise.all([
              db.execute(buildOppQuery(where, search)),
              db.execute(buildOppCount(where, search)),
            ]);
            return res.json(buildPaginatedResponse(
              metric, "Commit Deals",
              "Deals forecasted as Commit — highest-confidence opportunities.",
              OPP_COLS, rows.rows, cnt.cnt as number, page, pageSize,
              "No commit-category deals currently in pipeline.",
            ));
          }

          case "best_case_deals": {
            const where = `AND o.stage NOT IN ('closed_won','closed_lost') AND o.forecast_category = 'best_case'`;
            const [rows, [cnt]] = await Promise.all([
              db.execute(buildOppQuery(where, search)),
              db.execute(buildOppCount(where, search)),
            ]);
            return res.json(buildPaginatedResponse(
              metric, "Best Case Deals",
              "Deals forecasted as Best Case — strong but not fully committed.",
              OPP_COLS, rows.rows, cnt.cnt as number, page, pageSize,
              "No best-case deals in pipeline.",
            ));
          }

          case "overdue_close": {
            const where = `AND o.stage NOT IN ('closed_won','closed_lost') AND o.est_close_date IS NOT NULL AND o.est_close_date < NOW()`;
            const [rows, [cnt]] = await Promise.all([
              db.execute(buildOppQuery(where, search)),
              db.execute(buildOppCount(where, search)),
            ]);
            return res.json(buildPaginatedResponse(
              metric, "Overdue Close Date",
              "Active deals where the estimated close date has already passed.",
              OPP_COLS, rows.rows, cnt.cnt as number, page, pageSize,
              "No overdue close dates — forecast is current!",
            ));
          }

          case "no_open_task": {
            const where = `AND o.stage NOT IN ('closed_won','closed_lost') AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.linked_object_type = 'opportunity' AND t.linked_object_id = o.id AND t.status != 'done')`;
            const [rows, [cnt]] = await Promise.all([
              db.execute(buildOppQuery(where, search)),
              db.execute(buildOppCount(where, search)),
            ]);
            return res.json(buildPaginatedResponse(
              metric, "No Open Task",
              "Active deals with no open task assigned.",
              OPP_COLS, rows.rows, cnt.cnt as number, page, pageSize,
              "All active deals have at least one open task.",
            ));
          }

          // ── Leads metrics ──────────────────────────────────────────────────────

          case "leads_total": {
            const where = `AND l.status != 'archived' AND l.converted_at IS NULL`;
            const [rows, [cnt]] = await Promise.all([
              db.execute(buildLeadQuery(where, search)),
              db.execute(buildLeadCount(where, search)),
            ]);
            return res.json(buildPaginatedResponse(
              metric, "Total Leads",
              "All active leads not yet converted.",
              LEAD_COLS, rows.rows, cnt.cnt as number, page, pageSize,
              "No leads found.",
            ));
          }

          case "leads_no_owner": {
            const where = `AND l.owner_user_id IS NULL AND l.converted_at IS NULL AND l.status != 'archived'`;
            const [rows, [cnt]] = await Promise.all([
              db.execute(buildLeadQuery(where, search)),
              db.execute(buildLeadCount(where, search)),
            ]);
            return res.json(buildPaginatedResponse(
              metric, "Leads Without Owner",
              "Leads that have no assigned owner — need routing.",
              LEAD_COLS, rows.rows, cnt.cnt as number, page, pageSize,
              "All leads have an assigned owner.",
            ));
          }

          case "leads_stale": {
            const where = `AND l.converted_at IS NULL AND l.status != 'archived' AND EXTRACT(EPOCH FROM (NOW() - l.updated_at)) / 86400 >= 14`;
            const [rows, [cnt]] = await Promise.all([
              db.execute(buildLeadQuery(where, search)),
              db.execute(buildLeadCount(where, search)),
            ]);
            return res.json(buildPaginatedResponse(
              metric, "Stale Leads (14+ Days)",
              "Leads with no activity or update in 14 or more days.",
              LEAD_COLS, rows.rows, cnt.cnt as number, page, pageSize,
              "No stale leads — good pipeline hygiene!",
            ));
          }

          case "leads_new_month": {
            const where = `AND DATE_TRUNC('month', l.created_at) = DATE_TRUNC('month', NOW())`;
            const [rows, [cnt]] = await Promise.all([
              db.execute(buildLeadQuery(where, search)),
              db.execute(buildLeadCount(where, search)),
            ]);
            return res.json(buildPaginatedResponse(
              metric, "New Leads This Month",
              "Leads created in the current calendar month.",
              LEAD_COLS, rows.rows, cnt.cnt as number, page, pageSize,
              "No new leads this month.",
            ));
          }

          case "leads_converted": {
            const where = `AND l.converted_at IS NOT NULL`;
            const cols = [
              { key: "company",      label: "Company" },
              { key: "contact_name", label: "Contact" },
              { key: "source",       label: "Source" },
              { key: "deal_amount",  label: "Deal Value" },
              { key: "owner_name",   label: "Owner" },
              { key: "converted_at", label: "Converted" },
            ];
            const sc = searchClause(search, ["l.company", "l.contact_name", "u.name"]);
            const qRows = await db.execute(sql.raw(`
              SELECT l.id AS lead_id, l.company, l.contact_name, l.source, l.deal_amount,
                     l.converted_at, u.name AS owner_name
              FROM leads l
              LEFT JOIN users u ON u.id = l.owner_user_id
              WHERE l.converted_at IS NOT NULL ${sc}
              ORDER BY l.converted_at DESC
              LIMIT ${pageSize} OFFSET ${offset}
            `));
            const [cnt] = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM leads l LEFT JOIN users u ON u.id = l.owner_user_id WHERE l.converted_at IS NOT NULL ${sc}`))).rows;
            return res.json(buildPaginatedResponse(metric, "Converted Leads",
              "Leads that have been successfully converted to opportunities.",
              cols, qRows.rows, cnt.cnt as number, page, pageSize,
              "No converted leads found.",
            ));
          }

          // ── Contacts metrics ───────────────────────────────────────────────────

          case "contacts_total": {
            const sc = searchClause(search, ["c.name", "c.email", "c.company"]);
            const qRows = await db.execute(sql.raw(`
              SELECT c.id AS contact_id, c.name AS contact_name, c.email, c.phone,
                     c.company, c.title, c.created_at
              FROM contacts c
              WHERE TRUE ${sc}
              ORDER BY c.updated_at DESC
              LIMIT ${pageSize} OFFSET ${offset}
            `));
            const [cnt] = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM contacts c WHERE TRUE ${sc}`))).rows;
            return res.json(buildPaginatedResponse(metric, "Total Contacts",
              "All contacts in the CRM.",
              [
                { key: "contact_name", label: "Name" },
                { key: "email",        label: "Email" },
                { key: "company",      label: "Company" },
                { key: "title",        label: "Title" },
                { key: "created_at",   label: "Added" },
              ],
              qRows.rows, cnt.cnt as number, page, pageSize,
              "No contacts found.",
            ));
          }

          case "contacts_missing_email": {
            const sc = searchClause(search, ["c.name", "c.company"]);
            const qRows = await db.execute(sql.raw(`
              SELECT c.id AS contact_id, c.name AS contact_name, c.phone,
                     c.company, c.title, c.created_at
              FROM contacts c
              WHERE (c.email IS NULL OR c.email = '') ${sc}
              ORDER BY c.updated_at DESC
              LIMIT ${pageSize} OFFSET ${offset}
            `));
            const [cnt] = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM contacts c WHERE (c.email IS NULL OR c.email = '') ${sc}`))).rows;
            return res.json(buildPaginatedResponse(metric, "Contacts Missing Email",
              "Contacts without an email address — outreach will be limited.",
              [
                { key: "contact_name", label: "Name" },
                { key: "company",      label: "Company" },
                { key: "title",        label: "Title" },
                { key: "phone",        label: "Phone" },
                { key: "created_at",   label: "Added" },
              ],
              qRows.rows, cnt.cnt as number, page, pageSize,
              "All contacts have an email address.",
            ));
          }

          // ── Quotes metrics ─────────────────────────────────────────────────────

          case "quotes_awaiting": {
            const sc = searchClause(search, ["q.quote_number", "q.customer_name", "a.name"]);
            const ownerW = ownerId > 0 ? `AND q.owner_user_id = ${ownerId}` : "";
            const qRows = await db.execute(sql.raw(`
              SELECT q.id AS quote_id, q.quote_number, q.status, q.total, q.sent_at,
                     q.customer_name, a.name AS account_name, a.id AS account_id,
                     u.name AS owner_name,
                     GREATEST(0, EXTRACT(EPOCH FROM (NOW() - q.sent_at)) / 86400)::int AS days_waiting
              FROM quotes q
              LEFT JOIN accounts a ON a.id = q.account_id
              LEFT JOIN users u ON u.id = q.owner_user_id
              WHERE q.status = 'sent' ${ownerW} ${sc}
              ORDER BY q.sent_at ASC
              LIMIT ${pageSize} OFFSET ${offset}
            `));
            const [cnt] = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM quotes q LEFT JOIN accounts a ON a.id = q.account_id LEFT JOIN users u ON u.id = q.owner_user_id WHERE q.status = 'sent' ${ownerW} ${sc}`))).rows;
            return res.json(buildPaginatedResponse(metric, "Quotes Awaiting Response",
              "Sent quotes that haven't received a customer response yet — sorted oldest first.",
              [
                { key: "quote_number",  label: "Quote #" },
                { key: "account_name",  label: "Account" },
                { key: "total",         label: "Total" },
                { key: "owner_name",    label: "Owner" },
                { key: "days_waiting",  label: "Days Waiting" },
                { key: "sent_at",       label: "Sent" },
              ],
              qRows.rows, cnt.cnt as number, page, pageSize,
              "No quotes awaiting response.",
            ));
          }

          case "quotes_accepted": {
            const sc = searchClause(search, ["q.quote_number", "q.customer_name", "a.name"]);
            const ownerW = ownerId > 0 ? `AND q.owner_user_id = ${ownerId}` : "";
            const dfW = dateFrom ? `AND q.accepted_at >= '${dateFrom}'` : "";
            const dtW = dateTo   ? `AND q.accepted_at <= '${dateTo}'` : "";
            const qRows = await db.execute(sql.raw(`
              SELECT q.id AS quote_id, q.quote_number, q.total, q.accepted_at,
                     q.customer_name, a.name AS account_name, a.id AS account_id,
                     u.name AS owner_name
              FROM quotes q
              LEFT JOIN accounts a ON a.id = q.account_id
              LEFT JOIN users u ON u.id = q.owner_user_id
              WHERE q.status = 'accepted' ${ownerW} ${dfW} ${dtW} ${sc}
              ORDER BY q.accepted_at DESC
              LIMIT ${pageSize} OFFSET ${offset}
            `));
            const [cnt] = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM quotes q LEFT JOIN accounts a ON a.id = q.account_id LEFT JOIN users u ON u.id = q.owner_user_id WHERE q.status = 'accepted' ${ownerW} ${dfW} ${dtW} ${sc}`))).rows;
            return res.json(buildPaginatedResponse(metric, "Accepted Quotes",
              "Quotes that have been accepted — confirmed revenue.",
              [
                { key: "quote_number",  label: "Quote #" },
                { key: "account_name",  label: "Account" },
                { key: "total",         label: "Total" },
                { key: "owner_name",    label: "Owner" },
                { key: "accepted_at",   label: "Accepted" },
              ],
              qRows.rows, cnt.cnt as number, page, pageSize,
              "No accepted quotes found.",
            ));
          }

          case "quotes_declined": {
            const sc = searchClause(search, ["q.quote_number", "q.customer_name", "a.name"]);
            const ownerW = ownerId > 0 ? `AND q.owner_user_id = ${ownerId}` : "";
            const qRows = await db.execute(sql.raw(`
              SELECT q.id AS quote_id, q.quote_number, q.total, q.declined_at,
                     q.customer_name, a.name AS account_name, a.id AS account_id,
                     u.name AS owner_name
              FROM quotes q
              LEFT JOIN accounts a ON a.id = q.account_id
              LEFT JOIN users u ON u.id = q.owner_user_id
              WHERE q.status = 'declined' ${ownerW} ${sc}
              ORDER BY q.declined_at DESC
              LIMIT ${pageSize} OFFSET ${offset}
            `));
            const [cnt] = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM quotes q LEFT JOIN accounts a ON a.id = q.account_id LEFT JOIN users u ON u.id = q.owner_user_id WHERE q.status = 'declined' ${ownerW} ${sc}`))).rows;
            return res.json(buildPaginatedResponse(metric, "Declined Quotes",
              "Quotes that were declined by the customer.",
              [
                { key: "quote_number",  label: "Quote #" },
                { key: "account_name",  label: "Account" },
                { key: "total",         label: "Total" },
                { key: "owner_name",    label: "Owner" },
                { key: "declined_at",   label: "Declined" },
              ],
              qRows.rows, cnt.cnt as number, page, pageSize,
              "No declined quotes found.",
            ));
          }

          // ── Install/renewal metrics ────────────────────────────────────────────

          case "renewals_at_risk": {
            const sc = searchClause(search, ["cs.company_name", "u.name"]);
            const qRows = await db.execute(sql.raw(`
              SELECT cs.id AS install_id, cs.company_name AS install_title,
                     cs.health_status AS status, cs.arr_value AS total_amount,
                     cs.renewal_date AS est_close_date, u.name AS owner_name,
                     a.id AS account_id, a.name AS account_name
              FROM customer_subscriptions cs
              LEFT JOIN accounts a ON a.id = cs.account_id
              LEFT JOIN users u ON u.id = cs.owner_user_id
              WHERE cs.health_status = 'at_risk' ${sc}
              ORDER BY cs.renewal_date ASC NULLS LAST
              LIMIT ${pageSize} OFFSET ${offset}
            `));
            const [cnt] = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM customer_subscriptions cs WHERE cs.health_status = 'at_risk'`))).rows;
            return res.json(buildPaginatedResponse(metric, "At-Risk Renewals",
              "Customer subscriptions with an at-risk health status — need immediate attention.",
              [
                { key: "install_title",  label: "Customer" },
                { key: "account_name",   label: "Account" },
                { key: "status",         label: "Health" },
                { key: "total_amount",   label: "ARR" },
                { key: "owner_name",     label: "Owner" },
                { key: "est_close_date", label: "Renewal" },
              ],
              qRows.rows, cnt.cnt as number, page, pageSize,
              "No at-risk renewals — customer base is healthy!",
            ));
          }

          case "renewals_overdue": {
            const sc = searchClause(search, ["cs.company_name"]);
            const qRows = await db.execute(sql.raw(`
              SELECT cs.id AS install_id, cs.company_name AS install_title,
                     cs.health_status AS status, cs.arr_value AS total_amount,
                     cs.renewal_date AS est_close_date, u.name AS owner_name,
                     a.id AS account_id, a.name AS account_name
              FROM customer_subscriptions cs
              LEFT JOIN accounts a ON a.id = cs.account_id
              LEFT JOIN users u ON u.id = cs.owner_user_id
              WHERE cs.renewal_date IS NOT NULL AND cs.renewal_date < NOW() AND cs.status != 'churned' ${sc}
              ORDER BY cs.renewal_date ASC
              LIMIT ${pageSize} OFFSET ${offset}
            `));
            const [cnt] = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM customer_subscriptions cs WHERE cs.renewal_date IS NOT NULL AND cs.renewal_date < NOW() AND cs.status != 'churned'`))).rows;
            return res.json(buildPaginatedResponse(metric, "Overdue Renewals",
              "Subscriptions with a renewal date in the past that haven't renewed or churned.",
              [
                { key: "install_title",  label: "Customer" },
                { key: "account_name",   label: "Account" },
                { key: "status",         label: "Health" },
                { key: "total_amount",   label: "ARR" },
                { key: "owner_name",     label: "Owner" },
                { key: "est_close_date", label: "Renewal Due" },
              ],
              qRows.rows, cnt.cnt as number, page, pageSize,
              "No overdue renewals.",
            ));
          }

          case "booking_outreach_sent": {
            const sc = searchClause(search, ["blr.recipient_email", "blr.recipient_name"]);
            const qRows = await db.execute(sql.raw(`
              SELECT blr.id AS lead_id, blr.recipient_name AS contact_name,
                     blr.recipient_email AS company, blr.status, blr.sent_at AS created_at,
                     bl.campaign_name AS source
              FROM booking_link_recipients blr
              LEFT JOIN booking_links bl ON bl.id = blr.booking_link_id
              WHERE blr.sent_at IS NOT NULL ${sc}
              ORDER BY blr.sent_at DESC
              LIMIT ${pageSize} OFFSET ${offset}
            `));
            const [cnt] = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM booking_link_recipients blr WHERE blr.sent_at IS NOT NULL`))).rows;
            return res.json(buildPaginatedResponse(metric, "Outreach Sent",
              "All booking outreach emails that have been sent.",
              [
                { key: "contact_name", label: "Recipient" },
                { key: "company",      label: "Email" },
                { key: "source",       label: "Campaign" },
                { key: "status",       label: "Status" },
                { key: "created_at",   label: "Sent" },
              ],
              qRows.rows, cnt.cnt as number, page, pageSize,
              "No outreach emails sent yet.",
            ));
          }

          case "booking_outreach_opened": {
            const sc = searchClause(search, ["blr.recipient_email", "blr.recipient_name"]);
            const qRows = await db.execute(sql.raw(`
              SELECT blr.id AS lead_id, blr.recipient_name AS contact_name,
                     blr.recipient_email AS company, blr.status, blr.opened_at AS created_at,
                     bl.campaign_name AS source
              FROM booking_link_recipients blr
              LEFT JOIN booking_links bl ON bl.id = blr.booking_link_id
              WHERE blr.opened_at IS NOT NULL ${sc}
              ORDER BY blr.opened_at DESC
              LIMIT ${pageSize} OFFSET ${offset}
            `));
            const [cnt] = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM booking_link_recipients blr WHERE blr.opened_at IS NOT NULL`))).rows;
            return res.json(buildPaginatedResponse(metric, "Outreach Opened",
              "Recipients who opened the booking outreach email.",
              [
                { key: "contact_name", label: "Recipient" },
                { key: "company",      label: "Email" },
                { key: "source",       label: "Campaign" },
                { key: "status",       label: "Status" },
                { key: "created_at",   label: "Opened" },
              ],
              qRows.rows, cnt.cnt as number, page, pageSize,
              "No opened emails recorded yet.",
            ));
          }

          case "booking_outreach_booked": {
            const sc = searchClause(search, ["blr.recipient_email", "blr.recipient_name"]);
            const qRows = await db.execute(sql.raw(`
              SELECT blr.id AS lead_id, blr.recipient_name AS contact_name,
                     blr.recipient_email AS company, blr.status, blr.booked_at AS created_at,
                     bl.campaign_name AS source
              FROM booking_link_recipients blr
              LEFT JOIN booking_links bl ON bl.id = blr.booking_link_id
              WHERE blr.booked_at IS NOT NULL ${sc}
              ORDER BY blr.booked_at DESC
              LIMIT ${pageSize} OFFSET ${offset}
            `));
            const [cnt] = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM booking_link_recipients blr WHERE blr.booked_at IS NOT NULL`))).rows;
            return res.json(buildPaginatedResponse(metric, "Outreach Booked",
              "Prospects who booked a meeting from the booking outreach.",
              [
                { key: "contact_name", label: "Prospect" },
                { key: "company",      label: "Email" },
                { key: "source",       label: "Campaign" },
                { key: "status",       label: "Status" },
                { key: "created_at",   label: "Booked" },
              ],
              qRows.rows, cnt.cnt as number, page, pageSize,
              "No bookings recorded yet.",
            ));
          }

          default:
            return res.status(400).json({ message: `Unknown pipeline metric: ${metric}` });
        }
      } catch (err: any) {
        console.error("[drilldown] GET /api/pipeline/drilldown:", err.message);
        res.status(500).json({ message: err.message });
      }
    },
  );
}
