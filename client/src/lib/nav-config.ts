import type React from "react";
import {
  Sun, Briefcase, Target, SlidersHorizontal, Brain, Share2,
  Settings2, LayoutDashboard, Mail, CalendarClock, CheckSquare, BarChart3,
  Sparkles, GitBranch, Building2, Contact, FileText, RefreshCcw, Trophy,
  StickyNote, Layers, Package, Megaphone, BookOpen, FolderOpen, TrendingUp,
  Globe, Users2, Truck, Factory, FlaskConical, Landmark, Circle,
  Newspaper, PlayCircle, FlaskRound, BellRing, MapPin, ShieldCheck, Tags,
  Zap, HelpCircle, ClipboardList, Snowflake, Search, Settings, Smartphone,
  Mic, Car, PenSquare, GraduationCap, CalendarDays, MessageSquare,
  Radio, Ban, Flame, Banknote,
} from "lucide-react";

// Note: a few items intentionally use a different icon on mobile than on desktop
// (e.g. Deployments is a Truck on the phone where the field crew thinks of it
// as a delivery, but Layers on the wide-screen pipeline view). Use `mobileIcon`
// for that override; otherwise the single `icon` is used on both surfaces.
import type { UserPermissions } from "@/App";

// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for navigation. Both the desktop sidebar
// (app-sidebar.tsx) and the mobile All Sections sheet (mobile-nav.tsx) project
// from this list. Edit here to add, move, rename, or hide any nav item.
//
// Schema notes:
//   • `label` may be a string (used on both surfaces) or `{ desktop, mobile }`
//     when mobile needs a shorter version for the bottom-sheet.
//   • `showOn` defaults to both platforms when omitted. Set it to `["mobile"]`
//     for phone-only screens (e.g. Field Mode, Nearby) or `["desktop"]` for
//     desktop-only pieces (e.g. the ADMIN divider).
//   • A section with both `url` AND `items` renders as a direct link on
//     desktop (no chevron, single-click) and as a group on mobile. This is how
//     Today stays a one-tap link on desktop while exposing Field Mode + Nearby
//     on the phone.
// ─────────────────────────────────────────────────────────────────────────────

export type Platform = "desktop" | "mobile";

type PermKey = keyof Pick<
  UserPermissions,
  "crm" | "partnerships" | "projects" | "communications" | "team_workload" |
  "knowledge" | "support" | "quoting" | "calendar"
>;

type Label = string | { desktop: string; mobile: string };

export type NavItem = {
  id: string;
  label: Label;
  route: string;
  icon: React.ElementType;
  // Optional mobile-specific icon override. When omitted, `icon` is used on
  // both surfaces. Used for items that historically had different glyphs on
  // each surface (Deployments, Signals).
  mobileIcon?: React.ElementType;
  adminOnly?: boolean;
  permKey?: PermKey;
  exactMatch?: boolean;
  badge?: string;
  showOn?: Platform[];
  advisorHidden?: boolean;
};

export type NavSection = {
  id: string;
  label: Label;
  icon?: React.ElementType;
  url?: string;
  items?: NavItem[];
  adminOnly?: boolean;
  capitalOnly?: boolean;
  permKey?: PermKey;
  isDivider?: boolean;
  showOn?: Platform[];
  advisorHidden?: boolean;
};

export function isAdvisorRole(globalRole: string): boolean {
  return globalRole === "advisor";
}

// ─────────────────────────────────────────────────────────────────────────────
// NAV_CONFIG — consolidated structure (≤7 children per section).
//
// ALL existing routes are preserved in App.tsx and remain reachable via
// direct URL or ⌘K global search. Only the sidebar items are reduced here.
// Secondary pages within each group are surfaced via:
//   • Their direct URL (unchanged)
//   • The PAGE_NAV_INDEX in global-search.tsx (⌘K page navigation)
//   • Hub/landing pages where explicitly created (marketing/engagement,
//     settings/personal)
// ─────────────────────────────────────────────────────────────────────────────

export const NAV_CONFIG: NavSection[] = [
  {
    id: "today",
    label: "Today",
    icon: Sun,
    url: "/today",
    items: [
      { id: "today-home",   label: "Today",      route: "/today",        icon: Sparkles,   showOn: ["mobile"] },
      { id: "field-mode",   label: "Field Mode", route: "/field",        icon: Smartphone, showOn: ["mobile"] },
      { id: "field-nearby", label: "Nearby",     route: "/field/nearby", icon: MapPin,     showOn: ["mobile"] },
    ],
  },
  // ── CURRENTS: top-level dedicated workspace, directly below Today ──────────
  {
    id: "currents",
    label: "CURRENTS",
    icon: Zap,
    url: "/current",
    items: [
      { id: "current-home", label: "CURRENTS", route: "/current", icon: Zap, showOn: ["mobile"] },
    ],
  },

  // ── WORK (6 items) ─────────────────────────────────────────────────────────
  // Removed from sidebar (still accessible via direct URL / ⌘K):
  //   Work Calendar (/work/team-calendar), Meeting Notes (/meeting-notes),
  //   Activity Feed (/activity), Email Signatures (/settings/signatures),
  //   AI Voice Profiles (/settings/voice-profiles), Daily Execution (/execution/daily),
  //   Digest Settings (/alerts-digest)
  {
    id: "work",
    label: "Work",
    icon: Briefcase,
    items: [
      { id: "mission-control",  label: "Mission Control",  route: "/",                   icon: LayoutDashboard, exactMatch: true },
      { id: "inbox",            label: "Inbox & Mail",     route: "/gmail",              icon: Mail },
      { id: "tasks",            label: "Tasks & Execution",route: "/execution/tasks",    icon: CheckSquare },
      { id: "calendar",         label: "Calendar & Meetings", route: "/execution/calendar", icon: CalendarClock, permKey: "calendar" },
      { id: "my-travel",        label: "Travel",           route: "/my-travel",          icon: Car },
      { id: "personal-settings",label: "Personal Settings",route: "/settings/personal",  icon: Settings },
    ],
  },

  // ── PIPELINE (6 items) ─────────────────────────────────────────────────────
  // Removed from sidebar (still accessible via direct URL / ⌘K):
  //   Accounts (/accounts), Renewals (/renewals), Booking Analytics (/booking-analytics),
  //   Notes (/notes), Accounts Won (/revenue/deals)
  {
    id: "pipeline",
    label: "Pipeline",
    icon: Target,
    permKey: "crm",
    advisorHidden: true,
    items: [
      { id: "pipeline-snapshot", label: "Snapshot",       route: "/pipeline",         icon: GitBranch, permKey: "crm",     advisorHidden: true },
      { id: "leads-accounts", label: "Leads & Accounts", route: "/opportunities",    icon: Building2, permKey: "crm",     advisorHidden: true },
      { id: "contacts",       label: "Contacts",         route: "/contacts",         icon: Contact,   permKey: "crm",     advisorHidden: true },
      { id: "quotes-renewals",label: "Quotes & Renewals",route: "/quotes",           icon: FileText,  permKey: "quoting", advisorHidden: true },
      { id: "outreach",       label: "Outreach",         route: "/booking-outreach", icon: CalendarClock, permKey: "crm", advisorHidden: true },
      { id: "revenue-tools",  label: "Revenue Tools",    route: "/price-lists",      icon: Tags,      permKey: "quoting", advisorHidden: true },
    ],
  },

  // ── OPERATIONS (6 items) ───────────────────────────────────────────────────
  // Removed from sidebar (still accessible via direct URL / ⌘K):
  //   Deployments (/deployments), Events (/operations/events),
  //   Communications (/execution/communications), Knowledge Assets (/knowledge/assets),
  //   Territory Routing (/routing), Winter Support (/winter)
  {
    id: "operations",
    label: "Operations",
    icon: SlidersHorizontal,
    items: [
      { id: "install-deployments",   label: "Install & Deployments", route: "/install-workflows",  icon: Layers,       permKey: "crm",      advisorHidden: true },
      { id: "projects",              label: "Projects",              route: "/execution/projects", icon: Layers,       permKey: "projects" },
      { id: "procurement",           label: "Procurement",           route: "/procurement",        icon: Package,      permKey: "crm",      advisorHidden: true },
      { id: "support",               label: "Support",               route: "/support/tickets",    icon: ClipboardList,permKey: "support" },
      { id: "knowledge-documents",   label: "Knowledge & Documents", route: "/documents",          icon: BookOpen },
      { id: "data-quality",          label: "Data Quality",          route: "/data-quality",       icon: ShieldCheck,  permKey: "crm",      advisorHidden: true },
    ],
  },

  // ── INSIGHTS (6 items) ─────────────────────────────────────────────────────
  // Removed from sidebar (still accessible via direct URL / ⌘K):
  //   Cortex Intel Library (/cortex/intel), Territory & Geo (/geography),
  //   Revenue Hub (/revenue), Revenue Ops (/revenue-ops),
  //   Score Feedback (/scores/feedback)
  {
    id: "insights",
    label: "Insights",
    icon: Brain,
    items: [
      { id: "exec-dashboard",       label: { desktop: "Executive Dashboard", mobile: "Exec Dashboard" }, route: "/executive-dashboard",           icon: Trophy,    permKey: "crm", advisorHidden: true },
      { id: "revenue-intelligence", label: { desktop: "Revenue Intelligence", mobile: "Rev Intel" },     route: "/revenue-intelligence",          icon: Zap,       permKey: "crm", advisorHidden: true },
      { id: "attribution",          label: "Attribution",                                                route: "/analytics/source-attribution",  icon: TrendingUp,permKey: "crm", advisorHidden: true },
      { id: "rel-intelligence",     label: { desktop: "Relationship Intel", mobile: "Rel Intel" },       route: "/intelligence/rel-intelligence", icon: BarChart3 },
      { id: "cortex",               label: "Cortex",                                                     route: "/executive-copilot",             icon: Brain },
      { id: "simulators-feedback",  label: { desktop: "Simulators & Feedback", mobile: "Simulators" },  route: "/revenue-sim",                   icon: FlaskRound, advisorHidden: true },
    ],
  },

  // ── ECOSYSTEM (5 items) ────────────────────────────────────────────────────
  // Removed from sidebar (still accessible via direct URL / ⌘K):
  //   Strategic Alliances (/strategy/partnerships/manufacturing)
  {
    id: "channels",
    label: "Ecosystem",
    icon: Share2,
    permKey: "partnerships",
    advisorHidden: true,
    items: [
      { id: "partners",    label: "Partners",                                                    route: "/strategy/partnerships/industry-associations", icon: Users2,  advisorHidden: true },
      { id: "channels-item", label: "Channels",                                                  route: "/strategy/partnerships/channel-commercial",    icon: Truck,   advisorHidden: true },
      { id: "govt",        label: "Government & Grants",                                         route: "/strategy/partnerships/government-public",     icon: Landmark,advisorHidden: true },
      { id: "referrals",   label: "Referrals",                                                   route: "/strategy/partnerships/other",                 icon: Circle,  advisorHidden: true },
      { id: "events-media",label: { desktop: "Events & Media", mobile: "Events" },              route: "/strategy/partnerships/media-tradeshows",      icon: Newspaper,advisorHidden: true },
    ],
  },

  // ── MARKETING (5 items) ────────────────────────────────────────────────────
  // Replies + Hot Accounts consolidated into Engagement hub (/marketing/engagement)
  {
    id: "marketing",
    label: "Marketing",
    icon: Megaphone,
    permKey: "crm",
    items: [
      { id: "marketing-dashboard",   label: "Dashboard",   route: "/marketing/dashboard",   icon: LayoutDashboard },
      { id: "marketing-campaigns",   label: "Campaigns",   route: "/marketing/campaigns",   icon: Radio },
      { id: "marketing-audiences",   label: "Audiences",   route: "/marketing/audiences",   icon: Users2 },
      { id: "marketing-engagement",  label: "Engagement",  route: "/marketing/engagement",  icon: MessageSquare },
      { id: "marketing-compliance",  label: "Compliance",  route: "/marketing/compliance",  icon: ShieldCheck },
    ],
  },

  // ── CAPITAL (6 items, capitalOnly) ─────────────────────────────────────────
  // Removed from sidebar (still accessible via direct URL / ⌘K):
  //   Capital Dashboard (/capital/dashboard), Investor Targets (/capital/targets),
  //   Investor Contacts (/capital/contacts), Commitments (/capital/commitments),
  //   Grants & Non-Dilutive (/capital/grants), Email Review (/capital/email-review)
  {
    id: "capital",
    label: "Capital",
    icon: Banknote,
    capitalOnly: true,
    items: [
      { id: "capital-command-center", label: "Command Center",      route: "/capital/command-center", icon: Target },
      { id: "capital-investors",      label: "Investors",           route: "/capital/pipeline",       icon: TrendingUp },
      { id: "capital-rounds",         label: "Rounds & Commitments",route: "/capital/rounds",         icon: RefreshCcw },
      { id: "capital-follow-ups",     label: "Follow-Ups",          route: "/capital/follow-ups",     icon: Zap },
      { id: "capital-data-room",      label: "Data Room",           route: "/capital/data-room",      icon: FolderOpen },
      { id: "capital-updates",        label: "Updates & Reviews",   route: "/capital/updates",        icon: BellRing },
    ],
  },

  // ── LEARN (2 items — unchanged) ────────────────────────────────────────────
  {
    id: "learn",
    label: "Learn",
    icon: GraduationCap,
    items: [
      { id: "training", label: "Training", route: "/training", icon: GraduationCap },
      { id: "help",     label: "Help",     route: "/help",     icon: HelpCircle },
    ],
  },

  // Desktop-only divider above the Admin section.
  { id: "divider-admin", label: "ADMIN", isDivider: true, adminOnly: true, showOn: ["desktop"] },

  // ── ADMIN (5 items) ────────────────────────────────────────────────────────
  // Removed from sidebar (still accessible via direct URL / ⌘K):
  //   Task Hub Access (/admin/task-hub-access), User Signatures (/admin/signatures),
  //   Role Manager (/admin/roles), Global Search (/search — also ⌘K)
  {
    id: "admin",
    label: "Admin",
    icon: Settings2,
    adminOnly: true,
    items: [
      { id: "admin-users",        label: "Users & Roles",           route: "/admin/users",      icon: ShieldCheck, adminOnly: true },
      { id: "admin-integrations", label: "Integrations",            route: "/admin/integrations",icon: Zap,        adminOnly: true },
      { id: "admin-mailboxes",    label: "Mailboxes & Signatures",  route: "/settings/mailbox", icon: Mail,        adminOnly: true },
      { id: "admin-settings",     label: "System Settings",         route: "/settings",         icon: Settings,    adminOnly: true, exactMatch: true },
      { id: "automations",        label: "Automations",             route: "/automations",      icon: Zap },
    ],
  },
];

function projectLabel(label: Label, platform: Platform): string {
  return typeof label === "string" ? label : label[platform];
}

function visibleOnPlatform(entry: { showOn?: Platform[] }, platform: Platform): boolean {
  return !entry.showOn || entry.showOn.includes(platform);
}

// ─────────────────────────────────────────────────────────────────────────────
// Desktop sidebar projection — output shape matches what app-sidebar.tsx
// expected from its inline `sections` array (title/url field names preserved).
// When a section has `url`, `items` is intentionally omitted so the sidebar
// renders it as a one-click direct link with no chevron.
// ─────────────────────────────────────────────────────────────────────────────

export type DesktopNavItem = {
  title: string;
  url: string;
  icon: React.ElementType;
  adminOnly?: boolean;
  exactMatch?: boolean;
  badge?: string;
  permKey?: PermKey;
  advisorHidden?: boolean;
};

export type DesktopNavSection = {
  id: string;
  label: string;
  icon?: React.ElementType;
  url?: string;
  items?: DesktopNavItem[];
  adminOnly?: boolean;
  capitalOnly?: boolean;
  permKey?: PermKey;
  isDivider?: boolean;
  advisorHidden?: boolean;
};

export function getDesktopSections(): DesktopNavSection[] {
  return NAV_CONFIG
    .filter((s) => visibleOnPlatform(s, "desktop"))
    .map((s) => ({
      id: s.id,
      label: projectLabel(s.label, "desktop"),
      icon: s.icon,
      url: s.url,
      items: s.url
        ? undefined
        : s.items
            ?.filter((item) => visibleOnPlatform(item, "desktop"))
            .map((item) => ({
              title: projectLabel(item.label, "desktop"),
              url: item.route,
              icon: item.icon,
              adminOnly: item.adminOnly,
              exactMatch: item.exactMatch,
              badge: item.badge,
              permKey: item.permKey,
              advisorHidden: item.advisorHidden,
            })),
      adminOnly: s.adminOnly,
      capitalOnly: s.capitalOnly,
      permKey: s.permKey,
      isDivider: s.isDivider,
      advisorHidden: s.advisorHidden,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Mobile All Sections sheet projection — flatter shape that matches
// mobile-nav.tsx's existing `allNavGroups` consumer. Dividers are dropped
// (mobile has no divider rows). Empty groups (after platform/perm filtering)
// are dropped at render time by the consumer.
// ─────────────────────────────────────────────────────────────────────────────

export type MobileNavItem = {
  title: string;
  url: string;
  icon: React.ElementType;
  adminOnly?: boolean;
  advisorHidden?: boolean;
};

export type MobileNavGroup = {
  label: string;
  items: MobileNavItem[];
  advisorHidden?: boolean;
};

export function getMobileNavGroups(): MobileNavGroup[] {
  return NAV_CONFIG
    .filter((s) => !s.isDivider && visibleOnPlatform(s, "mobile"))
    .map((s) => ({
      label: projectLabel(s.label, "mobile"),
      advisorHidden: s.advisorHidden,
      items: (s.items ?? [])
        .filter((item) => visibleOnPlatform(item, "mobile"))
        .map((item) => ({
          title: projectLabel(item.label, "mobile"),
          url: item.route,
          icon: item.mobileIcon ?? item.icon,
          adminOnly: item.adminOnly,
          advisorHidden: item.advisorHidden,
        })),
    }))
    .filter((g) => g.items.length > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE_NAV_INDEX — full list of all pages (including those removed from the
// sidebar) with their canonical route and searchable aliases. Consumed by
// global-search.tsx to power ⌘K page-navigation even for consolidated pages.
// ─────────────────────────────────────────────────────────────────────────────

export type PageNavEntry = {
  name: string;
  route: string;
  section: string;
  aliases?: string[];
};

export const PAGE_NAV_INDEX: PageNavEntry[] = [
  // Today / Work
  { name: "Today",             route: "/today",                   section: "Work" },
  { name: "Mission Control",   route: "/",                        section: "Work" },
  { name: "Inbox & Mail",      route: "/gmail",                   section: "Work", aliases: ["Inbox", "Email", "Gmail"] },
  { name: "Tasks & Execution", route: "/execution/tasks",         section: "Work", aliases: ["Tasks", "Task Hub"] },
  { name: "Daily Execution",   route: "/execution/daily",         section: "Work" },
  { name: "Calendar & Meetings",route: "/execution/calendar",     section: "Work", aliases: ["Calendar"] },
  { name: "Work Calendar",     route: "/work/team-calendar",      section: "Work", aliases: ["Team Calendar"] },
  { name: "Meeting Notes",     route: "/meeting-notes",           section: "Work" },
  { name: "Activity Feed",     route: "/activity",                section: "Work", aliases: ["Activity"] },
  { name: "Travel",            route: "/my-travel",               section: "Work", aliases: ["My Travel"] },
  { name: "Personal Settings", route: "/settings/personal",       section: "Work" },
  { name: "Email Signatures",  route: "/settings/signatures",     section: "Work", aliases: ["Signatures"] },
  { name: "AI Voice Profiles", route: "/settings/voice-profiles", section: "Work", aliases: ["Voice Profiles"] },
  { name: "Digest Settings",   route: "/alerts-digest",           section: "Work", aliases: ["Digest", "Alerts"] },
  // Pipeline
  { name: "Snapshot",          route: "/pipeline",                section: "Pipeline", aliases: ["Pipeline"] },
  { name: "Leads & Accounts",  route: "/opportunities",           section: "Pipeline", aliases: ["Leads", "Opportunities"] },
  { name: "Accounts",          route: "/accounts",                section: "Pipeline" },
  { name: "Contacts",          route: "/contacts",                section: "Pipeline" },
  { name: "Quotes & Renewals", route: "/quotes",                  section: "Pipeline", aliases: ["Quotes"] },
  { name: "Renewals",          route: "/renewals",                section: "Pipeline" },
  { name: "Accounts Won",      route: "/revenue/deals",           section: "Pipeline", aliases: ["Won"] },
  { name: "Outreach",          route: "/booking-outreach",        section: "Pipeline", aliases: ["Booking Outreach"] },
  { name: "Booking Analytics", route: "/booking-analytics",       section: "Pipeline" },
  { name: "Notes",             route: "/notes",                   section: "Pipeline" },
  { name: "Revenue Tools",     route: "/price-lists",             section: "Pipeline", aliases: ["Price Lists"] },
  // Operations
  { name: "Install & Deployments", route: "/install-workflows",       section: "Operations", aliases: ["Install Workflows"] },
  { name: "Deployments",       route: "/deployments",             section: "Operations" },
  { name: "Territory Routing", route: "/routing",                 section: "Operations", aliases: ["Routing"] },
  { name: "Winter Support",    route: "/winter",                  section: "Operations", aliases: ["Winter Hub"] },
  { name: "Projects",          route: "/execution/projects",      section: "Operations" },
  { name: "Procurement",       route: "/procurement",             section: "Operations" },
  { name: "Support",           route: "/support/tickets",         section: "Operations", aliases: ["Support Tickets", "Tickets"] },
  { name: "Communications",    route: "/execution/communications",section: "Operations" },
  { name: "Events",            route: "/operations/events",       section: "Operations", aliases: ["Tradeshow Events"] },
  { name: "Knowledge & Documents", route: "/documents",           section: "Operations", aliases: ["Document Hub", "Documents"] },
  { name: "Knowledge Assets",  route: "/knowledge/assets",        section: "Operations", aliases: ["Assets"] },
  { name: "Data Quality",      route: "/data-quality",            section: "Operations" },
  // Insights
  { name: "Executive Dashboard",    route: "/executive-dashboard",          section: "Insights" },
  { name: "Revenue Intelligence",   route: "/revenue-intelligence",         section: "Insights" },
  { name: "Revenue Hub",            route: "/revenue",                      section: "Insights" },
  { name: "Revenue Ops",            route: "/revenue-ops",                  section: "Insights" },
  { name: "Attribution",            route: "/analytics/source-attribution", section: "Insights", aliases: ["Source Attribution"] },
  { name: "Relationship Intelligence", route: "/intelligence/rel-intelligence", section: "Insights" },
  { name: "Cortex",                 route: "/executive-copilot",            section: "Insights", aliases: ["Executive Copilot", "Copilot"] },
  { name: "Cortex Intel Library",   route: "/cortex/intel",                 section: "Insights", aliases: ["Intel Library"] },
  { name: "Territory & Geo",        route: "/geography",                    section: "Insights", aliases: ["Geography", "Territory"] },
  { name: "Simulators & Feedback",  route: "/revenue-sim",                  section: "Insights", aliases: ["Revenue Simulator"] },
  { name: "Score Feedback",         route: "/scores/feedback",              section: "Insights" },
  // Ecosystem
  { name: "Partners",               route: "/strategy/partnerships/industry-associations", section: "Ecosystem", aliases: ["Industry Partnerships", "Industry"] },
  { name: "Channels",               route: "/strategy/partnerships/channel-commercial",    section: "Ecosystem", aliases: ["Dealers", "Resellers"] },
  { name: "Strategic Alliances",    route: "/strategy/partnerships/manufacturing",         section: "Ecosystem", aliases: ["Alliances", "Manufacturing"] },
  { name: "Government & Grants",    route: "/strategy/partnerships/government-public",     section: "Ecosystem", aliases: ["Government", "Grants"] },
  { name: "Referrals",              route: "/strategy/partnerships/other",                 section: "Ecosystem" },
  { name: "Events & Media",         route: "/strategy/partnerships/media-tradeshows",      section: "Ecosystem", aliases: ["Media & Tradeshows", "Media", "Tradeshows"] },
  // Marketing
  { name: "Marketing Dashboard",    route: "/marketing/dashboard",    section: "Marketing", aliases: ["Marketing"] },
  { name: "Campaigns",              route: "/marketing/campaigns",    section: "Marketing" },
  { name: "Audiences",              route: "/marketing/audiences",    section: "Marketing" },
  { name: "Engagement",             route: "/marketing/engagement",   section: "Marketing" },
  { name: "Replies",                route: "/marketing/replies",      section: "Marketing", aliases: ["Marketing Replies"] },
  { name: "Hot Accounts",           route: "/marketing/hot-accounts", section: "Marketing" },
  { name: "Compliance",             route: "/marketing/compliance",   section: "Marketing", aliases: ["Marketing Compliance"] },
  // Capital
  { name: "Capital Command Center", route: "/capital/command-center", section: "Capital", aliases: ["Command Center"] },
  { name: "Capital Dashboard",      route: "/capital/dashboard",      section: "Capital" },
  { name: "Investors",              route: "/capital/pipeline",       section: "Capital", aliases: ["Investor Pipeline"] },
  { name: "Investor Targets",       route: "/capital/targets",        section: "Capital", aliases: ["Targets"] },
  { name: "Investor Contacts",      route: "/capital/contacts",       section: "Capital" },
  { name: "Rounds & Commitments",   route: "/capital/rounds",         section: "Capital", aliases: ["Funding Rounds", "Rounds"] },
  { name: "Commitments",            route: "/capital/commitments",    section: "Capital" },
  { name: "Grants & Non-Dilutive",  route: "/capital/grants",         section: "Capital", aliases: ["Grants"] },
  { name: "Follow-Ups",             route: "/capital/follow-ups",     section: "Capital", aliases: ["Follow-Up Queue"] },
  { name: "Data Room",              route: "/capital/data-room",      section: "Capital" },
  { name: "Updates & Reviews",      route: "/capital/updates",        section: "Capital", aliases: ["Investor Updates"] },
  { name: "Capital Email Review",   route: "/capital/email-review",   section: "Capital", aliases: ["Email Review"] },
  // Learn
  { name: "Training",               route: "/training",               section: "Learn" },
  { name: "Help",                   route: "/help",                   section: "Learn" },
  // Admin
  { name: "Users & Roles",          route: "/admin/users",            section: "Admin", aliases: ["Users", "Admin Users"] },
  { name: "Task Hub Access",        route: "/admin/task-hub-access",  section: "Admin" },
  { name: "Role Manager",           route: "/admin/roles",            section: "Admin", aliases: ["Roles"] },
  { name: "Integrations",           route: "/admin/integrations",     section: "Admin" },
  { name: "Mailboxes & Signatures", route: "/settings/mailbox",       section: "Admin", aliases: ["My Mailboxes", "Mailboxes"] },
  { name: "User Signatures",        route: "/admin/signatures",       section: "Admin" },
  { name: "System Settings",        route: "/settings",               section: "Admin", aliases: ["Settings"] },
  { name: "Global Search",          route: "/search",                 section: "Admin" },
  { name: "Automations",            route: "/automations",            section: "Admin" },
];
