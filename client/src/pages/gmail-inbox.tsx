import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import {
  Search, Mail, MailOpen, Send, RefreshCw, Inbox, X, ChevronLeft, Loader2, Link2, Ban, FolderX, Trash2,
  Clock, FileText, CalendarClock, CalendarX, Paperclip, Star, Users, Newspaper, Bell, Receipt, Download,
  FolderOpen, FolderPlus, Settings2, Globe, Plus, PlusCircle, ChevronDown, ChevronUp, ChevronRight, Folder,
  Reply, ReplyAll, Pencil, User, Building2, Zap, Flame, Video,
  CheckCircle2, XCircle, TrendingUp, Handshake, ShieldCheck, AlertCircle, Tag, Lock, ExternalLink,
  CheckCheck, ArrowLeft, ArrowUp, ClipboardList, StickyNote, ArchiveX, Square, Filter, Eye,
  Sparkles, Code2, Type, Rows3, Rows2, Inbox as InboxIcon,
  Maximize2, Minimize2, Pin, PinOff, LayoutList, List as ListIcon,
  Command as CommandIcon, AlignJustify, Hash, AtSign, Folders, Zap as ZapIcon,
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
import { EmailFormatToolbar } from "@/components/inbox/email-format-toolbar";
import { RecipientList } from "@/components/inbox/recipient-list";
import { CalendarInviteCard } from "@/components/inbox/calendar-invite-card";
import {
  useSetAside,
  useFormatBus,
  applyFormatToTextarea,
  type FormatEvent,
} from "@/components/inbox/inbox-actions-store";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandSeparator,
} from "@/components/ui/command";
import { useSnippets, SnippetInsertButton, SnippetsManagerDialog } from "@/components/inbox-snippets";
import { useLocation } from "wouter";
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
  to: string;
  subject: string;
  date: string;
  // Multi-mailbox Phase 1: present when fetched in unified ("All Inboxes") mode so the
  // row can render an account badge. Absent in single-account mode.
  sourceAccountId?: number;
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
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
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
  const match = from.match(/^"?([^"<]+)"?\s*<[^>]+>$/);
  return match ? match[1].trim() : from.replace(/<[^>]+>/, "").trim() || from;
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
type InboxCategory = "all" | "people" | "newsletters" | "updates" | "priority";
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
  engScore: number;
};

const INBOX_SIGNAL_CONFIG: Record<string, { label: string; color: string }> = {
  replied: { label: "Replied",           color: "text-violet-400 bg-violet-500/10 border-violet-500/25" },
  hot:     { label: "Hot",               color: "text-orange-400 bg-orange-500/10 border-orange-500/25" },
  high:    { label: "Clicked",           color: "text-blue-400 bg-blue-500/8 border-blue-500/20" },
  medium:  { label: "Opened ×2+",        color: "text-emerald-400 bg-emerald-500/8 border-emerald-500/20" },
  low:     { label: "Opened",            color: "text-emerald-400/70 bg-emerald-500/5 border-emerald-500/15" },
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
  const effectiveKey = sig.isReplied ? "replied" : sig.isHot ? "hot" : (sig.signalLevel ?? "none");
  const cfg = INBOX_SIGNAL_CONFIG[effectiveKey];
  if (!cfg) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0 rounded border font-medium ${cfg.color}`}
      data-testid={`signal-badge-${effectiveKey}`}>
      {cfg.label}
    </span>
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

function isUnread(labelIds: string[]) {
  return labelIds.includes("UNREAD");
}

function isStarred(labelIds: string[]) {
  return labelIds.includes("STARRED");
}

function getEmailCategory(labelIds: string[]): "people" | "newsletters" | "updates" {
  if (labelIds.includes("CATEGORY_PROMOTIONS") || labelIds.includes("CATEGORY_FORUMS")) return "newsletters";
  if (labelIds.includes("CATEGORY_UPDATES") || labelIds.includes("CATEGORY_SOCIAL")) return "updates";
  return "people";
}

const EMAIL_SIGNATURE_HTML = `<div style="font-family: OpenSans, Arial, sans-serif; font-size: 13px; color: #222; line-height: 1.5;">
<p style="margin: 0 0 20px 0; font-size: 13px;">Regards,</p>
<table cellpadding="0" cellspacing="0" border="0" style="min-width: 300px;">
    <tbody>
        <tr>
            <td style="padding-bottom: 2px;">
                <p style="margin: 0; font-size: 16px; font-weight: bold; color: #111; letter-spacing: 0.01em;">TREVOR BURGESS</p>
                <p style="margin: 0; font-size: 12px; color: #00C1DE; line-height: 1.6;">Co-Founder &amp; CEO</p>
            </td>
        </tr>
        <tr>
            <td style="padding: 6px 0 8px 0;">
                <hr style="border: none; border-top: 1px solid #d0d0d0; margin: 0;">
            </td>
        </tr>
        <tr>
            <td>
                <p style="margin: 0; font-size: 12px; color: #787f84; line-height: 1.8;">
                    VoltSafe Inc.<br>
                    410-1444 Alberni St. Vancouver, BC<br>
                    <b style="color: #555;">M:</b> <a href="tel:+17786880498" style="text-decoration: none; color: #787f84;">+1 778 688 0498</a> &nbsp;|&nbsp; <b style="color: #555;">T:</b> <a href="tel:+18339996960" style="text-decoration: none; color: #787f84;">+1 833 999 6960</a><br>
                    <a href="mailto:trevor@voltsafe.com" style="color: #787f84; text-decoration: none;">trevor@voltsafe.com</a><br>
                    <a href="https://www.voltsafe.com" style="color: #787f84; text-decoration: none;"><span style="color: #787f84;">voltsafe.com</span></a> | <a href="https://www.voltsafemarine.com" style="color: #787f84; text-decoration: none;"><span style="color: #787f84;">voltsafemarine.com</span></a>
                </p>
                <p style="margin: 4px 0 0 0; font-size: 11px; color: #787f84;">
                    Follow us:
                    <a href="https://www.linkedin.com/company/voltsafe" style="color: #00C1DE; text-decoration: none;">LinkedIn</a> |
                    <a href="https://www.instagram.com/voltsafetech/" style="color: #00C1DE; text-decoration: none;">Instagram</a> |
                    <a href="https://www.youtube.com/channel/UChU-fgZlHgE6TQtve3pXGMw" style="color: #00C1DE; text-decoration: none;">Youtube</a>
                </p>
            </td>
        </tr>
    </tbody>
</table>
</div>`;

function buildEmailHtml(messageText: string): string {
  const escaped = messageText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .split("\n")
    .map((line) => line || "&nbsp;")
    .join("<br/>");
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111;line-height:1.6;margin-bottom:24px;">${escaped}</div>\n${EMAIL_SIGNATURE_HTML}`;
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
}) {
  const { toast } = useToast();
  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState(defaultCc);
  const [bcc, setBcc] = useState(defaultBcc);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);

  // Sync fields whenever the modal opens with new defaults (e.g. switching between reply targets)
  useEffect(() => {
    if (open) {
      setTo(defaultTo);
      setCc(defaultCc);
      setBcc(defaultBcc);
      setSubject(defaultSubject);
      setBody(defaultBody);
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
      const insert = `\n\nYou're invited to a Zoom meeting.\n📅 ${dateStr} at ${timeStr} (${zoomDuration} min)\n🔗 Join Zoom Meeting: ${data.joinUrl}`;
      setBody((prev) => (prev || "") + insert);
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
  const [assetCategoryFilter, setAssetCategoryFilter] = useState<string>("all");
  const [showQuotePicker, setShowQuotePicker] = useState(false);

  // Ref to the message textarea so the format-bus handler (below) can
  // wrap the current selection with the appropriate markdown markers.
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  // Pending-format queue: when a format event arrives before the
  // composer is open or before the textarea has mounted, we stash it
  // here and replay once both conditions are satisfied. This fixes
  // the race where the user clicks a format button in the reader
  // toolbar, the parent calls onBeforeFormat() to open the composer,
  // and the bus event then fires synchronously before <Textarea> has
  // a chance to mount and bind its ref.
  const pendingFormatRef = useRef<FormatEvent | null>(null);

  const applyFormat = useCallback((e: FormatEvent) => {
    const ta = bodyRef.current;
    if (!ta) return false;
    // The textarea must be focused so the calculated selection is
    // sensible — if it isn't (e.g. the user just clicked the format
    // button without ever clicking the textarea), focus it first
    // and place the cursor at the end before applying.
    if (document.activeElement !== ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
    const next = applyFormatToTextarea(ta, e.cmd, e.value);
    setBody(next.value);
    // Restore the selection after React re-renders.
    requestAnimationFrame(() => {
      if (bodyRef.current) {
        bodyRef.current.focus();
        bodyRef.current.setSelectionRange(next.selectionStart, next.selectionEnd);
      }
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

  // Drain any pending format event once the composer is open AND the
  // textarea has mounted. We tick a small timeout to give Radix's
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

  const assetsQuery = useQuery<{ id: number; name: string; mimeType: string; size: number; category: string }[]>({
    queryKey: ["/api/assets"],
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

  const sendMutation = useMutation({
    mutationFn: async () => {
      const htmlBody = buildEmailHtml(body);
      const res = await apiRequest("POST", "/api/gmail/send", {
        to, subject, body: htmlBody, threadId,
        ...(cc ? { cc } : {}),
        ...(bcc ? { bcc } : {}),
        attachmentIds: attachedAssets.map((a) => a.id),
        ...(asAccountId ? { asAccountId } : {}),
        ...(pendingIcal ? { icalContent: pendingIcal } : {}),
      });
      return res.json();
    },
    onSuccess: async () => {
      toast({ title: "Email sent" });
      if (activeDraftId) {
        await fetch(`/api/gmail/drafts/${activeDraftId}`, { method: "DELETE", credentials: "include" }).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ["/api/gmail/drafts"] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
      onClose();
    },
    onError: (err: any) => toast({ title: "Failed to send", description: err.message, variant: "destructive" }),
  });

  const draftMutation = useMutation({
    mutationFn: async () => {
      const htmlBody = buildEmailHtml(body);
      const res = await apiRequest("POST", "/api/gmail/drafts", { to, subject, body: htmlBody, threadId, draftId: activeDraftId });
      return res.json();
    },
    onSuccess: (data) => {
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
      const htmlBody = buildEmailHtml(body);
      const res = await apiRequest("POST", "/api/gmail/schedule", {
        to, subject, body: htmlBody, threadId, scheduledAt,
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

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{threadId ? "Reply" : draftId ? "Edit Draft" : "New Email"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {!canSend && (
            <p className="text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
              You have view-only access. Only trevor@voltsafe.com can send emails.
            </p>
          )}
          <div>
            <Label className="text-xs">To</Label>
            <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="recipient@email.com" disabled={!canSend} data-testid="input-email-to" />
          </div>
          <div>
            <Label className="text-xs">CC</Label>
            <Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="cc@email.com" disabled={!canSend} data-testid="input-email-cc" />
          </div>
          <div>
            <Label className="text-xs">BCC</Label>
            <Input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="bcc@email.com" disabled={!canSend} data-testid="input-email-bcc" />
          </div>
          {!threadId && (
            <div>
              <Label className="text-xs">
                Subject <span className="text-destructive">*</span>
              </Label>
              <Input
                ref={subjectRef}
                value={subject}
                onChange={(e) => { setSubject(e.target.value); if (e.target.value.trim()) setSubjectError(false); }}
                disabled={!canSend}
                data-testid="input-email-subject"
                className={subjectError ? "border-destructive focus-visible:ring-destructive" : ""}
              />
              {subjectError && (
                <p className="text-xs text-destructive mt-1" data-testid="error-subject-required">
                  Subject is required before sending.
                </p>
              )}
            </div>
          )}
          <div>
            <Label className="text-xs">Message</Label>
            <Textarea ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)} rows={6} placeholder="Write your message..." disabled={!canSend} data-testid="input-email-body" />
          </div>

          <div className="border border-border/50 rounded-md p-3 bg-muted/20">
            <div
              className="text-sm opacity-70 pointer-events-none select-none"
              dangerouslySetInnerHTML={{ __html: EMAIL_SIGNATURE_HTML }}
            />
          </div>

          {/* Attached assets chips */}
          {attachedAssets.length > 0 && (
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

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
              {canSend && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => draftMutation.mutate()}
                  disabled={!body || isWorking}
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
                  className={`h-8 w-8 ${attachedAssets.length > 0 ? "text-primary" : "text-muted-foreground"}`}
                  onClick={() => setShowAssetPicker(true)}
                  title="Attach asset"
                  data-testid="button-attach-asset"
                >
                  <Paperclip className="h-4 w-4" />
                  {attachedAssets.length > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-primary text-[9px] text-primary-foreground flex items-center justify-center font-medium">
                      {attachedAssets.length}
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
                    setBody((prev) => {
                      const sep = prev && !prev.endsWith("\n") ? "\n\n" : "";
                      return prev + sep + snippetBody;
                    });
                  }}
                />
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
      </DialogContent>
    </Dialog>

    {/* Asset picker dialog */}
    <Dialog open={showAssetPicker} onOpenChange={(v) => !v && setShowAssetPicker(false)}>
      <DialogContent className="sm:max-w-md max-h-[75vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Attach a File</DialogTitle>
        </DialogHeader>
        {/* Category filter */}
        <div className="flex gap-1 flex-wrap pb-1">
          {["all", "quotes", "general", "proposal", "presentation"].map(cat => (
            <button key={cat} onClick={() => setAssetCategoryFilter(cat)}
              className={`px-2.5 py-0.5 rounded text-xs font-medium transition-colors ${assetCategoryFilter === cat ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80 text-muted-foreground"}`}
              data-testid={`asset-filter-${cat}`}>
              {cat === "all" ? "All" : cat.charAt(0).toUpperCase() + cat.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto space-y-1 py-1">
          {assetsQuery.isLoading && (
            <div className="p-4 text-center text-sm text-muted-foreground">Loading assets...</div>
          )}
          {!assetsQuery.isLoading && (assetsQuery.data || []).filter(a => assetCategoryFilter === "all" || a.category === assetCategoryFilter).length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              <p>{assetCategoryFilter === "quotes" ? "No quote files yet. Create a quote to generate XLSX & HTML invoice files." : "No assets found."}</p>
              {assetCategoryFilter !== "quotes" && (
                <a href="/assets" target="_blank" className="text-primary hover:underline text-xs mt-1 block">
                  Go to Assets to upload files →
                </a>
              )}
              {assetCategoryFilter === "quotes" && (
                <a href="/quotes" target="_blank" className="text-primary hover:underline text-xs mt-1 block">
                  Go to Quotes →
                </a>
              )}
            </div>
          )}
          {(assetsQuery.data || [])
            .filter(a => assetCategoryFilter === "all" || a.category === assetCategoryFilter)
            .map((asset) => {
            const isAttached = attachedAssets.some((a) => a.id === asset.id);
            return (
              <button
                key={asset.id}
                onClick={() => {
                  setAttachedAssets((prev) =>
                    isAttached ? prev.filter((a) => a.id !== asset.id) : [...prev, { id: asset.id, name: asset.name }]
                  );
                }}
                data-testid={`asset-picker-item-${asset.id}`}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                  isAttached ? "bg-primary/10 border border-primary/30" : "hover:bg-muted/50"
                }`}
              >
                <div className={`h-4 w-4 rounded border flex-shrink-0 flex items-center justify-center ${
                  isAttached ? "bg-primary border-primary" : "border-border"
                }`}>
                  {isAttached && <span className="text-[10px] text-primary-foreground font-bold">✓</span>}
                </div>
                <Paperclip className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{asset.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{asset.category} · {asset.mimeType.split("/").pop()?.toUpperCase()}</p>
                </div>
              </button>
            );
          })}
        </div>
        <div className="flex-shrink-0 pt-3 flex justify-between items-center border-t border-border/50">
          <span className="text-xs text-muted-foreground">{attachedAssets.length} attached</span>
          <Button size="sm" onClick={() => setShowAssetPicker(false)} data-testid="button-done-assets">Done</Button>
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

function MessageBody({
  body,
  isHtml,
  headerLeft,
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
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<ReadingMode>("beautiful");
  const [zoom, setZoom] = useState<ZoomMode>("fit");
  const [iframeReady, setIframeReady] = useState(false);
  const [scaleApplied, setScaleApplied] = useState(1);

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
  useEffect(() => {
    const wrap = wrapperRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => fitContent());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fitContent]);

  // When zoom mode flips, recompute.
  useEffect(() => { fitContent(); }, [zoom, fitContent]);

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
    if (isHtml) return sanitizeEmailHtml(body);
    return sanitizeEmailHtml(plainTextToEmailHtml(body));
  }, [body, isHtml]);
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
<style>
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #1a1a1a;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    font-size: 14.5px;
    line-height: 1.6;
    word-wrap: break-word;
    overflow-wrap: anywhere;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
    overflow-x: hidden;
  }
  body { padding: 18px 20px; }
  /* Normalize giant inline-styled newsletter widths */
  body, body * { max-width: 100% !important; box-sizing: border-box; }
  /* Tables: drop hardcoded widths, allow flexible layout */
  table, table[width] { width: 100% !important; max-width: 100% !important; border-collapse: collapse; table-layout: auto !important; }
  td, th { padding: 4px 6px; word-wrap: break-word; overflow-wrap: anywhere; }
  td[width], th[width] { width: auto !important; }
  /* Images: scale to pane, preserve aspect ratio, ignore hardcoded width/height attrs */
  img, video { max-width: 100% !important; height: auto !important; border-radius: 4px; display: inline-block; }
  img[width], img[height] { width: auto !important; height: auto !important; max-width: 100% !important; }
  /* Buttons / CTA divs that newsletters often size to 600px */
  a[role="button"], .btn, button, input[type="button"], input[type="submit"] {
    border-radius: 6px !important;
    max-width: 100% !important;
    box-sizing: border-box;
    display: inline-block;
  }
  /* Links */
  a { color: #0b6ed4; text-decoration: none; border-bottom: 1px solid rgba(11,110,212,0.22); transition: border-color .15s ease; }
  a:hover { border-bottom-color: rgba(11,110,212,0.6); }
  /* Code & quotes */
  pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  pre { white-space: pre-wrap; word-break: break-word; background: #f6f8fa; padding: 12px 14px; border-radius: 8px; font-size: 13px; max-width: 100% !important; overflow-x: auto; }
  blockquote { border-left: 3px solid #d0d7de; margin: 14px 0; padding: 4px 14px; color: #57606a; }
  hr { border: none; border-top: 1px solid #d0d7de; margin: 18px 0; }
  /* Heading scale — slightly tighter than newsletter defaults */
  h1, h2, h3, h4 { color: #0d1117; line-height: 1.25; margin: 16px 0 8px; }
  h1 { font-size: 20px; } h2 { font-size: 17px; } h3 { font-size: 15.5px; } h4 { font-size: 14.5px; }
  p { margin: 6px 0; }
  ul, ol { padding-left: 22px; }
  /* Tame inline font-size attacks from promotional emails */
  [style*="font-size: 60"], [style*="font-size:60"],
  [style*="font-size: 50"], [style*="font-size:50"],
  [style*="font-size: 48"], [style*="font-size:48"],
  [style*="font-size: 40"], [style*="font-size:40"] { font-size: 22px !important; line-height: 1.25 !important; }
  [style*="font-size: 36"], [style*="font-size:36"],
  [style*="font-size: 32"], [style*="font-size:32"],
  [style*="font-size: 30"], [style*="font-size:30"] { font-size: 19px !important; line-height: 1.3 !important; }
  /* Common newsletter wrapper IDs/classes that have fixed pixel widths */
  [width="600"], [width="640"], [width="700"], [width="800"] { width: 100% !important; max-width: 100% !important; }
  /* Selection */
  ::selection { background: rgba(11,110,212,0.15); }
</style>
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
  account:     "Linked Organization",
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

  const [showQuickTask, setShowQuickTask] = useState(false);
  const [quickTaskTitle, setQuickTaskTitleLocal] = useState("");

  // Quote request popover state
  const [showQuotePopover, setShowQuotePopover] = useState(false);
  const [quoteTaskTitle, setQuoteTaskTitle] = useState("");
  const [quoteParticipants, setQuoteParticipants] = useState<Set<number>>(new Set());

  const [panelExpanded, setPanelExpanded] = useState(() => {
    try { return localStorage.getItem("crm-panel-expanded") === "true"; } catch { return false; }
  });
  const togglePanel = () => {
    const next = !panelExpanded;
    setPanelExpanded(next);
    try { localStorage.setItem("crm-panel-expanded", String(next)); } catch {}
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
        toast({ title: "Organization already exists", description: msg, variant: "destructive" });
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
      toast({ title: `Organization created: ${result?.account?.name ?? aName}` });
      try { await refreshAssocMutation.mutateAsync(); } catch {}
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-associations", threadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-record", threadId] });
    },
    onError: (err: any) => {
      const msg = err.message || "Unknown error";
      if (msg.includes("DOMAIN_CONFLICT")) {
        toast({ title: "Organization for this domain already exists", description: msg, variant: "destructive" });
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
      if (!cNewOrgName.trim()) { toast({ title: "Organization name is required", variant: "destructive" }); return; }
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
      {/* Awaiting reply indicator */}
      {thread?.awaitingReplySince && (
        <div className="px-4 pb-1.5">
          <div className="flex items-center gap-1.5 text-[11px] text-amber-400/80 bg-amber-500/8 border border-amber-500/20 rounded-md px-2.5 py-1.5" data-testid="awaiting-reply-badge">
            <Clock className="h-3 w-3 flex-shrink-0" />
            <span>Awaiting reply since {new Date(thread.awaitingReplySince).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
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
                      Organization
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
                    <span className="text-[10px] font-medium text-violet-400/80">New Organization</span>
                    <button onClick={() => setShowCreateAccountForm(false)} className="text-muted-foreground/40 hover:text-muted-foreground"><X className="h-3 w-3" /></button>
                  </div>
                  {domain && (
                    <div className="text-[10px] text-muted-foreground/50">Domain: <span className="text-muted-foreground/70">{domain}</span></div>
                  )}
                  <div className="space-y-0.5">
                    <label className="text-[10px] text-muted-foreground/60 font-medium">Organization name *</label>
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
                      {isPending ? "Creating…" : "Create Organization"}
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
                    <label className="text-[10px] text-muted-foreground/60 font-medium">Organization *</label>

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
                          placeholder="Organization name"
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

            {/* Unconfirmed / suggested associations */}
            {unconfirmedCandidates.map(cand => {
              const cfg = TYPE_CFG[cand.objectType as keyof typeof TYPE_CFG];
              if (!cfg) return null;
              const { Icon } = cfg;
              const canAccess = hasAccessForType(cand.objectType);
              const displayName = cand.objectName ?? cand.entityDetail?.name ?? "Unknown";
              const deepUrl = getDeepLinkUrl(cand.objectType, cand.objectId);
              const firstReason = cand.reasons?.[0];
              const allReasons = cand.reasons?.join(" · ");
              return (
                <div
                  key={cand.id}
                  data-testid={`crm-assoc-candidate-${cand.id}`}
                  className="group"
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`flex items-center gap-0.5 text-[10px] px-1.5 py-[2px] rounded border flex-shrink-0 opacity-60 ${cfg.bg} ${cfg.text} ${cfg.border}`}>
                      <Icon className="h-2.5 w-2.5" />
                      {cfg.label}
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
          </div>
        )}
      </div>
      </>
      )}
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
  const [from, setFrom] = useState("");
  const [domain, setDomain] = useState("");
  const [direction, setDirection] = useState<string>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const params = new URLSearchParams();
  if (q) params.set("q", q);
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
    enabled: submitted && (q.length > 0 || from.length > 0 || domain.length > 0 || direction.length > 0 || dateFrom.length > 0 || dateTo.length > 0),
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
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="invoice, refund, etc." data-testid="input-local-search-q" autoFocus />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">From (email or name)</Label>
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
            <Button type="button" size="sm" variant="ghost" onClick={() => { setQ(""); setFrom(""); setDomain(""); setDirection(""); setDateFrom(""); setDateTo(""); setSubmitted(false); }} data-testid="button-local-search-clear">
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
  const [returnPath] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("return") ?? null;
  });
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<{ to: string; cc?: string; subject: string; threadId: string } | null>(null);
  const [tab, setTab] = useState<"inbox" | "sent" | "other" | "drafts" | "scheduled" | "folder" | "review">("inbox");
  const [selectedReviewIds, setSelectedReviewIds] = useState<Set<string>>(new Set());
  const [inboxCategory, setInboxCategory] = useState<InboxCategory>("all");
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [showFolderSettings, setShowFolderSettings] = useState<number | null>(null);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderDomainInput, setNewFolderDomainInput] = useState("");
  const [foldersExpanded, setFoldersExpanded] = useState(true);
  // ── Focus Mode (premium full-reader experience) ────────────────────────
  const [focusMode, setFocusMode] = useState<boolean>(() => {
    try { return typeof window !== "undefined" && localStorage.getItem("inbox.focusMode") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("inbox.focusMode", focusMode ? "1" : "0"); } catch {}
  }, [focusMode]);
  // ── Density (Comfortable / Compact / Ultra) ────────────────────────────
  type Density = "comfortable" | "compact" | "ultra";
  const [density, setDensity] = useState<Density>(() => {
    try {
      const v = typeof window !== "undefined" ? localStorage.getItem("inbox.density") : null;
      if (v === "compact" || v === "ultra" || v === "comfortable") return v as Density;
    } catch {}
    return "comfortable";
  });
  useEffect(() => {
    try { localStorage.setItem("inbox.density", density); } catch {}
  }, [density]);

  // Spark-style "Smart Inbox" toggle. When enabled the inbox renders sectioned
  // groups (Priority → Unread by category → Pinned → Seen) instead of a flat
  // chronological list. Persisted in localStorage via the hook.
  const [viewMode, setViewMode] = useInboxViewMode();
  // Per-user thread pin set (localStorage). Pinning lets the user surface a
  // specific thread in the "Pinned" section even after it has been read.
  const pinnedAPI = usePinnedThreads();
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
  const [composeInitial, setComposeInitial] = useState<{ to?: string; body?: string } | null>(null);
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
  const [editingDomainFolderId, setEditingDomainFolderId] = useState<number | null>(null);
  const [addDomainInput, setAddDomainInput] = useState("");
  const [editingDraft, setEditingDraft] = useState<{ to: string; subject: string; body: string; draftId: string; threadId?: string } | null>(null);
  const [loadingDraftId, setLoadingDraftId] = useState<string | null>(null);
  const [inboxExtra, setInboxExtra] = useState<MessageSummary[]>([]);
  const [inboxNextToken, setInboxNextToken] = useState<string | null>(null);
  const [loadingMoreInbox, setLoadingMoreInbox] = useState(false);
  const [sentExtra, setSentExtra] = useState<MessageSummary[]>([]);
  const [sentNextToken, setSentNextToken] = useState<string | null>(null);
  const [loadingMoreSent, setLoadingMoreSent] = useState(false);

  // Resizable email-list panel
  const [listPanelWidth, setListPanelWidth] = useState<number>(() => {
    try { const s = localStorage.getItem("inbox-list-width"); return s ? Math.max(300, Math.min(680, Number(s))) : 400; } catch { return 400; }
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
      try { localStorage.setItem("inbox-list-width", String(listPanelWidthRef.current)); } catch {}
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);
  const [selectedInboxIds, setSelectedInboxIds] = useState<Set<string>>(new Set());
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

  const blockedDomains = new Set((filtersQuery.data || []).map((f) => f.domain));

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

  const triageSummaryQuery = useQuery<{ awaitingReply: number; hot: number; unlinked: number }>({
    queryKey: ["/api/inbox/triage-summary"],
    queryFn: async () => {
      const res = await fetch("/api/inbox/triage-summary", { credentials: "include" });
      if (!res.ok) return { awaitingReply: 0, hot: 0, unlinked: 0 };
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const triageThreadIdsQuery = useQuery<{ awaitingReply: string[]; hot: string[]; unlinked: string[] }>({
    queryKey: ["/api/inbox/triage-thread-ids"],
    queryFn: async () => {
      const res = await fetch("/api/inbox/triage-thread-ids", { credentials: "include" });
      if (!res.ok) return { awaitingReply: [], hot: [], unlinked: [] };
      return res.json();
    },
    enabled: ["awaiting-reply", "hot", "unlinked"].includes(crmFilter),
    refetchInterval: 60_000,
  });

  const triageSummary = triageSummaryQuery.data ?? { awaitingReply: 0, hot: 0, unlinked: 0 };
  const triageIds = triageThreadIdsQuery.data ?? { awaitingReply: [], hot: [], unlinked: [] };
  const triageAwaitingSet = new Set(triageIds.awaitingReply);
  const triageHotSet      = new Set(triageIds.hot);
  const triageUnlinkedSet = new Set(triageIds.unlinked);

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
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-filters"] });
      toast({ title: "Domain blocked", description: "Future emails from this sender will appear in Other." });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const unblockMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/email-filters/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-filters"] });
      toast({ title: "Domain unblocked", description: "Emails from this sender will appear in your inbox again." });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
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
      queryClient.setQueryData(["/api/gmail/messages", "inbox", searchQuery, activeAccountId], update);
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

  // null = user's personal account (default); number = shared/specific account id; "all" = unified inbox.
  // Multi-mailbox Phase 1: "all" sentinel triggers the unified view that pulls from every
  // account the user can access (their own personal accounts + shared inboxes they have view perms on).
  const [activeAccountId, setActiveAccountId] = useState<number | "all" | null>(null);
  // Multi-mailbox Phase 1: when a message is opened from "All Inboxes", remember its source
  // account id so per-thread reads/mutations target the right mailbox (instead of sending the
  // literal "all" sentinel, which numeric-only routes coerce to NaN).
  const [currentThreadAccountId, setCurrentThreadAccountId] = useState<number | null>(null);

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
  const STALENESS_THRESHOLD_MS = 60_000;
  const PER_ACCOUNT_COOLDOWN_MS = 15_000;
  const lastPolledAtRef = useRef<Map<number, number>>(new Map());
  const inFlightPollRef = useRef<Set<number>>(new Set());
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
        fetch(`/api/gmail/sync-incremental?accountId=${a.id}`, {
          method: "POST",
          credentials: "include",
        })
          .then((res) => (res.ok ? res.json() : null))
          .then((payload) => {
            const r = payload?.results?.[0];
            // Only invalidate when the sync actually changed something —
            // avoids unnecessary refetch storms when polling is just
            // confirming "still nothing new".
            if (r && (r.added > 0 || r.deleted > 0 || r.labelsChanged > 0)) {
              queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
              queryClient.invalidateQueries({ queryKey: ["/api/gmail/threads"] });
              queryClient.invalidateQueries({ queryKey: ["/api/gmail/accounts", "health"] });
            }
          })
          .catch(() => { /* swallow — next tick will retry */ })
          .finally(() => {
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
    if (activeAccountId) params.set("asAccountId", String(activeAccountId));
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

  const inboxQuery = useQuery<{ messages: MessageSummary[]; nextPageToken: string | null }>({
    queryKey: ["/api/gmail/messages", "inbox", searchQuery, activeAccountId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", "50");
      params.set("q", searchQuery ? `in:inbox ${searchQuery}` : "in:inbox");
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
    // Sent doesn't change as fast — 30s is plenty.
    refetchInterval: 30_000,
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
  }, [searchQuery, activeAccountId]);
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
      params.set("q", searchQuery ? `in:inbox ${searchQuery}` : "in:inbox");
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

  // Multi-mailbox Phase 1: thread-scoped account id. In "All Inboxes" we resolve to the
  // specific source account of the open message (avoids "all" → NaN coercion on routes that
  // still parse asAccountId as a plain Number).
  const threadAccountId: number | null =
    activeAccountId === "all"
      ? currentThreadAccountId
      : (typeof activeAccountId === "number" ? activeAccountId : null);

  const threadQuery = useQuery<Thread>({
    queryKey: ["/api/gmail/threads", selectedThreadId, threadAccountId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (threadAccountId) params.set("asAccountId", String(threadAccountId));
      const qs = params.toString() ? `?${params}` : "";
      const res = await fetch(`/api/gmail/threads/${selectedThreadId}${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    enabled: !!selectedThreadId,
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
  type ScheduledEmail = { id: number; to: string; subject: string | null; scheduledAt: string; createdAt: string };

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

  type ReviewQueueItem = {
    gmailThreadId: string;
    latestMessage: {
      id: number;
      subject: string | null;
      fromName: string | null;
      fromEmail: string | null;
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

  const bulkConfirmMutation = useMutation({
    mutationFn: async (items: Array<{ associationId: number; threadId: string }>) => {
      const res = await apiRequest("POST", "/api/gmail/thread-associations/bulk-confirm", { items });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Unknown error" }));
        throw new Error(body.message || `Error ${res.status}`);
      }
      return res.json() as Promise<BulkResult>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/review-queue/stats"] });
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
    onSuccess: (result) => {
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
    setSelectedInboxIds(new Set(activeMessages.map(m => m.threadId)));
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
      queryClient.setQueryData(["/api/gmail/messages", "inbox", searchQuery, activeAccountId], updateMsgs);
      setInboxExtra(prev => prev.map(m =>
        messageIds.includes(m.id)
          ? { ...m, labelIds: isRead ? m.labelIds.filter(l => l !== "UNREAD") : [...m.labelIds.filter(l => l !== "UNREAD"), "UNREAD"] }
          : m
      ));
      setSelectedInboxIds(new Set());
      toast({ title: `Marked ${messageIds.length} email${messageIds.length !== 1 ? "s" : ""} as ${markAs}` });
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
      queryClient.setQueryData(["/api/gmail/messages", "inbox", searchQuery, activeAccountId], removeArchived);
      setInboxExtra(prev => prev.filter(m => !threadIds.includes(m.threadId)));
      if (selectedThreadId && threadIds.includes(selectedThreadId)) {
        setSelectedThreadId(null);
        setSelectedMessageId(null);
      }
      setSelectedInboxIds(new Set());
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
      queryClient.setQueryData(["/api/gmail/messages", "inbox", searchQuery, activeAccountId], removeArchived);
      setInboxExtra(prev => prev.filter(m => m.threadId !== threadId));
      if (selectedThreadId === threadId) { setSelectedThreadId(null); setSelectedMessageId(null); }
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
      queryClient.setQueryData(["/api/gmail/messages", "inbox", searchQuery, activeAccountId], removeTrashed);
      setInboxExtra(prev => prev.filter(m => m.threadId !== threadId));
      if (selectedThreadId === threadId) { setSelectedThreadId(null); setSelectedMessageId(null); }
      toast({ title: "Moved to Trash" });
    },
    onError: (err: any) => toast({ title: "Trash failed", description: err.message, variant: "destructive" }),
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
      queryClient.setQueryData(["/api/gmail/messages", "inbox", searchQuery, activeAccountId], updateMsgs);
      setInboxExtra(prev => prev.map(m =>
        m.id === messageId
          ? { ...m, labelIds: [...m.labelIds.filter(l => l !== "UNREAD"), "UNREAD"] }
          : m
      ));
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
      setEditingDraft({ to: content.to, subject: content.subject, body: content.body, draftId, threadId: content.threadId });
      setComposeOpen(true);
    } catch {
      toast({ title: "Could not load draft", variant: "destructive" });
    } finally {
      setLoadingDraftId(null);
    }
  };

  // Pagination dedup: when local & gmail sources overlap, or refetch races with a loadMore append,
  // the same message id can appear twice. Keep the FIRST occurrence (newer page wins because base
  // page is always rendered before extras) and drop duplicates so React keys stay unique and the
  // user never sees a row twice.
  const dedupById = (msgs: MessageSummary[]): MessageSummary[] => {
    const seen = new Set<string>();
    const out: MessageSummary[] = [];
    for (const m of msgs) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
    return out;
  };
  const allInboxMessages = dedupById([...(inboxQuery.data?.messages || []), ...inboxExtra]);
  const allSentMessages = dedupById([...(sentQuery.data?.messages || []), ...sentExtra]);

  const inboxMain = canSend
    ? allInboxMessages.filter((m) => !blockedDomains.has(parseSenderDomain(m.from)))
    : allInboxMessages;
  const inboxOther = canSend
    ? allInboxMessages.filter((m) => blockedDomains.has(parseSenderDomain(m.from)))
    : [];

  const categorizedInbox =
    inboxCategory === "priority" ? inboxMain.filter((m) => isStarred(m.labelIds)) :
    inboxCategory === "all"      ? inboxMain :
    inboxMain.filter((m) => getEmailCategory(m.labelIds) === inboxCategory);

  const priorityCount = inboxMain.filter((m) => isStarred(m.labelIds)).length;
  const peopleCount = inboxMain.filter((m) => getEmailCategory(m.labelIds) === "people").length;
  const newslettersCount = inboxMain.filter((m) => getEmailCategory(m.labelIds) === "newsletters").length;
  const updatesCount = inboxMain.filter((m) => getEmailCategory(m.labelIds) === "updates").length;
  const inboxUnreadCount = inboxMain.filter((m) => isUnread(m.labelIds)).length;

  const activeMessages =
    tab === "inbox" ? categorizedInbox :
    tab === "sent"  ? allSentMessages :
    inboxOther;

  const crmFilteredMessages = tab !== "inbox" ? activeMessages :
    // Keep the currently-open thread visible even after its UNREAD label is
    // removed from cache — the grouper handles keeping it in the right section.
    crmFilter === "unread"         ? activeMessages.filter(m => isUnread(m.labelIds) || m.threadId === selectedThreadId) :
    crmFilter === "starred"        ? activeMessages.filter(m => isStarred(m.labelIds)) :
    crmFilter === "needs-reply"    ? activeMessages.filter(m => isUnread(m.labelIds) || m.threadId === selectedThreadId) :
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
    tab !== "drafts" && tab !== "scheduled" && tab !== "folder" && tab !== "review";
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

  const isLoading = tab === "other" ? inboxQuery.isLoading : tab === "inbox" ? inboxQuery.isLoading : sentQuery.isLoading;
  const error = tab === "other" ? inboxQuery.error : tab === "inbox" ? inboxQuery.error : sentQuery.error;
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
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMoreRef.current && !isLoadingMoreRef.current) {
          loadMoreRef.current();
        }
      },
      { rootMargin: "600px 0px", threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
    // Re-attach when the sentinel element mounts/unmounts. The sentinel is gated by
    // `!isLoading && !error`, so we MUST include those in deps — otherwise on first
    // render `sentinelRef.current` is null (sentinel not yet in DOM) and the observer
    // never attaches, breaking infinite scroll until the user manually switches tabs.
  }, [tab, isLoading, error]);

  // ── Visible-list starvation auto-chain (Apr 2026, hardening pass 3) ──
  // The IntersectionObserver only fires when the sentinel's intersection state CHANGES.
  // If the visible list (after ALL filters — blocked-domains, category, CRM) is shorter than
  // the viewport, the sentinel is intersecting on mount, fires ONCE, then never re-fires
  // because its state never changes. This stranded the inbox at "10 messages" for users
  // with heavy blocked-domain lists (LinkedIn etc.) who hadn't picked a category/CRM filter.
  //
  // Fix: auto-chain whenever the rendered list is starved (< 25 visible) AND more pages exist,
  // regardless of WHY it's starved (blocked-domain stripping, category, CRM, or all three).
  // Bounded to 25 chained pages (1,250 raw messages) per context to prevent runaway loops.
  // Cap raised from 10 → 25 (Apr 2026 hardening pass 4) because heavy-spam mailboxes (~1k+ msgs
  // with aggressive blocked-domain lists) routinely exhausted the 10-page budget before the
  // viewport filled, leaving the user with a starved list and no auto-resume. The chain resets
  // when tab/account/search/source/category/CRM changes (new context = new budget). When the
  // budget is exhausted but `hasMore` stays true, the sentinel renders an explicit "Load more"
  // button so the user has a manual escape hatch — never silently stops with rows missing.
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
    if (crmFilteredMessages.length >= 25) return;
    if (autoChainRef.current.count >= 25) {
      if (autoChainExhaustedKey !== inboxChainKey) setAutoChainExhaustedKey(inboxChainKey);
      dbg("autoChain:exhausted", { ctx: inboxChainKey, visible: crmFilteredMessages.length, count: autoChainRef.current.count });
      return;
    }
    autoChainRef.current.count += 1;
    dbg("autoChain:fire", { ctx: inboxChainKey, iter: autoChainRef.current.count, visible: crmFilteredMessages.length });
    loadMore();
  }, [tab, hasMore, isLoadingMore, inboxChainKey, crmFilteredMessages.length, loadMore, autoChainExhaustedKey]);
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
    queryKey: ["/api/inbox/thread-signals", visibleThreadIds.join(",")],
    queryFn: async () => {
      if (!visibleThreadIds.length) return {};
      const res = await fetch(`/api/inbox/thread-signals?threadIds=${visibleThreadIds.join(",")}`, { credentials: "include" });
      if (!res.ok) return {};
      return res.json();
    },
    enabled: visibleThreadIds.length > 0 && (tab === "inbox" || tab === "sent"),
    staleTime: 30000,
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
      const removeUnread = (old: { messages: MessageSummary[]; nextPageToken: string | null } | undefined) =>
        old ? { ...old, messages: old.messages.map((m) =>
          m.id === msg.id ? { ...m, labelIds: m.labelIds.filter((l) => l !== "UNREAD") } : m
        ) } : old;
      queryClient.setQueryData(["/api/gmail/messages", "inbox", searchQuery, activeAccountId], removeUnread);
      queryClient.setQueryData(["/api/gmail/messages", "sent", searchQuery, activeAccountId], removeUnread);
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

  const handleReply = (msg: ThreadMessage) => {
    setReplyTo({
      to: parseSenderEmail(msg.from),
      subject: msg.subject.startsWith("Re:") ? msg.subject : `Re: ${msg.subject}`,
      threadId: msg.threadId,
    });
  };

  const handleReplyAll = (msg: ThreadMessage) => {
    // Collect all addresses from To and CC, exclude the sender's own address
    const ownEmail = currentUserEmail.toLowerCase();
    const allRecipients = [msg.to, msg.cc]
      .filter(Boolean)
      .join(", ")
      .split(/,\s*/)
      .map((e) => e.trim())
      .filter((e) => e && parseSenderEmail(e).toLowerCase() !== ownEmail);
    setReplyTo({
      to: parseSenderEmail(msg.from),
      cc: allRecipients.length > 0 ? allRecipients.join(", ") : undefined,
      subject: msg.subject.startsWith("Re:") ? msg.subject : `Re: ${msg.subject}`,
      threadId: msg.threadId,
    });
  };

  const selectedMessages = threadQuery.data?.messages || [];
  const focusedMsg = selectedMessages.find((m) => m.id === selectedMessageId) || selectedMessages[selectedMessages.length - 1];
  // Newest-first display order (Spark Mail pattern): most recent email shown at top,
  // older messages collapsed below it for reference.
  const displayMessages = [...selectedMessages].reverse();
  const [expandedOlderMsgIds, setExpandedOlderMsgIds] = useState<Set<string>>(new Set());
  // Reset expanded set whenever the selected thread changes.
  useEffect(() => { setExpandedOlderMsgIds(new Set()); }, [selectedThreadId]);

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

  // ── Keyboard navigation ────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const list = tab === "drafts" || tab === "scheduled" || tab === "folder" ? [] : activeMessages;
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
          else if (selectedThreadId) { e.preventDefault(); handleBack(); }
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [tab, activeMessages, selectedThreadId, focusedMsg, canSend, selectedInboxIds, focusMode]);

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
        <Mail className="h-3.5 w-3.5 text-primary/70 flex-shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h1 className="text-[12px] font-semibold leading-tight text-foreground/80" data-testid="text-page-title">Mail</h1>
            {profileQuery.data?.emailAddress && (
              <span className="text-[10px] text-muted-foreground/65 truncate hidden sm:block">{profileQuery.data.emailAddress}</span>
            )}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!canSend && (
            <Badge variant="outline" className="text-xs text-amber-400 border-amber-500/30">View Only</Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            data-testid="button-sync-crm"
            className="gap-1.5 text-xs"
          >
            {syncMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
            {syncMutation.isPending ? "Syncing..." : "Sync to CRM"}
          </Button>
          {/* Commit 4: the inbox is always sourced from the local mirror —
              the Source selector and ?mailSource= URL param were removed. */}
          <LocalSearchButton />
          {/* Inbox view-mode picker — Smart (sectioned) vs Classic (flat).
              Only meaningful on the inbox tab; we still render it elsewhere so
              it doesn't pop in/out as users navigate between Sent/Drafts/etc.
              Mirrors Spark's Focused-List vs Simple-List choice but distilled
              into a single inline radiogroup that matches the density toggle. */}
          <div
            className="hidden md:inline-flex items-center gap-0.5 p-0.5 rounded-md border border-border/50 bg-background/60"
            role="radiogroup"
            aria-label="Inbox view mode"
            data-testid="view-mode-toggle"
          >
            {([
              { key: "smart" as const,   icon: LayoutList, label: "Smart Inbox — group by Priority, Unread categories, Pinned, Seen" },
              { key: "classic" as const, icon: ListIcon,   label: "Classic Inbox — flat chronological list" },
            ]).map(({ key, icon: Icon, label }) => {
              const active = viewMode === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  title={label}
                  data-testid={`button-view-${key}`}
                  onClick={() => setViewMode(key)}
                  className={`h-6 w-7 inline-flex items-center justify-center rounded-[4px] transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 outline-none ${
                    active
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground/55 hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              );
            })}
          </div>
          {/* Density toggle — Comfortable / Compact / Ultra */}
          <div
            className="hidden md:inline-flex items-center gap-0.5 p-0.5 rounded-md border border-border/50 bg-background/60"
            role="radiogroup"
            aria-label="List density"
            data-testid="density-toggle"
          >
            {([
              { key: "comfortable", icon: Rows3, label: "Comfortable" },
              { key: "compact",     icon: Rows2, label: "Compact" },
              { key: "ultra",       icon: AlignJustify, label: "Ultra compact" },
            ] as const).map(({ key, icon: Icon, label }) => {
              const active = density === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  title={label}
                  data-testid={`button-density-${key}`}
                  onClick={() => setDensity(key)}
                  className={`h-6 w-7 inline-flex items-center justify-center rounded-[4px] transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 outline-none ${
                    active
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground/55 hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              );
            })}
          </div>
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
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
              queryClient.invalidateQueries({ queryKey: ["/api/gmail/threads"] });
            }}
            data-testid="button-refresh-inbox"
          >
            <RefreshCw className="h-4 w-4" />
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

      <div className="flex flex-1 min-h-0">
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
                <button
                  onClick={() => {
                    setActiveAccountId(null); setTab("inbox"); setSelectedMessageId(null); setSelectedThreadId(null); setCurrentThreadAccountId(null);
                  }}
                  data-testid="btn-account-personal"
                  className={`w-full flex items-center gap-2.5 px-2 ${densityClasses.sidebarRowPy} rounded-md transition-colors ${activeAccountId === null ? "text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
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
                  {activeAccountId === null && inboxUnreadCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium bg-primary/20 text-primary">{inboxUnreadCount}</span>
                  )}
                </button>
                {/* Personal account subtabs */}
                {activeAccountId === null && (
                  <div className="ml-3 pl-2 border-l border-border/40 space-y-0.5 mt-0.5 mb-1">
                    <button onClick={() => { setTab("inbox"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid="nav-tab-inbox"
                      className={`w-full flex items-center gap-2 px-2 ${densityClasses.sidebarSubtabPy} rounded-md ${densityClasses.sidebarSubtabText} font-medium transition-colors ${tab === "inbox" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                      <Inbox className="h-3.5 w-3.5" /><span className="flex-1 text-left">Inbox</span>
                      {inboxUnreadCount > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium ${tab === "inbox" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>{inboxUnreadCount}</span>}
                    </button>
                    <button onClick={() => { setTab("sent"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid="nav-tab-sent"
                      className={`w-full flex items-center gap-2 px-2 ${densityClasses.sidebarSubtabPy} rounded-md ${densityClasses.sidebarSubtabText} font-medium transition-colors ${tab === "sent" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                      <Send className="h-3.5 w-3.5" /><span className="flex-1 text-left">Sent</span>
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
                        {(scheduledQuery.data?.length ?? 0) > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium ${tab === "scheduled" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>{scheduledQuery.data?.length}</span>}
                      </button>
                    </>}
                    <button onClick={() => { setTab("other"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid="nav-tab-other"
                      className={`w-full flex items-center gap-2 px-2 ${densityClasses.sidebarSubtabPy} rounded-md ${densityClasses.sidebarSubtabText} font-medium transition-colors ${tab === "other" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                      <FolderX className="h-3.5 w-3.5" /><span className="flex-1 text-left">Other</span>
                      {inboxOther.length > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium bg-muted text-muted-foreground">{inboxOther.length}</span>}
                    </button>
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
                {inboxUnreadCount > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium ${tab === "inbox" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>{inboxUnreadCount}</span>}
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
                      <button
                        onClick={() => {
                          setActiveAccountId(acct.id); setTab("inbox"); setSelectedMessageId(null); setSelectedThreadId(null); setCurrentThreadAccountId(null);
                        }}
                        data-testid={`btn-account-shared-${acct.id}`}
                        title={acct.emailAddress}
                        className={`w-full flex items-center gap-2.5 px-2 ${densityClasses.sidebarRowPy} rounded-md transition-colors ${isThisActive ? "text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
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
                        {isThisActive && inboxUnreadCount > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium bg-primary/20 text-primary">{inboxUnreadCount}</span>
                        )}
                      </button>
                      {/* Subtabs for this team inbox when active */}
                      {isThisActive && (
                        <div className="ml-3 pl-2 border-l border-border/40 space-y-0.5 mt-0.5 mb-1">
                          <button onClick={() => { setTab("inbox"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid={`nav-tab-inbox-${acct.id}`}
                            className={`w-full flex items-center gap-2 px-2 ${densityClasses.sidebarSubtabPy} rounded-md ${densityClasses.sidebarSubtabText} font-medium transition-colors ${tab === "inbox" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                            <Inbox className="h-3.5 w-3.5" /><span className="flex-1 text-left">Inbox</span>
                            {inboxUnreadCount > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium ${tab === "inbox" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>{inboxUnreadCount}</span>}
                          </button>
                          <button onClick={() => { setTab("sent"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid={`nav-tab-sent-${acct.id}`}
                            className={`w-full flex items-center gap-2 px-2 ${densityClasses.sidebarSubtabPy} rounded-md ${densityClasses.sidebarSubtabText} font-medium transition-colors ${tab === "sent" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                            <Send className="h-3.5 w-3.5" /><span className="flex-1 text-left">Sent</span>
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
                              {(scheduledQuery.data?.length ?? 0) > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium ${tab === "scheduled" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>{scheduledQuery.data?.length}</span>}
                            </button>
                          </>}
                          <button onClick={() => { setTab("other"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid={`nav-tab-other-${acct.id}`}
                            className={`w-full flex items-center gap-2 px-2 ${densityClasses.sidebarSubtabPy} rounded-md ${densityClasses.sidebarSubtabText} font-medium transition-colors ${tab === "other" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                            <FolderX className="h-3.5 w-3.5" /><span className="flex-1 text-left">Other</span>
                            {inboxOther.length > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium bg-muted text-muted-foreground">{inboxOther.length}</span>}
                          </button>
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
            {connectedAccount && (
              <div className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`flex-shrink-0 h-2 w-2 rounded-full ${connectedAccount.authStatus === "active" ? "bg-emerald-400" : connectedAccount.authStatus === "expired" ? "bg-amber-400" : "bg-red-400"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate" data-testid="text-connected-email">{connectedAccount.emailAddress}</p>
                    {connectedAccount.lastSyncAt ? (
                      // Commit 4: relative "synced N min ago" sourced from the
                      // server's email_accounts.last_sync_at — refreshed
                      // naturally by accountsQuery (30s poll). Avoids a
                      // frontend-side now() ticker.
                      <p className="text-[10px] text-muted-foreground truncate" data-testid="text-last-sync">
                        synced {(() => {
                          try { return formatDistanceToNow(new Date(connectedAccount.lastSyncAt), { addSuffix: true }); }
                          catch { return ""; }
                        })()}
                      </p>
                    ) : (
                      <p className="text-[10px] text-muted-foreground">{connectedAccount.authStatus === "active" ? "Never synced" : connectedAccount.authStatus}</p>
                    )}
                  </div>
                  {connectedAccount.authStatus !== "active" ? (
                    <a href="/api/auth/gmail/connect" className="flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors whitespace-nowrap" data-testid="button-reconnect-account-footer">Reconnect</a>
                  ) : (
                    <button title="Resync this account" data-testid="button-resync-account-footer" onClick={async () => { try { await fetch(`/api/gmail/accounts/${connectedAccount.id}/resync?limit=100`, { method: "POST", credentials: "include" }); syncMutation.mutate(undefined); } catch {} }} className="flex-shrink-0 p-1 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted/50 transition-colors">
                      <RefreshCw className="h-3 w-3" />
                    </button>
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
                { key: "inbox",    label: "Inbox",   badge: inboxUnreadCount > 0 ? inboxUnreadCount : null },
                { key: "sent",     label: "Sent",    badge: null },
                ...(canSend ? [{ key: "drafts", label: "Drafts", badge: (draftsQuery.data?.length ?? 0) > 0 ? draftsQuery.data?.length : null }] : []),
                { key: "review",   label: "Review",  badge: (reviewStatsQuery.data?.needsReview ?? 0) > 0 ? reviewStatsQuery.data?.needsReview : null },
                { key: "other",    label: "Other",   badge: inboxOther.length > 0 ? inboxOther.length : null },
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

          {/* Category pills + Search */}
          <div className={`flex-shrink-0 ${densityClasses.chipsRootPad} ${densityClasses.chipsRootGap} border-b border-border/50`}>
            {tab === "inbox" && (
              <>
                {/* Category pills — horizontally scrollable on mobile */}
                <div className="overflow-x-auto -mx-3 px-3">
                  <div className="flex gap-1 min-w-max">
                  {([
                    { key: "all",         label: "All",         icon: <Inbox className="h-3 w-3" />,     count: inboxMain.length },
                    { key: "priority",    label: "Priority",    icon: <Star className="h-3 w-3" />,      count: priorityCount },
                    { key: "people",      label: "People",      icon: <Users className="h-3 w-3" />,     count: peopleCount },
                    { key: "newsletters", label: "Newsletters", icon: <Newspaper className="h-3 w-3" />, count: newslettersCount },
                    { key: "updates",     label: "Updates",     icon: <Bell className="h-3 w-3" />,      count: updatesCount },
                  ] as { key: InboxCategory; label: string; icon: React.ReactNode; count: number }[]).map(({ key, label, icon, count }) => {
                    const active = inboxCategory === key;
                    return (
                    <motion.button
                      key={key}
                      whileTap={{ scale: 0.95 }}
                      whileHover={{ scale: 1.04 }}
                      transition={{ type: "spring", stiffness: 500, damping: 22 }}
                      onClick={() => setInboxCategory(key)}
                      data-testid={`inbox-category-${key}`}
                      className={`flex items-center gap-1 ${densityClasses.chipPx} ${densityClasses.chipPy} rounded-full ${densityClasses.chipText} font-medium transition-colors whitespace-nowrap ${
                        active
                          ? key === "priority"
                            ? "bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-400/40 shadow-[0_0_12px_-2px_rgba(251,191,36,0.35)]"
                            : "bg-primary/12 text-primary ring-1 ring-inset ring-primary/40 shadow-[0_0_12px_-2px_rgba(20,184,166,0.35)]"
                          : "bg-muted/40 text-muted-foreground/85 hover:bg-muted/70 hover:text-foreground ring-1 ring-inset ring-transparent"
                      }`}
                    >
                      {icon}
                      {label}
                      {count > 0 && <span className={`ml-0.5 tabular-nums ${active ? "opacity-90" : "opacity-60"}`}>{count}</span>}
                    </motion.button>
                  );})}
                  </div>
                </div>
                {/* CRM fast filters — horizontally scrollable on mobile */}
                <div className="overflow-x-auto -mx-3 px-3">
                  <div className="flex gap-1 min-w-max pt-0.5">
                  {([
                    { key: "all",         label: "All",           icon: <Filter className="h-3 w-3" />,       count: null },
                    { key: "unread",      label: "Unread",        icon: <MailOpen className="h-3 w-3" />,     count: inboxUnreadCount || null },
                    { key: "starred",     label: "Starred",       icon: <Star className="h-3 w-3" />,         count: null },
                    { key: "needs-reply", label: "Needs Reply",   icon: <Reply className="h-3 w-3" />,        count: null },
                    { key: "follow-up",   label: "Follow Up",     icon: <ClipboardList className="h-3 w-3" />, count: null },
                  ] as { key: CrmInboxFilter; label: string; icon: React.ReactNode; count: number | null }[]).map(({ key, label, icon, count }) => {
                    const active = crmFilter === key;
                    return (
                    <motion.button
                      key={key}
                      whileTap={{ scale: 0.95 }}
                      whileHover={{ scale: 1.04 }}
                      transition={{ type: "spring", stiffness: 500, damping: 22 }}
                      onClick={() => setCrmFilter(key)}
                      data-testid={`crm-filter-${key}`}
                      className={`flex items-center gap-1 ${densityClasses.chipPx} ${densityClasses.chipPy} rounded-full ${densityClasses.chipText} font-medium transition-colors whitespace-nowrap ${
                        active
                          ? "bg-violet-500/15 text-violet-300 ring-1 ring-inset ring-violet-400/40 shadow-[0_0_12px_-2px_rgba(167,139,250,0.35)]"
                          : "bg-muted/25 text-muted-foreground/65 hover:bg-muted/55 hover:text-foreground/85 ring-1 ring-inset ring-transparent"
                      }`}
                    >
                      {icon}
                      {label}
                      {count !== null && count > 0 && (
                        <span className={`ml-0.5 text-[10px] tabular-nums ${active ? "opacity-90" : "opacity-70"}`}>{count}</span>
                      )}
                    </motion.button>
                  );})}
                  </div>
                </div>

                {/* Triage filters — Awaiting Reply / Hot / Unlinked */}
                <div className="overflow-x-auto -mx-3 px-3">
                  <div className="flex gap-1 min-w-max pt-0.5">
                  {([
                    {
                      key: "awaiting-reply",
                      label: "Awaiting Reply",
                      icon: <Clock className="h-3 w-3" />,
                      count: triageSummary.awaitingReply,
                      activeClass: "bg-amber-500/20 text-amber-400 border border-amber-500/30",
                    },
                    {
                      key: "hot",
                      label: "Hot / Engaged",
                      icon: <Flame className="h-3 w-3" />,
                      count: triageSummary.hot,
                      activeClass: "bg-rose-500/20 text-rose-400 border border-rose-500/30",
                    },
                    {
                      key: "unlinked",
                      label: "Unlinked",
                      icon: <Link2 className="h-3 w-3" />,
                      count: triageSummary.unlinked,
                      activeClass: "bg-slate-500/20 text-slate-300 border border-slate-500/30",
                    },
                  ] as { key: CrmInboxFilter; label: string; icon: React.ReactNode; count: number; activeClass: string }[]).map(({ key, label, icon, count, activeClass }) => {
                    const active = crmFilter === key;
                    return (
                    <motion.button
                      key={key}
                      whileTap={{ scale: 0.95 }}
                      whileHover={{ scale: 1.04 }}
                      transition={{ type: "spring", stiffness: 500, damping: 22 }}
                      onClick={() => setCrmFilter(active ? "all" : key)}
                      data-testid={`triage-filter-${key}`}
                      className={`flex items-center gap-1 ${densityClasses.chipPx} ${densityClasses.chipPy} rounded-full ${densityClasses.chipText} font-medium transition-colors whitespace-nowrap ring-1 ring-inset ${
                        active
                          ? `${activeClass.replace('border ', 'ring-')} shadow-[0_0_12px_-2px_currentColor]`
                          : "bg-muted/25 text-muted-foreground/65 hover:bg-muted/55 hover:text-foreground/85 ring-transparent"
                      }`}
                    >
                      {icon}
                      {label}
                      {count > 0 && (
                        <span className={`ml-0.5 text-[10px] px-1 py-0 rounded-full font-semibold tabular-nums ${
                          active ? "opacity-90" : "bg-muted/60 opacity-80"
                        }`}>{count}</span>
                      )}
                    </motion.button>
                  );})}
                  </div>
                </div>
              </>
            )}
            <form onSubmit={handleSearch} className="flex gap-1">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search emails..."
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
          <div ref={inboxScrollRef} className="flex-1 overflow-y-auto pb-36 md:pb-24">
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
                  <button
                    key={draft.id}
                    onClick={() => openDraft(draft.id)}
                    disabled={loadingDraftId === draft.id}
                    data-testid={`draft-row-${draft.id}`}
                    className="w-full text-left px-3 py-2.5 border-b border-border/30 transition-colors hover:bg-muted/50 flex flex-col gap-0.5"
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
                (scheduledQuery.data || []).map((email) => (
                  <div key={email.id} className="group relative px-3 py-2.5 border-b border-border/30">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className="text-sm truncate text-muted-foreground">{email.to}</span>
                      <button
                        onClick={() => cancelScheduledMutation.mutate(email.id)}
                        disabled={cancelScheduledMutation.isPending}
                        title="Cancel scheduled send"
                        data-testid={`button-cancel-scheduled-${email.id}`}
                        className="text-muted-foreground/40 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      >
                        <CalendarX className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p className="text-xs truncate text-foreground/70">{email.subject || "(no subject)"}</p>
                    <p className="text-xs text-primary/70 mt-0.5 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(email.scheduledAt).toLocaleString()}
                    </p>
                  </div>
                ))
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
                  {/* ── Bulk action bar ─────────────────────────────────── */}
                  <div className="sticky top-0 z-10 flex items-center gap-1.5 px-2 py-1.5 bg-background/95 backdrop-blur border-b border-border/30">
                    {selectedReviewIds.size === 0 ? (
                      /* No selection — show quick-select helper */
                      <button
                        onClick={selectHighConfidence}
                        data-testid="button-select-high-confidence"
                        className="flex items-center gap-1 text-[11px] text-amber-500/80 hover:text-amber-400 transition-colors px-1.5 py-1 rounded hover:bg-amber-500/10"
                        title={`Select all suggestions with ≥${HIGH_CONFIDENCE_THRESHOLD}% confidence`}
                      >
                        <CheckCheck className="h-3 w-3" />
                        Select high-confidence (≥{HIGH_CONFIDENCE_THRESHOLD}%)
                      </button>
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
                          className="flex items-center justify-center px-2 flex-shrink-0 cursor-pointer"
                          onClick={(e) => { e.stopPropagation(); toggleReviewSelection(item.gmailThreadId); }}
                          data-testid={`review-checkbox-${item.gmailThreadId}`}
                          title={isChecked ? "Deselect" : "Select for bulk action"}
                        >
                          <div className={`h-3.5 w-3.5 rounded border transition-colors flex items-center justify-center flex-shrink-0 ${
                            isChecked
                              ? "bg-amber-500 border-amber-500"
                              : "border-border/50 hover:border-amber-400"
                          }`}>
                            {isChecked && <CheckCheck className="h-2.5 w-2.5 text-white" />}
                          </div>
                        </div>

                        {/* Row content — click opens thread */}
                        <button
                          className="flex-1 text-left py-3 pr-3 min-w-0"
                          onClick={() => { setSelectedThreadId(item.gmailThreadId); setSelectedMessageId(null); }}
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
                  const senderName = email.fromName || email.fromEmail?.split("@")[0] || "Unknown";
                  const dateStr = email.sentAt
                    ? formatDate(new Date(email.sentAt).toISOString(), undefined)
                    : "";
                  return (
                    <div
                      key={email.id}
                      className={`relative group flex items-stretch transition-colors border-b border-border/20 ${
                        isSelected
                          ? "bg-primary/8 border-l-[3px] border-l-primary"
                          : "border-l-[3px] border-l-transparent hover:bg-muted/25"
                      }`}
                    >
                      <button
                        onClick={() => { setSelectedThreadId(email.gmailThreadId); setSelectedMessageId(null); }}
                        data-testid={`folder-email-row-${email.id}`}
                        className="flex-1 text-left px-3 py-3 pr-10 min-w-0"
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

            {tab !== "drafts" && tab !== "scheduled" && tab !== "folder" && tab !== "review" && isLoading && (
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
            {/* Bulk action toolbar — shown when inbox threads are selected */}
            {tab !== "drafts" && tab !== "scheduled" && tab !== "folder" && tab !== "review" && selectedInboxIds.size > 0 && (
              <div className="sticky top-0 z-10 flex items-center gap-1.5 px-2 py-2 bg-background/98 backdrop-blur border-b border-primary/20 border-l-[3px] border-l-primary/40">
                <span className="text-[11px] font-semibold text-foreground/70 mr-0.5 tabular-nums shrink-0" data-testid="text-bulk-selected-count">
                  {selectedInboxIds.size} sel.
                </span>
                {canSend && (
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
                {canSend && (
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
                    onClick={() => setSelectedInboxIds(new Set())}
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
            {tab !== "drafts" && tab !== "scheduled" && tab !== "folder" && tab !== "review" && (
              viewItems ?? (crmFilteredMessages ?? []).map((m) => ({ kind: "msg" as const, section: "flat" as SmartSectionId, msg: m }))
            )?.map((item) => {
              // Smart-Inbox section header — purely visual, not a clickable
              // mail row. Rendered inline so we don't break the surrounding
              // <div> flow (the parent is a flex column that expects flat
              // children with a stable border-bottom rhythm).
              if (item.kind === "header") {
                const headerIcon =
                  item.glyph === "priority"      ? Flame       :
                  item.glyph === "people"        ? Users       :
                  item.glyph === "notifications" ? Bell        :
                  item.glyph === "newsletters"   ? Newspaper   :
                  item.glyph === "pinned"        ? Pin         :
                  /* "seen" */                     MailOpen;
                const HeaderIcon = headerIcon;
                // Priority rows in Spark use a warm amber tone; everything
                // else stays neutral so the eye is naturally drawn to the
                // top section first when there are flagged messages.
                const tone = item.glyph === "priority"
                  ? "text-amber-400"
                  : "text-muted-foreground/65";
                return (
                  <div
                    key={`smart-header-${item.id}`}
                    data-testid={`smart-section-header-${item.id}`}
                    className={`flex items-center gap-2 ${item.isSubsection ? "pl-7" : "pl-3"} pr-3 py-1.5 bg-muted/15 border-b border-border/20 sticky top-0 z-[1] backdrop-blur-sm`}
                  >
                    <HeaderIcon className={`h-3.5 w-3.5 ${tone}`} aria-hidden="true" />
                    <span className={`text-[11px] font-semibold uppercase tracking-[0.06em] ${tone}`}>
                      {item.title}
                    </span>
                    <span className="text-[10px] tabular-nums text-muted-foreground/45">
                      {item.count}
                    </span>
                  </div>
                );
              }
              const msg = item.msg;
              const unread = isUnread(msg.labelIds);
              const starred = isStarred(msg.labelIds);
              const isSelected = msg.threadId === selectedThreadId;
              const isBulkChecked = selectedInboxIds.has(msg.threadId);
              const domain = parseSenderDomain(msg.from);
              const blocked = blockedDomains.has(domain);
              const senderName = tab === "sent"
                ? (msg.to ? `→ ${parseSenderName(msg.to)}` : "Unknown")
                : parseSenderName(msg.from);
              const threadSig = threadSignals[msg.threadId] ?? null;
              const hasSignalRow = threadSig && (
                threadSig.isReplied || threadSig.isHot ||
                (threadSig.signalLevel && threadSig.signalLevel !== "none") ||
                threadSig.awaitingReplySince ||
                (threadSig.workflowState && threadSig.workflowState !== "none")
              );
              return (
                <div
                  key={msg.id}
                  className={`relative group flex items-stretch transition-all duration-150 border-b border-border/20 ${
                    isBulkChecked
                      ? "bg-primary/10 border-l-[3px] border-l-primary/60"
                      : isSelected
                        ? "bg-primary/[0.13] border-l-[3px] border-l-primary shadow-[inset_0_0_0_1px_rgba(20,184,166,0.14),inset_4px_0_12px_-4px_rgba(20,184,166,0.08)]"
                        : "border-l-[3px] border-l-transparent hover:bg-muted/35 hover:border-l-primary/15"
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
                    onClick={() => handleSelectMessage(msg)}
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
                        {activeAccountId === "all" && msg.sourceAccountId != null && (() => {
                          const acct = accountsQuery.data?.find((a) => a.id === msg.sourceAccountId);
                          if (!acct) return null;
                          const letter = (acct.displayName || acct.emailAddress)[0].toUpperCase();
                          const colour = acct.isShared ? "bg-teal-500/20 text-teal-300 border-teal-500/30" : "bg-primary/20 text-primary border-primary/30";
                          return (
                            <span
                              title={acct.emailAddress}
                              data-testid={`badge-account-${msg.sourceAccountId}-${msg.id}`}
                              className={`flex-shrink-0 h-4 px-1.5 rounded border text-[9px] font-bold leading-4 tabular-nums ${colour}`}
                            >
                              {letter}
                            </span>
                          );
                        })()}
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
                    {/* Row 3: signal badges + triage status (only when data present) */}
                    {hasSignalRow && density !== "ultra" && (
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
                    {canSend && tab !== "sent" && (
                      <motion.button
                        whileTap={{ scale: 0.82 }}
                        whileHover={{ scale: 1.1 }}
                        title={blocked ? `Unblock @${domain}` : `Block @${domain}`}
                        aria-label={blocked ? `Unblock @${domain}` : `Block @${domain}`}
                        tabIndex={-1}
                        data-testid={`button-flag-${msg.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (blocked) {
                            const filter = (filtersQuery.data || []).find((f) => f.domain === domain);
                            if (filter) unblockMutation.mutate(filter.id);
                          } else {
                            flagMutation.mutate(domain);
                          }
                        }}
                        className={`p-1.5 rounded-md transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100 ${
                          blocked ? "text-amber-400 hover:text-amber-300" : "text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10"
                        }`}
                      >
                        {blocked ? <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Ban className="h-3.5 w-3.5" aria-hidden="true" />}
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
                  // Commit 4: the "Switch to live Gmail / Switch to local archive"
                  // CTAs were removed along with the mailSource toggle — the inbox
                  // is always sourced from the local mirror now, so the shortfall
                  // branches no longer apply (any gap is a backfill issue, not a
                  // source-toggle issue, and surfaces in Mailbox Health instead).
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground/45 tabular-nums" data-testid="status-all-caught-up">
                    <span className="h-1 w-1 rounded-full bg-muted-foreground/30" />
                    You're all caught up · {crmFilteredMessages.length} message{crmFilteredMessages.length !== 1 ? "s" : ""}
                  </span>
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
                    onMarkSpam: () => archiveThreadMutation.mutate(selectedThreadId),
                    onBlock: () => archiveThreadMutation.mutate(selectedThreadId),
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
                      onMarkSpam: () => archiveThreadMutation.mutate(selectedThreadId),
                      onBlock: () => archiveThreadMutation.mutate(selectedThreadId),
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

            {/* Messages in thread — bottom padding so last message is not hidden under FAB */}
            <div className={`flex-1 overflow-y-auto pb-36 md:pb-24 transition-[padding] duration-300 ${focusMode ? "pt-8 px-4 sm:px-6" : `${densityClasses.readerThreadPt} ${densityClasses.readerThreadPx}`}`}>
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
                const initials = parseSenderName(msg.from).split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
                const isLatest = idx === 0;
                const isOlderExpanded = expandedOlderMsgIds.has(msg.id);
                // Older (non-latest) messages: show a collapsed single-line summary
                // until the user taps to expand — Spark Mail style.
                if (!isLatest && !isOlderExpanded) {
                  return (
                    <button
                      key={msg.id}
                      onClick={() => setExpandedOlderMsgIds(prev => new Set([...prev, msg.id]))}
                      className="w-full flex items-center gap-3 rounded-xl border border-border/20 bg-card/20 hover:bg-card/40 px-4 py-2.5 text-left transition-colors group"
                      data-testid={`email-message-collapsed-${msg.id}`}
                      title="Click to expand"
                    >
                      <div className={`h-6 w-6 rounded-full bg-gradient-to-br ${avatarColor(parseSenderEmail(msg.from))} text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0`}>
                        {initials || "?"}
                      </div>
                      <span className="text-[12px] font-medium text-foreground/60 flex-shrink-0">{parseSenderName(msg.from)}</span>
                      <span className="text-[12px] text-muted-foreground/45 truncate flex-1 min-w-0">{msg.subject || "(no subject)"}</span>
                      <span className="text-[11px] text-muted-foreground/35 flex-shrink-0 tabular-nums">{formatMessageHeaderDate(msg.date, msg.internalDate)}</span>
                      <ChevronDown className="h-3 w-3 text-muted-foreground/25 group-hover:text-muted-foreground/50 flex-shrink-0 transition-colors" />
                    </button>
                  );
                }
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
                          title={parseSenderName(msg.from)}
                        >
                          {initials || "?"}
                        </div>
                        <div className="flex-1 min-w-0 pt-0.5">
                          <div className="flex items-baseline justify-between gap-2">
                            <p
                              className={`font-semibold ${densityClasses.msgSenderText} text-foreground leading-tight tracking-[-0.005em] truncate`}
                              title={parseSenderEmail(msg.from)}
                              data-testid={`text-sender-${msg.id}`}
                            >
                              {parseSenderName(msg.from)}
                            </p>
                            <span
                              className="text-[11px] text-muted-foreground/70 whitespace-nowrap flex-shrink-0 tabular-nums font-medium"
                              title={(() => {
                                const d = msg.date ? new Date(msg.date) : msg.internalDate ? new Date(Number(msg.internalDate)) : null;
                                return d && !isNaN(d.getTime()) ? d.toLocaleString() : "";
                              })()}
                              data-testid={`text-message-date-${msg.id}`}
                            >
                              {formatMessageHeaderDate(msg.date, msg.internalDate)}
                            </span>
                          </div>
                          <div className="text-[11px] text-muted-foreground/50 mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                            <RecipientList label="To" raw={msg.to} />
                            <RecipientList label="Cc" raw={msg.cc} />
                          </div>
                        </div>
                      </div>
                    </div>
                    {/* Spark-style rich calendar invite block — rendered ABOVE
                        the body whenever the message carries a text/calendar
                        attachment with a known DB id. The card lazily fetches
                        the parsed event (date/time/Join URL/attendees) from
                        /api/gmail/attachments/:id/calendar-invite. */}
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
                      return ics?.id != null ? (
                        <CalendarInviteCard attachmentId={ics.id} messageKey={msg.id} />
                      ) : null;
                    })()}
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
                    {/* Attachment strip (Phase 2E) — bigger & grid-laid in Focus Mode */}
                    {Array.isArray((msg as any).attachments) && (msg as any).attachments.filter((a: any) => !a.isInline).length > 0 && (
                      <div className={`bg-background/30 border-t border-border/20 ${focusMode ? "px-6 md:px-8 pb-6 pt-4" : "px-5 pb-4 pt-1"}`}>
                        <div className={`uppercase tracking-wider text-muted-foreground/60 ${focusMode ? "text-[11px] mb-3 font-semibold" : "text-[10px] mb-2"}`}>
                          {(msg as any).attachments.filter((a: any) => !a.isInline).length} attachment{(msg as any).attachments.filter((a: any) => !a.isInline).length === 1 ? "" : "s"}
                        </div>
                        <div className={focusMode ? "grid grid-cols-1 sm:grid-cols-2 gap-2.5" : "flex flex-wrap gap-2"}>
                          {(msg as any).attachments.filter((a: any) => !a.isInline).map((a: any, i: number) => {
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
                  <span className="text-[10px] text-muted-foreground/35 font-mono hidden lg:block">r</span>
                </div>
              </div>
            )}
            {/* CRM Context Panel — hidden in Focus Mode for distraction-free reading */}
            {!focusMode && (
              <CrmContextPanel key={selectedThreadId} threadId={selectedThreadId!} userPermissions={userPermissions} isAdminUser={isAdmin} returnPath={returnPath} hintSenderEmail={focusedMsg ? parseSenderEmail(focusedMsg.from) : undefined} hintSenderName={focusedMsg ? parseSenderName(focusedMsg.from) : undefined} hintSubject={focusedMsg?.subject ?? undefined} />
            )}
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

      {/* Snippets Manager dialog */}
      <SnippetsManagerDialog open={snippetsManagerOpen} onClose={() => setSnippetsManagerOpen(false)} />

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

      {/* Compose / Reply dialog */}
      <ComposeDialog
        key={editingDraft?.draftId ?? (replyTo ? `reply-${replyTo.threadId}` : "compose")}
        open={composeOpen || !!replyTo || !!editingDraft || !!composeInitial}
        onClose={() => { setComposeOpen(false); setReplyTo(null); setEditingDraft(null); setComposeInitial(null); }}
        canSend={canSend}
        defaultTo={editingDraft?.to || replyTo?.to || composeInitial?.to || ""}
        defaultCc={replyTo?.cc || ""}
        defaultSubject={editingDraft?.subject || replyTo?.subject || ""}
        defaultBody={editingDraft?.body || composeInitial?.body || ""}
        draftId={editingDraft?.draftId}
        threadId={editingDraft?.threadId || replyTo?.threadId}
        asAccountId={typeof activeAccountId === "number" ? activeAccountId : undefined}
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
    </div>
  );
}
