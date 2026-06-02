import type React from "react";
import {
  Sun, Briefcase, Target, SlidersHorizontal, Brain, Share2, MoreHorizontal,
  Settings2, LayoutDashboard, Mail, CalendarClock, CheckSquare, BarChart3,
  Sparkles, GitBranch, Building2, Contact, FileText, RefreshCcw, Trophy,
  StickyNote, Layers, Package, Megaphone, BookOpen, FolderOpen, TrendingUp,
  Bell, Globe, Users2, Truck, Factory, FlaskConical, Landmark, Circle,
  Newspaper, PlayCircle, FlaskRound, BellRing, MapPin, ShieldCheck, Tags,
  Zap, HelpCircle, ClipboardList, Snowflake, Search, Settings, Smartphone,
  Mic, Car,
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
  permKey?: PermKey;
  isDivider?: boolean;
  showOn?: Platform[];
  advisorHidden?: boolean;
};

export function isAdvisorRole(globalRole: string): boolean {
  return globalRole === "advisor";
}

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
  {
    id: "work",
    label: "Work",
    icon: Briefcase,
    items: [
      { id: "mission-control", label: "Mission Control", route: "/",                    icon: LayoutDashboard, exactMatch: true },
      { id: "my-travel",       label: "My Travel",       route: "/my-travel",           icon: Car },
      { id: "inbox",           label: "Inbox",           route: "/gmail",               icon: Mail },
      { id: "tasks",           label: "Tasks",           route: "/execution/tasks",     icon: CheckSquare },
      { id: "calendar",        label: "Calendar",        route: "/execution/calendar",  icon: CalendarClock, permKey: "calendar" },
      { id: "meeting-notes",   label: "Meeting Notes",   route: "/meeting-notes",       icon: Mic },
      { id: "activity",        label: { desktop: "Activity Feed", mobile: "Activity" }, route: "/activity", icon: BarChart3 },
    ],
  },
  {
    id: "pipeline",
    label: "Pipeline",
    icon: Target,
    permKey: "crm",
    advisorHidden: true,
    items: [
      { id: "pipeline",  label: "Snapshot",  route: "/pipeline",      icon: GitBranch,   permKey: "crm",     advisorHidden: true },
      { id: "leads",     label: "Leads",     route: "/opportunities", icon: Sparkles,    permKey: "crm",     advisorHidden: true },
      { id: "accounts",  label: "Accounts",  route: "/accounts",      icon: Building2,   permKey: "crm",     advisorHidden: true },
      { id: "contacts",  label: "Contacts",  route: "/contacts",      icon: Contact,     permKey: "crm",     advisorHidden: true },
      { id: "quotes",    label: "Quotes",    route: "/quotes",        icon: FileText,    permKey: "quoting", advisorHidden: true },
      { id: "renewals",  label: "Renewals",  route: "/renewals",      icon: RefreshCcw,                      advisorHidden: true },
      { id: "won",       label: { desktop: "Accounts Won", mobile: "Won" }, route: "/revenue/deals", icon: Trophy, permKey: "crm", advisorHidden: true },
      { id: "booking-outreach", label: { desktop: "Booking Outreach", mobile: "Outreach" }, route: "/booking-outreach", icon: CalendarClock, permKey: "crm", advisorHidden: true },
      { id: "booking-analytics", label: { desktop: "Booking Analytics", mobile: "Analytics" }, route: "/booking-analytics", icon: TrendingUp, permKey: "crm", advisorHidden: true },
      { id: "notes",     label: "Notes",     route: "/notes",         icon: StickyNote },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    icon: SlidersHorizontal,
    items: [
      { id: "install-workflows", label: "Install Workflows", route: "/install-workflows",        icon: Layers,    permKey: "crm",          advisorHidden: true },
      { id: "procurement",       label: "Procurement",       route: "/procurement",              icon: Package,   permKey: "crm",          advisorHidden: true },
      { id: "deployments",       label: "Deployments",       route: "/deployments",              icon: Layers,    mobileIcon: Truck, permKey: "crm", advisorHidden: true },
      { id: "projects",          label: "Projects",          route: "/execution/projects",       icon: Layers,    permKey: "projects" },
      { id: "events",            label: "Events",            route: "/operations/events",         icon: Trophy },
      { id: "communications",    label: "Communications",    route: "/execution/communications", icon: Megaphone, permKey: "communications", advisorHidden: true },
      { id: "documents",         label: "Asset Library",     route: "/documents",                icon: BookOpen },
      { id: "assets",            label: "Assets",            route: "/knowledge/assets",         icon: FolderOpen, permKey: "knowledge" },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    icon: Brain,
    items: [
      { id: "exec-dashboard",     label: { desktop: "Executive Dashboard", mobile: "Exec Dashboard" }, route: "/executive-dashboard",          icon: Trophy,     permKey: "crm", advisorHidden: true },
      { id: "reports",            label: "Reports",                                                     route: "/relationships",                icon: TrendingUp },
      { id: "forecasting",        label: "Forecasting",                                                 route: "/execution/forecast",           icon: GitBranch,                  advisorHidden: true },
      { id: "source-attribution", label: "Source Attribution",                                          route: "/analytics/source-attribution", icon: TrendingUp, permKey: "crm", advisorHidden: true },
      { id: "copilot",            label: { desktop: "Executive Copilot",  mobile: "Copilot" },         route: "/executive-copilot",            icon: Brain },
      { id: "briefs",             label: { desktop: "Meeting Briefs",     mobile: "Briefs"  },         route: "/intelligence/briefs",          icon: Sparkles },
      { id: "signals",            label: { desktop: "Signals & Alerts",   mobile: "Signals" },         route: "/intelligence/signals",         icon: Bell, mobileIcon: SlidersHorizontal },
      { id: "territory",          label: { desktop: "Territory & Geo",    mobile: "Territory" },       route: "/geography",                    icon: Globe,      permKey: "crm", advisorHidden: true },
    ],
  },
  {
    id: "channels",
    label: "Channels",
    icon: Share2,
    permKey: "partnerships",
    advisorHidden: true,
    items: [
      { id: "industry",  label: { desktop: "Industry Partnerships", mobile: "Industry" }, route: "/strategy/partnerships/industry-associations", icon: Users2,      advisorHidden: true },
      { id: "dealers",   label: { desktop: "Dealers / Resellers",   mobile: "Dealers"  }, route: "/strategy/partnerships/channel-commercial",    icon: Truck,       advisorHidden: true },
      { id: "alliances", label: { desktop: "Strategic Alliances",   mobile: "Alliances"}, route: "/strategy/partnerships/manufacturing",         icon: Factory,     advisorHidden: true },
      { id: "investors", label: "Investors",                                              route: "/strategy/partnerships/innovation-research",   icon: FlaskConical, advisorHidden: true },
      { id: "govt",      label: "Govt & Grants",                                          route: "/strategy/partnerships/government-public",     icon: Landmark,    advisorHidden: true },
      { id: "referrals", label: "Referrals",                                              route: "/strategy/partnerships/other",                 icon: Circle,      advisorHidden: true },
      { id: "media",     label: { desktop: "Media & Tradeshows",    mobile: "Media"    }, route: "/strategy/partnerships/media-tradeshows",      icon: Newspaper,   advisorHidden: true },
    ],
  },
  {
    id: "more",
    label: "More",
    icon: MoreHorizontal,
    items: [
      { id: "daily-execution",   label: "Daily Execution",   route: "/execution/daily",                icon: PlayCircle },
      { id: "revenue-hub",       label: "Revenue Hub",       route: "/revenue",                        icon: BarChart3,   permKey: "crm", exactMatch: true, advisorHidden: true },
      { id: "revenue-ops",       label: "Revenue Ops",       route: "/revenue-ops",                    icon: Target,                                         advisorHidden: true },
      { id: "revenue-sim",       label: "Revenue Simulator", route: "/revenue-sim",                    icon: FlaskRound,                                     advisorHidden: true },
      { id: "rel-intelligence",  label: "Rel. Intelligence", route: "/intelligence/rel-intelligence",  icon: BarChart3 },
      { id: "score-feedback",    label: "Score Feedback",    route: "/scores/feedback",                icon: Target,                                         advisorHidden: true },
      { id: "digest-alerts",     label: "Digest & Alerts",   route: "/alerts-digest",                  icon: BellRing },
      { id: "territory-routing", label: "Territory Routing", route: "/routing",                        icon: MapPin,                                         advisorHidden: true },
      { id: "data-quality",      label: "Data Quality",      route: "/data-quality",                   icon: ShieldCheck, permKey: "crm",                   advisorHidden: true },
      { id: "price-lists",       label: "Price Lists",       route: "/price-lists",                    icon: Tags,        permKey: "quoting",               advisorHidden: true },
      { id: "task-rules",        label: "Task Rules",        route: "/automation/tasks",               icon: Zap },
      { id: "automations",       label: "Automations",       route: "/automations",                    icon: Zap },
      { id: "help",              label: "Help",              route: "/help",                           icon: HelpCircle },
      { id: "tickets",           label: { desktop: "Support Tickets", mobile: "Tickets" }, route: "/support/tickets", icon: ClipboardList, permKey: "support" },
      { id: "winter-support",    label: "Winter Support",    route: "/winter",                         icon: Snowflake,   permKey: "support" },
    ],
  },
  // Desktop-only divider above the Admin section.
  { id: "divider-admin", label: "ADMIN", isDivider: true, adminOnly: true, showOn: ["desktop"] },
  {
    id: "admin",
    label: "Admin",
    icon: Settings2,
    adminOnly: true,
    items: [
      { id: "admin-users",        label: "Users",                                          route: "/admin/users",             icon: ShieldCheck, adminOnly: true },
      { id: "admin-task-access",  label: "Task Hub Access",                                route: "/admin/task-hub-access",   icon: CheckSquare, adminOnly: true },
      { id: "admin-integrations", label: "Integrations",                                   route: "/admin/integrations",      icon: Zap,         adminOnly: true },
      { id: "admin-mailboxes",    label: { desktop: "My Mailboxes", mobile: "Mailboxes" }, route: "/settings/mailbox",        icon: Mail,        adminOnly: true },
      { id: "admin-search",       label: "Global Search",                                  route: "/search",                  icon: Search,      adminOnly: true },
      { id: "admin-settings",     label: "Settings",                                       route: "/settings",                icon: Settings,    adminOnly: true, exactMatch: true },
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
