import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { StickyNote, Plus, Pencil, Trash2, Check, X, Search, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export type Snippet = { id: string; name: string; body: string };

const STORAGE_KEY = "inbox.snippets.v1";

const DEFAULT_SNIPPETS: Snippet[] = [
  {
    id: "default-thanks",
    name: "Thanks",
    body: "Thanks for reaching out — I'll get back to you shortly with the details.\n\nBest,\nTrevor",
  },
  {
    id: "default-quote-followup",
    name: "Quote follow-up",
    body: "Hi {{firstName}},\n\nFollowing up on the quote we sent over. Happy to walk through it on a quick call or answer any questions by email.\n\nBest,\nTrevor",
  },
  {
    id: "default-schedule-call",
    name: "Schedule a call",
    body: "Hi {{firstName}},\n\nWould love to find 15 minutes this week to talk through next steps. You can grab any open slot here: <link>\n\nThanks,\nTrevor",
  },
];

function loadSnippets(): Snippet[] {
  if (typeof window === "undefined") return DEFAULT_SNIPPETS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SNIPPETS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_SNIPPETS;
    return parsed.filter((s) => s && typeof s.id === "string" && typeof s.name === "string" && typeof s.body === "string");
  } catch {
    return DEFAULT_SNIPPETS;
  }
}

export function useSnippets() {
  const [snippets, setSnippets] = useState<Snippet[]>(() => loadSnippets());

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets)); } catch {}
  }, [snippets]);

  // Cross-tab + cross-instance sync — listen for storage + custom events
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setSnippets(loadSnippets());
    };
    const customHandler = () => setSnippets(loadSnippets());
    window.addEventListener("storage", handler);
    window.addEventListener("inbox.snippets.changed", customHandler as EventListener);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("inbox.snippets.changed", customHandler as EventListener);
    };
  }, []);

  const broadcast = () => {
    try { window.dispatchEvent(new Event("inbox.snippets.changed")); } catch {}
  };

  const upsert = useCallback((snippet: Snippet) => {
    setSnippets((prev) => {
      const idx = prev.findIndex((s) => s.id === snippet.id);
      const next = idx >= 0
        ? prev.map((s, i) => (i === idx ? snippet : s))
        : [...prev, snippet];
      return next;
    });
    setTimeout(broadcast, 0);
  }, []);

  const remove = useCallback((id: string) => {
    setSnippets((prev) => prev.filter((s) => s.id !== id));
    setTimeout(broadcast, 0);
  }, []);

  return { snippets, upsert, remove };
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Insert button — opens picker dialog, calls onInsert with snippet body      */
/* ─────────────────────────────────────────────────────────────────────────── */

export function SnippetInsertButton({
  onInsert,
  disabled,
  variant = "icon",
}: {
  onInsert: (body: string) => void;
  disabled?: boolean;
  variant?: "icon" | "labeled";
}) {
  const [open, setOpen] = useState(false);
  const { snippets } = useSnippets();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return snippets;
    return snippets.filter((s) => s.name.toLowerCase().includes(q) || s.body.toLowerCase().includes(q));
  }, [snippets, query]);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size={variant === "icon" ? "icon" : "sm"}
        className={variant === "icon" ? "h-8 w-8 text-muted-foreground hover:text-primary" : "gap-1.5"}
        onClick={() => setOpen(true)}
        disabled={disabled}
        title="Insert snippet"
        data-testid="button-snippet-insert"
      >
        <StickyNote className="h-4 w-4" />
        {variant === "labeled" && <span className="text-xs">Snippets</span>}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg p-0 overflow-hidden">
          <div className="px-4 pt-4 pb-2 border-b border-border/40 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary/70 flex-shrink-0" />
            <h2 className="text-sm font-semibold text-foreground">Insert snippet</h2>
            <button
              onClick={() => setOpen(false)}
              className="ml-auto p-1 text-muted-foreground/60 hover:text-foreground rounded"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="px-4 py-2 border-b border-border/40 flex items-center gap-2 bg-muted/15">
            <Search className="h-3.5 w-3.5 text-muted-foreground/60" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search snippets…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
              data-testid="input-snippet-search"
            />
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-2">
            {filtered.length === 0 ? (
              <div className="px-3 py-10 text-center text-xs text-muted-foreground/60">
                No snippets match "{query}".
              </div>
            ) : (
              <ul className="space-y-1">
                {filtered.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => {
                        onInsert(s.body);
                        setOpen(false);
                        setQuery("");
                      }}
                      data-testid={`button-snippet-${s.id}`}
                      className="w-full text-left rounded-lg px-3 py-2.5 hover:bg-primary/8 hover:ring-1 hover:ring-primary/30 transition-all group"
                    >
                      <div className="flex items-baseline justify-between gap-3 mb-0.5">
                        <span className="text-[13px] font-semibold text-foreground truncate">{s.name}</span>
                        <span className="text-[10px] text-muted-foreground/50 group-hover:text-primary/70 uppercase tracking-wider font-medium flex-shrink-0">
                          Insert ↵
                        </span>
                      </div>
                      <p className="text-[11.5px] text-muted-foreground/65 line-clamp-2 leading-snug whitespace-pre-wrap">
                        {s.body}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="px-4 py-2.5 border-t border-border/40 bg-muted/10 flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground/50">
              {snippets.length} snippet{snippets.length !== 1 ? "s" : ""}
            </span>
            <span className="text-[10px] text-muted-foreground/40">
              Manage from the Mail header
            </span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Manager dialog — full CRUD for snippets                                    */
/* ─────────────────────────────────────────────────────────────────────────── */

export function SnippetsManagerDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { snippets, upsert, remove } = useSnippets();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftBody, setDraftBody] = useState("");

  const startEdit = (s: Snippet) => {
    setEditingId(s.id);
    setDraftName(s.name);
    setDraftBody(s.body);
  };
  const startNew = () => {
    setEditingId("__new__");
    setDraftName("");
    setDraftBody("");
  };
  const cancelEdit = () => {
    setEditingId(null);
    setDraftName("");
    setDraftBody("");
  };
  const save = () => {
    const name = draftName.trim();
    const body = draftBody.trim();
    if (!name || !body) return;
    const id = editingId === "__new__" || !editingId
      ? `snippet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      : editingId;
    upsert({ id, name, body });
    cancelEdit();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/40">
          <DialogTitle className="flex items-center gap-2 text-base">
            <StickyNote className="h-4 w-4 text-primary/70" />
            Snippets &amp; Templates
          </DialogTitle>
          <p className="text-[11.5px] text-muted-foreground/60 mt-1">
            Reusable replies that can be inserted into any email with one click. Stored locally on this device.
          </p>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.4fr] divide-x divide-border/30 max-h-[70vh]">
          {/* List */}
          <div className="flex flex-col min-h-0">
            <div className="px-3 pt-3 pb-2 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/60">
                {snippets.length} snippet{snippets.length !== 1 ? "s" : ""}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={startNew}
                className="h-7 gap-1 text-xs"
                data-testid="button-new-snippet"
              >
                <Plus className="h-3 w-3" />
                New
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-3">
              {snippets.length === 0 && editingId !== "__new__" ? (
                <div className="px-3 py-8 text-center text-xs text-muted-foreground/55">
                  No snippets yet. Click <span className="font-semibold text-foreground/70">New</span> to create one.
                </div>
              ) : (
                <ul className="space-y-1">
                  <AnimatePresence initial={false}>
                    {snippets.map((s) => (
                      <motion.li
                        key={s.id}
                        layout
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -6 }}
                      >
                        <button
                          onClick={() => startEdit(s)}
                          data-testid={`row-snippet-${s.id}`}
                          className={`w-full text-left rounded-md px-2.5 py-2 transition-colors ${
                            editingId === s.id
                              ? "bg-primary/10 ring-1 ring-primary/30"
                              : "hover:bg-muted/40"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[13px] font-medium text-foreground truncate">{s.name}</span>
                            <Pencil className="h-3 w-3 text-muted-foreground/40 flex-shrink-0" />
                          </div>
                          <p className="text-[11px] text-muted-foreground/55 truncate mt-0.5">
                            {s.body.replace(/\s+/g, " ").slice(0, 60)}
                          </p>
                        </button>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </div>
          </div>

          {/* Editor */}
          <div className="flex flex-col min-h-0 bg-muted/10">
            {editingId === null ? (
              <div className="flex-1 flex items-center justify-center text-center px-6">
                <div>
                  <StickyNote className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground/55">
                    Select a snippet to edit, or click <span className="font-semibold text-foreground/70">New</span> to create one.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-h-0 p-4 gap-3">
                <div>
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Name</Label>
                  <Input
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    placeholder="e.g. Quote follow-up"
                    className="mt-1 h-9 text-sm"
                    data-testid="input-snippet-name"
                    autoFocus
                  />
                </div>
                <div className="flex-1 flex flex-col min-h-0">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Body</Label>
                  <Textarea
                    value={draftBody}
                    onChange={(e) => setDraftBody(e.target.value)}
                    placeholder="Write your reusable reply…"
                    className="mt-1 flex-1 min-h-[180px] text-sm font-mono leading-relaxed"
                    data-testid="input-snippet-body"
                  />
                  <p className="text-[10px] text-muted-foreground/45 mt-1.5">
                    Tip: use placeholders like <code className="font-mono text-foreground/60">{"{{firstName}}"}</code> as reminders to personalize.
                  </p>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div>
                    {editingId !== "__new__" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => { remove(editingId!); cancelEdit(); }}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
                        data-testid="button-delete-snippet"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={cancelEdit}>
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={save}
                      disabled={!draftName.trim() || !draftBody.trim()}
                      className="gap-1.5"
                      data-testid="button-save-snippet"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Save
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
