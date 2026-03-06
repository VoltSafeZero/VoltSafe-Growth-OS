import {
  Anchor,
  LayoutDashboard,
  UserPlus,
  Building2,
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
import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
} from "@/components/ui/sidebar";

const overviewItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Calendar", url: "/calendar", icon: CalendarClock },
  { title: "Team Workload", url: "/team-workload", icon: Users },
];

const salesItems = [
  { title: "Marina Accounts", url: "/accounts", icon: Building2 },
  { title: "Marina Leads", url: "/leads", icon: UserPlus },
  { title: "Quotes", url: "/quotes", icon: FileText },
];

const partnershipsItems = [
  { title: "Strategic Industry", url: "/partnerships/strategic-industry", icon: Handshake },
  { title: "Technology & Integrations", url: "/partnerships/technology", icon: Cpu },
  { title: "Distribution & Channel", url: "/partnerships/distribution", icon: Truck },
  { title: "OEM & Licensing", url: "/partnerships/oem", icon: Factory },
  { title: "Government & Grants", url: "/partnerships/government", icon: Landmark },
  { title: "Research & Innovation", url: "/partnerships/research", icon: FlaskConical },
  { title: "Pilot & Lighthouse Marinas", url: "/partnerships/pilot", icon: Ship },
];

const ecosystemItems = [
  { title: "Organizations", url: "/ecosystem/organizations", icon: Globe },
  { title: "People", url: "/ecosystem/people", icon: Contact },
  { title: "Relationships", url: "/ecosystem/relationships", icon: GitBranch },
  { title: "Events", url: "/ecosystem/events", icon: CalendarDays },
  { title: "Regions", url: "/ecosystem/regions", icon: MapPin },
];

const supportItems = [
  { title: "Tickets", url: "/tickets", icon: LifeBuoy },
];

const commsItems = [
  { title: "Communications", url: "/communications", icon: Megaphone },
];

const configItems = [
  { title: "Settings", url: "/settings", icon: Settings },
  { title: "Integrations", url: "/integrations", icon: Zap },
];

type NavGroup = {
  label: string;
  items: { title: string; url: string; icon: React.ElementType }[];
};

const navGroups: NavGroup[] = [
  { label: "Overview", items: overviewItems },
  { label: "Sales", items: salesItems },
  { label: "Partnerships", items: partnershipsItems },
  { label: "Ecosystem", items: ecosystemItems },
  { label: "Support", items: supportItems },
  { label: "Communications", items: commsItems },
  { label: "Configuration", items: configItems },
];

export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar className="border-r border-border/50">
      <SidebarHeader className="h-16 flex items-center px-6">
        <div className="flex items-center gap-2 font-bold text-lg tracking-tight">
          <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center shadow-lg shadow-primary/20">
            <Anchor className="w-4 h-4 text-primary-foreground" />
          </div>
          <span>VoltSafe <span className="text-primary">Cortex</span></span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((group) => (
          <SidebarGroup key={group.label} className={group.label !== "Overview" ? "mt-2" : ""}>
            <SidebarGroupLabel className="px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="px-3">
                {group.items.map((item) => {
                  const isActive = location === item.url || (item.url !== "/" && location.startsWith(item.url));
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        className={`transition-all ${isActive ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground'}`}
                      >
                        <Link href={item.url} className="flex items-center gap-3 px-3 py-2 rounded-lg" data-testid={`nav-${item.title.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}>
                          <item.icon className={`w-4 h-4 ${isActive ? 'text-primary' : ''}`} />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
