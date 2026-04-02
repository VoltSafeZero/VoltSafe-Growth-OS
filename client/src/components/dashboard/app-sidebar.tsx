import { useState, useEffect } from "react";
import {
  Home,
  Users,
  TrendingUp,
  Activity,
  BookOpen,
  LifeBuoy,
  Settings2,
  Building2,
  Contact,
  UserPlus,
  FileText,
  Handshake,
  Truck,
  Factory,
  Landmark,
  FlaskConical,
  Mail,
  CalendarClock,
  Megaphone,
  FolderOpen,
  Tags,
  Zap,
  Settings,
  ChevronRight,
  Users2,
  ClipboardList,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import navLogo from "@assets/nav-logo.png";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
} from "@/components/ui/sidebar";

type NavItem = {
  title: string;
  url: string;
  icon: React.ElementType;
};

type NavSection = {
  id: string;
  label: string;
  icon: React.ElementType;
  url?: string;
  items?: NavItem[];
};

const sections: NavSection[] = [
  {
    id: "home",
    label: "Home",
    icon: Home,
    url: "/",
  },
  {
    id: "crm",
    label: "CRM",
    icon: Users,
    items: [
      { title: "Accounts", url: "/accounts", icon: Building2 },
      { title: "Contacts", url: "/contacts", icon: Contact },
      { title: "Opportunities", url: "/opportunities", icon: UserPlus },
      { title: "Quotes", url: "/quotes", icon: FileText },
    ],
  },
  {
    id: "strategy",
    label: "Strategy",
    icon: TrendingUp,
    items: [
      { title: "Industry", url: "/strategy/industry", icon: Handshake },
      { title: "Partnerships", url: "/strategy/partnerships", icon: Truck },
      { title: "OEM & Licensing", url: "/strategy/oem", icon: Factory },
      { title: "Government & Grants", url: "/strategy/government", icon: Landmark },
      { title: "Research", url: "/strategy/research", icon: FlaskConical },
    ],
  },
  {
    id: "execution",
    label: "Execution",
    icon: Activity,
    items: [
      { title: "Gmail", url: "/gmail", icon: Mail },
      { title: "Calendar", url: "/execution/calendar", icon: CalendarClock },
      { title: "Communications", url: "/execution/communications", icon: Megaphone },
      { title: "Team Workload", url: "/execution/team-workload", icon: Users2 },
    ],
  },
  {
    id: "knowledge",
    label: "Knowledge",
    icon: BookOpen,
    items: [
      { title: "Assets", url: "/knowledge/assets", icon: FolderOpen },
      { title: "Price Lists", url: "/price-lists", icon: Tags },
    ],
  },
  {
    id: "support",
    label: "Support",
    icon: LifeBuoy,
    items: [
      { title: "Tickets", url: "/support/tickets", icon: ClipboardList },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    icon: Settings2,
    items: [
      { title: "Integrations", url: "/admin/integrations", icon: Zap },
      { title: "Settings", url: "/settings", icon: Settings },
    ],
  },
];

function getActiveSectionId(location: string): string {
  if (location === "/") return "home";
  for (const section of sections) {
    if (section.url && location === section.url) return section.id;
    if (section.items?.some((item) => location.startsWith(item.url))) {
      return section.id;
    }
  }
  return "";
}

export function AppSidebar() {
  const [location, navigate] = useLocation();
  const [openSection, setOpenSection] = useState<string>(() =>
    getActiveSectionId(location)
  );

  useEffect(() => {
    const active = getActiveSectionId(location);
    if (active) setOpenSection(active);
  }, [location]);

  const handleSectionClick = (section: NavSection) => {
    if (section.url) {
      navigate(section.url);
      setOpenSection(section.id);
    } else {
      setOpenSection((prev) => (prev === section.id ? "" : section.id));
      if (section.items && section.items.length > 0) {
        const firstActive = section.items.find((item) =>
          location.startsWith(item.url)
        );
        if (!firstActive) {
          navigate(section.items[0].url);
        }
      }
    }
  };

  return (
    <Sidebar className="border-r border-border/50">
      <SidebarHeader className="h-auto py-2 flex items-center px-5">
        <button
          onClick={() => window.dispatchEvent(new Event("open-cortex-ai"))}
          className="flex items-center gap-1.5 font-bold text-lg tracking-tight cursor-pointer transition-opacity hover:opacity-80 active:scale-[0.98]"
          data-testid="button-sidebar-cortex-ai"
        >
          <img
            src={navLogo}
            alt="VoltSafe Cortex"
            className="w-[6.75rem] h-[6.75rem] object-contain mix-blend-screen brightness-125 shrink-0"
          />
          <span>
            VoltSafe <span className="text-primary">Cortex</span>
          </span>
        </button>
      </SidebarHeader>

      <SidebarContent className="px-3 py-2 overflow-y-auto">
        <nav className="flex flex-col gap-0.5">
          {sections.map((section) => {
            const isSectionOpen = openSection === section.id;
            const isSectionActive =
              section.url
                ? location === section.url
                : section.items?.some((item) => location.startsWith(item.url)) ?? false;
            const SectionIcon = section.icon;

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
                  <SectionIcon
                    className={`w-4 h-4 shrink-0 transition-colors ${
                      isSectionActive ? "text-primary" : "group-hover:text-foreground"
                    }`}
                  />
                  <span className="flex-1 text-left">{section.label}</span>
                  {section.items && section.items.length > 0 && (
                    <ChevronRight
                      className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${
                        isSectionOpen ? "rotate-90 text-primary" : "text-muted-foreground/50"
                      }`}
                    />
                  )}
                </button>

                {section.items && isSectionOpen && (
                  <div className="ml-3 mt-0.5 mb-1 pl-3 border-l border-border/40 flex flex-col gap-0.5">
                    {section.items.map((item) => {
                      const isItemActive =
                        location === item.url ||
                        (item.url !== "/" && location.startsWith(item.url));
                      const ItemIcon = item.icon;
                      return (
                        <Link
                          key={item.url}
                          href={item.url}
                          data-testid={`nav-${item.title.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                          className={`flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-all ${
                            isItemActive
                              ? "bg-primary/10 text-primary font-medium"
                              : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                          }`}
                        >
                          <ItemIcon
                            className={`w-3.5 h-3.5 shrink-0 ${
                              isItemActive ? "text-primary" : ""
                            }`}
                          />
                          <span>{item.title}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </SidebarContent>
    </Sidebar>
  );
}
