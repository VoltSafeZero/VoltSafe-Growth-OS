import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users, Activity, Clock, UserPlus, Unlink,
  Building2, ArrowUpDown, ArrowUp, ArrowDown,
  Mail, ExternalLink, TrendingUp, UserRoundPlus,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

type Period = 7 | 30 | 90 | 0;

type RiData = {
  period: number;
  cards: {
    totalExternal: number;
    activeRelationships: number;
    dormantRelationships: number;
    newRelationships: number;
    unlinkedSenders: number;
  };
  mostActive: {
    contactId: number;
    contactName: string;
    accountId: number | null;
    accountName: string | null;
    orgType: string | null;
    messageCount: number;
    lastActivity: string | null;
  }[];
  neglected: {
    contactId: number;
    contactName: string;
    accountId: number | null;
    accountName: string | null;
    orgType: string | null;
    lastActivity: string | null;
    daysSinceContact: number;
  }[];
  orgsByVolume: {
    accountId: number;
    accountName: string;
    orgType: string | null;
    contactCount: number;
    messageCount: number;
    lastActivity: string | null;
  }[];
  unlinkedSenders: {
    fromName: string | null;
    fromEmail: string;
    domain: string;
    threadCount: number;
    messageCount: number;
    lastSeen: string | null;
    latestThreadId: string | null;
  }[];
  trend: { date: string; count: number }[];
};

type SortDir = "asc" | "desc";

function relativeDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = Date.now();
  const diff = Math.floor((now - d.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return `${diff}d ago`;
  if (diff < 30) return `${Math.floor(diff / 7)}w ago`;
  if (diff < 365) return `${Math.floor(diff / 30)}mo ago`;
  return `${Math.floor(diff / 365)}y ago`;
}

function orgTypeBadge(type: string | null) {
  if (!type) return null;
  const map: Record<string, string> = {
    marina_prospect: "Marina",
    marina_existing: "Marina",
    government: "Govt",
    industry_association: "Assoc.",
    investor: "Investor",
    distributor: "Distributor",
    technology_partner: "Tech Partner",
    other: "Other",
  };
  return map[type] ?? type;
}

function useSortable<T>(data: T[], defaultKey: keyof T, defaultDir: SortDir = "desc") {
  const [sortKey, setSortKey] = useState<keyof T>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  function toggleSort(key: keyof T) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  function SortIcon({ col }: { col: keyof T }) {
    if (col !== sortKey) return <ArrowUpDown className="w-3 h-3 text-muted-foreground/50 ml-1 inline" />;
    return sortDir === "asc"
      ? <ArrowUp className="w-3 h-3 text-primary ml-1 inline" />
      : <ArrowDown className="w-3 h-3 text-primary ml-1 inline" />;
  }

  return { sorted, toggleSort, sortKey, sortDir, SortIcon };
}

const PERIOD_OPTIONS: { label: string; value: Period }[] = [
  { label: "7d", value: 7 },
  { label: "30d", value: 30 },
  { label: "90d", value: 90 },
  { label: "All", value: 0 },
];

export default function RelationshipIntelligencePage() {
  const [period, setPeriod] = useState<Period>(30);
  const [, navigate] = useLocation();

  const { data, isLoading } = useQuery<RiData>({
    queryKey: ["/api/relationships/intelligence", period],
    queryFn: async () => {
      const res = await fetch(`/api/relationships/intelligence?days=${period}`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const activeSort = useSortable(data?.mostActive ?? [], "messageCount");
  const neglectedSort = useSortable(data?.neglected ?? [], "daysSinceContact");
  const orgsSort = useSortable(data?.orgsByVolume ?? [], "messageCount");
  const unlinkedSort = useSortable(data?.unlinkedSenders ?? [], "messageCount");

  const periodLabel = period === 0 ? "all time" : `last ${period} days`;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto bg-background">
      <div className="max-w-[1400px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <TrendingUp className="w-6 h-6 text-primary" />
              Relationship Intelligence
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Email activity across your CRM contacts — {periodLabel}
            </p>
          </div>
          <div className="flex items-center gap-1 bg-secondary/50 rounded-lg p-1">
            {PERIOD_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setPeriod(opt.value)}
                data-testid={`period-${opt.label.toLowerCase()}`}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-all ${
                  period === opt.value
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard
            icon={<Mail className="w-4 h-4" />}
            label="External Contacts"
            sublabel={periodLabel}
            value={data?.cards.totalExternal}
            color="text-sky-400"
            loading={isLoading}
            testid="stat-total-external"
          />
          <StatCard
            icon={<Activity className="w-4 h-4" />}
            label="Active"
            sublabel="2+ emails in period"
            value={data?.cards.activeRelationships}
            color="text-emerald-400"
            loading={isLoading}
            testid="stat-active"
          />
          <StatCard
            icon={<Clock className="w-4 h-4" />}
            label="Dormant"
            sublabel="No contact in 60d"
            value={data?.cards.dormantRelationships}
            color="text-amber-400"
            loading={isLoading}
            testid="stat-dormant"
          />
          <StatCard
            icon={<UserPlus className="w-4 h-4" />}
            label="New"
            sublabel="First email in period"
            value={data?.cards.newRelationships}
            color="text-violet-400"
            loading={isLoading}
            testid="stat-new"
          />
          <StatCard
            icon={<Unlink className="w-4 h-4" />}
            label="Unlinked"
            sublabel="No CRM match"
            value={data?.cards.unlinkedSenders}
            color="text-rose-400"
            loading={isLoading}
            testid="stat-unlinked"
          />
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Trend line chart */}
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Inbound Activity Trend
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : !data?.trend.length ? (
                <EmptyChart label="No email data for this period" />
              ) : (
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={data.trend} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.4)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={d => d.slice(5)}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "6px",
                        fontSize: "12px",
                      }}
                      labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="count"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Top orgs bar chart */}
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Top Organizations by Volume
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : !data?.orgsByVolume.length ? (
                <EmptyChart label="No organization associations yet" />
              ) : (
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart
                    data={data.orgsByVolume.slice(0, 8)}
                    margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
                    layout="vertical"
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.4)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="accountName"
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      width={90}
                      tickFormatter={n => n?.length > 12 ? n.slice(0, 12) + "…" : n}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "6px",
                        fontSize: "12px",
                      }}
                    />
                    <Bar dataKey="messageCount" fill="hsl(var(--primary))" radius={[0, 3, 3, 0]} name="Emails" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Tables row: Most Active + Neglected */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Most Active Contacts */}
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                Most Active Contacts
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <TableSkeleton rows={5} />
              ) : !activeSort.sorted.length ? (
                <EmptyTable label="No active contacts with email associations yet" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="table-most-active">
                    <thead>
                      <tr className="border-b border-border/50">
                        <SortTh label="Contact" onClick={() => activeSort.toggleSort("contactName")}>
                          <activeSort.SortIcon col="contactName" />
                        </SortTh>
                        <SortTh label="Org" onClick={() => activeSort.toggleSort("accountName")}>
                          <activeSort.SortIcon col="accountName" />
                        </SortTh>
                        <SortTh label="Emails" onClick={() => activeSort.toggleSort("messageCount")} right>
                          <activeSort.SortIcon col="messageCount" />
                        </SortTh>
                        <SortTh label="Last" onClick={() => activeSort.toggleSort("lastActivity")} right>
                          <activeSort.SortIcon col="lastActivity" />
                        </SortTh>
                      </tr>
                    </thead>
                    <tbody>
                      {activeSort.sorted.map(row => (
                        <tr key={row.contactId} className="border-b border-border/30 hover:bg-secondary/30 transition-colors">
                          <td className="px-4 py-2.5">
                            <Link
                              href={`/contacts?selected=${row.contactId}`}
                              className="font-medium text-foreground hover:text-primary transition-colors flex items-center gap-1"
                              data-testid={`link-contact-${row.contactId}`}
                            >
                              {row.contactName}
                              <ExternalLink className="w-3 h-3 opacity-40" />
                            </Link>
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">
                            {row.accountId ? (
                              <Link
                                href={`/accounts?selected=${row.accountId}`}
                                className="hover:text-foreground transition-colors flex items-center gap-1"
                              >
                                {row.accountName ?? "—"}
                                {row.orgType && (
                                  <Badge variant="outline" className="text-[10px] py-0 px-1 h-4 shrink-0">
                                    {orgTypeBadge(row.orgType)}
                                  </Badge>
                                )}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground/50">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-primary font-semibold">
                            {row.messageCount}
                          </td>
                          <td className="px-4 py-2.5 text-right text-muted-foreground text-xs whitespace-nowrap">
                            {relativeDate(row.lastActivity)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Neglected Relationships */}
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400" />
                Neglected Relationships
                <span className="text-xs font-normal text-muted-foreground">(no contact in 30d+)</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <TableSkeleton rows={5} />
              ) : !neglectedSort.sorted.length ? (
                <EmptyTable label="No neglected contacts — all relationships are recent" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="table-neglected">
                    <thead>
                      <tr className="border-b border-border/50">
                        <SortTh label="Contact" onClick={() => neglectedSort.toggleSort("contactName")}>
                          <neglectedSort.SortIcon col="contactName" />
                        </SortTh>
                        <SortTh label="Org" onClick={() => neglectedSort.toggleSort("accountName")}>
                          <neglectedSort.SortIcon col="accountName" />
                        </SortTh>
                        <SortTh label="Last Contact" onClick={() => neglectedSort.toggleSort("daysSinceContact")} right>
                          <neglectedSort.SortIcon col="daysSinceContact" />
                        </SortTh>
                      </tr>
                    </thead>
                    <tbody>
                      {neglectedSort.sorted.map(row => (
                        <tr key={row.contactId} className="border-b border-border/30 hover:bg-secondary/30 transition-colors">
                          <td className="px-4 py-2.5">
                            <Link
                              href={`/contacts?selected=${row.contactId}`}
                              className="font-medium text-foreground hover:text-primary transition-colors flex items-center gap-1"
                              data-testid={`link-neglected-${row.contactId}`}
                            >
                              {row.contactName}
                              <ExternalLink className="w-3 h-3 opacity-40" />
                            </Link>
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground text-xs">
                            {row.accountName ?? "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <span className={`text-xs font-medium ${
                              row.daysSinceContact > 60
                                ? "text-rose-400"
                                : row.daysSinceContact > 30
                                ? "text-amber-400"
                                : "text-muted-foreground"
                            }`}>
                              {row.daysSinceContact}d ago
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Orgs by Volume — full width table */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Building2 className="w-4 h-4 text-sky-400" />
              Top Organizations by Email Volume
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <TableSkeleton rows={4} />
            ) : !orgsSort.sorted.length ? (
              <EmptyTable label="No organization associations yet — add contacts to seed data" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-orgs-volume">
                  <thead>
                    <tr className="border-b border-border/50">
                      <SortTh label="Organization" onClick={() => orgsSort.toggleSort("accountName")}>
                        <orgsSort.SortIcon col="accountName" />
                      </SortTh>
                      <SortTh label="Type" onClick={() => orgsSort.toggleSort("orgType")}>
                        <orgsSort.SortIcon col="orgType" />
                      </SortTh>
                      <SortTh label="Contacts" onClick={() => orgsSort.toggleSort("contactCount")} right>
                        <orgsSort.SortIcon col="contactCount" />
                      </SortTh>
                      <SortTh label="Emails" onClick={() => orgsSort.toggleSort("messageCount")} right>
                        <orgsSort.SortIcon col="messageCount" />
                      </SortTh>
                      <SortTh label="Last Activity" onClick={() => orgsSort.toggleSort("lastActivity")} right>
                        <orgsSort.SortIcon col="lastActivity" />
                      </SortTh>
                    </tr>
                  </thead>
                  <tbody>
                    {orgsSort.sorted.map(row => (
                      <tr key={row.accountId} className="border-b border-border/30 hover:bg-secondary/30 transition-colors">
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/accounts?selected=${row.accountId}`}
                            className="font-medium text-foreground hover:text-primary transition-colors flex items-center gap-1"
                            data-testid={`link-org-${row.accountId}`}
                          >
                            {row.accountName}
                            <ExternalLink className="w-3 h-3 opacity-40" />
                          </Link>
                        </td>
                        <td className="px-4 py-2.5">
                          {row.orgType && (
                            <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-5">
                              {orgTypeBadge(row.orgType)}
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
                          {row.contactCount}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-primary font-semibold">
                          {row.messageCount}
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground text-xs whitespace-nowrap">
                          {relativeDate(row.lastActivity)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Unlinked Senders — full width */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Unlink className="w-4 h-4 text-rose-400" />
              Unlinked Real Senders
              <span className="text-xs font-normal text-muted-foreground">
                — external business senders with no CRM contact
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <TableSkeleton rows={6} />
            ) : !unlinkedSort.sorted.length ? (
              <EmptyTable label="All senders are linked to CRM contacts" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-unlinked-senders">
                  <thead>
                    <tr className="border-b border-border/50">
                      <SortTh label="Name" onClick={() => unlinkedSort.toggleSort("fromName")}>
                        <unlinkedSort.SortIcon col="fromName" />
                      </SortTh>
                      <SortTh label="Email" onClick={() => unlinkedSort.toggleSort("fromEmail")}>
                        <unlinkedSort.SortIcon col="fromEmail" />
                      </SortTh>
                      <SortTh label="Domain" onClick={() => unlinkedSort.toggleSort("domain")}>
                        <unlinkedSort.SortIcon col="domain" />
                      </SortTh>
                      <SortTh label="Threads" onClick={() => unlinkedSort.toggleSort("threadCount")} right>
                        <unlinkedSort.SortIcon col="threadCount" />
                      </SortTh>
                      <SortTh label="Emails" onClick={() => unlinkedSort.toggleSort("messageCount")} right>
                        <unlinkedSort.SortIcon col="messageCount" />
                      </SortTh>
                      <SortTh label="Last Seen" onClick={() => unlinkedSort.toggleSort("lastSeen")} right>
                        <unlinkedSort.SortIcon col="lastSeen" />
                      </SortTh>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground/70 uppercase tracking-wide whitespace-nowrap">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {unlinkedSort.sorted.map(row => (
                      <tr key={row.fromEmail} className="border-b border-border/30 hover:bg-secondary/30 transition-colors">
                        <td className="px-4 py-2.5 font-medium text-foreground">
                          {row.fromName ?? <span className="text-muted-foreground/50 italic">Unknown</span>}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs">
                          {row.fromEmail}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground text-xs">
                          {row.domain}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
                          {row.threadCount}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-foreground font-semibold">
                          {row.messageCount}
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground text-xs whitespace-nowrap">
                          {relativeDate(row.lastSeen)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {row.latestThreadId ? (
                              <button
                                onClick={() => navigate(`/gmail?thread=${row.latestThreadId}`)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors whitespace-nowrap border border-primary/20"
                                data-testid={`btn-create-crm-${row.fromEmail.replace(/[@.]/g, "-")}`}
                              >
                                <UserRoundPlus className="w-3 h-3" />
                                Create in CRM
                              </button>
                            ) : (
                              <Link
                                href="/gmail"
                                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
                                data-testid={`link-inbox-${row.fromEmail.replace(/[@.]/g, "-")}`}
                              >
                                <Mail className="w-3 h-3" />
                                Open inbox
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}

function StatCard({
  icon, label, sublabel, value, color, loading, testid,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  value: number | undefined;
  color: string;
  loading: boolean;
  testid: string;
}) {
  return (
    <Card className="border-border/50" data-testid={testid}>
      <CardContent className="pt-4 pb-4 px-4">
        <div className={`flex items-center gap-2 mb-2 ${color}`}>
          {icon}
          <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
        </div>
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <p className="text-3xl font-bold tracking-tight text-foreground">{value ?? 0}</p>
        )}
        <p className="text-xs text-muted-foreground/60 mt-0.5">{sublabel}</p>
      </CardContent>
    </Card>
  );
}

function SortTh({
  label, onClick, right, children,
}: {
  label: string;
  onClick: () => void;
  right?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <th
      className={`px-4 py-2.5 text-xs font-medium text-muted-foreground/70 uppercase tracking-wide whitespace-nowrap cursor-pointer hover:text-muted-foreground transition-colors select-none ${right ? "text-right" : "text-left"}`}
      onClick={onClick}
    >
      {label}{children}
    </th>
  );
}

function EmptyTable({ label }: { label: string }) {
  return (
    <div className="px-4 py-8 text-center text-sm text-muted-foreground/60">
      {label}
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-40 flex items-center justify-center text-sm text-muted-foreground/60">
      {label}
    </div>
  );
}

function TableSkeleton({ rows }: { rows: number }) {
  return (
    <div className="px-4 py-2 space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}
