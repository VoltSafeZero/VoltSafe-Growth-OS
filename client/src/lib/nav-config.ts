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
  Radio, Ban, Flame, Banknote, Activity, Bot, AtSign,
} from "lucide-react";

// Note: a few items intentionally use a different icon on mobile than on desktop
// (e.g. Deployments is a Truck on the phone where the field crew thinks of it
// as a delivery, but Layers on the wide-screen pipeline view). Use `mobileIcon`
// for that override; otherwise the single `icon` is used on both surfaces.
import type { UserPermissions } from "@/App";
import { PRIVILEGED_SALES_ROLES } from "@shared/rbac";

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
  /** Restrict this item to a specific globalRole allowlist (admins always bypass). */
  allowedGlobalRoles?: string[];
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
  //   Work Calendar (/work/team-calendar),
  //   Activity Feed (/activity), Travel (/my-travel), Personal Settings hub (/settings/personal)
  // Email Signatures + AI Voice Profiles moved to Settings section.
  {
    id: "work",
    label: "Work",
    icon: Briefcase,
    items: [
      { id: "daily-exec",      label: "Daily Execution",    route: "/execution/daily",        icon: CalendarDays },
      { id: "mission-control", label: "Mission Control",    route: "/",                       icon: LayoutDashboard, exactMatch: true },
      { id: "inbox",           label: "Inbox & Mail",       route: "/gmail",                  icon: Mail },
      { id: "tasks",           label: "Tasks",              route: "/execution/tasks",        icon: CheckSquare },
      { id: "calendar",        label: "Calendar & Meetings",route: "/execution/calendar",     icon: CalendarClock, permKey: "calendar" },
      { id: "mentions",        label: "My Mentions",        route: "/mentions",               icon: AtSign },
      // nav-drift phase 4B: { label: "Digest Settings", route: "/alerts-digest" } — accessible via ⌘K
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
      { id: "outreach",       label: "Outreach",         route: "/booking-outreach", icon: CalendarClock, permKey: "crm", advisorHidden: true },
      { id: "leads-accounts", label: "Leads & Accounts", route: "/opportunities",    icon: Building2, permKey: "crm",     advisorHidden: true },
      { id: "contacts",            label: "Contacts",            route: "/contacts",             icon: Contact,    permKey: "crm",     advisorHidden: true },
      { id: "potential-investors", label: "Potential Investors",  route: "/potential-investors",  icon: TrendingUp, permKey: "crm",     advisorHidden: true },
      { id: "quotes-renewals",     label: "Quotes & Renewals",   route: "/quotes",               icon: FileText,   permKey: "quoting", advisorHidden: true },
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
      { id: "projects",              label: "Projects",              route: "/execution/projects", icon: Layers,       permKey: "projects" },
      { id: "install-deployments",   label: "Install & Deployments", route: "/install-workflows",  icon: Layers,       permKey: "crm",      advisorHidden: true },
      { id: "procurement",           label: "Procurement",           route: "/procurement",        icon: Package,      permKey: "crm",      advisorHidden: true },
      { id: "support",               label: "Support",               route: "/support/tickets",    icon: ClipboardList,permKey: "support" },
      { id: "knowledge-documents",   label: "Document Hub",          route: "/documents",          icon: BookOpen },
      { id: "data-quality",          label: "Data Quality",          route: "/data-quality",       icon: ShieldCheck,  permKey: "crm",      advisorHidden: true },
      // ⌘K accessible: route: "/routing" (Territory Routing), route: "/winter" (Winter Support)
      // { label: "Knowledge Assets", route: "/knowledge/assets" }
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
      { id: "rel-intelligence",     label: "Relationship Intelligence",                                  route: "/intelligence/rel-intelligence", icon: BarChart3 },
      { id: "cortex",               label: "Cortex",                                                     route: "/executive-copilot",             icon: Brain }, // "copilot" alias; "cortex-intel-library" at /cortex/intel
      { id: "simulators-feedback",  label: { desktop: "Simulators & Feedback", mobile: "Simulators" },  route: "/revenue-sim",                   icon: FlaskRound, advisorHidden: true, allowedGlobalRoles: PRIVILEGED_SALES_ROLES },
      // ⌘K accessible: route: "/revenue" (Revenue Hub), route: "/revenue-ops" (Revenue Ops), route: "/scores/feedback" (Score Feedback)
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
      { id: "channels-item", label: "Commercial",                                                route: "/strategy/partnerships/channel-commercial",    icon: Truck,   advisorHidden: true },
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
      { id: "marketing-hot-accounts", label: "Hot Accounts", route: "/marketing/hot-accounts", icon: Flame },
      { id: "marketing-engagement",   label: "Engagement",   route: "/marketing/engagement",   icon: MessageSquare },
      { id: "marketing-dashboard",    label: "Dashboard",    route: "/marketing/dashboard",    icon: LayoutDashboard },
      { id: "marketing-campaigns",    label: "Campaigns",    route: "/marketing/campaigns",    icon: Radio },
      { id: "marketing-audiences",    label: "Audiences",    route: "/marketing/audiences",    icon: Users2 },
      { id: "marketing-compliance",   label: "Compliance",   route: "/marketing/compliance",   icon: ShieldCheck },
      { id: "marketing-email-tools",  label: "Email Tools",  route: "/marketing/email-tools",  icon: StickyNote },
    ],
  },

  // ── CAPITAL (6 items, capitalOnly) ─────────────────────────────────────────
  // Removed from sidebar (still accessible via direct URL / ⌘K):
  //   capital-pipeline: Investor Pipeline (/capital/pipeline) → now "Investors" under capital-investors
  //   capital-targets: Investor Targets (/capital/targets)
  //   capital-contacts: Investor Contacts (/capital/contacts)
  //   capital-rounds: Funding Rounds (/capital/rounds) → now "Rounds & Commitments"
  //   capital-commitments: Commitments (/capital/commitments)
  //   capital-grants: Grants & Non-Dilutive (/capital/grants)
  //   capital-updates: Investor Updates (/capital/updates) → now "Updates & Reviews"
  {
    id: "capital",
    label: "Capital",
    icon: Banknote,
    capitalOnly: true,
    items: [
      { id: "capital-follow-ups",     label: "Follow-Ups",          route: "/capital/follow-ups",     icon: Zap },
      { id: "capital-command-center", label: "Command Center",      route: "/capital/command-center", icon: Target },
      // capital-dashboard (/capital/dashboard) + capital-email-review (/capital/email-review) rolled into Command Center above.
      { id: "capital-copilot",        label: "AI Copilot",          route: "/capital/copilot",        icon: Bot },
      { id: "capital-rounds",         label: "Rounds & Commitments",route: "/capital/rounds",         icon: RefreshCcw },
      { id: "capital-engagement",     label: "Engagement",          route: "/capital/engagement",     icon: Activity },
      { id: "capital-investors",      label: "Investors",           route: "/capital/pipeline",       icon: TrendingUp },
      { id: "capital-reports",        label: "Reports",             route: "/capital/reports",        icon: FileText },
      { id: "capital-data-room",      label: "Data Room",           route: "/capital/data-room",      icon: FolderOpen },
      { id: "capital-updates",        label: "Updates & Reviews",   route: "/capital/updates",        icon: BellRing },
    ],
  },

  // ── FEED CORTEX — teach Cortex new intelligence via URL ingestion ───────────
  {
    id: "feed-cortex",
    label: "Feed CORTEX",
    icon: Brain,
    url: "/feed-cortex",
    items: [
      { id: "feed-cortex-home", label: "Feed CORTEX", route: "/feed-cortex", icon: Brain, showOn: ["mobile"] },
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

  // ── SETTINGS (2 items) ─────────────────────────────────────────────────────
  // User configuration pages moved out of Work for a cleaner Work section.
  {
    id: "settings",
    label: "Settings",
    icon: SlidersHorizontal,
    items: [
      { id: "signatures",     label: "Email Signatures",  route: "/settings/signatures",    icon: PenSquare },
      { id: "voice-profiles", label: "AI Voice Profiles", route: "/settings/voice-profiles",icon: Mic },
    ],
  },

  // Desktop-only divider above the Admin section.
  { id: "divider-admin", label: "ADMIN", isDivider: true, adminOnly: true, showOn: ["desktop"] },

  // ── ADMIN (9 items) ────────────────────────────────────────────────────────
  {
    id: "admin",
    label: "Admin",
    icon: Settings2,
    adminOnly: true,
    items: [
      { id: "admin-users",       label: "Users & Roles",           route: "/admin/users",           icon: ShieldCheck, adminOnly: true },
      { id: "admin-integrations",label: "Integrations",            route: "/admin/integrations",    icon: Zap,         adminOnly: true },
      { id: "admin-mailboxes",   label: "Mailboxes & Signatures",  route: "/settings/mailbox",      icon: Mail,        adminOnly: true },
      { id: "admin-settings",    label: "System Settings",         route: "/settings",              icon: Settings,    adminOnly: true, exactMatch: true },
      { id: "automations",       label: "Automations",             route: "/automations",           icon: Zap },
      { id: "admin-task-hub",    label: "Task Hub Access",         route: "/admin/task-hub-access", icon: Users2,      adminOnly: true },
      { id: "admin-roles",       label: "Role Manager",            route: "/admin/roles",           icon: Settings2,   adminOnly: true },
      { id: "admin-search",      label: "Search",                  route: "/search",                icon: Search,      adminOnly: true },
      { id: "admin-signatures",  label: "User Signatures",   route: "/admin/signatures",         icon: PenSquare,      adminOnly: true },
      { id: "admin-knowledge",   label: "Knowledge Rebuild", route: "/admin/knowledge-rebuild",   icon: Bot,            adminOnly: true },
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
  allowedGlobalRoles?: string[];
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
              allowedGlobalRoles: item.allowedGlobalRoles,
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
  allowedGlobalRoles?: string[];
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
          allowedGlobalRoles: item.allowedGlobalRoles,
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
  url: string;
  section: string;
  aliases?: string[];
  capitalOnly?: true;
  adminOnly?: true;
};

export const PAGE_NAV_INDEX: PageNavEntry[] = [
  // Today / Work
  { name: "Today",             url: "/today",                   section: "Work" },
  { name: "Mission Control",   url: "/",                        section: "Work" },
  { name: "Inbox & Mail",      url: "/gmail",                   section: "Work", aliases: ["Inbox", "Email", "Gmail"] },
  { name: "Tasks",             url: "/execution/tasks",         section: "Work", aliases: ["Tasks", "Task Hub", "Tasks & Execution"] },
  { name: "Daily Execution",   url: "/execution/daily",         section: "Work" },
  { name: "Calendar & Meetings",url: "/execution/calendar",     section: "Work", aliases: ["Calendar"] },
  { name: "Work Calendar",     url: "/work/team-calendar",      section: "Work", aliases: ["Team Calendar"] },
  { name: "Meeting Notes",     url: "/execution/calendar",      section: "Work", aliases: ["Meeting Recorder", "Recorder"] },
  { name: "Activity Feed",     url: "/activity",                section: "Work", aliases: ["Activity"] },
  { name: "Travel",            url: "/my-travel",               section: "Work", aliases: ["My Travel"] },
  { name: "Personal Settings", url: "/settings/personal",       section: "Work" },
  { name: "My Mentions",       url: "/mentions",                section: "Work", aliases: ["Mentions", "@mentions", "Notifications"] },
  { name: "Email Signatures",  url: "/settings/signatures",     section: "Settings", aliases: ["Signatures"] },
  { name: "AI Voice Profiles", url: "/settings/voice-profiles", section: "Settings", aliases: ["Voice Profiles"] },
  { name: "Digest Settings",   url: "/alerts-digest",           section: "Work", aliases: ["Digest", "Alerts"] },
  // Pipeline
  { name: "Snapshot",          url: "/pipeline",                section: "Pipeline", aliases: ["Pipeline"] },
  { name: "Leads & Accounts",  url: "/opportunities",           section: "Pipeline", aliases: ["Leads", "Opportunities"] },
  { name: "Accounts",          url: "/accounts",                section: "Pipeline" },
  { name: "Contacts",          url: "/contacts",                section: "Pipeline" },
  { name: "Quotes & Renewals", url: "/quotes",                  section: "Pipeline", aliases: ["Quotes"] },
  { name: "Renewals",          url: "/renewals",                section: "Pipeline" },
  { name: "Accounts Won",      url: "/revenue/deals",           section: "Pipeline", aliases: ["Won"] },
  { name: "Outreach",          url: "/booking-outreach",        section: "Pipeline", aliases: ["Booking Outreach"] },
  { name: "Booking Analytics", url: "/booking-analytics",       section: "Pipeline" },
  { name: "Notes",             url: "/notes",                   section: "Pipeline" },
  { name: "Revenue Tools",     url: "/price-lists",             section: "Pipeline", aliases: ["Price Lists"] },
  // Operations
  { name: "Install & Deployments", url: "/install-workflows",       section: "Operations", aliases: ["Install Workflows"] },
  { name: "Deployments",       url: "/deployments",             section: "Operations" },
  { name: "Territory Routing", url: "/routing",                 section: "Operations", aliases: ["Routing"] },
  { name: "Winter Support",    url: "/winter",                  section: "Operations", aliases: ["Winter Hub"] },
  { name: "Projects",          url: "/execution/projects",      section: "Operations" },
  { name: "Procurement",       url: "/procurement",             section: "Operations" },
  { name: "Support",           url: "/support/tickets",         section: "Operations", aliases: ["Support Tickets", "Tickets"] },
  { name: "Communications",    url: "/execution/communications",section: "Operations" },
  { name: "Events",            url: "/operations/events",       section: "Operations", aliases: ["Tradeshow Events"] },
  { name: "Knowledge & Documents", url: "/documents",           section: "Operations", aliases: ["Document Hub", "Documents"] },
  { name: "Knowledge Assets",  url: "/knowledge/assets",        section: "Operations", aliases: ["Assets"] },
  { name: "Data Quality",      url: "/data-quality",            section: "Operations" },
  // Insights
  { name: "Executive Dashboard",    url: "/executive-dashboard",          section: "Insights" },
  { name: "Revenue Intelligence",   url: "/revenue-intelligence",         section: "Insights" },
  { name: "Revenue Hub",            url: "/revenue",                      section: "Insights" },
  { name: "Revenue Ops",            url: "/revenue-ops",                  section: "Insights" },
  { name: "Attribution",            url: "/analytics/source-attribution", section: "Insights", aliases: ["Source Attribution"] },
  { name: "Relationship Intelligence", url: "/intelligence/rel-intelligence", section: "Insights" },
  { name: "Cortex",                 url: "/executive-copilot",            section: "Insights", aliases: ["Executive Copilot", "Copilot"] },
  { name: "Cortex Intel Library",   url: "/cortex/intel",                 section: "Insights", aliases: ["Intel Library"] },
  { name: "Territory & Geo",        url: "/geography",                    section: "Insights", aliases: ["Geography", "Territory"] },
  { name: "Simulators & Feedback",  url: "/revenue-sim",                  section: "Insights", aliases: ["Revenue Simulator"] },
  { name: "Score Feedback",         url: "/scores/feedback",              section: "Insights" },
  // Ecosystem
  { name: "Partners",               url: "/strategy/partnerships/industry-associations", section: "Ecosystem", aliases: ["Industry Partnerships", "Industry"] },
  { name: "Channels",               url: "/strategy/partnerships/channel-commercial",    section: "Ecosystem", aliases: ["Dealers", "Resellers"] },
  { name: "Strategic Alliances",    url: "/strategy/partnerships/manufacturing",         section: "Ecosystem", aliases: ["Alliances", "Manufacturing"] },
  { name: "Government & Grants",    url: "/strategy/partnerships/government-public",     section: "Ecosystem", aliases: ["Government", "Grants"] },
  { name: "Referrals",              url: "/strategy/partnerships/other",                 section: "Ecosystem" },
  { name: "Events & Media",         url: "/strategy/partnerships/media-tradeshows",      section: "Ecosystem", aliases: ["Media & Tradeshows", "Media", "Tradeshows"] },
  // Marketing
  { name: "Marketing Dashboard",    url: "/marketing/dashboard",    section: "Marketing", aliases: ["Marketing"] },
  { name: "Campaigns",              url: "/marketing/campaigns",    section: "Marketing" },
  { name: "Audiences",              url: "/marketing/audiences",    section: "Marketing" },
  { name: "Engagement",             url: "/marketing/engagement",   section: "Marketing" },
  { name: "Replies",                url: "/marketing/replies",      section: "Marketing", aliases: ["Marketing Replies"] },
  { name: "Hot Accounts",           url: "/marketing/hot-accounts", section: "Marketing" },
  { name: "Compliance",             url: "/marketing/compliance",   section: "Marketing", aliases: ["Marketing Compliance"] },
  { name: "Email Tools",            url: "/marketing/email-tools",  section: "Marketing", aliases: ["Snippets", "Canned Replies", "Canned Responses", "Email Templates", "Saved Replies"] },
  { name: "Snippets & Templates",   url: "/marketing/email-tools",  section: "Marketing", aliases: ["Snippets", "Templates", "Canned Responses"] },
  // Capital — all entries are capitalOnly: true (hidden from non-CEO/CFO users in global search)
  { name: "Capital Command Center", url: "/capital/command-center", section: "Capital", capitalOnly: true, aliases: ["Command Center"] },
  { name: "Capital Dashboard",      url: "/capital/dashboard",      section: "Capital", capitalOnly: true },
  { name: "Investors",              url: "/capital/pipeline",       section: "Capital", capitalOnly: true, aliases: ["Investor Pipeline"] },
  { name: "Investor Targets",       url: "/capital/targets",        section: "Capital", capitalOnly: true, aliases: ["Targets"] },
  { name: "Investor Contacts",      url: "/capital/contacts",       section: "Capital", capitalOnly: true },
  { name: "Rounds & Commitments",   url: "/capital/rounds",         section: "Capital", capitalOnly: true, aliases: ["Funding Rounds", "Rounds"] },
  { name: "Commitments",            url: "/capital/commitments",    section: "Capital", capitalOnly: true },
  { name: "Grants & Non-Dilutive",  url: "/capital/grants",         section: "Capital", capitalOnly: true, aliases: ["Grants"] },
  { name: "Follow-Ups",             url: "/capital/follow-ups",     section: "Capital", capitalOnly: true, aliases: ["Follow-Up Queue"] },
  { name: "Data Room",              url: "/capital/data-room",      section: "Capital", capitalOnly: true, aliases: ["Capital Data Room"] },
  { name: "Updates & Reviews",      url: "/capital/updates",        section: "Capital", capitalOnly: true, aliases: ["Investor Updates"] },
  { name: "Capital Email Review",   url: "/capital/email-review",   section: "Capital", capitalOnly: true, aliases: ["Email Review"] },
  { name: "Investor Engagement",    url: "/capital/engagement",     section: "Capital", capitalOnly: true, aliases: ["Capital Engagement", "Engagement Analytics"] },
  { name: "Capital Reports",        url: "/capital/reports",        section: "Capital", capitalOnly: true, aliases: ["Board Report", "CFO Report", "Investor Reports"] },
  { name: "Capital AI Copilot",     url: "/capital/copilot",        section: "Capital", capitalOnly: true, aliases: ["Capital Copilot", "Investor Copilot"] },
  // Feed CORTEX
  { name: "Feed CORTEX",            url: "/feed-cortex",            section: "Feed CORTEX", aliases: ["Feed Cortex", "Cortex Ingestion", "URL Ingestion", "Teach Cortex"] },
  // Learn
  { name: "Training",               url: "/training",               section: "Learn" },
  { name: "Help",                   url: "/help",                   section: "Learn" },
  // Grouped landing pages (Nav Consolidation Phase 2)
  { name: "Inbox & Mail",          url: "/work/inbox-mail",              section: "Work",      aliases: ["Inbox Hub", "Mail Hub"] },
  { name: "Tasks & Execution",     url: "/work/tasks-execution",         section: "Work",      aliases: ["Task Hub Overview", "Execution Hub"] },
  { name: "Calendar & Meetings",   url: "/work/calendar-meetings",       section: "Work",      aliases: ["Meetings Hub", "Calendar Hub"] },
  { name: "Personal Settings",     url: "/work/personal-settings",       section: "Work",      aliases: ["My Settings", "Preferences Hub"] },
  { name: "Leads & Accounts Hub",  url: "/pipeline/leads-accounts",      section: "Pipeline",  aliases: ["CRM Hub", "Leads Hub"] },
  { name: "Quotes & Renewals Hub", url: "/pipeline/quotes-renewals",     section: "Pipeline",  aliases: ["Quotes Hub"] },
  { name: "Outreach Hub",          url: "/pipeline/outreach",            section: "Pipeline",  aliases: ["Booking Outreach Hub"] },
  { name: "Revenue Tools Hub",     url: "/pipeline/revenue-tools",       section: "Pipeline",  aliases: ["Price Lists Hub"] },
  { name: "Install & Deployments Hub", url: "/operations/install-deployments", section: "Operations", aliases: ["Deployments Hub", "Install Hub"] },
  { name: "Support Hub",           url: "/operations/support",           section: "Operations", aliases: ["Tickets Hub", "Support Overview"] },
  { name: "Knowledge & Documents Hub", url: "/operations/knowledge-documents", section: "Operations", aliases: ["Docs Hub", "Documents Hub"] },
  { name: "Revenue Intelligence Hub", url: "/insights/revenue-intelligence", section: "Insights", aliases: ["Rev Intel Hub"] },
  { name: "Cortex Hub",            url: "/insights/cortex",              section: "Insights",  aliases: ["AI Hub", "Copilot Hub"] },
  { name: "Simulators & Feedback Hub", url: "/insights/simulators-feedback", section: "Insights", aliases: ["Simulator Hub"] },
  { name: "Partners Hub",          url: "/ecosystem/partners",           section: "Ecosystem", aliases: ["Partnership Hub", "Industry Hub"] },
  { name: "Channels Hub",          url: "/ecosystem/channels",           section: "Ecosystem", aliases: ["Channel Partners Hub", "Gov Grants Hub"] },
  { name: "Events & Media Hub",    url: "/ecosystem/events-media",       section: "Ecosystem", aliases: ["Events Hub", "Media Hub"] },
  { name: "Users & Roles Hub",     url: "/admin/users-roles",            section: "Admin",     aliases: ["User Management Hub", "Role Hub"],                   adminOnly: true },
  { name: "Mailboxes & Signatures Hub", url: "/admin/mailboxes-signatures", section: "Admin",  aliases: ["Mailbox Hub", "Signature Admin Hub"],               adminOnly: true },
  { name: "System Settings Hub",   url: "/admin/system-settings",        section: "Admin",     aliases: ["Settings Hub", "Admin Settings Hub", "Config Hub"], adminOnly: true },
  // Admin
  { name: "Users & Roles",          url: "/admin/users",            section: "Admin", aliases: ["Users", "Admin Users"],    adminOnly: true },
  { name: "Task Hub Access",        url: "/admin/task-hub-access",  section: "Admin",                                      adminOnly: true },
  { name: "Role Manager",           url: "/admin/roles",            section: "Admin", aliases: ["Roles"],                  adminOnly: true },
  { name: "Integrations",           url: "/admin/integrations",     section: "Admin",                                      adminOnly: true },
  { name: "Mailboxes & Signatures", url: "/settings/mailbox",       section: "Admin", aliases: ["My Mailboxes", "Mailboxes"], adminOnly: true },
  { name: "User Signatures",        url: "/admin/signatures",       section: "Admin",                                      adminOnly: true },
  { name: "System Settings",        url: "/settings",               section: "Admin", aliases: ["Settings"],               adminOnly: true },
  { name: "Global Search",          url: "/search",                 section: "Admin",                                      adminOnly: true },
  { name: "Automations",            url: "/automations",            section: "Admin",                                      adminOnly: true },
];
