import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Settings2, Zap, Mail, Users, Target, FileText, AlertTriangle, CheckSquare, Save,
} from "lucide-react";

type RuleConfig = {
  ruleId: string;
  label: string;
  description: string | null;
  thresholdValue: number;
  thresholdUnit: string;
  isEnabled: boolean;
  assigneeStrategy: string;
  defaultAssigneeUserId: number | null;
};

const RULE_ICONS: Record<string, React.ElementType> = {
  unanswered_email: Mail,
  stale_lead: Users,
  missing_next_step: Target,
  quote_no_followup: FileText,
  account_needs_attention: AlertTriangle,
  overdue_task_reminder: CheckSquare,
};

const RULE_COLORS: Record<string, string> = {
  unanswered_email: "text-blue-400",
  stale_lead: "text-amber-400",
  missing_next_step: "text-purple-400",
  quote_no_followup: "text-green-400",
  account_needs_attention: "text-orange-400",
  overdue_task_reminder: "text-red-400",
};

const ASSIGNEE_LABELS: Record<string, string> = {
  record_owner: "Record Owner",
  email_owner: "Email Owner",
  admin: "Admin fallback",
  custom: "Custom user",
};

function RuleCard({
  rule,
  users,
  onSave,
  saving,
}: {
  rule: RuleConfig;
  users: { id: number; name: string }[];
  onSave: (ruleId: string, updates: Partial<RuleConfig>) => void;
  saving: boolean;
}) {
  const [localRule, setLocalRule] = useState<RuleConfig>(rule);
  const [dirty, setDirty] = useState(false);
  const Icon = RULE_ICONS[rule.ruleId] ?? Settings2;
  const colorCls = RULE_COLORS[rule.ruleId] ?? "text-muted-foreground";

  const update = (patch: Partial<RuleConfig>) => {
    setLocalRule(prev => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const handleSave = () => {
    onSave(rule.ruleId, localRule);
    setDirty(false);
  };

  return (
    <div
      className={`rounded-lg border border-border/40 bg-card/50 p-4 transition-all ${!localRule.isEnabled ? "opacity-50" : ""}`}
      data-testid={`rule-card-${rule.ruleId}`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 shrink-0 ${colorCls}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{localRule.label}</span>
              {!localRule.isEnabled && (
                <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 text-muted-foreground">
                  Disabled
                </Badge>
              )}
            </div>
            <Switch
              checked={localRule.isEnabled}
              onCheckedChange={v => update({ isEnabled: v })}
              data-testid={`switch-rule-${rule.ruleId}`}
            />
          </div>
          {rule.description && (
            <p className="text-xs text-muted-foreground mt-1">{rule.description}</p>
          )}

          {localRule.isEnabled && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Threshold */}
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  Threshold
                </label>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min={1}
                    max={999}
                    value={localRule.thresholdValue}
                    onChange={e => update({ thresholdValue: Number(e.target.value) })}
                    className="h-8 w-20 text-sm"
                    data-testid={`input-threshold-${rule.ruleId}`}
                  />
                  <Select
                    value={localRule.thresholdUnit}
                    onValueChange={v => update({ thresholdUnit: v })}
                  >
                    <SelectTrigger className="h-8 w-24 text-xs" data-testid={`select-unit-${rule.ruleId}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hours">hours</SelectItem>
                      <SelectItem value="days">days</SelectItem>
                      <SelectItem value="weeks">weeks</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Assignee strategy */}
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  Assign to
                </label>
                <Select
                  value={localRule.assigneeStrategy}
                  onValueChange={v => update({ assigneeStrategy: v })}
                >
                  <SelectTrigger className="h-8 text-xs" data-testid={`select-assignee-${rule.ruleId}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ASSIGNEE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Custom user (only if strategy = custom) */}
              {localRule.assigneeStrategy === "custom" && (
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                    Custom user
                  </label>
                  <Select
                    value={String(localRule.defaultAssigneeUserId ?? "")}
                    onValueChange={v => update({ defaultAssigneeUserId: Number(v) })}
                  >
                    <SelectTrigger className="h-8 text-xs" data-testid={`select-custom-user-${rule.ruleId}`}>
                      <SelectValue placeholder="Select user" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map(u => (
                        <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {dirty && (
            <div className="mt-3 flex justify-end">
              <Button
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={handleSave}
                disabled={saving}
                data-testid={`button-save-rule-${rule.ruleId}`}
              >
                <Save className="h-3 w-3" />
                Save
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TaskRulesSettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [savingRule, setSavingRule] = useState<string | null>(null);

  const { data: rules = [], isLoading } = useQuery<RuleConfig[]>({
    queryKey: ["/api/task-rules"],
    queryFn: () => fetch("/api/task-rules", { credentials: "include" }).then(r => r.json()),
  });

  const { data: usersData = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/users"],
    queryFn: () => fetch("/api/users", { credentials: "include" }).then(r => r.json()),
  });

  const updateMut = useMutation({
    mutationFn: ({ ruleId, updates }: { ruleId: string; updates: Partial<RuleConfig> }) =>
      apiRequest("PUT", `/api/task-rules/${ruleId}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/task-rules"] });
      toast({ description: "Rule saved" });
      setSavingRule(null);
    },
    onError: () => {
      toast({ variant: "destructive", description: "Failed to save rule" });
      setSavingRule(null);
    },
  });

  const handleSave = (ruleId: string, updates: Partial<RuleConfig>) => {
    setSavingRule(ruleId);
    updateMut.mutate({ ruleId, updates });
  };

  const enabledCount = rules.filter(r => r.isEnabled).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border/50 bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="px-4 md:px-6 pt-5 pb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                Task Automation Rules
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Configure thresholds for automatic task suggestions
              </p>
            </div>
            <Badge variant="outline" className="text-xs" data-testid="badge-enabled-count">
              {enabledCount} of {rules.length} enabled
            </Badge>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ) : rules.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Settings2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No task rules configured</p>
          </div>
        ) : (
          <div className="space-y-3 max-w-3xl">
            <p className="text-xs text-muted-foreground mb-4">
              These rules scan your CRM data to suggest tasks before they slip through the cracks.
              Adjust thresholds to control when suggestions appear.
            </p>
            {rules.map(rule => (
              <RuleCard
                key={rule.ruleId}
                rule={rule}
                users={usersData}
                onSave={handleSave}
                saving={savingRule === rule.ruleId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
