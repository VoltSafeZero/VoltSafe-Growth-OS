/**
 * Spark-style horizontal action toolbar that pins to the top of the open
 * email reader. Mirrors the icon row from Spark Mail (see attached
 * screenshots in the request):
 *
 *   ✕  ✓  |  🗑  ⚡  ⚪  📌  ↙  🔗  ⏰  +ai  ⋯              Assign  Share
 *
 * Most actions delegate to the parent through props so the heavy
 * mutations (star/archive/mark-read/snooze) stay co-located with the rest
 * of the inbox state in gmail-inbox.tsx. Things that are purely local —
 * Set Aside, Pin, Share — are wired through the localStorage hooks in
 * inbox-actions-store.ts.
 *
 * Assign uses the new `PATCH /api/inbox/threads/:threadId/assign` endpoint
 * (existing email_threads.assignedUserId column).
 *
 * AI summary / translation calls `POST /api/inbox/threads/:threadId/ai-summary`.
 */

import { memo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  X as CloseIcon,
  Check,
  Trash2,
  Zap,
  Circle,
  Flame,
  ArrowDownLeft,
  Link as LinkIcon,
  Clock,
  Sparkles,
  MoreHorizontal,
  Reply,
  Send,
  Ban,
  FolderInput,
  AlertOctagon,
  Printer,
  Copy,
  Upload,
  ListChecks,
  UserPlus2,
  Share2,
  Loader2,
  ChevronDown,
  Languages,
  Pin,
  PinOff,
  CheckCircle2,
  ShieldCheck,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useShareAccess } from "./inbox-actions-store";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export interface ActionsToolbarUser {
  id: number;
  name: string | null;
  email: string;
}

export interface ActionsToolbarHandlers {
  onClose: () => void;
  onMarkDone: () => void;
  onTrash: () => void;
  onTogglePriority: () => void;
  onMarkUnread: () => void;
  onTogglePin: () => void;
  onSetAside: () => void;
  /** "Send again" — opens compose pre-filled with the current message body. */
  onSendAgain: () => void;
  onReply: () => void;
  onMove: () => void;
  onMarkSpam: () => void;
  onBlock: () => void;
  /** Remove SPAM label and move to Inbox. Only called when isSpamView=true. */
  onNotSpam?: () => void;
}

export interface EmailActionsToolbarProps {
  threadId: string;
  /** Currently focused message in the thread; needed for Mark Unread / Send Again. */
  focusedMessage: {
    id: string;
    subject?: string | null;
    body?: string;
    snippet?: string | null;
  } | null;
  /** True when this message currently has the STARRED label. */
  isPriority: boolean;
  /** True when the user has pinned this thread (Smart Inbox pin-set). */
  isPinned: boolean;
  /** True when the user has set this thread aside. */
  isSetAside: boolean;
  /** Currently assigned user id (from email_threads.assignedUserId), if any. */
  assignedUserId: number | null;
  /** When true, all "edit" actions (star, archive, etc.) are hidden — view-only mailboxes. */
  readOnly?: boolean;
  /** Whether the inline reply button should be visible (canSend gate from parent). */
  canReply: boolean;
  /** When true, shows "Not Spam" as a prominent action and hides irrelevant Inbox actions. */
  isSpamView?: boolean;
  handlers: ActionsToolbarHandlers;
  /** Optional callback fired AFTER assignedUserId is mutated successfully so the parent can refresh queries. */
  onAssignChanged?: (userId: number | null) => void;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function userInitials(u: { name: string | null; email: string }): string {
  const base = (u.name || u.email || "?").trim();
  const parts = base.split(/[\s@.]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return base.slice(0, 2).toUpperCase();
}

function userDisplay(u: { name: string | null; email: string }): string {
  return u.name?.trim() || u.email;
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────

interface UserPickerProps {
  users: ActionsToolbarUser[];
  selectedIds: number[];
  onToggle: (userId: number) => void;
  emptyText?: string;
}

function UserPickerList({
  users,
  selectedIds,
  onToggle,
  emptyText = "No teammates available",
}: UserPickerProps) {
  if (!users.length) {
    return (
      <p className="text-xs text-muted-foreground/70 py-3 text-center">
        {emptyText}
      </p>
    );
  }
  const selectedSet = new Set(selectedIds);
  return (
    <ul className="max-h-64 overflow-y-auto -mx-1 mt-1">
      {users.map((u) => {
        const checked = selectedSet.has(u.id);
        return (
          <li key={u.id}>
            <button
              type="button"
              onClick={() => onToggle(u.id)}
              data-testid={`option-user-${u.id}`}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs transition-colors hover-elevate ${
                checked ? "bg-primary/10" : ""
              }`}
            >
              <Avatar className="h-6 w-6">
                <AvatarFallback className="text-[10px] bg-primary/15 text-primary">
                  {userInitials(u)}
                </AvatarFallback>
              </Avatar>
              <span className="flex-1 min-w-0">
                <span className="block font-medium truncate">{userDisplay(u)}</span>
                {u.name && (
                  <span className="block text-[10.5px] text-muted-foreground/60 truncate">
                    {u.email}
                  </span>
                )}
              </span>
              {checked && (
                <CheckCircle2
                  className="h-3.5 w-3.5 text-primary flex-shrink-0"
                  aria-hidden="true"
                />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Main toolbar
// ─────────────────────────────────────────────────────────────────────

function EmailActionsToolbarImpl({
  threadId,
  focusedMessage,
  isPriority,
  isPinned,
  isSetAside,
  assignedUserId,
  readOnly = false,
  canReply,
  isSpamView = false,
  handlers,
  onAssignChanged,
}: EmailActionsToolbarProps) {
  const { toast } = useToast();
  const shareAPI = useShareAccess();

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignSearch, setAssignSearch] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [shareSearch, setShareSearch] = useState("");
  const [shareNote, setShareNote] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiResult, setAiResult] = useState<{ mode: string; content: string; language?: string | null } | null>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  // Team list for Assign / Share popovers. Uses the existing /api/users
  // route — same query key as the rest of the app so we share the cache.
  const { data: users = [] } = useQuery<ActionsToolbarUser[]>({
    queryKey: ["/api/users"],
    enabled: assignOpen || shareOpen,
  });

  // PATCH /api/inbox/threads/:threadId/assign
  const assignMutation = useMutation({
    mutationFn: async (userId: number | null) => {
      const r = await apiRequest("PATCH", `/api/inbox/threads/${threadId}/assign`, {
        assignedUserId: userId,
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "Assign failed");
      return (await r.json()) as { threadId: string; assignedUserId: number | null };
    },
    onSuccess: (data) => {
      // Invalidate any thread-record queries the parent uses.
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-record", threadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread", threadId] });
      onAssignChanged?.(data.assignedUserId);
      const u = users.find((x) => x.id === data.assignedUserId);
      toast({
        title: data.assignedUserId === null ? "Unassigned" : `Assigned to ${userDisplay(u || { name: null, email: String(data.assignedUserId) })}`,
      });
      setAssignOpen(false);
    },
    onError: (err: any) =>
      toast({ title: "Assign failed", description: err?.message, variant: "destructive" }),
  });

  // Share = create a task linked to this thread for each picked user, with
  // an optional note. Uses the existing /api/inbox/create-task-from-thread
  // route so sharing is real cross-user (the task shows up in their list).
  // The localStorage map is the per-thread chip cache — recipients are
  // remembered so the chip can render "Shared with X, Y" without a fetch.
  const shareMutation = useMutation({
    mutationFn: async ({
      userIds,
      note,
    }: {
      userIds: number[];
      note: string;
    }) => {
      // Fan out one task per recipient; the create-task endpoint already
      // accepts an optional title so we can prefix with the note.
      const subject = focusedMessage?.subject || "(no subject)";
      const ops = userIds.map((uid) =>
        apiRequest("POST", "/api/inbox/create-task-from-thread", {
          threadId,
          subject,
          title: note?.trim()
            ? `${note.trim()} — re: ${subject}`
            : `Review: ${subject}`,
          assignedToUserId: uid,
        }).then(async (r) => {
          if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            throw new Error(j?.message || "Share failed");
          }
          return r.json();
        }),
      );
      return Promise.all(ops);
    },
    onSuccess: (_data, vars) => {
      // Persist the recipients locally so the chip remembers.
      const merged = Array.from(
        new Set([...shareAPI.getSharedWith(threadId), ...vars.userIds]),
      );
      shareAPI.setSharedWith(threadId, merged);
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({
        title: `Shared with ${vars.userIds.length} teammate${vars.userIds.length === 1 ? "" : "s"}`,
        description: vars.note?.trim() ? "A note + task was created for each." : "A task was created for each.",
      });
      setShareOpen(false);
      setShareNote("");
    },
    onError: (err: any) =>
      toast({ title: "Share failed", description: err?.message, variant: "destructive" }),
  });

  // POST /api/inbox/threads/:threadId/ai-summary
  const aiMutation = useMutation({
    mutationFn: async ({
      mode,
      language,
    }: {
      mode: "summary" | "translate";
      language?: string;
    }) => {
      const r = await apiRequest("POST", `/api/inbox/threads/${threadId}/ai-summary`, {
        mode,
        language,
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "AI request failed");
      return (await r.json()) as { mode: string; content: string; language?: string | null };
    },
    onSuccess: (data) => setAiResult(data),
    onError: (err: any) =>
      toast({ title: "AI request failed", description: err?.message, variant: "destructive" }),
  });

  // PATCH /api/gmail/thread-record/:threadId — used for Snooze.
  // We rebuild the mutation locally so the toolbar is self-contained;
  // parent doesn't need to know about snooze plumbing.
  const snoozeMutation = useMutation({
    mutationFn: async (snoozedUntil: Date) => {
      const r = await apiRequest("PATCH", `/api/gmail/thread-record/${threadId}`, {
        snoozedUntil: snoozedUntil.toISOString(),
        workflowState: "snoozed",
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "Snooze failed");
      return r.json();
    },
    onSuccess: (_d, _v) => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-record", threadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/threads"] });
      toast({ title: "Snoozed" });
      setSnoozeOpen(false);
    },
    onError: (err: any) =>
      toast({ title: "Snooze failed", description: err?.message, variant: "destructive" }),
  });

  const filteredAssignUsers = users.filter((u) => {
    const q = assignSearch.trim().toLowerCase();
    if (!q) return true;
    return (u.name || "").toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });
  const filteredShareUsers = users.filter((u) => {
    const q = shareSearch.trim().toLowerCase();
    if (!q) return true;
    return (u.name || "").toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  const sharedWith = shareAPI.getSharedWith(threadId);
  const assignedUser = users.find((u) => u.id === assignedUserId) || null;

  const [shareDraftSelection, setShareDraftSelection] = useState<number[]>([]);
  // Reset draft selection whenever the popover (re-)opens.
  const openShare = () => {
    setShareDraftSelection([]);
    setShareNote("");
    setShareOpen(true);
  };

  const snoozeOptions: { label: string; compute: () => Date }[] = [
    {
      label: "In 1 hour",
      compute: () => new Date(Date.now() + 60 * 60 * 1000),
    },
    {
      label: "Tomorrow 9 AM",
      compute: () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0);
        return d;
      },
    },
    {
      label: "This weekend",
      compute: () => {
        const d = new Date();
        const day = d.getDay(); // 0 = Sun, 6 = Sat
        const daysUntilSat = (6 - day + 7) % 7 || 7;
        d.setDate(d.getDate() + daysUntilSat);
        d.setHours(9, 0, 0, 0);
        return d;
      },
    },
    {
      label: "Next week",
      compute: () => {
        const d = new Date();
        const day = d.getDay();
        const daysUntilMon = (8 - day) % 7 || 7;
        d.setDate(d.getDate() + daysUntilMon);
        d.setHours(9, 0, 0, 0);
        return d;
      },
    },
  ];

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className="flex items-center gap-1.5 flex-wrap"
        data-testid="email-actions-toolbar"
        role="toolbar"
        aria-label="Email actions"
      >
        {/* ── Left cluster: close + done ─────────────────────────── */}
        <div className="flex items-center rounded-full bg-muted/40 ring-1 ring-border/50 overflow-hidden">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handlers.onClose}
                data-testid="action-close"
                aria-label="Close"
                className="px-2.5 py-1.5 text-muted-foreground/80 hover:text-foreground hover:bg-background/60 transition-colors focus:outline-none"
              >
                <CloseIcon className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[11px]">
              Close
            </TooltipContent>
          </Tooltip>
          <span className="w-px h-4 bg-border/60" aria-hidden="true" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handlers.onMarkDone}
                data-testid="action-done"
                aria-label="Mark as done"
                disabled={readOnly}
                className="px-2.5 py-1.5 text-muted-foreground/80 hover:text-emerald-500 hover:bg-background/60 transition-colors focus:outline-none disabled:opacity-30"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[11px]">
              Mark as done
            </TooltipContent>
          </Tooltip>
        </div>

        {/* ── Not Spam button — only shown in Spam view ──────────── */}
        {!readOnly && isSpamView && handlers.onNotSpam && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handlers.onNotSpam}
                data-testid="action-not-spam"
                aria-label="Not spam — move to inbox"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40"
              >
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Not Spam
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[11px]">
              Remove spam label and move to Inbox
            </TooltipContent>
          </Tooltip>
        )}

        {/* ── Main action cluster ────────────────────────────────── */}
        {!readOnly && (
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handlers.onTrash}
                  data-testid="action-trash"
                  aria-label="Move to trash"
                  className="p-2 rounded-lg text-muted-foreground/70 hover:text-rose-500 hover:bg-rose-500/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[11px]">
                Trash
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handlers.onTogglePriority}
                  data-testid="action-priority"
                  aria-label={isPriority ? "Remove priority" : "Mark as priority"}
                  aria-pressed={isPriority}
                  className={`p-2 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                    isPriority
                      ? "text-amber-400 bg-amber-500/15"
                      : "text-muted-foreground/70 hover:text-amber-400 hover:bg-amber-500/10"
                  }`}
                >
                  <Zap
                    className={`h-3.5 w-3.5 ${isPriority ? "fill-amber-400" : ""}`}
                    aria-hidden="true"
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[11px]">
                {isPriority ? "Remove priority" : "Mark as Priority"}
                <span className="ml-2 opacity-60 font-mono">I</span>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handlers.onMarkUnread}
                  data-testid="action-unread"
                  aria-label="Mark as unread"
                  className="p-2 rounded-lg text-muted-foreground/70 hover:text-sky-500 hover:bg-sky-500/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <Circle className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[11px]">
                Mark as Unread
                <span className="ml-2 opacity-60 font-mono">U</span>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handlers.onTogglePin}
                  data-testid="action-pin"
                  aria-label={isPinned ? "Unpin thread" : "Pin thread"}
                  aria-pressed={isPinned}
                  className={`p-2 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                    isPinned
                      ? "text-orange-500 bg-orange-500/15"
                      : "text-muted-foreground/70 hover:text-orange-500 hover:bg-orange-500/10"
                  }`}
                >
                  {isPinned ? (
                    <Flame className="h-3.5 w-3.5 fill-orange-500" aria-hidden="true" />
                  ) : (
                    <Flame className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[11px]">
                {isPinned ? "Unpin from inbox" : "Pin to inbox"}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handlers.onSetAside}
                  data-testid="action-set-aside"
                  aria-label={isSetAside ? "Bring back to inbox" : "Set aside"}
                  aria-pressed={isSetAside}
                  className={`p-2 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                    isSetAside
                      ? "text-violet-400 bg-violet-500/15"
                      : "text-muted-foreground/70 hover:text-violet-400 hover:bg-violet-500/10"
                  }`}
                >
                  <ArrowDownLeft className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[11px]">
                {isSetAside ? "Bring back" : "Set Aside"}
                <span className="ml-2 opacity-60 font-mono">G</span>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => {
                    // Hyperlink Settings opens the inline reply with focus
                    // and dispatches the format-link event so the link
                    // popover lights up. Clicking here without a compose
                    // open just opens reply; the user then clicks the
                    // link button on the format toolbar.
                    handlers.onReply();
                  }}
                  data-testid="action-hyperlink"
                  aria-label="Hyperlink Settings"
                  className="p-2 rounded-lg text-muted-foreground/70 hover:text-primary hover:bg-primary/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <LinkIcon className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[11px]">
                Hyperlink Settings
              </TooltipContent>
            </Tooltip>

            {/* ── Snooze popover ───────────────────────────────── */}
            <Popover open={snoozeOpen} onOpenChange={setSnoozeOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      data-testid="action-snooze"
                      aria-label="Snooze"
                      className="p-2 rounded-lg text-muted-foreground/70 hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-[11px]">
                  Snooze
                  <span className="ml-2 opacity-60 font-mono">S</span>
                </TooltipContent>
              </Tooltip>
              <PopoverContent
                className="w-56 p-2"
                side="bottom"
                align="start"
                data-testid="popover-snooze"
              >
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground/70 px-2 pb-1">
                  Snooze until
                </p>
                <ul className="space-y-0.5">
                  {snoozeOptions.map((opt) => (
                    <li key={opt.label}>
                      <button
                        type="button"
                        onClick={() => snoozeMutation.mutate(opt.compute())}
                        disabled={snoozeMutation.isPending}
                        data-testid={`option-snooze-${opt.label.toLowerCase().replace(/\s+/g, "-")}`}
                        className="w-full text-left px-2 py-1.5 text-xs rounded hover-elevate disabled:opacity-50"
                      >
                        <div className="flex items-center justify-between">
                          <span>{opt.label}</span>
                          <span className="text-[10px] text-muted-foreground/60">
                            {opt.compute().toLocaleString(undefined, {
                              weekday: "short",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
                {snoozeMutation.isPending && (
                  <div className="flex items-center justify-center pt-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin mr-1" /> Snoozing…
                  </div>
                )}
              </PopoverContent>
            </Popover>

            {/* ── +AI popover ──────────────────────────────────── */}
            <Popover
              open={aiOpen}
              onOpenChange={(o) => {
                setAiOpen(o);
                if (!o) setAiResult(null);
              }}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      data-testid="action-ai"
                      aria-label="AI Summary and Translation"
                      className="px-2.5 py-1.5 rounded-lg text-muted-foreground/70 hover:text-primary hover:bg-primary/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 inline-flex items-center gap-1 text-[11px] font-medium"
                    >
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>ai</span>
                    </button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-[11px]">
                  AI Summary and Translation
                </TooltipContent>
              </Tooltip>
              <PopoverContent
                className="w-[360px] p-0"
                side="bottom"
                align="start"
                data-testid="popover-ai"
              >
                <div className="p-3 border-b border-border/40">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => aiMutation.mutate({ mode: "summary" })}
                      disabled={aiMutation.isPending}
                      data-testid="button-ai-summary"
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-primary/10 text-primary text-xs font-medium hover:bg-primary/15 transition-colors disabled:opacity-50"
                    >
                      <Sparkles className="h-3 w-3" />
                      Summary
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          disabled={aiMutation.isPending}
                          data-testid="button-ai-translate"
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-muted/40 text-foreground text-xs font-medium hover:bg-muted/60 transition-colors disabled:opacity-50"
                        >
                          <Languages className="h-3 w-3" />
                          Translate
                          <ChevronDown className="h-3 w-3" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="text-xs">
                        {["English", "Spanish", "French", "German", "Mandarin", "Japanese"].map(
                          (lang) => (
                            <DropdownMenuItem
                              key={lang}
                              onClick={() => aiMutation.mutate({ mode: "translate", language: lang })}
                              data-testid={`option-translate-${lang.toLowerCase()}`}
                            >
                              {lang}
                            </DropdownMenuItem>
                          ),
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="p-3 max-h-72 overflow-y-auto text-xs leading-relaxed">
                  {aiMutation.isPending && (
                    <div className="flex items-center justify-center py-6 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Thinking…
                    </div>
                  )}
                  {!aiMutation.isPending && !aiResult && (
                    <p className="text-muted-foreground/70 text-center py-6">
                      Pick Summary or Translate to begin.
                    </p>
                  )}
                  {!aiMutation.isPending && aiResult && (
                    <div data-testid="text-ai-result">
                      {aiResult.mode === "translate" && aiResult.language && (
                        <Badge variant="secondary" className="mb-2 text-[10px]">
                          Translated → {aiResult.language}
                        </Badge>
                      )}
                      <pre className="whitespace-pre-wrap font-sans text-foreground/90">
                        {aiResult.content}
                      </pre>
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>

            {/* ── More-actions menu ────────────────────────────── */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      data-testid="action-more"
                      aria-label="More actions"
                      className="p-2 rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-muted/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-[11px]">
                  Actions
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-52 text-xs">
                {canReply && (
                  <DropdownMenuItem onClick={handlers.onReply} data-testid="more-reply">
                    <Reply className="h-3.5 w-3.5 mr-2" /> Reply
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handlers.onSendAgain} data-testid="more-send-again">
                  <Send className="h-3.5 w-3.5 mr-2" /> Send again
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handlers.onBlock} data-testid="more-block">
                  <Ban className="h-3.5 w-3.5 mr-2" /> Block sender
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handlers.onMove} data-testid="more-move">
                  <FolderInput className="h-3.5 w-3.5 mr-2" /> Move to folder
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handlers.onMarkSpam} data-testid="more-spam">
                  <AlertOctagon className="h-3.5 w-3.5 mr-2" /> Mark as Spam
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger data-testid="more-print-trigger">
                    <Printer className="h-3.5 w-3.5 mr-2" /> Print
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem
                      onClick={() => window.print()}
                      data-testid="print-window"
                    >
                      Print this view
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem
                  onClick={async () => {
                    if (!focusedMessage) return;
                    const md = `# ${focusedMessage.subject || "(no subject)"}\n\n${focusedMessage.snippet || ""}`;
                    try {
                      await navigator.clipboard.writeText(md);
                      toast({ title: "Copied as Markdown" });
                    } catch {
                      toast({ title: "Clipboard unavailable", variant: "destructive" });
                    }
                  }}
                  data-testid="more-copy-md"
                >
                  <Copy className="h-3.5 w-3.5 mr-2" /> Copy as Markdown
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => toast({ title: "Export coming soon" })}
                  data-testid="more-export"
                >
                  <Upload className="h-3.5 w-3.5 mr-2" /> Export to…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => toast({ title: "All actions panel coming soon" })}
                  data-testid="more-all"
                >
                  <ListChecks className="h-3.5 w-3.5 mr-2" /> All Actions
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* ── Spacer pushes Assign / Share to the far right ─── */}
        <div className="flex-1" />

        {/* ── Assign popover ─────────────────────────────── */}
        <Popover open={assignOpen} onOpenChange={setAssignOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={readOnly}
              data-testid="action-assign"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full ring-1 ring-border/60 bg-background/40 text-[11px] font-medium text-foreground/85 hover:bg-muted/60 hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
            >
              {assignedUser ? (
                <>
                  <Avatar className="h-4 w-4">
                    <AvatarFallback className="text-[8px] bg-primary/15 text-primary">
                      {userInitials(assignedUser)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="max-w-[80px] truncate">{userDisplay(assignedUser)}</span>
                </>
              ) : (
                <>
                  <UserPlus2 className="h-3.5 w-3.5" />
                  <span>Assign</span>
                </>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-72 p-3"
            side="bottom"
            align="end"
            data-testid="popover-assign"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium">Assign owner</p>
                {assignedUserId !== null && (
                  <button
                    type="button"
                    onClick={() => assignMutation.mutate(null)}
                    data-testid="button-clear-assign"
                    className="text-[10.5px] text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                )}
              </div>
              <Input
                value={assignSearch}
                onChange={(e) => setAssignSearch(e.target.value)}
                placeholder="Search teammates…"
                data-testid="input-assign-search"
                className="h-8 text-xs"
              />
              <UserPickerList
                users={filteredAssignUsers}
                selectedIds={assignedUserId === null ? [] : [assignedUserId]}
                onToggle={(uid) => {
                  // Single-owner semantics: tapping an already-assigned user clears.
                  assignMutation.mutate(uid === assignedUserId ? null : uid);
                }}
              />
              {assignMutation.isPending && (
                <div className="flex items-center justify-center pt-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin mr-1" /> Saving…
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* ── Share popover ──────────────────────────────── */}
        <Popover
          open={shareOpen}
          onOpenChange={(o) => (o ? openShare() : setShareOpen(false))}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={readOnly}
              data-testid="action-share"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full ring-1 ring-border/60 bg-background/40 text-[11px] font-medium text-foreground/85 hover:bg-muted/60 hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
            >
              <Share2 className="h-3.5 w-3.5" />
              <span>Share</span>
              {sharedWith.length > 0 && (
                <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-0.5">
                  {sharedWith.length}
                </Badge>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-80 p-3"
            side="bottom"
            align="end"
            data-testid="popover-share"
          >
            <div className="space-y-2">
              <p className="text-xs font-medium">Share & assign action items</p>
              <p className="text-[10.5px] text-muted-foreground/70">
                Picking a teammate creates a task linked to this email so they
                can pick it up. Add a quick note for context.
              </p>
              <Input
                value={shareSearch}
                onChange={(e) => setShareSearch(e.target.value)}
                placeholder="Search teammates…"
                data-testid="input-share-search"
                className="h-8 text-xs"
              />
              <UserPickerList
                users={filteredShareUsers}
                selectedIds={shareDraftSelection}
                onToggle={(uid) => {
                  setShareDraftSelection((prev) =>
                    prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid],
                  );
                }}
              />
              <Textarea
                value={shareNote}
                onChange={(e) => setShareNote(e.target.value)}
                placeholder="Optional note (e.g. 'Can you respond by EOD?')"
                rows={2}
                data-testid="input-share-note"
                className="text-xs resize-none"
              />
              {sharedWith.length > 0 && (
                <p className="text-[10.5px] text-muted-foreground/60">
                  Already shared with {sharedWith.length} teammate
                  {sharedWith.length === 1 ? "" : "s"}.
                </p>
              )}
              <div className="flex items-center justify-end gap-1.5 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShareOpen(false)}
                  data-testid="button-cancel-share"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={shareDraftSelection.length === 0 || shareMutation.isPending}
                  onClick={() =>
                    shareMutation.mutate({
                      userIds: shareDraftSelection,
                      note: shareNote,
                    })
                  }
                  data-testid="button-confirm-share"
                >
                  {shareMutation.isPending && (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  )}
                  Share with {shareDraftSelection.length || 0}
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </TooltipProvider>
  );
}

export const EmailActionsToolbar = memo(EmailActionsToolbarImpl);
