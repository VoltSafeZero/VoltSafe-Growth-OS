import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Home, Users, LifeBuoy, Settings2, Building2, Contact, UserPlus, FileText,
  Mail, CalendarClock, Megaphone, FolderOpen, Tags, Zap, Settings,
  MoreHorizontal, X, Users2, ClipboardList, Layers, Sun, LayoutDashboard,
  Target, Share2, Brain, SlidersHorizontal, Truck, Landmark, Factory,
  FlaskConical, Newspaper, Circle, ShieldCheck,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

const primaryNav = [
  { title: "Today", url: "/today", icon: Sun },
  { title: "Growth OS", url: "/accounts", icon: LayoutDashboard },
  { title: "Intelligence", url: "/gmail", icon: Brain },
  { title: "Support", url: "/support/tickets", icon: LifeBuoy },
];

const GROWTH_OS_URLS = [
  "/accounts", "/contacts", "/opportunities", "/quotes", "/pipeline",
  "/strategy", "/relationships", "/activity", "/reports", "/forecasting",
  "/notes", "/renewals", "/segments", "/tags", "/automations", "/imports",
];

const allNavGroups = [
  {
    label: "Command Center",
    items: [
      { title: "Dashboard", url: "/", icon: Home },
      { title: "Forecasting", url: "/pipeline", icon: Target },
      { title: "Reports", url: "/relationships", icon: SlidersHorizontal },
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
      { title: "Opportunities", url: "/opportunities", icon: UserPlus },
      { title: "Pipeline", url: "/pipeline", icon: Target },
      { title: "Quotes", url: "/quotes", icon: FileText },
    ],
  },
  {
    label: "Growth Channels",
    items: [
      { title: "Industry Partnerships", url: "/strategy/partnerships/industry-associations", icon: Users2 },
      { title: "Dealers / Resellers", url: "/strategy/partnerships/channel-commercial", icon: Truck },
      { title: "Govt & Grants", url: "/strategy/partnerships/government-public", icon: Landmark },
      { title: "Investors", url: "/strategy/partnerships/innovation-research", icon: FlaskConical },
      { title: "Strategic Alliances", url: "/strategy/partnerships/manufacturing", icon: Factory },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { title: "Inbox", url: "/gmail", icon: Mail },
      { title: "Calendar", url: "/execution/calendar", icon: CalendarClock },
      { title: "Rel. Intelligence", url: "/relationships", icon: SlidersHorizontal },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Projects", url: "/execution/projects", icon: Layers },
      { title: "Communications", url: "/execution/communications", icon: Megaphone },
      { title: "Assets", url: "/knowledge/assets", icon: FolderOpen },
      { title: "Price Lists", url: "/price-lists", icon: Tags },
    ],
  },
  {
    label: "Support & Admin",
    items: [
      { title: "Tickets", url: "/support/tickets", icon: ClipboardList },
      { title: "Integrations", url: "/admin/integrations", icon: Zap },
      { title: "Settings", url: "/settings", icon: Settings },
    ],
  },
];

export function MobileNav() {
  const isMobile = useIsMobile();
  const [location, navigate] = useLocation();
  const [showMore, setShowMore] = useState(false);

  if (!isMobile) return null;

  const handleNavClick = (url: string) => {
    navigate(url);
    setShowMore(false);
  };

  return (
    <>
      {showMore && (
        <div
          className="fixed inset-0 z-40 bg-black/60"
          onClick={() => setShowMore(false)}
        />
      )}

      {showMore && (
        <div className="fixed bottom-16 left-0 right-0 z-50 bg-background border-t border-border/50 rounded-t-2xl max-h-[70vh] overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
            <div>
              <span className="text-sm font-semibold text-foreground">Growth OS</span>
              <p className="text-xs text-muted-foreground mt-0.5">All sections</p>
            </div>
            <button
              onClick={() => setShowMore(false)}
              className="p-1.5 rounded-full bg-secondary/60 text-muted-foreground"
              data-testid="button-mobile-nav-close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="pb-4">
            {allNavGroups.map((group) => (
              <div key={group.label} className="mt-3">
                <div className="px-4 py-1">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {group.label}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 px-3">
                  {group.items.map((item) => {
                    const isActive =
                      item.url === "/"
                        ? location === "/"
                        : location.startsWith(item.url);
                    return (
                      <button
                        key={`${group.label}-${item.url}`}
                        onClick={() => handleNavClick(item.url)}
                        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-sm transition-all ${
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

      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-background/95 border-t border-border/50 safe-area-bottom">
        <div className="flex items-stretch h-16">
          {primaryNav.map((item) => {
            const isActive =
              item.url === "/"
                ? location === "/"
                : item.title === "Growth OS"
                  ? GROWTH_OS_URLS.some(u => location.startsWith(u))
                  : location.startsWith(item.url);
            return (
              <Link
                key={item.url}
                href={item.url}
                className={`flex flex-col items-center justify-center gap-1 flex-1 py-2 transition-all active:scale-95 ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`}
                data-testid={`mobile-nav-${item.title.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
              >
                <item.icon className={`w-5 h-5 ${isActive ? "text-primary" : ""}`} />
                <span className="text-[10px] font-medium">{item.title}</span>
              </Link>
            );
          })}
          <button
            onClick={() => setShowMore(!showMore)}
            className={`flex flex-col items-center justify-center gap-1 flex-1 py-2 transition-all active:scale-95 ${
              showMore ? "text-primary" : "text-muted-foreground"
            }`}
            data-testid="mobile-nav-more"
          >
            <MoreHorizontal className={`w-5 h-5 ${showMore ? "text-primary" : ""}`} />
            <span className="text-[10px] font-medium">More</span>
          </button>
        </div>
      </nav>
    </>
  );
}
