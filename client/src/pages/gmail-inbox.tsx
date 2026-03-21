import { useState, useCallback } from "react";
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

function isUnread(labelIds: string[]) {
  return labelIds.includes("UNREAD");
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
  threadId,
}: {
  open: boolean;
  onClose: () => void;
  canSend: boolean;
  defaultTo?: string;
  defaultSubject?: string;
  threadId?: string;
}) {
  const { toast } = useToast();
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState("");

  const sendMutation = useMutation({
    mutationFn: async () => {
      const htmlBody = buildEmailHtml(body);
      const res = await apiRequest("POST", "/api/gmail/send", { to, subject, body: htmlBody, threadId });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Email sent" });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Failed to send", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{threadId ? "Reply" : "New Email"}</DialogTitle>
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

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            {canSend && (
              <Button size="sm" onClick={() => sendMutation.mutate()} disabled={!to || !body || sendMutation.isPending} data-testid="button-send-email">
                {sendMutation.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Sending...</> : <><Send className="h-4 w-4 mr-1" /> Send</>}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
  const [tab, setTab] = useState<"inbox" | "sent" | "other">("inbox");

  const filtersQuery = useQuery<EmailFilter[]>({
    queryKey: ["/api/email-filters"],
    queryFn: async () => {
      const res = await fetch("/api/email-filters", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const blockedDomains = new Set((filtersQuery.data || []).map((f) => f.domain));

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

  const canSend = currentUserEmail === "trevor@voltsafe.com";

  const statusQuery = useQuery<{ connected: boolean; hasCredentials: boolean }>({
    queryKey: ["/api/gmail/status"],
    queryFn: async () => {
      const res = await fetch("/api/gmail/status", { credentials: "include" });
      if (!res.ok) return { connected: false, hasCredentials: false };
      return res.json();
    },
    retry: false,
  });

  const inboxQuery = useQuery<MessageSummary[]>({
    queryKey: ["/api/gmail/messages", "inbox", searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", "50");
      if (searchQuery) {
        params.set("q", `in:inbox ${searchQuery}`);
      } else {
        params.set("q", "in:inbox");
      }
      const res = await fetch(`/api/gmail/messages?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
  });

  const sentQuery = useQuery<MessageSummary[]>({
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

  const inboxMain = (inboxQuery.data || []).filter((m) => !blockedDomains.has(parseSenderDomain(m.from)));
  const inboxOther = (inboxQuery.data || []).filter((m) => blockedDomains.has(parseSenderDomain(m.from)));

  const activeMessages =
    tab === "inbox" ? inboxMain :
    tab === "sent"  ? sentQuery.data :
    inboxOther;
  const isLoading = tab === "other" ? inboxQuery.isLoading : tab === "inbox" ? inboxQuery.isLoading : sentQuery.isLoading;
  const error = tab === "other" ? inboxQuery.error : tab === "inbox" ? inboxQuery.error : sentQuery.error;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(search);
    setSelectedMessageId(null);
    setSelectedThreadId(null);
  };

  const handleSelectMessage = (msg: MessageSummary) => {
    setSelectedMessageId(msg.id);
    setSelectedThreadId(msg.threadId);
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

      <div className="flex flex-1 min-h-0">
        {/* Left panel: message list */}
        <div className={`flex flex-col border-r border-border/50 bg-background ${selectedThreadId ? "hidden md:flex md:w-80 lg:w-96 flex-shrink-0" : "flex-1 md:w-80 lg:w-96 md:flex-initial"}`}>
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
            </div>
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
            {isLoading && (
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
            {error && (
              <div className="p-8 text-center">
                <Mail className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium text-foreground mb-1">Could not load emails.</p>
                {statusQuery.data && !statusQuery.data.connected ? (
                  <>
                    <p className="text-xs text-muted-foreground mb-4">Gmail is not connected to VoltSafe Cortex.</p>
                    {canSend && statusQuery.data.hasCredentials && (
                      <a
                        href="/api/auth/gmail/connect"
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                        data-testid="button-connect-gmail"
                      >
                        <Mail className="w-4 h-4" />
                        Connect Gmail Account
                      </a>
                    )}
                    {canSend && !statusQuery.data.hasCredentials && (
                      <p className="text-xs text-red-400">Google credentials not configured. Ask your admin to set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.</p>
                    )}
                  </>
                ) : (
                  <p className="text-xs mt-1 text-red-400">{(error as Error).message}</p>
                )}
              </div>
            )}
            {!isLoading && !error && tab !== "other" && activeMessages?.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                <Inbox className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p>No messages found</p>
              </div>
            )}
            {tab === "other" && inboxOther.length === 0 && !isLoading && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                <FolderX className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p>No filtered emails</p>
              </div>
            )}
            {activeMessages?.map((msg) => {
              const unread = isUnread(msg.labelIds);
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
                    className="w-full text-left px-3 py-2.5 pr-8 transition-colors hover:bg-muted/50"
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
                  {tab !== "sent" && (
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
                      className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity ${blocked ? "text-amber-400 hover:text-amber-300" : "text-muted-foreground/50 hover:text-destructive"}`}
                    >
                      {blocked ? <Trash2 className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right panel: thread view */}
        {selectedThreadId && (
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
        {!selectedThreadId && (
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
        open={composeOpen || !!replyTo}
        onClose={() => { setComposeOpen(false); setReplyTo(null); }}
        canSend={canSend}
        defaultTo={replyTo?.to || ""}
        defaultSubject={replyTo?.subject || ""}
        threadId={replyTo?.threadId}
      />
    </div>
  );
}
