import { useState } from "react";
import TaskRulesSettingsPage from "./task-rules-settings";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Zap, Plus, Pencil, Trash2, Play, History, ChevronDown, ChevronRight,
  CheckCircle, XCircle, Clock, AlertTriangle, Copy, BookOpen, Info,
  Settings2, FlaskConical,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
interface AutomationRule {
  id: number;
  name: string;
  description: string | null;
  enabled: boolean;
  triggerType: string;
  conditions: ConditionRow[];
  actions: ActionRow[];
  scope: string;
  cooldownMinutes: number;
  dedupeKey: string | null;
  isTemplate: boolean;
  templateName: string | null;
  runCount: number;
  lastRunAt: string | null;
  lastResult: string | null;
  createdAt: string;
  updatedAt: string;
}
interface RunLog {
  id: number;
  ruleId: number;
  status: string;
  actionsTaken: number;
  dryRun: boolean;
  executedAt: string;
  triggerData: Record<string, unknown> | null;
  actionsResult: ActionResult[] | null;
  errorMessage: string | null;
}
interface ActionResult {
  action: { type: string; params: Record<string, unknown> };
  success: boolean;
  detail: string;
  skipped?: boolean;
}
interface ConditionRow {
  field: string;
  op: string;
  value: string;
  logic: "AND" | "OR";
}
interface ActionRow {
  type: string;
  params: Record<string, string | number>;
}
interface TriggerType { value: string; label: string; group: string }
interface ConditionOp { value: string; label: string }
interface ActionType { value: string; label: string; group: string }

// ── Field suggestions per trigger ─────────────────────────────────────────────
const TRIGGER_FIELDS: Record<string, string[]> = {
  record_created:       ["objectType", "after.status", "after.priority"],
  field_changed:        ["objectType", "before.status", "after.status", "before.stage", "after.stage"],
  status_changed:       ["objectType", "before.status", "after.status"],
  date_approaching:     ["objectType", "after.dueDate", "extra.daysUntil"],
  date_overdue:         ["objectType", "after.dueDate"],
  task_overdue:         ["objectType", "after.dueDate", "after.priority"],
  quote_accepted:       ["objectType", "after.status"],
  deployment_blocked:   ["objectType", "after.status"],
  certification_blocker:["objectType", "extra.category"],
  renewal_due:          ["objectType", "extra.daysUntilRenewal"],
  document_added:       ["objectType", "extra.category", "extra.source"],
  engagement_signal:    ["objectType", "extra.signalType"],
  manual:               ["objectType"],
};

const DEFAULT_CONDITION: ConditionRow = { field: "objectType", op: "equals", value: "", logic: "AND" };
const DEFAULT_ACTION: ActionRow = { type: "create_task", params: { title: "", priority: "medium", dueDaysFromNow: 3 } };

function triggerLabel(value: string, types: TriggerType[]): string {
  return types.find(t => t.value === value)?.label ?? value;
}
function relativeTime(ts: string): string {
  const d = new Date(ts);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Condition Builder ──────────────────────────────────────────────────────────
function ConditionBuilder({
  conditions, onChange, triggerType, ops,
}: {
  conditions: ConditionRow[];
  onChange: (c: ConditionRow[]) => void;
  triggerType: string;
  ops: ConditionOp[];
}) {
  const fields = TRIGGER_FIELDS[triggerType] ?? ["objectType"];
  const add = () => onChange([...conditions, { ...DEFAULT_CONDITION }]);
  const remove = (i: number) => onChange(conditions.filter((_, idx) => idx !== i));
  const update = (i: number, patch: Partial<ConditionRow>) => {
    const next = [...conditions];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };

  return (
    <div className="space-y-2" data-testid="condition-builder">
      {conditions.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No conditions — rule matches all records.</p>
      )}
      {conditions.map((c, i) => (
        <div key={i} className="flex items-center gap-2 flex-wrap">
          {i > 0 && (
            <Select value={c.logic} onValueChange={v => update(i, { logic: v as "AND" | "OR" })}>
              <SelectTrigger className="w-16 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AND">AND</SelectItem>
                <SelectItem value="OR">OR</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Select value={c.field} onValueChange={v => update(i, { field: v })}>
            <SelectTrigger className="w-40 h-8 text-xs" data-testid={`condition-field-${i}`}>
              <SelectValue placeholder="Field" />
            </SelectTrigger>
            <SelectContent>
              {fields.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              <SelectItem value="custom">custom…</SelectItem>
            </SelectContent>
          </Select>
          {c.field === "custom" && (
            <Input className="h-8 text-xs w-32" placeholder="field.path" value={c.field === "custom" ? "" : c.field} onChange={e => update(i, { field: e.target.value })} />
          )}
          <Select value={c.op} onValueChange={v => update(i, { op: v })}>
            <SelectTrigger className="w-36 h-8 text-xs" data-testid={`condition-op-${i}`}>
              <SelectValue placeholder="Operator" />
            </SelectTrigger>
            <SelectContent>
              {ops.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {!["is_null", "is_not_null", "date_overdue"].includes(c.op) && (
            <Input
              className="h-8 text-xs w-32"
              placeholder="value"
              value={c.value}
              onChange={e => update(i, { value: e.target.value })}
              data-testid={`condition-value-${i}`}
            />
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(i)} data-testid={`condition-remove-${i}`}>
            <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="h-7 text-xs mt-1" onClick={add} data-testid="condition-add">
        <Plus className="h-3 w-3 mr-1" /> Add condition
      </Button>
    </div>
  );
}

// ── Action Builder ─────────────────────────────────────────────────────────────
function ActionParamFields({ type, params, onChange }: { type: string; params: Record<string, string | number>; onChange: (p: Record<string, string | number>) => void }) {
  const set = (key: string, val: string | number) => onChange({ ...params, [key]: val });
  switch (type) {
    case "create_task":
    case "create_suggestion":
      return (
        <div className="flex gap-2 flex-wrap mt-1">
          <Input className="h-7 text-xs flex-1 min-w-32" placeholder="Title" value={String(params.title ?? "")} onChange={e => set("title", e.target.value)} data-testid="action-param-title" />
          <Select value={String(params.priority ?? "medium")} onValueChange={v => set("priority", v)}>
            <SelectTrigger className="w-24 h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["low","medium","high","urgent"].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          {type === "create_task" && (
            <Input className="h-7 text-xs w-28" type="number" min={0} placeholder="Due in X days" value={String(params.dueDaysFromNow ?? 3)} onChange={e => set("dueDaysFromNow", Number(e.target.value))} data-testid="action-param-due" />
          )}
          {type === "create_suggestion" && (
            <Input className="h-7 text-xs flex-1 min-w-32" placeholder="Reason" value={String(params.reason ?? "")} onChange={e => set("reason", e.target.value)} />
          )}
        </div>
      );
    case "create_notification":
      return (
        <div className="flex gap-2 flex-wrap mt-1">
          <Input className="h-7 text-xs flex-1 min-w-32" placeholder="Title" value={String(params.title ?? "")} onChange={e => set("title", e.target.value)} />
          <Input className="h-7 text-xs flex-1 min-w-32" placeholder="Body" value={String(params.body ?? "")} onChange={e => set("body", e.target.value)} />
          <Select value={String(params.severity ?? "medium")} onValueChange={v => set("severity", v)}>
            <SelectTrigger className="w-24 h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["low","medium","high","critical"].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input className="h-7 text-xs w-32" placeholder="Action URL" value={String(params.actionUrl ?? "/")} onChange={e => set("actionUrl", e.target.value)} />
        </div>
      );
    case "add_timeline_event":
    case "flag_record":
      return (
        <div className="flex gap-2 mt-1">
          <Input className="h-7 text-xs flex-1" placeholder={type === "flag_record" ? "Flag note" : "Subject"} value={String(params.subject ?? params.note ?? "")} onChange={e => set(type === "flag_record" ? "note" : "subject", e.target.value)} />
          {type === "add_timeline_event" && (
            <Input className="h-7 text-xs flex-1" placeholder="Summary (optional)" value={String(params.summary ?? "")} onChange={e => set("summary", e.target.value)} />
          )}
        </div>
      );
    case "change_status":
      return (
        <div className="flex gap-2 mt-1">
          <Input className="h-7 text-xs flex-1" placeholder="New status value" value={String(params.status ?? "")} onChange={e => set("status", e.target.value)} />
        </div>
      );
    case "assign_owner":
      return (
        <div className="flex gap-2 mt-1">
          <Input className="h-7 text-xs w-32" type="number" placeholder="User ID" value={String(params.userId ?? "")} onChange={e => set("userId", Number(e.target.value))} />
        </div>
      );
    default:
      return null;
  }
}

function ActionBuilder({
  actions, onChange, actionTypes,
}: {
  actions: ActionRow[];
  onChange: (a: ActionRow[]) => void;
  actionTypes: ActionType[];
}) {
  const add = () => onChange([...actions, { ...DEFAULT_ACTION }]);
  const remove = (i: number) => onChange(actions.filter((_, idx) => idx !== i));
  const update = (i: number, patch: Partial<ActionRow>) => {
    const next = [...actions];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };

  return (
    <div className="space-y-3" data-testid="action-builder">
      {actions.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No actions — rule will match but do nothing.</p>
      )}
      {actions.map((a, i) => (
        <div key={i} className="border border-border rounded-lg p-3 bg-muted/30">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-4">{i + 1}.</span>
            <Select value={a.type} onValueChange={v => update(i, { type: v, params: {} })}>
              <SelectTrigger className="h-8 text-xs flex-1" data-testid={`action-type-${i}`}>
                <SelectValue placeholder="Action type" />
              </SelectTrigger>
              <SelectContent>
                {actionTypes.map(at => <SelectItem key={at.value} value={at.value}>{at.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(i)} data-testid={`action-remove-${i}`}>
              <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </div>
          <ActionParamFields type={a.type} params={a.params} onChange={p => update(i, { params: p })} />
        </div>
      ))}
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={add} data-testid="action-add">
        <Plus className="h-3 w-3 mr-1" /> Add action
      </Button>
    </div>
  );
}

// ── Rule Editor Dialog ─────────────────────────────────────────────────────────
function RuleEditorDialog({
  open, onClose, rule, triggerTypes, conditionOps, actionTypes,
}: {
  open: boolean;
  onClose: () => void;
  rule?: AutomationRule;
  triggerTypes: TriggerType[];
  conditionOps: ConditionOp[];
  actionTypes: ActionType[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const isNew = !rule;

  const [name, setName] = useState(rule?.name ?? "");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [triggerType, setTriggerType] = useState(rule?.triggerType ?? "manual");
  const [conditions, setConditions] = useState<ConditionRow[]>((rule?.conditions as ConditionRow[]) ?? []);
  const [actions, setActions] = useState<ActionRow[]>((rule?.actions as ActionRow[]) ?? [{ ...DEFAULT_ACTION }]);
  const [cooldown, setCooldown] = useState(String(rule?.cooldownMinutes ?? 0));
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);

  const save = useMutation({
    mutationFn: (body: unknown) => isNew
      ? apiRequest("/api/automations", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } })
      : apiRequest(`/api/automations/${rule!.id}`, { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/automations"] });
      toast({ title: isNew ? "Rule created" : "Rule updated" });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleSave = () => {
    if (!name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    save.mutate({ name, description, triggerType, conditions, actions, cooldownMinutes: Number(cooldown), enabled });
  };

  const groupedTriggers = triggerTypes.reduce<Record<string, TriggerType[]>>((acc, t) => {
    (acc[t.group] = acc[t.group] ?? []).push(t);
    return acc;
  }, {});

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="rule-editor-dialog">
        <DialogHeader>
          <DialogTitle>{isNew ? "Create Automation Rule" : "Edit Rule"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Name + description */}
          <div className="grid gap-3">
            <div>
              <Label className="text-xs">Rule Name *</Label>
              <Input className="mt-1" placeholder="e.g. Quote Accepted → Onboarding Tasks" value={name} onChange={e => setName(e.target.value)} data-testid="rule-name-input" />
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Textarea className="mt-1 text-sm" rows={2} placeholder="What does this rule do?" value={description} onChange={e => setDescription(e.target.value)} data-testid="rule-description-input" />
            </div>
          </div>

          {/* Trigger */}
          <div>
            <Label className="text-xs">Trigger</Label>
            <Select value={triggerType} onValueChange={setTriggerType}>
              <SelectTrigger className="mt-1" data-testid="rule-trigger-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(groupedTriggers).map(([group, items]) => (
                  <div key={group}>
                    <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{group}</div>
                    {items.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </div>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Conditions */}
          <div>
            <Label className="text-xs mb-2 block">Conditions <span className="text-muted-foreground font-normal">(all must match)</span></Label>
            <ConditionBuilder conditions={conditions} onChange={setConditions} triggerType={triggerType} ops={conditionOps} />
          </div>

          {/* Actions */}
          <div>
            <Label className="text-xs mb-2 block">Actions</Label>
            <ActionBuilder actions={actions} onChange={setActions} actionTypes={actionTypes} />
          </div>

          {/* Safety */}
          <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
            <div>
              <Label className="text-xs">Cooldown (minutes)</Label>
              <Input className="mt-1 h-8" type="number" min={0} value={cooldown} onChange={e => setCooldown(e.target.value)} data-testid="rule-cooldown-input" />
              <p className="text-[10px] text-muted-foreground mt-1">0 = no cooldown</p>
            </div>
            <div className="flex items-center gap-2 pt-4">
              <Switch checked={enabled} onCheckedChange={setEnabled} data-testid="rule-enabled-switch" />
              <Label className="text-sm">{enabled ? "Enabled" : "Disabled"}</Label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={save.isPending} data-testid="rule-save-button">
            {save.isPending ? "Saving…" : isNew ? "Create Rule" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Run History Panel ──────────────────────────────────────────────────────────
function RunHistoryPanel({ ruleId, onClose }: { ruleId: number; onClose: () => void }) {
  const { data: logs = [], isLoading } = useQuery<RunLog[]>({
    queryKey: ["/api/automations", ruleId, "history"],
    queryFn: () => apiRequest(`/api/automations/${ruleId}/history?limit=25`).then(r => r.json()),
  });

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><History className="h-4 w-4" /> Run History</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground text-sm">Loading…</div>
        ) : logs.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground text-sm">No runs yet.</div>
        ) : (
          <div className="space-y-2">
            {logs.map(log => (
              <div key={log.id} className="border border-border rounded-lg p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {log.status === "success"
                      ? <CheckCircle className="h-4 w-4 text-emerald-500" />
                      : <XCircle className="h-4 w-4 text-red-500" />}
                    <span className="font-medium capitalize">{log.status}</span>
                    {log.dryRun && <Badge variant="outline" className="text-[10px] h-4">dry run</Badge>}
                  </div>
                  <span className="text-xs text-muted-foreground">{relativeTime(log.executedAt)}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{log.actionsTaken} action{log.actionsTaken !== 1 ? "s" : ""} taken</div>
                {log.actionsResult && log.actionsResult.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {log.actionsResult.map((r, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-xs">
                        {r.success ? <CheckCircle className="h-3 w-3 text-emerald-500 mt-0.5 shrink-0" /> : <XCircle className="h-3 w-3 text-red-400 mt-0.5 shrink-0" />}
                        <span className={r.skipped ? "text-muted-foreground" : ""}>{r.detail}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Run Rule Panel ─────────────────────────────────────────────────────────────
function RunRulePanel({ rule, onClose }: { rule: AutomationRule; onClose: () => void }) {
  const { toast } = useToast();
  const [objectType, setObjectType] = useState("account");
  const [objectId, setObjectId] = useState("1");
  const [dryRun, setDryRun] = useState(true);
  const [result, setResult] = useState<{ matched: boolean; actionsTaken: number; actionsResult: ActionResult[] } | null>(null);

  const run = useMutation({
    mutationFn: () => apiRequest(`/api/automations/${rule.id}/run`, {
      method: "POST",
      body: JSON.stringify({ objectType, objectId: Number(objectId), dryRun }),
      headers: { "Content-Type": "application/json" },
    }).then(r => r.json()),
    onSuccess: (data) => {
      setResult(data);
      toast({ title: data.matched ? "Rule matched!" : "No match", description: `${data.actionsTaken} actions taken` });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="run-rule-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Play className="h-4 w-4" /> Run Rule Manually</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">Simulate or execute this rule against a specific record.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Object Type</Label>
              <Input className="mt-1 h-8 text-xs" value={objectType} onChange={e => setObjectType(e.target.value)} data-testid="run-object-type" />
            </div>
            <div>
              <Label className="text-xs">Object ID</Label>
              <Input className="mt-1 h-8 text-xs" type="number" value={objectId} onChange={e => setObjectId(e.target.value)} data-testid="run-object-id" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={dryRun} onCheckedChange={setDryRun} data-testid="run-dry-run-switch" />
            <Label className="text-sm flex items-center gap-1.5">
              <FlaskConical className="h-3.5 w-3.5" />
              Dry run <span className="text-muted-foreground text-xs">(preview only, no side effects)</span>
            </Label>
          </div>

          {result && (
            <div className="border border-border rounded-lg p-3 text-sm space-y-2">
              <div className="flex items-center gap-2 font-medium">
                {result.matched
                  ? <CheckCircle className="h-4 w-4 text-emerald-500" />
                  : <XCircle className="h-4 w-4 text-muted-foreground" />}
                {result.matched ? "Conditions matched" : "Conditions did not match"}
              </div>
              {result.actionsResult?.map((r, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs">
                  {r.success ? <CheckCircle className="h-3 w-3 text-emerald-500 mt-0.5" /> : <XCircle className="h-3 w-3 text-red-400 mt-0.5" />}
                  <span className={r.skipped ? "text-muted-foreground" : ""}>{r.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={() => run.mutate()} disabled={run.isPending} data-testid="run-confirm-button">
            {run.isPending ? "Running…" : dryRun ? "Preview" : "Execute"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Rule Card ──────────────────────────────────────────────────────────────────
function RuleCard({
  rule, triggerTypes, onEdit, onDelete, onHistory, onRun,
}: {
  rule: AutomationRule;
  triggerTypes: TriggerType[];
  onEdit: () => void;
  onDelete: () => void;
  onHistory: () => void;
  onRun: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const toggle = useMutation({
    mutationFn: () => apiRequest(`/api/automations/${rule.id}/toggle`, { method: "PATCH" }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/automations"] }),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className={`border border-border rounded-xl p-4 bg-card shadow-sm transition-opacity ${rule.enabled ? "" : "opacity-60"}`} data-testid={`rule-card-${rule.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sm truncate" data-testid={`rule-name-${rule.id}`}>{rule.name}</h3>
            {rule.isTemplate && <Badge variant="secondary" className="text-[10px] h-4">template</Badge>}
            <Badge variant={rule.enabled ? "default" : "outline"} className="text-[10px] h-4">
              {rule.enabled ? "active" : "paused"}
            </Badge>
          </div>
          {rule.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{rule.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1">
              <Zap className="h-3 w-3" />
              {triggerLabel(rule.triggerType, triggerTypes)}
            </span>
            <span>{(rule.conditions as ConditionRow[]).length} condition{(rule.conditions as ConditionRow[]).length !== 1 ? "s" : ""}</span>
            <span>{(rule.actions as ActionRow[]).length} action{(rule.actions as ActionRow[]).length !== 1 ? "s" : ""}</span>
            {rule.lastRunAt && (
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Last run {relativeTime(rule.lastRunAt)}</span>
            )}
            {rule.runCount > 0 && <span>{rule.runCount} run{rule.runCount !== 1 ? "s" : ""}</span>}
          </div>
        </div>

        {/* Enable / disable toggle */}
        <div className="flex items-center gap-1 shrink-0">
          <Switch
            checked={rule.enabled}
            onCheckedChange={() => toggle.mutate()}
            disabled={toggle.isPending}
            data-testid={`toggle-rule-${rule.id}`}
          />
        </div>
      </div>

      <div className="flex items-center gap-1 mt-3 pt-3 border-t border-border">
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={onEdit} data-testid={`edit-rule-${rule.id}`}>
          <Pencil className="h-3 w-3" /> Edit
        </Button>
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={onRun} data-testid={`run-rule-${rule.id}`}>
          <Play className="h-3 w-3" /> Run
        </Button>
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={onHistory} data-testid={`history-rule-${rule.id}`}>
          <History className="h-3 w-3" /> History
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-red-500 hover:text-red-600" onClick={onDelete} data-testid={`delete-rule-${rule.id}`}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// ── Main Automations Page ──────────────────────────────────────────────────────
export default function AutomationsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"builder" | "task-rules">("builder");
  const [search, setSearch] = useState("");
  const [filterEnabled, setFilterEnabled] = useState<"all" | "enabled" | "disabled">("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editRule, setEditRule] = useState<AutomationRule | undefined>();
  const [historyRuleId, setHistoryRuleId] = useState<number | null>(null);
  const [runRule, setRunRule] = useState<AutomationRule | null>(null);

  const { data: rules = [], isLoading } = useQuery<AutomationRule[]>({
    queryKey: ["/api/automations"],
    queryFn: () => apiRequest("/api/automations").then(r => r.json()),
  });

  const { data: triggerTypes = [] } = useQuery<TriggerType[]>({
    queryKey: ["/api/automations/trigger-types"],
    queryFn: () => apiRequest("/api/automations/trigger-types").then(r => r.json()),
  });

  const { data: conditionOps = [] } = useQuery<ConditionOp[]>({
    queryKey: ["/api/automations/condition-ops"],
    queryFn: () => apiRequest("/api/automations/condition-ops").then(r => r.json()),
  });

  const { data: actionTypes = [] } = useQuery<ActionType[]>({
    queryKey: ["/api/automations/action-types"],
    queryFn: () => apiRequest("/api/automations/action-types").then(r => r.json()),
  });

  const deleteRule = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/automations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/automations"] });
      toast({ title: "Rule deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = rules.filter(r => {
    const matchSearch = !search || r.name.toLowerCase().includes(search.toLowerCase()) || (r.description ?? "").toLowerCase().includes(search.toLowerCase());
    const matchEnabled = filterEnabled === "all" || (filterEnabled === "enabled" ? r.enabled : !r.enabled);
    return matchSearch && matchEnabled;
  });

  const templates = filtered.filter(r => r.isTemplate);
  const custom = filtered.filter(r => !r.isTemplate);
  const enabledCount = rules.filter(r => r.enabled).length;

  const openEditor = (rule?: AutomationRule) => {
    setEditRule(rule);
    setEditorOpen(true);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border/60 px-6 shrink-0" data-testid="automations-tab-bar">
        {(["builder", "task-rules"] as const).map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            data-testid={`tab-automations-${t}`}
          >
            {t === "builder" ? "Automation Builder" : "Task Rules"}
          </button>
        ))}
      </div>

      {activeTab === "task-rules" ? (
        <TaskRulesSettingsPage />
      ) : (
        <>
          {/* Builder header */}
          <div className="border-b border-border px-6 py-4 shrink-0">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-semibold flex items-center gap-2">
                  <Zap className="h-5 w-5 text-primary" /> Automation Builder
                </h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {rules.length} rule{rules.length !== 1 ? "s" : ""} · {enabledCount} active
                </p>
              </div>
              <Button onClick={() => openEditor()} data-testid="create-rule-button">
                <Plus className="h-4 w-4 mr-1.5" /> New Rule
              </Button>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              <Input
                placeholder="Search rules…"
                className="h-8 w-64 text-sm"
                value={search}
                onChange={e => setSearch(e.target.value)}
                data-testid="search-rules-input"
              />
              <div className="flex items-center rounded-lg border border-border overflow-hidden">
                {(["all", "enabled", "disabled"] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilterEnabled(f)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${filterEnabled === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                    data-testid={`filter-${f}`}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Builder content */}
          <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="animate-spin h-6 w-6 rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : rules.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-60 gap-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Zap className="h-7 w-7 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold">No automation rules yet</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">Starter templates will be seeded on first load. Create your first custom rule above.</p>
            </div>
            <Button onClick={() => openEditor()} data-testid="create-first-rule-button">
              <Plus className="h-4 w-4 mr-1.5" /> Create First Rule
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">No rules match your filters.</div>
        ) : (
          <div className="space-y-6">
            {/* Starter templates */}
            {templates.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <BookOpen className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Starter Templates</h2>
                  <Badge variant="secondary" className="text-[10px] h-4">{templates.length}</Badge>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="templates-grid">
                  {templates.map(rule => (
                    <RuleCard
                      key={rule.id}
                      rule={rule}
                      triggerTypes={triggerTypes}
                      onEdit={() => openEditor(rule)}
                      onDelete={() => deleteRule.mutate(rule.id)}
                      onHistory={() => setHistoryRuleId(rule.id)}
                      onRun={() => setRunRule(rule)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Custom rules */}
            {custom.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Settings2 className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Custom Rules</h2>
                  <Badge variant="secondary" className="text-[10px] h-4">{custom.length}</Badge>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="custom-rules-grid">
                  {custom.map(rule => (
                    <RuleCard
                      key={rule.id}
                      rule={rule}
                      triggerTypes={triggerTypes}
                      onEdit={() => openEditor(rule)}
                      onDelete={() => deleteRule.mutate(rule.id)}
                      onHistory={() => setHistoryRuleId(rule.id)}
                      onRun={() => setRunRule(rule)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
          </div>
        </>
      )}

      {/* Dialogs */}
      {editorOpen && (
        <RuleEditorDialog
          open={editorOpen}
          onClose={() => { setEditorOpen(false); setEditRule(undefined); }}
          rule={editRule}
          triggerTypes={triggerTypes}
          conditionOps={conditionOps}
          actionTypes={actionTypes}
        />
      )}
      {historyRuleId !== null && (
        <RunHistoryPanel ruleId={historyRuleId} onClose={() => setHistoryRuleId(null)} />
      )}
      {runRule && (
        <RunRulePanel rule={runRule} onClose={() => setRunRule(null)} />
      )}
    </div>
  );
}
