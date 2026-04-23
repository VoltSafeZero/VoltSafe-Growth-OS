import { useState, useEffect, useMemo } from "react";
import {
  Home, Users, LifeBuoy, Settings2, Building2, Contact, FileText, Mail,
  CalendarClock, FolderOpen, Tags, Zap, Settings, ChevronRight, Users2,
  ClipboardList, Layers, ShieldCheck, Sun, Moon, GitBranch, MapPin,
  LayoutDashboard, Target, Share2, Brain, SlidersHorizontal, BarChart3,
  Megaphone, TrendingUp, Landmark, Truck, Factory, FlaskConical, Newspaper,
  Circle, StickyNote, CheckSquare, RefreshCcw, Bell, BellRing, Sparkles, PlayCircle, Trophy, Package, Globe, BookOpen, FlaskRound, Snowflake, Search, GraduationCap, HelpCircle, Flame, Ghost,
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { Link, useLocation } from "wouter";
import voltSafeVIcon from "@assets/Screenshot_2026-04-15_at_7.26.57_PM_1776306420926.png";
import { Sidebar, SidebarContent, SidebarHeader } from "@/components/ui/sidebar";
import type { UserPermissions } from "@/App";

type AccessLevel = "none" | "view" | "edit";

type NavItem = {
  title: string;
  url: string;
  icon: React.ElementType;
  adminOnly?: boolean;
  exactMatch?: boolean;
  badge?: string;
  permKey?: keyof Pick<UserPermissions, "crm" | "partnerships" | "projects" | "communications" | "team_workload" | "knowledge" | "support" | "quoting" | "calendar">;
};

type NavSection = {
  id: string;
  label: string;
  icon?: React.ElementType;
  url?: string;
  items?: NavItem[];
  adminOnly?: boolean;
  isDivider?: boolean;
  permKey?: keyof Pick<UserPermissions, "crm" | "partnerships" | "projects" | "communications" | "team_workload" | "knowledge" | "support" | "quoting" | "calendar">;
};

const sections: NavSection[] = [
  {
    id: "today",
    label: "Today",
    icon: Sun,
    url: "/today",
  },

  // ── Growth OS ─────────────────────────────────────────────────────────────
  { id: "divider-growth", label: "GROWTH OS", isDivider: true },

  {
    id: "command-center",
    label: "Command Center",
    icon: LayoutDashboard,
    items: [
      { title: "Mission Control", url: "/", icon: LayoutDashboard, exactMatch: true },
      { title: "Daily Execution", url: "/execution/daily", icon: PlayCircle },
      { title: "Tasks Hub", url: "/execution/tasks", icon: CheckSquare },
      { title: "Activity Feed", url: "/activity", icon: BarChart3 },
      { title: "Executive Dashboard", url: "/executive-dashboard", icon: Trophy, permKey: "crm" },
      { title: "Reports", url: "/relationships", icon: TrendingUp },
      { title: "Forecasting", url: "/execution/forecast", icon: GitBranch },
      { title: "Source Attribution", url: "/analytics/source-attribution", icon: TrendingUp, permKey: "crm" },
    ],
  },

  {
    id: "relationships",
    label: "Relationships",
    icon: Users,
    permKey: "crm",
    items: [
      { title: "Contacts", url: "/contacts", icon: Contact, permKey: "crm" },
      { title: "Organizations", url: "/accounts", icon: Building2, permKey: "crm" },
      { title: "Notes", url: "/notes", icon: StickyNote },
    ],
  },

  {
    id: "revenue",
    label: "Revenue Engine",
    icon: Target,
    permKey: "crm",
    items: [
      { title: "Revenue Hub", url: "/revenue", icon: BarChart3, permKey: "crm" },
      { title: "Leads", url: "/opportunities", icon: Sparkles, permKey: "crm" },
      { title: "Pipeline", url: "/pipeline", icon: GitBranch, permKey: "crm" },
      { title: "Deals", url: "/revenue/deals", icon: Target, permKey: "crm" },
      { title: "Data Quality", url: "/data-quality", icon: ShieldCheck, permKey: "crm" },
      { title: "Install Workflows", url: "/install-workflows", icon: Layers, permKey: "crm" },
      { title: "Renewals", url: "/renewals", icon: RefreshCcw },
      { title: "Quotes", url: "/quotes", icon: FileText, permKey: "quoting" },
    ],
  },

  {
    id: "procurement",
    label: "Procurement & Mfg",
    icon: Package,
    permKey: "crm",
    items: [
      { title: "Procurement", url: "/procurement", icon: Package, permKey: "crm" },
      { title: "Deployments", url: "/deployments", icon: Layers, permKey: "crm" },
    ],
  },

  {
    id: "channels",
    label: "Growth Channels",
    icon: Share2,
    permKey: "partnerships",
    items: [
      { title: "Industry Partnerships", url: "/strategy/partnerships/industry-associations", icon: Users2 },
      { title: "Dealers / Resellers", url: "/strategy/partnerships/channel-commercial", icon: Truck },
      { title: "Strategic Alliances", url: "/strategy/partnerships/manufacturing", icon: Factory },
      { title: "Investors", url: "/strategy/partnerships/innovation-research", icon: FlaskConical },
      { title: "Govt & Grants", url: "/strategy/partnerships/government-public", icon: Landmark },
      { title: "Referrals", url: "/strategy/partnerships/other", icon: Circle },
      { title: "Media & Tradeshows", url: "/strategy/partnerships/media-tradeshows", icon: Newspaper },
    ],
  },

  {
    id: "intelligence",
    label: "Intelligence",
    icon: Brain,
    items: [
      { title: "Executive Copilot", url: "/executive-copilot", icon: Brain },
      { title: "Inbox", url: "/gmail", icon: Mail },
      { title: "Calendar", url: "/execution/calendar", icon: CalendarClock, permKey: "calendar" },
      { title: "Meeting Briefs", url: "/intelligence/briefs", icon: Sparkles },
      { title: "Signals & Alerts", url: "/intelligence/signals", icon: Bell },
      { title: "Digest & Alerts", url: "/alerts-digest", icon: BellRing },
      { title: "Score Feedback", url: "/scores/feedback", icon: Target },
      { title: "Rel. Intelligence", url: "/intelligence/rel-intelligence", icon: BarChart3 },
      { title: "Territory & Geo", url: "/geography", icon: Globe, permKey: "crm" },
      { title: "Territory Routing", url: "/routing", icon: MapPin },
      { title: "Revenue Simulator", url: "/revenue-sim", icon: FlaskRound },
      { title: "Revenue Ops", url: "/revenue-ops", icon: Target },
    ],
  },

  {
    id: "operations",
    label: "Operations",
    icon: SlidersHorizontal,
    items: [
      { title: "Projects", url: "/execution/projects", icon: Layers, permKey: "projects" },
      { title: "Communications", url: "/execution/communications", icon: Megaphone, permKey: "communications" },
      { title: "Document Hub", url: "/documents", icon: BookOpen },
      { title: "Assets", url: "/knowledge/assets", icon: FolderOpen, permKey: "knowledge" },
      { title: "Price Lists", url: "/price-lists", icon: Tags, permKey: "quoting" },
      { title: "Task Rules", url: "/automation/tasks", icon: Zap },
      { title: "Automations", url: "/automations", icon: Zap },
    ],
  },

  // ── Tools ─────────────────────────────────────────────────────────────────
  { id: "divider-tools", label: "TOOLS", isDivider: true },

  {
    id: "help",
    label: "Help Center",
    icon: BookOpen,
    url: "/help",
    items: [
      { title: "Quick Start Guide", url: "/help", icon: Zap },
      { title: "Operations Manual", url: "/help", icon: BookOpen },
      { title: "Training Handbook", url: "/help", icon: GraduationCap },
      { title: "FAQ & Glossary", url: "/help", icon: HelpCircle },
    ],
  },

  {
    id: "support",
    label: "Support",
    icon: LifeBuoy,
    permKey: "support",
    items: [
      { title: "Tickets", url: "/support/tickets", icon: ClipboardList },
      { title: "Winter Support", url: "/winter", icon: Snowflake },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    icon: Settings2,
    adminOnly: true,
    items: [
      { title: "Users", url: "/admin/users", icon: ShieldCheck },
      { title: "Integrations", url: "/admin/integrations", icon: Zap },
      { title: "My Mailboxes", url: "/settings/mailbox", icon: Mail },
      { title: "Global Search", url: "/search", icon: Search },
      { title: "Settings", url: "/settings", icon: Settings, exactMatch: true },
    ],
  },
];

function getActiveSectionId(location: string): string {
  if (location === "/") return "command-center";
  for (const section of sections) {
    if (section.isDivider) continue;
    if (section.url && location === section.url) return section.id;
    if (section.items?.some((item) => item.exactMatch ? location === item.url : location.startsWith(item.url) && item.url !== "/")) return section.id;
  }
  return "";
}

const DEFAULT_PERMISSIONS: UserPermissions = {
  crm: "edit", partnerships: "edit", projects: "edit",
  communications: "edit", team_workload: "edit", knowledge: "edit",
  support: "edit", quoting: "edit", calendar: "edit",
  mail_team: {}, calendar_team: [],
};

export function AppSidebar({
  userGlobalRole = "sales",
  userPermissions,
}: {
  userGlobalRole?: string;
  userPermissions?: UserPermissions;
}) {
  const isAdmin = ["master_admin", "admin"].includes(userGlobalRole);
  const perms: UserPermissions = userPermissions ?? DEFAULT_PERMISSIONS;
  const [location, navigate] = useLocation();
  const [openSection, setOpenSection] = useState<string>(() => getActiveSectionId(location));
  const { theme, setTheme } = useTheme();
  const isDemon = theme === "demon";
  const isDemonLight = theme === "demon-light";
  const isAnyDemon = isDemon || isDemonLight;
  const isDark = !isAnyDemon && (theme === "dark" || (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches));
  const isLight = !isAnyDemon && !isDark;

  useEffect(() => {
    const active = getActiveSectionId(location);
    if (active) setOpenSection(active);
  }, [location]);

  function canSeeSection(section: NavSection): boolean {
    if (section.isDivider) return true;
    if (section.adminOnly && !isAdmin) return false;
    if (isAdmin) return true;
    if (!section.permKey) return true;
    return (perms[section.permKey] as AccessLevel) !== "none";
  }

  function canSeeItem(item: NavItem): boolean {
    if (isAdmin) return true;
    if (item.adminOnly) return false;
    if (!item.permKey) return true;
    return (perms[item.permKey] as AccessLevel) !== "none";
  }

  const visibleSections = useMemo(() => {
    return sections.filter(s => canSeeSection(s)).map(s => ({
      ...s,
      items: s.items?.filter(item => canSeeItem(item)),
    })).filter(s => s.isDivider || !s.items || s.items.length > 0);
  }, [isAdmin, perms]);

  const handleSectionClick = (section: NavSection) => {
    if (section.url) {
      navigate(section.url);
      setOpenSection(section.id);
    } else {
      setOpenSection((prev) => (prev === section.id ? "" : section.id));
      if (section.items && section.items.length > 0) {
        const firstActive = section.items.find((item) => location.startsWith(item.url) && item.url !== "/");
        if (!firstActive) {
          const firstVisible = section.items.find(item => canSeeItem(item));
          if (firstVisible) navigate(firstVisible.url);
        }
      }
    }
  };

  return (
    <Sidebar className="border-r border-border/50">
      <SidebarHeader className="h-auto py-3 flex items-center px-4">
        <Link
          href="/"
          className="flex items-center gap-3 cursor-pointer transition-opacity hover:opacity-80 active:scale-[0.98]"
          data-testid="link-sidebar-home"
        >
          <img
            src={voltSafeVIcon}
            alt="VoltSafe V"
            className="h-[72px] w-[72px] object-cover object-center rounded-xl shrink-0"
          />
          <div className="flex flex-col items-center leading-tight">
            <span className="text-3xl font-bold tracking-tight text-foreground">VoltSafe</span>
            <span className="text-xl font-semibold text-primary tracking-tight">Growth OS</span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-3 py-1 overflow-y-auto">
        <nav className="flex flex-col gap-0.5">
          {visibleSections.map((section) => {
            if (section.isDivider) {
              return (
                <div key={section.id} className="px-3 pt-4 pb-1 flex items-center gap-2">
                  <span className="text-[10px] font-bold tracking-widest text-muted-foreground/50 uppercase select-none">
                    {section.label}
                  </span>
                  <div className="flex-1 h-px bg-border/30" />
                </div>
              );
            }

            const isSectionOpen = openSection === section.id;
            const isSectionActive = section.url
              ? location === section.url
              : section.items?.some((item) => item.exactMatch ? location === item.url : location.startsWith(item.url) && item.url !== "/") ?? false;
            const SectionIcon = section.icon!;

            return (
              <div key={section.id}>
                <button
                  onClick={() => handleSectionClick(section)}
                  data-testid={`nav-section-${section.id}`}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-sm font-medium group ${
                    isSectionActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                  }`}
                >
                  <SectionIcon className={`w-4 h-4 shrink-0 transition-colors ${isSectionActive ? "text-primary" : "group-hover:text-foreground"}`} />
                  <span className="flex-1 text-left">{section.label}</span>
                  {section.items && section.items.length > 0 && (
                    <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${isSectionOpen ? "rotate-90 text-primary" : "text-muted-foreground/50"}`} />
                  )}
                </button>

                {section.items && isSectionOpen && (
                  <div className="ml-3 mt-0.5 mb-1 pl-3 border-l border-border/40 flex flex-col gap-0.5">
                    {section.items.map((item) => {
                      const isItemActive = item.exactMatch
                        ? location === item.url
                        : location === item.url || (item.url !== "/" && location.startsWith(item.url));
                      const ItemIcon = item.icon;
                      return (
                        <Link
                          key={`${section.id}-${item.url}-${item.title}`}
                          href={item.url}
                          data-testid={`nav-${item.title.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                          className={`flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-all ${
                            isItemActive
                              ? "bg-primary/10 text-primary font-medium"
                              : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                          }`}
                        >
                          <ItemIcon className={`w-3.5 h-3.5 shrink-0 ${isItemActive ? "text-primary" : ""}`} />
                          <span className="flex-1">{item.title}</span>
                          {item.badge && (
                            <span className="text-[10px] font-semibold text-muted-foreground/60 bg-secondary/60 px-1.5 py-0.5 rounded-full">
                              {item.badge}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

        </nav>

        {/* Theme toggle — 4-segment pill: Light / Dark / Demon Dark / Demon Light.
            Demon Dark = the breach itself. Demon Light = the breach seen through
            haunted translucent glass. Both persist via localStorage ("vite-ui-theme"). */}
        <div className="px-3 py-3 border-t border-border/40 mt-auto shrink-0">
          <div
            className="w-full flex items-center justify-between px-3 py-2 rounded-md text-sm text-muted-foreground gap-2"
            data-testid="theme-toggle-row"
          >
            <span className="flex items-center gap-2.5 min-w-0">
              {isDemon ? (
                <Flame className="w-3.5 h-3.5 shrink-0 text-[hsl(355_75%_55%)]" />
              ) : isDemonLight ? (
                <Ghost className="w-3.5 h-3.5 shrink-0 text-[hsl(355_55%_42%)]" />
              ) : isDark ? (
                <Moon className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <Sun className="w-3.5 h-3.5 shrink-0" />
              )}
              <span className="truncate">
                {isDemon ? "Demon Dark" : isDemonLight ? "Demon Light" : isDark ? "Dark mode" : "Light mode"}
              </span>
            </span>
            <span
              role="radiogroup"
              aria-label="Appearance"
              className="flex items-center gap-0.5 bg-secondary rounded-full p-0.5 shrink-0"
            >
              <button
                role="radio"
                aria-checked={isLight}
                aria-label="Light mode"
                onClick={() => setTheme("light")}
                data-testid="button-theme-light"
                className={`w-5 h-5 rounded-full flex items-center justify-center transition-all ${
                  isLight ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Sun className="w-3 h-3" />
              </button>
              <button
                role="radio"
                aria-checked={isDark}
                aria-label="Dark mode"
                onClick={() => setTheme("dark")}
                data-testid="button-theme-dark"
                className={`w-5 h-5 rounded-full flex items-center justify-center transition-all ${
                  isDark ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Moon className="w-3 h-3" />
              </button>
              <button
                role="radio"
                aria-checked={isDemon}
                aria-label="Demon Dark mode"
                onClick={() => setTheme("demon")}
                data-testid="button-theme-demon"
                className={`w-5 h-5 rounded-full flex items-center justify-center transition-all ${
                  isDemon
                    ? "bg-[hsl(355_25%_4%)] text-[hsl(355_80%_60%)] shadow-[0_0_10px_-1px_hsl(355_80%_45%/0.7)]"
                    : "text-muted-foreground hover:text-[hsl(355_70%_55%)]"
                }`}
              >
                <Flame className="w-3 h-3" />
              </button>
              <button
                role="radio"
                aria-checked={isDemonLight}
                aria-label="Demon Light mode"
                onClick={() => setTheme("demon-light")}
                data-testid="button-theme-demon-light"
                className={`w-5 h-5 rounded-full flex items-center justify-center transition-all ${
                  isDemonLight
                    ? "bg-[hsl(350_18%_97%)] text-[hsl(355_55%_42%)] shadow-[0_0_8px_-1px_hsl(355_55%_55%/0.55)]"
                    : "text-muted-foreground hover:text-[hsl(355_55%_50%)]"
                }`}
              >
                <Ghost className="w-3 h-3" />
              </button>
            </span>
          </div>
        </div>
      </SidebarContent>
    </Sidebar>
  );
}
