import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  Mail,
  MailCheck,
  StickyNote,
  Activity,
  CheckSquare,
  TrendingUp,
  AlertTriangle,
  Heart,
  Users,
  Paperclip,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";

export type SummaryObjectType = "account" | "contact" | "opportunity" | "lead" | "partner";

interface RecordSummary {
  objectType: SummaryObjectType;
  objectId: number;
  lastInboundEmail: string | null;
  lastOutboundEmail: string | null;
  lastNote: string | null;
  lastActivity: string | null;
  lastTouch: string | null;
  openTasksCount: number;
  overdueTasksCount: number;
  openOppsCount: number;
  openOppsValue: number;
  contactsCount: number;
  attachmentsCount: number;
  healthScore: number;
  healthLabel: string;
  healthReasons: string[];
  warnings: Array<{ type: string; message: string }>;
}

const HEALTH_COLOR: Record<string, string> = {
  Strong: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  Active: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  Warm: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  Cooling: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  "At Risk": "bg-red-500/15 text-red-400 border-red-500/30",
  Stale: "bg-muted text-muted-foreground border-border",
};

const HEALTH_SCORE_COLOR: Record<string, string> = {
  Strong: "text-emerald-400",
  Active: "text-blue-400",
  Warm: "text-yellow-400",
  Cooling: "text-orange-400",
  "At Risk": "text-red-400",
  Stale: "text-muted-foreground",
};

function relativeDate(date: string | null): string {
  if (!date) return "—";
  try {
    return formatDistanceToNow(new Date(date), { addSuffix: true });
  } catch {
    return "—";
  }
}

interface MetricPillProps {
  icon: React.ElementType;
  label: string;
  value: string;
  accent?: boolean;
  warning?: boolean;
  testId?: string;
}

function MetricPill({ icon: Icon, label, value, accent, warning, testId }: MetricPillProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs cursor-default select-none transition-colors
              ${warning ? "bg-red-500/10 border-red-500/30 text-red-400" :
                accent ? "bg-primary/8 border-primary/20 text-primary" :
                "bg-secondary/30 border-border/40 text-foreground"}`}
            data-testid={testId}
          >
            <Icon className="h-3 w-3 flex-shrink-0" />
            <span className="font-medium">{value}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface RecordSummaryBarProps {
  objectType: SummaryObjectType;
  objectId: number;
  compact?: boolean;
}

export function RecordSummaryBar({ objectType, objectId, compact = false }: RecordSummaryBarProps) {
  const { data, isLoading, isError } = useQuery<RecordSummary>({
    queryKey: ["/api/record-summary", objectType, objectId],
    queryFn: async () => {
      const res = await fetch(`/api/record-summary/${objectType}/${objectId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load summary");
      return res.json();
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex flex-wrap gap-2 py-2" data-testid="record-summary-bar-loading">
        {[1, 2, 3, 4, 5].map(i => (
          <Skeleton key={i} className="h-7 w-20 rounded-md" />
        ))}
      </div>
    );
  }

  if (isError || !data) return null;

  const { healthLabel, healthScore, healthReasons, warnings } = data;

  const showOpps = ["account", "contact"].includes(objectType);
  const showContacts = objectType === "account";
  const showAttachments = data.attachmentsCount > 0;

  return (
    <div className="space-y-2" data-testid="record-summary-bar">
      {/* Main metrics strip */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Health badge */}
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-semibold cursor-default select-none ${HEALTH_COLOR[healthLabel] ?? HEALTH_COLOR["Stale"]}`}
                data-testid="badge-health-label"
              >
                <Heart className="h-3 w-3 flex-shrink-0" />
                <span>{healthLabel}</span>
                <span className={`ml-0.5 font-bold ${HEALTH_SCORE_COLOR[healthLabel] ?? ""}`}>{healthScore}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-52">
              <p className="font-semibold mb-1">Relationship Health</p>
              <ul className="space-y-0.5 text-xs">
                {healthReasons.map((r, i) => <li key={i}>• {r}</li>)}
              </ul>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Inbound email */}
        <MetricPill
          icon={Mail}
          label={`Last inbound email: ${relativeDate(data.lastInboundEmail)}`}
          value={`↙ ${relativeDate(data.lastInboundEmail)}`}
          testId="metric-last-inbound"
        />

        {/* Outbound email */}
        <MetricPill
          icon={MailCheck}
          label={`Last outbound email: ${relativeDate(data.lastOutboundEmail)}`}
          value={`↗ ${relativeDate(data.lastOutboundEmail)}`}
          testId="metric-last-outbound"
        />

        {/* Last note */}
        {!compact && (
          <MetricPill
            icon={StickyNote}
            label={`Last note: ${relativeDate(data.lastNote)}`}
            value={`Note: ${relativeDate(data.lastNote)}`}
            testId="metric-last-note"
          />
        )}

        {/* Last activity */}
        {!compact && (
          <MetricPill
            icon={Activity}
            label={`Last activity: ${relativeDate(data.lastActivity)}`}
            value={`Act: ${relativeDate(data.lastActivity)}`}
            testId="metric-last-activity"
          />
        )}

        {/* Open tasks */}
        {data.openTasksCount > 0 && (
          <MetricPill
            icon={CheckSquare}
            label={`${data.openTasksCount} open task${data.openTasksCount !== 1 ? "s" : ""}${data.overdueTasksCount > 0 ? `, ${data.overdueTasksCount} overdue` : ""}`}
            value={data.overdueTasksCount > 0 ? `${data.overdueTasksCount}/${data.openTasksCount} tasks` : `${data.openTasksCount} task${data.openTasksCount !== 1 ? "s" : ""}`}
            warning={data.overdueTasksCount > 0}
            testId="metric-tasks"
          />
        )}

        {/* Open opportunities */}
        {showOpps && data.openOppsCount > 0 && (
          <MetricPill
            icon={TrendingUp}
            label={`${data.openOppsCount} open deal${data.openOppsCount !== 1 ? "s" : ""} · $${(data.openOppsValue / 1000).toFixed(0)}k pipeline`}
            value={`${data.openOppsCount} deal${data.openOppsCount !== 1 ? "s" : ""} · $${(data.openOppsValue / 1000).toFixed(0)}k`}
            accent
            testId="metric-opportunities"
          />
        )}

        {/* Contacts count */}
        {showContacts && data.contactsCount > 0 && !compact && (
          <MetricPill
            icon={Users}
            label={`${data.contactsCount} contact${data.contactsCount !== 1 ? "s" : ""} linked`}
            value={`${data.contactsCount} contact${data.contactsCount !== 1 ? "s" : ""}`}
            testId="metric-contacts"
          />
        )}

        {/* Attachments */}
        {showAttachments && !compact && (
          <MetricPill
            icon={Paperclip}
            label={`${data.attachmentsCount} attachment${data.attachmentsCount !== 1 ? "s" : ""}`}
            value={`${data.attachmentsCount} file${data.attachmentsCount !== 1 ? "s" : ""}`}
            testId="metric-attachments"
          />
        )}
      </div>

      {/* Warnings strip */}
      {warnings.length > 0 && !compact && (
        <div className="flex flex-wrap gap-2">
          {warnings.map((w) => (
            <div
              key={w.type}
              className="flex items-center gap-1 text-[11px] text-orange-400 bg-orange-500/8 border border-orange-500/20 rounded px-2 py-0.5"
              data-testid={`warning-${w.type}`}
            >
              <AlertTriangle className="h-2.5 w-2.5 flex-shrink-0" />
              {w.message}
            </div>
          ))}
        </div>
      )}

      {/* Compact warnings — only show critical ones */}
      {warnings.length > 0 && compact && warnings.some(w => w.type === "overdue_tasks" || w.type === "no_touch_30d") && (
        <div className="flex flex-wrap gap-1.5">
          {warnings
            .filter(w => w.type === "overdue_tasks" || w.type === "no_touch_30d")
            .map((w) => (
              <div
                key={w.type}
                className="flex items-center gap-1 text-[11px] text-orange-400 bg-orange-500/8 border border-orange-500/20 rounded px-2 py-0.5"
                data-testid={`warning-${w.type}`}
              >
                <AlertTriangle className="h-2.5 w-2.5 flex-shrink-0" />
                {w.message}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
