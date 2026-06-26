import { useState } from "react";
import {
  Sparkles, X, RefreshCw, Loader2, Copy, Check,
  AlignLeft, CheckCircle2, HelpCircle, ListTodo,
  AlertTriangle, ArrowRight, CheckSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CurrentSummaryData {
  summary: string[];
  decisions: string[];
  openQuestions: string[];
  actionItems: Array<{ owner: string; task: string; due: string | null }>;
  risks: string[];
  nextSteps: string[];
  sourceMessageCount: number;
  generatedAt: string;
}

interface Props {
  data?: CurrentSummaryData | null;
  isLoading: boolean;
  isError: boolean;
  onClose: () => void;
  onRegenerate: () => void;
  onCreateTask?: (item: { task: string; owner: string; due: string | null }) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function summaryToText(d: CurrentSummaryData): string {
  const lines: string[] = [];
  if (d.summary.length) { lines.push("Summary:"); d.summary.forEach(b => lines.push(`• ${b}`)); lines.push(""); }
  if (d.decisions.length) { lines.push("Key Decisions:"); d.decisions.forEach(b => lines.push(`• ${b}`)); lines.push(""); }
  if (d.openQuestions.length) { lines.push("Open Questions:"); d.openQuestions.forEach(b => lines.push(`• ${b}`)); lines.push(""); }
  if (d.actionItems.length) { lines.push("Action Items:"); d.actionItems.forEach(a => lines.push(`• ${a.owner} — ${a.task}${a.due ? ` (${a.due})` : ""}`)); lines.push(""); }
  if (d.risks.length) { lines.push("Risks / Blockers:"); d.risks.forEach(b => lines.push(`• ${b}`)); lines.push(""); }
  if (d.nextSteps.length) { lines.push("Suggested Next Steps:"); d.nextSteps.forEach(b => lines.push(`• ${b}`)); }
  return lines.join("\n").trim();
}

// ── Section ───────────────────────────────────────────────────────────────────

function Section({
  icon: Icon,
  label,
  items,
  colorClass = "text-primary/70",
  optional = false,
}: {
  icon: React.ElementType;
  label: string;
  items: string[];
  colorClass?: string;
  optional?: boolean;
}) {
  if (optional && !items.length) return null;
  return (
    <div className="mb-3.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className={cn("w-3 h-3 shrink-0", colorClass)} />
        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/60">
          {label}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-[12px] text-muted-foreground/35 pl-3 italic">None identified</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li
              key={i}
              className="text-[12.5px] text-foreground/80 leading-relaxed pl-3 border-l border-border/40"
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── CurrentSummaryPanel ───────────────────────────────────────────────────────

export function CurrentSummaryPanel({ data, isLoading, isError, onClose, onRegenerate, onCreateTask }: Props) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!data) return;
    navigator.clipboard.writeText(summaryToText(data)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div
      className="rounded-xl border border-primary/20 bg-primary/[0.03] overflow-hidden"
      data-testid="current-summary-panel"
    >
      {/* Header */}
      <div className="px-3.5 py-2.5 flex items-center gap-2 border-b border-primary/15 bg-primary/[0.04]">
        <Sparkles className="w-3.5 h-3.5 text-primary/70 shrink-0" />
        <span className="text-[12px] font-semibold text-foreground/80 flex-1">
          AI Summary
        </span>
        {data && (
          <>
            <span className="text-[10px] text-muted-foreground/40 tabular-nums">
              {data.sourceMessageCount} msg{data.sourceMessageCount !== 1 ? "s" : ""}
            </span>
            <button
              onClick={handleCopy}
              title="Copy summary"
              className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground/40 hover:text-foreground hover:bg-muted/60 transition-colors"
              data-testid="btn-summary-copy"
            >
              {copied ? <Check className="w-3 h-3 text-teal-500" /> : <Copy className="w-3 h-3" />}
            </button>
            <button
              onClick={onRegenerate}
              title="Regenerate"
              className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground/40 hover:text-foreground hover:bg-muted/60 transition-colors"
              data-testid="btn-summary-regenerate"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </>
        )}
        <button
          onClick={onClose}
          title="Close"
          className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground/40 hover:text-foreground hover:bg-muted/60 transition-colors"
          data-testid="btn-summary-close"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Body */}
      <div className="px-3.5 py-3">
        {isLoading && (
          <div className="flex items-center gap-2.5 py-4 justify-center">
            <Loader2 className="w-4 h-4 text-primary/50 animate-spin" />
            <span className="text-[12px] text-muted-foreground/60">Generating summary…</span>
          </div>
        )}

        {isError && !isLoading && (
          <div className="py-4 text-center">
            <p className="text-[12px] text-muted-foreground/60 mb-2">
              Could not generate summary. Try again.
            </p>
            <button
              onClick={onRegenerate}
              className="text-[11.5px] text-primary/70 hover:text-primary underline-offset-2 hover:underline transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {!isLoading && !isError && data && (
          <>
            <Section
              icon={AlignLeft}
              label="Summary"
              items={data.summary}
              colorClass="text-primary/70"
            />
            <Section
              icon={CheckCircle2}
              label="Key Decisions"
              items={data.decisions}
              colorClass="text-teal-500/70"
            />
            {/* Action Items — rendered separately to support "Create Task" per item */}
            <div className="mb-3.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <ListTodo className="w-3 h-3 shrink-0 text-cyan-500/70" />
                <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                  Action Items
                </span>
              </div>
              {data.actionItems.length === 0 ? (
                <p className="text-[12px] text-muted-foreground/35 pl-3 italic">None identified</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.actionItems.map((item, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 pl-3 border-l border-border/40"
                    >
                      <span className="flex-1 text-[12.5px] text-foreground/80 leading-relaxed">
                        {item.owner && item.owner !== "Unassigned"
                          ? `${item.owner} — ${item.task}${item.due ? ` · ${item.due}` : ""}`
                          : `${item.task}${item.due ? ` · ${item.due}` : ""}`}
                      </span>
                      {onCreateTask && (
                        <button
                          onClick={() => onCreateTask(item)}
                          title="Create Task"
                          data-testid={`btn-summary-create-task-${i}`}
                          className="shrink-0 mt-0.5 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] text-muted-foreground/50 hover:text-emerald-500 hover:bg-emerald-500/10 transition-colors border border-transparent hover:border-emerald-500/20"
                        >
                          <CheckSquare className="w-2.5 h-2.5" />
                          <span>Task</span>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Section
              icon={HelpCircle}
              label="Open Questions"
              items={data.openQuestions}
              colorClass="text-amber-500/70"
            />
            <Section
              icon={AlertTriangle}
              label="Risks / Blockers"
              items={data.risks}
              colorClass="text-rose-500/70"
            />
            <Section
              icon={ArrowRight}
              label="Suggested Next Steps"
              items={data.nextSteps}
              colorClass="text-violet-500/70"
              optional
            />
          </>
        )}
      </div>
    </div>
  );
}
