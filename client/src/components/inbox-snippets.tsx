import { useState, useMemo, useRef, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  StickyNote, Plus, Pencil, Trash2, Search, X, Copy, ArrowDownToLine,
} from "lucide-react";
import {
  type Snippet,
  type ActiveContact,
  useSnippets,
} from "@/hooks/use-snippets";

export type { Snippet, ActiveContact };

/* ─── Constants ─────────────────────────────────────────────────────────── */

const SNIPPET_CATEGORIES = [
  "Quick Replies",
  "Cold Outreach",
  "Follow Ups",
  "Founder Marina",
  "PO Conversion",
  "International",
  "Dealer / Partner",
  "Re-Engagement",
  "Urgency",
  "Brand",
  "Custom",
];

const MERGE_VARS = [
  { var: "{{firstName}}",    desc: "Contact first name" },
  { var: "{{lastName}}",     desc: "Contact last name" },
  { var: "{{marinaName}}",   desc: "Marina / facility name" },
  { var: "{{companyName}}",  desc: "Company name" },
  { var: "{{senderName}}",   desc: "Your name" },
  { var: "{{calendarLink}}", desc: "Calendar booking link" },
];

const CAT_COLORS: Record<string, string> = {
  "Quick Replies":    "bg-sky-500/15 text-sky-400 border border-sky-500/20",
  "Cold Outreach":    "bg-violet-500/15 text-violet-400 border border-violet-500/20",
  "Follow Ups":       "bg-amber-500/15 text-amber-400 border border-amber-500/20",
  "Founder Marina":   "bg-teal-500/15 text-teal-400 border border-teal-500/20",
  "PO Conversion":    "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  "International":    "bg-blue-500/15 text-blue-400 border border-blue-500/20",
  "Dealer / Partner": "bg-indigo-500/15 text-indigo-400 border border-indigo-500/20",
  "Re-Engagement":    "bg-orange-500/15 text-orange-400 border border-orange-500/20",
  "Urgency":          "bg-red-500/15 text-red-400 border border-red-500/20",
  "Brand":            "bg-pink-500/15 text-pink-400 border border-pink-500/20",
};
const catColor = (cat: string) =>
  CAT_COLORS[cat] ?? "bg-muted/40 text-muted-foreground/70 border border-border/30";

/* ─── Merge-variable resolver ───────────────────────────────────────────── */

function resolveVars(text: string, contact: ActiveContact | null, senderName = ""): string {
  const fill = (v: string | undefined, fallback: string) =>
    v && v.trim() ? v.trim() : fallback;
  return text
    .replace(/\{\{firstName\}\}/g,    fill(contact?.firstName,   "{{firstName}}"))
    .replace(/\{\{lastName\}\}/g,     fill(contact?.lastName,    "{{lastName}}"))
    .replace(/\{\{marinaName\}\}/g,   fill(contact?.marinaName,  "{{marinaName}}"))
    .replace(/\{\{companyName\}\}/g,  fill(contact?.companyName, "{{companyName}}"))
    .replace(/\{\{senderName\}\}/g,   senderName || "{{senderName}}")
    .replace(/\{\{calendarLink\}\}/g, "{{calendarLink}}");
}

/* ─── SnippetsModal ─────────────────────────────────────────────────────── */

export function SnippetsModal({
  isOpen,
  onClose,
  onInsertSnippet,
  activeContact,
  isNewEmail = false,
}: {
  isOpen: boolean;
  onClose: () => void;
  onInsertSnippet?: (body: string, subject: string) => void;
  activeContact?: ActiveContact | null;
  isNewEmail?: boolean;
}) {
  const { toast } = useToast();
  const { snippets, upsert, remove } = useSnippets();

  const [search, setSearch]               = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedId, setSelectedId]       = useState<string | null>(null);

  const [draftTitle,    setDraftTitle]    = useState("");
  const [draftCategory, setDraftCategory] = useState(SNIPPET_CATEGORIES[0]);
  const [draftSubject,  setDraftSubject]  = useState("");
  const [draftBody,     setDraftBody]     = useState("");
  const [isNewDraft,    setIsNewDraft]    = useState(false);

  const categoriesInUse = useMemo(
    () => Array.from(new Set(snippets.map((s) => s.category))).sort(),
    [snippets],
  );

  const filtered = useMemo(() => {
    let list = snippets;
    if (categoryFilter !== "all") list = list.filter((s) => s.category === categoryFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.body.toLowerCase().includes(q) ||
          s.subject.toLowerCase().includes(q),
      );
    }
    return list;
  }, [snippets, search, categoryFilter]);

  const selectSnippet = (s: Snippet) => {
    setSelectedId(s.id);
    setDraftTitle(s.title);
    setDraftCategory(s.category);
    setDraftSubject(s.subject);
    setDraftBody(s.body);
    setIsNewDraft(false);
  };

  const startNew = () => {
    setSelectedId("__new__");
    setDraftTitle("");
    setDraftCategory(SNIPPET_CATEGORIES[0]);
    setDraftSubject("");
    setDraftBody("");
    setIsNewDraft(true);
  };

  const cancelEdit = () => {
    setSelectedId(null);
    setIsNewDraft(false);
  };

  const handleSave = () => {
    const title = draftTitle.trim();
    const body  = draftBody.trim();
    if (!title || !body) return;
    const id = isNewDraft
      ? `snippet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      : selectedId!;
    const saved: Snippet = { id, title, category: draftCategory, subject: draftSubject.trim(), body };
    upsert(saved);
    setSelectedId(id);
    setIsNewDraft(false);
    toast({ title: "Snippet saved" });
  };

  const handleDelete = () => {
    if (!selectedId || isNewDraft) return;
    remove(selectedId);
    setSelectedId(null);
    setIsNewDraft(false);
    toast({ title: "Snippet deleted", variant: "destructive" });
  };

  const handleDuplicate = () => {
    if (!selectedId) return;
    const id = `snippet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const duped: Snippet = {
      id,
      title:    `${draftTitle} (copy)`,
      category: draftCategory,
      subject:  draftSubject,
      body:     draftBody,
    };
    upsert(duped);
    setSelectedId(id);
    setIsNewDraft(false);
    toast({ title: "Snippet duplicated" });
  };

  const handleInsert = () => {
    if (!onInsertSnippet || !selectedId) return;
    const resolvedBody    = resolveVars(draftBody, activeContact ?? null);
    const resolvedSubject = isNewEmail ? resolveVars(draftSubject, activeContact ?? null) : "";
    onInsertSnippet(resolvedBody, resolvedSubject);
    toast({ title: "Snippet inserted" });
    onClose();
  };

  /* Auto-resize body textarea to fit its content */
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draftBody]);

  const canSave = draftTitle.trim().length > 0 && draftBody.trim().length > 0;
  const hasEditor = selectedId !== null;

  return (
    <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="p-0 overflow-hidden max-w-4xl w-[96vw] flex flex-col"
        style={{ maxHeight: "88vh" }}
        data-testid="snippets-modal"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-border/40 flex-shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <StickyNote className="h-4 w-4 text-primary/70 flex-shrink-0" />
              <h2 className="text-[15px] font-semibold text-foreground">Snippets &amp; Templates</h2>
            </div>
            <p className="text-[11.5px] text-muted-foreground/60 mt-0.5 ml-6">
              Reusable replies that can be inserted into any email with one click.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted/40 transition-colors ml-4 mt-0.5"
            aria-label="Close"
            data-testid="button-close-snippets-modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body — two-panel layout */}
        <div className="flex flex-col md:flex-row min-h-0 flex-1 overflow-hidden">
          {/* ── Left panel ── */}
          <div className="flex flex-col w-full md:w-72 lg:w-80 flex-shrink-0 border-b md:border-b-0 md:border-r border-border/30 min-h-0">
            {/* Search + category filter */}
            <div className="px-3 pt-3 pb-2 space-y-2 flex-shrink-0">
              <div className="flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/20 px-2.5 py-1.5">
                <Search className="h-3.5 w-3.5 text-muted-foreground/50 flex-shrink-0" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search snippets…"
                  className="flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground/40"
                  data-testid="input-snippets-search"
                />
                {search && (
                  <button onClick={() => setSearch("")} className="text-muted-foreground/40 hover:text-foreground">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="flex-1 text-[11.5px] bg-muted/20 border border-border/40 rounded px-2 py-1 text-foreground/80 outline-none cursor-pointer"
                  data-testid="select-category-filter"
                >
                  <option value="all">All categories</option>
                  {categoriesInUse.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={startNew}
                  className="h-7 gap-1 text-[11.5px] px-2 flex-shrink-0 text-primary hover:text-primary hover:bg-primary/10"
                  data-testid="button-new-snippet"
                >
                  <Plus className="h-3 w-3" />
                  New
                </Button>
              </div>
            </div>

            {/* Snippet list */}
            <div className="flex-1 overflow-y-auto px-2 pb-3 min-h-0">
              {filtered.length === 0 && (
                <div className="py-10 text-center text-[11.5px] text-muted-foreground/50">
                  {search ? `No snippets match "${search}".` : "No snippets yet. Click + New to create one."}
                </div>
              )}
              <ul className="space-y-0.5">
                {filtered.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => selectSnippet(s)}
                      data-testid={`row-snippet-${s.id}`}
                      className={`w-full text-left rounded-md px-2.5 py-2 transition-colors group ${
                        selectedId === s.id
                          ? "bg-primary/10 ring-1 ring-primary/30"
                          : "hover:bg-muted/40"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-[12.5px] font-medium text-foreground truncate">{s.title}</span>
                            <Pencil className="h-2.5 w-2.5 text-muted-foreground/30 group-hover:text-muted-foreground/60 flex-shrink-0" />
                          </div>
                          <span className={`inline-block text-[9.5px] font-medium px-1.5 py-0.5 rounded-full ${catColor(s.category)}`}>
                            {s.category}
                          </span>
                          {s.body && (
                            <p className="text-[11px] text-muted-foreground/50 mt-1 line-clamp-1 leading-snug">
                              {s.body.replace(/\n+/g, " ").slice(0, 70)}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* Footer count */}
            <div className="px-3 py-2 border-t border-border/30 flex-shrink-0">
              <span className="text-[10px] text-muted-foreground/40">
                {snippets.length} snippet{snippets.length !== 1 ? "s" : ""} stored locally
              </span>
            </div>
          </div>

          {/* ── Right panel ── */}
          <div className="flex-1 min-w-0 flex flex-col min-h-0 bg-muted/5">
            {!hasEditor ? (
              <div className="flex-1 flex items-center justify-center px-8 text-center">
                <div>
                  <StickyNote className="h-8 w-8 text-muted-foreground/20 mx-auto mb-3" />
                  <p className="text-[12.5px] text-muted-foreground/50 leading-relaxed">
                    Select a snippet to view and edit, or click{" "}
                    <span className="font-semibold text-foreground/60">+ New</span>{" "}
                    to create one.
                  </p>
                  {onInsertSnippet && (
                    <p className="text-[11px] text-muted-foreground/35 mt-1.5">
                      Use <strong>Insert</strong> to add a snippet directly to your email.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
                <div className="flex-1 p-4 space-y-3">
                  {/* Title */}
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/55 mb-1 block">
                      Snippet Title
                    </Label>
                    <Input
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      placeholder="e.g. Post Demo Follow Up"
                      className="h-9 text-sm"
                      data-testid="input-snippet-title"
                      autoFocus
                    />
                  </div>

                  {/* Category */}
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/55 mb-1 block">
                      Category
                    </Label>
                    <Select value={draftCategory} onValueChange={setDraftCategory}>
                      <SelectTrigger className="h-9 text-sm" data-testid="select-snippet-category">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SNIPPET_CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Subject */}
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/55 mb-1 block">
                      Subject Line{isNewEmail && onInsertSnippet && (
                        <span className="ml-1.5 text-primary/70 normal-case font-normal">(auto-filled when inserted)</span>
                      )}
                    </Label>
                    <Input
                      value={draftSubject}
                      onChange={(e) => setDraftSubject(e.target.value)}
                      placeholder="e.g. Great connecting today"
                      className="h-9 text-sm"
                      data-testid="input-snippet-subject"
                    />
                  </div>

                  {/* Body — auto-expands to full content height */}
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/55 mb-1 block">
                      Body
                    </Label>
                    <Textarea
                      ref={bodyRef}
                      value={draftBody}
                      onChange={(e) => setDraftBody(e.target.value)}
                      placeholder="Write your reusable reply…"
                      className="text-[13px] font-mono leading-relaxed resize-none overflow-hidden w-full"
                      style={{ minHeight: 180 }}
                      data-testid="input-snippet-body"
                    />
                  </div>

                  {/* Merge Variables helper */}
                  <div className="rounded-md border border-border/30 bg-muted/20 p-3">
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/50 mb-2">
                      Available Variables
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                      {MERGE_VARS.map((mv) => (
                        <div key={mv.var} className="flex items-baseline gap-1.5">
                          <code className="text-[10.5px] font-mono text-primary/80 select-all">{mv.var}</code>
                          <span className="text-[10px] text-muted-foreground/45">{mv.desc}</span>
                        </div>
                      ))}
                    </div>
                    {activeContact?.firstName && (
                      <p className="mt-2 text-[10px] text-emerald-400/80">
                        ✓ Contact data available — variables will be pre-filled on insert.
                      </p>
                    )}
                  </div>
                </div>

                {/* Action bar */}
                <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border/30 flex-shrink-0 bg-background/60">
                  {/* Left: Delete */}
                  <div>
                    {!isNewDraft && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={handleDelete}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5 h-8"
                        data-testid="button-delete-snippet"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </Button>
                    )}
                  </div>

                  {/* Right: Save, Duplicate, Insert */}
                  <div className="flex items-center gap-1.5">
                    {!isNewDraft && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={handleDuplicate}
                        className="gap-1.5 h-8 text-xs"
                        data-testid="button-duplicate-snippet"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Duplicate
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleSave}
                      disabled={!canSave}
                      className="gap-1.5 h-8 text-xs"
                      data-testid="button-save-snippet"
                    >
                      Save
                    </Button>
                    {onInsertSnippet && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleInsert}
                        disabled={!selectedId || isNewDraft}
                        className="gap-1.5 h-8 text-xs bg-primary hover:bg-primary/90"
                        data-testid="button-insert-snippet"
                      >
                        <ArrowDownToLine className="h-3.5 w-3.5" />
                        Insert
                      </Button>
                    )}
                    {isNewDraft && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={cancelEdit}
                        className="h-8 text-xs"
                      >
                        Cancel
                      </Button>
                    )}
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

/* ─── SnippetInsertButton ───────────────────────────────────────────────── */

export function SnippetInsertButton({
  onInsert,
  onInsertFull,
  disabled,
  variant = "icon",
  activeContact,
  isNewEmail,
}: {
  onInsert: (body: string) => void;
  onInsertFull?: (body: string, subject: string) => void;
  disabled?: boolean;
  variant?: "icon" | "labeled";
  activeContact?: ActiveContact | null;
  isNewEmail?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size={variant === "icon" ? "icon" : "sm"}
        className={
          variant === "icon"
            ? "h-8 w-8 text-muted-foreground hover:text-primary"
            : "gap-1.5"
        }
        onClick={() => setOpen(true)}
        disabled={disabled}
        title="Snippets & templates"
        data-testid="button-snippet-insert"
      >
        <StickyNote className="h-4 w-4" />
        {variant === "labeled" && <span className="text-xs">Snippets</span>}
      </Button>

      <SnippetsModal
        isOpen={open}
        onClose={() => setOpen(false)}
        onInsertSnippet={(body, subject) => {
          if (onInsertFull) {
            onInsertFull(body, subject);
          } else {
            onInsert(body);
          }
        }}
        activeContact={activeContact}
        isNewEmail={isNewEmail}
      />
    </>
  );
}

/* ─── SnippetsManagerDialog ─────────────────────────────────────────────── */

export function SnippetsManagerDialog({
  open,
  onClose,
  activeContact,
}: {
  open: boolean;
  onClose: () => void;
  activeContact?: ActiveContact | null;
}) {
  return (
    <SnippetsModal
      isOpen={open}
      onClose={onClose}
      activeContact={activeContact}
      isNewEmail={false}
    />
  );
}
