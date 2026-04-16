import { useLocation } from "wouter";
import { SiJira, SiConfluence, SiGmail } from "react-icons/si";
import { ExternalLink, CheckCircle2, Circle, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Integration = {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  iconColor: string;
  status: "connected" | "disconnected" | "coming_soon";
  url?: string;
  externalUrl?: string;
  badge?: string;
};

const integrations: Integration[] = [
  {
    id: "gmail",
    name: "Gmail",
    description: "CRM-linked email inbox with thread tracking, auto-categorization, starred prioritization, and quote attachment.",
    icon: SiGmail,
    iconColor: "text-red-400",
    status: "connected",
    url: "/gmail",
    badge: "OAuth 2.0",
  },
  {
    id: "jira",
    name: "Jira",
    description: "View and manage Jira issues, sprints, and project boards directly within Cortex.",
    icon: SiJira,
    iconColor: "text-blue-400",
    status: "connected",
    url: "/jira",
    badge: "Atlassian",
  },
  {
    id: "confluence",
    name: "Confluence",
    description: "Browse and search your Confluence knowledge base without leaving the CRM.",
    icon: SiConfluence,
    iconColor: "text-blue-500",
    status: "connected",
    url: "/confluence",
    badge: "Atlassian",
  },
  {
    id: "hubspot",
    name: "HubSpot",
    description: "Sync contacts, deals, and pipeline data with HubSpot CRM for a unified view.",
    icon: Zap,
    iconColor: "text-orange-400",
    status: "coming_soon",
  },
  {
    id: "klaviyo",
    name: "Klaviyo",
    description: "Connect email marketing campaigns and subscriber lists with your CRM accounts.",
    icon: Zap,
    iconColor: "text-green-400",
    status: "coming_soon",
  },
];

export default function AdminIntegrationsPage() {
  const [, navigate] = useLocation();

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-5 border-b border-border/50">
        <h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Connected services and third-party tools
        </p>
      </div>

      <div className="flex-1 overflow-auto px-6 py-6 pb-24 md:pb-6">
        <div className="max-w-3xl space-y-3">
          {integrations.map((integration) => {
            const Icon = integration.icon;
            const isConnected = integration.status === "connected";
            const isComingSoon = integration.status === "coming_soon";

            return (
              <div
                key={integration.id}
                className={`flex items-center gap-5 px-5 py-4 rounded-xl border transition-all ${
                  isConnected
                    ? "bg-secondary/20 border-border/40 hover:border-border/70 hover:bg-secondary/30"
                    : "bg-secondary/10 border-border/20 opacity-60"
                }`}
                data-testid={`integration-card-${integration.id}`}
              >
                <div className="w-11 h-11 rounded-xl bg-background border border-border/40 flex items-center justify-center shrink-0">
                  <Icon className={`w-5 h-5 ${integration.iconColor}`} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{integration.name}</span>
                    {integration.badge && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-border/40 text-muted-foreground">
                        {integration.badge}
                      </Badge>
                    )}
                    {isComingSoon && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/30 text-primary/70">
                        Coming Soon
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {integration.description}
                  </p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {isConnected ? (
                    <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                  ) : (
                    <Circle className="w-4 h-4 text-muted-foreground/30 shrink-0" />
                  )}
                  {isConnected && integration.url && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-3 text-xs border-border/50 bg-secondary/30 hover:bg-secondary/60"
                      onClick={() => navigate(integration.url!)}
                      data-testid={`integration-open-${integration.id}`}
                    >
                      <ExternalLink className="w-3 h-3 mr-1.5" />
                      Open
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
