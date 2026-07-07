import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BellRing, Plus, Mail, FileText, Calendar, Users, MoreHorizontal, Tag, Send, FileEdit, Trash2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";

const UPDATE_TYPES = [
  { label: "Monthly Update",    color: "text-blue-400 bg-blue-400/10 border-blue-400/20" },
  { label: "Quarterly Update",  color: "text-violet-400 bg-violet-400/10 border-violet-400/20" },
  { label: "Milestone",         color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },
  { label: "Data Room Access",  color: "text-amber-400 bg-amber-400/10 border-amber-400/20" },
  { label: "Ad Hoc",            color: "text-muted-foreground bg-muted/40 border-border" },
];

const TYPE_COLOR: Record<string, string> = Object.fromEntries(UPDATE_TYPES.map(t => [t.label, t.color]));

const BLANK = { title: "", update_type: "Monthly Update", subject: "", body: "", tags: "", status: "draft", scheduled_at: "" };

interface Update {
  id: number;
  title: string;
  update_type: string;
  subject: string | null;
  body: string | null;
  status: string;
  tags: string[] | null;
  scheduled_at: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export default function CapitalUpdatesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [filterType, setFilterType] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Update | null>(null);
  const [form, setForm] = useState({ ...BLANK });
  const [deleteTarget, setDeleteTarget] = useState<Update | null>(null);

  const { data: updates = [], isLoading } = useQuery<Update[]>({
    queryKey: ["/api/capital/investor-updates"],
  });

  const createMut = useMutation({
    mutationFn: (body: typeof BLANK) => apiRequest("POST", "/api/capital/investor-updates", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capital/investor-updates"] });
      toast({ title: "Update created" });
      closeModal();
    },
    onError: () => toast({ title: "Failed to create update", variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: typeof BLANK }) =>
      apiRequest("PATCH", `/api/capital/investor-updates/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capital/investor-updates"] });
      toast({ title: "Update saved" });
      closeModal();
    },
    onError: () => toast({ title: "Failed to save update", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/capital/investor-updates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capital/investor-updates"] });
      toast({ title: "Update deleted" });
      setDeleteTarget(null);
    },
    onError: () => toast({ title: "Failed to delete update", variant: "destructive" }),
  });

  const markSentMut = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/capital/investor-updates/${id}`, { status: "sent", sent_at: new Date().toISOString() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capital/investor-updates"] });
      toast({ title: "Marked as sent" });
    },
    onError: () => toast({ title: "Failed to mark as sent", variant: "destructive" }),
  });

  function openCreate() {
    setEditing(null);
    setForm({ ...BLANK });
    setModalOpen(true);
  }

  function openEdit(u: Update) {
    setEditing(u);
    setForm({
      title: u.title,
      update_type: u.update_type,
      subject: u.subject ?? "",
      body: u.body ?? "",
      tags: (u.tags ?? []).join(", "),
      status: u.status,
      scheduled_at: u.scheduled_at ? u.scheduled_at.slice(0, 16) : "",
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditing(null);
    setForm({ ...BLANK });
  }

  function handleSubmit() {
    if (!form.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    const payload = {
      ...form,
      tags: form.tags ? form.tags.split(",").map(t => t.trim()).filter(Boolean).join(",") : "",
      scheduled_at: form.scheduled_at || "",
    };
    if (editing) {
      updateMut.mutate({ id: editing.id, body: payload });
    } else {
      createMut.mutate(payload);
    }
  }

  const filtered = filterType ? updates.filter(u => u.update_type === filterType) : updates;
  const isPending = createMut.isPending || updateMut.isPending;

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <BellRing className="w-5 h-5 text-primary" />
            Investor Updates
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Send and log regular updates to investors — monthly reports, milestone announcements, and data room access invites.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openCreate} data-testid="btn-add-update">
          <Plus className="w-3.5 h-3.5" />
          Create Update
        </Button>
      </div>

      {/* Filter chips */}
      <div className="flex gap-3 px-6 py-3 border-b border-border shrink-0 overflow-x-auto">
        {UPDATE_TYPES.map(u => (
          <Badge
            key={u.label}
            variant="outline"
            className={`cursor-pointer text-xs whitespace-nowrap transition-opacity ${u.color} ${filterType && filterType !== u.label ? "opacity-40" : ""}`}
            onClick={() => setFilterType(filterType === u.label ? null : u.label)}
            data-testid={`filter-update-type-${u.label.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {u.label}
            {filterType === u.label && " ×"}
          </Badge>
        ))}
        {filterType && (
          <Badge
            variant="outline"
            className="cursor-pointer text-xs whitespace-nowrap text-muted-foreground"
            onClick={() => setFilterType(null)}
            data-testid="filter-clear"
          >
            Clear filter
          </Badge>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center p-12">
            <Card className="max-w-md w-full border-dashed border-border/60 bg-muted/20">
              <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                  <BellRing className="w-7 h-7 text-primary" />
                </div>
                <div>
                  <h2 className="font-semibold text-base mb-1">
                    {filterType ? `No ${filterType} updates yet` : "No investor updates yet"}
                  </h2>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {filterType
                      ? `No updates of type "${filterType}" have been created. Click "Create Update" to add one.`
                      : "Keep investors informed with regular updates. Log monthly and quarterly reports, milestone announcements, data room access invites, and any ad hoc communications."}
                  </p>
                </div>
                {!filterType && (
                  <div className="flex flex-col gap-2 w-full mt-2">
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground">
                      <Mail className="w-4 h-4 shrink-0 text-primary/60" />
                      <span>Compose updates and track who received each communication</span>
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground">
                      <FileText className="w-4 h-4 shrink-0 text-primary/60" />
                      <span>Attach board decks, financial summaries, and investor reports</span>
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground">
                      <Calendar className="w-4 h-4 shrink-0 text-primary/60" />
                      <span>Schedule recurring monthly and quarterly update reminders</span>
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground">
                      <Users className="w-4 h-4 shrink-0 text-primary/60" />
                      <span>Segment distribution — prospects vs current investors vs advisors</span>
                    </div>
                  </div>
                )}
                <Button size="sm" className="mt-2 gap-1.5" onClick={openCreate} data-testid="btn-create-first-update">
                  <Plus className="w-3.5 h-3.5" />
                  Create First Update
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="px-6 py-4 flex flex-col gap-3">
            {filtered.map(u => (
              <div
                key={u.id}
                className="border border-border/30 rounded-xl px-4 py-3 bg-card/30 hover:bg-muted/10 transition-colors"
                data-testid={`row-update-${u.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-medium text-sm truncate">{u.title}</span>
                      <Badge variant="outline" className={`text-xs shrink-0 ${TYPE_COLOR[u.update_type] ?? ""}`}>
                        {u.update_type}
                      </Badge>
                      {u.status === "sent" ? (
                        <Badge variant="outline" className="text-xs text-emerald-400 bg-emerald-400/10 border-emerald-400/20 shrink-0">
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Sent
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-muted-foreground shrink-0">
                          Draft
                        </Badge>
                      )}
                    </div>
                    {u.subject && <p className="text-xs text-muted-foreground truncate">{u.subject}</p>}
                    {u.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{u.body}</p>}
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      {format(new Date(u.created_at), "MMM d, yyyy")}
                      {u.sent_at && ` · Sent ${format(new Date(u.sent_at), "MMM d, yyyy")}`}
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                    {u.status !== "sent" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => markSentMut.mutate(u.id)}
                        disabled={markSentMut.isPending}
                        data-testid={`btn-mark-sent-${u.id}`}
                      >
                        <Send className="w-3 h-3" /> Mark Sent
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" data-testid={`btn-menu-update-${u.id}`}>
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(u)} data-testid={`menu-edit-update-${u.id}`}>
                          <FileEdit className="w-3.5 h-3.5 mr-2" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-red-400"
                          onClick={() => setDeleteTarget(u)}
                          data-testid={`menu-delete-update-${u.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                {u.tags && u.tags.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap mt-2">
                    {u.tags.map(tag => (
                      <span key={tag} className="flex items-center gap-0.5 text-xs text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">
                        <Tag className="w-2.5 h-2.5" />{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create / Edit modal */}
      <Dialog open={modalOpen} onOpenChange={open => { if (!open) closeModal(); }}>
        <DialogContent className="max-w-lg" data-testid="modal-create-update">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Investor Update" : "Create Investor Update"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Title *</Label>
              <Input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Q2 2026 Monthly Update"
                data-testid="input-update-title"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Update Type</Label>
              <Select value={form.update_type} onValueChange={v => setForm(f => ({ ...f, update_type: v }))}>
                <SelectTrigger data-testid="select-update-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UPDATE_TYPES.map(t => (
                    <SelectItem key={t.label} value={t.label}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Subject Line</Label>
              <Input
                value={form.subject}
                onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                placeholder="VoltSafe — June 2026 Investor Update"
                data-testid="input-update-subject"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Body</Label>
              <Textarea
                value={form.body}
                onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                placeholder="Write your update here…"
                rows={5}
                className="resize-none text-sm"
                data-testid="textarea-update-body"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger data-testid="select-update-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Schedule Send (optional)</Label>
                <Input
                  type="datetime-local"
                  value={form.scheduled_at}
                  onChange={e => setForm(f => ({ ...f, scheduled_at: e.target.value }))}
                  className="text-xs"
                  data-testid="input-update-scheduled-at"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tags (comma-separated)</Label>
              <Input
                value={form.tags}
                onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
                placeholder="q2, fundraising, milestone"
                data-testid="input-update-tags"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeModal} data-testid="btn-cancel-update">Cancel</Button>
            <Button onClick={handleSubmit} disabled={isPending} data-testid="btn-submit-update">
              {isPending ? "Saving…" : editing ? "Save Changes" : "Create Update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <DialogContent data-testid="modal-delete-update">
          <DialogHeader>
            <DialogTitle>Delete update?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            "{deleteTarget?.title}" will be permanently deleted.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
              disabled={deleteMut.isPending}
              data-testid="btn-confirm-delete-update"
            >
              {deleteMut.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
