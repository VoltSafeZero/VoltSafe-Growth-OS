import { useState, useRef, useEffect, type ElementType } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search, Bell, LogOut, X, Plus, CalendarDays, CheckSquare, UserPlus as UserPlusIcon,
  Mail, Flame, AlertTriangle, Building2, Contact, FileText, Ticket, FolderOpen, Layers,
  Users, Target, StickyNote,
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
  id: string; type: string; title: string; body: string; link: string; priority: string;
};
type NotificationsResponse = { notifications: NotificationAlert[]; unreadCount: number };

type SearchResultItem = {
  type: "account" | "contact" | "opportunity" | "note";
  id: string;
  label: string;
  sub: string | null;
  sub2: string | null;
  linked_id: string | null;
};

const NOTIF_ICON: Record<string, ElementType> = {
  meeting: CalendarDays, task: CheckSquare, deal: Flame,
  lead: UserPlusIcon, email: Mail,
};

const SEARCH_TYPE_META: Record<string, { label: string; Icon: ElementType; color: string }> = {
  account:     { label: "Accounts",      Icon: Building2, color: "text-blue-400" },
  contact:     { label: "Contacts",      Icon: Users,     color: "text-violet-400" },
  opportunity: { label: "Opportunities", Icon: Target,    color: "text-emerald-400" },
  note:        { label: "Notes",         Icon: StickyNote, color: "text-amber-400" },
};

function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [, navigate] = useLocation();

  const { data, isFetching } = useQuery<{ results: SearchResultItem[] }>({
    queryKey: ["/api/search", { q: query }],
    enabled: query.trim().length >= 2,
    staleTime: 10_000,
  });

  const results = data?.results ?? [];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
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

  const handleSelect = (r: SearchResultItem) => {
    setOpen(false);
    setQuery("");
    if (r.type === "account") { navigate(`/accounts/${r.id}`); return; }
    if (r.type === "contact") { navigate(`/contacts/${r.id}`); return; }
    if (r.type === "opportunity") { navigate(`/opportunities/${r.id}`); return; }
    if (r.type === "note") {
      if (r.sub === "account" && r.linked_id) { navigate(`/accounts/${r.linked_id}`); return; }
      if (r.sub === "contact" && r.linked_id) { navigate(`/contacts/${r.linked_id}`); return; }
      if (r.sub === "opportunity" && r.linked_id) { navigate(`/opportunities/${r.linked_id}`); return; }
      navigate("/notes");
    }
  };

  const grouped = results.reduce((acc, r) => {
    if (!acc[r.type]) acc[r.type] = [];
    acc[r.type].push(r);
    return acc;
  }, {} as Record<string, SearchResultItem[]>);

  const hasResults = results.length > 0;
  const showDropdown = open && query.trim().length >= 2;

  return (
    <div ref={containerRef} className="relative w-full max-w-md hidden md:block">
      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
      <Input
        ref={inputRef}
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search accounts, contacts, opportunities… ⌘K"
        className="pl-9 pr-4 bg-secondary/30 border-transparent focus-visible:border-primary/50 focus-visible:ring-primary/20 rounded-full h-10 transition-all"
        data-testid="input-global-search"
      />
      {query && (
        <button
          onClick={() => { setQuery(""); setOpen(false); inputRef.current?.focus(); }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          data-testid="button-search-clear"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}

      {showDropdown && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-popover border border-border/60 rounded-xl shadow-2xl z-50 overflow-hidden max-h-[440px] overflow-y-auto">
          {isFetching && !hasResults && (
            <div className="p-4 text-sm text-muted-foreground text-center">Searching…</div>
          )}
          {!isFetching && !hasResults && (
            <div className="p-5 text-sm text-muted-foreground text-center">
              No results for <span className="font-medium text-foreground">"{query}"</span>
            </div>
          )}
          {(["account", "contact", "opportunity", "note"] as const).map(type => {
            const group = grouped[type];
            if (!group?.length) return null;
            const { label, Icon, color } = SEARCH_TYPE_META[type];
            return (
              <div key={type}>
                <div className="px-3 py-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground bg-secondary/20 sticky top-0">
                  <Icon className={`h-3 w-3 ${color}`} />
                  {label}
                </div>
                {group.map(r => (
                  <button
                    key={r.id}
                    onClick={() => handleSelect(r)}
                    className="flex items-center gap-3 w-full px-3 py-2.5 hover:bg-secondary/40 transition-colors text-left border-b border-border/20 last:border-0"
                    data-testid={`search-result-${r.type}-${r.id}`}
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${color}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{r.label}</p>
                      {(r.sub || r.sub2) && (
                        <p className="text-xs text-muted-foreground truncate">
                          {[r.sub2, r.sub].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NotificationPanel({ onNavigate }: { onNavigate: (href: string) => void }) {
  const { data, isLoading } = useQuery<NotificationsResponse>({
    queryKey: ["/api/notifications"],
    refetchInterval: 60_000,
  });
  const alerts = data?.notifications ?? [];

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground text-center">Loading…</div>;
  if (alerts.length === 0) return <div className="p-6 text-sm text-muted-foreground text-center">No new alerts — you're all caught up!</div>;

  return (
    <div className="divide-y divide-border/40">
      {alerts.map(a => {
        const Icon = NOTIF_ICON[a.type] ?? AlertTriangle;
        return (
          <button key={a.id} onClick={() => onNavigate(a.link)}
            className="flex items-start gap-3 w-full px-4 py-3 hover:bg-secondary/30 transition-colors text-left"
            data-testid={`notif-${a.id}`}>
            <div className={`mt-0.5 shrink-0 ${a.priority === "high" ? "text-primary" : "text-muted-foreground"}`}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{a.title}</p>
              <p className="text-sm mt-0.5 leading-tight">{a.body}</p>
            </div>
            {a.priority === "high" && <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />}
          </button>
        );
      })}
    </div>
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
                alt="VoltSafe Cortex"
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
                  {unreadCount > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full ring-2 ring-background" />}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0 max-h-[400px] overflow-y-auto">
                <div className="px-4 py-3 border-b border-border/50">
                  <p className="text-sm font-semibold">Notifications</p>
                </div>
                <NotificationPanel onNavigate={(href) => navigate(href)} />
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
