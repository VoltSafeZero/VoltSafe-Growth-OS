import { Link } from "wouter";
import { Settings, PenSquare, Mic, Car, ArrowRight } from "lucide-react";
import { CmsBreadcrumb } from "@/components/shared/cms-breadcrumb";

const cards = [
  {
    href: "/settings/personal",
    icon: Settings,
    iconBg: "bg-sky-500/10",
    iconColor: "text-sky-400",
    title: "Personal Settings",
    desc: "Timezone, notification preferences, display options, and your personal profile.",
    tags: ["Preferences", "Profile", "Notifications"],
    testId: "card-personal-settings",
  },
  {
    href: "/settings/signatures",
    icon: PenSquare,
    iconBg: "bg-violet-500/10",
    iconColor: "text-violet-400",
    title: "Email Signatures",
    desc: "Design rich email signatures with CTA buttons and built-in link tracking.",
    tags: ["CTA tracking", "Rich HTML", "Templates"],
    testId: "card-signatures",
  },
  {
    href: "/settings/voice-profiles",
    icon: Mic,
    iconBg: "bg-emerald-500/10",
    iconColor: "text-emerald-400",
    title: "AI Voice Profiles",
    desc: "Train the AI to write in your style — generate emails that sound exactly like you.",
    tags: ["AI training", "Style matching", "GPT-powered"],
    testId: "card-voice-profiles",
  },
  {
    href: "/my-travel",
    icon: Car,
    iconBg: "bg-amber-500/10",
    iconColor: "text-amber-400",
    title: "My Travel",
    desc: "Log and track business travel, site visits, and customer trips.",
    tags: ["Travel log", "Mileage", "Site visits"],
    testId: "card-my-travel",
  },
];

export default function WorkPersonalSettingsPage() {
  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto" data-testid="hub-work-personal-settings">
      <div>
        <CmsBreadcrumb />
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Settings className="w-6 h-6 text-primary" />
          Personal Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your personal workspace — configure how VoltSafe works for you.
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
