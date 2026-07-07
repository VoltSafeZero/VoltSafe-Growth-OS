import { Link } from "wouter";
import { Newspaper, CalendarClock, Users2, Globe, ArrowRight } from "lucide-react";
import { CmsBreadcrumb } from "@/components/shared/cms-breadcrumb";

const cards = [
  {
    href: "/strategy/partnerships/media-tradeshows",
    icon: Newspaper,
    iconBg: "bg-sky-500/10",
    iconColor: "text-sky-400",
    title: "Events & Media",
    desc: "Media contacts, tradeshows, and PR relationships — manage coverage and industry presence.",
    tags: ["Media", "Tradeshows", "PR"],
    testId: "card-events-media",
  },
  {
    href: "/ecosystem/events",
    icon: CalendarClock,
    iconBg: "bg-violet-500/10",
    iconColor: "text-violet-400",
    title: "Ecosystem Events",
    desc: "Track event attendance, leads captured, and follow-up actions from industry events.",
    tags: ["Event tracking", "Lead capture", "Follow-ups"],
    testId: "card-ecosystem-events",
  },
  {
    href: "/ecosystem/organizations",
    icon: Globe,
    iconBg: "bg-emerald-500/10",
    iconColor: "text-emerald-400",
    title: "Organizations",
    desc: "Ecosystem organization directory — industry bodies, associations, and external entities.",
    tags: ["Directory", "Industry bodies", "External orgs"],
    testId: "card-ecosystem-organizations",
  },
  {
    href: "/ecosystem/people",
    icon: Users2,
    iconBg: "bg-amber-500/10",
    iconColor: "text-amber-400",
    title: "People",
    desc: "Contacts within the broader ecosystem — speakers, journalists, and industry influencers.",
    tags: ["Ecosystem contacts", "Influencers", "Journalists"],
    testId: "card-ecosystem-people",
  },
];

export default function EcosystemEventsMediaPage() {
  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto" data-testid="hub-ecosystem-events-media">
      <div>
        <CmsBreadcrumb />
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Newspaper className="w-6 h-6 text-primary" />
          Events & Media
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Industry presence and ecosystem relationships — events, media, and the organizations behind them.
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
