import { Link } from "wouter";
import { Truck, Landmark, Circle, ArrowRight } from "lucide-react";
import { CmsBreadcrumb } from "@/components/shared/cms-breadcrumb";

const cards = [
  {
    href: "/strategy/partnerships/channel-commercial",
    icon: Truck,
    iconBg: "bg-sky-500/10",
    iconColor: "text-sky-400",
    title: "Commercial",
    desc: "Dealer and reseller channel partnerships — manage relationships with commercial distribution partners.",
    tags: ["Dealers", "Resellers", "Distribution"],
    testId: "card-commercial",
  },
  {
    href: "/strategy/partnerships/government-public",
    icon: Landmark,
    iconBg: "bg-violet-500/10",
    iconColor: "text-violet-400",
    title: "Government & Grants",
    desc: "Government partnerships and grant-funded relationships — track funding opportunities and public sector deals.",
    tags: ["Government", "Grants", "Public sector"],
    testId: "card-government-grants",
  },
  {
    href: "/strategy/partnerships/other",
    icon: Circle,
    iconBg: "bg-emerald-500/10",
    iconColor: "text-emerald-400",
    title: "Referrals",
    desc: "Referral partner tracking — manage relationships with partners who send VoltSafe opportunities.",
    tags: ["Referral network", "Partner tracking", "Introductions"],
    testId: "card-referrals",
  },
];

export default function EcosystemChannelsPage() {
  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto" data-testid="hub-ecosystem-channels">
      <div>
        <CmsBreadcrumb />
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Truck className="w-6 h-6 text-primary" />
          Channels
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Commercial partners, government relationships, and referral networks that grow the business.
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
