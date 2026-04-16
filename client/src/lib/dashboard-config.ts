export type CenterType = "ceo" | "cfo" | "cto" | "cmo" | "sales" | "cs" | "default";
export type LayoutMode = "expanded" | "compact";
export type AccessLevel = "none" | "view" | "edit";

export type UserProfile = {
  globalRole: string;
  department?: string | null;
  jobTitle?: string | null;
  userType?: string | null;
  permissions?: Record<string, any>;
  defaultCommandCenter?: string | null;
  preferredLayout?: string;
  widgetVisibility?: Record<string, boolean | any>;
  name?: string;
};

// ── Widget visibility rules ──────────────────────────────────────────────────
// Widgets can declare gating rules across five axes:
//   1. permKey       — a module permission key ("crm","quoting","support",...)
//   2. minAccessLevel — "view" (default) or "edit"
//   3. allowedGlobalRoles — app roles allowed to see the widget
//   4. allowedUserTypes   — "internal" / "external"
//   5. managerOnly       — restrict to admin / master_admin / manager roles
//   6. jobTitleIncludes / departmentIncludes — soft keyword relevance filters
//
// master_admin and admin bypass every rule.
export type WidgetVisibilityRule = {
  permKey?: string;
  minAccessLevel?: "view" | "edit";
  allowedGlobalRoles?: string[];
  allowedUserTypes?: string[];
  managerOnly?: boolean;
  jobTitleIncludes?: string[];
  departmentIncludes?: string[];
};

export type WidgetDef = {
  id: string;
  label: string;
  description: string;
  defaultVisible: boolean;
  category?: "action" | "risk" | "revenue" | "team" | "pipeline" | "classic";
  isNew?: boolean;
  visibility?: WidgetVisibilityRule;
};

export type DashboardConfig = {
  centerType: CenterType;
  centerLabel: string;
  accentColor: string;
  layoutMode: LayoutMode;
  widgets: WidgetDef[];
  visibleWidgets: Record<string, boolean>;
  widgetOrder: string[];
};

// ── Widget library ───────────────────────────────────────────────────────────

const NEW_WIDGETS: Record<string, WidgetDef> = {
  today_critical_actions: {
    id: "today_critical_actions", label: "Today's Critical Actions",
    description: "High/urgent tasks due today or overdue — your must-do list",
    defaultVisible: true, category: "action", isNew: true,
    visibility: { permKey: "crm", minAccessLevel: "view" },
  },
  inbox_priority_radar: {
    id: "inbox_priority_radar", label: "Inbox Priority Radar",
    description: "Email threads awaiting your reply, ranked by wait time",
    defaultVisible: true, category: "action", isNew: true,
  },
  cert_watchtower: {
    id: "cert_watchtower", label: "Certification Watchtower",
    description: "Live alerts from test-tracker: failed tests, blockers, cert risk",
    defaultVisible: true, category: "risk", isNew: true,
    visibility: { permKey: "projects", minAccessLevel: "view" },
  },
  deployment_pulse: {
    id: "deployment_pulse", label: "Deployment Pulse",
    description: "Install workflows at risk and deployment blockers at a glance",
    defaultVisible: true, category: "risk", isNew: true,
    visibility: { permKey: "projects", minAccessLevel: "view" },
  },
  cash_pulse: {
    id: "cash_pulse", label: "Cash Pulse",
    description: "MRR, ARR, hardware revenue and forecast vs target in one view",
    defaultVisible: true, category: "revenue", isNew: true,
    visibility: {
      permKey: "crm", minAccessLevel: "view", managerOnly: true,
      departmentIncludes: ["finance", "accounting", "executive", "operations", "revenue"],
    },
  },
  team_load_balancer: {
    id: "team_load_balancer", label: "Team Load Balancer",
    description: "Open and overdue task counts per team member to spot burnout",
    defaultVisible: true, category: "team", isNew: true,
    visibility: { permKey: "team_workload", minAccessLevel: "view", managerOnly: true },
  },
  my_waiting_on: {
    id: "my_waiting_on", label: "My Waiting On",
    description: "Tasks and emails where you're waiting on someone else to act",
    defaultVisible: true, category: "action", isNew: true,
    visibility: { permKey: "crm", minAccessLevel: "view" },
  },
  ai_suggested_moves: {
    id: "ai_suggested_moves", label: "AI Suggested Moves",
    description: "AI-generated next-best-actions across your pipeline and accounts",
    defaultVisible: true, category: "action", isNew: true,
    visibility: { permKey: "crm", minAccessLevel: "view" },
  },
  quick_create_launcher: {
    id: "quick_create_launcher", label: "Quick Create Launcher",
    description: "One-click shortcuts: add task, log call, create lead or quote",
    defaultVisible: true, category: "action", isNew: true,
    visibility: { permKey: "crm", minAccessLevel: "edit" },
  },
  board_pack_readiness: {
    id: "board_pack_readiness", label: "Board Pack Readiness",
    description: "Executive readiness score: pipeline, revenue, tasks, leads",
    defaultVisible: true, category: "risk", isNew: true,
    visibility: {
      permKey: "crm", minAccessLevel: "view", managerOnly: true,
      jobTitleIncludes: ["ceo", "cfo", "chief", "vp", "director", "head", "president", "founder"],
    },
  },
  open_quotes_aging: {
    id: "open_quotes_aging", label: "Open Quotes Aging",
    description: "Sent quotes awaiting response beyond the follow-up threshold",
    defaultVisible: false, category: "pipeline", isNew: true,
    visibility: { permKey: "quoting", minAccessLevel: "view" },
  },
  pipeline_funnel: {
    id: "pipeline_funnel", label: "Pipeline Stage Funnel",
    description: "Opportunity count and value by stage — visual funnel snapshot",
    defaultVisible: false, category: "pipeline", isNew: true,
    visibility: { permKey: "crm", minAccessLevel: "view" },
  },
  recent_wins: {
    id: "recent_wins", label: "Recent Wins",
    description: "Deals closed won in the last 30 days with revenue totals",
    defaultVisible: false, category: "revenue", isNew: true,
    visibility: { permKey: "crm", minAccessLevel: "view" },
  },
  top_performers: {
    id: "top_performers", label: "Top Performers",
    description: "Team members ranked by completed tasks this month",
    defaultVisible: false, category: "team", isNew: true,
    visibility: { permKey: "team_workload", minAccessLevel: "view", managerOnly: true },
  },
  cert_status_summary: {
    id: "cert_status_summary", label: "Certification Status Summary",
    description: "Active certification projects: status, blockers, risk overview",
    defaultVisible: false, category: "risk", isNew: true,
    visibility: { permKey: "projects", minAccessLevel: "view" },
  },
  deal_velocity: {
    id: "deal_velocity", label: "Deal Velocity Tracker",
    description: "Pipeline throughput: stalled opps, avg close time, stage gaps",
    defaultVisible: false, category: "pipeline", isNew: true,
    visibility: { permKey: "crm", minAccessLevel: "view", managerOnly: true },
  },
  unresponded_leads: {
    id: "unresponded_leads", label: "Unresponded Leads",
    description: "New leads sitting uncontacted for more than 3 days",
    defaultVisible: false, category: "pipeline", isNew: true,
    visibility: { permKey: "crm", minAccessLevel: "view" },
  },
  renewal_countdown: {
    id: "renewal_countdown", label: "Renewal Countdown",
    description: "Upcoming account renewals by date with ARR at stake",
    defaultVisible: false, category: "revenue", isNew: true,
    visibility: { permKey: "crm", minAccessLevel: "view" },
  },
  forecast_gap: {
    id: "forecast_gap", label: "Revenue Forecast Gap",
    description: "Pipeline weighted value vs monthly/quarterly revenue target",
    defaultVisible: false, category: "revenue", isNew: true,
    visibility: {
      permKey: "crm", minAccessLevel: "view", managerOnly: true,
      departmentIncludes: ["finance", "sales", "executive", "revenue", "growth"],
    },
  },
  todays_meetings: {
    id: "todays_meetings", label: "Today's Meetings",
    description: "Calendar events and customer calls happening today",
    defaultVisible: true, category: "action", isNew: true,
    visibility: { permKey: "calendar", minAccessLevel: "view" },
  },
  my_inbox: {
    id: "my_inbox", label: "My Inbox",
    description: "High-level view of your email inbox — click to open Gmail",
    defaultVisible: true, category: "action", isNew: true,
    // No permKey — every user has their own inbox visibility
  },
  team_inboxes: {
    id: "team_inboxes", label: "Team Inboxes",
    description: "Email activity across the team — awaiting replies and recent volume",
    defaultVisible: true, category: "team", isNew: true,
    visibility: { managerOnly: true },
  },
};

// Classic widgets referenced by id inside each center array.
// Adding the rule once here lets every occurrence inherit the gate via resolveClassic().
const CLASSIC_WIDGETS: Record<string, Partial<WidgetDef>> = {
  // CEO classics
  summary_bullets:      { visibility: { permKey: "crm", minAccessLevel: "view" } },
  pipeline_health:      { visibility: { permKey: "crm", minAccessLevel: "view" } },
  revenue_at_risk:      { visibility: { permKey: "crm", minAccessLevel: "view", managerOnly: true } },
  close_opps_score:     { visibility: { permKey: "crm", minAccessLevel: "view" } },
  churn_score:          { visibility: { permKey: "crm", minAccessLevel: "view", managerOnly: true } },
  cert_blockers:        { visibility: { permKey: "projects", minAccessLevel: "view" } },
  deployment_blockers:  { visibility: { permKey: "projects", minAccessLevel: "view" } },
  key_accounts:         { visibility: { permKey: "crm", minAccessLevel: "view" } },
  // CFO classics
  mrr_overview:         { visibility: { permKey: "crm", minAccessLevel: "view", managerOnly: true } },
  hardware_revenue:     { visibility: { permKey: "crm", minAccessLevel: "view", managerOnly: true } },
  pricing_lock_expiries:{ visibility: { permKey: "quoting", minAccessLevel: "view" } },
  renewal_exposure:     { visibility: { permKey: "crm", minAccessLevel: "view", managerOnly: true } },
  churn_risk_financial: { visibility: { permKey: "crm", minAccessLevel: "view", managerOnly: true } },
  billing_anomalies:    { visibility: { permKey: "crm", minAccessLevel: "view", managerOnly: true } },
  forecast_pressure:    { visibility: { permKey: "crm", minAccessLevel: "view", managerOnly: true } },
  // CTO classics
  deployment_risk_score:{ visibility: { permKey: "projects", minAccessLevel: "view" } },
  install_workflows:    { visibility: { permKey: "projects", minAccessLevel: "view" } },
  procurement_blocked:  { visibility: { permKey: "projects", minAccessLevel: "view" } },
  critical_tasks:       { visibility: { permKey: "crm", minAccessLevel: "view" } },
  // CMO classics
  lead_volume:          { visibility: { permKey: "crm", minAccessLevel: "view" } },
  hottest_leads_score:  { visibility: { permKey: "crm", minAccessLevel: "view" } },
  source_attribution:   { visibility: { permKey: "crm", minAccessLevel: "view" } },
  territory_whitespace: { visibility: { permKey: "crm", minAccessLevel: "view" } },
  pipeline_by_source:   { visibility: { permKey: "crm", minAccessLevel: "view" } },
  conversion_by_source: { visibility: { permKey: "crm", minAccessLevel: "view" } },
  // Sales classics
  overdue_tasks:        { visibility: { permKey: "crm", minAccessLevel: "view" } },
  suggested_actions:    { visibility: { permKey: "crm", minAccessLevel: "view" } },
  quote_urgency_score:  { visibility: { permKey: "quoting", minAccessLevel: "view" } },
  accounts_at_risk:     { visibility: { permKey: "crm", minAccessLevel: "view" } },
  stale_deals:          { visibility: { permKey: "crm", minAccessLevel: "view" } },
  inbox_followups:      { visibility: { permKey: "crm", minAccessLevel: "view" } },
  week_priorities:      { visibility: { permKey: "crm", minAccessLevel: "view" } },
  nearby_routes:        { visibility: { permKey: "crm", minAccessLevel: "view" } },
  // CS classics
  health_scores:        { visibility: { permKey: "crm", minAccessLevel: "view" } },
  churn_risk_score:     { visibility: { permKey: "crm", minAccessLevel: "view" } },
  expansion_score:      { visibility: { permKey: "crm", minAccessLevel: "view" } },
};

function applyClassicRule(w: WidgetDef): WidgetDef {
  const extra = CLASSIC_WIDGETS[w.id];
  if (!extra || w.visibility) return w;
  return { ...w, ...extra };
}

// ── Widget definitions per center type ───────────────────────────────────────

// Widgets that make sense for every user regardless of role/department.
const UNIVERSAL_EXTRAS: WidgetDef[] = [
  { ...NEW_WIDGETS.my_inbox,              defaultVisible: true  },
  { ...NEW_WIDGETS.todays_meetings,       defaultVisible: false },
  { ...NEW_WIDGETS.my_waiting_on,         defaultVisible: false },
  { ...NEW_WIDGETS.inbox_priority_radar,  defaultVisible: false },
  { ...NEW_WIDGETS.quick_create_launcher, defaultVisible: false },
];

export const WIDGET_DEFS: Record<CenterType, WidgetDef[]> = {
  ceo: [
    { id: "summary_bullets",      label: "Executive Summary",        description: "AI-generated priority bullets",          defaultVisible: true,  category: "classic" },
    { id: "pipeline_health",      label: "Pipeline Health",          description: "Weighted forecast and stage breakdown",  defaultVisible: true,  category: "classic" },
    { id: "revenue_at_risk",      label: "Revenue at Risk",          description: "CS health and renewal exposure",         defaultVisible: true,  category: "classic" },
    { id: "close_opps_score",     label: "Close-Likelihood Deals",   description: "Top opps ranked by close probability",   defaultVisible: true,  category: "classic" },
    { id: "churn_score",          label: "Churn Risk Signals",       description: "Accounts most at risk of churning",      defaultVisible: true,  category: "classic" },
    { id: "cert_blockers",        label: "Certification Blockers",   description: "Engineering cert issues blocking deals", defaultVisible: false, category: "classic" },
    { id: "deployment_blockers",  label: "Deployment Blockers",      description: "Installs and rollout blocked",           defaultVisible: false, category: "classic" },
    { id: "key_accounts",         label: "Key Accounts Needing Action", description: "High-value accounts with signals",    defaultVisible: true,  category: "classic" },
    { ...NEW_WIDGETS.today_critical_actions, defaultVisible: true  },
    { ...NEW_WIDGETS.board_pack_readiness,   defaultVisible: true  },
    { ...NEW_WIDGETS.cash_pulse,             defaultVisible: true  },
    { ...NEW_WIDGETS.cert_watchtower,        defaultVisible: true  },
    { ...NEW_WIDGETS.deployment_pulse,       defaultVisible: true  },
    { ...NEW_WIDGETS.recent_wins,            defaultVisible: true  },
    { ...NEW_WIDGETS.pipeline_funnel,        defaultVisible: true  },
    { ...NEW_WIDGETS.forecast_gap,           defaultVisible: true  },
    { ...NEW_WIDGETS.my_inbox,               defaultVisible: true  },
    { ...NEW_WIDGETS.team_inboxes,           defaultVisible: true  },
    { ...NEW_WIDGETS.top_performers,         defaultVisible: false },
    { ...NEW_WIDGETS.ai_suggested_moves,     defaultVisible: false },
    { ...NEW_WIDGETS.quick_create_launcher,  defaultVisible: false },
    { ...NEW_WIDGETS.inbox_priority_radar,   defaultVisible: false },
    { ...NEW_WIDGETS.todays_meetings,        defaultVisible: false },
    { ...NEW_WIDGETS.my_waiting_on,          defaultVisible: false },
    { ...NEW_WIDGETS.team_load_balancer,     defaultVisible: false },
  ],
  cfo: [
    { id: "mrr_overview",         label: "MRR Overview",             description: "Current, contracted and deployed MRR",   defaultVisible: true,  category: "classic" },
    { id: "hardware_revenue",     label: "Hardware Revenue",         description: "Contracted vs booked vs delivered",      defaultVisible: true,  category: "classic" },
    { id: "pricing_lock_expiries",label: "Pricing Lock Expiries",    description: "Accounts with expiring pricing locks",   defaultVisible: true,  category: "classic" },
    { id: "renewal_exposure",     label: "Renewal Exposure",         description: "Upcoming renewals and churn risk",       defaultVisible: true,  category: "classic" },
    { id: "churn_risk_financial", label: "Churn Risk / Revenue",     description: "Top churn risks with ARR exposure",      defaultVisible: true,  category: "classic" },
    { id: "billing_anomalies",    label: "Billing Anomalies",        description: "Inactive lines or missing billing start",defaultVisible: true,  category: "classic" },
    { id: "forecast_pressure",    label: "Forecast Pressure",        description: "Pipeline vs target gap",                 defaultVisible: true,  category: "classic" },
    { ...NEW_WIDGETS.cash_pulse,             defaultVisible: true  },
    { ...NEW_WIDGETS.board_pack_readiness,   defaultVisible: true  },
    { ...NEW_WIDGETS.forecast_gap,           defaultVisible: true  },
    { ...NEW_WIDGETS.renewal_countdown,      defaultVisible: true  },
    { ...NEW_WIDGETS.open_quotes_aging,      defaultVisible: true  },
    { ...NEW_WIDGETS.my_inbox,               defaultVisible: true  },
    { ...NEW_WIDGETS.team_inboxes,           defaultVisible: true  },
    { ...NEW_WIDGETS.deal_velocity,          defaultVisible: false },
    { ...NEW_WIDGETS.today_critical_actions, defaultVisible: false },
    { ...NEW_WIDGETS.quick_create_launcher,  defaultVisible: false },
    { ...NEW_WIDGETS.ai_suggested_moves,     defaultVisible: false },
    { ...NEW_WIDGETS.todays_meetings,        defaultVisible: false },
    { ...NEW_WIDGETS.my_waiting_on,          defaultVisible: false },
    { ...NEW_WIDGETS.inbox_priority_radar,   defaultVisible: false },
  ],
  cto: [
    { id: "cert_blockers",        label: "Certification Blockers",   description: "Engineering cert issues",                defaultVisible: true,  category: "classic" },
    { id: "deployment_blockers",  label: "Deployment Blockers",      description: "Rollout and install technical blockers", defaultVisible: true,  category: "classic" },
    { id: "deployment_risk_score",label: "Deployment Delay Risk",    description: "Sites ranked by AI-predicted delay risk",defaultVisible: true,  category: "classic" },
    { id: "install_workflows",    label: "Install Workflows at Risk", description: "Workflows missing steps or overdue",    defaultVisible: true,  category: "classic" },
    { id: "procurement_blocked",  label: "Procurement Blocked",      description: "Hardware batches stuck in procurement",  defaultVisible: true,  category: "classic" },
    { id: "critical_tasks",       label: "Critical Tasks",           description: "High-priority overdue tasks",            defaultVisible: true,  category: "classic" },
    { ...NEW_WIDGETS.cert_watchtower,        defaultVisible: true  },
    { ...NEW_WIDGETS.deployment_pulse,       defaultVisible: true  },
    { ...NEW_WIDGETS.cert_status_summary,    defaultVisible: true  },
    { ...NEW_WIDGETS.team_load_balancer,     defaultVisible: true  },
    { ...NEW_WIDGETS.my_inbox,               defaultVisible: true  },
    { ...NEW_WIDGETS.team_inboxes,           defaultVisible: true  },
    { ...NEW_WIDGETS.board_pack_readiness,   defaultVisible: false },
    { ...NEW_WIDGETS.today_critical_actions, defaultVisible: false },
    { ...NEW_WIDGETS.quick_create_launcher,  defaultVisible: false },
    { ...NEW_WIDGETS.ai_suggested_moves,     defaultVisible: false },
    { ...NEW_WIDGETS.todays_meetings,        defaultVisible: false },
    { ...NEW_WIDGETS.my_waiting_on,          defaultVisible: false },
    { ...NEW_WIDGETS.inbox_priority_radar,   defaultVisible: false },
  ],
  cmo: [
    { id: "lead_volume",          label: "Lead Volume",              description: "New leads and MQL trend",                defaultVisible: true,  category: "classic" },
    { id: "hottest_leads_score",  label: "Hottest Leads",            description: "Top leads ranked by AI quality score",   defaultVisible: true,  category: "classic" },
    { id: "source_attribution",   label: "Source Attribution",       description: "Leads and pipeline by channel",          defaultVisible: true,  category: "classic" },
    { id: "territory_whitespace", label: "Territory Whitespace",     description: "Uncovered regions and opportunity gaps", defaultVisible: true,  category: "classic" },
    { id: "pipeline_by_source",   label: "Pipeline by Source",       description: "Quotes and deals created per channel",   defaultVisible: true,  category: "classic" },
    { id: "conversion_by_source", label: "Conversion by Source",     description: "Lead-to-deal conversion rate by channel",defaultVisible: false, category: "classic" },
    { ...NEW_WIDGETS.unresponded_leads,      defaultVisible: true  },
    { ...NEW_WIDGETS.recent_wins,            defaultVisible: true  },
    { ...NEW_WIDGETS.pipeline_funnel,        defaultVisible: true  },
    { ...NEW_WIDGETS.deal_velocity,          defaultVisible: true  },
    { ...NEW_WIDGETS.my_inbox,               defaultVisible: true  },
    { ...NEW_WIDGETS.team_inboxes,           defaultVisible: true  },
    { ...NEW_WIDGETS.top_performers,         defaultVisible: false },
    { ...NEW_WIDGETS.open_quotes_aging,      defaultVisible: false },
    { ...NEW_WIDGETS.today_critical_actions, defaultVisible: false },
    { ...NEW_WIDGETS.quick_create_launcher,  defaultVisible: false },
    { ...NEW_WIDGETS.ai_suggested_moves,     defaultVisible: false },
    { ...NEW_WIDGETS.todays_meetings,        defaultVisible: false },
    { ...NEW_WIDGETS.inbox_priority_radar,   defaultVisible: false },
    { ...NEW_WIDGETS.my_waiting_on,          defaultVisible: false },
  ],
  sales: [
    { id: "overdue_tasks",        label: "Overdue Tasks",            description: "Tasks past their due date",              defaultVisible: true,  category: "classic" },
    { id: "suggested_actions",    label: "Suggested Actions",        description: "AI signals and recommended follow-ups",  defaultVisible: true,  category: "classic" },
    { id: "hottest_leads_score",  label: "Hottest Leads",            description: "Top leads ranked by AI quality score",   defaultVisible: true,  category: "classic" },
    { id: "close_opps_score",     label: "Close-Likelihood Deals",   description: "Top opps ranked by AI close probability",defaultVisible: true,  category: "classic" },
    { id: "quote_urgency_score",  label: "Quote Follow-up Urgency",  description: "Quotes ranked by AI urgency score",      defaultVisible: true,  category: "classic" },
    { id: "accounts_at_risk",     label: "Accounts at Risk",         description: "High-value accounts with no recent touch",defaultVisible: true, category: "classic" },
    { id: "stale_deals",          label: "Stale Deals",              description: "Opportunities with no recent activity",  defaultVisible: true,  category: "classic" },
    { id: "inbox_followups",      label: "Inbox Follow-ups",         description: "Emails needing responses",               defaultVisible: true,  category: "classic" },
    { id: "week_priorities",      label: "This Week",                description: "Tasks and meetings due this week",       defaultVisible: true,  category: "classic" },
    { id: "nearby_routes",        label: "Nearby Routes",            description: "High-priority stops near your location", defaultVisible: true,  category: "classic" },
    { ...NEW_WIDGETS.today_critical_actions, defaultVisible: true  },
    { ...NEW_WIDGETS.inbox_priority_radar,   defaultVisible: true  },
    { ...NEW_WIDGETS.my_waiting_on,          defaultVisible: true  },
    { ...NEW_WIDGETS.ai_suggested_moves,     defaultVisible: true  },
    { ...NEW_WIDGETS.quick_create_launcher,  defaultVisible: true  },
    { ...NEW_WIDGETS.todays_meetings,        defaultVisible: true  },
    { ...NEW_WIDGETS.my_inbox,               defaultVisible: true  },
    { ...NEW_WIDGETS.team_inboxes,           defaultVisible: false },
    { ...NEW_WIDGETS.open_quotes_aging,      defaultVisible: false },
    { ...NEW_WIDGETS.deal_velocity,          defaultVisible: false },
    { ...NEW_WIDGETS.recent_wins,            defaultVisible: false },
    { ...NEW_WIDGETS.pipeline_funnel,        defaultVisible: false },
    { ...NEW_WIDGETS.team_load_balancer,     defaultVisible: false },
    { ...NEW_WIDGETS.unresponded_leads,      defaultVisible: false },
    { ...NEW_WIDGETS.top_performers,         defaultVisible: false },
    { ...NEW_WIDGETS.board_pack_readiness,   defaultVisible: false },
    { ...NEW_WIDGETS.cert_watchtower,        defaultVisible: false },
    { ...NEW_WIDGETS.cert_status_summary,    defaultVisible: false },
    { ...NEW_WIDGETS.forecast_gap,           defaultVisible: false },
    { ...NEW_WIDGETS.renewal_countdown,      defaultVisible: false },
    { ...NEW_WIDGETS.cash_pulse,             defaultVisible: false },
    { ...NEW_WIDGETS.deployment_pulse,       defaultVisible: false },
  ],
  cs: [
    { id: "health_scores",        label: "Account Health",           description: "CS health scores and risk signals",      defaultVisible: true,  category: "classic" },
    { id: "churn_risk_score",     label: "Churn Risk",               description: "Accounts most at risk of churning",      defaultVisible: true,  category: "classic" },
    { id: "expansion_score",      label: "Expansion Ready",          description: "Accounts with high expansion likelihood",defaultVisible: true,  category: "classic" },
    { id: "renewal_exposure",     label: "Renewal Exposure",         description: "Upcoming renewals and at-risk accounts", defaultVisible: true,  category: "classic" },
    { id: "overdue_tasks",        label: "Overdue Tasks",            description: "CS tasks past due",                      defaultVisible: true,  category: "classic" },
    { id: "accounts_at_risk",     label: "Accounts at Risk",         description: "Accounts flagged for risk",              defaultVisible: true,  category: "classic" },
    { ...NEW_WIDGETS.my_waiting_on,          defaultVisible: true  },
    { ...NEW_WIDGETS.renewal_countdown,      defaultVisible: true  },
    { ...NEW_WIDGETS.inbox_priority_radar,   defaultVisible: true  },
    { ...NEW_WIDGETS.my_inbox,               defaultVisible: true  },
    { ...NEW_WIDGETS.team_inboxes,           defaultVisible: true  },
    { ...NEW_WIDGETS.cert_status_summary,    defaultVisible: false },
    { ...NEW_WIDGETS.today_critical_actions, defaultVisible: false },
    { ...NEW_WIDGETS.quick_create_launcher,  defaultVisible: false },
    { ...NEW_WIDGETS.ai_suggested_moves,     defaultVisible: false },
    { ...NEW_WIDGETS.todays_meetings,        defaultVisible: false },
    { ...NEW_WIDGETS.top_performers,         defaultVisible: false },
    { ...NEW_WIDGETS.team_load_balancer,     defaultVisible: false },
  ],
  default: [
    { id: "overdue_tasks",        label: "Overdue Tasks",            description: "Tasks past their due date",              defaultVisible: true,  category: "classic" },
    { id: "suggested_actions",    label: "Suggested Actions",        description: "AI signals and recommended actions",     defaultVisible: true,  category: "classic" },
    { id: "accounts_at_risk",     label: "Accounts at Risk",         description: "High-value accounts with no recent touch",defaultVisible: true, category: "classic" },
    { id: "stale_deals",          label: "Stale Deals",              description: "Opportunities with no recent activity",  defaultVisible: true,  category: "classic" },
    ...UNIVERSAL_EXTRAS,
    { ...NEW_WIDGETS.today_critical_actions, defaultVisible: true  },
    { ...NEW_WIDGETS.ai_suggested_moves,     defaultVisible: false },
  ],
};

const CENTER_LABELS: Record<CenterType, string> = {
  ceo: "CEO Command Center",
  cfo: "CFO Command Center",
  cto: "CTO Command Center",
  cmo: "CMO Command Center",
  sales: "Sales Command Center",
  cs: "CS Command Center",
  default: "Command Center",
};

const CENTER_ACCENTS: Record<CenterType, string> = {
  ceo: "text-violet-400",
  cfo: "text-emerald-400",
  cto: "text-blue-400",
  cmo: "text-orange-400",
  sales: "text-primary",
  cs: "text-cyan-400",
  default: "text-muted-foreground",
};

// ── Permission gate ──────────────────────────────────────────────────────────

const ACCESS_ORDER: Record<string, number> = { none: 0, view: 1, edit: 2 };
const MANAGER_ROLES = new Set(["master_admin", "admin", "manager"]);
const ADMIN_ROLES   = new Set(["master_admin", "admin"]);

export function canUserSeeWidget(profile: UserProfile, widget: WidgetDef): boolean {
  const rule = widget.visibility;
  if (!rule) return true;

  const globalRole = String(profile.globalRole || "").toLowerCase();

  // Admins and master admins see everything.
  if (ADMIN_ROLES.has(globalRole)) return true;

  // Permission module + minimum access level.
  if (rule.permKey) {
    const perms = profile.permissions || {};
    const level = String(perms[rule.permKey] ?? "none").toLowerCase();
    const minLevel = rule.minAccessLevel ?? "view";
    if ((ACCESS_ORDER[level] ?? 0) < (ACCESS_ORDER[minLevel] ?? 1)) return false;
  }

  // Explicit role allowlist.
  if (rule.allowedGlobalRoles?.length) {
    const allowed = rule.allowedGlobalRoles.map(r => r.toLowerCase());
    if (!allowed.includes(globalRole)) return false;
  }

  // Internal / external gate.
  if (rule.allowedUserTypes?.length) {
    const uType = String(profile.userType || "internal").toLowerCase();
    const allowed = rule.allowedUserTypes.map(s => s.toLowerCase());
    if (!allowed.includes(uType)) return false;
  }

  // Manager-tier shortcut (admin|master_admin|manager).
  if (rule.managerOnly) {
    if (!MANAGER_ROLES.has(globalRole)) return false;
  }

  // Soft keyword filters — relevant to the user's title/dept.
  if (rule.jobTitleIncludes?.length) {
    const jt = String(profile.jobTitle || "").toLowerCase();
    const ok = rule.jobTitleIncludes.some(k => jt.includes(k.toLowerCase()));
    if (!ok) return false;
  }
  if (rule.departmentIncludes?.length) {
    const dp = String(profile.department || "").toLowerCase();
    const ok = rule.departmentIncludes.some(k => dp.includes(k.toLowerCase()));
    if (!ok) return false;
  }

  return true;
}

// ── Detect center type from user profile ─────────────────────────────────────

export function detectCenterType(profile: UserProfile): CenterType {
  if (profile.defaultCommandCenter && isValidCenterType(profile.defaultCommandCenter)) {
    return profile.defaultCommandCenter as CenterType;
  }

  const title = (profile.jobTitle ?? "").toLowerCase();
  const dept = (profile.department ?? "").toLowerCase();

  if (title.includes("ceo") || title.includes("chief executive")) return "ceo";
  if (title.includes("cfo") || title.includes("chief financial") || title.includes("vp finance")) return "cfo";
  if (title.includes("cto") || title.includes("chief technology") || title.includes("chief technical")) return "cto";
  if (title.includes("cmo") || title.includes("chief marketing")) return "cmo";
  if (title.includes("vp") && dept.includes("sales")) return "ceo";

  if (dept.includes("finance") || dept.includes("accounting") || dept.includes("revenue")) return "cfo";
  if (dept.includes("engineering") || dept.includes("technology") || dept.includes("tech")) return "cto";
  if (dept.includes("marketing") || dept.includes("growth") || dept.includes("demand")) return "cmo";
  if (dept.includes("customer success") || dept.includes("cx") || dept.includes("account management")) return "cs";
  if (dept.includes("sales") || dept.includes("business development")) return "sales";

  const role = profile.globalRole;
  if (role === "master_admin" || role === "admin") return "ceo";
  if (role === "manager") return "sales";
  if (role === "analyst") return "default";
  if (role === "sales") return "sales";

  return "default";
}

function isValidCenterType(s: string): s is CenterType {
  return ["ceo", "cfo", "cto", "cmo", "sales", "cs", "default"].includes(s);
}

export const ALL_CENTER_TYPES: { value: CenterType; label: string }[] = [
  { value: "ceo",     label: CENTER_LABELS.ceo },
  { value: "cfo",     label: CENTER_LABELS.cfo },
  { value: "cto",     label: CENTER_LABELS.cto },
  { value: "cmo",     label: CENTER_LABELS.cmo },
  { value: "sales",   label: CENTER_LABELS.sales },
  { value: "cs",      label: CENTER_LABELS.cs },
  { value: "default", label: CENTER_LABELS.default },
];

// ── Build full dashboard config ──────────────────────────────────────────────

export function buildDashboardConfig(profile: UserProfile, overrideCenterType?: CenterType): DashboardConfig {
  const centerType = overrideCenterType ?? detectCenterType(profile);

  // Start with the center's widget list and de-duplicate by id (classics that
  // match a NEW_WIDGETS id should be merged so the visibility rule carries over).
  const seen = new Set<string>();
  const widgets: WidgetDef[] = [];
  for (const raw of WIDGET_DEFS[centerType]) {
    if (seen.has(raw.id)) continue;
    seen.add(raw.id);
    const w = applyClassicRule(raw);
    if (canUserSeeWidget(profile, w)) widgets.push(w);
  }

  const rawVis = profile.widgetVisibility;
  const userVisibility: Record<string, boolean> =
    (rawVis !== null && typeof rawVis === "object" && !Array.isArray(rawVis))
      ? (rawVis as Record<string, boolean>)
      : {};
  const visibleWidgets: Record<string, boolean> = {};
  for (const w of widgets) {
    visibleWidgets[w.id] = w.id in userVisibility ? !!userVisibility[w.id] : w.defaultVisible;
  }

  // Extract widgetOrder from __order key in widgetVisibility
  const savedOrder: string[] = Array.isArray((rawVis as any)?.__order) ? (rawVis as any).__order : [];
  const newWidgetIds = widgets.filter(w => w.isNew).map(w => w.id);
  const widgetOrder = savedOrder.length > 0
    ? [
        ...savedOrder.filter(id => newWidgetIds.includes(id)),
        ...newWidgetIds.filter(id => !savedOrder.includes(id)),
      ]
    : newWidgetIds;

  return {
    centerType,
    centerLabel: CENTER_LABELS[centerType],
    accentColor: CENTER_ACCENTS[centerType],
    layoutMode: (profile.preferredLayout as LayoutMode) ?? "expanded",
    widgets,
    visibleWidgets,
    widgetOrder,
  };
}
