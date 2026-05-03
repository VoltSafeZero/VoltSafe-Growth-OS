import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  CalendarDays, Copy, Eye, Mail, RotateCcw, Search, Send, Filter as FilterIcon,
  Users, CheckCircle2, MousePointerClick, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { StatusBadge } from "@/components/SendBookingLinkButton";

type Status = "not_sent" | "sent" | "opened" | "booked" | "revoked";
type OutreachRow = {
  recipientId: number; recipientEmail: string;
  bookingLinkId: number; bookingLinkName: string;
  ownerUserId: number; ownerName: string | null;
  status: Status;
  sentAt: string | null; firstViewedAt: string | null; viewCount: number;
  bookedAt: string | null; bookedCalendarEventId: number | null;
  revokedAt: string | null; createdAt: string; publicUrl: string;
  crmRecord: null | { type: "contact" | "lead"; id: number; name: string | null; accountId?: number | null; accountName?: string | null };
};
type Summary = { total: number; notSent: number; sent: number; opened: number; booked: number; revoked: number; openRate: number; bookingRate: number };
type BookingLink = { id: number; name: string; active: boolean };
type Owner = { id: number; name: string };

const STATUS_OPTIONS: { value: Status | "all"; label: string }[] = [
  { value: "all",      label: "All statuses" },
  { value: "not_sent", label: "Not sent" },
  { value: "sent",     label: "Sent" },
  { value: "opened",   label: "Opened" },
  { value: "booked",   label: "Booked" },
  { value: "revoked",  label: "Revoked" },
];

function pct(n: number) { return `${Math.round(n * 100)}%`; }

function MetricCard({ icon: Icon, label, value, sub, testid }: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: string | number; sub?: string; testid: string;
}) {
  return (
    <Card data-testid={testid}>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className="text-2xl font-semibold leading-tight" data-testid={`${testid}-value`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function BookingOutreachPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [linkId, setLinkId] = useState<string>("all");
  const [ownerId, setOwnerId] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (search.trim())            p.set("search", search.trim());
    if (status   !== "all")       p.set("status", status);
    if (linkId   !== "all")       p.set("bookingLinkId", linkId);
    if (ownerId  !== "all")       p.set("ownerUserId", ownerId);
    if (dateFrom)                 p.set("dateFrom", new Date(dateFrom).toISOString());
    if (dateTo) {
      const d = new Date(dateTo); d.setHours(23, 59, 59, 999);
      p.set("dateTo", d.toISOString());
    }
    const s = p.toString();
    return s ? `?${s}` : "";
  }, [search, status, linkId, ownerId, dateFrom, dateTo]);

  const listKey = ["/api/crm/booking-outreach", queryParams] as const;
  const { data: listData, isLoading: listLoading } = useQuery<{ rows: OutreachRow[]; isAdmin: boolean }>({
    queryKey: listKey,
    queryFn: async () => (await fetch(`/api/crm/booking-outreach${queryParams}`, { credentials: "include" })).json(),
  });
  const rows = listData?.rows ?? [];
  const isAdmin = !!listData?.isAdmin;

  const { data: summary } = useQuery<Summary>({
    queryKey: ["/api/crm/booking-outreach/summary", queryParams],
    queryFn: async () => (await fetch(`/api/crm/booking-outreach/summary${queryParams}`, { credentials: "include" })).json(),
  });

  const { data: links } = useQuery<BookingLink[]>({ queryKey: ["/api/booking-links"] });
  const { data: ownersData } = useQuery<{ owners: Owner[] }>({
    queryKey: ["/api/crm/booking-outreach/owners"],
    queryFn: async () => {
      const r = await fetch(`/api/crm/booking-outreach/owners`, { credentials: "include" });
      if (!r.ok) return { owners: [] };
      return r.json();
    },
    enabled: isAdmin,
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
      queryClient.invalidateQueries({ queryKey: ["/api/crm/booking-outreach"] });
    },
    onError: (e: any) => toast({ title: "Could not resend", description: e.message, variant: "destructive" }),
  });

  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast({ title: "Link copied" }); }
    catch { toast({ title: "Copy failed", variant: "destructive" }); }
  };

  return (
    <div className="px-4 sm:px-6 py-5 max-w-[1400px] mx-auto" data-testid="page-booking-outreach">
      {/* Header */}
      <div className="flex items-start gap-3 mb-5">
        <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <CalendarDays className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold leading-tight" data-testid="text-page-title">Booking Outreach</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            All booking-link activity across the CRM — sends, opens, bookings.
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
        <MetricCard icon={Send}                  testid="card-summary-sent"        label="Sent"          value={summary?.sent ?? "—"} />
        <MetricCard icon={Eye}                   testid="card-summary-opened"      label="Opened"        value={summary?.opened ?? "—"} />
        <MetricCard icon={CheckCircle2}          testid="card-summary-booked"      label="Booked"        value={summary?.booked ?? "—"} />
        <MetricCard icon={MousePointerClick}     testid="card-summary-open-rate"   label="Open rate"     value={summary ? pct(summary.openRate) : "—"}    sub={summary ? `${summary.opened}/${summary.sent}` : undefined} />
        <MetricCard icon={Users}                 testid="card-summary-booking-rate" label="Booking rate" value={summary ? pct(summary.bookingRate) : "—"} sub={summary ? `${summary.booked}/${summary.sent}` : undefined} />
      </div>

      {/* Filters */}
      <Card className="mb-5">
        <CardContent className="p-3 sm:p-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by email…" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search" />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[160px]" data-testid="select-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={linkId} onValueChange={setLinkId}>
            <SelectTrigger className="w-[200px]" data-testid="select-link"><SelectValue placeholder="All links" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All booking links</SelectItem>
              {(links || []).map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {isAdmin && (
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger className="w-[180px]" data-testid="select-owner"><SelectValue placeholder="All owners" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All owners</SelectItem>
                {(ownersData?.owners || []).map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-[160px]" data-testid="input-date-from" />
          <Input type="date" value={dateTo}   onChange={(e) => setDateTo(e.target.value)}   className="w-[160px]" data-testid="input-date-to" />
          {(search || status !== "all" || linkId !== "all" || ownerId !== "all" || dateFrom || dateTo) && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setStatus("all"); setLinkId("all"); setOwnerId("all"); setDateFrom(""); setDateTo(""); }} data-testid="button-clear-filters">
              Clear
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b border-border/50">
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Recipient</th>
                  <th className="px-4 py-2.5 font-medium">CRM record</th>
                  <th className="px-4 py-2.5 font-medium">Booking link</th>
                  {isAdmin && <th className="px-4 py-2.5 font-medium">Owner</th>}
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Sent</th>
                  <th className="px-4 py-2.5 font-medium">First viewed</th>
                  <th className="px-4 py-2.5 font-medium text-right">Views</th>
                  <th className="px-4 py-2.5 font-medium">Booked</th>
                  <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {listLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={`skel-${i}`} className="border-b border-border/30">
                      {Array.from({ length: isAdmin ? 10 : 9 }).map((__, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                      ))}
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 10 : 9} className="px-4 py-12 text-center text-sm text-muted-foreground" data-testid="text-empty">
                      <Mail className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      No booking-link activity matches your filters yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.recipientId} className="border-b border-border/30 hover-elevate" data-testid={`row-outreach-${r.recipientId}`}>
                      <td className="px-4 py-2.5 max-w-[220px] truncate" data-testid={`text-email-${r.recipientId}`}>{r.recipientEmail}</td>
                      <td className="px-4 py-2.5">
                        {r.crmRecord ? (
                          <Link href={r.crmRecord.type === "contact" ? `/contacts/${r.crmRecord.id}` : `/opportunities/${r.crmRecord.id}`}>
                            <span className="text-primary hover:underline inline-flex items-center gap-1" data-testid={`link-crm-${r.recipientId}`}>
                              {r.crmRecord.name || (r.crmRecord.type === "contact" ? "Contact" : "Lead")}
                              <ExternalLink className="h-3 w-3" />
                            </span>
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                        {r.crmRecord?.accountName && (
                          <p className="text-xs text-muted-foreground truncate">{r.crmRecord.accountName}</p>
                        )}
                      </td>
                      <td className="px-4 py-2.5 max-w-[200px] truncate" data-testid={`text-link-${r.recipientId}`}>{r.bookingLinkName}</td>
                      {isAdmin && <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.ownerName ?? `#${r.ownerUserId}`}</td>}
                      <td className="px-4 py-2.5"><StatusBadge status={r.status === "revoked" ? "not_sent" : r.status} /></td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {r.sentAt ? format(new Date(r.sentAt), "MMM d, h:mm a") : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {r.firstViewedAt ? format(new Date(r.firstViewedAt), "MMM d, h:mm a") : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{r.viewCount}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {r.bookedAt ? format(new Date(r.bookedAt), "MMM d, h:mm a") : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => copy(r.publicUrl)} data-testid={`button-copy-${r.recipientId}`} title="Copy link">
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          {!r.bookedAt && !r.revokedAt && (
                            <Button size="icon" variant="ghost" className="h-7 w-7"
                              disabled={resendMut.isPending}
                              onClick={() => resendMut.mutate(r.recipientId)}
                              data-testid={`button-resend-${r.recipientId}`}
                              title="Resend"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {!listLoading && rows.length > 0 && (
        <p className="text-xs text-muted-foreground mt-3">
          Showing {rows.length} recipient{rows.length === 1 ? "" : "s"} · open & view counts come from the public booking page (no email pixels needed)
        </p>
      )}
    </div>
  );
}
