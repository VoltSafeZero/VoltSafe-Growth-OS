import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  StickyNote, Plus, Search, Edit2, Trash2, Copy, Star, Globe, Lock,
  ChevronDown, ChevronRight, BarChart2, X, Check, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

type Snippet = {
  id: number;
  title: string;
  subject: string;
  body: string;
  category: string;
  snippetType: string;
  ownerUserId: number | null;
  ownerName: string | null;
  sharingScope: string;
  isStarter: boolean;
  usageCount: number;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
};

const CATEGORIES = [
  "All Categories", "Introduction", "Follow-Up", "Proposal", "Objection Handling",
  "Pricing", "Technical", "Support", "Closing", "Meeting Request",
  "Thank You", "Re-Engagement", "Custom",
];

const EMPTY_FORM = {
  title: "",
  subject: "",
  body: "",
  category: "Custom",
  snippetType: "snippet",
  sharingScope: "org",
};

type FormValues = typeof EMPTY_FORM;

function SnippetCard({
  s, isAdmin, currentUserId, onEdit, onDelete, onDuplicate,
}: {
  s: Snippet;
  isAdmin: boolean;
  currentUserId: number;
  onEdit: (s: Snippet) => void;
  onDelete: (s: Snippet) => void;
  onDuplicate: (s: Snippet) => void;
}) {
  const canEdit = isAdmin || s.ownerUserId === currentUserId;
  const bodyPreview = s.body.replace(/<[^>]+>/g, "").slice(0, 120);

  return (
    <div
      className="group rounded-xl border border-border/50 bg-card/40 hover:bg-card/70 hover:border-border p-4 flex flex-col gap-2 transition-all"
      data-testid={`snippet-card-${s.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {s.isStarter && <Star className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
          <span className="font-medium text-sm text-foreground truncate">{s.title}</span>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onDuplicate(s)} data-testid={`duplicate-snippet-${s.id}`}>
            <Copy className="w-3.5 h-3.5" />
          </Button>
          {canEdit && (
            <>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(s)} data-testid={`edit-snippet-${s.id}`}>
                <Edit2 className="w-3.5 h-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive" onClick={() => onDelete(s)} data-testid={`delete-snippet-${s.id}`}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {s.subject && (
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground/60">Subject:</span> {s.subject}
        </div>
      )}

      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{bodyPreview || "—"}</p>

      <div className="flex items-center gap-2 mt-1">
        <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">{s.category}</Badge>
        <Badge variant="outline" className={`text-xs px-1.5 py-0 h-5 ${s.snippetType === "template" ? "border-blue-500/30 text-blue-400" : "border-teal-500/30 text-teal-400"}`}>
          {s.snippetType === "template" ? "Template" : "Snippet"}
        </Badge>
        {s.sharingScope === "org" ? (
          <Globe className="w-3 h-3 text-muted-foreground" />
        ) : (
          <Lock className="w-3 h-3 text-muted-foreground" />
        )}
        {s.usageCount > 0 && (
          <span className="text-xs text-muted-foreground ml-auto flex items-center gap-0.5">
            <BarChart2 className="w-3 h-3" />{s.usageCount}
          </span>
        )}
      </div>
      {s.ownerName && s.sharingScope === "org" && (
        <p className="text-xs text-muted-foreground/60">by {s.ownerName}</p>
      )}
    </div>
  );
}

function SnippetFormDialog({
  open, initial, onClose,
}: {
  open: boolean;
  initial: Snippet | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = ["master_admin", "admin", "ceo"].includes((user as any)?.globalRole ?? "");
  const [form, setForm] = useState<FormValues>(
    initial
      ? { title: initial.title, subject: initial.subject, body: initial.body, category: initial.category, snippetType: initial.snippetType, sharingScope: initial.sharingScope }
      : { ...EMPTY_FORM },
  );

  const set = (k: keyof FormValues, v: string) => setForm(p => ({ ...p, [k]: v }));

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (initial) {
        return apiRequest("PATCH", `/api/email-snippets/${initial.id}`, values);
      }
      return apiRequest("POST", "/api/email-snippets", values);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-snippets"] });
      toast({ title: initial ? "Snippet updated" : "Snippet created", description: form.title });
      onClose();
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const handleSubmit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!form.title.trim()) return toast({ title: "Title required", variant: "destructive" });
    if (!form.body.trim()) return toast({ title: "Body required", variant: "destructive" });
    saveMutation.mutate(form);
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto" data-testid="snippet-form-dialog">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Snippet" : "New Snippet or Template"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Type</Label>
              <Select value={form.snippetType} onValueChange={v => set("snippetType", v)}>
                <SelectTrigger data-testid="select-snippet-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="snippet">Snippet (body only)</SelectItem>
                  <SelectItem value="template">Template (subject + body)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={v => set("category", v)}>
                <SelectTrigger data-testid="select-snippet-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.filter(c => c !== "All Categories").map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Title *</Label>
            <Input
              value={form.title}
              onChange={e => set("title", e.target.value)}
              placeholder="e.g. ROI Follow-Up"
              data-testid="input-snippet-title"
            />
          </div>

          {form.snippetType === "template" && (
            <div className="flex flex-col gap-1.5">
              <Label>Subject Line</Label>
              <Input
                value={form.subject}
                onChange={e => set("subject", e.target.value)}
                placeholder="e.g. Following up on our conversation — {{first_name}}"
                data-testid="input-snippet-subject"
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>Body *</Label>
            <Textarea
              value={form.body}
              onChange={e => set("body", e.target.value)}
              placeholder={"Use {{first_name}}, {{company}}, {{marina_name}} for merge fields"}
              rows={8}
              className="font-mono text-xs"
              data-testid="textarea-snippet-body"
            />
            <p className="text-xs text-muted-foreground">Merge fields: {"{{first_name}}"} {"{{company}}"} {"{{marina_name}}"} {"{{user_name}}"}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Visibility</Label>
            <Select value={form.sharingScope} onValueChange={v => set("sharingScope", v)}>
              <SelectTrigger data-testid="select-snippet-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="org">Org-wide (everyone can use)</SelectItem>
                <SelectItem value="private">Private (only me)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saveMutation.isPending} data-testid="save-snippet-btn">
              {saveMutation.isPending ? "Saving…" : initial ? "Save Changes" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function EmailToolsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = ["master_admin", "admin", "ceo"].includes((user as any)?.globalRole ?? "");
  const currentUserId = (user as any)?.id ?? 0;

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | "snippet" | "template">("all");
  const [filterCategory, setFilterCategory] = useState("All Categories");
  const [filterScope, setFilterScope] = useState<"all" | "org" | "mine">("all");
  const [editTarget, setEditTarget] = useState<Snippet | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Snippet | null>(null);

  const { data: snippets = [], isLoading } = useQuery<Snippet[]>({
    queryKey: ["/api/email-snippets"],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/email-snippets/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-snippets"] });
      toast({ title: "Deleted" });
      setDeleteTarget(null);
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const seedMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/email-snippets/seed-defaults"),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-snippets"] });
      toast({ title: "Library seeded", description: `${data?.seeded ?? 0} starter snippets added` });
    },
    onError: (e: any) => toast({ title: "Seed failed", description: e.message, variant: "destructive" }),
  });

  const handleEdit = (s: Snippet) => { setEditTarget(s); setFormOpen(true); };
  const handleNew = () => { setEditTarget(null); setFormOpen(true); };
  const handleDuplicate = (s: Snippet) => {
    setEditTarget({ ...s, id: 0, title: s.title + " (copy)" } as any);
    setFormOpen(true);
  };

  const filtered = snippets.filter(s => {
    if (s.isArchived) return false;
    if (filterType !== "all" && s.snippetType !== filterType) return false;
    if (filterCategory !== "All Categories" && s.category !== filterCategory) return false;
    if (filterScope === "org" && s.sharingScope !== "org") return false;
    if (filterScope === "mine" && s.ownerUserId !== currentUserId) return false;
    if (search) {
      const q = search.toLowerCase();
      return s.title.toLowerCase().includes(q) || s.body.toLowerCase().includes(q) || (s.subject || "").toLowerCase().includes(q);
    }
    return true;
  });

  const starterCount = filtered.filter(s => s.isStarter).length;
  const orgCount = filtered.filter(s => s.sharingScope === "org").length;
  const mineCount = filtered.filter(s => s.ownerUserId === currentUserId).length;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <StickyNote className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground" data-testid="email-tools-heading">Snippets & Templates</h1>
            <p className="text-sm text-muted-foreground">Reusable email content for your whole team</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && snippets.length === 0 && (
            <Button variant="outline" size="sm" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending} data-testid="seed-defaults-btn">
              <Sparkles className="w-4 h-4 mr-2" />
              {seedMutation.isPending ? "Seeding…" : "Load Starter Library"}
            </Button>
          )}
          <Button onClick={handleNew} data-testid="new-snippet-btn">
            <Plus className="w-4 h-4 mr-2" />
            New Snippet
          </Button>
        </div>
      </div>

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border/30 shrink-0 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-8 h-8 w-48 text-sm"
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="search-snippets"
          />
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/50">
          {(["all", "snippet", "template"] as const).map(t => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${filterType === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              data-testid={`filter-type-${t}`}
            >
              {t === "all" ? "All" : t === "snippet" ? "Snippets" : "Templates"}
            </button>
          ))}
        </div>

        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="h-8 w-40 text-sm" data-testid="filter-category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterScope} onValueChange={v => setFilterScope(v as any)}>
          <SelectTrigger className="h-8 w-36 text-sm" data-testid="filter-scope">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Snippets</SelectItem>
            <SelectItem value="org">Org-Wide</SelectItem>
            <SelectItem value="mine">My Snippets</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span data-testid="snippet-count">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
          <span>· {orgCount} org-wide</span>
          <span>· {mineCount} mine</span>
        </div>
      </div>

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border/40 bg-card/40 p-4 h-40 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-center" data-testid="empty-state">
            <StickyNote className="w-12 h-12 text-muted-foreground/30" />
            <div>
              <p className="text-lg font-medium text-foreground/60">No snippets found</p>
              <p className="text-sm text-muted-foreground mt-1">
                {snippets.length === 0
                  ? isAdmin
                    ? "Click \"Load Starter Library\" to add 20+ pre-built snippets, or create your own."
                    : "No snippets exist yet. Create the first one for your team."
                  : "Try adjusting your filters."}
              </p>
            </div>
            <Button onClick={handleNew} variant="outline" data-testid="empty-new-snippet-btn">
              <Plus className="w-4 h-4 mr-2" />Create a Snippet
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map(s => (
              <SnippetCard
                key={s.id}
                s={s}
                isAdmin={isAdmin}
                currentUserId={currentUserId}
                onEdit={handleEdit}
                onDelete={setDeleteTarget}
                onDuplicate={handleDuplicate}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Form dialog ──────────────────────────────────────────────────── */}
      {formOpen && (
        <SnippetFormDialog
          open={formOpen}
          initial={editTarget?.id ? editTarget : null}
          onClose={() => { setFormOpen(false); setEditTarget(null); }}
        />
      )}

      {/* ── Delete confirm ──────────────────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete snippet?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.title}" will be permanently removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="confirm-delete-snippet"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
