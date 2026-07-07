import { Link } from "wouter";
import { Mail, StickyNote, Activity, BellRing, ArrowRight } from "lucide-react";
import { CmsBreadcrumb } from "@/components/shared/cms-breadcrumb";

const cards = [
  {
    href: "/gmail",
    icon: Mail,
    iconBg: "bg-sky-500/10",
    iconColor: "text-sky-400",
    title: "Inbox",
    desc: "Full Gmail-synced email client with smart inbox grouping, bulk actions, and auto-backfill.",
    tags: ["Smart grouping", "Auto-backfill", "Bulk actions"],
    testId: "card-inbox",
  },
  {
    href: "/meeting-notes",
    icon: StickyNote,
    iconBg: "bg-violet-500/10",
    iconColor: "text-violet-400",
    title: "Meeting Notes",
    desc: "Structured notes tied to calendar events and linked CRM records.",
    tags: ["CRM linked", "Searchable", "Templates"],
    testId: "card-meeting-notes",
  },
  {
    href: "/activity",
    icon: Activity,
    iconBg: "bg-emerald-500/10",
    iconColor: "text-emerald-400",
    title: "Activity Feed",
    desc: "Live stream of all CRM and team interactions — calls, emails, tasks, and notes.",
    tags: ["Real-time", "Filterable", "Team view"],
    testId: "card-activity-feed",
  },
  {
    href: "/alerts-digest",
    icon: BellRing,
    iconBg: "bg-amber-500/10",
    iconColor: "text-amber-400",
    title: "Digest Settings",
    desc: "Configure daily digest emails and alert thresholds for your inbox.",
    tags: ["Alerts", "Daily digest", "Custom rules"],
    testId: "card-digest-settings",
  },
];

export default function WorkInboxMailPage() {
  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto" data-testid="hub-work-inbox-mail">
      <div>
        <CmsBreadcrumb />
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Mail className="w-6 h-6 text-primary" />
          Inbox & Mail
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your email workspace — read, reply, and stay on top of every thread with smart tools.
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
                <h2 className="text-base font-semibold text-foreground group-hover:text-primary transition-colors">
                  {card.title}
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5 leading-snug">{card.desc}</p>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-auto">
                {card.tags.map(tag => (
                  <span key={tag} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/30">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
