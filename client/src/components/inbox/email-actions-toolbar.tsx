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
import { useLocation } from "wouter";
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
  Star,
  Brain,
  Anchor,
  Globe,
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
import { SaveToCortexModal } from "./save-to-cortex-modal";
import { DomainWatchPopover } from "./domain-watch-popover";

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
  /** Block exact sender email address + move to spam. */
  onBlock: () => void;
  /** Trust this sender — move to inbox and whitelist them. Visible when isSpamView or isBlocked. */
  onTrustSender?: () => void;
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
    senderName?: string;
    receivedAt?: string | null;
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
  /** When true, Capital-specific actions (Link to Investor) are shown in the overflow menu. */
  isCapitalUser?: boolean;
  /** Whether the inline reply button should be visible (canSend gate from parent). */
  canReply: boolean;
  /** When true, shows "Not Spam" as a prominent action and hides irrelevant Inbox actions. */
  isSpamView?: boolean;
  /** The sender's email address — used to label the "Block sender" action. */
  senderEmail?: string;
  /** True when this sender is already in the blocked_senders list. */
  isBlocked?: boolean;
  /** True when this thread/sender has been tagged as Marine Related. */
  isMarineRelated?: boolean;
  /** Called when the user clicks the Marine Related anchor toggle. */
  onToggleMarineRelated?: () => void;
  handlers: ActionsToolbarHandlers;
  /** Optional callback fired AFTER assignedUserId is mutated successfully so the parent can refresh queries. */
  onAssignChanged?: (userId: number | null) => void;
  /**
   * When true the current user has permission to create/manage Cortex Domain Watch rules
   * (master_admin, admin, exec, manager).  Hides the domain-watch menu item and disables
   * the backend call when false.
   */
  canManageCortexDomains?: boolean;
  /**
   * When true the currently open message was sent BY the current user (outbound/SENT).
   * Domain Watch is suppressed for outbound messages since there is no inbound sender domain.
   */
  isOutbound?: boolean;
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
  senderEmail = "",
  isBlocked = false,
  isMarineRelated = false,
  onToggleMarineRelated,
  handlers,
  onAssignChanged,
  isCapitalUser = false,
  canManageCortexDomains = false,
  isOutbound = false,
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
  const [cortexOpen, setCortexOpen] = useState(false);
  const [domainWatchOpen, setDomainWatchOpen] = useState(false);
  const [capitalLinkOpen, setCapitalLinkOpen] = useState(false);
  const [, setLocation] = useLocation();

  // Derived sender domain for Domain Watch actions
  const senderDomain = senderEmail.includes("@")
    ? (senderEmail.split("@")[1]?.trim() ?? "")
    : "";
  const [capitalSearch, setCapitalSearch] = useState("");
  const [capitalSelectedId, setCapitalSelectedId] = useState<number | null>(null);

  // Check if the focused message is already saved to Cortex (for saved-state indicator)
  const { data: cortexCheckData } = useQuery<{ exists: boolean; record: any | null }>({
    queryKey: ["/api/cortex-intel/check", focusedMessage?.id ?? ""],
    queryFn: () =>
      fetch(`/api/cortex-intel/check/${encodeURIComponent(focusedMessage!.id)}`, { credentials: "include" })
        .then(r => r.json()),
    enabled: !!focusedMessage?.id,
    staleTime: 30_000,
  });
  const isSavedToCortex = cortexCheckData?.exists === true;

  // Domain Watch status — fetched only when the user has permission and there is an external sender
  const { data: domainWatchData } = useQuery<{ watched: boolean; active: boolean; rule: any | null }>({
    queryKey: ["/api/cortex/auto-ingest-domains/check", senderDomain],
    queryFn: () =>
      fetch(`/api/cortex/auto-ingest-domains/check?domain=${encodeURIComponent(senderDomain)}`, {
        credentials: "include",
      }).then(r => r.json()),
    enabled: !!senderDomain && !isOutbound && canManageCortexDomains,
    staleTime: 60_000,
  });
  const isDomainWatched = domainWatchData?.watched === true && domainWatchData?.active === true;

  // Team list for Assign / Share popovers. Uses the existing /api/users
  // route — same query key as the rest of the app so we share the cache.
  const { data: users = [] } = useQuery<ActionsToolbarUser[]>({
    queryKey: ["/api/users"],
    enabled: assignOpen || shareOpen,
  });

  // Capital investor list — only fetched when the capital link modal is open
  const { data: capitalInvestors = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/capital/investors-list"],
    queryFn: () =>
      fetch("/api/capital/investors?limit=200", { credentials: "include" })
        .then(r => r.json())
        .then((d: any) => Array.isArray(d) ? d : []),
    enabled: capitalLinkOpen,
    staleTime: 60_000,
  });
  const filteredCapitalInvestors = capitalInvestors.filter(
    (inv) => !capitalSearch.trim() || inv.name.toLowerCase().includes(capitalSearch.toLowerCase()),
  );

  const capitalLinkMutation = useMutation({
    mutationFn: async (investorId: number) => {
      const r = await apiRequest("POST", "/api/capital/email-links", {
        capital_investor_id: investorId,
        email_thread_id: threadId,
        email_message_id: focusedMessage?.id,
        subject: focusedMessage?.subject,
        direction: "unknown",
        participants: [senderEmail, focusedMessage?.senderName].filter(Boolean).join(", "),
        latest_message_at: focusedMessage?.receivedAt,
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "Link failed");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Linked to Capital investor" });
      setCapitalLinkOpen(false);
      setCapitalSearch("");
      setCapitalSelectedId(null);
    },
    onError: (e: any) => toast({ title: e?.message || "Failed to link", variant: "destructive" }),
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
                  <Star
                    className={`h-3.5 w-3.5 ${isPriority ? "fill-amber-400 drop-shadow-[0_0_4px_rgba(251,191,36,0.45)]" : ""}`}
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

            {onToggleMarineRelated && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={onToggleMarineRelated}
                    data-testid="action-marine-related"
                    aria-label={isMarineRelated ? "Remove Marine Related tag" : "Tag as Marine Related"}
                    aria-pressed={isMarineRelated}
                    className={`p-2 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 ${
                      isMarineRelated
                        ? "text-cyan-400 bg-cyan-500/15"
                        : "text-muted-foreground/70 hover:text-cyan-400 hover:bg-cyan-500/10"
                    }`}
                  >
                    <Anchor
                      className={`h-3.5 w-3.5 ${isMarineRelated ? "drop-shadow-[0_0_4px_rgba(34,211,238,0.5)]" : ""}`}
                      aria-hidden="true"
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-[11px]">
                  {isMarineRelated ? "Remove Marine Related tag" : "Tag as Marine Related"}
                </TooltipContent>
              </Tooltip>
            )}

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
                    <PinOff className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Pin className="h-3.5 w-3.5" aria-hidden="true" />
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

            {/* ── Cortex split-button group ──────────────────── */}
            {/*
              Left part  → direct click → SaveToCortexModal (preserves existing UX)
              Right part → ChevronDown  → dropdown with full Cortex options
            */}
            <div
              className="inline-flex items-stretch rounded-lg border border-transparent hover:border-cyan-500/20 transition-colors group/cortex"
              data-testid="cortex-button-group"
            >
              {/* Main Brain button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    data-testid="action-save-to-cortex"
                    aria-label={
                      isSavedToCortex
                        ? "Saved to Cortex — click to view/edit"
                        : isDomainWatched
                        ? `Domain watched: future emails from ${senderDomain} are auto-ingested — click to save this email`
                        : "Save to Cortex"
                    }
                    onClick={() => setCortexOpen(true)}
                    className={`px-2 py-1.5 rounded-l-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 inline-flex items-center gap-1 text-[11px] font-medium relative ${
                      isSavedToCortex || isDomainWatched
                        ? "text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/15"
                        : "text-muted-foreground/70 hover:text-cyan-400 hover:bg-cyan-500/10"
                    }`}
                  >
                    <Brain className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">
                      {isSavedToCortex ? "In Cortex" : "Cortex"}
                    </span>
                    {isSavedToCortex && (
                      <span
                        className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-cyan-400 border border-background"
                        aria-hidden="true"
                        data-testid="cortex-saved-dot"
                      />
                    )}
                    {isDomainWatched && !isSavedToCortex && (
                      <span
                        className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 border border-background"
                        aria-hidden="true"
                        data-testid="cortex-domain-watched-dot"
                      />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-[11px]">
                  {isSavedToCortex
                    ? `Saved to Cortex${cortexCheckData?.record?.intel_type ? ` · ${cortexCheckData.record.intel_type}` : ""} — click to edit`
                    : isDomainWatched
                    ? `Domain Watch: active — future emails from ${senderDomain} auto-ingested`
                    : "Save to Cortex — flag as marine industry intelligence"}
                </TooltipContent>
              </Tooltip>

              {/* Dropdown chevron */}
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        data-testid="cortex-menu-trigger"
                        aria-label="Cortex ingestion options"
                        className={`px-1 py-1.5 rounded-r-lg border-l transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 ${
                          isSavedToCortex || isDomainWatched
                            ? "border-l-cyan-500/30 text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/15"
                            : "border-l-border/30 text-muted-foreground/50 hover:text-cyan-400 hover:bg-cyan-500/10"
                        }`}
                      >
                        <ChevronDown className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[11px]">Cortex options</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="start" className="w-64 text-xs" data-testid="cortex-dropdown-menu">
                  <DropdownMenuItem
                    data-testid="cortex-menu-save"
                    onClick={() => setCortexOpen(true)}
                  >
                    <Brain className="h-3.5 w-3.5 mr-2 flex-shrink-0" aria-hidden="true" />
                    Save this email to Cortex
                  </DropdownMenuItem>
                  {senderDomain && !isOutbound && (
                    canManageCortexDomains ? (
                      <DropdownMenuItem
                        data-testid="cortex-menu-domain-watch"
                        onClick={() => setDomainWatchOpen(true)}
                        aria-label={`Always ingest future emails from ${senderDomain} into Cortex`}
                        className={isDomainWatched ? "text-cyan-400" : ""}
                      >
                        <Globe className="h-3.5 w-3.5 mr-2 flex-shrink-0" aria-hidden="true" />
                        <span className="flex-1">Always ingest this domain</span>
                        <span className="ml-2 text-muted-foreground/70 text-[10px] font-mono truncate max-w-[100px]">
                          {senderDomain}
                        </span>
                        {isDomainWatched && (
                          <span className="ml-1 w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" aria-hidden="true" />
                        )}
                      </DropdownMenuItem>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <DropdownMenuItem
                              disabled
                              data-testid="cortex-menu-domain-watch-disabled"
                              aria-label="Always ingest this domain — requires admin, exec, or manager access"
                            >
                              <Globe className="h-3.5 w-3.5 mr-2 flex-shrink-0 opacity-50" aria-hidden="true" />
                              <span className="flex-1 opacity-50">Always ingest this domain</span>
                            </DropdownMenuItem>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="text-[11px]">
                          Requires admin, exec, or manager access
                        </TooltipContent>
                      </Tooltip>
                    )
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    data-testid="cortex-menu-manage"
                    onClick={() => setLocation("/feed-cortex")}
                  >
                    <ShieldCheck className="h-3.5 w-3.5 mr-2 flex-shrink-0" aria-hidden="true" />
                    Manage Cortex ingestion rules
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

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
                {(isBlocked || isSpamView) && handlers.onTrustSender && (
                  <DropdownMenuItem onClick={handlers.onTrustSender} data-testid="more-trust-sender" className="text-emerald-400 focus:text-emerald-400">
                    <ShieldCheck className="h-3.5 w-3.5 mr-2" /> Trust sender
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handlers.onBlock} data-testid="more-block">
                  <Ban className="h-3.5 w-3.5 mr-2" />
                  {senderEmail ? `Block ${senderEmail}` : "Block sender"}
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
                {isCapitalUser && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => { setCapitalLinkOpen(true); setCapitalSearch(""); setCapitalSelectedId(null); }}
                      data-testid="more-link-capital"
                    >
                      <LinkIcon className="h-3.5 w-3.5 mr-2 text-cyan-400" /> Link to Capital Investor
                    </DropdownMenuItem>
                  </>
                )}
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

      {/* Link to Capital Investor modal */}
      {capitalLinkOpen && isCapitalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" data-testid="capital-link-modal">
          <div className="bg-card border border-border rounded-xl p-5 w-full max-w-sm space-y-4 mx-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm flex items-center gap-2">
                <LinkIcon className="w-4 h-4 text-cyan-400" /> Link to Capital Investor
              </h2>
              <button
                type="button"
                onClick={() => setCapitalLinkOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded"
                data-testid="btn-close-capital-link"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Linking this conversation to an investor records it in their Capital timeline and updates last-touch date.
            </p>
            <Input
              placeholder="Search investors…"
              value={capitalSearch}
              onChange={(e) => { setCapitalSearch(e.target.value); setCapitalSelectedId(null); }}
              className="h-8 text-xs"
              data-testid="input-capital-search"
              autoFocus
            />
            <ul className="max-h-48 overflow-y-auto -mx-1">
              {filteredCapitalInvestors.length === 0 && (
                <li className="text-xs text-muted-foreground text-center py-3">
                  {capitalSearch ? "No investors match." : "Loading investors…"}
                </li>
              )}
              {filteredCapitalInvestors.slice(0, 20).map((inv) => (
                <li key={inv.id}>
                  <button
                    type="button"
                    data-testid={`capital-investor-option-${inv.id}`}
                    onClick={() => setCapitalSelectedId(inv.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center justify-between ${
                      capitalSelectedId === inv.id
                        ? "bg-primary/20 text-primary font-medium"
                        : "hover:bg-muted/60 text-foreground"
                    }`}
                  >
                    {inv.name}
                    {capitalSelectedId === inv.id && <Check className="w-3 h-3" />}
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setCapitalLinkOpen(false)}>Cancel</Button>
              <Button
                size="sm"
                disabled={!capitalSelectedId || capitalLinkMutation.isPending}
                onClick={() => capitalSelectedId && capitalLinkMutation.mutate(capitalSelectedId)}
                data-testid="btn-confirm-capital-link"
              >
                {capitalLinkMutation.isPending ? "Linking…" : "Link Conversation"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Domain Watch confirmation dialog */}
      {senderDomain && (
        <DomainWatchPopover
          open={domainWatchOpen}
          onOpenChange={setDomainWatchOpen}
          senderDomain={senderDomain}
          canManage={canManageCortexDomains}
          onNavigateManage={() => setLocation("/feed-cortex")}
        />
      )}

      {/* Save to Cortex modal */}
      {focusedMessage && (
        <SaveToCortexModal
          open={cortexOpen}
          onOpenChange={setCortexOpen}
          email={{
            id: focusedMessage.id,
            threadId,
            subject: focusedMessage.subject,
            senderName: focusedMessage.senderName,
            senderEmail,
            receivedAt: focusedMessage.receivedAt,
            body: focusedMessage.body,
            snippet: focusedMessage.snippet,
            sourceLabel: focusedMessage.senderName,
          }}
        />
      )}
    </TooltipProvider>
  );
}

export const EmailActionsToolbar = memo(EmailActionsToolbarImpl);
