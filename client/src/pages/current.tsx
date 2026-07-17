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
  Lock,
  FileText,
  Upload,
  ImageIcon,
  ChevronLeft,
  ChevronRight,
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
  CurrentAttachmentChips, PendingFileChips, uploadCurrentAttachments, FilesTabAttachments,
} from "@/components/current/current-attachment-display";
import type { CurrentAttachment } from "@/components/current/current-attachment-display";
import { CurrentSummaryPanel } from "@/components/current/current-summary-panel";
import { tokensToCleanText } from "@/hooks/use-mention-composer";
import type { CurrentSummaryData } from "@/components/current/current-summary-panel";
import { CreateTaskFromCurrentDialog } from "@/components/current/create-task-from-current-dialog";
import type { CreateTaskSource } from "@/components/current/create-task-from-current-dialog";
import { CurrentFilesTab } from "@/components/current/current-files-tab";
import {
  useSlashCommand,
  SlashCommandMenu,
  SlashCommandPill,
  CHANNEL_COMMANDS,
  DM_COMMANDS,
  THREAD_COMMANDS,
} from "@/components/current/slash-command-menu";

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
  resultType?: "message" | "file" | "channel" | "person";
  id?: number;
  parentMessageId?: number | null;
  snippet?: string;
  userName?: string;
  userId?: number;
  createdAt?: string;
  channelSlug?: string | null;
  channelName?: string | null;
  conversationId?: number | null;
  isChannelArchived?: boolean;
  objectType?: string | null;
  objectId?: number | null;
  attachmentNames?: string[];
  matchedAttachment?: boolean;
  actionUrl?: string | null;
  isReply?: boolean;
  // file-specific
  attachmentId?: number;
  originalName?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  uploaderName?: string;
  messageId?: number;
  downloadUrl?: string;
  // channel-specific
  isPrivate?: boolean;
  description?: string | null;
  lastActivityAt?: string | null;
  // person-specific
  displayName?: string;
  email?: string;
  avatarUrl?: string | null;
}

interface SearchResponse {
  items: SearchResult[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EMOJI_DATA: { id: string; label: string; icon: string; emojis: string[] }[] = [
  { id: "smileys", label: "Smileys & Emotions", icon: "😀", emojis: ["😀","😃","😄","😁","😅","😂","🤣","😊","😇","🙂","😉","😌","😍","🥰","😘","😗","😙","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🤩","🥳","😏","😒","😔","😟","😕","🙁","😣","😫","😩","🥺","😢","😭","😤","😠","😡","🤬","🤯","😳","😱","😨","😰","😥","😓","🤗","🤔","🤫","🤥","😶","😐","😑","😬","🙄","😯","😮","😲","🥱","😴","🤤","😵","🤐","🥴","🤢","🤮","🤧","😷","🤒","🤕","🤑","🤠","😈","👿","💩","👻","💀","☠️","👽","🤖"] },
  { id: "people", label: "People & Hands", icon: "👋", emojis: ["👋","🤚","🖐","✋","🖖","👌","🤌","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","👇","☝️","👍","👎","✊","👊","🤛","🤜","👏","🙌","🫶","👐","🤲","🙏","✍️","💅","💪","🦵","🦶","👂","🦻","👃","👁","👀","👶","🧒","👦","👧","🧑","👱","👨","🧔","👩","🧓","👴","👵","👮","💂","🕵️","👷","🎅","🤶","🦸","🦹","🧙","🧝","🧛","🧟","🧞","🧜","🧚","👼","💃","🕺"] },
  { id: "nature", label: "Animals & Nature", icon: "🌿", emojis: ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🙈","🙉","🙊","🐔","🐧","🐦","🦆","🦅","🦉","🦇","🐺","🐗","🐴","🦄","🐝","🐛","🦋","🐌","🐞","🐜","🦗","🦂","🐢","🐍","🦎","🐙","🦑","🦐","🦞","🦀","🐡","🐠","🐟","🐬","🐳","🐋","🦈","🌸","🌹","🌺","🌻","🌼","🌷","🌱","🌲","🌳","🌴","🌵","🍀","🍁","🍂","🍃","🌊","🔥","⚡","❄️","🌈","⭐","🌙","☀️","⛅","🌧","⛈","🌩","🌨"] },
  { id: "food", label: "Food & Drink", icon: "🍕", emojis: ["🍎","🍊","🍋","🍇","🍓","🍒","🍑","🥭","🍍","🥝","🍅","🫐","🥑","🍆","🥦","🥕","🌽","🌶","🥒","🧅","🥔","🥐","🍞","🥖","🧀","🥚","🍳","🥞","🧇","🥓","🥩","🍗","🍖","🌭","🍔","🍟","🍕","🌮","🌯","🥙","🍱","🍜","🍝","🍛","🍲","🍣","🍤","🦐","🦑","🍦","🍧","🍨","🍩","🍪","🎂","🍰","🧁","🍫","🍬","🍭","🍮","☕","🍵","🧃","🥤","🧋","🍺","🥂","🍷","🥃","🍸","🍹","🍾"] },
  { id: "activity", label: "Activities", icon: "⚽", emojis: ["⚽","🏀","🏈","⚾","🎾","🏐","🏉","🎱","🏓","🏸","🥅","🏒","🏑","🥊","🥋","🎽","🛹","🛷","⛸","🎿","🎯","🎲","♟","🎮","🎰","🎭","🎨","🎬","🎤","🎧","🎼","🎹","🥁","🎷","🎺","🎸","🎵","🎶","🏆","🥇","🥈","🥉","🏅","🎖","🎁","🎀","🎊","🎉","🎈","✨","🎇","🎆","🎃","🎄","🎋","🎍","🎑","🎐"] },
  { id: "travel", label: "Travel & Places", icon: "✈️", emojis: ["🚗","🚕","🚙","🚌","🚎","🏎","🚓","🚑","🚒","🚐","🚚","🚛","🚜","🛵","🏍","🚲","🛴","🚁","⛵","🚤","🛥","🚢","✈️","🛩","🚀","🛸","🏠","🏡","🏢","🏥","🏦","🏨","🏪","🏫","🏬","🏯","🏰","⛪","🕌","🕍","⛩","🏔","🌋","🏕","🏖","🏜","🏝","🌐","🗺","🧭","🌍","🌎","🌏","🗽","🗼","🏟","🏛","🌃","🌆","🌇","🌉","🌌","🌠"] },
  { id: "objects", label: "Objects", icon: "💡", emojis: ["⌚","📱","💻","⌨️","🖥","🖨","🖱","💽","💾","💿","📺","📷","📸","📹","🎥","📞","☎️","📟","⏰","🕰","⌛","⏳","🔋","🔌","💡","🔦","🕯","🧲","💈","🧰","🔧","🔨","⚒","🛠","⛏","🔩","🔑","🗝","🔐","🔒","🔓","📝","✏️","🖊","📖","📚","📋","📌","📍","📎","📏","📐","✂️","📊","📈","📉","💰","💳","💎","👑","🏺","🎩","💄","💍","💼","🎒","👜","🧳","🛍","🛒"] },
  { id: "symbols", label: "Symbols & Signs", icon: "❤️", emojis: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","💯","✅","❎","⚠️","🚫","🔴","🟠","🟡","🟢","🔵","🟣","⚫","⚪","♻️","🔔","🔕","💬","💭","🗯","❗","❕","❓","❔","‼️","⁉️","➕","➖","✖️","➗","🔁","🔀","🔃","🔄","▶️","⏸","⏹","⏺","🔝","🆗","🆙","🆒","🆕","🆓","💤","📵","🚳","🚭","🚯"] },
];

const EMOJI_KEYWORDS: Record<string, string> = {
  "😀":"happy smile grin","😂":"laugh cry funny lol","😊":"smile happy","😍":"love heart eyes","😎":"cool sunglasses awesome","😭":"cry sad sob","😡":"angry mad furious","🤔":"thinking hmm","😴":"sleep tired","🤯":"mind blown shock","🤮":"sick vomit","😷":"mask sick ill","😈":"devil evil","💩":"poop",
  "👍":"thumbs up good yes like","👎":"thumbs down no dislike","❤️":"heart love","🔥":"fire hot flame","✅":"check done yes correct","👀":"eyes look see watching","🎉":"party celebrate","🚀":"rocket launch fast","💯":"100 perfect","🙏":"pray thanks please","💪":"strong muscle","👏":"clap applause",
  "🙌":"raise hands celebrate","🫶":"heart hands love","✌️":"peace victory two","🤞":"fingers crossed luck","🤙":"call me hangloose","👋":"wave hello hi bye",
  "🎊":"confetti celebrate party","🎈":"balloon party","🏆":"trophy win champion first","⭐":"star","💡":"idea light bulb","💎":"diamond gem jewel","💰":"money cash","🔑":"key","🎯":"target bullseye aim","📈":"chart up growth","📉":"chart down",
  "⚡":"lightning fast energy bolt","🌊":"wave water ocean","🌈":"rainbow","❄️":"snow cold winter ice","🌹":"rose flower","🌺":"flower bloom","🍀":"lucky clover","🦄":"unicorn magic",
  "🐶":"dog puppy","🐱":"cat kitten","🎮":"game controller","🍕":"pizza food","🍺":"beer drink","☕":"coffee hot drink","🥂":"cheers toast celebrate","🏠":"home house","🌍":"earth world globe",
  "🎤":"mic microphone sing","🎸":"guitar music","🎵":"music note","🎶":"music notes","🏅":"medal award","🎁":"gift present","🧠":"brain think","🔮":"crystal ball magic","🗺":"map travel","🧭":"compass navigate",
};

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

function formatDateDivider(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dateMid = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (dateMid === todayMid) return "Today";
  if (dateMid === todayMid - 86400000) return "Yesterday";
  return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function msgIsNewDay(prevDate: string | undefined, currDate: string): boolean {
  if (!prevDate) return true;
  const a = new Date(prevDate); const b = new Date(currDate);
  return a.getFullYear() !== b.getFullYear() || a.getMonth() !== b.getMonth() || a.getDate() !== b.getDate();
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

// ── MemberPickerInline ────────────────────────────────────────────────────────
// Lightweight member search + chip picker for create/edit channel dialogs.
function MemberPickerInline({
  selectedIds,
  onChange,
  excludeIds = [],
}: {
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  excludeIds?: number[];
}) {
  const [q, setQ] = useState("");
  const { data: users = [] } = useQuery<MentionUser[]>({
    queryKey: ["/api/current/users", q],
    queryFn: () =>
      fetch(`/api/current/users?q=${encodeURIComponent(q)}`, { credentials: "include" }).then((r) => r.json()),
    staleTime: 10_000,
  });
  const nameMapRef = useRef<Record<number, string>>({});
  users.forEach((u) => { nameMapRef.current[u.id] = u.name; });
  const allExcluded = new Set([...excludeIds, ...selectedIds]);
  const suggestions = users.filter((u) => !allExcluded.has(u.id));

  return (
    <div className="space-y-2">
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedIds.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-primary/15 text-primary border border-primary/20">
              {nameMapRef.current[id] ?? `#${id}`}
              <button type="button" onClick={() => onChange(selectedIds.filter((i) => i !== id))} className="opacity-60 hover:opacity-100" data-testid={`remove-member-${id}`}>
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        data-testid="input-member-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search teammates…"
        className="h-7 text-[12px]"
      />
      {q.length > 0 && suggestions.length > 0 && (
        <div className="border border-border/60 rounded-md overflow-hidden bg-popover">
          {suggestions.slice(0, 6).map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => { onChange([...selectedIds, u.id]); setQ(""); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left hover:bg-muted/60 transition-colors"
              data-testid={`member-suggestion-${u.id}`}
            >
              <span className="font-medium">{u.name}</span>
              <span className="text-muted-foreground/60 text-[11px] truncate">{u.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function normalizeChannelSlug(name: string): string {
  return name.toLowerCase().trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
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

// Replace the @query at the cursor with clean "@Name " text.
// Mention metadata (user id) is tracked separately in mentionEntriesRef.
// Token format is only produced at serialization time (serializeForSave).
function insertMentionToken(
  value: string,
  cursor: number,
  user: MentionUser
): { newValue: string; newCursor: number; atPos: number; insertedLen: number } {
  const before = value.slice(0, cursor);
  const after = value.slice(cursor);
  const m = before.match(/@([^\s@]*)$/);
  if (!m) return { newValue: value, newCursor: cursor, atPos: cursor, insertedLen: 0 };
  const atPos = before.length - m[0].length;
  // Clean display text: "@Name " — no token format visible in the textarea
  const cleanText = `@${user.name} `;
  return {
    newValue: value.slice(0, atPos) + cleanText + after,
    newCursor: atPos + cleanText.length,
    atPos,
    insertedLen: cleanText.length,
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

// MentionEntry tracks one @mention in clean-text coordinate space.
type MentionEntry = { name: string; userId: number; isAll: boolean; atPos: number; end: number };

function useComposerMentions(taRef: React.RefObject<HTMLTextAreaElement>) {
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIdx, setMentionIdx] = useState(0);
  const [mentionAnchorRect, setMentionAnchorRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  // Registry of inserted mention positions in clean-text coordinate space.
  const mentionEntriesRef = useRef<MentionEntry[]>([]);

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

  /** Keep tracked entry positions in sync with every keystroke. */
  function updateEntryPositions(oldValue: string, newValue: string) {
    const entries = mentionEntriesRef.current;
    if (!entries.length) return;
    // Find first position where old and new diverge
    let changePos = 0;
    const minLen = Math.min(oldValue.length, newValue.length);
    while (changePos < minLen && oldValue[changePos] === newValue[changePos]) changePos++;
    const diff = newValue.length - oldValue.length;
    mentionEntriesRef.current = entries
      .map((e) => {
        if (e.atPos < changePos) return e; // before change — unchanged
        return { ...e, atPos: e.atPos + diff, end: e.end + diff };
      })
      .filter((e) => {
        // Validate: the substring at atPos..end must still be "@Name"
        const expected = `@${e.name}`;
        return (
          e.atPos >= 0 &&
          e.end <= newValue.length &&
          newValue.slice(e.atPos, e.end) === expected
        );
      });
  }

  /** Serialize clean-text editor value → token format for DB storage. */
  function serializeForSave(cleanText: string): string {
    const entries = [...mentionEntriesRef.current].sort((a, b) => b.atPos - a.atPos);
    let result = cleanText;
    for (const e of entries) {
      if (e.atPos < 0 || e.end > result.length) continue;
      const token = `@[${e.name}](user:${e.userId})`;
      result = result.slice(0, e.atPos) + token + result.slice(e.end);
    }
    return result;
  }

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
    const { newValue, newCursor, atPos, insertedLen } = insertMentionToken(draft, cursor, user);
    // Track this mention in the registry
    mentionEntriesRef.current = [
      ...mentionEntriesRef.current,
      {
        name: user.name,
        userId: user.id,
        isAll: !!user.isAll,
        atPos,
        end: atPos + insertedLen - 1, // -1: trailing space is not part of "@Name"
      },
    ];
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
    closeMention: () => { setMentionActive(false); },
    updateEntryPositions,
    serializeForSave,
    clearEntries: () => { mentionEntriesRef.current = []; },
    initFromTokenText: (stored: string) => {
      const TOKEN_RE = /@\[([^\]]+)\]\(user:(\d+)\)/g;
      const entries: MentionEntry[] = [];
      let lastIndex = 0;
      let cleanPos = 0;
      let match: RegExpExecArray | null;
      while ((match = TOKEN_RE.exec(stored)) !== null) {
        cleanPos += match.index - lastIndex;
        lastIndex = match.index + match[0].length;
        const name = match[1];
        const userId = parseInt(match[2], 10);
        const atPos = cleanPos;
        entries.push({ name, userId, isAll: false, atPos, end: atPos + 1 + name.length });
        cleanPos = atPos + 1 + name.length;
      }
      mentionEntriesRef.current = entries;
    },
  };
}

// ── Emoji picker — portal-based so it's never clipped by overflow-y: auto ────

function EmojiPickerPopover({
  onReact,
  onSelect,
}: {
  onReact?: (emoji: string) => void;
  onSelect?: (emoji: string) => void;
}) {
  const handleEmoji = onReact ?? onSelect ?? (() => {});
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("smileys");
  const [showUpload, setShowUpload] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const [recentEmojis, setRecentEmojis] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("vc_recent_emoji") ?? "[]"); }
    catch { return []; }
  });

  const { data: customEmojis = [] } = useQuery<{ id: number; name: string; slug: string; imageUrl: string }[]>({
    queryKey: ["/api/current/custom-emojis"],
    staleTime: 60_000,
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ name, file }: { name: string; file: File }) => {
      const fd = new FormData();
      fd.append("name", name);
      fd.append("file", file);
      const r = await fetch("/api/current/custom-emojis", { method: "POST", body: fd, credentials: "include" });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).message || "Upload failed"); }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/current/custom-emojis"] });
      setShowUpload(false);
      setUploadName("");
      setUploadFile(null);
    },
  });

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (
        pickerRef.current && !pickerRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) { setOpen(false); }
    }
    function onScroll(e: Event) {
      // Only close when scroll happens outside the picker (e.g. message list behind it)
      if (pickerRef.current && pickerRef.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) { setSearch(""); setShowUpload(false); setTimeout(() => searchRef.current?.focus(), 40); }
  }, [open]);

  function handleToggle() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const W = 280, H = 360;
      const left = Math.max(4, Math.min(rect.right - W, window.innerWidth - W - 4));
      const top = rect.bottom + 4 + H > window.innerHeight ? rect.top - H - 4 : rect.bottom + 4;
      setCoords({ top, left });
    }
    setOpen((v) => !v);
  }

  function selectEmoji(emoji: string) {
    const next = [emoji, ...recentEmojis.filter((e) => e !== emoji)].slice(0, 18);
    setRecentEmojis(next);
    try { localStorage.setItem("vc_recent_emoji", JSON.stringify(next)); } catch {}
    handleEmoji(emoji);
    setOpen(false);
  }

  const allCategories = [
    ...(recentEmojis.length > 0 ? [{ id: "recent", label: "Recently Used", icon: "🕐", emojis: recentEmojis }] : []),
    ...EMOJI_DATA,
    ...(customEmojis.length > 0 ? [{ id: "custom", label: "Custom", icon: "✨", emojis: customEmojis.map((c) => `:${c.slug}:`) }] : []),
  ];
  const activeCat = allCategories.find((c) => c.id === activeCategory) ?? allCategories[0];

  const searchTrimmed = search.trim().toLowerCase();
  const searchedEmojis: string[] | null = searchTrimmed
    ? EMOJI_DATA.flatMap((c) => c.emojis).filter((emoji) => {
        const kw = (EMOJI_KEYWORDS[emoji] ?? "").toLowerCase();
        const catLabel = (EMOJI_DATA.find((c) => c.emojis.includes(emoji))?.label ?? "").toLowerCase();
        return kw.includes(searchTrimmed) || catLabel.includes(searchTrimmed) || emoji === searchTrimmed;
      })
    : null;

  const displayEmojis = searchedEmojis ?? activeCat?.emojis ?? [];

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
      {open && createPortal(
        <div
          ref={pickerRef}
          style={{ position: "fixed", top: coords.top, left: coords.left, zIndex: 9999, width: 280 }}
          className="bg-popover border border-border/70 rounded-xl shadow-xl overflow-hidden flex flex-col"
        >
          {/* Search bar */}
          <div className="px-2 pt-2 pb-1 shrink-0">
            <div className="flex items-center gap-1.5 bg-muted/40 rounded-lg px-2 py-1.5">
              <Search className="w-3 h-3 text-muted-foreground/50 shrink-0" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search emojis…"
                className="flex-1 bg-transparent text-[12px] outline-none text-foreground placeholder:text-muted-foreground/40 min-w-0"
              />
              {search && (
                <button onClick={() => setSearch("")} className="text-muted-foreground/40 hover:text-muted-foreground transition-colors leading-none">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Category tabs */}
          {!searchTrimmed && (
            <div className="flex items-center gap-0.5 px-2 pb-0.5 overflow-x-auto shrink-0" style={{ scrollbarWidth: "none" }}>
              {allCategories.map((cat) => (
                <button
                  key={cat.id}
                  title={cat.label}
                  onClick={() => setActiveCategory(cat.id)}
                  className={cn(
                    "w-7 h-7 flex items-center justify-center rounded-md text-[14px] shrink-0 transition-colors",
                    activeCategory === cat.id
                      ? "bg-primary/15 text-primary"
                      : "hover:bg-muted/60 text-muted-foreground hover:text-foreground"
                  )}
                >
                  {cat.icon}
                </button>
              ))}
            </div>
          )}

          {/* Section label */}
          <div className="px-2.5 py-0.5 shrink-0">
            <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">
              {searchTrimmed ? `Results for "${search}"` : (activeCat?.label ?? "")}
            </span>
          </div>

          {/* Emoji grid */}
          <div
            className="px-1.5 pb-1.5 overflow-y-auto flex-1"
            style={{ maxHeight: 220, overscrollBehavior: "contain" }}
            onWheel={(e) => e.stopPropagation()}
          >
            {displayEmojis.length === 0 ? (
              <div className="py-6 text-center text-[12px] text-muted-foreground/50">No emojis found</div>
            ) : (
              <div className="grid grid-cols-8 gap-0.5">
                {displayEmojis.map((emoji) => {
                  if (emoji.startsWith(":") && emoji.endsWith(":")) {
                    const slug = emoji.slice(1, -1);
                    const custom = customEmojis.find((c) => c.slug === slug);
                    return custom ? (
                      <button
                        key={emoji}
                        title={`:${slug}:`}
                        onClick={() => selectEmoji(emoji)}
                        className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-muted/60 transition-colors overflow-hidden"
                      >
                        <img src={custom.imageUrl} alt={slug} className="w-5 h-5 object-contain" />
                      </button>
                    ) : null;
                  }
                  return (
                    <button
                      key={emoji}
                      title={emoji}
                      onClick={() => selectEmoji(emoji)}
                      className="w-8 h-8 flex items-center justify-center text-[16px] rounded-md hover:bg-muted/60 transition-colors leading-none"
                    >
                      {emoji}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Custom emoji: upload row */}
          {!searchTrimmed && activeCategory === "custom" && (
            <div className="border-t border-border/30 px-2.5 py-1.5 shrink-0">
              {!showUpload ? (
                <button
                  onClick={() => setShowUpload(true)}
                  className="text-[11px] text-primary/70 hover:text-primary transition-colors flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  Upload custom emoji
                </button>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <input
                    value={uploadName}
                    onChange={(e) => setUploadName(e.target.value)}
                    placeholder="Name (e.g. voltbolt)"
                    className="w-full bg-muted/40 rounded-md px-2 py-1 text-[11px] outline-none focus:ring-1 ring-primary/40"
                  />
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex-1 bg-muted/40 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/60 transition-colors text-left truncate"
                    >
                      {uploadFile ? uploadFile.name : "Choose image…"}
                    </button>
                    <button
                      disabled={!uploadName.trim() || !uploadFile || uploadMutation.isPending}
                      onClick={() => { if (uploadName.trim() && uploadFile) uploadMutation.mutate({ name: uploadName.trim(), file: uploadFile }); }}
                      className="text-[11px] bg-primary/80 hover:bg-primary text-white rounded-md px-2 py-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {uploadMutation.isPending ? "…" : "Upload"}
                    </button>
                    <button onClick={() => setShowUpload(false)} className="text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/png,image/gif,image/webp,image/jpeg" className="hidden"
                    onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} />
                  {uploadMutation.isError && (
                    <span className="text-[10px] text-destructive">{(uploadMutation.error as Error)?.message}</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Quick-access custom tab trigger when not on custom */}
          {!searchTrimmed && activeCategory !== "custom" && customEmojis.length === 0 && (
            <div className="border-t border-border/20 px-2.5 py-1 shrink-0">
              <button
                onClick={() => { setActiveCategory("custom"); }}
                className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                Add custom emojis
              </button>
            </div>
          )}
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
  hasBody,
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
        "relative flex gap-3 group hover:bg-muted/40 rounded-xl px-2 -mx-2 py-0.5 transition-colors",
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
  const [text, setText] = useState(() => tokensToCleanText(message.body ?? ""));
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mention = useComposerMentions(taRef);

  useEffect(() => {
    mention.initFromTokenText(message.body ?? "");
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
    if (trimmed === tokensToCleanText(message.body ?? "").trim()) {
      onCancel();
      return;
    }
    onSave(mention.serializeForSave(trimmed));
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
            const newValue = e.target.value;
            mention.updateEntryPositions(text, newValue);
            setText(newValue);
            growTextarea(e.target, 192);
            mention.onValueChange(
              newValue,
              e.target.selectionStart ?? newValue.length
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
  conversationId,
  onClose,
  onCreateTaskMsg,
  onCreateSummaryTask,
}: {
  rootMessageId: number;
  currentUserId: number;
  isAdmin: boolean;
  isArchived?: boolean;
  selectedSlug: string;
  conversationId?: number;
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
  const threadSlash = useSlashCommand(replyDraft, THREAD_COMMANDS);
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
    if (conversationId) {
      queryClient.invalidateQueries({ queryKey: ["/api/current/dms", conversationId, "messages"] });
    } else {
      queryClient.invalidateQueries({
        queryKey: ["/api/current/channels", selectedSlug, "messages"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/current/channels"] });
    }
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
    mutationFn: ({ body, hasPendingAttachments }: { body: string; hasPendingAttachments?: boolean }) =>
      apiRequest("POST", `/api/current/messages/${rootMessageId}/thread`, { body, hasPendingAttachments })
        .then((r) => r.json()),
  });

  const threadMarkStructuredMutation = useMutation({
    mutationFn: ({ messageId, itemType }: { messageId: number; itemType: string }) =>
      apiRequest("POST", `/api/current/messages/${messageId}/structured`, { itemType })
        .then((r) => r.json()),
    onSuccess: () => {
      invalidateThread();
      invalidateFeed();
      queryClient.invalidateQueries({ queryKey: ["/api/current/structured"] });
    },
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
    const hasFiles = replyPendingFiles.length > 0;
    if ((!trimmed && !hasFiles) || postReplyMutation.isPending || isReplyUploading) return;
    const cmd = threadSlash.selectedCommand;
    try {
      const body = replyMention.serializeForSave(trimmed);
      const newMsg = await postReplyMutation.mutateAsync({ body, hasPendingAttachments: hasFiles });
      threadSlash.clearCommand();
      setReplyDraft("");
      replyMention.closeMention();
      replyMention.clearEntries();
      if (replyTextareaRef.current) replyTextareaRef.current.style.height = "auto";
      threadAtBottom.current = true;
      // Execute thread slash command
      if (cmd && newMsg?.id) {
        if (cmd.id === "task" && onCreateTaskMsg) {
          onCreateTaskMsg(newMsg as Message, rootMessageId);
        } else if (cmd.id === "decision" || cmd.id === "risk" || cmd.id === "requirement") {
          threadMarkStructuredMutation.mutate({ messageId: newMsg.id, itemType: cmd.id });
          toast({ title: `Marked as ${cmd.id}` });
        }
      }
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
    } catch (err: any) {
      toast({ title: "Reply not sent", description: err?.message ?? "Please try again.", variant: "destructive" });
    }
  }

  function handleReplyKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (replyMention.handleMentionKeyDown(e, replyDraft, setReplyDraft)) return;
    const slashResult = threadSlash.handleMenuKeyDown(e);
    if (slashResult !== false) {
      if (typeof slashResult === "object") {
        threadSlash.selectCommand(slashResult);
        setReplyDraft("");
      }
      return;
    }
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
            {threadSlash.menuOpen && (
              <SlashCommandMenu
                commands={threadSlash.filteredCommands}
                activeIndex={threadSlash.activeIndex}
                onSelect={(cmd) => { threadSlash.selectCommand(cmd); setReplyDraft(""); }}
                onHover={threadSlash.setActiveIndex}
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
            {threadSlash.selectedCommand && (
              <SlashCommandPill command={threadSlash.selectedCommand} onClear={threadSlash.clearCommand} />
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
                disabled={(!replyDraft.trim() && replyPendingFiles.length === 0) || postReplyMutation.isPending || isReplyUploading}
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
              Enter to reply · Shift+Enter for new line · @ to mention · / for commands · 📎 to attach
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
      <div className="relative mb-6">
        <div className="absolute inset-0 rounded-2xl bg-primary/20 blur-xl opacity-50 scale-110" />
        <div className="relative w-18 h-18 w-[72px] h-[72px] rounded-2xl bg-primary/15 flex items-center justify-center ring-1 ring-primary/25 shadow-lg">
          <Hash className="w-9 h-9 text-primary/70" />
        </div>
      </div>
      <h3 className="text-[16px] font-semibold text-foreground mb-2">
        Start the conversation
      </h3>
      <p className="text-[13px] text-muted-foreground/70 max-w-[220px] leading-relaxed">
        Be the first to post in{" "}
        <span className="text-primary font-semibold">#{displaySlug(slug)}</span>
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
  const rType = result.resultType ?? "message";

  // ── File result ──────────────────────────────────────────────────────────
  if (rType === "file") {
    const fileKey = result.attachmentId ?? Math.random();
    const ext = (result.originalName ?? "").split(".").pop()?.toLowerCase() ?? "";
    const isImg = ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext);
    return (
      <a
        href={result.downloadUrl ?? "#"}
        target="_blank"
        rel="noreferrer"
        className="block no-underline"
        data-testid={`search-result-file-${fileKey}`}
      >
        <div className="w-full text-left rounded-xl px-3.5 py-3 border border-border/40 hover:border-primary/30 hover:bg-muted/30 transition-all group/src">
          <div className="flex items-center gap-1.5 mb-1.5">
            {isImg ? <ImageIcon className="w-3 h-3 text-primary/60 shrink-0" /> : <Paperclip className="w-3 h-3 text-primary/60 shrink-0" />}
            <span className="text-[10.5px] font-semibold text-primary/70 truncate">
              {result.channelSlug ? `#${displaySlug(result.channelSlug)}` : "DM"}
            </span>
            <span className="ml-auto text-[10.5px] text-muted-foreground/40 shrink-0 tabular-nums">
              {formatTs(result.createdAt ?? "")}
            </span>
          </div>
          <p className="text-[12.5px] font-medium text-foreground/80 line-clamp-1 break-all mb-0.5">
            {highlightMatch(result.originalName ?? "", query)}
          </p>
          <p className="text-[11px] text-muted-foreground/50">
            {result.uploaderName ?? ""}
            {result.fileSizeBytes ? ` · ${(result.fileSizeBytes / 1024).toFixed(0)} KB` : ""}
          </p>
          <div className="mt-2 flex justify-end">
            <span className="text-[10.5px] text-primary/50 font-medium group-hover/src:text-primary transition-colors">Download →</span>
          </div>
        </div>
      </a>
    );
  }

  // ── Channel result ────────────────────────────────────────────────────────
  if (rType === "channel") {
    return (
      <button
        onClick={onNavigate}
        className="block w-full"
        data-testid={`search-result-channel-${result.channelSlug}`}
      >
        <div className="w-full text-left rounded-xl px-3.5 py-3 border border-border/40 hover:border-primary/30 hover:bg-muted/30 transition-all group/src">
          <div className="flex items-center gap-1.5 mb-1">
            {result.isPrivate ? <Lock className="w-3 h-3 text-primary/60 shrink-0" /> : <Hash className="w-3 h-3 text-primary/60 shrink-0" />}
            <span className="text-[12.5px] font-semibold text-foreground/80 truncate">
              {highlightMatch(result.channelName ?? result.channelSlug ?? "", query)}
            </span>
            {result.isPrivate && <span className="text-[9.5px] text-muted-foreground/40 ml-auto shrink-0">Private</span>}
          </div>
          {result.description && (
            <p className="text-[11.5px] text-muted-foreground/60 line-clamp-1">{result.description}</p>
          )}
          <div className="mt-2 flex justify-end">
            <span className="text-[10.5px] text-primary/50 font-medium group-hover/src:text-primary transition-colors">Open channel →</span>
          </div>
        </div>
      </button>
    );
  }

  // ── Person result ─────────────────────────────────────────────────────────
  if (rType === "person") {
    return (
      <div
        className="rounded-xl px-3.5 py-3 border border-border/40 hover:border-primary/30 hover:bg-muted/30 transition-all"
        data-testid={`search-result-person-${result.userId}`}
      >
        <div className="flex items-center gap-2.5">
          {result.avatarUrl ? (
            <img src={result.avatarUrl} className="w-7 h-7 rounded-full object-cover shrink-0" alt={result.displayName ?? ""} />
          ) : (
            <div className={cn("w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[9px] font-bold text-white", avatarBg(result.userId ?? 0))}>
              {initials(result.displayName ?? "")}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold text-foreground/80 truncate">
              {highlightMatch(result.displayName ?? "", query)}
            </p>
            <p className="text-[11px] text-muted-foreground/50 truncate">{result.email ?? ""}</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Message result (default) ──────────────────────────────────────────────
  const msgId = result.id ?? 0;
  const sourceLabel = result.channelSlug
    ? `#${displaySlug(result.channelSlug)}`
    : result.conversationId
    ? "Direct Message"
    : result.objectType
    ? `${result.objectType.replace(/_/g, " ")} · ${result.objectId}`
    : "CURRENTS";

  const recordUrl = (() => {
    if (result.channelSlug || result.conversationId || !result.objectType || !result.objectId) return null;
    const threadPart = result.parentMessageId ? `&thread=${result.parentMessageId}` : "";
    const msgPart = `&message=${msgId}`;
    if (result.objectType === "lead") {
      return `/opportunities?selected=${result.objectId}&tab=current${msgPart}${threadPart}`;
    }
    return buildRecordUrl(result.objectType, result.objectId) + `?tab=current${msgPart}${threadPart}`;
  })();

  const inner = (
    <div className="w-full text-left rounded-xl px-3.5 py-3 border border-border/40 hover:border-primary/30 hover:bg-muted/30 transition-all group/src">
      <div className="flex items-center gap-1.5 mb-1.5 min-w-0">
        {result.channelSlug ? (
          <Hash className="w-3 h-3 text-primary/60 shrink-0" />
        ) : result.conversationId ? (
          <MessageSquare className="w-3 h-3 text-primary/60 shrink-0" />
        ) : (
          <MessageSquare className="w-3 h-3 text-primary/60 shrink-0" />
        )}
        <span className="text-[10.5px] font-semibold text-primary/70 truncate">{sourceLabel}</span>
        {result.isReply && <span className="text-[10px] text-muted-foreground/50 shrink-0">· thread</span>}
        {result.isChannelArchived && <ArchivedBadge />}
        <span className="ml-auto text-[10.5px] text-muted-foreground/40 shrink-0 tabular-nums">
          {formatTs(result.createdAt ?? "")}
        </span>
      </div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <div className={cn("w-4 h-4 rounded-full flex items-center justify-center shrink-0 text-[7px] font-bold text-white", avatarBg(msgId))}>
          {initials(result.userName ?? "")}
        </div>
        <span className="text-[11.5px] font-medium text-foreground/70">{result.userName ?? ""}</span>
      </div>
      {result.snippet ? (
        <p className="text-[12.5px] text-foreground/80 leading-relaxed line-clamp-2 break-words">
          {highlightMatch(result.snippet, query)}
        </p>
      ) : result.matchedAttachment ? (
        <p className="text-[12px] text-muted-foreground/50 italic">Matched in attached file</p>
      ) : null}
      {result.matchedAttachment && (result.attachmentNames ?? []).length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {(result.attachmentNames ?? []).slice(0, 3).map((name, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-muted/50 text-muted-foreground border border-border/30 max-w-[160px] truncate">
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
      <a href={recordUrl} className="block no-underline" data-testid={`search-result-${msgId}`}>{inner}</a>
    );
  }
  return (
    <button onClick={onNavigate} className="block w-full" data-testid={`search-result-${msgId}`}>
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
                    <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white overflow-hidden", avatarBg(m.id))}>
                      {m.avatarUrl ? (
                        <img src={m.avatarUrl} alt={m.name} className="w-full h-full object-cover" />
                      ) : (
                        initials(m.name)
                      )}
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

// ── ChannelParticipant type ───────────────────────────────────────────────────

interface ChannelParticipant {
  id: number;
  name: string;
  email: string;
}

// ── ChannelDetailsModal ───────────────────────────────────────────────────────
// Phase 19C: Slack-style channel details modal with About/Members/Files/Pins/Settings tabs.

type ChannelDetailsTab = "about" | "members" | "files" | "pins" | "settings";

function ChannelDetailsModal({
  open,
  onOpenChange,
  defaultTab = "about",
  channelSlug,
  channel,
  channelDirect,
  participants,
  pins,
  messages,
  currentUserId,
  isAdmin,
  isArchived = false,
  presenceMap = {},
  onPrefChange,
  onUnarchive,
  onOpenEditChannel,
  onRemoveMember,
  onAddMember,
  onUnpin,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultTab?: ChannelDetailsTab;
  channelSlug: string;
  channel: Channel | null;
  channelDirect: ChannelInfo | null;
  participants: ChannelParticipant[];
  pins: PinnedMessage[];
  messages: Message[];
  currentUserId: number;
  isAdmin: boolean;
  isArchived?: boolean;
  presenceMap?: Record<number, "online" | "offline">;
  onPrefChange: (level: "all" | "mentions" | "muted") => void;
  onUnarchive: () => void;
  onOpenEditChannel: () => void;
  onRemoveMember: (userId: number) => void;
  onAddMember: (userId: number) => void;
  onUnpin: (messageId: number) => void;
}) {
  const [activeTab, setActiveTab] = useState<ChannelDetailsTab>("about");
  const [memberSearch, setMemberSearch] = useState("");

  useEffect(() => {
    if (open) { setActiveTab(defaultTab); setMemberSearch(""); }
  }, [open, defaultTab]);

  const sorted = useMemo(() => {
    const you = participants.filter((p) => p.id === currentUserId);
    const others = participants.filter((p) => p.id !== currentUserId);
    const online = others.filter((p) => presenceMap[p.id] === "online").sort((a, b) => a.name.localeCompare(b.name));
    const offline = others.filter((p) => presenceMap[p.id] !== "online").sort((a, b) => a.name.localeCompare(b.name));
    return [...you, ...online, ...offline];
  }, [participants, currentUserId, presenceMap]);

  const filteredMembers = memberSearch.trim()
    ? sorted.filter((p) =>
        p.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
        p.email.toLowerCase().includes(memberSearch.toLowerCase())
      )
    : sorted;

  const msgsWithFiles = messages.filter((m) => m.attachments && m.attachments.length > 0).slice(-20);

  const channelTypeLabel = isArchived
    ? "Archived channel"
    : channel?.isPrivate
    ? "Private channel"
    : "Public channel";

  const notifLevel: "all" | "mentions" | "muted" = channel?.notificationLevel ?? "mentions";
  const createdAt = channelDirect?.createdAt;
  const TABS: ChannelDetailsTab[] = ["about", "members", "files", "pins", "settings"];
  const TAB_LABELS: Record<ChannelDetailsTab, string> = { about: "About", members: "Members", files: "Files", pins: "Pins", settings: "Settings" };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] w-full p-0 gap-0 overflow-hidden flex flex-col" style={{ maxHeight: "85vh" }}>
        {/* Modal header */}
        <div className="px-5 pt-5 pb-3 border-b border-border/30 shrink-0">
          <div className="flex items-start gap-2.5 min-w-0">
            {isArchived ? (
              <Archive className="w-4 h-4 text-muted-foreground/50 shrink-0 mt-0.5" />
            ) : channel?.isPrivate ? (
              <Lock className="w-4 h-4 text-amber-400/70 shrink-0 mt-0.5" />
            ) : (
              <Hash className="w-4 h-4 text-primary/60 shrink-0 mt-0.5" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <DialogTitle className="text-[15px] font-bold text-foreground tracking-tight">
                  {channel?.name ?? displaySlug(channelSlug)}
                </DialogTitle>
                <span className={cn("text-[10.5px] font-medium px-1.5 py-0.5 rounded-full shrink-0 select-none",
                  isArchived ? "bg-muted/40 text-muted-foreground/60" :
                  channel?.isPrivate ? "bg-amber-500/10 text-amber-400" : "bg-primary/10 text-primary/70"
                )}>
                  {channelTypeLabel}
                </span>
              </div>
              {channel?.description ? (
                <p className="text-[12.5px] text-muted-foreground/70 leading-relaxed mt-0.5">{channel.description}</p>
              ) : (
                <p className="text-[12px] text-muted-foreground/35 italic mt-0.5">No description set</p>
              )}
            </div>
          </div>
        </div>

        {/* Tab row */}
        <div className="flex items-end px-2 border-b border-border/30 bg-muted/5 shrink-0 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab}
              data-testid={`channel-details-tab-${tab}`}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "px-3 py-2.5 text-[12px] font-medium transition-colors border-b-2 -mb-px whitespace-nowrap shrink-0",
                activeTab === tab
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground/50 hover:text-foreground hover:bg-muted/30"
              )}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto min-h-0">

          {/* ── About ── */}
          {activeTab === "about" && (
            <div className="px-5 py-4 space-y-4">
              <div className={cn("flex items-center gap-3 p-3 rounded-xl",
                isArchived ? "bg-amber-500/10 border border-amber-500/20" :
                channel?.isPrivate ? "bg-amber-500/8 border border-amber-500/15" : "bg-primary/8 border border-primary/15"
              )}>
                <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                  isArchived ? "bg-muted/40" : channel?.isPrivate ? "bg-amber-500/10" : "bg-primary/10"
                )}>
                  {isArchived ? <Archive className="w-4 h-4 text-amber-400/60" /> :
                   channel?.isPrivate ? <Lock className="w-4 h-4 text-amber-400/70" /> :
                   <Hash className="w-4 h-4 text-primary/60" />}
                </div>
                <div>
                  <p className="text-[12.5px] font-semibold text-foreground/85">{channelTypeLabel}</p>
                  <p className="text-[11.5px] text-muted-foreground/60 leading-tight mt-0.5">
                    {isArchived ? "Messages are preserved in read-only mode." :
                     channel?.isPrivate ? "Only invited members can access this channel." :
                     "Anyone in CURRENTS can join and see this channel."}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-[10.5px] font-semibold text-muted-foreground/40 uppercase tracking-wider mb-1">Members</p>
                  <p className="text-[13px] text-foreground/80">{participants.length} {participants.length === 1 ? "member" : "members"}</p>
                </div>
                {channel?.description && (
                  <div>
                    <p className="text-[10.5px] font-semibold text-muted-foreground/40 uppercase tracking-wider mb-1">Description</p>
                    <p className="text-[13px] text-foreground/80 leading-relaxed">{channel.description}</p>
                  </div>
                )}
                {createdAt && (
                  <div>
                    <p className="text-[10.5px] font-semibold text-muted-foreground/40 uppercase tracking-wider mb-1">Created</p>
                    <p className="text-[13px] text-foreground/80">
                      {new Date(createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Members ── */}
          {activeTab === "members" && (
            <div className="flex flex-col h-full">
              <div className="px-4 py-3 border-b border-border/20 shrink-0">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Find members"
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-[12.5px] bg-muted/30 border border-border/40 rounded-lg text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/50 transition-all"
                    data-testid="channel-details-member-search"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground/40 mt-1.5">
                  {participants.length} {participants.length === 1 ? "member" : "members"}
                </p>
              </div>

              <div className="flex-1 overflow-y-auto py-1">
                {filteredMembers.length === 0 ? (
                  <p className="px-4 py-6 text-center text-[13px] text-muted-foreground/50" data-testid="channel-participants-empty">
                    {memberSearch ? "No members match your search" : "No channel participants yet"}
                  </p>
                ) : filteredMembers.map((p) => {
                  const isYou = p.id === currentUserId;
                  const status = isYou ? "online" : (presenceMap[p.id] ?? "offline");
                  return (
                    <div key={p.id} className="flex items-center gap-3 px-4 py-2 hover:bg-muted/30 transition-colors" data-testid={`channel-participant-row-${p.id}`}>
                      <div className="relative shrink-0">
                        <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white select-none", avatarBg(p.id))}>
                          {initials(p.name)}
                        </div>
                        <PresenceDot
                          status={status}
                          className="absolute -bottom-px -right-px w-2 h-2"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[13px] font-medium text-foreground truncate">{p.name}</span>
                          {isYou && <span className="text-[10.5px] text-muted-foreground/50 shrink-0">You</span>}
                        </div>
                        <div className="text-[11.5px] text-muted-foreground/60 truncate">{p.email}</div>
                      </div>
                      <div className="shrink-0 flex items-center gap-1">
                        <span className="text-[11px]">
                          {status === "online"
                            ? <span className="text-emerald-500/80">Online</span>
                            : <span className="text-muted-foreground/40">Offline</span>}
                        </span>
                        {isAdmin && channel?.isPrivate && !isYou && (
                          <button
                            onClick={() => onRemoveMember(p.id)}
                            className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10 transition-colors ml-1"
                            title="Remove from channel"
                            data-testid={`channel-details-remove-member-${p.id}`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {isAdmin && channel?.isPrivate && !isArchived && (
                <div className="px-4 py-3 border-t border-border/20 shrink-0">
                  <p className="text-[11px] font-medium text-muted-foreground/50 mb-2">Add people</p>
                  <MemberPickerInline
                    selectedIds={[]}
                    onChange={(ids) => { const id = ids[0]; if (id) onAddMember(id); }}
                    excludeIds={participants.map((p) => p.id)}
                  />
                </div>
              )}
            </div>
          )}

          {/* ── Files ── */}
          {activeTab === "files" && (
            <div className="px-4 py-4">
              {msgsWithFiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3 select-none">
                  <FileText className="w-10 h-10 text-muted-foreground/15" />
                  <div className="text-center">
                    <p className="text-[13px] font-medium text-muted-foreground/50">No files shared yet</p>
                    <p className="text-[12px] text-muted-foreground/35 mt-1">Files shared in this channel will appear here.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {msgsWithFiles.map((msg, i) => {
                    const prev = msgsWithFiles[i - 1];
                    const showDivider = msgIsNewDay(prev?.createdAt, msg.createdAt);
                    return (
                      <div key={msg.id}>
                        {showDivider && (
                          <div className="flex items-center gap-3 py-2 select-none" aria-hidden>
                            <div className="flex-1 h-px bg-border/30" />
                            <span className="text-[10.5px] font-medium text-muted-foreground/40 px-2 whitespace-nowrap">{formatDateDivider(msg.createdAt)}</span>
                            <div className="flex-1 h-px bg-border/30" />
                          </div>
                        )}
                        <div className="flex items-start gap-3 px-1 py-2 rounded-xl hover:bg-muted/20 transition-colors">
                          <div className={cn("w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-white text-[10px] font-bold mt-0.5 overflow-hidden select-none", avatarBg(msg.userId))}>
                            {msg.userAvatarUrl
                              ? <img src={msg.userAvatarUrl} alt={msg.userName} className="w-full h-full object-cover" />
                              : initials(msg.userName)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2 mb-1.5">
                              <span className="text-[12px] font-semibold text-foreground/85">{msg.userName}</span>
                              <span className="text-[10.5px] text-muted-foreground/50">{formatTs(msg.createdAt)}</span>
                            </div>
                            <FilesTabAttachments attachments={msg.attachments!} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Pins ── */}
          {activeTab === "pins" && (
            <div className="px-4 py-4 space-y-2.5">
              {pins.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3 select-none">
                  <Pin className="w-10 h-10 text-muted-foreground/15" />
                  <div className="text-center">
                    <p className="text-[13px] font-medium text-muted-foreground/50">No pinned messages yet</p>
                    <p className="text-[12px] text-muted-foreground/35 mt-1">Pinned messages will appear here.</p>
                  </div>
                </div>
              ) : pins.map((pin) => (
                <div key={pin.id} className="group flex items-start gap-3 px-3 py-2.5 rounded-xl bg-muted/20 border border-border/30 hover:bg-muted/30 transition-colors">
                  <Pin className="w-3.5 h-3.5 text-primary/50 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="text-[12px] font-semibold text-foreground/80">{pin.messageUserName}</span>
                      <span className="text-[10.5px] text-muted-foreground/40">{formatTs(pin.messageCreatedAt)}</span>
                    </div>
                    <p className="text-[12.5px] text-foreground/70 leading-snug break-words">
                      {pin.messageBody || <em className="text-muted-foreground/40">Attachment</em>}
                    </p>
                    {pin.pinnedByName && (
                      <p className="text-[10px] text-muted-foreground/35 mt-1">Pinned by {pin.pinnedByName}</p>
                    )}
                  </div>
                  {!isArchived && (
                    <button
                      onClick={() => onUnpin(pin.messageId)}
                      className="opacity-0 group-hover:opacity-100 shrink-0 w-6 h-6 rounded flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-muted/60 transition-all"
                      title="Unpin"
                      data-testid={`channel-details-unpin-${pin.messageId}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Settings ── */}
          {activeTab === "settings" && (
            <div className="px-5 py-4 space-y-5">
              <div>
                <p className="text-[10.5px] font-semibold text-muted-foreground/40 uppercase tracking-wider mb-3">Notifications</p>
                <div className="space-y-1">
                  {(
                    [
                      { value: "all" as const, label: "All messages", desc: "Get notified for every message" },
                      { value: "mentions" as const, label: "Mentions & keywords", desc: "Only when @mentioned or keywords match" },
                      { value: "muted" as const, label: "Muted", desc: "No notifications from this channel" },
                    ] as const
                  ).map((opt) => {
                    const isActive = notifLevel === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => onPrefChange(opt.value)}
                        data-testid={`channel-notif-${opt.value}`}
                        className={cn(
                          "w-full flex items-start gap-3 px-3 py-2.5 rounded-xl transition-colors text-left",
                          isActive
                            ? "bg-primary/10 border border-primary/20"
                            : "hover:bg-muted/30 border border-transparent"
                        )}
                      >
                        <div className={cn(
                          "w-4 h-4 rounded-full border-2 shrink-0 mt-0.5 flex items-center justify-center",
                          isActive ? "border-primary bg-primary" : "border-border/50"
                        )}>
                          {isActive && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[12.5px] font-medium text-foreground/85 leading-tight">{opt.label}</p>
                          <p className="text-[11px] text-muted-foreground/50 mt-0.5">{opt.desc}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {isAdmin && (
                <div>
                  <p className="text-[10.5px] font-semibold text-muted-foreground/40 uppercase tracking-wider mb-3">Admin</p>
                  <div className="space-y-2">
                    {!isArchived && (
                      <button
                        onClick={onOpenEditChannel}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted/30 border border-border/30 transition-colors text-left"
                        data-testid="channel-details-edit-btn"
                      >
                        <Settings className="w-4 h-4 text-muted-foreground/60 shrink-0" />
                        <div>
                          <p className="text-[12.5px] font-medium text-foreground/85">Edit channel</p>
                          <p className="text-[11px] text-muted-foreground/50">Change name, description, and privacy</p>
                        </div>
                      </button>
                    )}
                    {isArchived && (
                      <button
                        onClick={onUnarchive}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-emerald-500/10 border border-emerald-500/20 transition-colors text-left"
                        data-testid="channel-details-unarchive-btn"
                      >
                        <Archive className="w-4 h-4 text-emerald-500/60 shrink-0" />
                        <div>
                          <p className="text-[12.5px] font-medium text-emerald-400">Restore channel</p>
                          <p className="text-[11px] text-muted-foreground/50">Make this channel active again</p>
                        </div>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {isArchived && (
                <div className="px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <div className="flex items-center gap-2">
                    <Archive className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <p className="text-[12px] text-amber-400 font-medium">This channel is archived</p>
                  </div>
                  <p className="text-[11.5px] text-muted-foreground/60 mt-1">Messages are preserved in read-only mode.</p>
                </div>
              )}
            </div>
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

type SearchType = "all" | "messages" | "files" | "channels" | "people";
const SEARCH_TYPE_LABELS: Record<SearchType, string> = {
  all: "All",
  messages: "Messages",
  files: "Files",
  channels: "Channels",
  people: "People",
};

function SearchPanel({
  onNavigate,
  onNavigateDm,
}: {
  onNavigate: (slug: string, messageId: number, threadId?: number) => void;
  onNavigateDm?: (convId: number, messageId: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [searchType, setSearchType] = useState<SearchType>("all");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(query.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => { setPage(1); }, [searchType]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const {
    data: resp,
    isLoading,
    isError,
  } = useQuery<SearchResponse>({
    queryKey: ["/api/current/search", debouncedQ, searchType, page],
    queryFn: () => {
      const params = new URLSearchParams({
        q: debouncedQ,
        type: searchType,
        page: String(page),
        page_size: String(PAGE_SIZE),
      });
      return fetch(`/api/current/search?${params}`, { credentials: "include" }).then((r) => r.json());
    },
    enabled: debouncedQ.length >= 1,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const items   = resp?.items ?? [];
  const total   = resp?.total ?? 0;
  const totalPages = resp?.totalPages ?? 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Search bar + type tabs */}
      <div className="px-4 pt-3 pb-0 border-b border-border/60 shrink-0">
        <div className="relative mb-2.5">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages, files, channels, people…"
            className={cn(
              "w-full pl-8 pr-8 py-1.5 text-[13px] rounded-lg border",
              "bg-muted/30 border-border/40 text-foreground placeholder:text-muted-foreground/40",
              "focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/40 transition-all"
            )}
            data-testid="current-search-input"
          />
          {query && (
            <button
              onClick={() => { setQuery(""); setPage(1); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              data-testid="current-search-clear"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {/* Type filter tabs */}
        <div className="flex items-end gap-0 overflow-x-auto" data-testid="search-type-tabs">
          {(["all", "messages", "files", "channels", "people"] as SearchType[]).map((t) => (
            <button
              key={t}
              onClick={() => setSearchType(t)}
              data-testid={`search-tab-${t}`}
              className={cn(
                "px-2.5 py-1.5 text-[11.5px] font-medium transition-colors border-b-2 -mb-px whitespace-nowrap shrink-0",
                searchType === t
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground/50 hover:text-foreground hover:bg-muted/20",
              )}
            >
              {SEARCH_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {!debouncedQ && (
          <div className="flex flex-col items-center justify-center h-full py-20 text-center select-none">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 ring-1 ring-primary/10">
              <Search className="w-6 h-6 text-primary/50" />
            </div>
            <p className="text-[13.5px] font-semibold text-foreground/70 mb-1.5">Search CURRENTS</p>
            <p className="text-[12px] text-muted-foreground/60 max-w-[230px] leading-relaxed">
              Find messages, files, channels, and people across all your workspaces.
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

        {debouncedQ && !isLoading && !isError && items.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center select-none">
            <p className="text-[13px] text-muted-foreground/60">No results for &ldquo;{debouncedQ}&rdquo;</p>
            <p className="text-[11.5px] text-muted-foreground/40 mt-1">Try different keywords or change the filter.</p>
          </div>
        )}

        {debouncedQ && !isLoading && !isError && items.length > 0 && (
          <p className="text-[10.5px] text-muted-foreground/40 mb-1" data-testid="search-result-count">
            {total.toLocaleString()} result{total === 1 ? "" : "s"}
            {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ""}
          </p>
        )}

        {items.map((r, idx) => {
          const key = r.resultType === "message"
            ? `msg-${r.id}`
            : r.resultType === "file"
            ? `file-${r.attachmentId}`
            : r.resultType === "channel"
            ? `ch-${r.channelSlug}`
            : r.resultType === "person"
            ? `person-${r.userId}`
            : `item-${idx}`;

          const handleNavigate = (() => {
            if (r.resultType === "channel" && r.channelSlug) {
              return () => onNavigate(r.channelSlug!, 0);
            }
            if (r.resultType === "message") {
              if (r.channelSlug) return () => onNavigate(r.channelSlug!, r.id!, r.parentMessageId ?? undefined);
              if (r.conversationId && onNavigateDm) return () => onNavigateDm(r.conversationId!, r.id!);
            }
            return undefined;
          })();

          return (
            <SearchResultCard
              key={key}
              result={r}
              query={debouncedQ}
              onNavigate={handleNavigate}
            />
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-t border-border/40 bg-muted/5" data-testid="search-pagination">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            data-testid="search-page-prev"
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded text-[11.5px] font-medium transition-colors",
              page <= 1 ? "text-muted-foreground/30 cursor-not-allowed" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
            )}
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Prev
          </button>
          <span className="text-[11px] text-muted-foreground/50 tabular-nums">{page} / {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            data-testid="search-page-next"
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded text-[11.5px] font-medium transition-colors",
              page >= totalPages ? "text-muted-foreground/30 cursor-not-allowed" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
            )}
          >
            Next <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
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
            All CURRENTS
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
                      ? `${item.objectType.charAt(0).toUpperCase() + item.objectType.slice(1)} · CURRENTS`
                      : "CURRENTS"}
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
  const [channelDetailsTab, setChannelDetailsTab] = useState<ChannelDetailsTab>("about");
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
  // In-conversation search state
  const [inConvSearchOpen, setInConvSearchOpen] = useState(false);
  const [inConvSearchQ, setInConvSearchQ] = useState("");
  const [inConvSearchDebounced, setInConvSearchDebounced] = useState("");
  // Load-older state
  const [olderChannelCursor, setOlderChannelCursor] = useState<string | null>(null);
  const [olderChannelMsgs, setOlderChannelMsgs] = useState<Message[]>([]);
  const [loadingOlderChannel, setLoadingOlderChannel] = useState(false);
  const [olderDmCursor, setOlderDmCursor] = useState<string | null>(null);
  const [olderDmMsgs, setOlderDmMsgs] = useState<DmMessage[]>([]);
  const [loadingOlderDm, setLoadingOlderDm] = useState(false);
  const [channelTab, setChannelTab] = useState<"messages" | "files" | "pins" | "structured">("messages");
  const [dmTab, setDmTab] = useState<"messages" | "files">("messages");
  const [selectedDmId, setSelectedDmId] = useState<number | null>(null);
  const [newDmOpen, setNewDmOpen] = useState(false);
  const [dmDraft, setDmDraft] = useState("");
  const [editingDmMessage, setEditingDmMessage] = useState<DmMessage | null>(null);
  const [groupMemberOpen, setGroupMemberOpen] = useState(false);

  // Phase 19A: reset sub-tab on context switch
  useEffect(() => { setChannelTab("messages"); }, [selectedSlug]);
  useEffect(() => { setDmTab("messages"); }, [selectedDmId]);
  const [dmPendingFiles, setDmPendingFiles] = useState<File[]>([]);
  const dmFileInputRef = useRef<HTMLInputElement | null>(null);
  // Drag-and-drop state for channel and DM conversation areas
  const [mainDragOver, setMainDragOver] = useState(false);
  const [dmDragOver, setDmDragOver] = useState(false);
  const mainDragCounter = useRef(0);
  const dmDragCounter = useRef(0);
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
  const channelSlash = useSlashCommand(draft, CHANNEL_COMMANDS, selectedSlug);
  const dmSlash = useSlashCommand(dmDraft, DM_COMMANDS, selectedDmId);

  const [createTaskSource, setCreateTaskSource] = useState<CreateTaskSource | null>(null);

  // Phase 15A / 15B: Private channel state — multi-step create flow
  const [createStep, setCreateStep] = useState<1 | 2>(1);
  const [createVisibility, setCreateVisibility] = useState<"public" | "private">("public");
  const [createMemberIds, setCreateMemberIds] = useState<number[]>([]);
  const [editIsPrivate, setEditIsPrivate] = useState(false);

  // Query: fetch channel members for edit dialog (admin only)
  const { data: editChannelMembersData } = useQuery<{ members: { id: number; name: string; email: string; avatarUrl: string | null }[] }>({
    queryKey: ["/api/current/channels", selectedSlug, "members"],
    queryFn: async () => {
      const r = await fetch(`/api/current/channels/${encodeURIComponent(selectedSlug)}/members`, { credentials: "include" });
      if (!r.ok) return { members: [] };
      return r.json();
    },
    enabled: editChannelOpen && isAdmin,
    staleTime: 30_000,
  });
  const editChannelMembers = editChannelMembersData?.members ?? [];

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
  // Phase 15B: derived create-channel validation (computed after channels is available below)
  // These are referenced inside the Create Channel Dialog JSX; defined as a getter-style block
  // so they re-evaluate on every render using the live `channels` + `channelNameInput` values.

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

  // ── In-conv search debounce ───────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setInConvSearchDebounced(inConvSearchQ.trim()), 350);
    return () => clearTimeout(t);
  }, [inConvSearchQ]);

  // Reset in-conv search + older msgs when channel changes
  useEffect(() => {
    setInConvSearchOpen(false);
    setInConvSearchQ("");
    setInConvSearchDebounced("");
    setOlderChannelMsgs([]);
    setOlderChannelCursor(null);
  }, [selectedSlug]);

  // Reset older DM msgs when DM changes
  useEffect(() => {
    setOlderDmMsgs([]);
    setOlderDmCursor(null);
    setInConvSearchOpen(false);
    setInConvSearchQ("");
  }, [selectedDmId]);

  // ── In-conv search query (scoped to current channel or DM) ───────────────
  const { data: inConvSearchResp } = useQuery<SearchResponse>({
    queryKey: ["/api/current/search", "conv", view === "dm" ? selectedDmId : selectedSlug, inConvSearchDebounced],
    queryFn: () => {
      const p = new URLSearchParams({ q: inConvSearchDebounced, scope: "current", page_size: "12" });
      if (view === "channel" && selectedSlug) p.set("channel_slug", selectedSlug);
      else if (view === "dm" && selectedDmId) p.set("conversation_id", String(selectedDmId));
      return fetch(`/api/current/search?${p}`, { credentials: "include" }).then((r) => r.json());
    },
    enabled: inConvSearchDebounced.length >= 2 && inConvSearchOpen,
    staleTime: 20_000,
  });
  const inConvSearchItems = inConvSearchResp?.items ?? [];

  // ── Load-older handlers ───────────────────────────────────────────────────
  async function handleLoadOlderChannel() {
    if (!selectedSlug || loadingOlderChannel) return;
    const cursor = olderChannelMsgs.length > 0 ? olderChannelMsgs[0].createdAt : messages[0]?.createdAt;
    if (!cursor) return;
    setLoadingOlderChannel(true);
    try {
      const r = await fetch(
        `/api/current/channels/${encodeURIComponent(selectedSlug)}/messages?before=${encodeURIComponent(cursor)}`,
        { credentials: "include" }
      );
      if (!r.ok) return;
      const older: Message[] = await r.json();
      older.reverse(); // backend returns DESC when before= given; flip to ASC
      if (older.length > 0) {
        setOlderChannelMsgs((prev) => [...older, ...prev]);
        setOlderChannelCursor(older[0].createdAt);
      }
    } catch {
      // silently ignore
    } finally {
      setLoadingOlderChannel(false);
    }
  }

  async function handleLoadOlderDm() {
    if (!selectedDmId || loadingOlderDm) return;
    const cursor = olderDmMsgs.length > 0 ? olderDmMsgs[0].createdAt : dmMessages[0]?.createdAt;
    if (!cursor) return;
    setLoadingOlderDm(true);
    try {
      const r = await fetch(
        `/api/current/dms/${selectedDmId}/messages?before=${encodeURIComponent(cursor)}`,
        { credentials: "include" }
      );
      if (!r.ok) return;
      const older: DmMessage[] = await r.json();
      if (older.length > 0) setOlderDmMsgs((prev) => [...older, ...prev]);
    } catch {
      // silently ignore
    } finally {
      setLoadingOlderDm(false);
    }
  }

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
    mutationFn: async (data: { name: string; description: string; isPrivate?: boolean; memberIds?: number[] }) => {
      const r = await apiRequest("POST", "/api/current/channels", data);
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).message || "Failed to create channel"); }
      return r.json() as Promise<Channel>;
    },
    onSuccess: (channel) => {
      queryClient.invalidateQueries({ queryKey: ["/api/current/channels"] });
      setCreateChannelOpen(false);
      setChannelNameInput("");
      setChannelDescInput("");
      setCreateStep(1);
      setCreateVisibility("public");
      setCreateMemberIds([]);
      setSelectedSlug(channel.slug);
      setView("channel");
      toast({ title: "Channel created", description: `#${channel.slug} is ready.` });
    },
    onError: (err: Error) => toast({ title: "Could not create channel", description: err.message, variant: "destructive" }),
  });

  const editChannelMutation = useMutation({
    mutationFn: async (data: { name: string; description: string; isPrivate?: boolean }) => {
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
    onError: (err: Error) => toast({ title: "Could not update channel", description: err.message, variant: "destructive" }),
  });

  const removeChannelMemberMutation = useMutation({
    mutationFn: async ({ slug, userId }: { slug: string; userId: number }) => {
      const r = await apiRequest("DELETE", `/api/current/channels/${encodeURIComponent(slug)}/members/${userId}`, {});
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).message || "Failed to remove member"); }
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/current/channels", selectedSlug, "members"] }),
    onError: (err: Error) => toast({ title: "Could not remove member", description: err.message, variant: "destructive" }),
  });

  const addChannelMemberMutation = useMutation({
    mutationFn: async ({ slug, userId }: { slug: string; userId: number }) => {
      const r = await apiRequest("POST", `/api/current/channels/${encodeURIComponent(slug)}/members/${userId}`, {});
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).message || "Failed to add member"); }
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/current/channels", selectedSlug, "members"] }),
    onError: (err: Error) => toast({ title: "Could not add member", description: err.message, variant: "destructive" }),
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
    onError: (err: Error) => toast({ title: "Could not archive channel", description: err.message, variant: "destructive" }),
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
    onError: (err: Error) => toast({ title: "Could not unarchive channel", description: err.message, variant: "destructive" }),
  });

  // Post
  const postMutation = useMutation({
    mutationFn: ({ body, hasPendingAttachments }: { body: string; hasPendingAttachments?: boolean }) =>
      apiRequest("POST", `/api/current/channels/${selectedSlug}/messages`, { body, hasPendingAttachments })
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
          ? "Muted unread hidden from CURRENTS badge"
          : "Muted unread included in CURRENTS badge",
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
    onError: () => toast({ title: "Could not edit message", description: "Please try again.", variant: "destructive" }),
  });

  const dmDeleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/current/messages/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/current/dms", selectedDmId, "messages"] });
    },
    onError: () => toast({ title: "Could not delete message", description: "Please try again.", variant: "destructive" }),
  });

  const dmReactMutation = useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: number; emoji: string }) =>
      apiRequest("POST", `/api/current/messages/${messageId}/reactions`, { emoji }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["/api/current/dms", selectedDmId, "messages"] }),
  });

  const dmPinMutation = useMutation({
    mutationFn: (messageId: number) =>
      apiRequest("POST", `/api/current/messages/${messageId}/pin`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["/api/current/dms", selectedDmId, "messages"] }),
    onError: () => toast({ title: "Could not pin message", variant: "destructive" }),
  });

  const dmUnpinMutation = useMutation({
    mutationFn: (messageId: number) =>
      apiRequest("DELETE", `/api/current/messages/${messageId}/pin`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["/api/current/dms", selectedDmId, "messages"] }),
    onError: () => toast({ title: "Could not unpin message", variant: "destructive" }),
  });

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleSend() {
    // /summarize: no message — trigger channel summary directly
    if (channelSlash.selectedCommand?.id === "summarize") {
      channelSummaryMutation.mutate(selectedSlug);
      channelSlash.clearCommand();
      return;
    }
    const trimmed = draft.trim();
    const hasFiles = mainPendingFiles.length > 0;
    if ((!trimmed && !hasFiles) || postMutation.isPending || isMainUploading) return;
    const cmd = channelSlash.selectedCommand;
    try {
      const body = mainMention.serializeForSave(trimmed);
      const newMsg = await postMutation.mutateAsync({ body, hasPendingAttachments: hasFiles });
      channelSlash.clearCommand();
      setDraft("");
      mainMention.closeMention();
      mainMention.clearEntries();
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      isAtBottom.current = true;
      // Execute slash command on the newly sent message
      if (cmd && newMsg?.id) {
        if (cmd.id === "task") {
          handleCreateTaskFromMsg(newMsg as Message);
        } else if (cmd.id === "decision" || cmd.id === "risk" || cmd.id === "requirement") {
          markStructuredMutation.mutate({ messageId: newMsg.id, itemType: cmd.id });
          toast({ title: `Marked as ${cmd.id}` });
        } else if (cmd.id === "pin") {
          pinMutation.mutate(newMsg.id);
          toast({ title: "Message pinned" });
        }
      }
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
    } catch (err: any) {
      toast({ title: "Message not sent", description: err?.message ?? "Please try again.", variant: "destructive" });
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mainMention.handleMentionKeyDown(e, draft, setDraft)) return;
    const slashResult = channelSlash.handleMenuKeyDown(e);
    if (slashResult !== false) {
      if (typeof slashResult === "object") {
        channelSlash.selectCommand(slashResult);
        setDraft("");
      }
      return;
    }
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
    const cmd = dmSlash.selectedCommand;
    try {
      const body = dmMention.serializeForSave(trimmed);
      const newMsg = await dmPostMutation.mutateAsync({ body, hasPendingAttachments: hasFiles });
      dmSlash.clearCommand();
      setDmDraft("");
      dmMention.closeMention();
      dmMention.clearEntries();
      if (dmTextareaRef.current) dmTextareaRef.current.style.height = "auto";
      dmIsAtBottom.current = true;
      // Execute DM slash command
      if (cmd?.id === "task" && newMsg?.id) {
        handleCreateTaskFromMsg(newMsg as Message);
      }
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
    } catch (err: any) {
      toast({ title: "Message not sent", description: err?.message ?? "Please try again.", variant: "destructive" });
    }
  }

  function handleDmKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (dmMention.handleMentionKeyDown(e, dmDraft, setDmDraft)) return;
    const slashResult = dmSlash.handleMenuKeyDown(e);
    if (slashResult !== false) {
      if (typeof slashResult === "object") {
        dmSlash.selectCommand(slashResult);
        setDmDraft("");
      }
      return;
    }
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
    <div className="flex h-full overflow-hidden">

      {/* ── Channel sidebar ─────────────────────────────────────────────── */}
      <aside className="w-56 shrink-0 flex flex-col border-r border-border bg-muted/30 overflow-hidden">

        {/* Module header */}
        <div className="px-4 py-3 border-b border-border/60 shrink-0 bg-gradient-to-b from-primary/[0.04] to-transparent">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center shrink-0 ring-1 ring-primary/20 shadow-sm">
              <MessageSquare className="w-4 h-4 text-primary" />
            </div>
            <span className="font-bold text-[12.5px] text-foreground tracking-widest uppercase">
              CURRENTS
            </span>
            {totalUnread > 0 && (
              <span className="ml-auto min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold shrink-0 shadow-sm">
                {totalUnread > 99 ? "99+" : totalUnread}
              </span>
            )}
          </div>
        </div>

        {/* Section label */}
        <div className="px-4 pt-2 pb-0.5 shrink-0 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
            Channels
          </span>
          {isAdmin && (
            <button
              data-testid="btn-new-channel"
              onClick={() => { setChannelNameInput(""); setChannelDescInput(""); setCreateStep(1); setCreateVisibility("public"); setCreateMemberIds([]); setCreateChannelOpen(true); }}
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
                      "w-full flex items-center gap-2 px-2.5 py-1 rounded-lg text-[13px]",
                      "transition-all duration-100",
                      active
                        ? "bg-primary/20 text-primary font-semibold"
                        : isMutedChan
                          ? "text-muted-foreground/40 hover:bg-muted/40 hover:text-muted-foreground/70"
                          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                      isAdmin ? "pr-14" : "pr-7",
                    )}
                  >
                    {channel.isPrivate ? (
                      <Lock
                        className={cn(
                          "w-3.5 h-3.5 shrink-0 transition-opacity",
                          active ? "opacity-80" : isMutedChan ? "opacity-20" : "opacity-40 group-hover:opacity-60"
                        )}
                      />
                    ) : (
                      <Hash
                        className={cn(
                          "w-3.5 h-3.5 shrink-0 transition-opacity",
                          active ? "opacity-80" : isMutedChan ? "opacity-20" : "opacity-40 group-hover:opacity-60"
                        )}
                      />
                    )}
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
                          setEditIsPrivate(channel.isPrivate);
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
        <div className="px-4 pt-2 pb-0.5 shrink-0 flex items-center justify-between">
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
              className="w-full flex items-center gap-2 px-2.5 py-1 rounded-lg text-[12px] text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-muted/30 transition-colors"
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
                      "w-full flex items-center gap-2 px-2.5 py-1 rounded-lg text-[13px] pr-7",
                      "transition-all duration-100",
                      active
                        ? "bg-primary/20 text-primary font-semibold"
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
                            "w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white overflow-hidden",
                            avatarBg(dm.otherUser?.id ?? dm.conversationId)
                          )}
                        >
                          {dm.otherUser?.avatarUrl ? (
                            <img src={dm.otherUser.avatarUrl} alt={dm.otherUser.name} className="w-full h-full object-cover" />
                          ) : (
                            initials(dm.otherUser?.name ?? dm.displayName)
                          )}
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
              "w-full flex items-center gap-2 px-2.5 py-1 rounded-lg text-[13px]",
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
              "w-full flex items-center gap-2 px-2.5 py-1 rounded-lg text-[13px]",
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
              "w-full flex items-center gap-2 px-2.5 py-1 rounded-lg text-[13px]",
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
        <div className="px-5 py-3.5 border-b border-border/60 flex items-center gap-2.5 shrink-0 min-w-0 bg-muted/20">
          {view === "mentions" ? (
            <>
              <AtSign className="w-4 h-4 text-primary/60 shrink-0" />
              <span className="font-bold text-[14px] text-foreground shrink-0 tracking-tight">
                Mentions
              </span>
            </>
          ) : view === "search" ? (
            <>
              <Search className="w-4 h-4 text-primary/60 shrink-0" />
              <span className="font-bold text-[14px] text-foreground shrink-0 tracking-tight">
                Search
              </span>
            </>
          ) : view === "structured" ? (
            <>
              <Bookmark className="w-4 h-4 text-primary/60 shrink-0" />
              <span className="font-bold text-[14px] text-foreground shrink-0 tracking-tight">
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
                    "w-6 h-6 rounded-full flex items-center justify-center shrink-0 overflow-hidden",
                    "text-[10px] font-bold text-white",
                    selectedDm ? avatarBg(selectedDm.otherUser?.id ?? selectedDm.conversationId) : "bg-muted"
                  )}
                >
                  {selectedDm?.otherUser?.avatarUrl ? (
                    <img src={selectedDm.otherUser.avatarUrl} alt={selectedDm.otherUser.name} className="w-full h-full object-cover" />
                  ) : (
                    selectedDm ? initials(selectedDm.otherUser?.name ?? selectedDm.displayName) : "?"
                  )}
                </div>
              )}
              <span className="font-bold text-[14px] text-foreground shrink-0 tracking-tight">
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
              {selectedChannel?.isPrivate ? (
                <Lock className="w-4 h-4 text-primary/60 shrink-0" />
              ) : (
                <Hash className="w-4 h-4 text-primary/60 shrink-0" />
              )}
              <span className="font-bold text-[14px] text-foreground shrink-0 tracking-tight">
                {displaySlug(selectedSlug)}
              </span>
              {isArchivedChannel && <ArchivedBadge />}
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
                onClick={() => { setChannelDetailsTab("members"); setChannelParticipantsOpen(true); }}
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
              <button
                onClick={() => { setInConvSearchOpen((v) => !v); setInConvSearchQ(""); }}
                data-testid="btn-conv-search-toggle"
                title={inConvSearchOpen ? "Close search" : "Search in this conversation"}
                className={cn(
                  "shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-md text-[11.5px] font-medium transition-colors",
                  inConvSearchOpen
                    ? "bg-primary/10 text-primary/80 hover:bg-primary/15"
                    : "text-muted-foreground/50 hover:text-foreground hover:bg-muted/60",
                )}
              >
                <Search className="w-3 h-3" />
                <span className="hidden sm:inline">{inConvSearchOpen ? "Close" : "Search"}</span>
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

        {/* In-conversation search panel */}
        {inConvSearchOpen && (view === "channel" || view === "dm") && (
          <div className="border-b border-border/50 bg-muted/5 px-4 py-2.5 shrink-0" data-testid="in-conv-search-panel">
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50 pointer-events-none" />
              <input
                value={inConvSearchQ}
                onChange={(e) => setInConvSearchQ(e.target.value)}
                placeholder={view === "channel" ? `Search in #${displaySlug(selectedSlug)}…` : "Search in this conversation…"}
                autoFocus
                data-testid="in-conv-search-input"
                className={cn(
                  "w-full pl-7 pr-7 py-1.5 text-[12.5px] rounded-lg border",
                  "bg-background/80 border-border/40 text-foreground placeholder:text-muted-foreground/40",
                  "focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/40 transition-all"
                )}
              />
              {inConvSearchQ && (
                <button onClick={() => setInConvSearchQ("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground" data-testid="in-conv-search-clear">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            {inConvSearchDebounced.length >= 2 && (
              <div className="space-y-1 max-h-56 overflow-y-auto" data-testid="in-conv-search-results">
                {inConvSearchItems.length === 0 ? (
                  <p className="text-[11.5px] text-muted-foreground/50 py-2 text-center">No messages found for &ldquo;{inConvSearchDebounced}&rdquo;</p>
                ) : (
                  inConvSearchItems.slice(0, 10).map((r) => (
                    <button
                      key={`iconv-${r.id}`}
                      data-testid={`in-conv-result-${r.id}`}
                      onClick={() => {
                        if (r.id) setHighlight(r.id);
                        setInConvSearchOpen(false);
                        setInConvSearchQ("");
                      }}
                      className="w-full text-left rounded-lg px-3 py-2 hover:bg-muted/40 transition-colors border border-transparent hover:border-border/30"
                    >
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="text-[11px] font-medium text-foreground/70 truncate">{r.userName ?? ""}</span>
                        <span className="text-[10px] text-muted-foreground/40 shrink-0 tabular-nums">{formatTs(r.createdAt ?? "")}</span>
                      </div>
                      <p className="text-[11.5px] text-foreground/60 line-clamp-1">
                        {r.snippet ? highlightMatch(r.snippet, inConvSearchDebounced) : <span className="italic text-muted-foreground/40">No preview</span>}
                      </p>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* Phase 19A: Slack-style tab row */}
        {(view === "channel" || view === "dm") && (
          <div className="border-b border-border/40 px-4 bg-muted/10 shrink-0 flex items-end gap-0 overflow-x-auto">
            {view === "channel" ? (
              <>
                {(["messages", "files", "pins", "structured"] as const).map((tab) => {
                  const labels: Record<string, string> = { messages: "Messages", files: "Files", pins: "Pins", structured: "Structured" };
                  return (
                    <button key={tab} data-testid={`channel-tab-${tab}`} onClick={() => setChannelTab(tab)}
                      className={cn("px-3 py-2 text-[12px] font-medium transition-colors border-b-2 -mb-px whitespace-nowrap shrink-0",
                        channelTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground/50 hover:text-foreground hover:bg-muted/30")}>
                      {labels[tab]}
                    </button>
                  );
                })}
                <button data-testid="channel-tab-members" onClick={() => { setChannelDetailsTab("members"); setChannelParticipantsOpen(true); }}
                  className="px-3 py-2 text-[12px] font-medium transition-colors border-b-2 border-transparent -mb-px whitespace-nowrap shrink-0 text-muted-foreground/50 hover:text-foreground hover:bg-muted/30">
                  Members
                </button>
              </>
            ) : (
              <>
                {(["messages", "files"] as const).map((tab) => (
                  <button key={tab} data-testid={`dm-tab-${tab}`} onClick={() => setDmTab(tab)}
                    className={cn("px-3 py-2 text-[12px] font-medium transition-colors border-b-2 -mb-px whitespace-nowrap shrink-0",
                      dmTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground/50 hover:text-foreground hover:bg-muted/30")}>
                    {tab === "messages" ? "Messages" : "Files"}
                  </button>
                ))}
                <button data-testid="dm-tab-search" onClick={() => setView("search")}
                  className="px-3 py-2 text-[12px] font-medium transition-colors border-b-2 border-transparent -mb-px whitespace-nowrap shrink-0 text-muted-foreground/50 hover:text-foreground hover:bg-muted/30">
                  Search
                </button>
              </>
            )}
          </div>
        )}
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
              setHighlight(threadId ?? messageId);
            }}
            onNavigateDm={(convId, messageId) => {
              setSelectedDmId(convId);
              setView("dm");
              setTimeout(() => setHighlight(messageId), 300);
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
          <div
            className="flex-1 flex flex-col min-w-0 overflow-hidden relative"
            data-testid="dm-drop-zone"
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (Array.from(e.dataTransfer.types).includes("Files")) {
                dmDragCounter.current++;
                setDmDragOver(true);
              }
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              dmDragCounter.current--;
              if (dmDragCounter.current <= 0) {
                dmDragCounter.current = 0;
                setDmDragOver(false);
              }
            }}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              dmDragCounter.current = 0;
              setDmDragOver(false);
              const files = Array.from(e.dataTransfer.files);
              if (files.length > 0) setDmPendingFiles((prev) => [...prev, ...files]);
            }}
          >
            {/* Drag-over overlay */}
            {dmDragOver && (
              <div
                className="absolute inset-0 z-50 flex flex-col items-center justify-center pointer-events-none"
                data-testid="dm-drag-overlay"
                style={{ background: "hsl(var(--primary)/0.07)", border: "2px dashed hsl(var(--primary)/0.45)", borderRadius: 0 }}
              >
                <Upload className="w-10 h-10 mb-3" style={{ color: "hsl(var(--primary)/0.7)" }} />
                <p className="text-sm font-semibold" style={{ color: "hsl(var(--primary)/0.85)" }}>
                  Drop files to upload to this conversation
                </p>
              </div>
            )}
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
                <div className="flex flex-col items-center justify-center py-20 gap-5 select-none">
                  {selectedDm?.type === 'group_dm' ? (
                    <div className="relative">
                      <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl opacity-40 scale-125" />
                      <div className="relative w-20 h-20 rounded-full flex items-center justify-center bg-muted/80 border border-border/60 shadow-lg">
                        <Users className="w-9 h-9 text-muted-foreground/50" />
                      </div>
                    </div>
                  ) : (
                    <div className="relative">
                      <div className="absolute inset-0 rounded-full blur-xl opacity-30 scale-125"
                        style={{ background: "hsl(var(--primary))" }} />
                      <div
                        className={cn(
                          "relative w-20 h-20 rounded-full flex items-center justify-center overflow-hidden shadow-lg",
                          "text-lg font-bold text-white ring-2 ring-white/10",
                          selectedDm ? avatarBg(selectedDm.otherUser?.id ?? selectedDm.conversationId) : "bg-muted"
                        )}
                      >
                        {selectedDm?.otherUser?.avatarUrl ? (
                          <img src={selectedDm.otherUser.avatarUrl} alt={selectedDm.otherUser.name} className="w-full h-full object-cover" />
                        ) : (
                          selectedDm ? initials(selectedDm.otherUser?.name ?? selectedDm.displayName) : "?"
                        )}
                      </div>
                    </div>
                  )}
                  <div className="text-center">
                    <div className="text-[15px] font-semibold text-foreground/80 mb-1.5">
                      {selectedDm?.displayName ?? "Your teammate"}
                    </div>
                    <div className="text-[13px] text-muted-foreground/60 leading-relaxed max-w-[200px]">
                      {selectedDm?.type === 'group_dm' ? "Kick off the group conversation!" : "Say hi to start the conversation."}
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {/* DM Load older messages */}
                  {(olderDmMsgs.length > 0 || dmMessages.length >= 100) && (
                    <div className="flex justify-center py-3" data-testid="load-older-dm-wrapper">
                      <button
                        onClick={handleLoadOlderDm}
                        disabled={loadingOlderDm}
                        data-testid="btn-load-older-dm"
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-medium text-muted-foreground hover:text-foreground bg-muted/30 hover:bg-muted/50 border border-border/30 transition-colors disabled:opacity-50"
                      >
                        {loadingOlderDm ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronLeft className="w-3 h-3" />}
                        Load older messages
                      </button>
                    </div>
                  )}
                  {olderDmMsgs.map((msg) => (
                    <div
                      key={`older-dm-${msg.id}`}
                      data-testid={`message-row-${msg.id}`}
                      className={cn(msg.id === highlightedMsgId && "rounded-lg ring-1 ring-primary/30 bg-primary/[0.04] transition-all")}
                    >
                      <MessageRow
                        key={msg.id}
                        message={{ ...msg, channelId: 0, replyCount: 0, latestReplyAt: null, structuredItems: msg.structuredItems ?? [] }}
                        currentUserId={currentUserId}
                        isArchived={false}
                        grouped={false}
                        isAdmin={isAdmin}
                        pinnedMessageIds={new Set()}
                        onToggleReaction={(mid, emoji) => dmReactMutation.mutate({ messageId: mid, emoji })}
                        onEdit={() => setEditingDmMessage(msg)}
                        onDelete={() => dmDeleteMutation.mutate(msg.id)}
                        onPin={() => dmPinMutation.mutate(msg.id)}
                        onOpenThread={() => setThreadRootId(msg.id)}
                        onMarkStructured={() => {}}
                        onUnmarkStructured={() => {}}
                      />
                    </div>
                  ))}
                  {dmMessages.map((msg, i) => {
                  const prev = dmMessages[i - 1];
                  const isConsecutive =
                    prev &&
                    !prev.deletedAt &&
                    prev.userId === msg.userId &&
                    new Date(msg.createdAt).getTime() -
                      new Date(prev.createdAt).getTime() <
                      5 * 60 * 1000;
                  const showDmDateDivider = !msg.deletedAt && msgIsNewDay(prev?.createdAt, msg.createdAt);
                  if (editingDmMessage?.id === msg.id) {
                    return (
                      <InlineEditRow
                        key={msg.id}
                        message={{ ...msg, channelId: 0, replyCount: 0, latestReplyAt: null, structuredItems: msg.structuredItems ?? [] }}
                        onSave={(body) => dmEditMutation.mutate({ id: msg.id, body })}
                        onCancel={() => setEditingDmMessage(null)}
                      />
                    );
                  }
                  return (
                    <>
                      {showDmDateDivider && (
                        <div className="flex items-center gap-3 py-3 select-none" aria-hidden>
                          <div className="flex-1 h-px bg-border/30" />
                          <span className="text-[11px] font-medium text-muted-foreground/40 px-2 whitespace-nowrap">
                            {formatDateDivider(msg.createdAt)}
                          </span>
                          <div className="flex-1 h-px bg-border/30" />
                        </div>
                      )}
                    <MessageRow
                      key={msg.id}
                      message={{ ...msg, channelId: 0, replyCount: 0, latestReplyAt: null, structuredItems: msg.structuredItems ?? [] }}
                      currentUserId={currentUserId}
                      grouped={isConsecutive}
                      isAdmin={isAdmin}
                      isArchived={false}
                      pinnedMessageIds={new Set()}
                      onToggleReaction={(mid, emoji) => dmReactMutation.mutate({ messageId: mid, emoji })}
                      onEdit={() => setEditingDmMessage(msg)}
                      onDelete={() => dmDeleteMutation.mutate(msg.id)}
                      onPin={() => dmPinMutation.mutate(msg.id)}
                      onOpenThread={() => setThreadRootId(msg.id)}
                      onMarkStructured={() => {}}
                      onUnmarkStructured={() => {}}
                    />
                    </>
                  );
                })}
                </>
              )}
            </div>

            {/* Phase 19B: DM Files tab — real file library */}
            {dmTab === "files" && (
              <div className="flex-1 flex flex-col min-h-0">
                <CurrentFilesTab
                  conversationId={selectedDmId}
                  onJumpToMessage={(_msgId, snippet) => {
                    setDmTab("messages");
                    toast({ title: "Showing messages", description: snippet ? `"${snippet.slice(0, 80)}"` : undefined });
                  }}
                />
              </div>
            )}

            {/* DM Composer */}
            <div className="px-4 pb-5 shrink-0 border-t border-border/50 bg-muted/10 pt-3">
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
              {dmSlash.menuOpen && (
                <SlashCommandMenu
                  commands={dmSlash.filteredCommands}
                  activeIndex={dmSlash.activeIndex}
                  onSelect={(cmd) => { dmSlash.selectCommand(cmd); setDmDraft(""); }}
                  onHover={dmSlash.setActiveIndex}
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
              {dmSlash.selectedCommand && (
                <SlashCommandPill command={dmSlash.selectedCommand} onClear={dmSlash.clearCommand} />
              )}
              <div
                className={cn(
                  "flex items-end gap-2 rounded-2xl px-3.5 py-2.5 transition-all duration-150",
                  "bg-muted/40 border border-border/50",
                  "focus-within:border-primary/50 focus-within:bg-background/80",
                  "focus-within:shadow-[0_0_0_3px_hsl(var(--primary)/0.10)]"
                )}
              >
                <textarea
                  ref={dmTextareaRef}
                  data-testid="dm-composer-input"
                  value={dmDraft}
                  onChange={handleDmDraftChange}
                  onKeyDown={handleDmKeyDown}
                  placeholder={selectedDm?.type === "group_dm" ? "Message the group…" : `Message ${selectedDm?.otherUser?.name ?? selectedDm?.displayName ?? "your teammate"}…`}
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
                Enter to send · Shift+Enter for new line · @ to mention · / for commands · 📎 to attach
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
            {channelTab === "messages" && <PinnedBar pins={pins} onUnpin={(mid) => unpinMutation.mutate(mid)} />}

            {/* Phase 19A: tab panels */}
            {/* Phase 19B: channel Files tab — real file library */}
            {channelTab === "files" && (
              <div className="flex-1 flex flex-col min-h-0">
                <CurrentFilesTab
                  channelSlug={selectedSlug}
                  onJumpToMessage={(_msgId, snippet) => {
                    setChannelTab("messages");
                    toast({ title: "Showing messages", description: snippet ? `"${snippet.slice(0, 80)}"` : undefined });
                  }}
                />
              </div>
            )}
            {channelTab === "pins" && (
              <div className="flex-1 overflow-y-auto px-5 py-6 space-y-3">
                {pins.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-4 select-none">
                    <Pin className="w-12 h-12 text-muted-foreground/15" />
                    <p className="text-[13px] font-medium text-muted-foreground/50">No pinned messages</p>
                    <p className="text-[12px] text-muted-foreground/35 mt-1">Pin important messages so they're easy to find.</p>
                  </div>
                ) : pins.map(pin => (
                  <div key={pin.id} className="group flex items-start gap-3 px-3 py-2.5 rounded-xl bg-muted/20 border border-border/30 hover:bg-muted/30 transition-colors">
                    <Pin className="w-3.5 h-3.5 text-primary/50 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 mb-0.5">
                        <span className="text-[12.5px] font-semibold text-foreground/80">{pin.messageUserName}</span>
                        <span className="text-[10.5px] text-muted-foreground/40">{formatTs(pin.messageCreatedAt)}</span>
                      </div>
                      <p className="text-[13px] text-foreground/70 leading-snug break-words">
                        {pin.messageBody || <em className="text-muted-foreground/40">Attachment</em>}
                      </p>
                      {pin.pinnedByName && <p className="text-[10.5px] text-muted-foreground/35 mt-1">Pinned by {pin.pinnedByName}</p>}
                    </div>
                    <button onClick={() => unpinMutation.mutate(pin.messageId)}
                      className="opacity-0 group-hover:opacity-100 shrink-0 w-6 h-6 rounded flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-muted/60 transition-all" title="Unpin">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {channelTab === "structured" && (
              <StructuredItemsPanel selectedSlug={selectedSlug}
                onChannelNavigate={(slug, messageId, threadId) => {
                  setSelectedSlug(slug); setView("channel"); setChannelTab("messages");
                  setThreadRootId(threadId ?? null); setHighlight(threadId ?? messageId);
                }}
              />
            )}

            {/* Message feed (Messages tab only) */}
            {channelTab === "messages" && (
            <div
              className="flex-1 flex flex-col min-h-0 relative"
              data-testid="channel-drop-zone"
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (Array.from(e.dataTransfer.types).includes("Files")) {
                  mainDragCounter.current++;
                  setMainDragOver(true);
                }
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                mainDragCounter.current--;
                if (mainDragCounter.current <= 0) {
                  mainDragCounter.current = 0;
                  setMainDragOver(false);
                }
              }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                mainDragCounter.current = 0;
                setMainDragOver(false);
                const files = Array.from(e.dataTransfer.files);
                if (files.length > 0) setMainPendingFiles((prev) => [...prev, ...files]);
              }}
            >
              {/* Drag-over overlay */}
              {mainDragOver && (
                <div
                  className="absolute inset-0 z-50 flex flex-col items-center justify-center pointer-events-none"
                  data-testid="channel-drag-overlay"
                  style={{ background: "hsl(var(--primary)/0.07)", border: "2px dashed hsl(var(--primary)/0.45)", borderRadius: 0 }}
                >
                  <Upload className="w-10 h-10 mb-3" style={{ color: "hsl(var(--primary)/0.7)" }} />
                  <p className="text-sm font-semibold" style={{ color: "hsl(var(--primary)/0.85)" }}>
                    Drop files to upload to this conversation
                  </p>
                </div>
              )}
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
                  {/* Load older messages — shown when there are 100+ messages loaded */}
                  {(olderChannelMsgs.length > 0 || messages.length >= 100) && (
                    <div className="flex justify-center py-3" data-testid="load-older-channel-wrapper">
                      <button
                        onClick={handleLoadOlderChannel}
                        disabled={loadingOlderChannel}
                        data-testid="btn-load-older-channel"
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-medium text-muted-foreground hover:text-foreground bg-muted/30 hover:bg-muted/50 border border-border/30 transition-colors disabled:opacity-50"
                      >
                        {loadingOlderChannel ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronLeft className="w-3 h-3" />}
                        Load older messages
                      </button>
                    </div>
                  )}
                  {/* Older messages prepended */}
                  {olderChannelMsgs.map((msg) => (
                    <div
                      key={`older-${msg.id}`}
                      data-testid={`message-row-${msg.id}`}
                      className={cn(msg.id === highlightedMsgId && "rounded-lg ring-1 ring-primary/30 bg-primary/[0.04] transition-all")}
                    >
                      <MessageRow
                        message={msg}
                        isArchived={isArchivedChannel}
                        grouped={false}
                        isAdmin={isAdmin}
                        isArchived2={isArchivedChannel}
                        pinnedMessageIds={pinnedMessageIds}
                        onToggleReaction={(mid, emoji) => reactMutation.mutate({ messageId: mid, emoji })}
                        onEdit={() => setEditingMessage(msg)}
                        onDelete={() => deleteMutation.mutate(msg.id)}
                        onPin={() => pinMutation.mutate(msg.id)}
                        onOpenThread={() => setThreadRootId(msg.id)}
                        onMarkStructured={() => {}}
                        onUnmarkStructured={() => {}}
                      />
                    </div>
                  ))}
                  {messages.map((msg, i) => {
                    const isHighlighted = msg.id === highlightedMsgId;
                    const showDateDivider = !msg.deletedAt && msgIsNewDay(messages[i - 1]?.createdAt, msg.createdAt);
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
                      <>
                        {showDateDivider && (
                          <div className="flex items-center gap-3 py-3 select-none" aria-hidden>
                            <div className="flex-1 h-px bg-border/30" />
                            <span className="text-[11px] font-medium text-muted-foreground/40 px-2 whitespace-nowrap">
                              {formatDateDivider(msg.createdAt)}
                            </span>
                            <div className="flex-1 h-px bg-border/30" />
                          </div>
                        )}
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
                      </>
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
            <div className="px-5 pt-3 pb-5 border-t border-border/50 shrink-0 bg-muted/10">
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
              {channelSlash.menuOpen && (
                <SlashCommandMenu
                  commands={channelSlash.filteredCommands}
                  activeIndex={channelSlash.activeIndex}
                  onSelect={(cmd) => { channelSlash.selectCommand(cmd); setDraft(""); }}
                  onHover={channelSlash.setActiveIndex}
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
              {channelSlash.selectedCommand && (
                <SlashCommandPill command={channelSlash.selectedCommand} onClear={channelSlash.clearCommand} />
              )}
              <div
                className={cn(
                  "flex items-end gap-2 rounded-2xl px-3.5 py-2.5 transition-all duration-150",
                  "bg-muted/40 border border-border/50",
                  "focus-within:border-primary/50 focus-within:bg-background/80",
                  "focus-within:shadow-[0_0_0_3px_hsl(var(--primary)/0.10)]"
                )}
              >
                <Textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={handleDraftChange}
                  onKeyDown={handleKeyDown}
                  placeholder={`Message #${displaySlug(selectedSlug)}…`}
                  className={cn(
                    "flex-1 border-0 bg-transparent shadow-none resize-none p-0",
                    "text-[13.5px] placeholder:text-muted-foreground/40 leading-relaxed",
                    "focus-visible:ring-0 focus-visible:ring-offset-0",
                    "min-h-[22px] max-h-36 overflow-y-auto"
                  )}
                  rows={1}
                  data-testid="composer-input"
                />
                <EmojiPickerPopover
                  onSelect={(emoji) => {
                    setDraft((d) => d + emoji);
                    textareaRef.current?.focus();
                  }}
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
                  disabled={(!draft.trim() && mainPendingFiles.length === 0 && channelSlash.selectedCommand?.id !== "summarize") || postMutation.isPending || isMainUploading}
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
                Enter to send · Shift+Enter for new line · @ to mention · / for commands · 📎 to attach
              </p>
            </div>
            )}
            </div>)}
          </>
        )}
      </div>

      {/* ── Create Channel Dialog (multi-step) ─────────────────────────── */}
      <Dialog open={createChannelOpen} onOpenChange={(o) => {
        setCreateChannelOpen(o);
        if (!o) { setCreateStep(1); setCreateVisibility("public"); setCreateMemberIds([]); setChannelNameInput(""); setChannelDescInput(""); }
      }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{createStep === 1 ? "New Channel" : "Set Visibility"}</DialogTitle>
          </DialogHeader>

          {createStep === 1 ? (
            /* ── Step 1: Name + Description ─────────────────── */
            <div className="space-y-3 pt-1">
              <div>
                <label className="text-[12px] font-medium text-muted-foreground mb-1.5 block">Channel name</label>
                <div className="flex items-center rounded-md border border-input overflow-hidden focus-within:ring-1 focus-within:ring-ring">
                  <span className="px-3 h-9 flex items-center text-sm text-muted-foreground bg-muted/40 border-r border-input select-none shrink-0">#</span>
                  <input
                    data-testid="input-channel-name"
                    value={channelNameInput}
                    onChange={(e) => setChannelNameInput(e.target.value)}
                    placeholder="e.g. marina-sales"
                    maxLength={80}
                    autoFocus
                    className="flex-1 h-9 px-3 text-sm bg-transparent outline-none"
                    onKeyDown={(e) => {
                      const slug = normalizeChannelSlug(channelNameInput);
                      const nameValid = slug.length > 0 && !channels.some((c) => c.slug === slug);
                      if (e.key === "Enter" && nameValid) setCreateStep(2);
                    }}
                  />
                </div>
                {(() => {
                  const slug = normalizeChannelSlug(channelNameInput);
                  const raw = channelNameInput.trim();
                  if (!raw) return (
                    <p className="text-[11px] text-muted-foreground/40 mt-1">Letters, numbers, hyphens and underscores only.</p>
                  );
                  if (slug.length === 0) return (
                    <p className="text-[11px] text-destructive mt-1" data-testid="create-slug-error">Channel names can only use letters, numbers, hyphens, and underscores.</p>
                  );
                  if (channels.some((c) => c.slug === slug)) return (
                    <p className="text-[11px] text-destructive mt-1" data-testid="create-slug-error">A channel named <span className="font-mono">#{slug}</span> already exists.</p>
                  );
                  return (
                    <p className="text-[11px] text-muted-foreground/60 mt-1">
                      Slug: <span className="font-mono text-primary/70">#{normalizeChannelSlug(channelNameInput)}</span>
                    </p>
                  );
                })()}
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
          ) : (
            /* ── Step 2: Visibility + Members ───────────────── */
            <div className="space-y-3 pt-1">
              <div className="space-y-2">
                {/* Public option */}
                <button
                  type="button"
                  data-testid="visibility-option-public"
                  onClick={() => setCreateVisibility("public")}
                  className={`w-full text-left rounded-lg border p-3 transition-all ${
                    createVisibility === "public"
                      ? "border-primary bg-primary/5"
                      : "border-border/60 hover:border-border"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${createVisibility === "public" ? "border-primary" : "border-border"}`}>
                      {createVisibility === "public" && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                    </div>
                    <div>
                      <p className="text-[12px] font-semibold leading-tight">Public</p>
                      <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">All VoltSafe CMS users can view and post</p>
                    </div>
                  </div>
                </button>
                {/* Private option */}
                <button
                  type="button"
                  data-testid="visibility-option-private"
                  onClick={() => setCreateVisibility("private")}
                  className={`w-full text-left rounded-lg border p-3 transition-all ${
                    createVisibility === "private"
                      ? "border-primary bg-primary/5"
                      : "border-border/60 hover:border-border"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${createVisibility === "private" ? "border-primary" : "border-border"}`}>
                      {createVisibility === "private" && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                    </div>
                    <div>
                      <p className="text-[12px] font-semibold leading-tight">Private</p>
                      <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">Only invited users can view and post</p>
                    </div>
                  </div>
                </button>
              </div>

              {/* Member picker — only shown when Private selected */}
              {createVisibility === "private" && (
                <div>
                  <label className="text-[12px] font-medium text-muted-foreground mb-1.5 block">
                    Invite members <span className="text-muted-foreground/40">(you are added automatically)</span>
                  </label>
                  <MemberPickerInline
                    selectedIds={createMemberIds}
                    onChange={setCreateMemberIds}
                  />
                  {createMemberIds.length === 0 && (
                    <p className="text-[11px] text-destructive mt-1.5" data-testid="private-member-error">
                      Private channels need at least one invited user.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter className="mt-2">
            {createStep === 1 ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => setCreateChannelOpen(false)}>Cancel</Button>
                <Button
                  size="sm"
                  data-testid="btn-channel-next"
                  onClick={() => setCreateStep(2)}
                  disabled={(() => {
                    const slug = normalizeChannelSlug(channelNameInput);
                    return slug.length === 0 || channels.some((c) => c.slug === slug);
                  })()}
                >
                  Next
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={() => setCreateStep(1)}>Back</Button>
                <Button
                  size="sm"
                  data-testid="btn-create-channel-submit"
                  onClick={() => createChannelMutation.mutate({
                    name: channelNameInput.trim(),
                    description: channelDescInput.trim(),
                    isPrivate: createVisibility === "private",
                    memberIds: createMemberIds,
                  })}
                  disabled={createChannelMutation.isPending || (createVisibility === "private" && createMemberIds.length === 0)}
                >
                  {createChannelMutation.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                  Create Channel
                </Button>
              </>
            )}
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
                {/* Private toggle */}
                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-[12px] font-medium text-foreground/80 leading-tight">Private channel</p>
                    <p className="text-[11px] text-muted-foreground/60 leading-tight mt-0.5">Only invited members can see it</p>
                  </div>
                  <Switch
                    data-testid="toggle-edit-channel-private"
                    checked={editIsPrivate}
                    onCheckedChange={setEditIsPrivate}
                  />
                </div>
                {/* Member management — only shown for private channels */}
                {editIsPrivate && (
                  <div>
                    <label className="text-[12px] font-medium text-muted-foreground mb-2 block">Members</label>
                    <div className="border border-border/50 rounded-md max-h-36 overflow-y-auto mb-2">
                      {editChannelMembers.length === 0 ? (
                        <p className="px-3 py-2 text-[11px] text-muted-foreground/50">No members yet</p>
                      ) : (
                        editChannelMembers.map((m) => (
                          <div key={m.id} className="flex items-center justify-between px-3 py-1.5 hover:bg-muted/30 transition-colors">
                            <div className="min-w-0">
                              <span className="text-[12px] font-medium text-foreground/80">{m.name}</span>
                              <span className="text-[11px] text-muted-foreground/50 ml-1.5 truncate">{m.email}</span>
                            </div>
                            <button
                              type="button"
                              data-testid={`remove-channel-member-${m.id}`}
                              onClick={() => removeChannelMemberMutation.mutate({ slug: selectedSlug, userId: m.id })}
                              disabled={removeChannelMemberMutation.isPending}
                              className="w-5 h-5 shrink-0 flex items-center justify-center rounded text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                    <MemberPickerInline
                      selectedIds={[]}
                      onChange={(ids) => {
                        const newId = ids[0];
                        if (newId) addChannelMemberMutation.mutate({ slug: selectedSlug, userId: newId });
                      }}
                      excludeIds={editChannelMembers.map((m) => m.id)}
                    />
                  </div>
                )}
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
                    onClick={() => editChannelMutation.mutate({ name: channelEditNameInput.trim(), description: channelEditDescInput.trim(), isPrivate: editIsPrivate })}
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

      {/* Phase 19C: ChannelDetailsModal call site */}
      <ChannelDetailsModal
        open={channelParticipantsOpen}
        onOpenChange={setChannelParticipantsOpen}
        defaultTab={channelDetailsTab}
        channelSlug={selectedSlug}
        channel={selectedChannel ?? null}
        channelDirect={selectedChannelDirect ?? null}
        participants={channelParticipants}
        pins={pins}
        messages={messages}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
        isArchived={isArchivedChannel}
        presenceMap={presenceMap}
        onPrefChange={(level) => {
          if (selectedChannel?.id) channelPrefMutation.mutate({ channelId: selectedChannel.id, notificationLevel: level });
        }}
        onUnarchive={() => {
          if (selectedChannelDirect?.id) unarchiveChannelMutation.mutate(selectedChannelDirect.id);
        }}
        onOpenEditChannel={() => {
          setChannelParticipantsOpen(false);
          setChannelEditNameInput(selectedChannel?.name ?? "");
          setChannelEditDescInput(selectedChannel?.description ?? "");
          setEditChannelOpen(true);
        }}
        onRemoveMember={(userId) => removeChannelMemberMutation.mutate({ slug: selectedSlug, userId })}
        onAddMember={(userId) => addChannelMemberMutation.mutate({ slug: selectedSlug, userId })}
        onUnpin={(messageId) => unpinMutation.mutate(messageId)}
      />

      {/* ── Thread panel ────────────────────────────────────────────────── */}
      {threadRootId !== null && (
        <ThreadPanel
          rootMessageId={threadRootId}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          isArchived={isArchivedChannel}
          selectedSlug={selectedSlug}
          conversationId={view === "dm" ? selectedDmId ?? undefined : undefined}
          onClose={() => setThreadRootId(null)}
          onCreateTaskMsg={handleCreateTaskFromMsg}
          onCreateSummaryTask={(item) => setCreateTaskSource({ kind: "summary_action_item", task: item.task, owner: item.owner, due: item.due, summaryContext: `Thread in #${selectedSlug}`, channelSlug: selectedSlug, threadRootId: threadRootId ?? undefined })}
        />
      )}
    </div>
  );
}
