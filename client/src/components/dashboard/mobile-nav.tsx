import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  UserPlus,
  Building2,
  Mail,
  MoreHorizontal,
  X,
  FileText,
  LifeBuoy,
  Megaphone,
  Settings,
  Zap,
  Users,
  Handshake,
  Cpu,
  Truck,
  Factory,
  Landmark,
  FlaskConical,
  Ship,
  Globe,
  Contact,
  GitBranch,
  CalendarDays,
  CalendarClock,
  MapPin,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

const primaryNav = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Leads", url: "/leads", icon: UserPlus },
  { title: "Accounts", url: "/accounts", icon: Building2 },
  { title: "Gmail", url: "/gmail", icon: Mail },
];

const allNavGroups = [
  {
    label: "Overview",
    items: [
      { title: "Dashboard", url: "/", icon: LayoutDashboard },
      { title: "Calendar", url: "/calendar", icon: CalendarClock },
      { title: "Team Workload", url: "/team-workload", icon: Users },
    ],
  },
  {
    label: "Sales",
    items: [
      { title: "Marina Leads", url: "/leads", icon: UserPlus },
      { title: "Marina Accounts", url: "/accounts", icon: Building2 },
      { title: "Quotes", url: "/quotes", icon: FileText },
    ],
  },
  {
    label: "Communications",
    items: [
      { title: "Gmail Inbox", url: "/gmail", icon: Mail },
      { title: "Communications", url: "/communications", icon: Megaphone },
    ],
  },
  {
    label: "Partnerships",
    items: [
      { title: "Strategic Industry", url: "/partnerships/strategic-industry", icon: Handshake },
      { title: "Technology & Integrations", url: "/partnerships/technology", icon: Cpu },
      { title: "Distribution & Channel", url: "/partnerships/distribution", icon: Truck },
      { title: "OEM & Licensing", url: "/partnerships/oem", icon: Factory },
      { title: "Government & Grants", url: "/partnerships/government", icon: Landmark },
      { title: "Research & Innovation", url: "/partnerships/research", icon: FlaskConical },
      { title: "Pilot & Lighthouse Marinas", url: "/partnerships/pilot", icon: Ship },
    ],
  },
  {
    label: "Ecosystem",
    items: [
      { title: "Organizations", url: "/ecosystem/organizations", icon: Globe },
      { title: "People", url: "/ecosystem/people", icon: Contact },
      { title: "Relationships", url: "/ecosystem/relationships", icon: GitBranch },
      { title: "Events", url: "/ecosystem/events", icon: CalendarDays },
      { title: "Regions", url: "/ecosystem/regions", icon: MapPin },
    ],
  },
  {
    label: "Support & Config",
    items: [
      { title: "Tickets", url: "/tickets", icon: LifeBuoy },
      { title: "Settings", url: "/settings", icon: Settings },
      { title: "Integrations", url: "/integrations", icon: Zap },
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
            <span className="text-sm font-semibold text-foreground">All Sections</span>
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
                    const isActive = location === item.url || (item.url !== "/" && location.startsWith(item.url));
                    return (
                      <button
                        key={item.url}
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
            const isActive = location === item.url || (item.url !== "/" && location.startsWith(item.url));
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
