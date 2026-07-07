// Grouped pages map — maps every child route to its parent group landing page.
// Used by CmsBreadcrumb and recent-page tracker.
// Section = top-level nav label. Group = landing page title. GroupUrl = the hub route.

export type GroupEntry = {
  section: string;
  group: string;
  groupUrl: string;
};

// prefix-match: keys are matched with startsWith against the current pathname
export const GROUPED_PAGES_MAP: Record<string, GroupEntry> = {
  // Work / Inbox & Mail
  "/gmail":          { section: "Work", group: "Inbox & Mail",       groupUrl: "/work/inbox-mail" },
  "/meeting-notes":  { section: "Work", group: "Inbox & Mail",       groupUrl: "/work/inbox-mail" },
  "/activity":       { section: "Work", group: "Inbox & Mail",       groupUrl: "/work/inbox-mail" },
  "/alerts-digest":  { section: "Work", group: "Inbox & Mail",       groupUrl: "/work/inbox-mail" },

  // Work / Tasks & Execution
  "/execution/tasks":        { section: "Work", group: "Tasks & Execution",  groupUrl: "/work/tasks-execution" },
  "/execution/daily":        { section: "Work", group: "Tasks & Execution",  groupUrl: "/work/tasks-execution" },
  "/execution/team-workload":{ section: "Work", group: "Tasks & Execution",  groupUrl: "/work/tasks-execution" },

  // Work / Calendar & Meetings
  "/execution/calendar":     { section: "Work", group: "Calendar & Meetings", groupUrl: "/work/calendar-meetings" },
  "/work/team-calendar":     { section: "Work", group: "Calendar & Meetings", groupUrl: "/work/calendar-meetings" },

  // Work / Personal Settings
  "/settings/personal":       { section: "Work",     group: "Personal Settings", groupUrl: "/work/personal-settings" },
  "/settings/signatures":     { section: "Settings", group: "Personal Settings", groupUrl: "/work/personal-settings" },
  "/settings/voice-profiles": { section: "Settings", group: "Personal Settings", groupUrl: "/work/personal-settings" },
  "/my-travel":               { section: "Work",     group: "Personal Settings", groupUrl: "/work/personal-settings" },

  // Pipeline / Leads & Accounts
  "/opportunities":    { section: "Pipeline", group: "Leads & Accounts",   groupUrl: "/pipeline/leads-accounts" },
  "/accounts":         { section: "Pipeline", group: "Leads & Accounts",   groupUrl: "/pipeline/leads-accounts" },
  "/contacts":         { section: "Pipeline", group: "Leads & Accounts",   groupUrl: "/pipeline/leads-accounts" },
  "/notes":            { section: "Pipeline", group: "Leads & Accounts",   groupUrl: "/pipeline/leads-accounts" },
  "/revenue/deals":    { section: "Pipeline", group: "Leads & Accounts",   groupUrl: "/pipeline/leads-accounts" },

  // Pipeline / Quotes & Renewals
  "/quotes":              { section: "Pipeline", group: "Quotes & Renewals", groupUrl: "/pipeline/quotes-renewals" },
  "/renewals":            { section: "Pipeline", group: "Quotes & Renewals", groupUrl: "/pipeline/quotes-renewals" },
  "/booking-analytics":   { section: "Pipeline", group: "Quotes & Renewals", groupUrl: "/pipeline/quotes-renewals" },

  // Pipeline / Outreach
  "/booking-outreach":    { section: "Pipeline", group: "Outreach",          groupUrl: "/pipeline/outreach" },

  // Pipeline / Revenue Tools
  "/price-lists":         { section: "Pipeline", group: "Revenue Tools",     groupUrl: "/pipeline/revenue-tools" },

  // Operations / Install & Deployments
  "/install-workflows":   { section: "Operations", group: "Install & Deployments", groupUrl: "/operations/install-deployments" },
  "/deployments":         { section: "Operations", group: "Install & Deployments", groupUrl: "/operations/install-deployments" },
  "/routing":             { section: "Operations", group: "Install & Deployments", groupUrl: "/operations/install-deployments" },

  // Operations / Support
  "/support/tickets":     { section: "Operations", group: "Support",               groupUrl: "/operations/support" },
  "/winter":              { section: "Operations", group: "Support",               groupUrl: "/operations/support" },
  "/operations/events":   { section: "Operations", group: "Support",               groupUrl: "/operations/support" },

  // Operations / Knowledge & Documents
  "/documents":                   { section: "Operations", group: "Knowledge & Documents", groupUrl: "/operations/knowledge-documents" },
  "/knowledge/assets":            { section: "Operations", group: "Knowledge & Documents", groupUrl: "/operations/knowledge-documents" },
  "/data-quality":                { section: "Operations", group: "Knowledge & Documents", groupUrl: "/operations/knowledge-documents" },
  "/execution/communications":    { section: "Operations", group: "Knowledge & Documents", groupUrl: "/operations/knowledge-documents" },

  // Insights / Revenue Intelligence
  "/revenue-intelligence":           { section: "Insights", group: "Revenue Intelligence",    groupUrl: "/insights/revenue-intelligence" },
  "/revenue-ops":                    { section: "Insights", group: "Revenue Intelligence",    groupUrl: "/insights/revenue-intelligence" },
  "/revenue":                        { section: "Insights", group: "Revenue Intelligence",    groupUrl: "/insights/revenue-intelligence" },
  "/analytics/source-attribution":   { section: "Insights", group: "Revenue Intelligence",    groupUrl: "/insights/revenue-intelligence" },

  // Insights / Cortex
  "/executive-copilot":              { section: "Insights", group: "Cortex",                  groupUrl: "/insights/cortex" },
  "/cortex/intel":                   { section: "Insights", group: "Cortex",                  groupUrl: "/insights/cortex" },
  "/executive-dashboard":            { section: "Insights", group: "Cortex",                  groupUrl: "/insights/cortex" },
  "/intelligence/rel-intelligence":  { section: "Insights", group: "Cortex",                  groupUrl: "/insights/cortex" },

  // Insights / Simulators & Feedback
  "/revenue-sim":                    { section: "Insights", group: "Simulators & Feedback",   groupUrl: "/insights/simulators-feedback" },
  "/scores/feedback":                { section: "Insights", group: "Simulators & Feedback",   groupUrl: "/insights/simulators-feedback" },
  "/board-pack":                     { section: "Insights", group: "Simulators & Feedback",   groupUrl: "/insights/simulators-feedback" },

  // Ecosystem / Partners
  "/strategy/partnerships/industry-associations": { section: "Ecosystem", group: "Partners",     groupUrl: "/ecosystem/partners" },
  "/strategy/partnerships/manufacturing":         { section: "Ecosystem", group: "Partners",     groupUrl: "/ecosystem/partners" },

  // Ecosystem / Channels
  "/strategy/partnerships/channel-commercial":    { section: "Ecosystem", group: "Channels",     groupUrl: "/ecosystem/channels" },
  "/strategy/partnerships/government-public":     { section: "Ecosystem", group: "Channels",     groupUrl: "/ecosystem/channels" },
  "/strategy/partnerships/other":                 { section: "Ecosystem", group: "Channels",     groupUrl: "/ecosystem/channels" },

  // Ecosystem / Events & Media
  "/strategy/partnerships/media-tradeshows":      { section: "Ecosystem", group: "Events & Media", groupUrl: "/ecosystem/events-media" },
  "/ecosystem/events":                            { section: "Ecosystem", group: "Events & Media", groupUrl: "/ecosystem/events-media" },
  "/ecosystem/organizations":                     { section: "Ecosystem", group: "Events & Media", groupUrl: "/ecosystem/events-media" },
  "/ecosystem/people":                            { section: "Ecosystem", group: "Events & Media", groupUrl: "/ecosystem/events-media" },

  // Admin / Users & Roles
  "/admin/users":            { section: "Admin", group: "Users & Roles",          groupUrl: "/admin/users-roles" },
  "/admin/roles":            { section: "Admin", group: "Users & Roles",          groupUrl: "/admin/users-roles" },
  "/admin/task-hub-access":  { section: "Admin", group: "Users & Roles",          groupUrl: "/admin/users-roles" },

  // Admin / Mailboxes & Signatures
  "/settings/mailbox":       { section: "Admin", group: "Mailboxes & Signatures", groupUrl: "/admin/mailboxes-signatures" },
  "/admin/signatures":       { section: "Admin", group: "Mailboxes & Signatures", groupUrl: "/admin/mailboxes-signatures" },

  // Admin / System Settings
  "/settings":               { section: "Admin", group: "System Settings",        groupUrl: "/admin/system-settings" },
  "/automations":            { section: "Admin", group: "System Settings",        groupUrl: "/admin/system-settings" },
  "/admin/integrations":     { section: "Admin", group: "System Settings",        groupUrl: "/admin/system-settings" },
  "/search":                 { section: "Admin", group: "System Settings",        groupUrl: "/admin/system-settings" },
};

// Resolve the group entry for a given pathname (prefix match, longest wins).
export function resolveGroupEntry(pathname: string): GroupEntry | null {
  let best: { key: string; entry: GroupEntry } | null = null;
  for (const [key, entry] of Object.entries(GROUPED_PAGES_MAP)) {
    if (pathname === key || pathname.startsWith(key + "/") || pathname.startsWith(key + "?")) {
      if (!best || key.length > best.key.length) {
        best = { key, entry };
      }
    }
  }
  return best ? best.entry : null;
}

// Grouped landing pages — used to populate PAGE_NAV_INDEX entries and
// to seed favorites/recents with human-friendly labels.
export type GroupedLandingPage = {
  name: string;
  url: string;
  section: string;
  aliases?: string[];
  adminOnly?: boolean;
};

export const GROUPED_LANDING_PAGES: GroupedLandingPage[] = [
  // Work
  { name: "Inbox & Mail",          url: "/work/inbox-mail",              section: "Work",      aliases: ["Inbox Hub", "Mail Hub"] },
  { name: "Tasks & Execution",     url: "/work/tasks-execution",         section: "Work",      aliases: ["Task Hub Overview"] },
  { name: "Calendar & Meetings",   url: "/work/calendar-meetings",       section: "Work",      aliases: ["Meetings Hub", "Calendar Hub"] },
  { name: "Personal Settings",     url: "/work/personal-settings",       section: "Work",      aliases: ["My Settings", "Preferences Hub"] },
  // Pipeline
  { name: "Leads & Accounts Hub",  url: "/pipeline/leads-accounts",      section: "Pipeline",  aliases: ["CRM Hub", "Leads Hub"] },
  { name: "Quotes & Renewals Hub", url: "/pipeline/quotes-renewals",     section: "Pipeline",  aliases: ["Quotes Hub"] },
  { name: "Outreach Hub",          url: "/pipeline/outreach",            section: "Pipeline",  aliases: ["Booking Outreach Hub"] },
  { name: "Revenue Tools Hub",     url: "/pipeline/revenue-tools",       section: "Pipeline",  aliases: ["Price Lists Hub"] },
  // Operations
  { name: "Install & Deployments Hub", url: "/operations/install-deployments", section: "Operations", aliases: ["Deployments Hub", "Install Hub"] },
  { name: "Support Hub",           url: "/operations/support",           section: "Operations", aliases: ["Tickets Hub", "Customer Support Hub"] },
  { name: "Knowledge & Documents Hub", url: "/operations/knowledge-documents", section: "Operations", aliases: ["Docs Hub", "Document Hub Overview"] },
  // Insights
  { name: "Revenue Intelligence Hub", url: "/insights/revenue-intelligence", section: "Insights", aliases: ["Rev Intel Hub", "Revenue Hub Overview"] },
  { name: "Cortex Hub",            url: "/insights/cortex",              section: "Insights",  aliases: ["AI Hub", "Copilot Hub", "Cortex Overview"] },
  { name: "Simulators & Feedback Hub", url: "/insights/simulators-feedback", section: "Insights", aliases: ["Simulator Hub", "Score Feedback Hub"] },
  // Ecosystem
  { name: "Partners Hub",          url: "/ecosystem/partners",           section: "Ecosystem", aliases: ["Partnership Hub"] },
  { name: "Channels Hub",          url: "/ecosystem/channels",           section: "Ecosystem", aliases: ["Channel Partners Hub", "Gov Grants Hub"] },
  { name: "Events & Media Hub",    url: "/ecosystem/events-media",       section: "Ecosystem", aliases: ["Events Hub", "Media Hub"] },
  // Admin
  { name: "Users & Roles Hub",     url: "/admin/users-roles",            section: "Admin", adminOnly: true, aliases: ["User Management Hub", "Role Hub"] },
  { name: "Mailboxes & Signatures Hub", url: "/admin/mailboxes-signatures", section: "Admin", adminOnly: true, aliases: ["Mailbox Hub", "Signature Admin Hub"] },
  { name: "System Settings Hub",   url: "/admin/system-settings",        section: "Admin", adminOnly: true, aliases: ["Settings Hub", "Admin Settings Hub", "Config Hub"] },
];
