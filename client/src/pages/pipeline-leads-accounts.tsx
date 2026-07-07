import { Link } from "wouter";
import { Building2, Contact, StickyNote, Trophy, ArrowRight } from "lucide-react";
import { CmsBreadcrumb } from "@/components/shared/cms-breadcrumb";

const cards = [
  {
    href: "/opportunities",
    icon: Building2,
    iconBg: "bg-sky-500/10",
    iconColor: "text-sky-400",
    title: "Leads & Accounts",
    desc: "All marina leads organized by pipeline stage with predictive scoring and deal value.",
    tags: ["Pipeline stages", "Predictive scoring", "Deal value"],
    testId: "card-leads-accounts",
  },
  {
    href: "/accounts",
    icon: Building2,
    iconBg: "bg-violet-500/10",
    iconColor: "text-violet-400",
    title: "Accounts",
    desc: "Full marina account profiles with CRM history, contacts, opportunities, and notes.",
    tags: ["Full history", "CRM profiles", "Marina data"],
    testId: "card-accounts",
  },
  {
    href: "/contacts",
    icon: Contact,
    iconBg: "bg-emerald-500/10",
    iconColor: "text-emerald-400",
    title: "Contacts",
    desc: "Individual contacts across all accounts with relationship warmness and engagement scores.",
    tags: ["Warmness scores", "Multi-account", "Email history"],
    testId: "card-contacts",
  },
  {
    href: "/notes",
    icon: StickyNote,
    iconBg: "bg-amber-500/10",
    iconColor: "text-amber-400",
    title: "Notes",
    desc: "Cross-CRM notes and activity log — searchable history across all accounts and contacts.",
    tags: ["Searchable", "Activity log", "CRM linked"],
    testId: "card-notes",
  },
  {
    href: "/revenue/deals",
    icon: Trophy,
    iconBg: "bg-rose-500/10",
    iconColor: "text-rose-400",
    title: "Accounts Won",
    desc: "Closed-won accounts and historical deal data for renewal and expansion tracking.",
    tags: ["Closed-won", "Deal history", "Expansion ready"],
    testId: "card-accounts-won",
  },
];

export default function PipelineLeadsAccountsPage() {
  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto" data-testid="hub-pipeline-leads-accounts">
      <div>
        <CmsBreadcrumb />
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Building2 className="w-6 h-6 text-primary" />
          Leads & Accounts
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your full CRM — every marina lead, account, and contact in one place.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {cards.map(card => (
          <Link key={card.href} href={card.href}>
            <div
              className="group rounded-xl border border-border/50 bg-card hover:bg-primary/5 hover:border-primary/40 transition-all cursor-pointer p-5 flex flex-col gap-3 h-full"
              data-testid={card.testId}
            >
              <div className="flex items-center justify-between">
                <div className={`p-2 rounded-lg ${card.iconBg}`}>
                  <card.icon className={`w-5 h-5 ${card.iconColor}`} />
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground group-hover:text-primary transition-colors">{card.title}</h2>
                <p className="text-sm text-muted-foreground mt-0.5 leading-snug">{card.desc}</p>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-auto">
                {card.tags.map(tag => (
                  <span key={tag} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/30">{tag}</span>
                ))}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
