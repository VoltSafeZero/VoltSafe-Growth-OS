import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CheckSquare, ExternalLink, Loader2, MessageSquare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

// ── Types ──────────────────────────────────────────────────────────────────────

export type CreateTaskSource =
  | {
      kind: "channel_message";
      messageId: number;
      body: string | null;
      userName: string;
      createdAt: string;
      channelSlug: string;
      threadRootId?: number;
    }
  | {
      kind: "record_message";
      messageId: number;
      body: string | null;
      userName: string;
      createdAt: string;
      objectType: string;
      objectId: number;
      threadRootId?: number;
    }
  | {
      kind: "summary_action_item";
      task: string;
      owner: string;
      due: string | null;
      summaryContext: string;
    };

interface Props {
  open: boolean;
  source: CreateTaskSource | null;
  onClose: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function stripMentionTokens(body: string): string {
  return body.replace(/@\[([^\]]+)\]\(user:\d+\)/g, "@$1");
}

function truncateTitle(text: string, max = 90): string {
  const stripped = stripMentionTokens(text).trim();
  if (stripped.length <= max) return stripped;
  return stripped.slice(0, max - 1).trimEnd() + "…";
}

function buildDescription(source: CreateTaskSource): string {
  if (source.kind === "channel_message") {
    const body = source.body ? stripMentionTokens(source.body) : "(no text)";
    const msgKind = source.threadRootId != null ? "thread reply" : "message";
    return (
      `Created from Currents ${msgKind} in #${source.channelSlug}.\n\n` +
      `"${body}"\n\n` +
      `— ${source.userName}, ${format(new Date(source.createdAt), "MMM d, yyyy 'at' h:mm a")}`
    );
  }
  if (source.kind === "record_message") {
    const body = source.body ? stripMentionTokens(source.body) : "(no text)";
    const msgKind = source.threadRootId != null ? "thread reply" : "message";
    const label = source.objectType.charAt(0).toUpperCase() + source.objectType.slice(1);
    return (
      `Created from Currents ${msgKind} on ${label} record.\n\n` +
      `"${body}"\n\n` +
      `— ${source.userName}, ${format(new Date(source.createdAt), "MMM d, yyyy 'at' h:mm a")}`
    );
  }
  return `Action Item from AI Summary\n\n${source.summaryContext}`;
}

function buildDefaultTitle(source: CreateTaskSource): string {
  if (source.kind === "channel_message" || source.kind === "record_message") {
    return source.body ? truncateTitle(source.body) : "Task from Currents";
  }
  return truncateTitle(source.task) || "Task from Currents";
}

function buildSourceMeta(source: CreateTaskSource): Record<string, unknown> {
  if (source.kind === "channel_message") {
    return {
      messageId: source.messageId,
      channelSlug: source.channelSlug,
      threadRootId: source.threadRootId ?? null,
      sourceContext: "currents_channel",
    };
  }
  if (source.kind === "record_message") {
    return {
      messageId: source.messageId,
      objectType: source.objectType,
      objectId: source.objectId,
      threadRootId: source.threadRootId ?? null,
      sourceContext: "currents_record",
    };
  }
  return {
    owner: source.owner,
    summaryContext: "currents_summary",
  };
}

// ── Component ──────────────────────────────────────────────────────────────────

export function CreateTaskFromCurrentDialog({ open, source, onClose }: Props) {
  const { toast } = useToast();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "urgent">("medium");
  const [dueDate, setDueDate] = useState("");
  const [assigneeId, setAssigneeId] = useState<string>("_none");
  const [success, setSuccess] = useState(false);
  const [createdTaskId, setCreatedTaskId] = useState<number | null>(null);

  const { data: users = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/users"],
    queryFn: () => fetch("/api/users", { credentials: "include" }).then(r => r.json()),
    staleTime: 60_000,
  });

  const { data: me } = useQuery<{ id: number; name: string }>({
    queryKey: ["/api/auth/me"],
    queryFn: () => fetch("/api/auth/me", { credentials: "include" }).then(r => r.json()),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!open || !source) return;
    setTitle(buildDefaultTitle(source));
    setDescription(buildDescription(source));
    setPriority("medium");
    setDueDate(
      source.kind === "summary_action_item" && source.due
        ? (() => {
            try {
              const d = new Date(source.due);
              if (isNaN(d.getTime())) return "";
              return format(d, "yyyy-MM-dd");
            } catch {
              return "";
            }
          })()
        : ""
    );
    // For summary action items: try to match the AI-provided owner name to a
    // user. Only pre-select if we find a confident (case-insensitive exact)
    // match — otherwise leave unassigned so the user can choose.
    if (source.kind === "summary_action_item") {
      const ownerName = source.owner?.trim();
      if (ownerName && ownerName !== "Unassigned" && users.length > 0) {
        const matched = users.find(
          u => u.name.toLowerCase() === ownerName.toLowerCase()
        );
        setAssigneeId(matched ? String(matched.id) : "_none");
      } else {
        setAssigneeId("_none");
      }
    } else {
      setAssigneeId(me ? String(me.id) : "_none");
    }
    setSuccess(false);
    setCreatedTaskId(null);
  }, [open, source, me, users]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!source) throw new Error("No source");
      const body: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        source: "current_message",
        sourceLabel: "Currents",
        sourceMeta: buildSourceMeta(source),
      };
      if (assigneeId && assigneeId !== "_none") {
        body.ownerUserId = Number(assigneeId);
      }
      if (dueDate) {
        body.dueDate = new Date(dueDate).toISOString();
      }
      if (source.kind === "record_message") {
        body.linkedObjectType = source.objectType;
        body.linkedObjectId = source.objectId;
      }
      const r = await apiRequest("POST", "/api/tasks", body);
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as any).message || "Failed to create task");
      }
      return r.json();
    },
    onSuccess: (task) => {
      setSuccess(true);
      setCreatedTaskId(task?.id ?? null);
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/hub"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/board"] });
    },
    onError: (err: Error) => {
      toast({ title: "Could not create task", description: err.message, variant: "destructive" });
    },
  });

  function handleClose() {
    if (!createMutation.isPending) onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent
        className="max-w-md"
        data-testid="create-task-from-current-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[14px]">
            <CheckSquare className="w-4 h-4 text-primary/70 shrink-0" />
            Create Task
          </DialogTitle>
        </DialogHeader>

        {success ? (
          <div className="py-4 text-center space-y-3">
            <div className="flex items-center justify-center gap-2 text-emerald-500">
              <CheckSquare className="w-5 h-5" />
              <span className="text-[13.5px] font-medium">Task created</span>
            </div>
            <p className="text-[12px] text-muted-foreground/60">
              The task has been added to your task board.
            </p>
            {createdTaskId && (
              <a
                href="/execution/tasks"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[12px] text-primary/70 hover:text-primary underline-offset-2 hover:underline transition-colors"
              >
                View in Tasks
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        ) : (
          <>
            {/* Source context badge */}
            {source && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-muted/40 border border-border/50 text-[11.5px] text-muted-foreground/70">
                <MessageSquare className="w-3 h-3 shrink-0 mt-0.5 text-primary/50" />
                <span className="leading-relaxed">
                  {source.kind === "channel_message" && (
                    <>From <span className="font-medium text-foreground/80">#{source.channelSlug}</span>{source.threadRootId != null ? " · thread reply" : ""} · {source.userName}</>
                  )}
                  {source.kind === "record_message" && (
                    <>From <span className="font-medium text-foreground/80">{source.objectType.charAt(0).toUpperCase() + source.objectType.slice(1)}</span> record Currents{source.threadRootId != null ? " · thread reply" : ""} · {source.userName}</>
                  )}
                  {source.kind === "summary_action_item" && (
                    <>From AI Summary — <span className="font-medium text-foreground/80">Action Item</span></>
                  )}
                </span>
              </div>
            )}

            <div className="space-y-3.5 pt-1">
              {/* Title */}
              <div className="space-y-1.5">
                <Label htmlFor="task-title" className="text-[12px] text-muted-foreground/80">
                  Title <span className="text-rose-400">*</span>
                </Label>
                <Input
                  id="task-title"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Task title"
                  className="text-[13px] h-8"
                  data-testid="input-task-title"
                />
              </div>

              {/* Assignee + Priority row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="task-assignee" className="text-[12px] text-muted-foreground/80">
                    Assignee
                  </Label>
                  <Select value={assigneeId} onValueChange={setAssigneeId}>
                    <SelectTrigger
                      id="task-assignee"
                      className="h-8 text-[12px]"
                      data-testid="select-task-assignee"
                    >
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Unassigned</SelectItem>
                      {users.map(u => (
                        <SelectItem key={u.id} value={String(u.id)}>
                          {u.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="task-priority" className="text-[12px] text-muted-foreground/80">
                    Priority
                  </Label>
                  <Select value={priority} onValueChange={v => setPriority(v as typeof priority)}>
                    <SelectTrigger
                      id="task-priority"
                      className="h-8 text-[12px]"
                      data-testid="select-task-priority"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Due date */}
              <div className="space-y-1.5">
                <Label htmlFor="task-due" className="text-[12px] text-muted-foreground/80">
                  Due Date
                </Label>
                <Input
                  id="task-due"
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  className="text-[12px] h-8"
                  data-testid="input-task-due"
                />
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <Label htmlFor="task-desc" className="text-[12px] text-muted-foreground/80">
                  Description
                </Label>
                <Textarea
                  id="task-desc"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={3}
                  className="text-[12px] resize-none"
                  data-testid="textarea-task-description"
                />
              </div>
            </div>
          </>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            data-testid="btn-task-cancel"
            className="text-[12px]"
          >
            {success ? "Close" : "Cancel"}
          </Button>
          {!success && (
            <Button
              size="sm"
              onClick={() => createMutation.mutate()}
              disabled={!title.trim() || createMutation.isPending}
              data-testid="btn-task-create"
              className="text-[12px]"
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                  Creating…
                </>
              ) : (
                "Create Task"
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
