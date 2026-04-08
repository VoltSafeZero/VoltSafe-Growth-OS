import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Search, Mail, MailOpen, Send, RefreshCw, Inbox, X, ChevronLeft, Loader2, Link2, Ban, FolderX, Trash2,
  Clock, FileText, CalendarClock, CalendarX, Paperclip, Star, Users, Newspaper, Bell, Receipt, Download,
  FolderOpen, FolderPlus, Settings2, Globe, Plus, ChevronDown, ChevronRight, Folder,
} from "lucide-react";
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
  defaultSubject = "",
  defaultBody = "",
  threadId,
  draftId,
}: {
  open: boolean;
  onClose: () => void;
  canSend: boolean;
  defaultTo?: string;
  defaultSubject?: string;
  defaultBody?: string;
  threadId?: string;
  draftId?: string;
}) {
  const { toast } = useToast();
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
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
        attachmentIds: attachedAssets.map((a) => a.id),
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
      const res = await apiRequest("POST", "/api/gmail/schedule", { to, subject, body: htmlBody, threadId, scheduledAt });
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
  if (!body) return <p className="text-muted-foreground text-sm italic">No content</p>;
  if (isHtml) {
    const clean = DOMPurify.sanitize(body, { USE_PROFILES: { html: true } });
    return (
      <div
        className="prose prose-sm dark:prose-invert max-w-none text-sm overflow-auto"
        dangerouslySetInnerHTML={{ __html: clean }}
      />
    );
  }
  return <pre className="text-sm whitespace-pre-wrap font-sans text-foreground">{body}</pre>;
}

export default function GmailInboxPage({ currentUserEmail }: { currentUserEmail: string }) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<{ to: string; subject: string; threadId: string } | null>(null);
  const [tab, setTab] = useState<"inbox" | "sent" | "other" | "drafts" | "scheduled" | "folder">("inbox");
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
      const res = await apiRequest("POST", `/api/gmail/messages/${msgId}/toggle-star`);
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
  const connectedAccount = accountsQuery.data?.[0] ?? null;

  // Any user with an active connected Gmail account can send
  const canSend = connectedAccount?.authStatus === "active";

  const inboxQuery = useQuery<{ messages: MessageSummary[]; nextPageToken: string | null }>({
    queryKey: ["/api/gmail/messages", "inbox", searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", "50");
      params.set("q", searchQuery ? `in:inbox ${searchQuery}` : "in:inbox");
      const res = await fetch(`/api/gmail/messages?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
  });

  const sentQuery = useQuery<{ messages: MessageSummary[]; nextPageToken: string | null }>({
    queryKey: ["/api/gmail/messages", "sent", searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", "50");
      params.set("q", searchQuery ? `in:sent ${searchQuery}` : "in:sent");
      const res = await fetch(`/api/gmail/messages?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    enabled: tab === "sent",
  });

  // Reset extra pages when the base query data refreshes (e.g. search change)
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
    queryKey: ["/api/gmail/threads", selectedThreadId],
    queryFn: async () => {
      const res = await fetch(`/api/gmail/threads/${selectedThreadId}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    enabled: !!selectedThreadId,
  });

  const profileQuery = useQuery({
    queryKey: ["/api/gmail/profile"],
    queryFn: async () => {
      const res = await fetch("/api/gmail/profile", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    retry: false,
  });

  type DraftSummary = { id: string; to: string; subject: string; date: string; snippet: string; internalDate: string };
  type ScheduledEmail = { id: number; to: string; subject: string | null; scheduledAt: string; createdAt: string };

  const draftsQuery = useQuery<DraftSummary[]>({
    queryKey: ["/api/gmail/drafts"],
    queryFn: async () => {
      const res = await fetch("/api/gmail/drafts", { credentials: "include" });
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

  const selectedMessages = threadQuery.data?.messages || [];
  const focusedMsg = selectedMessages.find((m) => m.id === selectedMessageId) || selectedMessages[selectedMessages.length - 1];

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-border/50 bg-card/50 flex-shrink-0">
        <Mail className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-lg font-bold leading-tight" data-testid="text-page-title">Gmail Inbox</h1>
          {profileQuery.data?.emailAddress && (
            <p className="text-xs text-muted-foreground">{profileQuery.data.emailAddress}</p>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!canSend && (
            <Badge variant="outline" className="text-xs text-amber-400 border-amber-500/30">View Only</Badge>
          )}
          {canSend && (
            <Button size="sm" onClick={() => { setReplyTo(null); setComposeOpen(true); }} data-testid="button-compose">
              <Send className="h-4 w-4 mr-1" /> Compose
            </Button>
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
        {/* Left panel: message list */}
        <div className={`flex flex-col min-h-0 border-r border-border/50 bg-background ${selectedThreadId ? "hidden md:flex md:w-80 lg:w-96 flex-shrink-0" : "flex-1 md:w-80 lg:w-96 md:flex-initial"}`}>
          {/* Tabs + Search */}
          <div className="flex-shrink-0 p-3 space-y-2 border-b border-border/50">
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={tab === "inbox" ? "default" : "ghost"}
                className="flex-1"
                onClick={() => { setTab("inbox"); setSelectedMessageId(null); setSelectedThreadId(null); }}
                data-testid="tab-inbox"
              >
                <Inbox className="h-4 w-4 mr-1" /> Inbox
              </Button>
              <Button
                size="sm"
                variant={tab === "sent" ? "default" : "ghost"}
                className="flex-1"
                onClick={() => { setTab("sent"); setSelectedMessageId(null); setSelectedThreadId(null); }}
                data-testid="tab-sent"
              >
                <Send className="h-4 w-4 mr-1" /> Sent
              </Button>
              {canSend && (
                <Button
                  size="sm"
                  variant={tab === "other" ? "default" : "ghost"}
                  className="flex-1 relative"
                  onClick={() => { setTab("other"); setSelectedMessageId(null); setSelectedThreadId(null); }}
                  data-testid="tab-other"
                >
                  <FolderX className="h-4 w-4 mr-1" /> Other
                  {inboxOther.length > 0 && (
                    <span className="absolute -top-1 -right-1 h-4 min-w-4 px-0.5 rounded-full bg-muted-foreground/40 text-[10px] flex items-center justify-center">
                      {inboxOther.length}
                    </span>
                  )}
                </Button>
              )}
            </div>
            {canSend && (
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={tab === "drafts" ? "default" : "ghost"}
                  className="flex-1"
                  onClick={() => { setTab("drafts"); setSelectedMessageId(null); setSelectedThreadId(null); }}
                  data-testid="tab-drafts"
                >
                  <FileText className="h-4 w-4 mr-1" /> Drafts
                </Button>
                <Button
                  size="sm"
                  variant={tab === "scheduled" ? "default" : "ghost"}
                  className="flex-1 relative"
                  onClick={() => { setTab("scheduled"); setSelectedMessageId(null); setSelectedThreadId(null); }}
                  data-testid="tab-scheduled"
                >
                  <CalendarClock className="h-4 w-4 mr-1" /> Scheduled
                  {(scheduledQuery.data?.length ?? 0) > 0 && (
                    <span className="absolute -top-1 -right-1 h-4 min-w-4 px-0.5 rounded-full bg-primary/60 text-[10px] flex items-center justify-center">
                      {scheduledQuery.data?.length}
                    </span>
                  )}
                </Button>
              </div>
            )}
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

          {/* Custom Folders section */}
          <div className="flex-shrink-0 border-b border-border/30">
            <div className="px-3 py-1.5 flex items-center justify-between">
              <button
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setFoldersExpanded(!foldersExpanded)}
                data-testid="button-toggle-folders"
              >
                {foldersExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <span className="font-medium tracking-wide uppercase" style={{ fontSize: "10px", letterSpacing: "0.08em" }}>Custom Folders</span>
              </button>
              <button
                className="text-muted-foreground hover:text-foreground transition-colors rounded p-0.5 hover:bg-muted/60"
                onClick={() => setShowCreateFolder(true)}
                title="New folder"
                data-testid="button-new-folder"
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </button>
            </div>
            {foldersExpanded && (
              <div className="pb-1.5 px-1 space-y-0.5 max-h-48 overflow-y-auto">
                {foldersQuery.isLoading && (
                  <div className="px-2 py-1.5 space-y-1">
                    {[1, 2].map(i => <Skeleton key={i} className="h-6 w-full rounded" />)}
                  </div>
                )}
                {!foldersQuery.isLoading && (foldersQuery.data || []).length === 0 && (
                  <div className="px-2 py-2 text-xs text-muted-foreground/60 italic">
                    No folders yet. Create one to auto-sort emails by domain.
                  </div>
                )}
                {(foldersQuery.data || []).map((folder) => {
                  const isActive = tab === "folder" && selectedFolderId === folder.id;
                  return (
                    <div
                      key={folder.id}
                      className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${isActive ? "bg-primary/15 text-primary" : "hover:bg-muted/50 text-muted-foreground hover:text-foreground"}`}
                      onClick={() => { setTab("folder"); setSelectedFolderId(folder.id); setSelectedThreadId(null); setSelectedMessageId(null); }}
                      data-testid={`folder-row-${folder.id}`}
                    >
                      <Folder className={`h-3.5 w-3.5 flex-shrink-0 ${isActive ? "text-primary" : "text-teal-500/70"}`} />
                      <span className="text-xs flex-1 truncate font-medium">{folder.name}</span>
                      {folder.unreadCount > 0 && (
                        <span className="text-[10px] px-1 py-0.5 rounded-full bg-primary/20 text-primary font-medium min-w-4 text-center">
                          {folder.unreadCount}
                        </span>
                      )}
                      {folder.emailCount > 0 && folder.unreadCount === 0 && (
                        <span className="text-[10px] text-muted-foreground/50">{folder.emailCount}</span>
                      )}
                      <button
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground ml-0.5 flex-shrink-0"
                        onClick={(e) => { e.stopPropagation(); setShowFolderSettings(folder.id); }}
                        title="Folder settings"
                        data-testid={`button-folder-settings-${folder.id}`}
                      >
                        <Settings2 className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
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
                  const dateStr = email.sentAt ? new Date(email.sentAt).toLocaleDateString([], { month: "short", day: "numeric" }) : "";
                  return (
                    <div
                      key={email.id}
                      className={`group relative border-b border-border/30 ${isSelected ? "bg-primary/10 border-l-2 border-l-primary" : ""}`}
                    >
                      <button
                        onClick={() => { setSelectedThreadId(email.gmailThreadId); setSelectedMessageId(null); }}
                        data-testid={`folder-email-row-${email.id}`}
                        className="w-full text-left px-3 py-2.5 pr-10 transition-colors hover:bg-muted/50"
                      >
                        <div className="flex items-start justify-between gap-2 mb-0.5">
                          <span className="text-sm truncate font-medium text-foreground">{senderName}</span>
                          <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">{dateStr}</span>
                        </div>
                        <p className="text-xs truncate text-foreground/80">{email.subject || "(no subject)"}</p>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{email.snippet}</p>
                      </button>
                      <button
                        className="absolute right-2 top-2.5 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/40 hover:text-destructive"
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

            {tab !== "drafts" && tab !== "scheduled" && tab !== "folder" && isLoading && (
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
            {tab !== "drafts" && tab !== "scheduled" && tab !== "folder" && !isLoading && !error && tab !== "other" && activeMessages?.length === 0 && (
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
            {tab !== "drafts" && tab !== "scheduled" && tab !== "folder" && activeMessages?.map((msg) => {
              const unread = isUnread(msg.labelIds);
              const starred = isStarred(msg.labelIds);
              const isSelected = msg.threadId === selectedThreadId;
              const domain = parseSenderDomain(msg.from);
              const blocked = blockedDomains.has(domain);
              return (
                <div
                  key={msg.id}
                  className={`relative group border-b border-border/30 ${isSelected ? "bg-primary/10 border-l-2 border-l-primary" : ""}`}
                >
                  <button
                    onClick={() => handleSelectMessage(msg)}
                    data-testid={`email-row-${msg.id}`}
                    className="w-full text-left px-3 py-2.5 pr-14 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex items-start justify-between gap-2 mb-0.5">
                      <span className={`text-sm truncate ${unread ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                        {tab === "sent" ? (msg.to ? `To: ${parseSenderName(msg.to)}` : "Unknown") : parseSenderName(msg.from)}
                      </span>
                      <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                        {formatDate(msg.date, msg.internalDate)}
                      </span>
                    </div>
                    <p className={`text-xs truncate ${unread ? "text-foreground" : "text-muted-foreground"}`}>
                      {msg.subject || "(no subject)"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{msg.snippet}</p>
                    {unread && <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1" />}
                  </button>
                  <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                    {/* Star / Priority button — always visible if starred, else on hover */}
                    <button
                      title={starred ? "Remove priority" : "Mark as priority"}
                      data-testid={`button-star-${msg.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleStarMutation.mutate(msg.id);
                      }}
                      className={`p-1 rounded transition-all ${
                        starred
                          ? "text-amber-400 hover:text-amber-300"
                          : "text-muted-foreground/30 opacity-0 group-hover:opacity-100 hover:text-amber-400"
                      }`}
                    >
                      <Star className={`h-3.5 w-3.5 ${starred ? "fill-amber-400" : ""}`} />
                    </button>
                    {/* Block/unblock button */}
                    {canSend && tab !== "sent" && (
                      <button
                        title={blocked ? `Unblock @${domain}` : `Block all email from @${domain}`}
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
                        className={`p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity ${blocked ? "text-amber-400 hover:text-amber-300" : "text-muted-foreground/50 hover:text-destructive"}`}
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

          {/* ── S2: Connected account status footer ────────────────────── */}
          {connectedAccount && (
            <div className="flex-shrink-0 border-t border-border/40 bg-card/30 px-3 py-2">
              <div className="flex items-center gap-2">
                {/* Status dot */}
                <span
                  className={`flex-shrink-0 h-2 w-2 rounded-full ${
                    connectedAccount.authStatus === "active"
                      ? "bg-emerald-400"
                      : connectedAccount.authStatus === "expired"
                      ? "bg-amber-400"
                      : "bg-red-400"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p
                    className="text-xs font-medium text-foreground truncate"
                    data-testid="text-connected-email"
                  >
                    {connectedAccount.emailAddress}
                  </p>
                  {connectedAccount.lastSyncAt ? (
                    <p className="text-[10px] text-muted-foreground truncate">
                      Synced {new Date(connectedAccount.lastSyncAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  ) : (
                    <p className="text-[10px] text-muted-foreground">
                      {connectedAccount.authStatus === "active" ? "Never synced" : connectedAccount.authStatus}
                    </p>
                  )}
                </div>
                {/* Actions */}
                {connectedAccount.authStatus !== "active" && canSend ? (
                  <a
                    href="/api/auth/gmail/connect"
                    className="flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors whitespace-nowrap"
                    data-testid="button-reconnect-account-footer"
                  >
                    Reconnect
                  </a>
                ) : (
                  <button
                    title="Resync this account"
                    data-testid="button-resync-account-footer"
                    onClick={async () => {
                      try {
                        await fetch(`/api/gmail/accounts/${connectedAccount.id}/resync?limit=100`, {
                          method: "POST",
                          credentials: "include",
                        });
                        syncMutation.mutate(undefined);
                      } catch {}
                    }}
                    className="flex-shrink-0 p-1 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted/50 transition-colors"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right panel: thread view */}
        {selectedThreadId && tab !== "drafts" && tab !== "scheduled" && (
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            {/* Thread header */}
            <div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-card/30">
              <Button variant="ghost" size="icon" className="md:hidden" onClick={handleBack}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex-1 min-w-0">
                {threadQuery.isLoading ? (
                  <Skeleton className="h-5 w-48" />
                ) : (
                  <h2 className="font-semibold text-sm truncate">{focusedMsg?.subject || "(no subject)"}</h2>
                )}
              </div>
              {focusedMsg && (
                <button
                  title={isStarred(focusedMsg.labelIds) ? "Remove priority" : "Mark as priority"}
                  data-testid="button-star-thread"
                  onClick={() => toggleStarMutation.mutate(focusedMsg.id)}
                  className={`p-1.5 rounded transition-colors ${isStarred(focusedMsg.labelIds) ? "text-amber-400 hover:text-amber-300" : "text-muted-foreground/40 hover:text-amber-400"}`}
                >
                  <Star className={`h-4 w-4 ${isStarred(focusedMsg.labelIds) ? "fill-amber-400" : ""}`} />
                </button>
              )}
              {canSend && focusedMsg && (
                <Button size="sm" variant="outline" onClick={() => handleReply(focusedMsg)} data-testid="button-reply">
                  Reply
                </Button>
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
              {selectedMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`border rounded-lg overflow-hidden ${msg.id === selectedMessageId ? "border-primary/40" : "border-border/50"}`}
                  data-testid={`email-message-${msg.id}`}
                >
                  {/* Message header */}
                  <div className="bg-card/50 px-4 py-2.5 border-b border-border/30">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm">{parseSenderName(msg.from)}</p>
                        <p className="text-xs text-muted-foreground">{msg.from}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">To: {msg.to}</p>
                        {msg.cc && <p className="text-xs text-muted-foreground">Cc: {msg.cc}</p>}
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                        {formatDate(msg.date, msg.internalDate)}
                      </span>
                    </div>
                  </div>
                  {/* Message body */}
                  <div className="px-4 py-3 bg-background/50">
                    <MessageBody body={msg.body} isHtml={msg.isHtml} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state when no message selected */}
        {!selectedThreadId && tab !== "drafts" && tab !== "scheduled" && (
          <div className="hidden md:flex flex-1 items-center justify-center text-muted-foreground">
            <div className="text-center">
              <MailOpen className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">Select an email to read</p>
            </div>
          </div>
        )}
      </div>

      {/* Compose / Reply dialog */}
      <ComposeDialog
        key={editingDraft?.draftId ?? "compose"}
        open={composeOpen || !!replyTo || !!editingDraft}
        onClose={() => { setComposeOpen(false); setReplyTo(null); setEditingDraft(null); }}
        canSend={canSend}
        defaultTo={editingDraft?.to || replyTo?.to || ""}
        defaultSubject={editingDraft?.subject || replyTo?.subject || ""}
        defaultBody={editingDraft?.body || ""}
        draftId={editingDraft?.draftId}
        threadId={editingDraft?.threadId || replyTo?.threadId}
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
