import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, User, Building2, Mail, ArrowRight } from "lucide-react";

interface SearchResult {
  type: "contact" | "account" | "email";
  id: number | string;
  title: string;
  subtitle?: string;
  meta?: string;
  href: string;
}

interface SearchResponse {
  contacts: Array<{ id: number; name: string; email?: string; accountName?: string }>;
  accounts: Array<{ id: number; name: string; orgType?: string; city?: string }>;
  emails: Array<{ gmailMessageId: string; subject: string; fromEmail: string; date: string }>;
}

function useGlobalSearch(query: string) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!query.trim() || query.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/global?q=${encodeURIComponent(query)}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("search failed");
        const data: SearchResponse = await res.json();
        const flat: SearchResult[] = [
          ...data.contacts.map(c => ({
            type: "contact" as const,
            id: c.id,
            title: c.name,
            subtitle: c.email ?? "",
            meta: c.accountName ?? "",
            href: `/contacts?selected=${c.id}`,
          })),
          ...data.accounts.map(a => ({
            type: "account" as const,
            id: a.id,
            title: a.name,
            subtitle: a.orgType ?? "",
            meta: a.city ?? "",
            href: `/accounts?selected=${a.id}`,
          })),
          ...data.emails.map(e => ({
            type: "email" as const,
            id: e.gmailMessageId,
            title: e.subject || "(no subject)",
            subtitle: e.fromEmail,
            meta: e.date ? new Date(e.date).toLocaleDateString() : "",
            href: `/gmail?thread=${e.gmailMessageId}`,
          })),
        ];
        setResults(flat);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query]);

  return { results, loading };
}

function typeIcon(type: SearchResult["type"]) {
  switch (type) {
    case "contact": return <User className="w-3.5 h-3.5 shrink-0" />;
    case "account": return <Building2 className="w-3.5 h-3.5 shrink-0" />;
    case "email":   return <Mail className="w-3.5 h-3.5 shrink-0" />;
  }
}

function typeBadgeColor(type: SearchResult["type"]) {
  switch (type) {
    case "contact": return "bg-violet-500/15 text-violet-400 border-violet-500/20";
    case "account": return "bg-sky-500/15 text-sky-400 border-sky-500/20";
    case "email":   return "bg-emerald-500/15 text-emerald-400 border-emerald-500/20";
  }
}

interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function GlobalSearch({ open, onOpenChange }: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [, navigate] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const { results, loading } = useGlobalSearch(query);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => { setSelected(0); }, [results]);

  const goTo = useCallback((href: string) => {
    onOpenChange(false);
    navigate(href);
  }, [navigate, onOpenChange]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected(s => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected(s => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && results[selected]) {
      goTo(results[selected].href);
    }
  };

  const groupedByType = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    acc[r.type] = acc[r.type] ?? [];
    acc[r.type].push(r);
    return acc;
  }, {});
  const typeOrder: SearchResult["type"][] = ["contact", "account", "email"];
  const typeLabels: Record<string, string> = { contact: "Contacts", account: "Accounts", email: "Emails" };

  let resultIndex = 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="p-0 gap-0 max-w-xl overflow-hidden"
        data-testid="global-search-modal"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Global Search</DialogTitle>
        </DialogHeader>

        {/* Search input */}
        <div className="flex items-center gap-2 px-3 py-3 border-b border-border/50">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <Input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search contacts, accounts, emails…"
            className="border-0 shadow-none focus-visible:ring-0 p-0 h-7 bg-transparent text-sm"
            data-testid="input-global-search"
          />
          {loading && (
            <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin shrink-0" />
          )}
          <kbd className="shrink-0 text-[10px] text-muted-foreground bg-muted border border-border rounded px-1.5 py-0.5">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[400px] overflow-y-auto py-1">
          {!query.trim() || query.length < 2 ? (
            <div className="py-8 text-center text-sm text-muted-foreground/60">
              Type at least 2 characters to search
            </div>
          ) : loading && results.length === 0 ? (
            <div className="px-3 py-2 space-y-1.5">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : results.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground/60">
              No results for <span className="font-medium text-foreground">"{query}"</span>
            </div>
          ) : (
            typeOrder.map(type => {
              const group = groupedByType[type];
              if (!group?.length) return null;
              return (
                <div key={type}>
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                    {typeLabels[type]}
                  </div>
                  {group.map(item => {
                    const idx = resultIndex++;
                    const isActive = idx === selected;
                    return (
                      <button
                        key={`${item.type}-${item.id}`}
                        onClick={() => goTo(item.href)}
                        onMouseEnter={() => setSelected(idx)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                          isActive ? "bg-primary/10 text-foreground" : "hover:bg-secondary/50 text-foreground/90"
                        }`}
                        data-testid={`search-result-${item.type}-${item.id}`}
                      >
                        <span className={`p-1 rounded-md border ${typeBadgeColor(item.type)}`}>
                          {typeIcon(item.type)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.title}</p>
                          {(item.subtitle || item.meta) && (
                            <p className="text-xs text-muted-foreground truncate">
                              {[item.subtitle, item.meta].filter(Boolean).join(" · ")}
                            </p>
                          )}
                        </div>
                        {isActive && <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        {results.length > 0 && (
          <div className="border-t border-border/50 px-3 py-2 flex items-center gap-3 text-[10px] text-muted-foreground/50">
            <span><kbd className="bg-muted border border-border rounded px-1">↑↓</kbd> navigate</span>
            <span><kbd className="bg-muted border border-border rounded px-1">↵</kbd> open</span>
            <span><kbd className="bg-muted border border-border rounded px-1">ESC</kbd> close</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
