import { useState, useRef, useEffect, useCallback, type ElementType } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Search, Bell, LogOut, X, Plus, CalendarDays, CheckSquare, UserPlus as UserPlusIcon,
  Mail, Flame, AlertTriangle, Building2, Contact, FileText, Ticket, FolderOpen, Layers,
  Users, Target, StickyNote, ArrowRight, Sun, LayoutDashboard, Zap, Clock, GitBranch,
  ExternalLink, Copy, BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import navLogo from "@assets/nav-logo.png";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useLocation } from "wouter";

type NotificationAlert = {
  id: number;
  type: string;
  title: string;
  body: string;
  severity: string;
  linkedObjectType?: string;
  linkedObjectId?: number;
  actionUrl: string;
  isRead: boolean;
  createdAt: string;
};
type NotificationsResponse = { notifications: NotificationAlert[]; unreadCount: number };

type SearchResultItem = {
  type: "account" | "contact" | "opportunity" | "lead" | "note" | "document";
  id: string;
  label: string;
  sub: string | null;
  sub2: string | null;
  linked_id: string | null;
};

const NOTIF_ICON: Record<string, ElementType> = {
  meeting: CalendarDays,
  overdue_task: CheckSquare,
  reminder: Bell,
  stale_opportunity: Flame,
  account_at_risk: AlertTriangle,
  inbox_followup_needed: Mail,
  lead: UserPlusIcon,
  email: Mail,
};

const SEARCH_TYPE_META: Record<string, { label: string; Icon: ElementType; color: string; href: string }> = {
  account:     { label: "Accounts",      Icon: Building2,    color: "text-blue-400",    href: "/accounts" },
  contact:     { label: "Contacts",      Icon: Users,        color: "text-violet-400",  href: "/contacts" },
  opportunity: { label: "Opportunities", Icon: Target,       color: "text-emerald-400", href: "/opportunities" },
  lead:        { label: "Leads",         Icon: UserPlusIcon, color: "text-cyan-400",    href: "/leads" },
  note:        { label: "Notes",         Icon: StickyNote,   color: "text-amber-400",   href: "/notes" },
  document:    { label: "Documents",     Icon: BookOpen,     color: "text-teal-400",    href: "/documents" },
};

const TYPE_ORDER = ["account", "contact", "opportunity", "lead", "note", "document"] as const;

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query || query.length < 2) return <>{text}</>;
  const re = new RegExp(`(${escapeRegex(query)})`, "gi");
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        re.test(part)
          ? <mark key={i} className="bg-primary/25 text-foreground rounded-sm not-italic font-medium">{part}</mark>
          : <span key={i}>{part}</span>
      )}
    </>
  );
}

// ── Command-bar: action items ─────────────────────────────────────────────────
type CmdAction = {
  id: string;
  label: string;
  icon: ElementType;
  color: string;
  href: string;
  event?: string;
  keywords: string[];
};

type RecentRecord = { type: string; id: string; label: string; sub?: string };

const REC_SEARCH_KEY = "cb_recent_searches";
const REC_RECORD_KEY  = "cb_recent_records";

function loadRecentSearches(): string[] {
  try { return (JSON.parse(localStorage.getItem(REC_SEARCH_KEY) || "[]") as string[]).slice(0, 5); }
  catch { return []; }
}
function saveRecentSearch(q: string) {
  const prev = loadRecentSearches().filter(s => s !== q);
  localStorage.setItem(REC_SEARCH_KEY, JSON.stringify([q, ...prev].slice(0, 5)));
}
function loadRecentRecords(): RecentRecord[] {
  try { return (JSON.parse(localStorage.getItem(REC_RECORD_KEY) || "[]") as RecentRecord[]).slice(0, 8); }
  catch { return []; }
}
function saveRecentRecord(r: RecentRecord) {
  const prev = loadRecentRecords().filter(x => !(x.type === r.type && x.id === r.id));
  localStorage.setItem(REC_RECORD_KEY, JSON.stringify([r, ...prev].slice(0, 8)));
}

const ALL_ACTIONS: CmdAction[] = [
  { id: "go-today",       label: "Today's Overview",  icon: Sun,            color: "text-amber-400",   href: "/today",           keywords: ["today","overview","daily","morning","briefing","go"] },
  { id: "go-home",        label: "Command Center",    icon: LayoutDashboard, color: "text-primary",    href: "/",                keywords: ["home","dashboard","command","center","main","go"] },
  { id: "go-contacts",    label: "Go to Contacts",    icon: Contact,        color: "text-violet-400",  href: "/contacts",        keywords: ["contact","contacts","people","person","go"] },
  { id: "go-accounts",    label: "Go to Accounts",    icon: Building2,      color: "text-blue-400",    href: "/accounts",        keywords: ["account","accounts","org","organization","company","business","go"] },
  { id: "go-leads",       label: "Go to Leads",       icon: UserPlusIcon,   color: "text-cyan-400",    href: "/opportunities",   keywords: ["lead","leads","marina","prospect","go"] },
  { id: "go-tasks",       label: "Tasks Hub",         icon: CheckSquare,    color: "text-emerald-400", href: "/execution/tasks", keywords: ["task","tasks","todo","action","hub","work","go"] },
  { id: "go-pipeline",    label: "Pipeline",          icon: GitBranch,      color: "text-emerald-400", href: "/pipeline",        keywords: ["pipeline","deal","deals","revenue","forecast","go"] },
  { id: "go-inbox",       label: "Inbox",             icon: Mail,           color: "text-blue-400",    href: "/gmail",           keywords: ["email","inbox","mail","gmail","message","go"] },
  { id: "create-account", label: "Create Account",    icon: Building2,      color: "text-blue-400",    href: "/accounts",        event: "open-create-account",  keywords: ["create","new","add","account","organization","company"] },
  { id: "create-lead",    label: "Create Lead",       icon: UserPlusIcon,   color: "text-cyan-400",    href: "/opportunities",   event: "open-create-lead",     keywords: ["create","new","add","lead","prospect","marina"] },
  { id: "create-contact", label: "Create Contact",    icon: Contact,        color: "text-violet-400",  href: "/contacts",        event: "open-create-contact",  keywords: ["create","new","add","contact","person"] },
  { id: "create-task",    label: "Create Task",       icon: CheckSquare,    color: "text-emerald-400", href: "/execution/tasks", event: "open-create-task",     keywords: ["create","new","add","task","todo","remind"] },
];

function getMatchingActions(query: string): CmdAction[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored = ALL_ACTIONS.map(a => {
    let score = 0;
    for (const w of words)
      for (const k of a.keywords)
        if (k === w) score += 3; else if (k.startsWith(w)) score += 2; else if (k.includes(w)) score += 1;
    return { a, score };
  });
  return scored.filter(x => x.score > 0).sort((x, y) => y.score - x.score).slice(0, 3).map(x => x.a);
}

const PINNED_SHORTCUTS = [
  { label: "Today",          href: "/today",           icon: Sun,            color: "text-amber-400" },
  { label: "Command Center", href: "/",                icon: LayoutDashboard, color: "text-primary" },
  { label: "Tasks Hub",      href: "/execution/tasks", icon: CheckSquare,    color: "text-emerald-400" },
  { label: "Inbox",          href: "/gmail",           icon: Mail,           color: "text-blue-400" },
];

// ── GlobalSearch command bar ──────────────────────────────────────────────────
type NavItem = { kind: "action"; data: CmdAction } | { kind: "result"; data: SearchResultItem };

// ── Record action types ───────────────────────────────────────────────────────
type RecordAction = {
  id: string;
  label: string;
  icon: ElementType;
  requiresEdit?: boolean;
  primary?: boolean;
};

type SmartActionHint = {
  actionId: string;
  actionLabel: string;
  entityQuery: string;
  icon: ElementType;
};

const RECORD_ACTIONS: Record<string, RecordAction[]> = {
  account: [
    { id: "open",          label: "Open",   icon: ExternalLink, primary: true },
    { id: "add-note",      label: "Note",   icon: StickyNote,   requiresEdit: true },
    { id: "create-task",   label: "Task",   icon: CheckSquare,  requiresEdit: true },
    { id: "search-emails", label: "Emails", icon: Mail },
    { id: "create-quote",  label: "Quote",  icon: FileText,     requiresEdit: true },
  ],
  lead: [
    { id: "open",          label: "Open",    icon: ExternalLink, primary: true },
    { id: "add-note",      label: "Note",    icon: StickyNote,   requiresEdit: true },
    { id: "create-task",   label: "Task",    icon: CheckSquare,  requiresEdit: true },
    { id: "convert-lead",  label: "Convert", icon: Zap,          requiresEdit: true },
    { id: "assign-owner",  label: "Assign",  icon: Users,        requiresEdit: true },
  ],
  contact: [
    { id: "open",          label: "Open",  icon: ExternalLink, primary: true },
    { id: "create-task",   label: "Task",  icon: CheckSquare,  requiresEdit: true },
    { id: "compose-email", label: "Email", icon: Mail },
    { id: "add-note",      label: "Note",  icon: StickyNote,   requiresEdit: true },
  ],
  opportunity: [
    { id: "open",         label: "Open",  icon: ExternalLink, primary: true },
    { id: "create-task",  label: "Task",  icon: CheckSquare,  requiresEdit: true },
    { id: "add-note",     label: "Note",  icon: StickyNote,   requiresEdit: true },
    { id: "create-quote", label: "Quote", icon: FileText,     requiresEdit: true },
    { id: "update-stage", label: "Stage", icon: GitBranch,    requiresEdit: true },
  ],
  note: [
    { id: "open-context", label: "Open",   icon: ExternalLink, primary: true },
    { id: "copy-note",    label: "Copy",   icon: Copy },
    { id: "open-linked",  label: "Linked", icon: ArrowRight },
  ],
  document: [
    { id: "open",         label: "Open",   icon: ExternalLink, primary: true },
    { id: "open-linked",  label: "Record", icon: ArrowRight },
  ],
};

function getRecordActions(type: string, canEdit: boolean): RecordAction[] {
  const base = RECORD_ACTIONS[type] ?? [];
  return canEdit ? base : base.filter(a => !a.requiresEdit);
}

function parseSmartAction(q: string): SmartActionHint | null {
  const patterns: { re: RegExp; actionId: string; label: string; icon: ElementType }[] = [
    { re: /^(?:task|add task|create task|new task)\s+(?:for|on|about|re)\s+(.+)$/i,                  actionId: "create-task",   label: "Create Task for",  icon: CheckSquare },
    { re: /^(?:note|add note|new note)\s+(?:on|for|about|re)\s+(.+)$/i,                              actionId: "add-note",      label: "Add Note for",     icon: StickyNote },
    { re: /^(?:email|compose|send)(?:\s+(?:email\s+to|email|to))?\s+(.+)$/i,                         actionId: "compose-email", label: "Email",            icon: Mail },
    { re: /^(?:quote|create quote|new quote|draft quote)\s+(?:for|on)\s+(.+)$/i,                      actionId: "create-quote",  label: "Create Quote for", icon: FileText },
  ];
  for (const p of patterns) {
    const m = q.match(p.re);
    if (m) return { actionId: p.actionId, actionLabel: p.label, entityQuery: m[1].trim(), icon: p.icon };
  }
  return null;
}

function GlobalSearch({ canEdit }: { canEdit: boolean }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [recentRecords, setRecentRecords]   = useState<RecentRecord[]>([]);
  const [actionMode, setActionMode] = useState(false);
  const [actionIndex, setActionIndex] = useState(-1);
  const inputRef    = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs    = useRef<(HTMLButtonElement | null)[]>([]);
  const [, navigate] = useLocation();

  const trimmed = query.trim();
  const isShortQuery = trimmed.length === 1;
  const smartAction = trimmed.length >= 4 ? parseSmartAction(trimmed) : null;
  const searchQuery = smartAction ? smartAction.entityQuery : trimmed;

  // Load recents whenever the dropdown opens
  useEffect(() => {
    if (open) {
      setRecentSearches(loadRecentSearches());
      setRecentRecords(loadRecentRecords());
    }
  }, [open]);

  // Reset action mode whenever the active index changes
  useEffect(() => { setActionMode(false); setActionIndex(-1); }, [activeIndex]);

  const { data, isFetching } = useQuery<{ results: SearchResultItem[] }>({
    queryKey: [`/api/search?q=${encodeURIComponent(searchQuery)}`],
    enabled: searchQuery.length >= 2,
    staleTime: 10_000,
  });

  const results  = data?.results ?? [];
  const actions  = trimmed.length >= 2 ? getMatchingActions(trimmed) : [];

  const grouped = TYPE_ORDER.reduce((acc, type) => {
    const group = results.filter(r => r.type === type);
    if (group.length) acc[type] = group;
    return acc;
  }, {} as Record<string, SearchResultItem[]>);

  const flatResults: SearchResultItem[] = TYPE_ORDER.flatMap(type => grouped[type] ?? []);

  // Unified nav list: actions first, then search results
  const navItems: NavItem[] = [
    ...actions.map(a => ({ kind: "action" as const, data: a })),
    ...flatResults.map(r => ({ kind: "result" as const, data: r })),
  ];

  const hasResults  = flatResults.length > 0;
  const hasRecents  = recentSearches.length > 0 || recentRecords.length > 0;
  const showDropdown = open && (trimmed.length >= 1 || hasRecents);

  // Reset active index whenever query changes
  useEffect(() => { setActiveIndex(-1); }, [query]);

  // Auto-highlight first item once results/actions land
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isFetching && trimmed.length >= 2) setActiveIndex(prev => prev === -1 ? 0 : prev);
  }, [data, isFetching]);

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex >= 0 && itemRefs.current[activeIndex])
      itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // ⌘K / Ctrl+K global shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Navigate to a search result + save to recents
  const navigateToResult = useCallback((r: SearchResultItem) => {
    saveRecentRecord({ type: r.type, id: r.id, label: r.label, sub: r.sub2 || r.sub || undefined });
    if (r.type === "account") { navigate(`/accounts/${r.id}`); return; }
    if (r.type === "contact") { navigate(`/contacts/${r.id}`); return; }
    if (r.type === "opportunity") { navigate(`/opportunities/${r.id}`); return; }
    if (r.type === "lead") { navigate(`/opportunities?selected=${r.id}`); return; }
    if (r.type === "note") {
      if (r.sub === "account"     && r.linked_id) { navigate(`/accounts/${r.linked_id}`); return; }
      if (r.sub === "contact"     && r.linked_id) { navigate(`/contacts/${r.linked_id}`); return; }
      if (r.sub === "opportunity" && r.linked_id) { navigate(`/opportunities/${r.linked_id}`); return; }
      navigate("/notes");
    }
    if (r.type === "document") {
      // linked_id is "objectType:objectId" — navigate to the linked record's page
      const [linkedType, linkedId] = (r.linked_id || "").split(":");
      if (linkedType === "account"     && linkedId) { navigate(`/accounts/${linkedId}`); return; }
      if (linkedType === "contact"     && linkedId) { navigate(`/contacts/${linkedId}`); return; }
      if (linkedType === "opportunity" && linkedId) { navigate(`/opportunities/${linkedId}`); return; }
      if (linkedType === "lead"        && linkedId) { navigate(`/opportunities?selected=${linkedId}`); return; }
      navigate("/documents");
    }
  }, [navigate]);

  // Navigate to a command action
  const navigateToAction = useCallback((a: CmdAction) => {
    navigate(a.href);
    if (a.event) setTimeout(() => window.dispatchEvent(new CustomEvent(a.event)), 80);
  }, [navigate]);

  // Execute a record-level action from the action pill bar
  const executeRecordAction = useCallback((action: RecordAction, r: SearchResultItem) => {
    setOpen(false);
    if (trimmed.length >= 2) saveRecentSearch(trimmed);
    setQuery("");
    setActiveIndex(-1);
    setActionMode(false);
    setActionIndex(-1);
    saveRecentRecord({ type: r.type, id: r.id, label: r.label, sub: r.sub2 || r.sub || undefined });

    switch (action.id) {
      case "open":
      case "open-context":
        navigateToResult(r);
        break;
      case "add-note":
        navigateToResult(r);
        setTimeout(() => window.dispatchEvent(new CustomEvent("open-note-panel", { detail: { type: r.type, id: r.id, label: r.label } })), 150);
        break;
      case "create-task":
        (window as any).__cmdbarCtx = { type: r.type, id: r.id, label: r.label };
        navigate("/execution/team-workload");
        setTimeout(() => window.dispatchEvent(new CustomEvent("open-create-task")), 150);
        break;
      case "search-emails":
        navigate(`/gmail?search=${encodeURIComponent(r.label)}`);
        break;
      case "create-quote":
        navigate(`/quotes?linked=${r.type}:${r.id}`);
        break;
      case "convert-lead":
        navigate(`/opportunities?selected=${r.id}&action=convert`);
        break;
      case "assign-owner":
        navigate(`/opportunities?selected=${r.id}&action=assign`);
        break;
      case "compose-email":
        if (r.sub) navigate(`/gmail?compose=${encodeURIComponent(r.sub)}`);
        else navigate("/gmail");
        break;
      case "copy-note":
        navigator.clipboard.writeText(r.label).catch(() => {});
        break;
      case "open-linked":
        if (r.type === "document") {
          // linked_id is "objectType:objectId" for documents
          const [dLinkedType, dLinkedId] = (r.linked_id || "").split(":");
          if (dLinkedType === "account"     && dLinkedId) navigate(`/accounts/${dLinkedId}`);
          else if (dLinkedType === "contact"     && dLinkedId) navigate(`/contacts/${dLinkedId}`);
          else if (dLinkedType === "opportunity" && dLinkedId) navigate(`/opportunities/${dLinkedId}`);
          else if (dLinkedType === "lead"        && dLinkedId) navigate(`/opportunities?selected=${dLinkedId}`);
          else navigate("/documents");
        } else {
          if (r.sub === "account"     && r.linked_id) navigate(`/accounts/${r.linked_id}`);
          else if (r.sub === "contact"     && r.linked_id) navigate(`/contacts/${r.linked_id}`);
          else if (r.sub === "opportunity" && r.linked_id) navigate(`/opportunities/${r.linked_id}`);
          else navigate("/notes");
        }
        break;
      case "update-stage":
        navigate(`/pipeline?opportunity=${r.id}`);
        break;
      default:
        navigateToResult(r);
    }
  }, [trimmed, navigate, navigateToResult]);

  // Unified select handler — respects active smart action if present
  const handleSelect = useCallback((item: NavItem) => {
    setOpen(false);
    if (trimmed.length >= 2) saveRecentSearch(trimmed);
    setQuery("");
    setActiveIndex(-1);
    setActionMode(false);
    setActionIndex(-1);
    if (item.kind === "action") {
      navigateToAction(item.data);
    } else if (smartAction) {
      // Smart action: execute the detected action against the selected record
      const matchingAction = getRecordActions(item.data.type, canEdit).find(a => a.id === smartAction.actionId);
      if (matchingAction) executeRecordAction(matchingAction, item.data);
      else navigateToResult(item.data);
    } else {
      navigateToResult(item.data);
    }
  }, [trimmed, smartAction, canEdit, navigateToAction, navigateToResult, executeRecordAction]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!showDropdown) { setOpen(true); return; }
      // Exit action mode and move to next result
      if (actionMode) { setActionMode(false); setActionIndex(-1); }
      setActiveIndex(i => Math.min(i + 1, navItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (actionMode) { setActionMode(false); setActionIndex(-1); }
      setActiveIndex(i => Math.max(i - 1, -1));
    } else if (e.key === "Tab") {
      if (!showDropdown || activeIndex < 0) return;
      if (e.shiftKey) {
        // Shift+Tab: exit action mode
        if (actionMode) { e.preventDefault(); setActionMode(false); setActionIndex(-1); }
        return;
      }
      e.preventDefault();
      const item = navItems[activeIndex];
      if (!item || item.kind !== "result") return;
      const actions = getRecordActions(item.data.type, canEdit);
      if (!actionMode) {
        if (actions.length > 0) { setActionMode(true); setActionIndex(0); }
      } else {
        const next = actionIndex + 1;
        if (next < actions.length) setActionIndex(next);
        else { setActionMode(false); setActionIndex(-1); setActiveIndex(i => Math.min(i + 1, navItems.length - 1)); }
      }
    } else if (e.key === "ArrowRight") {
      if (!showDropdown || activeIndex < 0) return;
      const item = navItems[activeIndex];
      if (!item || item.kind !== "result") return;
      e.preventDefault();
      const actions = getRecordActions(item.data.type, canEdit);
      if (!actionMode) {
        if (actions.length > 0) { setActionMode(true); setActionIndex(0); }
      } else {
        setActionIndex(i => Math.min(i + 1, actions.length - 1));
      }
    } else if (e.key === "ArrowLeft") {
      if (!showDropdown || !actionMode) return;
      e.preventDefault();
      if (actionIndex > 0) setActionIndex(i => i - 1);
      else { setActionMode(false); setActionIndex(-1); }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (actionMode && activeIndex >= 0) {
        const item = navItems[activeIndex];
        if (item?.kind === "result") {
          const actions = getRecordActions(item.data.type, canEdit);
          const action = actions[actionIndex];
          if (action) { executeRecordAction(action, item.data); return; }
        }
      }
      if (activeIndex >= 0 && navItems[activeIndex]) handleSelect(navItems[activeIndex]);
    } else if (e.key === "Escape") {
      if (actionMode) { setActionMode(false); setActionIndex(-1); }
      else { setOpen(false); setActiveIndex(-1); inputRef.current?.blur(); }
    }
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-md hidden md:block">
      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
      <Input
        ref={inputRef}
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Search or ⌘K to command…"
        className="pl-9 pr-4 bg-secondary/30 border-transparent focus-visible:border-primary/50 focus-visible:ring-primary/20 rounded-full h-10 transition-all"
        data-testid="input-global-search"
        autoComplete="off"
        role="combobox"
        aria-expanded={showDropdown}
        aria-haspopup="listbox"
        aria-autocomplete="list"
      />
      {query && (
        <button
          onClick={() => { setQuery(""); setOpen(false); setActiveIndex(-1); inputRef.current?.focus(); }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          data-testid="button-search-clear"
          tabIndex={-1}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}

      {showDropdown && (
        <div
          className="absolute top-full left-0 right-0 mt-1.5 bg-popover border border-border/60 rounded-xl shadow-2xl z-50 overflow-hidden"
          role="listbox"
          aria-label="Search results"
        >
          {/* ── EMPTY STATE: pinned shortcuts + recents ── */}
          {trimmed.length === 0 && (
            <div className="max-h-[400px] overflow-y-auto">
              {/* Pinned shortcuts */}
              <div className="px-3 pt-2.5 pb-2 flex flex-wrap gap-1.5 border-b border-border/20">
                {PINNED_SHORTCUTS.map(p => {
                  const Icon = p.icon;
                  return (
                    <button
                      key={p.href}
                      onClick={() => { setOpen(false); navigate(p.href); }}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-secondary/40 hover:bg-secondary/70 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      data-testid={`search-pinned-${p.label.replace(/\s+/g, "-").toLowerCase()}`}
                    >
                      <Icon className={`h-3 w-3 ${p.color}`} />
                      {p.label}
                    </button>
                  );
                })}
              </div>

              {recentSearches.length > 0 && (
                <div>
                  <div className="px-3 py-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground bg-secondary/10">
                    <Clock className="h-3 w-3" /> Recent searches
                  </div>
                  {recentSearches.map(s => (
                    <button
                      key={s}
                      onClick={() => { setQuery(s); inputRef.current?.focus(); }}
                      className="flex items-center gap-3 w-full px-3 py-2 hover:bg-secondary/40 transition-colors text-left border-b border-border/10 last:border-0"
                      data-testid={`search-recent-query`}
                    >
                      <Search className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                      <span className="text-sm text-muted-foreground flex-1">{s}</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground/30 shrink-0" />
                    </button>
                  ))}
                </div>
              )}

              {recentRecords.length > 0 && (
                <div>
                  <div className="px-3 py-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground bg-secondary/10">
                    <Clock className="h-3 w-3" /> Recently opened
                  </div>
                  {recentRecords.map(r => {
                    const meta = SEARCH_TYPE_META[r.type];
                    const Icon = meta?.Icon;
                    return (
                      <button
                        key={`${r.type}-${r.id}`}
                        onClick={() => {
                          setOpen(false);
                          const fake: SearchResultItem = { type: r.type as SearchResultItem["type"], id: r.id, label: r.label, sub: r.sub || null, sub2: null, linked_id: null };
                          navigateToResult(fake);
                        }}
                        className="flex items-center gap-3 w-full px-3 py-2 hover:bg-secondary/40 transition-colors text-left border-b border-border/10 last:border-0"
                        data-testid={`search-recent-record`}
                      >
                        {Icon && <Icon className={`h-3.5 w-3.5 shrink-0 ${meta.color}`} />}
                        <div className="flex-1 min-w-0">
                          <span className="text-sm">{r.label}</span>
                          {r.sub && <span className="text-xs text-muted-foreground ml-2">{r.sub}</span>}
                        </div>
                        <span className="text-[9px] text-muted-foreground/50 shrink-0 border border-border/30 rounded px-1 py-0.5 capitalize">{r.type}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {!hasRecents && (
                <div className="px-4 py-5 text-center text-sm text-muted-foreground/60">
                  <Search className="w-6 h-6 mx-auto mb-2 opacity-30" />
                  Type to search or use ⌘K
                </div>
              )}

              <div className="px-3 py-1.5 text-[10px] text-muted-foreground/40 bg-secondary/10 border-t border-border/20 text-center">
                ↑↓ navigate · ↵ select · Esc close
              </div>
            </div>
          )}

          {/* ── SHORT QUERY HINT ── */}
          {isShortQuery && (
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
              <Search className="w-3.5 h-3.5 shrink-0" />
              Keep typing to search…
            </div>
          )}

          {/* ── LOADING ── */}
          {!isShortQuery && trimmed.length >= 2 && isFetching && !hasResults && actions.length === 0 && (
            <div className="space-y-0 max-h-[400px] overflow-y-auto">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2.5 border-b border-border/20 last:border-0">
                  <div className="w-4 h-4 rounded bg-muted/50 animate-pulse shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-muted/50 rounded animate-pulse w-3/4" />
                    <div className="h-2.5 bg-muted/30 rounded animate-pulse w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── NO RESULTS ── */}
          {!isShortQuery && trimmed.length >= 2 && !isFetching && !hasResults && actions.length === 0 && (
            <div className="px-5 py-6 text-center space-y-1">
              <Search className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm font-medium text-foreground">No results for "{trimmed}"</p>
              <p className="text-xs text-muted-foreground">Try a different term or check spelling</p>
            </div>
          )}

          {/* ── ACTIONS + RESULTS ── */}
          {!isShortQuery && trimmed.length >= 2 && (actions.length > 0 || hasResults) && (() => {
            let navIdx = 0;
            return (
              <div className="max-h-[420px] overflow-y-auto" ref={el => { if (el) itemRefs.current = []; }}>

                {/* Smart action banner */}
                {smartAction && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border-b border-primary/20">
                    <smartAction.icon className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="text-xs font-medium text-primary">{smartAction.actionLabel}</span>
                    <span className="text-xs text-muted-foreground">— select a result then ↵</span>
                  </div>
                )}

                {/* Actions section */}
                {actions.length > 0 && (
                  <div>
                    <div className="px-3 py-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground bg-secondary/20 sticky top-0 z-10">
                      <Zap className="h-3 w-3 text-amber-400" />
                      Actions
                    </div>
                    {actions.map(action => {
                      const itemNavIdx = navIdx++;
                      const isActive = activeIndex === itemNavIdx;
                      const Icon = action.icon;
                      return (
                        <button
                          key={action.id}
                          ref={el => { itemRefs.current[itemNavIdx] = el; }}
                          onClick={() => handleSelect({ kind: "action", data: action })}
                          onMouseEnter={() => { setActiveIndex(itemNavIdx); }}
                          className={`flex items-center gap-3 w-full px-3 py-2.5 transition-colors text-left border-b border-border/20 last:border-0 ${isActive ? "bg-secondary/60" : "hover:bg-secondary/40"}`}
                          data-testid={`search-action-${action.id}`}
                          role="option"
                          aria-selected={isActive}
                        >
                          <Icon className={`h-4 w-4 shrink-0 ${action.color}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{action.label}</p>
                          </div>
                          <div className="shrink-0 flex items-center gap-1">
                            {action.event && (
                              <span className="text-[9px] text-muted-foreground/60 border border-border/30 rounded px-1 py-0.5">create</span>
                            )}
                            {isActive && (
                              <span className="text-[9px] text-muted-foreground border border-border/50 rounded px-1 py-0.5">↵</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Search results grouped by type */}
                {TYPE_ORDER.map(type => {
                  const group = grouped[type];
                  if (!group?.length) return null;
                  const { label, Icon, color, href } = SEARCH_TYPE_META[type];
                  const sectionStart = navIdx;
                  navIdx += group.length;

                  return (
                    <div key={type}>
                      <div className="px-3 py-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-widest text-muted-foreground bg-secondary/20 sticky top-0 z-10">
                        <div className="flex items-center gap-1.5">
                          <Icon className={`h-3 w-3 ${color}`} />
                          {label}
                          <span className="font-normal normal-case tracking-normal text-muted-foreground/60">
                            ({group.length}{group.length === 5 ? "+" : ""})
                          </span>
                        </div>
                        <button
                          onClick={() => { setOpen(false); setQuery(""); navigate(href); }}
                          className="flex items-center gap-0.5 text-muted-foreground hover:text-primary transition-colors normal-case tracking-normal font-normal"
                          tabIndex={-1}
                          data-testid={`search-viewall-${type}`}
                        >
                          View all <ArrowRight className="h-2.5 w-2.5" />
                        </button>
                      </div>

                      {group.map((r, i) => {
                        const itemNavIdx = sectionStart + i;
                        const isActive = activeIndex === itemNavIdx;
                        const recordActions = getRecordActions(r.type, canEdit);
                        const highlightQuery = smartAction ? smartAction.entityQuery : trimmed;
                        return (
                          <div
                            key={r.id}
                            className={`border-b border-border/20 last:border-0 transition-colors ${isActive ? "bg-secondary/60" : "hover:bg-secondary/30"}`}
                            data-testid={`search-result-${r.type}-${r.id}`}
                          >
                            <button
                              ref={el => { itemRefs.current[itemNavIdx] = el; }}
                              onClick={() => handleSelect({ kind: "result", data: r })}
                              onMouseEnter={() => setActiveIndex(itemNavIdx)}
                              className="flex items-center gap-3 w-full px-3 py-2.5 text-left"
                              role="option"
                              aria-selected={isActive}
                            >
                              <Icon className={`h-4 w-4 shrink-0 ${color}`} />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">
                                  <HighlightMatch text={r.label} query={highlightQuery} />
                                </p>
                                {(r.sub || r.sub2) && (
                                  <p className="text-xs text-muted-foreground truncate">
                                    {[r.sub2, r.sub].filter(Boolean).join(" · ")}
                                  </p>
                                )}
                              </div>
                              <div className="shrink-0 flex items-center gap-1">
                                {r.type === "lead" && (
                                  <span className="text-[9px] font-semibold uppercase tracking-wide text-cyan-400 border border-cyan-400/30 bg-cyan-400/5 rounded px-1 py-0.5">Lead</span>
                                )}
                                {isActive && !actionMode && (
                                  <span className="text-[9px] text-muted-foreground border border-border/50 rounded px-1 py-0.5">↵</span>
                                )}
                                {isActive && !actionMode && recordActions.length > 0 && (
                                  <span className="text-[9px] text-muted-foreground/70 border border-border/40 rounded px-1 py-0.5">Tab →</span>
                                )}
                              </div>
                            </button>

                            {/* Action pills — shown when this result is active */}
                            {isActive && recordActions.length > 0 && (
                              <div className="flex items-center gap-1 px-3 pb-2 flex-wrap" data-testid={`action-bar-${r.id}`}>
                                {recordActions.map((action, ai) => {
                                  const isActionActive = actionMode && actionIndex === ai;
                                  const ActionIcon = action.icon;
                                  return (
                                    <button
                                      key={action.id}
                                      onClick={e => { e.stopPropagation(); executeRecordAction(action, r); }}
                                      onMouseEnter={() => { setActionMode(true); setActionIndex(ai); }}
                                      onMouseLeave={() => { setActionMode(false); setActionIndex(-1); }}
                                      className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] border transition-all ${
                                        isActionActive
                                          ? "bg-primary text-primary-foreground border-primary shadow-sm"
                                          : action.primary
                                            ? "bg-secondary text-foreground border-border/60 hover:border-primary/40 hover:bg-secondary/80"
                                            : "bg-secondary/40 text-muted-foreground border-border/30 hover:bg-secondary/70 hover:text-foreground"
                                      }`}
                                      data-testid={`action-pill-${r.id}-${action.id}`}
                                      tabIndex={-1}
                                    >
                                      <ActionIcon className="h-3 w-3 shrink-0" />
                                      {action.label}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                {/* Footer */}
                <div className="px-3 py-1.5 flex items-center justify-between text-[10px] text-muted-foreground/60 bg-secondary/10 border-t border-border/20">
                  <span>↑↓ navigate · Tab/→ actions</span>
                  <span>↵ select · Esc {actionMode ? "back" : "close"}</span>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function NotificationPanel({ onNavigate }: { onNavigate: (href: string) => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<NotificationsResponse>({
    queryKey: ["/api/notifications"],
    refetchInterval: 60_000,
  });
  const alerts = data?.notifications ?? [];
  const unreadCount = alerts.filter(a => !a.isRead).length;

  const markReadMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PATCH", `/api/notifications/${id}/read`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/notifications"] }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/notifications/read-all`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/notifications"] }),
  });

  const handleClick = (a: NotificationAlert) => {
    if (!a.isRead) markReadMutation.mutate(a.id);
    onNavigate(a.actionUrl);
  };

  const severityColor = (s: string) =>
    s === "high" ? "text-primary" : s === "medium" ? "text-amber-400" : "text-muted-foreground";
  const severityDot = (s: string) =>
    s === "high" ? "bg-primary" : s === "medium" ? "bg-amber-400" : "bg-muted-foreground/40";

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground text-center">Loading…</div>;

  return (
    <>
      {unreadCount > 0 && (
        <div className="px-4 py-2 flex items-center justify-between border-b border-border/30 bg-secondary/10">
          <span className="text-xs text-muted-foreground">{unreadCount} unread</span>
          <button
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending}
            className="text-xs text-primary hover:underline disabled:opacity-50"
            data-testid="button-mark-all-read"
          >
            {markAllReadMutation.isPending ? "Marking…" : "Mark all read"}
          </button>
        </div>
      )}
      {alerts.length === 0 ? (
        <div className="p-6 text-sm text-muted-foreground text-center">
          <CheckSquare className="h-8 w-8 mx-auto mb-2 opacity-20" />
          You're all caught up!
        </div>
      ) : (
        <div className="divide-y divide-border/30">
          {alerts.map(a => {
            const Icon = NOTIF_ICON[a.type] ?? AlertTriangle;
            return (
              <button
                key={a.id}
                onClick={() => handleClick(a)}
                className={`flex items-start gap-3 w-full px-4 py-3 text-left transition-colors ${a.isRead ? "opacity-50 hover:opacity-70 hover:bg-secondary/20" : "hover:bg-secondary/30"}`}
                data-testid={`notif-${a.id}`}
              >
                <div className={`mt-0.5 shrink-0 ${severityColor(a.severity)}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide leading-none mb-0.5">{a.title}</p>
                  <p className="text-sm leading-snug">{a.body}</p>
                  <p className="text-[10px] text-muted-foreground/50 mt-0.5">{new Date(a.createdAt).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                </div>
                {!a.isRead && <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${severityDot(a.severity)}`} />}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

type AuthUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  mustChangePassword: boolean;
};

const quickCreateItems = [
  { label: "New Account", icon: Building2, url: "/accounts", event: "open-create-account" },
  { label: "New Contact", icon: Contact, url: "/contacts", event: "open-create-contact" },
  { label: "New Opportunity", icon: UserPlusIcon, url: "/opportunities", event: "open-create-opportunity" },
  { label: "New Quote", icon: FileText, url: "/quotes", event: "open-create-quote" },
  { label: "New Task", icon: CheckSquare, url: "/execution/team-workload", event: "open-create-task" },
  { label: "New Ticket", icon: Ticket, url: "/support/tickets", event: "open-create-ticket" },
  { label: "New Asset", icon: FolderOpen, url: "/knowledge/assets", event: "open-create-asset" },
];

export function Header({ user, onLogout }: { user?: AuthUser; onLogout?: () => void }) {
  const initials = user?.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "VS";
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const mobileSearchRef = useRef<HTMLInputElement>(null);
  const [, navigate] = useLocation();
  const { data: notifData } = useQuery<NotificationsResponse>({
    queryKey: ["/api/notifications"],
    refetchInterval: 60_000,
  });
  const unreadCount = notifData?.unreadCount ?? 0;

  useEffect(() => {
    if (mobileSearchOpen && mobileSearchRef.current) {
      mobileSearchRef.current.focus();
    }
  }, [mobileSearchOpen]);

  const handleQuickCreate = (item: typeof quickCreateItems[0]) => {
    navigate(item.url);
    setTimeout(() => window.dispatchEvent(new Event(item.event)), 100);
  };

  return (
    <header className="h-auto py-2 flex items-center justify-between px-3 sm:px-6 border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10">
      {mobileSearchOpen ? (
        <div className="flex items-center gap-2 flex-1 md:hidden">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={mobileSearchRef}
              placeholder="Search..."
              className="pl-9 bg-secondary/30 border-transparent focus-visible:border-primary/50 focus-visible:ring-primary/20 rounded-full"
              data-testid="input-mobile-search"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 rounded-full"
            onClick={() => setMobileSearchOpen(false)}
            data-testid="button-close-mobile-search"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 sm:gap-4 flex-1">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden rounded-full text-muted-foreground"
              onClick={() => setMobileSearchOpen(true)}
              data-testid="button-open-mobile-search"
            >
              <Search className="w-5 h-5" />
            </Button>

            <GlobalSearch canEdit={user?.role !== "view_only"} />
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="hidden sm:flex items-center gap-1.5 h-9 px-3 border-border/60 bg-secondary/30 hover:bg-secondary/60 text-foreground rounded-lg"
                  data-testid="button-quick-create"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span className="text-sm font-medium">Create</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                  Quick Create
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {quickCreateItems.map((item) => (
                  <DropdownMenuItem
                    key={item.label}
                    onClick={() => handleQuickCreate(item)}
                    className="gap-2.5 cursor-pointer"
                    data-testid={`quick-create-${item.label.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                  >
                    <item.icon className="w-4 h-4 text-muted-foreground" />
                    {item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <button
              onClick={() => window.dispatchEvent(new Event("open-cortex-ai"))}
              className="relative flex items-center justify-center cursor-pointer transition-opacity hover:opacity-80 active:scale-[0.98]"
              data-testid="button-header-cortex-ai"
            >
              <img
                src={navLogo}
                alt="VoltSafe Growth OS"
                className="w-[6.75rem] h-[6.75rem] object-contain mix-blend-screen brightness-125"
              />
            </button>

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative text-muted-foreground rounded-full"
                  data-testid="button-notifications"
                >
                  <Bell className="w-5 h-5" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-primary text-primary-foreground text-[10px] font-bold rounded-full ring-2 ring-background" data-testid="badge-notification-count">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[340px] p-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
                  <p className="text-sm font-semibold">Notifications</p>
                  {unreadCount > 0 && <span className="text-xs text-muted-foreground">{unreadCount} unread</span>}
                </div>
                <div className="max-h-[420px] overflow-y-auto">
                  <NotificationPanel onNavigate={(href) => navigate(href)} />
                </div>
              </PopoverContent>
            </Popover>

            <div className="h-6 w-px bg-border/50 mx-0.5 hidden sm:block"></div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-2 p-1 rounded-full sm:pr-3 transition-colors hover:bg-secondary/50"
                  data-testid="button-user-menu"
                >
                  <Avatar className="w-8 h-8 border border-primary/30 bg-primary/10">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium hidden sm:inline">{user?.name || "User"}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <span className="font-medium">{user?.name}</span>
                    <span className="text-xs text-muted-foreground font-normal">{user?.email}</span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onLogout}
                  className="text-red-400 focus:text-red-400 cursor-pointer"
                  data-testid="button-logout"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </>
      )}
    </header>
  );
}
