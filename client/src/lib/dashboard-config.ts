export type CenterType = "ceo" | "cfo" | "cto" | "cmo" | "sales" | "cs" | "default";
export type LayoutMode = "expanded" | "compact";

export type UserProfile = {
  globalRole: string;
  department?: string | null;
  jobTitle?: string | null;
  userType?: string;
  permissions?: Record<string, any>;
  defaultCommandCenter?: string | null;
  preferredLayout?: string;
  widgetVisibility?: Record<string, boolean>;
};

export type WidgetDef = {
  id: string;
  label: string;
  description: string;
  defaultVisible: boolean;
};

export type DashboardConfig = {
  centerType: CenterType;
  centerLabel: string;
  accentColor: string;
  layoutMode: LayoutMode;
  widgets: WidgetDef[];
  visibleWidgets: Record<string, boolean>;
};

// ── Widget definitions per center type ───────────────────────────────────────

export const WIDGET_DEFS: Record<CenterType, WidgetDef[]> = {
  ceo: [
    { id: "summary_bullets",      label: "Executive Summary",        description: "AI-generated priority bullets",          defaultVisible: true  },
    { id: "pipeline_health",      label: "Pipeline Health",          description: "Weighted forecast and stage breakdown",  defaultVisible: true  },
    { id: "revenue_at_risk",      label: "Revenue at Risk",          description: "CS health and renewal exposure",         defaultVisible: true  },
    { id: "cert_blockers",        label: "Certification Blockers",   description: "Engineering cert issues blocking deals",  defaultVisible: true  },
    { id: "deployment_blockers",  label: "Deployment Blockers",      description: "Installs and rollout blocked",           defaultVisible: true  },
    { id: "key_accounts",         label: "Key Accounts Needing Action", description: "High-value accounts with signals",   defaultVisible: true  },
  ],
  cfo: [
    { id: "mrr_overview",         label: "MRR Overview",             description: "Current, contracted and deployed MRR",   defaultVisible: true  },
    { id: "hardware_revenue",     label: "Hardware Revenue",         description: "Contracted vs booked vs delivered",      defaultVisible: true  },
    { id: "pricing_lock_expiries",label: "Pricing Lock Expiries",    description: "Accounts with expiring pricing locks",   defaultVisible: true  },
    { id: "renewal_exposure",     label: "Renewal Exposure",         description: "Upcoming renewals and churn risk",       defaultVisible: true  },
    { id: "billing_anomalies",    label: "Billing Anomalies",        description: "Inactive lines or missing billing start",defaultVisible: true  },
    { id: "forecast_pressure",    label: "Forecast Pressure",        description: "Pipeline vs target gap",                 defaultVisible: true  },
  ],
  cto: [
    { id: "cert_blockers",        label: "Certification Blockers",   description: "Engineering cert issues",                defaultVisible: true  },
    { id: "deployment_blockers",  label: "Deployment Blockers",      description: "Rollout and install technical blockers", defaultVisible: true  },
    { id: "install_workflows",    label: "Install Workflows at Risk", description: "Workflows missing steps or overdue",     defaultVisible: true  },
    { id: "procurement_blocked",  label: "Procurement Blocked",      description: "Hardware batches stuck in procurement",  defaultVisible: true  },
    { id: "critical_tasks",       label: "Critical Tasks",           description: "High-priority overdue tasks",            defaultVisible: true  },
  ],
  cmo: [
    { id: "lead_volume",          label: "Lead Volume",              description: "New leads and MQL trend",                defaultVisible: true  },
    { id: "source_attribution",   label: "Source Attribution",       description: "Leads and pipeline by channel",          defaultVisible: true  },
    { id: "territory_whitespace", label: "Territory Whitespace",     description: "Uncovered regions and opportunity gaps", defaultVisible: true  },
    { id: "pipeline_by_source",   label: "Pipeline by Source",       description: "Quotes and deals created per channel",  defaultVisible: true  },
    { id: "conversion_by_source", label: "Conversion by Source",     description: "Lead-to-deal conversion rate by channel",defaultVisible: false },
  ],
  sales: [
    { id: "overdue_tasks",        label: "Overdue Tasks",            description: "Tasks past their due date",              defaultVisible: true  },
    { id: "suggested_actions",    label: "Suggested Actions",        description: "AI signals and recommended follow-ups",  defaultVisible: true  },
    { id: "accounts_at_risk",     label: "Accounts at Risk",         description: "High-value accounts with no recent touch",defaultVisible: true  },
    { id: "stale_deals",          label: "Stale Deals",              description: "Opportunities with no recent activity",  defaultVisible: true  },
    { id: "inbox_followups",      label: "Inbox Follow-ups",         description: "Emails needing responses",               defaultVisible: true  },
    { id: "week_priorities",      label: "This Week",                description: "Tasks and meetings due this week",       defaultVisible: true  },
    { id: "nearby_routes",        label: "Nearby Routes",            description: "High-priority stops near your location", defaultVisible: true  },
  ],
  cs: [
    { id: "health_scores",        label: "Account Health",           description: "CS health scores and risk signals",      defaultVisible: true  },
    { id: "renewal_exposure",     label: "Renewal Exposure",         description: "Upcoming renewals and at-risk accounts", defaultVisible: true  },
    { id: "overdue_tasks",        label: "Overdue Tasks",            description: "CS tasks past due",                      defaultVisible: true  },
    { id: "accounts_at_risk",     label: "Accounts at Risk",         description: "Accounts flagged for risk",              defaultVisible: true  },
  ],
  default: [
    { id: "overdue_tasks",        label: "Overdue Tasks",            description: "Tasks past their due date",              defaultVisible: true  },
    { id: "suggested_actions",    label: "Suggested Actions",        description: "AI signals and recommended actions",     defaultVisible: true  },
    { id: "accounts_at_risk",     label: "Accounts at Risk",         description: "High-value accounts with no recent touch",defaultVisible: true  },
    { id: "stale_deals",          label: "Stale Deals",              description: "Opportunities with no recent activity",  defaultVisible: true  },
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

// ── Detect center type from user profile ──────────────────────────────────────

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

// ── Build full dashboard config ───────────────────────────────────────────────

export function buildDashboardConfig(profile: UserProfile, overrideCenterType?: CenterType): DashboardConfig {
  const centerType = overrideCenterType ?? detectCenterType(profile);
  const widgets = WIDGET_DEFS[centerType];

  const rawVis = profile.widgetVisibility;
  const userVisibility: Record<string, boolean> =
    (rawVis !== null && typeof rawVis === "object" && !Array.isArray(rawVis))
      ? (rawVis as Record<string, boolean>)
      : {};
  const visibleWidgets: Record<string, boolean> = {};
  for (const w of widgets) {
    visibleWidgets[w.id] = w.id in userVisibility ? userVisibility[w.id] : w.defaultVisible;
  }

  return {
    centerType,
    centerLabel: CENTER_LABELS[centerType],
    accentColor: CENTER_ACCENTS[centerType],
    layoutMode: (profile.preferredLayout as LayoutMode) ?? "expanded",
    widgets,
    visibleWidgets,
  };
}

export const ALL_CENTER_TYPES: { value: CenterType; label: string }[] = [
  { value: "ceo",   label: "CEO Command Center"   },
  { value: "cfo",   label: "CFO Command Center"   },
  { value: "cto",   label: "CTO Command Center"   },
  { value: "cmo",   label: "CMO Command Center"   },
  { value: "sales", label: "Sales Command Center" },
  { value: "cs",    label: "CS Command Center"    },
  { value: "default", label: "Default Center"     },
];
