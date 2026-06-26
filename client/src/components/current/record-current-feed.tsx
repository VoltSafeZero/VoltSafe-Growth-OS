import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistanceToNow } from "date-fns";
import {
  MessageSquare, Send, Smile, Pencil, Trash2, X, Check,
  MessagesSquare, ChevronLeft, Pin, ChevronDown, ChevronUp, Paperclip,
  Search, Loader2, Sparkles, CheckSquare, Bookmark,
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
import { useToast } from "@/hooks/use-toast";
import {
  CurrentAttachmentChips, PendingFileChips, uploadCurrentAttachments,
} from "./current-attachment-display";
import type { CurrentAttachment, UploadResult } from "./current-attachment-display";
import { CurrentSummaryPanel } from "./current-summary-panel";
import type { CurrentSummaryData } from "./current-summary-panel";
import { CreateTaskFromCurrentDialog } from "./create-task-from-current-dialog";
import type { CreateTaskSource } from "./create-task-from-current-dialog";

// ── Helpers ───────────────────────────────────────────────────────────────────

function highlightSnippet(text: string, query: string): React.ReactNode {
  if (!query.trim() || !text) return text;
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

// ── Types ─────────────────────────────────────────────────────────────────────

interface StructuredItem {
  id: number;
  itemType: 'decision' | 'risk' | 'requirement';
  notes: string | null;
  createdBy: number | null;
  createdAt: string;
}

const REC_STRUCTURED_BADGE_STYLE: Record<string, string> = {
  decision: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
  risk: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
  requirement: "bg-purple-500/10 text-purple-400 border border-purple-500/20",
};

const REC_STRUCTURED_DOT_STYLE: Record<string, string> = {
  decision: "bg-emerald-500",
  risk: "bg-amber-500",
  requirement: "bg-purple-500",
};

interface RecordMessage {
  id: number;
  userId: number;
  body: string | null;
  isEdited: boolean;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  parentMessageId: number | null;
  userName: string;
  userAvatarUrl: string | null;
  reactions: Array<{ emoji: string; count: number; reacted: boolean }>;
  replyCount: number;
  latestReplyAt: string | null;
  attachments: CurrentAttachment[];
  structuredItems?: StructuredItem[];
}

interface PinnedRecord {
  id: number;
  messageId: number;
  pinnedBy: number | null;
  pinnedByName: string | null;
  pinnedAt: string;
  messageBody: string | null;
  messageUserName: string;
  messageCreatedAt: string;
}

interface MentionUser {
  id: number;
  name: string;
  avatarUrl: string | null;
  department: string | null;
}

export interface RecordCurrentFeedProps {
  objectType: string;
  objectId: number;
  initialMessageId?: number;
  initialThreadId?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectMentionTrigger(text: string): { query: string; triggerStart: number } | null {
  const at = text.lastIndexOf("@");
  if (at === -1) return null;
  const before = text[at - 1];
  if (before && /\S/.test(before) && before !== "@") return null;
  const after = text.slice(at + 1);
  if (after.includes(" ") && /\s/.test(after[0] ?? "")) return null;
  return { query: after, triggerStart: at };
}

function renderMentionBody(body: string, myUserId: number): React.ReactNode {
  const re = /@\[([^\]]+)\]\(user:(\d+)\)/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let hadToken = false;
  while ((m = re.exec(body)) !== null) {
    hadToken = true;
    if (m.index > last) parts.push(body.slice(last, m.index));
    const uid = Number(m[2]);
    const isMe = !!myUserId && uid === myUserId;
    parts.push(
      <span
        key={m.index}
        className={`inline-flex items-center gap-0.5 px-1 rounded text-[11px] font-semibold ${
          isMe
            ? "bg-primary/25 text-primary ring-1 ring-primary/40"
            : "bg-muted/60 text-foreground"
        }`}
      >
        @{m[1]}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (!hadToken) return <>{body}</>;
  if (last < body.length) parts.push(body.slice(last));
  return <>{parts}</>;
}

const QUICK_EMOJIS = ["👍", "❤️", "🎉", "😄", "🚀", "👀"];

function initials(name: string) {
  return name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
}

// ── MentionDropdown ───────────────────────────────────────────────────────────

function MentionDropdown({
  users, activeIdx, anchorRect, onSelect,
}: {
  users: MentionUser[];
  activeIdx: number;
  anchorRect: DOMRect | null;
  onSelect: (u: MentionUser) => void;
}) {
  if (!users.length || !anchorRect) return null;
  const style: React.CSSProperties = {
    position: "fixed",
    bottom: window.innerHeight - anchorRect.top + 6,
    left: anchorRect.left,
    zIndex: 9999,
    minWidth: 220,
    maxWidth: 300,
  };
  return createPortal(
    <div
      style={style}
      className="rounded-lg border border-border bg-popover shadow-xl overflow-hidden"
      data-testid="record-mention-dropdown"
    >
      {users.map((u, i) => (
        <div
          key={u.id}
          onMouseDown={(e) => { e.preventDefault(); onSelect(u); }}
          className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-sm ${
            i === activeIdx ? "bg-primary/15 text-primary" : "hover:bg-muted/40"
          }`}
          data-testid={`mention-option-${u.id}`}
        >
          <Avatar className="h-5 w-5 flex-shrink-0">
            {u.avatarUrl && <AvatarImage src={u.avatarUrl} />}
            <AvatarFallback className="text-[9px]">{initials(u.name)}</AvatarFallback>
          </Avatar>
          <span className="font-medium truncate">{u.name}</span>
          {u.department && <span className="text-xs text-muted-foreground truncate">{u.department}</span>}
        </div>
      ))}
      {users.length === 0 && (
        <div className="px-3 py-2 text-xs text-muted-foreground">No teammates found</div>
      )}
    </div>,
    document.body
  );
}

// ── EmojiPicker ───────────────────────────────────────────────────────────────

function EmojiPicker({
  anchorRef, onPick, onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const rect = anchorRef.current?.getBoundingClientRect();
  if (!rect) return null;
  const style: React.CSSProperties = {
    position: "fixed",
    bottom: window.innerHeight - rect.top + 6,
    left: rect.left,
    zIndex: 9999,
  };
  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onMouseDown={onClose} />
      <div style={style} className="z-[9999] relative rounded-lg border border-border bg-popover shadow-xl p-2 flex gap-1">
        {QUICK_EMOJIS.map(e => (
          <button key={e} onMouseDown={(ev) => { ev.preventDefault(); onPick(e); onClose(); }}
            className="text-lg hover:bg-muted/40 rounded p-1 transition-colors">{e}</button>
        ))}
      </div>
    </>,
    document.body
  );
}

// ── useComposerMentions ───────────────────────────────────────────────────────

function useComposerMentions(text: string, setText: (t: string) => void) {
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIdx, setMentionIdx] = useState(0);
  const [triggerStart, setTriggerStart] = useState(-1);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const { data: mentionUsers = [] } = useQuery<MentionUser[]>({
    queryKey: ["/api/current/users", mentionQuery],
    queryFn: async () => {
      const r = await fetch(`/api/current/users?q=${encodeURIComponent(mentionQuery)}`, { credentials: "include" });
      return r.json();
    },
    enabled: mentionActive,
  });

  function onInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setText(val);
    const selEnd = (e.target as HTMLTextAreaElement).selectionStart ?? val.length;
    const trig = detectMentionTrigger(val.slice(0, selEnd));
    if (trig) {
      setMentionActive(true);
      setMentionQuery(trig.query);
      setTriggerStart(trig.triggerStart);
      setMentionIdx(0);
      setAnchorRect((e.target as HTMLTextAreaElement).getBoundingClientRect());
    } else {
      setMentionActive(false);
    }
  }

  function handleMentionKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!mentionActive) return false;
    if (e.key === "ArrowDown") { e.preventDefault(); setMentionIdx(i => Math.min(i + 1, mentionUsers.length - 1)); return true; }
    if (e.key === "ArrowUp") { e.preventDefault(); setMentionIdx(i => Math.max(i - 1, 0)); return true; }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      if (mentionUsers[mentionIdx]) insertMention(mentionUsers[mentionIdx]);
      return true;
    }
    if (e.key === "Escape") { setMentionActive(false); return true; }
    return false;
  }

  function insertMention(user: MentionUser) {
    const token = `@[${user.name}](user:${user.id}) `;
    const before = text.slice(0, triggerStart);
    const after = text.slice(triggerStart + 1 + mentionQuery.length);
    setText(before + token + after);
    setMentionActive(false);
  }

  return {
    mentionActive, mentionUsers, mentionIdx, anchorRect,
    onInput, handleMentionKeyDown, insertMention,
    closeMention: () => setMentionActive(false),
  };
}

// ── MessageComposer ───────────────────────────────────────────────────────────

function MessageComposer({
  onSend, placeholder, disabled,
}: {
  onSend: (body: string, files: File[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mention = useComposerMentions(draft, setDraft);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mention.handleMentionKeyDown(e)) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    const trimmed = draft.trim();
    if (!trimmed || disabled) return;
    const files = [...pendingFiles];
    onSend(trimmed, files);
    setDraft("");
    setPendingFiles([]);
    mention.closeMention();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length === 0) return;
    setPendingFiles(prev => [...prev, ...selected]);
    e.target.value = "";
  }

  function removeFile(index: number) {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      {pendingFiles.length > 0 && (
        <PendingFileChips files={pendingFiles} onRemove={removeFile} />
      )}
      <div className="flex items-end gap-2">
        <div className="flex-1 relative">
          <Textarea
            value={draft}
            onChange={mention.onInput}
            onKeyDown={handleKeyDown}
            placeholder={placeholder ?? "Message… @ to mention"}
            rows={1}
            className="min-h-[38px] max-h-28 resize-none text-sm pr-8 py-2"
            disabled={disabled}
            data-testid="record-current-composer"
          />
          <button
            className="absolute right-2 bottom-2 text-muted-foreground hover:text-foreground transition-colors"
            type="button"
            tabIndex={-1}
            onClick={() => fileInputRef.current?.click()}
            title="Attach file"
            data-testid="record-current-attach"
          >
            <Paperclip className="h-3.5 w-3.5" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileChange}
            data-testid="record-current-file-input"
          />
        </div>
        <Button
          size="sm"
          onClick={submit}
          disabled={!draft.trim() || disabled}
          className="h-[38px] px-3 shrink-0"
          data-testid="record-current-send"
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
      {mention.mentionActive && (
        <MentionDropdown
          users={mention.mentionUsers}
          activeIdx={mention.mentionIdx}
          anchorRect={mention.anchorRect}
          onSelect={mention.insertMention}
        />
      )}
    </div>
  );
}

// ── MessageItem ───────────────────────────────────────────────────────────────

function MessageItem({
  msg, myUserId, onReact, onEdit, onDelete, onOpenThread, onPin, isPinned, highlighted, onCreateTask,
  onMarkStructured, onUnmarkStructured, onMarkWithNote,
}: {
  msg: RecordMessage;
  myUserId: number;
  onReact: (msgId: number, emoji: string) => void;
  onEdit: (msgId: number, body: string) => void;
  onDelete: (msgId: number) => void;
  onOpenThread: (msgId: number) => void;
  onPin: (msgId: number, currentlyPinned: boolean) => void;
  isPinned: boolean;
  highlighted: boolean;
  onCreateTask?: (msg: RecordMessage) => void;
  onMarkStructured?: (msgId: number, itemType: string) => void;
  onUnmarkStructured?: (msgId: number, itemType: string) => void;
  onMarkWithNote?: (msgId: number, itemType: string, notes: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [recNoteDialogType, setRecNoteDialogType] = useState<string | null>(null);
  const [recNoteText, setRecNoteText] = useState("");
  const isOwn = msg.userId === myUserId;

  if (msg.deletedAt) {
    return (
      <div className="flex items-center gap-2 py-1.5 px-2" data-testid={`record-msg-${msg.id}`}>
        <div className="h-6 w-6 flex-shrink-0" />
        <span className="text-xs text-muted-foreground/50 italic">Message deleted</span>
      </div>
    );
  }

  function startEdit() {
    setEditDraft(msg.body || "");
    setEditing(true);
  }

  function commitEdit() {
    const trimmed = editDraft.trim();
    if (trimmed && trimmed !== msg.body) onEdit(msg.id, trimmed);
    setEditing(false);
  }

  return (
    <div
      id={`record-msg-${msg.id}`}
      data-testid={`record-msg-${msg.id}`}
      className={`group flex gap-2.5 px-2 py-1.5 rounded-lg transition-colors ${
        highlighted ? "ring-1 ring-primary/50 bg-primary/5" : "hover:bg-muted/20"
      }`}
    >
      <Avatar className="h-6 w-6 flex-shrink-0 mt-0.5">
        {msg.userAvatarUrl && <AvatarImage src={msg.userAvatarUrl} />}
        <AvatarFallback className="text-[9px]">{initials(msg.userName)}</AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="text-xs font-semibold text-foreground">{msg.userName}</span>
          <span className="text-[10px] text-muted-foreground">
            {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
          </span>
          {msg.isEdited && <span className="text-[9px] text-muted-foreground/50">(edited)</span>}
          {isPinned && <Pin className="h-2.5 w-2.5 text-primary/50 ml-0.5" />}
        </div>

        {editing ? (
          <div className="mt-1 flex gap-1.5">
            <Textarea
              value={editDraft}
              onChange={e => setEditDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitEdit(); }
                if (e.key === "Escape") setEditing(false);
              }}
              rows={1}
              className="min-h-[32px] max-h-20 resize-none text-xs py-1"
              autoFocus
              data-testid={`record-msg-edit-${msg.id}`}
            />
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={commitEdit} data-testid={`record-msg-edit-confirm-${msg.id}`}>
              <Check className="h-3 w-3" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditing(false)} data-testid={`record-msg-edit-cancel-${msg.id}`}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words mt-0.5">
            {renderMentionBody(msg.body || "", myUserId)}
          </p>
        )}

        {/* Attachments */}
        <CurrentAttachmentChips attachments={msg.attachments ?? []} />

        {/* Structured badges */}
        {(msg.structuredItems?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {msg.structuredItems!.map((si) => (
              <span
                key={si.itemType}
                data-testid={`record-structured-badge-${si.itemType}-${msg.id}`}
                title={si.notes ?? undefined}
                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium ${REC_STRUCTURED_BADGE_STYLE[si.itemType]}`}
              >
                <Bookmark className="w-2 h-2" />
                {si.itemType.charAt(0).toUpperCase() + si.itemType.slice(1)}
                {si.notes && <span className="opacity-60 ml-0.5">·</span>}
              </span>
            ))}
          </div>
        )}

        {/* Reactions */}
        {msg.reactions.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {msg.reactions.map(r => (
              <button
                key={r.emoji}
                onClick={() => onReact(msg.id, r.emoji)}
                className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
                  r.reacted
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border/40 bg-muted/20 hover:bg-muted/40"
                }`}
                data-testid={`reaction-${msg.id}-${r.emoji}`}
              >
                {r.emoji} <span className="text-[10px]">{r.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Reply count chip */}
        {msg.replyCount > 0 && (
          <button
            onClick={() => onOpenThread(msg.id)}
            className="flex items-center gap-1 mt-1 text-xs text-primary hover:underline"
            data-testid={`thread-btn-${msg.id}`}
          >
            <MessagesSquare className="h-3 w-3" />
            {msg.replyCount} {msg.replyCount === 1 ? "reply" : "replies"}
            {msg.latestReplyAt && (
              <span className="text-muted-foreground/60 ml-0.5">
                · {formatDistanceToNow(new Date(msg.latestReplyAt), { addSuffix: true })}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Hover actions */}
      <div className="flex-shrink-0 flex items-start gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity pt-0.5">
        <button
          ref={emojiAnchorRef as any}
          onClick={() => setEmojiOpen(o => !o)}
          className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          data-testid={`emoji-btn-${msg.id}`}
        >
          <Smile className="h-3 w-3" />
        </button>
        <button
          onClick={() => onOpenThread(msg.id)}
          className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          title="Reply in thread"
          data-testid={`thread-icon-btn-${msg.id}`}
        >
          <MessageSquare className="h-3 w-3" />
        </button>
        {onCreateTask && !msg.deletedAt && (
          <button
            onClick={() => onCreateTask(msg)}
            className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10 transition-colors"
            title="Create Task"
            data-testid={`create-task-btn-${msg.id}`}
          >
            <CheckSquare className="h-3 w-3" />
          </button>
        )}
        {(onMarkStructured || onUnmarkStructured || onMarkWithNote) && !msg.deletedAt && (
          <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                title="Mark as Decision / Risk / Requirement"
                data-testid={`mark-structured-btn-${msg.id}`}
                className={`h-5 w-5 flex items-center justify-center rounded transition-colors ${
                  (msg.structuredItems?.length ?? 0) > 0
                    ? "text-violet-400 bg-violet-500/10 hover:bg-violet-500/20"
                    : "text-muted-foreground hover:text-violet-400 hover:bg-violet-500/10"
                }`}
              >
                <Bookmark className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="w-44 z-50">
              <DropdownMenuLabel className="text-[10px] py-1 text-muted-foreground font-normal">Mark as…</DropdownMenuLabel>
              {(["decision", "risk", "requirement"] as const).map((type) => {
                const isMarked = msg.structuredItems?.some((si) => si.itemType === type);
                return (
                  <DropdownMenuItem
                    key={type}
                    data-testid={`record-mark-as-${type}-${msg.id}`}
                    onClick={() => {
                      if (onMarkWithNote) {
                        const existing = msg.structuredItems?.find((si) => si.itemType === type)?.notes ?? "";
                        setRecNoteDialogType(type);
                        setRecNoteText(existing ?? "");
                      } else {
                        isMarked ? onUnmarkStructured?.(msg.id, type) : onMarkStructured?.(msg.id, type);
                      }
                    }}
                    className="text-xs gap-2 cursor-pointer"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${REC_STRUCTURED_DOT_STYLE[type]}`} />
                    <span className="flex-1 capitalize">{type}</span>
                    {isMarked && <span className="text-[10px] text-primary/60">✓</span>}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {recNoteDialogType && (
            <Dialog open onOpenChange={(o) => { if (!o) { setRecNoteDialogType(null); setRecNoteText(""); } }}>
              <DialogContent className="max-w-sm" data-testid="rec-structured-note-dialog">
                <DialogHeader>
                  <DialogTitle className="text-sm flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${REC_STRUCTURED_DOT_STYLE[recNoteDialogType]}`} />
                    {msg.structuredItems?.some((si) => si.itemType === recNoteDialogType)
                      ? `Edit ${recNoteDialogType} note`
                      : `Mark as ${recNoteDialogType}`}
                  </DialogTitle>
                </DialogHeader>
                <div className="py-1">
                  <Textarea
                    value={recNoteText}
                    onChange={(e) => setRecNoteText(e.target.value.slice(0, 500))}
                    placeholder={
                      recNoteDialogType === "decision" ? "Why is this a decision?" :
                      recNoteDialogType === "risk" ? "What is the risk or concern?" :
                      "What requirement does this capture?"
                    }
                    className="text-sm resize-none min-h-[80px]"
                    autoFocus
                    data-testid="rec-structured-note-textarea"
                  />
                  <p className="text-[10px] text-muted-foreground/50 mt-1 text-right">{recNoteText.length}/500</p>
                </div>
                <DialogFooter className="gap-2 sm:gap-2">
                  {msg.structuredItems?.some((si) => si.itemType === recNoteDialogType) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-destructive hover:text-destructive hover:bg-destructive/10 mr-auto"
                      onClick={() => {
                        onUnmarkStructured?.(msg.id, recNoteDialogType);
                        setRecNoteDialogType(null);
                        setRecNoteText("");
                      }}
                      data-testid="rec-structured-note-unmark-btn"
                    >
                      Unmark
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => { setRecNoteDialogType(null); setRecNoteText(""); }}
                    data-testid="rec-structured-note-cancel-btn"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      const trimmed = recNoteText.trim().slice(0, 500) || null;
                      onMarkWithNote!(msg.id, recNoteDialogType, trimmed);
                      setRecNoteDialogType(null);
                      setRecNoteText("");
                    }}
                    data-testid="rec-structured-note-save-btn"
                  >
                    {msg.structuredItems?.some((si) => si.itemType === recNoteDialogType) ? "Update" : "Mark"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          </>
        )}
        <button
          onClick={() => onPin(msg.id, isPinned)}
          className={`h-5 w-5 flex items-center justify-center rounded transition-colors ${
            isPinned
              ? "text-primary hover:text-primary/70 hover:bg-primary/10"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
          }`}
          title={isPinned ? "Unpin" : "Pin"}
          data-testid={`pin-btn-${msg.id}`}
        >
          <Pin className={`h-3 w-3 ${isPinned ? "fill-primary/30" : ""}`} />
        </button>
        {isOwn && (
          <>
            <button
              onClick={startEdit}
              className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              data-testid={`edit-btn-${msg.id}`}
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              onClick={() => onDelete(msg.id)}
              className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
              data-testid={`delete-btn-${msg.id}`}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </>
        )}
        {emojiOpen && (
          <EmojiPicker
            anchorRef={emojiAnchorRef}
            onPick={emoji => { onReact(msg.id, emoji); }}
            onClose={() => setEmojiOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

// ── PinnedBar ─────────────────────────────────────────────────────────────────

function PinnedBar({
  pins, onUnpin,
}: {
  pins: PinnedRecord[];
  onUnpin: (messageId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (pins.length === 0) return null;
  const shown = expanded ? pins : [pins[0]];

  return (
    <div className="px-3 py-1.5 border-b border-border/40 bg-primary/[0.02] shrink-0" data-testid="record-pinned-bar">
      <div className="flex items-start gap-1.5">
        <Pin className="w-2.5 h-2.5 text-primary/50 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 space-y-0.5">
          {shown.map(pin => (
            <div key={pin.id} className="flex items-center gap-1.5 group/pin min-w-0">
              <div className="flex-1 min-w-0 flex items-baseline gap-1 overflow-hidden">
                <span className="text-[10px] font-medium text-primary/70 shrink-0">{pin.messageUserName}</span>
                <span className="text-[11px] text-foreground/55 truncate">
                  {(pin.messageBody ?? "").slice(0, 80)}{(pin.messageBody ?? "").length > 80 ? "…" : ""}
                </span>
              </div>
              <button
                onClick={() => onUnpin(pin.messageId)}
                title="Unpin"
                className="opacity-0 group-hover/pin:opacity-100 shrink-0 w-3.5 h-3.5 flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground transition-all rounded"
                data-testid={`unpin-btn-${pin.messageId}`}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
        {pins.length > 1 && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="shrink-0 flex items-center gap-0.5 text-[10px] text-primary/60 hover:text-primary transition-colors"
            data-testid="pinned-bar-toggle"
          >
            {expanded ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
            <span>{expanded ? "less" : `+${pins.length - 1}`}</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ── ThreadPanel ───────────────────────────────────────────────────────────────

function ThreadPanel({
  rootId, myUserId, objectType, objectId, pinnedIds, onPin, onClose, onCreateTask,
}: {
  rootId: number;
  myUserId: number;
  objectType: string;
  objectId: number;
  pinnedIds: Set<number>;
  onPin: (msgId: number, isPinned: boolean) => void;
  onClose: () => void;
  onCreateTask?: (msg: RecordMessage, threadRootId: number) => void;
}) {
  const { toast } = useToast();
  const apiBase = `/api/current/record/${objectType}/${objectId}`;

  const { data: threadData, isLoading } = useQuery<{ root: RecordMessage; replies: RecordMessage[] }>({
    queryKey: ["/api/current/messages", rootId, "thread"],
    queryFn: async () => {
      const r = await fetch(`/api/current/messages/${rootId}/thread`, { credentials: "include" });
      return r.json();
    },
    refetchInterval: 10000,
  });

  const replyMutation = useMutation({
    mutationFn: async ({ body, files }: { body: string; files: File[] }) => {
      const r = await apiRequest("POST", `/api/current/messages/${rootId}/thread`, { body });
      const newMsg = await r.json();
      if (files.length > 0 && newMsg?.id) {
        const result: UploadResult = await uploadCurrentAttachments(newMsg.id, files);
        if (result.failed.length > 0) {
          toast({
            title: "Some files failed to upload",
            description: result.failed.join(", "),
            variant: "destructive",
          });
        }
      }
      return newMsg;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/current/messages", rootId, "thread"] });
      queryClient.invalidateQueries({ queryKey: [apiBase + "/messages"] });
    },
    onError: () => toast({ title: "Failed to send reply", variant: "destructive" }),
  });

  const reactMutation = useMutation({
    mutationFn: async ({ msgId, emoji }: { msgId: number; emoji: string }) => {
      const r = await apiRequest("POST", "/api/current/reactions", { messageId: msgId, emoji });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/current/messages", rootId, "thread"] });
    },
  });

  const editMutation = useMutation({
    mutationFn: async ({ msgId, body }: { msgId: number; body: string }) => {
      const r = await apiRequest("PATCH", `/api/current/messages/${msgId}`, { body });
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/current/messages", rootId, "thread"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (msgId: number) => {
      const r = await apiRequest("DELETE", `/api/current/messages/${msgId}`);
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/current/messages", rootId, "thread"] }),
  });

  const allMsgs = threadData ? [threadData.root, ...threadData.replies] : [];
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [allMsgs.length]);

  return (
    <Sheet open onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-[380px] p-0 flex flex-col" data-testid="record-thread-panel">
        <SheetHeader className="px-4 py-3 border-b border-border/50 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 -ml-1" onClick={onClose} data-testid="record-thread-close">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <SheetTitle className="text-sm font-semibold">Thread</SheetTitle>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-3 space-y-1">
            {isLoading && (
              <div className="py-8 text-center text-xs text-muted-foreground">Loading…</div>
            )}
            {allMsgs.map((m, i) => (
              <div key={m.id}>
                <MessageItem
                  msg={m}
                  myUserId={myUserId}
                  highlighted={false}
                  isPinned={pinnedIds.has(m.id)}
                  onReact={(msgId, emoji) => reactMutation.mutate({ msgId, emoji })}
                  onEdit={(msgId, body) => editMutation.mutate({ msgId, body })}
                  onDelete={msgId => deleteMutation.mutate(msgId)}
                  onOpenThread={() => {}}
                  onPin={onPin}
                  onCreateTask={(m) => onCreateTask?.(m, rootId)}
                  onMarkStructured={(msgId, itemType) =>
                    apiRequest("POST", `/api/current/messages/${msgId}/structured`, { itemType })
                      .then(() => {
                        queryClient.invalidateQueries({ queryKey: ["/api/current/messages", rootId, "thread"] });
                        queryClient.invalidateQueries({ queryKey: [apiBase + "/messages"] });
                      })
                  }
                  onUnmarkStructured={(msgId, itemType) =>
                    apiRequest("DELETE", `/api/current/messages/${msgId}/structured/${itemType}`)
                      .then(() => {
                        queryClient.invalidateQueries({ queryKey: ["/api/current/messages", rootId, "thread"] });
                        queryClient.invalidateQueries({ queryKey: [apiBase + "/messages"] });
                      })
                  }
                  onMarkWithNote={(msgId, itemType, notes) =>
                    apiRequest("POST", `/api/current/messages/${msgId}/structured`, { itemType, notes })
                      .then(() => {
                        queryClient.invalidateQueries({ queryKey: ["/api/current/messages", rootId, "thread"] });
                        queryClient.invalidateQueries({ queryKey: [apiBase + "/messages"] });
                        queryClient.invalidateQueries({ queryKey: ["/api/current/structured"] });
                      })
                  }
                />
                {i === 0 && allMsgs.length > 1 && (
                  <div className="ml-8 my-1 border-l-2 border-border/30 pl-2 text-[10px] text-muted-foreground">
                    {allMsgs.length - 1} {allMsgs.length - 1 === 1 ? "reply" : "replies"}
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        <div className="p-3 border-t border-border/50 flex-shrink-0">
          <MessageComposer
            onSend={(body, files) => replyMutation.mutate({ body, files })}
            placeholder="Reply…"
            disabled={replyMutation.isPending}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}


// ── RecordStructuredPanel ─────────────────────────────────────────────────────

interface RecStructuredItem {
  id: number;
  messageId: number;
  itemType: "decision" | "risk" | "requirement";
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
  messageBody: string | null;
  messageCreatedAt: string;
  authorName: string | null;
  actionUrl: string | null;
}

const REC_STRUCT_FILTER_ITEMS = [
  { value: "all" as const, label: "All" },
  { value: "decision" as const, label: "Decisions" },
  { value: "risk" as const, label: "Risks" },
  { value: "requirement" as const, label: "Requirements" },
];

function RecordStructuredPanel({ objectType, objectId }: { objectType: string; objectId: number }) {
  const [filter, setFilter] = useState<"all" | "decision" | "risk" | "requirement">("all");

  const params = new URLSearchParams({
    scope: "record",
    objectType,
    objectId: String(objectId),
    limit: "50",
  });
  if (filter !== "all") params.set("itemType", filter);

  const { data = [], isLoading, isError } = useQuery<RecStructuredItem[]>({
    queryKey: ["/api/current/structured", "record", objectType, objectId, filter],
    queryFn: () =>
      fetch(`/api/current/structured?${params}`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 30_000,
  });

  const filterLabel =
    filter === "decision" ? "decisions" :
    filter === "risk" ? "risks" :
    filter === "requirement" ? "requirements" : "structured items";

  const chipActive: Record<string, string> = {
    all: "bg-foreground/10 text-foreground border-border/50",
    decision: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    risk: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    requirement: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  };

  return (
    <div className="flex flex-col h-full">
      {/* Filter chips */}
      <div className="px-3 pt-2 pb-1.5 shrink-0 flex items-center gap-1.5 flex-wrap border-b border-border/30">
        {REC_STRUCT_FILTER_ITEMS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            data-testid={`rec-structured-filter-${value}`}
            className={`px-2 py-0.5 rounded-full text-[10.5px] font-medium border transition-colors ${
              filter === value
                ? chipActive[value]
                : "text-muted-foreground border-border/20 hover:border-border/60 hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto px-2 py-2" data-testid="rec-structured-items-list">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 text-muted-foreground/40 animate-spin" />
          </div>
        ) : isError ? (
          <div className="flex items-center justify-center py-8 px-3 text-center">
            <p className="text-[12px] text-muted-foreground/70">Could not load structured items. Try again.</p>
          </div>
        ) : data.length === 0 ? (
          <div className="flex flex-col items-center py-8 px-3 text-center select-none">
            <Bookmark className="w-6 h-6 text-muted-foreground/30 mb-2" />
            <p className="text-[12px] font-medium text-foreground/60 mb-0.5">
              {filter === "all" ? "No structured items yet" :
               filter === "decision" ? "No decisions marked yet" :
               filter === "risk" ? "No risks marked yet" :
               "No requirements marked yet"}
            </p>
            <p className="text-[11px] text-muted-foreground/50 mt-0.5">
              Mark messages as {filterLabel} using the bookmark icon.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {data.map((item) => (
              <div
                key={item.id}
                data-testid={`rec-structured-item-${item.id}`}
                className="rounded-lg border border-border/40 hover:border-border/70 bg-muted/[0.03] hover:bg-muted/15 transition-all p-2.5 group"
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium ${REC_STRUCTURED_BADGE_STYLE[item.itemType]}`}>
                    <Bookmark className="w-2 h-2" />
                    {item.itemType.charAt(0).toUpperCase() + item.itemType.slice(1)}
                  </span>
                  <span className="text-[10px] text-muted-foreground/40 ml-auto shrink-0 tabular-nums">
                    {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                  </span>
                </div>
                {item.messageBody && (
                  <p className="text-[11.5px] text-foreground/75 leading-relaxed line-clamp-2 mb-1.5">
                    {item.messageBody}
                  </p>
                )}
                {item.notes && (
                  <p className="text-[10.5px] text-muted-foreground/55 italic line-clamp-1 mb-1.5 border-t border-border/20 pt-1.5">
                    {item.notes}
                  </p>
                )}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10.5px] text-muted-foreground/60 flex-1 min-w-0 truncate">
                    {item.authorName ?? "Unknown"}
                    {item.createdByName && item.createdByName !== item.authorName && (
                      <span className="text-[10px] text-muted-foreground/40"> · marked by {item.createdByName}</span>
                    )}
                  </span>
                  {item.actionUrl && (
                    <button
                      onClick={() => { window.location.href = item.actionUrl!; }}
                      data-testid={`rec-structured-view-btn-${item.id}`}
                      className="shrink-0 text-[10.5px] text-primary/40 hover:text-primary font-medium transition-colors group-hover:text-primary/70"
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

// ── RecordCurrentFeed (main export) ──────────────────────────────────────────

export function RecordCurrentFeed({ objectType, objectId, initialMessageId, initialThreadId }: RecordCurrentFeedProps) {
  const { toast } = useToast();
  const apiBase = `/api/current/record/${objectType}/${objectId}`;
  const [threadRootId, setThreadRootId] = useState<number | null>(initialThreadId ?? null);
  const [highlightedMsgId, setHighlightedMsgId] = useState<number | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasHighlightedRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Inline search
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const { data: searchResults = [], isLoading: searchLoading } = useQuery<any[]>({
    queryKey: ["/api/current/search", "record", objectType, objectId, debouncedSearch],
    queryFn: () =>
      fetch(
        `/api/current/search?q=${encodeURIComponent(debouncedSearch)}&scope=record&objectType=${objectType}&objectId=${objectId}&limit=50`,
        { credentials: "include" }
      ).then((r) => r.json()),
    enabled: debouncedSearch.length > 0,
    staleTime: 30_000,
  });

  // Session user
  const { data: me } = useQuery<{ id: number }>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => { const r = await fetch("/api/auth/me", { credentials: "include" }); return r.json(); },
  });
  const myUserId = me?.id ?? 0;

  // Messages
  const { data: messages = [], isLoading } = useQuery<RecordMessage[]>({
    queryKey: [apiBase + "/messages"],
    queryFn: async () => {
      const r = await fetch(apiBase + "/messages", { credentials: "include" });
      return r.json();
    },
    refetchInterval: 8000,
  });

  // Pins
  const { data: pins = [] } = useQuery<PinnedRecord[]>({
    queryKey: [apiBase + "/pins"],
    queryFn: async () => {
      const r = await fetch(apiBase + "/pins", { credentials: "include" });
      return r.json();
    },
    refetchInterval: 15000,
  });

  const pinnedIds = new Set(pins.map(p => p.messageId));

  // Mark read on mount + whenever messages load
  useEffect(() => {
    if (!messages.length) return;
    fetch(apiBase + "/read", { method: "POST", credentials: "include" }).catch(() => {});
  }, [messages.length, apiBase]);

  // Auto-scroll on new messages (bottom) — only when no initial message target
  useEffect(() => {
    if (initialMessageId) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Deep-link: highlight target message once when it becomes available
  function setHighlight(msgId: number) {
    clearTimeout(highlightTimerRef.current ?? undefined);
    setHighlightedMsgId(msgId);
    highlightTimerRef.current = setTimeout(() => setHighlightedMsgId(null), 3500);
  }

  useEffect(() => {
    if (!initialMessageId || hasHighlightedRef.current) return;
    // The main message list only contains top-level messages (parent_message_id IS NULL).
    // When initialMessageId is a thread reply, it won't be in the list.
    // Fall back to initialThreadId (the root) so the scroll/highlight still lands visibly.
    const highlightTarget = initialThreadId ?? initialMessageId;
    if (messages.some(m => m.id === highlightTarget)) {
      hasHighlightedRef.current = true;
      setTimeout(() => {
        const el = document.getElementById(`record-msg-${highlightTarget}`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlight(highlightTarget);
      }, 150);
    }
  }, [messages.length]);

  // Deep-link: open thread if initialThreadId provided (already in useState initial value)
  // but also handle late open if thread param arrives after render
  useEffect(() => {
    if (initialThreadId && threadRootId === null) setThreadRootId(initialThreadId);
  }, [initialThreadId]);

  const [createTaskSource, setCreateTaskSource] = useState<CreateTaskSource | null>(null);
  const [showStructured, setShowStructured] = useState(false);

  function handleCreateTaskFromRecordMsg(msg: RecordMessage, threadRootId?: number): void {
    setCreateTaskSource({
      kind: "record_message",
      messageId: msg.id,
      body: msg.body,
      userName: msg.userName,
      createdAt: msg.createdAt,
      objectType,
      objectId,
      threadRootId,
    });
  }

  // Record AI summary
  const [recordSummaryOpen, setRecordSummaryOpen] = useState(false);
  const [recordSummaryData, setRecordSummaryData] = useState<CurrentSummaryData | null>(null);
  const recordSummaryMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/current/summary", {
        scope: "record",
        objectType,
        objectId,
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).message || "AI summary failed"); }
      return r.json() as Promise<CurrentSummaryData>;
    },
    onSuccess: (data) => { setRecordSummaryData(data); setRecordSummaryOpen(true); },
    onError: () => { setRecordSummaryOpen(true); setRecordSummaryData(null); },
  });

  // Mutations
  const postMutation = useMutation({
    mutationFn: async ({ body, files }: { body: string; files: File[] }) => {
      const r = await apiRequest("POST", apiBase + "/messages", { body });
      const newMsg = await r.json();
      if (files.length > 0 && newMsg?.id) {
        const result: UploadResult = await uploadCurrentAttachments(newMsg.id, files);
        if (result.failed.length > 0) {
          toast({
            title: "Some files failed to upload",
            description: result.failed.join(", "),
            variant: "destructive",
          });
        }
      }
      return newMsg;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [apiBase + "/messages"] }),
    onError: () => toast({ title: "Failed to send", variant: "destructive" }),
  });

  const reactMutation = useMutation({
    mutationFn: async ({ msgId, emoji }: { msgId: number; emoji: string }) => {
      const r = await apiRequest("POST", "/api/current/reactions", { messageId: msgId, emoji });
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [apiBase + "/messages"] }),
  });

  const editMutation = useMutation({
    mutationFn: async ({ msgId, body }: { msgId: number; body: string }) => {
      const r = await apiRequest("PATCH", `/api/current/messages/${msgId}`, { body });
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [apiBase + "/messages"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (msgId: number) => {
      const r = await apiRequest("DELETE", `/api/current/messages/${msgId}`);
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [apiBase + "/messages"] }),
  });

  const pinMutation = useMutation({
    mutationFn: async ({ msgId, isPinned }: { msgId: number; isPinned: boolean }) => {
      if (isPinned) {
        return apiRequest("DELETE", `/api/current/messages/${msgId}/pin`);
      } else {
        return apiRequest("POST", `/api/current/messages/${msgId}/pin`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [apiBase + "/pins"] });
      queryClient.invalidateQueries({ queryKey: [apiBase + "/messages"] });
    },
    onError: () => toast({ title: "Failed to update pin", variant: "destructive" }),
  });

  function handlePin(msgId: number, isPinned: boolean) {
    pinMutation.mutate({ msgId, isPinned });
  }

  const markStructuredMutation = useMutation({
    mutationFn: async ({ messageId, itemType, notes }: { messageId: number; itemType: string; notes?: string | null }) => {
      const r = await apiRequest("POST", `/api/current/messages/${messageId}/structured`, { itemType, notes });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [apiBase + "/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/current/structured"] });
    },
  });

  const unmarkStructuredMutation = useMutation({
    mutationFn: async ({ messageId, itemType }: { messageId: number; itemType: string }) => {
      return apiRequest("DELETE", `/api/current/messages/${messageId}/structured/${itemType}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [apiBase + "/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/current/structured"] });
    },
  });

  return (
    <div className="flex flex-col h-full min-h-[320px]" data-testid={`record-current-feed-${objectType}-${objectId}`}>
      {/* Pinned bar */}
      <PinnedBar
        pins={pins}
        onUnpin={msgId => pinMutation.mutate({ msgId, isPinned: true })}
      />

      {/* Compact inline search + AI summary button row */}
      <div className="px-2 pt-1.5 pb-1 shrink-0 flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/40 pointer-events-none" />
          <input
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); if (showStructured) setShowStructured(false); }}
            placeholder="Search this Current…"
            className="w-full pl-6 pr-6 py-1 text-[11.5px] rounded-md border bg-muted/20 border-border/30 text-foreground placeholder:text-muted-foreground/35 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
            data-testid="record-current-search-input"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              data-testid="record-current-search-clear"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <button
          onClick={() => { setShowStructured(v => !v); if (!showStructured) setRecordSummaryOpen(false); }}
          data-testid="btn-structured-record"
          title="Structured items (Decisions, Risks, Requirements)"
          className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
            showStructured
              ? "bg-primary/10 text-primary/80 hover:bg-primary/15"
              : "text-muted-foreground/40 hover:text-foreground hover:bg-muted/60"
          }`}
        >
          <Bookmark className="w-3 h-3" />
          <span className="hidden sm:inline">Structured</span>
        </button>
        <button
          onClick={() => {
            if (recordSummaryOpen) {
              setRecordSummaryOpen(false);
            } else {
              setRecordSummaryData(null);
              recordSummaryMutation.mutate();
            }
          }}
          disabled={recordSummaryMutation.isPending}
          title="Summarize this record's Current"
          data-testid="btn-summarize-record-current"
          className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
            recordSummaryOpen
              ? "bg-primary/10 text-primary/80 hover:bg-primary/15"
              : "text-muted-foreground/40 hover:text-foreground hover:bg-muted/60"
          }`}
        >
          {recordSummaryMutation.isPending
            ? <Loader2 className="w-3 h-3 animate-spin" />
            : <Sparkles className="w-3 h-3" />}
          <span className="hidden sm:inline">Summary</span>
        </button>
      </div>

      {/* Record AI Summary panel */}
      {recordSummaryOpen && (
        <div className="px-2 pb-1 shrink-0">
          <CurrentSummaryPanel
            data={recordSummaryData}
            isLoading={recordSummaryMutation.isPending}
            isError={recordSummaryMutation.isError}
            onClose={() => setRecordSummaryOpen(false)}
            onRegenerate={() => { setRecordSummaryData(null); recordSummaryMutation.mutate(); }}
            onCreateTask={(item) => setCreateTaskSource({ kind: "summary_action_item", task: item.task, owner: item.owner, due: item.due, summaryContext: `${objectType} record Currents`, objectType, objectId })}
          />
        </div>
      )}

      {/* Message list — or search results overlay */}
      <div className="flex-1 overflow-y-auto min-h-0 pr-0.5">
        {showStructured ? (
          /* ── Structured items ── */
          <RecordStructuredPanel objectType={objectType} objectId={objectId} />
        ) : debouncedSearch ? (
          /* ── Search results ── */
          searchLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-4 h-4 text-muted-foreground/40 animate-spin" />
            </div>
          ) : searchResults.length === 0 ? (
            <div className="flex flex-col items-center py-8 px-4 text-center select-none">
              <p className="text-[12px] text-muted-foreground/60">
                No results for &ldquo;{debouncedSearch}&rdquo;
              </p>
            </div>
          ) : (
            searchResults.map((r: any) => (
              <button
                key={r.id}
                onClick={() => {
                  setSearchQuery("");
                  if (r.parentMessageId) setThreadRootId(r.parentMessageId);
                  setHighlightedMsgId(r.id);
                  setTimeout(() => {
                    const el = document.getElementById(`record-msg-${r.id}`);
                    el?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }, 120);
                }}
                className="w-full text-left px-2 py-1.5 hover:bg-muted/30 rounded-lg transition-colors border-b border-border/20 last:border-0"
                data-testid={`record-search-result-${r.id}`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[11px] font-medium text-foreground/70 truncate flex-1">
                    {r.userName}
                  </span>
                  {r.isReply && (
                    <span className="text-[10px] text-muted-foreground/50 shrink-0">thread</span>
                  )}
                  <span className="text-[10px] text-muted-foreground/40 tabular-nums shrink-0">
                    {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}
                  </span>
                </div>
                <p className="text-[11.5px] text-foreground/70 line-clamp-2 break-words">
                  {r.snippet
                    ? highlightSnippet(r.snippet, debouncedSearch)
                    : r.matchedAttachment
                    ? <span className="text-muted-foreground/50 italic flex items-center gap-1"><Paperclip className="w-2.5 h-2.5 shrink-0" />Matched in attached file</span>
                    : ""}
                </p>
              </button>
            ))
          )
        ) : (
          /* ── Normal message list ── */
          <>
            {isLoading && (
              <div className="flex flex-col gap-2 p-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="flex gap-2.5 animate-pulse">
                    <div className="h-6 w-6 rounded-full bg-muted flex-shrink-0" />
                    <div className="flex-1 space-y-1">
                      <div className="h-2.5 bg-muted rounded w-24" />
                      <div className="h-2.5 bg-muted rounded w-3/4" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!isLoading && messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 px-4 gap-2" data-testid="record-current-empty">
                <MessageSquare className="h-7 w-7 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No messages yet</p>
                <p className="text-xs text-muted-foreground/60">Start the conversation below</p>
              </div>
            )}

            {messages.map(msg => (
              <MessageItem
                key={msg.id}
                msg={msg}
                myUserId={myUserId}
                highlighted={highlightedMsgId === msg.id}
                isPinned={pinnedIds.has(msg.id)}
                onReact={(msgId, emoji) => reactMutation.mutate({ msgId, emoji })}
                onEdit={(msgId, body) => editMutation.mutate({ msgId, body })}
                onDelete={msgId => deleteMutation.mutate(msgId)}
                onOpenThread={msgId => setThreadRootId(msgId)}
                onPin={handlePin}
                onCreateTask={(m) => handleCreateTaskFromRecordMsg(m)}
                onMarkStructured={(msgId, itemType) => markStructuredMutation.mutate({ messageId: msgId, itemType })}
                onUnmarkStructured={(msgId, itemType) => unmarkStructuredMutation.mutate({ messageId: msgId, itemType })}
                onMarkWithNote={(msgId, itemType, notes) => markStructuredMutation.mutate({ messageId: msgId, itemType, notes })}
              />
            ))}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Composer */}
      <div className="flex-shrink-0 pt-2 border-t border-border/30 mt-1">
        <MessageComposer
          onSend={(body, files) => postMutation.mutate({ body, files })}
          disabled={postMutation.isPending}
        />
      </div>

      <CreateTaskFromCurrentDialog
        open={createTaskSource !== null}
        source={createTaskSource}
        onClose={() => setCreateTaskSource(null)}
      />

      {/* Thread panel */}
      {threadRootId !== null && (
        <ThreadPanel
          rootId={threadRootId}
          myUserId={myUserId}
          objectType={objectType}
          objectId={objectId}
          pinnedIds={pinnedIds}
          onPin={handlePin}
          onClose={() => setThreadRootId(null)}
          onCreateTask={handleCreateTaskFromRecordMsg}
        />
      )}
    </div>
  );
}
