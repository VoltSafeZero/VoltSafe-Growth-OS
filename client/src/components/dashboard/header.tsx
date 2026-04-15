import { useState, useRef, useEffect, useCallback, type ElementType } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Search, Bell, LogOut, X, Plus, CalendarDays, CheckSquare, UserPlus as UserPlusIcon,
  Mail, Flame, AlertTriangle, Building2, Contact, FileText, Ticket, FolderOpen, Layers,
  Users, Target, StickyNote, ArrowRight,
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
  type: "account" | "contact" | "opportunity" | "lead" | "note";
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
};

const TYPE_ORDER = ["account", "contact", "opportunity", "lead", "note"] as const;

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

function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [, navigate] = useLocation();

  const trimmed = query.trim();
  const isShortQuery = trimmed.length === 1;

  const { data, isFetching } = useQuery<{ results: SearchResultItem[] }>({
    queryKey: [`/api/search?q=${encodeURIComponent(trimmed)}`],
    enabled: trimmed.length >= 2,
    staleTime: 10_000,
  });

  const results = data?.results ?? [];

  const grouped = TYPE_ORDER.reduce((acc, type) => {
    const group = results.filter(r => r.type === type);
    if (group.length) acc[type] = group;
    return acc;
  }, {} as Record<string, SearchResultItem[]>);

  const flatItems: SearchResultItem[] = TYPE_ORDER.flatMap(type => grouped[type] ?? []);
  const hasResults = flatItems.length > 0;
  const showDropdown = open && trimmed.length >= 1;

  useEffect(() => { setActiveIndex(-1); }, [query]);

  useEffect(() => {
    if (activeIndex >= 0 && itemRefs.current[activeIndex]) {
      itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

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

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = useCallback((r: SearchResultItem) => {
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
    if (r.type === "account") { navigate(`/accounts/${r.id}`); return; }
    if (r.type === "contact") { navigate(`/contacts/${r.id}`); return; }
    if (r.type === "opportunity") { navigate(`/opportunities/${r.id}`); return; }
    if (r.type === "lead") { navigate(`/leads`); return; }
    if (r.type === "note") {
      if (r.sub === "account" && r.linked_id) { navigate(`/accounts/${r.linked_id}`); return; }
      if (r.sub === "contact" && r.linked_id) { navigate(`/contacts/${r.linked_id}`); return; }
      if (r.sub === "opportunity" && r.linked_id) { navigate(`/opportunities/${r.linked_id}`); return; }
      navigate("/notes");
    }
  }, [navigate]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && flatItems[activeIndex]) {
        handleSelect(flatItems[activeIndex]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      inputRef.current?.blur();
    }
  };

  let flatIdx = 0;

  return (
    <div ref={containerRef} className="relative w-full max-w-md hidden md:block">
      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
      <Input
        ref={inputRef}
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Search accounts, contacts, opportunities… ⌘K"
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
          {/* Keep typing hint — only 1 char typed */}
          {isShortQuery && (
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
              <Search className="w-3.5 h-3.5 shrink-0" />
              Keep typing to search…
            </div>
          )}

          {/* Loading */}
          {!isShortQuery && isFetching && !hasResults && (
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

          {/* No results */}
          {!isShortQuery && !isFetching && !hasResults && (
            <div className="px-5 py-6 text-center space-y-1">
              <Search className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm font-medium text-foreground">No results for "{trimmed}"</p>
              <p className="text-xs text-muted-foreground">Try a different term or check spelling</p>
            </div>
          )}

          {/* Results grouped by type */}
          {!isShortQuery && hasResults && (
            <div className="max-h-[420px] overflow-y-auto" ref={el => { if (el) itemRefs.current = []; }}>
              {TYPE_ORDER.map(type => {
                const group = grouped[type];
                if (!group?.length) return null;
                const { label, Icon, color, href } = SEARCH_TYPE_META[type];
                const sectionStartIdx = flatIdx;
                flatIdx += group.length;

                return (
                  <div key={type}>
                    {/* Section header — clickable to "view all" */}
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
                      const itemIdx = sectionStartIdx + i;
                      const isActive = activeIndex === itemIdx;
                      return (
                        <button
                          key={r.id}
                          ref={el => { itemRefs.current[itemIdx] = el; }}
                          onClick={() => handleSelect(r)}
                          onMouseEnter={() => setActiveIndex(itemIdx)}
                          className={`flex items-center gap-3 w-full px-3 py-2.5 transition-colors text-left border-b border-border/20 last:border-0 ${isActive ? "bg-secondary/60" : "hover:bg-secondary/40"}`}
                          data-testid={`search-result-${r.type}-${r.id}`}
                          role="option"
                          aria-selected={isActive}
                        >
                          <Icon className={`h-4 w-4 shrink-0 ${color}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              <HighlightMatch text={r.label} query={trimmed} />
                            </p>
                            {(r.sub || r.sub2) && (
                              <p className="text-xs text-muted-foreground truncate">
                                {[r.sub2, r.sub].filter(Boolean).join(" · ")}
                              </p>
                            )}
                          </div>
                          {isActive && (
                            <span className="text-[9px] text-muted-foreground shrink-0 border border-border/50 rounded px-1 py-0.5">↵</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}

              {/* Footer hint */}
              <div className="px-3 py-1.5 flex items-center justify-between text-[10px] text-muted-foreground/60 bg-secondary/10 border-t border-border/20">
                <span>↑↓ navigate</span>
                <span>↵ select · Esc close</span>
              </div>
            </div>
          )}
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

            <GlobalSearch />
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
