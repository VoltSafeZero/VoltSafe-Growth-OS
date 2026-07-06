import { Link } from "wouter";
import { MessageSquare, Flame, ArrowRight, TrendingUp, Mail } from "lucide-react";

export default function MarketingEngagementPage() {
  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto" data-testid="marketing-engagement-hub">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <MessageSquare className="w-6 h-6 text-primary" />
          Engagement
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Reply intelligence and hot account tracking — powered by your outbound campaigns.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Replies card */}
        <Link href="/marketing/replies">
          <div
            className="group rounded-xl border border-border/50 bg-card hover:bg-primary/5 hover:border-primary/40 transition-all cursor-pointer p-5 flex flex-col gap-3"
            data-testid="engagement-card-replies"
          >
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-violet-500/10">
                <Mail className="w-5 h-5 text-violet-400" />
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground group-hover:text-primary transition-colors">
                Replies
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5 leading-snug">
                Inbound reply classification, sentiment analysis, and task creation for campaign responses.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-auto">
              {["Auto-ingested", "Sentiment scoring", "Task creation"].map(tag => (
                <span key={tag} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/30">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </Link>

        {/* Hot Accounts card */}
        <Link href="/marketing/hot-accounts">
          <div
            className="group rounded-xl border border-border/50 bg-card hover:bg-primary/5 hover:border-primary/40 transition-all cursor-pointer p-5 flex flex-col gap-3"
            data-testid="engagement-card-hot-accounts"
          >
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-orange-500/10">
                <Flame className="w-5 h-5 text-orange-400" />
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground group-hover:text-primary transition-colors">
                Hot Accounts
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5 leading-snug">
                Accounts showing high-intent signals — opens, clicks, and repeated engagement heatmap.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-auto">
              {["Heatmap view", "Signal filters", "CRM linked"].map(tag => (
                <span key={tag} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/30">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </Link>
      </div>

      {/* Quick links */}
      <div className="rounded-xl border border-border/30 bg-muted/20 p-4">
        <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider mb-3">Quick links</p>
        <div className="flex flex-col gap-1">
          {[
            { label: "Campaign Replies",    href: "/marketing/replies",      icon: MessageSquare },
            { label: "Hot Account Signals", href: "/marketing/hot-accounts", icon: Flame },
            { label: "Marketing Dashboard", href: "/marketing/dashboard",    icon: TrendingUp },
            { label: "All Campaigns",       href: "/marketing/campaigns",    icon: Mail },
          ].map(({ label, href, icon: Icon }) => (
            <Link key={href} href={href}>
              <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-primary/8 hover:text-primary text-muted-foreground text-sm transition-colors cursor-pointer group" data-testid={`engagement-link-${label.toLowerCase().replace(/\s+/g, "-")}`}>
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{label}</span>
                <ArrowRight className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-60 transition-opacity" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
