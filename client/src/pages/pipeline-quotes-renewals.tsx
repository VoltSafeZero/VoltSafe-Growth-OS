import { Link } from "wouter";
import { FileText, RefreshCcw, BarChart3, ArrowRight } from "lucide-react";
import { CmsBreadcrumb } from "@/components/shared/cms-breadcrumb";

const cards = [
  {
    href: "/quotes",
    icon: FileText,
    iconBg: "bg-sky-500/10",
    iconColor: "text-sky-400",
    title: "Quotes",
    desc: "Create, manage, and track quoted proposals for marina charging installations.",
    tags: ["Quote builder", "PDF export", "Follow-up alerts"],
    testId: "card-quotes",
  },
  {
    href: "/renewals",
    icon: RefreshCcw,
    iconBg: "bg-violet-500/10",
    iconColor: "text-violet-400",
    title: "Renewals",
    desc: "Track upcoming renewals with health scores, churn risk, and automated reminders.",
    tags: ["Health scores", "Churn risk", "Auto-reminders"],
    testId: "card-renewals",
  },
  {
    href: "/booking-analytics",
    icon: BarChart3,
    iconBg: "bg-emerald-500/10",
    iconColor: "text-emerald-400",
    title: "Booking Analytics",
    desc: "Conversion rates, quote-to-close timing, and booking performance breakdown.",
    tags: ["Conversion rates", "Close timing", "Stage analytics"],
    testId: "card-booking-analytics",
  },
];

export default function PipelineQuotesRenewalsPage() {
  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto" data-testid="hub-pipeline-quotes-renewals">
      <div>
        <CmsBreadcrumb />
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <FileText className="w-6 h-6 text-primary" />
          Quotes & Renewals
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Build proposals, track renewals, and understand your booking conversion performance.
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
