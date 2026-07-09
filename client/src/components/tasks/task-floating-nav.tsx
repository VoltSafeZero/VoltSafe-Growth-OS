import { useState, useEffect, useRef, useMemo } from "react";
import { AlertTriangle, CheckCircle2, LayoutGrid, CalendarDays, ListTodo, Users, ArrowRight, Clock, Sparkles, Trash2, Search, Check, User2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

export type FloatingTabKey =
  | "urgentOverdue" | "recentlyCompleted" | "board" | "calendar"
  | "my" | "team" | "assigned_by_me" | "today" | "suggestions" | "archived";

export const DEFAULT_FLOATING_TABS: FloatingTabKey[] = ["urgentOverdue", "recentlyCompleted", "board", "calendar"];

export const FLOATING_TAB_META: Record<FloatingTabKey, { label: string; shortLabel: string; icon: typeof AlertTriangle }> = {
  urgentOverdue: { label: "Urgent / Overdue", shortLabel: "Urgent", icon: AlertTriangle },
  recentlyCompleted: { label: "Recently Completed", shortLabel: "Completed", icon: CheckCircle2 },
  board: { label: "Board", shortLabel: "Board", icon: LayoutGrid },
  calendar: { label: "Calendar", shortLabel: "Calendar", icon: CalendarDays },
  my: { label: "My Tasks", shortLabel: "My Tasks", icon: ListTodo },
  team: { label: "Team Tasks", shortLabel: "Team", icon: Users },
  assigned_by_me: { label: "Delegated", shortLabel: "Delegated", icon: ArrowRight },
  today: { label: "Due Today", shortLabel: "Today", icon: Clock },
  suggestions: { label: "Suggestions", shortLabel: "Suggestions", icon: Sparkles },
  archived: { label: "Archived", shortLabel: "Archived", icon: Trash2 },
};

type PermittedUser = { id: number; name: string };

type Props = {
  tabs?: FloatingTabKey[];
  activeKey: FloatingTabKey;
  onSelect: (key: FloatingTabKey) => void;
  viewingUserId?: number | null;
  viewingUserName?: string | null;
  permittedUsers?: PermittedUser[];
  onSelectBoard: (userId: number | null, scope: "my" | "team" | "user") => void;
  boardScope: "my" | "team" | "user";
};

export function TaskFloatingNav({
  tabs,
  activeKey,
  onSelect,
  viewingUserId,
  viewingUserName,
  permittedUsers = [],
  onSelectBoard,
  boardScope,
}: Props) {
  const [boardPopupOpen, setBoardPopupOpen] = useState(false);
  const [boardSearch, setBoardSearch] = useState("");
  const popupRef = useRef<HTMLDivElement | null>(null);
  const boardBtnRef = useRef<HTMLButtonElement | null>(null);

  const { data: currentUser } = useQuery<{ taskFloatingMenuTabs?: FloatingTabKey[] }>({
    queryKey: ["/api/auth/me"],
  });

  const navTabs = useMemo<FloatingTabKey[]>(() => {
    const source = tabs ?? currentUser?.taskFloatingMenuTabs;
    if (!Array.isArray(source) || source.length === 0) return DEFAULT_FLOATING_TABS;
    const filtered = source.filter((t): t is FloatingTabKey => t in FLOATING_TAB_META);
    return filtered.length > 0 ? filtered : DEFAULT_FLOATING_TABS;
  }, [tabs, currentUser?.taskFloatingMenuTabs]);

  useEffect(() => {
    if (!boardPopupOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (popupRef.current?.contains(e.target as Node)) return;
      if (boardBtnRef.current?.contains(e.target as Node)) return;
      setBoardPopupOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBoardPopupOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [boardPopupOpen]);

  const filteredUsers = permittedUsers.filter(u =>
    u.name.toLowerCase().includes(boardSearch.trim().toLowerCase())
  );

  const handleClick = (key: FloatingTabKey) => {
    if (key === "board") {
      setBoardPopupOpen(o => !o);
      onSelect("board");
      return;
    }
    setBoardPopupOpen(false);
    onSelect(key);
  };

  const boardLabel = boardScope === "my" ? "My Tasks" : boardScope === "team" ? "Team Tasks" : (viewingUserName ?? "User");

  return (
    <>
      {boardPopupOpen && (
        <div
          ref={popupRef}
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-64 rounded-xl border-2 border-border bg-popover shadow-2xl p-2"
          data-testid="board-selector-popup"
        >
          <p className="px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Switch board</p>
          {permittedUsers.length > 3 && (
            <div className="relative px-1 pb-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
              <input
                value={boardSearch}
                onChange={(e) => setBoardSearch(e.target.value)}
                placeholder="Search people…"
                className="w-full pl-7 pr-2 py-1 text-xs rounded-md border border-border bg-background outline-none focus:ring-1 focus:ring-primary"
                data-testid="board-selector-search"
              />
            </div>
          )}
          <div className="max-h-64 overflow-y-auto flex flex-col gap-0.5">
            <button
              onClick={() => { onSelectBoard(null, "my"); setBoardPopupOpen(false); }}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left hover:bg-muted transition-colors ${boardScope === "my" ? "bg-primary/10 text-primary font-semibold" : "text-foreground"}`}
              data-testid="board-selector-my-tasks"
            >
              <User2 className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">My Tasks</span>
              {boardScope === "my" && <Check className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={() => { onSelectBoard(null, "team"); setBoardPopupOpen(false); }}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left hover:bg-muted transition-colors ${boardScope === "team" ? "bg-primary/10 text-primary font-semibold" : "text-foreground"}`}
              data-testid="board-selector-team-tasks"
            >
              <Users className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">Team Tasks</span>
              {boardScope === "team" && <Check className="h-3.5 w-3.5" />}
            </button>
            {filteredUsers.length > 0 && <div className="my-1 border-t border-border/50" />}
            {filteredUsers.map(u => (
              <button
                key={u.id}
                onClick={() => { onSelectBoard(u.id, "user"); setBoardPopupOpen(false); }}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left hover:bg-muted transition-colors ${boardScope === "user" && viewingUserId === u.id ? "bg-primary/10 text-primary font-semibold" : "text-foreground"}`}
                data-testid={`board-selector-user-${u.id}`}
              >
                <User2 className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1 truncate">{u.name}</span>
                {boardScope === "user" && viewingUserId === u.id && <Check className="h-3.5 w-3.5" />}
              </button>
            ))}
            {permittedUsers.length === 0 && (
              <p className="px-2 py-2 text-[11px] text-muted-foreground">No other boards visible to you.</p>
            )}
          </div>
        </div>
      )}
      <div
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 rounded-full border-2 border-border bg-background/98 backdrop-blur-md shadow-xl px-2 py-2"
        data-testid="floating-task-nav"
      >
        {navTabs.map(key => {
          const meta = FLOATING_TAB_META[key];
          if (!meta) return null;
          const isActive = key === activeKey;
          const Icon = meta.icon;
          return (
            <button
              key={key}
              ref={key === "board" ? boardBtnRef : undefined}
              type="button"
              onClick={() => handleClick(key)}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground font-bold shadow-sm"
                  : "text-foreground/70 font-medium hover:text-foreground hover:bg-secondary/80"
              }`}
              aria-current={isActive ? "page" : undefined}
              data-testid={`floating-nav-${key}`}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{meta.shortLabel}</span>
              {key === "board" && isActive && (
                <span className="hidden md:inline opacity-80 font-normal">· {boardLabel}</span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}
