import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  MessageSquare, Search, Plus, AlertTriangle, RefreshCw,
  Building2, User, TrendingUp, Trash2, Pencil, Send,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type NoteItem = {
  id: number;
  content: string;
  author_id: number | null;
  author_name: string;
  linked_object_type: string;
  linked_object_id: number;
  linked_object_name: string | null;
  created_at: string;
  updated_at: string;
};

function displayAuthor(note: NoteItem): string {
  if (note.author_id === null && note.author_name === "System") return "System (legacy)";
  return note.author_name;
}

const TYPE_LABEL: Record<string, string> = {
  contact: "Contact", account: "Account", opportunity: "Opportunity",
};
const TYPE_ICON: Record<string, React.ElementType> = {
  contact: User, account: Building2, opportunity: TrendingUp,
};
const TYPE_COLOR: Record<string, string> = {
  contact: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  account: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  opportunity: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
};
const ENTITY_LINK: Record<string, (id: number) => string> = {
  contact: (id) => `/contacts/${id}`,
  account: (id) => `/accounts/${id}`,
  opportunity: (id) => `/opportunities/${id}`,
};

type EntityResult = { id: number; label: string };

function EntityPicker({
  objType, setObjType, selected, setSelected,
}: {
  objType: string;
  setObjType: (t: string) => void;
  selected: EntityResult | null;
  setSelected: (e: EntityResult | null) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const { data: results = [] } = useQuery<EntityResult[]>({
    queryKey: ["/api/entity-search", objType, q],
    queryFn: async () => {
      if (q.length < 2) return [];
      const params = new URLSearchParams({ search: q, limit: "8" });
      if (objType === "account") {
        const r = await fetch(`/api/accounts?${params}`).then(x => x.json());
        return (r.data ?? []).map((a: any) => ({ id: a.id, label: a.name }));
      }
      if (objType === "contact") {
        const r = await fetch(`/api/contacts?${params}`).then(x => x.json());
        return (Array.isArray(r) ? r : []).map((c: any) => ({ id: c.id, label: c.name }));
      }
      if (objType === "opportunity") {
        const r = await fetch(`/api/opportunities?${params}`).then(x => x.json());
        return (r.data ?? []).map((o: any) => ({ id: o.id, label: o.title }));
      }
      return [];
    },
    enabled: q.length >= 2,
  });

  const handleTypeChange = (t: string) => {
    setObjType(t);
    setSelected(null);
    setQ("");
    setOpen(false);
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs">Linked To</Label>
      <Select value={objType} onValueChange={handleTypeChange}>
        <SelectTrigger data-testid="select-note-type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="account">Account</SelectItem>
          <SelectItem value="contact">Contact</SelectItem>
          <SelectItem value="opportunity">Opportunity</SelectItem>
        </SelectContent>
      </Select>
      {selected ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-muted/40 text-sm">
          <span className="flex-1 truncate text-foreground">{selected.label}</span>
          <button type="button" onClick={() => { setSelected(null); setQ(""); }}
            className="text-muted-foreground hover:text-foreground transition-colors text-xs"
            data-testid="button-clear-entity">✕</button>
        </div>
      ) : (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={q}
            onChange={e => { setQ(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder={`Search ${objType}s…`}
            className="pl-8 text-sm"
            data-testid="input-entity-search"
          />
          {open && results.length > 0 && (
            <div className="absolute z-50 left-0 right-0 top-full mt-1 rounded-md border border-border bg-popover shadow-lg overflow-hidden">
              {results.map(r => (
                <button key={r.id} type="button"
                  onMouseDown={() => { setSelected(r); setQ(""); setOpen(false); }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors truncate"
                  data-testid={`option-entity-${r.id}`}>
                  {r.label}
                </button>
              ))}
            </div>
          )}
          {open && q.length >= 2 && results.length === 0 && (
            <div className="absolute z-50 left-0 right-0 top-full mt-1 rounded-md border border-border bg-popover shadow-sm px-3 py-2 text-xs text-muted-foreground">
              No results
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AddNoteDialog({ onClose }: { onClose: () => void }) {
  const [content, setContent] = useState("");
  const [objType, setObjType] = useState("account");
  const [selected, setSelected] = useState<EntityResult | null>(null);
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/notes", {
      content, linkedObjectType: objType, linkedObjectId: selected!.id,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notes/all"] });
      toast({ title: "Note saved" });
      onClose();
    },
    onError: () => toast({ title: "Failed to save note", variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" /> New Note
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <EntityPicker objType={objType} setObjType={setObjType} selected={selected} setSelected={setSelected} />
          <div className="space-y-1.5">
            <Label className="text-xs">Note</Label>
            <Textarea value={content} onChange={e => setContent(e.target.value)}
              placeholder="Write your note here..." className="min-h-[120px] resize-none"
              data-testid="textarea-note-content" />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button disabled={!content.trim() || !selected || mutation.isPending}
              onClick={() => mutation.mutate()} className="gap-1.5" data-testid="button-save-note">
              <Send className="h-3.5 w-3.5" /> Save Note
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function NotesPage() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [editNote, setEditNote] = useState<NoteItem | null>(null);
  const [editContent, setEditContent] = useState("");
  const { toast } = useToast();

  const { data = [], isLoading, isError, refetch } = useQuery<NoteItem[]>({
    queryKey: ["/api/notes/all", typeFilter, search],
    queryFn: () => {
      const p = new URLSearchParams({ limit: "100" });
      if (typeFilter !== "all") p.set("type", typeFilter);
      if (search) p.set("search", search);
      return fetch(`/api/notes/all?${p}`).then(r => r.json());
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/notes/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/notes/all"] }); toast({ title: "Note deleted" }); },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, content }: { id: number; content: string }) =>
      apiRequest("PUT", `/api/notes/${id}`, { content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notes/all"] });
      setEditNote(null);
      toast({ title: "Note updated" });
    },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  const startEdit = (note: NoteItem) => { setEditNote(note); setEditContent(note.content); };

  if (isError) return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[40vh] gap-4">
      <AlertTriangle className="h-8 w-8 text-amber-400" />
      <p className="text-sm text-muted-foreground">Failed to load notes.</p>
      <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
        <RefreshCw className="h-3.5 w-3.5" /> Try again
      </Button>
    </div>
  );

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5" data-testid="notes-page">
      {addOpen && <AddNoteDialog onClose={() => setAddOpen(false)} />}

      {/* Edit dialog */}
      {editNote && (
        <Dialog open onOpenChange={() => setEditNote(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Pencil className="h-4 w-4 text-primary" /> Edit Note
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <Textarea value={editContent} onChange={e => setEditContent(e.target.value)}
                className="min-h-[120px] resize-none" data-testid="textarea-edit-note" />
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" onClick={() => setEditNote(null)}>Cancel</Button>
                <Button disabled={!editContent.trim() || updateMutation.isPending}
                  onClick={() => updateMutation.mutate({ id: editNote.id, content: editContent })}
                  className="gap-1.5" data-testid="button-update-note">
                  <Send className="h-3.5 w-3.5" /> Update
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <MessageSquare className="h-7 w-7 text-primary" /> Notes
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">All notes across contacts, accounts, and opportunities</p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="gap-1.5 self-start" data-testid="button-add-note">
          <Plus className="h-4 w-4" /> Add Note
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search notes..." value={search} onChange={e => setSearch(e.target.value)}
            className="pl-9" data-testid="input-search-notes" />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {["all", "account", "contact", "opportunity"].map(t => (
            <Button key={t} variant={typeFilter === t ? "secondary" : "ghost"} size="sm"
              onClick={() => setTypeFilter(t)} className="h-8 text-xs capitalize" data-testid={`filter-${t}`}>
              {t === "all" ? "All" : TYPE_LABEL[t] ?? t}
            </Button>
          ))}
        </div>
      </div>

      {/* Notes list */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : data.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <MessageSquare className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{search || typeFilter !== "all" ? "No matching notes" : "No notes yet"}</p>
          <Button variant="outline" size="sm" onClick={() => setAddOpen(true)} className="mt-4 gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Add first note
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {data.map(note => {
            const Icon = TYPE_ICON[note.linked_object_type] ?? MessageSquare;
            const href = ENTITY_LINK[note.linked_object_type]?.(note.linked_object_id);
            return (
              <Card key={note.id} className="border-border/40 hover:border-border/60 transition-colors"
                data-testid={`note-card-${note.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm whitespace-pre-wrap text-foreground/90 leading-relaxed">{note.content}</p>
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        <span className="text-xs text-muted-foreground">{displayAuthor(note)}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}
                        </span>
                        {note.linked_object_type && (
                          <Badge variant="outline" className={`text-[10px] h-5 px-1.5 border ${TYPE_COLOR[note.linked_object_type] ?? ""}`}>
                            <Icon className="h-3 w-3 mr-0.5" />
                            {TYPE_LABEL[note.linked_object_type] ?? note.linked_object_type}
                          </Badge>
                        )}
                        {note.linked_object_name && href ? (
                          <Link href={href}>
                            <span className="text-xs text-primary hover:underline cursor-pointer">{note.linked_object_name}</span>
                          </Link>
                        ) : note.linked_object_name ? (
                          <span className="text-xs text-muted-foreground">{note.linked_object_name}</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                        onClick={() => startEdit(note)} data-testid={`button-edit-note-${note.id}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400"
                        onClick={() => { if (window.confirm("Delete this note?")) deleteMutation.mutate(note.id); }}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-note-${note.id}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
