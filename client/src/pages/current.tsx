import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Hash,
  Send,
  MessageSquare,
  Loader2,
  Pin,
  Pencil,
  Trash2,
  X,
  ChevronDown,
  ChevronUp,
  AtSign,
  Paperclip,
  Search,
  Sparkles,
  CheckSquare,
  Bookmark,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  CurrentAttachmentChips, PendingFileChips, uploadCurrentAttachments,
} from "@/components/current/current-attachment-display";
import type { CurrentAttachment } from "@/components/current/current-attachment-display";
import { CurrentSummaryPanel } from "@/components/current/current-summary-panel";
import type { CurrentSummaryData } from "@/components/current/current-summary-panel";
import { CreateTaskFromCurrentDialog } from "@/components/current/create-task-from-current-dialog";
import type { CreateTaskSource } from "@/components/current/create-task-from-current-dialog";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Channel {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  isPrivate: boolean;
  unreadCount: number;
}

interface Reaction {
  emoji: string;
  count: number;
  reacted: boolean;
}

interface StructuredItem {
  id: number;
  itemType: 'decision' | 'risk' | 'requirement';
  notes: string | null;
  createdBy: number | null;
  createdAt: string;
}

const STRUCTURED_BADGE_STYLE: Record<string, string> = {
  decision: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  risk: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  requirement: "bg-purple-500/10 text-purple-400 border-purple-500/20",
};

const STRUCTURED_DOT_STYLE: Record<string, string> = {
  decision: "bg-emerald-500",
  risk: "bg-amber-500",
  requirement: "bg-purple-500",
};

interface Message {
  id: number;
  channelId: number;
  userId: number;
  body: string | null;
  isEdited: boolean;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  userName: string;
  userAvatarUrl: string | null;
  reactions: Reaction[];
  replyCount: number;
  latestReplyAt: string | null;
  attachments?: CurrentAttachment[];
  structuredItems?: StructuredItem[];
}

interface ThreadData {
  root: Message;
  replies: Message[];
}

interface PinnedMessage {
  id: number;
  channelId: number;
  messageId: number;
  pinnedBy: number | null;
  pinnedAt: string;
  pinnedByName: string | null;
  messageBody: string;
  messageUserName: string;
  messageCreatedAt: string;
}

interface Me {
  id: number;
  name: string;
  globalRole: string;
}

interface MentionUser {
  id: number;
  name: string;
  email: string;
  avatarUrl: string | null;
  department: string | null;
}

interface MentionMessage {
  id: number;
  channelId: number;
  userId: number;
  body: string | null;
  isEdited: boolean;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  parentMessageId: number | null;
  userName: string;
  userAvatarUrl: string | null;
  channelSlug: string;
  channelName: string;
}

// ── SearchResult ──────────────────────────────────────────────────────────────

interface SearchResult {
  id: number;
  parentMessageId: number | null;
  snippet: string;
  userName: string;
  createdAt: string;
  channelSlug: string | null;
  channelName: string | null;
  objectType: string | null;
  objectId: number | null;
  attachmentNames: string[];
  matchedAttachment: boolean;
  actionUrl: string | null;
  isReply: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PRESET_REACTIONS = ["👍", "❤️", "🔥", "✅", "😂", "👀"];

const AVATAR_PALETTE = [
  "bg-teal-600",
  "bg-cyan-600",
  "bg-blue-600",
  "bg-violet-600",
  "bg-rose-600",
  "bg-amber-600",
  "bg-emerald-600",
  "bg-sky-600",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function avatarBg(userId: number): string {
  return AVATAR_PALETTE[userId % AVATAR_PALETTE.length];
}

function strHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

function buildRecordUrl(objectType: string, objectId: number): string {
  const map: Record<string, string> = {
    account: "accounts",
    contact: "contacts",
    opportunity: "opportunities",
    lead: "opportunities",
    project: "execution/projects",
    deployment: "deployments",
    install_workflow: "install-workflows",
    customer_success: "customer-success",
    partnership: "strategy/partnerships",
    quote: "quotes",
    tradeshow_event: "operations/events",
  };
  const seg = map[objectType] ?? objectType.replace(/_/g, "-") + "s";
  return `/${seg}/${objectId}`;
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  try {
    const esc = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = text.split(new RegExp(`(${esc})`, "gi"));
    return parts.map((p, i) =>
      p.toLowerCase() === query.toLowerCase() ? (
        <mark key={i} className="bg-primary/25 text-primary rounded-sm px-0.5 not-italic">
          {p}
        </mark>
      ) : (
        p
      )
    );
  } catch {
    return text;
  }
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatTs(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMins = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24)
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (diffHours < 48)
    return `Yesterday ${d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    })}`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isContinuation(prev: Message | undefined, curr: Message): boolean {
  if (!prev || prev.deletedAt) return false;
  if (prev.userId !== curr.userId) return false;
  return (
    new Date(curr.createdAt).getTime() - new Date(prev.createdAt).getTime() <
    5 * 60_000
  );
}

function displaySlug(slug: string): string {
  return slug.replace(/-/g, "\u2011");
}

function growTextarea(el: HTMLTextAreaElement, maxPx = 144) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`;
}

// ── Mention helpers ───────────────────────────────────────────────────────────

// Returns the @-trigger query (text after @) if the cursor is immediately after
// one, or null if no active trigger.
function detectMentionTrigger(value: string, cursor: number): string | null {
  const before = value.slice(0, cursor);
  const m = before.match(/@([^\s@]*)$/);
  return m ? m[1] : null;
}

// Replace the @query at the cursor with a structured mention token.
function insertMentionToken(
  value: string,
  cursor: number,
  user: MentionUser
): { newValue: string; newCursor: number } {
  const before = value.slice(0, cursor);
  const after = value.slice(cursor);
  const m = before.match(/@([^\s@]*)$/);
  if (!m) return { newValue: value, newCursor: cursor };
  const atPos = before.length - m[0].length;
  const token = `@[${user.name}](user:${user.id}) `;
  return {
    newValue: value.slice(0, atPos) + token + after,
    newCursor: atPos + token.length,
  };
}

// Convert a stored body string with @[Name](user:ID) tokens into React nodes.
// Tokens belonging to the current user are highlighted in teal.
function renderMentionBody(
  body: string | null,
  myUserId?: number
): React.ReactNode {
  if (!body) return null;
  const re = /@\[([^\]]+)\]\(user:(\d+)\)/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match;
  let key = 0;
  while ((match = re.exec(body)) !== null) {
    if (match.index > last)
      parts.push(<span key={key++}>{body.slice(last, match.index)}</span>);
    const name = match[1];
    const uid = Number(match[2]);
    // myUserId=0 while session loads — never treat 0 as a valid match
    const isMe = !!myUserId && uid === myUserId;
    parts.push(
      <span
        key={key++}
        className={cn(
          "inline-flex items-center rounded px-1 text-[12.5px] font-semibold leading-tight",
          isMe
            ? "bg-primary/20 text-primary"
            : "bg-muted/80 text-foreground/90"
        )}
      >
        @{name}
      </span>
    );
    last = match.index + match[0].length;
  }
  if (last < body.length)
    parts.push(<span key={key++}>{body.slice(last)}</span>);
  // No mention tokens — return plain text as-is (avoids returning null for plain bodies)
  if (parts.length === 0) return <>{body}</>;
  return <>{parts}</>;
}

// ── useComposerMentions hook ─────────────────────────────────────────────────
// Encapsulates all @mention detection, user search, and token insertion for any
// textarea composer. Pass in the textarea ref; the hook owns mention state and
// exposes helper handlers.

function useComposerMentions(taRef: React.RefObject<HTMLTextAreaElement>) {
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIdx, setMentionIdx] = useState(0);
  const [mentionAnchorRect, setMentionAnchorRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const { data: mentionUsers = [], isLoading: mentionLoading } = useQuery<
    MentionUser[]
  >({
    queryKey: ["/api/current/users", mentionQuery],
    queryFn: () =>
      fetch(`/api/current/users?q=${encodeURIComponent(mentionQuery)}`, {
        credentials: "include",
      }).then((r) => r.json()),
    enabled: mentionActive,
    staleTime: 10_000,
  });

  const clampedIdx = Math.min(mentionIdx, Math.max(0, mentionUsers.length - 1));

  function onValueChange(value: string, cursorPos: number) {
    const q = detectMentionTrigger(value, cursorPos);
    if (q !== null) {
      setMentionQuery(q);
      setMentionIdx(0);
      if (!mentionActive && taRef.current) {
        const rect = taRef.current.getBoundingClientRect();
        setMentionAnchorRect({ top: rect.top, left: rect.left, width: rect.width });
        setMentionActive(true);
      }
    } else {
      if (mentionActive) setMentionActive(false);
    }
  }

  function insertMention(
    draft: string,
    setDraft: (v: string) => void,
    user: MentionUser
  ) {
    const ta = taRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart ?? draft.length;
    const { newValue, newCursor } = insertMentionToken(draft, cursor, user);
    setDraft(newValue);
    setMentionActive(false);
    requestAnimationFrame(() => {
      ta.setSelectionRange(newCursor, newCursor);
      ta.focus();
      growTextarea(ta);
    });
  }

  // Returns true if the keydown was consumed by mention handling.
  function handleMentionKeyDown(
    e: React.KeyboardEvent,
    draft: string,
    setDraft: (v: string) => void
  ): boolean {
    if (!mentionActive) return false;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMentionIdx((i) => Math.min(i + 1, mentionUsers.length - 1));
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setMentionIdx((i) => Math.max(0, i - 1));
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      const user = mentionUsers[clampedIdx];
      if (user) {
        e.preventDefault();
        insertMention(draft, setDraft, user);
        return true;
      }
    }
    if (e.key === "Escape") {
      e.nativeEvent.stopPropagation();
      setMentionActive(false);
      return true;
    }
    return false;
  }

  return {
    mentionActive,
    mentionAnchorRect,
    mentionUsers,
    mentionLoading,
    mentionIdx: clampedIdx,
    onValueChange,
    insertMention,
    handleMentionKeyDown,
    setMentionIdx,
    closeMention: () => setMentionActive(false),
  };
}

// ── Emoji picker — portal-based so it's never clipped by overflow-y: auto ────

function EmojiPickerPopover({
  onReact,
}: {
  onReact: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (
        pickerRef.current &&
        !pickerRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onScroll() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  function handleToggle() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom + 4,
        left: Math.max(4, rect.right - 166),
      });
    }
    setOpen((v) => !v);
  }

  return (
    <>
      <button
        ref={triggerRef}
        onClick={handleToggle}
        title="Add reaction"
        className="w-6 h-6 flex items-center justify-center rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
      >
        😊
      </button>
      {open &&
        createPortal(
          <div
            ref={pickerRef}
            style={{ position: "fixed", top: coords.top, left: coords.left, zIndex: 9999 }}
            className="flex gap-0.5 p-1 bg-popover border border-border/70 rounded-lg shadow-lg"
          >
            {PRESET_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => {
                  onReact(emoji);
                  setOpen(false);
                }}
                className="w-7 h-7 flex items-center justify-center text-[15px] rounded-md hover:bg-muted/60 transition-colors"
              >
                {emoji}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

// ── Mention autocomplete dropdown — portal, positions above composer ─────────

function MentionDropdown({
  users,
  isLoading,
  anchorRect,
  activeIdx,
  onSelect,
  onHover,
}: {
  users: MentionUser[];
  isLoading: boolean;
  anchorRect: { top: number; left: number; width: number };
  activeIdx: number;
  onSelect: (user: MentionUser) => void;
  onHover: (idx: number) => void;
}) {
  const el = (
    <div
      style={{
        position: "fixed",
        bottom: window.innerHeight - anchorRect.top + 6,
        left: anchorRect.left,
        minWidth: Math.max(anchorRect.width, 220),
        maxWidth: 320,
        zIndex: 9999,
      }}
      className="bg-popover border border-border/70 rounded-lg shadow-xl overflow-hidden py-1"
    >
      {isLoading ? (
        <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          Searching…
        </div>
      ) : users.length === 0 ? (
        <div className="px-3 py-2 text-[12px] text-muted-foreground">
          No teammates found
        </div>
      ) : (
        users.map((user, idx) => (
          <button
            key={user.id}
            onMouseDown={(e) => {
              e.preventDefault(); // keep textarea focus
              onSelect(user);
            }}
            onMouseEnter={() => onHover(idx)}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors",
              idx === activeIdx
                ? "bg-primary/10 text-primary"
                : "text-foreground hover:bg-muted/60"
            )}
          >
            <div
              className={cn(
                "w-7 h-7 rounded-full flex items-center justify-center shrink-0",
                "text-[10px] font-bold text-white",
                avatarBg(user.id)
              )}
            >
              {initials(user.name)}
            </div>
            <div className="min-w-0">
              <div className="text-[12.5px] font-medium truncate">{user.name}</div>
              {user.department && (
                <div className="text-[10.5px] text-muted-foreground truncate">
                  {user.department}
                </div>
              )}
            </div>
          </button>
        ))
      )}
    </div>
  );
  return createPortal(el, document.body);
}

// ── Message hover action bar ──────────────────────────────────────────────────

function MessageActionBar({
  isOwn,
  isAdmin,
  isPinned,
  onReact,
  onEdit,
  onDelete,
  onPin,
  onReply,
  onCreateTask,
  structuredItems,
  onMarkStructured,
  onUnmarkStructured,
  onMarkWithNote,
}: {
  isOwn: boolean;
  isAdmin: boolean;
  isPinned: boolean;
  onReact: (emoji: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onPin: () => void;
  onReply?: () => void;
  onCreateTask?: () => void;
  structuredItems?: StructuredItem[];
  onMarkStructured?: (itemType: string) => void;
  onUnmarkStructured?: (itemType: string) => void;
  onMarkWithNote?: (itemType: string, notes: string | null) => void;
}) {
  const canEdit = isOwn;
  const canDelete = isOwn || isAdmin;

  const [noteDialog, setNoteDialog] = useState<{ type: string; currentNote: string } | null>(null);
  const [noteText, setNoteText] = useState("");

  const NOTE_PLACEHOLDER: Record<string, string> = {
    decision:    "Why is this a decision?",
    risk:        "What is the risk or concern?",
    requirement: "What requirement does this capture?",
  };

  function openNoteDialog(type: string) {
    const existing = structuredItems?.find((si) => si.itemType === type)?.notes ?? "";
    setNoteText(existing ?? "");
    setNoteDialog({ type, currentNote: existing ?? "" });
  }

  function closeNoteDialog() {
    setNoteDialog(null);
    setNoteText("");
  }

  function saveNote() {
    if (!noteDialog) return;
    const trimmed = noteText.trim().slice(0, 500) || null;
    onMarkWithNote!(noteDialog.type, trimmed);
    closeNoteDialog();
  }

  const isDialogMarked = noteDialog ? !!(structuredItems?.some((si) => si.itemType === noteDialog.type)) : false;

  return (
    <>
    <div
      className={cn(
        "absolute right-2 -top-3 z-20",
        "flex items-center gap-px p-0.5 rounded-lg",
        "bg-background border border-border/70 shadow-sm",
        "opacity-0 group-hover:opacity-100 transition-opacity duration-100 pointer-events-none group-hover:pointer-events-auto"
      )}
    >
      <EmojiPickerPopover onReact={onReact} />
      {onReply && (
        <button
          onClick={onReply}
          title="Reply in thread"
          className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          <MessageSquare className="w-3 h-3" />
        </button>
      )}
      {onCreateTask && (
        <button
          onClick={onCreateTask}
          title="Create Task"
          data-testid="btn-create-task-from-message"
          className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10 transition-colors"
        >
          <CheckSquare className="w-3 h-3" />
        </button>
      )}
      {(onMarkStructured || onUnmarkStructured || onMarkWithNote) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              title="Mark as Decision / Risk / Requirement"
              data-testid="btn-mark-structured"
              className={cn(
                "w-6 h-6 flex items-center justify-center rounded-md transition-colors",
                (structuredItems?.length ?? 0) > 0
                  ? "text-violet-400 bg-violet-500/10 hover:bg-violet-500/20"
                  : "text-muted-foreground hover:text-violet-400 hover:bg-violet-500/10"
              )}
            >
              <Bookmark className="w-3 h-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="w-44 z-50">
            <DropdownMenuLabel className="text-[10px] py-1 text-muted-foreground font-normal">Mark as…</DropdownMenuLabel>
            {(["decision", "risk", "requirement"] as const).map((type) => {
              const isMarked = structuredItems?.some((si) => si.itemType === type);
              return (
                <DropdownMenuItem
                  key={type}
                  data-testid={`mark-as-${type}`}
                  onClick={() => {
                    if (onMarkWithNote) {
                      openNoteDialog(type);
                    } else {
                      isMarked ? onUnmarkStructured?.(type) : onMarkStructured?.(type);
                    }
                  }}
                  className="text-xs gap-2 cursor-pointer"
                >
                  <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", STRUCTURED_DOT_STYLE[type])} />
                  <span className="flex-1 capitalize">{type}</span>
                  {isMarked && <span className="text-[10px] text-primary/60">✓</span>}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <button
        onClick={onPin}
        title={isPinned ? "Unpin" : "Pin"}
        className={cn(
          "w-6 h-6 flex items-center justify-center rounded-md transition-colors",
          isPinned
            ? "text-primary bg-primary/10 hover:bg-primary/20"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
        )}
      >
        <Pin className="w-3 h-3" />
      </button>
      {canEdit && (
        <button
          onClick={onEdit}
          title="Edit"
          className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          <Pencil className="w-3 h-3" />
        </button>
      )}
      {canDelete && (
        <button
          onClick={onDelete}
          title="Delete"
          className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>

    {/* Note dialog — outside action bar div so pointer-events work correctly */}
    {noteDialog && (
      <Dialog open onOpenChange={(o) => { if (!o) closeNoteDialog(); }}>
        <DialogContent className="max-w-sm" data-testid="structured-note-dialog">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <span className={cn("w-2 h-2 rounded-full shrink-0", STRUCTURED_DOT_STYLE[noteDialog.type])} />
              {isDialogMarked ? `Edit ${noteDialog.type} note` : `Mark as ${noteDialog.type}`}
            </DialogTitle>
          </DialogHeader>
          <div className="py-1">
            <Textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value.slice(0, 500))}
              placeholder={NOTE_PLACEHOLDER[noteDialog.type] ?? "Add a note (optional)"}
              className="text-sm resize-none min-h-[80px]"
              autoFocus
              data-testid="structured-note-textarea"
            />
            <p className="text-[10px] text-muted-foreground/50 mt-1 text-right">{noteText.length}/500</p>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            {isDialogMarked && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-destructive hover:text-destructive hover:bg-destructive/10 mr-auto"
                onClick={() => { onUnmarkStructured?.(noteDialog.type); closeNoteDialog(); }}
                data-testid="structured-note-unmark-btn"
              >
                Unmark
              </Button>
            )}
            <Button variant="ghost" size="sm" className="text-xs" onClick={closeNoteDialog} data-testid="structured-note-cancel-btn">
              Cancel
            </Button>
            <Button size="sm" className="text-xs" onClick={saveNote} data-testid="structured-note-save-btn">
              {isDialogMarked ? "Update" : "Mark"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )}
    </>
  );
}

// ── Reaction strip ────────────────────────────────────────────────────────────

function ReactionStrip({
  reactions,
  messageId,
  onToggle,
}: {
  reactions: Reaction[];
  messageId: number;
  onToggle: (messageId: number, emoji: string) => void;
}) {
  if (!reactions || reactions.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 mt-1.5">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          onClick={() => onToggle(messageId, r.emoji)}
          className={cn(
            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[12px]",
            "border select-none transition-all duration-100",
            r.reacted
              ? "bg-primary/15 border-primary/30 text-foreground hover:bg-primary/20"
              : "bg-muted/40 border-border/40 text-foreground/70 hover:bg-muted/60 hover:border-border/60"
          )}
        >
          <span>{r.emoji}</span>
          <span className="font-medium text-[11px] tabular-nums">{r.count}</span>
        </button>
      ))}
    </div>
  );
}

// ── Message row ───────────────────────────────────────────────────────────────

function MessageRow({
  message,
  grouped,
  currentUserId,
  isAdmin,
  pinnedMessageIds,
  onToggleReaction,
  onEdit,
  onDelete,
  onPin,
  onOpenThread,
  onCreateTask,
  onMarkStructured,
  onUnmarkStructured,
  onMarkWithNote,
}: {
  message: Message;
  grouped: boolean;
  currentUserId: number;
  isAdmin: boolean;
  pinnedMessageIds: Set<number>;
  onToggleReaction: (messageId: number, emoji: string) => void;
  onEdit: (message: Message) => void;
  onDelete: (messageId: number) => void;
  onPin: (messageId: number, isPinned: boolean) => void;
  onOpenThread?: () => void;
  onCreateTask?: (message: Message) => void;
  onMarkStructured?: (messageId: number, itemType: string) => void;
  onUnmarkStructured?: (messageId: number, itemType: string) => void;
  onMarkWithNote?: (messageId: number, itemType: string, notes: string | null) => void;
}) {
  const isPinned = pinnedMessageIds.has(message.id);
  const isOwn = message.userId === currentUserId;

  if (message.deletedAt) {
    return (
      <div
        className={cn(
          "flex gap-3 px-2 -mx-2 py-0.5",
          grouped ? "mt-0.5" : "mt-4 first:mt-0"
        )}
        data-testid={`message-row-${message.id}`}
      >
        <div className="w-8 shrink-0" />
        <p className="text-[12.5px] text-muted-foreground/40 italic select-none">
          Message deleted
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative flex gap-3 group hover:bg-white/[0.025] rounded-lg px-2 -mx-2 py-0.5 transition-colors",
        grouped ? "mt-0.5" : "mt-4 first:mt-0"
      )}
      data-testid={`message-row-${message.id}`}
    >
      {/* Hover action bar */}
      <MessageActionBar
        isOwn={isOwn}
        isAdmin={isAdmin}
        isPinned={isPinned}
        onReact={(emoji) => onToggleReaction(message.id, emoji)}
        onEdit={() => onEdit(message)}
        onDelete={() => onDelete(message.id)}
        onPin={() => onPin(message.id, isPinned)}
        onReply={onOpenThread}
        onCreateTask={onCreateTask ? () => onCreateTask(message) : undefined}
        structuredItems={message.structuredItems}
        onMarkStructured={onMarkStructured ? (t) => onMarkStructured(message.id, t) : undefined}
        onUnmarkStructured={onUnmarkStructured ? (t) => onUnmarkStructured(message.id, t) : undefined}
        onMarkWithNote={onMarkWithNote ? (t, n) => onMarkWithNote(message.id, t, n) : undefined}
      />

      {/* Avatar / grouped spacer */}
      {grouped ? (
        <div className="w-8 shrink-0" />
      ) : (
        <div
          className={cn(
            "w-8 h-8 shrink-0 rounded-full flex items-center justify-center",
            "text-white text-[11px] font-bold mt-0.5 overflow-hidden select-none",
            avatarBg(message.userId)
          )}
        >
          {message.userAvatarUrl ? (
            <img
              src={message.userAvatarUrl}
              alt={message.userName}
              className="w-full h-full object-cover"
            />
          ) : (
            initials(message.userName)
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        {!grouped && (
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="text-[13px] font-semibold text-foreground leading-tight">
              {message.userName}
            </span>
            <span className="text-[11px] text-muted-foreground/60 shrink-0">
              {formatTs(message.createdAt)}
            </span>
            {message.isEdited && (
              <span className="text-[10px] text-muted-foreground/40 italic">
                edited
              </span>
            )}
            {isPinned && (
              <span className="inline-flex items-center text-primary/50">
                <Pin className="w-2.5 h-2.5" />
              </span>
            )}
          </div>
        )}
        <p className="text-[13.5px] text-foreground/90 leading-relaxed whitespace-pre-wrap break-words">
          {renderMentionBody(message.body, currentUserId)}
        </p>
        <CurrentAttachmentChips attachments={message.attachments ?? []} />
        <ReactionStrip
          reactions={message.reactions || []}
          messageId={message.id}
          onToggle={onToggleReaction}
        />
        {/* Structured item badges */}
        {(message.structuredItems?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {message.structuredItems!.map((si) => (
              <span
                key={si.itemType}
                data-testid={`structured-badge-${si.itemType}-${message.id}`}
                title={si.notes ?? undefined}
                className={cn(
                  "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border select-none",
                  STRUCTURED_BADGE_STYLE[si.itemType]
                )}
              >
                <Bookmark className="w-2 h-2" />
                {si.itemType.charAt(0).toUpperCase() + si.itemType.slice(1)}
                {si.notes && <span className="opacity-60 ml-0.5">·</span>}
              </span>
            ))}
          </div>
        )}
        {/* Reply count chip — only on top-level messages with replies */}
        {onOpenThread && (message.replyCount ?? 0) > 0 && (
          <button
            onClick={onOpenThread}
            data-testid={`reply-count-${message.id}`}
            className="mt-2 flex items-center gap-1.5 text-[12px] text-primary/70 hover:text-primary transition-colors group/rc"
          >
            <div className="flex -space-x-1">
              <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center">
                <MessageSquare className="w-2.5 h-2.5 text-primary/60" />
              </div>
            </div>
            <span className="font-medium">
              {message.replyCount === 1 ? "1 reply" : `${message.replyCount} replies`}
            </span>
            {message.latestReplyAt && (
              <span className="text-muted-foreground/40 group-hover/rc:text-muted-foreground/60 transition-colors">
                · {formatTs(message.latestReplyAt)}
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Inline edit overlay ───────────────────────────────────────────────────────

function InlineEditRow({
  message,
  onSave,
  onCancel,
}: {
  message: Message;
  onSave: (newBody: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(message.body ?? "");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mention = useComposerMentions(taRef);

  useEffect(() => {
    if (taRef.current) {
      taRef.current.focus();
      const len = taRef.current.value.length;
      taRef.current.setSelectionRange(len, len);
      growTextarea(taRef.current, 192);
    }
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (mention.handleMentionKeyDown(e, text, setText)) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape") {
      // Stop the native event from reaching document listeners (e.g. ThreadPanel
      // close). The edit should cancel; the panel should stay open.
      e.nativeEvent.stopPropagation();
      onCancel();
    }
  }

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (trimmed === (message.body ?? "").trim()) {
      onCancel();
      return;
    }
    onSave(trimmed);
  }

  return (
    <div
      className={cn(
        "flex gap-3 px-2 -mx-2 py-2 mt-4 first:mt-0",
        "bg-primary/[0.03] rounded-lg border border-primary/15"
      )}
    >
      {mention.mentionActive && mention.mentionAnchorRect && (
        <MentionDropdown
          users={mention.mentionUsers}
          isLoading={mention.mentionLoading}
          anchorRect={mention.mentionAnchorRect}
          activeIdx={mention.mentionIdx}
          onSelect={(u) => mention.insertMention(text, setText, u)}
          onHover={mention.setMentionIdx}
        />
      )}
      <div className="w-8 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-[13px] font-semibold text-foreground">
            {message.userName}
          </span>
          <span className="text-[11px] text-muted-foreground/60">
            {formatTs(message.createdAt)}
          </span>
        </div>
        <Textarea
          ref={taRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            growTextarea(e.target, 192);
            mention.onValueChange(
              e.target.value,
              e.target.selectionStart ?? e.target.value.length
            );
          }}
          onKeyDown={handleKeyDown}
          className="border border-primary/20 bg-background shadow-none resize-none p-2 text-[13.5px] leading-relaxed focus-visible:ring-1 focus-visible:ring-primary/30 min-h-[36px] max-h-48 overflow-y-auto rounded-lg w-full"
          rows={1}
        />
        <div className="flex items-center gap-2 mt-1.5">
          <Button size="sm" onClick={submit} className="h-6 text-[11px] px-2.5">
            Save
          </Button>
          <button
            onClick={onCancel}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <span className="text-[10px] text-muted-foreground/35 ml-1 select-none">
            Esc to cancel · Enter to save
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Pinned messages bar ───────────────────────────────────────────────────────

function PinnedBar({
  pins,
  onUnpin,
}: {
  pins: PinnedMessage[];
  onUnpin: (messageId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (pins.length === 0) return null;

  const shown = expanded ? pins : [pins[0]];

  return (
    <div className="px-5 py-2 border-b border-border/40 bg-primary/[0.02] shrink-0">
      <div className="flex items-start gap-2">
        <Pin className="w-3 h-3 text-primary/50 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 space-y-0.5">
          {shown.map((pin) => (
            <div key={pin.id} className="flex items-center gap-2 group/pin min-w-0">
              <div className="flex-1 min-w-0 flex items-baseline gap-1.5 overflow-hidden">
                <span className="text-[11px] font-medium text-primary/70 shrink-0">
                  {pin.messageUserName}
                </span>
                <span className="text-[12px] text-foreground/60 truncate">
                  {(pin.messageBody ?? "").slice(0, 90)}
                  {(pin.messageBody ?? "").length > 90 ? "…" : ""}
                </span>
              </div>
              <button
                onClick={() => onUnpin(pin.messageId)}
                title="Unpin"
                className="opacity-0 group-hover/pin:opacity-100 shrink-0 w-4 h-4 flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground transition-all rounded"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
        {pins.length > 1 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 flex items-center gap-0.5 text-[11px] text-primary/60 hover:text-primary transition-colors"
          >
            {expanded ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
            <span>{expanded ? "less" : `+${pins.length - 1}`}</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Thread panel ──────────────────────────────────────────────────────────────

function ThreadPanel({
  rootMessageId,
  currentUserId,
  isAdmin,
  selectedSlug,
  onClose,
  onCreateTaskMsg,
  onCreateSummaryTask,
}: {
  rootMessageId: number;
  currentUserId: number;
  isAdmin: boolean;
  selectedSlug: string;
  onClose: () => void;
  onCreateTaskMsg?: (msg: Message, threadRootId?: number) => void;
  onCreateSummaryTask?: (item: { task: string; owner: string; due: string | null }) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [replyDraft, setReplyDraft] = useState("");
  const [replyPendingFiles, setReplyPendingFiles] = useState<File[]>([]);
  const replyFileInputRef = useRef<HTMLInputElement | null>(null);
  const [isReplyUploading, setIsReplyUploading] = useState(false);
  const [editingReply, setEditingReply] = useState<Message | null>(null);
  const threadFeedRef = useRef<HTMLDivElement>(null);
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const threadAtBottom = useRef(true);
  const replyMention = useComposerMentions(replyTextareaRef);

  // Thread AI summary
  const [threadSummaryOpen, setThreadSummaryOpen] = useState(false);
  const [threadSummaryData, setThreadSummaryData] = useState<CurrentSummaryData | null>(null);
  const threadSummaryMutation = useMutation({
    mutationFn: async (msgId: number) => {
      const r = await apiRequest("POST", "/api/current/summary", { scope: "thread", messageId: msgId });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).message || "AI summary failed"); }
      return r.json() as Promise<CurrentSummaryData>;
    },
    onSuccess: (data) => { setThreadSummaryData(data); setThreadSummaryOpen(true); },
    onError: () => { setThreadSummaryOpen(true); setThreadSummaryData(null); },
  });

  const threadQueryKey = ["/api/current/messages", rootMessageId, "thread"];

  // Keep a stable ref to onClose so the Esc listener never needs to re-register
  // on every render (onClose is an arrow fn in the parent → new ref each render).
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  const { data, isLoading } = useQuery<ThreadData>({
    queryKey: threadQueryKey,
    queryFn: () =>
      fetch(`/api/current/messages/${rootMessageId}/thread`, {
        credentials: "include",
      }).then((r) => {
        if (!r.ok) throw new Error("Thread not found");
        return r.json();
      }),
    refetchInterval: 5_000,
    placeholderData: keepPreviousData,
  });

  const invalidateThread = () =>
    queryClient.invalidateQueries({ queryKey: threadQueryKey });

  const invalidateFeed = () => {
    queryClient.invalidateQueries({
      queryKey: ["/api/current/channels", selectedSlug, "messages"],
    });
    queryClient.invalidateQueries({ queryKey: ["/api/current/channels"] });
  };

  // Esc to close — uses ref so the effect never re-registers on every render
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to bottom when replies arrive (if already near bottom)
  const prevReplyCount = useRef(0);
  useEffect(() => {
    const count = data?.replies?.length ?? 0;
    if (count > prevReplyCount.current && threadAtBottom.current) {
      requestAnimationFrame(() => {
        if (threadFeedRef.current)
          threadFeedRef.current.scrollTop = threadFeedRef.current.scrollHeight;
      });
    }
    prevReplyCount.current = count;
  }, [data?.replies?.length]);

  // On first open, scroll to bottom
  useEffect(() => {
    requestAnimationFrame(() => {
      if (threadFeedRef.current)
        threadFeedRef.current.scrollTop = threadFeedRef.current.scrollHeight;
    });
  }, [rootMessageId]);

  function handleThreadScroll() {
    if (!threadFeedRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = threadFeedRef.current;
    threadAtBottom.current = scrollHeight - scrollTop - clientHeight < 80;
  }

  // Post reply
  const postReplyMutation = useMutation({
    mutationFn: (body: string) =>
      apiRequest("POST", `/api/current/messages/${rootMessageId}/thread`, { body })
        .then((r) => r.json()),
  });

  // Edit reply (reuses same PATCH route)
  const editReplyMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: string }) =>
      apiRequest("PATCH", `/api/current/messages/${id}`, { body }),
    onSuccess: () => {
      setEditingReply(null);
      invalidateThread();
      invalidateFeed();
    },
  });

  // Delete reply
  const deleteReplyMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/current/messages/${id}`),
    onSuccess: () => {
      invalidateThread();
      invalidateFeed();
    },
  });

  // React on reply
  const reactReplyMutation = useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: number; emoji: string }) =>
      apiRequest("POST", `/api/current/messages/${messageId}/reactions`, { emoji }),
    onSuccess: () => {
      invalidateThread();
      invalidateFeed();
    },
  });

  // Pin on reply (reuses same PIN route — pins are channel-scoped so this works fine)
  const pinReplyMutation = useMutation({
    mutationFn: ({ id, isPinned }: { id: number; isPinned: boolean }) =>
      isPinned
        ? apiRequest("DELETE", `/api/current/messages/${id}/pin`)
        : apiRequest("POST", `/api/current/messages/${id}/pin`),
    onSuccess: () => {
      invalidateThread();
      invalidateFeed();
      queryClient.invalidateQueries({
        queryKey: ["/api/current/channels", selectedSlug, "pins"],
      });
    },
  });

  async function handleReplySend() {
    const trimmed = replyDraft.trim();
    if (!trimmed || postReplyMutation.isPending || isReplyUploading) return;
    try {
      const newMsg = await postReplyMutation.mutateAsync(trimmed);
      setReplyDraft("");
      replyMention.closeMention();
      if (replyTextareaRef.current) replyTextareaRef.current.style.height = "auto";
      threadAtBottom.current = true;
      const files = [...replyPendingFiles];
      setReplyPendingFiles([]);
      if (files.length > 0 && newMsg?.id) {
        setIsReplyUploading(true);
        try {
          const result = await uploadCurrentAttachments(newMsg.id, files);
          if (result.failed.length > 0) {
            toast({
              title: "Some files failed to upload",
              description: result.failed.join(", "),
              variant: "destructive",
            });
          }
        } finally {
          setIsReplyUploading(false);
        }
      }
      invalidateThread();
      invalidateFeed();
    } catch {}
  }

  function handleReplyKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (replyMention.handleMentionKeyDown(e, replyDraft, setReplyDraft)) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleReplySend();
    }
  }

  const root = data?.root;
  const replies = data?.replies ?? [];
  const emptyPinnedSet = new Set<number>();

  return (
    <div
      className="w-[380px] shrink-0 flex flex-col border-l border-border bg-background overflow-hidden"
      data-testid="thread-panel"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/60 flex items-center gap-2 shrink-0">
        <MessageSquare className="w-3.5 h-3.5 text-muted-foreground/50" />
        <span className="font-semibold text-[13px] text-foreground tracking-tight">
          Thread
        </span>
        <span className="text-[12px] text-muted-foreground/50 ml-0.5">
          · #{displaySlug(selectedSlug)}
        </span>
        <button
          onClick={() => {
            if (threadSummaryOpen) {
              setThreadSummaryOpen(false);
            } else {
              setThreadSummaryData(null);
              threadSummaryMutation.mutate(rootMessageId);
            }
          }}
          disabled={threadSummaryMutation.isPending}
          title="Summarize thread"
          data-testid="btn-summarize-thread"
          className={cn(
            "ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors",
            threadSummaryOpen
              ? "bg-primary/10 text-primary/80 hover:bg-primary/15"
              : "text-muted-foreground/40 hover:text-foreground hover:bg-muted/60",
          )}
        >
          {threadSummaryMutation.isPending
            ? <Loader2 className="w-3 h-3 animate-spin" />
            : <Sparkles className="w-3 h-3" />}
          <span>Summarize</span>
        </button>
        <button
          onClick={onClose}
          data-testid="btn-close-thread"
          title="Close thread (Esc)"
          className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Thread AI Summary panel */}
      {threadSummaryOpen && (
        <div className="px-3 pt-2.5 pb-0 shrink-0 border-b border-border/30">
          <CurrentSummaryPanel
            data={threadSummaryData}
            isLoading={threadSummaryMutation.isPending}
            isError={threadSummaryMutation.isError}
            onClose={() => setThreadSummaryOpen(false)}
            onRegenerate={() => { setThreadSummaryData(null); threadSummaryMutation.mutate(rootMessageId); }}
            onCreateTask={onCreateSummaryTask}
          />
          <div className="h-2.5" />
        </div>
      )}

      {/* Root message */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-4 h-4 text-muted-foreground/40 animate-spin" />
        </div>
      ) : root ? (
        <div className="px-4 pt-4 pb-3 border-b border-border/30 shrink-0 bg-muted/[0.02]">
          {editingReply?.id === root.id ? (
            <InlineEditRow
              message={root}
              onSave={(body) => editReplyMutation.mutate({ id: root.id, body })}
              onCancel={() => setEditingReply(null)}
            />
          ) : (
            <MessageRow
              message={root}
              grouped={false}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              pinnedMessageIds={emptyPinnedSet}
              onToggleReaction={(mid, emoji) =>
                reactReplyMutation.mutate({ messageId: mid, emoji })
              }
              onEdit={(m) => setEditingReply(m)}
              onDelete={(id) => deleteReplyMutation.mutate(id)}
              onPin={(id, isPinned) => pinReplyMutation.mutate({ id, isPinned })}
              onCreateTask={onCreateTaskMsg ? () => onCreateTaskMsg(root, undefined) : undefined}
              onMarkStructured={(mid, itemType) =>
                apiRequest("POST", `/api/current/messages/${mid}/structured`, { itemType }).then(() => { invalidateThread(); invalidateFeed(); })
              }
              onUnmarkStructured={(mid, itemType) =>
                apiRequest("DELETE", `/api/current/messages/${mid}/structured/${itemType}`).then(() => { invalidateThread(); invalidateFeed(); })
              }
              onMarkWithNote={(mid, itemType, notes) =>
                apiRequest("POST", `/api/current/messages/${mid}/structured`, { itemType, notes }).then(() => { invalidateThread(); invalidateFeed(); })
              }
            />
          )}
        </div>
      ) : null}

      {/* Reply count divider */}
      {!isLoading && (
        <div className="px-4 py-2 shrink-0 flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground/50 font-medium select-none">
            {replies.length === 0
              ? "No replies yet"
              : replies.length === 1
              ? "1 reply"
              : `${replies.length} replies`}
          </span>
          <div className="flex-1 h-px bg-border/30" />
        </div>
      )}

      {/* Replies feed */}
      <div
        ref={threadFeedRef}
        onScroll={handleThreadScroll}
        className="flex-1 overflow-y-auto px-4 py-1"
        data-testid="thread-replies-feed"
      >
        {replies.map((reply, i) => {
          if (editingReply?.id === reply.id) {
            return (
              <InlineEditRow
                key={reply.id}
                message={reply}
                onSave={(body) => editReplyMutation.mutate({ id: reply.id, body })}
                onCancel={() => setEditingReply(null)}
              />
            );
          }
          return (
            <MessageRow
              key={reply.id}
              message={reply}
              grouped={isContinuation(replies[i - 1], reply)}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              pinnedMessageIds={emptyPinnedSet}
              onToggleReaction={(mid, emoji) =>
                reactReplyMutation.mutate({ messageId: mid, emoji })
              }
              onEdit={(m) => setEditingReply(m)}
              onDelete={(id) => deleteReplyMutation.mutate(id)}
              onPin={(id, isPinned) => pinReplyMutation.mutate({ id, isPinned })}
              onCreateTask={onCreateTaskMsg ? () => onCreateTaskMsg(reply, rootMessageId) : undefined}
              onMarkStructured={(mid, itemType) =>
                apiRequest("POST", `/api/current/messages/${mid}/structured`, { itemType }).then(() => { invalidateThread(); invalidateFeed(); })
              }
              onUnmarkStructured={(mid, itemType) =>
                apiRequest("DELETE", `/api/current/messages/${mid}/structured/${itemType}`).then(() => { invalidateThread(); invalidateFeed(); })
              }
              onMarkWithNote={(mid, itemType, notes) =>
                apiRequest("POST", `/api/current/messages/${mid}/structured`, { itemType, notes }).then(() => { invalidateThread(); invalidateFeed(); })
              }
            />
          );
        })}
        <div className="h-2" />
      </div>

      {/* Reply composer — hidden when root is deleted */}
      <div className="px-4 pt-2 pb-4 border-t border-border/60 shrink-0">
        {root?.deletedAt ? (
          <p className="text-[12px] text-muted-foreground/50 italic text-center py-1 select-none">
            This message was deleted — no new replies can be added.
          </p>
        ) : (
          <>
            {replyMention.mentionActive && replyMention.mentionAnchorRect && (
              <MentionDropdown
                users={replyMention.mentionUsers}
                isLoading={replyMention.mentionLoading}
                anchorRect={replyMention.mentionAnchorRect}
                activeIdx={replyMention.mentionIdx}
                onSelect={(u) =>
                  replyMention.insertMention(replyDraft, setReplyDraft, u)
                }
                onHover={replyMention.setMentionIdx}
              />
            )}
            {replyPendingFiles.length > 0 && (
              <div className="mb-2">
                <PendingFileChips
                  files={replyPendingFiles}
                  onRemove={(i) =>
                    setReplyPendingFiles((prev) => prev.filter((_, idx) => idx !== i))
                  }
                />
              </div>
            )}
            <div
              className={cn(
                "flex items-end gap-2 rounded-xl px-3 py-2 transition-all duration-150",
                "bg-muted/30 border border-border/60",
                "focus-within:border-primary/40 focus-within:bg-background",
                "focus-within:shadow-[0_0_0_3px_hsl(var(--primary)/0.07)]"
              )}
            >
              <Textarea
                ref={replyTextareaRef}
                value={replyDraft}
                onChange={(e) => {
                  setReplyDraft(e.target.value);
                  growTextarea(e.target, 120);
                  replyMention.onValueChange(
                    e.target.value,
                    e.target.selectionStart ?? e.target.value.length
                  );
                }}
                onKeyDown={handleReplyKeyDown}
                placeholder="Reply… (@ to mention)"
                className={cn(
                  "flex-1 border-0 bg-transparent shadow-none resize-none p-0",
                  "text-[13px] placeholder:text-muted-foreground/40 leading-relaxed",
                  "focus-visible:ring-0 focus-visible:ring-offset-0",
                  "min-h-[20px] max-h-32 overflow-y-auto"
                )}
                rows={1}
                data-testid="thread-reply-input"
              />
              <button
                type="button"
                onClick={() => replyFileInputRef.current?.click()}
                title="Attach file"
                className="shrink-0 h-7 w-7 p-0 rounded-lg flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted/40 transition-colors"
                data-testid="btn-attach-reply"
              >
                <Paperclip className="w-3 h-3" />
              </button>
              <input
                ref={replyFileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0)
                    setReplyPendingFiles((prev) => [...prev, ...files]);
                  e.target.value = "";
                }}
                data-testid="reply-file-input"
              />
              <Button
                size="sm"
                onClick={handleReplySend}
                disabled={!replyDraft.trim() || postReplyMutation.isPending || isReplyUploading}
                className="shrink-0 h-7 w-7 p-0 rounded-lg transition-all"
                data-testid="btn-send-reply"
              >
                {(postReplyMutation.isPending || isReplyUploading) ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Send className="w-3 h-3" />
                )}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground/30 mt-1 px-0.5 select-none">
              Enter to reply · Shift+Enter for new line · @ to mention · 📎 to attach
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ── Sidebar skeletons ─────────────────────────────────────────────────────────

function ChannelSkeleton() {
  return (
    <div className="px-4 py-2 space-y-1">
      {Array.from({ length: 9 }).map((_, i) => (
        <div
          key={i}
          className="h-7 rounded-lg bg-muted/30 animate-pulse"
          style={{ width: `${60 + (i % 3) * 15}%` }}
        />
      ))}
    </div>
  );
}

// ── Empty feed ────────────────────────────────────────────────────────────────

function EmptyFeed({ slug }: { slug: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-20 select-none">
      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-5 ring-1 ring-primary/10">
        <Hash className="w-8 h-8 text-primary/50" />
      </div>
      <h3 className="text-[15px] font-semibold text-foreground mb-1.5">
        Start the conversation
      </h3>
      <p className="text-sm text-muted-foreground max-w-[240px]">
        Be the first to post in{" "}
        <span className="text-primary font-medium">#{displaySlug(slug)}</span>
      </p>
    </div>
  );
}

// ── Mentions panel ────────────────────────────────────────────────────────────

// ── SearchResultCard ──────────────────────────────────────────────────────────

function SearchResultCard({
  result,
  query,
  onNavigate,
}: {
  result: SearchResult;
  query: string;
  onNavigate?: () => void;
}) {
  const sourceLabel = result.channelSlug
    ? `#${displaySlug(result.channelSlug)}`
    : result.objectType
    ? `${result.objectType.replace(/_/g, " ")} · ${result.objectId}`
    : "Currents";

  const recordUrl = (() => {
    if (result.channelSlug || !result.objectType || !result.objectId) return null;
    const threadPart = result.parentMessageId ? `&thread=${result.parentMessageId}` : "";
    const msgPart = `&message=${result.id}`;
    if (result.objectType === "lead") {
      return `/opportunities?selected=${result.objectId}&tab=current${msgPart}${threadPart}`;
    }
    return buildRecordUrl(result.objectType, result.objectId) +
      `?tab=current${msgPart}${threadPart}`;
  })();

  const inner = (
    <div className="w-full text-left rounded-xl px-3.5 py-3 border border-border/40 hover:border-primary/30 hover:bg-muted/30 transition-all group/src">
      <div className="flex items-center gap-1.5 mb-1.5 min-w-0">
        {result.channelSlug ? (
          <Hash className="w-3 h-3 text-primary/60 shrink-0" />
        ) : (
          <MessageSquare className="w-3 h-3 text-primary/60 shrink-0" />
        )}
        <span className="text-[10.5px] font-semibold text-primary/70 truncate">
          {sourceLabel}
        </span>
        {result.isReply && (
          <span className="text-[10px] text-muted-foreground/50 shrink-0">· thread</span>
        )}
        <span className="ml-auto text-[10.5px] text-muted-foreground/40 shrink-0 tabular-nums">
          {formatTs(result.createdAt)}
        </span>
      </div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <div
          className={cn(
            "w-4 h-4 rounded-full flex items-center justify-center shrink-0 text-[7px] font-bold text-white",
            avatarBg(result.id)
          )}
        >
          {initials(result.userName)}
        </div>
        <span className="text-[11.5px] font-medium text-foreground/70">{result.userName}</span>
      </div>
      {result.snippet ? (
        <p className="text-[12.5px] text-foreground/80 leading-relaxed line-clamp-2 break-words">
          {highlightMatch(result.snippet, query)}
        </p>
      ) : result.matchedAttachment ? (
        <p className="text-[12px] text-muted-foreground/50 italic">Matched in attached file</p>
      ) : null}
      {result.matchedAttachment && result.attachmentNames.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {result.attachmentNames.slice(0, 3).map((name, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-muted/50 text-muted-foreground border border-border/30 max-w-[160px] truncate"
            >
              <Paperclip className="w-2.5 h-2.5 shrink-0" />
              <span className="truncate">{name}</span>
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 flex justify-end">
        <span className="text-[10.5px] text-primary/50 font-medium group-hover/src:text-primary transition-colors">
          Go to message →
        </span>
      </div>
    </div>
  );

  if (recordUrl) {
    return (
      <a href={recordUrl} className="block no-underline" data-testid={`search-result-${result.id}`}>
        {inner}
      </a>
    );
  }
  return (
    <button
      onClick={onNavigate}
      className="block w-full"
      data-testid={`search-result-${result.id}`}
    >
      {inner}
    </button>
  );
}

// ── SearchPanel ───────────────────────────────────────────────────────────────

function SearchPanel({
  onNavigate,
}: {
  onNavigate: (slug: string, messageId: number, threadId?: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const {
    data: results = [],
    isLoading,
    isError,
  } = useQuery<SearchResult[]>({
    queryKey: ["/api/current/search", debouncedQ],
    queryFn: () =>
      fetch(`/api/current/search?q=${encodeURIComponent(debouncedQ)}&limit=50`, {
        credentials: "include",
      }).then((r) => r.json()),
    enabled: debouncedQ.length > 0,
    staleTime: 30_000,
  });

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Search bar */}
      <div className="px-4 py-3 border-b border-border/60 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages, files, people…"
            className={cn(
              "w-full pl-8 pr-8 py-1.5 text-[13px] rounded-lg border",
              "bg-muted/30 border-border/40 text-foreground placeholder:text-muted-foreground/40",
              "focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/40 transition-all"
            )}
            data-testid="current-search-input"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              data-testid="current-search-clear"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {debouncedQ && !isLoading && (
          <p className="text-[10.5px] text-muted-foreground/40 mt-1.5 px-0.5">
            {results.length === 0
              ? "No results"
              : `${results.length} result${results.length === 1 ? "" : "s"}`}
          </p>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {!debouncedQ && (
          <div className="flex flex-col items-center justify-center h-full py-20 text-center select-none">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 ring-1 ring-primary/10">
              <Search className="w-6 h-6 text-primary/50" />
            </div>
            <p className="text-[13.5px] font-semibold text-foreground/70 mb-1.5">
              Search Currents
            </p>
            <p className="text-[12px] text-muted-foreground/60 max-w-[230px] leading-relaxed">
              Find messages, files, and people across all channels and records.
            </p>
          </div>
        )}

        {debouncedQ && isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 text-muted-foreground/40 animate-spin" />
          </div>
        )}

        {debouncedQ && isError && (
          <div className="text-center py-12">
            <p className="text-sm text-muted-foreground/60">Search failed. Try again.</p>
          </div>
        )}

        {debouncedQ && !isLoading && !isError && results.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center select-none">
            <p className="text-[13px] text-muted-foreground/60">
              No results for &ldquo;{debouncedQ}&rdquo;
            </p>
            <p className="text-[11.5px] text-muted-foreground/40 mt-1">
              Try different keywords.
            </p>
          </div>
        )}

        {results.map((r) => (
          <SearchResultCard
            key={r.id}
            result={r}
            query={debouncedQ}
            onNavigate={
              r.channelSlug
                ? () => onNavigate(r.channelSlug!, r.id, r.parentMessageId ?? undefined)
                : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}

// ── MentionsPanel ─────────────────────────────────────────────────────────────

function MentionsPanel({
  currentUserId,
  onNavigate,
}: {
  currentUserId: number;
  onNavigate: (slug: string, messageId: number, threadId?: number) => void;
}) {
  const { data: mentions = [], isLoading } = useQuery<MentionMessage[]>({
    queryKey: ["/api/current/mentions"],
    queryFn: () =>
      fetch("/api/current/mentions", { credentials: "include" }).then((r) =>
        r.json()
      ),
    refetchInterval: 15_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 text-muted-foreground/40 animate-spin" />
      </div>
    );
  }

  if (mentions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-20 select-none">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-5 ring-1 ring-primary/10">
          <AtSign className="w-8 h-8 text-primary/50" />
        </div>
        <h3 className="text-[15px] font-semibold text-foreground mb-1.5">
          No mentions yet
        </h3>
        <p className="text-sm text-muted-foreground max-w-[240px]">
          When a teammate tags you with @, it'll show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
      {mentions.map((m) => (
        <button
          key={m.id}
          onClick={() =>
            onNavigate(
              m.channelSlug,
              m.id,
              m.parentMessageId ?? undefined
            )
          }
          className="w-full text-left rounded-xl px-4 py-3 hover:bg-muted/40 transition-colors border border-border/40 hover:border-border/70"
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-semibold text-primary/70 truncate">
              #{displaySlug(m.channelSlug)}
            </span>
            {m.parentMessageId && (
              <span className="text-[10px] text-muted-foreground/50 shrink-0">
                · in thread
              </span>
            )}
            <span className="ml-auto text-[11px] text-muted-foreground/40 shrink-0 tabular-nums">
              {formatTs(m.createdAt)}
            </span>
          </div>
          <div className="flex items-start gap-2">
            <div
              className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                "text-[9px] font-bold text-white",
                avatarBg(m.userId)
              )}
            >
              {initials(m.userName)}
            </div>
            <div className="min-w-0">
              <span className="text-[12.5px] font-medium text-foreground/80 mr-1.5">
                {m.userName}
              </span>
              <span className="text-[13px] text-foreground/70 leading-relaxed whitespace-pre-wrap break-words">
                {renderMentionBody(m.body, currentUserId)}
              </span>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}


// ── StructuredListItem ────────────────────────────────────────────────────────

interface StructuredListItem {
  id: number;
  messageId: number;
  itemType: "decision" | "risk" | "requirement";
  notes: string | null;
  severity: string | null;
  status: string | null;
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string;
  channelId: number | null;
  channelSlug: string | null;
  channelName: string | null;
  objectType: string | null;
  objectId: number | null;
  threadRootId: number | null;
  messageBody: string | null;
  messageCreatedAt: string;
  authorName: string | null;
  authorAvatar: string | null;
  actionUrl: string | null;
}

const STRUCT_FILTER_ITEMS = [
  { value: "all" as const, label: "All" },
  { value: "decision" as const, label: "Decisions" },
  { value: "risk" as const, label: "Risks" },
  { value: "requirement" as const, label: "Requirements" },
];

// ── StructuredItemsPanel ─────────────────────────────────────────────────────

function StructuredItemsPanel({
  selectedSlug,
  onChannelNavigate,
}: {
  selectedSlug: string;
  onChannelNavigate: (slug: string, messageId: number, threadId?: number) => void;
}) {
  const [filter, setFilter] = useState<"all" | "decision" | "risk" | "requirement">("all");
  const [scope, setScope] = useState<"channel" | "all">("channel");

  const params = new URLSearchParams({ scope: scope === "channel" ? "channel" : "all", limit: "50" });
  if (scope === "channel") {
    params.set("channel", selectedSlug);
  }
  if (filter !== "all") params.set("itemType", filter);

  const { data = [], isLoading, isError } = useQuery<StructuredListItem[]>({
    queryKey: ["/api/current/structured", scope, selectedSlug, filter],
    queryFn: () =>
      fetch(`/api/current/structured?${params}`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 30_000,
  });

  function handleView(item: StructuredListItem) {
    if (!item.actionUrl) return;
    if (item.actionUrl.startsWith("/current?")) {
      const url = new URL(item.actionUrl, window.location.origin);
      const slug = url.searchParams.get("channel") ?? selectedSlug;
      const msgId = Number(url.searchParams.get("message"));
      const threadId = Number(url.searchParams.get("thread")) || undefined;
      if (slug && msgId) onChannelNavigate(slug, msgId, threadId);
    } else {
      window.location.href = item.actionUrl;
    }
  }

  const filterLabel =
    filter === "decision" ? "decisions" :
    filter === "risk" ? "risks" :
    filter === "requirement" ? "requirements" : "structured items";

  const chipActive: Record<string, string> = {
    all: "bg-foreground/10 text-foreground border-border/60",
    decision: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    risk: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    requirement: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  };

  return (
    <div className="flex flex-col h-full">
      {/* Scope + filter controls */}
      <div className="px-5 pt-3 pb-2.5 shrink-0 space-y-2 border-b border-border/40">
        {/* Scope pills */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setScope("channel")}
            data-testid="structured-scope-channel"
            className={cn(
              "px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors",
              scope === "channel"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
            )}
          >
            #{displaySlug(selectedSlug)}
          </button>
          <button
            onClick={() => setScope("all")}
            data-testid="structured-scope-all"
            className={cn(
              "px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors",
              scope === "all"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
            )}
          >
            All Currents
          </button>
        </div>
        {/* Filter chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {STRUCT_FILTER_ITEMS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              data-testid={`structured-filter-${value}`}
              className={cn(
                "px-2.5 py-0.5 rounded-full text-[11.5px] font-medium border transition-colors",
                filter === value
                  ? chipActive[value]
                  : "text-muted-foreground border-border/30 hover:border-border/60 hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Items list */}
      <div className="flex-1 overflow-y-auto px-5 py-3" data-testid="structured-items-list">
        {isLoading ? (
          <div className="flex items-center justify-center pt-16">
            <Loader2 className="w-5 h-5 text-muted-foreground/40 animate-spin" />
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center pt-16 text-center px-6 select-none">
            <p className="text-[13px] text-muted-foreground">Could not load structured items.</p>
            <p className="text-[12px] text-muted-foreground/60 mt-1">Check your connection and try again.</p>
          </div>
        ) : data.length === 0 ? (
          <div className="flex flex-col items-center justify-center pt-16 text-center px-6 select-none">
            <div className="w-14 h-14 rounded-2xl bg-primary/[0.08] flex items-center justify-center mb-4 ring-1 ring-primary/10">
              <Bookmark className="w-7 h-7 text-primary/40" />
            </div>
            <h3 className="text-[14px] font-semibold text-foreground mb-1.5">
              {filter === "all" ? "No structured items yet" :
               filter === "decision" ? "No decisions marked yet" :
               filter === "risk" ? "No risks marked yet" :
               "No requirements marked yet"}
            </h3>
            <p className="text-[13px] text-muted-foreground max-w-[240px] leading-relaxed">
              {filter === "all"
                ? "Mark important messages as Decisions, Risks, or Requirements using the bookmark icon on any message."
                : `Mark messages as ${filterLabel} using the bookmark icon on any message.`}
            </p>
          </div>
        ) : (
          <div className="space-y-2" data-testid="structured-items-grid">
            {data.map((item) => (
              <div
                key={item.id}
                data-testid={`structured-item-${item.id}`}
                className="rounded-xl border border-border/50 hover:border-border/70 bg-card/30 hover:bg-muted/10 transition-all p-3.5 group"
              >
                {/* Top row: type badge + source + date */}
                <div className="flex items-center gap-2 mb-2.5">
                  <span className={cn(
                    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border select-none shrink-0",
                    STRUCTURED_BADGE_STYLE[item.itemType]
                  )}>
                    <Bookmark className="w-2 h-2" />
                    {item.itemType.charAt(0).toUpperCase() + item.itemType.slice(1)}
                  </span>
                  <span className="text-[11px] text-muted-foreground/50 truncate flex-1 min-w-0">
                    {item.channelSlug
                      ? `#${displaySlug(item.channelSlug)}`
                      : item.objectType
                      ? `${item.objectType.charAt(0).toUpperCase() + item.objectType.slice(1)} Currents`
                      : "Currents"}
                    {item.threadRootId ? " · thread" : ""}
                  </span>
                  <span className="text-[11px] text-muted-foreground/40 shrink-0 tabular-nums">
                    {formatTs(item.createdAt)}
                  </span>
                </div>

                {/* Message preview */}
                {item.messageBody && (
                  <p className="text-[12.5px] text-foreground/80 leading-relaxed line-clamp-3 mb-2.5 whitespace-pre-wrap break-words">
                    {item.messageBody}
                  </p>
                )}

                {/* Notes */}
                {item.notes && (
                  <p className="text-[11.5px] text-muted-foreground/60 italic line-clamp-2 mb-2.5 border-t border-border/30 pt-2">
                    {item.notes}
                  </p>
                )}

                {/* Bottom row: author + marked by + View */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <div className={cn(
                      "w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0",
                      "text-[7px] font-bold text-white",
                      avatarBg(strHash(item.authorName ?? "?"))
                    )}>
                      {initials(item.authorName ?? "?")}
                    </div>
                    <span className="text-[11.5px] text-muted-foreground/70 truncate">
                      {item.authorName ?? "Unknown"}
                      {item.createdByName && item.createdByName !== item.authorName && (
                        <span className="text-[10.5px] text-muted-foreground/40"> · marked by {item.createdByName}</span>
                      )}
                    </span>
                  </div>
                  {item.actionUrl && (
                    <button
                      onClick={() => handleView(item)}
                      data-testid={`structured-view-btn-${item.id}`}
                      className="shrink-0 text-[11.5px] text-primary/40 hover:text-primary font-medium transition-colors group-hover:text-primary/70"
                    >
                      View →
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CurrentPage() {
  const queryClient = useQueryClient();
  const [selectedSlug, setSelectedSlug] = useState<string>("general");
  const [draft, setDraft] = useState("");
  const [mainPendingFiles, setMainPendingFiles] = useState<File[]>([]);
  const mainFileInputRef = useRef<HTMLInputElement | null>(null);
  const [isMainUploading, setIsMainUploading] = useState(false);
  const { toast } = useToast();
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [threadRootId, setThreadRootId] = useState<number | null>(null);
  const [view, setView] = useState<"channel" | "mentions" | "search" | "structured">("channel");
  const [highlightedMsgId, setHighlightedMsgId] = useState<number | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isAtBottom = useRef(true);
  const lastReadRef = useRef<number>(0);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mainMention = useComposerMentions(textareaRef);

  const [createTaskSource, setCreateTaskSource] = useState<CreateTaskSource | null>(null);

  function handleCreateTaskFromMsg(msg: Message, threadRootId?: number): void {
    setCreateTaskSource({
      kind: "channel_message",
      messageId: msg.id,
      body: msg.body,
      userName: msg.userName,
      createdAt: msg.createdAt,
      channelSlug: selectedSlug,
      threadRootId,
    });
  }

  // Channel AI summary
  const [channelSummaryOpen, setChannelSummaryOpen] = useState(false);
  const [channelSummaryData, setChannelSummaryData] = useState<CurrentSummaryData | null>(null);
  const channelSummaryMutation = useMutation({
    mutationFn: async (slug: string) => {
      const r = await apiRequest("POST", "/api/current/summary", { scope: "channel", channel: slug });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).message || "AI summary failed"); }
      return r.json() as Promise<CurrentSummaryData>;
    },
    onSuccess: (data) => { setChannelSummaryData(data); setChannelSummaryOpen(true); },
    onError: () => { setChannelSummaryOpen(true); setChannelSummaryData(null); },
  });

  // Helper: set a highlight with automatic 3s clear — cancels any pending timer
  function setHighlight(msgId: number | null) {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    setHighlightedMsgId(msgId);
    if (msgId !== null) {
      highlightTimerRef.current = setTimeout(() => setHighlightedMsgId(null), 3_000);
    }
  }

  // ── Session ──────────────────────────────────────────────────────────────
  const { data: me } = useQuery<Me>({ queryKey: ["/api/auth/me"] });
  const currentUserId = me?.id ?? 0;
  const isAdmin = ["admin", "master_admin"].includes(me?.globalRole ?? "");

  // ── Queries ───────────────────────────────────────────────────────────────
  // Declared before useEffects that reference messages/channels to avoid TDZ.

  const { data: channels = [], isLoading: channelsLoading } = useQuery<Channel[]>({
    queryKey: ["/api/current/channels"],
    refetchInterval: 15_000,
  });

  const {
    data: messages = [],
    isLoading: msgsLoading,
    isFetching: msgsFetching,
  } = useQuery<Message[]>({
    queryKey: ["/api/current/channels", selectedSlug, "messages"],
    queryFn: () =>
      fetch(`/api/current/channels/${selectedSlug}/messages`, {
        credentials: "include",
      }).then((r) => r.json()),
    refetchInterval: 5_000,
    enabled: !!selectedSlug,
    placeholderData: keepPreviousData,
  });

  const { data: pins = [] } = useQuery<PinnedMessage[]>({
    queryKey: ["/api/current/channels", selectedSlug, "pins"],
    queryFn: () =>
      fetch(`/api/current/channels/${selectedSlug}/pins`, {
        credentials: "include",
      }).then((r) => r.json()),
    refetchInterval: 30_000,
    enabled: !!selectedSlug,
  });

  const pinnedMessageIds = new Set(pins.map((p) => p.messageId));

  // ── Deep-link from notification action_url: ?channel=X&message=Y&thread=Z ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const chan = params.get("channel");
    const thread = params.get("thread");
    const msg = params.get("message");
    if (chan) { setSelectedSlug(chan); setView("channel"); }
    if (thread) setThreadRootId(Number(thread));
    if (msg) {
      const msgId = Number(msg);
      if (msgId > 0) setHighlight(msgId);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to highlighted message once messages are loaded
  useEffect(() => {
    if (!highlightedMsgId || messages.length === 0) return;
    requestAnimationFrame(() => {
      const el = document.querySelector(
        `[data-testid="message-row-${highlightedMsgId}"]`
      );
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [highlightedMsgId, messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scroll ────────────────────────────────────────────────────────────────

  function handleScroll() {
    if (!feedRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = feedRef.current;
    isAtBottom.current = scrollHeight - scrollTop - clientHeight < 80;
  }

  function scrollToBottom() {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }

  useEffect(() => {
    if (isAtBottom.current) scrollToBottom();
  }, [messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    isAtBottom.current = true;
    lastReadRef.current = 0;
    setEditingMessage(null);
    setThreadRootId(null); // close thread when switching channels
    mainMention.closeMention(); // close mention dropdown when switching channels
    scrollToBottom();
    // Clear stale channel AI summary when switching channels
    setChannelSummaryOpen(false);
    setChannelSummaryData(null);
  }, [selectedSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Read receipts ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!selectedSlug || messages.length === 0) return;
    const lastMsg = [...messages].reverse().find((m) => !m.deletedAt);
    if (!lastMsg) return;
    const lastId = lastMsg.id;
    if (lastId === lastReadRef.current) return;
    lastReadRef.current = lastId;
    fetch(`/api/current/channels/${selectedSlug}/read`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lastReadMessageId: lastId }),
    })
      .then(() =>
        queryClient.invalidateQueries({ queryKey: ["/api/current/channels"] })
      )
      .catch(() => {});
  }, [selectedSlug, messages.length, queryClient]);

  // ── Mutation helpers ──────────────────────────────────────────────────────

  const invalidateFeed = () => {
    queryClient.invalidateQueries({
      queryKey: ["/api/current/channels", selectedSlug, "messages"],
    });
    queryClient.invalidateQueries({ queryKey: ["/api/current/channels"] });
  };

  const invalidatePins = () => {
    queryClient.invalidateQueries({
      queryKey: ["/api/current/channels", selectedSlug, "pins"],
    });
  };

  // Post
  const postMutation = useMutation({
    mutationFn: (body: string) =>
      apiRequest("POST", `/api/current/channels/${selectedSlug}/messages`, { body })
        .then((r) => r.json()),
  });

  // Edit
  const editMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: string }) =>
      apiRequest("PATCH", `/api/current/messages/${id}`, { body }),
    onSuccess: () => {
      setEditingMessage(null);
      queryClient.invalidateQueries({
        queryKey: ["/api/current/channels", selectedSlug, "messages"],
      });
    },
  });

  // Delete
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/current/messages/${id}`),
    onSuccess: () => invalidateFeed(),
  });

  // React (toggle)
  const reactMutation = useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: number; emoji: string }) =>
      apiRequest("POST", `/api/current/messages/${messageId}/reactions`, {
        emoji,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["/api/current/channels", selectedSlug, "messages"],
      }),
  });

  // Pin
  const pinMutation = useMutation({
    mutationFn: (messageId: number) =>
      apiRequest("POST", `/api/current/messages/${messageId}/pin`),
    onSuccess: () => {
      invalidateFeed();
      invalidatePins();
    },
  });

  // Unpin
  const unpinMutation = useMutation({
    mutationFn: (messageId: number) =>
      apiRequest("DELETE", `/api/current/messages/${messageId}/pin`),
    onSuccess: () => {
      invalidateFeed();
      invalidatePins();
    },
  });

  // Mark as Decision / Risk / Requirement
  const markStructuredMutation = useMutation({
    mutationFn: ({ messageId, itemType, notes }: { messageId: number; itemType: string; notes?: string | null }) =>
      apiRequest("POST", `/api/current/messages/${messageId}/structured`, { itemType, notes }),
    onSuccess: () => {
      invalidateFeed();
      queryClient.invalidateQueries({ queryKey: ["/api/current/structured"] });
    },
  });

  function handleConfirmMark(mid: number, itemType: string, notes: string | null) {
    if (notes) {
      markStructuredMutation.mutate({ messageId: mid, itemType, notes });
    } else {
      markStructuredMutation.mutate({ messageId: mid, itemType });
    }
  }

  // Unmark structured
  const unmarkStructuredMutation = useMutation({
    mutationFn: ({ messageId, itemType }: { messageId: number; itemType: string }) =>
      apiRequest("DELETE", `/api/current/messages/${messageId}/structured/${itemType}`),
    onSuccess: () => {
      invalidateFeed();
      queryClient.invalidateQueries({ queryKey: ["/api/current/structured"] });
    },
  });

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleSend() {
    const trimmed = draft.trim();
    if (!trimmed || postMutation.isPending || isMainUploading) return;
    try {
      const newMsg = await postMutation.mutateAsync(trimmed);
      setDraft("");
      mainMention.closeMention();
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      isAtBottom.current = true;
      const files = [...mainPendingFiles];
      setMainPendingFiles([]);
      if (files.length > 0 && newMsg?.id) {
        setIsMainUploading(true);
        try {
          const result = await uploadCurrentAttachments(newMsg.id, files);
          if (result.failed.length > 0) {
            toast({
              title: "Some files failed to upload",
              description: result.failed.join(", "),
              variant: "destructive",
            });
          }
        } finally {
          setIsMainUploading(false);
        }
      }
      invalidateFeed();
    } catch {}
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mainMention.handleMentionKeyDown(e, draft, setDraft)) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleDraftChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setDraft(e.target.value);
    growTextarea(e.target);
    mainMention.onValueChange(
      e.target.value,
      e.target.selectionStart ?? e.target.value.length
    );
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const selectedChannel = channels.find((c) => c.slug === selectedSlug);
  const totalUnread = channels.reduce((s, c) => s + c.unreadCount, 0);
  const nonDeletedCount = messages.filter((m) => !m.deletedAt).length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden bg-background">

      {/* ── Channel sidebar ─────────────────────────────────────────────── */}
      <aside className="w-56 shrink-0 flex flex-col border-r border-border bg-sidebar/40 overflow-hidden">

        {/* Module header */}
        <div className="px-4 py-3.5 border-b border-border/60 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-primary/15 flex items-center justify-center shrink-0">
              <MessageSquare className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="font-semibold text-[13px] text-foreground tracking-tight">
              Currents
            </span>
            {totalUnread > 0 && (
              <span className="ml-auto min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold shrink-0">
                {totalUnread > 99 ? "99+" : totalUnread}
              </span>
            )}
          </div>
        </div>

        {/* Section label */}
        <div className="px-4 pt-3 pb-1 shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
            Currents
          </span>
        </div>

        {/* Channel list */}
        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-px">
          {channelsLoading ? (
            <ChannelSkeleton />
          ) : (
            channels.map((channel) => {
              const active = view === "channel" && selectedSlug === channel.slug;
              return (
                <button
                  key={channel.slug}
                  data-testid={`channel-item-${channel.slug}`}
                  onClick={() => { setSelectedSlug(channel.slug); setView("channel"); }}
                  className={cn(
                    "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px]",
                    "transition-all duration-100 group",
                    active
                      ? "bg-primary/15 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  )}
                >
                  <Hash
                    className={cn(
                      "w-3.5 h-3.5 shrink-0 transition-opacity",
                      active
                        ? "opacity-80"
                        : "opacity-40 group-hover:opacity-60"
                    )}
                  />
                  <span className="flex-1 truncate text-left min-w-0">
                    {displaySlug(channel.slug)}
                  </span>
                  {channel.unreadCount > 0 && (
                    <span
                      className={cn(
                        "min-w-[18px] h-[18px] px-1 flex items-center justify-center",
                        "rounded-full text-[10px] font-bold shrink-0",
                        active
                          ? "bg-primary/20 text-primary"
                          : "bg-primary text-primary-foreground"
                      )}
                    >
                      {channel.unreadCount > 99 ? "99+" : channel.unreadCount}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Search + Mentions entry */}
        <div className="px-2 pb-3 shrink-0 border-t border-border/40 pt-2 space-y-px">
          <button
            onClick={() => setView("search")}
            data-testid="sidebar-search"
            className={cn(
              "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px]",
              "transition-all duration-100 group",
              view === "search"
                ? "bg-primary/15 text-primary font-medium"
                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            )}
          >
            <Search
              className={cn(
                "w-3.5 h-3.5 shrink-0 transition-opacity",
                view === "search"
                  ? "opacity-80"
                  : "opacity-40 group-hover:opacity-60"
              )}
            />
            <span className="flex-1 text-left">Search</span>
          </button>
          <button
            onClick={() => setView("mentions")}
            data-testid="sidebar-mentions"
            className={cn(
              "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px]",
              "transition-all duration-100 group",
              view === "mentions"
                ? "bg-primary/15 text-primary font-medium"
                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            )}
          >
            <AtSign
              className={cn(
                "w-3.5 h-3.5 shrink-0 transition-opacity",
                view === "mentions"
                  ? "opacity-80"
                  : "opacity-40 group-hover:opacity-60"
              )}
            />
            <span className="flex-1 text-left">Mentions</span>
          </button>
          <button
            onClick={() => setView("structured")}
            data-testid="sidebar-structured"
            className={cn(
              "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px]",
              "transition-all duration-100 group",
              view === "structured"
                ? "bg-primary/15 text-primary font-medium"
                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            )}
          >
            <Bookmark
              className={cn(
                "w-3.5 h-3.5 shrink-0 transition-opacity",
                view === "structured"
                  ? "opacity-80"
                  : "opacity-40 group-hover:opacity-60"
              )}
            />
            <span className="flex-1 text-left">Structured</span>
          </button>
        </div>
      </aside>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Header — adapts for channel vs. mentions view */}
        <div className="px-5 py-3 border-b border-border/60 flex items-center gap-2.5 shrink-0 min-w-0">
          {view === "mentions" ? (
            <>
              <AtSign className="w-4 h-4 text-muted-foreground/60 shrink-0" />
              <span className="font-semibold text-[14px] text-foreground shrink-0">
                Mentions
              </span>
            </>
          ) : view === "search" ? (
            <>
              <Search className="w-4 h-4 text-muted-foreground/60 shrink-0" />
              <span className="font-semibold text-[14px] text-foreground shrink-0">
                Search
              </span>
            </>
          ) : view === "structured" ? (
            <>
              <Bookmark className="w-4 h-4 text-muted-foreground/60 shrink-0" />
              <span className="font-semibold text-[14px] text-foreground shrink-0">
                Structured Items
              </span>
            </>
          ) : (
            <>
              <Hash className="w-4 h-4 text-muted-foreground/60 shrink-0" />
              <span className="font-semibold text-[14px] text-foreground shrink-0">
                {displaySlug(selectedSlug)}
              </span>
              {selectedChannel?.description && (
                <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                  <div className="w-px h-4 bg-border/60 shrink-0" />
                  <span className="text-[12.5px] text-muted-foreground truncate">
                    {selectedChannel.description}
                  </span>
                </div>
              )}
              <button
                onClick={() => {
                  if (channelSummaryOpen) {
                    setChannelSummaryOpen(false);
                  } else {
                    setChannelSummaryData(null);
                    channelSummaryMutation.mutate(selectedSlug);
                  }
                }}
                disabled={channelSummaryMutation.isPending}
                title="Summarize channel"
                data-testid="btn-summarize-channel"
                className={cn(
                  "ml-auto shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-md text-[11.5px] font-medium transition-colors",
                  channelSummaryOpen
                    ? "bg-primary/10 text-primary/80 hover:bg-primary/15"
                    : "text-muted-foreground/50 hover:text-foreground hover:bg-muted/60",
                )}
              >
                {channelSummaryMutation.isPending
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <Sparkles className="w-3 h-3" />}
                <span className="hidden sm:inline">Summarize</span>
              </button>
              {msgsFetching && !msgsLoading && (
                <div className="shrink-0 w-1.5 h-1.5 rounded-full bg-primary/30 animate-pulse" />
              )}
            </>
          )}
        </div>

        {view === "mentions" ? (
          /* ── Mentions view ──────────────────────────────────────────── */
          <MentionsPanel
            currentUserId={currentUserId}
            onNavigate={(slug, messageId, threadId) => {
              setSelectedSlug(slug);
              setView("channel");
              setThreadRootId(threadId ?? null);
              // Highlight the root message (visible in main list) when
              // navigating to a reply; the reply itself is only in the thread panel.
              setHighlight(threadId ?? messageId);
            }}
          />
        ) : view === "search" ? (
          /* ── Search view ────────────────────────────────────────────── */
          <SearchPanel
            onNavigate={(slug, messageId, threadId) => {
              setSelectedSlug(slug);
              setView("channel");
              setThreadRootId(threadId ?? null);
              // Highlight the root message (visible in main list) when
              // navigating to a reply; the reply itself is only in the thread panel.
              setHighlight(threadId ?? messageId);
            }}
          />
        ) : view === "structured" ? (
          /* ── Structured Items view ───────────────────────────────────── */
          <StructuredItemsPanel
            selectedSlug={selectedSlug}
            onChannelNavigate={(slug, messageId, threadId) => {
              setSelectedSlug(slug);
              setView("channel");
              setThreadRootId(threadId ?? null);
              setHighlight(threadId ?? messageId);
            }}
          />
        ) : (
          /* ── Channel view ───────────────────────────────────────────── */
          <>
            {/* AI Summary panel */}
            {channelSummaryOpen && (
              <div className="px-4 pt-3 pb-0 shrink-0">
                <CurrentSummaryPanel
                  data={channelSummaryData}
                  isLoading={channelSummaryMutation.isPending}
                  isError={channelSummaryMutation.isError}
                  onClose={() => setChannelSummaryOpen(false)}
                  onRegenerate={() => { setChannelSummaryData(null); channelSummaryMutation.mutate(selectedSlug); }}
                  onCreateTask={(item) => setCreateTaskSource({ kind: "summary_action_item", task: item.task, owner: item.owner, due: item.due, summaryContext: `Channel: #${selectedSlug}`, channelSlug: selectedSlug })}
                />
              </div>
            )}

            {/* Pinned bar */}
            <PinnedBar pins={pins} onUnpin={(mid) => unpinMutation.mutate(mid)} />

            {/* Message feed */}
            <div
              ref={feedRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto px-5 py-4"
              data-testid="message-feed"
            >
              {msgsLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-5 h-5 text-muted-foreground/40 animate-spin" />
                </div>
              ) : nonDeletedCount === 0 && messages.length === 0 ? (
                <EmptyFeed slug={selectedSlug} />
              ) : (
                <>
                  {messages.map((msg, i) => {
                    const isHighlighted = msg.id === highlightedMsgId;
                    if (editingMessage?.id === msg.id) {
                      return (
                        <InlineEditRow
                          key={msg.id}
                          message={msg}
                          onSave={(newBody) =>
                            editMutation.mutate({ id: msg.id, body: newBody })
                          }
                          onCancel={() => setEditingMessage(null)}
                        />
                      );
                    }
                    return (
                      <div
                        key={msg.id}
                        className={cn(
                          isHighlighted &&
                            "rounded-lg ring-1 ring-primary/30 bg-primary/[0.04] transition-all"
                        )}
                      >
                        <MessageRow
                          message={msg}
                          grouped={
                            !isHighlighted &&
                            isContinuation(messages[i - 1], msg)
                          }
                          currentUserId={currentUserId}
                          isAdmin={isAdmin}
                          pinnedMessageIds={pinnedMessageIds}
                          onToggleReaction={(mid, emoji) =>
                            reactMutation.mutate({ messageId: mid, emoji })
                          }
                          onEdit={(m) => setEditingMessage(m)}
                          onDelete={(id) => deleteMutation.mutate(id)}
                          onPin={(id, isPinned) =>
                            isPinned
                              ? unpinMutation.mutate(id)
                              : pinMutation.mutate(id)
                          }
                          onOpenThread={() => setThreadRootId(msg.id)}
                          onCreateTask={(m) => handleCreateTaskFromMsg(m)}
                          onMarkStructured={(mid, itemType) =>
                            markStructuredMutation.mutate({ messageId: mid, itemType })
                          }
                          onUnmarkStructured={(mid, itemType) =>
                            unmarkStructuredMutation.mutate({ messageId: mid, itemType })
                          }
                          onMarkWithNote={(mid, itemType, notes) =>
                            handleConfirmMark(mid, itemType, notes)
                          }
                        />
                      </div>
                    );
                  })}
                  <div className="h-2" />
                </>
              )}
            </div>

            {/* Composer */}
            <div className="px-5 pt-3 pb-4 border-t border-border/60 shrink-0">
              {mainMention.mentionActive && mainMention.mentionAnchorRect && (
                <MentionDropdown
                  users={mainMention.mentionUsers}
                  isLoading={mainMention.mentionLoading}
                  anchorRect={mainMention.mentionAnchorRect}
                  activeIdx={mainMention.mentionIdx}
                  onSelect={(u) => mainMention.insertMention(draft, setDraft, u)}
                  onHover={mainMention.setMentionIdx}
                />
              )}
              {mainPendingFiles.length > 0 && (
                <div className="mb-2">
                  <PendingFileChips
                    files={mainPendingFiles}
                    onRemove={(i) =>
                      setMainPendingFiles((prev) => prev.filter((_, idx) => idx !== i))
                    }
                  />
                </div>
              )}
              <div
                className={cn(
                  "flex items-end gap-2 rounded-xl px-3.5 py-2.5 transition-all duration-150",
                  "bg-muted/30 border border-border/60",
                  "focus-within:border-primary/40 focus-within:bg-background",
                  "focus-within:shadow-[0_0_0_3px_hsl(var(--primary)/0.07)]"
                )}
              >
                <Textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={handleDraftChange}
                  onKeyDown={handleKeyDown}
                  placeholder={`Message #${displaySlug(selectedSlug)} (@ to mention)`}
                  className={cn(
                    "flex-1 border-0 bg-transparent shadow-none resize-none p-0",
                    "text-[13.5px] placeholder:text-muted-foreground/40 leading-relaxed",
                    "focus-visible:ring-0 focus-visible:ring-offset-0",
                    "min-h-[22px] max-h-36 overflow-y-auto"
                  )}
                  rows={1}
                  data-testid="composer-input"
                />
                <button
                  type="button"
                  onClick={() => mainFileInputRef.current?.click()}
                  title="Attach file"
                  className="shrink-0 h-8 w-8 p-0 rounded-lg flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted/40 transition-colors"
                  data-testid="btn-attach-channel"
                >
                  <Paperclip className="w-3.5 h-3.5" />
                </button>
                <input
                  ref={mainFileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length > 0)
                      setMainPendingFiles((prev) => [...prev, ...files]);
                    e.target.value = "";
                  }}
                  data-testid="channel-file-input"
                />
                <Button
                  size="sm"
                  onClick={handleSend}
                  disabled={!draft.trim() || postMutation.isPending || isMainUploading}
                  className="shrink-0 h-8 w-8 p-0 rounded-lg transition-all"
                  data-testid="btn-send-message"
                >
                  {(postMutation.isPending || isMainUploading) ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                </Button>
              </div>
              <p className="text-[10.5px] text-muted-foreground/35 mt-1.5 px-0.5 select-none">
                Enter to send · Shift+Enter for new line · @ to mention · 📎 to attach
              </p>
            </div>
          </>
        )}
      </div>

      <CreateTaskFromCurrentDialog
        open={createTaskSource !== null}
        source={createTaskSource}
        onClose={() => setCreateTaskSource(null)}
      />

      {/* ── Thread panel ────────────────────────────────────────────────── */}
      {threadRootId !== null && (
        <ThreadPanel
          rootMessageId={threadRootId}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          selectedSlug={selectedSlug}
          onClose={() => setThreadRootId(null)}
          onCreateTaskMsg={handleCreateTaskFromMsg}
          onCreateSummaryTask={(item) => setCreateTaskSource({ kind: "summary_action_item", task: item.task, owner: item.owner, due: item.due, summaryContext: `Thread in #${selectedSlug}`, channelSlug: selectedSlug, threadRootId: threadRootId ?? undefined })}
        />
      )}
    </div>
  );
}
