import { useState, useEffect, useRef, useMemo } from "react";
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
  Download,
  UserRound,
  Plus,
  Users,
  Settings,
  Archive,
  Bell,
  BellOff,
  BellRing,
  Check,
  UserPlus,
  LogOut,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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

interface DmMember {
  id: number;
  name: string;
  email: string;
  avatarUrl: string | null;
}

interface DmConversation {
  conversationId: number;
  type: 'dm' | 'group_dm';
  displayName: string;
  otherUser: DmMember | null;
  members: DmMember[];
  isArchived: boolean;
  isMuted: boolean;
  unreadCount: number;
  lastMessage: {
    id: number;
    body: string | null;
    userName: string;
    createdAt: string;
  } | null;
  lastMessageAt: string | null;
}

interface DmMessage {
  id: number;
  conversationId: number;
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

interface Channel {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  isPrivate: boolean;
  unreadCount: number;
  archivedAt?: string | null;
  notificationLevel?: 'all' | 'mentions' | 'muted';
}

interface ChannelInfo {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  isPrivate: boolean;
  createdAt: string;
  archivedAt: string | null;
  archivedBy: number | null;
  updatedAt: string | null;
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
  isChannelArchived?: boolean;
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
  isChannelArchived?: boolean;
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

// ── ArchivedBadge ─────────────────────────────────────────────────────────────
function ArchivedBadge() {
  return (
    <span
      data-testid="archived-badge"
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9.5px] font-semibold border select-none shrink-0 bg-amber-500/10 text-amber-400/80 border-amber-500/20"
    >
      Archived
    </span>
  );
}

function normalizeChannelSlug(name: string): string {
  return name.toLowerCase().trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
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
  isArchived,
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
  hasBody?: boolean;
  isArchived?: boolean;
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
  if (isArchived) return null;
  const canEdit = isOwn && (hasBody !== false);
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
  isArchived,
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
  isArchived?: boolean;
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
        hasBody={!!message.body}
        isArchived={isArchived}
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
        {message.body && (
          <p className="text-[13.5px] text-foreground/90 leading-relaxed whitespace-pre-wrap break-words">
            {renderMentionBody(message.body, currentUserId)}
          </p>
        )}
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
  isArchived,
  selectedSlug,
  onClose,
  onCreateTaskMsg,
  onCreateSummaryTask,
}: {
  rootMessageId: number;
  currentUserId: number;
  isAdmin: boolean;
  isArchived?: boolean;
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
  // Phase 12A: thread typing ping throttle
  const threadTypingPingRef = useRef(0);
  const { data: threadTypingData } = useQuery<{ typers: { userId: number; name: string }[]; count: number }>({
    queryKey: ["/api/current/typing", "thread", rootMessageId],
    queryFn: () =>
      fetch(`/api/current/typing?scope=thread&rootMessageId=${rootMessageId}`, { credentials: "include" }).then((r) => r.json()),
    refetchInterval: 3_000,
    staleTime: 0,
    refetchOnWindowFocus: false,
    enabled: !!rootMessageId && !isArchived,
  });

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
              isArchived={isArchived}
              pinnedMessageIds={emptyPinnedSet}
              onToggleReaction={(mid, emoji) =>
                reactReplyMutation.mutate({ messageId: mid, emoji })
              }
              onEdit={(m) => setEditingReply(m)}
              onDelete={(id) => deleteReplyMutation.mutate(id)}
              onPin={(id, isPinned) => pinReplyMutation.mutate({ id, isPinned })}
              onCreateTask={onCreateTaskMsg ? () => onCreateTaskMsg(root, undefined) : undefined}
              onMarkStructured={(mid, itemType) =>
                apiRequest("POST", `/api/current/messages/${mid}/structured`, { itemType }).then(() => { invalidateThread(); invalidateFeed(); queryClient.invalidateQueries({ queryKey: ["/api/current/structured"] }); })
              }
              onUnmarkStructured={(mid, itemType) =>
                apiRequest("DELETE", `/api/current/messages/${mid}/structured/${itemType}`).then(() => { invalidateThread(); invalidateFeed(); queryClient.invalidateQueries({ queryKey: ["/api/current/structured"] }); })
              }
              onMarkWithNote={(mid, itemType, notes) =>
                apiRequest("POST", `/api/current/messages/${mid}/structured`, { itemType, notes }).then(() => { invalidateThread(); invalidateFeed(); queryClient.invalidateQueries({ queryKey: ["/api/current/structured"] }); })
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
              isArchived={isArchived}
              pinnedMessageIds={emptyPinnedSet}
              onToggleReaction={(mid, emoji) =>
                reactReplyMutation.mutate({ messageId: mid, emoji })
              }
              onEdit={(m) => setEditingReply(m)}
              onDelete={(id) => deleteReplyMutation.mutate(id)}
              onPin={(id, isPinned) => pinReplyMutation.mutate({ id, isPinned })}
              onCreateTask={onCreateTaskMsg ? () => onCreateTaskMsg(reply, rootMessageId) : undefined}
              onMarkStructured={(mid, itemType) =>
                apiRequest("POST", `/api/current/messages/${mid}/structured`, { itemType }).then(() => { invalidateThread(); invalidateFeed(); queryClient.invalidateQueries({ queryKey: ["/api/current/structured"] }); })
              }
              onUnmarkStructured={(mid, itemType) =>
                apiRequest("DELETE", `/api/current/messages/${mid}/structured/${itemType}`).then(() => { invalidateThread(); invalidateFeed(); queryClient.invalidateQueries({ queryKey: ["/api/current/structured"] }); })
              }
              onMarkWithNote={(mid, itemType, notes) =>
                apiRequest("POST", `/api/current/messages/${mid}/structured`, { itemType, notes }).then(() => { invalidateThread(); invalidateFeed(); queryClient.invalidateQueries({ queryKey: ["/api/current/structured"] }); })
              }
            />
          );
        })}
        <div className="h-2" />
      </div>

      {/* Reply composer — hidden when root is deleted or channel is archived */}
      <div className="px-4 pt-2 pb-4 border-t border-border/60 shrink-0">
        {isArchived ? (
          <p className="text-[12px] text-muted-foreground/50 italic text-center py-1 select-none" data-testid="thread-archived-notice">
            This channel is archived — replies are disabled.
          </p>
        ) : root?.deletedAt ? (
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
            {/* Phase 12A: thread typing indicator */}
            <TypingIndicator typers={threadTypingData?.typers ?? []} count={threadTypingData?.count ?? 0} />
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
                  // Phase 12A: thread typing ping, throttled
                  if (e.target.value.trim() && !isArchived) {
                    const now = Date.now();
                    if (now - threadTypingPingRef.current > 2_500) {
                      threadTypingPingRef.current = now;
                      fetch("/api/current/typing", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        credentials: "include",
                        body: JSON.stringify({ scope: "thread", rootMessageId }),
                      }).catch(() => {});
                    }
                  }
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
        {result.isChannelArchived && <ArchivedBadge />}
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

// ── NewDmDialog ───────────────────────────────────────────────────────────────
// Phase 11A: multi-select chip UI — 1 user → 1:1 DM, 2+ users → group DM

function NewDmDialog({
  open,
  onOpenChange,
  onConfirm,
  isPending = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (userIds: number[]) => void;
  isPending?: boolean;
}) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<MentionUser[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!open) { setQ(""); setDebouncedQ(""); setSelectedUsers([]); }
  }, [open]);

  const { data: users = [], isLoading } = useQuery<MentionUser[]>({
    queryKey: ["/api/current/users", debouncedQ],
    queryFn: () =>
      fetch(`/api/current/users?q=${encodeURIComponent(debouncedQ)}`, {
        credentials: "include",
      }).then((r) => r.json()),
    staleTime: 10_000,
    enabled: open,
  });

  const selectedIds = new Set(selectedUsers.map((u) => u.id));

  function toggleUser(user: MentionUser) {
    setSelectedUsers((prev) =>
      prev.some((u) => u.id === user.id)
        ? prev.filter((u) => u.id !== user.id)
        : [...prev, user]
    );
  }

  function handleConfirm() {
    if (!selectedUsers.length || isPending) return;
    onConfirm(selectedUsers.map((u) => u.id));
  }

  const isGroup = selectedUsers.length >= 2;
  const canConfirm = selectedUsers.length >= 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            {isGroup
              ? <Users className="w-4 h-4 text-primary/70" />
              : <UserRound className="w-4 h-4 text-primary/70" />
            }
            {isGroup ? "New Group Message" : "New Direct Message"}
          </DialogTitle>
        </DialogHeader>
        <div className="py-1 space-y-3">
          {/* Selected chips */}
          {selectedUsers.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pb-1">
              {selectedUsers.map((u) => (
                <span
                  key={u.id}
                  data-testid={`dm-selected-chip-${u.id}`}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium",
                    "bg-primary/15 text-primary border border-primary/20"
                  )}
                >
                  {u.name.split(" ")[0]}
                  <button
                    onClick={() => toggleUser(u)}
                    className="ml-0.5 rounded-full hover:bg-primary/20 p-px transition-colors"
                    aria-label={`Remove ${u.name}`}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
            <Input
              placeholder={selectedUsers.length ? "Add more teammates…" : "Search teammates…"}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-8 text-sm h-8"
              autoFocus
              data-testid="dm-user-search-input"
            />
          </div>

          {/* Results */}
          <div className="space-y-0.5 max-h-44 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-5 text-muted-foreground/40">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            ) : users.length === 0 ? (
              <div className="text-center py-5 text-[12px] text-muted-foreground/60">
                {debouncedQ ? "No teammates found" : "Start typing to search teammates"}
              </div>
            ) : (
              users.map((user) => {
                const selected = selectedIds.has(user.id);
                return (
                  <button
                    key={user.id}
                    data-testid={`dm-user-option-${user.id}`}
                    onClick={() => toggleUser(user)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors",
                      selected ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-muted/50"
                    )}
                  >
                    <div
                      className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                        "text-[11px] font-bold text-white",
                        avatarBg(user.id)
                      )}
                    >
                      {initials(user.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-foreground truncate">
                        {user.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {user.email}
                      </div>
                    </div>
                    {selected && (
                      <div className="shrink-0 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                        <Check className="w-2.5 h-2.5 text-primary-foreground" />
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Start conversation button */}
          <button
            data-testid="btn-dm-start-conversation"
            onClick={handleConfirm}
            className={cn(
              "w-full py-1.5 rounded-lg text-[13px] font-medium transition-colors flex items-center justify-center gap-1.5",
              canConfirm && !isPending
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted/40 text-muted-foreground/40 cursor-not-allowed"
            )}
            disabled={!canConfirm || isPending}
          >
            {isPending ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Starting…</>
            ) : isGroup
              ? `Start group message (${selectedUsers.length + 1} people)`
              : "Start conversation"
            }
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── GroupMemberDialog ─────────────────────────────────────────────────────────
// Phase 11B: view members, add members, leave group DM

function GroupMemberDialog({
  open,
  onOpenChange,
  conversation,
  currentUserId,
  onAddMembers,
  onLeave,
  isAddPending = false,
  isLeavePending = false,
  presenceMap = {},
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  conversation: DmConversation | null;
  currentUserId: number;
  onAddMembers: (userIds: number[]) => void;
  onLeave: () => void;
  isAddPending?: boolean;
  isLeavePending?: boolean;
  presenceMap?: Record<number, "online" | "offline">;
}) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [selectedNew, setSelectedNew] = useState<MentionUser[]>([]);
  const [confirmLeave, setConfirmLeave] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!open) { setQ(""); setDebouncedQ(""); setSelectedNew([]); setConfirmLeave(false); }
  }, [open]);

  const existingMemberIds = new Set([
    currentUserId,
    ...(conversation?.members.map((m) => m.id) ?? []),
  ]);

  const { data: searchUsers = [], isLoading: searchLoading } = useQuery<MentionUser[]>({
    queryKey: ["/api/current/users", debouncedQ],
    queryFn: () =>
      fetch(`/api/current/users?q=${encodeURIComponent(debouncedQ)}`, { credentials: "include" }).then((r) => r.json()),
    staleTime: 10_000,
    enabled: open && !confirmLeave,
  });

  const filteredUsers = searchUsers.filter((u) => !existingMemberIds.has(u.id));
  const selectedIds = new Set(selectedNew.map((u) => u.id));

  function toggleNew(user: MentionUser) {
    setSelectedNew((prev) =>
      prev.some((u) => u.id === user.id)
        ? prev.filter((u) => u.id !== user.id)
        : [...prev, user]
    );
  }

  const totalCount = 1 + (conversation?.members.length ?? 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm w-full p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-3 border-b border-border/30">
          <DialogTitle className="text-[14px] font-semibold flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground/60" />
            {conversation?.displayName ?? "Group"} · {totalCount} member{totalCount !== 1 ? "s" : ""}
          </DialogTitle>
        </DialogHeader>

        {confirmLeave ? (
          <div className="px-4 py-5 flex flex-col gap-3">
            <p className="text-[13px] text-foreground/80">
              Leave <span className="font-medium">{conversation?.displayName}</span>? You won't be able to send or receive messages in this group.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmLeave(false)}
                className="flex-1 py-1.5 rounded-lg text-[13px] border border-border/50 hover:bg-muted/50 transition-colors"
              >
                Cancel
              </button>
              <button
                data-testid="btn-leave-confirm"
                onClick={onLeave}
                disabled={isLeavePending}
                className="flex-1 py-1.5 rounded-lg text-[13px] font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
              >
                {isLeavePending
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Leaving…</>
                  : "Leave conversation"
                }
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col max-h-[72vh] overflow-hidden">
            {/* ── Current members ── */}
            <div className="px-3 pt-3 pb-2 overflow-y-auto max-h-44 flex flex-col gap-0.5">
              {/* Current user first */}
              <div className="flex items-center gap-2 px-1 py-1.5 rounded-md">
                <div className="relative shrink-0">
                  <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white", avatarBg(currentUserId))}>
                    {initials("You")}
                  </div>
                  <PresenceDot status="online" className="absolute -bottom-px -right-px w-2 h-2" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-medium leading-tight">You</div>
                  <div className="text-[11px] text-emerald-500/80">Online</div>
                </div>
              </div>
              {(conversation?.members ?? []).map((m) => (
                <div key={m.id} className="flex items-center gap-2 px-1 py-1.5 rounded-md hover:bg-muted/30">
                  <div className="relative shrink-0">
                    <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white", avatarBg(m.id))}>
                      {initials(m.name)}
                    </div>
                    <PresenceDot status={presenceMap[m.id] ?? "offline"} className="absolute -bottom-px -right-px w-2 h-2" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-medium leading-tight truncate">{m.name}</div>
                    <div className="text-[11px] text-muted-foreground/50 truncate">
                      {m.email}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-border/30 mx-3" />

            {/* ── Add people ── */}
            <div className="px-3 pt-3 pb-2 flex flex-col gap-2">
              <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wide px-1">Add people</p>

              {selectedNew.length > 0 && (
                <div className="flex flex-wrap gap-1 px-1">
                  {selectedNew.map((u) => (
                    <span key={u.id} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 text-primary text-[12px] font-medium">
                      {u.name.split(" ")[0]}
                      <button onClick={() => toggleNew(u)} className="hover:opacity-70"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
              )}

              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search teammates…"
                data-testid="input-add-member-search"
                className="w-full px-3 py-1.5 rounded-lg text-[13px] bg-muted/40 border border-border/30 focus:outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground/40"
              />

              <div className="overflow-y-auto max-h-32">
                {searchLoading ? (
                  <div className="flex items-center justify-center py-3">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/40" />
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground/40 text-center py-2">
                    {debouncedQ ? "No results" : "Search to add teammates"}
                  </p>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {filteredUsers.slice(0, 8).map((user) => (
                      <button
                        key={user.id}
                        onClick={() => toggleNew(user)}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/40 transition-colors w-full text-left"
                      >
                        <div className={cn("w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[9px] font-bold text-white", avatarBg(user.id))}>
                          {initials(user.name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12.5px] font-medium truncate">{user.name}</div>
                          <div className="text-[11px] text-muted-foreground/50 truncate">{user.email}</div>
                        </div>
                        {selectedIds.has(user.id) && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                data-testid="btn-add-members"
                onClick={() => { if (selectedNew.length) onAddMembers(selectedNew.map((u) => u.id)); }}
                disabled={!selectedNew.length || isAddPending}
                className={cn(
                  "w-full py-1.5 rounded-lg text-[13px] font-medium transition-colors flex items-center justify-center gap-1.5",
                  selectedNew.length && !isAddPending
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-muted/40 text-muted-foreground/40 cursor-not-allowed"
                )}
              >
                {isAddPending
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Adding…</>
                  : selectedNew.length
                    ? `Add ${selectedNew.length} person${selectedNew.length > 1 ? "s" : ""}`
                    : "Select people to add"
                }
              </button>
            </div>

            <div className="border-t border-border/30 mx-3" />

            {/* ── Leave ── */}
            <div className="px-3 py-2.5">
              <button
                data-testid="btn-leave-group-dm"
                onClick={() => setConfirmLeave(true)}
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-[12.5px] text-destructive/70 hover:bg-destructive/10 hover:text-destructive transition-colors"
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" />
                Leave conversation
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── ChannelParticipantsDialog ────────────────────────────────────────────────
// Phase 12C: shows channel participants with online presence indicators.

interface ChannelParticipant {
  id: number;
  name: string;
  email: string;
}

function ChannelParticipantsDialog({
  open,
  onOpenChange,
  channelSlug,
  participants,
  currentUserId,
  isArchived = false,
  presenceMap = {},
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  channelSlug: string;
  participants: ChannelParticipant[];
  currentUserId: number;
  isArchived?: boolean;
  presenceMap?: Record<number, "online" | "offline">;
}) {
  const sorted = useMemo(() => {
    const you = participants.filter((p) => p.id === currentUserId);
    const others = participants.filter((p) => p.id !== currentUserId);
    const online = others
      .filter((p) => presenceMap[p.id] === "online")
      .sort((a, b) => a.name.localeCompare(b.name));
    const offline = others
      .filter((p) => presenceMap[p.id] !== "online")
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...you, ...online, ...offline];
  }, [participants, currentUserId, presenceMap]);

  function initials(name: string) {
    return name
      .split(" ")
      .map((w) => w[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm w-full p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-3 border-b border-border/30">
          <DialogTitle className="text-[14px] font-semibold flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground/60" />
            <span className="truncate">
              #{displaySlug(channelSlug)} · {participants.length}{" "}
              {participants.length === 1 ? "person" : "people"}
            </span>
            {isArchived && (
              <span className="ml-auto shrink-0 text-[11px] font-normal text-muted-foreground/60 bg-muted/40 px-1.5 py-0.5 rounded">
                Archived
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto max-h-[360px] py-1">
          {sorted.length === 0 ? (
            <p
              className="px-4 py-6 text-center text-[13px] text-muted-foreground/50"
              data-testid="channel-participants-empty"
            >
              No channel participants yet
            </p>
          ) : (
            sorted.map((p) => {
              const isYou = p.id === currentUserId;
              const status = isYou ? "online" : (presenceMap[p.id] ?? "offline");
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3 px-4 py-2 hover:bg-muted/30 transition-colors"
                  data-testid={`channel-participant-row-${p.id}`}
                >
                  <div className="relative shrink-0">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-[11px] font-semibold text-primary/80">
                      {initials(p.name)}
                    </div>
                    <PresenceDot
                      status={status}
                      className="absolute -bottom-px -right-px w-2 h-2"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-medium text-foreground truncate">
                        {p.name}
                      </span>
                      {isYou && (
                        <span className="text-[10.5px] text-muted-foreground/50 shrink-0">
                          You
                        </span>
                      )}
                    </div>
                    <div className="text-[11.5px] text-muted-foreground/60 truncate">
                      {p.email}
                    </div>
                  </div>
                  <div className="shrink-0 text-[11px]">
                    {status === "online" ? (
                      <span className="text-emerald-500/80">Online</span>
                    ) : (
                      <span className="text-muted-foreground/40">Offline</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── PresenceDot ──────────────────────────────────────────────────────────────
// Phase 12B: small green dot indicating a user is online.
function PresenceDot({
  status,
  className,
}: {
  status: "online" | "offline";
  className?: string;
}) {
  if (status !== "online") return null;
  return (
    <span
      className={cn("block rounded-full bg-emerald-500 ring-[1.5px] ring-background shrink-0", className)}
      aria-label="Online"
      data-testid="presence-dot"
    />
  );
}

// ── TypingIndicator ──────────────────────────────────────────────────────────
// Phase 12A: displays who is typing in a channel, DM, or thread.

function TypingIndicator({
  typers,
  count,
}: {
  typers: { userId: number; name: string }[];
  count: number;
}) {
  // Always reserve h-5 space so the composer does not jump when a typer appears.
  const firstName = (n: string) => n.split(" ")[0];
  let label = "";
  if (count === 1) label = `${firstName(typers[0]?.name ?? "")} is typing`;
  else if (count === 2) label = `${firstName(typers[0]?.name ?? "")} and ${firstName(typers[1]?.name ?? "")} are typing`;
  else if (count > 2) label = `${firstName(typers[0]?.name ?? "")} and ${count - 1} other${count - 1 > 1 ? "s" : ""} are typing`;

  return (
    <div
      className="h-5 flex items-center gap-1.5 px-1 shrink-0 select-none"
      aria-live="polite"
      data-testid="typing-indicator"
    >
      {count > 0 && (
        <>
          <span className="text-[11px] text-muted-foreground/55 italic leading-none">{label}</span>
          <span className="flex gap-[3px] items-end pb-0.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-[3px] h-[3px] rounded-full bg-muted-foreground/40 animate-bounce"
                style={{ animationDelay: `${i * 160}ms`, animationDuration: "0.9s" }}
              />
            ))}
          </span>
        </>
      )}
    </div>
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
            {m.isChannelArchived && <ArchivedBadge />}
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
  isChannelArchived: boolean;
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

// ── CSV export helpers ────────────────────────────────────────────────────────

function csvEscapeField(val: unknown): string {
  const raw = val == null ? "" : String(val);
  let s = raw;
  if (s.length > 0 && "=+-@\t".includes(s[0])) s = "'" + s;
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function downloadCsv(rows: unknown[][], filename: string) {
  const csv = rows.map(r => r.map(csvEscapeField).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

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
  const [includeArchived, setIncludeArchived] = useState(false);

  const params = new URLSearchParams({ scope: scope === "channel" ? "channel" : "all", limit: "200" });
  if (scope === "channel") {
    params.set("channel", selectedSlug);
  }

  const { data = [], isLoading, isError } = useQuery<StructuredListItem[]>({
    queryKey: ["/api/current/structured", scope, selectedSlug],
    queryFn: () =>
      fetch(`/api/current/structured?${params}`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 30_000,
  });

  // Apply archived filter: hide items from archived channels unless toggle is on
  const visibleData = includeArchived ? data : data.filter(i => !i.isChannelArchived);

  const counts = {
    all: visibleData.length,
    decision: visibleData.filter(i => i.itemType === "decision").length,
    risk: visibleData.filter(i => i.itemType === "risk").length,
    requirement: visibleData.filter(i => i.itemType === "requirement").length,
  };
  const displayed = filter === "all" ? visibleData : visibleData.filter(i => i.itemType === filter);

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

  function handleExportCsv() {
    const date = new Date().toISOString().slice(0, 10);
    const scopePart = scope === "channel" ? displaySlug(selectedSlug) : "all";
    const filterPart = filter === "all" ? "all" : filter + "s";
    const filename = `voltsafe-currents-structured-${scopePart}-${filterPart}-${date}.csv`;
    const headers = [
      "Type", "Message Preview", "Notes", "Message Author", "Marked By",
      "Created At", "Source", "Message ID", "Thread Root ID", "Action URL",
      "Channel", "Record Type", "Record ID",
    ];
    const rows = displayed.map(item => [
      item.itemType,
      item.messageBody ?? "",
      item.notes ?? "",
      item.authorName ?? "",
      item.createdByName ?? "",
      item.createdAt,
      item.channelSlug
        ? `#${item.channelSlug}`
        : item.objectType
        ? `${item.objectType} ${item.objectId ?? ""}`
        : "",
      String(item.messageId),
      item.threadRootId ? String(item.threadRootId) : "",
      item.actionUrl ?? "",
      item.channelSlug ?? "",
      item.objectType ?? "",
      item.objectId ? String(item.objectId) : "",
    ]);
    downloadCsv([headers, ...rows], filename);
  }

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
        {/* Include archived toggle */}
        <label
          className="flex items-center gap-1.5 cursor-pointer select-none w-fit"
          data-testid="structured-include-archived-label"
        >
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
            data-testid="structured-include-archived-toggle"
            className="w-3 h-3 rounded accent-amber-500"
          />
          <span className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors">
            Include archived channels
          </span>
        </label>
        {/* Filter chips + export */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {STRUCT_FILTER_ITEMS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              data-testid={`structured-filter-${value}`}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11.5px] font-medium border transition-colors",
                filter === value
                  ? chipActive[value]
                  : "text-muted-foreground border-border/30 hover:border-border/60 hover:text-foreground"
              )}
            >
              {label}
              <span
                data-testid={`structured-count-${value}`}
                className={cn(
                  "text-[10px] font-semibold tabular-nums leading-none px-1 py-0.5 rounded-full min-w-[16px] text-center",
                  filter === value
                    ? "bg-current/15 opacity-80"
                    : "bg-muted/60 text-muted-foreground/70"
                )}
              >
                {counts[value]}
              </span>
            </button>
          ))}
          <button
            onClick={handleExportCsv}
            disabled={displayed.length === 0}
            data-testid="structured-export-csv"
            title="Export visible structured items"
            className={cn(
              "ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors",
              displayed.length === 0
                ? "text-muted-foreground/30 cursor-not-allowed"
                : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/40"
            )}
          >
            <Download className="w-3 h-3" />
            CSV
          </button>
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
        ) : displayed.length === 0 ? (
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
            {displayed.map((item) => (
              <div
                key={item.id}
                data-testid={`structured-item-${item.id}`}
                className="rounded-xl border border-border/50 hover:border-border/70 bg-card/30 hover:bg-muted/10 transition-all p-3.5 group"
              >
                {/* Top row: type badge + source + archived badge + date */}
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
                  {item.isChannelArchived && <ArchivedBadge />}
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
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [editChannelOpen, setEditChannelOpen] = useState(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [channelParticipantsOpen, setChannelParticipantsOpen] = useState(false);
  const [channelNameInput, setChannelNameInput] = useState("");
  const [channelDescInput, setChannelDescInput] = useState("");
  const [channelEditNameInput, setChannelEditNameInput] = useState("");
  const [channelEditDescInput, setChannelEditDescInput] = useState("");
  const [draft, setDraft] = useState("");
  const [mainPendingFiles, setMainPendingFiles] = useState<File[]>([]);
  const mainFileInputRef = useRef<HTMLInputElement | null>(null);
  const [isMainUploading, setIsMainUploading] = useState(false);
  const { toast } = useToast();
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [threadRootId, setThreadRootId] = useState<number | null>(null);
  const [view, setView] = useState<"channel" | "mentions" | "search" | "structured" | "dm">("channel");
  const [selectedDmId, setSelectedDmId] = useState<number | null>(null);
  const [newDmOpen, setNewDmOpen] = useState(false);
  const [dmDraft, setDmDraft] = useState("");
  const [editingDmMessage, setEditingDmMessage] = useState<DmMessage | null>(null);
  const [groupMemberOpen, setGroupMemberOpen] = useState(false);
  const [dmPendingFiles, setDmPendingFiles] = useState<File[]>([]);
  const dmFileInputRef = useRef<HTMLInputElement | null>(null);
  // Phase 12A: typing ping throttle refs (per composer)
  const channelTypingPingRef = useRef(0);
  const dmTypingPingRef = useRef(0);
  const [isDmUploading, setIsDmUploading] = useState(false);
  const dmFeedRef = useRef<HTMLDivElement>(null);
  const dmTextareaRef = useRef<HTMLTextAreaElement>(null);
  const dmIsAtBottom = useRef(true);
  const dmLastReadRef = useRef<number>(0);
  const dmMention = useComposerMentions(dmTextareaRef);
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

  // Detect archived channel when slug is not in the active list (e.g. deep-link)
  const { data: selectedChannelDirect } = useQuery<ChannelInfo | null>({
    queryKey: ["/api/current/channels", selectedSlug, "info"],
    queryFn: async () => {
      const r = await fetch(`/api/current/channels/${encodeURIComponent(selectedSlug)}`, { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!selectedSlug && !channelsLoading && !channels.find((c) => c.slug === selectedSlug),
    staleTime: 30_000,
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

  // ── DM queries ────────────────────────────────────────────────────────────

  const { data: dmConversations = [], isLoading: dmsLoading } = useQuery<DmConversation[]>({
    queryKey: ["/api/current/dms"],
    refetchInterval: 15_000,
  });

  const { data: dmMessages = [], isLoading: dmMsgsLoading } = useQuery<DmMessage[]>({
    queryKey: ["/api/current/dms", selectedDmId, "messages"],
    queryFn: () =>
      fetch(`/api/current/dms/${selectedDmId}/messages`, {
        credentials: "include",
      }).then((r) => r.json()),
    refetchInterval: 5_000,
    enabled: !!selectedDmId && view === "dm",
    placeholderData: keepPreviousData,
  });

  // Phase 12A: typing indicator queries (poll every 3 s while active)
  const { data: channelTypingData } = useQuery<{ typers: { userId: number; name: string }[]; count: number }>({
    queryKey: ["/api/current/typing", "channel", selectedSlug],
    queryFn: () =>
      fetch(`/api/current/typing?scope=channel&channelSlug=${encodeURIComponent(selectedSlug)}`, { credentials: "include" }).then((r) => r.json()),
    refetchInterval: 3_000,
    staleTime: 0,
    refetchOnWindowFocus: false,
    enabled: !!selectedSlug && view === "channel",
  });
  const { data: dmTypingData } = useQuery<{ typers: { userId: number; name: string }[]; count: number }>({
    queryKey: ["/api/current/typing", "dm", selectedDmId],
    queryFn: () =>
      fetch(`/api/current/typing?scope=dm&conversationId=${selectedDmId}`, { credentials: "include" }).then((r) => r.json()),
    refetchInterval: 3_000,
    staleTime: 0,
    refetchOnWindowFocus: false,
    enabled: !!selectedDmId && view === "dm",
  });

  // Phase 12C: channel participants query (independent of presenceUserIds — feeds into it)
  const { data: channelParticipantsData } = useQuery<{
    channel: { id: number; slug: string; name: string; description: string | null; isArchived: boolean };
    participants: ChannelParticipant[];
  }>({
    queryKey: ["/api/current/channels", selectedSlug, "participants"],
    queryFn: () =>
      fetch(`/api/current/channels/${encodeURIComponent(selectedSlug)}/participants`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!selectedSlug && view === "channel",
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const channelParticipants = channelParticipantsData?.participants ?? [];

  // Phase 12B+12C: collect user IDs needing presence — DMs first, then channel participants.
  // DMs take priority because their dots are always visible in the sidebar.
  // Capped at 100 to match the server-side cap on GET /api/current/presence.
  const PRESENCE_ID_CAP = 100;
  const presenceUserIds = useMemo(() => {
    const ids = new Set<number>();
    for (const dm of dmConversations) {
      if (dm.type === "dm" && dm.otherUser) ids.add(dm.otherUser.id);
      dm.members.forEach((m) => ids.add(m.id));
    }
    // Phase 12C: include channel participant IDs so presence dot works in the panel.
    // Added after DM IDs so DM presence takes priority when the cap is hit.
    for (const p of channelParticipants) {
      if (ids.size >= PRESENCE_ID_CAP) break;
      ids.add(p.id);
    }
    return Array.from(ids).sort((a, b) => a - b);
  }, [dmConversations, channelParticipants]);

  const { data: presenceData } = useQuery<{ users: { userId: number; status: "online" | "offline" }[] }>({
    queryKey: ["/api/current/presence", presenceUserIds.join(",")],
    queryFn: () =>
      fetch(`/api/current/presence?userIds=${presenceUserIds.join(",")}`, { credentials: "include" }).then((r) => r.json()),
    enabled: presenceUserIds.length > 0,
    refetchInterval: 30_000,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  // Phase 12B: heartbeat — fires immediately when Currents opens, then every 30 s
  useEffect(() => {
    if (!currentUserId) return;
    const beat = () =>
      fetch("/api/current/presence/heartbeat", {
        method: "POST",
        credentials: "include",
      }).catch(() => {});
    beat();
    const t = setInterval(beat, 30_000);
    return () => clearInterval(t);
  }, [currentUserId]);

  // ── Deep-link from notification action_url: ?channel=X&message=Y&thread=Z&dm=N ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const dm = params.get("dm");
    const chan = params.get("channel");
    const thread = params.get("thread");
    const msg = params.get("message");
    if (dm) {
      const dmId = Number(dm);
      if (dmId > 0) { setSelectedDmId(dmId); setView("dm"); }
    } else if (chan) {
      setSelectedSlug(chan);
      setView("channel");
    }
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
    // Phase 12C: close participant dialog on channel switch to avoid stale context
    setChannelParticipantsOpen(false);
  }, [selectedSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── DM scroll ─────────────────────────────────────────────────────────────

  function handleDmScroll() {
    if (!dmFeedRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = dmFeedRef.current;
    dmIsAtBottom.current = scrollHeight - scrollTop - clientHeight < 80;
  }

  useEffect(() => {
    if (dmIsAtBottom.current && dmFeedRef.current)
      dmFeedRef.current.scrollTop = dmFeedRef.current.scrollHeight;
  }, [dmMessages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    dmIsAtBottom.current = true;
    dmLastReadRef.current = 0;
    setEditingDmMessage(null);
    dmMention.closeMention();
    setTimeout(() => {
      if (dmFeedRef.current) dmFeedRef.current.scrollTop = dmFeedRef.current.scrollHeight;
    }, 50);
  }, [selectedDmId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── DM read receipts ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!selectedDmId || dmMessages.length === 0 || view !== "dm") return;
    const lastMsg = [...dmMessages].reverse().find((m) => !m.deletedAt);
    if (!lastMsg) return;
    const lastId = lastMsg.id;
    if (lastId === dmLastReadRef.current) return;
    dmLastReadRef.current = lastId;
    fetch(`/api/current/dms/${selectedDmId}/read`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lastReadMessageId: lastId }),
    })
      .then(() => queryClient.invalidateQueries({ queryKey: ["/api/current/dms"] }))
      .catch(() => {});
  }, [selectedDmId, dmMessages.length, view, queryClient]);

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

  // ── Channel management mutations ─────────────────────────────────────────

  const createChannelMutation = useMutation({
    mutationFn: async (data: { name: string; description: string }) => {
      const r = await apiRequest("POST", "/api/current/channels", data);
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).message || "Failed to create channel"); }
      return r.json() as Promise<Channel>;
    },
    onSuccess: (channel) => {
      queryClient.invalidateQueries({ queryKey: ["/api/current/channels"] });
      setCreateChannelOpen(false);
      setChannelNameInput("");
      setChannelDescInput("");
      setSelectedSlug(channel.slug);
      setView("channel");
      toast({ title: "Channel created", description: `#${channel.slug} is ready.` });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const editChannelMutation = useMutation({
    mutationFn: async (data: { name: string; description: string }) => {
      const chan = channels.find((c) => c.slug === selectedSlug);
      if (!chan) throw new Error("No channel selected");
      const r = await apiRequest("PATCH", `/api/current/channels/${chan.id}`, data);
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).message || "Failed to update channel"); }
      return r.json();
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/current/channels"] });
      setEditChannelOpen(false);
      setArchiveConfirmOpen(false);
      if (updated.slug && updated.slug !== selectedSlug) setSelectedSlug(updated.slug);
      toast({ title: "Channel updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const archiveChannelMutation = useMutation({
    mutationFn: async () => {
      const chan = channels.find((c) => c.slug === selectedSlug);
      if (!chan) throw new Error("No channel selected");
      const r = await apiRequest("POST", `/api/current/channels/${chan.id}/archive`, {});
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).message || "Failed to archive channel"); }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/current/channels"] });
      setEditChannelOpen(false);
      setArchiveConfirmOpen(false);
      const others = channels.filter((c) => c.slug !== selectedSlug);
      const nextSlug = others[0]?.slug ?? channels[0]?.slug ?? "general";
      setSelectedSlug(nextSlug);
      toast({ title: "Channel archived", description: "The channel is now read-only." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const unarchiveChannelMutation = useMutation({
    mutationFn: async (channelId: number) => {
      const r = await apiRequest("POST", `/api/current/channels/${channelId}/unarchive`, {});
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).message || "Failed to unarchive channel"); }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/current/channels"] });
      toast({ title: "Channel unarchived", description: "The channel is active again." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

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

  // ── Currents badge preference (Phase 10B) ────────────────────────────────

  const { data: currentPrefs } = useQuery<{ hideMutedFromCurrentsBadge: boolean }>({
    queryKey: ["/api/current/preferences"],
    staleTime: 60_000,
  });

  const currentPrefMutation = useMutation({
    mutationFn: (hideMuted: boolean) =>
      apiRequest("PUT", "/api/current/preferences", { hideMutedFromCurrentsBadge: hideMuted }).then((r) => r.json()),
    onSuccess: (_data, hideMuted) => {
      queryClient.invalidateQueries({ queryKey: ["/api/current/preferences"] });
      queryClient.invalidateQueries({ queryKey: ["/api/current/unread-counts"] });
      toast({
        title: hideMuted
          ? "Muted unread hidden from Currents badge"
          : "Muted unread included in Currents badge",
      });
    },
    onError: (e: any) => {
      toast({ title: "Could not update preference", description: e.message, variant: "destructive" });
    },
  });

  // ── Notification preference mutations ────────────────────────────────────

  const channelPrefMutation = useMutation({
    mutationFn: ({ channelId, notificationLevel }: { channelId: number; notificationLevel: string }) =>
      apiRequest("PUT", `/api/current/channels/${channelId}/preference`, { notificationLevel }).then((r) => r.json()),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/current/channels"] });
      const labels: Record<string, string> = {
        muted: "Channel muted",
        mentions: "Channel set to mentions only",
        all: "Channel set to all messages",
      };
      toast({ title: labels[vars.notificationLevel] || "Preference updated" });
    },
    onError: (e: any) => {
      toast({ title: "Could not update preference", description: e.message, variant: "destructive" });
    },
  });

  const dmPrefMutation = useMutation({
    mutationFn: ({ conversationId, isMuted }: { conversationId: number; isMuted: boolean }) =>
      apiRequest("PUT", `/api/current/dms/${conversationId}/preference`, { isMuted }).then((r) => r.json()),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/current/dms"] });
      toast({ title: vars.isMuted ? "Conversation muted" : "Conversation unmuted" });
    },
    onError: (e: any) => {
      toast({ title: "Could not update preference", description: e.message, variant: "destructive" });
    },
  });

  // ── DM mutations ──────────────────────────────────────────────────────────

  const startDmMutation = useMutation({
    mutationFn: (userIds: number[]) => {
      const body = userIds.length === 1 ? { userId: userIds[0] } : { userIds };
      return apiRequest("POST", "/api/current/dms", body).then((r) => r.json());
    },
    onSuccess: (data: { conversationId: number }) => {
      setNewDmOpen(false);
      setSelectedDmId(data.conversationId);
      setView("dm");
      queryClient.invalidateQueries({ queryKey: ["/api/current/dms"] });
    },
    onError: (e: any) => {
      toast({ title: "Could not start conversation", description: e.message, variant: "destructive" });
    },
  });

  const addMembersMutation = useMutation({
    mutationFn: (userIds: number[]) =>
      apiRequest("POST", `/api/current/dms/${selectedDmId}/members`, { userIds }).then((r) => r.json()),
    onSuccess: () => {
      setGroupMemberOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/current/dms"] });
      toast({ title: "Members added successfully" });
    },
    onError: (e: any) => {
      toast({ title: "Could not add members", description: e.message, variant: "destructive" });
    },
  });

  const leaveDmMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/current/dms/${selectedDmId}/leave`, {}).then((r) => r.json()),
    onSuccess: () => {
      setGroupMemberOpen(false);
      setSelectedDmId(null);
      setView("channel");
      queryClient.invalidateQueries({ queryKey: ["/api/current/dms"] });
      toast({ title: "You left the conversation" });
    },
    onError: (e: any) => {
      toast({ title: "Could not leave conversation", description: e.message, variant: "destructive" });
    },
  });

  const dmPostMutation = useMutation({
    mutationFn: ({ body, hasPendingAttachments }: { body: string; hasPendingAttachments: boolean }) =>
      apiRequest("POST", `/api/current/dms/${selectedDmId}/messages`, { body, hasPendingAttachments }).then((r) => r.json()),
  });

  const dmEditMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: string }) =>
      apiRequest("PATCH", `/api/current/messages/${id}`, { body }),
    onSuccess: () => {
      setEditingDmMessage(null);
      queryClient.invalidateQueries({ queryKey: ["/api/current/dms", selectedDmId, "messages"] });
    },
  });

  const dmDeleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/current/messages/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/current/dms", selectedDmId, "messages"] });
    },
  });

  const dmReactMutation = useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: number; emoji: string }) =>
      apiRequest("POST", `/api/current/messages/${messageId}/reactions`, { emoji }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["/api/current/dms", selectedDmId, "messages"] }),
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
    // Phase 12A: send typing ping, throttled to every 2.5 s, only when non-empty
    if (e.target.value.trim() && !isArchivedChannel) {
      const now = Date.now();
      if (now - channelTypingPingRef.current > 2_500) {
        channelTypingPingRef.current = now;
        fetch("/api/current/typing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ scope: "channel", channelSlug: selectedSlug }),
        }).catch(() => {});
      }
    }
  }

  // ── DM Handlers ───────────────────────────────────────────────────────────

  async function handleDmSend() {
    const trimmed = dmDraft.trim();
    const hasFiles = dmPendingFiles.length > 0;
    if ((!trimmed && !hasFiles) || dmPostMutation.isPending || isDmUploading || !selectedDmId) return;
    try {
      const newMsg = await dmPostMutation.mutateAsync({ body: trimmed, hasPendingAttachments: hasFiles });
      setDmDraft("");
      dmMention.closeMention();
      if (dmTextareaRef.current) dmTextareaRef.current.style.height = "auto";
      dmIsAtBottom.current = true;
      const files = [...dmPendingFiles];
      setDmPendingFiles([]);
      if (files.length > 0 && newMsg?.id) {
        setIsDmUploading(true);
        try {
          const result = await uploadCurrentAttachments(Number(newMsg.id), files);
          if (result.failed.length > 0) {
            toast({
              title: "Message sent, but some files failed",
              description: `${result.failed.length} attachment${result.failed.length > 1 ? "s" : ""} failed: ${result.failed.join(", ")}`,
              variant: "destructive",
            });
          }
        } finally {
          setIsDmUploading(false);
        }
      }
      queryClient.invalidateQueries({ queryKey: ["/api/current/dms", selectedDmId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/current/dms"] });
    } catch {}
  }

  function handleDmKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (dmMention.handleMentionKeyDown(e, dmDraft, setDmDraft)) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleDmSend();
    }
  }

  function handleDmDraftChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setDmDraft(e.target.value);
    growTextarea(e.target);
    dmMention.onValueChange(
      e.target.value,
      e.target.selectionStart ?? e.target.value.length
    );
    // Phase 12A: DM typing ping, throttled
    if (e.target.value.trim() && selectedDmId) {
      const now = Date.now();
      if (now - dmTypingPingRef.current > 2_500) {
        dmTypingPingRef.current = now;
        fetch("/api/current/typing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ scope: "dm", conversationId: selectedDmId }),
        }).catch(() => {});
      }
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const selectedChannel = channels.find((c) => c.slug === selectedSlug);
  const isArchivedChannel = !selectedChannel && !channelsLoading && !!selectedChannelDirect?.archivedAt;
  const selectedDm = dmConversations.find((d) => d.conversationId === selectedDmId);
  const totalDmUnread = dmConversations.reduce((s, d) => s + d.unreadCount, 0);

  // Phase 12B: presence lookup map and group online count
  const presenceMap = useMemo(() => {
    const m: Record<number, "online" | "offline"> = {};
    for (const u of presenceData?.users ?? []) m[u.userId] = u.status;
    return m;
  }, [presenceData]);

  // Current user is always online while Currents is open (heartbeat running).
  // members[] = other members only (API excludes current user), so add +1.
  const groupOnlineCount = useMemo(() => {
    if (!selectedDm || selectedDm.type !== "group_dm") return 0;
    const othersOnline = selectedDm.members.filter((mem) => presenceMap[mem.id] === "online").length;
    return 1 + othersOnline; // +1 for current user (always online in Currents)
  }, [selectedDm, presenceMap]);

  // Phase 12C: how many channel participants are currently online
  const channelOnlineCount = useMemo(() => {
    let count = 0;
    for (const p of channelParticipants) {
      if (p.id === currentUserId) { count += 1; continue; } // current user always online
      if (presenceMap[p.id] === "online") count += 1;
    }
    return count;
  }, [channelParticipants, currentUserId, presenceMap]);
  const hideMutedPref = currentPrefs?.hideMutedFromCurrentsBadge ?? false;
  const badgeDmUnread = hideMutedPref
    ? dmConversations.reduce((s, d) => s + (d.isMuted ? 0 : d.unreadCount), 0)
    : totalDmUnread;
  const badgeChannelUnread = hideMutedPref
    ? channels.reduce((s, c) => s + (c.notificationLevel === 'muted' ? 0 : c.unreadCount), 0)
    : channels.reduce((s, c) => s + c.unreadCount, 0);
  const totalUnread = badgeChannelUnread + badgeDmUnread;
  const nonDeletedCount = messages.filter((m) => !m.deletedAt).length;
  const dmNonDeletedCount = dmMessages.filter((m) => !m.deletedAt).length;

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
        <div className="px-4 pt-3 pb-1 shrink-0 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
            Channels
          </span>
          {isAdmin && (
            <button
              data-testid="btn-new-channel"
              onClick={() => { setChannelNameInput(""); setChannelDescInput(""); setCreateChannelOpen(true); }}
              className="w-4 h-4 rounded flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground/80 hover:bg-muted/40 transition-colors"
              title="New Channel"
            >
              <Plus className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Channel list */}
        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-px">
          {channelsLoading ? (
            <ChannelSkeleton />
          ) : (
            channels.map((channel) => {
              const active = view === "channel" && selectedSlug === channel.slug;
              const isMutedChan = channel.notificationLevel === 'muted';
              return (
                <div key={channel.slug} className="relative group">
                  <button
                    data-testid={`channel-item-${channel.slug}`}
                    onClick={() => { setSelectedSlug(channel.slug); setView("channel"); }}
                    className={cn(
                      "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px]",
                      "transition-all duration-100",
                      active
                        ? "bg-primary/15 text-primary font-medium"
                        : isMutedChan
                          ? "text-muted-foreground/40 hover:bg-muted/40 hover:text-muted-foreground/70"
                          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                      isAdmin ? "pr-14" : "pr-7",
                    )}
                  >
                    <Hash
                      className={cn(
                        "w-3.5 h-3.5 shrink-0 transition-opacity",
                        active ? "opacity-80" : isMutedChan ? "opacity-20" : "opacity-40 group-hover:opacity-60"
                      )}
                    />
                    <span className={cn("flex-1 truncate text-left min-w-0", isMutedChan && "opacity-60")}>
                      {displaySlug(channel.slug)}
                    </span>
                    {isMutedChan && !active && (
                      <BellOff
                        data-testid={`channel-muted-icon-${channel.slug}`}
                        className="w-3 h-3 shrink-0 opacity-30"
                      />
                    )}
                    {channel.unreadCount > 0 && (
                      <span
                        className={cn(
                          "min-w-[18px] h-[18px] px-1 flex items-center justify-center",
                          "rounded-full text-[10px] font-bold shrink-0",
                          active
                            ? "bg-primary/20 text-primary"
                            : isMutedChan
                              ? "bg-muted/60 text-muted-foreground/50"
                              : "bg-primary text-primary-foreground"
                        )}
                      >
                        {channel.unreadCount > 99 ? "99+" : channel.unreadCount}
                      </span>
                    )}
                  </button>
                  {/* Notification preference dropdown — all users */}
                  <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          data-testid={`btn-channel-pref-${channel.slug}`}
                          onClick={(e) => e.stopPropagation()}
                          className={cn(
                            "w-5 h-5 rounded flex items-center justify-center transition-all",
                            "opacity-0 group-hover:opacity-100",
                            isMutedChan
                              ? "text-amber-400/70 hover:text-amber-400 hover:bg-amber-500/10"
                              : "text-muted-foreground/40 hover:text-foreground hover:bg-muted/60"
                          )}
                          title="Notification preference"
                        >
                          {isMutedChan
                            ? <BellOff className="w-3 h-3" />
                            : channel.notificationLevel === 'all'
                              ? <Bell className="w-3 h-3" />
                              : <BellRing className="w-3 h-3" />
                          }
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="right" align="center" className="w-48 z-50">
                        <DropdownMenuLabel className="text-[10px] py-1 text-muted-foreground/60 font-normal">
                          Notifications
                        </DropdownMenuLabel>
                        <DropdownMenuItem
                          data-testid={`pref-all-${channel.slug}`}
                          onClick={(e) => { e.stopPropagation(); channelPrefMutation.mutate({ channelId: channel.id, notificationLevel: 'all' }); }}
                          className={cn("text-[12px]", channel.notificationLevel === 'all' && "font-semibold text-primary")}
                        >
                          <Bell className="w-3.5 h-3.5 mr-2 shrink-0" />
                          All messages
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          data-testid={`pref-mentions-${channel.slug}`}
                          onClick={(e) => { e.stopPropagation(); channelPrefMutation.mutate({ channelId: channel.id, notificationLevel: 'mentions' }); }}
                          className={cn("text-[12px]", (channel.notificationLevel === 'mentions' || !channel.notificationLevel) && "font-semibold text-primary")}
                        >
                          <BellRing className="w-3.5 h-3.5 mr-2 shrink-0" />
                          Mentions only
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          data-testid={`pref-muted-${channel.slug}`}
                          onClick={(e) => { e.stopPropagation(); channelPrefMutation.mutate({ channelId: channel.id, notificationLevel: 'muted' }); }}
                          className={cn("text-[12px]", isMutedChan && "font-semibold text-amber-400")}
                        >
                          <BellOff className="w-3.5 h-3.5 mr-2 shrink-0" />
                          Mute channel
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {isAdmin && (
                      <button
                        data-testid={`btn-edit-channel-${channel.slug}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setChannelEditNameInput(channel.name);
                          setChannelEditDescInput(channel.description ?? "");
                          setSelectedSlug(channel.slug);
                          setView("channel");
                          setArchiveConfirmOpen(false);
                          setEditChannelOpen(true);
                        }}
                        className="w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-foreground hover:bg-muted/60 transition-all"
                        title="Edit channel"
                      >
                        <Settings className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* DMs section */}
        <div className="px-4 pt-3 pb-1 shrink-0 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
            Direct Messages
          </span>
          <button
            data-testid="btn-new-dm"
            onClick={() => setNewDmOpen(true)}
            className="w-4 h-4 rounded flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground/80 hover:bg-muted/40 transition-colors"
            title="New Direct Message"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
        <div className="px-2 pb-2 shrink-0 space-y-px">
          {dmsLoading ? (
            <div className="flex items-center gap-2 px-2.5 py-1.5">
              <div className="w-5 h-5 rounded-full bg-muted/40 animate-pulse shrink-0" />
              <div className="h-3 w-20 rounded bg-muted/30 animate-pulse" />
            </div>
          ) : dmConversations.length === 0 ? (
            <button
              data-testid="btn-new-dm-empty"
              onClick={() => setNewDmOpen(true)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-muted/30 transition-colors"
            >
              <UserRound className="w-3.5 h-3.5 opacity-50 shrink-0" />
              <span>Message a teammate</span>
            </button>
          ) : (
            dmConversations.map((dm) => {
              const active = view === "dm" && selectedDmId === dm.conversationId;
              const isMutedDm = dm.isMuted;
              return (
                <div key={dm.conversationId} className="relative group">
                  <button
                    data-testid={`dm-item-${dm.conversationId}`}
                    onClick={() => { setSelectedDmId(dm.conversationId); setView("dm"); }}
                    className={cn(
                      "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] pr-7",
                      "transition-all duration-100",
                      active
                        ? "bg-primary/15 text-primary font-medium"
                        : isMutedDm
                          ? "text-muted-foreground/40 hover:bg-muted/40 hover:text-muted-foreground/70"
                          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                    )}
                  >
                    {dm.type === 'group_dm' ? (
                      <div
                        className={cn(
                          "w-5 h-5 rounded-full flex items-center justify-center shrink-0",
                          "bg-muted/60 border border-border/40",
                          isMutedDm && !active && "opacity-40"
                        )}
                      >
                        <Users className="w-3 h-3 text-muted-foreground/60" />
                      </div>
                    ) : (
                      <div className={cn("relative shrink-0", isMutedDm && !active && "opacity-40")}>
                        <div
                          className={cn(
                            "w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white",
                            avatarBg(dm.otherUser?.id ?? dm.conversationId)
                          )}
                        >
                          {initials(dm.otherUser?.name ?? dm.displayName)}
                        </div>
                        <PresenceDot
                          status={presenceMap[dm.otherUser?.id ?? 0] ?? "offline"}
                          className="absolute -bottom-px -right-px w-2 h-2"
                        />
                      </div>
                    )}
                    <div className={cn("flex-1 min-w-0 text-left", isMutedDm && !active && "opacity-50")}>
                      <div className="flex items-center gap-1">
                        <span className="truncate flex-1 font-medium">
                          {dm.displayName}
                        </span>
                        {isMutedDm && !active && (
                          <BellOff
                            data-testid={`dm-muted-icon-${dm.conversationId}`}
                            className="w-2.5 h-2.5 shrink-0 opacity-40"
                          />
                        )}
                        {dm.unreadCount > 0 && (
                          <span
                            className={cn(
                              "min-w-[16px] h-[16px] px-1 flex items-center justify-center",
                              "rounded-full text-[10px] font-bold shrink-0",
                              active
                                ? "bg-primary/20 text-primary"
                                : isMutedDm
                                  ? "bg-muted/60 text-muted-foreground/50"
                                  : "bg-primary text-primary-foreground"
                            )}
                          >
                            {dm.unreadCount > 99 ? "99+" : dm.unreadCount}
                          </span>
                        )}
                      </div>
                      {dm.lastMessage && (
                        <div className="text-[11px] text-muted-foreground/50 truncate leading-tight">
                          {dm.lastMessage.body
                            ? dm.lastMessage.body.replace(/@\[([^\]]+)\]\(user:\d+\)/g, "@$1").slice(0, 45)
                            : "📎 Attachment"}
                        </div>
                      )}
                    </div>
                  </button>
                  {/* DM mute dropdown */}
                  <div className="absolute right-1 top-1/2 -translate-y-1/2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          data-testid={`btn-dm-pref-${dm.conversationId}`}
                          onClick={(e) => e.stopPropagation()}
                          className={cn(
                            "w-5 h-5 rounded flex items-center justify-center transition-all",
                            "opacity-0 group-hover:opacity-100",
                            isMutedDm
                              ? "text-amber-400/70 hover:text-amber-400 hover:bg-amber-500/10"
                              : "text-muted-foreground/40 hover:text-foreground hover:bg-muted/60"
                          )}
                          title="Notification preference"
                        >
                          {isMutedDm ? <BellOff className="w-3 h-3" /> : <Bell className="w-3 h-3" />}
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="right" align="center" className="w-44 z-50">
                        <DropdownMenuLabel className="text-[10px] py-1 text-muted-foreground/60 font-normal">
                          Notifications
                        </DropdownMenuLabel>
                        <DropdownMenuItem
                          data-testid={`dm-pref-notify-${dm.conversationId}`}
                          onClick={(e) => { e.stopPropagation(); dmPrefMutation.mutate({ conversationId: dm.conversationId, isMuted: false }); }}
                          className={cn("text-[12px]", !isMutedDm && "font-semibold text-primary")}
                        >
                          <Bell className="w-3.5 h-3.5 mr-2 shrink-0" />
                          Notify me
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          data-testid={`dm-pref-mute-${dm.conversationId}`}
                          onClick={(e) => { e.stopPropagation(); dmPrefMutation.mutate({ conversationId: dm.conversationId, isMuted: true }); }}
                          className={cn("text-[12px]", isMutedDm && "font-semibold text-amber-400")}
                        >
                          <BellOff className="w-3.5 h-3.5 mr-2 shrink-0" />
                          Mute conversation
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
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

        {/* Badge preference toggle (Phase 10B) */}
        <div className="px-3 py-2.5 border-t border-border/30 shrink-0">
          <div className="flex items-center gap-2">
            <Switch
              data-testid="toggle-hide-muted-badge"
              checked={hideMutedPref}
              onCheckedChange={(v) => currentPrefMutation.mutate(v)}
              className="shrink-0 scale-75 origin-left"
              disabled={currentPrefMutation.isPending}
            />
            <div className="min-w-0">
              <div className="text-[11px] text-muted-foreground/70 font-medium leading-tight">
                Hide muted unread from badge
              </div>
              <div className="text-[10px] text-muted-foreground/40 leading-tight mt-0.5">
                Muted channels and DMs still show their own counts
              </div>
            </div>
          </div>
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
          ) : view === "dm" ? (
            <>
              {selectedDm?.type === 'group_dm' ? (
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-muted/60 border border-border/40"
                >
                  <Users className="w-3.5 h-3.5 text-muted-foreground/60" />
                </div>
              ) : (
                <div
                  className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center shrink-0",
                    "text-[10px] font-bold text-white",
                    selectedDm ? avatarBg(selectedDm.otherUser?.id ?? selectedDm.conversationId) : "bg-muted"
                  )}
                >
                  {selectedDm ? initials(selectedDm.otherUser?.name ?? selectedDm.displayName) : "?"}
                </div>
              )}
              <span className="font-semibold text-[14px] text-foreground shrink-0">
                {selectedDm?.displayName ?? "Direct Message"}
              </span>
              {selectedDm?.type === 'group_dm' ? (
                <button
                  data-testid="btn-group-member-count"
                  onClick={() => setGroupMemberOpen(true)}
                  className="flex items-center gap-1 text-[12px] text-muted-foreground/60 hover:text-primary/80 transition-colors rounded px-1 -mx-1"
                  title="View members"
                >
                  <UserPlus className="w-3 h-3 shrink-0" />
                  {(selectedDm.members.length + 1)} members
                  {groupOnlineCount > 0 && (
                    <>
                      <span className="text-muted-foreground/40">·</span>
                      <span className="text-emerald-500" data-testid="dm-header-online-count">{groupOnlineCount} online</span>
                    </>
                  )}
                </button>
              ) : selectedDm?.otherUser ? (
                <span
                  className={cn(
                    "text-[12px] flex items-center gap-1 shrink-0",
                    presenceMap[selectedDm.otherUser.id] === "online" ? "text-emerald-500" : "text-muted-foreground/40"
                  )}
                  data-testid="dm-header-presence-status"
                >
                  <span className={cn(
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    presenceMap[selectedDm.otherUser.id] === "online" ? "bg-emerald-500" : "bg-muted-foreground/30"
                  )} />
                  {presenceMap[selectedDm.otherUser.id] === "online" ? "Online" : "Offline"}
                </span>
              ) : null}
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
              {/* Phase 12C: channel people / online presence control */}
              <button
                onClick={() => setChannelParticipantsOpen(true)}
                data-testid="btn-channel-participants"
                title="Channel participants"
                className={cn(
                  "ml-auto shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-md text-[11.5px] font-medium transition-colors",
                  "text-muted-foreground/50 hover:text-foreground hover:bg-muted/60",
                )}
              >
                <Users className="w-3 h-3" />
                <span className="hidden sm:inline" data-testid="channel-participants-label">
                  {channelParticipants.length > 0
                    ? channelOnlineCount > 0
                      ? `${channelParticipants.length} people · ${channelOnlineCount} online`
                      : `${channelParticipants.length} people`
                    : "People"}
                </span>
              </button>
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
                  "shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-md text-[11.5px] font-medium transition-colors",
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
              {isAdmin && (
                <button
                  data-testid="btn-edit-channel-header"
                  onClick={() => {
                    if (selectedChannel) {
                      setChannelEditNameInput(selectedChannel.name);
                      setChannelEditDescInput(selectedChannel.description ?? "");
                      setArchiveConfirmOpen(false);
                      setEditChannelOpen(true);
                    }
                  }}
                  title="Edit channel"
                  className="shrink-0 w-7 h-7 p-0 rounded-md flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-muted/60 transition-colors"
                >
                  <Settings className="w-3.5 h-3.5" />
                </button>
              )}
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
        ) : view === "dm" ? (
          /* ── DM view ─────────────────────────────────────────────────── */
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {/* DM feed */}
            <div
              ref={dmFeedRef}
              onScroll={handleDmScroll}
              className="flex-1 overflow-y-auto px-4 py-4 space-y-1"
            >
              {dmMsgsLoading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground/30">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : dmNonDeletedCount === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground/40">
                  {selectedDm?.type === 'group_dm' ? (
                    <div className="w-12 h-12 rounded-full flex items-center justify-center bg-muted/60 border border-border/40">
                      <Users className="w-6 h-6 text-muted-foreground/40" />
                    </div>
                  ) : (
                    <div
                      className={cn(
                        "w-12 h-12 rounded-full flex items-center justify-center",
                        "text-base font-bold text-white",
                        selectedDm ? avatarBg(selectedDm.otherUser?.id ?? selectedDm.conversationId) : "bg-muted"
                      )}
                    >
                      {selectedDm ? initials(selectedDm.otherUser?.name ?? selectedDm.displayName) : "?"}
                    </div>
                  )}
                  <div className="text-center">
                    <div className="text-[13px] font-medium text-foreground/60">
                      {selectedDm?.displayName ?? "Your teammate"}
                    </div>
                    <div className="text-[12px] mt-1">
                      {selectedDm?.type === 'group_dm' ? "Kick off the group conversation!" : "Start the conversation — say hi!"}
                    </div>
                  </div>
                </div>
              ) : (
                dmMessages.map((msg, i) => {
                  const prev = dmMessages[i - 1];
                  const isConsecutive =
                    prev &&
                    !prev.deletedAt &&
                    prev.userId === msg.userId &&
                    new Date(msg.createdAt).getTime() -
                      new Date(prev.createdAt).getTime() <
                      5 * 60 * 1000;
                  if (editingDmMessage?.id === msg.id) {
                    return (
                      <InlineEditRow
                        key={msg.id}
                        initialValue={msg.body ?? ""}
                        onSave={(body) => dmEditMutation.mutate({ id: msg.id, body })}
                        onCancel={() => setEditingDmMessage(null)}
                        isPending={dmEditMutation.isPending}
                      />
                    );
                  }
                  return (
                    <MessageRow
                      key={msg.id}
                      message={{ ...msg, channelId: 0, replyCount: 0, latestReplyAt: null, structuredItems: [] }}
                      currentUserId={currentUserId}
                      grouped={isConsecutive}
                      isAdmin={false}
                      isArchived={false}
                      pinnedMessageIds={new Set()}
                      onToggleReaction={(mid, emoji) => dmReactMutation.mutate({ messageId: mid, emoji })}
                      onEdit={() => setEditingDmMessage(msg)}
                      onDelete={() => dmDeleteMutation.mutate(msg.id)}
                      onPin={() => {}}
                      onOpenThread={() => {}}
                      onMarkStructured={() => {}}
                      onUnmarkStructured={() => {}}
                    />
                  );
                })
              )}
            </div>

            {/* DM Composer */}
            <div className="px-4 pb-4 shrink-0">
              {dmMention.open && dmMention.results.length > 0 && (
                <MentionDropdown
                  users={dmMention.results}
                  activeIndex={dmMention.activeIndex}
                  onSelect={(user) => {
                    const next = dmMention.insertMention(user, dmDraft, dmTextareaRef);
                    setDmDraft(next);
                  }}
                />
              )}
              {/* Phase 12A: DM typing indicator */}
              <TypingIndicator typers={dmTypingData?.typers ?? []} count={dmTypingData?.count ?? 0} />
              {dmPendingFiles.length > 0 && (
                <div className="mb-2">
                  <PendingFileChips
                    files={dmPendingFiles}
                    onRemove={(i) =>
                      setDmPendingFiles((prev) => prev.filter((_, idx) => idx !== i))
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
                <textarea
                  ref={dmTextareaRef}
                  data-testid="dm-composer-input"
                  value={dmDraft}
                  onChange={handleDmDraftChange}
                  onKeyDown={handleDmKeyDown}
                  placeholder="Write a message or attach files…"
                  rows={1}
                  className={cn(
                    "flex-1 border-0 bg-transparent shadow-none resize-none p-0 outline-none",
                    "text-[13.5px] placeholder:text-muted-foreground/40 leading-relaxed",
                    "min-h-[22px] max-h-36 overflow-y-auto"
                  )}
                  style={{ height: "auto" }}
                />
                <div className="flex items-center gap-1 shrink-0">
                  <EmojiPickerPopover
                    onSelect={(emoji) => {
                      setDmDraft((d) => d + emoji);
                      dmTextareaRef.current?.focus();
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => dmFileInputRef.current?.click()}
                    title="Attach file"
                    data-testid="btn-attach-dm"
                    className="h-8 w-8 p-0 rounded-lg flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted/40 transition-colors"
                  >
                    <Paperclip className="w-3.5 h-3.5" />
                  </button>
                  <input
                    ref={dmFileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    data-testid="dm-file-input"
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      if (files.length > 0)
                        setDmPendingFiles((prev) => [...prev, ...files]);
                      e.target.value = "";
                    }}
                  />
                  <button
                    data-testid="dm-send-btn"
                    onClick={handleDmSend}
                    disabled={
                      (!dmDraft.trim() && dmPendingFiles.length === 0) ||
                      dmPostMutation.isPending ||
                      isDmUploading
                    }
                    className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all",
                      (dmDraft.trim() || dmPendingFiles.length > 0) && !dmPostMutation.isPending && !isDmUploading
                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                        : "bg-muted/40 text-muted-foreground/30"
                    )}
                  >
                    {(dmPostMutation.isPending || isDmUploading) ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
              <p className="text-[10.5px] text-muted-foreground/35 mt-1.5 px-0.5 select-none">
                Enter to send · Shift+Enter for new line · @ to mention · 📎 to attach
              </p>
            </div>
          </div>
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
                          isArchived={isArchivedChannel}
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

            {/* Archived banner */}
            {isArchivedChannel && (
              <div className="mx-4 mb-0 mt-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[12.5px] shrink-0">
                <Archive className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1">This channel is archived. Messages are read-only.</span>
                {isAdmin && selectedChannelDirect?.id && (
                  <button
                    data-testid="btn-unarchive-channel"
                    onClick={() => unarchiveChannelMutation.mutate(selectedChannelDirect.id)}
                    disabled={unarchiveChannelMutation.isPending}
                    className="shrink-0 text-amber-400 hover:text-amber-300 underline underline-offset-2 text-[12px] font-medium transition-colors disabled:opacity-50"
                  >
                    {unarchiveChannelMutation.isPending ? "Restoring…" : "Unarchive"}
                  </button>
                )}
              </div>
            )}

            {/* Composer */}
            {!isArchivedChannel && (
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
              {/* Phase 12A: channel typing indicator */}
              <TypingIndicator typers={channelTypingData?.typers ?? []} count={channelTypingData?.count ?? 0} />
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
            )}
          </>
        )}
      </div>

      {/* ── Create Channel Dialog ─────────────────────────────────────── */}
      <Dialog open={createChannelOpen} onOpenChange={setCreateChannelOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New Channel</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div>
              <label className="text-[12px] font-medium text-muted-foreground mb-1.5 block">Name</label>
              <Input
                data-testid="input-channel-name"
                value={channelNameInput}
                onChange={(e) => setChannelNameInput(e.target.value)}
                placeholder="e.g. product-updates"
                maxLength={80}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && channelNameInput.trim() && !createChannelMutation.isPending) {
                    createChannelMutation.mutate({ name: channelNameInput.trim(), description: channelDescInput.trim() });
                  }
                }}
              />
              {channelNameInput.trim() && (
                <p className="text-[11px] text-muted-foreground/60 mt-1">
                  Slug: <span className="font-mono text-primary/70">#{normalizeChannelSlug(channelNameInput)}</span>
                </p>
              )}
            </div>
            <div>
              <label className="text-[12px] font-medium text-muted-foreground mb-1.5 block">
                Description <span className="text-muted-foreground/40">(optional)</span>
              </label>
              <Input
                data-testid="input-channel-description"
                value={channelDescInput}
                onChange={(e) => setChannelDescInput(e.target.value)}
                placeholder="What's this channel for?"
                maxLength={200}
              />
            </div>
          </div>
          <DialogFooter className="mt-2">
            <Button variant="ghost" size="sm" onClick={() => setCreateChannelOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              data-testid="btn-create-channel-submit"
              onClick={() => createChannelMutation.mutate({ name: channelNameInput.trim(), description: channelDescInput.trim() })}
              disabled={!channelNameInput.trim() || createChannelMutation.isPending}
            >
              {createChannelMutation.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              Create Channel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Channel Dialog ───────────────────────────────────────── */}
      <Dialog open={editChannelOpen} onOpenChange={(o) => { setEditChannelOpen(o); if (!o) setArchiveConfirmOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {archiveConfirmOpen ? "Archive channel?" : `Edit #${displaySlug(selectedSlug)}`}
            </DialogTitle>
          </DialogHeader>
          {archiveConfirmOpen ? (
            <div className="space-y-3 pt-1">
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                Archive <strong>#{displaySlug(selectedSlug)}</strong>? It will be removed from the sidebar. Messages are preserved in read-only mode.
              </p>
              <DialogFooter>
                <Button variant="ghost" size="sm" onClick={() => setArchiveConfirmOpen(false)}>Cancel</Button>
                <Button
                  variant="destructive"
                  size="sm"
                  data-testid="btn-confirm-archive-channel"
                  onClick={() => archiveChannelMutation.mutate()}
                  disabled={archiveChannelMutation.isPending}
                >
                  {archiveChannelMutation.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                  Archive Channel
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <div className="space-y-3 pt-1">
                <div>
                  <label className="text-[12px] font-medium text-muted-foreground mb-1.5 block">Name</label>
                  <Input
                    data-testid="input-edit-channel-name"
                    value={channelEditNameInput}
                    onChange={(e) => setChannelEditNameInput(e.target.value)}
                    maxLength={80}
                    autoFocus
                  />
                  {channelEditNameInput.trim() && normalizeChannelSlug(channelEditNameInput) !== selectedSlug && (
                    <p className="text-[11px] text-muted-foreground/60 mt-1">
                      New slug: <span className="font-mono text-primary/70">#{normalizeChannelSlug(channelEditNameInput)}</span>
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-[12px] font-medium text-muted-foreground mb-1.5 block">Description</label>
                  <Input
                    data-testid="input-edit-channel-description"
                    value={channelEditDescInput}
                    onChange={(e) => setChannelEditDescInput(e.target.value)}
                    placeholder="What's this channel for?"
                    maxLength={200}
                  />
                </div>
              </div>
              <DialogFooter className="flex items-center justify-between sm:justify-between gap-2 mt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setArchiveConfirmOpen(true)}
                  data-testid="btn-archive-channel"
                >
                  <Archive className="w-3.5 h-3.5 mr-1.5" />
                  Archive
                </Button>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditChannelOpen(false)}>Cancel</Button>
                  <Button
                    size="sm"
                    data-testid="btn-edit-channel-submit"
                    onClick={() => editChannelMutation.mutate({ name: channelEditNameInput.trim(), description: channelEditDescInput.trim() })}
                    disabled={!channelEditNameInput.trim() || editChannelMutation.isPending}
                  >
                    {editChannelMutation.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                    Save
                  </Button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <CreateTaskFromCurrentDialog
        open={createTaskSource !== null}
        source={createTaskSource}
        onClose={() => setCreateTaskSource(null)}
      />

      <NewDmDialog
        open={newDmOpen}
        onOpenChange={setNewDmOpen}
        onConfirm={(userIds) => startDmMutation.mutate(userIds)}
        isPending={startDmMutation.isPending}
      />

      <GroupMemberDialog
        open={groupMemberOpen}
        onOpenChange={setGroupMemberOpen}
        conversation={selectedDm ?? null}
        currentUserId={currentUserId}
        onAddMembers={(userIds) => addMembersMutation.mutate(userIds)}
        onLeave={() => leaveDmMutation.mutate()}
        isAddPending={addMembersMutation.isPending}
        isLeavePending={leaveDmMutation.isPending}
        presenceMap={presenceMap}
      />

      {/* Phase 12C: channel participants / online presence panel */}
      <ChannelParticipantsDialog
        open={channelParticipantsOpen}
        onOpenChange={setChannelParticipantsOpen}
        channelSlug={selectedSlug}
        participants={channelParticipants}
        currentUserId={currentUserId}
        isArchived={isArchivedChannel}
        presenceMap={presenceMap}
      />

      {/* ── Thread panel ────────────────────────────────────────────────── */}
      {threadRootId !== null && (
        <ThreadPanel
          rootMessageId={threadRootId}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          isArchived={isArchivedChannel}
          selectedSlug={selectedSlug}
          onClose={() => setThreadRootId(null)}
          onCreateTaskMsg={handleCreateTaskFromMsg}
          onCreateSummaryTask={(item) => setCreateTaskSource({ kind: "summary_action_item", task: item.task, owner: item.owner, due: item.due, summaryContext: `Thread in #${selectedSlug}`, channelSlug: selectedSlug, threadRootId: threadRootId ?? undefined })}
        />
      )}
    </div>
  );
}
