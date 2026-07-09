import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CheckCircle2, X, Clock, Zap, Mail, Phone, StickyNote, Calendar, TrendingUp, CheckSquare, ChevronDown,
} from "lucide-react";
import { InfoIcon as Info } from "@/components/icons/info-icon";
import { formatDistanceToNow, addDays, format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

export type SuggestionObjectType =
  | "account"
  | "contact"
  | "opportunity"
  | "lead"
  | "partner";

interface TaskSuggestion {
  id: number;
  objectType: string;
  objectId: number;
  signalType: string;
  severity: "low" | "medium" | "high";
  title: string;
  reason: string;
  suggestedActionType: string;
  suggestedActionLabel: string;
  priority: "low" | "medium" | "high";
  suggestedDueDate: string | null;
  status: string;
}

const ACTION_ICON: Record<string, React.ElementType> = {
  send_email: Mail,
  reply_email: Mail,
  log_call: Phone,
  add_note: StickyNote,
  schedule_meeting: Calendar,
  review_opportunity: TrendingUp,
  complete_task: CheckSquare,
  create_task: CheckSquare,
};

const SEVERITY_STYLE: Record<string, string> = {
  high: "bg-red-500/15 text-red-400 border-red-500/30",
  medium: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  low: "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

const SEVERITY_LABEL: Record<string, string> = {
  high: "Urgent",
  medium: "Important",
  low: "Nice to do",
};

const SNOOZE_OPTIONS = [
  { label: "1 day", days: 1 },
  { label: "3 days", days: 3 },
  { label: "1 week", days: 7 },
];

interface SuggestedActionsCardProps {
  objectType: SuggestionObjectType;
  objectId: number;
  compact?: boolean;
  onOpenNoteComposer?: () => void;
  onScrollToSection?: (section: string) => void;
}

export function SuggestedActionsCard({
  objectType,
  objectId,
  compact = false,
  onOpenNoteComposer,
  onScrollToSection,
}: SuggestedActionsCardProps) {
  const { toast } = useToast();
  const [acceptedIds, setAcceptedIds] = useState<Set<number>>(new Set());

  const { data: suggestions = [], isLoading } = useQuery<TaskSuggestion[]>({
    queryKey: ["/api/suggestions", objectType, objectId],
    queryFn: async () => {
      const res = await fetch(`/api/suggestions/${objectType}/${objectId}`, {
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60_000,
  });

  const acceptMutation = useMutation({
    mutationFn: async ({ id, createTask }: { id: number; createTask: boolean }) => {
      const res = await apiRequest("POST", `/api/suggestions/${id}/accept`, {
        createTask,
      });
      return res.json();
    },
    onSuccess: (data, { id }) => {
      setAcceptedIds((prev) => new Set([...prev, id]));
      queryClient.invalidateQueries({ queryKey: ["/api/suggestions", objectType, objectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({
        title: data.taskCreated ? "Task created" : "Marked as done",
        description: data.taskCreated
          ? "A follow-up task has been added to your list."
          : "Suggestion accepted — no task created.",
      });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/suggestions/${id}/dismiss`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suggestions", objectType, objectId] });
    },
  });

  const snoozeMutation = useMutation({
    mutationFn: ({ id, days }: { id: number; days: number }) =>
      apiRequest("POST", `/api/suggestions/${id}/snooze`, { days }),
    onSuccess: (_data, { days }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/suggestions", objectType, objectId] });
      toast({
        title: "Snoozed",
        description: `Reminder snoozed for ${days} day${days !== 1 ? "s" : ""}.`,
      });
    },
  });

  function handleSmartAction(suggestion: TaskSuggestion) {
    if (suggestion.suggestedActionType === "add_note" && onOpenNoteComposer) {
      onOpenNoteComposer();
    } else if (
      (suggestion.suggestedActionType === "review_opportunity" ||
        suggestion.suggestedActionType === "complete_task") &&
      onScrollToSection
    ) {
      onScrollToSection(
        suggestion.suggestedActionType === "review_opportunity"
          ? "opportunities"
          : "tasks"
      );
    }
    acceptMutation.mutate({ id: suggestion.id, createTask: true });
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-4 pb-3 px-4 space-y-2">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-md" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!suggestions.length) return null;

  return (
    <Card data-testid="suggested-actions-card">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-1.5 text-foreground">
          <Zap className="h-3.5 w-3.5 text-primary" />
          Suggested Next Actions
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            ({suggestions.length})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 pb-3 px-4 space-y-2">
        {suggestions.map((s) => {
          const Icon = ACTION_ICON[s.suggestedActionType] ?? Zap;
          const isAccepted = acceptedIds.has(s.id);

          return (
            <div
              key={s.id}
              className={`flex items-start gap-3 p-3 rounded-lg border transition-opacity ${
                isAccepted
                  ? "opacity-50 bg-muted/20 border-border/30"
                  : "bg-secondary/20 border-border/40"
              }`}
              data-testid={`suggestion-${s.id}`}
            >
              {/* Icon */}
              <div className="flex-shrink-0 mt-0.5">
                <Icon className="h-4 w-4 text-primary" />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                  <span className="text-sm font-medium text-foreground leading-tight">
                    {s.title}
                  </span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] px-1.5 py-0 h-4 border ${SEVERITY_STYLE[s.severity] ?? ""}`}
                    data-testid={`badge-severity-${s.id}`}
                  >
                    {SEVERITY_LABEL[s.severity] ?? s.severity}
                  </Badge>
                </div>

                {!compact && (
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <p className="text-xs text-muted-foreground leading-relaxed truncate cursor-default flex items-center gap-1">
                          <Info className="h-2.5 w-2.5 flex-shrink-0" />
                          {s.reason}
                        </p>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-56 text-xs">
                        {s.reason}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}

                {s.suggestedDueDate && !compact && (
                  <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                    Suggested by {format(new Date(s.suggestedDueDate), "MMM d")}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex-shrink-0 flex items-center gap-1">
                {/* Accept */}
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                        onClick={() => handleSmartAction(s)}
                        disabled={
                          acceptMutation.isPending || dismissMutation.isPending || isAccepted
                        }
                        data-testid={`button-accept-${s.id}`}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      Accept &amp; create task
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                {/* Dismiss */}
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-muted/40"
                        onClick={() => dismissMutation.mutate(s.id)}
                        disabled={dismissMutation.isPending || isAccepted}
                        data-testid={`button-dismiss-${s.id}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      Dismiss
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                {/* Snooze */}
                <DropdownMenu>
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-muted/40"
                            disabled={snoozeMutation.isPending || isAccepted}
                            data-testid={`button-snooze-${s.id}`}
                          >
                            <Clock className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">
                        Snooze
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <DropdownMenuContent align="end" className="w-32">
                    {SNOOZE_OPTIONS.map((opt) => (
                      <DropdownMenuItem
                        key={opt.days}
                        onClick={() =>
                          snoozeMutation.mutate({ id: s.id, days: opt.days })
                        }
                        data-testid={`snooze-${opt.days}d-${s.id}`}
                      >
                        <Clock className="h-3 w-3 mr-2" />
                        {opt.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
