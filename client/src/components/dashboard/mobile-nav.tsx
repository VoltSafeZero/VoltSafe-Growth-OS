import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Home, Users, LifeBuoy, Settings2, Building2, Contact, UserPlus, FileText,
  Mail, CalendarClock, Megaphone, FolderOpen, Tags, Zap, Settings,
  X, Users2, ClipboardList, Layers, LayoutDashboard, LayoutGrid,
  Target, Share2, Brain, SlidersHorizontal, Truck, Landmark, Factory,
  FlaskConical, Newspaper, Circle, ShieldCheck,
  Zap as ZapIcon, Smartphone, Plus, MapPin, ChevronRight,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { QuickLogModal } from "@/components/mobile/quick-log-modal";

const allNavGroups = [
  {
    label: "Command Center",
    items: [
      { title: "Dashboard", url: "/", icon: Home },
      { title: "Field Mode", url: "/field", icon: Smartphone },
      { title: "Nearby", url: "/field/nearby", icon: MapPin },
    ],
  },
  {
    label: "Relationships",
    items: [
      { title: "Organizations", url: "/accounts", icon: Building2 },
      { title: "Contacts", url: "/contacts", icon: Contact },
      { title: "Tasks", url: "/execution/team-workload", icon: Users2 },
    ],
  },
  {
    label: "Revenue Engine",
    items: [
      { title: "Leads", url: "/opportunities", icon: UserPlus },
      { title: "Pipeline", url: "/pipeline", icon: Target },
      { title: "Quotes", url: "/quotes", icon: FileText },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Deployments", url: "/deployments", icon: Truck },
      { title: "Install Workflows", url: "/install-workflows", icon: Layers },
      { title: "Projects", url: "/execution/projects", icon: Layers },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { title: "Inbox", url: "/gmail", icon: Mail },
      { title: "Calendar", url: "/execution/calendar", icon: CalendarClock },
      { title: "Rel. Intelligence", url: "/intelligence/rel-intelligence", icon: SlidersHorizontal },
    ],
  },
  {
    label: "Growth Channels",
    items: [
      { title: "Partnerships", url: "/strategy/partnerships/industry-associations", icon: Users2 },
      { title: "Dealers", url: "/strategy/partnerships/channel-commercial", icon: Truck },
      { title: "Govt & Grants", url: "/strategy/partnerships/government-public", icon: Landmark },
    ],
  },
  {
    label: "Support & Admin",
    items: [
      { title: "Tickets", url: "/support/tickets", icon: ClipboardList },
      { title: "Users", url: "/admin/users", icon: ShieldCheck, adminOnly: true },
      { title: "Integrations", url: "/admin/integrations", icon: Zap },
      { title: "Settings", url: "/settings", icon: Settings },
    ],
  },
];

// 2 tabs left of center, 2 tabs right of center
const LEFT_NAV = [
  { title: "Home", url: "/", icon: Home, exactMatch: true },
  { title: "Accounts", url: "/accounts", icon: Building2 },
];
const RIGHT_NAV = [
  { title: "Pipeline", url: "/pipeline", icon: Target },
  { title: "Log", url: null, icon: Plus },
];

export function MobileNav({ userGlobalRole = "sales" }: { userGlobalRole?: string } = {}) {
  const isMobile = useIsMobile();
  const [location, navigate] = useLocation();
  const [showMore, setShowMore] = useState(false);
  const [showQuickLog, setShowQuickLog] = useState(false);
  const isAdmin = ["master_admin", "admin"].includes(userGlobalRole);

  // Filter admin-only items so non-admins never see (or can navigate to) restricted routes.
  const visibleNavGroups = allNavGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item: any) => !item.adminOnly || isAdmin),
    }))
    .filter((group) => group.items.length > 0);

  if (!isMobile) return null;

  const handleNavClick = (url: string) => {
    navigate(url);
    setShowMore(false);
  };

  return (
    <>
      {showMore && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={() => setShowMore(false)}
        />
      )}

      {showMore && (
        <div
          className="fixed bottom-16 left-0 right-0 z-50 bg-background border-t border-border/50 rounded-t-2xl max-h-[75vh] overflow-y-auto"
          data-testid="mobile-nav-more-panel"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 sticky top-0 bg-background z-10">
            <div>
              <span className="text-sm font-semibold text-foreground">All Sections</span>
              <p className="text-xs text-muted-foreground mt-0.5">VoltSafe Growth OS</p>
            </div>
            <button
              onClick={() => setShowMore(false)}
              className="p-1.5 rounded-full bg-secondary/60 text-muted-foreground"
              data-testid="button-mobile-nav-close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="pb-6">
            {visibleNavGroups.map((group) => (
              <div key={group.label} className="mt-3">
                <div className="px-4 py-1">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {group.label}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 px-3">
                  {group.items.map((item) => {
                    const isActive = item.url === "/"
                      ? location === "/"
                      : location.startsWith(item.url);
                    return (
                      <button
                        key={`${group.label}-${item.url}`}
                        onClick={() => handleNavClick(item.url)}
                        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-sm transition-all min-h-[44px] ${
                          isActive
                            ? "bg-primary/10 text-primary font-medium"
                            : "text-muted-foreground hover:bg-secondary/60 active:bg-secondary"
                        }`}
                        data-testid={`mobile-nav-more-${item.title.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                      >
                        <item.icon className={`w-4 h-4 shrink-0 ${isActive ? "text-primary" : ""}`} />
                        <span className="truncate">{item.title}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <nav
        className="fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur-sm border-t border-border/50 safe-area-bottom"
        data-testid="mobile-bottom-nav"
      >
        <div className="flex items-stretch h-16">
          {/* Left tabs */}
          {LEFT_NAV.map((item) => {
            const isActive = item.exactMatch
              ? location === item.url
              : location.startsWith(item.url);
            return (
              <Link
                key={item.url}
                href={item.url}
                className={`flex flex-col items-center justify-center gap-1 flex-1 py-2 min-h-[44px] transition-all active:scale-95 ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`}
                data-testid={`mobile-nav-${item.title.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
              >
                <item.icon className={`w-5 h-5 ${isActive ? "text-primary" : ""}`} />
                <span className="text-[10px] font-medium">{item.title}</span>
              </Link>
            );
          })}

          {/* Centre: Menu — most thumb-accessible position */}
          <button
            onClick={() => setShowMore(!showMore)}
            className="flex flex-col items-center justify-center gap-1 flex-1 py-2 min-h-[44px] transition-all active:scale-95"
            data-testid="mobile-nav-menu"
            aria-label="All sections menu"
          >
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center -mt-3 shadow-md transition-colors ${
              showMore
                ? "bg-primary shadow-primary/30"
                : "bg-primary/90 shadow-primary/20"
            }`}>
              <LayoutGrid className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className={`text-[10px] font-medium ${showMore ? "text-primary" : "text-muted-foreground"}`}>Menu</span>
          </button>

          {/* Right tabs */}
          {RIGHT_NAV.map((item) => {
            const isActive = item.url
              ? (item.url === "/" ? location === "/" : location.startsWith(item.url))
              : false;
            if (item.url === null) {
              return (
                <button
                  key="log"
                  onClick={() => setShowQuickLog(true)}
                  className="flex flex-col items-center justify-center gap-1 flex-1 py-2 min-h-[44px] transition-all active:scale-95 text-muted-foreground"
                  data-testid="mobile-nav-quick-log"
                  aria-label="Quick Log"
                >
                  <item.icon className="w-5 h-5" />
                  <span className="text-[10px] font-medium">{item.title}</span>
                </button>
              );
            }
            return (
              <Link
                key={item.url}
                href={item.url}
                className={`flex flex-col items-center justify-center gap-1 flex-1 py-2 min-h-[44px] transition-all active:scale-95 ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`}
                data-testid={`mobile-nav-${item.title.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
              >
                <item.icon className={`w-5 h-5 ${isActive ? "text-primary" : ""}`} />
                <span className="text-[10px] font-medium">{item.title}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <QuickLogModal
        open={showQuickLog}
        onClose={() => setShowQuickLog(false)}
      />
    </>
  );
}
