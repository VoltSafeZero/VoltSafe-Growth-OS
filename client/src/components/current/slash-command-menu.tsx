import { useState, useMemo, useEffect } from "react";
import {
  CheckSquare, Bookmark, AlertTriangle, FileText, Pin, Sparkles, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SlashCommandId =
  | "task"
  | "decision"
  | "risk"
  | "requirement"
  | "pin"
  | "summarize";

export interface SlashCommand {
  id: SlashCommandId;
  label: string;
  description: string;
}

// ── Command sets ──────────────────────────────────────────────────────────────

export const CHANNEL_COMMANDS: SlashCommand[] = [
  { id: "task",        label: "/task",        description: "Create task" },
  { id: "decision",    label: "/decision",    description: "Mark as decision" },
  { id: "risk",        label: "/risk",        description: "Mark as risk" },
  { id: "requirement", label: "/requirement", description: "Mark as requirement" },
  { id: "pin",         label: "/pin",         description: "Send and pin" },
  { id: "summarize",   label: "/summarize",   description: "Summarize channel" },
];

export const DM_COMMANDS: SlashCommand[] = [
  { id: "task", label: "/task", description: "Create task" },
];

export const THREAD_COMMANDS: SlashCommand[] = [
  { id: "task",        label: "/task",        description: "Create task" },
  { id: "decision",    label: "/decision",    description: "Mark as decision" },
  { id: "risk",        label: "/risk",        description: "Mark as risk" },
  { id: "requirement", label: "/requirement", description: "Mark as requirement" },
];

export const RECORD_COMMANDS: SlashCommand[] = [
  { id: "task",        label: "/task",        description: "Create task" },
  { id: "decision",    label: "/decision",    description: "Mark as decision" },
  { id: "risk",        label: "/risk",        description: "Mark as risk" },
  { id: "requirement", label: "/requirement", description: "Mark as requirement" },
];

// ── Icon helper ───────────────────────────────────────────────────────────────

function SlashCommandIcon({ id, className }: { id: SlashCommandId; className?: string }) {
  const cls = cn("w-3.5 h-3.5", className);
  switch (id) {
    case "task":        return <CheckSquare className={cls} />;
    case "decision":    return <Bookmark className={cls} />;
    case "risk":        return <AlertTriangle className={cls} />;
    case "requirement": return <FileText className={cls} />;
    case "pin":         return <Pin className={cls} />;
    case "summarize":   return <Sparkles className={cls} />;
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface SlashCommandHook {
  menuOpen: boolean;
  slashQuery: string;
  filteredCommands: SlashCommand[];
  activeIndex: number;
  setActiveIndex: (i: number) => void;
  selectedCommand: SlashCommand | null;
  selectCommand: (cmd: SlashCommand) => void;
  clearCommand: () => void;
  handleMenuKeyDown: (
    e: React.KeyboardEvent
  ) => SlashCommand | "navigate" | "escape" | false;
}

export function useSlashCommand(
  draft: string,
  commands: SlashCommand[],
  // Pass selectedSlug or selectedDmId so the hook resets when context switches.
  resetKey?: string | number | null
): SlashCommandHook {
  const [selectedCommand, setSelectedCommand] = useState<SlashCommand | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [suppressedQuery, setSuppressedQuery] = useState<string | null>(null);

  // Reset all state when the conversation context switches (channel/DM change).
  useEffect(() => {
    setSelectedCommand(null);
    setSuppressedQuery(null);
    setActiveIndex(0);
  }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Detect /word pattern at the start of the draft (no spaces allowed)
  const slashMatch = /^\/(\w*)$/.exec(draft);
  const rawQuery = slashMatch ? slashMatch[1] : null;
  const slashQuery = rawQuery ?? "";

  const filteredCommands = useMemo(() => {
    if (rawQuery === null) return [];
    const q = rawQuery.toLowerCase();
    return commands.filter((c) => c.id.startsWith(q));
  }, [commands, rawQuery]);

  // Clamp activeIndex so it never points out-of-bounds when commands shrink.
  const clampedActiveIndex = Math.min(activeIndex, Math.max(0, filteredCommands.length - 1));

  const menuOpen =
    rawQuery !== null &&
    suppressedQuery !== rawQuery &&
    !selectedCommand &&
    filteredCommands.length > 0;

  function selectCommand(cmd: SlashCommand) {
    setSelectedCommand(cmd);
    setSuppressedQuery(null);
    setActiveIndex(0);
  }

  function clearCommand() {
    setSelectedCommand(null);
  }

  function handleMenuKeyDown(
    e: React.KeyboardEvent
  ): SlashCommand | "navigate" | "escape" | false {
    if (!menuOpen) return false;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
      return "navigate";
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return "navigate";
    }
    if (e.key === "Enter" && filteredCommands.length > 0) {
      e.preventDefault();
      const cmd = filteredCommands[clampedActiveIndex] ?? filteredCommands[0];
      selectCommand(cmd);
      return cmd;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setSuppressedQuery(slashQuery);
      return "escape";
    }
    return false;
  }

  return {
    menuOpen,
    slashQuery,
    filteredCommands,
    activeIndex: clampedActiveIndex,
    setActiveIndex,
    selectedCommand,
    selectCommand,
    clearCommand,
    handleMenuKeyDown,
  };
}

// ── SlashCommandMenu ──────────────────────────────────────────────────────────

export function SlashCommandMenu({
  commands,
  activeIndex,
  onSelect,
  onHover,
}: {
  commands: SlashCommand[];
  activeIndex: number;
  onSelect: (cmd: SlashCommand) => void;
  onHover: (idx: number) => void;
}) {
  if (commands.length === 0) return null;
  return (
    <div
      className={cn(
        "mb-1.5 rounded-lg border border-border/80 bg-background shadow-md overflow-hidden",
        "animate-in fade-in-0 slide-in-from-bottom-1 duration-100"
      )}
      data-testid="slash-command-menu"
    >
      {commands.map((cmd, idx) => (
        <button
          key={cmd.id}
          type="button"
          data-testid={`slash-cmd-${cmd.id}`}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(cmd);
          }}
          onMouseEnter={() => onHover(idx)}
          className={cn(
            "w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors",
            idx === activeIndex
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          )}
        >
          <span
            className={cn(
              "shrink-0 flex items-center justify-center",
              idx === activeIndex ? "text-primary" : "text-muted-foreground/60"
            )}
          >
            <SlashCommandIcon id={cmd.id} />
          </span>
          <span className="font-mono font-medium text-[12px] shrink-0 min-w-[90px]">
            {cmd.label}
          </span>
          <span className="text-muted-foreground/60 text-[11.5px]">
            {cmd.description}
          </span>
        </button>
      ))}
    </div>
  );
}

// ── SlashCommandPill ──────────────────────────────────────────────────────────

export function SlashCommandPill({
  command,
  onClear,
}: {
  command: SlashCommand;
  onClear: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 mb-1.5 px-2 py-0.5 rounded-md w-fit select-none",
        "bg-primary/10 border border-primary/20 text-primary",
        "text-[11.5px] font-medium"
      )}
      data-testid="slash-command-pill"
    >
      <SlashCommandIcon id={command.id} />
      <span>{command.description}</span>
      <button
        type="button"
        data-testid="slash-command-clear"
        onClick={onClear}
        className="ml-0.5 rounded-sm text-primary/60 hover:text-primary transition-colors"
        title="Clear command"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
