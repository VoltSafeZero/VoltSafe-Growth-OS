import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PotentialInvestorBadge } from "@/components/investor-tag";
import {
  TrendingUp, User, Building2, Briefcase, Mail, ExternalLink,
  Calendar, UserCheck, MailOpen,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface InvestorTagRecord {
  id: number;
  record_type: "lead" | "account" | "contact";
  record_id: number;
  tagged_at: string;
  source_thread_id?: string;
  source_message_id?: string;
  tagged_by_name?: string;
  record_name?: string;
  record_detail?: string;
  record_email?: string;
  record_status?: string;
}

const TYPE_CONFIG = {
  lead: {
    label: "Lead",
    icon: Briefcase,
    color: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    href: (id: number) => `/opportunities/${id}`,
  },
  account: {
    label: "Account",
    icon: Building2,
    color: "bg-blue-500/10 text-blue-400 border-blue-500/30",
    href: (id: number) => `/accounts/${id}`,
  },
  contact: {
    label: "Contact",
    icon: User,
    color: "bg-purple-500/10 text-purple-400 border-purple-500/30",
    href: (id: number) => `/contacts/${id}`,
  },
};

function InvestorRow({ item }: { item: InvestorTagRecord }) {
  const cfg = TYPE_CONFIG[item.record_type];
  const TypeIcon = cfg.icon;

  return (
    <tr
      className="border-b border-border/20 hover:bg-secondary/20 transition-colors"
      data-testid={`row-investor-${item.record_type}-${item.record_id}`}
    >
      <td className="py-3 px-4">
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${cfg.color}`}>
          <TypeIcon className="h-3 w-3" />
          {cfg.label}
        </span>
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium" data-testid={`text-investor-name-${item.record_id}`}>
            {item.record_name ?? `—`}
          </span>
          <Link href={cfg.href(item.record_id)}>
            <a className="text-muted-foreground/40 hover:text-primary transition-colors">
              <ExternalLink className="h-3 w-3" />
            </a>
          </Link>
        </div>
      </td>
      <td className="py-3 px-4 text-sm text-muted-foreground">
        {item.record_detail || "—"}
      </td>
      <td className="py-3 px-4">
        {item.record_email ? (
          <a href={`mailto:${item.record_email}`} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors">
            <Mail className="h-3 w-3 flex-shrink-0" />
            <span className="truncate max-w-[160px]">{item.record_email}</span>
          </a>
        ) : "—"}
      </td>
      <td className="py-3 px-4">
        {item.record_status ? (
          <Badge variant="outline" className="text-[10px]">{item.record_status}</Badge>
        ) : "—"}
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-1 text-xs text-muted-foreground" title={item.tagged_at}>
          <Calendar className="h-3 w-3 flex-shrink-0" />
          {formatDistanceToNow(new Date(item.tagged_at), { addSuffix: true })}
        </div>
      </td>
      <td className="py-3 px-4">
        {item.tagged_by_name ? (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <UserCheck className="h-3 w-3 flex-shrink-0" />
            {item.tagged_by_name}
          </div>
        ) : "—"}
      </td>
      <td className="py-3 px-4">
        {item.source_thread_id ? (
          <Link href={`/mail?thread=${item.source_thread_id}`}>
            <a className="flex items-center gap-1 text-xs text-primary hover:underline">
              <MailOpen className="h-3 w-3 flex-shrink-0" />
              View email
            </a>
          </Link>
        ) : "—"}
      </td>
      <td className="py-3 px-4">
        <PotentialInvestorBadge
          recordType={item.record_type}
          recordId={item.record_id}
          compact
        />
      </td>
    </tr>
  );
}

export default function PotentialInvestorsPage() {
  const [, setLocation] = useLocation();

  const { data, isLoading } = useQuery<{ items: InvestorTagRecord[] }>({
    queryKey: ["/api/investor-tags"],
    queryFn: async () => {
      const res = await fetch("/api/investor-tags", { credentials: "include" });
      return res.json();
    },
    staleTime: 15_000,
  });

  const items = data?.items ?? [];
  const leads = items.filter(i => i.record_type === "lead");
  const accounts = items.filter(i => i.record_type === "account");
  const contacts = items.filter(i => i.record_type === "contact");

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/15 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-teal-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Potential Investors</h1>
            <p className="text-sm text-muted-foreground">
              Manually tagged across all CRM record types
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isLoading ? (
            <Skeleton className="h-7 w-20 rounded-full" />
          ) : (
            <Badge variant="outline" className="text-sm px-3 py-1">
              {items.length} total
            </Badge>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Leads", count: leads.length, icon: Briefcase, color: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
          { label: "Accounts", count: accounts.length, icon: Building2, color: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
          { label: "Contacts", count: contacts.length, icon: User, color: "text-purple-400 bg-purple-500/10 border-purple-500/20" },
        ].map(({ label, count, icon: Icon, color }) => (
          <Card key={label} className={`border ${color.split(" ").find(c => c.startsWith("border-"))}`}>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${color.split(" ")[0]}`} />
                <span className="text-sm text-muted-foreground">{label}</span>
              </div>
              <p className="text-2xl font-bold mt-1">
                {isLoading ? <Skeleton className="h-8 w-12" /> : count}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-teal-400" />
            All Tagged Records
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              <TrendingUp className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p className="font-medium">No Potential Investors tagged yet</p>
              <p className="text-sm mt-1 max-w-xs mx-auto">
                Open any Lead, Account, Contact, or email thread and click "Tag as Potential Investor" to add records here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/30 bg-secondary/20">
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground">Type</th>
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground">Name</th>
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground">Contact</th>
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground">Email</th>
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground">Status</th>
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground">Date Tagged</th>
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground">Tagged By</th>
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground">Source</th>
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground">Tag</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => <InvestorRow key={item.id} item={item} />)}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
