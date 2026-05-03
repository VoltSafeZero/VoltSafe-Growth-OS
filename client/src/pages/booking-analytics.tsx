import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp, Trophy, AlertTriangle, Users, Mail, MousePointerClick,
  CheckCircle2, Clock, Target, DollarSign, FileText, Zap, Eye,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type LinkRow = {
  bookingLinkId: number; bookingLinkName: string;
  ownerUserId: number; ownerName: string | null;
  sent: number; opened: number; booked: number;
  openRate: number; bookingRate: number; underperforming: boolean;
};
type OwnerRow = {
  ownerUserId: number; ownerName: string | null;
  sent: number; opened: number; booked: number;
  openRate: number; bookingRate: number;
};
type SegmentRow = {
  segment: "contact" | "lead" | "orphan";
  sent: number; opened: number; booked: number;
  openRate: number; bookingRate: number;
};
type Timing = {
  sentToOpenedSec:   number | null; sentToOpenedSamples:   number;
  openedToBookedSec: number | null; openedToBookedSamples: number;
  sentToBookedSec:   number | null; sentToBookedSamples:   number;
};
type Leaderboard = {
  top: (LinkRow & { rank: number })[];
  underperforming: LinkRow[];
  minSent: number;
};
type RevenueSummary = {
  bookedMeetings: number; bookedAttributable: number; bookedOrphan: number;
  quotesGenerated: number; quotedValue: number;
  wonQuotes: number; wonValue: number;
  bookingToQuoteRate: number; quoteToWinRate: number;
  isAdmin: boolean;
};
type AttributionRow = {
  bookingLinkId: number; bookingLinkName: string;
  ownerUserId: number; ownerName: string | null;
  bookedMeetings: number; quotesGenerated: number; quotedValue: number;
  wonQuotes: number; wonValue: number;
  bookingToQuoteRate: number; quoteToWinRate: number;
};
type Attribution = {
  perLink: AttributionRow[];
  perOwner: Omit<AttributionRow, "bookingLinkId" | "bookingLinkName">[];
  topRevenueLinks: (AttributionRow & { rank: number })[];
  isAdmin: boolean;
};
type ActionListData = {
  bookedNoNextAction: {
    recipientId: number; recipientEmail: string;
    bookingLinkId: number; bookingLinkName: string;
    ownerUserId: number; ownerName: string | null;
    bookedAt: string;
    crm: { type: "contact" | "lead" | null; id: number | null; accountId: number | null };
  }[];
  openedNotBooked: {
    recipientId: number; recipientEmail: string;
    bookingLinkId: number; bookingLinkName: string;
    ownerUserId: number; ownerName: string | null;
    firstViewedAt: string; daysSinceOpen: number;
    crm: { type: "contact" | "lead" | null; id: number | null; accountId: number | null };
  }[];
  isAdmin: boolean;
};
const fmtMoney = (v: number) => `$${(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fmtDate  = (s: string) => new Date(s).toLocaleDateString();

const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;
const fmtDuration = (sec: number | null) => {
  if (sec == null) return "—";
  if (sec < 60)        return `${Math.round(sec)}s`;
  if (sec < 3600)      return `${Math.round(sec / 60)}m`;
  if (sec < 86400)     return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
};

function MetricCard({ icon: Icon, label, value, sub, testId }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string; sub?: string; testId: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-4 flex items-start gap-3">
        <Icon className="h-5 w-5 mt-0.5 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
          <div className="text-2xl font-semibold mt-0.5">{value}</div>
          {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

function FunnelBar({ label, value, max, testId }: {
  label: string; value: number; max: number; testId: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="space-y-1" data-testid={testId}>
      <div className="flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">{value.toLocaleString()}</span>
      </div>
      <div className="h-3 bg-muted rounded overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function BookingAnalyticsPage() {
  const linksQ        = useQuery<{ rows: LinkRow[]; isAdmin: boolean }>({ queryKey: ["/api/crm/booking-analytics/links"] });
  const ownersQ       = useQuery<{ rows: OwnerRow[] }>({ queryKey: ["/api/crm/booking-analytics/owners"], enabled: !!linksQ.data?.isAdmin });
  const segmentsQ     = useQuery<{ rows: SegmentRow[] }>({ queryKey: ["/api/crm/booking-analytics/segments"] });
  const timingQ       = useQuery<Timing>({ queryKey: ["/api/crm/booking-analytics/timing"] });
  const leaderboardQ  = useQuery<Leaderboard>({ queryKey: ["/api/crm/booking-analytics/leaderboard"] });
  const revenueQ      = useQuery<RevenueSummary>({ queryKey: ["/api/crm/booking-analytics/revenue"] });
  const attributionQ  = useQuery<Attribution>({ queryKey: ["/api/crm/booking-analytics/attribution"] });
  const actionListQ   = useQuery<ActionListData>({ queryKey: ["/api/crm/booking-analytics/action-list"] });

  const totals = useMemo(() => {
    const rows = linksQ.data?.rows ?? [];
    return rows.reduce((a, r) => ({
      sent: a.sent + r.sent, opened: a.opened + r.opened, booked: a.booked + r.booked,
    }), { sent: 0, opened: 0, booked: 0 });
  }, [linksQ.data]);

  const overallOpenRate    = totals.sent > 0 ? totals.opened / totals.sent : 0;
  const overallBookingRate = totals.sent > 0 ? totals.booked / totals.sent : 0;

  return (
    <div className="container mx-auto px-4 py-6 space-y-6 max-w-7xl">
      <div className="flex items-center gap-3">
        <TrendingUp className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Booking Conversion Intelligence</h1>
          <p className="text-sm text-muted-foreground">What links, messaging, and timing actually convert.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricCard icon={Mail}                label="Sent"         value={totals.sent.toLocaleString()}    testId="metric-sent" />
        <MetricCard icon={MousePointerClick}   label="Opened"       value={totals.opened.toLocaleString()}  testId="metric-opened" />
        <MetricCard icon={CheckCircle2}        label="Booked"       value={totals.booked.toLocaleString()}  testId="metric-booked" />
        <MetricCard icon={Target}              label="Open rate"    value={fmtPct(overallOpenRate)}         sub={`${totals.opened}/${totals.sent}`} testId="metric-open-rate" />
        <MetricCard icon={Trophy}              label="Booking rate" value={fmtPct(overallBookingRate)}      sub={`${totals.booked}/${totals.sent}`} testId="metric-booking-rate" />
      </div>

      <Tabs defaultValue="leaderboard" className="space-y-4">
        <TabsList>
          <TabsTrigger value="leaderboard" data-testid="tab-leaderboard">Leaderboard</TabsTrigger>
          <TabsTrigger value="funnel"      data-testid="tab-funnel">Funnel</TabsTrigger>
          <TabsTrigger value="timing"      data-testid="tab-timing">Time to convert</TabsTrigger>
          <TabsTrigger value="segments"    data-testid="tab-segments">CRM segment</TabsTrigger>
          <TabsTrigger value="revenue"     data-testid="tab-revenue">Revenue Attribution</TabsTrigger>
          {linksQ.data?.isAdmin && <TabsTrigger value="owners" data-testid="tab-owners">By owner</TabsTrigger>}
        </TabsList>

        {/* Leaderboard */}
        <TabsContent value="leaderboard" className="space-y-6">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-500" />
                <h2 className="font-medium">Top converting links</h2>
                {leaderboardQ.data && (
                  <Badge variant="secondary" data-testid="badge-min-sent">≥ {leaderboardQ.data.minSent} sent</Badge>
                )}
              </div>
              {leaderboardQ.isLoading ? <Skeleton className="h-32" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-muted-foreground border-b">
                      <tr>
                        <th className="text-left py-2 px-2">#</th>
                        <th className="text-left py-2 px-2">Link</th>
                        {linksQ.data?.isAdmin && <th className="text-left py-2 px-2">Owner</th>}
                        <th className="text-right py-2 px-2">Sent</th>
                        <th className="text-right py-2 px-2">Opened</th>
                        <th className="text-right py-2 px-2">Booked</th>
                        <th className="text-right py-2 px-2">Open rate</th>
                        <th className="text-right py-2 px-2">Booking rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(leaderboardQ.data?.top ?? []).length === 0 && (
                        <tr><td colSpan={linksQ.data?.isAdmin ? 8 : 7} className="text-center text-muted-foreground py-6">
                          No links meet the minimum-sent threshold yet.
                        </td></tr>
                      )}
                      {(leaderboardQ.data?.top ?? []).map((r) => (
                        <tr key={r.bookingLinkId} className="border-b last:border-0" data-testid={`row-leaderboard-${r.bookingLinkId}`}>
                          <td className="py-2 px-2 font-medium">{r.rank}</td>
                          <td className="py-2 px-2">{r.bookingLinkName}</td>
                          {linksQ.data?.isAdmin && <td className="py-2 px-2 text-muted-foreground">{r.ownerName ?? "—"}</td>}
                          <td className="py-2 px-2 text-right tabular-nums">{r.sent}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{r.opened}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{r.booked}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{fmtPct(r.openRate)}</td>
                          <td className="py-2 px-2 text-right tabular-nums font-medium">{fmtPct(r.bookingRate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <h2 className="font-medium">Underperforming links</h2>
                <Badge variant="outline">≥5 sent · &lt;10% booking rate</Badge>
              </div>
              {leaderboardQ.isLoading ? <Skeleton className="h-20" /> : (
                (leaderboardQ.data?.underperforming ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">Nothing flagged. Nice work.</p>
                ) : (
                  <div className="space-y-2">
                    {(leaderboardQ.data?.underperforming ?? []).map((r) => (
                      <div key={r.bookingLinkId} className="flex items-center justify-between border rounded p-2"
                           data-testid={`row-underperforming-${r.bookingLinkId}`}>
                        <div>
                          <div className="font-medium text-sm">{r.bookingLinkName}</div>
                          <div className="text-xs text-muted-foreground">
                            {r.ownerName ?? "—"} · {r.sent} sent · {r.opened} opened · {r.booked} booked
                          </div>
                        </div>
                        <Badge variant="destructive">{fmtPct(r.bookingRate)}</Badge>
                      </div>
                    ))}
                  </div>
                )
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Funnel */}
        <TabsContent value="funnel">
          <Card>
            <CardContent className="p-6 space-y-6">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                <h2 className="font-medium">Conversion funnel</h2>
              </div>
              {linksQ.isLoading ? <Skeleton className="h-40" /> : (
                <div className="space-y-4 max-w-2xl">
                  <FunnelBar label="Sent"   value={totals.sent}   max={totals.sent} testId="funnel-sent" />
                  <FunnelBar label="Opened" value={totals.opened} max={totals.sent} testId="funnel-opened" />
                  <FunnelBar label="Booked" value={totals.booked} max={totals.sent} testId="funnel-booked" />
                  <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                    <div>
                      <div className="text-xs text-muted-foreground uppercase">Sent → Opened</div>
                      <div className="text-lg font-semibold tabular-nums" data-testid="text-funnel-open-rate">{fmtPct(overallOpenRate)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground uppercase">Sent → Booked</div>
                      <div className="text-lg font-semibold tabular-nums" data-testid="text-funnel-booking-rate">{fmtPct(overallBookingRate)}</div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Timing */}
        <TabsContent value="timing">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                <h2 className="font-medium">Average time to convert</h2>
              </div>
              {timingQ.isLoading ? <Skeleton className="h-24" /> : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <MetricCard icon={Clock} label="Sent → Opened"  value={fmtDuration(timingQ.data?.sentToOpenedSec   ?? null)}
                    sub={`${timingQ.data?.sentToOpenedSamples   ?? 0} samples`} testId="timing-sent-to-opened" />
                  <MetricCard icon={Clock} label="Opened → Booked" value={fmtDuration(timingQ.data?.openedToBookedSec ?? null)}
                    sub={`${timingQ.data?.openedToBookedSamples ?? 0} samples`} testId="timing-opened-to-booked" />
                  <MetricCard icon={Clock} label="Sent → Booked"   value={fmtDuration(timingQ.data?.sentToBookedSec   ?? null)}
                    sub={`${timingQ.data?.sentToBookedSamples   ?? 0} samples`} testId="timing-sent-to-booked" />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Segments */}
        <TabsContent value="segments">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                <h2 className="font-medium">Conversion by CRM segment</h2>
              </div>
              {segmentsQ.isLoading ? <Skeleton className="h-32" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-muted-foreground border-b">
                      <tr>
                        <th className="text-left py-2 px-2">Segment</th>
                        <th className="text-right py-2 px-2">Sent</th>
                        <th className="text-right py-2 px-2">Opened</th>
                        <th className="text-right py-2 px-2">Booked</th>
                        <th className="text-right py-2 px-2">Open rate</th>
                        <th className="text-right py-2 px-2">Booking rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(segmentsQ.data?.rows ?? []).map((r) => (
                        <tr key={r.segment} className="border-b last:border-0" data-testid={`row-segment-${r.segment}`}>
                          <td className="py-2 px-2 capitalize">{r.segment}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{r.sent}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{r.opened}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{r.booked}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{fmtPct(r.openRate)}</td>
                          <td className="py-2 px-2 text-right tabular-nums font-medium">{fmtPct(r.bookingRate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Revenue Attribution */}
        <TabsContent value="revenue" className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <MetricCard icon={CheckCircle2} label="Booked meetings" value={(revenueQ.data?.bookedMeetings ?? 0).toLocaleString()}
              sub={revenueQ.data ? `${revenueQ.data.bookedAttributable} CRM-matched · ${revenueQ.data.bookedOrphan} orphan` : undefined}
              testId="metric-rev-booked" />
            <MetricCard icon={FileText} label="Quotes generated" value={(revenueQ.data?.quotesGenerated ?? 0).toLocaleString()}
              sub="created after booking" testId="metric-rev-quotes" />
            <MetricCard icon={DollarSign} label="Quoted value" value={fmtMoney(revenueQ.data?.quotedValue ?? 0)} testId="metric-rev-quoted-value" />
            <MetricCard icon={Trophy} label="Won value" value={fmtMoney(revenueQ.data?.wonValue ?? 0)}
              sub={revenueQ.data ? `${revenueQ.data.wonQuotes} accepted` : undefined} testId="metric-rev-won-value" />
            <MetricCard icon={Target} label="Booking → Quote" value={fmtPct(revenueQ.data?.bookingToQuoteRate ?? 0)}
              sub={revenueQ.data ? `Quote → Win: ${fmtPct(revenueQ.data.quoteToWinRate)}` : undefined}
              testId="metric-rev-rates" />
          </div>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-emerald-500" />
                <h2 className="font-medium">Top revenue-producing booking links</h2>
              </div>
              {attributionQ.isLoading ? <Skeleton className="h-32" /> : (
                (attributionQ.data?.topRevenueLinks ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">No attributed revenue yet. Quotes created after a booking will appear here.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs uppercase text-muted-foreground border-b">
                        <tr>
                          <th className="text-left py-2 px-2">#</th>
                          <th className="text-left py-2 px-2">Link</th>
                          {attributionQ.data?.isAdmin && <th className="text-left py-2 px-2">Owner</th>}
                          <th className="text-right py-2 px-2">Booked</th>
                          <th className="text-right py-2 px-2">Quotes</th>
                          <th className="text-right py-2 px-2">Quoted $</th>
                          <th className="text-right py-2 px-2">Won $</th>
                          <th className="text-right py-2 px-2">Win rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(attributionQ.data?.topRevenueLinks ?? []).map((r) => (
                          <tr key={r.bookingLinkId} className="border-b last:border-0" data-testid={`row-rev-link-${r.bookingLinkId}`}>
                            <td className="py-2 px-2 font-medium">{r.rank}</td>
                            <td className="py-2 px-2">{r.bookingLinkName}</td>
                            {attributionQ.data?.isAdmin && <td className="py-2 px-2 text-muted-foreground">{r.ownerName ?? "—"}</td>}
                            <td className="py-2 px-2 text-right tabular-nums">{r.bookedMeetings}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{r.quotesGenerated}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{fmtMoney(r.quotedValue)}</td>
                            <td className="py-2 px-2 text-right tabular-nums font-medium text-emerald-600 dark:text-emerald-400">{fmtMoney(r.wonValue)}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{fmtPct(r.quoteToWinRate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-500" />
                  <h2 className="font-medium">Booked — no next action</h2>
                  <Badge variant="outline" data-testid="badge-no-action-count">
                    {actionListQ.data?.bookedNoNextAction.length ?? 0}
                  </Badge>
                </div>
                {actionListQ.isLoading ? <Skeleton className="h-24" /> : (
                  (actionListQ.data?.bookedNoNextAction ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground py-2">Nothing stalled. Every booked meeting has a follow-up or a quote.</p>
                  ) : (
                    <div className="space-y-2">
                      {(actionListQ.data?.bookedNoNextAction ?? []).map((r) => (
                        <div key={r.recipientId} className="border rounded p-2"
                             data-testid={`row-no-action-${r.recipientId}`}>
                          <div className="flex justify-between gap-2">
                            <div className="font-medium text-sm truncate">{r.recipientEmail}</div>
                            <div className="text-xs text-muted-foreground whitespace-nowrap">booked {fmtDate(r.bookedAt)}</div>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {r.bookingLinkName}
                            {actionListQ.data?.isAdmin && r.ownerName && ` · ${r.ownerName}`}
                            {r.crm.type && ` · linked to ${r.crm.type}`}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-blue-500" />
                  <h2 className="font-medium">Opened — not booked</h2>
                  <Badge variant="outline" data-testid="badge-opened-count">
                    {actionListQ.data?.openedNotBooked.length ?? 0}
                  </Badge>
                </div>
                {actionListQ.isLoading ? <Skeleton className="h-24" /> : (
                  (actionListQ.data?.openedNotBooked ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground py-2">Everyone who opened has either booked or been actioned.</p>
                  ) : (
                    <div className="space-y-2">
                      {(actionListQ.data?.openedNotBooked ?? []).map((r) => (
                        <div key={r.recipientId} className="border rounded p-2"
                             data-testid={`row-opened-not-booked-${r.recipientId}`}>
                          <div className="flex justify-between gap-2">
                            <div className="font-medium text-sm truncate">{r.recipientEmail}</div>
                            <Badge variant={r.daysSinceOpen >= 2 ? "destructive" : "secondary"} className="whitespace-nowrap">
                              {r.daysSinceOpen}d ago
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {r.bookingLinkName}
                            {actionListQ.data?.isAdmin && r.ownerName && ` · ${r.ownerName}`}
                            {r.crm.type && ` · ${r.crm.type}`}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Owners (admin) */}
        {linksQ.data?.isAdmin && (
          <TabsContent value="owners">
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  <h2 className="font-medium">Conversion by owner</h2>
                </div>
                {ownersQ.isLoading ? <Skeleton className="h-32" /> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs uppercase text-muted-foreground border-b">
                        <tr>
                          <th className="text-left py-2 px-2">Owner</th>
                          <th className="text-right py-2 px-2">Sent</th>
                          <th className="text-right py-2 px-2">Opened</th>
                          <th className="text-right py-2 px-2">Booked</th>
                          <th className="text-right py-2 px-2">Open rate</th>
                          <th className="text-right py-2 px-2">Booking rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(ownersQ.data?.rows ?? []).map((r) => (
                          <tr key={r.ownerUserId} className="border-b last:border-0" data-testid={`row-owner-${r.ownerUserId}`}>
                            <td className="py-2 px-2">{r.ownerName ?? `User #${r.ownerUserId}`}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{r.sent}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{r.opened}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{r.booked}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{fmtPct(r.openRate)}</td>
                            <td className="py-2 px-2 text-right tabular-nums font-medium">{fmtPct(r.bookingRate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
