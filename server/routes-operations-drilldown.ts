// ── Operations Drilldown Routes — Phase 3 Universal Drilldowns ────────────────
// GET /api/operations/drilldown
// requireAuth — paginated, filtered, safe SQL (no raw metric interpolation)

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

// ── Allowed metric names (whitelist — never interpolated into SQL) ─────────────
const OPERATIONS_METRICS = new Set([
  // Install / Deployments
  "active_installs",
  "overdue_installs",
  "blocked_installs",
  "completed_installs",
  "installs_missing_owner",
  "installs_missing_date",
  "deployments_active",
  "deployments_overdue",
  // Projects
  "active_projects",
  "overdue_projects",
  "projects_due_this_week",
  "completed_projects",
  "projects_missing_owner",
  // Procurement
  "orders_open",
  "orders_overdue",
  "orders_received_this_month",
  "orders_blocked",
  "orders_without_owner",
  "batches_blocked",
  // Support
  "tickets_open",
  "tickets_overdue",
  "tickets_high_priority",
  "tickets_unassigned",
  "tickets_closed_recently",
  // Documents / Assets
  "documents_total",
  "documents_recent",
  "documents_stale",
  "documents_missing_owner",
  // Data Quality
  "dq_missing_email",
  "dq_missing_phone",
  "dq_stale_leads",
  "dq_stale_accounts",
  "dq_missing_owner_opps",
]);

// ── Shared column sets ─────────────────────────────────────────────────────────
const INSTALL_COLS = [
  { key: "install_title", label: "Workflow" },
  { key: "status",        label: "Status" },
  { key: "owner_name",    label: "Owner" },
  { key: "account_name",  label: "Account" },
  { key: "target_date",   label: "Target Date" },
  { key: "milestone_progress", label: "Progress" },
];

const PROJECT_COLS = [
  { key: "project_name", label: "Project" },
  { key: "status",       label: "Status" },
  { key: "owner_name",   label: "Owner" },
  { key: "account_name", label: "Account" },
  { key: "end_date",     label: "End Date" },
  { key: "type",         label: "Type" },
];

const ORDER_COLS = [
  { key: "po_number",     label: "PO Number" },
  { key: "status",        label: "Status" },
  { key: "supplier_name", label: "Supplier" },
  { key: "owner_name",    label: "Owner" },
  { key: "expected_delivery_date", label: "Expected Delivery" },
  { key: "total_amount",  label: "Value" },
];

const TICKET_COLS = [
  { key: "ticket_number",   label: "#" },
  { key: "subject",         label: "Subject" },
  { key: "status",          label: "Status" },
  { key: "priority",        label: "Priority" },
  { key: "requester_name",  label: "Requester" },
  { key: "assigned_name",   label: "Assignee" },
  { key: "sla_due_at",      label: "SLA Due" },
];

const ASSET_COLS = [
  { key: "asset_name",   label: "Name" },
  { key: "category",     label: "Category" },
  { key: "uploader",     label: "Uploaded By" },
  { key: "file_size_kb", label: "Size" },
  { key: "created_at",   label: "Added" },
];

export function registerOperationsDrilldownRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: (section: string, level: string) => any,
) {
  // Broad gate: any user with CRM view can read operational metrics.
  // Data-quality (dq_*) metrics are admin-only — checked inside the handler.
  app.get(
    "/api/operations/drilldown",
    requireAuth,
    requirePermission("crm", "view"),
    async (req: any, res) => {
      try {
        const metric   = String(req.query.metric   ?? "");
        const search   = String(req.query.search   ?? "");
        const page     = Math.max(1, safeInt(req.query.page, PAGE_DEFAULT));
        const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, safeInt(req.query.page_size, PAGE_SIZE_DEFAULT)));
        const offset   = (page - 1) * pageSize;

        const ownerId   = safeInt(req.query.owner_id, 0);
        const accountId = safeInt(req.query.account_id, 0);
        const dateFrom  = req.query.date_from ? String(req.query.date_from).slice(0, 20) : null;
        const dateTo    = req.query.date_to   ? String(req.query.date_to).slice(0, 20) : null;

        if (!OPERATIONS_METRICS.has(metric)) {
          return res.status(400).json({ error: `Unknown metric: ${metric}` });
        }
        // Data-quality metrics expose system-wide record hygiene — admin only.
        if (metric.startsWith("dq_") && !req.user?.isAdmin && req.user?.role !== "admin" && req.user?.role !== "master_admin") {
          return res.status(403).json({ message: "Admin access required for data quality metrics" });
        }

        // ── Install / Deployment metrics ───────────────────────────────────────
        if (metric === "active_installs" || metric === "overdue_installs" || metric === "blocked_installs" || metric === "completed_installs" || metric === "installs_missing_owner" || metric === "installs_missing_date") {
          const whereParts: string[] = [];

          if (metric === "active_installs")        whereParts.push(`iw.status IN ('pending_kickoff','in_progress')`);
          else if (metric === "overdue_installs")  whereParts.push(`iw.status NOT IN ('complete','cancelled') AND iw.target_completion_date < NOW()`);
          else if (metric === "blocked_installs")  whereParts.push(`iw.blockers IS NOT NULL AND iw.blockers != '' AND iw.status NOT IN ('complete','cancelled')`);
          else if (metric === "completed_installs") whereParts.push(`iw.status = 'complete'`);
          else if (metric === "installs_missing_owner") whereParts.push(`iw.owner_user_id IS NULL AND iw.status NOT IN ('complete','cancelled')`);
          else if (metric === "installs_missing_date")  whereParts.push(`iw.target_completion_date IS NULL AND iw.status NOT IN ('complete','cancelled')`);

          if (ownerId > 0)   whereParts.push(`iw.owner_user_id = ${ownerId}`);
          if (accountId > 0) whereParts.push(`iw.account_id = ${accountId}`);
          if (dateFrom)      whereParts.push(`iw.created_at >= '${dateFrom}'`);
          if (dateTo)        whereParts.push(`iw.created_at <= '${dateTo}'`);

          const sc = searchClause(search, ["iw.title", "a.name", "iw.customer_name"]);

          const whereSQL = whereParts.length > 0
            ? `WHERE ${whereParts.join(" AND ")} ${sc}`
            : sc ? `WHERE 1=1 ${sc}` : "";

          const countRes = await db.execute(sql.raw(`
            SELECT COUNT(*)::int AS cnt
            FROM install_workflows iw
            LEFT JOIN accounts a ON a.id = iw.account_id
            ${whereSQL}
          `));
          const total = (countRes.rows[0] as any)?.cnt ?? 0;

          const rowRes = await db.execute(sql.raw(`
            SELECT
              iw.id                         AS install_id,
              iw.title                      AS install_title,
              iw.status,
              iw.target_completion_date     AS target_date,
              iw.blockers,
              u.name                        AS owner_name,
              a.name                        AS account_name,
              CONCAT(
                (SELECT COUNT(*)::int FROM install_milestones im2 WHERE im2.workflow_id = iw.id AND im2.status = 'complete'),
                '/',
                (SELECT COUNT(*)::int FROM install_milestones im3 WHERE im3.workflow_id = iw.id)
              )                             AS milestone_progress
            FROM install_workflows iw
            LEFT JOIN users u ON u.id = iw.owner_user_id
            LEFT JOIN accounts a ON a.id = iw.account_id
            ${whereSQL}
            ORDER BY iw.updated_at DESC
            LIMIT ${pageSize} OFFSET ${offset}
          `));

          const LABELS: Record<string, string> = {
            active_installs: "Active Install Workflows",
            overdue_installs: "Overdue Install Workflows",
            blocked_installs: "Blocked Install Workflows",
            completed_installs: "Completed Install Workflows",
            installs_missing_owner: "Installs Without Owner",
            installs_missing_date: "Installs Without Target Date",
          };
          const DESCS: Record<string, string> = {
            active_installs: "Install workflows currently in progress or awaiting kickoff.",
            overdue_installs: "Install workflows past their target completion date.",
            blocked_installs: "Install workflows with active blockers noted.",
            completed_installs: "Successfully completed install workflows.",
            installs_missing_owner: "Active install workflows not assigned to an owner.",
            installs_missing_date: "Active install workflows without a target completion date.",
          };
          const EMPTY: Record<string, string> = {
            active_installs: "No active install workflows. All workflows are either complete or cancelled.",
            overdue_installs: "No overdue installs. Every install is on schedule.",
            blocked_installs: "No blocked installs. The machines are not on fire.",
            installs_missing_owner: "Every active install has an owner assigned.",
            installs_missing_date: "Every active install has a target date set.",
          };

          return res.json(buildPaginatedResponse(metric, LABELS[metric], DESCS[metric], INSTALL_COLS, rowRes.rows, total, page, pageSize, EMPTY[metric]));
        }

        // ── Deployment metrics ─────────────────────────────────────────────────
        if (metric === "deployments_active" || metric === "deployments_overdue") {
          const DEPLOY_COLS = [
            { key: "deploy_number", label: "#" },
            { key: "site_name",     label: "Site" },
            { key: "status",        label: "Status" },
            { key: "owner_name",    label: "Owner" },
            { key: "account_name",  label: "Account" },
            { key: "target_go_live",label: "Target Go-Live" },
          ];

          const whereParts: string[] = [];
          if (metric === "deployments_active")  whereParts.push(`d.status IN ('planned','in_progress','commissioning')`);
          if (metric === "deployments_overdue") whereParts.push(`d.status NOT IN ('live','cancelled') AND d.target_go_live < NOW()`);
          if (ownerId > 0)   whereParts.push(`d.owner_user_id = ${ownerId}`);
          if (accountId > 0) whereParts.push(`d.account_id = ${accountId}`);

          const sc = searchClause(search, ["d.site_name", "d.deploy_number", "a.name"]);
          const whereSQL = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")} ${sc}` : sc ? `WHERE 1=1 ${sc}` : "";

          const countRes = await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM deployments d LEFT JOIN accounts a ON a.id = d.account_id ${whereSQL}`));
          const total = (countRes.rows[0] as any)?.cnt ?? 0;

          const rowRes = await db.execute(sql.raw(`
            SELECT d.id AS deploy_id, d.deploy_number, d.site_name, d.status, d.target_go_live,
                   u.name AS owner_name, a.name AS account_name
            FROM deployments d
            LEFT JOIN users u ON u.id = d.owner_user_id
            LEFT JOIN accounts a ON a.id = d.account_id
            ${whereSQL}
            ORDER BY d.updated_at DESC
            LIMIT ${pageSize} OFFSET ${offset}
          `));

          const LABELS: Record<string,string> = { deployments_active: "Active Deployments", deployments_overdue: "Overdue Deployments" };
          const DESCS: Record<string,string> = {
            deployments_active: "Site deployments currently planned or in progress.",
            deployments_overdue: "Deployments past their target go-live date.",
          };
          const EMPTY: Record<string,string> = {
            deployments_overdue: "No overdue deployments. Every site is on track.",
          };
          return res.json(buildPaginatedResponse(metric, LABELS[metric], DESCS[metric], DEPLOY_COLS, rowRes.rows, total, page, pageSize, EMPTY[metric]));
        }

        // ── Project metrics ────────────────────────────────────────────────────
        if (["active_projects","overdue_projects","projects_due_this_week","completed_projects","projects_missing_owner"].includes(metric)) {
          const whereParts: string[] = [];

          if (metric === "active_projects")         whereParts.push(`p.status = 'active'`);
          else if (metric === "overdue_projects")   whereParts.push(`p.status NOT IN ('completed','cancelled') AND p.end_date < NOW()`);
          else if (metric === "projects_due_this_week") whereParts.push(`p.status NOT IN ('completed','cancelled') AND p.end_date BETWEEN NOW() AND (NOW() + INTERVAL '7 days')`);
          else if (metric === "completed_projects") whereParts.push(`p.status = 'completed'`);
          else if (metric === "projects_missing_owner") whereParts.push(`p.owner_user_id IS NULL AND p.status NOT IN ('completed','cancelled')`);

          if (ownerId > 0)   whereParts.push(`p.owner_user_id = ${ownerId}`);
          if (accountId > 0) whereParts.push(`p.account_id = ${accountId}`);

          const sc = searchClause(search, ["p.name", "p.description", "a.name"]);
          const whereSQL = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")} ${sc}` : sc ? `WHERE 1=1 ${sc}` : "";

          const countRes = await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM projects p LEFT JOIN accounts a ON a.id = p.account_id ${whereSQL}`));
          const total = (countRes.rows[0] as any)?.cnt ?? 0;

          const rowRes = await db.execute(sql.raw(`
            SELECT p.id AS project_id, p.name AS project_name, p.status, p.type, p.end_date,
                   u.name AS owner_name, a.name AS account_name
            FROM projects p
            LEFT JOIN users u ON u.id = p.owner_user_id
            LEFT JOIN accounts a ON a.id = p.account_id
            ${whereSQL}
            ORDER BY p.updated_at DESC
            LIMIT ${pageSize} OFFSET ${offset}
          `));

          const LABELS: Record<string,string> = {
            active_projects: "Active Projects", overdue_projects: "Overdue Projects",
            projects_due_this_week: "Projects Due This Week", completed_projects: "Completed Projects",
            projects_missing_owner: "Projects Without Owner",
          };
          const DESCS: Record<string,string> = {
            active_projects: "All projects currently in active status.",
            overdue_projects: "Projects past their scheduled end date.",
            projects_due_this_week: "Projects with an end date in the next 7 days.",
            completed_projects: "Projects marked as completed.",
            projects_missing_owner: "Active projects without an assigned owner.",
          };
          const EMPTY: Record<string,string> = {
            overdue_projects: "No overdue projects. All projects are on schedule.",
            projects_missing_owner: "Every active project has an owner assigned.",
          };
          return res.json(buildPaginatedResponse(metric, LABELS[metric], DESCS[metric], PROJECT_COLS, rowRes.rows, total, page, pageSize, EMPTY[metric]));
        }

        // ── Procurement metrics ────────────────────────────────────────────────
        if (["orders_open","orders_overdue","orders_received_this_month","orders_blocked","orders_without_owner","batches_blocked"].includes(metric)) {
          if (metric === "batches_blocked") {
            const BATCH_COLS = [
              { key: "batch_number",  label: "Batch #" },
              { key: "part_name",     label: "Part" },
              { key: "status",        label: "Status" },
              { key: "quantity",      label: "Qty" },
              { key: "owner_name",    label: "Owner" },
              { key: "blockers",      label: "Blocker" },
              { key: "target_completion_date", label: "Target" },
            ];
            const sc = searchClause(search, ["pb.batch_number", "pb.part_name", "u.name"]);
            const whereSQL = `WHERE pb.blockers IS NOT NULL AND pb.blockers != '' AND pb.status NOT IN ('completed','cancelled') ${sc}`;
            const countRes = await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM production_batches pb LEFT JOIN users u ON u.id = pb.owner_user_id ${whereSQL}`));
            const total = (countRes.rows[0] as any)?.cnt ?? 0;
            const rowRes = await db.execute(sql.raw(`
              SELECT pb.id, pb.batch_number, pb.part_name, pb.status, pb.quantity, pb.blockers, pb.target_completion_date,
                     u.name AS owner_name
              FROM production_batches pb LEFT JOIN users u ON u.id = pb.owner_user_id
              ${whereSQL}
              ORDER BY pb.updated_at DESC LIMIT ${pageSize} OFFSET ${offset}
            `));
            return res.json(buildPaginatedResponse(metric, "Blocked Production Batches", "Production batches with active blockers.", BATCH_COLS, rowRes.rows, total, page, pageSize, "No blocked production batches. Manufacturing is running smoothly."));
          }

          const whereParts: string[] = [];
          if (metric === "orders_open")                whereParts.push(`po.status IN ('draft','issued','partially_received')`);
          else if (metric === "orders_overdue")        whereParts.push(`po.status NOT IN ('received','cancelled') AND po.expected_delivery_date < NOW()`);
          else if (metric === "orders_received_this_month") whereParts.push(`po.status = 'received' AND po.actual_delivery_date >= DATE_TRUNC('month', NOW())`);
          else if (metric === "orders_blocked")        whereParts.push(`po.blockers IS NOT NULL AND po.blockers != '' AND po.status NOT IN ('received','cancelled')`);
          else if (metric === "orders_without_owner")  whereParts.push(`po.owner_user_id IS NULL AND po.status NOT IN ('received','cancelled')`);

          if (ownerId > 0)   whereParts.push(`po.owner_user_id = ${ownerId}`);
          if (accountId > 0) whereParts.push(`po.account_id = ${accountId}`);

          const sc = searchClause(search, ["po.po_number", "s.name", "a.name"]);
          const whereSQL = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")} ${sc}` : sc ? `WHERE 1=1 ${sc}` : "";

          const countRes = await db.execute(sql.raw(`
            SELECT COUNT(*)::int AS cnt
            FROM purchase_orders po
            LEFT JOIN suppliers s ON s.id = po.supplier_id
            LEFT JOIN accounts a ON a.id = po.account_id
            ${whereSQL}
          `));
          const total = (countRes.rows[0] as any)?.cnt ?? 0;

          const rowRes = await db.execute(sql.raw(`
            SELECT po.id, po.po_number, po.status, po.expected_delivery_date, po.total_amount, po.currency, po.blockers,
                   s.name AS supplier_name, u.name AS owner_name, a.name AS account_name
            FROM purchase_orders po
            LEFT JOIN suppliers s ON s.id = po.supplier_id
            LEFT JOIN users u ON u.id = po.owner_user_id
            LEFT JOIN accounts a ON a.id = po.account_id
            ${whereSQL}
            ORDER BY po.updated_at DESC LIMIT ${pageSize} OFFSET ${offset}
          `));

          const LABELS: Record<string,string> = {
            orders_open: "Open Purchase Orders", orders_overdue: "Overdue Purchase Orders",
            orders_received_this_month: "Orders Received This Month", orders_blocked: "Blocked Purchase Orders",
            orders_without_owner: "Orders Without Owner",
          };
          const DESCS: Record<string,string> = {
            orders_open: "Purchase orders in draft, issued, or partially received status.",
            orders_overdue: "Purchase orders past their expected delivery date.",
            orders_received_this_month: "Purchase orders received during the current calendar month.",
            orders_blocked: "Purchase orders with an active blocker noted.",
            orders_without_owner: "Open purchase orders without an assigned owner.",
          };
          const EMPTY: Record<string,string> = {
            orders_overdue: "No overdue purchase orders. All deliveries are on schedule.",
            orders_blocked: "No blocked purchase orders. Procurement is running smoothly.",
          };
          return res.json(buildPaginatedResponse(metric, LABELS[metric], DESCS[metric], ORDER_COLS, rowRes.rows, total, page, pageSize, EMPTY[metric]));
        }

        // ── Support / Ticket metrics ───────────────────────────────────────────
        if (["tickets_open","tickets_overdue","tickets_high_priority","tickets_unassigned","tickets_closed_recently"].includes(metric)) {
          const whereParts: string[] = [];

          if (metric === "tickets_open")            whereParts.push(`t.status IN ('new','open','in_progress')`);
          else if (metric === "tickets_overdue")    whereParts.push(`t.status NOT IN ('resolved','closed','cancelled') AND t.sla_due_at < NOW()`);
          else if (metric === "tickets_high_priority") whereParts.push(`t.priority IN ('high','urgent') AND t.status IN ('new','open','in_progress')`);
          else if (metric === "tickets_unassigned") whereParts.push(`t.assigned_to_user_id IS NULL AND t.status IN ('new','open','in_progress')`);
          else if (metric === "tickets_closed_recently") whereParts.push(`t.status IN ('resolved','closed') AND t.updated_at > NOW() - INTERVAL '7 days'`);

          if (accountId > 0) whereParts.push(`t.account_id = ${accountId}`);
          if (dateFrom)      whereParts.push(`t.created_at >= '${dateFrom}'`);
          if (dateTo)        whereParts.push(`t.created_at <= '${dateTo}'`);

          const sc = searchClause(search, ["t.subject", "t.requester_name", "t.ticket_number"]);
          const whereSQL = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")} ${sc}` : sc ? `WHERE 1=1 ${sc}` : "";

          const countRes = await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM tickets t ${whereSQL}`));
          const total = (countRes.rows[0] as any)?.cnt ?? 0;

          const rowRes = await db.execute(sql.raw(`
            SELECT t.id AS ticket_id, t.ticket_number, t.subject, t.status, t.priority, t.severity,
                   t.requester_name, t.sla_due_at,
                   u.name AS assigned_name
            FROM tickets t
            LEFT JOIN users u ON u.id = t.assigned_to_user_id
            ${whereSQL}
            ORDER BY t.updated_at DESC LIMIT ${pageSize} OFFSET ${offset}
          `));

          const LABELS: Record<string,string> = {
            tickets_open: "Open Support Tickets", tickets_overdue: "Overdue Tickets (SLA Breached)",
            tickets_high_priority: "High-Priority Open Tickets", tickets_unassigned: "Unassigned Open Tickets",
            tickets_closed_recently: "Recently Closed Tickets",
          };
          const DESCS: Record<string,string> = {
            tickets_open: "Tickets currently in new, open, or in-progress status.",
            tickets_overdue: "Tickets where the SLA due date has passed.",
            tickets_high_priority: "High and urgent priority tickets that are still open.",
            tickets_unassigned: "Open tickets without an assigned team member.",
            tickets_closed_recently: "Tickets resolved or closed in the last 7 days.",
          };
          const EMPTY: Record<string,string> = {
            tickets_open: "No open tickets. The queue is empty.",
            tickets_overdue: "No SLA breaches. All tickets are within their SLA.",
            tickets_unassigned: "Every open ticket has an assignee.",
          };
          return res.json(buildPaginatedResponse(metric, LABELS[metric], DESCS[metric], TICKET_COLS, rowRes.rows, total, page, pageSize, EMPTY[metric]));
        }

        // ── Document / Asset metrics ───────────────────────────────────────────
        if (["documents_total","documents_recent","documents_stale","documents_missing_owner"].includes(metric)) {
          const whereParts: string[] = [];

          if (metric === "documents_recent")        whereParts.push(`a.created_at > NOW() - INTERVAL '30 days'`);
          else if (metric === "documents_stale")    whereParts.push(`a.created_at < NOW() - INTERVAL '180 days'`);
          else if (metric === "documents_missing_owner") whereParts.push(`a.uploaded_by IS NULL`);

          const sc = searchClause(search, ["a.name", "a.original_name", "a.category"]);
          const whereSQL = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")} ${sc}` : sc ? `WHERE 1=1 ${sc}` : "";

          const countRes = await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM assets a ${whereSQL}`));
          const total = (countRes.rows[0] as any)?.cnt ?? 0;

          const rowRes = await db.execute(sql.raw(`
            SELECT a.id, a.name AS asset_name, a.original_name, a.category,
                   ROUND(a.size::numeric / 1024, 1)::text || ' KB' AS file_size_kb,
                   a.created_at,
                   u.name AS uploader
            FROM assets a
            LEFT JOIN users u ON u.id = a.uploaded_by
            ${whereSQL}
            ORDER BY a.created_at DESC LIMIT ${pageSize} OFFSET ${offset}
          `));

          const LABELS: Record<string,string> = {
            documents_total: "All Documents & Assets", documents_recent: "Recently Added Documents",
            documents_stale: "Stale Documents (6+ months old)", documents_missing_owner: "Documents Without Owner",
          };
          const DESCS: Record<string,string> = {
            documents_total: "All documents and assets in the Document Hub.",
            documents_recent: "Documents and assets added in the last 30 days.",
            documents_stale: "Documents and assets not updated in over 6 months.",
            documents_missing_owner: "Documents with no uploader recorded.",
          };
          const EMPTY: Record<string,string> = {
            documents_total: "No documents found in the Document Hub yet.",
            documents_stale: "No stale documents. The Document Hub is current.",
            documents_missing_owner: "Every document has an owner recorded.",
          };
          return res.json(buildPaginatedResponse(metric, LABELS[metric], DESCS[metric], ASSET_COLS, rowRes.rows, total, page, pageSize, EMPTY[metric]));
        }

        // ── Data Quality metrics ───────────────────────────────────────────────
        if (["dq_missing_email","dq_missing_phone","dq_stale_leads","dq_stale_accounts","dq_missing_owner_opps"].includes(metric)) {
          if (metric === "dq_missing_email") {
            const CONTACT_COLS = [
              { key: "full_name",    label: "Name" },
              { key: "record_type",  label: "Type" },
              { key: "account_name", label: "Account" },
              { key: "created_at",   label: "Created" },
            ];
            const sc = searchClause(search, ["c.first_name", "c.last_name", "a.name"]);
            const countRes = await db.execute(sql.raw(`
              SELECT COUNT(*)::int AS cnt FROM contacts c
              LEFT JOIN accounts a ON a.id = c.account_id
              WHERE (c.email IS NULL OR c.email = '') ${sc}
            `));
            const total = (countRes.rows[0] as any)?.cnt ?? 0;
            const rowRes = await db.execute(sql.raw(`
              SELECT c.id AS contact_id, CONCAT(c.first_name, ' ', c.last_name) AS full_name,
                     'Contact' AS record_type, a.name AS account_name, c.created_at
              FROM contacts c
              LEFT JOIN accounts a ON a.id = c.account_id
              WHERE (c.email IS NULL OR c.email = '') ${sc}
              ORDER BY c.created_at DESC LIMIT ${pageSize} OFFSET ${offset}
            `));
            return res.json(buildPaginatedResponse(metric, "Contacts Missing Email", "Contacts without an email address on file.", CONTACT_COLS, rowRes.rows, total, page, pageSize, "Every contact has an email address. Great data hygiene."));
          }

          if (metric === "dq_missing_phone") {
            const CONTACT_COLS = [
              { key: "full_name",    label: "Name" },
              { key: "account_name", label: "Account" },
              { key: "created_at",   label: "Created" },
            ];
            const sc = searchClause(search, ["c.first_name", "c.last_name", "a.name"]);
            const countRes = await db.execute(sql.raw(`
              SELECT COUNT(*)::int AS cnt FROM contacts c
              LEFT JOIN accounts a ON a.id = c.account_id
              WHERE (c.phone IS NULL OR c.phone = '') ${sc}
            `));
            const total = (countRes.rows[0] as any)?.cnt ?? 0;
            const rowRes = await db.execute(sql.raw(`
              SELECT c.id AS contact_id, CONCAT(c.first_name, ' ', c.last_name) AS full_name,
                     a.name AS account_name, c.created_at
              FROM contacts c
              LEFT JOIN accounts a ON a.id = c.account_id
              WHERE (c.phone IS NULL OR c.phone = '') ${sc}
              ORDER BY c.created_at DESC LIMIT ${pageSize} OFFSET ${offset}
            `));
            return res.json(buildPaginatedResponse(metric, "Contacts Missing Phone", "Contacts without a phone number on file.", CONTACT_COLS, rowRes.rows, total, page, pageSize, "Every contact has a phone number. Great data hygiene."));
          }

          if (metric === "dq_stale_leads") {
            const LEAD_COLS = [
              { key: "company",     label: "Company" },
              { key: "status",      label: "Status" },
              { key: "owner_name",  label: "Owner" },
              { key: "last_updated", label: "Last Updated" },
              { key: "deal_value",  label: "Value" },
            ];
            const sc = searchClause(search, ["l.company", "l.contact_name", "u.name"]);
            const countRes = await db.execute(sql.raw(`
              SELECT COUNT(*)::int AS cnt FROM leads l LEFT JOIN users u ON u.id = l.owner_user_id
              WHERE l.updated_at < NOW() - INTERVAL '90 days' AND l.status NOT IN ('closed_won','closed_lost','disqualified') ${sc}
            `));
            const total = (countRes.rows[0] as any)?.cnt ?? 0;
            const rowRes = await db.execute(sql.raw(`
              SELECT l.id AS lead_id, l.company, l.status, l.deal_value, l.updated_at AS last_updated,
                     u.name AS owner_name
              FROM leads l LEFT JOIN users u ON u.id = l.owner_user_id
              WHERE l.updated_at < NOW() - INTERVAL '90 days' AND l.status NOT IN ('closed_won','closed_lost','disqualified') ${sc}
              ORDER BY l.updated_at ASC LIMIT ${pageSize} OFFSET ${offset}
            `));
            return res.json(buildPaginatedResponse(metric, "Stale Leads (90+ days)", "Active leads with no activity in over 90 days.", LEAD_COLS, rowRes.rows, total, page, pageSize, "No stale leads. Your pipeline is active and well-tended."));
          }

          if (metric === "dq_stale_accounts") {
            const ACCT_COLS = [
              { key: "account_name", label: "Account" },
              { key: "status",       label: "Status" },
              { key: "owner_name",   label: "Owner" },
              { key: "last_updated", label: "Last Updated" },
            ];
            const sc = searchClause(search, ["a.name", "u.name"]);
            const countRes = await db.execute(sql.raw(`
              SELECT COUNT(*)::int AS cnt FROM accounts a LEFT JOIN users u ON u.id = a.owner_user_id
              WHERE a.updated_at < NOW() - INTERVAL '180 days' ${sc}
            `));
            const total = (countRes.rows[0] as any)?.cnt ?? 0;
            const rowRes = await db.execute(sql.raw(`
              SELECT a.id AS account_id, a.name AS account_name, a.status, a.updated_at AS last_updated,
                     u.name AS owner_name
              FROM accounts a LEFT JOIN users u ON u.id = a.owner_user_id
              WHERE a.updated_at < NOW() - INTERVAL '180 days' ${sc}
              ORDER BY a.updated_at ASC LIMIT ${pageSize} OFFSET ${offset}
            `));
            return res.json(buildPaginatedResponse(metric, "Stale Accounts (6+ months)", "Accounts with no recorded activity in over 6 months.", ACCT_COLS, rowRes.rows, total, page, pageSize, "No stale accounts. All accounts are recently active."));
          }

          if (metric === "dq_missing_owner_opps") {
            const OPP_COLS = [
              { key: "company",     label: "Company" },
              { key: "title",       label: "Opportunity" },
              { key: "status",      label: "Stage" },
              { key: "deal_value",  label: "Value" },
              { key: "created_at",  label: "Created" },
            ];
            const sc = searchClause(search, ["l.company", "l.contact_name"]);
            const countRes = await db.execute(sql.raw(`
              SELECT COUNT(*)::int AS cnt FROM leads l
              WHERE l.owner_user_id IS NULL AND l.status NOT IN ('closed_won','closed_lost','disqualified') ${sc}
            `));
            const total = (countRes.rows[0] as any)?.cnt ?? 0;
            const rowRes = await db.execute(sql.raw(`
              SELECT l.id AS lead_id, l.company, l.contact_name AS title, l.status, l.deal_value, l.created_at
              FROM leads l
              WHERE l.owner_user_id IS NULL AND l.status NOT IN ('closed_won','closed_lost','disqualified') ${sc}
              ORDER BY l.created_at DESC LIMIT ${pageSize} OFFSET ${offset}
            `));
            return res.json(buildPaginatedResponse(metric, "Opportunities Without Owner", "Active opportunities not assigned to any owner.", OPP_COLS, rowRes.rows, total, page, pageSize, "Every opportunity has an owner. Great pipeline hygiene."));
          }
        }

        // Should not reach here — whitelist check above covers all metrics
        return res.status(400).json({ error: `Metric not implemented: ${metric}` });
      } catch (err: any) {
        console.error("[operations-drilldown] error:", err.message);
        return res.status(500).json({ error: "Internal server error" });
      }
    },
  );
}
