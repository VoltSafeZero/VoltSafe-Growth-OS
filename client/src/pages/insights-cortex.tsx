import { Link } from "wouter";
import { Brain, BookOpen, Trophy, BarChart3, ArrowRight } from "lucide-react";
import { CmsBreadcrumb } from "@/components/shared/cms-breadcrumb";

const cards = [
  {
    href: "/executive-copilot",
    icon: Brain,
    iconBg: "bg-sky-500/10",
    iconColor: "text-sky-400",
    title: "Cortex",
    desc: "AI-powered executive copilot — daily decision briefs, critical alerts, and suggested next moves.",
    tags: ["Daily briefs", "AI alerts", "Suggested actions"],
    testId: "card-cortex",
  },
  {
    href: "/cortex/intel",
    icon: BookOpen,
    iconBg: "bg-violet-500/10",
    iconColor: "text-violet-400",
    title: "Cortex Intel Library",
    desc: "Curated AI knowledge base — training documents that keep Cortex accurate and up to date.",
    tags: ["Knowledge base", "AI training", "Curated docs"],
    testId: "card-cortex-intel",
  },
  {
    href: "/executive-dashboard",
    icon: Trophy,
    iconBg: "bg-emerald-500/10",
    iconColor: "text-emerald-400",
    title: "Executive Dashboard",
    desc: "High-level KPIs for leadership — pipeline health, team performance, and key metrics at a glance.",
    tags: ["KPIs", "Leadership view", "Pipeline health"],
    testId: "card-executive-dashboard",
  },
  {
    href: "/intelligence/rel-intelligence",
    icon: BarChart3,
    iconBg: "bg-amber-500/10",
    iconColor: "text-amber-400",
    title: "Relationship Intelligence",
    desc: "Contact warmness scoring, dormant lead detection, and multi-threaded relationship analysis.",
    tags: ["Warmness scores", "Dormant leads", "Multi-threaded"],
    testId: "card-rel-intelligence",
  },
];

export default function InsightsCortexPage() {
  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto" data-testid="hub-insights-cortex">
      <div>
        <CmsBreadcrumb />
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Brain className="w-6 h-6 text-primary" />
          Cortex
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your AI intelligence layer — daily briefs, relationship scoring, and the knowledge library that powers it all.
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
