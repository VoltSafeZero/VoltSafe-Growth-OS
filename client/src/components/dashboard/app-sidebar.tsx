import { useState, useEffect, useMemo } from "react";
import { ChevronRight, Sun, Moon, Flame, Ghost, Plus } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import voltSafeVIcon from "@assets/Screenshot_2026-04-15_at_7.26.57_PM_1776306420926.png";
import { Sidebar, SidebarContent, SidebarHeader } from "@/components/ui/sidebar";
import { FieldHelp } from "@/components/help/field-help";
import type { UserPermissions } from "@/App";
import {
  getDesktopSections,
  isAdvisorRole,
  type DesktopNavSection as NavSection,
  type DesktopNavItem as NavItem,
} from "@/lib/nav-config";

type AccessLevel = "none" | "view" | "edit";

// Sidebar groupings live in client/src/lib/nav-config.ts — single source of
// truth shared with mobile-nav.tsx. Edit there to add or move items; both
// surfaces stay in sync automatically.
const sections: NavSection[] = getDesktopSections();

function getActiveSectionId(location: string): string {
  if (location === "/") return "work";
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

const SECTION_HELP_KEYS: Record<string, string> = {
  today: "nav.today",
  currents: "nav.currents",
  work: "nav.work",
  pipeline: "nav.pipeline",
  operations: "nav.operations",
  insights: "nav.insights",
  marketing: "nav.marketing",
  capital: "nav.capital",
  "feed-cortex": "nav.feedCortex",
  learn: "nav.learn",
};

export function AppSidebar({
  userGlobalRole = "sales",
  userPermissions,
}: {
  userGlobalRole?: string;
  userPermissions?: UserPermissions;
}) {
  const isAdmin = ["master_admin", "admin"].includes(userGlobalRole);
  const isAdvisor = isAdvisorRole(userGlobalRole);
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
    // capitalOnly is checked before the admin bypass — Capital access is identity-based, not role-based.
    // Even admins who are not Trevor/Scott must not see this section.
    if (section.capitalOnly) return (perms as any).capital === "edit";
    if (section.adminOnly && !isAdmin) return false;
    if (isAdvisor && section.advisorHidden) return false;
    if (isAdmin) return true;
    if (!section.permKey) return true;
    return (perms[section.permKey] as AccessLevel) !== "none";
  }

  function canSeeItem(item: NavItem): boolean {
    if (isAdvisor && item.advisorHidden) return false;
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
  }, [isAdmin, isAdvisor, perms]);

  const { data: unreadCounts } = useQuery<{ total: number; dm: number; channels: Record<string, number> }>({
    queryKey: ["/api/current/unread-counts"],
    refetchInterval: 30_000,
  });

  const currentNavBadge = (unreadCounts?.total ?? 0) > 0
    ? ((unreadCounts?.total ?? 0) > 99 ? "99+" : String(unreadCounts?.total))
    : null;

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

            const isCurrentsSection = section.id === "currents";

            return (
              <div key={section.id}>
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={() => handleSectionClick(section)}
                    data-testid={`nav-section-${section.id}`}
                    className={`flex-1 min-w-0 flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-sm font-medium group ${
                      isSectionActive
                        ? isCurrentsSection
                          ? "bg-cyan-500/10 text-cyan-400"
                          : "bg-primary/10 text-primary"
                        : isCurrentsSection
                          ? "text-cyan-400/65 hover:bg-cyan-500/8 hover:text-cyan-300"
                          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                    }`}
                  >
                    <SectionIcon className={`w-4 h-4 shrink-0 transition-colors ${
                      isSectionActive
                        ? isCurrentsSection ? "text-cyan-400" : "text-primary"
                        : isCurrentsSection ? "text-cyan-400/70 group-hover:text-cyan-300" : "group-hover:text-foreground"
                    }`} />
                    <span className={`flex-1 text-left ${isCurrentsSection ? "tracking-widest text-[11.5px] font-bold" : ""} ${SECTION_HELP_KEYS[section.id] ? "pr-4" : ""}`}>
                      {section.label}
                    </span>
                    {/* CURRENTS unread badge — shown on the section button when top-level */}
                    {isCurrentsSection && currentNavBadge ? (
                      <span
                        data-testid="nav-currents-unread-badge"
                        className="text-[10px] font-bold text-white bg-cyan-500 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full shrink-0 shadow-sm shadow-cyan-500/30"
                      >
                        {currentNavBadge}
                      </span>
                    ) : null}
                    {section.items && section.items.length > 0 && !section.url && (
                      <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${isSectionOpen ? "rotate-90 text-primary" : "text-muted-foreground/50"}`} />
                    )}
                  </button>
                  {SECTION_HELP_KEYS[section.id] && (
                    <FieldHelp
                      helpKey={SECTION_HELP_KEYS[section.id]}
                      placement="right"
                      className="shrink-0"
                    />
                  )}
                </div>

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
                          {item.id === "current" && currentNavBadge ? (
                            <span
                              data-testid="nav-currents-unread-badge"
                              className="text-[10px] font-bold text-primary-foreground bg-primary min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full shrink-0"
                            >
                              {currentNavBadge}
                            </span>
                          ) : item.badge ? (
                            <span className="text-[10px] font-semibold text-muted-foreground/60 bg-secondary/60 px-1.5 py-0.5 rounded-full">
                              {item.badge}
                            </span>
                          ) : null}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

        </nav>

        {/* Quick Capture button — right-aligned, sits between nav and theme toggle */}
        <div className="px-3 pt-2 pb-1 flex justify-end">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("open-quick-capture", { detail: { tab: "task" } }))}
            className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground shadow hover:shadow-md hover:scale-105 active:scale-95 transition-all"
            title="Quick capture"
            data-testid="button-quick-capture"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

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
