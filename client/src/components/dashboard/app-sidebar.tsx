import { useState, useEffect, useMemo } from "react";
import {
  Home, Users, LifeBuoy, Settings2, Building2, Contact, FileText, Mail,
  CalendarClock, FolderOpen, Tags, Zap, Settings, ChevronRight, Users2,
  ClipboardList, Layers, ShieldCheck, Sun, Moon, GitBranch, Search, X,
  LayoutDashboard, Target, Share2, Brain, SlidersHorizontal, BarChart3,
  Megaphone, TrendingUp, Landmark, Truck, Factory, FlaskConical, Newspaper,
  Circle, StickyNote, CheckSquare, RefreshCcw, Bell, Sparkles, PlayCircle, Trophy, Package, Globe, BookOpen,
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { Link, useLocation } from "wouter";
import navLogo from "@assets/nav-logo.png";
import { Sidebar, SidebarContent, SidebarHeader } from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
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
      { title: "Command Center", url: "/", icon: LayoutDashboard, exactMatch: true },
      { title: "Activity Feed", url: "/activity", icon: BarChart3 },
      { title: "Reports", url: "/relationships", icon: TrendingUp },
      { title: "Forecasting", url: "/execution/forecast", icon: GitBranch },
      { title: "Source Attribution", url: "/analytics/source-attribution", icon: TrendingUp, permKey: "crm" },
      { title: "Executive Dashboard", url: "/executive-dashboard", icon: Trophy, permKey: "crm" },
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
      { title: "Tasks Hub", url: "/execution/tasks", icon: CheckSquare },
      { title: "Daily Execution", url: "/execution/daily", icon: PlayCircle },
    ],
  },

  {
    id: "revenue",
    label: "Revenue Engine",
    icon: Target,
    permKey: "crm",
    items: [
      { title: "Revenue Hub", url: "/revenue", icon: BarChart3, permKey: "crm" },
      { title: "Opportunities", url: "/opportunities", icon: Sparkles, permKey: "crm" },
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
      { title: "Inbox", url: "/gmail", icon: Mail },
      { title: "Calendar", url: "/execution/calendar", icon: CalendarClock, permKey: "calendar" },
      { title: "Meeting Briefs", url: "/intelligence/briefs", icon: Sparkles },
      { title: "Signals & Alerts", url: "/intelligence/signals", icon: Bell },
      { title: "Rel. Intelligence", url: "/intelligence/rel-intelligence", icon: BarChart3 },
      { title: "Territory & Geo", url: "/geography", icon: Globe, permKey: "crm" },
    ],
  },

  {
    id: "operations",
    label: "Operations",
    icon: SlidersHorizontal,
    items: [
      { title: "Segments", url: "/segments", icon: Users2 },
      { title: "Tags", url: "/tags", icon: Tags },
      { title: "Automations", url: "/automations", icon: Zap },
      { title: "Task Rules", url: "/automation/tasks", icon: Zap },
      { title: "Imports / Exports", url: "/imports", icon: FolderOpen },
      { title: "Projects", url: "/execution/projects", icon: Layers, permKey: "projects" },
      { title: "Communications", url: "/execution/communications", icon: Megaphone, permKey: "communications" },
      { title: "Document Hub", url: "/documents", icon: BookOpen },
      { title: "Assets", url: "/knowledge/assets", icon: FolderOpen, permKey: "knowledge" },
      { title: "Price Lists", url: "/price-lists", icon: Tags, permKey: "quoting" },
    ],
  },

  // ── Tools ─────────────────────────────────────────────────────────────────
  { id: "divider-tools", label: "TOOLS", isDivider: true },

  {
    id: "support",
    label: "Support",
    icon: LifeBuoy,
    permKey: "support",
    items: [
      { title: "Tickets", url: "/support/tickets", icon: ClipboardList },
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
      { title: "Settings", url: "/settings", icon: Settings },
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
  const [searchQuery, setSearchQuery] = useState("");
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

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

  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return visibleSections;
    const q = searchQuery.toLowerCase();
    const results: NavSection[] = [];
    for (const section of visibleSections) {
      if (section.isDivider) continue;
      if (!section.items) {
        if (section.label.toLowerCase().includes(q)) results.push(section);
        continue;
      }
      const matchingItems = section.items.filter(
        item => item.title.toLowerCase().includes(q) || section.label.toLowerCase().includes(q)
      );
      if (matchingItems.length > 0) {
        results.push({ ...section, items: matchingItems });
      }
    }
    return results;
  }, [searchQuery, visibleSections]);

  const isSearching = searchQuery.trim().length > 0;

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
      <SidebarHeader className="h-auto py-2 flex items-center px-5">
        <button
          onClick={() => window.dispatchEvent(new Event("open-cortex-ai"))}
          className="flex items-center gap-2 font-bold tracking-tight cursor-pointer transition-opacity hover:opacity-80 active:scale-[0.98]"
          data-testid="button-sidebar-cortex-ai"
        >
          <img
            src={navLogo}
            alt="VoltSafe Growth OS"
            className="w-14 h-14 object-contain mix-blend-screen brightness-125 shrink-0"
          />
          <span className="text-xl leading-tight">VoltSafe<br /><span className="text-primary">Growth OS</span></span>
        </button>
      </SidebarHeader>

      <div className="px-4 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-8 pr-7 h-8 text-sm bg-secondary/30 border-transparent focus-visible:border-primary/30 focus-visible:ring-primary/10 rounded-lg"
            data-testid="input-sidebar-search"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              data-testid="button-clear-search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <SidebarContent className="px-3 py-1 overflow-y-auto">
        <nav className="flex flex-col gap-0.5">
          {filteredSections.map((section) => {
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

            const isSectionOpen = isSearching || openSection === section.id;
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

          {isSearching && filteredSections.length === 0 && (
            <div className="px-3 py-6 text-center">
              <p className="text-xs text-muted-foreground">No results for "{searchQuery}"</p>
            </div>
          )}
        </nav>

        {/* Theme toggle */}
        <div className="px-3 py-3 border-t border-border/40 mt-auto shrink-0">
          <button
            onClick={() => setTheme(isDark ? "light" : "dark")}
            data-testid="button-theme-toggle"
            className="w-full flex items-center justify-between px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-colors"
          >
            <span className="flex items-center gap-2.5">
              {isDark ? <Moon className="w-3.5 h-3.5 shrink-0" /> : <Sun className="w-3.5 h-3.5 shrink-0" />}
              <span>{isDark ? "Dark mode" : "Light mode"}</span>
            </span>
            <span className="flex items-center gap-0.5 bg-secondary rounded-full p-0.5">
              <span className={`w-5 h-5 rounded-full flex items-center justify-center transition-all ${!isDark ? "bg-background shadow text-foreground" : "text-muted-foreground"}`}>
                <Sun className="w-3 h-3" />
              </span>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center transition-all ${isDark ? "bg-background shadow text-foreground" : "text-muted-foreground"}`}>
                <Moon className="w-3 h-3" />
              </span>
            </span>
          </button>
        </div>
      </SidebarContent>
    </Sidebar>
  );
}
