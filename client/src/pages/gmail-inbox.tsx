import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Search, Mail, MailOpen, Send, RefreshCw, Inbox, X, ChevronLeft, Loader2, Link2, Ban, FolderX, Trash2,
  Clock, FileText, CalendarClock, CalendarX, Paperclip, Star, Users, Newspaper, Bell, Receipt, Download,
  FolderOpen, FolderPlus, Settings2, Globe, Plus, PlusCircle, ChevronDown, ChevronRight, Folder,
  Reply, ReplyAll, Pencil, User, Building2, Zap,
  CheckCircle2, XCircle, TrendingUp, Handshake, ShieldCheck, AlertCircle, Tag, Lock, ExternalLink,
  CheckCheck, ArrowLeft,
} from "lucide-react";
import { useLocation } from "wouter";
import DOMPurify from "dompurify";

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
  const [activeDraftId, setActiveDraftId] = useState(draftId);
  const [attachedAssets, setAttachedAssets] = useState<{ id: number; name: string }[]>([]);
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [assetCategoryFilter, setAssetCategoryFilter] = useState<string>("all");
  const [showQuotePicker, setShowQuotePicker] = useState(false);

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

  const scheduleMutation = useMutation({
    mutationFn: async () => {
      const htmlBody = buildEmailHtml(body);
      const res = await apiRequest("POST", "/api/gmail/schedule", {
        to, subject, body: htmlBody, threadId, scheduledAt,
        ...(cc ? { cc } : {}),
        ...(bcc ? { bcc } : {}),
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

  const isWorking = sendMutation.isPending || draftMutation.isPending || scheduleMutation.isPending;
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
              <Label className="text-xs">Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!canSend} data-testid="input-email-subject" />
            </div>
          )}
          <div>
            <Label className="text-xs">Message</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} placeholder="Write your message..." disabled={!canSend} data-testid="input-email-body" />
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
                    onClick={() => scheduleMutation.mutate()}
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
                    onClick={() => sendMutation.mutate()}
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

function MessageBody({ body, isHtml }: { body: string; isHtml: boolean }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleIframeLoad = () => {
    const iframe = iframeRef.current;
    if (iframe?.contentDocument?.body) {
      const h = iframe.contentDocument.documentElement.scrollHeight;
      iframe.style.height = `${h + 16}px`;
    }
  };

  if (!body) return <p className="text-muted-foreground text-sm italic">No content</p>;

  if (isHtml) {
    const clean = DOMPurify.sanitize(body, { USE_PROFILES: { html: true } });
    const srcDoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  html, body { margin: 0; padding: 8px 12px; background: #ffffff; color: #1a1a1a;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
    font-size: 14px; line-height: 1.5; word-break: break-word; }
  a { color: #0066cc; }
  img { max-width: 100%; height: auto; }
  pre { white-space: pre-wrap; word-break: break-word; }
  blockquote { border-left: 3px solid #ccc; margin: 8px 0; padding-left: 12px; color: #555; }
</style>
</head>
<body>${clean}</body>
</html>`;
    return (
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        sandbox="allow-same-origin allow-popups"
        onLoad={handleIframeLoad}
        title="Email content"
        className="w-full border-0 rounded bg-white"
        style={{ minHeight: 200 }}
        data-testid="iframe-email-body"
      />
    );
  }

  return <pre className="text-sm whitespace-pre-wrap font-sans text-foreground">{body}</pre>;
}

type ThreadRecord = {
  found: boolean;
  thread?: {
    id: number; workflowState: string | null; snoozedUntil: string | null;
    followUpAt: string | null; primaryContactId: number | null;
    primaryAccountId: number | null; primaryLeadId: number | null;
    primaryPartnerId: number | null; associationStatus: string;
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
  { value: "other",       label: "Other" },
  { value: "marina",      label: "Marina" },
  { value: "government",  label: "Government / Port Authority" },
  { value: "association", label: "Association / NGO" },
  { value: "investor",    label: "Investor" },
  { value: "research",    label: "Research / Academic" },
  { value: "vendor",      label: "Vendor / Supplier" },
] as const;

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
}: {
  threadId: string;
  userPermissions?: CrmPanelPerms;
  isAdminUser?: boolean;
  returnPath?: string | null;
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
  const [cNewOrgType, setCNewOrgType] = useState("other");

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
      const res = await apiRequest("PATCH", `/api/gmail/thread-record/${threadId}`, { workflowState: state });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-record", threadId] });
    },
    onError: (err: any) => toast({ title: "Failed to update status", description: err.message, variant: "destructive" }),
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

  // Org search for the create-contact form (accounts only)
  const orgSearchQuery = useQuery<CrmSearchResult[]>({
    queryKey: ["/api/gmail/crm-search/org", cOrgSearch],
    queryFn: async () => {
      if (cOrgSearch.length < 2) return [];
      const res = await fetch(`/api/gmail/crm-search?q=${encodeURIComponent(cOrgSearch)}&types=account`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: cOrgMode === "existing" && cOrgSearch.length >= 2,
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

  function openCreateForm() {
    const s = threadRecordQuery.data?.sender;
    setCName(s?.fromName?.trim() || "");
    setCTitle("");
    setCOrgMode("existing");
    setCOrgSearch("");
    setCSelectedAccount(null);
    setCNewOrgName("");
    setCNewOrgType("other");
    setShowCreateForm(true);
    setShowManualLink(false);
  }

  function handleCreateSubmit() {
    const sender = threadRecordQuery.data?.sender;
    if (!sender?.fromEmail) return;
    const payload: Parameters<typeof createContactMutation.mutate>[0] = {
      fromEmail: sender.fromEmail,
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
      payload.orgType = cNewOrgType;
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
  const sender = data?.sender;
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
      {/* Workflow state pills */}
      <div className="px-4 pt-2.5 pb-1.5 flex items-center gap-2 flex-wrap">
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
      </div>

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

            {!assocQuery.isLoading && candidates.length === 0 && !showCreateForm && (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/35 italic py-0.5">
                  <AlertCircle className="h-3 w-3 flex-shrink-0" />
                  No CRM matches found — sync or link manually
                </div>
                {senderEligible && (
                  <button
                    onClick={openCreateForm}
                    data-testid="create-contact-from-sender-btn"
                    className="flex items-center gap-1 text-[10px] text-sky-400/70 hover:text-sky-400 border border-sky-500/20 hover:border-sky-500/50 px-2 py-[2px] rounded transition-all"
                  >
                    <Plus className="h-2.5 w-2.5" />
                    Create Contact from Sender
                  </button>
                )}
              </div>
            )}

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
                        {!cSelectedAccount && cOrgSearch.length >= 2 && (
                          <div className="max-h-24 overflow-y-auto border border-border/20 rounded bg-background/80 space-y-0">
                            {orgSearchQuery.isLoading && (
                              <div className="flex items-center justify-center py-2">
                                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/50" />
                              </div>
                            )}
                            {!orgSearchQuery.isLoading && (orgSearchQuery.data?.length ?? 0) === 0 && (
                              <p className="text-[10px] text-muted-foreground/40 text-center py-2">No organizations found — try "Create new"</p>
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
                                {r.meta && <span className="text-[10px] text-muted-foreground/40 truncate max-w-[60px]">{r.meta}</span>}
                              </button>
                            ))}
                          </div>
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
                        <select
                          value={cNewOrgType}
                          onChange={e => setCNewOrgType(e.target.value)}
                          data-testid="new-org-type-select"
                          disabled={isPending}
                          className="w-full px-2 py-1 text-[11px] bg-muted/20 border border-border/30 rounded focus:outline-none focus:border-border/70 text-foreground"
                        >
                          {ORG_TYPE_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
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
    </div>
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
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("thread") ?? null;
  });
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
      queryClient.setQueryData(["/api/gmail/messages", "inbox", searchQuery], update);
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

  // null = user's personal account (default); number = shared account id
  const [activeAccountId, setActiveAccountId] = useState<number | null>(null);

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
  // Resolve which account is "active" — the selected shared account or the user's personal one
  const connectedAccount = activeAccountId
    ? (accountsQuery.data?.find((a) => a.id === activeAccountId) ?? accountsQuery.data?.[0] ?? null)
    : (accountsQuery.data?.find((a) => a.isOwner) ?? accountsQuery.data?.[0] ?? null);

  // Shared accounts visible to this user — filtered by mail_team permissions
  const sharedAccounts = (accountsQuery.data ?? []).filter((a) => {
    if (a.isOwner) return false;
    if (isAdmin) return true;
    const entry = mailTeamPerms[String(a.id)];
    // If no entry configured yet, default to visible
    return entry ? entry.view !== false : true;
  });
  const personalAccount = (accountsQuery.data ?? []).find((a) => a.isOwner) ?? null;

  // Helper to append asAccountId to URLSearchParams when viewing a shared account
  const appendAccountId = (params: URLSearchParams) => {
    if (activeAccountId) params.set("asAccountId", String(activeAccountId));
  };

  // canSend: account must be active AND user must have edit permission for shared inboxes
  const canSend = (() => {
    if (connectedAccount?.authStatus !== "active") return false;
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
  });

  // Reset extra pages when the base query data refreshes (e.g. search change or account switch)
  const inboxBaseToken = inboxQuery.data?.nextPageToken ?? null;
  const sentBaseToken = sentQuery.data?.nextPageToken ?? null;
  useEffect(() => { setInboxExtra([]); setInboxNextToken(inboxBaseToken); }, [inboxQuery.data]);
  useEffect(() => { setSentExtra([]); setSentNextToken(sentBaseToken); }, [sentQuery.data]);

  const loadMoreInbox = async () => {
    if (!inboxNextToken || loadingMoreInbox) return;
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
      setInboxExtra((prev) => [...prev, ...data.messages]);
      setInboxNextToken(data.nextPageToken);
    } catch {
      toast({ title: "Failed to load more", variant: "destructive" });
    } finally {
      setLoadingMoreInbox(false);
    }
  };

  const loadMoreSent = async () => {
    if (!sentNextToken || loadingMoreSent) return;
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
      setSentExtra((prev) => [...prev, ...data.messages]);
      setSentNextToken(data.nextPageToken);
    } catch {
      toast({ title: "Failed to load more", variant: "destructive" });
    } finally {
      setLoadingMoreSent(false);
    }
  };

  const threadQuery = useQuery<Thread>({
    queryKey: ["/api/gmail/threads", selectedThreadId, activeAccountId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (activeAccountId) params.set("asAccountId", String(activeAccountId));
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
    enabled: canSend && tab === "drafts",
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

  const allInboxMessages = [...(inboxQuery.data?.messages || []), ...inboxExtra];
  const allSentMessages = [...(sentQuery.data?.messages || []), ...sentExtra];

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
  const isLoading = tab === "other" ? inboxQuery.isLoading : tab === "inbox" ? inboxQuery.isLoading : sentQuery.isLoading;
  const error = tab === "other" ? inboxQuery.error : tab === "inbox" ? inboxQuery.error : sentQuery.error;
  const hasMore = tab === "inbox" ? !!inboxNextToken : tab === "sent" ? !!sentNextToken : false;
  const isLoadingMore = tab === "inbox" ? loadingMoreInbox : tab === "sent" ? loadingMoreSent : false;
  const loadMore = tab === "inbox" ? loadMoreInbox : loadMoreSent;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(search);
    setSelectedMessageId(null);
    setSelectedThreadId(null);
  };

  const handleSelectMessage = (msg: MessageSummary) => {
    setSelectedMessageId(msg.id);
    setSelectedThreadId(msg.threadId);

    if (isUnread(msg.labelIds)) {
      // Optimistically remove UNREAD from both inbox query caches immediately
      const removeUnread = (old: { messages: MessageSummary[]; nextPageToken: string | null } | undefined) =>
        old ? { ...old, messages: old.messages.map((m) =>
          m.id === msg.id ? { ...m, labelIds: m.labelIds.filter((l) => l !== "UNREAD") } : m
        ) } : old;
      queryClient.setQueryData(["/api/gmail/messages", "inbox", searchQuery], removeUnread);
      queryClient.setQueryData(["/api/gmail/messages", "sent", searchQuery], removeUnread);
      // Also update the locally-stored extra pages
      setInboxExtra((prev) => prev.map((m) => m.id === msg.id ? { ...m, labelIds: m.labelIds.filter((l) => l !== "UNREAD") } : m));
      setSentExtra((prev) => prev.map((m) => m.id === msg.id ? { ...m, labelIds: m.labelIds.filter((l) => l !== "UNREAD") } : m));

      // Fire-and-forget — tell Gmail to mark it read server-side
      fetch(`/api/gmail/messages/${msg.id}/mark-read`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(activeAccountId ? { asAccountId: activeAccountId } : {}),
      }).catch(() => {/* silent — cache already updated */});
    }
  };

  const handleBack = () => {
    setSelectedMessageId(null);
    setSelectedThreadId(null);
  };

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

  // ── Keyboard navigation ────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const list = tab === "drafts" || tab === "scheduled" || tab === "folder" ? [] : activeMessages;
      const currentIdx = list.findIndex(m => m.threadId === selectedThreadId);

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          if (list.length > 0) {
            const next = currentIdx < list.length - 1 ? currentIdx + 1 : 0;
            handleSelectMessage(list[next]);
          }
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          if (list.length > 0 && currentIdx > 0) {
            handleSelectMessage(list[currentIdx - 1]);
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
        case "Escape":
          if (selectedThreadId) { e.preventDefault(); handleBack(); }
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [tab, activeMessages, selectedThreadId, focusedMsg, canSend]);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 sm:px-6 py-2.5 border-b border-border/40 bg-background/80 backdrop-blur-sm flex-shrink-0">
        <Mail className="h-4 w-4 text-primary/70" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-[13px] font-semibold leading-tight text-foreground/80" data-testid="text-page-title">Mail</h1>
            {profileQuery.data?.emailAddress && (
              <span className="text-[11px] text-muted-foreground/50 truncate hidden sm:block">{profileQuery.data.emailAddress}</span>
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
        <aside className="hidden md:flex flex-col w-56 flex-shrink-0 border-r border-border/50 bg-background">
          {/* Compose button */}
          {canSend && (
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
          )}

          <nav className="flex-1 overflow-y-auto py-1 px-2 space-y-0.5">

            {/* ── INBOX section label ───────────────────────────────── */}
            <div className="pb-0.5 pt-1 px-1">
              <span style={{ fontSize: "10px", letterSpacing: "0.08em" }} className="font-semibold uppercase text-muted-foreground/40">Inbox</span>
            </div>

            {/* Personal account row + subtabs when active */}
            {personalAccount ? (
              <>
                <button
                  onClick={() => { setActiveAccountId(null); setTab("inbox"); setSelectedMessageId(null); setSelectedThreadId(null); }}
                  data-testid="btn-account-personal"
                  className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md transition-colors ${activeAccountId === null ? "text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
                >
                  <span className={`flex-shrink-0 h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold ${activeAccountId === null ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                    {(personalAccount.displayName || personalAccount.emailAddress)[0].toUpperCase()}
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
                      className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-[12px] font-medium transition-colors ${tab === "inbox" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                      <Inbox className="h-3.5 w-3.5" /><span className="flex-1 text-left">Inbox</span>
                      {inboxUnreadCount > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium ${tab === "inbox" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>{inboxUnreadCount}</span>}
                    </button>
                    <button onClick={() => { setTab("sent"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid="nav-tab-sent"
                      className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-[12px] font-medium transition-colors ${tab === "sent" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                      <Send className="h-3.5 w-3.5" /><span className="flex-1 text-left">Sent</span>
                    </button>
                    {canSend && <>
                      <button onClick={() => { setTab("drafts"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid="nav-tab-drafts"
                        className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-[12px] font-medium transition-colors ${tab === "drafts" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                        <FileText className="h-3.5 w-3.5" /><span className="flex-1 text-left">Drafts</span>
                        {(draftsQuery.data?.length ?? 0) > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium ${tab === "drafts" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>{draftsQuery.data?.length}</span>}
                      </button>
                      <button onClick={() => { setTab("scheduled"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid="nav-tab-scheduled"
                        className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-[12px] font-medium transition-colors ${tab === "scheduled" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                        <CalendarClock className="h-3.5 w-3.5" /><span className="flex-1 text-left">Scheduled</span>
                        {(scheduledQuery.data?.length ?? 0) > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium ${tab === "scheduled" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>{scheduledQuery.data?.length}</span>}
                      </button>
                    </>}
                    <button onClick={() => { setTab("other"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid="nav-tab-other"
                      className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-[12px] font-medium transition-colors ${tab === "other" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                      <FolderX className="h-3.5 w-3.5" /><span className="flex-1 text-left">Other</span>
                      {inboxOther.length > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium bg-muted text-muted-foreground">{inboxOther.length}</span>}
                    </button>
                    {((reviewStatsQuery.data?.needsReview ?? 0) > 0 || tab === "review") && (
                      <button onClick={() => { setTab("review"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid="nav-tab-review"
                        className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-[12px] font-medium transition-colors ${tab === "review" ? "bg-amber-500/15 text-amber-400" : "text-amber-500/80 hover:bg-amber-500/10 hover:text-amber-400"}`}>
                        <ShieldCheck className="h-3.5 w-3.5" /><span className="flex-1 text-left">CRM Review</span>
                        {(reviewStatsQuery.data?.needsReview ?? 0) > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium ${tab === "review" ? "bg-amber-500/30 text-amber-300" : "bg-amber-500/20 text-amber-400"}`}>{reviewStatsQuery.data!.needsReview}</span>}
                      </button>
                    )}
                    {/* Folders under personal */}
                    <div className="pt-1.5 pb-0.5 flex items-center justify-between pr-1">
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
                        <div key={folder.id} className={`group flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer transition-colors text-[12px] font-medium ${isFolderActive ? "bg-primary/15 text-primary" : "hover:bg-muted/50 text-muted-foreground hover:text-foreground"}`}
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
                <div className="pt-3 pb-0.5 px-1">
                  <span style={{ fontSize: "10px", letterSpacing: "0.08em" }} className="font-semibold uppercase text-muted-foreground/40">Team Inboxes</span>
                </div>
                {sharedAccounts.map((acct) => {
                  const isThisActive = activeAccountId === acct.id;
                  const letter = acct.emailAddress[0].toUpperCase();
                  return (
                    <div key={acct.id}>
                      <button
                        onClick={() => { setActiveAccountId(acct.id); setTab("inbox"); setSelectedMessageId(null); setSelectedThreadId(null); }}
                        data-testid={`btn-account-shared-${acct.id}`}
                        title={acct.emailAddress}
                        className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md transition-colors ${isThisActive ? "text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
                      >
                        <span className={`flex-shrink-0 h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold ${isThisActive ? "bg-teal-500 text-white" : "bg-teal-900/60 text-teal-300"}`}>
                          {letter}
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
                            className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-[12px] font-medium transition-colors ${tab === "inbox" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                            <Inbox className="h-3.5 w-3.5" /><span className="flex-1 text-left">Inbox</span>
                            {inboxUnreadCount > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium ${tab === "inbox" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>{inboxUnreadCount}</span>}
                          </button>
                          <button onClick={() => { setTab("sent"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid={`nav-tab-sent-${acct.id}`}
                            className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-[12px] font-medium transition-colors ${tab === "sent" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                            <Send className="h-3.5 w-3.5" /><span className="flex-1 text-left">Sent</span>
                          </button>
                          {canSend && <>
                            <button onClick={() => { setTab("drafts"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid={`nav-tab-drafts-${acct.id}`}
                              className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-[12px] font-medium transition-colors ${tab === "drafts" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                              <FileText className="h-3.5 w-3.5" /><span className="flex-1 text-left">Drafts</span>
                              {(draftsQuery.data?.length ?? 0) > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium ${tab === "drafts" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>{draftsQuery.data?.length}</span>}
                            </button>
                            <button onClick={() => { setTab("scheduled"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid={`nav-tab-scheduled-${acct.id}`}
                              className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-[12px] font-medium transition-colors ${tab === "scheduled" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                              <CalendarClock className="h-3.5 w-3.5" /><span className="flex-1 text-left">Scheduled</span>
                              {(scheduledQuery.data?.length ?? 0) > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium ${tab === "scheduled" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>{scheduledQuery.data?.length}</span>}
                            </button>
                          </>}
                          <button onClick={() => { setTab("other"); setSelectedMessageId(null); setSelectedThreadId(null); }} data-testid={`nav-tab-other-${acct.id}`}
                            className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-[12px] font-medium transition-colors ${tab === "other" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                            <FolderX className="h-3.5 w-3.5" /><span className="flex-1 text-left">Other</span>
                            {inboxOther.length > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full min-w-5 text-center font-medium bg-muted text-muted-foreground">{inboxOther.length}</span>}
                          </button>
                          {/* Folders under each team inbox */}
                          <div className="pt-1.5 pb-0.5 flex items-center justify-between pr-1">
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
                              <div key={folder.id} className={`group flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer transition-colors text-[12px] font-medium ${isFolderActive ? "bg-primary/15 text-primary" : "hover:bg-muted/50 text-muted-foreground hover:text-foreground"}`}
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
                      <p className="text-[10px] text-muted-foreground truncate">Synced {new Date(connectedAccount.lastSyncAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
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
        <div className={`flex flex-col min-h-0 border-r border-border/50 bg-background ${selectedThreadId ? "hidden md:flex md:w-72 flex-shrink-0" : "flex-1 md:w-72 md:flex-initial"}`}>
          {/* Category pills + Search */}
          <div className="flex-shrink-0 p-3 space-y-2 border-b border-border/50">
            {tab === "inbox" && (
              <div className="flex gap-1 flex-wrap">
                {([
                  { key: "all",         label: "All",         icon: <Inbox className="h-3 w-3" />,     count: inboxMain.length },
                  { key: "priority",    label: "Priority",    icon: <Star className="h-3 w-3" />,      count: priorityCount },
                  { key: "people",      label: "People",      icon: <Users className="h-3 w-3" />,     count: peopleCount },
                  { key: "newsletters", label: "Newsletters", icon: <Newspaper className="h-3 w-3" />, count: newslettersCount },
                  { key: "updates",     label: "Updates",     icon: <Bell className="h-3 w-3" />,      count: updatesCount },
                ] as { key: InboxCategory; label: string; icon: React.ReactNode; count: number }[]).map(({ key, label, icon, count }) => (
                  <button
                    key={key}
                    onClick={() => setInboxCategory(key)}
                    data-testid={`inbox-category-${key}`}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                      inboxCategory === key
                        ? key === "priority"
                          ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                          : "bg-primary/15 text-primary border border-primary/30"
                        : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {icon}
                    {label}
                    {count > 0 && <span className="ml-0.5 opacity-70">{count}</span>}
                  </button>
                ))}
              </div>
            )}
            <form onSubmit={handleSearch} className="flex gap-1">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search emails..."
                  className="pl-7 h-8 text-sm"
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

          {/* Message list */}
          <div className="flex-1 overflow-y-auto">
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
                          className="flex-1 text-left py-[9px] pr-3 min-w-0"
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
                        className="flex-1 text-left px-3 py-[9px] pr-10 min-w-0"
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
                        : "Gmail is not connected to VoltSafe Cortex."}
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
            {tab !== "drafts" && tab !== "scheduled" && tab !== "folder" && tab !== "review" && !isLoading && !error && tab !== "other" && activeMessages?.length === 0 && (
              statusQuery.data && !statusQuery.data.connected ? (
                <div className="p-8 text-center">
                  <Mail className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <p className="text-sm font-medium text-foreground mb-1">Connect Your Gmail Account</p>
                  <p className="text-xs text-muted-foreground mb-5">
                    Link your Google account to see your inbox inside VoltSafe Cortex.
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
            {tab !== "drafts" && tab !== "scheduled" && tab !== "folder" && tab !== "review" && activeMessages?.map((msg) => {
              const unread = isUnread(msg.labelIds);
              const starred = isStarred(msg.labelIds);
              const isSelected = msg.threadId === selectedThreadId;
              const domain = parseSenderDomain(msg.from);
              const blocked = blockedDomains.has(domain);
              const senderName = tab === "sent"
                ? (msg.to ? `→ ${parseSenderName(msg.to)}` : "Unknown")
                : parseSenderName(msg.from);
              return (
                <div
                  key={msg.id}
                  className={`relative group flex items-stretch transition-colors border-b border-border/20 ${
                    isSelected
                      ? "bg-primary/8 border-l-[3px] border-l-primary"
                      : "border-l-[3px] border-l-transparent hover:bg-muted/25"
                  }`}
                >
                  <button
                    onClick={() => handleSelectMessage(msg)}
                    data-testid={`email-row-${msg.id}`}
                    className="flex-1 text-left px-3 py-[9px] pr-14 min-w-0"
                  >
                    {/* Row 1: sender + timestamp */}
                    <div className="flex items-center justify-between gap-2 mb-[3px]">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {unread && (
                          <div className="w-[7px] h-[7px] rounded-full bg-primary flex-shrink-0" />
                        )}
                        <span className={`text-[13px] leading-none truncate ${
                          unread ? "font-semibold text-foreground" : "font-medium text-foreground/55"
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
                    <div className="text-[12px] leading-snug truncate">
                      <span className={unread ? "text-foreground/90 font-medium" : "text-muted-foreground/55"}>
                        {msg.subject || "(no subject)"}
                      </span>
                      {msg.snippet && (
                        <span className="text-muted-foreground/40"> — {msg.snippet}</span>
                      )}
                    </div>
                  </button>

                  {/* Hover actions — absolutely positioned right side */}
                  <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0">
                    <button
                      title={starred ? "Remove priority" : "Mark as priority"}
                      data-testid={`button-star-${msg.id}`}
                      onClick={(e) => { e.stopPropagation(); toggleStarMutation.mutate(msg.id); }}
                      className={`p-1.5 rounded-md transition-all ${
                        starred
                          ? "text-amber-400 hover:text-amber-300"
                          : "text-transparent group-hover:text-muted-foreground/35 hover:!text-amber-400"
                      }`}
                    >
                      <Star className={`h-3.5 w-3.5 ${starred ? "fill-amber-400" : ""}`} />
                    </button>
                    {canSend && tab !== "sent" && (
                      <button
                        title={blocked ? `Unblock @${domain}` : `Block @${domain}`}
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
                        className={`p-1.5 rounded-md transition-all opacity-0 group-hover:opacity-100 ${
                          blocked ? "text-amber-400 hover:text-amber-300" : "text-muted-foreground/35 hover:text-destructive"
                        }`}
                      >
                        {blocked ? <Trash2 className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Load more button */}
            {tab !== "drafts" && tab !== "scheduled" && !isLoading && !error && hasMore && (
              <div className="p-3 flex justify-center">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={loadMore}
                  disabled={isLoadingMore}
                  data-testid="button-load-more-emails"
                  className="w-full text-xs gap-1.5"
                >
                  {isLoadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {isLoadingMore ? "Loading..." : "Load more emails"}
                </Button>
              </div>
            )}
          </div>

        </div>

        {/* ── RIGHT PANEL: thread view + CRM context ─────────────────────── */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {selectedThreadId && tab !== "drafts" && tab !== "scheduled" && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Thread header */}
            <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-border/30 bg-background/80 backdrop-blur-sm">
              <Button variant="ghost" size="icon" className="md:hidden h-8 w-8" onClick={handleBack}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex-1 min-w-0">
                {threadQuery.isLoading ? (
                  <Skeleton className="h-4 w-48" />
                ) : (
                  <h2 className="font-semibold text-[13px] truncate text-foreground/90">{focusedMsg?.subject || "(no subject)"}</h2>
                )}
                {focusedMsg && (
                  <p className="text-[11px] text-muted-foreground/50 truncate">{selectedMessages.length} message{selectedMessages.length !== 1 ? "s" : ""}</p>
                )}
              </div>
              {focusedMsg && (
                <button
                  title={isStarred(focusedMsg.labelIds) ? "Remove priority" : "Mark as priority (s)"}
                  data-testid="button-star-thread"
                  onClick={() => toggleStarMutation.mutate(focusedMsg.id)}
                  className={`p-1.5 rounded-md transition-colors ${isStarred(focusedMsg.labelIds) ? "text-amber-400 hover:text-amber-300" : "text-muted-foreground/30 hover:text-amber-400"}`}
                >
                  <Star className={`h-4 w-4 ${isStarred(focusedMsg.labelIds) ? "fill-amber-400" : ""}`} />
                </button>
              )}
            </div>

            {/* Messages in thread */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
              {selectedMessages.map((msg, idx) => {
                const initials = parseSenderName(msg.from).split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
                const isLatest = idx === selectedMessages.length - 1;
                return (
                  <div
                    key={msg.id}
                    className={`rounded-xl border overflow-hidden transition-shadow ${
                      isLatest ? "border-border/60 shadow-sm" : "border-border/30 opacity-80"
                    }`}
                    data-testid={`email-message-${msg.id}`}
                  >
                    {/* Message header */}
                    <div className="bg-card/40 px-4 py-3 border-b border-border/25">
                      <div className="flex items-start gap-3">
                        {/* Avatar */}
                        <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[11px] font-bold flex-shrink-0 mt-0.5">
                          {initials || "?"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="font-semibold text-sm text-foreground leading-tight">{parseSenderName(msg.from)}</p>
                            <span className="text-[11px] text-muted-foreground/60 whitespace-nowrap flex-shrink-0 tabular-nums">
                              {formatDate(msg.date, msg.internalDate)}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5">{msg.from}</p>
                          <p className="text-[11px] text-muted-foreground/55 truncate">To: {msg.to}</p>
                          {msg.cc && <p className="text-[11px] text-muted-foreground/55 truncate">Cc: {msg.cc}</p>}
                        </div>
                      </div>
                    </div>
                    {/* Message body */}
                    <div className="px-5 py-4 bg-background/30">
                      <MessageBody body={msg.body} isHtml={msg.isHtml} />
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Sticky reply bar */}
            {canSend && focusedMsg && (
              <div className="flex-shrink-0 border-t border-border/30 bg-card/20 px-4 py-2.5 flex items-center gap-2">
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
            )}
            {/* CRM Context Panel */}
            <CrmContextPanel key={selectedThreadId} threadId={selectedThreadId!} userPermissions={userPermissions} isAdminUser={isAdmin} returnPath={returnPath} />
          </div>
        )}

        {/* Empty state when no message selected */}
        {!selectedThreadId && tab !== "drafts" && tab !== "scheduled" && (
          <div className="hidden md:flex flex-1 items-center justify-center text-muted-foreground">
            <div className="text-center space-y-6">
              <div>
                <MailOpen className="h-10 w-10 mx-auto mb-3 opacity-15" />
                <p className="text-sm text-muted-foreground/60">Select an email to read</p>
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/35">Keyboard shortcuts</p>
                <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-[11px] text-muted-foreground/50 text-left">
                  {[
                    ["j / ↓", "Next email"],
                    ["k / ↑", "Prev email"],
                    ["r", "Reply"],
                    ["c", "Compose"],
                    ["s", "Star / unstar"],
                    ["Esc", "Deselect"],
                  ].map(([key, desc]) => (
                    <div key={key} className="flex items-center gap-2">
                      <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted/60 border border-border/40 text-muted-foreground/70">{key}</kbd>
                      <span>{desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Compose / Reply dialog */}
      <ComposeDialog
        key={editingDraft?.draftId ?? (replyTo ? `reply-${replyTo.threadId}` : "compose")}
        open={composeOpen || !!replyTo || !!editingDraft}
        onClose={() => { setComposeOpen(false); setReplyTo(null); setEditingDraft(null); }}
        canSend={canSend}
        defaultTo={editingDraft?.to || replyTo?.to || ""}
        defaultCc={replyTo?.cc || ""}
        defaultSubject={editingDraft?.subject || replyTo?.subject || ""}
        defaultBody={editingDraft?.body || ""}
        draftId={editingDraft?.draftId}
        threadId={editingDraft?.threadId || replyTo?.threadId}
        asAccountId={activeAccountId ?? undefined}
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
