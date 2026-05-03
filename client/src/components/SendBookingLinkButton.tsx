import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  CalendarDays, CheckCircle2, Copy, Eye, Link2, Loader2, Mail,
  Send, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type BookingLink = {
  id: number;
  name: string;
  description: string | null;
  slug: string;
  active: boolean;
  locationType: string;
};

type RecipientStatus = "not_sent" | "sent" | "opened" | "booked";

type RecipientRow = {
  recipientId: number;
  bookingLinkId: number;
  bookingLinkName: string;
  recipientEmail: string;
  status: RecipientStatus;
  sentAt: string | null;
  firstViewedAt: string | null;
  viewCount: number;
  bookedAt: string | null;
  bookedCalendarEventId: number | null;
  revokedAt: string | null;
  publicUrl: string;
  createdAt: string;
};

type Props = {
  objectType: "contact" | "lead";
  objectId: number;
  recipientEmail: string | null;
  recipientName?: string | null;
  /** Optional render-as control. Defaults to a small outline Button. */
  trigger?: React.ReactNode;
};

const STATUS_META: Record<RecipientStatus, { label: string; cls: string; icon: React.ComponentType<{ className?: string }> }> = {
  not_sent: { label: "Not sent",  cls: "bg-secondary/40 text-muted-foreground border-border",                      icon: Mail },
  sent:     { label: "Sent",      cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",       icon: Send },
  opened:   { label: "Opened",    cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",   icon: Eye },
  booked:   { label: "Booked",    cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30", icon: CheckCircle2 },
};

export function StatusBadge({ status }: { status: RecipientStatus }) {
  const m = STATUS_META[status];
  const Icon = m.icon;
  return (
    <Badge variant="outline" className={`gap-1 text-xs ${m.cls}`} data-testid={`badge-booking-status-${status}`}>
      <Icon className="h-3 w-3" /> {m.label}
    </Badge>
  );
}

export function SendBookingLinkButton({
  objectType, objectId, recipientEmail, recipientName, trigger,
}: Props) {
  const [open, setOpen] = useState(false);
  const [linkId, setLinkId] = useState<string>("");
  const [emailOverride, setEmailOverride] = useState(recipientEmail ?? "");
  const [message, setMessage] = useState("");
  const { toast } = useToast();

  const { data: links, isLoading: linksLoading } = useQuery<BookingLink[]>({
    queryKey: ["/api/booking-links"],
    enabled: open,
  });

  const statusKey = ["/api/crm/booking-link-status", objectType, objectId] as const;
  const { data: statusData } = useQuery<{ recipients: RecipientRow[] }>({
    queryKey: statusKey,
    queryFn: async () => {
      const res = await fetch(
        `/api/crm/booking-link-status?objectType=${objectType}&objectId=${objectId}`,
        { credentials: "include" });
      return res.json();
    },
    enabled: open,
  });

  const sendMut = useMutation({
    mutationFn: async () => {
      const id = parseInt(linkId, 10);
      if (!id) throw new Error("Pick a booking link");
      const body: any = {
        bookingLinkId: id,
        objectType,
        objectId,
        customMessage: message || undefined,
      };
      if (emailOverride && emailOverride !== recipientEmail) {
        body.recipientEmailOverride = emailOverride;
      }
      const res = await apiRequest("POST", "/api/crm/booking-link-send", body);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Send failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Booking link sent", description: `Emailed ${emailOverride}` });
      queryClient.invalidateQueries({ queryKey: statusKey });
      setMessage("");
    },
    onError: (e: any) => toast({ title: "Could not send link", description: e.message, variant: "destructive" }),
  });

  const resendMut = useMutation({
    mutationFn: async (recipientId: number) => {
      const res = await apiRequest("POST", `/api/crm/booking-link-recipients/${recipientId}/resend`, {});
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Resend failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Booking link re-sent" });
      queryClient.invalidateQueries({ queryKey: statusKey });
    },
    onError: (e: any) => toast({ title: "Could not resend", description: e.message, variant: "destructive" }),
  });

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied to clipboard" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const previewUrl = (() => {
    const id = parseInt(linkId, 10);
    const existing = statusData?.recipients.find(
      (r) => r.bookingLinkId === id && r.recipientEmail.toLowerCase() === (emailOverride || "").toLowerCase());
    return existing?.publicUrl || null;
  })();

  return (
    <>
      <span onClick={() => setOpen(true)} data-testid={`open-send-booking-${objectType}-${objectId}`}>
        {trigger ?? (
          <Button size="sm" variant="outline" className="gap-1.5 w-full sm:w-auto">
            <CalendarDays className="h-3.5 w-3.5" /> Send booking link
          </Button>
        )}
      </span>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" /> Send a booking link
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="bk-link">Booking link</Label>
              {linksLoading ? (
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                </div>
              ) : (links && links.filter((l) => l.active).length === 0) ? (
                <div className="text-sm text-muted-foreground border border-dashed border-border/60 rounded-md p-3">
                  You don't have any active booking links yet. Create one first.
                </div>
              ) : (
                <Select value={linkId} onValueChange={setLinkId}>
                  <SelectTrigger data-testid="select-booking-link"><SelectValue placeholder="Pick a booking link" /></SelectTrigger>
                  <SelectContent>
                    {(links || []).filter((l) => l.active).map((l) => (
                      <SelectItem key={l.id} value={String(l.id)} data-testid={`select-booking-link-option-${l.id}`}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bk-email">Recipient email</Label>
              <Input
                id="bk-email"
                value={emailOverride}
                onChange={(e) => setEmailOverride(e.target.value)}
                placeholder="someone@example.com"
                data-testid="input-recipient-email"
              />
              {recipientName && (
                <p className="text-xs text-muted-foreground">
                  For <span className="font-medium text-foreground">{recipientName}</span>
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bk-msg">Personal note (optional)</Label>
              <Textarea
                id="bk-msg"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Looking forward to chatting…"
                rows={3}
                maxLength={2000}
                data-testid="input-custom-message"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => sendMut.mutate()}
                disabled={!linkId || !emailOverride || sendMut.isPending}
                className="gap-1.5"
                data-testid="button-send-booking-link"
              >
                {sendMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Send via email
              </Button>
              {previewUrl && (
                <Button
                  variant="outline"
                  onClick={() => copyLink(previewUrl)}
                  className="gap-1.5"
                  data-testid="button-copy-booking-link"
                >
                  <Copy className="h-3.5 w-3.5" /> Copy link
                </Button>
              )}
            </div>

            {/* History */}
            {statusData?.recipients && statusData.recipients.length > 0 && (
              <div className="border-t border-border/50 pt-3 mt-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  History · {statusData.recipients.length}
                </p>
                <div className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1">
                  {statusData.recipients.map((r) => (
                    <div
                      key={r.recipientId}
                      className="flex items-start gap-2 p-2.5 rounded-md border border-border/50 bg-card"
                      data-testid={`row-recipient-${r.recipientId}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate" data-testid={`text-recipient-link-name-${r.recipientId}`}>
                            {r.bookingLinkName}
                          </span>
                          <StatusBadge status={r.status} />
                          {r.revokedAt && (
                            <Badge variant="outline" className="gap-1 text-xs bg-red-500/10 text-red-600 border-red-500/30">
                              <XCircle className="h-3 w-3" /> Revoked
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{r.recipientEmail}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {r.bookedAt
                            ? `Booked ${format(new Date(r.bookedAt), "MMM d, yyyy")}`
                            : r.firstViewedAt
                              ? `Opened ${format(new Date(r.firstViewedAt), "MMM d, yyyy")} · ${r.viewCount} view${r.viewCount === 1 ? "" : "s"}`
                              : r.sentAt
                                ? `Sent ${format(new Date(r.sentAt), "MMM d, yyyy h:mm a")}`
                                : `Created ${format(new Date(r.createdAt), "MMM d, yyyy")}`}
                        </p>
                      </div>
                      <div className="flex flex-col gap-1.5 shrink-0">
                        <Button
                          size="sm" variant="ghost" className="h-7 px-2 gap-1"
                          onClick={() => copyLink(r.publicUrl)}
                          data-testid={`button-copy-recipient-${r.recipientId}`}
                        >
                          <Link2 className="h-3 w-3" />
                        </Button>
                        {!r.bookedAt && !r.revokedAt && (
                          <Button
                            size="sm" variant="ghost" className="h-7 px-2 gap-1"
                            disabled={resendMut.isPending}
                            onClick={() => resendMut.mutate(r.recipientId)}
                            data-testid={`button-resend-recipient-${r.recipientId}`}
                          >
                            <Send className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Compact summary used inline on a CRM record. Shows the latest status
 * badge for the most recent booking-link recipient (if any).
 */
export function BookingLinkStatusInline({
  objectType, objectId,
}: { objectType: "contact" | "lead"; objectId: number }) {
  const { data } = useQuery<{ recipients: RecipientRow[] }>({
    queryKey: ["/api/crm/booking-link-status", objectType, objectId],
    queryFn: async () => {
      const res = await fetch(
        `/api/crm/booking-link-status?objectType=${objectType}&objectId=${objectId}`,
        { credentials: "include" });
      return res.json();
    },
  });
  const latest = data?.recipients?.[0];
  if (!latest) return null;
  return <StatusBadge status={latest.status} />;
}
