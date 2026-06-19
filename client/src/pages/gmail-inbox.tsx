import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { buildEmailHtml, htmlToCleanHtml, isBodyEmpty, stripEmailWrapper, plainTextToHtml, sanitizeSignatureHtmlClientSide, normalizeSignatureHtmlClientSide, emergencyStripDangerousHtml, signatureToTextFallback } from "@/lib/email-format";
import { CtaEngagementBanner, ThreadEngagementWidget } from "@/components/engagement/EngagementWidget";
import { buildLinkPreviewCardHtml, buildLinkPreviewLoadingHtml } from "@/lib/link-preview-card";
import { createPortal } from "react-dom";
import { EmailTokenInput } from "@/components/email/email-autocomplete";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { inboxQueryKey, INBOX_QK_PREFIX } from "@/lib/inbox-query-key";

// C3: Returns a user-scoped localStorage key to prevent state bleed between users on shared browsers.
// queryClient already has /api/auth/me cached by the time GmailInboxPage mounts (auth gate in App.tsx).
// If userId is unavailable (should never happen given the auth gate, but defensive), we use an
// ephemeral anon prefix rather than the bare key — this guarantees we never silently write to an
// unscoped key that could be read by a subsequent user's session.
const _anonLsPrefix = typeof crypto !== "undefined" ? crypto.randomUUID().slice(0, 8) : "anon";
function lsKey(key: string): string {
  try {
    const u = queryClient.getQueryData<{ id: number }>(["/api/auth/me"]);
    if (u?.id) return `u${u.id}.${key}`;
    // Fallback: ephemeral anon prefix — won't match any user-scoped key and
    // won't persist meaningfully (new prefix on every page load).
    return `_anon_${_anonLsPrefix}.${key}`;
  } catch { return `_anon_${_anonLsPrefix}.${key}`; }
}
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import {
  Search, Mail, MailOpen, Send, RefreshCw, Inbox, X, ChevronLeft, Loader2, Link2, Ban, FolderX, Trash2,
  Clock, FileText, CalendarClock, CalendarX, Calendar, Paperclip, Star, Users, Newspaper, Bell, Receipt, Download,
  FolderOpen, FolderPlus, Settings2, Globe, Plus, PlusCircle, ChevronDown, ChevronUp, ChevronRight, Folder,
  Reply, ReplyAll, Forward, Pencil, User, Building2, Zap, Flame, Video, UserPlus,
  Check, CheckCircle2, XCircle, TrendingUp, Handshake, ShieldCheck, AlertCircle, Tag, Lock, ExternalLink,
  CheckCheck, ArrowLeft, ArrowUp, ClipboardList, StickyNote, ArchiveX, Square, CheckSquare, Filter, Eye,
  Sparkles, Code2, Type, Rows3, Rows2, Inbox as InboxIcon,
  Maximize2, Minimize2, Pin, PinOff, LayoutList, List as ListIcon,
  Command as CommandIcon, AlignJustify, Hash, AtSign, Folders, Zap as ZapIcon,
  ShieldAlert, Upload, ImagePlus,
} from "lucide-react";
import {
  groupSmartInbox,
  useInboxViewMode,
  usePinnedThreads,
  type SmartHeaderItem,
  type SmartItem,
  type SmartSectionId,
} from "@/components/inbox/smart-inbox-grouper";
import { EmailActionsToolbar } from "@/components/inbox/email-actions-toolbar";
import { SmartAddContactDialog } from "@/components/contacts/smart-add-contact-dialog";
import { NewLeadFromEmailDialog } from "@/components/inbox/new-lead-from-email-dialog";
import { EmailFormatToolbar } from "@/components/inbox/email-format-toolbar";
import { RecipientList } from "@/components/inbox/recipient-list";
import { MailTrustStrip, type TrustEvent } from "@/components/inbox/mail-trust-strip";
import { CalendarInviteCard } from "@/components/inbox/calendar-invite-card";
import {
  useSetAside,
  useFormatBus,
  applyFormatToEditor,
  type FormatEvent,
} from "@/components/inbox/inbox-actions-store";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandSeparator,
} from "@/components/ui/command";
import { SnippetInsertButton, SnippetsManagerDialog } from "@/components/inbox-snippets";
import { useSnippets } from "@/hooks/use-snippets";
import { useLocation } from "wouter";
import { takePendingCompose } from "@/lib/compose-handoff";
import { PENDING_COMPOSE_KEY } from "@/components/crm/suggested-next-email-modal";
import { sanitizeEmailHtml, plainTextToEmailHtml, htmlToPlainText } from "@/lib/sanitize-html";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow } from "date-fns";

// ─── Avatar deterministic color palette ─────────────────────────────────────
// Tightened palette — removed the lightest pastels (lime, amber) to keep
// white initials at a comfortable contrast ratio across every variant.
const AVATAR_GRADIENTS = [
  "from-violet-600 to-fuchsia-600",
  "from-blue-600 to-cyan-600",
  "from-emerald-600 to-teal-600",
  "from-orange-600 to-rose-600",
  "from-rose-600 to-pink-600",
  "from-indigo-600 to-purple-600",
  "from-sky-600 to-blue-700",
  "from-teal-600 to-green-700",
];
function avatarColor(seed: string): string {
  if (!seed) return AVATAR_GRADIENTS[0];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  return AVATAR_GRADIENTS[Math.abs(h) % AVATAR_GRADIENTS.length];
}

// htmlToPlainText is imported from @/lib/sanitize-html — it uses DOMParser
// (inert document, no script execution, no <img onerror> firing) instead of
// the previous detached-div innerHTML approach.

type MessageSummary = {
  id: string;
  threadId: string;
  snippet: string;
  internalDate: string;
  labelIds: string[];
  from: string;
  // Separate sender fields populated by the local-mailbox layer.
  // These are preferred over reparsing the combined `from` string.
  fromName?: string;
  fromEmail?: string;
  to: string;
  subject: string;
  date: string;
  // Multi-mailbox Phase 1: present when fetched in unified ("All Inboxes") mode so the
  // row can render an account badge. Absent in single-account mode.
  sourceAccountId?: number;
  // Phase 6: server-derived category (email_messages.smart_category).
  // Values: "people" | "updates" | "promotions" | "social" | "forums".
  // When present, used in preference to the client-side label-ID heuristic
  // (getEmailCategory). Always absent until the list endpoint returns this field.
  smartCategory?: string | null;
};

type ThreadAttachment = {
  id?: number;              // email_attachments.id — present when source=local
  downloadable?: boolean;   // false for inline parts that have no Gmail attachmentId
  filename: string;
  mimeType: string;
  sizeBytes: number;
  isInline: boolean;
  contentId?: string | null;
};

type ThreadMessage = {
  id: string;
  /** Same as `id` — the Gmail message ID. Present when source=local so the
   *  MessageBody CID-image proxy can resolve inline signature images. */
  gmailMessageId?: string;
  threadId: string;
  snippet: string;
  internalDate: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  labelIds: string[];
  body: string;
  isHtml: boolean;
  attachments?: ThreadAttachment[];
};

type Thread = {
  id: string;
  historyId: string;
  messages: ThreadMessage[];
};

function formatDate(dateStr: string, internalDate?: string) {
  const d = dateStr ? new Date(dateStr) : internalDate ? new Date(Number(internalDate)) : null;
  if (!d || isNaN(d.getTime())) return "";
  const now = new Date();
  // Compare calendar days (midnight-to-midnight) so yesterday's emails are never
  // shown as a bare time even if they arrived less than 24 hours ago.
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((todayMidnight.getTime() - msgMidnight.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// Full timestamp shown on each opened email message header so the user can see
// the exact day-of-week + date + time of every message in a thread (e.g.
// "Thu, Apr 23, 2026 · 3:09 PM"). Year is omitted for messages from the
// current year to keep the line compact.
function formatMessageHeaderDate(dateStr: string, internalDate?: string) {
  const d = dateStr ? new Date(dateStr) : internalDate ? new Date(Number(internalDate)) : null;
  if (!d || isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const datePart = d.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const timePart = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${datePart} · ${timePart}`;
}

function parseSenderName(from: string) {
  if (!from?.trim()) return "";
  const match = from.match(/^"?([^"<]+)"?\s*<[^>]+>$/);
  if (match) return match[1].trim();
  const stripped = from.replace(/<[^>]+>/, "").trim();
  // When the from string is just angle-bracket-wrapped (no display name), fall back
  // to the extracted email address so we never render a blank sender label.
  return stripped || parseSenderEmail(from) || from;
}

function parseSenderEmail(from: string) {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from;
}

function parseSenderDomain(from: string): string {
  const email = parseSenderEmail(from);
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : "";
}

type EmailFilter = { id: number; domain: string; createdAt: string };
type InboxCategory = "all" | "people" | "updates" | "promotions" | "social" | "forums" | "priority";
type CrmInboxFilter = "all" | "unread" | "starred" | "follow-up" | "needs-reply" | "awaiting-reply" | "hot" | "unlinked";

type MailFolderDomain = { id: number; folderId: number; domain: string; matchType: string };
type MailFolder = {
  id: number; name: string; color: string; ownerUserId: number; sourceAccountId: number | null;
  domains: MailFolderDomain[]; emailCount: number; unreadCount: number;
};
type FolderEmail = {
  id: number; gmailMessageId: string; gmailThreadId: string; subject: string | null;
  fromEmail: string | null; fromName: string | null; sentAt: string | null; snippet: string | null;
  labelIds: string | null; direction: string | null;
};

type ThreadSignal = {
  awaitingReplySince: string | null;
  workflowState: string | null;
  replyStatus: string | null;
  signalLevel: string | null;
  isHot: boolean;
  isReplied: boolean;
  isRepliedByUser: boolean;
  isForwardedByUser: boolean;
  engScore: number;
  openCount: number;
  clickCount: number;
  firstOpenAt: string | null;
  lastOpenAt: string | null;
};

const INBOX_SIGNAL_CONFIG: Record<string, { label: string; color: string }> = {
  replied:           { label: "Replied",    color: "text-violet-400 bg-violet-500/10 border-violet-500/25" },
  forwarded_by_user: { label: "Forwarded",  color: "text-sky-400 bg-sky-500/10 border-sky-500/25" },
  replied_by_user:   { label: "Replied",    color: "text-violet-400 bg-violet-500/10 border-violet-500/25" },
  hot:               { label: "Hot",        color: "text-orange-400 bg-orange-500/10 border-orange-500/25" },
  high:              { label: "Clicked",    color: "text-blue-400 bg-blue-500/8 border-blue-500/20" },
  medium:            { label: "Opened ×2+", color: "text-emerald-400 bg-emerald-500/8 border-emerald-500/20" },
  low:               { label: "Opened",     color: "text-emerald-400/70 bg-emerald-500/5 border-emerald-500/15" },
};

const WORKFLOW_ROW_CONFIG: Record<string, { label: string; color: string }> = {
  needs_reply:     { label: "Needs Reply",     color: "text-amber-400 bg-amber-500/10 border-amber-500/25" },
  waiting_on_them: { label: "Waiting",         color: "text-blue-400 bg-blue-500/10 border-blue-500/25" },
  follow_up:       { label: "Follow Up",       color: "text-orange-400 bg-orange-500/10 border-orange-500/25" },
  done:            { label: "Done",            color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25" },
  quote_requested: { label: "Quote Requested", color: "text-violet-400 bg-violet-500/10 border-violet-500/25" },
};

function formatWaitTime(since: string | null): string {
  if (!since) return "";
  const ms = Date.now() - new Date(since).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 24) return h < 1 ? "just now" : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function InboxSignalBadge({ sig }: { sig: ThreadSignal }) {
  const badges: { key: string; cfg: { label: string; color: string } }[] = [];

  if (sig.isForwardedByUser) {
    badges.push({ key: "forwarded_by_user", cfg: INBOX_SIGNAL_CONFIG["forwarded_by_user"] });
  } else if (sig.isRepliedByUser) {
    badges.push({ key: "replied_by_user", cfg: INBOX_SIGNAL_CONFIG["replied_by_user"] });
  }

  const engKey = sig.isReplied ? "replied" : sig.isHot ? "hot" : (sig.signalLevel ?? "none");
  const engCfg = INBOX_SIGNAL_CONFIG[engKey];
  if (engCfg && !sig.isRepliedByUser && !sig.isForwardedByUser) {
    badges.push({ key: engKey, cfg: engCfg });
  } else if (engCfg && (engKey === "hot" || engKey === "high" || engKey === "medium" || engKey === "low")) {
    badges.push({ key: engKey, cfg: engCfg });
  }

  if (badges.length === 0) return null;
  return (
    <>
      {badges.map(({ key, cfg }) => (
        <span key={key} className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0 rounded border font-medium ${cfg.color}`}
          data-testid={`signal-badge-${key}`}>
          {cfg.label}
        </span>
      ))}
    </>
  );
}

function WorkflowStateBadge({ state }: { state: string | null }) {
  if (!state) return null;
  const cfg = WORKFLOW_ROW_CONFIG[state];
  if (!cfg) return null;
  return (
    <span className={`inline-flex items-center text-[10px] px-1.5 py-0 rounded border font-medium ${cfg.color}`}
      data-testid={`workflow-badge-${state}`}>
      {cfg.label}
    </span>
  );
}

function SentTrackingRow({ sig, threadId, signalsMt }: {
  sig: ThreadSignal | undefined;
  threadId: string;
  signalsMt: string;
}) {
  if (!sig) return null;
  const opens = sig.openCount ?? 0;
  const clicks = sig.clickCount ?? 0;
  const replied = sig.isReplied ?? false;
  const firstOpen = sig.firstOpenAt ?? null;
  const lastOpen = sig.lastOpenAt ?? null;
  return (
    <div className={`flex items-center gap-1 ${signalsMt} flex-wrap`} data-testid={`sent-tracking-${threadId}`}>
      {replied ? (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-violet-400 bg-violet-500/10 border border-violet-500/25 px-1.5 py-0 rounded font-medium"
          data-testid={`sent-badge-replied-${threadId}`}>
          Replied
        </span>
      ) : opens === 0 ? (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/45 bg-muted/20 border border-border/30 px-1.5 py-0 rounded font-medium"
          data-testid={`sent-badge-not-opened-${threadId}`}>
          Not opened
        </span>
      ) : (
        <span
          className="inline-flex items-center gap-0.5 text-[10px] text-emerald-400 bg-emerald-500/8 border border-emerald-500/20 px-1.5 py-0 rounded font-medium cursor-pointer hover:bg-emerald-500/15 transition-colors"
          data-testid={`sent-badge-opened-${threadId}`}
          title="Click to see detailed open events"
          onClick={() => window.dispatchEvent(new CustomEvent("expand-engagement", { detail: { threadId } }))}
        >
          {opens === 1 ? "Opened" : `Opened ${opens}×`}
        </span>
      )}
      {clicks > 0 && (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-blue-400 bg-blue-500/8 border border-blue-500/20 px-1.5 py-0 rounded font-medium"
          data-testid={`sent-badge-clicked-${threadId}`}>
          {clicks === 1 ? "Link clicked" : `${clicks} clicks`}
        </span>
      )}
      {firstOpen && (
        <span className="text-[10px] text-muted-foreground/40 tabular-nums"
          title={`First opened: ${new Date(firstOpen).toLocaleString()}`}
          data-testid={`sent-first-open-${threadId}`}>
          · first {formatWaitTime(firstOpen)} ago
        </span>
      )}
      {lastOpen && lastOpen !== firstOpen && (
        <span className="text-[10px] text-muted-foreground/40 tabular-nums"
          title={`Last opened: ${new Date(lastOpen).toLocaleString()}`}
          data-testid={`sent-last-open-${threadId}`}>
          · last {formatWaitTime(lastOpen)} ago
        </span>
      )}
    </div>
  );
}

function AccountSourceBadge({ accounts, sourceAccountId, messageId }: {
  accounts: { id: number; displayName: string | null; emailAddress: string; isShared: boolean }[] | undefined;
  sourceAccountId: number;
  messageId: number;
}) {
  const acct = accounts?.find((a) => a.id === sourceAccountId);
  if (!acct) return null;
  const letter = (acct.displayName || acct.emailAddress)[0].toUpperCase();
  const colour = acct.isShared
    ? "bg-teal-500/20 text-teal-300 border-teal-500/30"
    : "bg-primary/20 text-primary border-primary/30";
  return (
    <span
      title={acct.emailAddress}
      data-testid={`badge-account-${sourceAccountId}-${messageId}`}
      className={`flex-shrink-0 h-4 px-1.5 rounded border text-[9px] font-bold leading-4 tabular-nums ${colour}`}
    >
      {letter}
    </span>
  );
}

const CATEGORY_BADGE_CONFIG: Record<string, { label: string; className: string }> = {
  CATEGORY_UPDATES:    { label: "Updates",    className: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
  CATEGORY_PROMOTIONS: { label: "Promotions", className: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  CATEGORY_SOCIAL:     { label: "Social",     className: "bg-violet-500/15 text-violet-300 border-violet-500/30" },
  CATEGORY_FORUMS:     { label: "Forums",     className: "bg-orange-500/15 text-orange-300 border-orange-500/30" },
};

function getCategoryLabel(labelIds: string[]): string | null {
  for (const key of Object.keys(CATEGORY_BADGE_CONFIG)) {
    if (labelIds.includes(key)) return key;
  }
  return null;
}

function CategoryBadge({
  labelIds,
  messageId,
  onFilter,
  filterLabel,
}: {
  labelIds: string[];
  messageId: number;
  onFilter?: (category: string) => void;
  filterLabel?: string;
}) {
  const key = getCategoryLabel(labelIds);
  if (!key) return null;
  const cfg = CATEGORY_BADGE_CONFIG[key];
  const tooltipSuffix = onFilter ? ` — ${filterLabel ?? "click to filter"}` : "";
  return (
    <span
      data-testid={`badge-category-${key.toLowerCase()}-${messageId}`}
      title={`Category: ${cfg.label}${tooltipSuffix}`}
      className={`flex-shrink-0 h-4 px-1.5 rounded border text-[9px] font-bold leading-4 tabular-nums ${cfg.className}${onFilter ? " cursor-pointer hover:opacity-80 transition-opacity" : ""}`}
      onClick={onFilter ? (e) => { e.stopPropagation(); onFilter(key); } : undefined}
    >
      {cfg.label}
    </span>
  );
}

function isUnread(labelIds: string[]) {
  return labelIds.includes("UNREAD");
}

function isStarred(labelIds: string[]) {
  return labelIds.includes("STARRED");
}

function getEmailCategory(labelIds: string[]): "people" | "updates" | "promotions" | "social" | "forums" {
  if (labelIds.includes("CATEGORY_UPDATES"))    return "updates";
  if (labelIds.includes("CATEGORY_PROMOTIONS")) return "promotions";
  if (labelIds.includes("CATEGORY_SOCIAL"))     return "social";
  if (labelIds.includes("CATEGORY_FORUMS"))     return "forums";
  return "people";
}



function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildReplyQuoteBlockHtml(from: string, date: string, bodyHtml: string): string {
  const meta = [date && `On ${escHtml(date)}`, from && escHtml(from)].filter(Boolean).join(", ");
  const header = meta ? `<p style="margin:0 0 8px 0;font-size:12px;color:#555;">${meta}${from ? " wrote:" : ""}</p>` : "";
  return `<div style="margin-top:16px;padding-top:12px;border-top:1px solid #e0e0e0;">${header}<blockquote style="margin:0;padding-left:16px;border-left:3px solid #ccc;color:#555;">${bodyHtml}</blockquote></div>`;
}

function buildForwardedBlockHtml(from: string, date: string, subject: string, to: string, bodyHtml: string): string {
  return `<div style="margin-top:24px;padding-top:16px;border-top:2px solid #e0e0e0;font-family:Arial,sans-serif;font-size:13px;color:#555;">
<p style="margin:0 0 8px 0;font-weight:bold;color:#333;">---------- Forwarded message ----------</p>
<p style="margin:0 0 2px 0;"><b>From:</b> ${escHtml(from)}</p>
<p style="margin:0 0 2px 0;"><b>Date:</b> ${escHtml(date)}</p>
<p style="margin:0 0 2px 0;"><b>Subject:</b> ${escHtml(subject)}</p>
<p style="margin:0 0 12px 0;"><b>To:</b> ${escHtml(to)}</p>
<div>${bodyHtml}</div>
</div>`;
}

function ComposeDialog({
  open,
  onClose,
  canSend,
  defaultTo = "",
  defaultCc = "",
  defaultBcc = "",
  defaultSubject = "",
  defaultBody = "",
  threadId,
  draftId,
  asAccountId,
  replyToSender,
  defaultQuotedHtml = "",
  defaultQuotedFrom = "",
  defaultQuotedDate = "",
  isForward = false,
  forwardSubject = "",
  forwardTo = "",
  onTrustEvent,
}: {
  open: boolean;
  onClose: () => void;
  canSend: boolean;
  defaultTo?: string;
  defaultCc?: string;
  defaultBcc?: string;
  defaultSubject?: string;
  defaultBody?: string;
  threadId?: string;
  draftId?: string;
  asAccountId?: number;
  replyToSender?: string;
  defaultQuotedHtml?: string;
  defaultQuotedFrom?: string;
  defaultQuotedDate?: string;
  isForward?: boolean;
  forwardSubject?: string;
  forwardTo?: string;
  onTrustEvent?: (event: TrustEvent) => void;
}) {
  const { toast } = useToast();
  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState(defaultCc);
  const [bcc, setBcc] = useState(defaultBcc);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);

  // ── Dynamic Signatures ───────────────────────────────────────────────────────
  type SigCta = { id: number; name: string; type: string; destination_url: string; image_url: string | null; alt_text: string | null; width_px: number | null; tracking_enabled: boolean };
  type EmailSig = {
    id: number; name: string; htmlContent: string; isDefault: boolean; ctas: SigCta[];
    // CTA asset columns (new format — stored separately, injected at render/send time)
    ctaImageUrl: string | null; ctaDestUrl: string | null; ctaAltText: string | null; ctaWidthPx: number | null;
  };
  const { data: signaturesData = [] } = useQuery<EmailSig[]>({ queryKey: ["/api/signatures"] });
  // undefined = auto-pick default; null = user chose "No signature"; number = specific sig id
  const [selectedSigId, setSelectedSigId] = useState<number | null | undefined>(undefined);
  const defaultSig = signaturesData.find(s => s.isDefault) ?? signaturesData[0];
  const effectiveSigId = selectedSigId === undefined ? (defaultSig?.id ?? null) : selectedSigId;
  const activeSig = effectiveSigId === null ? null : signaturesData.find(s => s.id === effectiveSigId);
  const activeSignatureHtml = (() => {
    if (!activeSig) return "";
    // Normalize at assembly time: strip any full-document wrapper tags
    // (<!DOCTYPE>, <html>, <head>, <body>) that may be stored in the DB.
    // This prevents the Replit WAF from rejecting POST /api/gmail/send with 403.
    const normalizedSigHtml = normalizeSignatureHtmlClientSide(activeSig.htmlContent || "");

    // Log all img srcs so broken URLs are visible in the browser console.
    const _allSigImgs = [
      ...(normalizedSigHtml.match(/src="([^"]+)"/g) || []),
      ...(activeSig.ctaImageUrl ? [`src="${activeSig.ctaImageUrl}"`] : []),
      ...((activeSig.ctas || []).filter((c: any) => c.image_url).map((c: any) => `src="${c.image_url}"`)),
    ].map((s: string) => s.replace(/^src="|"$/g, ""));
    console.log(
      `[sig-composer] id=${activeSig.id} name="${activeSig.name}" ` +
      `htmlLen=${normalizedSigHtml.length} ` +
      `ctaImageUrl=${activeSig.ctaImageUrl ?? "null"} ` +
      `legacyCtas=${activeSig.ctas?.length ?? 0} ` +
      `imgSrcs=[${_allSigImgs.join(", ")}]`
    );

    // ── New format: CTA stored as separate columns ──────────────────────────
    // Prefer ctaImageUrl/ctaDestUrl (written by new SignatureDialog) over the
    // legacy email_signature_ctas table, so both Builder and custom-HTML sigs
    // get their CTA injected identically.
    if (activeSig.ctaImageUrl && activeSig.ctaDestUrl) {
      const alt = (activeSig.ctaAltText || "Watch a Demo").replace(/"/g, "&quot;");
      const dest = activeSig.ctaDestUrl.replace(/"/g, "&quot;");
      const src  = activeSig.ctaImageUrl.replace(/"/g, "&quot;");
      const ctaHtml = `<a href="${dest}" target="_blank" rel="noopener noreferrer" style="display:block;text-decoration:none;border:0;"><img src="${src}" alt="${alt}" width="200" border="0" style="display:block;width:200px;max-width:200px;min-width:200px;height:auto;border:0;outline:none;text-decoration:none;border-radius:4px;-ms-interpolation-mode:bicubic;"></a>`;
      const wrapped = `<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="620" style="width:620px;max-width:620px;border-collapse:collapse;table-layout:fixed;"><tr><td width="396" valign="top" style="width:396px;max-width:396px;vertical-align:top;">${normalizedSigHtml}</td><td width="224" valign="middle" align="right" style="width:224px;min-width:224px;vertical-align:middle;padding-left:24px;text-align:right;">${ctaHtml}</td></tr></table>`;
      console.log(`[sig-composer] using ctaImageUrl column → finalLen=${wrapped.length}`);
      return wrapped;
    }

    // ── Legacy format: CTA from email_signature_ctas table ──────────────────
    const ctaBlock = (activeSig.ctas || []).map(cta => {
      const alt  = (cta.alt_text || cta.name).replace(/"/g, "&quot;");
      const dest = cta.destination_url.replace(/"/g, "&quot;");
      if (cta.image_url) {
        const img = cta.image_url.replace(/"/g, "&quot;");
        return `<a href="${dest}" target="_blank" rel="noopener noreferrer" style="display:block;text-decoration:none;border:0;"><img src="${img}" alt="${alt}" width="200" border="0" style="display:block;width:200px;max-width:200px;min-width:200px;height:auto;border:0;outline:none;text-decoration:none;border-radius:4px;-ms-interpolation-mode:bicubic;"></a>`;
      }
      return `<a href="${dest}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 22px;background:#00C1DE;color:#fff;text-decoration:none;border-radius:4px;font-family:Arial,sans-serif;font-size:14px;">${alt}</a>`;
    }).join("");
    // Side-by-side table layout — CTA to the RIGHT of signature text (matches backend send route)
    const result = ctaBlock
      ? `<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="620" style="width:620px;max-width:620px;border-collapse:collapse;table-layout:fixed;"><tr><td width="396" valign="top" style="width:396px;max-width:396px;vertical-align:top;">${normalizedSigHtml}</td><td width="224" valign="middle" align="right" style="width:224px;min-width:224px;vertical-align:middle;padding-left:24px;text-align:right;">${ctaBlock}</td></tr></table>`
      : normalizedSigHtml;
    console.log(`[sig-composer] using legacy ctas → finalLen=${result.length}`);
    return result;
  })();

  // Sync fields whenever the modal opens with new defaults (e.g. switching between reply targets).
  // C1 fix: also reset the idempotency key so each open of the compose window gets a fresh UUID.
  // This is critical for the "new compose" case where key="compose" is stable and React never
  // remounts ComposeDialog — without this reset, consecutive compose sessions share the same UUID
  // and the second send within 5 minutes would return the cached result of the first send.
  useEffect(() => {
    if (open) {
      setTo(defaultTo);
      setCc(defaultCc);
      setBcc(defaultBcc);
      setSubject(defaultSubject);
      setBody(defaultBody);
      setSelectedSigId(undefined); // reset to auto-pick default on each compose open
      idempotencyKeyRef.current = crypto.randomUUID();
      // Seed the rich-text editor imperatively so the cursor isn't reset on
      // every React re-render. requestAnimationFrame gives the portal a frame
      // to finish mounting before we touch innerHTML.
      // stripEmailWrapper extracts only the user-typed content from a saved
      // draft body (which has the VoltSafe wrapper + signature baked in)
      // so the editor doesn't show the wrapper div or signature as editable text.
      requestAnimationFrame(() => {
        if (bodyRef.current) {
          bodyRef.current.innerHTML = stripEmailWrapper(defaultBody ?? "");
        }
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultTo, defaultCc, defaultBcc, defaultSubject]);
  const [showScheduler, setShowScheduler] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [subjectError, setSubjectError] = useState(false);
  const subjectRef = useRef<HTMLInputElement | null>(null);
  const [activeDraftId, setActiveDraftId] = useState(draftId);

  // ── Zoom meeting panel ──────────────────────────────────────────────────
  const [showZoomPanel, setShowZoomPanel] = useState(false);
  // Default start time = now + 1 hour, rounded to nearest 30 min
  function defaultZoomStart() {
    const d = new Date(Date.now() + 60 * 60_000);
    d.setMinutes(d.getMinutes() < 30 ? 30 : 0, 0, 0);
    if (d.getMinutes() === 0) d.setHours(d.getHours() + (new Date().getMinutes() >= 30 ? 1 : 0));
    return d.toISOString().slice(0, 16);
  }
  const [zoomStartTime, setZoomStartTime] = useState(defaultZoomStart);
  const [zoomDuration, setZoomDuration] = useState("30");
  const [pendingIcal, setPendingIcal] = useState<string | null>(null);

  // ── Calendar booking link ────────────────────────────────────────────────
  const authMeQuery = useQuery<{ calendarBookingUrl?: string | null }>({ queryKey: ["/api/auth/me"] });
  const savedCalUrl = authMeQuery.data?.calendarBookingUrl ?? null;
  const [showCalendarPopover, setShowCalendarPopover] = useState(false);
  const [showCalendarEdit, setShowCalendarEdit] = useState(false);
  const [calendarUrlInput, setCalendarUrlInput] = useState("");

  useEffect(() => {
    if (showCalendarPopover) {
      setCalendarUrlInput(savedCalUrl ?? "");
      setShowCalendarEdit(!savedCalUrl);
    }
  }, [showCalendarPopover, savedCalUrl]);

  const saveCalendarUrlMutation = useMutation({
    mutationFn: async (url: string | null) => {
      const res = await apiRequest("PATCH", "/api/users/me/calendar-url", { calendarBookingUrl: url });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).message || "Failed to save"); }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] }),
  });

  type CtaPickerItem = {
    id: number;
    name: string;
    type: string;
    destination_url: string;
    image_url: string | null;
    alt_text: string | null;
    width_px: number | null;
    tracking_enabled: boolean;
  };

  const [showCtaPicker, setShowCtaPicker] = useState(false);

  const ctaPickerQuery = useQuery<CtaPickerItem[]>({
    queryKey: ["/api/signature-ctas", "picker"],
    queryFn: () =>
      fetch("/api/signature-ctas?forPicker=true", { credentials: "include" }).then(r => r.json()),
    enabled: showCtaPicker,
  });

  function insertCtaIntoBody(cta: CtaPickerItem) {
    const altText = (cta.alt_text || cta.name).replace(/"/g, "&quot;");
    const destUrl = cta.destination_url.replace(/"/g, "&quot;");

    let ctaHtml: string;
    if (cta.image_url) {
      const imgUrl = cta.image_url.replace(/"/g, "&quot;");
      // For body insertion always use 600px; swap _200 variant for _600 if available
      const bodyImgUrl = imgUrl.replace(/(_200)(\.[a-zA-Z]+)(?=[?#]|$)/, "_600$2");
      ctaHtml = `<a href="${destUrl}" target="_blank" rel="noopener noreferrer" data-vs-cta-id="${cta.id}" style="display:inline-block;"><img src="${bodyImgUrl}" alt="${altText}" width="600" style="display:block;border:0;outline:none;text-decoration:none;max-width:600px;width:100%;height:auto;"></a>`;
    } else {
      ctaHtml = `<a href="${destUrl}" target="_blank" rel="noopener noreferrer" data-vs-cta-id="${cta.id}" style="display:inline-block;padding:10px 22px;background:#00C1DE;color:#fff;text-decoration:none;border-radius:4px;font-family:Arial,sans-serif;font-size:14px;">${altText}</a>`;
    }

    if (!bodyRef.current) {
      setBody(prev => (prev || "") + "<br>" + ctaHtml);
      setShowCtaPicker(false);
      return;
    }

    const currentHtml = bodyRef.current.innerHTML;

    // Determine the earliest insertion point before the sign-off / signature section.
    // Priority (whichever comes first in the document):
    //   1. <!--vs-sig-start--> comment marker
    //   2. A sign-off paragraph: full phrases OR a lone first-name line (≤20 chars, no punctuation)
    const SIG_MARKER_RE = /<!--vs-sig-start-->/i;
    // Multi-word sign-offs ("Kind regards", "Best wishes", …)
    const SIGNOFF_PHRASE_RE = /<p[^>]*>\s*(?:[^<]{1,40})(?:regards|cheers|sincerely|thanks|best|warm|kind|yours)[^<]{0,40}\s*<\/p>/i;
    // Lone first-name sign-off: a <p> or <div> containing only 1–4 words of ≤20 total chars
    const SIGNOFF_NAME_RE = /<(?:p|div)[^>]*>\s*([A-Z][a-zA-Z'-]{0,19}(?:\s[A-Z][a-zA-Z'-]{0,19}){0,2})\s*<\/(?:p|div)>/;

    const candidates: number[] = [];

    const mMarker = SIG_MARKER_RE.exec(currentHtml);
    if (mMarker) candidates.push(mMarker.index);

    const mPhrase = SIGNOFF_PHRASE_RE.exec(currentHtml);
    if (mPhrase) candidates.push(mPhrase.index);

    const mName = SIGNOFF_NAME_RE.exec(currentHtml);
    // Only treat a first-name block as a sign-off if it is in the last 30% of the HTML
    if (mName && mName.index > currentHtml.length * 0.7) candidates.push(mName.index);

    const insertAt = candidates.length > 0 ? Math.min(...candidates) : -1;

    if (insertAt >= 0) {
      bodyRef.current.innerHTML =
        currentHtml.slice(0, insertAt) + ctaHtml + "<br>" + currentHtml.slice(insertAt);
    } else {
      bodyRef.current.innerHTML = currentHtml + "<br>" + ctaHtml;
    }

    setBody(bodyRef.current.innerHTML);
    setShowCtaPicker(false);
  }

  function insertCalendarLinkIntoBody(url: string) {
    const safe = url.replace(/"/g, "&quot;").replace(/&(?!amp;)/g, "&amp;");
    const html = `<p style="margin:12px 0 4px 0;">&#x1F4C5;&nbsp;<a href="${safe}" target="_blank" rel="noopener noreferrer" style="color:#00C1DE;">Schedule a meeting with me</a></p>`;
    if (bodyRef.current) {
      bodyRef.current.focus();
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(bodyRef.current);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      document.execCommand("insertHTML", false, html);
      setBody(bodyRef.current.innerHTML);
    } else {
      setBody((prev) => (prev || "") + html);
    }
  }
  const zoomMutation = useMutation({
    mutationFn: () => {
      const attendeeEmails = to
        ? to.split(",").map((e) => e.trim().replace(/^.*<|>.*$/g, "")).filter(Boolean)
        : [];
      return apiRequest("POST", "/api/zoom/meetings", {
        topic: subject || "Meeting",
        startTime: new Date(zoomStartTime).toISOString(),
        durationMinutes: Number(zoomDuration),
        attendeeEmails,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    },
    onSuccess: async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Could not create Zoom meeting", description: (err as any).message, variant: "destructive" });
        return;
      }
      const data = await res.json() as { joinUrl: string; meetingId?: string; icalContent?: string };
      const startDate = new Date(zoomStartTime);
      const dateStr = startDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      const timeStr = startDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      // Build as HTML so the join link is a real clickable anchor and line
      // breaks render correctly in the rich-text editor.
      const safeDateStr = dateStr.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      const safeTimeStr = timeStr.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      const safeJoinUrl = data.joinUrl.replace(/"/g, "&quot;").replace(/&/g, "&amp;");
      const insertHtml = `<br><br>You're invited to a Zoom meeting.<br>\u{1F4C5} ${safeDateStr} at ${safeTimeStr} (${zoomDuration} min)<br>\u{1F517} <a href="${safeJoinUrl}" target="_blank" rel="noopener noreferrer" style="color:#00C1DE;">Join Zoom Meeting</a>`;
      if (bodyRef.current) {
        // Move cursor to end of editor content so the insert appears at the bottom.
        bodyRef.current.focus();
        const sel = window.getSelection();
        if (sel) {
          const range = document.createRange();
          range.selectNodeContents(bodyRef.current);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        document.execCommand("insertHTML", false, insertHtml);
        setBody(bodyRef.current.innerHTML);
      } else {
        setBody((prev) => (prev || "") + insertHtml);
      }
      if (data.icalContent) setPendingIcal(data.icalContent);
      setShowZoomPanel(false);
      toast({
        title: "Zoom meeting created",
        description: data.icalContent ? "Join link added. Calendar invite will be sent with the email." : "Join link added to your email.",
      });
    },
    onError: () => toast({ title: "Network error — please try again", variant: "destructive" }),
  });
  const [attachedAssets, setAttachedAssets] = useState<{ id: number; name: string }[]>([]);
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [assetTab, setAssetTab] = useState<string>("recommended");
  const [assetSearch, setAssetSearch] = useState<string>("");
  const [restrictedWarning, setRestrictedWarning] = useState<{ asset: { id: number; name: string; visibility: string }; onConfirm: () => void } | null>(null);
  const [showQuotePicker, setShowQuotePicker] = useState(false);

  // Drag-and-drop attachment state
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([]);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadFiles = async (files: FileList | File[]) => {
    const fileArr = Array.from(files);
    for (const file of fileArr) {
      setUploadingFiles(prev => [...prev, file.name]);
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/gmail/upload-attachment", {
          method: "POST",
          body: form,
          credentials: "include",
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: "Upload failed" }));
          throw new Error(err.message || "Upload failed");
        }
        const asset = await res.json();
        setAttachedAssets(prev => [...prev, { id: asset.id, name: asset.name }]);
      } catch (e: any) {
        toast({ title: `Failed to attach ${file.name}`, description: e.message, variant: "destructive" });
      } finally {
        setUploadingFiles(prev => prev.filter(n => n !== file.name));
      }
    }
  };

  // Ref to the rich-text contenteditable editor div.
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Saved Selection range for the link flow: captured before the link-URL
  // popover opens (which would steal focus and clear the selection).
  const savedRangeRef = useRef<Range | null>(null);

  // Pending-format queue: when a format event arrives before the
  // composer is open or before the editor has mounted, we stash it
  // here and replay once both conditions are satisfied. This fixes
  // the race where the user clicks a format button in the reader
  // toolbar, the parent calls onBeforeFormat() to open the composer,
  // and the bus event then fires synchronously before the editor div
  // has a chance to mount and bind its ref.
  const pendingFormatRef = useRef<FormatEvent | null>(null);

  const applyFormat = useCallback((e: FormatEvent) => {
    const div = bodyRef.current;
    if (!div) return false;
    // For the link command, pass the saved range so the correct text is
    // wrapped even though the popover stole focus.
    const range = e.cmd === "link" ? savedRangeRef.current : null;
    applyFormatToEditor(div, e.cmd, e.value, range);
    if (e.cmd === "link") savedRangeRef.current = null;
    // Sync React state from innerHTML after execCommand settles.
    requestAnimationFrame(() => {
      if (bodyRef.current) setBody(bodyRef.current.innerHTML);
    });
    return true;
  }, []);

  // Subscribe to the format-event bus while the composer is open. The
  // bus is fired by EmailFormatToolbar in the reader pane.
  const onFormatEvent = useCallback(
    (e: FormatEvent) => {
      if (!open || !bodyRef.current) {
        // Composer not ready yet — queue the event so the effect below
        // can replay it once everything has mounted.
        pendingFormatRef.current = e;
        return;
      }
      applyFormat(e);
    },
    [open, applyFormat],
  );
  useFormatBus(onFormatEvent);

  // ── Link preview ──────────────────────────────────────────────────────────
  // Matches a bare pasted URL (the full clipboard text is a single http/https
  // URL with no surrounding prose). We only trigger previews for bare pastes
  // so that pasting rich text that happens to contain a URL inside a sentence
  // doesn't accidentally generate a card.
  const LINK_PREVIEW_URL_RE = /^https?:\/\/\S{4,}$/i;

  // Fetch Open Graph metadata for `url`, insert a loading placeholder in the
  // editor, and replace it with the rendered preview card once the fetch
  // resolves. Silently removes the placeholder on error so the normal pasted
  // URL text remains untouched.
  const triggerLinkPreview = useCallback(async (url: string) => {
    if (!bodyRef.current) return;

    // Deduplicate: don't show two cards for the same URL in the same session.
    if (bodyRef.current.querySelector(`[data-link-preview]`)) {
      const existing = Array.from(bodyRef.current.querySelectorAll("[data-link-preview]"));
      if (existing.some((el) => el.getAttribute("data-link-preview") === url)) return;
    }
    // Also skip if a loading placeholder is already pending (concurrent paste guard).
    if (bodyRef.current.querySelector("[data-link-preview-loading]")) return;

    // Move cursor to end and insert the loading placeholder.
    bodyRef.current.focus();
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(bodyRef.current);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    document.execCommand("insertHTML", false, buildLinkPreviewLoadingHtml(url));
    setBody(bodyRef.current.innerHTML);

    try {
      const res = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`, {
        credentials: "include",
      });
      // Find and replace the loading placeholder (user may have deleted it).
      const placeholder = bodyRef.current?.querySelector("table[data-link-preview-loading]");
      if (!placeholder) return;

      if (res.ok) {
        const meta = await res.json();
        if (meta?.title) {
          placeholder.outerHTML = buildLinkPreviewCardHtml(meta);
        } else {
          placeholder.remove();
        }
      } else {
        placeholder.remove();
      }
    } catch {
      bodyRef.current?.querySelector("table[data-link-preview-loading]")?.remove();
    }
    if (bodyRef.current) setBody(bodyRef.current.innerHTML);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Paste handler ────────────────────────────────────────────────────────
  // Intercept rich-text paste events inside the editor. When the clipboard
  // contains HTML (e.g. from Word, Google Docs, Gmail, ChatGPT), strip all
  // external fonts/colors/spacing while keeping semantic structure (bold,
  // italic, links, lists). This ensures pasted content matches the VoltSafe
  // style and never leaks mixed fonts into outbound emails.
  //
  // If the pasted content is a bare http/https URL (no surrounding prose),
  // we additionally trigger a link-preview card fetch so the user gets a
  // rich clickable card below the pasted URL — similar to Slack / iMessage.
  const handleBodyPaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      const html = e.clipboardData.getData("text/html");
      const plainText = e.clipboardData.getData("text/plain").trim();

      if (!html.trim()) {
        // No HTML — let the browser paste plain text normally. If it looks
        // like a bare URL, trigger a link preview after the browser inserts it.
        if (LINK_PREVIEW_URL_RE.test(plainText)) {
          requestAnimationFrame(() => {
            if (bodyRef.current) {
              setBody(bodyRef.current.innerHTML);
              triggerLinkPreview(plainText);
            }
          });
        }
        return;
      }

      e.preventDefault();
      const clean = htmlToCleanHtml(html);
      if (clean) {
        document.execCommand("insertHTML", false, clean);
      } else {
        // Fallback: insert as plain text
        if (plainText) document.execCommand("insertText", false, plainText);
      }
      // Sync React state after the insert settles
      requestAnimationFrame(() => {
        if (bodyRef.current) setBody(bodyRef.current.innerHTML);
      });
      // Trigger link preview when the clipboard plain text is a bare URL
      // (even when the clipboard also carries HTML wrapping for the URL).
      if (LINK_PREVIEW_URL_RE.test(plainText)) {
        setTimeout(() => triggerLinkPreview(plainText), 80);
      }
    },
    [triggerLinkPreview],
  );

  // Drain any pending format event once the composer is open AND the
  // editor has mounted. We tick a small timeout to give Radix's
  // dialog mount + animation a frame to finish before we touch the
  // selection. The retry is bounded by the dialog's open state — if
  // the user closes the dialog before mount, the queued event is
  // discarded on the next close.
  useEffect(() => {
    if (!open) {
      pendingFormatRef.current = null;
      return;
    }
    if (!pendingFormatRef.current) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled || !open) return;
      if (!bodyRef.current) {
        // Try again next frame.
        requestAnimationFrame(tick);
        return;
      }
      const ev = pendingFormatRef.current;
      pendingFormatRef.current = null;
      if (ev) applyFormat(ev);
    };
    requestAnimationFrame(tick);
    return () => {
      cancelled = true;
    };
  }, [open, applyFormat]);

  const assetsQuery = useQuery<{ id: number; name: string; mimeType: string; size: number; category: string; useCase?: string; visibility?: string; isFavorite?: boolean; usageCount?: number; description?: string }[]>({
    queryKey: ["/api/assets", assetTab, assetSearch],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("tab", assetTab);
      if (assetSearch.trim()) params.set("search", assetSearch);
      const res = await fetch(`/api/assets?${params}`, { credentials: "include" });
      return res.json();
    },
    enabled: showAssetPicker,
  });

  type QuoteSummary = { id: number; quoteNumber: string; customerName: string | null; total: number | null; currency: string; status: string; xlsxAssetId: number | null; htmlAssetId: number | null };
  const quotesQuery = useQuery<{ data: QuoteSummary[] }>({
    queryKey: ["/api/quotes", "picker"],
    queryFn: async () => {
      const res = await fetch("/api/quotes?limit=100&sortBy=createdAt&sortOrder=desc", { credentials: "include" });
      return res.json();
    },
    enabled: showQuotePicker,
  });

  // C1: Per-session idempotency key — stable for the lifetime of this compose window.
  // A new key is generated each time ComposeDialog mounts (new compose session).
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  const sendMutation = useMutation({
    mutationFn: async () => {
      onTrustEvent?.({ type: "sending", at: Date.now() });

      // ── Step 1: Build quoted reply/forward block ──────────────────────────────
      // Signature HTML is NOT included in the body — only selectedSignatureId is
      // sent. The backend loads, normalizes, and appends the signature server-side,
      // keeping full HTML signature content out of the browser POST body (WAF-safe).
      const _frtOn = (import.meta.env.DEV as boolean) ||
        (typeof localStorage !== "undefined" && localStorage.getItem("FORWARD_REPLY_TRACE") === "true");
      if (_frtOn) {
        console.log("[FRT:E:send:step1-input]", {
          isForward, hasThread: !!threadId,
          defaultQuotedHtmlLen: defaultQuotedHtml?.length ?? 0,
          defaultQuotedHtmlFirst200: defaultQuotedHtml?.slice(0, 200) ?? "",
          defaultQuotedHtmlLast200:  defaultQuotedHtml?.slice(-200) ?? "",
          atOld4KCap:  !!(defaultQuotedHtml && defaultQuotedHtml.length >= 3900 && defaultQuotedHtml.length <= 4100),
          atOld200KCap: !!(defaultQuotedHtml && defaultQuotedHtml.length >= 199000 && defaultQuotedHtml.length <= 201000),
          defaultQuotedFrom, defaultQuotedDate,
        });
      }
      const quotedBlock = isForward && defaultQuotedHtml
        ? buildForwardedBlockHtml(defaultQuotedFrom, defaultQuotedDate, forwardSubject, forwardTo, defaultQuotedHtml)
        : (!isForward && threadId && defaultQuotedHtml
          ? buildReplyQuoteBlockHtml(defaultQuotedFrom, defaultQuotedDate, defaultQuotedHtml)
          : "");
      if (_frtOn) {
        console.log("[FRT:E:send:step1-quotedBlock]", {
          quotedBlockLen: quotedBlock.length,
          quotedBlockFirst200: quotedBlock.slice(0, 200),
          quotedBlockLast200:  quotedBlock.slice(-200),
          hasGmailQuote: quotedBlock.includes("gmail_quote") || quotedBlock.includes("blockquote"),
        });
      }

      // ── Step 2: Assemble body — user content + quoted block only ─────────────
      // IMPORTANT: quotedBlock must NOT be passed as appendHtml to buildEmailHtml.
      // buildEmailHtml wraps appendHtml in <!--vs-sig-start-->...<!--vs-sig-end-->
      // markers.  The server strips those markers to insert the real signature, which
      // would silently discard the entire forward/reply history.  Append the quoted
      // block directly after the wrapped body div instead.
      let htmlBody = buildEmailHtml(body);
      if (quotedBlock) htmlBody = htmlBody + quotedBlock;

      // ── Step 3: Emergency strip on the user-composed content ─────────────────
      const { result: strippedBody, stripped: wasEmergencyStripped } =
        emergencyStripDangerousHtml(htmlBody);
      if (wasEmergencyStripped) {
        console.warn("[send] EMERGENCY STRIP applied — dangerous content removed from body");
        htmlBody = strippedBody;
      }

      // ── Step 4: Build final payload — signature referenced by id, not HTML ───
      const finalPayload = {
        to, subject, body: htmlBody, threadId,
        selectedSignatureId: effectiveSigId ?? null,
        ...(cc  ? { cc }  : {}),
        ...(bcc ? { bcc } : {}),
        attachmentIds: attachedAssets.map((a) => a.id),
        ...(asAccountId   ? { asAccountId }           : {}),
        ...(pendingIcal   ? { icalContent: pendingIcal } : {}),
        ...(isForward     ? { isForward: true }        : {}),
        idempotencyKey: idempotencyKeyRef.current,
      };

      // ── Step 5: Serialize + diagnostic log ────────────────────────────────────
      const finalStr = JSON.stringify(finalPayload);
      const maskedTo = (typeof finalPayload.to === "string" ? finalPayload.to : String(finalPayload.to ?? "")).replace(/[^@\s,]+@[^@\s,]+/g, (m) => m[0] + "***@" + m.split("@")[1]);
      console.log("[FINAL SEND PAYLOAD]", {
        bodyLength:             htmlBody.length,
        jsonSizeBytes:          finalStr.length,
        selectedSignatureId:    finalPayload.selectedSignatureId,
        // These must all be false — any true means sig HTML leaked into body
        bodyContainsSignature:  htmlBody.includes("<!--vs-sig-start-->"),
        bodyContainsTable:      htmlBody.includes("<table"),
        bodyContainsImg:        /<img\b/i.test(htmlBody),
        bodyContainsDoctype:    /<!DOCTYPE\b/i.test(htmlBody),
        bodyContainsHtmlTag:    /<html\b/i.test(htmlBody),
        bodyContainsHeadTag:    /<head\b/i.test(htmlBody),
        bodyContainsBodyTag:    /<body\b/i.test(htmlBody),
        containsDataImage:      htmlBody.includes("data:image"),
        containsBase64:         htmlBody.includes("base64"),
        wasEmergencyStripped,
        maskedTo,
        payloadKeys:            Object.keys(finalPayload),
      });
      if (_frtOn) {
        console.log("[FRT:E:send:payload-final]", {
          htmlBodyLen: htmlBody.length,
          htmlBodyFirst200: htmlBody.slice(0, 200),
          htmlBodyLast200:  htmlBody.slice(-200),
          quotedBlockLen: quotedBlock.length,
          quotedBlockLast200: quotedBlock.slice(-200),
          atOld4KCap:   quotedBlock.length >= 3900 && quotedBlock.length <= 4100,
          atOld200KCap: quotedBlock.length >= 199000 && quotedBlock.length <= 201000,
        });
      }

      // ── Step 7: Fetch ─────────────────────────────────────────────────────────
      const res = await fetch("/api/gmail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: finalStr,
      });
      const ct = res.headers.get("content-type") ?? "";

      // ── Step 8: Full post-response log (raw, not hidden) ──────────────────────
      // Read the response body once — we need it for both logging and parsing.
      const rawResponseText = await res.text();
      const isHtmlResponse  = /^\s*<!doctype|^\s*<html/i.test(rawResponseText);
      // Detect origin: Replit proxy responses mention "replit" in headers or body
      const serverHeader    = res.headers.get("server") ?? "";
      const origin = isHtmlResponse
        ? (serverHeader.toLowerCase().includes("replit") || rawResponseText.toLowerCase().includes("replit")
            ? "Replit/proxy" : "unknown-middleware")
        : (ct.includes("application/json") ? "Express" : "unknown");
      console.log("[SEND RESPONSE]", {
        status:              res.status,
        contentType:         ct,
        serverHeader,
        detectedOrigin:      origin,
        isHtmlResponse,
        first1000ResponseChars: rawResponseText.slice(0, 1000),
      });

      // ── Step 9: Parse response ────────────────────────────────────────────────
      if (!ct.includes("application/json")) {
        const displayMsg = isHtmlResponse
          ? `Server returned an HTML page (${res.status}). Origin: ${origin}. See console [SEND RESPONSE] for details.`
          : rawResponseText.slice(0, 300);
        throw new Error(`Send failed (${res.status}): ${displayMsg}`);
      }
      let data: any;
      try {
        data = JSON.parse(rawResponseText);
      } catch {
        throw new Error(`Send failed: server returned invalid JSON (${res.status})`);
      }
      if (!res.ok) {
        if (data.error === "gmail_reauth_required") {
          const e = new Error(data.message || "Gmail connection expired") as any;
          e.isReauthRequired = true;
          throw e;
        }
        const err = new Error(data.message || "Send failed") as any;
        err.draftId      = data.draftId      ?? null;
        err.draftSaved   = data.draftSaved   ?? false;
        err.cidGateError = data.cidGateError ?? false;
        // Preserve the backend error detail (exact gate error text) separately
        // from `message` so the toast can show it even when draftSaved is true.
        err.detail = data.error ?? null;
        throw err;
      }
      return data;
    },
    onSuccess: async (data: any) => {
      onTrustEvent?.({ type: "sent", at: Date.now() });
      if (data?._usedSimplifiedSignature) {
        toast({
          title: "Email sent",
          description: "Sent with a simplified signature — the original contained embedded images that were automatically removed to allow delivery.",
        });
      } else {
        toast({ title: "Email sent" });
      }
      if (activeDraftId) {
        await fetch(`/api/gmail/drafts/${activeDraftId}`, { method: "DELETE", credentials: "include" }).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ["/api/gmail/drafts"] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/thread-signals"] });
      onClose();
    },
    onError: (err: any) => {
      if (err.isReauthRequired) {
        onTrustEvent?.({ type: "send-failed", at: Date.now() });
        toast({
          title: "Gmail connection expired",
          description: "Your Gmail session has expired. Reconnect to continue sending mail.",
          variant: "destructive",
          action: (
            <ToastAction altText="Reconnect Gmail" onClick={() => { window.location.href = "/api/auth/gmail/connect"; }}>
              Reconnect Gmail
            </ToastAction>
          ),
        });
        return;
      }
      // Use the exact gate error text when available; otherwise fall back to message.
      const errorDetail: string | null = err.detail || null;
      if (err.draftSaved && err.draftId) {
        // C2: Server saved content as Gmail draft — switch compose to draft-edit mode so user can retry.
        onTrustEvent?.({ type: "send-failed-draft-saved", at: Date.now() });
        setActiveDraftId(err.draftId);
        queryClient.invalidateQueries({ queryKey: ["/api/gmail/drafts"] });
        toast({
          title: "Send failed — saved as draft",
          description: errorDetail
            ? `${errorDetail}\n\nYour message was saved. Open Drafts to retry.`
            : "Your message was saved. Open Drafts to retry.",
          variant: "destructive",
        });
      } else {
        onTrustEvent?.({ type: "send-failed", at: Date.now() });
        toast({ title: "Failed to send", description: errorDetail || err.message, variant: "destructive" });
      }
    },
  });

  const draftMutation = useMutation({
    mutationFn: async () => {
      onTrustEvent?.({ type: "draft-saving", at: Date.now() });
      const htmlBody = buildEmailHtml(body, activeSignatureHtml);
      const res = await apiRequest("POST", "/api/gmail/drafts", {
        to, subject, body: htmlBody, threadId, draftId: activeDraftId,
        ...(cc  ? { cc }  : {}),
        ...(bcc ? { bcc } : {}),
      });
      return res.json();
    },
    onSuccess: (data) => {
      onTrustEvent?.({ type: "draft-saved", at: Date.now() });
      setActiveDraftId(data.id);
      toast({ title: "Draft saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/drafts"] });
    },
    onError: (err: any) => toast({ title: "Failed to save draft", description: err.message, variant: "destructive" }),
  });

  // Delete an existing draft and close the composer. Mirrors the post-send /
  // post-schedule cleanup path (lines 334 / 370) that already DELETE the draft
  // server-side, plus an explicit user-facing button + confirmation toast.
  const deleteDraftMutation = useMutation({
    mutationFn: async () => {
      if (!activeDraftId) throw new Error("No draft to delete");
      const qs = asAccountId ? `?asAccountId=${asAccountId}` : "";
      const res = await fetch(`/api/gmail/drafts/${activeDraftId}${qs}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Delete failed" }));
        throw new Error(err.message || "Delete failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Draft deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/drafts"] });
      // Drafts also surface in the unified messages list as DRAFT-labeled rows;
      // refresh that too so the deleted item disappears immediately.
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
      onClose();
    },
    onError: (err: any) => toast({ title: "Failed to delete draft", description: err.message, variant: "destructive" }),
  });

  const scheduleMutation = useMutation({
    mutationFn: async () => {
      // Quoted block only — signature sent as selectedSignatureId for backend assembly.
      const schedQuotedBlock = isForward && defaultQuotedHtml
        ? buildForwardedBlockHtml(defaultQuotedFrom, defaultQuotedDate, forwardSubject, forwardTo, defaultQuotedHtml)
        : (!isForward && threadId && defaultQuotedHtml
          ? buildReplyQuoteBlockHtml(defaultQuotedFrom, defaultQuotedDate, defaultQuotedHtml)
          : "");
      // Same as sendMutation: append quoted block OUTSIDE sig markers so the
      // server-side signature replacement doesn't discard forward/reply history.
      let htmlBody = buildEmailHtml(body);
      if (schedQuotedBlock) htmlBody = htmlBody + schedQuotedBlock;
      const res = await apiRequest("POST", "/api/gmail/schedule", {
        to, subject, body: htmlBody, threadId, scheduledAt,
        selectedSignatureId: effectiveSigId ?? null,
        ...(cc ? { cc } : {}),
        ...(bcc ? { bcc } : {}),
        ...(pendingIcal ? { icalContent: pendingIcal } : {}),
      });
      return res.json();
    },
    onSuccess: async () => {
      toast({ title: "Email scheduled", description: `Will send on ${new Date(scheduledAt).toLocaleString()}` });
      if (activeDraftId) {
        await fetch(`/api/gmail/drafts/${activeDraftId}`, { method: "DELETE", credentials: "include" }).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ["/api/gmail/drafts"] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/scheduled"] });
      onClose();
    },
    onError: (err: any) => toast({ title: "Failed to schedule", description: err.message, variant: "destructive" }),
  });

  const isWorking = sendMutation.isPending || draftMutation.isPending || scheduleMutation.isPending || deleteDraftMutation.isPending;
  const minDatetime = new Date(Date.now() + 60000).toISOString().slice(0, 16);

  // The contenteditable editor grows naturally with content — no auto-grow
  // hack needed. composeOuterRef is kept for the drag-overlay and resize-both.
  const composeOuterRef = useRef<HTMLDivElement>(null);

  // Save the current editor selection before the link popover opens.
  const handleBeforeLinkOpen = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  }, []);

  return (
    <>
    {open && createPortal(
      <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[4vh]" data-testid="compose-overlay">
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} />

        {/* Compose window — anchored top-center, resizes downward & rightward from bottom-right corner */}
        <div
          ref={composeOuterRef}
          className="relative z-10 bg-card border border-border/40 rounded-xl shadow-2xl flex flex-col"
          style={{
            width: "min(82vw, 960px)",
            height: "min(84vh, 880px)",
            minWidth: 520,
            minHeight: 420,
            maxWidth: "97vw",
            maxHeight: "96vh",
            resize: "both",
            overflow: "hidden",
          }}
          data-testid="compose-dialog"
          onDragEnter={(e) => {
            e.preventDefault();
            dragCounterRef.current++;
            if (e.dataTransfer.types.includes("Files")) setIsDragOver(true);
          }}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
          onDragLeave={(e) => {
            e.preventDefault();
            dragCounterRef.current--;
            if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setIsDragOver(false); }
          }}
          onDrop={(e) => {
            e.preventDefault();
            dragCounterRef.current = 0;
            setIsDragOver(false);
            if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
          }}
        >
          {/* Hidden file input for click-to-upload */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files?.length) uploadFiles(e.target.files); e.target.value = ""; }}
            data-testid="input-file-upload"
          />

          {/* Drag-over overlay */}
          {isDragOver && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-primary/[0.08] border-2 border-dashed border-primary/60 rounded-xl pointer-events-none">
              <div className="flex flex-col items-center gap-3 bg-card/90 backdrop-blur-sm border border-primary/30 rounded-2xl px-8 py-6 shadow-xl">
                <Paperclip className="h-10 w-10 text-primary" />
                <p className="text-primary font-semibold text-base">Drop to attach</p>
                <p className="text-muted-foreground text-sm">Files will be attached to this email</p>
              </div>
            </div>
          )}
          {/* ── Header bar ──────────────────────────────────────────── */}
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-border/30 bg-card/90 backdrop-blur-sm">
            <div className="flex items-center gap-2.5">
              <h2 className="text-sm font-semibold">{isForward ? "Forward" : threadId ? "Reply" : draftId ? "Edit Draft" : "New Email"}</h2>
              {threadId && replyToSender && (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground/55 bg-muted/25 rounded px-2 py-0.5 border border-border/20">
                  <Reply className="h-2.5 w-2.5 flex-shrink-0" />
                  <span>to <span className="font-medium text-foreground/65">{replyToSender}</span></span>
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-close-compose"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* ── Scrollable fields area ───────────────────────────────── */}
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
            <div className="flex flex-col gap-0 border-b border-border/20">
              {!canSend && (
                <div className="px-4 pt-3">
                  <p className="text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                    You have view-only access. Only trevor@voltsafe.com can send emails.
                  </p>
                </div>
              )}
              {/* To */}
              <div className="flex items-center gap-3 px-4 py-2 border-b border-border/15 hover:bg-muted/10 transition-colors">
                <Label className="text-xs text-muted-foreground/60 w-8 flex-shrink-0">To</Label>
                <EmailTokenInput
                  value={to}
                  onChange={setTo}
                  placeholder="recipient@email.com"
                  disabled={!canSend}
                  data-testid="input-email-to"
                />
              </div>
              {/* CC */}
              <div className="flex items-center gap-3 px-4 py-2 border-b border-border/15 hover:bg-muted/10 transition-colors">
                <Label className="text-xs text-muted-foreground/60 w-8 flex-shrink-0">CC</Label>
                <EmailTokenInput
                  value={cc}
                  onChange={setCc}
                  placeholder="cc@email.com"
                  disabled={!canSend}
                  data-testid="input-email-cc"
                />
              </div>
              {/* BCC */}
              <div className="flex items-center gap-3 px-4 py-2 border-b border-border/15 hover:bg-muted/10 transition-colors">
                <Label className="text-xs text-muted-foreground/60 w-8 flex-shrink-0">BCC</Label>
                <EmailTokenInput
                  value={bcc}
                  onChange={setBcc}
                  placeholder="bcc@email.com"
                  disabled={!canSend}
                  data-testid="input-email-bcc"
                />
              </div>
              {/* Subject */}
              {threadId ? (
                <div className="flex items-center gap-3 px-4 py-2 border-b border-border/15 bg-muted/5">
                  <Label className="text-xs text-muted-foreground/60 w-8 flex-shrink-0">Sub</Label>
                  <span className="flex-1 text-sm text-foreground/70 truncate" data-testid="text-reply-subject">{subject || "(no subject)"}</span>
                </div>
              ) : (
                <div className="flex items-center gap-3 px-4 py-2 border-b border-border/15 hover:bg-muted/10 transition-colors">
                  <Label className="text-xs text-muted-foreground/60 w-8 flex-shrink-0">
                    Sub <span className="text-destructive">*</span>
                  </Label>
                  <input
                    ref={subjectRef as any}
                    value={subject}
                    onChange={(e) => { setSubject(e.target.value); if (e.target.value.trim()) setSubjectError(false); }}
                    disabled={!canSend}
                    data-testid="input-email-subject"
                    className={`flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/35 disabled:opacity-50 ${subjectError ? "text-destructive" : ""}`}
                    placeholder="Subject"
                  />
                  {subjectError && (
                    <span className="text-xs text-destructive flex-shrink-0" data-testid="error-subject-required">Required</span>
                  )}
                </div>
              )}
            </div>

            {/* Message body — rich-text contentEditable editor */}
            <div className="flex-1 px-4 pt-3 pb-1 flex flex-col gap-3">
              <div className="relative">
                {/* Placeholder shown when the editor is functionally empty
                    (isBodyEmpty handles Chrome's <br> empty-div artifact) */}
                {isBodyEmpty(body) && (
                  <span
                    aria-hidden="true"
                    className="absolute top-0 left-0 text-sm text-muted-foreground/35 pointer-events-none select-none"
                  >
                    Write your message...
                  </span>
                )}
                <div
                  ref={bodyRef}
                  role="textbox"
                  aria-label="Email body"
                  aria-multiline="true"
                  spellCheck
                  contentEditable={canSend}
                  suppressContentEditableWarning
                  onInput={() => {
                    if (bodyRef.current) setBody(bodyRef.current.innerHTML);
                  }}
                  onPaste={handleBodyPaste}
                  onKeyDown={(e) => {
                    // Escape closes the composer
                    if (e.key === "Escape") { e.preventDefault(); onClose(); }
                  }}
                  data-testid="input-email-body"
                  className="compose-editor w-full bg-transparent text-sm outline-none leading-relaxed focus:outline-none"
                  style={{ minHeight: 160, wordBreak: "break-word" }}
                />
              </div>

              {/* Signature selector + preview */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between px-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground/70">Signature:</span>
                    <Select
                      value={effectiveSigId === null ? "none" : String(effectiveSigId ?? "")}
                      onValueChange={v => setSelectedSigId(v === "none" ? null : Number(v))}
                    >
                      <SelectTrigger
                        className="h-6 text-xs border-border/40 bg-transparent w-44 py-0"
                        data-testid="select-signature"
                      >
                        <SelectValue placeholder="No signature" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none" data-testid="sig-option-none">No signature</SelectItem>
                        {signaturesData.map(s => (
                          <SelectItem key={s.id} value={String(s.id)} data-testid={`sig-option-${s.id}`}>
                            {s.name}{s.isDefault ? " ★" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <a
                    href="/settings/signatures"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground/70 flex items-center gap-0.5 transition-colors"
                    data-testid="link-manage-signatures"
                  >
                    <Settings2 className="h-2.5 w-2.5" />
                    Manage
                  </a>
                </div>
                {activeSignatureHtml && (
                  <div className="border border-border/30 rounded-md px-3 py-2.5 bg-muted/15">
                    <div
                      className="text-sm opacity-60 pointer-events-none select-none"
                      dangerouslySetInnerHTML={{ __html: activeSignatureHtml }}
                    />
                  </div>
                )}
              </div>

              {/* Quoted original email (reply) / forwarded block (forward) */}
              {(threadId || isForward) && defaultQuotedHtml && (
                <div className="border border-border/25 rounded-md overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/20 border-b border-border/20">
                    {isForward
                      ? <Forward className="h-3 w-3 text-muted-foreground/50 flex-shrink-0" />
                      : <Reply className="h-3 w-3 text-muted-foreground/50 flex-shrink-0" />}
                    <span className="text-[11px] text-muted-foreground/60 truncate">
                      {isForward
                        ? <span className="font-medium">Forwarded message</span>
                        : (<>{defaultQuotedFrom && <span className="font-medium">{parseSenderName(defaultQuotedFrom)}</span>}{defaultQuotedDate && <span className="ml-1">· {defaultQuotedDate}</span>}</>)}
                    </span>
                  </div>
                  <div
                    className="px-3 py-2.5 text-sm text-foreground/70 max-h-64 overflow-y-auto"
                    dangerouslySetInnerHTML={{ __html: defaultQuotedHtml }}
                  />
                </div>
              )}

          {/* Attached assets chips + uploading indicators */}
          {(attachedAssets.length > 0 || uploadingFiles.length > 0) && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {attachedAssets.map((a) => (
                <div key={a.id} className="flex items-center gap-1 bg-primary/10 border border-primary/20 rounded-md px-2 py-0.5 text-xs">
                  <Paperclip className="h-2.5 w-2.5 text-primary" />
                  <span className="max-w-[180px] truncate">{a.name}</span>
                  <button
                    onClick={() => setAttachedAssets((prev) => prev.filter((x) => x.id !== a.id))}
                    className="text-muted-foreground hover:text-destructive ml-0.5"
                    data-testid={`button-remove-attachment-${a.id}`}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
              {uploadingFiles.map((fname) => (
                <div key={fname} className="flex items-center gap-1 bg-muted/60 border border-border/40 rounded-md px-2 py-0.5 text-xs text-muted-foreground">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  <span className="max-w-[160px] truncate">{fname}</span>
                </div>
              ))}
            </div>
          )}

          {pendingIcal && !showZoomPanel && (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#2D8CFF]/10 border border-[#2D8CFF]/30 rounded-md">
              <CalendarClock className="h-3.5 w-3.5 text-[#2D8CFF] flex-shrink-0" />
              <span className="text-xs text-[#2D8CFF] font-medium flex-1">Calendar invite (.ics) will be sent with this email</span>
              <button
                onClick={() => setPendingIcal(null)}
                className="text-[#2D8CFF]/60 hover:text-[#2D8CFF]"
                title="Remove calendar invite"
                data-testid="button-remove-ical"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {showZoomPanel && canSend && (
            <div className="flex flex-col gap-2 p-2.5 bg-muted/30 border border-[#2D8CFF]/30 rounded-md">
              <div className="flex items-center gap-2">
                <Video className="h-4 w-4 text-[#2D8CFF] flex-shrink-0" />
                <span className="text-xs font-medium text-[#2D8CFF]">Add Zoom Meeting</span>
                <button onClick={() => setShowZoomPanel(false)} className="ml-auto text-muted-foreground hover:text-foreground" data-testid="button-close-zoom-panel">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Date & Time</Label>
                  <input
                    type="datetime-local"
                    value={zoomStartTime}
                    min={new Date().toISOString().slice(0, 16)}
                    onChange={(e) => setZoomStartTime(e.target.value)}
                    className="w-full bg-transparent text-sm text-foreground outline-none border border-border/50 rounded px-2 py-1"
                    data-testid="input-zoom-start-time"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Duration</Label>
                  <Select value={zoomDuration} onValueChange={setZoomDuration}>
                    <SelectTrigger className="h-8 text-sm" data-testid="select-zoom-duration">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15">15 min</SelectItem>
                      <SelectItem value="30">30 min</SelectItem>
                      <SelectItem value="45">45 min</SelectItem>
                      <SelectItem value="60">1 hour</SelectItem>
                      <SelectItem value="90">1.5 hours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => zoomMutation.mutate()}
                disabled={!zoomStartTime || zoomMutation.isPending}
                className="w-full bg-[#2D8CFF] hover:bg-[#2680f0] text-white gap-1.5"
                data-testid="button-create-zoom-meeting"
              >
                {zoomMutation.isPending
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating…</>
                  : <><Video className="h-3.5 w-3.5" /> Create Zoom Meeting & Insert Link</>}
              </Button>
            </div>
          )}

          {showScheduler && canSend && (
            <div className="flex items-center gap-2 p-2.5 bg-muted/30 border border-border/50 rounded-md">
              <CalendarClock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground mb-1 block">Send at</Label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  min={minDatetime}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="w-full bg-transparent text-sm text-foreground outline-none"
                  data-testid="input-scheduled-at"
                />
              </div>
              {scheduledAt && (
                <button onClick={() => setScheduledAt("")} className="text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
            </div>
          </div>

          {/* Rich formatting toolbar — always visible inside the compose dialog */}
          {canSend && (
            <div className="flex-shrink-0 px-3 py-1.5 border-t border-border/20 bg-card/50">
              <EmailFormatToolbar onBeforeLinkOpen={handleBeforeLinkOpen} />
            </div>
          )}

          <div className="flex-shrink-0 flex items-center justify-between gap-2 px-4 py-2.5 border-t border-border/30 bg-card/80">
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
              {canSend && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => draftMutation.mutate()}
                  disabled={isBodyEmpty(body) || isWorking}
                  data-testid="button-save-draft"
                  className="text-muted-foreground"
                >
                  {draftMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                  <span className="ml-1">Save Draft</span>
                </Button>
              )}
              {/* Delete Draft — only shown when an actual draft exists server-side
                  (i.e. user opened an existing draft, or saved one this session).
                  Cancel handles the "discard unsaved compose" case already. */}
              {canSend && activeDraftId && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (window.confirm("Delete this draft? This can't be undone.")) {
                      deleteDraftMutation.mutate();
                    }
                  }}
                  disabled={isWorking}
                  data-testid="button-delete-draft"
                  className="text-muted-foreground hover:text-destructive"
                  title="Delete this draft"
                >
                  {deleteDraftMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  <span className="ml-1">Delete Draft</span>
                </Button>
              )}
              {canSend && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-8 w-8 relative ${(attachedAssets.length > 0 || uploadingFiles.length > 0) ? "text-primary" : "text-muted-foreground"}`}
                  onClick={() => setShowAssetPicker(true)}
                  title="Attach file — or drag & drop onto the compose window"
                  data-testid="button-attach-asset"
                >
                  {uploadingFiles.length > 0
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Paperclip className="h-4 w-4" />
                  }
                  {(attachedAssets.length + uploadingFiles.length) > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-primary text-[9px] text-primary-foreground flex items-center justify-center font-medium">
                      {attachedAssets.length + uploadingFiles.length}
                    </span>
                  )}
                </Button>
              )}
              {canSend && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-primary"
                  onClick={() => setShowQuotePicker(true)}
                  title="Attach a quote"
                  data-testid="button-attach-quote"
                >
                  <Receipt className="h-4 w-4" />
                </Button>
              )}
              {canSend && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-8 w-8 ${showZoomPanel ? "text-[#2D8CFF]" : "text-muted-foreground hover:text-[#2D8CFF]"}`}
                  onClick={() => { setShowZoomPanel((v) => !v); setZoomStartTime(defaultZoomStart()); }}
                  title="Add Zoom Meeting"
                  data-testid="button-toggle-zoom-panel"
                >
                  <Video className="h-4 w-4" />
                </Button>
              )}
              {canSend && (
                <SnippetInsertButton
                  onInsert={(snippetBody) => {
                    // Snippets may be plain text (old format) or HTML (new format).
                    // Convert to HTML so they render correctly in the rich-text editor.
                    const html = snippetBody.includes("<") ? snippetBody : plainTextToHtml(snippetBody);
                    const insertHtml = (isBodyEmpty(body) ? "" : "<br><br>") + html;
                    if (bodyRef.current) {
                      bodyRef.current.focus();
                      document.execCommand("insertHTML", false, insertHtml);
                      setBody(bodyRef.current.innerHTML);
                    } else {
                      setBody((prev) => (prev || "") + insertHtml);
                    }
                  }}
                  onInsertFull={(snippetBody, snippetSubject) => {
                    const html = snippetBody.includes("<") ? snippetBody : plainTextToHtml(snippetBody);
                    const insertHtml = (isBodyEmpty(body) ? "" : "<br><br>") + html;
                    if (bodyRef.current) {
                      bodyRef.current.focus();
                      document.execCommand("insertHTML", false, insertHtml);
                      setBody(bodyRef.current.innerHTML);
                    } else {
                      setBody((prev) => (prev || "") + insertHtml);
                    }
                    if (!threadId && snippetSubject && !subject.trim()) setSubject(snippetSubject);
                  }}
                  isNewEmail={!threadId}
                  activeContact={
                    replyToSender
                      ? {
                          firstName: replyToSender.split(" ")[0],
                          lastName: replyToSender.split(" ").slice(1).join(" "),
                        }
                      : undefined
                  }
                />
              )}
              {canSend && (
                <Popover
                  open={showCalendarPopover}
                  onOpenChange={(v) => { setShowCalendarPopover(v); if (!v) setShowCalendarEdit(false); }}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`h-8 w-8 ${savedCalUrl ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
                      title={savedCalUrl ? "Insert your booking link" : "Set your booking link"}
                      data-testid="button-insert-calendar-link"
                    >
                      <Calendar className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-3" align="start" side="top">
                    {savedCalUrl && !showCalendarEdit ? (
                      <div className="space-y-2.5">
                        <p className="text-sm font-medium">Insert booking link</p>
                        <p className="text-xs text-muted-foreground break-all">{savedCalUrl}</p>
                        <div className="flex gap-2 pt-0.5">
                          <Button
                            size="sm"
                            className="flex-1"
                            onClick={() => {
                              insertCalendarLinkIntoBody(savedCalUrl);
                              setShowCalendarPopover(false);
                              toast({ title: "Booking link inserted" });
                            }}
                          >
                            Insert
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowCalendarEdit(true)}
                            data-testid="button-change-calendar-url"
                          >
                            Change
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        <p className="text-sm font-medium">Your booking link</p>
                        <p className="text-xs text-muted-foreground">Paste your Calendly or other booking URL — saved to your profile.</p>
                        <Input
                          value={calendarUrlInput}
                          onChange={(e) => setCalendarUrlInput(e.target.value)}
                          placeholder="https://calendly.com/yourname"
                          className="h-8 text-sm"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && calendarUrlInput.trim()) {
                              const url = calendarUrlInput.trim();
                              saveCalendarUrlMutation.mutate(url, {
                                onSuccess: () => {
                                  insertCalendarLinkIntoBody(url);
                                  setShowCalendarPopover(false);
                                  toast({ title: "Booking link saved & inserted" });
                                },
                                onError: (err: any) => toast({ title: "Could not save", description: err.message, variant: "destructive" }),
                              });
                            }
                          }}
                          data-testid="input-calendar-url"
                          autoFocus
                        />
                        <div className="flex gap-2 pt-0.5">
                          <Button
                            size="sm"
                            className="flex-1"
                            disabled={!calendarUrlInput.trim() || saveCalendarUrlMutation.isPending}
                            onClick={() => {
                              const url = calendarUrlInput.trim();
                              if (!url) return;
                              saveCalendarUrlMutation.mutate(url, {
                                onSuccess: () => {
                                  insertCalendarLinkIntoBody(url);
                                  setShowCalendarPopover(false);
                                  toast({ title: "Booking link saved & inserted" });
                                },
                                onError: (err: any) => toast({ title: "Could not save", description: err.message, variant: "destructive" }),
                              });
                            }}
                            data-testid="button-save-calendar-url"
                          >
                            {saveCalendarUrlMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save & Insert"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setShowCalendarPopover(false); setShowCalendarEdit(false); }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              )}
              {/* Insert Tracked CTA */}
              {canSend && (
                <Popover open={showCtaPicker} onOpenChange={setShowCtaPicker}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`h-8 w-8 ${showCtaPicker ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
                      title="Insert tracked CTA"
                      data-testid="button-insert-cta"
                    >
                      <ImagePlus className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-3" align="start" side="top">
                    <p className="text-sm font-medium mb-2">Insert Tracked CTA</p>
                    {ctaPickerQuery.isLoading ? (
                      <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin" /></div>
                    ) : (ctaPickerQuery.data ?? []).filter(c => c.tracking_enabled).length === 0 ? (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">No tracked CTAs set up yet.</p>
                        <p className="text-xs text-muted-foreground/60">Go to Settings → Email Signatures to create one.</p>
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-52 overflow-y-auto">
                        {(ctaPickerQuery.data ?? []).filter(c => c.tracking_enabled).map(cta => (
                          <button
                            key={cta.id}
                            onClick={() => insertCtaIntoBody(cta)}
                            className="w-full flex items-center gap-2.5 text-left p-2 rounded-md hover:bg-muted/50 transition-colors"
                            data-testid={`button-insert-cta-${cta.id}`}
                          >
                            {cta.image_url ? (
                              <img src={cta.image_url} alt={cta.name} className="h-8 w-12 object-cover rounded border border-border/40 shrink-0" />
                            ) : (
                              <div className="h-8 w-12 rounded border border-border/40 shrink-0 bg-primary/10 flex items-center justify-center">
                                <ImagePlus className="h-3.5 w-3.5 text-primary" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="text-xs font-medium truncate">{cta.name}</p>
                              <p className="text-[10px] text-muted-foreground/60 truncate">{cta.destination_url}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              )}
            </div>
            {canSend && (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-8 w-8 ${showScheduler ? "text-primary" : "text-muted-foreground"}`}
                  onClick={() => setShowScheduler((v) => !v)}
                  title="Send Later"
                  data-testid="button-toggle-scheduler"
                >
                  <Clock className="h-4 w-4" />
                </Button>
                {scheduledAt ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      if (!threadId && !subject.trim()) {
                        setSubjectError(true);
                        subjectRef.current?.focus();
                        subjectRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                        return;
                      }
                      scheduleMutation.mutate();
                    }}
                    disabled={!to || !body || isWorking}
                    data-testid="button-schedule-send"
                    className="gap-1"
                  >
                    {scheduleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
                    Schedule
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => {
                      if (!threadId && !subject.trim()) {
                        setSubjectError(true);
                        subjectRef.current?.focus();
                        subjectRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                        return;
                      }
                      sendMutation.mutate();
                    }}
                    disabled={!to || !body || isWorking}
                    data-testid="button-send-email"
                  >
                    {sendMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending...</> : <><Send className="h-4 w-4 mr-1" /> Send</>}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    , document.body)}

    {/* Restricted asset safety warning */}
    {restrictedWarning && (
      <Dialog open={!!restrictedWarning} onOpenChange={() => setRestrictedWarning(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-400">
              <ShieldAlert className="h-4 w-4" /> Restricted Asset
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{restrictedWarning.asset.name}</span> is marked{" "}
              <span className="font-medium text-amber-400">{restrictedWarning.asset.visibility.replace(/_/g, " ")}</span>.
              Are you sure you want to attach it to this email?
            </p>
            <p className="text-xs text-muted-foreground/70">
              This file is not intended for external recipients. Only attach it if you are certain the recipient should have access.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRestrictedWarning(null)} data-testid="button-cancel-restricted">Cancel</Button>
            <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white" onClick={() => { restrictedWarning.onConfirm(); setRestrictedWarning(null); }} data-testid="button-confirm-restricted">
              Attach Anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )}

    {/* Asset picker dialog */}
    <Dialog open={showAssetPicker} onOpenChange={(v) => { if (!v) { setShowAssetPicker(false); setAssetSearch(""); } }}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-hidden flex flex-col" data-testid="dialog-asset-picker">
        <DialogHeader className="pb-0">
          <DialogTitle className="flex items-center gap-2">
            <Paperclip className="h-4 w-4 text-primary" /> Asset Library
          </DialogTitle>
        </DialogHeader>

        {/* Upload from computer */}
        <button
          className="flex items-center gap-3 w-full border border-dashed border-border/60 hover:border-primary/50 hover:bg-primary/5 rounded-lg px-3 py-2 text-left transition-colors group -mt-1"
          onClick={() => { fileInputRef.current?.click(); setShowAssetPicker(false); }}
          data-testid="button-upload-from-computer"
        >
          <div className="h-7 w-7 rounded-md bg-muted/60 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/10">
            <Upload className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary" />
          </div>
          <div>
            <p className="text-xs font-medium">Upload from computer</p>
            <p className="text-[10px] text-muted-foreground">Select any file from your device</p>
          </div>
        </button>

        {/* Search */}
        <div className="relative -mt-0.5">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={assetSearch}
            onChange={e => setAssetSearch(e.target.value)}
            placeholder="Search assets by name or description…"
            className="w-full pl-8 pr-3 h-8 text-xs bg-muted/40 border border-border/40 rounded-md outline-none focus:border-primary/50 focus:bg-muted/60 transition-colors"
            data-testid="input-asset-search"
          />
        </div>

        {/* Tab chips */}
        <div className="flex gap-1 flex-wrap -mt-0.5 pb-0.5">
          {[
            { key: "recommended", label: "Recommended" },
            { key: "sales",       label: "Sales" },
            { key: "product",     label: "Product" },
            { key: "proof",       label: "Proof" },
            { key: "quotes",      label: "Quotes" },
            { key: "brand",       label: "Brand" },
            { key: "internal",    label: "Internal" },
            { key: "recent",      label: "Recent" },
            { key: "favorites",   label: "Favorites" },
          ].map(tab => (
            <button key={tab.key}
              onClick={() => setAssetTab(tab.key)}
              data-testid={`asset-tab-${tab.key}`}
              className={`px-2.5 py-0.5 rounded text-xs font-medium transition-colors ${
                assetTab === tab.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/80 text-muted-foreground"
              } ${tab.key === "internal" ? "border border-red-500/30 text-red-400 hover:bg-red-500/10" : ""}`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Asset list */}
        <div className="flex-1 overflow-y-auto space-y-0.5 py-0.5">
          {assetsQuery.isLoading && (
            <div className="p-4 text-center text-sm text-muted-foreground">Loading assets…</div>
          )}
          {!assetsQuery.isLoading && (assetsQuery.data || []).length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              <Paperclip className="h-6 w-6 mx-auto mb-2 opacity-30" />
              <p>{assetTab === "quotes" ? "No quote files yet. Create a quote to generate files." : assetTab === "favorites" ? "No favorites yet." : assetTab === "recent" ? "No recently attached assets." : "No assets found."}</p>
              {assetTab === "quotes" && <a href="/quotes" target="_blank" className="text-primary hover:underline text-xs mt-1 block">Go to Quotes →</a>}
              {assetTab !== "quotes" && <a href="/documents" target="_blank" className="text-primary hover:underline text-xs mt-1 block">Go to Asset Library →</a>}
            </div>
          )}
          {/* CTA thumbnail hint — images should go through the CTA picker, not as attachments */}
          {(assetsQuery.data || []).some(a => (a.mimeType || "").startsWith("image/")) && (
            <div className="mx-1 mb-1.5 px-3 py-2 rounded-md bg-primary/5 border border-primary/20 text-xs text-muted-foreground flex items-start gap-2">
              <span className="text-primary mt-0.5">ℹ</span>
              <span>Image files are hidden here — use the <span className="text-primary font-medium">Insert Tracked CTA</span> button to embed Watch Demo thumbnails and other images directly in your email.</span>
            </div>
          )}
          {(assetsQuery.data || []).filter(a => !(a.mimeType || "").startsWith("image/")).map((asset) => {
            const isAttached = attachedAssets.some((a) => a.id === asset.id);
            const vis = asset.visibility ?? "customer_safe";
            const isRestricted = ["internal_only", "investor_only", "admin_only"].includes(vis);
            const visLabel = vis.replace(/_/g, " ");

            const handleToggle = () => {
              if (isAttached) {
                setAttachedAssets(prev => prev.filter(a => a.id !== asset.id));
                return;
              }
              const doAttach = () => {
                setAttachedAssets(prev => [...prev, { id: asset.id, name: asset.name }]);
                // Track usage on server (fire-and-forget)
                fetch(`/api/assets/${asset.id}/track-attachment`, { method: "PATCH", credentials: "include" }).catch(() => {});
              };
              if (isRestricted) {
                setRestrictedWarning({ asset: { id: asset.id, name: asset.name, visibility: vis }, onConfirm: doAttach });
              } else {
                doAttach();
              }
            };

            return (
              <button
                key={asset.id}
                onClick={handleToggle}
                data-testid={`asset-picker-item-${asset.id}`}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${
                  isAttached ? "bg-primary/10 border border-primary/30" : "hover:bg-muted/50"
                } ${isRestricted && !isAttached ? "border border-red-500/10 bg-red-500/5" : ""}`}
              >
                <div className={`h-4 w-4 rounded border flex-shrink-0 flex items-center justify-center ${
                  isAttached ? "bg-primary border-primary" : "border-border"
                }`}>
                  {isAttached && <span className="text-[10px] text-primary-foreground font-bold">✓</span>}
                </div>
                <Paperclip className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium truncate">{asset.name}</p>
                    {isRestricted && (
                      <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium bg-red-500/10 text-red-400 border border-red-500/20 flex-shrink-0">
                        <Lock className="h-2 w-2" />{visLabel}
                      </span>
                    )}
                    {!isRestricted && vis === "customer_safe" && (
                      <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium bg-teal-500/10 text-teal-400 border border-teal-500/20 flex-shrink-0" data-testid={`badge-customer-safe-asset-${asset.id}`}>
                        Safe
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground capitalize mt-0.5">
                    {asset.useCase ?? asset.category} · {asset.mimeType.split("/").pop()?.toUpperCase()}
                    {(asset.usageCount ?? 0) > 0 && ` · Used ${asset.usageCount}×`}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex-shrink-0 pt-2 flex justify-between items-center border-t border-border/50">
          <span className="text-xs text-muted-foreground">{attachedAssets.length} attached</span>
          <Button size="sm" onClick={() => { setShowAssetPicker(false); setAssetSearch(""); }} data-testid="button-done-assets">Done</Button>
        </div>
      </DialogContent>
    </Dialog>

    {/* Quote Attach Picker */}
    <Dialog open={showQuotePicker} onOpenChange={(v) => !v && setShowQuotePicker(false)}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-primary" />
            Attach a Quote
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">Select XLSX or HTML invoice files to attach to your email.</p>
        <div className="flex-1 overflow-y-auto space-y-1.5 py-1">
          {quotesQuery.isLoading && (
            <div className="space-y-2 p-2">
              {[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          )}
          {!quotesQuery.isLoading && (quotesQuery.data?.data || []).length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              <Receipt className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>No quotes yet.</p>
              <a href="/quotes" target="_blank" className="text-primary hover:underline text-xs mt-1 block">Go to Quotes →</a>
            </div>
          )}
          {(quotesQuery.data?.data || []).map((q) => {
            const sym = q.currency === "CAD" ? "CA$" : q.currency === "GBP" ? "£" : q.currency === "EUR" ? "€" : q.currency === "AUD" ? "A$" : q.currency === "MXN" ? "MX$" : "$";
            const xlsxAttached = q.xlsxAssetId ? attachedAssets.some(a => a.id === q.xlsxAssetId) : false;
            const htmlAttached = q.htmlAssetId ? attachedAssets.some(a => a.id === q.htmlAssetId) : false;
            return (
              <div key={q.id} className="border border-border/50 rounded-lg px-3 py-2.5 bg-muted/10" data-testid={`quote-picker-row-${q.id}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="text-sm font-mono font-semibold">{q.quoteNumber}</p>
                    <p className="text-xs text-muted-foreground truncate">{q.customerName || "—"}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-semibold">{sym}{(q.total || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    <p className="text-xs text-muted-foreground">{q.currency} · {q.status}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  {q.xlsxAssetId ? (
                    <button
                      onClick={() => setAttachedAssets(prev =>
                        xlsxAttached ? prev.filter(a => a.id !== q.xlsxAssetId) : [...prev, { id: q.xlsxAssetId!, name: `${q.quoteNumber}.xlsx` }]
                      )}
                      data-testid={`button-attach-xlsx-${q.id}`}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors border ${
                        xlsxAttached ? "bg-primary/15 border-primary/40 text-primary" : "border-border/50 hover:border-green-500/40 hover:bg-green-500/5 text-muted-foreground"
                      }`}
                    >
                      <Download className="h-3 w-3" />
                      {xlsxAttached ? "✓ XLSX" : "XLSX"}
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground/40 px-2.5 py-1">No XLSX</span>
                  )}
                  {q.htmlAssetId ? (
                    <button
                      onClick={() => setAttachedAssets(prev =>
                        htmlAttached ? prev.filter(a => a.id !== q.htmlAssetId) : [...prev, { id: q.htmlAssetId!, name: `${q.quoteNumber}-Invoice.html` }]
                      )}
                      data-testid={`button-attach-html-${q.id}`}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors border ${
                        htmlAttached ? "bg-blue-500/15 border-blue-500/40 text-blue-400" : "border-border/50 hover:border-blue-500/40 hover:bg-blue-500/5 text-muted-foreground"
                      }`}
                    >
                      <FileText className="h-3 w-3" />
                      {htmlAttached ? "✓ HTML Invoice" : "HTML Invoice"}
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground/40 px-2.5 py-1">No HTML</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex-shrink-0 pt-3 flex justify-between items-center border-t border-border/50">
          <span className="text-xs text-muted-foreground">{attachedAssets.length} file{attachedAssets.length !== 1 ? "s" : ""} attached</span>
          <Button size="sm" onClick={() => setShowQuotePicker(false)} data-testid="button-done-quotes">Done</Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}

type ReadingMode = "beautiful" | "raw" | "plain";
type ZoomMode = "fit" | "actual";

// Pure helpers for Google Calendar RSVP link detection.
// Defined at module level — created once per module load, not per render.
function isCalendarRsvpLink(href: string): boolean {
  if (!href) return false;
  const lower = href.toLowerCase();
  if (!lower.includes("calendar.google.com") && !lower.includes("google.com/calendar")) return false;
  return (
    lower.includes("action=respond") ||
    lower.includes("action=accept") ||
    lower.includes("action=decline") ||
    lower.includes("action=tentative") ||
    lower.includes("action=maybe") ||
    (lower.includes("eid=") && lower.includes("rst="))
  );
}

function extractRsvpResponse(
  href: string,
  text: string,
): "accepted" | "declined" | "tentative" | null {
  const lower = href.toLowerCase();
  const textLower = text.toLowerCase().trim();
  if (lower.includes("action=accept") || lower.includes("rst=1")) return "accepted";
  if (lower.includes("action=decline") || lower.includes("rst=2")) return "declined";
  if (lower.includes("action=tentative") || lower.includes("action=maybe") || lower.includes("rst=3")) return "tentative";
  if (/\b(yes|accept|going)\b/.test(textLower)) return "accepted";
  if (/\b(no|decline|not\s+going)\b/.test(textLower)) return "declined";
  if (/\b(maybe|tentative|possibly)\b/.test(textLower)) return "tentative";
  return null;
}

function MessageBody({
  body,
  isHtml,
  headerLeft,
  calendarAttachmentId,
  gmailMessageId,
}: {
  body: string;
  isHtml: boolean;
  /**
   * Optional content rendered to the LEFT of the FIT/100% + Beautiful/Source/Plain
   * tab cluster — used by the inbox reader to inject a rich-text formatting
   * toolbar so writers can bold/italic/list/link the reply they're about to
   * compose. Anything truthy will be wrapped in a left-aligned wrapper so the
   * existing right-aligned tab cluster stays anchored to the right edge.
   */
  headerLeft?: React.ReactNode;
  /**
   * DB id of the text/calendar attachment for this message, if any.
   * Enables the iframe click handler to intercept Google Calendar RSVP
   * links (Yes / No / Maybe) and respond in-app instead of opening a
   * new browser tab.
   */
  calendarAttachmentId?: number;
  /** Gmail message ID (e.g. "18xyzabc"). When provided, src="cid:xxx" refs
   *  in the HTML body are rewritten to /api/gmail/messages/{id}/cid-image/xxx
   *  before DOMPurify runs so inline signature images resolve in the browser. */
  gmailMessageId?: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<ReadingMode>("beautiful");
  const [zoom, setZoom] = useState<ZoomMode>("fit");
  const [iframeReady, setIframeReady] = useState(false);
  const [scaleApplied, setScaleApplied] = useState(1);
  const [rsvpBannerStatus, setRsvpBannerStatus] = useState<
    "pending" | "accepted" | "declined" | "tentative" | null
  >(null);
  const [rsvpBannerError, setRsvpBannerError] = useState<string | null>(null);

  // Re-fit content to the available pane width. Uses CSS transform: scale()
  // on the body so wide newsletters/tables don't overflow horizontally and
  // don't render at a giant zoomed-in size.
  const fitContent = useCallback(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc?.body) return;
    const body = doc.body;
    // Reset any previous transform so we measure the natural content width.
    body.style.transform = "";
    body.style.transformOrigin = "0 0";
    body.style.width = "";
    // Force a synchronous reflow so the browser discards cached layout
    // values from before the reset — critical when the pane was just resized.
    void body.offsetWidth;
    const containerWidth = iframe.clientWidth || iframe.getBoundingClientRect().width || 0;
    if (!containerWidth) return;
    const contentWidth = Math.max(
      body.scrollWidth,
      doc.documentElement.scrollWidth,
    );
    let scale = 1;
    if (zoom === "fit" && contentWidth > containerWidth + 2) {
      // Cap the down-scale so text never becomes unreadable.
      scale = Math.max(0.55, containerWidth / contentWidth);
      body.style.width = `${contentWidth}px`;
      body.style.transform = `scale(${scale})`;
      body.style.transformOrigin = "0 0";
    } else {
      // No scale needed — pin the body width to the container so plain-text
      // and simple HTML emails reflow to fill the full available pane width.
      body.style.width = `${containerWidth}px`;
    }
    setScaleApplied(scale);
    // After scale, the visual height is scrollHeight * scale.
    const h = Math.ceil(body.scrollHeight * scale) + 8;
    iframe.style.height = `${h}px`;
  }, [zoom]);

  const handleIframeLoad = () => {
    fitContent();
    // Re-fit once images decode (their natural sizes may shift the layout).
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (doc) {
      const imgs = Array.from(doc.images || []);
      let pending = imgs.filter((i) => !i.complete).length;
      if (pending > 0) {
        imgs.forEach((img) => {
          if (img.complete) return;
          const done = () => { pending--; if (pending <= 0) fitContent(); };
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
        });
      }
      // Belt-and-suspenders: re-fit shortly after for any late layout.
      setTimeout(fitContent, 120);
      setTimeout(fitContent, 400);
    }
    setIframeReady(true);
  };

  // Re-fit when the surrounding pane is resized (split-pane drag, etc).
  // A follow-up RAF call ensures the measurement is taken after the browser
  // has fully settled the new flex layout (avoids stale clientWidth reads
  // on the first tick after a panel resize).
  useEffect(() => {
    const wrap = wrapperRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    let rafId: number;
    const ro = new ResizeObserver(() => {
      fitContent();
      rafId = requestAnimationFrame(fitContent);
    });
    ro.observe(wrap);
    return () => { ro.disconnect(); cancelAnimationFrame(rafId); };
  }, [fitContent]);

  // When zoom mode flips, recompute.
  useEffect(() => { fitContent(); }, [zoom, fitContent]);

  // Intercept Google Calendar RSVP link clicks inside the sandboxed iframe.
  // sandbox="allow-same-origin" lets the parent attach listeners directly on
  // contentDocument. Capture phase (useCapture=true) fires before any inline
  // onclick the email HTML might carry, preventing the default navigation.
  useEffect(() => {
    if (!iframeReady || calendarAttachmentId == null) return;
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") || anchor.href || "";
      if (!isCalendarRsvpLink(href)) return;
      e.preventDefault();
      e.stopPropagation();
      const response = extractRsvpResponse(href, anchor.textContent || "");
      if (!response) return;
      setRsvpBannerStatus("pending");
      setRsvpBannerError(null);
      fetch("/api/calendar/invitations/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ attachmentId: calendarAttachmentId, response }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.success) {
            setRsvpBannerStatus(d.responseStatus as "accepted" | "declined" | "tentative");
          } else {
            setRsvpBannerStatus(null);
            setRsvpBannerError(d.message || "Could not update calendar response");
          }
        })
        .catch((err) => {
          setRsvpBannerStatus(null);
          setRsvpBannerError(err.message || "Network error \u2014 try again");
        });
    };
    doc.addEventListener("click", handleClick, true);
    return () => { doc.removeEventListener("click", handleClick, true); };
  }, [iframeReady, calendarAttachmentId]);

  // Build the HTML payload the iframe will render. For HTML emails we just
  // sanitize. For plain-text emails (Gmail returns text-only for some senders,
  // and ANY message we couldn't pull HTML for falls back to the text body) we
  // first convert to presentation-grade HTML — auto-linking URLs (including
  // Gmail's `<URL>` angle-bracket plain-text wrapping), turning `*bold*` into
  // <strong>, styling quoted reply lines as <blockquote>, and hiding noisy
  // `[image: ...]` placeholders — THEN sanitize that result so DOMPurify is
  // still the last line of defense before content reaches the iframe srcDoc.
  // Result: every email reads like a real email, never a wall of monospace.
  const sanitized = useMemo(() => {
    if (!body) return "";

    // ── Pre-process: resolve cid: and log all img srcs ────────────────────
    let resolved = body;

    // 0. Pre-process: Apple Mail (iPhone) and some Outlook versions replace
    //    <img src="cid:FILE.png"> with &lt;FILE.png&gt; text when quoting an
    //    email they cannot re-embed inline images in.  That HTML-entity-encoded
    //    filename renders as visible text <FILE.png> in the browser.
    //    Reconstruct a proper <img src="cid:FILE"> tag so the proxy step below
    //    can attempt to resolve it — or at least show a silent broken-image
    //    placeholder instead of confusing filename text.
    if (isHtml) {
      resolved = resolved.replace(
        /&lt;([A-Za-z0-9][A-Za-z0-9_\-]*\.(?:png|jpg|jpeg|gif|webp|svg|PNG|JPG|JPEG|GIF|WEBP|SVG))(?:@[^&\s]*)?\s*&gt;/g,
        (_match, filename) => `<img src="cid:${filename}" style="max-width:200px;height:auto" alt="${filename}">`
      );
    }

    // 1. Resolve cid: references BEFORE DOMPurify (DOMPurify strips cid: URIs by
    //    default). Replace src="cid:xxx" with a backend proxy URL that fetches the
    //    inline image part from Gmail API.
    if (gmailMessageId && /src=["']cid:/i.test(resolved)) {
      // Handle both double-quoted (src="cid:...") and single-quoted (src='cid:...')
      // attribute forms — rich-text editors sometimes produce single-quote attrs.
      resolved = resolved.replace(/\bsrc="cid:([^"]+)"/gi, (_, cid) =>
        `src="/api/gmail/messages/${encodeURIComponent(gmailMessageId)}/cid-image/${encodeURIComponent(cid)}"`
      );
      resolved = resolved.replace(/\bsrc='cid:([^']+)'/gi, (_, cid) =>
        `src="/api/gmail/messages/${encodeURIComponent(gmailMessageId)}/cid-image/${encodeURIComponent(cid)}"`
      );
    }

    // 2. Proxy remote https:// image URLs through our server so they always
    //    render in the sandboxed iframe reading pane, regardless of cross-origin
    //    or network-sandbox restrictions (same approach as Spark Mail / Gmail).
    //    Only rewrites src="https://..." — skips CID proxy paths (already /api/),
    //    data: URIs, and relative paths.
    if (isHtml) {
      resolved = resolved.replace(/\bsrc="(https?:\/\/[^"]+)"/gi, (_, url) =>
        `src="/api/gmail/proxy-image?url=${encodeURIComponent(url)}"`
      );
      resolved = resolved.replace(/\bsrc='(https?:\/\/[^']+)'/gi, (_, url) =>
        `src='/api/gmail/proxy-image?url=${encodeURIComponent(url)}'`
      );
    }

    // 3. Diagnostic: log every img src before and after sanitization so broken
    //    images in the viewer are traceable in the browser console.
    if (import.meta.env.DEV || (window as any).__VS_IMG_DEBUG__) {
      const preSrcs = [...resolved.matchAll(/\bsrc="([^"]+)"/gi)].map(m => m[1]);
      const result = isHtml ? sanitizeEmailHtml(resolved) : sanitizeEmailHtml(plainTextToEmailHtml(resolved));
      const postSrcs = [...result.matchAll(/\bsrc="([^"]+)"/gi)].map(m => m[1]);
      preSrcs.forEach((orig, i) => {
        const final = postSrcs[i] ?? "(removed)";
        const isDataImg = /^data:image\//i.test(orig);
        const isCidProxy = /^\/api\/gmail\/messages\//i.test(orig);
        const isImgProxy = /^\/api\/gmail\/proxy-image/i.test(orig);
        const isHttps = /^https?:\/\//i.test(orig);
        const allowed = final !== "(removed)" && final !== "";
        const reason = isDataImg ? "data:image (base64 inline)"
          : isCidProxy ? "cid proxy rewrite"
          : isImgProxy ? "remote-image proxy rewrite"
          : isHttps ? "https url"
          : allowed ? "relative/other"
          : "stripped by sanitizer";
        if (isDataImg || !allowed) {
          console.log(
            `[message-viewer-img] originalSrc=${orig.slice(0, 80)}${orig.length > 80 ? "…" : ""} finalSrc=${final.slice(0, 80)} allowed=${allowed} reason=${reason}`
          );
        }
      });
      return result;
    }

    if (isHtml) return sanitizeEmailHtml(resolved);
    return sanitizeEmailHtml(plainTextToEmailHtml(resolved));
  }, [body, isHtml, gmailMessageId]);
  const plainTextView = useMemo(
    () => (body && isHtml ? htmlToPlainText(sanitized) : body || ""),
    [sanitized, body, isHtml],
  );

  if (!body) return <p className="text-muted-foreground text-sm italic">No content</p>;

  // CSS strategy: aggressively normalize hardcoded newsletter widths so
  // images/tables/buttons fit the pane naturally — Spark/Apple Mail style.
  // We also kill horizontal overflow at the html/body level as a final guard.
  const srcDoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<base href="/">
<style>
  html, body {
    margin: 0; padding: 0;
    background: #ffffff;
    color: #1a1a1a;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    font-size: 14.5px; line-height: 1.6;
    word-wrap: break-word; overflow-wrap: anywhere;
    -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
    box-sizing: border-box;
  }
  body { padding: 12px 16px; box-sizing: border-box; }

  /*
   * RENDERING PHILOSOPHY: let the email's own HTML define layout — tables,
   * cell widths, image sizes — exactly as the sender designed it.
   * fitContent() already applies a CSS transform to shrink wide emails to fit
   * the reading pane, so aggressive element-level !important overrides are
   * counter-productive: they break table column ratios, explode small icons,
   * and strip background-color boxes that rely on their exact cell dimensions.
   *
   * We ONLY apply the minimum overrides needed for security / sanity:
   *   - Prevent horizontal overflow at the document level
   *   - Let images scale down if they're wider than the body (but don't
   *     force width:auto on images that have an explicit small width attr,
   *     which would make a 32×32 logo render at its full 512px natural size)
   *   - Preserve all background-color, border, and padding on table cells
   */

  /* Tables: keep the email's own border/padding/width attributes intact */
  table { border-collapse: collapse; }
  td, th { word-wrap: break-word; overflow-wrap: anywhere; vertical-align: top; }

  /*
   * Images: scale DOWN if wider than their container, but never scale UP
   * a small image that has an explicit width attribute (e.g. a 32px logo).
   * Crucially we do NOT set width:auto here — that would override the
   * HTML width attribute and expand small icons to their natural full size.
   */
  img { max-width: 100%; height: auto; display: inline-block; }
  video { max-width: 100%; height: auto; }

  /* Links */
  a { color: #0b6ed4; text-decoration: none; border-bottom: 1px solid rgba(11,110,212,0.2); transition: border-color .15s ease; }
  a:hover { border-bottom-color: rgba(11,110,212,0.6); }

  /* Code & quotes */
  pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  pre { white-space: pre-wrap; word-break: break-word; background: #f6f8fa; padding: 12px 14px; border-radius: 8px; font-size: 13px; overflow-x: auto; }
  blockquote { border-left: 3px solid #d0d7de; margin: 14px 0; padding: 4px 14px; color: #57606a; }
  hr { border: none; border-top: 1px solid #d0d7de; margin: 18px 0; }

  /* Typography — only kick in for plain-text emails; HTML emails supply their own */
  h1, h2, h3, h4 { color: #0d1117; line-height: 1.25; margin: 16px 0 8px; }
  h1 { font-size: 20px; } h2 { font-size: 17px; } h3 { font-size: 15.5px; } h4 { font-size: 14.5px; }
  p { margin: 6px 0; }
  ul, ol { padding-left: 22px; }

  /*
   * Tame only extreme headline sizes from promotional spam — a 60px font
   * in a scaled-down email breaks vertical rhythm even after transform scale.
   * Anything below 40px is left alone so normal heading hierarchy is intact.
   */
  [style*="font-size: 60"], [style*="font-size:60"],
  [style*="font-size: 56"], [style*="font-size:56"],
  [style*="font-size: 52"], [style*="font-size:52"],
  [style*="font-size: 48"], [style*="font-size:48"] { font-size: 26px !important; line-height: 1.2 !important; }
  [style*="font-size: 44"], [style*="font-size:44"],
  [style*="font-size: 40"], [style*="font-size:40"] { font-size: 22px !important; line-height: 1.25 !important; }

  /* Selection highlight */
  ::selection { background: rgba(11,110,212,0.15); }

  /* Broken-image placeholder — shown when onerror fires */
  img.vs-broken {
    display: inline-block !important;
    width: auto !important; height: auto !important;
    min-width: 0 !important; min-height: 0 !important;
    content: none;
  }
  .vs-img-ph {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 4px;
    background: #eef2f7;
    color: #7d8590;
    font-size: 11px;
    font-family: sans-serif;
    vertical-align: middle;
  }
</style>
<script>
(function(){
  function handleImgError(img){
    if(img.__vsHandled) return;
    img.__vsHandled = true;
    img.classList.add('vs-broken');
    img.style.display='none';
    var ph = document.createElement('span');
    ph.className = 'vs-img-ph';
    ph.textContent = '[image]';
    if(img.parentNode) img.parentNode.insertBefore(ph, img.nextSibling);
  }
  document.addEventListener('DOMContentLoaded', function(){
    document.querySelectorAll('img').forEach(function(img){
      if(!img.complete || img.naturalWidth===0){
        img.addEventListener('error', function(){ handleImgError(img); }, {once:true});
      }
    });
    var obs = new MutationObserver(function(muts){
      muts.forEach(function(m){
        m.addedNodes.forEach(function(n){
          if(n.nodeName==='IMG') n.addEventListener('error', function(){ handleImgError(n); }, {once:true});
          if(n.querySelectorAll) n.querySelectorAll('img').forEach(function(img){
            img.addEventListener('error', function(){ handleImgError(img); }, {once:true});
          });
        });
      });
    });
    obs.observe(document.body, {childList:true, subtree:true});
  });
})();
</script>
</head>
<body>${sanitized}</body>
</html>`;

  const ModeBtn = ({ k, label, Icon }: { k: ReadingMode; label: string; Icon: any }) => (
    <button
      onClick={() => setMode(k)}
      data-testid={`reading-mode-${k}`}
      role="radio"
      aria-checked={mode === k}
      aria-label={`${label} reading mode`}
      className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-medium transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
        mode === k
          ? "bg-primary/15 text-primary shadow-[inset_0_0_0_1px_rgba(20,184,166,0.25)]"
          : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/40"
      }`}
      title={`${label} view`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );

  return (
    <div>
      <AnimatePresence mode="wait">
        {mode === "beautiful" && (
          <motion.div key="beautiful-wrap" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
            {/* Controls row — sits ABOVE the email body, never overlapping it */}
            {body && (
              <div className="flex items-center justify-end gap-1 mb-1.5 flex-wrap min-h-[28px]">
                {headerLeft && (
                  <div className="flex-shrink-0 mr-auto" data-testid="message-header-left">
                    {headerLeft}
                  </div>
                )}
                <div
                  className="flex items-center gap-0.5 rounded-md bg-muted/30 p-0.5 ring-1 ring-border/20"
                  data-testid="reader-zoom-toggle"
                  role="radiogroup"
                  aria-label="Reader zoom"
                >
                  <button
                    onClick={() => setZoom("fit")}
                    role="radio"
                    aria-checked={zoom === "fit"}
                    aria-label="Fit to pane"
                    data-testid="reader-zoom-fit"
                    className={`px-2 py-0.5 rounded text-[10.5px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                      zoom === "fit" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground/70 hover:text-foreground"
                    }`}
                    title={scaleApplied < 1 ? `Fit (${Math.round(scaleApplied * 100)}%)` : "Fit to pane"}
                  >
                    Fit{scaleApplied < 1 && zoom === "fit" ? ` ${Math.round(scaleApplied * 100)}%` : ""}
                  </button>
                  <button
                    onClick={() => setZoom("actual")}
                    role="radio"
                    aria-checked={zoom === "actual"}
                    aria-label="Actual size"
                    data-testid="reader-zoom-actual"
                    className={`px-2 py-0.5 rounded text-[10.5px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                      zoom === "actual" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground/70 hover:text-foreground"
                    }`}
                    title="Actual size (may scroll horizontally)"
                  >
                    100%
                  </button>
                </div>
                <div
                  className="flex items-center gap-0.5 rounded-md bg-muted/30 p-0.5 ring-1 ring-border/20"
                  data-testid="reading-mode-toggle"
                  role="radiogroup"
                  aria-label="Reading mode"
                >
                  <ModeBtn k="beautiful" label="Beautiful" Icon={Sparkles} />
                  <ModeBtn k="raw" label="Source" Icon={Code2} />
                  <ModeBtn k="plain" label="Plain" Icon={Type} />
                </div>
              </div>
            )}
            {/* RSVP intercept banner — shown after the user clicks a Google Calendar
                Yes/No/Maybe link inside the email body. Prevents opening a new tab
                and confirms the response was updated in-app. */}
            {calendarAttachmentId != null && (rsvpBannerStatus || rsvpBannerError) && (
              <div
                className={`mb-1.5 rounded-lg border px-3 py-2 text-[11.5px] flex items-center gap-1.5 ${
                  rsvpBannerStatus === "pending"
                    ? "border-primary/20 bg-primary/5 text-primary/80"
                    : rsvpBannerStatus && rsvpBannerStatus !== "pending"
                    ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
                    : "border-destructive/20 bg-destructive/5 text-destructive"
                }`}
                data-testid="rsvp-intercept-banner"
              >
                {rsvpBannerStatus === "pending" && "Updating calendar response\u2026"}
                {rsvpBannerStatus === "accepted" && "\u2713 Calendar: Accepted"}
                {rsvpBannerStatus === "declined" && "\u2715 Calendar: Declined"}
                {rsvpBannerStatus === "tentative" && "? Calendar: Tentative"}
                {(!rsvpBannerStatus || rsvpBannerStatus === "pending") && rsvpBannerError && rsvpBannerError}
              </div>
            )}
            <div
              ref={wrapperRef}
              className={`relative rounded-xl bg-white shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)] ring-1 ring-border/30 ${
                zoom === "fit" ? "overflow-hidden" : "overflow-x-auto"
              }`}
            >
              {!iframeReady && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-white">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/60" />
                </div>
              )}
              <iframe
                ref={iframeRef}
                srcDoc={srcDoc}
                sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                referrerPolicy="no-referrer"
                onLoad={handleIframeLoad}
                title="Email content"
                className={`w-full border-0 bg-white transition-opacity duration-300 ${iframeReady ? "opacity-100" : "opacity-0"}`}
                style={{ minHeight: 240 }}
                data-testid="iframe-email-body"
              />
            </div>
          </motion.div>
        )}

        {/* (The legacy `beautiful && !isHtml` <pre> branch was removed — plain
            text now flows through the iframe above via plainTextToEmailHtml,
            which auto-links URLs, styles quoted lines, and gives the same
            typographic treatment as any HTML email.) */}

        {mode === "raw" && (
          <motion.div
            key="raw"
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            <div className="flex justify-end gap-0.5 mb-1.5" data-testid="reading-mode-toggle" role="radiogroup" aria-label="Reading mode">
              <ModeBtn k="beautiful" label="Beautiful" Icon={Sparkles} />
              <ModeBtn k="raw" label="Source" Icon={Code2} />
              <ModeBtn k="plain" label="Plain" Icon={Type} />
            </div>
            <pre
              className="text-[11.5px] whitespace-pre-wrap font-mono text-foreground/85 leading-relaxed bg-muted/30 rounded-xl p-4 overflow-x-auto max-h-[600px] border border-border/40"
              data-testid="text-email-body-raw"
            >
              <code>{body}</code>
            </pre>
          </motion.div>
        )}

        {mode === "plain" && (
          <motion.div
            key="plain"
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            <div className="flex justify-end gap-0.5 mb-1.5" data-testid="reading-mode-toggle" role="radiogroup" aria-label="Reading mode">
              <ModeBtn k="beautiful" label="Beautiful" Icon={Sparkles} />
              <ModeBtn k="raw" label="Source" Icon={Code2} />
              <ModeBtn k="plain" label="Plain" Icon={Type} />
            </div>
            <pre
              className="text-[14.5px] whitespace-pre-wrap font-sans text-foreground/85 leading-[1.65]"
              data-testid="text-email-body-plain-mode"
            >
              {plainTextView}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

type ThreadRecord = {
  found: boolean;
  thread?: {
    id: number; workflowState: string | null; snoozedUntil: string | null;
    followUpAt: string | null; primaryContactId: number | null;
    primaryAccountId: number | null; primaryLeadId: number | null;
    primaryPartnerId: number | null; associationStatus: string;
    replyStatus: string | null;
    awaitingReplySince: string | null;
    lastInboundAt: string | null;
    lastOutboundAt: string | null;
    // Single-owner assignment column on email_threads (no schema change —
    // already present); surfaced here so the actions toolbar can read /
    // mutate it through PATCH /api/inbox/threads/:threadId/assign.
    assignedUserId: number | null;
  };
  contact?: { id: number; name: string; firstName: string; lastName: string; email: string; } | null;
  account?: { id: number; name: string; website: string; } | null;
  lead?: { id: number; name: string; firstName: string; lastName: string; company: string; status: string; } | null;
  sender?: { fromEmail: string | null; fromName: string | null; bulkEmailScore: number | null; autoGeneratedScore: number | null; } | null;
};

type AssocCandidate = {
  id: number;
  emailMessageId: number;
  objectType: "contact" | "account" | "lead" | "opportunity" | "partner";
  objectId: number;
  objectName: string | null;
  confidenceScore: number | null;
  isAuto: boolean | null;
  isUserConfirmed: boolean | null;
  reasons: string[];
  entityDetail: Record<string, any>;
};

type CrmSearchResult = {
  objectType: string;
  objectId: number;
  objectName: string;
  meta: string;
};

type ParticipantInfo = {
  email: string;
  name: string;
  domain: string;
  status: "contact" | "unknown";
  contactId: number | null;
  contactName: string | null;
  accountId: number | null;
  accountName: string | null;
};

const TYPE_CFG = {
  contact:     { label: "Contact",     Icon: User,       bg: "bg-sky-500/10",     text: "text-sky-400",     border: "border-sky-500/25",     href: "/contacts" },
  account:     { label: "Account",     Icon: Building2,  bg: "bg-violet-500/10",  text: "text-violet-400",  border: "border-violet-500/25",  href: "/accounts" },
  lead:        { label: "Lead",        Icon: Zap,        bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/25", href: "/leads" },
  opportunity: { label: "Opp",         Icon: TrendingUp, bg: "bg-amber-500/10",   text: "text-amber-400",   border: "border-amber-500/25",   href: "/opportunities" },
  partner:     { label: "Partner",     Icon: Handshake,  bg: "bg-fuchsia-500/10", text: "text-fuchsia-400", border: "border-fuchsia-500/25", href: "/partnerships" },
} as const;

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com",
  "live.com", "icloud.com", "protonmail.com", "me.com",
  "aol.com", "msn.com", "ymail.com", "googlemail.com",
]);

const ORG_TYPE_OPTIONS = [
  { value: "unclassified",          label: "Unclassified" },
  { value: "marina",                label: "Marina" },
  { value: "port_harbor",           label: "Port / Harbor" },
  { value: "shipyard",              label: "Shipyard" },
  { value: "boatyard",              label: "Boatyard" },
  { value: "yacht_club",            label: "Yacht Club" },
  { value: "marina_group",          label: "Marina Group / Ownership Group" },
  { value: "property_developer",    label: "Property Developer" },
  { value: "utility",               label: "Utility" },
  { value: "municipality",          label: "Municipality" },
  { value: "government_agency",     label: "Government Agency" },
  { value: "defense_military",      label: "Defense / Military" },
  { value: "oem",                   label: "OEM" },
  { value: "distributor",           label: "Distributor" },
  { value: "dealer_reseller",       label: "Dealer / Reseller" },
  { value: "installer",             label: "Installer / Electrical Contractor" },
  { value: "industry_association",  label: "Industry Association" },
  { value: "accelerator",           label: "Accelerator" },
  { value: "investor",              label: "Investor" },
  { value: "media",                 label: "Media" },
  { value: "engineering_firm",      label: "Engineering Firm" },
  { value: "consultant",            label: "Consultant" },
  { value: "insurance",             label: "Insurance" },
  { value: "standards_body",        label: "Standards Body" },
  { value: "university_research",   label: "University / Research" },
  { value: "supplier_manufacturer", label: "Supplier / Manufacturer" },
  { value: "partner",               label: "Partner" },
  { value: "prospect",              label: "Prospect" },
  { value: "customer",              label: "Customer" },
  { value: "vendor",                label: "Vendor" },
  { value: "other",                 label: "Other" },
] as const;

function inferOrgTypeFromEmail(email: string): string {
  const domain = (email.split("@")[1] ?? "").toLowerCase();
  if (domain.endsWith(".mil")) return "defense_military";
  if (domain.endsWith(".gov")) return "government_agency";
  if (/marina/.test(domain)) return "marina";
  if (/yacht/.test(domain)) return "yacht_club";
  if (/harbor|harbour/.test(domain)) return "port_harbor";
  if (/\bport/.test(domain)) return "port_harbor";
  if (/shipyard/.test(domain)) return "shipyard";
  if (/boatyard/.test(domain)) return "boatyard";
  return "unclassified";
}

function orgNameFromDomain(domain: string): string {
  const parts = domain.replace(/^www\./, "").split(".");
  const main = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  return main.charAt(0).toUpperCase() + main.slice(1);
}

const WORKFLOW_PILLS = [
  { value: "needs_reply",     label: "Needs Reply", activeClass: "bg-amber-500/15 text-amber-400 border-amber-500/40" },
  { value: "waiting_on_them", label: "Waiting",     activeClass: "bg-blue-500/15 text-blue-400 border-blue-500/40" },
  { value: "follow_up",       label: "Follow Up",   activeClass: "bg-orange-500/15 text-orange-400 border-orange-500/40" },
  { value: "done",            label: "Done",        activeClass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40" },
];

function ScoreBadge({ score }: { score: number | null }) {
  const s = score ?? 0;
  const color = s >= 75 ? "text-emerald-400 bg-emerald-500/10" : s >= 45 ? "text-amber-400 bg-amber-500/10" : "text-muted-foreground bg-muted/30";
  return (
    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${color}`}>{s}%</span>
  );
}

const RESTRICTED_LABELS: Record<string, string> = {
  contact:     "Linked Contact",
  account:     "Linked Account",
  lead:        "Linked Lead",
  opportunity: "Linked Lead",
  partner:     "Linked Partner",
};

function getDeepLinkUrl(objectType: string, objectId: number): string {
  switch (objectType) {
    case "account":     return `/accounts?selected=${objectId}`;
    case "lead":
    case "opportunity": return `/opportunities?selected=${objectId}`;
    case "contact":     return `/contacts?selected=${objectId}`;
    case "partner":     return `/strategy/partnerships?selected=${objectId}`;
    default:            return "#";
  }
}

type CrmPanelPerms = { crm?: string; partnerships?: string; [key: string]: unknown };

function CrmContextPanel({
  threadId,
  userPermissions,
  isAdminUser,
  returnPath,
  hintSenderEmail,
  hintSenderName,
  hintSubject,
}: {
  threadId: string;
  userPermissions?: CrmPanelPerms;
  isAdminUser?: boolean;
  returnPath?: string | null;
  hintSenderEmail?: string;
  hintSenderName?: string;
  hintSubject?: string;
}) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [contactCreated, setContactCreated] = useState(false);
  const [showManualLink, setShowManualLink] = useState(false);
  const [manualSearch, setManualSearch] = useState("");
  const [manualLinkPending, setManualLinkPending] = useState(false);
  const [showCandidates, setShowCandidates] = useState(true);
  const [showLowConf, setShowLowConf] = useState(false);
  const [replacingCandidateId, setReplacingCandidateId] = useState<number | null>(null);
  const [replaceSearch, setReplaceSearch] = useState("");

  // Create-contact-from-sender form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [cName, setCName] = useState("");
  const [cTitle, setCTitle] = useState("");
  const [cOrgMode, setCOrgMode] = useState<"existing" | "new">("existing");
  const [cOrgSearch, setCOrgSearch] = useState("");
  const [cSelectedAccount, setCSelectedAccount] = useState<{ id: number; name: string } | null>(null);
  const [cNewOrgName, setCNewOrgName] = useState("");
  const [cNewOrgType, setCNewOrgType] = useState("unclassified");

  const [showCreateLeadForm, setShowCreateLeadForm] = useState(false);
  const [lCompany, setLCompany] = useState("");
  const [lContactName, setLContactName] = useState("");

  const [showCreateAccountForm, setShowCreateAccountForm] = useState(false);
  const [aName, setAName] = useState("");

  const [showParticipants, setShowParticipants] = useState(true);
  const [participantDialogTarget, setParticipantDialogTarget] = useState<{ email: string; name: string } | null>(null);

  const [showQuickTask, setShowQuickTask] = useState(false);
  const [quickTaskTitle, setQuickTaskTitleLocal] = useState("");

  // Quote request popover state
  const [showQuotePopover, setShowQuotePopover] = useState(false);
  const [quoteTaskTitle, setQuoteTaskTitle] = useState("");
  const [quoteParticipants, setQuoteParticipants] = useState<Set<number>>(new Set());

  const [panelExpanded, setPanelExpanded] = useState(() => {
    try { return localStorage.getItem(lsKey("crm-panel-expanded")) === "true"; } catch { return false; }
  });
  const togglePanel = () => {
    const next = !panelExpanded;
    setPanelExpanded(next);
    try { localStorage.setItem(lsKey("crm-panel-expanded"), String(next)); } catch {}
  };

  const canViewCrm = isAdminUser || (userPermissions?.crm !== "none" && userPermissions?.crm != null);
  const canEditCrm = isAdminUser || userPermissions?.crm === "edit";
  const canViewPartnerships = isAdminUser || (userPermissions?.partnerships !== "none" && userPermissions?.partnerships != null);

  function hasAccessForType(objectType: string): boolean {
    if (objectType === "partner") return !!canViewPartnerships;
    return !!canViewCrm;
  }

  function openReplace(candidateId: number) {
    setReplacingCandidateId(candidateId);
    setReplaceSearch("");
  }

  function closeReplace() {
    setReplacingCandidateId(null);
    setReplaceSearch("");
  }

  const threadRecordQuery = useQuery<ThreadRecord>({
    queryKey: ["/api/gmail/thread-record", threadId],
    queryFn: async () => {
      const res = await fetch(`/api/gmail/thread-record/${threadId}`, { credentials: "include" });
      if (!res.ok) return { found: false };
      return res.json();
    },
    enabled: !!threadId,
  });

  const assocQuery = useQuery<{ candidates: AssocCandidate[] }>({
    queryKey: ["/api/gmail/thread-associations", threadId],
    queryFn: async () => {
      const res = await fetch(`/api/gmail/thread-associations/${threadId}`, { credentials: "include" });
      if (!res.ok) return { candidates: [] };
      return res.json();
    },
    enabled: !!threadId,
  });

  const participantsQuery = useQuery<ParticipantInfo[]>({
    queryKey: ["/api/gmail/thread-participants", threadId],
    queryFn: async () => {
      const res = await fetch(`/api/gmail/thread-participants/${encodeURIComponent(threadId)}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!threadId,
    staleTime: 30_000,
  });

  const searchQuery = useQuery<CrmSearchResult[]>({
    queryKey: ["/api/gmail/crm-search", manualSearch],
    queryFn: async () => {
      if (manualSearch.length < 2) return [];
      const res = await fetch(`/api/gmail/crm-search?q=${encodeURIComponent(manualSearch)}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: manualSearch.length >= 2,
  });

  const workflowMutation = useMutation({
    mutationFn: async (state: string | null) => {
      const replyStatusMap: Record<string, string> = {
        needs_reply:     "needs_reply",
        waiting_on_them: "waiting_on_them",
        done:            "done",
      };
      const body: Record<string, unknown> = { workflowState: state };
      if (state && replyStatusMap[state]) body.replyStatus = replyStatusMap[state];
      if (!state) body.replyStatus = "none";
      const res = await apiRequest("PATCH", `/api/gmail/thread-record/${threadId}`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-record", threadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/triage-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/triage-thread-ids"] });
    },
    onError: (err: any) => toast({ title: "Failed to update status", description: err.message, variant: "destructive" }),
  });

  const { data: orgUsers = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/users"],
    queryFn: () => fetch("/api/users", { credentials: "include" }).then(r => r.json()),
  });

  const quoteRequestMutation = useMutation({
    mutationFn: async ({ title, participantIds }: { title: string; participantIds: number[] }) => {
      const res = await apiRequest("POST", "/api/inbox/quote-request", {
        threadId,
        title,
        participantIds,
        linkedObjectType: topLinkedRecord?.objectType,
        linkedObjectId: topLinkedRecord?.objectId,
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-record", threadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/triage-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/triage-thread-ids"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/thread-tasks", threadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/board"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/hub"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      setShowQuotePopover(false);
      const added = data?.participantsAdded ?? 0;
      toast({
        title: "Quote task created",
        description: added > 0 ? `Task created & shared with ${added} teammate${added === 1 ? "" : "s"}.` : "Task assigned to you — open it to add teammates.",
      });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const confirmMutation = useMutation({
    mutationFn: async (associationId: number) => {
      const res = await apiRequest("POST", "/api/gmail/thread-associations/confirm", { associationId, threadId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-associations", threadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-record", threadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/review-queue/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
      toast({ title: "Association confirmed" });
    },
    onError: (err: any) => toast({ title: "Failed to confirm", description: err.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (associationId: number) => {
      const res = await apiRequest("POST", "/api/gmail/thread-associations/reject", { associationId, threadId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-associations", threadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-record", threadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/review-queue/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/review-queue"] });
      toast({ title: "Association removed" });
    },
    onError: (err: any) => toast({ title: "Failed to remove", description: err.message, variant: "destructive" }),
  });

  const replaceSearchQuery = useQuery<CrmSearchResult[]>({
    queryKey: ["/api/gmail/crm-search/replace", replaceSearch],
    queryFn: async () => {
      if (replaceSearch.length < 2) return [];
      const res = await fetch(`/api/gmail/crm-search?q=${encodeURIComponent(replaceSearch)}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: replaceSearch.length >= 2 && replacingCandidateId !== null,
  });

  const replaceMutation = useMutation({
    mutationFn: async (payload: {
      oldAssociationId: number;
      objectType: string;
      objectId: number;
      objectName: string;
    }) => {
      const res = await apiRequest("POST", "/api/gmail/thread-associations/replace", {
        ...payload,
        threadId,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Unknown error" }));
        throw new Error(body.message || `Error ${res.status}`);
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-associations", threadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-record", threadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/review-queue/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/review-queue"] });
      closeReplace();
      toast({ title: `Reassociated to ${variables.objectName}` });
    },
    onError: (err: any) => toast({ title: "Failed to replace association", description: err.message, variant: "destructive" }),
  });

  // Org search for the create-contact form (accounts only).
  // When the search box is empty, the backend returns the top 20 accounts
  // alphabetically so the user has something to BROWSE without typing.
  // When the user types, it becomes a substring search.
  const orgSearchQuery = useQuery<CrmSearchResult[]>({
    queryKey: ["/api/gmail/crm-search/org", cOrgSearch],
    queryFn: async () => {
      const res = await fetch(`/api/gmail/crm-search?q=${encodeURIComponent(cOrgSearch)}&types=account`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: cOrgMode === "existing",
  });

  // Refresh association engine for this thread
  const refreshAssocMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/gmail/thread-associations/${threadId}/refresh`, {});
      if (!res.ok) throw new Error("Refresh failed");
      return res.json();
    },
  });

  // Create contact from sender
  const createContactMutation = useMutation({
    mutationFn: async (payload: {
      fromEmail: string; name: string; title?: string;
      orgMode: "existing" | "new"; accountId?: number;
      orgName?: string; orgType?: string;
    }) => {
      const res = await apiRequest("POST", "/api/gmail/sender/create-contact", payload);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).message || `Error ${res.status}`);
      }
      return res.json();
    },
    onSuccess: async (result: any) => {
      setShowCreateForm(false);
      const contactName = result?.contact?.name ?? cName;
      toast({ title: `Contact created: ${contactName}` });
      if (returnPath) setContactCreated(true);
      try { await refreshAssocMutation.mutateAsync(); } catch {}
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-associations", threadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-record", threadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/review-queue/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/review-queue"] });
    },
    onError: (err: any) => {
      const msg = err.message || "Unknown error";
      if (msg.includes("DOMAIN_CONFLICT")) {
        toast({ title: "Account already exists", description: msg, variant: "destructive" });
      } else if (msg.includes("CONTACT_EXISTS")) {
        toast({ title: "Contact already exists", description: msg, variant: "destructive" });
      } else {
        toast({ title: "Failed to create contact", description: msg, variant: "destructive" });
      }
    },
  });

  // Create lead from sender
  const createLeadMutation = useMutation({
    mutationFn: async (payload: { fromEmail: string; company: string; contactName?: string }) => {
      const res = await apiRequest("POST", "/api/gmail/sender/create-lead", payload);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).message || `Error ${res.status}`);
      }
      return res.json();
    },
    onSuccess: async (result: any) => {
      setShowCreateLeadForm(false);
      toast({ title: `Lead created: ${result?.lead?.company ?? lCompany}` });
      try { await refreshAssocMutation.mutateAsync(); } catch {}
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-associations", threadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-record", threadId] });
    },
    onError: (err: any) => {
      const msg = err.message || "Unknown error";
      if (msg.includes("LEAD_EXISTS")) {
        toast({ title: "Lead already exists for this email", variant: "destructive" });
      } else {
        toast({ title: "Failed to create lead", description: msg, variant: "destructive" });
      }
    },
  });

  // Create account (org stub) from sender domain
  const createAccountMutation = useMutation({
    mutationFn: async (payload: { fromEmail: string; name: string; orgType?: string }) => {
      const res = await apiRequest("POST", "/api/gmail/sender/create-account", payload);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).message || `Error ${res.status}`);
      }
      return res.json();
    },
    onSuccess: async (result: any) => {
      setShowCreateAccountForm(false);
      toast({ title: `Account created: ${result?.account?.name ?? aName}` });
      try { await refreshAssocMutation.mutateAsync(); } catch {}
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-associations", threadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-record", threadId] });
    },
    onError: (err: any) => {
      const msg = err.message || "Unknown error";
      if (msg.includes("DOMAIN_CONFLICT")) {
        toast({ title: "Account for this domain already exists", description: msg, variant: "destructive" });
      } else {
        toast({ title: "Failed to create organization", description: msg, variant: "destructive" });
      }
    },
  });

  function openCreateForm() {
    const s = threadRecordQuery.data?.sender;
    const effectiveEmail = s?.fromEmail || hintSenderEmail || "";
    const effectiveName  = s?.fromName?.trim() || hintSenderName || "";
    const domain = effectiveEmail.split("@")[1]?.toLowerCase() ?? "";
    setCName(effectiveName);
    setCTitle("");
    // Default to "Link existing" so the user immediately sees the
    // browse-and-search dropdown of organizations already in the DB.
    // They can still toggle to "Create new" if no match exists.
    setCOrgMode("existing");
    setCOrgSearch("");
    setCSelectedAccount(null);
    setCNewOrgName(domain ? orgNameFromDomain(domain) : "");
    setCNewOrgType(effectiveEmail ? inferOrgTypeFromEmail(effectiveEmail) : "unclassified");
    setShowCreateForm(true);
    setShowManualLink(false);
  }

  function handleCreateSubmit() {
    const s = threadRecordQuery.data?.sender;
    const effectiveEmail = s?.fromEmail || hintSenderEmail || "";
    if (!effectiveEmail) return;
    const payload: Parameters<typeof createContactMutation.mutate>[0] = {
      fromEmail: effectiveEmail,
      name: cName.trim(),
      title: cTitle.trim() || undefined,
      orgMode: cOrgMode,
    };
    if (cOrgMode === "existing") {
      if (!cSelectedAccount) { toast({ title: "Please select an organization", variant: "destructive" }); return; }
      payload.accountId = cSelectedAccount.id;
    } else {
      if (!cNewOrgName.trim()) { toast({ title: "Account name is required", variant: "destructive" }); return; }
      payload.orgName = cNewOrgName.trim();
      payload.orgType = cNewOrgType || "unclassified";
    }
    createContactMutation.mutate(payload);
  }

  async function handleManualLink(result: CrmSearchResult) {
    setManualLinkPending(true);
    try {
      const res = await apiRequest("POST", "/api/gmail/thread-associations/manual", {
        threadId,
        objectType: result.objectType,
        objectId: result.objectId,
        objectName: result.objectName,
      });
      if (!res.ok) throw new Error("Failed");
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-associations", threadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-record", threadId] });
      setShowManualLink(false);
      setManualSearch("");
      toast({ title: `Linked to ${result.objectName}` });
    } catch (err: any) {
      toast({ title: "Failed to link", description: err.message, variant: "destructive" });
    } finally {
      setManualLinkPending(false);
    }
  }

  const data = threadRecordQuery.data;
  const thread = data?.thread;
  const workflowState = thread?.workflowState ?? "none";
  const candidates = assocQuery.data?.candidates ?? [];
  const confirmedCandidates = candidates.filter(c => c.isUserConfirmed);
  const unconfirmedCandidates = candidates.filter(c => !c.isUserConfirmed);
  const CONF_THRESHOLD = 50;
  const highConfCandidates = unconfirmedCandidates.filter(c => (c.confidenceScore ?? 0) >= CONF_THRESHOLD);
  const lowConfCandidates = unconfirmedCandidates.filter(c => (c.confidenceScore ?? 0) < CONF_THRESHOLD);
  const hasAnyCandidates = candidates.length > 0;

  // Sender eligibility for the "Create Contact" CTA
  // Fall back to hint props (from Gmail thread header) when DB has no record for this thread
  const dbSender = data?.sender;
  const sender = dbSender ?? (hintSenderEmail ? {
    fromEmail: hintSenderEmail,
    fromName: hintSenderName ?? null,
    bulkEmailScore: null,
    autoGeneratedScore: null,
  } : null);
  const senderDomain = sender?.fromEmail?.split("@")[1]?.toLowerCase() ?? "";
  const senderEligible = !!(
    canEditCrm &&
    !assocQuery.isLoading &&
    candidates.length === 0 &&
    sender?.fromEmail &&
    !sender.fromEmail.toLowerCase().endsWith("@voltsafe.com") &&
    !PERSONAL_EMAIL_DOMAINS.has(senderDomain) &&
    (sender.bulkEmailScore ?? 0) < 40 &&
    (sender.autoGeneratedScore ?? 0) < 40
  );

  const topLinkedRecord = confirmedCandidates[0] ?? null;

  const quickCreateTaskMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/inbox/create-task-from-thread", {
        threadId,
        subject: data?.thread ? undefined : undefined,
        fromEmail: sender?.fromEmail,
        fromName: sender?.fromName,
        title: quickTaskTitle.trim() || undefined,
        linkedObjectType: topLinkedRecord?.objectType,
        linkedObjectId: topLinkedRecord?.objectId,
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      setShowQuickTask(false);
      setQuickTaskTitleLocal("");
      toast({ title: "Task created" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const quickCreateNoteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/inbox/create-note-from-thread", {
        threadId,
        fromEmail: sender?.fromEmail,
        fromName: sender?.fromName,
        linkedObjectType: topLinkedRecord?.objectType,
        linkedObjectId: topLinkedRecord?.objectId,
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => toast({ title: "Note added" }),
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const threadTasksQuery = useQuery<Array<{ id: number; title: string; dueDate: string | null; status: string; linkedObjectType: string | null; linkedObjectId: number | null }>>({
    queryKey: ["/api/inbox/thread-tasks", threadId],
    queryFn: async () => {
      const res = await fetch(`/api/inbox/thread-tasks/${encodeURIComponent(threadId)}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!threadId,
    staleTime: 30000,
  });
  const threadTasks = threadTasksQuery.data ?? [];

  return (
    <div className="flex-shrink-0 border-t border-border/30 bg-background/60" data-testid="crm-context-panel">
      {/* Return-path breadcrumb — only when navigated from Relationships dashboard */}
      {returnPath && (
        <div className="px-4 pt-2 pb-0 flex items-center gap-1.5">
          <button
            onClick={() => setLocation(returnPath)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-primary transition-colors"
            data-testid="btn-back-to-relationships"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to Relationship Intelligence
          </button>
        </div>
      )}
      {/* CRM panel — single compact toggle; all actions live inside the expandable section */}
      <div className="px-4 pt-2 pb-1.5 flex items-center gap-2">
        <button
          onClick={togglePanel}
          data-testid="crm-panel-toggle"
          title={panelExpanded ? "Collapse CRM panel" : "Expand CRM panel"}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60 hover:text-muted-foreground border border-border/30 hover:border-border/60 px-2.5 py-1 rounded-md transition-all"
        >
          <Tag className="h-3 w-3" />
          <span className="font-medium">CRM</span>
          {workflowState && workflowState !== "none" && (() => {
            const pill = WORKFLOW_PILLS.find(p => p.value === workflowState);
            const label = pill?.label ?? (workflowState === "quote_requested" ? "Quote Requested" : null);
            if (!label) return null;
            return (
              <span className={`text-[10px] px-1.5 py-px rounded-full border font-medium ${pill?.activeClass ?? "text-violet-400 bg-violet-500/15 border-violet-500/40"}`}>
                {label}
              </span>
            );
          })()}
          {workflowMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
          {panelExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        </button>
      </div>

      {panelExpanded && (
      <>
      {/* Workflow status pills + quick actions — inside the expandable CRM section */}
      <div className="px-4 pb-1.5 flex items-center gap-1.5 flex-wrap">
        {WORKFLOW_PILLS.map(pill => {
          const isActive = workflowState === pill.value;
          return (
            <button
              key={pill.value}
              onClick={() => workflowMutation.mutate(isActive ? null : pill.value)}
              disabled={workflowMutation.isPending}
              data-testid={`workflow-pill-${pill.value}`}
              className={`text-[11px] px-2.5 py-[3px] rounded-full border font-medium transition-all select-none ${
                isActive
                  ? pill.activeClass
                  : "text-muted-foreground/50 border-border/30 hover:border-border/60 hover:text-muted-foreground"
              }`}
            >
              {pill.label}
            </button>
          );
        })}
        {workflowMutation.isPending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/50" />}
        {/* Quote Requested — dedicated action with popover */}
        <Popover open={showQuotePopover} onOpenChange={(open) => {
          if (open) {
            const marinaName = topLinkedRecord?.objectName?.trim();
            const defaultTitle = marinaName
              ? `Prepare quote: ${marinaName}`
              : hintSubject
                ? `Prepare quote: ${hintSubject}`
                : "Prepare quote";
            setQuoteTaskTitle(defaultTitle);
            setQuoteParticipants(new Set());
          }
          setShowQuotePopover(open);
        }}>
          <PopoverTrigger asChild>
            <button
              data-testid="btn-quote-requested"
              className={`text-[11px] px-2.5 py-[3px] rounded-full border font-medium transition-all select-none ${
                workflowState === "quote_requested"
                  ? "text-violet-400 bg-violet-500/15 border-violet-500/40"
                  : "text-muted-foreground/50 border-border/30 hover:border-violet-500/40 hover:text-violet-400"
              }`}
            >
              {workflowState === "quote_requested" ? "✓ Quote Requested" : "Quote Requested"}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-4" side="bottom" align="start">
            <div className="space-y-3">
              <div>
                <p className="text-[13px] font-semibold text-foreground mb-0.5">Create quote task</p>
                <p className="text-[11px] text-muted-foreground">Tags this email and creates an actionable task.</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground">Task title</label>
                <Input
                  data-testid="input-quote-task-title"
                  value={quoteTaskTitle}
                  onChange={e => setQuoteTaskTitle(e.target.value)}
                  className="h-8 text-[12px]"
                  placeholder="Prepare quote: …"
                />
              </div>
              {orgUsers.filter(u => !u.name?.includes("trevor")).length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-muted-foreground">Share with teammates</label>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {orgUsers.map(u => (
                      <label key={u.id} className="flex items-center gap-2 cursor-pointer py-0.5">
                        <input
                          type="checkbox"
                          data-testid={`checkbox-quote-participant-${u.id}`}
                          checked={quoteParticipants.has(u.id)}
                          onChange={e => {
                            const next = new Set(quoteParticipants);
                            if (e.target.checked) next.add(u.id); else next.delete(u.id);
                            setQuoteParticipants(next);
                          }}
                          className="rounded border-border accent-violet-500"
                        />
                        <span className="text-[12px] text-foreground">{u.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <Button
                data-testid="btn-quote-confirm"
                size="sm"
                className="w-full bg-violet-600 hover:bg-violet-700 text-white text-[12px] h-8"
                disabled={!quoteTaskTitle.trim() || quoteRequestMutation.isPending}
                onClick={() => quoteRequestMutation.mutate({
                  title: quoteTaskTitle,
                  participantIds: Array.from(quoteParticipants),
                })}
              >
                {quoteRequestMutation.isPending ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Creating…</> : "Create Quote Task"}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {/* Awaiting reply indicator — with inline resolution actions */}
      {thread?.awaitingReplySince && (
        <div className="px-4 pb-1.5">
          <div className="flex items-center gap-2 bg-amber-500/8 border border-amber-500/20 rounded-md px-2.5 py-1.5" data-testid="awaiting-reply-badge">
            <Clock className="h-3 w-3 flex-shrink-0 text-amber-400/80" />
            <span className="text-[11px] text-amber-400/80 flex-1 min-w-0">
              Awaiting reply since {new Date(thread.awaitingReplySince).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
            <button
              type="button"
              data-testid="button-mark-replied"
              disabled={workflowMutation.isPending}
              onClick={() => workflowMutation.mutate("done")}
              className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              <CheckCheck className="h-2.5 w-2.5" />
              Replied
            </button>
            <button
              type="button"
              data-testid="button-no-reply-needed"
              disabled={workflowMutation.isPending}
              onClick={() => workflowMutation.mutate("waiting_on_them")}
              className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30 hover:bg-blue-500/25 transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              <X className="h-2.5 w-2.5" />
              No Reply Needed
            </button>
          </div>
        </div>
      )}

      {/* Open tasks linked to this thread's CRM records */}
      {threadTasks.length > 0 && (
        <div className="px-4 pb-2" data-testid="thread-tasks-section">
          <div className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider mb-1">Open Tasks</div>
          <div className="space-y-1">
            {threadTasks.slice(0, 5).map(task => (
              <div key={task.id} className="flex items-start gap-1.5 px-2 py-1.5 rounded-md bg-muted/20 border border-border/20" data-testid={`thread-task-${task.id}`}>
                <CheckCheck className="h-3 w-3 mt-0.5 flex-shrink-0 text-muted-foreground/40" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-foreground/80 leading-snug truncate">{task.title}</p>
                  {task.dueDate && (
                    <p className="text-[10px] text-muted-foreground/50">
                      Due {new Date(task.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </p>
                  )}
                </div>
                {task.linkedObjectType && (
                  <span className="text-[9px] text-muted-foreground/35 capitalize flex-shrink-0">{task.linkedObjectType}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick actions — Create Task / Add Note */}
      {canEditCrm && (
        <div className="px-4 pb-2">
          {showQuickTask ? (
            <div className="flex gap-1" data-testid="quick-task-form">
              <input
                autoFocus
                value={quickTaskTitle}
                onChange={e => setQuickTaskTitleLocal(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") { e.preventDefault(); quickCreateTaskMutation.mutate(); }
                  if (e.key === "Escape") { setShowQuickTask(false); setQuickTaskTitleLocal(""); }
                }}
                placeholder="Task title (Enter to save)"
                data-testid="input-quick-task-title"
                className="flex-1 px-2 py-1 text-[11px] bg-muted/20 border border-border/30 rounded focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground/40"
              />
              <button
                onClick={() => quickCreateTaskMutation.mutate()}
                disabled={quickCreateTaskMutation.isPending}
                data-testid="button-quick-task-save"
                className="px-2 py-1 text-[11px] rounded bg-primary/15 text-primary hover:bg-primary/25 transition-colors disabled:opacity-50"
              >
                {quickCreateTaskMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
              </button>
              <button
                onClick={() => { setShowQuickTask(false); setQuickTaskTitleLocal(""); }}
                className="px-1.5 py-1 rounded text-muted-foreground/50 hover:text-foreground transition-colors"
                data-testid="button-quick-task-cancel"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <div className="flex gap-1.5">
              <button
                onClick={() => setShowQuickTask(true)}
                data-testid="button-create-task-from-email"
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-border/30 text-muted-foreground/60 hover:text-foreground hover:border-border/60 transition-all"
              >
                <ClipboardList className="h-3 w-3" />
                Task
              </button>
              <button
                onClick={() => quickCreateNoteMutation.mutate()}
                disabled={quickCreateNoteMutation.isPending || !topLinkedRecord}
                data-testid="button-add-note-from-email"
                title={!topLinkedRecord ? "Link this thread to a CRM record first" : "Add note linked to CRM record"}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-border/30 text-muted-foreground/60 hover:text-foreground hover:border-border/60 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {quickCreateNoteMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <StickyNote className="h-3 w-3" />}
                Note
              </button>
            </div>
          )}
        </div>
      )}

      {/* Post-creation return banner — only when contact was just created from Relationships flow */}
      {contactCreated && returnPath && (
        <div className="mx-4 mb-2 flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-primary/10 border border-primary/20">
          <div className="flex items-center gap-1.5 text-[11px] text-primary/80">
            <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
            <span>Contact added to CRM.</span>
          </div>
          <button
            onClick={() => setLocation(returnPath)}
            className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline whitespace-nowrap"
            data-testid="btn-return-to-relationships"
          >
            Return to Relationships
            <ArrowLeft className="h-3 w-3 rotate-180" />
          </button>
        </div>
      )}

      {/* Engagement Intelligence — opens, clicks, demo signals for this thread */}
      <div className="px-4 pb-2" data-testid="thread-engagement-section">
        <ThreadEngagementWidget threadId={threadId} />
      </div>

      {/* People on this thread — participant training panel */}
      {canEditCrm && (participantsQuery.data?.length ?? 0) > 0 && (
        <div className="px-4 pb-2">
          <button
            onClick={() => setShowParticipants(v => !v)}
            data-testid="participants-toggle"
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70 hover:text-muted-foreground transition-colors mb-1.5 w-full"
          >
            <Users className="h-3 w-3" />
            <span className="font-medium">People</span>
            <span className="ml-0.5 text-[10px] bg-muted/40 px-1.5 py-0 rounded-full">
              {participantsQuery.data?.length}
            </span>
            {showParticipants ? <ChevronDown className="h-2.5 w-2.5 ml-0.5" /> : <ChevronRight className="h-2.5 w-2.5 ml-0.5" />}
          </button>

          {showParticipants && (
            <div className="space-y-1.5" data-testid="participants-list">
              {participantsQuery.data?.map(p => (
                <div key={p.email} className="flex items-start gap-1.5 min-w-0">
                  {p.status === "contact" ? (
                    <>
                      <CheckCircle2 className="h-3 w-3 text-emerald-400/80 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <span className="text-[11px] text-foreground/80 truncate block leading-tight">{p.contactName}</span>
                        {p.accountName && (
                          <span className="text-[10px] text-muted-foreground/50 truncate block">{p.accountName}</span>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <User className="h-3 w-3 text-muted-foreground/35 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        {p.name && (
                          <span className="text-[11px] text-foreground/70 truncate block leading-tight">{p.name}</span>
                        )}
                        <span className={`truncate block text-muted-foreground/50 ${p.name ? "text-[10px]" : "text-[11px] text-foreground/60"}`}>
                          {p.email}
                        </span>
                      </div>
                      <button
                        onClick={() => setParticipantDialogTarget({ email: p.email, name: p.name })}
                        data-testid={`add-contact-participant-${p.email.replace(/@|\./g, "-")}`}
                        className="flex-shrink-0 flex items-center gap-0.5 text-[10px] text-sky-400/70 hover:text-sky-400 border border-sky-500/20 hover:border-sky-500/50 px-1.5 py-[2px] rounded transition-all"
                      >
                        <UserPlus className="h-2.5 w-2.5" />
                        Add
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CRM Association Review Panel */}
      <div className="px-4 pb-3">
        {/* Section header */}
        <div className="flex items-center justify-between mb-1.5">
          <button
            onClick={() => setShowCandidates(v => !v)}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70 hover:text-muted-foreground transition-colors"
            data-testid="crm-assoc-toggle"
          >
            <Tag className="h-3 w-3" />
            <span className="font-medium">CRM Links</span>
            {hasAnyCandidates && (
              <span className="ml-0.5 text-[10px] bg-muted/40 px-1.5 py-0 rounded-full">{candidates.length}</span>
            )}
            {showCandidates ? <ChevronDown className="h-2.5 w-2.5 ml-0.5" /> : <ChevronRight className="h-2.5 w-2.5 ml-0.5" />}
          </button>
          <button
            onClick={() => { setShowManualLink(v => !v); setManualSearch(""); }}
            data-testid="crm-manual-link-btn"
            className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground border border-border/30 hover:border-border/60 px-2 py-[2px] rounded transition-all"
          >
            <Plus className="h-2.5 w-2.5" />
            Link
          </button>
        </div>

        {/* Manual link search */}
        {showManualLink && (
          <div className="mb-2 space-y-1" data-testid="manual-link-search">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
              <input
                autoFocus
                value={manualSearch}
                onChange={e => setManualSearch(e.target.value)}
                placeholder="Search contacts, accounts, leads…"
                data-testid="manual-link-input"
                className="w-full pl-7 pr-2 py-1 text-[11px] bg-muted/20 border border-border/30 rounded focus:outline-none focus:border-border/70 placeholder:text-muted-foreground/40"
              />
            </div>
            {manualSearch.length >= 2 && (
              <div className="max-h-32 overflow-y-auto space-y-0.5 border border-border/20 rounded bg-background/80">
                {searchQuery.isLoading && (
                  <div className="flex items-center justify-center py-2">
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/50" />
                  </div>
                )}
                {!searchQuery.isLoading && (searchQuery.data?.length ?? 0) === 0 && (
                  <p className="text-[10px] text-muted-foreground/40 text-center py-2">No matches</p>
                )}
                {(searchQuery.data ?? []).map(r => {
                  const cfg = TYPE_CFG[r.objectType as keyof typeof TYPE_CFG];
                  if (!cfg) return null;
                  const { Icon } = cfg;
                  return (
                    <button
                      key={`${r.objectType}:${r.objectId}`}
                      onClick={() => handleManualLink(r)}
                      disabled={manualLinkPending}
                      data-testid={`manual-link-result-${r.objectId}`}
                      className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-muted/30 transition-colors text-left"
                    >
                      <span className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
                        <Icon className="h-2.5 w-2.5" />
                        {cfg.label}
                      </span>
                      <span className="text-[11px] text-foreground flex-1 truncate">{r.objectName}</span>
                      {r.meta && <span className="text-[10px] text-muted-foreground/50 truncate max-w-[80px]">{r.meta}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Association candidates list */}
        {showCandidates && (
          <div className="space-y-0.5" data-testid="crm-candidates-list">
            {assocQuery.isLoading && (
              <div className="space-y-1">
                <Skeleton className="h-5 w-full rounded" />
                <Skeleton className="h-5 w-4/5 rounded" />
              </div>
            )}

            {!assocQuery.isLoading && candidates.length === 0 && !showCreateForm && !showCreateLeadForm && !showCreateAccountForm && (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/35 italic py-0.5">
                  <AlertCircle className="h-3 w-3 flex-shrink-0" />
                  No CRM matches found — sync or link manually
                </div>
                {senderEligible && (
                  <div className="flex flex-wrap gap-1">
                    <button
                      onClick={openCreateForm}
                      data-testid="create-contact-from-sender-btn"
                      className="flex items-center gap-1 text-[10px] text-sky-400/70 hover:text-sky-400 border border-sky-500/20 hover:border-sky-500/50 px-2 py-[2px] rounded transition-all"
                    >
                      <Plus className="h-2.5 w-2.5" />
                      Contact
                    </button>
                    <button
                      onClick={() => {
                        const s = threadRecordQuery.data?.sender;
                        const email = s?.fromEmail || hintSenderEmail || "";
                        const name = s?.fromName?.trim() || hintSenderName || "";
                        const domain = email.split("@")[1]?.toLowerCase() ?? "";
                        setLContactName(name);
                        setLCompany(domain ? orgNameFromDomain(domain) : "");
                        setShowCreateLeadForm(true);
                        setShowManualLink(false);
                      }}
                      data-testid="create-lead-from-sender-btn"
                      className="flex items-center gap-1 text-[10px] text-amber-400/70 hover:text-amber-400 border border-amber-500/20 hover:border-amber-500/50 px-2 py-[2px] rounded transition-all"
                    >
                      <Plus className="h-2.5 w-2.5" />
                      Lead
                    </button>
                    <button
                      onClick={() => {
                        const s = threadRecordQuery.data?.sender;
                        const email = s?.fromEmail || hintSenderEmail || "";
                        const domain = email.split("@")[1]?.toLowerCase() ?? "";
                        setAName(domain ? orgNameFromDomain(domain) : "");
                        setShowCreateAccountForm(true);
                        setShowManualLink(false);
                      }}
                      data-testid="create-account-from-domain-btn"
                      className="flex items-center gap-1 text-[10px] text-violet-400/70 hover:text-violet-400 border border-violet-500/20 hover:border-violet-500/50 px-2 py-[2px] rounded transition-all"
                    >
                      <Plus className="h-2.5 w-2.5" />
                      Account
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Inline create-lead form */}
            {showCreateLeadForm && (() => {
              const senderEmail = threadRecordQuery.data?.sender?.fromEmail ?? hintSenderEmail ?? "";
              const isPending = createLeadMutation.isPending;
              return (
                <div className="border border-amber-500/20 rounded bg-amber-500/5 p-2.5 space-y-2 text-[11px]" data-testid="create-lead-form">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-amber-400/80">New Lead</span>
                    <button onClick={() => setShowCreateLeadForm(false)} className="text-muted-foreground/40 hover:text-muted-foreground"><X className="h-3 w-3" /></button>
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-[10px] text-muted-foreground/60 font-medium">Email</label>
                    <div className="px-2 py-1 text-[11px] bg-muted/10 border border-border/20 rounded text-muted-foreground/60 truncate">{senderEmail}</div>
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-[10px] text-muted-foreground/60 font-medium">Company *</label>
                    <input
                      value={lCompany}
                      onChange={e => setLCompany(e.target.value)}
                      placeholder="e.g. Harbour Marine Group"
                      data-testid="create-lead-company-input"
                      className="w-full px-2 py-1 text-[11px] bg-muted/20 border border-border/30 rounded focus:outline-none focus:border-border/70 placeholder:text-muted-foreground/40"
                      disabled={isPending}
                    />
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-[10px] text-muted-foreground/60 font-medium">Contact name <span className="text-muted-foreground/40 font-normal">(optional)</span></label>
                    <input
                      value={lContactName}
                      onChange={e => setLContactName(e.target.value)}
                      placeholder="Full name"
                      data-testid="create-lead-name-input"
                      className="w-full px-2 py-1 text-[11px] bg-muted/20 border border-border/30 rounded focus:outline-none focus:border-border/70 placeholder:text-muted-foreground/40"
                      disabled={isPending}
                    />
                  </div>
                  <div className="flex gap-1.5 pt-0.5">
                    <button
                      onClick={() => createLeadMutation.mutate({ fromEmail: senderEmail, company: lCompany.trim(), contactName: lContactName.trim() || undefined })}
                      disabled={isPending || !lCompany.trim()}
                      data-testid="create-lead-submit-btn"
                      className="flex-1 py-1 text-[10px] font-medium rounded bg-amber-500/80 hover:bg-amber-500 text-black disabled:opacity-40 transition-colors"
                    >
                      {isPending ? "Creating…" : "Create Lead"}
                    </button>
                    <button onClick={() => setShowCreateLeadForm(false)} disabled={isPending} className="px-2 py-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground border border-border/30 rounded">Cancel</button>
                  </div>
                </div>
              );
            })()}

            {/* Inline create-account form */}
            {showCreateAccountForm && (() => {
              const senderEmail = threadRecordQuery.data?.sender?.fromEmail ?? hintSenderEmail ?? "";
              const domain = senderEmail.split("@")[1]?.toLowerCase() ?? "";
              const isPending = createAccountMutation.isPending;
              return (
                <div className="border border-violet-500/20 rounded bg-violet-500/5 p-2.5 space-y-2 text-[11px]" data-testid="create-account-form">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-violet-400/80">New Account</span>
                    <button onClick={() => setShowCreateAccountForm(false)} className="text-muted-foreground/40 hover:text-muted-foreground"><X className="h-3 w-3" /></button>
                  </div>
                  {domain && (
                    <div className="text-[10px] text-muted-foreground/50">Domain: <span className="text-muted-foreground/70">{domain}</span></div>
                  )}
                  <div className="space-y-0.5">
                    <label className="text-[10px] text-muted-foreground/60 font-medium">Account name *</label>
                    <input
                      value={aName}
                      onChange={e => setAName(e.target.value)}
                      placeholder="e.g. Harbour Marine Group"
                      data-testid="create-account-name-input"
                      className="w-full px-2 py-1 text-[11px] bg-muted/20 border border-border/30 rounded focus:outline-none focus:border-border/70 placeholder:text-muted-foreground/40"
                      disabled={isPending}
                    />
                  </div>
                  <div className="flex gap-1.5 pt-0.5">
                    <button
                      onClick={() => createAccountMutation.mutate({ fromEmail: senderEmail, name: aName.trim() })}
                      disabled={isPending || !aName.trim()}
                      data-testid="create-account-submit-btn"
                      className="flex-1 py-1 text-[10px] font-medium rounded bg-violet-500/80 hover:bg-violet-500 text-white disabled:opacity-40 transition-colors"
                    >
                      {isPending ? "Creating…" : "Create Account"}
                    </button>
                    <button onClick={() => setShowCreateAccountForm(false)} disabled={isPending} className="px-2 py-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground border border-border/30 rounded">Cancel</button>
                  </div>
                </div>
              );
            })()}

            {/* Inline create-contact form */}
            {showCreateForm && (() => {
              const senderEmail = threadRecordQuery.data?.sender?.fromEmail ?? "";
              const isPending = createContactMutation.isPending;
              return (
                <div className="border border-border/40 rounded bg-muted/10 p-2.5 space-y-2 text-[11px]" data-testid="create-contact-form">
                  {/* Contact name */}
                  <div className="space-y-0.5">
                    <label className="text-[10px] text-muted-foreground/60 font-medium">Name *</label>
                    <input
                      value={cName}
                      onChange={e => setCName(e.target.value)}
                      placeholder="Full name"
                      data-testid="create-contact-name-input"
                      className="w-full px-2 py-1 text-[11px] bg-muted/20 border border-border/30 rounded focus:outline-none focus:border-border/70 placeholder:text-muted-foreground/40"
                      disabled={isPending}
                    />
                  </div>

                  {/* Email (read-only) */}
                  <div className="space-y-0.5">
                    <label className="text-[10px] text-muted-foreground/60 font-medium">Email</label>
                    <div
                      className="px-2 py-1 text-[11px] bg-muted/10 border border-border/20 rounded text-muted-foreground/60 truncate"
                      data-testid="create-contact-email-display"
                    >
                      {senderEmail}
                    </div>
                  </div>

                  {/* Title (optional) */}
                  <div className="space-y-0.5">
                    <label className="text-[10px] text-muted-foreground/60 font-medium">Title <span className="text-muted-foreground/40 font-normal">(optional)</span></label>
                    <input
                      value={cTitle}
                      onChange={e => setCTitle(e.target.value)}
                      placeholder="e.g. Harbour Master"
                      data-testid="create-contact-title-input"
                      className="w-full px-2 py-1 text-[11px] bg-muted/20 border border-border/30 rounded focus:outline-none focus:border-border/70 placeholder:text-muted-foreground/40"
                      disabled={isPending}
                    />
                  </div>

                  {/* Organization section */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-muted-foreground/60 font-medium">Account *</label>

                    {/* Toggle existing / new */}
                    <div className="flex gap-1">
                      {(["existing", "new"] as const).map(mode => (
                        <button
                          key={mode}
                          onClick={() => { setCOrgMode(mode); setCOrgSearch(""); setCSelectedAccount(null); }}
                          data-testid={`org-mode-${mode}`}
                          disabled={isPending}
                          className={`text-[10px] px-2 py-[2px] rounded border transition-all ${
                            cOrgMode === mode
                              ? "bg-violet-500/15 text-violet-400 border-violet-500/40"
                              : "text-muted-foreground/50 border-border/30 hover:border-border/60"
                          }`}
                        >
                          {mode === "existing" ? "Link existing" : "Create new"}
                        </button>
                      ))}
                    </div>

                    {cOrgMode === "existing" ? (
                      <div className="space-y-1">
                        {cSelectedAccount ? (
                          <div className="flex items-center gap-1.5 px-2 py-1 bg-violet-500/10 border border-violet-500/20 rounded">
                            <Building2 className="h-3 w-3 text-violet-400 flex-shrink-0" />
                            <span className="text-[11px] text-violet-400 flex-1 truncate">{cSelectedAccount.name}</span>
                            <button
                              onClick={() => { setCSelectedAccount(null); setCOrgSearch(""); }}
                              disabled={isPending}
                              data-testid="clear-selected-org"
                              className="text-muted-foreground/40 hover:text-muted-foreground"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <div className="relative">
                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
                            <input
                              value={cOrgSearch}
                              onChange={e => setCOrgSearch(e.target.value)}
                              placeholder="Search organizations…"
                              data-testid="org-search-input"
                              disabled={isPending}
                              className="w-full pl-7 pr-2 py-1 text-[11px] bg-muted/20 border border-border/30 rounded focus:outline-none focus:border-border/70 placeholder:text-muted-foreground/40"
                            />
                          </div>
                        )}
                        {!cSelectedAccount && (
                          <div className="max-h-48 overflow-y-auto border border-border/20 rounded bg-background/80 space-y-0" data-testid="org-search-results">
                            {orgSearchQuery.isLoading && (
                              <div className="flex items-center justify-center py-2">
                                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/50" />
                              </div>
                            )}
                            {!orgSearchQuery.isLoading && (orgSearchQuery.data?.length ?? 0) === 0 && (
                              <p className="text-[10px] text-muted-foreground/40 text-center py-2">
                                {cOrgSearch.length === 0
                                  ? "No organizations in the database yet — use \"Create new\""
                                  : "No matches — try a different search or use \"Create new\""}
                              </p>
                            )}
                            {(orgSearchQuery.data ?? []).map(r => (
                              <button
                                key={r.objectId}
                                onClick={() => { setCSelectedAccount({ id: r.objectId, name: r.objectName }); setCOrgSearch(""); }}
                                data-testid={`org-result-${r.objectId}`}
                                className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-muted/30 text-left transition-colors"
                              >
                                <Building2 className="h-3 w-3 text-violet-400 flex-shrink-0" />
                                <span className="text-[11px] text-foreground flex-1 truncate">{r.objectName}</span>
                                {r.meta && <span className="text-[10px] text-muted-foreground/40 truncate max-w-[80px]">{r.meta}</span>}
                              </button>
                            ))}
                          </div>
                        )}
                        {!cSelectedAccount && cOrgSearch.length === 0 && (orgSearchQuery.data?.length ?? 0) > 0 && (
                          <p className="text-[10px] text-muted-foreground/40 italic">
                            Showing top {orgSearchQuery.data?.length} alphabetically — type to filter.
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <input
                          value={cNewOrgName}
                          onChange={e => setCNewOrgName(e.target.value)}
                          placeholder="Account name"
                          data-testid="new-org-name-input"
                          disabled={isPending}
                          className="w-full px-2 py-1 text-[11px] bg-muted/20 border border-border/30 rounded focus:outline-none focus:border-border/70 placeholder:text-muted-foreground/40"
                        />
                        <div>
                          <p className="text-[10px] text-muted-foreground/60 mb-1 font-medium">Type</p>
                          <select
                            value={cNewOrgType}
                            onChange={e => setCNewOrgType(e.target.value)}
                            data-testid="new-org-type-select"
                            disabled={isPending}
                            className="w-full px-2 py-1.5 text-[11px] rounded border border-border/50 focus:outline-none focus:border-primary/50 text-foreground cursor-pointer"
                            style={{ backgroundColor: "hsl(var(--background))" }}
                          >
                            {ORG_TYPE_OPTIONS.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>
                        <p className="text-[10px] text-muted-foreground/40 italic">
                          Domain <span className="font-mono">{senderDomain}</span> will be saved as the organization website.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <button
                      onClick={() => setShowCreateForm(false)}
                      disabled={isPending}
                      data-testid="create-contact-cancel-btn"
                      className="text-[10px] px-2.5 py-1 border border-border/30 rounded text-muted-foreground/60 hover:text-muted-foreground hover:border-border/60 transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreateSubmit}
                      disabled={isPending || !cName.trim()}
                      data-testid="create-contact-submit-btn"
                      className="flex items-center gap-1 text-[10px] px-2.5 py-1 bg-sky-500/15 border border-sky-500/30 text-sky-400 rounded hover:bg-sky-500/25 hover:border-sky-500/50 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <User className="h-2.5 w-2.5" />}
                      {isPending ? "Creating…" : "Create Contact"}
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Confirmed associations */}
            {confirmedCandidates.map(cand => {
              const cfg = TYPE_CFG[cand.objectType as keyof typeof TYPE_CFG];
              if (!cfg) return null;
              const { Icon } = cfg;
              const canAccess = hasAccessForType(cand.objectType);
              const displayName = cand.objectName ?? cand.entityDetail?.name ?? "Unknown";
              const deepUrl = getDeepLinkUrl(cand.objectType, cand.objectId);
              const firstReason = cand.reasons?.[0];
              const allReasons = cand.reasons?.join(" · ");
              const isReplacing = replacingCandidateId === cand.id;
              const replaceResults = (replaceSearchQuery.data ?? []).filter(r => hasAccessForType(r.objectType));
              return (
                <div
                  key={cand.id}
                  data-testid={`crm-assoc-confirmed-${cand.id}`}
                  className="group"
                >
                  {/* Normal row */}
                  <div className="flex items-center gap-1.5">
                    <span className={`flex items-center gap-0.5 text-[10px] px-1.5 py-[2px] rounded border flex-shrink-0 ${isReplacing ? "opacity-40" : ""} ${cfg.bg} ${cfg.text} ${cfg.border}`}>
                      <Icon className="h-2.5 w-2.5" />
                      {cfg.label}
                    </span>
                    {canAccess ? (
                      <button
                        onClick={() => !isReplacing && setLocation(deepUrl)}
                        data-testid={`crm-assoc-link-${cand.id}`}
                        className={`text-[11px] font-medium flex-1 truncate text-left flex items-center gap-1 group/link ${cfg.text} ${isReplacing ? "line-through opacity-40 cursor-default" : "hover:underline"}`}
                        title={isReplacing ? "Selecting replacement…" : allReasons}
                      >
                        <span className="truncate">{displayName}</span>
                        {!isReplacing && <ExternalLink className="h-2.5 w-2.5 flex-shrink-0 opacity-0 group-hover/link:opacity-60 transition-opacity" />}
                      </button>
                    ) : (
                      <span className="text-[11px] flex-1 truncate flex items-center gap-1 text-muted-foreground/50" title="You don't have permission to view this record">
                        <Lock className="h-2.5 w-2.5 flex-shrink-0" />
                        {RESTRICTED_LABELS[cand.objectType] ?? "Linked Record"}
                      </span>
                    )}
                    {!isReplacing && <ShieldCheck className="h-3 w-3 text-emerald-400/70 flex-shrink-0" />}
                    {/* Change button — appears on hover when not already replacing */}
                    {!isReplacing && (
                      <button
                        onClick={() => openReplace(cand.id)}
                        data-testid={`crm-change-${cand.id}`}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/40 hover:text-primary"
                        title="Change linked record"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                    {/* Cancel replace */}
                    {isReplacing && (
                      <button
                        onClick={closeReplace}
                        data-testid={`crm-replace-cancel-${cand.id}`}
                        className="text-muted-foreground/40 hover:text-foreground transition-colors text-[10px] flex-shrink-0"
                        title="Cancel"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                    {!isReplacing && (
                      <button
                        onClick={() => rejectMutation.mutate(cand.id)}
                        disabled={rejectMutation.isPending}
                        data-testid={`crm-reject-${cand.id}`}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/40 hover:text-red-400"
                        title="Remove link"
                      >
                        <XCircle className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  {/* Match reason line */}
                  {firstReason && !isReplacing && (
                    <p className="text-[10px] text-muted-foreground/40 italic pl-[calc(0.375rem+1.25rem+0.375rem)] mt-0.5 truncate" title={allReasons}>
                      {firstReason}
                    </p>
                  )}
                  {/* Inline replace widget */}
                  {isReplacing && (
                    <div className="mt-1.5 ml-0 space-y-1" data-testid={`crm-replace-widget-${cand.id}`}>
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
                        <input
                          autoFocus
                          value={replaceSearch}
                          onChange={e => setReplaceSearch(e.target.value)}
                          placeholder="Search for replacement record…"
                          data-testid="replace-link-input"
                          className="w-full pl-7 pr-2 py-1 text-[11px] bg-muted/20 border border-border/40 rounded focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground/40"
                        />
                      </div>
                      {replaceSearch.length >= 2 && (
                        <div className="max-h-36 overflow-y-auto space-y-0.5 border border-border/20 rounded bg-background/90">
                          {replaceSearchQuery.isLoading && (
                            <div className="flex items-center justify-center py-2">
                              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/50" />
                            </div>
                          )}
                          {!replaceSearchQuery.isLoading && replaceResults.length === 0 && (
                            <p className="text-[10px] text-muted-foreground/40 text-center py-2">No accessible records match</p>
                          )}
                          {replaceResults.map(r => {
                            const rcfg = TYPE_CFG[r.objectType as keyof typeof TYPE_CFG];
                            if (!rcfg) return null;
                            const isSame = cand.objectType === r.objectType && cand.objectId === r.objectId;
                            return (
                              <button
                                key={`${r.objectType}:${r.objectId}`}
                                onClick={() => {
                                  if (!isSame) {
                                    replaceMutation.mutate({
                                      oldAssociationId: cand.id,
                                      objectType: r.objectType,
                                      objectId: r.objectId,
                                      objectName: r.objectName,
                                    });
                                  }
                                }}
                                disabled={replaceMutation.isPending || isSame}
                                data-testid={`replace-result-${r.objectId}`}
                                className={`w-full flex items-center gap-2 px-2 py-1.5 text-left transition-colors ${isSame ? "opacity-40 cursor-not-allowed" : "hover:bg-muted/30"}`}
                                title={isSame ? "Already linked to this record" : undefined}
                              >
                                <span className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border flex-shrink-0 ${rcfg.bg} ${rcfg.text} ${rcfg.border}`}>
                                  <rcfg.Icon className="h-2.5 w-2.5" />
                                  {rcfg.label}
                                </span>
                                <span className="text-[11px] text-foreground flex-1 truncate">{r.objectName}</span>
                                {r.meta && <span className="text-[10px] text-muted-foreground/50 truncate max-w-[80px]">{r.meta}</span>}
                                {replaceMutation.isPending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/40 flex-shrink-0" />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {replaceSearch.length < 2 && (
                        <p className="text-[10px] text-muted-foreground/35 italic px-1">Type at least 2 characters to search</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Unconfirmed / suggested associations — high-confidence (≥50%) */}
            {highConfCandidates.map(cand => {
              const cfg = TYPE_CFG[cand.objectType as keyof typeof TYPE_CFG];
              if (!cfg) return null;
              const { Icon } = cfg;
              const canAccess = hasAccessForType(cand.objectType);
              const displayName = cand.objectName ?? cand.entityDetail?.name ?? "Unknown";
              const deepUrl = getDeepLinkUrl(cand.objectType, cand.objectId);
              const firstReason = cand.reasons?.[0];
              const allReasons = cand.reasons?.join(" · ");
              const score = cand.confidenceScore ?? 0;
              const isPossible = score >= 50 && score < 80;
              return (
                <div
                  key={cand.id}
                  data-testid={`crm-assoc-candidate-${cand.id}`}
                  className="group"
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`flex items-center gap-0.5 text-[10px] px-1.5 py-[2px] rounded border flex-shrink-0 ${isPossible ? "opacity-50" : "opacity-60"} ${cfg.bg} ${cfg.text} ${cfg.border}`}>
                      <Icon className="h-2.5 w-2.5" />
                      {isPossible ? `~${cfg.label}` : cfg.label}
                    </span>
                    {canAccess ? (
                      <button
                        onClick={() => setLocation(deepUrl)}
                        data-testid={`crm-cand-link-${cand.id}`}
                        className="text-[11px] text-muted-foreground flex-1 truncate text-left hover:underline flex items-center gap-1 group/link"
                        title={allReasons}
                      >
                        <span className="truncate">{displayName}</span>
                        <ExternalLink className="h-2.5 w-2.5 flex-shrink-0 opacity-0 group-hover/link:opacity-50 transition-opacity" />
                      </button>
                    ) : (
                      <span className="text-[11px] flex-1 truncate flex items-center gap-1 text-muted-foreground/40 italic" title="You don't have permission to view this record">
                        <Lock className="h-2.5 w-2.5 flex-shrink-0" />
                        {RESTRICTED_LABELS[cand.objectType] ?? "Linked Record"}
                      </span>
                    )}
                    <ScoreBadge score={cand.confidenceScore} />
                    <button
                      onClick={() => confirmMutation.mutate(cand.id)}
                      disabled={confirmMutation.isPending}
                      data-testid={`crm-confirm-${cand.id}`}
                      className="text-muted-foreground/30 hover:text-emerald-400 transition-colors"
                      title="Confirm this link"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => rejectMutation.mutate(cand.id)}
                      disabled={rejectMutation.isPending}
                      data-testid={`crm-reject-${cand.id}`}
                      className="text-muted-foreground/30 hover:text-red-400 transition-colors"
                      title="Dismiss this suggestion"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {firstReason && (
                    <p className="text-[10px] text-muted-foreground/35 italic pl-[calc(0.375rem+1.25rem+0.375rem)] mt-0.5 truncate" title={allReasons}>
                      {firstReason}
                    </p>
                  )}
                </div>
              );
            })}

            {/* Low-confidence suggestions (<50%) — hidden by default */}
            {lowConfCandidates.length > 0 && (
              <div className="mt-1">
                <button
                  onClick={() => setShowLowConf(v => !v)}
                  data-testid="toggle-low-conf-candidates"
                  className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground/70 flex items-center gap-1 transition-colors"
                >
                  {showLowConf ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
                  {showLowConf ? "Hide" : `Show ${lowConfCandidates.length} low-confidence match${lowConfCandidates.length !== 1 ? "es" : ""}`}
                </button>
                {showLowConf && lowConfCandidates.map(cand => {
                  const cfg = TYPE_CFG[cand.objectType as keyof typeof TYPE_CFG];
                  if (!cfg) return null;
                  const { Icon } = cfg;
                  const canAccess = hasAccessForType(cand.objectType);
                  const displayName = cand.objectName ?? cand.entityDetail?.name ?? "Unknown";
                  const deepUrl = getDeepLinkUrl(cand.objectType, cand.objectId);
                  const allReasons = cand.reasons?.join(" · ");
                  const firstReason = cand.reasons?.[0];
                  return (
                    <div key={cand.id} data-testid={`crm-assoc-low-${cand.id}`} className="group mt-0.5 opacity-60">
                      <div className="flex items-center gap-1.5">
                        <span className={`flex items-center gap-0.5 text-[10px] px-1.5 py-[2px] rounded border flex-shrink-0 opacity-50 ${cfg.bg} ${cfg.text} ${cfg.border}`}>
                          <Icon className="h-2.5 w-2.5" />
                          ~{cfg.label}
                        </span>
                        {canAccess ? (
                          <button
                            onClick={() => setLocation(deepUrl)}
                            data-testid={`crm-cand-link-low-${cand.id}`}
                            className="text-[11px] text-muted-foreground/60 flex-1 truncate text-left hover:underline flex items-center gap-1"
                            title={allReasons}
                          >
                            <span className="truncate">{displayName}</span>
                          </button>
                        ) : (
                          <span className="text-[11px] flex-1 truncate text-muted-foreground/30 italic">
                            {RESTRICTED_LABELS[cand.objectType] ?? "Linked Record"}
                          </span>
                        )}
                        <ScoreBadge score={cand.confidenceScore} />
                        <button
                          onClick={() => rejectMutation.mutate(cand.id)}
                          disabled={rejectMutation.isPending}
                          data-testid={`crm-reject-low-${cand.id}`}
                          className="text-muted-foreground/20 hover:text-red-400 transition-colors"
                          title="Dismiss"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {firstReason && (
                        <p className="text-[10px] text-muted-foreground/25 italic pl-[calc(0.375rem+1.25rem+0.375rem)] mt-0.5 truncate" title={allReasons}>
                          {firstReason}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      </>
      )}

      {/* Participant → Add Contact dialog */}
      <SmartAddContactDialog
        open={participantDialogTarget !== null}
        onClose={() => setParticipantDialogTarget(null)}
        fromEmail={participantDialogTarget?.email ?? ""}
        fromName={participantDialogTarget?.name ?? ""}
        subject={hintSubject ?? ""}
        body=""
        onSaved={async () => {
          setParticipantDialogTarget(null);
          try { await refreshAssocMutation.mutateAsync(); } catch {}
          queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-participants", threadId] });
          queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-associations", threadId] });
          queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-record", threadId] });
        }}
      />
    </div>
  );
}

// ── Phase 2B: Local indexed search (Sheet panel) ──────────────────────────
type LocalSearchHit = {
  id: number;
  gmailMessageId: string;
  gmailThreadId: string;
  subject: string | null;
  fromEmail: string | null;
  fromName: string | null;
  toEmails: string | null;
  sentAt: string | null;
  direction: string | null;
  snippet: string | null;
  rank: number | null;
};

function highlightSnippet(s: string | null) {
  if (!s) return null;
  const parts = s.split(/(<<.*?>>)/g);
  return parts.map((p, i) =>
    p.startsWith("<<") && p.endsWith(">>") ? (
      <mark key={i} className="bg-yellow-500/30 text-foreground px-0.5 rounded-sm">
        {p.slice(2, -2)}
      </mark>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

function LocalSearchButton() {
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [participants, setParticipants] = useState("");
  const [from, setFrom] = useState("");
  const [domain, setDomain] = useState("");
  const [direction, setDirection] = useState<string>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (participants) params.set("participants", participants);
  if (from) params.set("from", from);
  if (domain) params.set("domain", domain);
  if (direction) params.set("direction", direction);
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  params.set("limit", "50");

  const search = useQuery<{ rows: LocalSearchHit[]; total: number; tookMs: number }>({
    queryKey: ["/api/email-search", params.toString()],
    queryFn: async () => {
      const r = await fetch(`/api/email-search?${params.toString()}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: submitted && (q.length > 0 || participants.length > 0 || from.length > 0 || domain.length > 0 || direction.length > 0 || dateFrom.length > 0 || dateTo.length > 0),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  const onOpenThread = (threadId: string) => {
    setOpen(false);
    setLocation(`/gmail?thread=${encodeURIComponent(threadId)}`);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs" data-testid="button-open-local-search">
          <Search className="h-3.5 w-3.5" />
          Search Mailbox
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Search className="h-4 w-4" /> Search Mailbox
            <span className="text-[11px] font-normal text-muted-foreground/60">(local index — full history, ms-fast)</span>
          </SheetTitle>
        </SheetHeader>

        <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3 mt-4">
          <div className="col-span-2">
            <Label className="text-[11px] text-muted-foreground">Search text (subject, body, sender)</Label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="invoice, refund, contract…" data-testid="input-local-search-q" autoFocus />
          </div>
          <div className="col-span-2">
            <Label className="text-[11px] text-muted-foreground">Contact / Participants (email address or name — searches sent AND received)</Label>
            <Input value={participants} onChange={(e) => setParticipants(e.target.value)} placeholder="zach@portofsandiego.org" data-testid="input-local-search-participants" />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">From only (sender)</Label>
            <Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="stripe" data-testid="input-local-search-from" />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Domain</Label>
            <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="gmail.com" data-testid="input-local-search-domain" />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Direction</Label>
            <Select value={direction || "any"} onValueChange={(v) => setDirection(v === "any" ? "" : v)}>
              <SelectTrigger data-testid="select-local-search-direction"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                <SelectItem value="inbound">Inbound</SelectItem>
                <SelectItem value="outbound">Outbound</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Date from</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} data-testid="input-local-search-date-from" />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Date to</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} data-testid="input-local-search-date-to" />
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <Button type="submit" size="sm" disabled={search.isFetching} data-testid="button-local-search-submit">
              {search.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Search className="h-3.5 w-3.5 mr-1.5" />}
              Search
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setQ(""); setParticipants(""); setFrom(""); setDomain(""); setDirection(""); setDateFrom(""); setDateTo(""); setSubmitted(false); }} data-testid="button-local-search-clear">
              Clear
            </Button>
            {search.data && (
              <span className="text-[11px] text-muted-foreground/70 ml-auto" data-testid="text-local-search-stats">
                {search.data.total.toLocaleString()} match{search.data.total === 1 ? "" : "es"} · {search.data.tookMs}ms
              </span>
            )}
          </div>
        </form>

        <div className="mt-4 space-y-1.5">
          {search.error && (
            <div className="text-xs text-red-400 p-3 border border-red-500/30 rounded-md" data-testid="text-local-search-error">
              {(search.error as Error).message}
            </div>
          )}
          {search.data?.rows.map((r) => (
            <button
              key={r.id}
              onClick={() => onOpenThread(r.gmailThreadId)}
              className="w-full text-left p-2.5 rounded-md border border-border/30 hover:border-border/70 hover:bg-muted/20 transition-colors block"
              data-testid={`row-local-search-${r.id}`}
            >
              <div className="flex items-baseline gap-2">
                <span className="text-[12px] font-medium text-foreground/90 truncate flex-1">{r.subject || "(no subject)"}</span>
                <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">
                  {r.sentAt ? new Date(r.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) : ""}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground/70 truncate">
                {r.direction === "outbound" ? "→ " : ""}{r.fromName || r.fromEmail}
              </div>
              {r.snippet && (
                <div className="text-[11px] text-muted-foreground/60 mt-1 line-clamp-2">
                  {highlightSnippet(r.snippet)}
                </div>
              )}
            </button>
          ))}
          {submitted && search.data && search.data.rows.length === 0 && !search.isFetching && (
            <div className="text-xs text-muted-foreground/60 text-center py-6" data-testid="text-local-search-empty">
              No matches.
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

type MailTeamPerms = Record<string, { view: boolean; edit: boolean }>;

// Per-section visual palette for Smart Inbox card treatment.
// Subtle tints on dark navy — warm orange for Priority, category tints for the rest.
const SMART_SECTION_STYLES: Record<string, { headerBg: string; rowBg: string; tone: string; mx: string }> = {
  priority:               { headerBg: "bg-amber-400/[0.13]",  rowBg: "bg-amber-400/[0.06]",  tone: "text-amber-400",           mx: "mx-2" },
  "unread-people":        { headerBg: "bg-teal-400/[0.10]",   rowBg: "bg-teal-400/[0.04]",   tone: "text-teal-400/80",         mx: "mx-2" },
  "unread-newsletters":   { headerBg: "bg-violet-400/[0.10]", rowBg: "bg-violet-400/[0.04]", tone: "text-violet-400/80",       mx: "mx-2" },
  "unread-notifications": { headerBg: "bg-slate-400/[0.10]",  rowBg: "bg-slate-400/[0.04]",  tone: "text-slate-400/80",        mx: "mx-2" },
  seen:                   { headerBg: "bg-white/[0.05]",      rowBg: "bg-white/[0.02]",      tone: "text-muted-foreground/65", mx: "mx-2" },
};
const SMART_SECTION_STYLES_DEFAULT = { headerBg: "", rowBg: "", tone: "text-muted-foreground/65", mx: "" };

// Module-level dedup helpers — pure functions with no component state, defined here so
// useMemo deps arrays inside GmailInboxPage don't need to include them (they never change).
function dedupById(msgs: MessageSummary[]): MessageSummary[] {
  const seen = new Set<string>();
  const out: MessageSummary[] = [];
  for (const m of msgs) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}
// Thread dedup — messages sorted newest-first (ORDER BY sent_at DESC), so the first occurrence
// of each threadId is the newest reply. Keeps one row per thread (threaded inbox behaviour).
function dedupByThread(msgs: MessageSummary[]): MessageSummary[] {
  const seenThreads = new Set<string>();
  const out: MessageSummary[] = [];
  for (const m of msgs) {
    if (seenThreads.has(m.threadId)) continue;
    seenThreads.add(m.threadId);
    out.push(m);
  }
  return out;
}

// Union type for items in collapsedViewItems — extends SmartItem with expand/collapse sentinels.
type SmartCollapseItem =
  | SmartItem<MessageSummary>
  | { kind: "show-all"; sectionId: SmartSectionId; total: number }
  | { kind: "show-less"; sectionId: SmartSectionId };

export default function GmailInboxPage({ currentUserEmail, currentUserRole = "sales", userPermissions }: {
  currentUserEmail: string;
  currentUserRole?: string;
  userPermissions?: { mail_team?: MailTeamPerms; [key: string]: unknown };
}) {
  const mailTeamPerms: MailTeamPerms = (userPermissions?.mail_team ?? {}) as MailTeamPerms;
  const isAdmin = ["master_admin", "admin"].includes(currentUserRole);
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const handleNavigateBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      setLocation("/");
    }
  };
  // Commit 4 (unified inbox): the in-page mailSource toggle, the
  // ?mailSource= URL override, the localStorage `voltsafe.mailSource`
  // preference, and the toggle CTAs in the all-caught-up sentinel were all
  // removed. The inbox is now ALWAYS sourced from the local mirror — the
  // synced store has the full INBOX history (54k+ rows going back years) and
  // is kept fresh by the Gmail push webhook + a 15s foreground poll, so
  // there is no longer a UX reason to expose a "live Gmail" view. This
  // one-shot effect cleans up any localStorage value left over from
  // pre-Commit-4 sessions and drops any cached React Query entries that
  // still carry the old 5-tuple key (which included mailSource as the last
  // segment) so we don't ship stale rows on the first post-deploy load.
  useEffect(() => {
    try { window.localStorage.removeItem("voltsafe.mailSource"); } catch {}
    try {
      // Old 5-tuple keys: ["/api/gmail/messages", "inbox"|"sent", q, acct, mailSource].
      // After Commit 4 we use 4-tuple keys. Drop anything with an extra trailing
      // segment so the cache doesn't leak old "local"/"gmail" rows past upgrade.
      queryClient.removeQueries({
        predicate: (q) => {
          const k = q.queryKey;
          if (!Array.isArray(k) || k.length < 5) return false;
          if (k[0] !== "/api/gmail/messages") return false;
          return k[4] === "local" || k[4] === "gmail" || k[4] === "auto";
        },
      });
      queryClient.removeQueries({
        predicate: (q) => {
          const k = q.queryKey;
          if (!Array.isArray(k) || k.length < 4) return false;
          if (k[0] !== "/api/gmail/threads") return false;
          return k[3] === "local" || k[3] === "gmail" || k[3] === "auto";
        },
      });
    } catch {}
    // Run once on mount — no deps. Idempotent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("thread") ?? null;
  });
  // Tracks whether the currently-open thread was unread at the moment of click.
  // Used by the smart-inbox grouper to keep it in the unread bucket only when
  // it genuinely transitioned from unread→read (not when already read).
  const [openThreadWasUnread, setOpenThreadWasUnread] = useState(false);
  // Tracks threads the user has explicitly rescued from the spam/blocked tab.
  // inboxOther items (inbox messages from blocked domains shown in the spam tab)
  // always survive an inbox refetch, so a cache eviction alone cannot keep them
  // hidden. This set gives a permanent session-level exclusion that survives
  // every subsequent inbox query invalidation.
  const [rescuedFromSpam, setRescuedFromSpam] = useState<Set<string>>(new Set());
  // Mail Trust Strip — transient send/draft event surfaced from ComposeDialog mutations.
  const [trustEvent, setTrustEvent] = useState<TrustEvent | null>(null);
  const trustEventTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleTrustEvent = (event: TrustEvent) => {
    if (trustEventTimerRef.current) clearTimeout(trustEventTimerRef.current);
    setTrustEvent(event);
    const clearMs =
      event.type === "sent" ? 3000 :
      event.type === "draft-saved" ? 2500 :
      event.type === "send-failed-draft-saved" ? 6000 :
      event.type === "send-failed" ? 6000 :
      event.type === "scheduled-failed" ? 6000 : null;
    if (clearMs !== null) {
      trustEventTimerRef.current = setTimeout(() => setTrustEvent(null), clearMs);
    }
  };
  const [returnPath] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("return") ?? null;
  });
  const [composeOpen, setComposeOpen] = useState(false);
  const [smartContactOpen, setSmartContactOpen] = useState(false);
  const [smartContactSelectedText, setSmartContactSelectedText] = useState("");
  const [newLeadDialogOpen, setNewLeadDialogOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<{ to: string; cc?: string; subject: string; threadId: string; fromName?: string; quotedHtml?: string; quotedFrom?: string; quotedDate?: string } | null>(null);
  const [shownSenderEmailIds, setShownSenderEmailIds] = useState<Set<string>>(new Set());
  const toggleSenderEmail = (msgId: string) => setShownSenderEmailIds(prev => { const n = new Set(prev); n.has(msgId) ? n.delete(msgId) : n.add(msgId); return n; });
  const [tab, setTab] = useState<"inbox" | "sent" | "spam" | "other" | "drafts" | "scheduled" | "folder" | "review" | "pinned">("inbox");
  const isCategoryTab = false;
  const [selectedReviewIds, setSelectedReviewIds] = useState<Set<string>>(new Set());
  const [inboxCategory, setInboxCategory] = useState<InboxCategory>("all");
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [showFolderSettings, setShowFolderSettings] = useState<number | null>(null);
  const [showAutoLinkRules, setShowAutoLinkRules] = useState(false);
  const [newRuleDomain, setNewRuleDomain] = useState("");
  const [newRuleObjType, setNewRuleObjType] = useState<"lead" | "account" | "contact" | "partner">("lead");
  const [newRuleObjId, setNewRuleObjId] = useState("");
  const [newRuleObjName, setNewRuleObjName] = useState("");
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderDomainInput, setNewFolderDomainInput] = useState("");
  const [foldersExpanded, setFoldersExpanded] = useState(true);
  // ── Focus Mode (premium full-reader experience) ────────────────────────
  const [focusMode, setFocusMode] = useState<boolean>(() => {
    try { return typeof window !== "undefined" && localStorage.getItem(lsKey("inbox.focusMode")) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(lsKey("inbox.focusMode"), focusMode ? "1" : "0"); } catch {}
  }, [focusMode]);
  // ── Density (Comfortable / Compact / Ultra) ────────────────────────────
  type Density = "comfortable" | "compact" | "ultra";
  const [density, setDensity] = useState<Density>(() => {
    try {
      const v = typeof window !== "undefined" ? localStorage.getItem(lsKey("inbox.density")) : null;
      if (v === "compact" || v === "ultra" || v === "comfortable") return v as Density;
    } catch {}
    return "comfortable";
  });
  useEffect(() => {
    try { localStorage.setItem(lsKey("inbox.density"), density); } catch {}
  }, [density]);

  // Spark-style "Smart Inbox" toggle. When enabled the inbox renders sectioned
  // groups (Unread by category) instead of a flat chronological list.
  // Persisted in localStorage via the hook.
  const [viewMode, setViewMode] = useInboxViewMode();
  // Declared here (before other hooks that depend on it) so we can derive the
  // pinned-storage key before calling usePinnedThreads.
  // null  = user's own inbox (personal), "all" = unified cross-account view.
  const [activeAccountId, setActiveAccountId] = useState<number | "all" | null>(null);

  // Each inbox gets its own pin namespace so switching accounts never leaks
  // pinned threads from one mailbox into another.
  // "all" maps to "personal" because the unified view reads personal pins;
  // team-inbox pins are scoped to their numeric account id.
  const pinnedAccountKey =
    activeAccountId === null ? "personal" :
    activeAccountId === "all" ? "personal" :
    `acct-${activeAccountId}`;
  const pinnedAPI = usePinnedThreads(pinnedAccountKey);
  // Per-user "set aside" thread set (localStorage). Mirrors the Spark gesture:
  // briefly remove a thread from the active inbox without archiving so the
  // user can come back to it later. Surfaced via the actions toolbar.
  const setAsideAPI = useSetAside();
  // Global density token system — applied to sidebar, list, and reader pane
  // so the entire inbox reflows as one cohesive system when density changes.
  const densityClasses = useMemo(() => {
    const map = {
      comfortable: {
        // List row (existing)
        py: "py-3", senderText: "text-[13px]", subText: "text-[12px]", showSnippet: true, signalsMt: "mt-1",
        // Sidebar
        sidebarRowPy: "py-1.5", sidebarRowText: "text-[12px]",
        sidebarSubtabPy: "py-1", sidebarSubtabText: "text-[12px]",
        sidebarFolderPy: "py-1", sidebarFolderText: "text-[12px]",
        sidebarSectionPt: "pt-3", sidebarSectionPb: "pb-0.5",
        sidebarAvatar: "h-6 w-6", sidebarIcon: "h-3.5 w-3.5",
        composeBtnH: "h-9", composeBtnText: "text-[13px]",
        // Filter chips + search
        chipsRootPad: "p-3", chipsRootGap: "space-y-2",
        chipPy: "py-1", chipPx: "px-2.5", chipText: "text-[11px]",
        searchH: "h-8",
        // Reader header
        readerHeaderPx: "px-5", readerHeaderPy: "py-2.5",
        readerSubjectText: "text-[18px]", readerMetaMt: "mt-0.5",
        // Reader thread + per-message card
        readerThreadPx: "px-4", readerThreadPt: "pt-3", readerThreadGap: "space-y-3",
        msgHeaderPx: "px-5", msgHeaderPy: "py-2.5",
        msgBodyPx: "px-5", msgBodyPy: "py-2",
        msgAvatar: "w-9 h-9", msgAvatarText: "text-[12px]",
        msgSenderText: "text-[13.5px]",
        // Reply bar
        replyBarPx: "px-4", replyBarPy: "py-2",
      },
      compact: {
        py: "py-2", senderText: "text-[12.5px]", subText: "text-[11.5px]", showSnippet: true, signalsMt: "mt-0.5",
        sidebarRowPy: "py-1", sidebarRowText: "text-[11.5px]",
        sidebarSubtabPy: "py-0.5", sidebarSubtabText: "text-[11.5px]",
        sidebarFolderPy: "py-0.5", sidebarFolderText: "text-[11.5px]",
        sidebarSectionPt: "pt-2", sidebarSectionPb: "pb-0.5",
        sidebarAvatar: "h-5 w-5", sidebarIcon: "h-3 w-3",
        composeBtnH: "h-8", composeBtnText: "text-[12.5px]",
        chipsRootPad: "px-3 py-2", chipsRootGap: "space-y-1.5",
        chipPy: "py-0.5", chipPx: "px-2", chipText: "text-[10.5px]",
        searchH: "h-7",
        readerHeaderPx: "px-4", readerHeaderPy: "py-2",
        readerSubjectText: "text-[16px]", readerMetaMt: "mt-0.5",
        readerThreadPx: "px-3", readerThreadPt: "pt-2", readerThreadGap: "space-y-2.5",
        msgHeaderPx: "px-4", msgHeaderPy: "py-2",
        msgBodyPx: "px-4", msgBodyPy: "py-2.5",
        msgAvatar: "w-8 h-8", msgAvatarText: "text-[11px]",
        msgSenderText: "text-[13px]",
        replyBarPx: "px-3", replyBarPy: "py-1.5",
      },
      ultra: {
        py: "py-1.5", senderText: "text-[12px]", subText: "text-[11px]", showSnippet: false, signalsMt: "mt-0",
        sidebarRowPy: "py-0.5", sidebarRowText: "text-[11px]",
        sidebarSubtabPy: "py-0.5", sidebarSubtabText: "text-[11px]",
        sidebarFolderPy: "py-0.5", sidebarFolderText: "text-[11px]",
        sidebarSectionPt: "pt-1.5", sidebarSectionPb: "pb-0",
        sidebarAvatar: "h-5 w-5", sidebarIcon: "h-3 w-3",
        composeBtnH: "h-7", composeBtnText: "text-[12px]",
        chipsRootPad: "px-3 py-1.5", chipsRootGap: "space-y-1",
        chipPy: "py-0.5", chipPx: "px-2", chipText: "text-[10px]",
        searchH: "h-7",
        readerHeaderPx: "px-4", readerHeaderPy: "py-1.5",
        readerSubjectText: "text-[14px]", readerMetaMt: "mt-0",
        readerThreadPx: "px-3", readerThreadPt: "pt-1.5", readerThreadGap: "space-y-2",
        msgHeaderPx: "px-3.5", msgHeaderPy: "py-1.5",
        msgBodyPx: "px-3.5", msgBodyPy: "py-2",
        msgAvatar: "w-7 h-7", msgAvatarText: "text-[10px]",
        msgSenderText: "text-[12px]",
        replyBarPx: "px-3", replyBarPy: "py-1",
      },
    };
    return map[density];
  }, [density]);
  // ── Command Bar (Cmd+K) ────────────────────────────────────────────────
  const [cmdkOpen, setCmdkOpen] = useState(false);
  // ── Snippets Manager dialog ────────────────────────────────────────────
  const [snippetsManagerOpen, setSnippetsManagerOpen] = useState(false);
  const { snippets } = useSnippets();
  // ── Compose seed (cmdk → contact / snippet → fresh compose) ────────────
  const [composeInitial, setComposeInitial] = useState<{ to?: string; cc?: string; subject?: string; body?: string; isForward?: boolean; quotedHtml?: string; quotedFrom?: string; quotedDate?: string; forwardSubject?: string; forwardTo?: string } | null>(null);
  // ── Cmd+K / Ctrl+K listener ────────────────────────────────────────────
  // Registered in CAPTURE phase + stopImmediatePropagation so the inbox
  // palette is the *only* ⌘K target while this page is mounted (preempts
  // GlobalSearch, QuickCapture, and the header local-search shortcuts).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMetaK = (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K");
      if (!isMetaK) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setCmdkOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, []);
  // ── External compose trigger (from AI Summary "Suggested Email") ───────────
  useEffect(() => {
    // ── Primary fallback: module-level in-memory handoff ──────────────────
    // This is immune to sessionStorage restrictions (Replit preview iframe,
    // private-mode browsers) and has no async/timing requirements — the value
    // is synchronously available the moment this effect runs.
    const inMemory = takePendingCompose();
    if (inMemory) {
      console.log("[gmail-inbox] compose-handoff in-memory payload found", { to: inMemory.to, subject: inMemory.subject });
      setComposeInitial({ to: inMemory.to || "", cc: inMemory.cc || "", subject: inMemory.subject || "", body: inMemory.body || "" });
      setComposeOpen(true);
    } else {
      // ── Secondary fallback: sessionStorage (works for hard page reloads) ─
      try {
        const raw = sessionStorage.getItem(PENDING_COMPOSE_KEY);
        if (raw) {
          sessionStorage.removeItem(PENDING_COMPOSE_KEY);
          const p = JSON.parse(raw);
          console.log("[gmail-inbox] sessionStorage compose payload found", { to: p.to, subject: p.subject });
          setComposeInitial({ to: p.to || "", cc: p.cc || "", subject: p.subject || "", body: p.body || "" });
          setComposeOpen(true);
        } else {
          console.log("[gmail-inbox] no pending compose payload (in-memory or sessionStorage)");
        }
      } catch { /* sessionStorage blocked in iframe / private mode — ignore */ }
    }

    // Keep the CustomEvent listener for any in-page callers where the inbox
    // is already mounted (e.g. future in-app triggers within the Gmail view).
    const onOpenCompose = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      setComposeInitial({
        to: detail.to || "",
        cc: detail.cc || "",
        subject: detail.subject || "",
        body: detail.body || "",
      });
      setComposeOpen(true);
    };
    window.addEventListener("voltsafe:openCompose", onOpenCompose);
    return () => window.removeEventListener("voltsafe:openCompose", onOpenCompose);
  }, []);
  const [editingDomainFolderId, setEditingDomainFolderId] = useState<number | null>(null);
  const [addDomainInput, setAddDomainInput] = useState("");
  const [editingDraft, setEditingDraft] = useState<{ to: string; cc?: string; bcc?: string; subject: string; body: string; draftId: string; threadId?: string } | null>(null);
  const [loadingDraftId, setLoadingDraftId] = useState<string | null>(null);
  const [inboxExtra, setInboxExtra] = useState<MessageSummary[]>([]);
  const [inboxNextToken, setInboxNextToken] = useState<string | null>(null);
  const [loadingMoreInbox, setLoadingMoreInbox] = useState(false);
  const [sentExtra, setSentExtra] = useState<MessageSummary[]>([]);
  const [sentNextToken, setSentNextToken] = useState<string | null>(null);
  const [loadingMoreSent, setLoadingMoreSent] = useState(false);

  // Resizable email-list panel
  const [listPanelWidth, setListPanelWidth] = useState<number>(() => {
    try { const s = localStorage.getItem(lsKey("inbox-list-width")); return s ? Math.max(300, Math.min(680, Number(s))) : 400; } catch { return 400; }
  });
  const listPanelWidthRef = useRef(listPanelWidth);
  useEffect(() => { listPanelWidthRef.current = listPanelWidth; }, [listPanelWidth]);

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = listPanelWidthRef.current;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      const newW = Math.max(300, Math.min(680, startWidth + (ev.clientX - startX)));
      listPanelWidthRef.current = newW;
      setListPanelWidth(newW);
    };
    const onUp = () => {
      try { localStorage.setItem(lsKey("inbox-list-width"), String(listPanelWidthRef.current)); } catch {}
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  // Two-state (expanded / mini) top header and bottom panel in thread view
  const [topExpanded, setTopExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem(lsKey("inbox-top-expanded")) !== "false"; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem(lsKey("inbox-top-expanded"), String(topExpanded)); } catch {}
  }, [topExpanded]);
  const topHeaderRef = useRef<HTMLDivElement>(null);

  const handleTopDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    let toggled = false;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      if (toggled) return;
      const delta = ev.clientY - startY;
      if (delta < -20) { toggled = true; setTopExpanded(false); }
      else if (delta > 20) { toggled = true; setTopExpanded(true); }
    };
    const onUp = () => {
      if (!toggled) setTopExpanded(v => !v);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  // Two-state (expanded / mini) bottom panel in thread view
  const [bottomExpanded, setBottomExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem(lsKey("inbox-bottom-expanded")) !== "false"; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem(lsKey("inbox-bottom-expanded"), String(bottomExpanded)); } catch {}
  }, [bottomExpanded]);
  const bottomPanelRef = useRef<HTMLDivElement>(null);

  const handleBottomDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    let toggled = false;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      if (toggled) return;
      const delta = ev.clientY - startY;
      if (delta > 20) { toggled = true; setBottomExpanded(false); }
      else if (delta < -20) { toggled = true; setBottomExpanded(true); }
    };
    const onUp = () => {
      if (!toggled) setBottomExpanded(v => !v);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const [selectedInboxIds, setSelectedInboxIds] = useState<Set<string>>(new Set());
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set());
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const lastAnchorIdxRef = useRef<number>(-1);
  const [crmFilter, setCrmFilter] = useState<CrmInboxFilter>("all");
  const [quickTaskThreadId, setQuickTaskThreadId] = useState<string | null>(null);
  const [quickTaskTitle, setQuickTaskTitle] = useState("");

  const filtersQuery = useQuery<EmailFilter[]>({
    queryKey: ["/api/email-filters"],
    queryFn: async () => {
      const res = await fetch("/api/email-filters", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Memoized so downstream derived arrays (inboxMain, categorizedInbox, crmFilteredMessages,
  // viewItems) only recompute when the filter data actually changes — not on every render.
  const blockedDomains = useMemo(
    () => new Set((filtersQuery.data || []).map((f) => f.domain)),
    [filtersQuery.data],
  );

  const blockedSendersQuery = useQuery<{ id: number; email: string }[]>({
    queryKey: ["/api/blocked-senders"],
    queryFn: async () => {
      const res = await fetch("/api/blocked-senders", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const blockedEmails = useMemo(
    () => new Set((blockedSendersQuery.data || []).map((r) => r.email.toLowerCase())),
    [blockedSendersQuery.data],
  );

  const foldersQuery = useQuery<MailFolder[]>({
    queryKey: ["/api/mail-folders"],
    queryFn: async () => {
      const res = await fetch("/api/mail-folders", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const folderEmailsQuery = useQuery<FolderEmail[]>({
    queryKey: ["/api/mail-folders", selectedFolderId, "emails"],
    queryFn: async () => {
      if (!selectedFolderId) return [];
      const res = await fetch(`/api/mail-folders/${selectedFolderId}/emails?limit=100`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: tab === "folder" && !!selectedFolderId,
  });

  // activeAccountId declared earlier (before usePinnedThreads) — see above.
  const [inboxViewPickerOpen, setInboxViewPickerOpen] = useState(false);
  const inboxViewPickerRef = useRef<HTMLDivElement>(null);
  const inboxViewPickerBtnRef = useRef<HTMLButtonElement>(null);
  const [inboxViewPickerAnchor, setInboxViewPickerAnchor] = useState<{ top: number; left: number } | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<SmartSectionId>>(new Set());
  const [sectionLoadingIds, setSectionLoadingIds] = useState<Set<SmartSectionId>>(new Set());
  const [sectionFetchDoneIds, setSectionFetchDoneIds] = useState<Set<SmartSectionId>>(new Set());
  // Multi-mailbox Phase 1: when a message is opened from "All Inboxes", remember its source
  // account id so per-thread reads/mutations target the right mailbox (instead of sending the
  // literal "all" sentinel, which numeric-only routes coerce to NaN).
  const [currentThreadAccountId, setCurrentThreadAccountId] = useState<number | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const acct = params.get("account");
    return acct && !isNaN(Number(acct)) ? Number(acct) : null;
  });

  // When the user is viewing a specific mailbox (not null/"all"), scope the
  // triage counts/IDs to that account so the badges match what they actually see.
  const triageAccountParam = typeof activeAccountId === "number"
    ? `?accountId=${activeAccountId}`
    : "";

  const triageSummaryQuery = useQuery<{ awaitingReply: number; hot: number; unlinked: number }>({
    queryKey: ["/api/inbox/triage-summary", activeAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/inbox/triage-summary${triageAccountParam}`, { credentials: "include" });
      if (!res.ok) return { awaitingReply: 0, hot: 0, unlinked: 0 };
      return res.json();
    },
    refetchInterval: 15_000,
  });

  const triageThreadIdsQuery = useQuery<{ awaitingReply: string[]; hot: string[]; unlinked: string[] }>({
    queryKey: ["/api/inbox/triage-thread-ids", activeAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/inbox/triage-thread-ids${triageAccountParam}`, { credentials: "include" });
      if (!res.ok) return { awaitingReply: [], hot: [], unlinked: [] };
      return res.json();
    },
    enabled: ["needs-reply", "awaiting-reply", "hot", "unlinked"].includes(crmFilter),
    refetchInterval: 15_000,
  });

  const triageSummary = triageSummaryQuery.data ?? { awaitingReply: 0, hot: 0, unlinked: 0 };
  // Use the raw .data reference (undefined when not yet loaded) as the memo dep so the Sets
  // are only rebuilt when the server returns new data — not on every render. The inline
  // `?? []` fallback inside each memo keeps them empty (not null) while loading.
  const triageIdsData = triageThreadIdsQuery.data;
  const triageAwaitingSet = useMemo(() => new Set(triageIdsData?.awaitingReply ?? []), [triageIdsData]);
  const triageHotSet      = useMemo(() => new Set(triageIdsData?.hot       ?? []), [triageIdsData]);
  const triageUnlinkedSet = useMemo(() => new Set(triageIdsData?.unlinked  ?? []), [triageIdsData]);

  const createFolderMutation = useMutation({
    mutationFn: async (data: { name: string; domains: string[] }) => {
      const res = await apiRequest("POST", "/api/mail-folders", { name: data.name, color: "teal" });
      const folder = await res.json();
      for (const domain of data.domains) {
        if (domain.trim()) {
          await apiRequest("POST", `/api/mail-folders/${folder.id}/domains`, { domain: domain.trim() });
        }
      }
      return folder;
    },
    onSuccess: (folder) => {
      queryClient.invalidateQueries({ queryKey: ["/api/mail-folders"] });
      setShowCreateFolder(false);
      setNewFolderName("");
      setNewFolderDomainInput("");
      setSelectedFolderId(folder.id);
      setTab("folder");
      toast({ title: "Folder created", description: `"${folder.name}" is ready. Run Reprocess to populate it.` });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async (folderId: number) => {
      const res = await apiRequest("DELETE", `/api/mail-folders/${folderId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mail-folders"] });
      setSelectedFolderId(null);
      setTab("inbox");
      setShowFolderSettings(null);
      toast({ title: "Folder deleted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const addDomainMutation = useMutation({
    mutationFn: async ({ folderId, domain }: { folderId: number; domain: string }) => {
      const res = await apiRequest("POST", `/api/mail-folders/${folderId}/domains`, { domain });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mail-folders"] });
      setAddDomainInput("");
      setEditingDomainFolderId(null);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const removeDomainMutation = useMutation({
    mutationFn: async ({ folderId, domainId }: { folderId: number; domainId: number }) => {
      const res = await apiRequest("DELETE", `/api/mail-folders/${folderId}/domains/${domainId}`);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/mail-folders"] }),
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const backfillMutation = useMutation({
    mutationFn: async (folderId: number) => {
      const res = await apiRequest("POST", `/api/mail-folders/${folderId}/backfill`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Reprocessing started", description: "Existing emails are being scanned. Refresh in a moment." });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["/api/mail-folders"] }), 3000);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const removeEmailFromFolderMutation = useMutation({
    mutationFn: async ({ folderId, emailId }: { folderId: number; emailId: number }) => {
      const res = await apiRequest("DELETE", `/api/mail-folders/${folderId}/emails/${emailId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mail-folders", selectedFolderId, "emails"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mail-folders"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const flagMutation = useMutation({
    mutationFn: async (domain: string) => {
      const res = await apiRequest("POST", "/api/email-filters", { domain });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || "Domain block failed");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-filters"] });
      toast({ title: "Domain blocked", description: "Future emails from this domain will go to Spam." });
    },
    onError: (err: any) => toast({ title: "Block domain failed", description: err.message, variant: "destructive" }),
  });

  const unblockMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/email-filters/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-filters"] });
      toast({ title: "Domain unblocked", description: "Emails from this domain will appear in your inbox again." });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // Block an exact sender email address + move the thread to Spam.
  // Uses the blocked_senders table (not email_filters which is domain-level).
  const blockSenderMutation = useMutation({
    mutationFn: async ({ senderEmail, threadId }: { senderEmail: string; threadId: string }) => {
      await apiRequest("POST", "/api/blocked-senders", { email: senderEmail });
      const spamRes = await apiRequest("POST", `/api/inbox/threads/${encodeURIComponent(threadId)}/mark-spam`, {});
      if (!spamRes.ok) { const b = await spamRes.json(); throw new Error(b.message || "mark-spam failed"); }
      return { senderEmail, threadId };
    },
    onSuccess: ({ threadId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/blocked-senders"] });
      const removeThread = (old: any) =>
        old ? { ...old, messages: old.messages.filter((m: any) => m.threadId !== threadId) } : old;
      queryClient.setQueriesData({ queryKey: ["/api/gmail/messages", "inbox"] }, removeThread);
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages", "spam"] });
      if (selectedThreadId === threadId) { setSelectedThreadId(null); setSelectedMessageId(null); }
      invalidateBadgeQueries();
      toast({ title: "Sender blocked", description: "Moved to Spam. Future emails from this sender will be filtered." });
    },
    onError: (err: any) => toast({ title: "Block failed", description: err.message, variant: "destructive" }),
  });

  // Unblock a specific sender email address (removes from blocked_senders table).
  const unblockSenderMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/blocked-senders/${id}`);
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blocked-senders"] });
      toast({ title: "Sender unblocked", description: "Emails from this sender will appear in your inbox." });
    },
    onError: (err: any) => toast({ title: "Unblock failed", description: err.message, variant: "destructive" }),
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/gmail/sync?limit=50");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Sync complete", description: `${data.newMessages} new emails processed and matched` });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-assocs"] });
    },
    onError: (err: any) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  const deepBackfillMutation = useMutation({
    mutationFn: async (days: 30 | 90 | 365) => {
      if (!connectedAccount?.id) throw new Error("No connected account");
      const res = await apiRequest("POST", `/api/gmail/accounts/${connectedAccount.id}/deep-backfill`, { days });
      return res.json();
    },
    onSuccess: (_data, days) => {
      toast({
        title: `Catching up last ${days} days`,
        description: "Running in the background — new emails will appear as they sync in.",
      });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
      }, 8000);
    },
    onError: (err: any) => {
      toast({ title: "Backfill failed", description: err.message, variant: "destructive" });
    },
  });

  const toggleStarMutation = useMutation({
    mutationFn: async (msgId: string) => {
      const body = activeAccountId ? { asAccountId: activeAccountId } : {};
      const res = await apiRequest("POST", `/api/gmail/messages/${msgId}/toggle-star`, body);
      return res.json() as Promise<{ starred: boolean }>;
    },
    onSuccess: (data, msgId) => {
      const update = (old: { messages: MessageSummary[]; nextPageToken: string | null } | undefined) =>
        old ? { ...old, messages: old.messages.map((m) =>
          m.id === msgId ? { ...m, labelIds: data.starred
            ? [...m.labelIds.filter(l => l !== "STARRED"), "STARRED"]
            : m.labelIds.filter(l => l !== "STARRED") } : m
        ) } : old;
      queryClient.setQueriesData({ queryKey: ["/api/gmail/messages", "inbox"] }, update);
      setInboxExtra((prev) => prev.map((m) => m.id === msgId ? { ...m, labelIds: data.starred
        ? [...m.labelIds.filter(l => l !== "STARRED"), "STARRED"]
        : m.labelIds.filter(l => l !== "STARRED") } : m));
    },
    onError: (err: any) => toast({ title: "Failed to update star", description: err.message, variant: "destructive" }),
  });

  type ConnectedAccount = {
    id: number; userId: number; provider: string; emailAddress: string;
    displayName: string | null; authStatus: string; syncEnabled: boolean;
    lastSyncAt: string | null; syncErrorMessage: string | null; disconnectedAt: string | null;
    isShared: boolean; isOwner: boolean;
  };

  const statusQuery = useQuery<{ connected: boolean; tokenValid: boolean; apiEnabled: boolean; hasCredentials: boolean }>({
    queryKey: ["/api/gmail/status"],
    queryFn: async () => {
      const res = await fetch("/api/gmail/status", { credentials: "include" });
      if (!res.ok) return { connected: false, tokenValid: false, apiEnabled: true, hasCredentials: false };
      return res.json();
    },
    retry: false,
  });

  // S2: Per-user connected account(s) with live auth_status and sync metadata
  const accountsQuery = useQuery<ConnectedAccount[]>({
    queryKey: ["/api/gmail/accounts"],
    queryFn: async () => {
      const res = await fetch("/api/gmail/accounts", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 30_000,
    retry: false,
  });
  // Resolve which account is "active" — selected shared account, user's personal one, or
  // (unified mode) fall back to the personal account for compose/send semantics.
  const connectedAccount = activeAccountId === "all"
    ? (accountsQuery.data?.find((a) => a.isOwner) ?? accountsQuery.data?.[0] ?? null)
    : activeAccountId
      ? (accountsQuery.data?.find((a) => a.id === activeAccountId) ?? accountsQuery.data?.[0] ?? null)
      : (accountsQuery.data?.find((a) => a.isOwner) ?? accountsQuery.data?.[0] ?? null);

  // Multi-mailbox Phase 1: per-account health (status dots + warnings in the sidebar).
  // 30s refetch matches accountsQuery so they stay visually in sync.
  type AccountHealth = {
    id: number; emailAddress: string; displayName: string | null; isShared: boolean; isOwner: boolean;
    authStatus: string; syncEnabled: boolean; lastSyncAt: string | null; watchExpirationAt: string | null;
    lastWebhookAt: string | null; lastIncrementalSyncAt: string | null; incrementalEventCount: number;
    syncErrorMessage: string | null; unreadCount: number; messageCount: number; inboxCount?: number; lastMessageAt: string | null;
    watchHoursRemaining: number | null; lastWebhookMinAgo: number | null; status: "green" | "amber" | "red";
  };
  const accountsHealthQuery = useQuery<AccountHealth[]>({
    queryKey: ["/api/gmail/accounts", "health"],
    queryFn: async () => {
      const res = await fetch("/api/gmail/accounts/health", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 30_000,
    retry: false,
  });
  const healthById = new Map<number, AccountHealth>(
    (accountsHealthQuery.data ?? []).map((h) => [h.id, h] as const),
  );

  // ─── Commit 5: Foreground 15s polling fallback for incremental sync ─────
  //
  // Why this exists:
  //   Push (Pub/Sub) delivery is unreliable in the dev environment because
  //   Replit's container sleep terminates the long-lived listener. When push
  //   is down, the existing backend hourly tick is the only thing pulling
  //   new mail into our DB — fine for backups, terrible for "where's my
  //   live email?". This effect provides a 15s user-facing safety net.
  //
  // What it is NOT:
  //   It is NOT a duplicate of the inboxQuery 15s refetch above. That one
  //   re-reads the local DB mirror (cheap PG read). This one calls
  //   syncIncremental on the backend (Gmail history API + upsert). The two
  //   are layered: this fetches new mail INTO the DB, the inboxQuery
  //   fetches it FROM the DB into the UI.
  //
  // Race-safety:
  //   syncIncremental is idempotent end-to-end. Gmail's history.list({
  //   startHistoryId }) skips events <= startHistoryId. upsertMessageById
  //   uses onConflictDoNothing on inserts. Label-update writes are
  //   idempotent. The lastHistoryId UPDATE is a single atomic write. So
  //   this 15s tick coexists safely with the existing backend hourly tick
  //   AND any inbound push events — at worst we waste a few API calls
  //   during a race, never corrupt data.
  //
  // Endpoint reuse:
  //   No new endpoint. POST /api/gmail/sync-incremental?accountId=N
  //   already does exactly this (requireAuth + requireOwnerOrAdmin +
  //   syncIncremental). We just call it with the right cadence and gates.
  //   `requireOwnerOrAdmin`'s isOwner is `acct.userId === userId` (not
  //   `&& !isShared`), so it passes for the original creator even on
  //   accounts marked shared via the OAuth-admin-task data correction.
  //
  // Gates (all must hold for an account to be polled on a tick):
  //   1. document.visibilityState === "visible"  (don't poll a hidden tab)
  //   2. account.authStatus === "active" && syncEnabled !== false
  //   3. (now - max(lastWebhookAt, lastIncrementalSyncAt)) > 60s
  //      AND (now - lastPolledByThisHook) > 15s   (avoid spam)
  //
  // NOTE on watchExpirationAt:
  //   Watch expiration governs PUSH delivery (Pub/Sub notifications), NOT
  //   the history-API polling path that syncIncremental uses. An expired
  //   or null watchExpirationAt means push is dead for this account —
  //   which is precisely WHEN polling matters most. So we deliberately do
  //   NOT skip on expired watch; we treat watch state as orthogonal to
  //   polling viability. (An earlier draft of this hook had a "skip when
  //   watchExpirationAt < now" gate; architect review caught that as
  //   semantically backwards and it was removed in the same commit.)
  //
  // Mount point:
  //   This effect lives inside gmail-inbox.tsx, so it only runs while the
  //   user is on the inbox page. Page-mount + visibilityState together
  //   give us "visible AND on inbox page" coverage.
  const POLLING_TICK_MS = 15_000;
  const STALENESS_THRESHOLD_MS = 12_000;
  const PER_ACCOUNT_COOLDOWN_MS = 14_000;
  const lastPolledAtRef = useRef<Map<number, number>>(new Map());
  const inFlightPollRef = useRef<Set<number>>(new Set());
  const [refreshingAccounts, setRefreshingAccounts] = useState<Set<number>>(new Set());
  const [refreshingInbox, setRefreshingInbox] = useState(false);
  const healthDataRef = useRef(accountsHealthQuery.data);
  useEffect(() => { healthDataRef.current = accountsHealthQuery.data; }, [accountsHealthQuery.data]);
  useEffect(() => {
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const accounts = healthDataRef.current ?? [];
      if (accounts.length === 0) return;
      const now = Date.now();
      for (const a of accounts) {
        if (a.authStatus !== "active") continue;
        if (a.syncEnabled === false) continue;
        // (no watchExpirationAt skip — watch state governs push, not
        // polling. See the gates comment block above for full rationale.)
        if (inFlightPollRef.current.has(a.id)) continue;
        const lastSelfPoll = lastPolledAtRef.current.get(a.id) ?? 0;
        if (now - lastSelfPoll < PER_ACCOUNT_COOLDOWN_MS) continue;
        const lastWebhookMs = a.lastWebhookAt ? new Date(a.lastWebhookAt).getTime() : 0;
        const lastIncrementalMs = a.lastIncrementalSyncAt ? new Date(a.lastIncrementalSyncAt).getTime() : 0;
        const lastSyncSignalMs = Math.max(lastWebhookMs, lastIncrementalMs);
        if (now - lastSyncSignalMs < STALENESS_THRESHOLD_MS) continue;
        // Fire.
        inFlightPollRef.current.add(a.id);
        lastPolledAtRef.current.set(a.id, now);
        // Abort the fetch after 30 s so a slow/hung syncIncremental call
        // (e.g. historyId fallback to paginated sync) cannot lock inFlightPollRef
        // indefinitely and silently kill all future poll ticks for this account.
        const pollCtrl = new AbortController();
        const pollTimeout = setTimeout(() => pollCtrl.abort(), 30_000);
        fetch(`/api/gmail/sync-incremental?accountId=${a.id}`, {
          method: "POST",
          credentials: "include",
          signal: pollCtrl.signal,
        })
          .then((res) => (res.ok ? res.json() : null))
          .then((payload) => {
            const r = payload?.results?.[0];
            // Always refresh health data so the staleness-gate timestamps
            // stay accurate (without this, a zero-change sync leaves
            // healthDataRef stale and the next tick fires at the wrong cadence).
            invalidateBadgeQueries();
            if (r && (r.added > 0 || r.deleted > 0 || r.labelsChanged > 0)) {
              queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
              queryClient.invalidateQueries({ queryKey: ["/api/gmail/threads"] });
            }
          })
          .catch(() => { /* swallow — next tick will retry */ })
          .finally(() => {
            clearTimeout(pollTimeout);
            inFlightPollRef.current.delete(a.id);
          });
      }
    };
    // Run once immediately so a freshly-opened inbox doesn't wait 15s.
    tick();
    const handle = setInterval(tick, POLLING_TICK_MS);
    // Tab-visibility wake-up: when the user comes back to the tab after a
    // blur, run a tick immediately instead of waiting up to 15s for the
    // next interval. This is the most common "show me new mail" moment.
    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") tick();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    return () => {
      clearInterval(handle);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, []); // empty deps — interval mounts once; healthDataRef tracks fresh data.

  const handleRefreshAccount = async (accountId: number) => {
    if (refreshingAccounts.has(accountId)) return;
    setRefreshingAccounts((prev) => new Set(prev).add(accountId));
    try {
      const res = await fetch(`/api/gmail/sync-incremental?accountId=${accountId}`, { method: "POST", credentials: "include" });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
        queryClient.invalidateQueries({ queryKey: ["/api/gmail/threads"] });
        invalidateBadgeQueries();
      }
    } catch { /* swallow */ }
    finally {
      setRefreshingAccounts((prev) => { const s = new Set(prev); s.delete(accountId); return s; });
    }
  };

  /** Triggered by the top-right refresh button.
   *  Fires POST /api/gmail/sync-incremental?accountId=N for each of the user's
   *  active connected accounts (in parallel, with a 30 s per-account timeout),
   *  then invalidates the message/thread caches so the UI shows fresh data.
   *
   *  WHY per-account (not the no-accountId global path):
   *    POST /api/gmail/sync-incremental (no accountId) requires ADMIN — non-admin
   *    users would get a silent 403 and the button would only re-read the cached
   *    DB without ever fetching from Gmail.  The ?accountId=N path uses
   *    requireOwnerOrAdmin, which passes for any account owned by the caller. */
  const handleRefreshInbox = async () => {
    if (refreshingInbox) return;
    setRefreshingInbox(true);
    try {
      const accounts = healthDataRef.current ?? [];
      const active = accounts.filter(
        (a) => a.authStatus === "active" && a.syncEnabled !== false,
      );
      if (active.length === 0) {
        // No known accounts yet (health query still loading) — nothing to sync.
        return;
      }
      await Promise.all(
        active.map((a) => {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 30_000);
          return fetch(`/api/gmail/sync-incremental?accountId=${a.id}`, {
            method: "POST",
            credentials: "include",
            signal: ctrl.signal,
          })
            .catch(() => { /* swallow — invalidate happens in finally */ })
            .finally(() => clearTimeout(t));
        }),
      );
    } catch { /* swallow */ }
    finally {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/threads"] });
      invalidateBadgeQueries();
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/triage-summary"] });
      setRefreshingInbox(false);
    }
  };

  // Shared accounts visible to this user — filtered by mail_team permissions.
  // Non-admins require an explicit view grant; no grant = no access.
  const sharedAccounts = (accountsQuery.data ?? []).filter((a) => {
    if (a.isOwner) return false;
    if (isAdmin) return true;
    const entry = mailTeamPerms[String(a.id)];
    return entry?.view === true;
  });
  const personalAccount = (accountsQuery.data ?? []).find((a) => a.isOwner) ?? null;

  // Helper to append asAccountId to URLSearchParams when viewing a shared account
  const appendAccountId = (params: URLSearchParams) => {
    // null means "All Inboxes" unified view — send asAccountId=all so backend
    // queries span all accounts (same scope as serverInboxUnreadCount / health).
    if (activeAccountId === null) {
      params.set("asAccountId", "all");
    } else {
      params.set("asAccountId", String(activeAccountId));
    }
  };

  // Invalidates both badge-count queries together so they always re-fetch as a pair.
  // Call this after any mailbox mutation that can change unread counts (archive, trash,
  // mark-read, sync). Using a single helper ensures no mutation accidentally refreshes
  // only one of the two queries and creates a mixed-freshness display.
  const invalidateBadgeQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/gmail/accounts", "health"] });
    queryClient.invalidateQueries({ queryKey: ["/api/gmail/category-counts"] });
  };

  // canSend: account must be active AND user must have edit permission for shared inboxes.
  // In "all" (unified) mode we route compose through the personal account, so permission
  // logic mirrors the personal-account case (always allowed if active).
  const canSend = (() => {
    if (connectedAccount?.authStatus !== "active") return false;
    if (activeAccountId === "all") return true;
    // Shared account: check mail_team edit permission
    if (activeAccountId && !connectedAccount?.isOwner) {
      if (isAdmin) return true;
      const entry = mailTeamPerms[String(activeAccountId)];
      if (entry) return entry.edit !== false && entry.view !== false;
    }
    return true;
  })();

  // Build the server-side query filter for the current inbox category.
  // Category sub-inbox views fetch ONLY relevant messages from the server so
  // the first page already contains useful data — prevents the "People spins"
  // issue where the loader had to page through thousands of mixed-category messages.
  // "in:people" uses the custom filter added to buildQClauses in local-mailbox.ts
  // (INBOX + no CATEGORY_* labels). All other category queries use Gmail's own
  // "in:<category>" syntax which buildQClauses already maps to CATEGORY_* labels.
  const inboxCategoryQ = useMemo(() => {
    if (searchQuery) return searchQuery;
    if (inboxCategory === "people")     return "in:people is:unread";
    if (inboxCategory === "updates")    return "in:updates is:unread";
    if (inboxCategory === "promotions") return "in:promotions is:unread";
    if (inboxCategory === "social")     return "in:social is:unread";
    if (inboxCategory === "forums")     return "in:forums is:unread";
    return "in:inbox";
  }, [searchQuery, inboxCategory]);

  const inboxQuery = useQuery<{ messages: MessageSummary[]; nextPageToken: string | null }>({
    // When crmFilter==="unread" the query is always "in:inbox is:unread" regardless of which
    // category sub-tab is selected — category filtering is done client-side via categorizedInbox.
    // Using "all" as the inboxCategory key segment means every category tab shares the same
    // cached page, avoiding duplicate fetches and cursor mismatches between page 1 and page 2+.
    queryKey: inboxQueryKey(searchQuery, activeAccountId, inboxCategory, crmFilter),
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", "50");
      // When the Unread filter is active, push "is:unread" to the backend so it only returns
      // unread messages.  Without this the server returns 50 newest messages sorted by date
      // (99% read for a typical busy inbox), the client-side filter hides most of them, and
      // the user sees only a handful of unread rows even though hundreds exist in the DB.
      //
      // IMPORTANT: when unread mode is active we always send "in:inbox is:unread" — NOT the
      // category-specific inboxCategoryQ (e.g. "in:inbox in:people is:unread"). buildQClauses
      // only knows how to handle "in:<label>" prefixes that it explicitly recognises; anything
      // else falls through as freetext and gets treated as a full-text search. "in:people" as
      // freetext causes the SQL to add a plainto_tsquery("people") condition, which silently
      // restricts the first page to messages mentioning the word "people", while loadMoreInbox
      // (which sends plain "in:inbox is:unread") fetches a completely different data set — the
      // cursor from page 1 then misaligns against page 2+. By sending the same plain query from
      // both inboxQuery and loadMoreInbox, the pagination stays coherent and category filtering
      // is handled entirely client-side via categorizedInbox / getEmailCategory.
      if (crmFilter === "unread") {
        params.set("q", searchQuery ? `${searchQuery} is:unread` : "in:inbox is:unread");
      } else {
        params.set("q", inboxCategoryQ);
      }
      appendAccountId(params);
      const res = await fetch(`/api/gmail/messages?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    // Premium-client cadence: 15s foreground poll over the local mirror
    // (cheap PG read of already-webhook-synced data). The background-poll
    // gate keeps us from burning cycles on a tab the user isn't looking at.
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Commit 6: "X new messages" top-of-list pill (Superhuman/Gmail style).
  // ──────────────────────────────────────────────────────────────────────────
  // Lives RIGHT AFTER inboxQuery (TDZ — the detection effect closes over
  // inboxQuery.data?.messages and includes it in its deps array, so the
  // declaration must precede this block).
  //
  // Detection trigger: watch inboxQuery.data?.messages DIRECTLY (NOT the
  // polling fetch event). This naturally serializes AFTER the local mirror
  // update — addresses the user-flagged race-condition concern: "appear AFTER
  // the new mail lands in the local mirror, not as a blind 'polling fired'
  // trigger." It also covers ALL sources of new mail with one detection
  // path: the Commit 5 foreground 15s tick, push delivery (when working in
  // production), and the backend hourly tick.
  //
  // View-scope semantics: the pill is per (account, tab, searchQuery) tuple
  // — those are the segments that change the inbox queryKey AND the
  // user-perceived view. Switching account, tab, OR search resets the
  // baseline silently with no pill (we just adopted a different dataset;
  // "new since I started looking" is undefined). The client-side filters
  // (inboxCategory, crmFilter) do NOT reset — those narrow the same
  // underlying data, and the pill counts new arrivals in the underlying
  // inbox regardless of the active category filter (matches Gmail behavior).
  //
  // Counting algorithm: walk the new messages array from the top until we
  // hit an id we've seen — that prefix is the new-arrivals count. Robust to
  // pagination because Gmail orders newest-first and pagination appends at
  // the BOTTOM, so the loop short-circuits at the top.
  //
  // Scroll-position gate: scrollTop < 50px = "at top" (50px tolerance for
  // sub-pixel scroll states / inertia). When at top, baseline advances
  // silently; new mail just appears in place per the user spec ("If the
  // user is already at the top, no pill — the new email just appears at the
  // top naturally").
  //
  // Click contract: smooth-scroll to top + reset count + (baseline already
  // current). ZERO invalidateQueries / refetch — local mirror is current,
  // messages are already rendered just above the current scroll fold.
  const inboxScrollRef = useRef<HTMLDivElement>(null);
  const lastSeenInboxIdsRef = useRef<Set<string>>(new Set());
  const lastSeenViewKeyRef = useRef<string>("");
  const [newMessagesCount, setNewMessagesCount] = useState(0);
  const [isAtTop, setIsAtTop] = useState(true);

  useEffect(() => {
    const messages = inboxQuery.data?.messages ?? [];
    const viewKey = `${activeAccountId ?? "personal"}|${tab}|${searchQuery}`;

    // View change → silently reset baseline, never pop a pill.
    if (viewKey !== lastSeenViewKeyRef.current) {
      lastSeenViewKeyRef.current = viewKey;
      lastSeenInboxIdsRef.current = new Set(messages.map((m) => m.id));
      // Functional setState avoids reading newMessagesCount in deps (which
      // would self-retrigger this effect on every count change).
      setNewMessagesCount((prev) => (prev !== 0 ? 0 : prev));
      return;
    }

    // First non-empty data after a view change with empty baseline → adopt
    // as baseline silently. Without this guard, the very first data tick
    // would count all 50 messages as "new" and (if the user is scrolled)
    // pop a misleading "50 new messages" pill on initial load.
    const seen = lastSeenInboxIdsRef.current;
    if (seen.size === 0 && messages.length > 0) {
      lastSeenInboxIdsRef.current = new Set(messages.map((m) => m.id));
      return;
    }

    // Count new arrivals at the top of the list.
    let newArrivals = 0;
    for (const m of messages) {
      if (seen.has(m.id)) break;
      newArrivals++;
    }

    // Walked to the end without finding ANY known id. Either a long polling
    // gap rotated the entire 50-row window, or some upstream view-shape
    // change we can't reason about safely. Don't pop a misleading
    // "50 new messages" pill — silently re-baseline.
    if (newArrivals === messages.length && messages.length > 0) {
      lastSeenInboxIdsRef.current = new Set(messages.map((m) => m.id));
      return;
    }

    if (newArrivals === 0) return;

    // Always advance the baseline on a real new-arrivals tick — prevents
    // double-counting on the next data update. The pill count is the
    // running tally of "unseen at top, since the last user acknowledgement
    // (scroll-to-top or click)."
    lastSeenInboxIdsRef.current = new Set(messages.map((m) => m.id));
    if (!isAtTop) {
      setNewMessagesCount((prev) => prev + newArrivals);
    }
    // If isAtTop: baseline advances, count stays at 0 → no pill. The user
    // is already looking at the top of the list; the new mail just renders
    // in place.
  }, [inboxQuery.data?.messages, activeAccountId, tab, searchQuery, isAtTop]);

  // Scroll listener — updates isAtTop AND auto-dismisses the pill the
  // moment the user reaches the top (whether by smooth-scroll click or
  // manual scroll). Auto-dismiss avoids the surreal state of "user is
  // looking at the top of the inbox, sees the new emails right there, pill
  // still says '5 new messages' pointing where they already are."
  useEffect(() => {
    const el = inboxScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const top = el.scrollTop < 50;
      setIsAtTop(top);
      if (top) setNewMessagesCount((c) => (c > 0 ? 0 : c));
    };
    // Run once on mount in case the container starts mid-scroll (rare but
    // possible after browser scroll-restoration on hard-refresh).
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
    // tab in deps so the listener re-attaches when the underlying scroll
    // container DOM node may have changed via React tree reshuffles, and
    // the initial onScroll() call resets isAtTop correctly for the new view.
  }, [tab]);

  const handleScrollToTop = useCallback(() => {
    const el = inboxScrollRef.current;
    if (el) {
      try {
        el.scrollTo({ top: 0, behavior: "smooth" });
      } catch {
        // Fallback for very old browsers without smooth-scroll support.
        el.scrollTop = 0;
      }
    }
    setNewMessagesCount(0);
    // Baseline is already up-to-date from the detection-effect's increment
    // branch; no change needed here. Critically: we do NOT call
    // invalidateQueries or refetch. The new mail is already in the local
    // mirror and already rendered in the list above the current scroll
    // position — a refetch would be wasted bandwidth AND would risk a flash
    // of the skeleton state during the refetch window.
  }, []);

  // ── Commit 7: Auto 1-year backfill on OAuth — visible progress banner ──
  // (Originally Commit 7 shipped a 90-day default; widened to 365 days /
  // 1 year on 2026-04-28 per product decision — see gmail-oauth.ts header
  // comment for rationale.)
  // Polls /api/my/mailbox/backfill/status to surface a sticky banner at the
  // top of the inbox showing import progress. Backed by the existing
  // backfill_jobs table; new rows are created automatically on OAuth
  // completion (gmail-oauth.ts autoEnqueueBackfillForNewAccount) for the
  // last year of history.
  //
  // Refetch interval is GATED on job state: 5s while there's an in-flight
  // job (pending/running/cancelling) for the active account, plus a 30s
  // tail after a terminal transition so the user sees the resolution land,
  // then paused. This keeps the poll frequency tight while real work is
  // happening but avoids hammering the endpoint when nothing is going on.
  //
  // The Stop button calls /backfill/cancel which sets status='cancelling';
  // the runBackfillJob worker re-reads status at every page boundary
  // (~5–15s) and exits cleanly to status='cancelled', preserving
  // last_page_token. The Resume button calls /backfill/resume which sets
  // status back to 'pending' and re-fires the worker — it picks up from
  // last_page_token. Both endpoints are owner-scoped and 409 if a job is
  // already in flight.
  type BackfillJobRow = {
    id: number;
    emailAccountId: number;
    emailAddress: string | null;
    status: "pending" | "running" | "completed" | "failed" | "cancelling" | "cancelled";
    dateFrom: string | null;
    dateTo: string | null;
    processed: number | null;
    totalEstimate: number | null;
    errorMessage: string | null;
    createdAt: string;
    updatedAt: string | null;
    completedAt: string | null;
  };

  const backfillStatusQuery = useQuery<BackfillJobRow[]>({
    queryKey: ["/api/my/mailbox/backfill/status"],
    refetchInterval: (query) => {
      const data = query.state.data as BackfillJobRow[] | undefined;
      if (!data || data.length === 0) return false;
      const hasActive = data.some(
        (j) => j.status === "pending" || j.status === "running" || j.status === "cancelling"
      );
      if (hasActive) return 5_000;
      // Recently terminal — keep polling briefly so the user sees the
      // resolution arrive (and the banner disappear / flip to ✓ Complete).
      const now = Date.now();
      const recentlyTerminal = data.some((j) => {
        const t = j.updatedAt ? Date.parse(j.updatedAt) : 0;
        return Number.isFinite(t) && now - t < 30_000;
      });
      return recentlyTerminal ? 5_000 : false;
    },
    refetchIntervalInBackground: false,
  });

  // Resolve the most-recent job for the currently active mailbox view.
  // "all" view shows the most-recent active job across any account so the
  // user knows something's still happening even when not focused on it.
  const activeBackfillJob = useMemo<BackfillJobRow | null>(() => {
    const rows = backfillStatusQuery.data ?? [];
    if (rows.length === 0) return null;
    const filtered =
      activeAccountId === "all" || activeAccountId == null
        ? rows
        : rows.filter((j) => j.emailAccountId === activeAccountId);
    if (filtered.length === 0) return null;
    const sorted = [...filtered].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    );
    return sorted[0];
  }, [backfillStatusQuery.data, activeAccountId]);

  // Show banner for any in-flight state, plus a 30s tail after a terminal
  // transition so the user sees the resolution. Hidden entirely otherwise.
  const shouldShowBackfillBanner = useMemo(() => {
    if (!activeBackfillJob) return false;
    const s = activeBackfillJob.status;
    if (s === "pending" || s === "running" || s === "cancelling") return true;
    const t = activeBackfillJob.updatedAt ? Date.parse(activeBackfillJob.updatedAt) : 0;
    return Number.isFinite(t) && Date.now() - t < 30_000;
  }, [activeBackfillJob]);

  const cancelBackfillMut = useMutation({
    mutationFn: async (accountId: number) => {
      const res = await apiRequest("POST", `/api/my/mailbox/${accountId}/backfill/cancel`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my/mailbox/backfill/status"] });
      toast({
        title: "Stopping import…",
        description: "Will pause cleanly at the next batch boundary.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't stop import",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    },
  });

  const resumeBackfillMut = useMutation({
    mutationFn: async (accountId: number) => {
      const res = await apiRequest("POST", `/api/my/mailbox/${accountId}/backfill/resume`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my/mailbox/backfill/status"] });
      toast({ title: "Resuming import…" });
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't resume import",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    },
  });

  const sentQuery = useQuery<{ messages: MessageSummary[]; nextPageToken: string | null }>({
    queryKey: ["/api/gmail/messages", "sent", searchQuery, activeAccountId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", "50");
      params.set("q", searchQuery ? `in:sent ${searchQuery}` : "in:sent");
      appendAccountId(params);
      const res = await fetch(`/api/gmail/messages?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    enabled: tab === "sent",
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const spamQuery = useQuery<{ messages: MessageSummary[]; nextPageToken: string | null }>({
    queryKey: ["/api/gmail/messages", "spam", searchQuery, activeAccountId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", "50");
      params.set("q", searchQuery ? `in:spam ${searchQuery}` : "in:spam");
      appendAccountId(params);
      const res = await fetch(`/api/gmail/messages?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    enabled: tab === "spam",
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  // Category folder query — fetches messages for whichever category tab is active.
  // Uses the same /api/gmail/messages endpoint with in:<category> q-filter;
  // the backend local-mailbox layer maps in:updates → CATEGORY_UPDATES, etc.
  const categoryQuery = useQuery<{ messages: MessageSummary[]; nextPageToken: string | null }>({
    queryKey: ["/api/gmail/messages", "category", tab, searchQuery, activeAccountId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", "50");
      params.set("q", searchQuery ? `in:${tab} ${searchQuery}` : `in:${tab}`);
      appendAccountId(params);
      const res = await fetch(`/api/gmail/messages?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    enabled: isCategoryTab,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  // Category sidebar badge counts — total + unread per category, polled every 60s.
  const categoryCountsQuery = useQuery<{
    updates:    { total: number; unread: number };
    promotions: { total: number; unread: number };
    social:     { total: number; unread: number };
    forums:     { total: number; unread: number };
    people?:    { total: number; unread: number };
  }>({
    queryKey: ["/api/gmail/category-counts", activeAccountId],
    queryFn: async () => {
      const params = new URLSearchParams();
      appendAccountId(params);
      const res = await fetch(`/api/gmail/category-counts?${params}`, { credentials: "include" });
      if (!res.ok) return { updates: { total: 0, unread: 0 }, promotions: { total: 0, unread: 0 }, social: { total: 0, unread: 0 }, forums: { total: 0, unread: 0 } };
      return res.json();
    },
    refetchInterval: 30_000,   // aligned with accounts/health — both 30 s so they refresh together
    refetchIntervalInBackground: false,
  });

  const inboxBaseToken = inboxQuery.data?.nextPageToken ?? null;
  const sentBaseToken = sentQuery.data?.nextPageToken ?? null;

  // Pagination state hygiene (Commit 1.1 split — fixes stale-token leak on
  // context change). Two effects with disjoint responsibilities:
  //   * Effect A (context-change reset): clears extras + nulls nextToken
  //     when the user changes search/account. Does NOT depend on baseToken
  //     so background refetches don't trip it.
  //   * Effect B (base-token adoption): when nextToken is null (fresh slate)
  //     and baseToken arrives, adopt baseToken as the cursor. When nextToken
  //     is non-null (mid-pagination), leave it alone — preserves the user's
  //     scroll position across background refetches.
  // (Pre-Commit-4 these deps also included `mailSource` to handle the
  // gmail↔local toggle; that toggle no longer exists.)
  useEffect(() => {
    setInboxExtra([]);
    setInboxNextToken(null);
    setSectionLoadingIds(new Set());
    setSectionFetchDoneIds(new Set());
    // inboxCategory is included because each category tab now sends its own specific
    // query ("in:social is:unread", "in:people is:unread", …).  Without this, the
    // cursor from a previous category view would persist when switching tabs — Effect B
    // would not adopt the new category cursor (prev !== null) and page 2+ would fetch
    // the wrong partition.
    // crmFilter is included so switching to/from the Unread pill resets pagination:
    // the base query changes (unread-only vs all), and stale extra pages from the
    // previous filter must not bleed into the new view.
  }, [searchQuery, activeAccountId, crmFilter, inboxCategory]);
  useEffect(() => {
    setInboxNextToken((prev) => prev ?? inboxBaseToken);
  }, [inboxBaseToken]);
  // Sent reset deps must mirror the sent base query's filter axes. Sent's q is
  // `in:sent ± searchQuery`, so a search change while on inbox would otherwise
  // leave a stale sentNextToken that survives the switch back to sent — Effect
  // D's `prev ?? base` adopt is gated on prev being null and would not refresh
  // it. Including searchQuery here keeps sent symmetric with inbox.
  useEffect(() => {
    setSentExtra([]);
    setSentNextToken(null);
  }, [searchQuery, activeAccountId]);
  useEffect(() => {
    setSentNextToken((prev) => prev ?? sentBaseToken);
  }, [sentBaseToken]);

  // Pagination request-epoch guard (Apr 2026, hardening pass 2 + pass 4 expanded context). When
  // the user switches mailbox, search query, source, OR tab/category/CRM filter while a loadMore
  // is in flight, the in-flight response would otherwise be appended to the NEW context (leaking
  // old-mailbox rows OR causing autoChain budget reset to fire against stale extras). We bump
  // the epoch on every context change and drop late responses whose epoch no longer matches.
  // Tab is included even though inbox/other share data, because a tab change can race with reset.
  const inboxEpochRef = useRef(0);
  const sentEpochRef = useRef(0);
  useEffect(() => { inboxEpochRef.current += 1; }, [activeAccountId, searchQuery, tab, inboxCategory, crmFilter]);
  useEffect(() => { sentEpochRef.current += 1; }, [activeAccountId, searchQuery, tab]);

  // Inbox debug instrumentation — opt-in via `localStorage.inbox_debug=1`. Logs every fetch's
  // full context, raw vs visible count, drop-on-stale-epoch, and auto-chain decisions. Stripped
  // from production via the localStorage gate; safe to leave in code.
  const dbg = (label: string, payload: Record<string, unknown>) => {
    if (typeof window !== "undefined" && window.localStorage?.getItem("inbox_debug") === "1") {
      // eslint-disable-next-line no-console
      console.log(`[inbox] ${label}`, payload);
    }
  };

  const loadMoreInbox = async () => {
    if (!inboxNextToken || loadingMoreInbox) return;
    const requestEpoch = inboxEpochRef.current;
    const ctxKey = `acct=${activeAccountId ?? ""}|tab=${tab}|q=${searchQuery}|cat=${inboxCategory}|crm=${crmFilter}`;
    dbg("loadMoreInbox:fire", { ctx: ctxKey, epoch: requestEpoch, token: inboxNextToken });
    setLoadingMoreInbox(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", "50");
      // Mirror the exact base query used by inboxQuery (page 1) so page 2+ stays in the
      // same data partition.  Category tabs now send "in:<cat> is:unread" so loadMore must
      // use the same query — previously it hard-coded "in:inbox", which would mix all-inbox
      // messages into a category-specific view and misalign the cursor.
      // When the Unread pill (crmFilter="unread") is active the base is always "in:inbox is:unread"
      // regardless of category, matching the wide partition inboxQuery uses in that mode.
      const pageQ = crmFilter === "unread"
        ? (searchQuery ? `${searchQuery} is:unread` : "in:inbox is:unread")
        : (searchQuery || inboxCategoryQ);
      params.set("q", pageQ);
      params.set("pageToken", inboxNextToken);
      appendAccountId(params);
      const res = await fetch(`/api/gmail/messages?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error();
      const data: { messages: MessageSummary[]; nextPageToken: string | null } = await res.json();
      // Drop the response if the user changed mailbox/search/source/tab/category/crmFilter mid-flight.
      // CRITICAL: malformed pagination state (missing nextPageToken on a successful response with
      // rows) is treated as "more may exist" — we never set hasMore=false on ambiguous responses.
      if (inboxEpochRef.current !== requestEpoch) {
        dbg("loadMoreInbox:dropped-stale-epoch", { ctx: ctxKey, requestEpoch, currentEpoch: inboxEpochRef.current });
        return;
      }
      // Dedup against what's already loaded (base page + extras) — local/gmail overlap can echo ids
      let freshCount = 0;
      setInboxExtra((prev) => {
        const known = new Set<string>([
          ...(inboxQuery.data?.messages || []).map((m) => m.id),
          ...prev.map((m) => m.id),
        ]);
        const fresh = data.messages.filter((m) => !known.has(m.id));
        freshCount = fresh.length;
        return [...prev, ...fresh];
      });
      // Token-update hardening: trust the response only when it explicitly says exhaustion
      // (nextPageToken === null) OR hands us a new token (string). If the field is missing
      // entirely (undefined) AND we received rows, treat as ambiguous and preserve the prior
      // token so "all caught up" cannot appear from a malformed payload.
      const ambiguous = data.nextPageToken === undefined && data.messages.length > 0;
      if (!ambiguous) setInboxNextToken(data.nextPageToken ?? null);
      dbg("loadMoreInbox:done", { ctx: ctxKey, raw: data.messages.length, fresh: freshCount, nextToken: data.nextPageToken, ambiguous });
    } catch (err: any) {
      // Error path: NEVER clear inboxNextToken — preserves hasMore=true so "all caught up" cannot
      // appear. Surface a retry toast; existing rows stay rendered (shadcn toast pattern).
      dbg("loadMoreInbox:error", { ctx: ctxKey, error: err?.message ?? String(err) });
      toast({ title: "Failed to load more — tap Load more to retry", variant: "destructive" });
    } finally {
      setLoadingMoreInbox(false);
    }
  };

  const loadMoreSent = async () => {
    if (!sentNextToken || loadingMoreSent) return;
    const requestEpoch = sentEpochRef.current;
    const ctxKey = `acct=${activeAccountId ?? ""}|tab=sent|q=${searchQuery}`;
    dbg("loadMoreSent:fire", { ctx: ctxKey, epoch: requestEpoch, token: sentNextToken });
    setLoadingMoreSent(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", "50");
      params.set("q", searchQuery ? `in:sent ${searchQuery}` : "in:sent");
      params.set("pageToken", sentNextToken);
      appendAccountId(params);
      const res = await fetch(`/api/gmail/messages?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error();
      const data: { messages: MessageSummary[]; nextPageToken: string | null } = await res.json();
      if (sentEpochRef.current !== requestEpoch) {
        dbg("loadMoreSent:dropped-stale-epoch", { ctx: ctxKey, requestEpoch, currentEpoch: sentEpochRef.current });
        return;
      }
      let freshCount = 0;
      setSentExtra((prev) => {
        const known = new Set<string>([
          ...(sentQuery.data?.messages || []).map((m) => m.id),
          ...prev.map((m) => m.id),
        ]);
        const fresh = data.messages.filter((m) => !known.has(m.id));
        freshCount = fresh.length;
        return [...prev, ...fresh];
      });
      // Same ambiguous-token guard as inbox path.
      const ambiguous = data.nextPageToken === undefined && data.messages.length > 0;
      if (!ambiguous) setSentNextToken(data.nextPageToken ?? null);
      dbg("loadMoreSent:done", { ctx: ctxKey, raw: data.messages.length, fresh: freshCount, nextToken: data.nextPageToken, ambiguous });
    } catch (err: any) {
      dbg("loadMoreSent:error", { ctx: ctxKey, error: err?.message ?? String(err) });
      toast({ title: "Failed to load more — tap Load more to retry", variant: "destructive" });
    } finally {
      setLoadingMoreSent(false);
    }
  };

  // ── Per-section "load all" for Smart Inbox ─────────────────────────────────
  // When the user clicks "Show loaded (N of M)" on a Smart Inbox section header
  // and M > N, this fetches all remaining pages of the category-specific query
  // (e.g. "in:people is:unread" for the People section) and appends them to
  // inboxExtra, which flows into inboxMain → viewItems.  After fetching, the
  // section is auto-expanded to show all messages without a second click.
  // Sections that map to multiple categories (newsletters = promotions+forums,
  // notifications = updates+social) fetch each sub-category in sequence.
  const SECTION_FETCH_QUERIES: Partial<Record<SmartSectionId, string[]>> = {
    "unread-people":        ["in:people is:unread"],
    "unread-newsletters":   ["in:promotions is:unread", "in:forums is:unread"],
    "unread-notifications": ["in:updates is:unread", "in:social is:unread"],
  };
  const SECTION_DISPLAY_NAMES: Partial<Record<SmartSectionId, string>> = {
    "unread-people":        "People",
    "unread-newsletters":   "newsletter",
    "unread-notifications": "notification",
  };

  const loadAllForSection = async (sectionId: SmartSectionId) => {
    if (sectionLoadingIds.has(sectionId) || sectionFetchDoneIds.has(sectionId)) return;
    const queries = SECTION_FETCH_QUERIES[sectionId];
    if (!queries || queries.length === 0) {
      setExpandedSections(prev => { const s = new Set(prev); s.add(sectionId); return s; });
      return;
    }
    setSectionLoadingIds(prev => new Set([...prev, sectionId]));
    try {
      for (const q of queries) {
        let pageToken: string | null = null;
        let safetyPages = 0;
        while (safetyPages < 20) {
          const params = new URLSearchParams();
          params.set("limit", "50");
          params.set("q", q);
          if (pageToken) params.set("pageToken", pageToken);
          appendAccountId(params);
          const res = await fetch(`/api/gmail/messages?${params}`, { credentials: "include" });
          if (!res.ok) throw new Error("fetch failed");
          const data: { messages: MessageSummary[]; nextPageToken: string | null } = await res.json();
          setInboxExtra(prev => {
            const known = new Set<string>([
              ...(inboxQuery.data?.messages || []).map(m => m.id),
              ...prev.map(m => m.id),
            ]);
            const fresh = data.messages.filter(m => !known.has(m.id));
            return fresh.length > 0 ? [...prev, ...fresh] : prev;
          });
          if (!data.nextPageToken) break;
          pageToken = data.nextPageToken;
          safetyPages++;
        }
      }
      setSectionFetchDoneIds(prev => new Set([...prev, sectionId]));
    } catch {
      toast({ title: "Failed to load — please try again", variant: "destructive" });
    } finally {
      setSectionLoadingIds(prev => { const s = new Set(prev); s.delete(sectionId); return s; });
      setExpandedSections(prev => { const s = new Set(prev); s.add(sectionId); return s; });
    }
  };

  // Multi-mailbox Phase 1: thread-scoped account id. In unified mode ("all" sentinel OR the
  // null initial state — both map to asAccountId=all in the list query) we resolve to the
  // specific source account of the open message so we avoid the "all" → NaN coercion on
  // routes that still parse asAccountId as a plain Number.
  // IMPORTANT: null and "all" are both "unified inbox" modes (appendAccountId sends
  // asAccountId=all for both).  Previously only "all" was treated as unified here, leaving
  // null acting like a specific account with no ID — causing cross-account 404s.
  const isUnifiedInboxMode = activeAccountId === "all" || activeAccountId === null;
  const threadAccountId: number | null = isUnifiedInboxMode
    ? currentThreadAccountId
    : (typeof activeAccountId === "number" ? activeAccountId : null);

  const threadQuery = useQuery<Thread>({
    queryKey: ["/api/gmail/threads", selectedThreadId, threadAccountId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (threadAccountId) params.set("asAccountId", String(threadAccountId));
      const qs = params.toString() ? `?${params}` : "";
      const res = await fetch(`/api/gmail/threads/${selectedThreadId}${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({ message: `HTTP ${res.status}` }))).message);
      return res.json();
    },
    // In unified mode (activeAccountId is "all" OR null) the correct asAccountId comes from
    // currentThreadAccountId which is set in the same handleSelectMessage batch as
    // selectedThreadId. Holding the query until that value is populated prevents a spurious
    // first-fire with no asAccountId that resolves to the primary account and returns 404 for
    // messages owned by secondary accounts.
    enabled: !!selectedThreadId && (!isUnifiedInboxMode || currentThreadAccountId !== null),
  });

  const profileQuery = useQuery({
    queryKey: ["/api/gmail/profile", activeAccountId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (activeAccountId) params.set("asAccountId", String(activeAccountId));
      const qs = params.toString() ? `?${params}` : "";
      const res = await fetch(`/api/gmail/profile${qs}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    retry: false,
  });

  type DraftSummary = { id: string; to: string; subject: string; date: string; snippet: string; internalDate: string };
  type ScheduledEmail = { id: number; to: string; subject: string | null; scheduledAt: string; createdAt: string; status: string; error: string | null; sentAt: string | null; sentMessageId: string | null };

  const draftsQuery = useQuery<DraftSummary[]>({
    queryKey: ["/api/gmail/drafts", activeAccountId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (activeAccountId) params.set("asAccountId", String(activeAccountId));
      const qs = params.toString() ? `?${params}` : "";
      const res = await fetch(`/api/gmail/drafts${qs}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: canSend,
  });

  const scheduledQuery = useQuery<ScheduledEmail[]>({
    queryKey: ["/api/gmail/scheduled"],
    queryFn: async () => {
      const res = await fetch("/api/gmail/scheduled", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: canSend && tab === "scheduled",
    refetchInterval: canSend && tab === "scheduled" ? 30000 : false,
  });

  const cancelScheduledMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/gmail/scheduled/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/scheduled"] });
      toast({ title: "Scheduled email cancelled" });
    },
  });

  // C4: Retry a failed scheduled send — resets status to pending so the scheduler picks it up.
  const retryScheduledMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/gmail/scheduled/${id}/retry`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/scheduled"] });
      toast({ title: "Retry scheduled", description: "Email will be sent within ~30 seconds." });
    },
    onError: (err: any) => {
      setTrustEvent({ type: "scheduled-failed", at: Date.now() });
      trustEventTimerRef.current = setTimeout(() => setTrustEvent(null), 6000);
      toast({ title: "Retry failed", description: err.message, variant: "destructive" });
    },
  });

  // Review queue — unconfirmed auto-associations needing human review
  const reviewStatsQuery = useQuery<{ needsReview: number }>({
    queryKey: ["/api/gmail/review-queue/stats"],
    queryFn: async () => {
      const res = await fetch("/api/gmail/review-queue/stats", { credentials: "include" });
      if (!res.ok) return { needsReview: 0 };
      return res.json();
    },
    refetchInterval: 60000,
  });

  // Domains that belong to VoltSafe and must never be used as auto-link targets.
  const INTERNAL_DOMAINS = new Set(["voltsafe.com"]);

  // Extract clean domain from an email address string that may contain a display
  // name in angle-bracket format: "Name <email@domain>" or plain "email@domain".
  // Handles semicolon-separated lists as well as comma-separated.
  function extractEmailDomain(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    // Strip display name: "Name <email@domain.com>" → "email@domain.com"
    const angleMatch = trimmed.match(/<([^>]+)>/);
    const email = angleMatch ? angleMatch[1].trim() : trimmed;
    const atIdx = email.lastIndexOf("@");
    if (atIdx < 0) return null;
    const domain = email.slice(atIdx + 1).toLowerCase().trim();
    return domain || null;
  }

  // Resolve the best external domain for an auto-link rule:
  // - If the sender is external, use their domain.
  // - If the sender is internal (outbound email), scan TO/CC for the first external recipient domain.
  // - Returns null if no valid external domain can be found.
  function resolveAutoLinkDomain(item: ReviewQueueItem): string | null {
    const senderDomain = extractEmailDomain(item.latestMessage.fromEmail ?? "");
    if (senderDomain && !INTERNAL_DOMAINS.has(senderDomain)) return senderDomain;

    // Outbound email — find the first external TO or CC recipient domain.
    // Split on both comma and semicolon to handle all RFC-style formats.
    const rawAddrs = [
      ...(item.latestMessage.toEmails ?? "").split(/[,;]/),
      ...(item.latestMessage.ccEmails ?? "").split(/[,;]/),
    ];
    for (const addr of rawAddrs) {
      const domain = extractEmailDomain(addr);
      if (domain && !INTERNAL_DOMAINS.has(domain)) return domain;
    }
    return null;
  }

  type ReviewQueueItem = {
    gmailThreadId: string;
    gmailAccountId: number | null;
    latestMessage: {
      id: number;
      subject: string | null;
      fromName: string | null;
      fromEmail: string | null;
      toEmails: string | null;
      ccEmails: string | null;
      snippet: string | null;
      sentAt: string | null;
    };
    topCandidate: {
      id: number;
      objectType: string;
      objectId: number;
      objectName: string | null;
      confidenceScore: number | null;
      associationReasonJson: string | null;
    } | null;
    candidateCount: number;
  };

  const reviewQueueQuery = useQuery<{ items: ReviewQueueItem[]; total: number }>({
    queryKey: ["/api/gmail/review-queue"],
    queryFn: async () => {
      const res = await fetch("/api/gmail/review-queue?limit=50", { credentials: "include" });
      if (!res.ok) return { items: [], total: 0 };
      return res.json();
    },
    enabled: tab === "review",
    refetchInterval: tab === "review" ? 30000 : false,
  });

  const HIGH_CONFIDENCE_THRESHOLD = 75;

  // Domain auto-link rules
  type AutoLinkRule = {
    id: number;
    domain: string;
    object_type: string;
    object_id: number;
    object_name: string | null;
    created_at: string;
  };
  const autoLinkRulesQuery = useQuery<AutoLinkRule[]>({
    queryKey: ["/api/crm/auto-link-rules"],
    queryFn: async () => {
      const res = await fetch("/api/crm/auto-link-rules", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: showAutoLinkRules,
  });
  const createRuleMutation = useMutation({
    mutationFn: async (rule: { domain: string; objectType: string; objectId: number; objectName: string }) => {
      const res = await apiRequest("POST", "/api/crm/auto-link-rules", rule);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/auto-link-rules"] });
      setNewRuleDomain("");
      setNewRuleObjId("");
      setNewRuleObjName("");
      toast({ title: "Auto-link rule saved", description: "Future emails from this domain will be linked automatically." });
    },
    onError: (err: any) => toast({ title: "Failed to save rule", description: err.message, variant: "destructive" }),
  });
  const deleteRuleMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/crm/auto-link-rules/${id}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/auto-link-rules"] });
      toast({ title: "Rule deleted" });
    },
  });
  const confirmAndAutoLinkMutation = useMutation({
    mutationFn: async ({ items, domain, objectType, objectId, objectName }: {
      items: Array<{ associationId: number; threadId: string }>;
      domain: string; objectType: string; objectId: number; objectName: string;
    }) => {
      const [confirmRes] = await Promise.all([
        apiRequest("POST", "/api/gmail/thread-associations/bulk-confirm", { items }),
        apiRequest("POST", "/api/crm/auto-link-rules", { domain, objectType, objectId, objectName }),
      ]);
      if (!confirmRes.ok) throw new Error("Confirm failed");
      return confirmRes.json() as Promise<BulkResult>;
    },
    onSuccess: (result, vars) => {
      advanceReviewSelection(new Set(vars.items.map(i => i.threadId)));
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/review-queue/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/auto-link-rules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
      setSelectedReviewIds(new Set());
      toast({
        title: `Confirmed + auto-link rule set for @${vars.domain}`,
        description: `Future emails from @${vars.domain} will link to ${vars.objectName} automatically.`,
      });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  type BulkResult = {
    confirmed?: number[];
    rejected?: number[];
    skipped: Array<{ id: number; reason: string }>;
    failed: Array<{ id: number; reason: string }>;
  };

  function buildBulkResultToast(result: BulkResult, action: "confirm" | "reject") {
    const done = (result.confirmed ?? result.rejected ?? []).length;
    const skipped = result.skipped.length;
    const failed = result.failed.length;
    const verb = action === "confirm" ? "Confirmed" : "Rejected";
    let title = `${verb} ${done} association${done !== 1 ? "s" : ""}`;
    const parts: string[] = [];
    if (skipped > 0) parts.push(`${skipped} skipped (no permission)`);
    if (failed > 0) parts.push(`${failed} error${failed !== 1 ? "s" : ""}`);
    const description = parts.length > 0 ? parts.join(", ") : undefined;
    return { title, description, variant: failed > 0 ? ("destructive" as const) : undefined };
  }

  function advanceReviewSelection(actedThreadIds: Set<string>) {
    // Optimistically remove acted-on items from the cache immediately
    const currentItems: ReviewQueueItem[] =
      (queryClient.getQueryData(["/api/gmail/review-queue"]) as any)?.items ?? [];
    queryClient.setQueryData(
      ["/api/gmail/review-queue"],
      (old: { items: ReviewQueueItem[]; total: number } | undefined) => {
        if (!old) return old;
        const remaining = old.items.filter(i => !actedThreadIds.has(i.gmailThreadId));
        return { ...old, items: remaining, total: Math.max(0, old.total - actedThreadIds.size) };
      }
    );
    // If the currently-open thread was just acted on, advance to the next one
    if (selectedThreadId && actedThreadIds.has(selectedThreadId)) {
      const remaining = currentItems.filter(i => !actedThreadIds.has(i.gmailThreadId));
      const prevIdx = currentItems.findIndex(i => i.gmailThreadId === selectedThreadId);
      const next = remaining[Math.min(prevIdx, remaining.length - 1)] ?? null;
      setSelectedThreadId(next?.gmailThreadId ?? null);
      setSelectedMessageId(null);
    }
  }

  const bulkConfirmMutation = useMutation({
    mutationFn: async (items: Array<{ associationId: number; threadId: string }>) => {
      const res = await apiRequest("POST", "/api/gmail/thread-associations/bulk-confirm", { items });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Unknown error" }));
        throw new Error(body.message || `Error ${res.status}`);
      }
      return res.json() as Promise<BulkResult>;
    },
    onSuccess: (result, items) => {
      advanceReviewSelection(new Set(items.map(i => i.threadId)));
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/review-queue/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
      setSelectedReviewIds(new Set());
      const { title, description, variant } = buildBulkResultToast(result, "confirm");
      toast({ title, description, variant });
    },
    onError: (err: any) => toast({ title: "Bulk confirm failed", description: err.message, variant: "destructive" }),
  });

  const bulkRejectMutation = useMutation({
    mutationFn: async (items: Array<{ associationId: number; threadId: string }>) => {
      const res = await apiRequest("POST", "/api/gmail/thread-associations/bulk-reject", { items });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Unknown error" }));
        throw new Error(body.message || `Error ${res.status}`);
      }
      return res.json() as Promise<BulkResult>;
    },
    onSuccess: (result, items) => {
      advanceReviewSelection(new Set(items.map(i => i.threadId)));
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/review-queue/stats"] });
      setSelectedReviewIds(new Set());
      const { title, description, variant } = buildBulkResultToast(result, "reject");
      toast({ title, description, variant });
    },
    onError: (err: any) => toast({ title: "Bulk reject failed", description: err.message, variant: "destructive" }),
  });

  function toggleReviewSelection(threadId: string) {
    setSelectedReviewIds(prev => {
      const next = new Set(prev);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  }

  function selectHighConfidence() {
    const items = reviewQueueQuery.data?.items ?? [];
    const ids = items
      .filter(i => (i.topCandidate?.confidenceScore ?? 0) >= HIGH_CONFIDENCE_THRESHOLD && i.topCandidate)
      .map(i => i.gmailThreadId);
    setSelectedReviewIds(new Set(ids));
  }

  function buildBulkPayload(): Array<{ associationId: number; threadId: string }> {
    const items = reviewQueueQuery.data?.items ?? [];
    const result: Array<{ associationId: number; threadId: string }> = [];
    for (const item of items) {
      if (selectedReviewIds.has(item.gmailThreadId) && item.topCandidate) {
        result.push({ associationId: item.topCandidate.id, threadId: item.gmailThreadId });
      }
    }
    return result;
  }

  function toggleInboxSelection(threadId: string) {
    setSelectedInboxIds(prev => {
      const next = new Set(prev);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  }

  function selectAllInboxThreads() {
    if (tab === "drafts") {
      setSelectedDraftIds(new Set((draftsQuery.data || []).map(d => d.id)));
    } else if (tab === "folder") {
      setSelectedInboxIds(new Set((folderEmailsQuery.data || []).map(e => e.gmailThreadId).filter(Boolean) as string[]));
    } else if (isCategoryTab) {
      setSelectedInboxIds(new Set((categoryQuery.data?.messages || []).map(m => m.threadId)));
    } else {
      setSelectedInboxIds(new Set(activeMessages.map(m => m.threadId)));
    }
  }

  const bulkMarkReadMutation = useMutation({
    mutationFn: async ({ markAs }: { markAs: "read" | "unread" }) => {
      const messageIds = activeMessages
        .filter(m => selectedInboxIds.has(m.threadId))
        .map(m => m.id);
      const res = await apiRequest("POST", "/api/gmail/bulk-mark-read", {
        messageIds,
        markAs,
        ...(activeAccountId ? { asAccountId: activeAccountId } : {}),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return { messageIds, markAs, result: await res.json() };
    },
    onSuccess: ({ messageIds, markAs }) => {
      const isRead = markAs === "read";
      const updateMsgs = (old: { messages: MessageSummary[]; nextPageToken: string | null } | undefined) =>
        old ? {
          ...old, messages: old.messages.map(m =>
            messageIds.includes(m.id)
              ? { ...m, labelIds: isRead ? m.labelIds.filter(l => l !== "UNREAD") : [...m.labelIds.filter(l => l !== "UNREAD"), "UNREAD"] }
              : m
          )
        } : old;
      // setQueriesData with a 2-part prefix matches ALL inbox query variants
      // (the actual inboxQuery key has 6 parts: /messages, "inbox", searchQuery, activeAccountId, inboxCategory, crmFilter)
      queryClient.setQueriesData({ queryKey: ["/api/gmail/messages", "inbox"] }, updateMsgs);
      setInboxExtra(prev => prev.map(m =>
        messageIds.includes(m.id)
          ? { ...m, labelIds: isRead ? m.labelIds.filter(l => l !== "UNREAD") : [...m.labelIds.filter(l => l !== "UNREAD"), "UNREAD"] }
          : m
      ));
      // Refresh badge counts immediately so sidebar numbers drop/rise to match.
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/accounts", "health"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/category-counts"] });
      setSelectedInboxIds(new Set());
      toast({ title: `Marked ${messageIds.length} email${messageIds.length !== 1 ? "s" : ""} as ${markAs}` });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const markAllInboxReadMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/gmail/mark-all-inbox-read", {
        ...(activeAccountId && activeAccountId !== "all" ? { asAccountId: activeAccountId } : {}),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json() as Promise<{ success: number; failed: number; total: number }>;
    },
    onSuccess: ({ success }) => {
      queryClient.setQueriesData(
        { queryKey: ["/api/gmail/messages", "inbox"] },
        (old: { messages: MessageSummary[]; nextPageToken: string | null } | undefined) =>
          old ? {
            ...old,
            messages: old.messages.map(m => ({
              ...m,
              labelIds: m.labelIds.filter(l => l !== "UNREAD"),
            })),
          } : old,
      );
      setInboxExtra(prev => prev.map(m => ({
        ...m,
        labelIds: m.labelIds.filter(l => l !== "UNREAD"),
      })));
      // Refresh badge counts immediately so inbox badge drops to 0.
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/accounts", "health"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/category-counts"] });
      toast({ title: `Marked ${success} message${success !== 1 ? "s" : ""} as read` });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const bulkArchiveMutation = useMutation({
    mutationFn: async () => {
      const threadIds = Array.from(selectedInboxIds);
      const res = await apiRequest("POST", "/api/gmail/bulk-archive", {
        threadIds,
        ...(activeAccountId ? { asAccountId: activeAccountId } : {}),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return { threadIds, result: await res.json() };
    },
    onSuccess: ({ threadIds }) => {
      const removeArchived = (old: { messages: MessageSummary[]; nextPageToken: string | null } | undefined) =>
        old ? { ...old, messages: old.messages.filter(m => !threadIds.includes(m.threadId)) } : old;
      queryClient.setQueriesData({ queryKey: ["/api/gmail/messages", "inbox"] }, removeArchived);
      setInboxExtra(prev => prev.filter(m => !threadIds.includes(m.threadId)));
      if (selectedThreadId && threadIds.includes(selectedThreadId)) {
        setSelectedThreadId(null);
        setSelectedMessageId(null);
      }
      setSelectedInboxIds(new Set());
      invalidateBadgeQueries();
      toast({ title: `Archived ${threadIds.length} thread${threadIds.length !== 1 ? "s" : ""}` });
    },
    onError: (err: any) => toast({ title: "Archive failed", description: err.message, variant: "destructive" }),
  });

  const bulkMarkDoneMutation = useMutation({
    mutationFn: async () => {
      const threadIds = Array.from(selectedInboxIds);
      const res = await apiRequest("PATCH", "/api/inbox/bulk-mark-done", { threadIds });
      if (!res.ok) throw new Error((await res.json()).message);
      return { threadIds, result: await res.json() };
    },
    onSuccess: ({ threadIds }) => {
      setSelectedInboxIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/thread-signals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/triage-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/triage-thread-ids"] });
      toast({ title: `Marked ${threadIds.length} thread${threadIds.length !== 1 ? "s" : ""} as done` });
    },
    onError: (err: any) => toast({ title: "Mark done failed", description: err.message, variant: "destructive" }),
  });

  const bulkTrashMutation = useMutation({
    mutationFn: async (overrideIds?: string[]) => {
      const threadIds = overrideIds ?? Array.from(selectedInboxIds);
      const res = await apiRequest("POST", "/api/inbox/bulk-trash", {
        threadIds,
        ...(activeAccountId ? { asAccountId: activeAccountId } : {}),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return { threadIds, result: await res.json() };
    },
    onSuccess: ({ threadIds }) => {
      const removeDeleted = (old: { messages: MessageSummary[]; nextPageToken: string | null } | undefined) =>
        old ? { ...old, messages: old.messages.filter(m => !threadIds.includes(m.threadId)) } : old;
      queryClient.setQueriesData({ queryKey: ["/api/gmail/messages", "inbox"] }, removeDeleted);
      queryClient.setQueriesData({ queryKey: ["/api/gmail/messages", "sent"] }, removeDeleted);
      queryClient.setQueriesData({ queryKey: ["/api/gmail/messages", "spam"] }, removeDeleted);
      setInboxExtra(prev => prev.filter(m => !threadIds.includes(m.threadId)));
      queryClient.invalidateQueries({ queryKey: ["/api/mail-folders", selectedFolderId, "emails"] });
      if (selectedThreadId && threadIds.includes(selectedThreadId)) {
        setSelectedThreadId(null);
        setSelectedMessageId(null);
      }
      setSelectedInboxIds(new Set());
      setConfirmDeleteAll(false);
      invalidateBadgeQueries();
      toast({ title: `Moved ${threadIds.length} thread${threadIds.length !== 1 ? "s" : ""} to Trash` });
    },
    onError: (err: any) => { toast({ title: "Delete failed", description: err.message, variant: "destructive" }); setConfirmDeleteAll(false); },
  });

  const bulkDeleteDraftsMutation = useMutation({
    mutationFn: async (overrideIds?: string[]) => {
      const ids = overrideIds ?? Array.from(selectedDraftIds);
      const results = await Promise.allSettled(
        ids.map(id => fetch(`/api/gmail/drafts/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" }))
      );
      const deleted = results.filter(r => r.status === "fulfilled").length;
      return { ids, deleted };
    },
    onSuccess: ({ ids, deleted }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/drafts"] });
      setSelectedDraftIds(new Set());
      setConfirmDeleteAll(false);
      toast({ title: `Deleted ${deleted} draft${deleted !== 1 ? "s" : ""}` });
    },
    onError: () => { toast({ title: "Delete failed", variant: "destructive" }); setConfirmDeleteAll(false); },
  });

  const archiveThreadMutation = useMutation({
    mutationFn: async (threadId: string) => {
      const res = await apiRequest("POST", "/api/gmail/bulk-archive", {
        threadIds: [threadId],
        ...(activeAccountId ? { asAccountId: activeAccountId } : {}),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return { threadId, result: await res.json() };
    },
    onSuccess: ({ threadId }) => {
      const removeArchived = (old: { messages: MessageSummary[]; nextPageToken: string | null } | undefined) =>
        old ? { ...old, messages: old.messages.filter(m => m.threadId !== threadId) } : old;
      queryClient.setQueriesData({ queryKey: ["/api/gmail/messages", "inbox"] }, removeArchived);
      setInboxExtra(prev => prev.filter(m => m.threadId !== threadId));
      if (selectedThreadId === threadId) { setSelectedThreadId(null); setSelectedMessageId(null); }
      invalidateBadgeQueries();
      toast({ title: "Thread archived" });
    },
    onError: (err: any) => toast({ title: "Archive failed", description: err.message, variant: "destructive" }),
  });

  // True Gmail "Move to Trash" — distinct from archive. Used by the
  // Spark-style actions toolbar's Trash button. Cache update mirrors
  // archiveThreadMutation so the thread disappears from the list and
  // the reader pane closes.
  const trashThreadMutation = useMutation({
    mutationFn: async (threadId: string) => {
      const res = await apiRequest(
        "POST",
        `/api/inbox/threads/${encodeURIComponent(threadId)}/trash`,
        {},
      );
      if (!res.ok) throw new Error((await res.json()).message);
      return { threadId };
    },
    onSuccess: ({ threadId }) => {
      const removeTrashed = (old: { messages: MessageSummary[]; nextPageToken: string | null } | undefined) =>
        old ? { ...old, messages: old.messages.filter(m => m.threadId !== threadId) } : old;
      queryClient.setQueriesData({ queryKey: ["/api/gmail/messages", "inbox"] }, removeTrashed);
      setInboxExtra(prev => prev.filter(m => m.threadId !== threadId));
      if (selectedThreadId === threadId) { setSelectedThreadId(null); setSelectedMessageId(null); }
      invalidateBadgeQueries();
      toast({ title: "Moved to Trash" });
    },
    onError: (err: any) => toast({ title: "Trash failed", description: err.message, variant: "destructive" }),
  });

  // Remove SPAM label + add INBOX label — calls the not-spam API route and
  // removes the thread from the spam query cache so it disappears immediately.
  const notSpamMutation = useMutation({
    mutationFn: async (threadId: string) => {
      const res = await apiRequest(
        "POST",
        `/api/inbox/threads/${encodeURIComponent(threadId)}/not-spam`,
        {},
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.message);
      return { threadId, ...body } as {
        threadId: string;
        ok: boolean;
        linkedMessageCount: number;
        updatedLocal: number;
        remainingSpam: number;
        providerAttempted: number;
        providerSucceeded: number;
        providerFailed: number;
        warnings: string[];
      };
    },
    onSuccess: (result) => {
      const { threadId, remainingSpam, linkedMessageCount, warnings } = result;

      // 1. Optimistic update — remove the thread from the spam list immediately
      //    when all spam is cleared. If some messages still remain spam we keep
      //    it visible so the user sees the warning and can act again.
      if (remainingSpam === 0) {
        const removeThread = (old: { messages: MessageSummary[]; nextPageToken: string | null } | undefined) =>
          old ? { ...old, messages: old.messages.filter(m => m.threadId !== threadId) } : old;
        // Remove from spam cache (catches real-spam rows served by spamQuery).
        queryClient.setQueryData(["/api/gmail/messages", "spam", searchQuery, activeAccountId], removeThread);
        // Mark thread as rescued so inboxOther (inbox messages from blocked domains
        // shown in the spam tab) never re-surfaces it — even after the inbox query
        // refetches and returns the same messages from the server.
        setRescuedFromSpam((prev) => new Set([...prev, threadId]));

        // Persist the rescue for inboxOther messages across page refreshes.
        // rescuedFromSpam is in-memory React state — it resets on every page load,
        // which causes blocked-domain messages to reappear in the spam tab after
        // refresh even though the user explicitly clicked "Not Spam".
        //
        // Fix: if the rescued thread was being shown because its sender domain is
        // in the email_filters block-list (inboxOther path), permanently delete
        // that filter so the domain is no longer blocked.  The message will then
        // appear normally in the Inbox on any future load.
        const inboxOtherMsg = inboxOtherVisible.find((m) => m.threadId === threadId);
        if (inboxOtherMsg) {
          const domain = parseSenderDomain(inboxOtherMsg.from);
          const matchingFilter = (filtersQuery.data || []).find((f) => f.domain === domain);
          if (matchingFilter) {
            apiRequest("DELETE", `/api/email-filters/${matchingFilter.id}`)
              .then(() => queryClient.invalidateQueries({ queryKey: ["/api/email-filters"] }))
              .catch(() => {/* best-effort; rescuedFromSpam still guards this session */});
          }
        }
      }

      // 2. Invalidate ALL spam queries (partial key match) so every spam cache entry
      //    — regardless of searchQuery or activeAccountId — is refetched.
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages", "spam"] });

      // 3. Invalidate the inbox query family so the thread appears in the inbox
      //    after the server has applied the label change (remove SPAM, add INBOX).
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages", "inbox"] });

      // 4. Refresh blocked-senders — the not-spam route also removes the sender
      //    from blocked_senders, so the unblock is reflected immediately.
      queryClient.invalidateQueries({ queryKey: ["/api/blocked-senders"] });

      if (remainingSpam === 0 && selectedThreadId === threadId) {
        setSelectedThreadId(null);
        setSelectedMessageId(null);
      }

      // Stay in the spam folder — the user may have more emails to triage.
      // The thread already disappears from the list optimistically above,
      // and the toast confirms where it went.

      if (remainingSpam > 0) {
        // Partial success — some linked messages could not be moved out of spam.
        toast({
          title: "Partially moved to Inbox",
          description: `${linkedMessageCount - remainingSpam} message(s) moved. ${remainingSpam} linked message(s) in this thread still remain in spam — try again or check your mailbox sync.`,
          variant: "destructive",
        });
      } else if (warnings.some(w => w.startsWith("Provider update failed"))) {
        // All local rows updated but Gmail API had a hiccup — will self-heal on next sync.
        toast({
          title: "Moved to Inbox",
          description: "Thread marked as not spam. Gmail sync may take a moment to reflect this.",
        });
      } else {
        toast({ title: "Moved to Inbox", description: `${linkedMessageCount} message(s) restored to inbox.` });
      }
    },
    onError: (err: any) => toast({ title: "Couldn't move to inbox", description: err.message, variant: "destructive" }),
  });

  // Move-to-primary: lift a thread from a category folder into the Primary Inbox.
  // Calls POST /api/inbox/threads/:threadId/move-to-primary which adds INBOX and
  // strips all CATEGORY_* labels via Gmail API + local mirror.
  const moveToPrimaryMutation = useMutation({
    mutationFn: async (threadId: string) => {
      const res = await apiRequest("POST", `/api/inbox/threads/${encodeURIComponent(threadId)}/move-to-primary`, {});
      const body = await res.json();
      if (!res.ok) throw new Error(body.message);
      return { threadId, ...body } as { threadId: string; ok: boolean; gmailOk: boolean };
    },
    onSuccess: (result) => {
      const { threadId } = result;
      // Optimistically remove from the current category query cache.
      const removeThread = (old: { messages: MessageSummary[]; nextPageToken: string | null } | undefined) =>
        old ? { ...old, messages: old.messages.filter(m => m.threadId !== threadId) } : old;
      for (const cat of CATEGORY_TABS) {
        queryClient.setQueryData(["/api/gmail/messages", "category", cat, searchQuery, activeAccountId], removeThread);
      }
      // Refresh inbox so the moved thread appears there, and refresh counts.
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages", "inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/category-counts"] });
      if (selectedThreadId === threadId) {
        setSelectedThreadId(null);
        setSelectedMessageId(null);
      }
      toast({ title: "Moved to Primary Inbox", description: "Thread will appear in your inbox." });
    },
    onError: (err: any) => toast({ title: "Couldn't move to inbox", description: err.message, variant: "destructive" }),
  });

  // ── Single-thread / single-message variants used by the new Spark-style
  // actions toolbar at the top of the reader pane. They reuse the existing
  // bulk endpoints (no new backend routes) so cache-update semantics stay
  // consistent across bulk + per-thread paths.

  // Mark just the focused message as unread — uses bulk-mark-read with a
  // single-id array. Does NOT clear the selection like bulk does.
  const markUnreadSingleMutation = useMutation({
    mutationFn: async (messageId: string) => {
      const res = await apiRequest("POST", "/api/gmail/bulk-mark-read", {
        messageIds: [messageId],
        markAs: "unread",
        ...(activeAccountId ? { asAccountId: activeAccountId } : {}),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return { messageId };
    },
    onSuccess: ({ messageId }) => {
      const updateMsgs = (old: { messages: MessageSummary[]; nextPageToken: string | null } | undefined) =>
        old ? {
          ...old, messages: old.messages.map(m =>
            m.id === messageId
              ? { ...m, labelIds: [...m.labelIds.filter(l => l !== "UNREAD"), "UNREAD"] }
              : m
          )
        } : old;
      queryClient.setQueriesData({ queryKey: ["/api/gmail/messages", "inbox"] }, updateMsgs);
      setInboxExtra(prev => prev.map(m =>
        m.id === messageId
          ? { ...m, labelIds: [...m.labelIds.filter(l => l !== "UNREAD"), "UNREAD"] }
          : m
      ));
      // Refresh badge counts immediately so the unread thread count rises to reflect this.
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/accounts", "health"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/category-counts"] });
      toast({ title: "Marked as unread" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  // Mark just the current thread as done — uses /api/inbox/bulk-mark-done
  // with a single-id array. Closes the reader on success (Spark behaviour).
  const markDoneSingleMutation = useMutation({
    mutationFn: async (threadId: string) => {
      const res = await apiRequest("PATCH", "/api/inbox/bulk-mark-done", { threadIds: [threadId] });
      if (!res.ok) throw new Error((await res.json()).message);
      return { threadId };
    },
    onSuccess: ({ threadId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/thread-signals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/triage-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/triage-thread-ids"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-record", threadId] });
      if (selectedThreadId === threadId) { setSelectedThreadId(null); setSelectedMessageId(null); }
      toast({ title: "Marked as done" });
    },
    onError: (err: any) => toast({ title: "Mark done failed", description: err.message, variant: "destructive" }),
  });

  const createTaskFromThreadMutation = useMutation({
    mutationFn: async ({ threadId, subject, fromEmail, fromName, linkedObjectType, linkedObjectId, title }: {
      threadId: string; subject?: string; fromEmail?: string; fromName?: string;
      linkedObjectType?: string; linkedObjectId?: number; title?: string;
    }) => {
      const res = await apiRequest("POST", "/api/inbox/create-task-from-thread", {
        threadId, subject, fromEmail, fromName, linkedObjectType, linkedObjectId, title,
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      setQuickTaskThreadId(null);
      setQuickTaskTitle("");
      toast({ title: "Task created", description: "Task added to your list" });
    },
    onError: (err: any) => toast({ title: "Failed to create task", description: err.message, variant: "destructive" }),
  });

  const createNoteFromThreadMutation = useMutation({
    mutationFn: async ({ threadId, subject, snippet, fromEmail, fromName, linkedObjectType, linkedObjectId }: {
      threadId: string; subject?: string; snippet?: string; fromEmail?: string; fromName?: string;
      linkedObjectType?: string; linkedObjectId?: number;
    }) => {
      const res = await apiRequest("POST", "/api/inbox/create-note-from-thread", {
        threadId, subject, snippet, fromEmail, fromName, linkedObjectType, linkedObjectId,
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => toast({ title: "Note added" }),
    onError: (err: any) => toast({ title: "Failed to add note", description: err.message, variant: "destructive" }),
  });

  const openDraft = async (draftId: string) => {
    setLoadingDraftId(draftId);
    try {
      const res = await fetch(`/api/gmail/drafts/${draftId}`, { credentials: "include" });
      const content = await res.json();
      setEditingDraft({ to: content.to, cc: content.cc || "", bcc: content.bcc || "", subject: content.subject, body: content.body, draftId, threadId: content.threadId });
      setComposeOpen(true);
    } catch {
      toast({ title: "Could not load draft", variant: "destructive" });
    } finally {
      setLoadingDraftId(null);
    }
  };

  // ── URL-param compose trigger (?draft=<id>&compose=1) ────────────────────
  // Used by the AI Summary "Continue in Mail" flow: the modal creates a real
  // draft, navigates here with these params, and we open the compose window
  // hydrated with that draft — identical to clicking a row in the Drafts tab.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const draftId = params.get("draft");
    const compose = params.get("compose");
    if (draftId && compose === "1") {
      // Clean the URL immediately so a browser refresh doesn't re-open compose.
      window.history.replaceState({}, "", window.location.pathname);
      openDraft(draftId);
    }
  // openDraft is defined in the same render and only closes over stable
  // setState/toast refs, so it never needs to be in the dependency array.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pagination dedup: when local & gmail sources overlap, or refetch races with a loadMore append,
  // the same message id can appear twice. Keep the FIRST occurrence (newer page wins because base
  // page is always rendered before extras) and drop duplicates so React keys stay unique and the
  // user never sees a row twice.
  // Memoized on query data + extras so it only reruns when actual message data changes, not on
  // every render — prevents unnecessary downstream recomputation of inboxMain/viewItems/navList.
  const allInboxMessages = useMemo(
    () => dedupById([...(inboxQuery.data?.messages || []), ...inboxExtra]),
    [inboxQuery.data, inboxExtra],
  );
  const allSentMessages = useMemo(
    () => dedupById([...(sentQuery.data?.messages || []), ...sentExtra]),
    [sentQuery.data, sentExtra],
  );

  const inboxMainRaw = canSend
    ? allInboxMessages.filter(
        (m) =>
          !blockedDomains.has(parseSenderDomain(m.from)) &&
          !blockedEmails.has((m.fromEmail || "").toLowerCase()),
      )
    : allInboxMessages;
  // Apply thread dedup AFTER the blocked-domain filter so a blocked reply can't
  // "shadow" a valid earlier message in the same thread.
  const inboxMain = dedupByThread(inboxMainRaw);

  const inboxOther = canSend
    ? allInboxMessages.filter(
        (m) =>
          blockedDomains.has(parseSenderDomain(m.from)) ||
          blockedEmails.has((m.fromEmail || "").toLowerCase()),
      )
    : [];
  // Exclude threads the user has explicitly rescued via Not Spam from the
  // blocked-domain overlay. inboxOther items always survive an inbox refetch
  // (they're genuinely in the inbox), so cache invalidation alone cannot hide
  // them. rescuedFromSpam provides a session-level exclusion that is unaffected
  // by any subsequent query invalidation or refetch.
  const inboxOtherVisible = inboxOther.filter((m) => !rescuedFromSpam.has(m.threadId));
  const allSpamMessages = [...(spamQuery.data?.messages || []), ...inboxOtherVisible];

  // When the Unread filter pill is active, bypass the category sub-tab filter entirely.
  // The Unread view is meant to show ALL unread inbox messages — the badge ("Unread 223")
  // counts the full inbox, not just a single sub-category. The inboxQuery already sends
  // "in:inbox is:unread" (fetching all unread, not category-specific) so we must NOT
  // then apply a second client-side category filter that would silently eliminate valid
  // unread messages. The bug: if inboxCategory was "priority" (starred) before the user
  // clicked Unread, this filter reduces the list to zero starred-unread messages while
  // 200+ unread messages exist, producing "No messages found" and the auto-loader spin loop.
  const categorizedInbox = crmFilter === "unread"
    ? inboxMain
    : inboxCategory === "priority"    ? inboxMain.filter((m) => isStarred(m.labelIds)) :
      inboxCategory === "all"         ? inboxMain :
      inboxMain.filter((m) => (m.smartCategory ?? getEmailCategory(m.labelIds)) === inboxCategory);

  const priorityCount    = inboxMain.filter((m) => isStarred(m.labelIds)).length;
  const peopleCount      = inboxMain.filter((m) => (m.smartCategory ?? getEmailCategory(m.labelIds)) === "people").length;
  const updatesCount = inboxMain.filter((m) => (m.smartCategory ?? getEmailCategory(m.labelIds)) === "updates").length;
  const inboxUnreadCount = inboxMain.filter((m) => isUnread(m.labelIds)).length;

  // ── Raw inbox count from health API (private — feeds countSnapshot below) ───────────
  // Returns 0 while health data is loading. Never falls back to inboxUnreadCount
  // (first-page only). Kept private so all badge rendering goes through countSnapshot.
  const _rawServerInboxUnread = useMemo(() => {
    const accounts = accountsHealthQuery.data;
    if (!accounts || accounts.length === 0) return 0;
    // null = personal/unified (no account filter) and "all" = explicit All Inboxes —
    // both represent the unified view, so sum every account's unread count.
    if (activeAccountId === null || activeAccountId === "all") {
      return accounts.reduce((sum, a) => sum + (a.unreadCount ?? 0), 0);
    }
    return accounts.find((a) => a.id === activeAccountId)?.unreadCount ?? 0;
  }, [accountsHealthQuery.data, activeAccountId]);

  // ── Atomic count snapshot ─────────────────────────────────────────────────────────────
  // Single source of truth for every visible badge and section-header count.
  // A stable ref copy is kept and only updated when NEITHER badge query is mid-refetch,
  // so badges never show mixed-freshness values (e.g. health refreshed, category-counts
  // hasn't yet). Both queries now use the same 30 s interval and share invalidateBadgeQueries,
  // so in practice they refetch and settle together; the stable ref is a safety net for
  // the small window where one query settles a frame or two before the other.
  const _candidateSnapshot = useMemo(() => {
    const cc         = categoryCountsQuery.data;
    const inbox      = _rawServerInboxUnread;
    const updates    = cc?.updates?.unread    ?? 0;
    const promotions = cc?.promotions?.unread ?? 0;
    const social     = cc?.social?.unread     ?? 0;
    const forums     = cc?.forums?.unread     ?? 0;
    const people     = cc?.people?.unread
                     ?? Math.max(0, inbox - updates - promotions - social - forums);
    const categorySum = people + updates + promotions + social + forums;
    return {
      inbox, people, updates, promotions, social, forums,
      categorySum, gap: inbox - categorySum, isReconciled: inbox === categorySum,
      sourceTimestamp: Date.now(),
    };
  }, [_rawServerInboxUnread, categoryCountsQuery.data]);

  const _stableSnapshotRef = useRef<typeof _candidateSnapshot | null>(null);
  useEffect(() => {
    if (!accountsHealthQuery.isFetching && !categoryCountsQuery.isFetching) {
      _stableSnapshotRef.current = _candidateSnapshot;
    }
  }, [_candidateSnapshot, accountsHealthQuery.isFetching, categoryCountsQuery.isFetching]);
  // Use stable snapshot while either query is mid-refetch; fall back to candidate on
  // first render (before the effect has had a chance to populate the ref).
  const countSnapshot = _stableSnapshotRef.current ?? _candidateSnapshot;

  // Convenience alias — all existing render spots continue to work unchanged.
  const serverInboxUnreadCount = countSnapshot.inbox;

  // Category-specific server unread target for the smart unread loader + status banner.
  // When the user is in a sub-category view (People, Updates, etc.) we compare loaded
  // unread ONLY for that category, not the global inbox total.  Without this, the loader
  // would never converge because a People-filtered query returns far fewer messages than
  // the full inbox, so inboxUnreadCount < serverInboxUnreadCount always.
  const inboxCategoryServerUnread = useMemo(() => {
    if (inboxCategory === "people")     return countSnapshot.people;
    if (inboxCategory === "updates")    return countSnapshot.updates;
    if (inboxCategory === "promotions") return countSnapshot.promotions;
    if (inboxCategory === "social")     return countSnapshot.social;
    if (inboxCategory === "forums")     return countSnapshot.forums;
    return countSnapshot.inbox;
  }, [inboxCategory, countSnapshot]);

  // PART A — Server-side group counts for Smart Inbox section headers.
  // All values sourced from countSnapshot (stabilised joint freshness).
  // Newsletters = PROMOTIONS + FORUMS; Notifications = UPDATES + SOCIAL.
  // Priority is a highlight layer only — counted inside its category group.
  const serverGroupCounts = useMemo(() => {
    const { people, updates, promotions, social, forums } = countSnapshot;
    const newsletters   = promotions + forums;
    const notifications = updates    + social;
    if (people + newsletters + notifications === 0) return null;
    return {
      "unread-people":        people,
      "unread-newsletters":   newsletters,
      "unread-notifications": notifications,
    } as const;
  }, [countSnapshot]);

  // Per-category unread badge counts for the Inbox subcategory sidebar items.
  // All values sourced from countSnapshot (stabilised joint freshness).
  const sidebarCategoryBadges = useMemo(() => ({
    people:     countSnapshot.people,
    updates:    countSnapshot.updates,
    promotions: countSnapshot.promotions,
    social:     countSnapshot.social,
    forums:     countSnapshot.forums,
  }), [countSnapshot]);

  // ── LIVE BADGE COUNT DIAGNOSTIC ──────────────────────────────────────────
  // Logs every count being rendered so scope/cache mismatches are immediately
  // visible in the browser DevTools console.
  // Gated: only fires in development builds OR for admin users — never logs
  // to the console for regular production users.
  useEffect(() => {
    if (!import.meta.env.DEV && !isAdmin) return;
    const cc = categoryCountsQuery.data;
    const health = accountsHealthQuery.data ?? [];

    // Raw per-account health values
    const healthRows = health.map(a => ({
      id: a.id, email: a.emailAddress, unreadCount: a.unreadCount,
    }));

    // What the sidebar badge for each category actually renders
    const rendered = {
      inboxBadge:      serverInboxUnreadCount,
      peopleBadge:     sidebarCategoryBadges.people,
      updatesBadge:    sidebarCategoryBadges.updates,
      promotionsBadge: sidebarCategoryBadges.promotions,
      socialBadge:     sidebarCategoryBadges.social,
      forumsBadge:     sidebarCategoryBadges.forums,
      priorityCount:   serverGroupCounts?.["unread-people"] ?? null,
      seenCount:       null, // "Seen" section has no server count — local page only
    };

    const catSum = rendered.peopleBadge + rendered.updatesBadge +
                   rendered.promotionsBadge + rendered.socialBadge + rendered.forumsBadge;
    const gap = rendered.inboxBadge - catSum;

    console.group("%c🔢 VoltSafe Inbox Count Debug", "font-weight:bold;color:#22d3ee");

    console.log("activeAccountId:", activeAccountId,
      "(null = unified/All, number = single account, 'all' = explicit All Inboxes)");

    console.group("📡 Raw API Responses");
    console.log("GET /api/gmail/accounts/health  →  queryKey: [\"/api/gmail/accounts\",\"health\"]");
    console.table(healthRows);
    console.log("Health sum (all accounts):", health.reduce((s,a)=>s+(a.unreadCount??0), 0));
    console.log("GET /api/gmail/category-counts?asAccountId=<" + (activeAccountId ?? "all") + ">  →  queryKey: [\"/api/gmail/category-counts\", activeAccountId]");
    console.log("  people   :", cc?.people?.unread    ?? "(missing — using fallback arithmetic)");
    console.log("  updates  :", cc?.updates?.unread   ?? 0);
    console.log("  promotions:", cc?.promotions?.unread ?? 0);
    console.log("  social   :", cc?.social?.unread    ?? 0);
    console.log("  forums   :", cc?.forums?.unread    ?? 0);
    console.groupEnd();

    console.group("🧮 Derived React Variables → Rendered Values");
    console.log("serverInboxUnreadCount  (variable) → Inbox badge     =", rendered.inboxBadge,
      "\n  source: accountsHealthQuery.data → " +
      (activeAccountId === null || activeAccountId === "all"
        ? "SUM of all accounts (" + health.map(a=>a.unreadCount).join("+") + ")"
        : "accounts.find(a => a.id === " + activeAccountId + ")?.unreadCount"));
    console.log("sidebarCategoryBadges.people        → People badge    =", rendered.peopleBadge,
      "\n  source: cc?.people?.unread ?? Math.max(0, serverInboxUnreadCount - updates - promotions - social - forums)");
    console.log("sidebarCategoryBadges.updates       → Updates badge   =", rendered.updatesBadge,
      "\n  source: cc?.updates?.unread ?? 0");
    console.log("sidebarCategoryBadges.promotions    → Promotions badge=", rendered.promotionsBadge,
      "\n  source: cc?.promotions?.unread ?? 0");
    console.log("sidebarCategoryBadges.social        → Social badge    =", rendered.socialBadge,
      "\n  source: cc?.social?.unread ?? 0");
    console.log("sidebarCategoryBadges.forums        → Forums badge    =", rendered.forumsBadge,
      "\n  source: cc?.forums?.unread ?? 0");
    console.log("serverGroupCounts (Smart Inbox section headers):", serverGroupCounts,
      "\n  NOTE: section headers use serverGroupCounts ?? item.count where item.count = locally-loaded threads only");
    console.groupEnd();

    console.group("🔍 Reconciliation Table");
    console.table({
      "Inbox badge":  { displayed: rendered.inboxBadge,      sourceVar: "serverInboxUnreadCount",             queryKey: '"/api/gmail/accounts","health"',    endpoint: "GET /api/gmail/accounts/health",    rawAPIValue: health.reduce((s,a)=>s+(a.unreadCount??0),0) },
      "People":       { displayed: rendered.peopleBadge,     sourceVar: "sidebarCategoryBadges.people",        queryKey: '"/api/gmail/category-counts",acctId', endpoint: "GET /api/gmail/category-counts",    rawAPIValue: cc?.people?.unread    ?? "(fallback)" },
      "Updates":      { displayed: rendered.updatesBadge,    sourceVar: "sidebarCategoryBadges.updates",       queryKey: '"/api/gmail/category-counts",acctId', endpoint: "GET /api/gmail/category-counts",    rawAPIValue: cc?.updates?.unread   ?? 0 },
      "Promotions":   { displayed: rendered.promotionsBadge, sourceVar: "sidebarCategoryBadges.promotions",    queryKey: '"/api/gmail/category-counts",acctId', endpoint: "GET /api/gmail/category-counts",    rawAPIValue: cc?.promotions?.unread ?? 0 },
      "Social":       { displayed: rendered.socialBadge,     sourceVar: "sidebarCategoryBadges.social",        queryKey: '"/api/gmail/category-counts",acctId', endpoint: "GET /api/gmail/category-counts",    rawAPIValue: cc?.social?.unread    ?? 0 },
      "Forums":       { displayed: rendered.forumsBadge,     sourceVar: "sidebarCategoryBadges.forums",        queryKey: '"/api/gmail/category-counts",acctId', endpoint: "GET /api/gmail/category-counts",    rawAPIValue: cc?.forums?.unread    ?? 0 },
    });
    console.log("Category sum (People+Updates+Promotions+Social+Forums):", catSum);
    console.log("Inbox badge:", rendered.inboxBadge, "   Gap:", gap,
      gap === 0 ? "✅ RECONCILES" : "❌ GAP = " + gap + " — see explanation below");
    if (gap !== 0) {
      console.warn(
        "Gap explanation:\n" +
        "  health endpoint counts: INBOX-OR-CATEGORY_* (OR logic) — each account returns a single number.\n" +
        "  category-counts endpoint counts per-label independently (INBOX AND CATEGORY_X per bucket).\n" +
        "  Possible sources of gap:\n" +
        "  1. STALE CACHE — one query has a fresher response than the other (health refetches every 30s, category-counts every 60s).\n" +
        "     Fix: hard refresh the page (Ctrl+Shift+R) to clear React Query cache.\n" +
        "  2. ACCOUNT SCOPE MISMATCH — health sums ALL accounts; category-counts is scoped to activeAccountId='" + activeAccountId + "'.\n" +
        "     If activeAccountId is a specific account, compare health.find(id).unreadCount vs category-counts sum.\n" +
        "  3. LOADED-THREADS CONFUSION — Smart Inbox section headers fall back to item.count (loaded-page threads)\n" +
        "     when serverGroupCounts is null.  These are NOT the server totals.\n" +
        "     serverGroupCounts = " + JSON.stringify(serverGroupCounts)
      );
    }
    console.groupEnd();

    console.groupEnd();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId, serverInboxUnreadCount, sidebarCategoryBadges, serverGroupCounts,
      accountsHealthQuery.data, categoryCountsQuery.data]);

  const pinnedMessages = useMemo(
    () => inboxMain.filter((m) => pinnedAPI.pinned.has(m.threadId)),
    [inboxMain, pinnedAPI.pinned],
  );

  const activeMessages =
    tab === "inbox"   ? categorizedInbox :
    tab === "sent"    ? allSentMessages :
    tab === "spam"    ? allSpamMessages :
    tab === "pinned"  ? pinnedMessages :
    inboxOther;

  const crmFilteredMessages = tab !== "inbox" ? activeMessages :
    // Keep the currently-open thread visible even after its UNREAD label is
    // removed from cache — the grouper handles keeping it in the right section.
    crmFilter === "unread"         ? activeMessages.filter(m => isUnread(m.labelIds) || m.threadId === selectedThreadId) :
    crmFilter === "starred"        ? activeMessages.filter(m => isStarred(m.labelIds)) :
    crmFilter === "needs-reply"    ? activeMessages.filter(m => triageAwaitingSet.has(m.threadId) || m.threadId === selectedThreadId) :
    crmFilter === "follow-up"      ? activeMessages.filter(m => isStarred(m.labelIds)) :
    crmFilter === "awaiting-reply" ? activeMessages.filter(m => triageAwaitingSet.has(m.threadId)) :
    crmFilter === "hot"            ? activeMessages.filter(m => triageHotSet.has(m.threadId)) :
    crmFilter === "unlinked"       ? activeMessages.filter(m => triageUnlinkedSet.has(m.threadId)) :
    activeMessages;

  // Smart-Inbox grouping. We compute groups only when (a) the user picked
  // "smart" view and (b) we're on a tab where it makes sense. Otherwise
  // `viewItems` is `null` and the renderer falls back to the legacy flat-list
  // path. Memoised on the message slice + view mode + pin set so we don't
  // re-bucket on every render.
  const isSmartView =
    viewMode === "smart" &&
    !searchQuery &&
    tab !== "drafts" && tab !== "scheduled" && tab !== "folder" && tab !== "review" && tab !== "spam" && tab !== "pinned" && !isCategoryTab;
  const viewItems = useMemo<SmartItem<typeof activeMessages[number]>[] | null>(() => {
    if (!isSmartView) return null;
    if (!crmFilteredMessages || crmFilteredMessages.length === 0) return [];
    return groupSmartInbox(crmFilteredMessages, {
      pinnedThreadIds: pinnedAPI.pinned,
      // Keep the open thread in its original section while the user is reading
      // it, only when it was genuinely unread at click time.
      openThreadId: selectedThreadId,
      openThreadWasUnread,
    });
  }, [isSmartView, crmFilteredMessages, pinnedAPI.pinned, selectedThreadId, openThreadWasUnread]);

  // Collapses each Smart Inbox section to its per-section cap and injects
  // show-all / show-less sentinels BELOW the last visible email in each section
  // (not in the section header). Returns null when not in Smart view.
  const collapsedViewItems = useMemo((): SmartCollapseItem[] | null => {
    if (!viewItems) return null;
    if (viewItems.length === 0) return [];

    // Per-section default visible counts (user can expand via show-all).
    const SECTION_CAPS: Partial<Record<SmartSectionId, number>> = {
      priority: 3,
      "unread-people": 5,
      "unread-newsletters": 5,
      "unread-notifications": 5,
      seen: 30,
    };

    // Pre-count totals so show-all can display the full N.
    const sectionTotals = new Map<SmartSectionId, number>();
    for (const it of viewItems) {
      if (it.kind === "msg") {
        sectionTotals.set(it.section, (sectionTotals.get(it.section) ?? 0) + 1);
      }
    }

    const result: SmartCollapseItem[] = [];
    const sectionRendered = new Map<SmartSectionId, number>();

    for (let i = 0; i < viewItems.length; i++) {
      const it = viewItems[i];
      if (it.kind === "header") {
        result.push(it);
      } else {
        const sec = it.section;
        const cap = SECTION_CAPS[sec] ?? 5;
        const rendered = sectionRendered.get(sec) ?? 0;
        const expanded = expandedSections.has(sec);
        const total = sectionTotals.get(sec) ?? 0;

        if (expanded || rendered < cap) {
          result.push(it);
          const newRendered = rendered + 1;
          sectionRendered.set(sec, newRendered);

          const nextIt = viewItems[i + 1];
          const isLastInSection = !nextIt || nextIt.kind === "header";

          if (!expanded && newRendered === cap && total > cap) {
            // Show-all sits directly below the last visible email.
            result.push({ kind: "show-all", sectionId: sec, total });
          } else if (expanded && isLastInSection) {
            // Show-less sits below the last email in an expanded section.
            result.push({ kind: "show-less", sectionId: sec });
          }
        } else {
          sectionRendered.set(sec, rendered + 1);
        }
      }
    }

    return result;
  }, [viewItems, expandedSections]);

  // Unread View mode: sort unread messages first, then read — flat list (no card styling).
  const isUnreadCardsView =
    viewMode === "unread-cards" &&
    tab !== "drafts" && tab !== "scheduled" && tab !== "folder" && tab !== "review" && tab !== "pinned";
  const unreadCardsMessages = useMemo<MessageSummary[]>(() => {
    if (!isUnreadCardsView || !crmFilteredMessages) return [];
    const unread = crmFilteredMessages.filter(m => isUnread(m.labelIds));
    const read = crmFilteredMessages.filter(m => !isUnread(m.labelIds));
    return [...unread, ...read];
  }, [isUnreadCardsView, crmFilteredMessages]);

  // Ordered message list that matches what's actually displayed on screen.
  // Keyboard nav + shift/cmd-click use this so arrow-key order matches visual order.
  const navList = useMemo<MessageSummary[]>(() => {
    if (tab === "drafts" || tab === "scheduled" || tab === "folder" || tab === "review") return [];
    if (isUnreadCardsView) return unreadCardsMessages;
    if (collapsedViewItems) return collapsedViewItems.filter((i): i is { kind: "msg"; section: SmartSectionId; msg: MessageSummary } => i.kind === "msg").map(i => i.msg);
    return crmFilteredMessages ?? [];
  }, [tab, isUnreadCardsView, unreadCardsMessages, collapsedViewItems, crmFilteredMessages]);

  const isLoading = isCategoryTab ? categoryQuery.isLoading : tab === "other" || tab === "pinned" ? inboxQuery.isLoading : tab === "inbox" ? inboxQuery.isLoading : tab === "spam" ? spamQuery.isLoading : sentQuery.isLoading;
  const error = isCategoryTab ? categoryQuery.error : tab === "other" || tab === "pinned" ? inboxQuery.error : tab === "inbox" ? inboxQuery.error : tab === "spam" ? spamQuery.error : sentQuery.error;
  // "Other" tab is a derived slice of the same inboxQuery — it must paginate too,
  // otherwise users land on Other and see only blocked-domain rows from the first 50.
  const hasMore =
    (tab === "inbox" || tab === "other") ? !!inboxNextToken :
    tab === "sent" ? !!sentNextToken :
    false;
  const isLoadingMore =
    (tab === "inbox" || tab === "other") ? loadingMoreInbox :
    tab === "sent" ? loadingMoreSent :
    false;
  const loadMore = (tab === "inbox" || tab === "other") ? loadMoreInbox : loadMoreSent;

  // ── Infinite scroll — stable observer (Apr 2026 fix for "hard stop after first batch") ──
  // Previous version listed `loadMore` (a fresh function every render) in deps, which tore the
  // observer down and rebuilt it on every render. Intersection events landing in the teardown
  // window were silently lost. We now attach the observer ONCE per scroll-container lifetime
  // and read current values via refs inside the callback. rootMargin prefetches ~600px ahead so
  // the next batch is in flight before the user reaches the literal bottom.
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef(loadMore);
  const hasMoreRef = useRef(hasMore);
  const isLoadingMoreRef = useRef(isLoadingMore);
  useEffect(() => { loadMoreRef.current = loadMore; }, [loadMore]);
  useEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);
  useEffect(() => { isLoadingMoreRef.current = isLoadingMore; }, [isLoadingMore]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    // Use the email list scroll container as root so the observer fires relative
    // to the internal scroll position — not the outer viewport. With the default
    // viewport root, elements clipped inside an overflow:hidden ancestor register
    // as non-intersecting even when the user has scrolled close to them, so the
    // auto-load never re-triggers after the first fire.
    const scrollRoot = inboxScrollRef.current ?? undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMoreRef.current && !isLoadingMoreRef.current) {
          loadMoreRef.current();
        }
      },
      { root: scrollRoot, rootMargin: "400px 0px", threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
    // Re-attach when the sentinel element mounts/unmounts. The sentinel is gated by
    // `!isLoading && !error`, so we MUST include those in deps — otherwise on first
    // render `sentinelRef.current` is null (sentinel not yet in DOM) and the observer
    // never attaches, breaking infinite scroll until the user manually switches tabs.
    //
    // `hasMore` is also included to fix a race condition on team-inbox first load:
    // the observer fires immediately after attachment (sentinel visible in the empty
    // scroll container) but at that instant `hasMoreRef.current` is still false because
    // Effect B (setInboxNextToken) hasn't run yet. Adding `hasMore` here forces the
    // observer to re-attach once Effect B sets the token and `hasMore` flips to true,
    // so the sentinel fires again with the correct ref value and triggers the first load.
  }, [tab, isLoading, error, hasMore]);

  // ── Visible-list starvation auto-chain (Apr 2026, hardening pass 3) ──
  // The IntersectionObserver only fires when the sentinel's intersection state CHANGES.
  // If the visible list (after ALL filters — blocked-domains, category, CRM) is shorter than
  // the viewport, the sentinel is intersecting on mount, fires ONCE, then never re-fires
  // because its state never changes. This stranded the inbox at "10 messages" for users
  // with heavy blocked-domain lists (LinkedIn etc.) who hadn't picked a category/CRM filter.
  //
  // Fix: auto-chain whenever the rendered list is starved (< 25 visible) AND more pages exist,
  // regardless of WHY it's starved (blocked-domain stripping, category, CRM, or all three).
  // Budget raised to 200 pages (10,000 raw messages) so the auto-chain runs for a very long
  // time without exhausting, enabling continuous-scroll without manual "Load more" clicks.
  // The chain resets when tab/account/search/source/category/CRM changes (new context = new
  // budget). When the budget is exhausted but `hasMore` stays true, the sentinel renders an
  // explicit "Load more" button so the user has a manual escape hatch — never silently stops.
  const autoChainRef = useRef({ key: "", count: 0 });
  // Use STATE (not ref) so the "more available" CTA re-renders the moment the budget is exhausted.
  const [autoChainExhaustedKey, setAutoChainExhaustedKey] = useState<string | null>(null);
  // Compute the inbox chain key once; reused by the auto-chain effect AND the
  // unconditional context-clear effect below, so a context switch ALWAYS wipes the
  // exhaustion flag — even when the auto-chain effect short-circuits (e.g. tab=sent).
  const inboxChainKey = `inbox-or-other|${activeAccountId ?? ""}|${searchQuery}|${inboxCategory}|${crmFilter}`;
  useEffect(() => {
    // Unconditional clear on any inbox-context change — never gated by hasMore/isLoading
    // so stale exhaustion can't bleed across mailbox/source/tab switches.
    setAutoChainExhaustedKey((prev) => (prev !== null && prev !== inboxChainKey ? null : prev));
  }, [inboxChainKey]);
  useEffect(() => {
    if (tab !== "inbox" && tab !== "other") return;
    if (!hasMore || isLoadingMore) return;
    if (autoChainRef.current.key !== inboxChainKey) {
      autoChainRef.current = { key: inboxChainKey, count: 0 };
    }
    // Guard on navList.length (the count actually rendered on screen) rather than
    // crmFilteredMessages.length. In "unread-cards" view all read messages are
    // filtered out of navList, so crmFilteredMessages.length could be 50+ while
    // the visible list is 0 — causing all three team-inbox bugs:
    //   (1) blank list with no empty-state, (2) category pills appear empty,
    //   (3) no further pages load.  Using navList.length here makes the chain
    // keep fetching until it finds enough unread messages (or exhausts the budget).
    if (navList.length >= 25) return;
    if (autoChainRef.current.count >= 200) {
      if (autoChainExhaustedKey !== inboxChainKey) setAutoChainExhaustedKey(inboxChainKey);
      dbg("autoChain:exhausted", { ctx: inboxChainKey, visible: navList.length, count: autoChainRef.current.count });
      return;
    }
    autoChainRef.current.count += 1;
    dbg("autoChain:fire", { ctx: inboxChainKey, iter: autoChainRef.current.count, visible: navList.length });
    // Use loadMoreRef.current() instead of loadMore directly — loadMore is a non-memoized
    // async function that changes reference every render, and including it in deps would
    // cause this effect to re-register (and potentially fire) on every render cycle.
    // loadMoreRef is kept current by a separate sync effect above.
    loadMoreRef.current();
  }, [tab, hasMore, isLoadingMore, inboxChainKey, navList.length, autoChainExhaustedKey]);

  // PART B — Smart Inbox unread auto-loader.
  // While Smart Inbox is open and the loaded unread count is below the server total,
  // keep paging automatically — without waiting for the scroll sentinel — so all
  // unread messages reach the grouper.  Safety caps: ≤10 cycles OR ≤500 messages.
  const smartUnreadLoaderRef = useRef<{ key: string; cycles: number }>({ key: "", cycles: 0 });
  useEffect(() => {
    // Only fire in Smart view, on the inbox tab, without an active search query.
    if (!isSmartView || tab !== "inbox" || searchQuery) return;
    // Need a next page and must not already be loading.
    if (!inboxNextToken || loadingMoreInbox) return;
    // Stop when server count is unknown (health/category query still loading).
    if (inboxCategoryServerUnread === 0) return;
    // Stop when all relevant unread messages are already loaded.
    // Uses category-specific count when in sub-category view so the loader
    // converges on the right target instead of the full inbox total.
    if (inboxUnreadCount >= inboxCategoryServerUnread) return;
    // Hard cap: don't load more than 2500 total messages via this path.
    if (allInboxMessages.length >= 2500) return;
    // Per-context cycle cap of 50 auto-loads.
    const loaderKey = inboxChainKey;
    if (smartUnreadLoaderRef.current.key !== loaderKey) {
      smartUnreadLoaderRef.current = { key: loaderKey, cycles: 0 };
    }
    if (smartUnreadLoaderRef.current.cycles >= 50) return;
    smartUnreadLoaderRef.current.cycles += 1;
    loadMoreRef.current();
  }, [isSmartView, tab, searchQuery, inboxNextToken, loadingMoreInbox,
      inboxUnreadCount, inboxCategoryServerUnread, allInboxMessages.length, inboxChainKey]);

  // PART C — Unread stall safety-net refetch.
  // If the server reports unread messages exist (serverInboxUnreadCount > 0) but the
  // rendered list is empty after loading is done, fire ONE refetch per context key to
  // break the stall.  This covers an edge case where the TanStack cache serves stale
  // empty data before the new queryFn result arrives.  The ref guard prevents loops.
  const _unreadStallRefetchRef = useRef<string>("");
  useEffect(() => {
    if (
      tab !== "inbox" ||
      crmFilter !== "unread" ||
      isLoading ||
      loadingMoreInbox ||
      serverInboxUnreadCount <= 0 ||
      (crmFilteredMessages?.length ?? 0) > 0
    ) return;
    const key = `${activeAccountId ?? "all"}-${crmFilter}`;
    if (_unreadStallRefetchRef.current === key) return;   // already fired for this context
    _unreadStallRefetchRef.current = key;
    inboxQuery.refetch();
  }, [tab, crmFilter, isLoading, loadingMoreInbox, serverInboxUnreadCount,
      crmFilteredMessages?.length, activeAccountId]);

  // Strictly scope: only render the "more available" CTA when (a) we exhausted THIS chain key,
  // (b) we're on a tab where auto-chain even applies, and (c) hasMore is still true.
  const autoChainExhausted =
    autoChainExhaustedKey === inboxChainKey &&
    (tab === "inbox" || tab === "other") &&
    hasMore;

  // Batch fetch signal + triage data for visible thread IDs
  const visibleThreadIds = useMemo(
    () => [...new Set((crmFilteredMessages || []).map(m => m.threadId))].sort(),
    [crmFilteredMessages]
  );
  const threadSignalsQuery = useQuery<Record<string, ThreadSignal>>({
    // Use a stable hash-style key so React Query caches correctly.
    // The join is only for cache key uniqueness — it never goes into the URL now.
    queryKey: ["/api/inbox/thread-signals", visibleThreadIds.join(",")],
    queryFn: async () => {
      if (!visibleThreadIds.length) return {};
      // POST instead of GET: thread IDs live in the request body, never in the
      // URL query string.  A long GET query string pushes total request-header
      // bytes past the Replit proxy's ~8 KB limit and returns HTTP 431.
      const res = await fetch("/api/inbox/thread-signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ threadIds: visibleThreadIds.join(",") }),
      });
      // 431 = Request Header Fields Too Large (still-oversized Cookie header).
      // 4xx from upstream / network: return empty object — do not let React Query
      // auto-retry in a tight loop, which would flood the proxy with 431s.
      if (res.status === 431) {
        console.warn("[thread-signals] 431 Request Header Fields Too Large — Cookie header may be oversized. Run window.__debugCookies() to inspect.");
        return {};
      }
      if (!res.ok) return {};
      return res.json();
    },
    enabled: visibleThreadIds.length > 0 && (tab === "inbox" || tab === "sent" || isCategoryTab),
    staleTime: 30000,
    // Never auto-retry — a 431/network error will keep firing if we retry.
    retry: false,
    // Keep previous signal data visible while a new key (larger thread-ID list) loads.
    // Without this, when loadMore() adds emails and visibleThreadIds grows, all CRM signal
    // badges (replied/hot/awaiting) briefly disappear on every row until the new fetch
    // completes — the most visible cause of per-row "blipping" during startup.
    placeholderData: (prev: Record<string, ThreadSignal> | undefined) => prev,
  });
  const threadSignals = threadSignalsQuery.data ?? {};

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(search);
    setSelectedMessageId(null);
    setSelectedThreadId(null);
  };

  const handleSelectMessage = (msg: MessageSummary) => {
    setSelectedMessageId(msg.id);
    setSelectedThreadId(msg.threadId);
    // Record whether this thread was unread at click time so the grouper can
    // keep it in the unread bucket only during the genuine unread→read transition.
    setOpenThreadWasUnread(isUnread(msg.labelIds));
    // Multi-mailbox Phase 1: capture the source account so thread reads + mutations target
    // the correct mailbox when we're in unified mode. Outside unified mode this is unused.
    setCurrentThreadAccountId(msg.sourceAccountId ?? null);

    if (isUnread(msg.labelIds)) {
      // Immediately remove UNREAD from both inbox query caches so the email
      // row loses its bold/dot styling right away, while the smart-inbox
      // grouper keeps the thread in its current section until the user moves
      // to a different thread (see openThreadId passed to groupSmartInbox).
      // NOTE: setQueriesData with a partial prefix key matches ALL inbox queries
      // regardless of the inboxCategory / crmFilter key segments — this is
      // required because the 6-part inboxQuery key would not match a 4-part setQueryData call.
      const removeUnread = (old: { messages: MessageSummary[]; nextPageToken: string | null } | undefined) =>
        old ? { ...old, messages: old.messages.map((m) =>
          m.id === msg.id ? { ...m, labelIds: m.labelIds.filter((l) => l !== "UNREAD") } : m
        ) } : old;
      queryClient.setQueriesData({ queryKey: ["/api/gmail/messages", "inbox"] }, removeUnread);
      queryClient.setQueriesData({ queryKey: ["/api/gmail/messages", "sent"] }, removeUnread);
      // Also update the locally-stored extra pages
      setInboxExtra((prev) => prev.map((m) => m.id === msg.id ? { ...m, labelIds: m.labelIds.filter((l) => l !== "UNREAD") } : m));
      setSentExtra((prev) => prev.map((m) => m.id === msg.id ? { ...m, labelIds: m.labelIds.filter((l) => l !== "UNREAD") } : m));

      // Fire-and-forget — tell Gmail to mark it read server-side. In unified mode we send
      // the message's specific sourceAccountId, since /mark-read parses asAccountId as Number.
      const accId = msg.sourceAccountId ?? (typeof activeAccountId === "number" ? activeAccountId : null);
      fetch(`/api/gmail/messages/${msg.id}/mark-read`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accId ? { asAccountId: accId } : {}),
      }).catch(() => {/* silent — cache already updated */});
    }
  };

  const handleBack = () => {
    setSelectedMessageId(null);
    setSelectedThreadId(null);
    setOpenThreadWasUnread(false);
  };

  // Nudge the FAB up when the email reading pane is open so it never sits on
  // top of the CRM links / reply / triage buttons at the bottom of the pane.
  // The reading pane footer is ~220px tall; we add 16px breathing room → 236px.
  // Reset to the default 40px offset when no thread is selected, and also on
  // page unmount so other pages always start with the FAB in its default spot.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("fab-nudge", {
        detail: { bottom: selectedThreadId ? 236 : 40 },
      })
    );
    return () => {
      // Only reset on unmount (selectedThreadId dependency runs cleanup before
      // re-running, but we only want the unmount reset here — the dispatch above
      // handles the per-state transitions).
    };
  }, [selectedThreadId]);

  useEffect(() => {
    return () => {
      window.dispatchEvent(new CustomEvent("fab-nudge", { detail: { bottom: 40 } }));
    };
  }, []);

  // ── FORWARD_REPLY_TRACE helpers ─────────────────────────────────────────────
  // Always on in dev (import.meta.env.DEV), or enable at runtime with:
  //   localStorage.setItem('FORWARD_REPLY_TRACE', 'true')
  const _frtEnabled = (import.meta.env.DEV as boolean) ||
    (typeof localStorage !== "undefined" && localStorage.getItem("FORWARD_REPLY_TRACE") === "true");
  const [frtEvents, setFrtEvents] = useState<Array<{ stage: string; ts: number; data: Record<string, any> }>>([]);
  const frtLog = (action: string, data: Record<string, any>) => {
    if (!_frtEnabled) return;
    const evt = { stage: action, ts: Date.now(), data };
    setFrtEvents(prev => [...prev.slice(-99), evt]);
    console.log(`[FRT:${action}]`, { ...data, _ts: evt.ts });
  };
  const _frtSnippet = (s: string | null | undefined, len = 200) => (s ?? "").slice(0, len);
  const _frtTail    = (s: string | null | undefined, len = 200) => (s ?? "").slice(-(len));
  const _frtAtOld4K  = (n: number) => n >= 3900 && n <= 4100;
  const _frtAtOld200K = (n: number) => n >= 199000 && n <= 201000;

  // Fetches the full body_html for a message at compose time.
  // Fast path: returns body_html from DB (~0ms). Slow path: fetches live from Gmail.
  const fetchFullMessageBody = async (msgId: string) => {
    const qs = activeAccountId && activeAccountId !== "all"
      ? `?asAccountId=${activeAccountId}` : "";
    try {
      const r = await fetch(
        `/api/gmail/messages/${encodeURIComponent(msgId)}/full-body${qs}`,
        { credentials: "include" }
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json() as {
        bodyHtml: string; bodyText: string; isHtml: boolean; source: string;
        bodyHtmlLength?: number; bodyTextLength?: number;
        first200Html?: string; last200Html?: string;
        first200Text?: string; last200Text?: string;
        atOld4KCap?: boolean; atOld200KCap?: boolean;
        snippetLen?: number; snippet200?: string; dbId?: number;
      };
      const htmlLen = json.bodyHtmlLength ?? json.bodyHtml?.length ?? 0;
      const textLen = json.bodyTextLength ?? json.bodyText?.length ?? 0;
      frtLog("A:db-full-body", {
        msgId,
        source: json.source,
        isHtml: json.isHtml,
        dbId: json.dbId,
        bodyHtmlLen: htmlLen,
        bodyTextLen: textLen,
        first200Html: json.first200Html ?? _frtSnippet(json.bodyHtml),
        last200Html:  json.last200Html  ?? _frtTail(json.bodyHtml),
        first200Text: json.first200Text ?? _frtSnippet(json.bodyText),
        last200Text:  json.last200Text  ?? _frtTail(json.bodyText),
        atOld4KCap:   json.atOld4KCap   ?? _frtAtOld4K(textLen),
        atOld200KCap: json.atOld200KCap ?? _frtAtOld200K(htmlLen),
        snippetLen: json.snippetLen,
        snippet200: json.snippet200,
      });
      return json;
    } catch (e: any) {
      console.warn("[frt] fetchFullMessageBody failed:", e.message);
      return { bodyHtml: "", bodyText: "", isHtml: false, source: "error" } as const;
    }
  };

  // Builds a multi-message quoted thread block (used as fallback for Reply/Reply-All
  // when the focused message has no body_html so the full prior chain is preserved).
  const buildThreadQuoteBlock = (msgs: ThreadMessage[]): string =>
    msgs.map((m, idx) => {
      const mDate = m.date || (m.internalDate ? new Date(Number(m.internalDate)).toLocaleString() : "");
      const mBody = m.isHtml
        ? (m.body || "")
        : `<pre style="font-family:inherit;white-space:pre-wrap;">${escHtml(m.body || "")}</pre>`;
      const divider = idx > 0 ? `<div style="margin:12px 0;border-top:1px solid #e8e8e8;"></div>` : "";
      return `${divider}<p style="margin:0 0 4px 0;font-size:11px;color:#888;font-weight:bold;">${escHtml(m.from || "Unknown")}&nbsp;&nbsp;<span style="font-weight:normal;">${escHtml(mDate)}</span></p>${mBody}`;
    }).join("");

  // Like buildThreadQuoteBlock but allows per-message body overrides.
  // Use this when a freshly-fetched full body (from fetchFullMessageBody) should
  // replace the 4K-capped Stage-B cache value for the focused message.
  // overridesByMessageId keys are checked against both m.id (gmailMessageId) and
  // any secondary id so either lookup works.
  const buildThreadQuoteBlockWithOverrides = (
    msgs: ThreadMessage[],
    overridesByMessageId: Map<string, { body: string; isHtml: boolean; source: string }>
  ): string =>
    msgs.map((m, idx) => {
      const override = overridesByMessageId.get(m.id);
      const body   = override ? override.body   : (m.body   || "");
      const isHtml = override ? override.isHtml : m.isHtml;
      const mDate  = m.date || (m.internalDate ? new Date(Number(m.internalDate)).toLocaleString() : "");
      const mBody  = isHtml
        ? body
        : `<pre style="font-family:inherit;white-space:pre-wrap;">${escHtml(body)}</pre>`;
      const divider = idx > 0 ? `<div style="margin:12px 0;border-top:1px solid #e8e8e8;"></div>` : "";
      return `${divider}<p style="margin:0 0 4px 0;font-size:11px;color:#888;font-weight:bold;">${escHtml(m.from || "Unknown")}&nbsp;&nbsp;<span style="font-weight:normal;">${escHtml(mDate)}</span></p>${mBody}`;
    }).join("");

  // ── Reply ─────────────────────────────────────────────────────────────────
  const handleReply = async (msg: ThreadMessage) => {
    const dateStr = msg.date || (msg.internalDate ? new Date(Number(msg.internalDate)).toLocaleString() : "");
    let quotedHtml = msg.body || "";
    let bodySource = msg.isHtml ? "body_html" : (msg.body ? "body_text_truncated" : "empty");

    frtLog("C:reply:start", {
      action: "reply", msgId: msg.id, isHtml: msg.isHtml,
      bodyLen: msg.body?.length ?? 0, bodySource,
      first200: _frtSnippet(msg.body), last200: _frtTail(msg.body),
      atOld4KCap: _frtAtOld4K(msg.body?.length ?? 0),
      atOld200KCap: _frtAtOld200K(msg.body?.length ?? 0),
      threadMsgCount: threadQuery.data?.messages?.length ?? 0,
    });

    // If stored body is plain-text (body_html was empty/null in DB), fetch the full HTML on-demand.
    // body_text is stored with a 4 KB historical limit — plain-text emails and unbackfilled messages
    // would produce a severely truncated quoted block without this fetch.
    if (!msg.isHtml) {
      const full = await fetchFullMessageBody(msg.id);
      frtLog("A:reply:full-body-fetch", {
        source: full.source, isHtml: full.isHtml,
        htmlLen: full.bodyHtml?.length ?? 0, textLen: full.bodyText?.length ?? 0,
        first200Html: _frtSnippet(full.bodyHtml), last200Html: _frtTail(full.bodyHtml),
        first200Text: _frtSnippet(full.bodyText), last200Text: _frtTail(full.bodyText),
      });
      // Build override map: hydrate the focused message with the freshly-fetched
      // full body so buildThreadQuoteBlockWithOverrides doesn't use the 4K-capped
      // Stage-B cache value for it.
      const _replyOverrides = new Map<string, { body: string; isHtml: boolean; source: string }>();
      if (full.bodyHtml) {
        _replyOverrides.set(msg.id, { body: full.bodyHtml, isHtml: true,  source: full.source ?? "full-body" });
      } else if (full.bodyText) {
        _replyOverrides.set(msg.id, { body: full.bodyText, isHtml: false, source: full.source ?? "full-body" });
      }

      if (full.bodyHtml) {
        quotedHtml = full.bodyHtml;
        bodySource = `full-body:${full.source}`;
      } else {
        // Pure plain-text email or fetch failed — use full thread context so prior messages survive.
        // IMPORTANT: use buildThreadQuoteBlockWithOverrides so the focused message uses the
        // freshly-fetched full bodyText instead of the 4K-capped body_text from the Stage-B cache.
        const allMsgs = threadQuery.data?.messages || [msg];
        const plainText = full.bodyText || msg.body || "";
        if (allMsgs.length > 1) {
          if (_replyOverrides.size > 0) {
            frtLog("C:reply:override-applied", {
              action: "reply", msgId: msg.id,
              overrideSource: full.source,
              overrideBodyLen: (full.bodyText || "").length,
              cachedBodyLen: msg.body?.length ?? 0,
              overrideCount: _replyOverrides.size,
            });
          }
          quotedHtml = buildThreadQuoteBlockWithOverrides(allMsgs, _replyOverrides);
          bodySource = _replyOverrides.size > 0 ? "thread-context-with-overrides" : "thread-context-fallback";
        } else {
          quotedHtml = `<pre style="font-family:inherit;white-space:pre-wrap;">${escHtml(plainText)}</pre>`;
          bodySource = "plaintext-fallback";
        }
      }
    }

    frtLog("C:reply:final", {
      action: "reply", msgId: msg.id, bodySource,
      quotedHtmlLen: quotedHtml.length,
      first200: _frtSnippet(quotedHtml), last200: _frtTail(quotedHtml),
      atOld4KCap: _frtAtOld4K(quotedHtml.length),
      atOld200KCap: _frtAtOld200K(quotedHtml.length),
    });

    const _replyToPayload = {
      to: parseSenderEmail(msg.from),
      subject: msg.subject.startsWith("Re:") ? msg.subject : `Re: ${msg.subject}`,
      threadId: msg.threadId,
      fromName: parseSenderName(msg.from),
      quotedHtml,
      quotedFrom: msg.from || "",
      quotedDate: dateStr,
    };
    frtLog("D:compose:set-replyTo", {
      action: "reply",
      quotedHtmlLen: (_replyToPayload.quotedHtml ?? "").length,
      first200: _frtSnippet(_replyToPayload.quotedHtml),
      last200: _frtTail(_replyToPayload.quotedHtml),
    });
    setReplyTo(_replyToPayload);
  };

  // ── Reply All ─────────────────────────────────────────────────────────────
  const handleReplyAll = async (msg: ThreadMessage) => {
    const ownEmail = currentUserEmail.toLowerCase();
    const allRecipients = [msg.to, msg.cc]
      .filter(Boolean)
      .join(", ")
      .split(/,\s*/)
      .map((e) => e.trim())
      .filter((e) => e && parseSenderEmail(e).toLowerCase() !== ownEmail);
    const dateStr = msg.date || (msg.internalDate ? new Date(Number(msg.internalDate)).toLocaleString() : "");
    let quotedHtml = msg.body || "";
    let bodySource = msg.isHtml ? "body_html" : (msg.body ? "body_text_truncated" : "empty");

    frtLog("C:replyAll:start", {
      action: "replyAll", msgId: msg.id, isHtml: msg.isHtml,
      bodyLen: msg.body?.length ?? 0, bodySource, ccCount: allRecipients.length,
      first200: _frtSnippet(msg.body), last200: _frtTail(msg.body),
      atOld4KCap: _frtAtOld4K(msg.body?.length ?? 0),
      atOld200KCap: _frtAtOld200K(msg.body?.length ?? 0),
      threadMsgCount: threadQuery.data?.messages?.length ?? 0,
    });

    if (!msg.isHtml) {
      const full = await fetchFullMessageBody(msg.id);
      frtLog("A:replyAll:full-body-fetch", {
        source: full.source, isHtml: full.isHtml,
        htmlLen: full.bodyHtml?.length ?? 0, textLen: full.bodyText?.length ?? 0,
        first200Html: _frtSnippet(full.bodyHtml), last200Html: _frtTail(full.bodyHtml),
        first200Text: _frtSnippet(full.bodyText), last200Text: _frtTail(full.bodyText),
      });
      // Build override map: hydrate the focused message with the freshly-fetched
      // full body so buildThreadQuoteBlockWithOverrides doesn't use the 4K-capped
      // Stage-B cache value for it.
      const _raOverrides = new Map<string, { body: string; isHtml: boolean; source: string }>();
      if (full.bodyHtml) {
        _raOverrides.set(msg.id, { body: full.bodyHtml, isHtml: true,  source: full.source ?? "full-body" });
      } else if (full.bodyText) {
        _raOverrides.set(msg.id, { body: full.bodyText, isHtml: false, source: full.source ?? "full-body" });
      }

      if (full.bodyHtml) {
        quotedHtml = full.bodyHtml;
        bodySource = `full-body:${full.source}`;
      } else {
        // Pure plain-text email or fetch failed — use full thread context so prior messages survive.
        // IMPORTANT: use buildThreadQuoteBlockWithOverrides so the focused message uses the
        // freshly-fetched full bodyText instead of the 4K-capped body_text from the Stage-B cache.
        const allMsgs = threadQuery.data?.messages || [msg];
        const plainText = full.bodyText || msg.body || "";
        if (allMsgs.length > 1) {
          if (_raOverrides.size > 0) {
            frtLog("C:replyAll:override-applied", {
              action: "replyAll", msgId: msg.id,
              overrideSource: full.source,
              overrideBodyLen: (full.bodyText || "").length,
              cachedBodyLen: msg.body?.length ?? 0,
              overrideCount: _raOverrides.size,
            });
          }
          quotedHtml = buildThreadQuoteBlockWithOverrides(allMsgs, _raOverrides);
          bodySource = _raOverrides.size > 0 ? "thread-context-with-overrides" : "thread-context-fallback";
        } else {
          quotedHtml = `<pre style="font-family:inherit;white-space:pre-wrap;">${escHtml(plainText)}</pre>`;
          bodySource = "plaintext-fallback";
        }
      }
    }

    frtLog("C:replyAll:final", {
      action: "replyAll", msgId: msg.id, bodySource,
      quotedHtmlLen: quotedHtml.length,
      first200: _frtSnippet(quotedHtml), last200: _frtTail(quotedHtml),
      atOld4KCap: _frtAtOld4K(quotedHtml.length),
      atOld200KCap: _frtAtOld200K(quotedHtml.length),
    });

    const _raPayload = {
      to: parseSenderEmail(msg.from),
      cc: allRecipients.length > 0 ? allRecipients.join(", ") : undefined,
      subject: msg.subject.startsWith("Re:") ? msg.subject : `Re: ${msg.subject}`,
      threadId: msg.threadId,
      fromName: parseSenderName(msg.from),
      quotedHtml,
      quotedFrom: msg.from || "",
      quotedDate: dateStr,
    };
    frtLog("D:compose:set-replyAll", {
      action: "replyAll",
      quotedHtmlLen: (_raPayload.quotedHtml ?? "").length,
      first200: _frtSnippet(_raPayload.quotedHtml),
      last200: _frtTail(_raPayload.quotedHtml),
    });
    setReplyTo(_raPayload);
  };

  // ── Forward ───────────────────────────────────────────────────────────────
  const handleForward = async (msg: ThreadMessage) => {
    const dateStr = msg.date || (msg.internalDate ? new Date(Number(msg.internalDate)).toUTCString() : "");
    const allMsgs = threadQuery.data?.messages || [msg];

    frtLog("C:forward:start", {
      action: "forward", msgId: msg.id, threadMsgCount: allMsgs.length,
      focusedBodyLen: msg.body?.length ?? 0,
      first200: _frtSnippet(msg.body), last200: _frtTail(msg.body),
      atOld4KCap: _frtAtOld4K(msg.body?.length ?? 0),
      atOld200KCap: _frtAtOld200K(msg.body?.length ?? 0),
      msgsWithoutHtml: allMsgs.filter((m) => !m.isHtml).map((m) => m.id),
    });

    // For every message without body_html, fetch the full body on-demand in parallel.
    // This covers: emails not yet backfilled, pure plain-text emails (body_text 4 KB limit).
    const resolvedMsgs = await Promise.all(allMsgs.map(async (m) => {
      if (m.isHtml && (m.body?.length ?? 0) > 0) {
        frtLog("C:forward:msg-ok", {
          msgId: m.id, source: "body_html", len: m.body.length,
          first200: _frtSnippet(m.body), last200: _frtTail(m.body),
          atOld4KCap: _frtAtOld4K(m.body.length), atOld200KCap: _frtAtOld200K(m.body.length),
        });
        return { m, resolvedBody: m.body, resolvedIsHtml: true, bodySource: "body_html" };
      }
      const full = await fetchFullMessageBody(m.id);
      frtLog("A:forward:msg-fetch", {
        msgId: m.id, source: full.source, isHtml: full.isHtml,
        htmlLen: full.bodyHtml?.length ?? 0, textLen: full.bodyText?.length ?? 0,
        first200Html: _frtSnippet(full.bodyHtml), last200Html: _frtTail(full.bodyHtml),
        first200Text: _frtSnippet(full.bodyText), last200Text: _frtTail(full.bodyText),
      });
      if (full.bodyHtml) {
        return { m, resolvedBody: full.bodyHtml, resolvedIsHtml: true, bodySource: `full-body:${full.source}` };
      }
      return {
        m,
        resolvedBody: full.bodyText || m.body || "",
        resolvedIsHtml: false,
        bodySource: "plaintext-fallback",
      };
    }));

    let quotedHtml: string;
    if (resolvedMsgs.length === 1) {
      const { resolvedBody, resolvedIsHtml } = resolvedMsgs[0];
      quotedHtml = resolvedIsHtml
        ? resolvedBody
        : `<pre style="font-family:inherit;white-space:pre-wrap;">${escHtml(resolvedBody)}</pre>`;
    } else {
      quotedHtml = resolvedMsgs.map(({ m, resolvedBody, resolvedIsHtml }, idx) => {
        const mDate = m.date || (m.internalDate ? new Date(Number(m.internalDate)).toLocaleString() : "");
        const mBody = resolvedIsHtml
          ? resolvedBody
          : `<pre style="font-family:inherit;white-space:pre-wrap;">${escHtml(resolvedBody)}</pre>`;
        const divider = idx > 0 ? `<div style="margin:12px 0;border-top:1px solid #e8e8e8;"></div>` : "";
        return `${divider}<p style="margin:0 0 4px 0;font-size:11px;color:#888;font-weight:bold;">${escHtml(m.from || "Unknown")}&nbsp;&nbsp;<span style="font-weight:normal;">${escHtml(mDate)}</span></p>${mBody}`;
      }).join("");
    }

    frtLog("C:forward:final", {
      action: "forward", msgId: msg.id, threadMsgCount: allMsgs.length,
      quotedHtmlLen: quotedHtml.length,
      first200: _frtSnippet(quotedHtml), last200: _frtTail(quotedHtml),
      atOld4KCap: _frtAtOld4K(quotedHtml.length),
      atOld200KCap: _frtAtOld200K(quotedHtml.length),
    });

    const _fwdPayload = {
      to: "" as string,
      subject: msg.subject.startsWith("Fwd:") ? msg.subject : `Fwd: ${msg.subject}`,
      body: "",
      isForward: true,
      quotedHtml,
      quotedFrom: msg.from || "",
      quotedDate: dateStr,
      forwardSubject: msg.subject || "",
      forwardTo: msg.to || "",
    };
    frtLog("D:compose:set-forward", {
      action: "forward",
      quotedHtmlLen: (_fwdPayload.quotedHtml ?? "").length,
      first200: _frtSnippet(_fwdPayload.quotedHtml),
      last200: _frtTail(_fwdPayload.quotedHtml),
    });
    setReplyTo(null);
    setComposeInitial(_fwdPayload);
  };

  const selectedMessages = threadQuery.data?.messages || [];
  const focusedMsg = selectedMessages.find((m) => m.id === selectedMessageId) || selectedMessages[selectedMessages.length - 1];
  // Newest-first display order (Spark Mail pattern): most recent email shown at top,
  // older messages collapsed below it for reference.
  const displayMessages = [...selectedMessages].reverse();

  // Parent-level slice of /api/gmail/thread-record so the actions toolbar can
  // read the current assignedUserId WITHOUT re-fetching when the insights
  // panel is mounted (react-query dedupes by query key — both consumers
  // share the same network request and cache entry).
  const readerThreadRecordQuery = useQuery<ThreadRecord>({
    queryKey: ["/api/gmail/thread-record", selectedThreadId],
    queryFn: async () => {
      const res = await fetch(`/api/gmail/thread-record/${selectedThreadId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load thread record");
      return res.json();
    },
    enabled: !!selectedThreadId,
  });
  const readerAssignedUserId = readerThreadRecordQuery.data?.thread?.assignedUserId ?? null;

  // ── Click handler with modifier support ─────────────────────────────────────
  const handleEmailRowClick = (e: React.MouseEvent, msg: MessageSummary) => {
    const idx = navList.findIndex(m => m.threadId === msg.threadId);
    if (e.metaKey || e.ctrlKey) {
      // Cmd/Ctrl+click → toggle this thread in bulk selection without opening it
      e.preventDefault();
      toggleInboxSelection(msg.threadId);
      lastAnchorIdxRef.current = idx;
    } else if (e.shiftKey && lastAnchorIdxRef.current >= 0 && idx >= 0) {
      // Shift+click → select a range from the last anchor to here
      e.preventDefault();
      const lo = Math.min(lastAnchorIdxRef.current, idx);
      const hi = Math.max(lastAnchorIdxRef.current, idx);
      setSelectedInboxIds(prev => {
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) {
          if (navList[i]) next.add(navList[i].threadId);
        }
        return next;
      });
    } else {
      // Plain click → open thread; clear any bulk selection first
      if (selectedInboxIds.size > 0) setSelectedInboxIds(new Set());
      if (selectedDraftIds.size > 0) setSelectedDraftIds(new Set());
      handleSelectMessage(msg);
      lastAnchorIdxRef.current = idx;
    }
  };

  // ── Inbox view picker — close on outside click ────────────────────────────
  useEffect(() => {
    if (!inboxViewPickerOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideBtn = inboxViewPickerBtnRef.current?.contains(target);
      const insidePanel = inboxViewPickerRef.current?.contains(target);
      if (!insideBtn && !insidePanel) {
        setInboxViewPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [inboxViewPickerOpen]);

  // ── Keyboard navigation ────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      // Cmd/Ctrl+A → select all visible email threads (prevent browser text-select)
      if ((e.metaKey || e.ctrlKey) && (e.key === "a" || e.key === "A") && !e.altKey) {
        if (tab !== "scheduled" && tab !== "review") {
          e.preventDefault();
          selectAllInboxThreads();
          return;
        }
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const list = navList;
      const currentIdx = list.findIndex(m => m.threadId === selectedThreadId);

      const focusRow = (msg: MessageSummary) => {
        requestAnimationFrame(() => {
          const el = document.querySelector(`[data-testid="email-row-${msg.id}"]`) as HTMLElement | null;
          if (el) {
            el.focus({ preventScroll: true });
            el.scrollIntoView({ block: "nearest", behavior: "smooth" });
          }
        });
      };

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          if (list.length > 0) {
            const next = currentIdx < list.length - 1 ? currentIdx + 1 : 0;
            handleSelectMessage(list[next]);
            focusRow(list[next]);
          }
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          if (list.length > 0 && currentIdx > 0) {
            handleSelectMessage(list[currentIdx - 1]);
            focusRow(list[currentIdx - 1]);
          }
          break;
        case "r":
          if (focusedMsg) { e.preventDefault(); handleReply(focusedMsg); }
          break;
        case "c":
          if (canSend) { e.preventDefault(); setReplyTo(null); setComposeOpen(true); }
          break;
        case "s":
          if (focusedMsg) { e.preventDefault(); toggleStarMutation.mutate(focusedMsg.id); }
          break;
        case "x":
          if (selectedThreadId && tab === "inbox") {
            e.preventDefault();
            toggleInboxSelection(selectedThreadId);
          }
          break;
        case "f":
        case "F":
          if (selectedThreadId) { e.preventDefault(); setFocusMode((v) => !v); }
          break;
        case "Escape":
          if (focusMode) { e.preventDefault(); setFocusMode(false); }
          else if (selectedInboxIds.size > 0) { e.preventDefault(); setSelectedInboxIds(new Set()); }
          else if (selectedDraftIds.size > 0) { e.preventDefault(); setSelectedDraftIds(new Set()); }
          else if (confirmDeleteAll) { e.preventDefault(); setConfirmDeleteAll(false); }
          else if (selectedThreadId) { e.preventDefault(); handleBack(); }
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [tab, navList, selectedThreadId, focusedMsg, canSend, selectedInboxIds, selectedDraftIds, confirmDeleteAll, focusMode]);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 sm:px-4 py-1 border-b border-border/40 bg-background/80 backdrop-blur-sm flex-shrink-0">
        <button
          type="button"
          onClick={handleNavigateBack}
          data-testid="button-inbox-back"
          className="inline-flex items-center gap-1 h-7 px-1.5 rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-muted/50 transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 outline-none flex-shrink-0"
          aria-label="Back"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="text-[12px] font-medium">Back</span>
        </button>
        <div className="w-px h-4 bg-border/50 flex-shrink-0" />
        {/* ── Inbox View Picker (Spark-style) ─────────────────────────── */}
        <div className="relative min-w-0">
          <button
            ref={inboxViewPickerBtnRef}
            type="button"
            onClick={() => {
              if (!inboxViewPickerOpen) {
                const rect = inboxViewPickerBtnRef.current?.getBoundingClientRect();
                if (rect) setInboxViewPickerAnchor({ top: rect.bottom + 6, left: rect.left });
              }
              setInboxViewPickerOpen(v => !v);
            }}
            data-testid="button-inbox-view-picker"
            className="inline-flex items-center gap-1.5 h-7 px-1.5 rounded-md hover:bg-muted/50 transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 outline-none min-w-0 max-w-[240px]"
          >
            <Mail className="h-3.5 w-3.5 text-primary/70 flex-shrink-0" />
            <div className="min-w-0 text-left">
              <div className="text-[12px] font-semibold leading-tight text-foreground/80" data-testid="text-page-title">Mail</div>
              <div className="text-[10px] text-muted-foreground/65 truncate hidden sm:block leading-tight">
                {viewMode === "smart" ? "Smart Inbox" : viewMode === "unread-cards" ? "Unread View" : "Simple List"}
              </div>
            </div>
            <ChevronDown className={`h-3 w-3 text-muted-foreground/55 flex-shrink-0 transition-transform duration-150 ${inboxViewPickerOpen ? "rotate-180" : ""}`} />
          </button>

          {inboxViewPickerOpen && inboxViewPickerAnchor && createPortal(
            <div
              ref={inboxViewPickerRef}
              className="fixed z-[99999] rounded-xl border border-border/60 bg-popover shadow-xl shadow-black/20 p-3 animate-in fade-in-0 zoom-in-95 duration-100 origin-top-left"
              style={{ top: inboxViewPickerAnchor.top, left: inboxViewPickerAnchor.left, width: 380 }}
            >
              <div className="text-[11px] font-semibold text-foreground/70 mb-2.5 px-0.5">Choose your Inbox View</div>
              <div className="flex gap-2.5">
                {([
                  {
                    key: "smart" as const,
                    name: "Smart Inbox View",
                    sub: "Grouped by category",
                    illustration: (
                      <svg viewBox="0 0 72 52" fill="none" className="w-full h-full">
                        <rect width="72" height="52" rx="4" fill="currentColor" className="text-muted/40" />
                        <rect x="6" y="7" width="20" height="2.5" rx="1.25" fill="currentColor" className="text-amber-400/80" />
                        <rect x="6" y="12" width="60" height="7" rx="2" fill="currentColor" className="text-muted-foreground/10" />
                        <circle cx="10" cy="15.5" r="2.5" fill="currentColor" className="text-amber-400/70" />
                        <rect x="15" y="13.5" width="22" height="1.5" rx="0.75" fill="currentColor" className="text-foreground/60" />
                        <rect x="15" y="16" width="32" height="1" rx="0.5" fill="currentColor" className="text-muted-foreground/40" />
                        <rect x="6" y="22" width="28" height="2" rx="1" fill="currentColor" className="text-primary/60" />
                        <rect x="6" y="27" width="60" height="7" rx="2" fill="currentColor" className="text-muted-foreground/10" />
                        <circle cx="10" cy="30.5" r="2.5" fill="currentColor" className="text-blue-400/70" />
                        <rect x="15" y="28.5" width="26" height="1.5" rx="0.75" fill="currentColor" className="text-foreground/60" />
                        <rect x="15" y="31" width="36" height="1" rx="0.5" fill="currentColor" className="text-muted-foreground/40" />
                        <rect x="6" y="37" width="60" height="7" rx="2" fill="currentColor" className="text-muted-foreground/10" />
                        <circle cx="10" cy="40.5" r="2.5" fill="currentColor" className="text-blue-400/50" />
                        <rect x="15" y="38.5" width="20" height="1.5" rx="0.75" fill="currentColor" className="text-foreground/40" />
                        <rect x="15" y="41" width="30" height="1" rx="0.5" fill="currentColor" className="text-muted-foreground/25" />
                      </svg>
                    ),
                  },
                  {
                    key: "unread-cards" as const,
                    name: "Unread View",
                    sub: "Unread first",
                    illustration: (
                      <svg viewBox="0 0 72 52" fill="none" className="w-full h-full">
                        <rect width="72" height="52" rx="4" fill="currentColor" className="text-muted/40" />
                        <rect x="6" y="6" width="60" height="18" rx="3" fill="currentColor" className="text-primary/10" stroke="currentColor" strokeWidth="0.75" strokeOpacity="0.4" />
                        <circle cx="12" cy="15" r="4" fill="currentColor" className="text-primary/50" />
                        <rect x="19" y="9.5" width="24" height="2" rx="1" fill="currentColor" className="text-foreground/70" />
                        <rect x="19" y="13" width="38" height="1.5" rx="0.75" fill="currentColor" className="text-muted-foreground/45" />
                        <rect x="19" y="16" width="28" height="1.5" rx="0.75" fill="currentColor" className="text-muted-foreground/30" />
                        <rect x="6" y="27" width="60" height="18" rx="3" fill="currentColor" className="text-muted-foreground/8" />
                        <circle cx="12" cy="36" r="4" fill="currentColor" className="text-blue-400/40" />
                        <rect x="19" y="30.5" width="20" height="2" rx="1" fill="currentColor" className="text-foreground/50" />
                        <rect x="19" y="34" width="34" height="1.5" rx="0.75" fill="currentColor" className="text-muted-foreground/30" />
                        <rect x="19" y="37" width="24" height="1.5" rx="0.75" fill="currentColor" className="text-muted-foreground/20" />
                      </svg>
                    ),
                  },
                  {
                    key: "classic" as const,
                    name: "Simple List",
                    sub: "Classic Inbox",
                    illustration: (
                      <svg viewBox="0 0 72 52" fill="none" className="w-full h-full">
                        <rect width="72" height="52" rx="4" fill="currentColor" className="text-muted/40" />
                        {[0,1,2,3].map((i) => (
                          <g key={i}>
                            <rect x="6" y={7 + i * 11} width="60" height="8" rx="1.5" fill="currentColor" className="text-muted-foreground/10" />
                            <circle cx="10.5" cy={11 + i * 11} r="2" fill="currentColor" className="text-muted-foreground/40" />
                            <rect x="15" y={9 + i * 11} width={i === 0 ? 24 : i === 1 ? 18 : i === 2 ? 22 : 16} height="1.5" rx="0.75" fill="currentColor" className="text-foreground/50" />
                            <rect x="15" y={12 + i * 11} width={i === 0 ? 36 : i === 1 ? 40 : i === 2 ? 32 : 38} height="1" rx="0.5" fill="currentColor" className="text-muted-foreground/30" />
                          </g>
                        ))}
                      </svg>
                    ),
                  },
                ] as const).map(({ key, name, sub, illustration }) => {
                  const active = viewMode === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      data-testid={`inbox-view-option-${key}`}
                      onClick={() => { setViewMode(key); setInboxViewPickerOpen(false); }}
                      className={`flex-1 flex flex-col rounded-lg border-2 transition-all duration-150 overflow-hidden focus-visible:ring-2 focus-visible:ring-primary/40 outline-none ${
                        active
                          ? "border-primary shadow-[0_0_0_1px_rgba(20,184,166,0.25)] bg-primary/5"
                          : "border-border/50 hover:border-border bg-muted/20 hover:bg-muted/40"
                      }`}
                    >
                      <div className="w-full aspect-[72/52] p-1.5">
                        {illustration}
                      </div>
                      <div className="px-2 pb-2 pt-1 text-left">
                        <div className={`text-[11px] font-semibold leading-tight ${active ? "text-primary" : "text-foreground/80"}`}>{name}</div>
                        <div className="text-[9.5px] text-muted-foreground/55 leading-tight mt-0.5">{sub}</div>
                      </div>
                      {active && (
                        <div className="px-2 pb-1.5">
                          <CheckCheck className="h-3 w-3 text-primary" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          , document.body)}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!canSend && (
            <Badge variant="outline" className="text-xs text-amber-400 border-amber-500/30">View Only</Badge>
          )}
          <LocalSearchButton />
          {/* Snippets manager */}
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setSnippetsManagerOpen(true)}
            title="Snippets & templates"
            aria-label="Open snippets manager"
            data-testid="button-open-snippets-manager"
            className="h-8 w-8 hidden md:inline-flex"
          >
            <StickyNote className="h-4 w-4" />
          </Button>
          {/* Cmd+K command bar trigger */}
          <button
            type="button"
            onClick={() => setCmdkOpen(true)}
            data-testid="button-open-cmdk"
            title="Search & commands (⌘K)"
            aria-label="Open command bar"
            className="hidden md:inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border/50 bg-background/60 text-[11px] text-muted-foreground/70 hover:text-foreground hover:border-border transition-colors"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Search</span>
            <kbd className="ml-1 inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-muted/60 text-muted-foreground/70 text-[9.5px] font-mono">
              <CommandIcon className="h-2.5 w-2.5" />K
            </kbd>
          </button>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleRefreshInbox}
            disabled={refreshingInbox}
            title="Check for new emails"
            data-testid="button-refresh-inbox"
          >
            <RefreshCw className={`h-4 w-4 ${refreshingInbox ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* API disabled warning banner */}
      {statusQuery.data?.connected && statusQuery.data?.tokenValid && !statusQuery.data?.apiEnabled && (
        <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2.5 bg-red-500/10 border-b border-red-500/30 text-red-400 text-sm">
          <Mail className="h-4 w-4 flex-shrink-0" />
          <span className="flex-1">Gmail API is disabled in Google Cloud. Enable it to restore access.</span>
          <a
            href="https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=262239468400"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-red-500/20 hover:bg-red-500/30 text-red-300 text-xs font-medium transition-colors whitespace-nowrap"
            data-testid="button-enable-gmail-api"
          >
            Enable Gmail API →
          </a>
        </div>
      )}
      {/* Token expired warning banner */}
      {statusQuery.data?.connected && !statusQuery.data?.tokenValid && (
        <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/30 text-amber-400 text-sm">
          <Mail className="h-4 w-4 flex-shrink-0" />
          <span className="flex-1">Gmail session has expired. Your emails cannot be loaded until you reconnect.</span>
          {canSend && (
            <a
              href="/api/auth/gmail/connect"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-medium transition-colors whitespace-nowrap"
              data-testid="button-reconnect-gmail-banner"
            >
              Reconnect Gmail →
            </a>
          )}
        </div>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden min-w-0">
        {/* ── LEFT NAV SIDEBAR ───────────────────────────────────────────── */}
        <aside className={`hidden flex-col w-56 flex-shrink-0 border-r border-border/50 bg-background transition-[width,opacity] duration-300 ease-out ${focusMode ? "md:!hidden" : "md:flex"}`}>
          {/* Compose button — replaced by Read-only badge on shared view-only mailboxes (Phase 4) */}
          {canSend ? (
            <div className="px-3 pt-3 pb-2">
              <button
                onClick={() => { setReplyTo(null); setComposeOpen(true); }}
                data-testid="button-sidebar-compose"
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 active:scale-[0.98] transition-all"
              >
                <Pencil className="h-3.5 w-3.5" />
                Compose
              </button>
            </div>
          ) : (
            <div className="px-3 pt-3 pb-2">
              <div
                data-testid="badge-readonly-mailbox"
                title="You have view-only access to this mailbox. Ask the owner or an admin for edit access to send, reply, archive, or mark messages."
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-muted/40 text-muted-foreground text-xs font-medium border border-border/60 cursor-help"
              >
                <Eye className="h-3.5 w-3.5" />
                Read-only
              </div>
            </div>
          )}

          <nav className="flex-1 overflow-y-auto py-1 px-2 space-y-0.5">

            {/* ── INBOX section label ───────────────────────────────── */}
            <div className="pb-0.5 pt-1 px-1">
              <span style={{ fontSize: "10px", letterSpacing: "0.08em" }} className="font-semibold uppercase text-muted-foreground/40">Inbox</span>
            </div>

            {/* Multi-mailbox Phase 1: "All Inboxes" unified view — only show when user has
                more than one accessible account, since 1-account users get nothing extra from it. */}
            {((personalAccount ? 1 : 0) + sharedAccounts.length) > 1 && (
              <button
                onClick={() => {
                  setActiveAccountId("all");
                  setTab("inbox");
                  setInboxCategory("all");
                  setSelectedMessageId(null);
                  setSelectedThreadId(null);
                  setCurrentThreadAccountId(null);
                }}
                data-testid="btn-account-all"
                className={`w-full flex items-center gap-2.5 px-2 ${densityClasses.sidebarRowPy} rounded-md transition-colors ${activeAccountId === "all" ? "text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
              >
                <span className={`flex-shrink-0 h-6 w-6 rounded-full flex items-center justify-center ${activeAccountId === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                  <Inbox className="h-3.5 w-3.5" />
                </span>
                <span className="flex-1 text-left text-[12px] font-medium truncate">All Inboxes</span>
                <span className="text-[10px] text-muted-foreground/60">
                  {(personalAccount ? 1 : 0) + sharedAccounts.length}
                </span>
              </button>
            )}

            {/* Personal account row + subtabs when active */}
            {personalAccount ? (
              <>
                <div className="group flex items-center gap-0.5">
                  <button
                    onClick={() => {
                      setActiveAccountId(null); setTab("inbox"); setInboxCategory("all"); setSelectedMessageId(null); setSelectedThreadId(null); setCurrentThreadAccountId(null);
                    }}
                    data-testid="btn-account-personal"
                    className={`flex-1 flex items-center gap-2.5 px-2 ${densityClasses.sidebarRowPy} rounded-md transition-colors ${activeAccountId === null ? "text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
                  >
                    <span className={`relative flex-shrink-0 h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold ${activeAccountId === null ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                      {(personalAccount.displayName || personalAccount.emailAddress)[0].toUpperCase()}
                      {/* Multi-mailbox Phase 1: sync-status dot */}
                      {(() => {
                        const h = healthById.get(personalAccount.id);
                        if (!h) return null;
                        const cls = h.status === "green" ? "bg-emerald-500" : h.status === "amber" ? "bg-amber-500" : "bg-red-500";
                        const tip = h.status === "red" ? (h.syncErrorMessage || "Sync disabled") : h.status === "amber" ? `Watch expires in ${h.watchHoursRemaining ?? "?"}h` : "Healthy";
                        return <span title={tip} data-testid={`status-dot-${personalAccount.id}`} className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-1 ring-background ${cls}`} />;
                      })()}
                    </span>
                    <span className="flex-1 text-left text-[12px] font-medium truncate">{personalAccount.emailAddress}</span>
                    {activeAccountId === null && serverInboxUnreadCount > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium bg-primary/20 text-primary">{serverInboxUnreadCount}</span>
                    )}
                  </button>
                  <button
                    onClick={() => handleRefreshAccount(personalAccount.id)}
                    data-testid={`btn-refresh-account-${personalAccount.id}`}
                    title="Check for new mail"
                    className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all"
                  >
                    <RefreshCw className={`h-3 w-3 ${refreshingAccounts.has(personalAccount.id) ? "animate-spin" : ""}`} />
                  </button>
                </div>
                {/* Personal account subtabs */}
                {activeAccountId === null && (
                  <div className="ml-3 pl-2 border-l border-border/40 space-y-0.5 mt-0.5 mb-1">
                    <button onClick={() => { setTab("inbox"); setInboxCategory("all"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid="nav-tab-inbox"
                      className={`w-full flex items-center gap-2 px-2 ${densityClasses.sidebarSubtabPy} rounded-md ${densityClasses.sidebarSubtabText} font-medium transition-colors ${tab === "inbox" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                      <Inbox className="h-3.5 w-3.5" /><span className="flex-1 text-left">Inbox</span>
                      {serverInboxUnreadCount > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium ${tab === "inbox" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>{serverInboxUnreadCount}</span>}
                    </button>
                    {/* ── Category subcategories nested under Inbox ──────────── */}
                    {tab === "inbox" && (
                      <div className="ml-2 pl-2 border-l border-border/20 space-y-0 mt-0.5 mb-0.5">
                        {([
                          { key: "all" as const,         label: "All",                   Icon: Inbox,     badge: 0 },
                          { key: "people" as const,      label: "People",                Icon: User,      badge: sidebarCategoryBadges.people },
                          { key: "updates" as const, label: "Updates", Icon: Newspaper, badge: sidebarCategoryBadges.updates },
                          { key: "promotions" as const,  label: "Promotions",            Icon: Tag,       badge: sidebarCategoryBadges.promotions },
                          { key: "social" as const,      label: "Social",                Icon: Users,     badge: sidebarCategoryBadges.social },
                          { key: "forums" as const,      label: "Forums & Communities",  Icon: Hash,      badge: sidebarCategoryBadges.forums },
                        ]).map(({ key, label, Icon, badge }) => {
                          const isActive = inboxCategory === key;
                          return (
                            <button key={key}
                              onClick={() => { setInboxCategory(key); setSelectedMessageId(null); setSelectedThreadId(null); }}
                              data-testid={`nav-inbox-cat-${key}`}
                              className={`w-full flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors ${isActive ? "bg-primary/15 text-primary" : "text-muted-foreground/70 hover:bg-muted/40 hover:text-foreground"}`}>
                              <Icon className="h-3 w-3 flex-shrink-0" />
                              <span className="flex-1 text-left truncate">{label}</span>
                              {badge > 0 && <span className={`text-[10px] px-1 py-0 rounded-full min-w-4 text-center font-medium flex-shrink-0 ${isActive ? "bg-primary/20 text-primary" : "bg-muted/60 text-muted-foreground"}`}>{badge}</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <button onClick={() => { setTab("sent"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid="nav-tab-sent"
                      className={`w-full flex items-center gap-2 px-2 ${densityClasses.sidebarSubtabPy} rounded-md ${densityClasses.sidebarSubtabText} font-medium transition-colors ${tab === "sent" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                      <Send className="h-3.5 w-3.5" /><span className="flex-1 text-left">Sent</span>
                    </button>
                    <button onClick={() => { setTab("pinned"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid="nav-tab-pinned"
                      className={`w-full flex items-center gap-2 px-2 ${densityClasses.sidebarSubtabPy} rounded-md ${densityClasses.sidebarSubtabText} font-medium transition-colors ${tab === "pinned" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                      <Pin className="h-3.5 w-3.5" /><span className="flex-1 text-left">Pinned</span>
                      {pinnedMessages.length > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium ${tab === "pinned" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>{pinnedMessages.length}</span>}
                    </button>
                    <button onClick={() => { setTab("spam"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid="nav-tab-spam"
                      className={`w-full flex items-center gap-2 px-2 ${densityClasses.sidebarSubtabPy} rounded-md ${densityClasses.sidebarSubtabText} font-medium transition-colors ${tab === "spam" ? "bg-red-500/15 text-red-400" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                      <Ban className="h-3.5 w-3.5" /><span className="flex-1 text-left">Spam</span>
                      {tab === "spam" && (spamQuery.data?.messages?.length ?? 0) > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium bg-red-500/30 text-red-300">{spamQuery.data!.messages.length}{(spamQuery.data?.messages?.length ?? 0) >= 50 ? "+" : ""}</span>
                      )}
                    </button>
                    {canSend && <>
                      <button onClick={() => { setTab("drafts"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid="nav-tab-drafts"
                        className={`w-full flex items-center gap-2 px-2 ${densityClasses.sidebarSubtabPy} rounded-md ${densityClasses.sidebarSubtabText} font-medium transition-colors ${tab === "drafts" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                        <FileText className="h-3.5 w-3.5" /><span className="flex-1 text-left">Drafts</span>
                        {(draftsQuery.data?.length ?? 0) > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium ${tab === "drafts" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>{draftsQuery.data?.length}</span>}
                      </button>
                      <button onClick={() => { setTab("scheduled"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid="nav-tab-scheduled"
                        className={`w-full flex items-center gap-2 px-2 ${densityClasses.sidebarSubtabPy} rounded-md ${densityClasses.sidebarSubtabText} font-medium transition-colors ${tab === "scheduled" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                        <CalendarClock className="h-3.5 w-3.5" /><span className="flex-1 text-left">Scheduled</span>
                        {(scheduledQuery.data?.filter(e => e.status === "pending").length ?? 0) > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium ${tab === "scheduled" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>{scheduledQuery.data?.filter(e => e.status === "pending").length}</span>}
                      </button>
                    </>}
                    {((reviewStatsQuery.data?.needsReview ?? 0) > 0 || tab === "review") && (
                      <button onClick={() => { setTab("review"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid="nav-tab-review"
                        className={`w-full flex items-center gap-2 px-2 ${densityClasses.sidebarSubtabPy} rounded-md ${densityClasses.sidebarSubtabText} font-medium transition-colors ${tab === "review" ? "bg-amber-500/15 text-amber-400" : "text-amber-500/80 hover:bg-amber-500/10 hover:text-amber-400"}`}>
                        <ShieldCheck className="h-3.5 w-3.5" /><span className="flex-1 text-left">CRM Review</span>
                        {(reviewStatsQuery.data?.needsReview ?? 0) > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium ${tab === "review" ? "bg-amber-500/30 text-amber-300" : "bg-amber-500/20 text-amber-400"}`}>{reviewStatsQuery.data!.needsReview}</span>}
                      </button>
                    )}
                    {/* Folders under personal */}
                    <div className={`${densityClasses.sidebarSectionPt} pb-0.5 flex items-center justify-between pr-1`}>
                      <span style={{ fontSize: "10px", letterSpacing: "0.08em" }} className="font-semibold uppercase text-muted-foreground/40">Folders</span>
                      <button className="text-muted-foreground hover:text-foreground transition-colors rounded p-0.5 hover:bg-muted/60" onClick={() => setShowCreateFolder(true)} title="New folder" data-testid="button-new-folder">
                        <FolderPlus className="h-3 w-3" />
                      </button>
                    </div>
                    {foldersQuery.isLoading && <div className="space-y-1">{[1,2].map(i => <Skeleton key={i} className="h-5 w-full rounded" />)}</div>}
                    {!foldersQuery.isLoading && (foldersQuery.data || []).length === 0 && <p className="px-2 py-0.5 text-[11px] text-muted-foreground/50 italic">No folders yet</p>}
                    {(foldersQuery.data || []).map((folder) => {
                      const isFolderActive = tab === "folder" && selectedFolderId === folder.id;
                      return (
                        <div key={folder.id} className={`group flex items-center gap-2 px-2 ${densityClasses.sidebarFolderPy} rounded-md cursor-pointer transition-colors ${densityClasses.sidebarFolderText} font-medium ${isFolderActive ? "bg-primary/15 text-primary" : "hover:bg-muted/50 text-muted-foreground hover:text-foreground"}`}
                          onClick={() => { setTab("folder"); setSelectedFolderId(folder.id); setSelectedThreadId(null); setSelectedMessageId(null); }} data-testid={`folder-row-${folder.id}`}>
                          <Folder className={`h-3.5 w-3.5 flex-shrink-0 ${isFolderActive ? "text-primary" : "text-teal-500/70"}`} />
                          <span className="flex-1 truncate">{folder.name}</span>
                          {folder.unreadCount > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium ${isFolderActive ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>{folder.unreadCount}</span>}
                          <button className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground flex-shrink-0 ml-auto"
                            onClick={(e) => { e.stopPropagation(); setShowFolderSettings(folder.id); }} title="Folder settings" data-testid={`button-folder-settings-${folder.id}`}>
                            <Settings2 className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <button onClick={() => { setTab("inbox"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid="nav-tab-inbox"
                className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === "inbox" && activeAccountId === null ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                <Inbox className="h-4 w-4" /><span className="flex-1 text-left">Inbox</span>
                {serverInboxUnreadCount > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium ${tab === "inbox" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>{serverInboxUnreadCount}</span>}
              </button>
            )}

            {/* ── TEAM INBOXES section ──────────────────────────────────── */}
            {sharedAccounts.length > 0 && (
              <>
                <div className={`${densityClasses.sidebarSectionPt} pb-0.5 px-1`}>
                  <span style={{ fontSize: "10px", letterSpacing: "0.08em" }} className="font-semibold uppercase text-muted-foreground/40">Team Inboxes</span>
                </div>
                {sharedAccounts.map((acct) => {
                  const isThisActive = activeAccountId === acct.id;
                  const letter = acct.emailAddress[0].toUpperCase();
                  return (
                    <div key={acct.id}>
                      <div className="group flex items-center gap-0.5">
                        <button
                          onClick={() => {
                            setActiveAccountId(acct.id); setTab("inbox"); setInboxCategory("all"); setSelectedMessageId(null); setSelectedThreadId(null); setCurrentThreadAccountId(null);
                          }}
                          data-testid={`btn-account-shared-${acct.id}`}
                          title={acct.emailAddress}
                          className={`flex-1 flex items-center gap-2.5 px-2 ${densityClasses.sidebarRowPy} rounded-md transition-colors ${isThisActive ? "text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
                        >
                          <span className={`relative flex-shrink-0 h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold ${isThisActive ? "bg-teal-500 text-white" : "bg-teal-900/60 text-teal-300"}`}>
                            {letter}
                            {(() => {
                              const h = healthById.get(acct.id);
                              if (!h) return null;
                              const cls = h.status === "green" ? "bg-emerald-500" : h.status === "amber" ? "bg-amber-500" : "bg-red-500";
                              const tip = h.status === "red" ? (h.syncErrorMessage || "Sync disabled") : h.status === "amber" ? `Watch expires in ${h.watchHoursRemaining ?? "?"}h` : "Healthy";
                              return <span title={tip} data-testid={`status-dot-${acct.id}`} className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-1 ring-background ${cls}`} />;
                            })()}
                          </span>
                          <span className="flex-1 text-left text-[12px] font-medium truncate">{acct.emailAddress}</span>
                          {isThisActive && serverInboxUnreadCount > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium bg-primary/20 text-primary">{serverInboxUnreadCount}</span>
                          )}
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => handleRefreshAccount(acct.id)}
                            data-testid={`btn-refresh-account-${acct.id}`}
                            title="Check for new mail"
                            className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all"
                          >
                            <RefreshCw className={`h-3 w-3 ${refreshingAccounts.has(acct.id) ? "animate-spin" : ""}`} />
                          </button>
                        )}
                      </div>
                      {/* Subtabs for this team inbox when active */}
                      {isThisActive && (
                        <div className="ml-3 pl-2 border-l border-border/40 space-y-0.5 mt-0.5 mb-1">
                          <button onClick={() => { setTab("inbox"); setInboxCategory("all"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid={`nav-tab-inbox-${acct.id}`}
                            className={`w-full flex items-center gap-2 px-2 ${densityClasses.sidebarSubtabPy} rounded-md ${densityClasses.sidebarSubtabText} font-medium transition-colors ${tab === "inbox" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                            <Inbox className="h-3.5 w-3.5" /><span className="flex-1 text-left">Inbox</span>
                            {serverInboxUnreadCount > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium ${tab === "inbox" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>{serverInboxUnreadCount}</span>}
                          </button>
                          {/* ── Category subcategories nested under Inbox ──────────── */}
                          {tab === "inbox" && (
                            <div className="ml-2 pl-2 border-l border-border/20 space-y-0 mt-0.5 mb-0.5">
                              {([
                                { key: "all" as const,         label: "All",                   Icon: Inbox,     badge: 0 },
                                { key: "people" as const,      label: "People",                Icon: User,      badge: sidebarCategoryBadges.people },
                                { key: "updates" as const, label: "Updates", Icon: Newspaper, badge: sidebarCategoryBadges.updates },
                                { key: "promotions" as const,  label: "Promotions",            Icon: Tag,       badge: sidebarCategoryBadges.promotions },
                                { key: "social" as const,      label: "Social",                Icon: Users,     badge: sidebarCategoryBadges.social },
                                { key: "forums" as const,      label: "Forums & Communities",  Icon: Hash,      badge: sidebarCategoryBadges.forums },
                              ]).map(({ key, label, Icon, badge }) => {
                                const isActive = inboxCategory === key;
                                return (
                                  <button key={key}
                                    onClick={() => { setInboxCategory(key); setSelectedMessageId(null); setSelectedThreadId(null); }}
                                    data-testid={`nav-inbox-cat-${key}-${acct.id}`}
                                    className={`w-full flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors ${isActive ? "bg-primary/15 text-primary" : "text-muted-foreground/70 hover:bg-muted/40 hover:text-foreground"}`}>
                                    <Icon className="h-3 w-3 flex-shrink-0" />
                                    <span className="flex-1 text-left truncate">{label}</span>
                                    {badge > 0 && <span className={`text-[10px] px-1 py-0 rounded-full min-w-4 text-center font-medium flex-shrink-0 ${isActive ? "bg-primary/20 text-primary" : "bg-muted/60 text-muted-foreground"}`}>{badge}</span>}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          <button onClick={() => { setTab("sent"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid={`nav-tab-sent-${acct.id}`}
                            className={`w-full flex items-center gap-2 px-2 ${densityClasses.sidebarSubtabPy} rounded-md ${densityClasses.sidebarSubtabText} font-medium transition-colors ${tab === "sent" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                            <Send className="h-3.5 w-3.5" /><span className="flex-1 text-left">Sent</span>
                          </button>
                          <button onClick={() => { setTab("pinned"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid={`nav-tab-pinned-${acct.id}`}
                            className={`w-full flex items-center gap-2 px-2 ${densityClasses.sidebarSubtabPy} rounded-md ${densityClasses.sidebarSubtabText} font-medium transition-colors ${tab === "pinned" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                            <Pin className="h-3.5 w-3.5" /><span className="flex-1 text-left">Pinned</span>
                            {pinnedMessages.length > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium ${tab === "pinned" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>{pinnedMessages.length}</span>}
                          </button>
                          <button onClick={() => { setTab("spam"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid={`nav-tab-spam-${acct.id}`}
                            className={`w-full flex items-center gap-2 px-2 ${densityClasses.sidebarSubtabPy} rounded-md ${densityClasses.sidebarSubtabText} font-medium transition-colors ${tab === "spam" ? "bg-red-500/15 text-red-400" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                            <Ban className="h-3.5 w-3.5" /><span className="flex-1 text-left">Spam</span>
                            {tab === "spam" && (spamQuery.data?.messages?.length ?? 0) > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium bg-red-500/30 text-red-300">{spamQuery.data!.messages.length}{(spamQuery.data?.messages?.length ?? 0) >= 50 ? "+" : ""}</span>
                            )}
                          </button>
                          {canSend && <>
                            <button onClick={() => { setTab("drafts"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid={`nav-tab-drafts-${acct.id}`}
                              className={`w-full flex items-center gap-2 px-2 ${densityClasses.sidebarSubtabPy} rounded-md ${densityClasses.sidebarSubtabText} font-medium transition-colors ${tab === "drafts" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                              <FileText className="h-3.5 w-3.5" /><span className="flex-1 text-left">Drafts</span>
                              {(draftsQuery.data?.length ?? 0) > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium ${tab === "drafts" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>{draftsQuery.data?.length}</span>}
                            </button>
                            <button onClick={() => { setTab("scheduled"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid={`nav-tab-scheduled-${acct.id}`}
                              className={`w-full flex items-center gap-2 px-2 ${densityClasses.sidebarSubtabPy} rounded-md ${densityClasses.sidebarSubtabText} font-medium transition-colors ${tab === "scheduled" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                              <CalendarClock className="h-3.5 w-3.5" /><span className="flex-1 text-left">Scheduled</span>
                              {(scheduledQuery.data?.filter(e => e.status === "pending").length ?? 0) > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium ${tab === "scheduled" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>{scheduledQuery.data?.filter(e => e.status === "pending").length}</span>}
                            </button>
                          </>}
                          {/* Folders under each team inbox */}
                          <div className={`${densityClasses.sidebarSectionPt} pb-0.5 flex items-center justify-between pr-1`}>
                            <span style={{ fontSize: "10px", letterSpacing: "0.08em" }} className="font-semibold uppercase text-muted-foreground/40">Folders</span>
                            <button className="text-muted-foreground hover:text-foreground transition-colors rounded p-0.5 hover:bg-muted/60" onClick={() => setShowCreateFolder(true)} title="New folder" data-testid={`button-new-folder-${acct.id}`}>
                              <FolderPlus className="h-3 w-3" />
                            </button>
                          </div>
                          {foldersQuery.isLoading && <div className="space-y-1">{[1,2].map(i => <Skeleton key={i} className="h-5 w-full rounded" />)}</div>}
                          {!foldersQuery.isLoading && (foldersQuery.data || []).length === 0 && <p className="px-2 py-0.5 text-[11px] text-muted-foreground/50 italic">No folders yet</p>}
                          {(foldersQuery.data || []).map((folder) => {
                            const isFolderActive = tab === "folder" && selectedFolderId === folder.id;
                            return (
                              <div key={folder.id} className={`group flex items-center gap-2 px-2 ${densityClasses.sidebarFolderPy} rounded-md cursor-pointer transition-colors ${densityClasses.sidebarFolderText} font-medium ${isFolderActive ? "bg-primary/15 text-primary" : "hover:bg-muted/50 text-muted-foreground hover:text-foreground"}`}
                                onClick={() => { setTab("folder"); setSelectedFolderId(folder.id); setSelectedThreadId(null); setSelectedMessageId(null); }} data-testid={`folder-row-${acct.id}-${folder.id}`}>
                                <Folder className={`h-3.5 w-3.5 flex-shrink-0 ${isFolderActive ? "text-primary" : "text-teal-500/70"}`} />
                                <span className="flex-1 truncate">{folder.name}</span>
                                {folder.unreadCount > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium ${isFolderActive ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>{folder.unreadCount}</span>}
                                <button className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground flex-shrink-0 ml-auto"
                                  onClick={(e) => { e.stopPropagation(); setShowFolderSettings(folder.id); }} title="Folder settings" data-testid={`button-folder-settings-${acct.id}-${folder.id}`}>
                                  <Settings2 className="h-3 w-3" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </nav>

          {/* Account status footer */}
          <div className="flex-shrink-0 border-t border-border/40 bg-card/30">
            {/* Mail Trust Strip — connection/sync/send state */}
            <MailTrustStrip
              isLoading={accountsQuery.isLoading}
              authStatus={connectedAccount?.authStatus ?? null}
              lastSyncAt={connectedAccount?.lastSyncAt ?? null}
              healthStatus={healthById.get(connectedAccount?.id ?? 0)?.status ?? null}
              syncErrorMessage={connectedAccount?.syncErrorMessage ?? null}
              trustEvent={trustEvent}
              hasFailedScheduled={(scheduledQuery.data?.some(e => e.status === "failed")) ?? false}
            />
            {connectedAccount && (
              <div className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`flex-shrink-0 h-2 w-2 rounded-full ${connectedAccount.authStatus === "active" ? "bg-emerald-400" : connectedAccount.authStatus === "expired" ? "bg-amber-400" : "bg-red-400"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate" data-testid="text-connected-email">{connectedAccount.emailAddress}</p>
                    {refreshingInbox ? (
                      <p className="text-[10px] text-teal-400/80 animate-pulse" data-testid="text-last-sync">Syncing inbox…</p>
                    ) : (() => {
                      // Show the MOST RECENT of lastSyncAt and lastIncrementalSyncAt.
                      // lastSyncAt was historically only updated by the hourly full sync,
                      // making the label read "synced 2 hours ago" even when incremental
                      // syncs ran seconds ago. Now incremental sync also updates lastSyncAt
                      // (server-side fix), but we also take lastIncrementalSyncAt from the
                      // health data as a belt-and-suspenders fallback.
                      const h = healthById.get(connectedAccount.id);
                      const tA = connectedAccount.lastSyncAt ? new Date(connectedAccount.lastSyncAt).getTime() : 0;
                      const tB = h?.lastIncrementalSyncAt ? new Date(h.lastIncrementalSyncAt).getTime() : 0;
                      const tBest = Math.max(tA, tB);
                      if (!tBest) return (
                        <p className="text-[10px] text-muted-foreground">{connectedAccount.authStatus === "active" ? "Never synced" : connectedAccount.authStatus}</p>
                      );
                      return (
                        <p className="text-[10px] text-muted-foreground truncate" data-testid="text-last-sync">
                          synced {(() => {
                            try { return formatDistanceToNow(new Date(tBest), { addSuffix: true }); }
                            catch { return ""; }
                          })()}
                        </p>
                      );
                    })()}
                  </div>
                  {connectedAccount.authStatus !== "active" ? (
                    <a href="/api/auth/gmail/connect" className="flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors whitespace-nowrap" data-testid="button-reconnect-account-footer">Reconnect</a>
                  ) : (
                    <>
                    <button title="Quick resync (last 5 min)" data-testid="button-resync-account-footer" onClick={async () => { try { await fetch(`/api/gmail/accounts/${connectedAccount.id}/resync?limit=100`, { method: "POST", credentials: "include" }); syncMutation.mutate(undefined); } catch {} }} className="flex-shrink-0 p-1 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted/50 transition-colors">
                      <RefreshCw className="h-3 w-3" />
                    </button>
                    <div className="relative group/catchup">
                      <button
                        title="Catch up missing emails"
                        data-testid="button-deep-backfill-footer"
                        disabled={deepBackfillMutation.isPending}
                        className="flex-shrink-0 p-1 rounded text-muted-foreground/50 hover:text-cyan-400 hover:bg-cyan-400/10 transition-colors disabled:opacity-40"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      </button>
                      <div className="absolute bottom-full right-0 mb-1 hidden group-hover/catchup:flex flex-col gap-0.5 bg-popover border border-border rounded-lg shadow-lg p-1 z-50 w-36">
                        <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Catch up emails</div>
                        {([30, 90, 365] as const).map(d => (
                          <button
                            key={d}
                            onClick={() => deepBackfillMutation.mutate(d)}
                            disabled={deepBackfillMutation.isPending}
                            className="text-left px-2 py-1 text-[11px] rounded hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-40"
                            data-testid={`button-deep-backfill-${d}d`}
                          >
                            Last {d === 365 ? "1 year" : `${d} days`}
                          </button>
                        ))}
                      </div>
                    </div>
                    </>
                  )}
                </div>
              </div>
            )}
            {/* Connect team inbox — master_admin only */}
            {currentUserRole === "master_admin" && (
              <div className="px-3 pb-2 pt-0">
                <a
                  href="/api/auth/gmail/connect-shared"
                  data-testid="button-connect-team-inbox"
                  className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-dashed border-border/50 hover:border-border transition-colors"
                >
                  <PlusCircle className="h-3.5 w-3.5" />
                  Connect team inbox
                </a>
              </div>
            )}
          </div>
        </aside>

        {/* ── CENTER PANEL: thread list ───────────────────────────────────── */}
        <div
          className={`flex flex-col min-h-0 bg-background transition-[width,opacity] duration-300 ease-out ${focusMode ? "hidden" : selectedThreadId ? "hidden md:flex flex-shrink-0" : "flex-1 md:flex-initial md:flex-shrink-0"}`}
          style={{ width: focusMode ? 0 : listPanelWidth }}
        >

          {/* Mobile-only tab switcher (replaces hidden sidebar on phones) */}
          <div className="md:hidden flex-shrink-0 overflow-x-auto border-b border-border/50 bg-background/80">
            <div className="flex whitespace-nowrap px-2 py-1.5 gap-0.5 min-w-max">
              {[
                { key: "inbox",    label: "Inbox",   badge: serverInboxUnreadCount > 0 ? serverInboxUnreadCount : null },
                { key: "sent",     label: "Sent",    badge: null },
                ...(canSend ? [{ key: "drafts", label: "Drafts", badge: (draftsQuery.data?.length ?? 0) > 0 ? draftsQuery.data?.length : null }] : []),
                { key: "review",   label: "Review",  badge: (reviewStatsQuery.data?.needsReview ?? 0) > 0 ? reviewStatsQuery.data?.needsReview : null },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => { setTab(t.key as any); setSelectedMessageId(null); setSelectedThreadId(null); }}
                  data-testid={`mobile-tab-${t.key}`}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-colors min-h-[36px] ${tab === t.key ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
                >
                  {t.label}
                  {t.badge != null && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${tab === t.key ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>{t.badge}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Filter pills + Search */}
          <div className={`flex-shrink-0 ${densityClasses.chipsRootPad} ${densityClasses.chipsRootGap} border-b border-border/50`}>
            {tab === "inbox" && (
              <>
                {/* Simple filter bar — All, Unread, Starred */}
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  {([
                    { key: "all",     label: "All",     icon: <Filter className="h-3 w-3" />,   activeColor: "bg-violet-500/15 text-violet-300 ring-violet-400/40 shadow-[0_0_10px_-2px_rgba(167,139,250,0.3)]", count: null },
                    { key: "unread",  label: "Unread",  icon: <MailOpen className="h-3 w-3" />, activeColor: "bg-blue-500/15 text-blue-300 ring-blue-400/40 shadow-[0_0_10px_-2px_rgba(96,165,250,0.3)]",    count: serverInboxUnreadCount || inboxUnreadCount || null },
                    { key: "starred", label: "Starred", icon: <Star className="h-3 w-3" />,     activeColor: "bg-amber-500/15 text-amber-300 ring-amber-400/40 shadow-[0_0_10px_-2px_rgba(251,191,36,0.3)]",  count: null },
                  ] as { key: CrmInboxFilter; label: string; icon: React.ReactNode; activeColor: string; count: number | null }[]).map(({ key, label, icon, activeColor, count }) => {
                    const active = crmFilter === key;
                    return (
                      <motion.button
                        key={key}
                        whileTap={{ scale: 0.95 }}
                        whileHover={{ scale: 1.04 }}
                        transition={{ type: "spring", stiffness: 500, damping: 22 }}
                        onClick={() => { setCrmFilter(key); if (key === "unread") setInboxCategory("all"); }}
                        data-testid={`crm-filter-${key}`}
                        className={`flex items-center gap-1 ${densityClasses.chipPx} ${densityClasses.chipPy} rounded-full ${densityClasses.chipText} font-medium transition-all whitespace-nowrap ring-1 ring-inset ${
                          active ? activeColor : "bg-muted/30 text-muted-foreground/65 hover:bg-muted/55 hover:text-foreground/85 ring-transparent"
                        }`}
                      >
                        {icon}
                        {label}
                        {count !== null && count > 0 && (
                          <span className={`ml-0.5 text-[10px] tabular-nums ${active ? "opacity-90" : "opacity-60"}`}>{count}</span>
                        )}
                      </motion.button>
                    );
                  })}

                  {/* Mark all read */}
                  {inboxUnreadCount > 0 && (
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      whileHover={{ scale: 1.04 }}
                      transition={{ type: "spring", stiffness: 500, damping: 22 }}
                      onClick={() => markAllInboxReadMutation.mutate()}
                      disabled={markAllInboxReadMutation.isPending}
                      data-testid="button-mark-all-inbox-read"
                      title="Mark all inbox messages as read"
                      className={`flex items-center gap-1 ${densityClasses.chipPx} ${densityClasses.chipPy} rounded-full ${densityClasses.chipText} font-medium transition-all whitespace-nowrap ring-1 ring-inset ring-transparent bg-muted/30 text-muted-foreground/65 hover:bg-emerald-500/15 hover:text-emerald-300 hover:ring-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      {markAllInboxReadMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}
                      Mark all read
                    </motion.button>
                  )}
                </div>
              </>
            )}
            <form onSubmit={handleSearch} className="flex gap-1">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search all mail history (name, subject, keyword…)"
                  className={`pl-7 ${densityClasses.searchH} text-sm`}
                  data-testid="input-email-search"
                />
              </div>
              {searchQuery && (
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setSearch(""); setSearchQuery(""); }}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </form>
          </div>

          {/* Message list — bottom padding ensures last email isn't hidden under the FAB */}
          <div ref={inboxScrollRef} className="flex-1 overflow-y-auto pb-36 lg:pb-24">
            {/* Commit 7: Auto 1-year backfill progress banner. Sticky-pinned
                at the absolute top of the scroll viewport, sitting above the
                Commit 6 "new messages" pill (z-30 vs pill's z-20 vs the
                bulk-action toolbar's z-10). Render-gated by
                `shouldShowBackfillBanner` which covers in-flight states
                (pending / running / cancelling) plus a 30s tail after a
                terminal transition (completed / cancelled / failed) so the
                user sees the resolution land. The Stop button calls the
                /backfill/cancel endpoint; Resume/Retry calls /backfill/resume.
                See the state block near the inboxQuery for the full design
                rationale and race-condition analysis. */}
            {shouldShowBackfillBanner && activeBackfillJob && (
              <div
                className="sticky top-0 z-30 mx-2 mt-2 rounded-md border border-border bg-card/95 backdrop-blur shadow-sm overflow-hidden"
                data-testid="banner-backfill-progress"
                aria-live="polite"
                aria-atomic="false"
              >
                {(() => {
                  const j = activeBackfillJob;
                  const processed = Number(j.processed ?? 0);
                  const total = Number(j.totalEstimate ?? 0);
                  const hasTotal = Number.isFinite(total) && total > 0;
                  const pct = hasTotal
                    ? Math.min(100, Math.max(0, Math.round((processed / total) * 100)))
                    : 0;
                  const acctSuffix = j.emailAddress ? ` · ${j.emailAddress}` : "";

                  let statusText = "";
                  if (j.status === "pending") {
                    statusText = `Preparing to import your last year of email${acctSuffix}…`;
                  } else if (j.status === "running") {
                    statusText = hasTotal
                      ? `Importing your last year of email${acctSuffix} — ${processed.toLocaleString()} of ~${total.toLocaleString()} (${pct}%)`
                      : `Importing your last year of email${acctSuffix} — ${processed.toLocaleString()} so far`;
                  } else if (j.status === "cancelling") {
                    statusText = `Stopping import${acctSuffix} — ${processed.toLocaleString()} imported so far`;
                  } else if (j.status === "cancelled") {
                    statusText = `Import paused${acctSuffix} at ${processed.toLocaleString()} message${processed === 1 ? "" : "s"}`;
                  } else if (j.status === "failed") {
                    statusText = `Import paused on error${acctSuffix}: ${j.errorMessage || "unknown error"}`;
                  } else if (j.status === "completed") {
                    statusText = `✓ Imported ${processed.toLocaleString()} message${processed === 1 ? "" : "s"} from the last year${acctSuffix}`;
                  }

                  const showCancel = j.status === "pending" || j.status === "running";
                  const showResume = j.status === "cancelled" || j.status === "failed";
                  const isCancelDisabled = cancelBackfillMut.isPending || j.status === "cancelling";
                  const isResumeDisabled = resumeBackfillMut.isPending;

                  return (
                    <div className="flex items-center gap-3 px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <div
                          className="text-xs text-foreground truncate"
                          data-testid="text-backfill-status"
                        >
                          <span data-testid="text-backfill-counts">{statusText}</span>
                        </div>
                        {(j.status === "running" || j.status === "cancelling") && hasTotal && (
                          <div
                            className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted"
                            data-testid="progress-backfill-bar"
                          >
                            <div
                              className="h-full bg-primary transition-all duration-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        )}
                        {(j.status === "running" || j.status === "cancelling") && !hasTotal && (
                          <div
                            className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted"
                            data-testid="progress-backfill-bar"
                          >
                            <div className="h-full w-1/3 animate-pulse bg-primary/60" />
                          </div>
                        )}
                      </div>
                      {showCancel && (
                        <button
                          type="button"
                          onClick={() => cancelBackfillMut.mutate(j.emailAccountId)}
                          disabled={isCancelDisabled}
                          data-testid="button-backfill-cancel"
                          className="shrink-0 inline-flex items-center rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {cancelBackfillMut.isPending ? "Stopping…" : "Stop"}
                        </button>
                      )}
                      {showResume && (
                        <button
                          type="button"
                          onClick={() => resumeBackfillMut.mutate(j.emailAccountId)}
                          disabled={isResumeDisabled}
                          data-testid="button-backfill-resume"
                          className="shrink-0 inline-flex items-center rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {resumeBackfillMut.isPending
                            ? "Resuming…"
                            : j.status === "failed"
                              ? "Retry"
                              : "Resume"}
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
            {/* Commit 6: "X new messages" top-of-list pill (Superhuman/Gmail style).
                See state block near the inboxQuery / accountsHealthQuery for the
                detection logic. Render conditions: inbox tab only, count > 0,
                user scrolled below the top. Sticky-positioned to top of the
                visible scroll viewport, centered, with pointer-events-none on
                the wrapper so the empty horizontal space flanking the pill
                doesn't intercept row clicks underneath. z-20 to layer above the
                bulk-action toolbar (sticky top-0 z-10 at line ~5048) so both
                can coexist on the rare occasions both conditions hold. */}
            {tab === "inbox" && newMessagesCount > 0 && !isAtTop && (
              <div
                className="sticky top-2 z-20 flex justify-center pointer-events-none"
                data-testid="pill-new-messages"
                aria-live="polite"
                aria-atomic="true"
              >
                <button
                  type="button"
                  onClick={handleScrollToTop}
                  data-testid="button-pill-scroll-top"
                  className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground shadow-md hover:bg-primary/90 transition-all animate-in fade-in slide-in-from-top-2"
                >
                  {/* aria-hidden + focusable=false: the icon is purely decorative;
                      the visible text "1 new message" / "X new messages" is the
                      accessible name for screen-reader users. */}
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" focusable="false" />
                  <span data-testid="text-pill-new-messages-count">
                    {newMessagesCount === 1
                      ? "1 new message"
                      : `${newMessagesCount} new messages`}
                  </span>
                </button>
              </div>
            )}
            {/* Drafts tab */}
            {tab === "drafts" && (
              draftsQuery.isLoading ? (
                <div className="p-3 space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="space-y-1 p-2"><Skeleton className="h-3.5 w-2/3" /><Skeleton className="h-3 w-full" /></div>)}</div>
              ) : (draftsQuery.data || []).length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground"><FileText className="h-8 w-8 mx-auto mb-2 opacity-30" /><p>No drafts</p></div>
              ) : (
                (draftsQuery.data || []).map((draft) => (
                  <div
                    key={draft.id}
                    className={`relative group flex items-stretch border-b border-border/30 transition-colors ${selectedDraftIds.has(draft.id) ? "bg-primary/8" : "hover:bg-muted/50"}`}
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedDraftIds(prev => { const n = new Set(prev); n.has(draft.id) ? n.delete(draft.id) : n.add(draft.id); return n; }); }}
                      data-testid={`checkbox-draft-${draft.id}`}
                      className={`flex-shrink-0 w-8 flex items-center justify-center text-muted-foreground/30 hover:text-primary transition-all ${selectedDraftIds.size > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                      title="Select draft"
                    >
                      {selectedDraftIds.has(draft.id)
                        ? <CheckSquare className="h-3.5 w-3.5 text-primary" />
                        : <Square className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      onClick={() => openDraft(draft.id)}
                      disabled={loadingDraftId === draft.id}
                      data-testid={`draft-row-${draft.id}`}
                      className="flex-1 text-left px-2 py-2.5 flex flex-col gap-0.5 min-w-0"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm truncate text-muted-foreground">
                          {loadingDraftId === draft.id ? <Loader2 className="h-3.5 w-3.5 animate-spin inline" /> : null}
                          {draft.to || "(no recipient)"}
                        </span>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(draft.date, draft.internalDate)}</span>
                      </div>
                      <p className="text-xs truncate text-foreground/70">{draft.subject || "(no subject)"}</p>
                      <p className="text-xs text-muted-foreground truncate">{draft.snippet}</p>
                    </button>
                  </div>
                ))
              )
            )}

            {/* Scheduled tab */}
            {tab === "scheduled" && (
              scheduledQuery.isLoading ? (
                <div className="p-3 space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="space-y-1 p-2"><Skeleton className="h-3.5 w-2/3" /><Skeleton className="h-3 w-full" /></div>)}</div>
              ) : (scheduledQuery.data || []).length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground"><CalendarClock className="h-8 w-8 mx-auto mb-2 opacity-30" /><p>No scheduled emails</p></div>
              ) : (
                (scheduledQuery.data || []).map((email) => {
                  const isFailed = email.status === "failed";
                  return (
                    <div key={email.id} className={`group relative px-3 py-2.5 border-b border-border/30 ${isFailed ? "bg-destructive/5" : ""}`}>
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className={`text-sm truncate ${isFailed ? "text-destructive/80" : "text-muted-foreground"}`}>{email.to}</span>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {isFailed ? (
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/15 text-destructive font-medium">Failed</span>
                              <button
                                onClick={() => retryScheduledMutation.mutate(email.id)}
                                disabled={retryScheduledMutation.isPending}
                                title="Retry this scheduled email"
                                data-testid={`button-retry-scheduled-${email.id}`}
                                className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium disabled:opacity-50"
                              >Retry</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => cancelScheduledMutation.mutate(email.id)}
                              disabled={cancelScheduledMutation.isPending}
                              title="Cancel scheduled send"
                              data-testid={`button-cancel-scheduled-${email.id}`}
                              className="text-muted-foreground/40 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <CalendarX className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-xs truncate text-foreground/70">{email.subject || "(no subject)"}</p>
                      {isFailed ? (
                        <p className="text-xs text-destructive/70 mt-0.5 truncate" title={email.error ?? undefined}>{email.error || "Send failed"}</p>
                      ) : (
                        <p className="text-xs text-primary/70 mt-0.5 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(email.scheduledAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                  );
                })
              )
            )}

            {/* CRM Review tab — threads with unconfirmed auto-associations */}
            {tab === "review" && (
              reviewQueueQuery.isLoading ? (
                <div className="p-3 space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="space-y-1 p-2"><Skeleton className="h-3.5 w-2/3" /><Skeleton className="h-3 w-full" /></div>)}</div>
              ) : (reviewQueueQuery.data?.items || []).length === 0 ? (
                <div className="p-8 text-center">
                  <ShieldCheck className="h-10 w-10 mx-auto mb-3 opacity-30 text-green-500" />
                  <p className="text-sm font-medium text-foreground mb-1">All caught up</p>
                  <p className="text-xs text-muted-foreground">No threads need CRM review right now.</p>
                </div>
              ) : (
                <>
                  {/* ── Explainer + bulk action bar ──────────────────── */}
                  <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/30">
                    {/* What is CRM Review */}
                    <div className="px-3 py-2 border-b border-border/20 bg-amber-500/5">
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium mb-0.5">What to do here</p>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        These email threads were auto-matched to CRM records. Click <span className="font-medium text-green-500">✓ Confirm</span> to link the thread to that record, or <span className="font-medium text-red-400">✗ Reject</span> to dismiss. Use the checkbox to select multiple and act in bulk.
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 px-2 py-1.5">
                    {selectedReviewIds.size === 0 ? (
                      /* No selection — show quick-select helper + rules button */
                      <>
                      <button
                        onClick={selectHighConfidence}
                        data-testid="button-select-high-confidence"
                        className="flex items-center gap-1 text-[11px] text-amber-500/80 hover:text-amber-400 transition-colors px-1.5 py-1 rounded hover:bg-amber-500/10"
                        title={`Select all suggestions with ≥${HIGH_CONFIDENCE_THRESHOLD}% confidence`}
                      >
                        <CheckCheck className="h-3 w-3" />
                        Select high-confidence (≥{HIGH_CONFIDENCE_THRESHOLD}%)
                      </button>
                      <button
                        onClick={() => setShowAutoLinkRules(true)}
                        data-testid="button-auto-link-rules"
                        className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors px-1.5 py-1 rounded hover:bg-muted/40"
                        title="Manage domain auto-link rules"
                      >
                        <Zap className="h-3 w-3" />
                        Auto-link rules
                      </button>
                      </>
                    ) : (
                      /* Active selection — show count + actions */
                      <>
                        <span className="text-[11px] font-medium text-foreground/70 mr-0.5 tabular-nums">
                          {selectedReviewIds.size} selected
                        </span>
                        <button
                          onClick={() => bulkConfirmMutation.mutate(buildBulkPayload())}
                          disabled={bulkConfirmMutation.isPending || bulkRejectMutation.isPending}
                          data-testid="button-bulk-confirm"
                          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-green-500/15 text-green-400 hover:bg-green-500/25 transition-colors disabled:opacity-50"
                          title="Confirm all selected associations"
                        >
                          {bulkConfirmMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}
                          Confirm
                        </button>
                        <button
                          onClick={() => bulkRejectMutation.mutate(buildBulkPayload())}
                          disabled={bulkConfirmMutation.isPending || bulkRejectMutation.isPending}
                          data-testid="button-bulk-reject"
                          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors disabled:opacity-50"
                          title="Reject all selected associations"
                        >
                          {bulkRejectMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                          Reject
                        </button>
                        <button
                          onClick={() => setSelectedReviewIds(new Set())}
                          data-testid="button-clear-selection"
                          className="ml-auto text-muted-foreground/40 hover:text-foreground transition-colors"
                          title="Clear selection"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                  </div>

                  {/* ── Queue rows ─────────────────────────────────────── */}
                  {(reviewQueueQuery.data?.items || []).map((item) => {
                    const isThreadSelected = item.gmailThreadId === selectedThreadId;
                    const isChecked = selectedReviewIds.has(item.gmailThreadId);
                    const senderName = item.latestMessage.fromName || item.latestMessage.fromEmail?.split("@")[0] || "Unknown";
                    const dateStr = item.latestMessage.sentAt
                      ? formatDate(new Date(item.latestMessage.sentAt).toISOString(), undefined)
                      : "";
                    const cand = item.topCandidate;
                    const score = cand?.confidenceScore ?? 0;
                    const scoreBg = score >= HIGH_CONFIDENCE_THRESHOLD ? "bg-green-500/20 text-green-400" : score >= 45 ? "bg-amber-500/20 text-amber-400" : "bg-muted/60 text-muted-foreground";
                    const typeLabel: Record<string, string> = { contact: "Contact", account: "Account", lead: "Lead", opportunity: "Opp", partner: "Partner" };
                    return (
                      <div
                        key={item.gmailThreadId}
                        data-testid={`review-row-${item.gmailThreadId}`}
                        className={`w-full relative flex items-stretch transition-colors border-b border-border/20 border-l-[3px] ${
                          isChecked
                            ? "bg-amber-500/12 border-l-amber-400"
                            : isThreadSelected
                              ? "bg-amber-500/8 border-l-amber-500"
                              : "border-l-amber-500/40 hover:bg-amber-500/5"
                        }`}
                      >
                        {/* Checkbox — stops propagation so row click still works */}
                        <div
                          className="flex items-center justify-center px-2.5 flex-shrink-0 cursor-pointer group/cb"
                          onClick={(e) => { e.stopPropagation(); toggleReviewSelection(item.gmailThreadId); }}
                          data-testid={`review-checkbox-${item.gmailThreadId}`}
                          title={isChecked ? "Deselect" : "Select for bulk action"}
                        >
                          <div className={`h-4 w-4 rounded border-2 transition-colors flex items-center justify-center flex-shrink-0 ${
                            isChecked
                              ? "bg-amber-500 border-amber-500"
                              : "border-muted-foreground/40 group-hover/cb:border-amber-400"
                          }`}>
                            {isChecked && <CheckCheck className="h-2.5 w-2.5 text-white" />}
                          </div>
                        </div>

                        {/* Row content — click opens thread */}
                        <button
                          className="flex-1 text-left py-3 min-w-0"
                          onClick={() => { setSelectedThreadId(item.gmailThreadId); setSelectedMessageId(null); setCurrentThreadAccountId(item.gmailAccountId ?? null); }}
                        >
                          <div className="flex items-center justify-between gap-2 mb-[3px]">
                            <span className="text-[13px] leading-none font-medium text-foreground/80 truncate">{senderName}</span>
                            <span className="text-[11px] text-muted-foreground/45 whitespace-nowrap flex-shrink-0 tabular-nums">{dateStr}</span>
                          </div>
                          <div className="text-[12px] leading-snug truncate mb-1">
                            <span className="text-muted-foreground/65">{item.latestMessage.subject || "(no subject)"}</span>
                            {item.latestMessage.snippet && (
                              <span className="text-muted-foreground/38"> — {item.latestMessage.snippet}</span>
                            )}
                          </div>
                          {cand && (
                            <div className="flex items-center gap-1.5 mt-1">
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary/70 font-medium">
                                {typeLabel[cand.objectType] ?? cand.objectType}
                              </span>
                              <span className="text-[11px] text-foreground/60 truncate">{cand.objectName}</span>
                              <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded font-medium ${scoreBg}`}>
                                {score}%
                              </span>
                              {item.candidateCount > 1 && (
                                <span className="text-[10px] text-muted-foreground/50">+{item.candidateCount - 1}</span>
                              )}
                            </div>
                          )}
                        </button>

                        {/* Per-row confirm / reject / auto-link buttons */}
                        {cand && (() => {
                          const autoLinkDomain = resolveAutoLinkDomain(item);
                          const canAutoLink = !!autoLinkDomain && !!cand.objectId && !!cand.objectType;
                          const isBusy = bulkConfirmMutation.isPending || bulkRejectMutation.isPending || confirmAndAutoLinkMutation.isPending;
                          return (
                          <div className="flex flex-col justify-center gap-1 pr-2.5 pl-1 flex-shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                bulkConfirmMutation.mutate([{ associationId: cand.id, threadId: item.gmailThreadId }]);
                              }}
                              disabled={isBusy}
                              data-testid={`button-confirm-row-${item.gmailThreadId}`}
                              title="Confirm — link this thread to the CRM record"
                              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-green-500/25 text-green-400 hover:bg-green-500/40 border border-green-500/30 transition-colors disabled:opacity-40"
                            >
                              <Check className="h-3 w-3" /> Yes
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                bulkRejectMutation.mutate([{ associationId: cand.id, threadId: item.gmailThreadId }]);
                              }}
                              disabled={isBusy}
                              data-testid={`button-reject-row-${item.gmailThreadId}`}
                              title="Reject — dismiss this suggestion"
                              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-red-500/20 text-red-400 hover:bg-red-500/35 border border-red-500/30 transition-colors disabled:opacity-40"
                            >
                              <X className="h-3 w-3" /> No
                            </button>
                            {canAutoLink && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  confirmAndAutoLinkMutation.mutate({
                                    items: [{ associationId: cand.id, threadId: item.gmailThreadId }],
                                    domain: autoLinkDomain!,
                                    objectType: cand.objectType,
                                    objectId: cand.objectId,
                                    objectName: cand.objectName ?? cand.objectType,
                                  });
                                }}
                                disabled={isBusy}
                                data-testid={`button-autolink-row-${item.gmailThreadId}`}
                                title={`Confirm + always auto-link @${autoLinkDomain} to ${cand.objectName ?? cand.objectType}`}
                                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-primary/15 text-primary hover:bg-primary/25 border border-primary/25 transition-colors disabled:opacity-40"
                              >
                                <Zap className="h-3 w-3" /> Auto
                              </button>
                            )}
                          </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </>
              )
            )}

            {/* Folder tab — show emails from DB assigned to this folder */}
            {tab === "folder" && (
              folderEmailsQuery.isLoading ? (
                <div className="p-3 space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="space-y-1 p-2"><Skeleton className="h-3.5 w-2/3" /><Skeleton className="h-3 w-full" /></div>)}</div>
              ) : (folderEmailsQuery.data || []).length === 0 ? (
                <div className="p-8 text-center">
                  <FolderOpen className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-medium text-foreground mb-1">No emails yet</p>
                  <p className="text-xs text-muted-foreground mb-3">
                    Add domain rules in folder settings, then click Reprocess to populate this folder.
                  </p>
                  <button
                    onClick={() => { if (selectedFolderId) setShowFolderSettings(selectedFolderId); }}
                    className="text-xs text-primary hover:underline"
                  >
                    Open folder settings →
                  </button>
                </div>
              ) : (
                (folderEmailsQuery.data || []).map((email) => {
                  const isSelected = email.gmailThreadId === selectedThreadId;
                  const isBulkSelected = email.gmailThreadId ? selectedInboxIds.has(email.gmailThreadId) : false;
                  const senderName = email.fromName || email.fromEmail?.split("@")[0] || "Unknown";
                  const dateStr = email.sentAt
                    ? formatDate(new Date(email.sentAt).toISOString(), undefined)
                    : "";
                  return (
                    <div
                      key={email.id}
                      className={`relative group flex items-stretch transition-colors border-b border-border/20 ${
                        isBulkSelected
                          ? "bg-primary/8 border-l-[3px] border-l-primary/60"
                          : isSelected
                          ? "bg-primary/8 border-l-[3px] border-l-primary"
                          : "border-l-[3px] border-l-transparent hover:bg-muted/25"
                      }`}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); if (!email.gmailThreadId) return; setSelectedInboxIds(prev => { const n = new Set(prev); n.has(email.gmailThreadId!) ? n.delete(email.gmailThreadId!) : n.add(email.gmailThreadId!); return n; }); }}
                        data-testid={`checkbox-folder-email-${email.id}`}
                        className={`flex-shrink-0 w-8 flex items-center justify-center text-muted-foreground/30 hover:text-primary transition-all ${selectedInboxIds.size > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                        title="Select email"
                      >
                        {isBulkSelected
                          ? <CheckSquare className="h-3.5 w-3.5 text-primary" />
                          : <Square className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={() => { setSelectedThreadId(email.gmailThreadId); setSelectedMessageId(null); }}
                        data-testid={`folder-email-row-${email.id}`}
                        className="flex-1 text-left px-2 py-3 pr-10 min-w-0"
                      >
                        <div className="flex items-center justify-between gap-2 mb-[3px]">
                          <span className="text-[13px] leading-none font-medium text-foreground/80 truncate">{senderName}</span>
                          <span className="text-[11px] text-muted-foreground/45 whitespace-nowrap flex-shrink-0 tabular-nums">{dateStr}</span>
                        </div>
                        <div className="text-[12px] leading-snug truncate">
                          <span className="text-muted-foreground/65">{email.subject || "(no subject)"}</span>
                          {email.snippet && <span className="text-muted-foreground/38"> — {email.snippet}</span>}
                        </div>
                      </button>
                      <button
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/35 hover:text-destructive rounded-md"
                        title="Remove from folder"
                        data-testid={`button-remove-from-folder-${email.id}`}
                        onClick={() => selectedFolderId && removeEmailFromFolderMutation.mutate({ folderId: selectedFolderId, emailId: email.id })}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })
              )
            )}

            {/* ── Inbox subcategory header — "Inbox · [Category]" ─────────── */}
            {tab === "inbox" && inboxCategory !== "all" && (
              <div className="px-3 py-2 border-b border-border/40 flex items-center gap-1.5 bg-muted/15 flex-shrink-0">
                <InboxIcon className="h-3 w-3 text-muted-foreground/50 flex-shrink-0" />
                <span className="text-[11px] text-muted-foreground/55">Inbox</span>
                <span className="text-[11px] text-muted-foreground/30">·</span>
                <span className="text-[11px] font-medium text-foreground/70">
                  {inboxCategory === "people"      ? "People"
                    : inboxCategory === "updates" ? "Updates"
                    : inboxCategory === "promotions"  ? "Promotions"
                    : inboxCategory === "social"       ? "Social"
                    : inboxCategory === "forums"       ? "Forums & Communities"
                    : inboxCategory === "priority"     ? "Priority"
                    : ""}
                </span>
              </div>
            )}

            {/* ── Category tab rendering (Updates / Promotions / Social / Forums) ── */}
            {isCategoryTab && (
              categoryQuery.isLoading ? (
                <div className="p-3 space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="space-y-1 p-2"><Skeleton className="h-3.5 w-2/3" /><Skeleton className="h-3 w-full" /></div>)}</div>
              ) : (categoryQuery.data?.messages || []).length === 0 ? (
                <div className="p-8 text-center">
                  <Newspaper className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-medium text-foreground mb-1">No emails in this category</p>
                  <p className="text-xs text-muted-foreground">Gmail routes matching messages here automatically.</p>
                </div>
              ) : (
                (categoryQuery.data?.messages || []).map((msg) => {
                  const isSelected = msg.threadId === selectedThreadId;
                  const isUnread = (msg.labelIds || []).includes("UNREAD");
                  const senderName = msg.fromName || msg.fromEmail?.split("@")[0] || "Unknown";
                  const dateStr = msg.sentAt ? formatDate(new Date(msg.sentAt).toISOString(), undefined) : "";
                  return (
                    <div
                      key={msg.id}
                      data-testid={`category-email-row-${msg.id}`}
                      className={`relative group flex items-stretch transition-colors border-b border-border/20 ${
                        isSelected
                          ? "bg-primary/8 border-l-[3px] border-l-primary"
                          : "border-l-[3px] border-l-transparent hover:bg-muted/25"
                      }`}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedInboxIds(prev => { const n = new Set(prev); n.has(msg.threadId) ? n.delete(msg.threadId) : n.add(msg.threadId); return n; }); }}
                        data-testid={`checkbox-category-email-${msg.id}`}
                        className={`flex-shrink-0 w-8 flex items-center justify-center text-muted-foreground/30 hover:text-primary transition-all ${selectedInboxIds.size > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                        title="Select email"
                      >
                        {selectedInboxIds.has(msg.threadId)
                          ? <CheckSquare className="h-3.5 w-3.5 text-primary" />
                          : <Square className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={() => { setSelectedThreadId(msg.threadId); setSelectedMessageId(null); }}
                        data-testid={`button-open-category-thread-${msg.id}`}
                        className="flex-1 text-left px-2 py-2.5 pr-16 min-w-0"
                      >
                        <div className="flex items-center justify-between gap-2 mb-[3px]">
                          <span className={`text-[13px] leading-none truncate ${isUnread ? "font-semibold text-foreground" : "font-medium text-foreground/80"}`}>{senderName}</span>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {/* Clicking the badge navigates back to the flat inbox tab and pre-selects this thread */}
                            <CategoryBadge
                              labelIds={msg.labelIds || []}
                              messageId={msg.id}
                              filterLabel="View in Inbox"
                              onFilter={(_catKey) => {
                                setSelectedThreadId(msg.threadId);
                                setSelectedMessageId(null);
                                setTab("inbox");
                              }}
                            />
                            <span className="text-[11px] text-muted-foreground/45 whitespace-nowrap tabular-nums">{dateStr}</span>
                          </div>
                        </div>
                        <div className="text-[12px] leading-snug truncate">
                          <span className={isUnread ? "text-foreground/80 font-medium" : "text-muted-foreground/65"}>{msg.subject || "(no subject)"}</span>
                          {msg.snippet && <span className="text-muted-foreground/38"> — {msg.snippet}</span>}
                        </div>
                      </button>
                      {/* Move to Primary Inbox */}
                      <button
                        className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/50 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-md text-[10px] font-medium"
                        title="Move to Primary Inbox"
                        data-testid={`button-move-to-primary-${msg.id}`}
                        onClick={(e) => { e.stopPropagation(); moveToPrimaryMutation.mutate(msg.threadId); }}
                        disabled={moveToPrimaryMutation.isPending}
                      >
                        <Inbox className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })
              )
            )}

            {tab !== "drafts" && tab !== "scheduled" && tab !== "folder" && tab !== "review" && !isCategoryTab && isLoading && (
              <div className="p-3 space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="space-y-1 p-2">
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                ))}
              </div>
            )}
            {error && tab !== "folder" && (
              <div className="p-8 text-center">
                <Mail className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium text-foreground mb-1">Could not load emails.</p>
                {statusQuery.data?.connected && statusQuery.data?.tokenValid && !statusQuery.data?.apiEnabled ? (
                  <>
                    <p className="text-xs text-muted-foreground mb-4">The Gmail API is disabled in your Google Cloud project. Enable it to restore access.</p>
                    <a
                      href="https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=262239468400"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600/80 text-white text-sm font-medium hover:bg-red-600 transition-colors"
                      data-testid="button-enable-gmail-api-inline"
                    >
                      <Mail className="w-4 h-4" />
                      Enable Gmail API in Google Cloud →
                    </a>
                  </>
                ) : statusQuery.data?.hasCredentials && (!statusQuery.data.connected || !statusQuery.data.tokenValid) ? (
                  <>
                    <p className="text-xs text-muted-foreground mb-4">
                      {statusQuery.data.connected && !statusQuery.data.tokenValid
                        ? "Gmail session has expired. Please reconnect your account."
                        : "Gmail is not connected to VoltSafe Growth OS."}
                    </p>
                    <a
                      href="/api/auth/gmail/connect"
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                      data-testid="button-connect-gmail"
                    >
                      <Mail className="w-4 h-4" />
                      {statusQuery.data.connected && !statusQuery.data.tokenValid ? "Reconnect Gmail Account" : "Connect Gmail Account"}
                    </a>
                  </>
                ) : statusQuery.data && !statusQuery.data.hasCredentials ? (
                  <p className="text-xs text-red-400">Google credentials not configured. Ask your admin to set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.</p>
                ) : (
                  <p className="text-xs mt-1 text-red-400">{(error as Error).message}</p>
                )}
              </div>
            )}
            {/* Bulk action toolbar — shown when threads OR drafts are selected */}
            {tab !== "scheduled" && tab !== "review" && (selectedInboxIds.size > 0 || selectedDraftIds.size > 0) && (
              <div className="sticky top-0 z-10 flex items-center gap-1.5 px-2 py-2 bg-background/98 backdrop-blur border-b border-primary/20 border-l-[3px] border-l-primary/40">
                <span className="text-[11px] font-semibold text-foreground/70 mr-0.5 tabular-nums shrink-0" data-testid="text-bulk-selected-count">
                  {tab === "drafts" ? selectedDraftIds.size : selectedInboxIds.size} sel.
                </span>
                {/* Read/Unread/Archive/Done — only for non-draft thread tabs */}
                {tab !== "drafts" && canSend && (
                  <>
                    <button
                      onClick={() => bulkMarkReadMutation.mutate({ markAs: "read" })}
                      disabled={bulkMarkReadMutation.isPending || bulkArchiveMutation.isPending}
                      data-testid="button-bulk-mark-read"
                      title="Mark selected as read"
                      className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary/80 hover:bg-primary/20 transition-colors disabled:opacity-50 min-h-[32px]"
                    >
                      {bulkMarkReadMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MailOpen className="h-3.5 w-3.5" />}
                      <span className="hidden sm:inline">Read</span>
                    </button>
                    <button
                      onClick={() => bulkMarkReadMutation.mutate({ markAs: "unread" })}
                      disabled={bulkMarkReadMutation.isPending || bulkArchiveMutation.isPending}
                      data-testid="button-bulk-mark-unread"
                      title="Mark selected as unread"
                      className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg bg-muted/50 text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50 min-h-[32px]"
                    >
                      <Mail className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Unread</span>
                    </button>
                  </>
                )}
                {tab !== "drafts" && canSend && (
                  <button
                    onClick={() => bulkArchiveMutation.mutate()}
                    disabled={bulkMarkReadMutation.isPending || bulkArchiveMutation.isPending}
                    data-testid="button-bulk-archive"
                    title="Archive selected threads"
                    className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50 min-h-[32px]"
                  >
                    {bulkArchiveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArchiveX className="h-3.5 w-3.5" />}
                    <span className="hidden sm:inline">Archive</span>
                  </button>
                )}
                {tab !== "drafts" && (
                  <button
                    onClick={() => bulkMarkDoneMutation.mutate()}
                    disabled={bulkMarkDoneMutation.isPending}
                    data-testid="button-bulk-mark-done"
                    title="Mark selected threads as done (clears awaiting reply)"
                    className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50 min-h-[32px]"
                  >
                    {bulkMarkDoneMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
                    <span className="hidden sm:inline">Done</span>
                  </button>
                )}
                {/* Delete — always available */}
                {confirmDeleteAll ? (
                  <div className="flex items-center gap-1.5 ml-1">
                    <span className="text-[10px] text-destructive/80 font-medium">Delete all?</span>
                    <button
                      onClick={() => {
                        if (tab === "drafts") {
                          const allIds = (draftsQuery.data || []).map(d => d.id);
                          bulkDeleteDraftsMutation.mutate(allIds);
                        } else {
                          const allIds = tab === "folder"
                            ? (folderEmailsQuery.data || []).map(e => e.gmailThreadId).filter(Boolean) as string[]
                            : activeMessages.map(m => m.threadId);
                          bulkTrashMutation.mutate(allIds);
                        }
                      }}
                      disabled={bulkTrashMutation.isPending || bulkDeleteDraftsMutation.isPending}
                      data-testid="button-confirm-delete-all"
                      className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg bg-destructive/20 text-destructive hover:bg-destructive/30 transition-colors disabled:opacity-50 min-h-[32px] font-semibold"
                    >
                      {(bulkTrashMutation.isPending || bulkDeleteDraftsMutation.isPending) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      Yes, delete all
                    </button>
                    <button
                      onClick={() => setConfirmDeleteAll(false)}
                      className="text-[11px] px-2 py-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors min-h-[32px]"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        if (tab === "drafts") bulkDeleteDraftsMutation.mutate();
                        else bulkTrashMutation.mutate();
                      }}
                      disabled={bulkTrashMutation.isPending || bulkDeleteDraftsMutation.isPending}
                      data-testid="button-bulk-delete-selected"
                      title={tab === "drafts" ? "Delete selected drafts" : "Move selected to Trash"}
                      className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg bg-destructive/10 text-destructive/80 hover:bg-destructive/20 transition-colors disabled:opacity-50 min-h-[32px]"
                    >
                      {(bulkTrashMutation.isPending || bulkDeleteDraftsMutation.isPending) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      <span className="hidden sm:inline">Delete</span>
                    </button>
                    <button
                      onClick={() => setConfirmDeleteAll(true)}
                      disabled={bulkTrashMutation.isPending || bulkDeleteDraftsMutation.isPending}
                      data-testid="button-bulk-delete-all"
                      title={tab === "drafts" ? "Delete all drafts" : "Move all visible to Trash"}
                      className="flex items-center gap-1 text-[11px] px-2 py-1.5 rounded-lg text-destructive/50 hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50 min-h-[32px]"
                    >
                      <span className="hidden sm:inline">All</span>
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </>
                )}
                <div className="flex items-center gap-1 ml-auto">
                  <button
                    onClick={selectAllInboxThreads}
                    data-testid="button-select-all-inbox"
                    title="Select all visible threads"
                    className="text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors px-2 py-1.5 min-h-[32px]"
                  >
                    All
                  </button>
                  <button
                    onClick={() => { setSelectedInboxIds(new Set()); setSelectedDraftIds(new Set()); setConfirmDeleteAll(false); }}
                    data-testid="button-clear-inbox-selection"
                    title="Clear selection"
                    className="text-muted-foreground/40 hover:text-foreground transition-colors p-1.5 min-h-[32px]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
            {tab !== "drafts" && tab !== "scheduled" && tab !== "folder" && tab !== "review" && !isLoading && !error && tab !== "other" && crmFilteredMessages?.length === 0 && (
              statusQuery.data && !statusQuery.data.connected ? (
                <div className="p-8 text-center">
                  <Mail className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <p className="text-sm font-medium text-foreground mb-1">Connect Your Gmail Account</p>
                  <p className="text-xs text-muted-foreground mb-5">
                    Link your Google account to see your inbox inside VoltSafe Growth OS.
                  </p>
                  {statusQuery.data.hasCredentials ? (
                    <a
                      href="/api/auth/gmail/connect"
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                      data-testid="button-connect-gmail"
                    >
                      <Mail className="w-4 h-4" />
                      Connect Gmail Account
                    </a>
                  ) : (
                    <p className="text-xs text-red-400">Google credentials not configured. Ask your admin to set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.</p>
                  )}
                </div>
              ) : crmFilter === "awaiting-reply" ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-30 text-emerald-400" />
                  <p className="font-medium text-emerald-400/70">All caught up!</p>
                  <p className="text-[11px] mt-1">No threads awaiting your reply.</p>
                </div>
              ) : crmFilter === "hot" ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  <Flame className="h-8 w-8 mx-auto mb-2 opacity-20" />
                  <p>No hot / engaged threads</p>
                  <p className="text-[11px] mt-1">Threads appear here when contacts open your emails 3+ times.</p>
                </div>
              ) : crmFilter === "unlinked" ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  <Link2 className="h-8 w-8 mx-auto mb-2 opacity-20" />
                  <p>No unlinked threads</p>
                  <p className="text-[11px] mt-1">All inbox threads are linked to a CRM record.</p>
                </div>
              ) : tab === "pinned" ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  <Pin className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="font-medium">No pinned conversations</p>
                  <p className="text-[11px] mt-1">Right-click any thread and choose Pin to keep it here.</p>
                </div>
              ) : crmFilter === "unread" && serverInboxUnreadCount > 0 ? (
                // Safety guard: server says unread messages exist but none have rendered yet.
                // This can happen on first load or after a context switch before the query
                // settles. Show a loading state instead of the misleading "No messages found."
                <div className="p-6 text-center text-sm text-muted-foreground">
                  <Loader2 className="h-8 w-8 mx-auto mb-2 opacity-40 animate-spin" />
                  <p className="font-medium">Unread messages are still loading…</p>
                  <p className="text-[11px] mt-1 opacity-60">{serverInboxUnreadCount} unread email{serverInboxUnreadCount !== 1 ? "s" : ""} will appear shortly.</p>
                </div>
              ) : (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  <Inbox className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p>No messages found</p>
                </div>
              )
            )}
            {tab === "other" && inboxOther.length === 0 && !isLoading && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                <FolderX className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p>No filtered emails</p>
              </div>
            )}

            {/* PART C — Smart Inbox status strip */}
            {isSmartView && (
              <div className="px-3 py-1.5 flex items-center gap-1.5 border-b border-border/20">
                {loadingMoreInbox || (!!inboxNextToken && inboxUnreadCount < inboxCategoryServerUnread && inboxCategoryServerUnread > 0) ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/35 flex-shrink-0" />
                    <span className="text-[10px] text-muted-foreground/45 italic">Loading remaining unread emails…</span>
                  </>
                ) : (
                  <span className="text-[10px] text-muted-foreground/35 italic">Showing grouped unread inbox mail. Older unread emails load automatically.</span>
                )}
              </div>
            )}

            {tab !== "drafts" && tab !== "scheduled" && tab !== "folder" && tab !== "review" && (
              isUnreadCardsView
                ? unreadCardsMessages.map((m) => ({ kind: "msg" as const, section: "flat" as SmartSectionId, msg: m }))
                : (collapsedViewItems ?? (crmFilteredMessages ?? []).map((m) => ({ kind: "msg" as const, section: "flat" as SmartSectionId, msg: m })))
            )?.map((item, _idx, _arr) => {
              // Resolve section key for palette lookup — works for header, msg, and sentinel items.
              const smartSection: string =
                item.kind === "header" ? item.id :
                item.kind === "msg"    ? item.section :
                "sectionId" in item    ? (item as { sectionId: string }).sectionId : "";
              const sStyle = SMART_SECTION_STYLES[smartSection] ?? SMART_SECTION_STYLES_DEFAULT;

              // ── Section header ──────────────────────────────────────────────
              if (item.kind === "header") {
                const HeaderIcon =
                  item.glyph === "priority"      ? Zap        :
                  item.glyph === "people"        ? Users      :
                  item.glyph === "updates"        ? Newspaper  :
                  item.glyph === "notifications" ? Bell       :
                  item.glyph === "pinned"        ? Pin        :
                  /* "seen" */                     MailOpen;
                const isPriority = item.id === "priority";
                return (
                  <div
                    key={`smart-header-${item.id}`}
                    data-testid={`smart-section-header-${item.id}`}
                    className={`flex items-center gap-2 px-3 py-2 ${sStyle.headerBg} rounded-t-md mx-2 ${_idx === 0 ? "mt-1" : "mt-3"} border-b border-white/[0.06]`}
                  >
                    <HeaderIcon className={`h-3.5 w-3.5 flex-shrink-0 ${sStyle.tone}`} aria-hidden="true" />
                    <span className={`text-[11px] font-semibold uppercase tracking-[0.07em] ${sStyle.tone}`}>
                      {item.title}
                    </span>
                    <span className="text-[10px] tabular-nums text-muted-foreground/40 ml-0.5" data-testid={`section-header-count-${item.id}`}>
                      {item.id === "unread-people" || item.id === "unread-notifications" || item.id === "unread-newsletters"
                        ? serverGroupCounts !== null
                          ? serverGroupCounts[item.id as keyof typeof serverGroupCounts] ?? 0
                          : <span className="opacity-50">…</span>
                        : item.count}
                    </span>
                    {isPriority && (
                      <span className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium normal-case tracking-normal bg-amber-400/[0.10] text-amber-400/60 border border-amber-400/[0.15]">
                        overlay · also in People/Updates
                      </span>
                    )}
                  </div>
                );
              }

              // ── Show-all sentinel (below last visible email) ────────────────
              if (item.kind === "show-all") {
                const { sectionId, total } = item as { kind: "show-all"; sectionId: SmartSectionId; total: number };
                const serverTotal = serverGroupCounts?.[sectionId as keyof typeof serverGroupCounts];
                const needsServerFetch = !!(serverTotal && serverTotal > total && !sectionFetchDoneIds.has(sectionId));
                const isLoadingSection = sectionLoadingIds.has(sectionId);
                const sectionName = SECTION_DISPLAY_NAMES[sectionId] ?? "email";

                if (isLoadingSection) {
                  return (
                    <div
                      key={`show-all-${sectionId}`}
                      data-testid={`show-all-loading-${sectionId}`}
                      className={`w-full flex items-center justify-center gap-1.5 py-2 text-[11px] font-medium rounded-b-md mx-2 ${sStyle.rowBg} text-primary/50 border-t border-white/[0.04]`}
                    >
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                      Loading remaining {sectionName} emails…
                    </div>
                  );
                }

                const label = "Show all";

                return (
                  <button
                    key={`show-all-${sectionId}`}
                    data-testid={`show-all-${sectionId}`}
                    onClick={() => {
                      if (needsServerFetch) {
                        loadAllForSection(sectionId);
                      } else {
                        setExpandedSections(prev => { const s = new Set(prev); s.add(sectionId); return s; });
                      }
                    }}
                    className={`w-full flex items-center justify-center gap-1.5 py-2 text-[11px] font-medium cursor-pointer rounded-b-md mx-2 ${sStyle.rowBg} text-primary/60 hover:text-primary border-t border-white/[0.04] transition-colors`}
                  >
                    <ChevronDown className="h-3 w-3" aria-hidden="true" />
                    {label}
                  </button>
                );
              }

              // ── Show-less sentinel (below last email in expanded section) ───
              if (item.kind === "show-less") {
                const { sectionId } = item as { kind: "show-less"; sectionId: SmartSectionId };
                return (
                  <button
                    key={`show-less-${sectionId}`}
                    data-testid={`show-less-${sectionId}`}
                    onClick={() => setExpandedSections(prev => { const s = new Set(prev); s.delete(sectionId); return s; })}
                    className={`w-full flex items-center justify-center gap-1.5 py-2 text-[11px] font-medium cursor-pointer rounded-b-md mx-2 ${sStyle.rowBg} text-muted-foreground/50 hover:text-muted-foreground border-t border-white/[0.04] transition-colors`}
                  >
                    <ChevronUp className="h-3 w-3" aria-hidden="true" />
                    Show less
                  </button>
                );
              }

              // ── Email message row ───────────────────────────────────────────
              // Safety guard: only msg items reach this point.
              if (item.kind !== "msg") return null;
              // isLastInSection: determines rounded-b-md on the row when no sentinel follows.
              const isLastInSection = sStyle.mx !== "" && (!_arr[_idx + 1] || _arr[_idx + 1].kind === "header");
              const msg = item.msg;
              const unread = isUnread(msg.labelIds);
              const starred = isStarred(msg.labelIds);
              const isSelected = msg.threadId === selectedThreadId;
              const isBulkChecked = selectedInboxIds.has(msg.threadId);
              const domain = parseSenderDomain(msg.from);
              const blocked = blockedDomains.has(domain);
              const rowSenderEmail = (msg.fromEmail || "").toLowerCase();
              const emailBlocked = !!rowSenderEmail && blockedEmails.has(rowSenderEmail);
              const emailBlockRecord = emailBlocked
                ? (blockedSendersQuery.data || []).find((r) => r.email === rowSenderEmail)
                : null;
              const senderName = tab === "sent"
                ? (msg.to ? `→ ${parseSenderName(msg.to)}` : "Unknown")
                : (msg.fromName?.trim() || msg.fromEmail?.trim() || parseSenderName(msg.from) || "Unknown");
              const threadSig = threadSignals[msg.threadId] ?? null;
              const hasSignalRow = threadSig && (
                threadSig.isReplied || threadSig.isHot ||
                threadSig.isRepliedByUser || threadSig.isForwardedByUser ||
                (threadSig.signalLevel && threadSig.signalLevel !== "none") ||
                threadSig.awaitingReplySince ||
                (threadSig.workflowState && threadSig.workflowState !== "none")
              );
              return (
                <div
                  key={msg.id}
                  className={`relative group flex items-stretch cursor-pointer transition-colors border-b border-white/[0.06] ${sStyle.mx} ${isLastInSection ? "rounded-b-md overflow-hidden" : ""} ${
                    isSelected
                      ? `${sStyle.rowBg} bg-primary/[0.13] hover:bg-primary/[0.15] border-l-[3px] border-l-primary`
                      : isBulkChecked
                        ? `${sStyle.rowBg} bg-primary/10 border-l-[3px] border-l-primary/60`
                        : `${sStyle.rowBg} border-l-[3px] border-l-transparent hover:bg-primary/[0.07] hover:border-l-primary/25`
                  }`}
                >
                  {/* Checkbox — visible on hover or when any selection active */}
                  <div
                    className={`flex items-center justify-center px-2 flex-shrink-0 cursor-pointer transition-opacity ${
                      selectedInboxIds.size > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}
                    onClick={(e) => { e.stopPropagation(); toggleInboxSelection(msg.threadId); }}
                    data-testid={`checkbox-thread-${msg.id}`}
                    title={isBulkChecked ? "Deselect" : "Select for bulk action"}
                  >
                    <div className={`h-3.5 w-3.5 rounded border transition-colors flex items-center justify-center flex-shrink-0 ${
                      isBulkChecked
                        ? "bg-primary border-primary"
                        : "border-border/50 hover:border-primary/60"
                    }`}>
                      {isBulkChecked && <CheckCheck className="h-2.5 w-2.5 text-primary-foreground" />}
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleEmailRowClick(e, msg)}
                    data-testid={`email-row-${msg.id}`}
                    className={`flex-1 text-left ${densityClasses.py} pr-14 min-w-0 transition-[padding] duration-200 outline-none focus:outline-none focus-visible:outline-none`}
                  >
                    {/* Row 1: sender + timestamp */}
                    <div className="flex items-center justify-between gap-2 mb-[3px]">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {unread && (
                          <div
                            className="w-2 h-2 rounded-full bg-primary flex-shrink-0 shadow-[0_0_8px_0_rgba(20,184,166,0.55)]"
                            aria-label="Unread"
                            data-testid={`dot-unread-${msg.id}`}
                          />
                        )}
                        {/* Multi-mailbox Phase 1: account badge — only shown in unified ("All Inboxes") mode
                            so users can tell which mailbox each row came from at a glance. */}
                        {activeAccountId === "all" && msg.sourceAccountId != null && (
                          <AccountSourceBadge
                            accounts={accountsQuery.data}
                            sourceAccountId={msg.sourceAccountId}
                            messageId={msg.id}
                          />
                        )}
                        {(tab === "inbox" || isSmartView) && (
                          <CategoryBadge
                            labelIds={msg.labelIds}
                            messageId={msg.id}
                            onFilter={(catKey) => {
                              const tabMap: Record<string, string> = {
                                CATEGORY_UPDATES: "updates",
                                CATEGORY_PROMOTIONS: "promotions",
                                CATEGORY_SOCIAL: "social",
                                CATEGORY_FORUMS: "forums",
                              };
                              const dest = tabMap[catKey];
                              if (dest) setTab(dest as Parameters<typeof setTab>[0]);
                            }}
                          />
                        )}
                        <span className={`${densityClasses.senderText} leading-none truncate ${
                          unread
                            ? "font-semibold text-foreground tracking-[-0.01em]"
                            : "font-medium text-muted-foreground/75"
                        }`}>
                          {senderName}
                        </span>
                      </div>
                      <span className={`text-[11px] whitespace-nowrap flex-shrink-0 tabular-nums ${
                        unread ? "text-foreground/65 font-medium" : "text-muted-foreground/45"
                      }`}>
                        {formatDate(msg.date, msg.internalDate)}
                      </span>
                    </div>
                    {/* Row 2: subject — snippet (inline) */}
                    <div className={`${densityClasses.subText} leading-snug truncate`}>
                      <span className={unread ? "text-foreground/90 font-medium" : "text-muted-foreground/55"}>
                        {msg.subject || "(no subject)"}
                      </span>
                      {msg.snippet && densityClasses.showSnippet && (
                        <span className="text-muted-foreground/40"> — {msg.snippet}</span>
                      )}
                    </div>
                    {/* Row 3: signal badges + triage status (only when data present, not sent view) */}
                    {hasSignalRow && density !== "ultra" && tab !== "sent" && (
                      <div className={`flex items-center gap-1 ${densityClasses.signalsMt} flex-wrap`} data-testid={`thread-signals-${msg.threadId}`}>
                        {threadSig && <InboxSignalBadge sig={threadSig} />}
                        {threadSig?.workflowState && threadSig.workflowState !== "none" && (
                          <WorkflowStateBadge state={threadSig.workflowState} />
                        )}
                        {threadSig?.awaitingReplySince && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-400/80 bg-amber-500/8 border border-amber-500/20 px-1.5 py-0 rounded font-medium"
                            data-testid={`awaiting-badge-${msg.threadId}`}>
                            <Clock className="h-2.5 w-2.5" />
                            Awaiting {formatWaitTime(threadSig.awaitingReplySince)}
                          </span>
                        )}
                      </div>
                    )}
                    {/* Row 3 (Sent view): tracking pixel engagement indicators */}
                    {tab === "sent" && density !== "ultra" && (
                      <SentTrackingRow sig={threadSig} threadId={msg.threadId} signalsMt={densityClasses.signalsMt} />
                    )}
                  </button>

                  {/* Hover quick actions — slide+fade in on hover, backdrop-blur for legibility over dense rows */}
                  <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 pl-5 pr-1 rounded-l-lg
                                   opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0
                                   focus-within:opacity-100 focus-within:translate-x-0
                                   transition-all duration-150 ease-out
                                   bg-gradient-to-l from-background via-background/92 to-background/0
                                   backdrop-blur-[2px]">
                    {/* Star is always visible if starred (even outside hover) — handled via wrapper opacity override */}
                    <motion.button
                      whileTap={{ scale: 0.82 }}
                      whileHover={{ scale: 1.12 }}
                      transition={{ type: "spring", stiffness: 400, damping: 20 }}
                      title={starred ? "Remove priority" : "Mark as priority"}
                      aria-label={starred ? "Remove priority" : "Mark as priority"}
                      aria-pressed={starred}
                      tabIndex={starred ? 0 : -1}
                      data-testid={`button-star-${msg.id}`}
                      onClick={(e) => { e.stopPropagation(); toggleStarMutation.mutate(msg.id); }}
                      className={`p-1.5 rounded-md transition-colors focus-visible:!text-amber-400 ${
                        starred
                          ? "text-amber-400 hover:text-amber-300"
                          : "text-muted-foreground/40 hover:!text-amber-400 hover:bg-amber-500/10"
                      }`}
                    >
                      <motion.span
                        key={starred ? "starred" : "unstarred"}
                        initial={{ scale: 0.55, rotate: starred ? -55 : 55 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{ type: "spring", stiffness: 520, damping: 14 }}
                        className="inline-flex"
                        aria-hidden="true"
                      >
                        <Star className={`h-3.5 w-3.5 ${starred ? "fill-amber-400 drop-shadow-[0_0_4px_rgba(251,191,36,0.45)]" : ""}`} aria-hidden="true" />
                      </motion.span>
                    </motion.button>
                    {/* Pin to Smart-Inbox "Pinned" section. Only meaningful in
                        the Smart view — we hide it in Classic so the action
                        bar doesn't fill up with a control that has no visible
                        effect. Pinning lets the user pull a read-but-still-
                        important conversation back to the top of attention
                        without re-marking it unread. */}
                    {isSmartView && (() => {
                      const pinned = pinnedAPI.isPinned(msg.threadId);
                      return (
                        <motion.button
                          whileTap={{ scale: 0.82 }}
                          whileHover={{ scale: 1.1 }}
                          transition={{ type: "spring", stiffness: 400, damping: 20 }}
                          title={pinned ? "Unpin from Smart Inbox" : "Pin to Smart Inbox"}
                          aria-label={pinned ? "Unpin from Smart Inbox" : "Pin to Smart Inbox"}
                          aria-pressed={pinned}
                          tabIndex={pinned ? 0 : -1}
                          data-testid={`button-pin-${msg.id}`}
                          onClick={(e) => { e.stopPropagation(); pinnedAPI.togglePin(msg.threadId); }}
                          className={`p-1.5 rounded-md transition-colors ${
                            pinned
                              ? "text-primary hover:text-primary/80"
                              : "text-muted-foreground/40 hover:!text-primary hover:bg-primary/10"
                          }`}
                        >
                          {pinned
                            ? <PinOff className="h-3.5 w-3.5" aria-hidden="true" />
                            : <Pin className="h-3.5 w-3.5" aria-hidden="true" />}
                        </motion.button>
                      );
                    })()}
                    {canSend && tab === "inbox" && (
                      <motion.button
                        whileTap={{ scale: 0.82 }}
                        whileHover={{ scale: 1.1 }}
                        title="Archive this thread"
                        aria-label="Archive this thread"
                        tabIndex={-1}
                        data-testid={`button-archive-row-${msg.id}`}
                        onClick={(e) => { e.stopPropagation(); archiveThreadMutation.mutate(msg.threadId); }}
                        className="p-1.5 rounded-md transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground/40 hover:text-foreground hover:bg-muted/40"
                      >
                        <ArchiveX className="h-3.5 w-3.5" aria-hidden="true" />
                      </motion.button>
                    )}
                    {canSend && tab !== "sent" && (
                      <motion.button
                        whileTap={{ scale: 0.82 }}
                        whileHover={{ scale: 1.1 }}
                        title="Open thread"
                        aria-label="Open thread"
                        tabIndex={-1}
                        data-testid={`button-reply-row-${msg.id}`}
                        onClick={(e) => { e.stopPropagation(); handleSelectMessage(msg); }}
                        className="p-1.5 rounded-md transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground/40 hover:text-primary hover:bg-primary/10"
                      >
                        <Reply className="h-3.5 w-3.5" aria-hidden="true" />
                      </motion.button>
                    )}
                    {canSend && tab === "spam" && (
                      <motion.button
                        whileTap={{ scale: 0.82 }}
                        whileHover={{ scale: 1.1 }}
                        title="Not spam — move to inbox"
                        aria-label="Not spam — move to inbox"
                        tabIndex={-1}
                        data-testid={`button-not-spam-row-${msg.id}`}
                        onClick={(e) => { e.stopPropagation(); notSpamMutation.mutate(msg.threadId); }}
                        className="p-1.5 rounded-md transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground/40 hover:text-emerald-400 hover:bg-emerald-500/10"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      </motion.button>
                    )}
                    {canSend && tab !== "sent" && tab !== "spam" && (
                      <motion.button
                        whileTap={{ scale: 0.82 }}
                        whileHover={{ scale: 1.1 }}
                        title={
                          emailBlocked
                            ? `Unblock ${rowSenderEmail}`
                            : rowSenderEmail
                            ? `Block ${rowSenderEmail}`
                            : blocked
                            ? `Unblock @${domain}`
                            : `Block @${domain}`
                        }
                        aria-label={
                          emailBlocked
                            ? `Unblock ${rowSenderEmail}`
                            : rowSenderEmail
                            ? `Block ${rowSenderEmail}`
                            : `Block @${domain}`
                        }
                        tabIndex={-1}
                        data-testid={`button-flag-${msg.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (emailBlocked && emailBlockRecord) {
                            unblockSenderMutation.mutate(emailBlockRecord.id);
                          } else if (rowSenderEmail) {
                            blockSenderMutation.mutate({ senderEmail: rowSenderEmail, threadId: msg.threadId });
                          } else if (blocked) {
                            const filter = (filtersQuery.data || []).find((f) => f.domain === domain);
                            if (filter) unblockMutation.mutate(filter.id);
                          } else {
                            flagMutation.mutate(domain);
                          }
                        }}
                        className={`p-1.5 rounded-md transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100 ${
                          emailBlocked || blocked
                            ? "text-amber-400 hover:text-amber-300"
                            : "text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10"
                        }`}
                      >
                        {emailBlocked || blocked
                          ? <ShieldCheck className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                          : <Ban className="h-3.5 w-3.5" aria-hidden="true" />}
                      </motion.button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Infinite scroll sentinel — becomes visible at the bottom (with 600px prefetch),
                triggers auto-load. Always rendered for tabs that paginate so the IntersectionObserver
                stays attached. Adds an "all caught up" terminal state and an inline count so users
                always know whether more is coming. */}
            {tab !== "drafts" && tab !== "scheduled" && tab !== "folder" && !isLoading && !error && (
              <div ref={sentinelRef} className="py-5 flex flex-col items-center justify-center gap-1.5 text-[11px]" data-testid="infinite-scroll-sentinel">
                {isLoadingMore ? (
                  <span className="inline-flex items-center gap-2 text-muted-foreground/70" data-testid="status-loading-more">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading more messages…
                  </span>
                ) : hasMore ? (
                  <button
                    onClick={() => {
                      // When auto-chain has exhausted its budget but the user explicitly asks
                      // for more, reset the chain so it RESUMES for another batch of pages
                      // instead of stopping after a single 50-message fetch. This is the only
                      // way users with heavy blocked-domain stripping (LinkedIn, newsletters,
                      // etc.) can keep paginating — otherwise each click fetches one page that
                      // is mostly blocked, visible count doesn't grow, and the inbox feels stuck.
                      if (autoChainExhausted) {
                        autoChainRef.current = { key: inboxChainKey, count: 0 };
                        setAutoChainExhaustedKey(null);
                      }
                      loadMore();
                    }}
                    data-testid="button-load-more"
                    className="inline-flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-full text-[11px] text-muted-foreground/70 hover:text-foreground hover:bg-muted/40 transition-colors"
                  >
                    {autoChainExhausted ? (
                      <>
                        <span>Load more older messages</span>
                        <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                          {crmFilteredMessages.length.toLocaleString()} shown · {allInboxMessages.length.toLocaleString()} scanned
                          {(tab === "inbox" || tab === "other") && inboxOther.length > 0
                            ? ` · ${inboxOther.length.toLocaleString()} in Other`
                            : ""}
                        </span>
                      </>
                    ) : (
                      "Load more"
                    )}
                  </button>
                ) : crmFilteredMessages && crmFilteredMessages.length > 0 ? (
                  <div className="flex flex-col items-center gap-1.5" data-testid="status-all-caught-up">
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground/45 tabular-nums text-[11px]">
                      <span className="h-1 w-1 rounded-full bg-muted-foreground/30" />
                      You're all caught up · {crmFilteredMessages.length.toLocaleString()} message{crmFilteredMessages.length !== 1 ? "s" : ""} loaded
                    </span>
                    <span className="text-[10.5px] text-muted-foreground/40 text-center">
                      Looking for an older email? Use the search bar above — it searches your full mail history.
                    </span>
                    {(tab === "inbox" || tab === "other") && (
                      <button
                        data-testid="button-load-older-gmail"
                        onClick={() => {
                          setInboxExtra([]);
                          setInboxNextToken(null);
                          queryClient.invalidateQueries({ queryKey: INBOX_QK_PREFIX });
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10.5px] text-muted-foreground/50 hover:text-muted-foreground/80 hover:bg-muted/30 transition-colors"
                      >
                        <RefreshCw className="h-2.5 w-2.5" />
                        Load older messages
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </div>

        </div>

        {/* ── DRAGGABLE DIVIDER ───────────────────────────────────────────── */}
        <div
          className="hidden md:flex items-stretch w-[5px] flex-shrink-0 cursor-col-resize group relative select-none"
          onMouseDown={handleDividerMouseDown}
          data-testid="email-panel-divider"
          title="Drag to resize"
        >
          <div className="w-px bg-border/50 group-hover:bg-primary/50 group-active:bg-primary transition-colors mx-auto" />
        </div>

        {/* ── RIGHT PANEL: thread view + CRM context ─────────────────────── */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {selectedThreadId && tab !== "drafts" && tab !== "scheduled" && (() => {
          // Smart Focus Mode hint heuristic — long body, big thread, or wide HTML
          const totalBodyLen = selectedMessages.reduce((sum, m) => sum + (m.body?.length || 0), 0);
          const focusRecommended = !focusMode && (totalBodyLen > 12000 || selectedMessages.length >= 3);
          return (
          <div className={`flex-1 flex flex-col min-h-0 transition-colors duration-300 ${focusMode ? "bg-gradient-to-b from-background via-background to-card/10" : ""}`}>
            {/* CTA Engagement Banner — shows when recipient clicked a signature CTA */}
            {!focusMode && <CtaEngagementBanner threadId={selectedThreadId} />}
            {/* Resizable top header section (actions toolbar + subject header) */}
            {!topExpanded && focusedMsg && (
              <div
                ref={topHeaderRef}
                className="flex-shrink-0 h-9 flex items-center gap-2 border-b border-border/20 bg-card/15 px-3 cursor-pointer hover:bg-card/35 transition-colors group select-none"
                onClick={() => setTopExpanded(true)}
                data-testid="thread-header-mini"
                title="Click to expand"
              >
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary transition-colors flex-shrink-0" />
                <span className="text-[12.5px] font-semibold text-foreground/75 truncate min-w-0 flex-1">{focusedMsg.subject || "(no subject)"}</span>
                <span className="text-[11px] text-muted-foreground/45 flex-shrink-0 hidden sm:block">{parseSenderName(focusedMsg.from) || parseSenderEmail(focusedMsg.from)}</span>
                <span className="text-[10.5px] text-muted-foreground/35 tabular-nums flex-shrink-0 hidden md:block">{formatMessageHeaderDate(focusedMsg.date, focusedMsg.internalDate)}</span>
              </div>
            )}
            {topExpanded && (
            <div ref={topHeaderRef} className="flex-shrink-0">
            {/* Compact actions toolbar strip — sits flush above the subject header
                in normal mode so it doesn't eat into the padded header area. */}
            {!focusMode && selectedThreadId && focusedMsg && (
              <div
                className="flex-shrink-0 border-b border-border/20 bg-card/30 px-3 py-1"
                data-testid="email-actions-toolbar-wrapper"
              >
                <EmailActionsToolbar
                  threadId={selectedThreadId}
                  focusedMessage={{
                    id: focusedMsg.id,
                    subject: focusedMsg.subject,
                    body: focusedMsg.body,
                    snippet: focusedMsg.snippet ?? null,
                  }}
                  isPriority={isStarred(focusedMsg.labelIds)}
                  isPinned={pinnedAPI.isPinned(selectedThreadId)}
                  isSetAside={setAsideAPI.isSetAside(selectedThreadId)}
                  assignedUserId={readerAssignedUserId}
                  canReply={canSend}
                  isSpamView={tab === "spam"}
                  senderEmail={focusedMsg.fromEmail?.toLowerCase() || ""}
                  isBlocked={blockedEmails.has(focusedMsg.fromEmail?.toLowerCase() || "")}
                  handlers={{
                    onClose: handleBack,
                    onMarkDone: () => markDoneSingleMutation.mutate(selectedThreadId),
                    onTrash: () => trashThreadMutation.mutate(selectedThreadId),
                    onTogglePriority: () => toggleStarMutation.mutate(focusedMsg.id),
                    onMarkUnread: () => markUnreadSingleMutation.mutate(focusedMsg.id),
                    onTogglePin: () => pinnedAPI.togglePin(selectedThreadId),
                    onSetAside: () => {
                      setAsideAPI.toggle(selectedThreadId);
                      if (!setAsideAPI.isSetAside(selectedThreadId)) {
                        handleBack();
                      }
                    },
                    onSendAgain: () => handleReply(focusedMsg),
                    onReply: () => handleReply(focusedMsg),
                    onMove: () => archiveThreadMutation.mutate(selectedThreadId),
                    onMarkSpam: () => {
                      apiRequest("POST", `/api/inbox/threads/${encodeURIComponent(selectedThreadId)}/mark-spam`, {})
                        .then(() => {
                          const rm = (old: any) => old ? { ...old, messages: old.messages.filter((m: any) => m.threadId !== selectedThreadId) } : old;
                          queryClient.setQueriesData({ queryKey: ["/api/gmail/messages", "inbox"] }, rm);
                          queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages", "spam"] });
                          invalidateBadgeQueries();
                          setSelectedThreadId(null); setSelectedMessageId(null);
                          toast({ title: "Moved to Spam" });
                        })
                        .catch((e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }));
                    },
                    onBlock: () => {
                      const _email = focusedMsg.fromEmail?.toLowerCase().trim() || "";
                      if (_email) blockSenderMutation.mutate({ senderEmail: _email, threadId: selectedThreadId });
                      else archiveThreadMutation.mutate(selectedThreadId);
                    },
                    onBlockDomain: () => {
                      const _domain = parseSenderDomain(focusedMsg.from || focusedMsg.fromEmail || "");
                      const BROAD = new Set(["gmail.com","googlemail.com","outlook.com","hotmail.com","live.com","msn.com","icloud.com","me.com","yahoo.com","proton.me","protonmail.com","aol.com","fastmail.com","hey.com"]);
                      if (!_domain) return;
                      if (BROAD.has(_domain)) { toast({ title: "Domain too broad", description: `"${_domain}" is a widely-used provider. Block the specific sender instead.`, variant: "destructive" }); return; }
                      flagMutation.mutate(_domain);
                      archiveThreadMutation.mutate(selectedThreadId);
                    },
                    onTrustSender: () => notSpamMutation.mutate(selectedThreadId),
                    onNotSpam: () => notSpamMutation.mutate(selectedThreadId),
                  }}
                  onAssignChanged={() => {
                    queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-record", selectedThreadId] });
                  }}
                />
              </div>
            )}
            {/* Thread header — subject + meta only (tighter without toolbar) */}
            <div className={`flex-shrink-0 border-b border-border/30 bg-gradient-to-b from-card/40 via-card/20 to-transparent transition-all duration-300 ${focusMode ? "px-6 py-6" : `${densityClasses.readerHeaderPx} ${densityClasses.readerHeaderPy}`}`}>
              {/* Focus Mode: toolbar stays inside header for distraction-free layout */}
              {focusMode && selectedThreadId && focusedMsg && (
                <div className="mb-3 max-w-4xl mx-auto w-full">
                  <EmailActionsToolbar
                    threadId={selectedThreadId}
                    focusedMessage={{
                      id: focusedMsg.id,
                      subject: focusedMsg.subject,
                      body: focusedMsg.body,
                      snippet: focusedMsg.snippet ?? null,
                    }}
                    isPriority={isStarred(focusedMsg.labelIds)}
                    isPinned={pinnedAPI.isPinned(selectedThreadId)}
                    isSetAside={setAsideAPI.isSetAside(selectedThreadId)}
                    assignedUserId={readerAssignedUserId}
                    canReply={canSend}
                    isSpamView={tab === "spam"}
                    senderEmail={focusedMsg.fromEmail?.toLowerCase() || ""}
                    isBlocked={blockedEmails.has(focusedMsg.fromEmail?.toLowerCase() || "")}
                    handlers={{
                      onClose: handleBack,
                      onMarkDone: () => markDoneSingleMutation.mutate(selectedThreadId),
                      onTrash: () => trashThreadMutation.mutate(selectedThreadId),
                      onTogglePriority: () => toggleStarMutation.mutate(focusedMsg.id),
                      onMarkUnread: () => markUnreadSingleMutation.mutate(focusedMsg.id),
                      onTogglePin: () => pinnedAPI.togglePin(selectedThreadId),
                      onSetAside: () => {
                        setAsideAPI.toggle(selectedThreadId);
                        if (!setAsideAPI.isSetAside(selectedThreadId)) {
                          handleBack();
                        }
                      },
                      onSendAgain: () => handleReply(focusedMsg),
                      onReply: () => handleReply(focusedMsg),
                      onMove: () => archiveThreadMutation.mutate(selectedThreadId),
                      onMarkSpam: () => {
                        apiRequest("POST", `/api/inbox/threads/${encodeURIComponent(selectedThreadId)}/mark-spam`, {})
                          .then(() => {
                            const rm = (old: any) => old ? { ...old, messages: old.messages.filter((m: any) => m.threadId !== selectedThreadId) } : old;
                            queryClient.setQueriesData({ queryKey: ["/api/gmail/messages", "inbox"] }, rm);
                            queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages", "spam"] });
                            invalidateBadgeQueries();
                            setSelectedThreadId(null); setSelectedMessageId(null);
                            toast({ title: "Moved to Spam" });
                          })
                          .catch((e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }));
                      },
                      onBlock: () => {
                        const _email = focusedMsg.fromEmail?.toLowerCase().trim() || "";
                        if (_email) blockSenderMutation.mutate({ senderEmail: _email, threadId: selectedThreadId });
                        else archiveThreadMutation.mutate(selectedThreadId);
                      },
                      onBlockDomain: () => {
                        const _domain = parseSenderDomain(focusedMsg.from || focusedMsg.fromEmail || "");
                        const BROAD = new Set(["gmail.com","googlemail.com","outlook.com","hotmail.com","live.com","msn.com","icloud.com","me.com","yahoo.com","proton.me","protonmail.com","aol.com","fastmail.com","hey.com"]);
                        if (!_domain) return;
                        if (BROAD.has(_domain)) { toast({ title: "Domain too broad", description: `"${_domain}" is a widely-used provider. Block the specific sender instead.`, variant: "destructive" }); return; }
                        flagMutation.mutate(_domain);
                        archiveThreadMutation.mutate(selectedThreadId);
                      },
                      onTrustSender: () => notSpamMutation.mutate(selectedThreadId),
                      onNotSpam: () => notSpamMutation.mutate(selectedThreadId),
                    }}
                    onAssignChanged={() => {
                      queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-record", selectedThreadId] });
                    }}
                  />
                </div>
              )}
              <div className={`flex items-start gap-3 transition-[max-width] duration-300 ${focusMode ? "max-w-4xl mx-auto w-full" : ""}`}>
                <Button variant="ghost" size="icon" className="md:hidden h-8 w-8 -ml-2 mt-0.5" onClick={handleBack}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="flex-1 min-w-0">
                  {threadQuery.isLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-6 w-2/3" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                  ) : threadQuery.isError ? (
                    <div className="flex items-center gap-2" data-testid="thread-load-error">
                      <span className="text-[13px] text-destructive/80 font-medium">
                        {(threadQuery.error as any)?.message || "Could not load message"}
                      </span>
                      <button
                        onClick={() => threadQuery.refetch()}
                        className="text-[12px] text-primary/70 hover:text-primary underline underline-offset-2 transition-colors"
                        data-testid="button-retry-thread"
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <h1
                          className={`font-semibold leading-[1.2] tracking-[-0.018em] text-foreground transition-[font-size] duration-300 ${focusMode ? "text-[26px] md:text-[30px]" : densityClasses.readerSubjectText}`}
                          data-testid="text-thread-subject"
                        >
                          {focusedMsg?.subject || "(no subject)"}
                        </h1>
                        {focusedMsg && !focusMode && (
                          <span className="text-[11px] text-muted-foreground/40 tabular-nums font-medium flex-shrink-0 leading-none" data-testid="text-message-count">
                            {selectedMessages.length > 1 ? `${selectedMessages.length} msgs` : "1 msg"}
                          </span>
                        )}
                        {focusedMsg && isStarred(focusedMsg.labelIds) && (
                          <span className="inline-flex items-center gap-1 text-amber-400/90 text-[11px] font-medium flex-shrink-0 leading-none">
                            <Star className="h-3 w-3 fill-amber-400" aria-hidden="true" /> Starred
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {focusedMsg && (() => {
                    const headerStarred = isStarred(focusedMsg.labelIds);
                    return (
                      <motion.button
                        whileTap={{ scale: 0.85 }}
                        whileHover={{ scale: 1.08 }}
                        transition={{ type: "spring", stiffness: 400, damping: 22 }}
                        title={headerStarred ? "Remove priority" : "Mark as priority (s)"}
                        aria-label={headerStarred ? "Remove priority" : "Mark as priority"}
                        aria-pressed={headerStarred}
                        data-testid="button-star-thread"
                        onClick={() => toggleStarMutation.mutate(focusedMsg.id)}
                        className={`p-2 rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 outline-none ${
                          headerStarred
                            ? "text-amber-400 bg-amber-500/10 hover:bg-amber-500/15 shadow-[0_0_0_1px_rgba(251,191,36,0.18)]"
                            : "text-muted-foreground/40 hover:text-amber-400 hover:bg-muted/40"
                        }`}
                      >
                        <motion.span
                          key={headerStarred ? "starred" : "unstarred"}
                          initial={{ scale: 0.55, rotate: headerStarred ? -55 : 55 }}
                          animate={{ scale: 1, rotate: 0 }}
                          transition={{ type: "spring", stiffness: 520, damping: 14 }}
                          className="inline-flex"
                          aria-hidden="true"
                        >
                          <Star className={`h-4 w-4 ${headerStarred ? "fill-amber-400 drop-shadow-[0_0_5px_rgba(251,191,36,0.5)]" : ""}`} aria-hidden="true" />
                        </motion.span>
                      </motion.button>
                    );
                  })()}
                  {canSend && focusedMsg && (
                    <>
                      <motion.button
                        whileTap={{ scale: 0.92 }}
                        whileHover={{ scale: 1.05 }}
                        title="Reply (r)"
                        aria-label="Reply to this thread"
                        data-testid="button-reply-header"
                        onClick={() => handleReply(focusedMsg)}
                        className="p-2 rounded-lg text-muted-foreground/40 hover:text-primary hover:bg-primary/10 transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 outline-none"
                      >
                        <Reply className="h-4 w-4" aria-hidden="true" />
                      </motion.button>
                      <motion.button
                        whileTap={{ scale: 0.92 }}
                        whileHover={{ scale: 1.05 }}
                        title="Forward"
                        aria-label="Forward this email"
                        data-testid="button-forward-header"
                        onClick={() => handleForward(focusedMsg)}
                        className="p-2 rounded-lg text-muted-foreground/40 hover:text-primary hover:bg-primary/10 transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 outline-none"
                      >
                        <Forward className="h-4 w-4" aria-hidden="true" />
                      </motion.button>
                    </>
                  )}
                  {canSend && selectedThreadId && tab === "inbox" && (
                    <motion.button
                      whileTap={{ scale: 0.92 }}
                      whileHover={{ scale: 1.05 }}
                      title="Archive this thread"
                      aria-label="Archive this thread"
                      data-testid="button-archive-thread"
                      onClick={() => archiveThreadMutation.mutate(selectedThreadId)}
                      disabled={archiveThreadMutation.isPending}
                      className="p-2 rounded-lg text-muted-foreground/40 hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-primary/40 outline-none"
                    >
                      {archiveThreadMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArchiveX className="h-4 w-4" aria-hidden="true" />}
                    </motion.button>
                  )}
                  {/* Focus Mode toggle — smart hint pulse when long content / multi-message */}
                  <div className="relative">
                    {focusRecommended && (
                      <motion.span
                        initial={{ opacity: 0, scale: 0.6 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="absolute -top-1 -right-1 z-10 h-2 w-2 rounded-full bg-primary shadow-[0_0_0_3px_hsl(var(--background))]"
                        title="Focus Mode recommended for this email"
                        data-testid="badge-focus-recommended"
                      >
                        <span className="absolute inset-0 rounded-full bg-primary animate-ping opacity-75" />
                      </motion.span>
                    )}
                    <motion.button
                      whileTap={{ scale: 0.92 }}
                      whileHover={{ scale: 1.05 }}
                      title={focusMode ? "Exit Focus Mode (Esc · F)" : focusRecommended ? "Focus Mode recommended (F)" : "Focus Mode (F)"}
                      aria-label={focusMode ? "Exit Focus Mode" : "Enter Focus Mode"}
                      aria-pressed={focusMode}
                      data-testid="button-focus-mode"
                      onClick={() => setFocusMode((v) => !v)}
                      className={`p-2 rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 outline-none ${
                        focusMode
                          ? "text-primary bg-primary/10 hover:bg-primary/15"
                          : "text-muted-foreground/40 hover:text-foreground hover:bg-muted/40"
                      }`}
                    >
                      {focusMode ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
                    </motion.button>
                  </div>
                </div>
              </div>
            </div>

            </div>
            )}{/* /resizable-top-header */}
            {/* Top row-resize handle */}
            <div
              className="h-[5px] flex-shrink-0 cursor-row-resize group relative select-none"
              onMouseDown={handleTopDividerMouseDown}
              data-testid="thread-top-divider"
              title="Drag to resize"
            >
              <div className="h-px w-full bg-border/50 group-hover:bg-primary/50 group-active:bg-primary transition-colors absolute top-1/2 -translate-y-1/2" />
            </div>

            {/* Messages in thread — bottom padding so last message is not hidden under FAB */}
            <div className={`flex-1 overflow-y-auto overflow-x-hidden pb-36 lg:pb-24 transition-[padding] duration-300 ${focusMode ? "pt-8 px-4 sm:px-6" : `${densityClasses.readerThreadPt} ${densityClasses.readerThreadPx}`}`}>
            <div className={`transition-[max-width] duration-300 ${focusMode ? "space-y-6 max-w-3xl mx-auto w-full" : densityClasses.readerThreadGap}`}>
              {threadQuery.isLoading && (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="border border-border/50 rounded-lg p-4 space-y-2">
                      <Skeleton className="h-4 w-1/3" />
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  ))}
                </div>
              )}
              {displayMessages.map((msg, idx) => {
                const resolvedSenderName = parseSenderName(msg.from) || parseSenderEmail(msg.from) || "Unknown";
                const initials = resolvedSenderName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
                const isLatest = idx === 0;
                return (
                  <div
                    key={msg.id}
                    className={`rounded-xl border overflow-hidden transition-shadow ${
                      isLatest ? "border-border/60 shadow-sm" : "border-border/30"
                    }`}
                    data-testid={`email-message-${msg.id}`}
                  >
                    {/* Message header — premium sender card */}
                    <div className={`bg-gradient-to-b from-card/55 to-card/15 ${densityClasses.msgHeaderPx} ${densityClasses.msgHeaderPy} border-b border-border/25`}>
                      <div className="flex items-start gap-3.5">
                        {/* Avatar — deterministic gradient */}
                        <div
                          className={`${densityClasses.msgAvatar} rounded-full bg-gradient-to-br ${avatarColor(parseSenderEmail(msg.from))} text-white flex items-center justify-center ${densityClasses.msgAvatarText} font-bold flex-shrink-0 shadow-md ring-1 ring-black/5 select-none`}
                          data-testid={`avatar-sender-${msg.id}`}
                          title={resolvedSenderName}
                        >
                          {initials || "?"}
                        </div>
                        <div className="flex-1 min-w-0 pt-0.5">
                          <div className="flex items-baseline justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => toggleSenderEmail(msg.id)}
                              className={`font-semibold ${densityClasses.msgSenderText} text-foreground leading-tight tracking-[-0.005em] truncate text-left hover:text-primary transition-colors cursor-pointer`}
                              data-testid={`text-sender-${msg.id}`}
                            >
                              {resolvedSenderName}
                              {shownSenderEmailIds.has(msg.id) && parseSenderEmail(msg.from) && (
                                <span className="ml-1.5 font-normal text-[11px] text-muted-foreground tracking-normal">
                                  &lt;{parseSenderEmail(msg.from)}&gt;
                                </span>
                              )}
                            </button>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <span
                                className="text-[11px] text-muted-foreground/70 whitespace-nowrap tabular-nums font-medium"
                                title={(() => {
                                  const d = msg.date ? new Date(msg.date) : msg.internalDate ? new Date(Number(msg.internalDate)) : null;
                                  return d && !isNaN(d.getTime()) ? d.toLocaleString() : "";
                                })()}
                                data-testid={`text-message-date-${msg.id}`}
                              >
                                {formatMessageHeaderDate(msg.date, msg.internalDate)}
                              </span>
                            </div>
                          </div>
                          <div className="text-[11px] text-muted-foreground/50 mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                            <RecipientList label="To" raw={msg.to} />
                            <RecipientList label="Cc" raw={msg.cc} />
                          </div>
                        </div>
                      </div>
                    </div>
                    {/* Spark-style rich calendar invite block + message body.
                        The ics attachment id is resolved once here and forwarded
                        to both CalendarInviteCard (RSVP buttons) and MessageBody
                        (iframe RSVP link interceptor) so both surfaces respond
                        in-app without opening Google Calendar in a new tab. */}
                    {(() => {
                      // Pick the first text/calendar attachment with a Gmail
                      // attachmentId we can actually fetch. Skipping rows without
                      // `downloadable` avoids spinner-then-error on inline parts.
                      const ics = (msg.attachments || []).find(
                        (a) =>
                          a.id != null && a.downloadable !== false && (
                            (a.mimeType || "").toLowerCase().startsWith("text/calendar") ||
                            (a.filename || "").toLowerCase().endsWith(".ics")
                          )
                      );
                      return (
                        <>
                          {ics?.id != null && (
                            <CalendarInviteCard attachmentId={ics.id} messageKey={msg.id} />
                          )}
                          {/* Message body — for the LATEST message in the thread we
                              inject a rich-text formatting toolbar (Bold / Italic /
                              Lists / Link / Clear) into MessageBody's headerLeft
                              slot. Tapping any button auto-opens the reply composer
                              and dispatches the format event onto the global bus
                              which the composer textarea subscribes to. */}
                          <div className={`bg-background/30 ${focusMode ? "px-6 py-7 md:px-8 md:py-9" : `${densityClasses.msgBodyPx} ${densityClasses.msgBodyPy}`}`}>
                            <MessageBody
                              body={msg.body}
                              isHtml={msg.isHtml}
                              gmailMessageId={msg.gmailMessageId || msg.id}
                              calendarAttachmentId={ics?.id}
                              headerLeft={isLatest && canSend ? (
                                <EmailFormatToolbar
                                  onBeforeFormat={() => {
                                    // Open the reply composer (idempotent — does
                                    // nothing if already open) so the textarea is
                                    // mounted and ready to receive the format
                                    // event fired right after.
                                    if (!replyTo || replyTo.threadId !== msg.threadId) {
                                      handleReply(msg);
                              }
                            }}
                          />
                        ) : undefined}
                            />
                          </div>
                        </>
                      );
                    })()}
                    {/* Attachment strip (Phase 2E) — bigger & grid-laid in Focus Mode */}
                    {Array.isArray((msg as any).attachments) && (msg as any).attachments.filter((a: any) => !a.isInline && !a.contentId).length > 0 && (
                      <div className={`bg-background/30 border-t border-border/20 ${focusMode ? "px-6 md:px-8 pb-6 pt-4" : "px-5 pb-4 pt-1"}`}>
                        <div className={`uppercase tracking-wider text-muted-foreground/60 ${focusMode ? "text-[11px] mb-3 font-semibold" : "text-[10px] mb-2"}`}>
                          {(msg as any).attachments.filter((a: any) => !a.isInline && !a.contentId).length} attachment{(msg as any).attachments.filter((a: any) => !a.isInline && !a.contentId).length === 1 ? "" : "s"}
                        </div>
                        <div className={focusMode ? "grid grid-cols-1 sm:grid-cols-2 gap-2.5" : "flex flex-wrap gap-2"}>
                          {(msg as any).attachments.filter((a: any) => !a.isInline && !a.contentId).map((a: any, i: number) => {
                            // Clickable only when we have a DB id AND Gmail has fetchable bytes
                            // for it (downloadable=true means gmail_attachment_id IS NOT NULL).
                            // Without that guard, some inline-but-not-isInline parts would
                            // render as broken download links that 502 from /download.
                            const canDownload = a.id != null && a.downloadable !== false;
                            const downloadUrl = canDownload ? `/api/gmail/attachments/${a.id}/download` : null;
                            const isCalendar = (a.mimeType || "").toLowerCase().startsWith("text/calendar")
                              || (a.filename || "").toLowerCase().endsWith(".ics");
                            const sharedClass = `flex items-center bg-card/60 border border-border/40 rounded-md transition-colors ${focusMode ? "gap-3 px-3.5 py-3 text-[13px] shadow-sm" : "gap-2 px-2.5 py-1.5 text-xs"} ${downloadUrl ? "hover:border-primary/55 hover:bg-card/90 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" : "opacity-50 cursor-default select-none"}`;
                            const titleAttr = `${a.mimeType} • ${a.sizeBytes ? Math.round(a.sizeBytes/1024) + " KB" : "size unknown"}${downloadUrl ? " — click to download" : " — inline attachment (not downloadable)"}`;
                            const inner = (
                              <>
                                <div className={`flex items-center justify-center rounded-md flex-shrink-0 ${isCalendar ? "bg-blue-500/10 text-blue-500" : "bg-primary/10 text-primary"} ${focusMode ? "h-9 w-9" : ""}`}>
                                  {isCalendar
                                    ? <CalendarClock className={focusMode ? "h-4 w-4" : "h-3 w-3"} />
                                    : <Paperclip className={focusMode ? "h-4 w-4" : "h-3 w-3 text-muted-foreground"} />
                                  }
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className={`truncate font-medium ${focusMode ? "max-w-none text-foreground" : "max-w-[260px]"}`}>{a.filename}</div>
                                  {focusMode && (
                                    <div className="text-[11px] text-muted-foreground/70 tabular-nums mt-0.5">
                                      {a.sizeBytes ? `${Math.round(a.sizeBytes/1024)} KB` : ""}{a.mimeType ? ` · ${a.mimeType.split("/")[1] || a.mimeType}` : ""}
                                    </div>
                                  )}
                                </div>
                                {!focusMode && (
                                  <span className="text-muted-foreground/60 tabular-nums flex items-center gap-1">
                                    {a.sizeBytes ? `${Math.round(a.sizeBytes/1024)} KB` : ""}
                                    {downloadUrl && <Download className="h-3 w-3 text-muted-foreground/70" />}
                                  </span>
                                )}
                              </>
                            );
                            return downloadUrl ? (
                              <a
                                key={i}
                                href={downloadUrl}
                                download={a.filename}
                                data-testid={`chip-attachment-${msg.id}-${i}`}
                                className={sharedClass}
                                title={titleAttr}
                              >
                                {inner}
                              </a>
                            ) : (
                              <div
                                key={i}
                                data-testid={`chip-attachment-${msg.id}-${i}`}
                                className={sharedClass}
                                title={titleAttr}
                                aria-hidden="true"
                              >
                                {inner}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            </div>
            {/* Bottom row-resize handle */}
            <div
              className="h-[5px] flex-shrink-0 cursor-row-resize group relative select-none"
              onMouseDown={handleBottomDividerMouseDown}
              data-testid="thread-bottom-divider"
              title="Drag to resize"
            >
              <div className="h-px w-full bg-border/50 group-hover:bg-primary/50 group-active:bg-primary transition-colors absolute top-1/2 -translate-y-1/2" />
            </div>
            {/* Resizable bottom panel (reply bar + CRM) */}
            {!bottomExpanded && (
              <div
                ref={bottomPanelRef}
                className="flex-shrink-0 h-10 flex items-center gap-2 border-t border-border/20 bg-card/15 px-3"
                data-testid="thread-bottom-mini"
              >
                {canSend && focusedMsg && (
                  <>
                    <button
                      onClick={() => { setBottomExpanded(true); handleReply(focusedMsg); }}
                      className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground/60 hover:text-primary transition-colors rounded-full px-2.5 py-1 hover:bg-primary/10"
                    >
                      <Reply className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="truncate">Reply to {parseSenderName(focusedMsg.from)}</span>
                    </button>
                    <span className="text-muted-foreground/20 text-xs select-none">·</span>
                    <button
                      onClick={() => { setBottomExpanded(true); handleReplyAll(focusedMsg); }}
                      className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground/60 hover:text-primary transition-colors rounded-full px-2 py-1 hover:bg-primary/10 flex-shrink-0"
                    >
                      <ReplyAll className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="hidden sm:inline">Reply All</span>
                    </button>
                    <span className="text-muted-foreground/20 text-xs select-none">·</span>
                    <button
                      onClick={() => { setBottomExpanded(true); handleForward(focusedMsg); }}
                      data-testid="button-forward-mini"
                      className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground/60 hover:text-primary transition-colors rounded-full px-2 py-1 hover:bg-primary/10 flex-shrink-0"
                    >
                      <Forward className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="hidden sm:inline">Forward</span>
                    </button>
                    <span className="text-muted-foreground/20 text-xs select-none">·</span>
                    <button
                      onClick={() => setNewLeadDialogOpen(true)}
                      data-testid="button-new-lead-mini"
                      title="Create a new CRM lead from this email sender"
                      className="flex items-center gap-1.5 text-[11.5px] text-amber-400/70 hover:text-amber-300 transition-colors rounded-full px-2 py-1 hover:bg-amber-500/10 flex-shrink-0"
                    >
                      <Building2 className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="hidden sm:inline">New Lead</span>
                    </button>
                  </>
                )}
                <button
                  onClick={() => setBottomExpanded(true)}
                  className="ml-auto flex items-center gap-1 text-[10.5px] text-muted-foreground/35 hover:text-muted-foreground/60 transition-colors"
                  title="Expand footer"
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
              </div>
            )}
            {bottomExpanded && (
            <div ref={bottomPanelRef} className="flex-shrink-0">
            {/* Sticky reply bar */}
            {canSend && focusedMsg && (
              <div className={`flex-shrink-0 border-t border-border/30 transition-colors duration-300 ${focusMode ? "bg-gradient-to-t from-card/40 to-card/10 backdrop-blur-sm shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.4)]" : "bg-card/20"}`}>
                <div className={`flex items-center gap-2 transition-[max-width,padding] duration-300 ${focusMode ? "max-w-3xl mx-auto w-full px-4 sm:px-6 py-3" : `${densityClasses.replyBarPx} ${densityClasses.replyBarPy}`}`}>
                  <button
                    onClick={() => handleReply(focusedMsg)}
                    data-testid="button-reply-bar"
                    className="flex-1 flex items-center gap-2.5 px-3.5 py-2 rounded-full border border-border/40 bg-background/60 text-[13px] text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-background transition-all text-left group"
                  >
                    <Reply className="h-3.5 w-3.5 flex-shrink-0 group-hover:text-primary transition-colors" />
                    <span>Reply to <span className="font-medium">{parseSenderName(focusedMsg.from)}</span>…</span>
                  </button>
                  <button
                    onClick={() => handleReplyAll(focusedMsg)}
                    data-testid="button-reply-all-bar"
                    title="Reply All"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-border/40 bg-background/60 text-[12px] text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-background transition-all group flex-shrink-0"
                  >
                    <ReplyAll className="h-3.5 w-3.5 group-hover:text-primary transition-colors" />
                    <span className="hidden sm:inline">Reply All</span>
                  </button>
                  <button
                    onClick={() => handleForward(focusedMsg)}
                    data-testid="button-forward-bar"
                    title="Forward"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-border/40 bg-background/60 text-[12px] text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-background transition-all group flex-shrink-0"
                  >
                    <Forward className="h-3.5 w-3.5 group-hover:text-primary transition-colors" />
                    <span className="hidden sm:inline">Forward</span>
                  </button>
                  <button
                    onMouseDown={() => {
                      // Capture any text the user has highlighted inside the email
                      // iframe BEFORE mousedown shifts focus away and clears it.
                      const iframeDoc = iframeRef.current?.contentDocument;
                      const sel = iframeDoc?.getSelection?.();
                      setSmartContactSelectedText(sel?.toString().trim() ?? "");
                    }}
                    onClick={() => setSmartContactOpen(true)}
                    data-testid="button-smart-add-contact"
                    title="Smart Add Contact — AI extracts contact info from this email (highlight text first to scan only that selection)"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-border/40 bg-background/60 text-[12px] text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-background transition-all group flex-shrink-0"
                  >
                    <UserPlus className="h-3.5 w-3.5 group-hover:text-primary transition-colors" />
                    <span className="hidden sm:inline">Add Contact</span>
                  </button>
                  <button
                    onClick={() => setNewLeadDialogOpen(true)}
                    data-testid="button-new-lead-from-email"
                    title="Create a new CRM lead from this email sender"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-amber-500/30 bg-amber-500/8 text-[12px] text-amber-400/80 hover:border-amber-500/60 hover:text-amber-300 hover:bg-amber-500/15 transition-all group flex-shrink-0"
                  >
                    <Building2 className="h-3.5 w-3.5 transition-colors" />
                    <span className="hidden sm:inline">New Lead</span>
                  </button>
                  <span className="text-[10px] text-muted-foreground/35 font-mono hidden lg:block">r</span>
                </div>
              </div>
            )}
            {/* CRM Context Panel — hidden in Focus Mode for distraction-free reading */}
            {!focusMode && (
              <CrmContextPanel key={selectedThreadId} threadId={selectedThreadId!} userPermissions={userPermissions} isAdminUser={isAdmin} returnPath={returnPath} hintSenderEmail={focusedMsg ? parseSenderEmail(focusedMsg.from) : undefined} hintSenderName={focusedMsg ? parseSenderName(focusedMsg.from) : undefined} hintSubject={focusedMsg?.subject ?? undefined} />
            )}
            </div>
            )}{/* /resizable-bottom-panel */}
          </div>
          );
        })()}

        {/* Empty state when no message selected — premium */}
        {!selectedThreadId && tab !== "drafts" && tab !== "scheduled" && (
          <div className="hidden md:flex flex-1 items-center justify-center text-muted-foreground bg-gradient-to-br from-background via-background to-card/20">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="text-center space-y-7 max-w-sm"
            >
              <div className="relative">
                <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/5 via-violet-500/5 to-transparent rounded-full blur-3xl" />
                <div className="relative inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 ring-1 ring-primary/15">
                  <InboxIcon className="h-7 w-7 text-primary/70" />
                </div>
                <p className="text-[15px] font-medium text-foreground/80 mt-4">Your inbox is ready</p>
                <p className="text-[12.5px] text-muted-foreground/55 mt-1">Select a conversation to start reading.</p>
              </div>
              <div className="space-y-2.5 pt-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/40">Keyboard shortcuts</p>
                <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-[11px] text-muted-foreground/55 text-left">
                  {[
                    ["j / ↓", "Next email"],
                    ["k / ↑", "Prev email"],
                    ["r", "Reply"],
                    ["c", "Compose"],
                    ["s", "Star / unstar"],
                    ["Esc", "Deselect"],
                  ].map(([key, desc]) => (
                    <div key={key} className="flex items-center gap-2">
                      <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded-md bg-muted/60 border border-border/40 text-muted-foreground/75 shadow-sm">{key}</kbd>
                      <span>{desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        )}
        </div>
      </div>

      {/* Smart Add Contact dialog */}
      {focusedMsg && (
        <SmartAddContactDialog
          open={smartContactOpen}
          onClose={() => { setSmartContactOpen(false); setSmartContactSelectedText(""); }}
          fromName={parseSenderName(focusedMsg.from)}
          fromEmail={parseSenderEmail(focusedMsg.from)}
          subject={focusedMsg.subject || ""}
          body={focusedMsg.body || ""}
          selectedText={smartContactSelectedText}
        />
      )}

      {/* New Lead from Email dialog */}
      {focusedMsg && (
        <NewLeadFromEmailDialog
          open={newLeadDialogOpen}
          onClose={() => setNewLeadDialogOpen(false)}
          fromName={parseSenderName(focusedMsg.from)}
          fromEmail={parseSenderEmail(focusedMsg.from)}
          subject={focusedMsg.subject || ""}
          existingCrm={{
            lead:    readerThreadRecordQuery.data?.lead,
            contact: readerThreadRecordQuery.data?.contact,
            account: readerThreadRecordQuery.data?.account,
          }}
        />
      )}

      {/* Snippets Manager dialog */}
      <SnippetsManagerDialog
        open={snippetsManagerOpen}
        onClose={() => setSnippetsManagerOpen(false)}
        activeContact={
          readerThreadRecordQuery.data?.contact
            ? {
                firstName:   readerThreadRecordQuery.data.contact.firstName,
                lastName:    readerThreadRecordQuery.data.contact.lastName,
                companyName: readerThreadRecordQuery.data.account?.name,
              }
            : readerThreadRecordQuery.data?.lead
            ? {
                firstName:   readerThreadRecordQuery.data.lead.firstName,
                lastName:    readerThreadRecordQuery.data.lead.lastName,
                companyName: readerThreadRecordQuery.data.lead.company,
              }
            : null
        }
      />

      {/* Command Bar (⌘K) — search & commands */}
      <CommandDialog open={cmdkOpen} onOpenChange={setCmdkOpen}>
        <CommandInput placeholder="Search threads, contacts, mailboxes, snippets, commands…" data-testid="input-cmdk" />
        <CommandList className="max-h-[60vh]">
          <CommandEmpty>No results found.</CommandEmpty>

          {/* Commands */}
          <CommandGroup heading="Commands">
            {canSend && (
              <CommandItem
                value="compose new email message"
                onSelect={() => { setCmdkOpen(false); setReplyTo(null); setComposeOpen(true); }}
                data-testid="cmdk-compose"
              >
                <Pencil className="mr-2 h-4 w-4" />
                <span>Compose new email</span>
                <kbd className="ml-auto text-[10px] text-muted-foreground/60 font-mono">C</kbd>
              </CommandItem>
            )}
            <CommandItem
              value="refresh inbox sync"
              onSelect={() => {
                setCmdkOpen(false);
                queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
                queryClient.invalidateQueries({ queryKey: ["/api/gmail/threads"] });
              }}
              data-testid="cmdk-refresh"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              <span>Refresh inbox</span>
            </CommandItem>
            <CommandItem
              value="sync to crm"
              onSelect={() => { setCmdkOpen(false); syncMutation.mutate(); }}
              data-testid="cmdk-sync-crm"
            >
              <Link2 className="mr-2 h-4 w-4" />
              <span>Sync to CRM</span>
            </CommandItem>
            {selectedThreadId && (
              <CommandItem
                value="toggle focus mode reader"
                onSelect={() => { setCmdkOpen(false); setFocusMode((v) => !v); }}
                data-testid="cmdk-focus-mode"
              >
                {focusMode ? <Minimize2 className="mr-2 h-4 w-4" /> : <Maximize2 className="mr-2 h-4 w-4" />}
                <span>{focusMode ? "Exit Focus Mode" : "Enter Focus Mode"}</span>
                <kbd className="ml-auto text-[10px] text-muted-foreground/60 font-mono">F</kbd>
              </CommandItem>
            )}
            <CommandItem
              value="density comfortable comfy"
              onSelect={() => { setCmdkOpen(false); setDensity("comfortable"); }}
              data-testid="cmdk-density-comfortable"
            >
              <Rows3 className="mr-2 h-4 w-4" />
              <span>Density: Comfortable</span>
              {density === "comfortable" && <CheckCheck className="ml-auto h-3.5 w-3.5 text-primary" />}
            </CommandItem>
            <CommandItem
              value="density compact"
              onSelect={() => { setCmdkOpen(false); setDensity("compact"); }}
              data-testid="cmdk-density-compact"
            >
              <Rows2 className="mr-2 h-4 w-4" />
              <span>Density: Compact</span>
              {density === "compact" && <CheckCheck className="ml-auto h-3.5 w-3.5 text-primary" />}
            </CommandItem>
            <CommandItem
              value="density ultra dense"
              onSelect={() => { setCmdkOpen(false); setDensity("ultra"); }}
              data-testid="cmdk-density-ultra"
            >
              <AlignJustify className="mr-2 h-4 w-4" />
              <span>Density: Ultra compact</span>
              {density === "ultra" && <CheckCheck className="ml-auto h-3.5 w-3.5 text-primary" />}
            </CommandItem>
            <CommandItem
              value="manage snippets templates"
              onSelect={() => { setCmdkOpen(false); setSnippetsManagerOpen(true); }}
              data-testid="cmdk-manage-snippets"
            >
              <StickyNote className="mr-2 h-4 w-4" />
              <span>Manage snippets &amp; templates</span>
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          {/* Filters / Tabs */}
          <CommandGroup heading="Filters">
            {([
              { key: "inbox" as const,     label: "Inbox",     icon: Inbox },
              { key: "sent" as const,      label: "Sent",      icon: Send },
              { key: "drafts" as const,    label: "Drafts",    icon: FileText },
              { key: "scheduled" as const, label: "Scheduled", icon: CalendarClock },
              { key: "other" as const,     label: "Other",     icon: Newspaper },
              { key: "review" as const,    label: "Review",    icon: ShieldCheck },
            ]).map((t) => (
              <CommandItem
                key={t.key}
                value={`go to ${t.label.toLowerCase()} folder`}
                onSelect={() => { setCmdkOpen(false); setTab(t.key); setSelectedMessageId(null); setSelectedThreadId(null); }}
                data-testid={`cmdk-tab-${t.key}`}
              >
                <t.icon className="mr-2 h-4 w-4" />
                <span>Go to {t.label}</span>
                {tab === t.key && <CheckCheck className="ml-auto h-3.5 w-3.5 text-primary" />}
              </CommandItem>
            ))}
          </CommandGroup>

          {/* Mailboxes */}
          {(accountsQuery.data?.length ?? 0) > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Mailboxes">
                {accountsQuery.data!.map((acct) => (
                  <CommandItem
                    key={acct.id}
                    value={`mailbox ${acct.displayName ?? ""} ${acct.emailAddress}`}
                    onSelect={() => {
                      setCmdkOpen(false);
                      setActiveAccountId(acct.id);
                      setTab("inbox");
                      setSelectedMessageId(null);
                      setSelectedThreadId(null);
                    }}
                    data-testid={`cmdk-mailbox-${acct.id}`}
                  >
                    <AtSign className="mr-2 h-4 w-4" />
                    <span className="truncate">{acct.displayName || acct.emailAddress}</span>
                    {acct.isShared && <Badge variant="outline" className="ml-2 text-[9px] h-4">Shared</Badge>}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {/* Folders */}
          {(foldersQuery.data?.length ?? 0) > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Folders">
                {foldersQuery.data!.slice(0, 10).map((f) => (
                  <CommandItem
                    key={f.id}
                    value={`folder ${f.name}`}
                    onSelect={() => {
                      setCmdkOpen(false);
                      setTab("folder");
                      setSelectedFolderId(f.id);
                      setSelectedThreadId(null);
                      setSelectedMessageId(null);
                    }}
                    data-testid={`cmdk-folder-${f.id}`}
                  >
                    <Folder className="mr-2 h-4 w-4" />
                    <span className="truncate">{f.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {/* Threads — filtered against active list */}
          {activeMessages.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Threads in current view">
                {activeMessages.slice(0, 25).map((m) => (
                  <CommandItem
                    key={m.id}
                    value={`${m.subject || "(no subject)"} ${parseSenderName(m.from)} ${parseSenderEmail(m.from)} ${m.snippet || ""}`}
                    onSelect={() => { setCmdkOpen(false); handleSelectMessage(m); }}
                    data-testid={`cmdk-thread-${m.id}`}
                  >
                    <Mail className="mr-2 h-4 w-4 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[12.5px] font-medium truncate">{parseSenderName(m.from)}</span>
                        <span className="text-[10px] text-muted-foreground/55 tabular-nums flex-shrink-0">{formatDate(m.date, m.internalDate)}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground/70 truncate">{m.subject || "(no subject)"}</div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {/* Contacts — derived from active messages, deduped */}
          {(() => {
            const seen = new Map<string, { name: string; email: string }>();
            for (const m of activeMessages) {
              const email = parseSenderEmail(m.from).toLowerCase();
              if (email && !seen.has(email)) seen.set(email, { name: parseSenderName(m.from), email });
              if (seen.size >= 12) break;
            }
            const contacts = Array.from(seen.values());
            if (contacts.length === 0) return null;
            return (
              <>
                <CommandSeparator />
                <CommandGroup heading="Contacts">
                  {contacts.map((c) => (
                    <CommandItem
                      key={c.email}
                      value={`contact ${c.name} ${c.email}`}
                      onSelect={() => {
                        setCmdkOpen(false);
                        if (canSend) {
                          setReplyTo(null);
                          setEditingDraft(null);
                          setComposeInitial({ to: c.email });
                          setComposeOpen(true);
                        }
                      }}
                      data-testid={`cmdk-contact-${c.email}`}
                    >
                      <User className="mr-2 h-4 w-4" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] font-medium truncate">{c.name || c.email}</div>
                        <div className="text-[11px] text-muted-foreground/65 truncate font-mono">{c.email}</div>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            );
          })()}

          {/* Snippets — quick-insert into compose */}
          {snippets.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Snippets">
                {snippets.map((s) => (
                  <CommandItem
                    key={s.id}
                    value={`snippet ${s.name} ${s.body}`}
                    onSelect={() => {
                      setCmdkOpen(false);
                      if (canSend) {
                        setReplyTo(null);
                        setEditingDraft(null);
                        setComposeInitial({ body: s.body });
                        setComposeOpen(true);
                      }
                    }}
                    data-testid={`cmdk-snippet-${s.id}`}
                  >
                    <StickyNote className="mr-2 h-4 w-4" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] font-medium truncate">{s.name}</div>
                      <div className="text-[11px] text-muted-foreground/65 truncate">{s.body.replace(/\s+/g, " ").slice(0, 70)}</div>
                    </div>
                    <span className="text-[9.5px] text-muted-foreground/45 ml-2">Insert into draft</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>

      {/* Compose / Reply / Forward dialog */}
      <ComposeDialog
        key={editingDraft?.draftId ?? (replyTo ? `reply-${replyTo.threadId}` : composeInitial?.isForward ? `fwd-${composeInitial.subject}` : "compose")}
        open={composeOpen || !!replyTo || !!editingDraft || !!composeInitial}
        onClose={() => { setComposeOpen(false); setReplyTo(null); setEditingDraft(null); setComposeInitial(null); }}
        canSend={canSend}
        defaultTo={editingDraft?.to || replyTo?.to || composeInitial?.to || ""}
        defaultCc={editingDraft?.cc || replyTo?.cc || composeInitial?.cc || ""}
        defaultBcc={editingDraft?.bcc || ""}
        defaultSubject={editingDraft?.subject || replyTo?.subject || composeInitial?.subject || ""}
        defaultBody={editingDraft?.body || composeInitial?.body || ""}
        draftId={editingDraft?.draftId}
        threadId={editingDraft?.threadId || replyTo?.threadId}
        asAccountId={typeof activeAccountId === "number" ? activeAccountId : undefined}
        replyToSender={replyTo?.fromName}
        defaultQuotedHtml={replyTo?.quotedHtml || composeInitial?.quotedHtml || ""}
        defaultQuotedFrom={replyTo?.quotedFrom || composeInitial?.quotedFrom || ""}
        defaultQuotedDate={replyTo?.quotedDate || composeInitial?.quotedDate || ""}
        isForward={!!composeInitial?.isForward}
        forwardSubject={composeInitial?.forwardSubject || ""}
        forwardTo={composeInitial?.forwardTo || ""}
        onTrustEvent={handleTrustEvent}
      />

      {/* Create Folder dialog */}
      <Dialog open={showCreateFolder} onOpenChange={(v) => !v && setShowCreateFolder(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderPlus className="h-5 w-5 text-teal-400" />
              Create Inbox Folder
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label htmlFor="folder-name" className="text-sm font-medium">Folder Name</Label>
              <Input
                id="folder-name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="e.g. NMMA, Investors, Media"
                className="mt-1"
                data-testid="input-new-folder-name"
              />
            </div>
            <div>
              <Label htmlFor="folder-domains" className="text-sm font-medium">Domains</Label>
              <p className="text-xs text-muted-foreground mb-1">
                Emails from these domains will be automatically sorted into this folder. Separate multiple with commas or new lines.
              </p>
              <Textarea
                id="folder-domains"
                value={newFolderDomainInput}
                onChange={(e) => setNewFolderDomainInput(e.target.value)}
                placeholder="e.g. nmma.org, events.nmma.org"
                className="mt-1 h-20 text-sm"
                data-testid="input-new-folder-domains"
              />
              <p className="text-xs text-muted-foreground mt-1">Subdomains match automatically (e.g. nmma.org also matches events.nmma.org)</p>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setShowCreateFolder(false)} data-testid="button-cancel-create-folder">Cancel</Button>
              <Button
                disabled={!newFolderName.trim() || createFolderMutation.isPending}
                onClick={() => {
                  const domains = newFolderDomainInput
                    .split(/[\n,]+/)
                    .map(d => d.trim())
                    .filter(Boolean);
                  createFolderMutation.mutate({ name: newFolderName.trim(), domains });
                }}
                data-testid="button-confirm-create-folder"
              >
                {createFolderMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Folder"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Folder Settings dialog */}
      {showFolderSettings && (() => {
        const folder = (foldersQuery.data || []).find(f => f.id === showFolderSettings);
        if (!folder) return null;
        return (
          <Dialog open={true} onOpenChange={(v) => !v && setShowFolderSettings(null)}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Folder className="h-5 w-5 text-teal-400" />
                  {folder.name} — Folder Settings
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-5 pt-2">
                {/* Domain rules */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium">Domain Rules</p>
                    <span className="text-xs text-muted-foreground">{folder.domains.length} rule{folder.domains.length !== 1 ? "s" : ""}</span>
                  </div>
                  {folder.domains.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No domains yet. Emails won't be sorted until you add one.</p>
                  ) : (
                    <div className="space-y-1">
                      {folder.domains.map(d => (
                        <div key={d.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-muted/40 group" data-testid={`domain-rule-${d.id}`}>
                          <Globe className="h-3.5 w-3.5 text-teal-500/70 flex-shrink-0" />
                          <span className="text-sm flex-1 font-mono">{d.domain}</span>
                          <span className="text-xs text-muted-foreground">{d.matchType === "ends_with" ? "& subdomains" : "exact"}</span>
                          <button
                            onClick={() => removeDomainMutation.mutate({ folderId: folder.id, domainId: d.id })}
                            disabled={removeDomainMutation.isPending}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                            data-testid={`button-remove-domain-${d.id}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Add domain */}
                  {editingDomainFolderId === folder.id ? (
                    <div className="flex gap-2 mt-2">
                      <Input
                        value={addDomainInput}
                        onChange={(e) => setAddDomainInput(e.target.value)}
                        placeholder="e.g. nmma.org"
                        className="h-8 text-sm flex-1"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && addDomainInput.trim()) {
                            addDomainMutation.mutate({ folderId: folder.id, domain: addDomainInput.trim() });
                          }
                          if (e.key === "Escape") { setEditingDomainFolderId(null); setAddDomainInput(""); }
                        }}
                        autoFocus
                        data-testid="input-add-domain"
                      />
                      <Button
                        size="sm"
                        disabled={!addDomainInput.trim() || addDomainMutation.isPending}
                        onClick={() => addDomainMutation.mutate({ folderId: folder.id, domain: addDomainInput.trim() })}
                        data-testid="button-confirm-add-domain"
                      >
                        {addDomainMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setEditingDomainFolderId(null); setAddDomainInput(""); }}>Cancel</Button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setEditingDomainFolderId(folder.id)}
                      className="mt-2 flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                      data-testid="button-add-domain"
                    >
                      <Plus className="h-3 w-3" /> Add domain
                    </button>
                  )}
                </div>

                {/* Reprocess */}
                <div className="border-t border-border/30 pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">Reprocess Existing Emails</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Scan all your past emails and assign any that match the domain rules above to this folder.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={backfillMutation.isPending}
                      onClick={() => backfillMutation.mutate(folder.id)}
                      data-testid="button-reprocess-folder"
                    >
                      {backfillMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      <span className="ml-1.5">Reprocess</span>
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    <span className="font-medium">{folder.emailCount}</span> email{folder.emailCount !== 1 ? "s" : ""} currently in this folder.
                  </p>
                </div>

                {/* Danger zone */}
                <div className="border-t border-border/30 pt-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-destructive/80">Delete Folder</p>
                    <p className="text-xs text-muted-foreground">Emails are not deleted, only the folder and domain rules.</p>
                  </div>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => deleteFolderMutation.mutate(folder.id)}
                    disabled={deleteFolderMutation.isPending}
                    data-testid="button-delete-folder"
                  >
                    {deleteFolderMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    <span className="ml-1.5">Delete</span>
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* ── Domain Auto-Link Rules dialog ────────────────────────────── */}
      <Dialog open={showAutoLinkRules} onOpenChange={setShowAutoLinkRules}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Domain Auto-Link Rules
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground leading-relaxed">
            When an email arrives from a matching domain, it is automatically linked to the CRM record without going through the review queue.
          </p>

          {/* Existing rules */}
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {autoLinkRulesQuery.isLoading && (
              <div className="flex items-center gap-2 py-4 justify-center text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading rules…
              </div>
            )}
            {!autoLinkRulesQuery.isLoading && (autoLinkRulesQuery.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground/60 text-center py-4">No rules yet. Add one below.</p>
            )}
            {(autoLinkRulesQuery.data ?? []).map((rule) => (
              <div key={rule.id} className="flex items-center gap-2 px-3 py-2 rounded border border-border/40 bg-muted/20">
                <AtSign className="h-3.5 w-3.5 text-primary/60 shrink-0" />
                <span className="text-sm font-mono text-foreground/80 truncate flex-1">{rule.domain}</span>
                <span className="text-xs text-muted-foreground/60 shrink-0">→</span>
                <span className="text-xs text-muted-foreground truncate max-w-[130px]">{rule.object_name ?? `${rule.object_type} #${rule.object_id}`}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary/70 font-medium capitalize shrink-0">{rule.object_type}</span>
                <button
                  onClick={() => deleteRuleMutation.mutate(rule.id)}
                  disabled={deleteRuleMutation.isPending}
                  className="shrink-0 text-muted-foreground/40 hover:text-destructive transition-colors"
                  title="Delete this rule"
                  data-testid={`button-delete-rule-${rule.id}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Add new rule */}
          <div className="border-t border-border/30 pt-4 space-y-3">
            <p className="text-xs font-medium text-foreground/70">Add a new rule</p>
            <div className="flex items-center gap-2">
              <div className="flex items-center border border-border/50 rounded bg-background px-2 py-1 gap-1 flex-1">
                <AtSign className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <input
                  className="text-sm bg-transparent outline-none flex-1 min-w-0 placeholder:text-muted-foreground/50"
                  placeholder="leamington.ca"
                  value={newRuleDomain}
                  onChange={e => setNewRuleDomain(e.target.value.replace(/^@/, ""))}
                  data-testid="input-rule-domain"
                />
              </div>
              <Select value={newRuleObjType} onValueChange={v => setNewRuleObjType(v as any)}>
                <SelectTrigger className="w-[100px] text-xs h-8" data-testid="select-rule-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead">Lead</SelectItem>
                  <SelectItem value="account">Account</SelectItem>
                  <SelectItem value="contact">Contact</SelectItem>
                  <SelectItem value="partner">Partner</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center border border-border/50 rounded bg-background px-2 py-1 gap-1 flex-1">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <input
                  className="text-sm bg-transparent outline-none flex-1 min-w-0 placeholder:text-muted-foreground/50"
                  placeholder="CRM record name (display)"
                  value={newRuleObjName}
                  onChange={e => setNewRuleObjName(e.target.value)}
                  data-testid="input-rule-name"
                />
              </div>
              <div className="flex items-center border border-border/50 rounded bg-background px-2 py-1 gap-1 w-[90px]">
                <Hash className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <input
                  className="text-sm bg-transparent outline-none flex-1 min-w-0 placeholder:text-muted-foreground/50"
                  placeholder="ID"
                  value={newRuleObjId}
                  onChange={e => setNewRuleObjId(e.target.value.replace(/\D/g, ""))}
                  data-testid="input-rule-id"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground/60">
              Tip: You can find the CRM record ID from its detail page URL (e.g. /accounts/<strong>42</strong>).
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowAutoLinkRules(false)}>Close</Button>
              <Button
                size="sm"
                disabled={!newRuleDomain.trim() || !newRuleObjId || !newRuleObjName.trim() || createRuleMutation.isPending}
                onClick={() => createRuleMutation.mutate({
                  domain: newRuleDomain.trim(),
                  objectType: newRuleObjType,
                  objectId: Number(newRuleObjId),
                  objectName: newRuleObjName.trim(),
                })}
                data-testid="button-save-rule"
                className="gap-1.5"
              >
                {createRuleMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                Save Rule
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── FORWARD_REPLY_TRACE panel ───────────────────────────────────────────
           Visible only in dev or when localStorage.FORWARD_REPLY_TRACE='true'.
           Shows every instrumented stage so you can find where content disappears.
           ────────────────────────────────────────────────────────────────────── */}
      {_frtEnabled && <FrtTracePanel events={frtEvents} onClear={() => setFrtEvents([])} />}
    </div>
  );
}

// ── FrtTracePanel — dev-only forward/reply/forward trace panel ─────────────────
// Shows the A→F chain so you can find where a "unique bottom phrase" disappears.
function FrtTracePanel({
  events,
  onClear,
}: {
  events: Array<{ stage: string; ts: number; data: Record<string, any> }>;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const stageColor = (s: string) => {
    if (s.startsWith("A:")) return "#22d3ee";   // cyan  — DB
    if (s.startsWith("B:")) return "#a78bfa";   // purple — thread API
    if (s.startsWith("C:")) return "#86efac";   // green  — click handler
    if (s.startsWith("D:")) return "#fbbf24";   // amber  — compose state
    if (s.startsWith("E:") || s.includes("send")) return "#f472b6"; // pink — network
    if (s.startsWith("F:")) return "#fb923c";   // orange — server
    return "#94a3b8";
  };

  const filtered = search
    ? events.filter(e =>
        e.stage.toLowerCase().includes(search.toLowerCase()) ||
        JSON.stringify(e.data).toLowerCase().includes(search.toLowerCase())
      )
    : events;

  const capsWarning = (d: Record<string, any>) => {
    if (d.atOld4KCap)   return "⚠️ AT 4K TEXT CAP";
    if (d.atOld200KCap) return "⚠️ AT 200K HTML CAP";
    return null;
  };

  return (
    <div style={{
      position: "fixed", bottom: 0, right: 0, zIndex: 99999,
      fontFamily: "monospace", fontSize: "11px",
      maxWidth: open ? "680px" : "200px",
      maxHeight: open ? "420px" : "36px",
      background: "#0f172a", color: "#e2e8f0",
      border: "1px solid #334155", borderRadius: "8px 0 0 0",
      boxShadow: "0 -4px 24px rgba(0,0,0,0.6)",
      overflow: "hidden",
      transition: "max-height 0.2s, max-width 0.2s",
      display: "flex", flexDirection: "column",
    }}>
      {/* Header bar */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "6px 10px", cursor: "pointer",
          background: "#1e293b", borderBottom: "1px solid #334155",
          flexShrink: 0,
        }}
        onClick={() => setOpen((o: boolean) => !o)}
      >
        <span style={{ color: "#22d3ee", fontWeight: "bold" }}>FRT</span>
        <span style={{ color: "#64748b" }}>TRACE</span>
        <span style={{
          marginLeft: 4, background: "#334155", borderRadius: 9,
          padding: "1px 7px", color: "#f472b6",
        }}>{events.length}</span>
        <span style={{ marginLeft: "auto", color: "#475569" }}>{open ? "▼" : "▲"}</span>
      </div>

      {open && (
        <>
          {/* Toolbar */}
          <div style={{
            display: "flex", gap: 6, padding: "4px 8px",
            background: "#1e293b", borderBottom: "1px solid #334155", flexShrink: 0,
          }}>
            <input
              style={{
                flex: 1, background: "#0f172a", border: "1px solid #334155",
                color: "#e2e8f0", borderRadius: 4, padding: "2px 6px", fontSize: 11,
              }}
              placeholder="filter stages or content..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()}
            />
            <button
              style={{
                background: "#334155", border: "none", color: "#94a3b8",
                borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: 11,
              }}
              onClick={e => { e.stopPropagation(); onClear(); }}
            >Clear</button>
          </div>

          {/* Event list */}
          <div style={{ overflow: "auto", flex: 1, padding: "4px 0" }}>
            {filtered.length === 0 && (
              <div style={{ padding: "8px 12px", color: "#475569" }}>
                No events yet. Open a thread and click Reply / Reply-All / Forward.
              </div>
            )}
            {filtered.map((evt, i) => {
              const d = evt.data;
              const len = d.quotedHtmlLen ?? d.htmlLen ?? d.bodyLen ?? d.bodyHtmlLen ?? d.htmlBodyLen ?? d.quotedBlockLen ?? null;
              const warn = capsWarning(d);
              const last200 = d.last200 ?? d.last200Html ?? d.htmlBodyLast200 ?? d.last200Text ?? d.quotedBlockLast200 ?? null;
              return (
                <div key={i} style={{
                  padding: "3px 10px",
                  borderBottom: "1px solid #1e293b",
                  background: warn ? "rgba(251,191,36,0.08)" : undefined,
                }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                    <span style={{
                      color: stageColor(evt.stage), fontWeight: "bold", minWidth: 180,
                    }}>{evt.stage}</span>
                    {len !== null && (
                      <span style={{ color: "#64748b" }}>
                        len=<span style={{ color: "#e2e8f0" }}>{len}</span>
                      </span>
                    )}
                    {warn && <span style={{ color: "#fbbf24", marginLeft: 4 }}>{warn}</span>}
                  </div>
                  {last200 && (
                    <div style={{
                      color: "#94a3b8", marginTop: 1, paddingLeft: 4,
                      wordBreak: "break-all", lineHeight: 1.3,
                    }}>
                      <span style={{ color: "#475569" }}>last200: </span>
                      {String(last200).replace(/<[^>]+>/g, "").slice(-200)}
                    </div>
                  )}
                  {d.source && (
                    <span style={{ color: "#475569", paddingLeft: 4 }}>
                      src=<span style={{ color: "#a78bfa" }}>{d.source}</span>
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div style={{
            display: "flex", gap: 8, padding: "4px 10px",
            background: "#1e293b", borderTop: "1px solid #334155",
            flexShrink: 0, flexWrap: "wrap",
          }}>
            {[
              ["A:", "#22d3ee", "DB fetch"],
              ["C:", "#86efac", "handler"],
              ["D:", "#fbbf24", "compose state"],
              ["E:", "#f472b6", "network"],
              ["F:", "#fb923c", "server"],
            ].map(([prefix, color, label]) => (
              <span key={String(prefix)} style={{ display: "flex", gap: 3, alignItems: "center" }}>
                <span style={{ color: String(color), fontWeight: "bold" }}>{prefix}</span>
                <span style={{ color: "#475569" }}>{label}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
