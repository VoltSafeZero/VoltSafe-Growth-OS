// client/src/components/today/ceo-cockpit-sections.tsx
// CEO Cockpit UI sections — Team Communication Radar + 1:1 Operating System
// Only rendered for master_admin/admin users. No keystroke tracking, no shaming language.

import { useState } from "react";
import { Link } from "wouter";
import {
  Users, AlertTriangle, EyeOff, ClipboardList, Calendar,
  Zap, Radio, ChevronRight, Copy, Check, ExternalLink,
  TrendingDown, Clock, MessageSquare, Activity, User,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { OneOnOneDrawer, UpdateDraftSheet } from "./ceo-one-on-ones";
import { QueueActionButton } from "./ceo-action-queue";

// ── Shared types (mirroring service output) ────────────────────────────────────

export type SignalLabel =
  | "Active" | "Blocked" | "Overloaded" | "Needs follow-up"
  | "Quiet" | "No current signals" | "Waiting on CEO";

export type TeamMember = {
  id: number; name: string; email: string; role: string;
  department: string | null; jobTitle: string | null;
  activeTasks: number; overdueTasks: number; blockedTasks: number;
  ownedProjects: number; lastSignalAt: string | null;
  signal: { label: SignalLabel; reason: string };
  openCommitments: number; link: string;
};

export type BlockerItem = {
  id: string; title: string; ownerName: string | null; ownerId: number | null;
  source: "task" | "deployment" | "install" | "support" | "procurement";
  severity: "critical" | "high" | "medium" | "low";
  ageHours: number; ageDays: number; link: string;
  nextAction: string | null; askForUpdateText: string;
};

export type SilenceItem = {
  id: string; title: string; type: "task" | "opportunity" | "project" | "support_ticket" | "team_member";
  ownerName: string | null; ownerId: number | null;
  staleDays: number; reason: string; link: string; askForUpdateText: string;
};

export type CommitmentItem = {
  id: string; title: string; ownerName: string | null; ownerId: number | null;
  dueDate: string | null; source: string; status: string; daysOverdue: number; link: string;
};

export type OneOnOneItem = {
  userId: number; userName: string; nextScheduled: string | null; lastMeeting: string | null;
  openActionItems: number; overdueCommitments: number; suggestedAgenda: string[]; link: string;
};

export type CeoAttentionItem = {
  id: string; title: string; reason: string; source: string;
  ageHours: number; ownerName: string | null; link: string;
};

export type HotspotChannel = {
  id: number; name: string; slug: string; messageCount7d: number;
  lastMessageAt: string | null; isQuiet: boolean;
};

export type CeoCockpitData = {
  generated_at: string;
  user: { id: number };
  sections: {
    team_pulse: {
      title: string; members: TeamMember[];
      source_counts: { total: number; blocked: number; quiet: number; overloaded: number };
      empty_state: string;
    };
    blockers: { title: string; count: number; items: BlockerItem[]; empty_state: string };
    silence_watch: { title: string; count: number; items: SilenceItem[]; empty_state: string };
    commitments: { title: string; count: number; overdue: number; items: CommitmentItem[]; empty_state: string };
    one_on_ones: { title: string; items: OneOnOneItem[]; empty_state: string };
    ceo_attention: { title: string; count: number; items: CeoAttentionItem[]; empty_state: string };
    communication_hotspots: {
      title: string; active_channels: HotspotChannel[]; quiet_channels: HotspotChannel[];
      unanswered_mentions: number; empty_state: string;
    };
  };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAgo(isoStr: string | null): string {
  if (!isoStr) return "";
  const ms = Date.now() - new Date(isoStr).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

function fmtDate(isoStr: string | null): string {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function CopyButton({ text, label = "copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      toast({ description: "Message copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <Button
      size="sm" variant="ghost"
      className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
      onClick={handleCopy}
      data-testid="ask-for-update-copy"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

function SignalBadge({ label }: { label: SignalLabel }) {
  const map: Record<SignalLabel, { color: string; dot: string }> = {
    "Active":           { color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", dot: "bg-emerald-400" },
    "Blocked":          { color: "bg-red-500/10 text-red-400 border-red-500/20",     dot: "bg-red-400" },
    "Overloaded":       { color: "bg-amber-500/10 text-amber-400 border-amber-500/20", dot: "bg-amber-400" },
    "Needs follow-up":  { color: "bg-orange-500/10 text-orange-400 border-orange-500/20", dot: "bg-orange-400" },
    "Quiet":            { color: "bg-slate-500/10 text-slate-400 border-slate-500/20", dot: "bg-slate-400" },
    "No current signals": { color: "bg-slate-500/10 text-slate-400 border-slate-500/20", dot: "bg-slate-500" },
    "Waiting on CEO":   { color: "bg-violet-500/10 text-violet-400 border-violet-500/20", dot: "bg-violet-400" },
  };
  const { color, dot } = map[label] ?? map["Active"];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full border ${color}`}
      data-testid={`signal-badge-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function SeverityDot({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    critical: "bg-red-500", high: "bg-orange-400", medium: "bg-amber-400", low: "bg-slate-400",
  };
  return <span className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${map[severity] ?? map.medium}`} />;
}

function EmptyCockpitState({ text }: { text: string }) {
  return (
    <div className="py-6 flex flex-col items-center gap-2 text-center" data-testid="cockpit-empty-state">
      <Check className="h-5 w-5 text-emerald-400" />
      <p className="text-xs text-muted-foreground">{text}</p>
    </div>
  );
}

// ── 1. Team Pulse ─────────────────────────────────────────────────────────────

export function TeamPulseSection({ data }: { data: CeoCockpitData["sections"]["team_pulse"] }) {
  if (!data.members.length) return <EmptyCockpitState text={data.empty_state} />;

  return (
    <div className="space-y-2" data-testid="team-pulse-section">
      <div className="flex gap-3 mb-3 flex-wrap">
        {data.source_counts.blocked > 0 && (
          <span className="text-[11px] text-red-400 font-medium">{data.source_counts.blocked} blocked</span>
        )}
        {data.source_counts.overloaded > 0 && (
          <span className="text-[11px] text-amber-400 font-medium">{data.source_counts.overloaded} overloaded</span>
        )}
        {data.source_counts.quiet > 0 && (
          <span className="text-[11px] text-slate-400 font-medium">{data.source_counts.quiet} quiet</span>
        )}
      </div>
      {data.members.map((m) => (
        <div
          key={m.id}
          className="flex items-start justify-between gap-3 py-2.5 px-3 rounded-md bg-card/50 border border-border/30 hover:border-border/60 transition-colors"
          data-testid={`team-member-row-${m.id}`}
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="h-7 w-7 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0 mt-0.5">
              <User className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Link href={m.link}>
                  <span className="text-sm font-medium hover:text-primary cursor-pointer">{m.name}</span>
                </Link>
                <SignalBadge label={m.signal.label} />
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">{m.signal.reason}</p>
              {(m.jobTitle || m.department) && (
                <p className="text-[10px] text-muted-foreground/70">{[m.jobTitle, m.department].filter(Boolean).join(" · ")}</p>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0 text-right">
            <div className="flex gap-2">
              {m.activeTasks > 0 && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <span className="text-[10px] text-muted-foreground" data-testid={`member-active-tasks-${m.id}`}>
                        {m.activeTasks} tasks
                      </span>
                    </TooltipTrigger>
                    <TooltipContent><p>Active tasks assigned</p></TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {m.overdueTasks > 0 && (
                <span className="text-[10px] text-red-400" data-testid={`member-overdue-tasks-${m.id}`}>
                  {m.overdueTasks} overdue
                </span>
              )}
            </div>
            {(m.signal.label === "Blocked" || m.signal.label === "Needs follow-up") && (
              <QueueActionButton
                label="Queue"
                testId={`queue-team-pulse-${m.id}`}
                data={{
                  type: "ask_for_update", priority: "high",
                  source_section: "team_pulse", source_type: "user",
                  source_id: String(m.id),
                  assigned_to_user_id: m.id,
                  title: `Ask ${m.name} for update`,
                  body: `${m.name} has a "${m.signal.label}" signal.`,
                  suggested_message: `Hey ${m.name.split(" ")[0]}, can you share a quick update and any blockers?`,
                }}
              />
            )}
            {m.signal.label === "Quiet" && (
              <QueueActionButton
                label="Queue check-in"
                testId={`queue-team-pulse-quiet-${m.id}`}
                data={{
                  type: "follow_up", priority: "medium",
                  source_section: "team_pulse", source_type: "user",
                  source_id: String(m.id),
                  assigned_to_user_id: m.id,
                  title: `Check in with ${m.name}`,
                  body: m.signal.reason,
                  suggested_message: `Hey ${m.name.split(" ")[0]}, just checking in — how are things going?`,
                }}
              />
            )}
            {m.lastSignalAt && (
              <span className="text-[10px] text-muted-foreground/50">{fmtAgo(m.lastSignalAt)}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 2. Blockers ───────────────────────────────────────────────────────────────

const SOURCE_LABEL: Record<string, string> = {
  task: "Task", deployment: "Deployment", install: "Installation",
  support: "Support", procurement: "Procurement",
};

export function BlockersSection({ data }: { data: CeoCockpitData["sections"]["blockers"] }) {
  if (!data.items.length) return <EmptyCockpitState text={data.empty_state} />;

  return (
    <div className="space-y-2" data-testid="blockers-section">
      {data.items.map((b) => (
        <div
          key={b.id}
          className="flex items-start justify-between gap-3 py-2.5 px-3 rounded-md bg-card/50 border border-border/30 hover:border-border/60 transition-colors"
          data-testid={`blocker-item-${b.id}`}
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <SeverityDot severity={b.severity} />
            <div className="min-w-0">
              <Link href={b.link}>
                <span className="text-sm hover:text-primary cursor-pointer line-clamp-1">{b.title}</span>
              </Link>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-[10px] text-muted-foreground">{SOURCE_LABEL[b.source] ?? b.source}</span>
                {b.ownerName && <span className="text-[10px] text-muted-foreground">· {b.ownerName}</span>}
                <span className="text-[10px] text-muted-foreground/50">{fmtAgo(new Date(Date.now() - b.ageHours * 3600000).toISOString())}</span>
              </div>
              {b.nextAction && (
                <p className="text-[10px] text-amber-400 mt-0.5 line-clamp-1">Blocker: {b.nextAction}</p>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <CopyButton text={b.askForUpdateText} label="Ask update" />
            <QueueActionButton
              label="Queue follow-up"
              testId={`queue-blocker-${b.id}`}
              data={{
                type: "resolve_blocker",
                priority: b.severity === "critical" ? "critical" : b.ageDays > 7 ? "high" : "medium",
                source_section: "blockers",
                source_type: b.source,
                source_id: String(b.id),
                assigned_to_user_id: b.ownerId ?? undefined,
                title: `Resolve blocker: ${b.title}`,
                body: `${b.ownerName ?? "Someone"} is blocked on "${b.title}" (${b.ageDays}d). ${b.nextAction ?? ""}`.trim(),
                suggested_message: b.askForUpdateText,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 3. Silence Watch ──────────────────────────────────────────────────────────

export function SilenceWatchSection({ data }: { data: CeoCockpitData["sections"]["silence_watch"] }) {
  if (!data.items.length) return <EmptyCockpitState text={data.empty_state} />;

  const typeLabel: Record<string, string> = {
    task: "Task", opportunity: "Opportunity", project: "Project",
    support_ticket: "Support Ticket", team_member: "Team Member",
  };

  return (
    <div className="space-y-2" data-testid="silence-watch-section">
      {data.items.map((s) => (
        <div
          key={s.id}
          className="flex items-start justify-between gap-3 py-2.5 px-3 rounded-md bg-card/50 border border-border/30 hover:border-border/60 transition-colors"
          data-testid={`silence-item-${s.id}`}
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <Clock className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <Link href={s.link}>
                <span className="text-sm hover:text-primary cursor-pointer line-clamp-1">{s.title}</span>
              </Link>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <Badge variant="outline" className="text-[9px] h-4 px-1 font-normal">{typeLabel[s.type] ?? s.type}</Badge>
                {s.ownerName && <span className="text-[10px] text-muted-foreground">{s.ownerName}</span>}
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">{s.reason}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <CopyButton text={s.askForUpdateText} label="Check in" />
            <QueueActionButton
              label="Queue check-in"
              testId={`queue-silence-${s.id}`}
              data={{
                type: "follow_up",
                priority: (s.staleDays ?? 0) > 14 ? "high" : "medium",
                source_section: "silence_watch",
                source_type: s.type,
                source_id: String(s.id),
                assigned_to_user_id: s.ownerId ?? undefined,
                title: `Check in: ${s.title}`,
                body: `${s.reason}. Owner: ${s.ownerName ?? "unknown"}.`,
                suggested_message: s.askForUpdateText,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 4. Commitments ────────────────────────────────────────────────────────────

export function CommitmentsSection({ data }: { data: CeoCockpitData["sections"]["commitments"] }) {
  if (!data.items.length) return <EmptyCockpitState text={data.empty_state} />;

  return (
    <div className="space-y-2" data-testid="commitments-section">
      {data.overdue > 0 && (
        <div className="text-[11px] text-red-400 font-medium mb-2">
          {data.overdue} overdue commitment{data.overdue !== 1 ? "s" : ""}
        </div>
      )}
      {data.items.map((c) => (
        <div
          key={c.id}
          className="flex items-start justify-between gap-3 py-2.5 px-3 rounded-md bg-card/50 border border-border/30 hover:border-border/60 transition-colors"
          data-testid={`commitment-item-${c.id}`}
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <ClipboardList className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <Link href={c.link}>
                <span className="text-sm hover:text-primary cursor-pointer line-clamp-1">{c.title}</span>
              </Link>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                {c.ownerName && <span className="text-[10px] text-muted-foreground">{c.ownerName}</span>}
                <span className="text-[10px] text-muted-foreground/70">{c.source}</span>
                {c.dueDate && (
                  <span className={`text-[10px] ${c.daysOverdue > 0 ? "text-red-400" : "text-muted-foreground"}`}>
                    {c.daysOverdue > 0 ? `${c.daysOverdue}d overdue` : `Due ${fmtDate(c.dueDate)}`}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Link href={c.link}>
              <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1">
                <ExternalLink className="h-3 w-3" /> View
              </Button>
            </Link>
            {c.daysOverdue > 0 && (
              <QueueActionButton
                label="Queue review"
                testId={`queue-commitment-${c.id}`}
                data={{
                  type: "review_commitment",
                  priority: c.daysOverdue > 7 ? "critical" : "high",
                  source_section: "commitments",
                  source_type: "task",
                  source_id: String(c.id),
                  assigned_to_user_id: c.ownerId ?? undefined,
                  title: `Overdue commitment: ${c.title}`,
                  body: `"${c.title}" by ${c.ownerName ?? "unknown"} is ${c.daysOverdue}d overdue.`,
                }}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 5. 1:1 Operating System ───────────────────────────────────────────────────

export function OneOnOnesSection({ data }: { data: CeoCockpitData["sections"]["one_on_ones"] }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [drawerUserId, setDrawerUserId] = useState<number | null>(null);
  const [updateDraftUserId, setUpdateDraftUserId] = useState<number | null>(null);

  const drawerItem = data.items.find(i => i.userId === drawerUserId) ?? null;
  const updateDraftItem = data.items.find(i => i.userId === updateDraftUserId) ?? null;

  if (!data.items.length) return <EmptyCockpitState text={data.empty_state} />;

  return (
    <>
      <div className="space-y-2" data-testid="one-on-ones-section">
        {data.items.map((item) => {
          const isExpanded = expandedId === item.userId;
          const hasWarnings = item.overdueCommitments > 0 || item.openActionItems > 0;
          return (
            <div
              key={item.userId}
              className="rounded-md border border-border/30 overflow-hidden"
              data-testid={`one-on-one-row-${item.userId}`}
            >
              <div className="w-full flex items-center justify-between gap-3 py-2.5 px-3">
                <button
                  className="flex items-center gap-2.5 min-w-0 flex-1 text-left hover:bg-card/50 transition-colors rounded"
                  onClick={() => setExpandedId(isExpanded ? null : item.userId)}
                  data-testid={`one-on-one-expand-${item.userId}`}
                >
                  <div className="h-7 w-7 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                    <User className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-sm font-medium">{item.userName}</span>
                    {hasWarnings && (
                      <span className="ml-2 text-[10px] text-amber-400">
                        {item.overdueCommitments > 0 ? `${item.overdueCommitments} overdue` : `${item.openActionItems} open`}
                      </span>
                    )}
                  </div>
                </button>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="text-right hidden sm:block">
                    {item.nextScheduled ? (
                      <p className="text-[11px] text-primary">{fmtDate(item.nextScheduled)}</p>
                    ) : (
                      <p className="text-[10px] text-muted-foreground">No 1:1 scheduled</p>
                    )}
                    {item.lastMeeting && (
                      <p className="text-[10px] text-muted-foreground/50">Last: {fmtDate(item.lastMeeting)}</p>
                    )}
                  </div>
                  <Button
                    size="sm" variant="outline"
                    className="h-6 text-[10px] gap-1 flex-shrink-0"
                    onClick={() => setDrawerUserId(item.userId)}
                    data-testid={`open-one-on-one-drawer-${item.userId}`}
                  >
                    <Calendar className="h-2.5 w-2.5" /> Open 1:1
                  </Button>
                  <ChevronRight
                    className={`h-3.5 w-3.5 text-muted-foreground transition-transform cursor-pointer ${isExpanded ? "rotate-90" : ""}`}
                    onClick={() => setExpandedId(isExpanded ? null : item.userId)}
                  />
                </div>
              </div>
              {isExpanded && (
                <div className="border-t border-border/30 px-3 py-2.5 bg-card/30 space-y-2" data-testid={`one-on-one-detail-${item.userId}`}>
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Suggested Agenda</p>
                  <ul className="space-y-1">
                    {item.suggestedAgenda.map((topic, i) => (
                      <li key={i} className="flex items-start gap-2 text-[11px] text-foreground/80">
                        <span className="text-muted-foreground mt-0.5">·</span>
                        {topic}
                      </li>
                    ))}
                  </ul>
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm" variant="outline" className="h-6 text-[10px] gap-1"
                      onClick={() => setDrawerUserId(item.userId)}
                      data-testid={`open-1on1-notes-${item.userId}`}
                    >
                      <Zap className="h-2.5 w-2.5" /> Notes &amp; Commitments
                    </Button>
                    <Button
                      size="sm" variant="ghost" className="h-6 text-[10px] gap-1"
                      onClick={() => setUpdateDraftUserId(item.userId)}
                      data-testid={`open-update-draft-inline-${item.userId}`}
                    >
                      <MessageSquare className="h-2.5 w-2.5" /> Ask for Update
                    </Button>
                    <Link href={item.link}>
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1">
                        <ExternalLink className="h-2.5 w-2.5" /> Tasks
                      </Button>
                    </Link>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {drawerItem && (
        <OneOnOneDrawer
          item={drawerItem}
          isOpen={drawerUserId !== null}
          onClose={() => setDrawerUserId(null)}
        />
      )}

      {updateDraftItem && (
        <UpdateDraftSheet
          targetUserId={updateDraftItem.userId}
          targetName={updateDraftItem.userName}
          sourceType="team_pulse"
          isOpen={updateDraftUserId !== null}
          onClose={() => setUpdateDraftUserId(null)}
        />
      )}
    </>
  );
}

// ── 6. CEO Attention ──────────────────────────────────────────────────────────

export function CeoAttentionSection({ data }: { data: CeoCockpitData["sections"]["ceo_attention"] }) {
  if (!data.items.length) return <EmptyCockpitState text={data.empty_state} />;

  const sourceIcon = (source: string) => {
    if (source === "currents") return <MessageSquare className="h-3.5 w-3.5 text-primary" />;
    return <ClipboardList className="h-3.5 w-3.5 text-amber-400" />;
  };

  return (
    <div className="space-y-2" data-testid="ceo-attention-section">
      {data.items.map((item) => (
        <div
          key={item.id}
          className="flex items-start justify-between gap-3 py-2.5 px-3 rounded-md bg-card/50 border border-amber-500/20 hover:border-amber-500/40 transition-colors"
          data-testid={`ceo-attention-item-${item.id}`}
        >
          <div className="flex items-start gap-2.5 min-w-0">
            {sourceIcon(item.source)}
            <div className="min-w-0">
              <Link href={item.link}>
                <span className="text-sm hover:text-primary cursor-pointer line-clamp-1">{item.title}</span>
              </Link>
              <p className="text-[10px] text-muted-foreground mt-0.5">{item.reason}</p>
              {item.ownerName && (
                <p className="text-[10px] text-muted-foreground/60">From {item.ownerName}</p>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <span className="text-[10px] text-muted-foreground/50">{fmtAgo(new Date(Date.now() - item.ageHours * 3600000).toISOString())}</span>
            <Link href={item.link}>
              <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-primary hover:text-primary">
                <ChevronRight className="h-3 w-3" /> Go
              </Button>
            </Link>
            <QueueActionButton
              label="Queue follow-up"
              testId={`queue-ceo-attention-${item.id}`}
              data={{
                type: "follow_up",
                priority: "medium",
                source_section: "ceo_attention",
                source_type: item.source,
                source_id: String(item.id),
                title: item.title,
                body: item.reason,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 7. Communication Hotspots ─────────────────────────────────────────────────

export function CommunicationHotspotsSection({ data }: { data: CeoCockpitData["sections"]["communication_hotspots"] }) {
  const noData = !data.active_channels.length && !data.quiet_channels.length && data.unanswered_mentions === 0;
  if (noData) return <EmptyCockpitState text={data.empty_state} />;

  return (
    <div className="space-y-4" data-testid="communication-hotspots-section">
      {data.unanswered_mentions > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-primary/5 border border-primary/20" data-testid="unanswered-mentions-badge">
          <MessageSquare className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs text-primary font-medium">
            {data.unanswered_mentions} CURRENTS mention{data.unanswered_mentions !== 1 ? "s" : ""} in the last 7 days
          </span>
          <Link href="/current">
            <Button size="sm" variant="ghost" className="h-6 text-[10px] ml-auto gap-1">
              <ExternalLink className="h-2.5 w-2.5" /> View
            </Button>
          </Link>
        </div>
      )}

      {data.active_channels.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Most active (7 days)</p>
          <div className="space-y-1.5">
            {data.active_channels.map((ch) => (
              <Link key={ch.id} href={`/current?channel=${ch.slug}`}>
                <div className="flex items-center justify-between py-1.5 px-3 rounded hover:bg-card/50 cursor-pointer transition-colors"
                  data-testid={`hotspot-channel-${ch.slug}`}>
                  <div className="flex items-center gap-2">
                    <Activity className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs">#{ch.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-primary">{ch.messageCount7d} msg</span>
                    {ch.lastMessageAt && (
                      <span className="text-[10px] text-muted-foreground/50">{fmtAgo(ch.lastMessageAt)}</span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {data.quiet_channels.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Quiet channels (7 days)</p>
          <div className="space-y-1.5">
            {data.quiet_channels.map((ch) => (
              <Link key={ch.id} href={`/current?channel=${ch.slug}`}>
                <div className="flex items-center justify-between py-1.5 px-3 rounded hover:bg-card/50 cursor-pointer transition-colors"
                  data-testid={`quiet-channel-${ch.slug}`}>
                  <div className="flex items-center gap-2">
                    <EyeOff className="h-3 w-3 text-muted-foreground/50" />
                    <span className="text-xs text-muted-foreground">#{ch.name}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground/50">
                    {ch.lastMessageAt ? `Last: ${fmtAgo(ch.lastMessageAt)}` : "No messages yet"}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
