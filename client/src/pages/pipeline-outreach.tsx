import { Link } from "wouter";
import { CalendarClock, BarChart3, ArrowRight } from "lucide-react";
import { CmsBreadcrumb } from "@/components/shared/cms-breadcrumb";

const cards = [
  {
    href: "/booking-outreach",
    icon: CalendarClock,
    iconBg: "bg-sky-500/10",
    iconColor: "text-sky-400",
    title: "Booking Outreach",
    desc: "Track and manage outreach campaigns to marina prospects — scheduling, follow-ups, and response rates.",
    tags: ["Scheduling", "Follow-ups", "CRM linked"],
    testId: "card-booking-outreach",
  },
  {
    href: "/booking-analytics",
    icon: BarChart3,
    iconBg: "bg-violet-500/10",
    iconColor: "text-violet-400",
    title: "Outreach Analytics",
    desc: "Measure the effectiveness of your outreach — response rates, conversion, and pipeline impact.",
    tags: ["Response rates", "Conversion", "Pipeline impact"],
    testId: "card-outreach-analytics",
  },
];

export default function PipelineOutreachPage() {
  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto" data-testid="hub-pipeline-outreach">
      <div>
        <CmsBreadcrumb />
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <CalendarClock className="w-6 h-6 text-primary" />
          Outreach
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your outbound outreach pipeline — schedule calls, track follow-ups, and measure results.
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
