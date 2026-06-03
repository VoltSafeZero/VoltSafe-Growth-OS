/**
 * EngagementWidget — compact engagement intelligence panel.
 *
 * Used on:
 *   - Contact profile page (by contactId)
 *   - Account profile page (by accountId)
 *
 * Related:
 *   - CtaEngagementBanner — thin thread-view banner (exported separately)
 */

import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, format, isToday, isYesterday } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MousePointerClick, Mail, Eye, Zap, TrendingUp, Clock,
  ArrowRight, AlertTriangle, ThumbsUp, Flame
} from "lucide-react";

// ── Types (mirrors server response shape) ─────────────────────────────────

type IntentLevel =
  | "none"
  | "interested"
  | "high_intent"
  | "very_high_intent"
  | "follow_up_recommended";

interface ContactEngagement {
  contactId: number;
  accountId: number | null;
  contactName: string;
  contactEmail: string | null;
  totalCtaClicks: number;
  uniqueCtasClicked: number;
  demoClickCount: number;
  demoClicksIn7d: number;
  lastCtaClickedAt: string | null;
  lastCtaName: string | null;
  lastCtaDestination: string | null;
  totalOpens: number;
  uniqueOpens: number;
  lastOpenAt: string | null;
  isReplied: boolean;
  lastReplyAt: string | null;
  intentLevel: IntentLevel;
  suggestedAction: string | null;
}

interface AccountEngagement {
  accountId: number;
  accountName: string;
  totalCtaClicks: number;
  demoClickCount: number;
  engagedContactCount: number;
  demoCtickerContactCount: number;
  mostClickedCtaName: string | null;
  lastCtaClickedAt: string | null;
  intentLevel: IntentLevel;
  suggestedAction: string | null;
  contacts: ContactEngagement[];
}

interface ThreadEngagement {
  threadId: string;
  ctaClicks: Array<{
    recipientEmail: string;
    contactId: number | null;
    ctaName: string | null;
    clickCount: number;
    lastClickedAt: string | null;
    intentLevel: IntentLevel;
  }>;
  totalCtaClicks: number;
  uniqueCtaRecipients: number;
  hasHighIntent: boolean;
  bannerText: string | null;
  suggestedAction: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function friendlyDate(isoStr: string | null): string {
  if (!isoStr) return "—";
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return "—";
  if (isToday(d))     return formatDistanceToNow(d, { addSuffix: true });
  if (isYesterday(d)) return "Yesterday";
  const ageMs = Date.now() - d.getTime();
  if (ageMs < 7 * 24 * 60 * 60 * 1000) return formatDistanceToNow(d, { addSuffix: true });
  return format(d, "MMM d, yyyy");
}

// ── Intent Badge ──────────────────────────────────────────────────────────

interface IntentBadgeProps {
  level: IntentLevel;
  className?: string;
}

export function EngagementIntentBadge({ level, className = "" }: IntentBadgeProps) {
  const cfg: Record<IntentLevel, { label: string; icon: React.ReactNode; cls: string }> = {
    none: {
      label: "No activity",
      icon: null,
      cls: "bg-muted/30 text-muted-foreground border-muted/20",
    },
    interested: {
      label: "Interested",
      icon: <ThumbsUp className="h-2.5 w-2.5" />,
      cls: "bg-sky-500/10 text-sky-400 border-sky-500/20",
    },
    high_intent: {
      label: "High Intent",
      icon: <Zap className="h-2.5 w-2.5" />,
      cls: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    },
    very_high_intent: {
      label: "Very High Intent",
      icon: <Flame className="h-2.5 w-2.5" />,
      cls: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    },
    follow_up_recommended: {
      label: "Follow Up",
      icon: <AlertTriangle className="h-2.5 w-2.5" />,
      cls: "bg-red-500/10 text-red-400 border-red-500/20",
    },
  };

  const { label, icon, cls } = cfg[level] ?? cfg.none;
  if (level === "none") return null;

  return (
    <Badge
      variant="outline"
      className={`inline-flex items-center gap-1 text-[10.5px] font-medium h-5 px-1.5 border ${cls} ${className}`}
      data-testid={`intent-badge-${level}`}
    >
      {icon}
      {label}
    </Badge>
  );
}

// ── Follow-up button ──────────────────────────────────────────────────────

interface CreateFollowUpButtonProps {
  contactEmail: string | null;
  contactName: string;
  ctaName: string | null;
  className?: string;
  size?: "sm" | "xs";
}

export function CreateFollowUpButton({
  contactEmail,
  contactName,
  ctaName,
  className = "",
  size = "sm",
}: CreateFollowUpButtonProps) {
  function openComposer() {
    const firstName = contactName.split(" ")[0] || contactName;
    const isDemoCta = (ctaName ?? "").toLowerCase().includes("demo") ||
                      (ctaName ?? "").toLowerCase().includes("watch");

    const subject = isDemoCta
      ? "Following up on the VoltSafe demo"
      : `Any questions on VoltSafe?`;

    const body = isDemoCta
      ? `Hi ${firstName},\n\nI wanted to follow up in case the demo raised any questions or if you'd like a walkthrough of how VoltSafe applies to your marina.\n\nWould it be helpful to schedule a quick 15-minute call this week?\n\nBest,`
      : `Hi ${firstName},\n\nI wanted to follow up and see if you had any questions — happy to help.\n\nBest,`;

    // Fire the global compose event the existing ComposeDialog listens to
    window.dispatchEvent(
      new CustomEvent("open-compose", {
        detail: {
          to: contactEmail ?? "",
          subject,
          body,
        },
      })
    );
  }

  return (
    <Button
      size={size === "xs" ? "sm" : size}
      variant="outline"
      onClick={openComposer}
      className={`h-7 text-[11.5px] gap-1 border-primary/30 text-primary hover:bg-primary/10 ${className}`}
      data-testid="button-create-followup"
    >
      <Mail className="h-3 w-3" />
      Follow-Up Email
    </Button>
  );
}

// ── Summary stat cards ─────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 bg-muted/20 rounded-lg border border-border/20 px-3 py-2 min-w-0">
      <div className="flex items-center gap-1 text-muted-foreground">
        <Icon className="h-3 w-3 flex-shrink-0" />
        <span className="text-[10px] font-medium uppercase tracking-wide truncate">{label}</span>
      </div>
      <span className="text-base font-semibold text-foreground leading-tight">{value}</span>
      {sub && <span className="text-[10px] text-muted-foreground truncate">{sub}</span>}
    </div>
  );
}

// ── Contact engagement widget ─────────────────────────────────────────────

export function ContactEngagementWidget({ contactId }: { contactId: number }) {
  const { data, isLoading, isError } = useQuery<ContactEngagement>({
    queryKey: ["/api/engagement/contact", contactId],
    queryFn: () =>
      fetch(`/api/engagement/contact/${contactId}`, { credentials: "include" })
        .then(r => r.ok ? r.json() : Promise.reject(r)),
    staleTime: 60_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="engagement-widget-loading">
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-3/4 rounded-lg" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p className="text-xs text-muted-foreground/60 py-1" data-testid="engagement-widget-error">
        Couldn't load engagement activity.
      </p>
    );
  }

  if (data.intentLevel === "none" && data.totalOpens === 0) {
    return (
      <div className="text-center py-4" data-testid="engagement-widget-empty">
        <p className="text-xs text-muted-foreground/60">No engagement yet.</p>
        <p className="text-[11px] text-muted-foreground/40 mt-0.5">
          When this contact opens or clicks your email, activity will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid={`engagement-widget-contact-${contactId}`}>
      {/* Intent badge + suggested action */}
      {data.intentLevel !== "none" && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <EngagementIntentBadge level={data.intentLevel} />
          {data.suggestedAction && data.contactEmail && (
            <CreateFollowUpButton
              contactEmail={data.contactEmail}
              contactName={data.contactName}
              ctaName={data.lastCtaName}
              size="xs"
            />
          )}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard
          icon={Eye}
          label="Opens"
          value={data.uniqueOpens}
          sub={data.lastOpenAt ? friendlyDate(data.lastOpenAt) : undefined}
        />
        <StatCard
          icon={MousePointerClick}
          label="Demo Clicks"
          value={data.demoClickCount}
          sub={data.lastCtaClickedAt ? friendlyDate(data.lastCtaClickedAt) : undefined}
        />
      </div>

      {/* Last CTA clicked */}
      {data.lastCtaName && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <MousePointerClick className="h-3 w-3 flex-shrink-0 text-primary/60" />
          <span>
            Last clicked: <span className="text-foreground font-medium">"{data.lastCtaName}"</span>
            {data.lastCtaClickedAt && (
              <span className="text-muted-foreground/60"> · {friendlyDate(data.lastCtaClickedAt)}</span>
            )}
          </span>
        </div>
      )}

      {data.isReplied && (
        <div className="flex items-center gap-1.5 text-[11px] text-emerald-400/80">
          <Mail className="h-3 w-3" />
          <span>Replied</span>
        </div>
      )}
    </div>
  );
}

// ── Account engagement widget ─────────────────────────────────────────────

export function AccountEngagementWidget({ accountId }: { accountId: number }) {
  const { data, isLoading, isError } = useQuery<AccountEngagement>({
    queryKey: ["/api/engagement/account", accountId],
    queryFn: () =>
      fetch(`/api/engagement/account/${accountId}`, { credentials: "include" })
        .then(r => r.ok ? r.json() : Promise.reject(r)),
    staleTime: 60_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="engagement-widget-loading">
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-8 w-3/4 rounded-lg" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p className="text-xs text-muted-foreground/60 py-1" data-testid="engagement-widget-error">
        Couldn't load engagement activity.
      </p>
    );
  }

  if (data.intentLevel === "none") {
    return (
      <div className="text-center py-4" data-testid="engagement-widget-empty">
        <p className="text-xs text-muted-foreground/60">No engagement yet.</p>
        <p className="text-[11px] text-muted-foreground/40 mt-0.5">
          When contacts at this account click your emails, activity will appear here.
        </p>
      </div>
    );
  }

  const activeContacts = data.contacts.filter(c => c.intentLevel !== "none");

  return (
    <div className="space-y-3" data-testid={`engagement-widget-account-${accountId}`}>
      {/* Account-level badge */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <EngagementIntentBadge level={data.intentLevel} />
        {data.demoCtickerContactCount >= 2 && (
          <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-orange-500/30 text-orange-400 bg-orange-500/10">
            <Flame className="h-2.5 w-2.5 mr-1" />
            Account Heating Up
          </Badge>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-1.5">
        <StatCard
          icon={MousePointerClick}
          label="Demo Clicks"
          value={data.demoClickCount}
          sub={data.lastCtaClickedAt ? friendlyDate(data.lastCtaClickedAt) : undefined}
        />
        <StatCard
          icon={TrendingUp}
          label="Engaged"
          value={data.engagedContactCount}
          sub={data.engagedContactCount === 1 ? "contact" : "contacts"}
        />
        <StatCard
          icon={Clock}
          label="Last Activity"
          value={data.lastCtaClickedAt ? friendlyDate(data.lastCtaClickedAt) : "—"}
        />
      </div>

      {/* Per-contact rows */}
      {activeContacts.length > 0 && (
        <div className="space-y-1.5">
          {activeContacts.map(c => (
            <div key={c.contactId}
              className="flex items-center gap-2 py-1.5 border-b border-border/15 last:border-0"
              data-testid={`engagement-contact-row-${c.contactId}`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate">{c.contactName}</p>
                {c.lastCtaName && (
                  <p className="text-[10.5px] text-muted-foreground/70 truncate">
                    Clicked "{c.lastCtaName}"
                    {c.demoClickCount > 1 && ` · ${c.demoClickCount}×`}
                    {c.lastCtaClickedAt && ` · ${friendlyDate(c.lastCtaClickedAt)}`}
                  </p>
                )}
              </div>
              <EngagementIntentBadge level={c.intentLevel} />
              {c.suggestedAction && c.contactEmail && (
                <CreateFollowUpButton
                  contactEmail={c.contactEmail}
                  contactName={c.contactName}
                  ctaName={c.lastCtaName}
                  size="xs"
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Thread CTA banner (used in gmail-inbox.tsx) ───────────────────────────

export function CtaEngagementBanner({ threadId }: { threadId: string | null }) {
  const { data } = useQuery<ThreadEngagement>({
    queryKey: ["/api/engagement/thread", threadId],
    queryFn: () =>
      fetch(`/api/engagement/thread/${encodeURIComponent(threadId!)}`, { credentials: "include" })
        .then(r => r.ok ? r.json() : Promise.reject(r)),
    enabled: !!threadId,
    staleTime: 30_000,
    retry: false,
  });

  if (!data || !data.bannerText || data.totalCtaClicks === 0) return null;

  const levelCls: Record<IntentLevel, string> = {
    none:                 "hidden",
    interested:           "border-sky-500/20 bg-sky-500/5 text-sky-300",
    high_intent:          "border-amber-500/20 bg-amber-500/5 text-amber-300",
    very_high_intent:     "border-orange-500/20 bg-orange-500/5 text-orange-300",
    follow_up_recommended:"border-red-500/20 bg-red-500/5 text-red-300",
  };

  const topLevel = data.ctaClicks.reduce<IntentLevel>((best, r) => {
    const order: IntentLevel[] = ["none","interested","high_intent","very_high_intent","follow_up_recommended"];
    return order.indexOf(r.intentLevel) > order.indexOf(best) ? r.intentLevel : best;
  }, "none");

  const cls = levelCls[topLevel] ?? levelCls.interested;

  return (
    <div
      className={`flex-shrink-0 flex items-center gap-2 px-3 py-1.5 border-b text-[11.5px] ${cls}`}
      data-testid="cta-engagement-banner"
    >
      <MousePointerClick className="h-3 w-3 flex-shrink-0" />
      <span className="flex-1 min-w-0 truncate">{data.bannerText}</span>
      {data.suggestedAction && (
        <span className="flex items-center gap-0.5 flex-shrink-0 opacity-70 text-[10.5px]">
          {data.suggestedAction}
          <ArrowRight className="h-2.5 w-2.5" />
        </span>
      )}
    </div>
  );
}
