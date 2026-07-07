// client/src/components/today/ceo-one-on-ones.tsx
// CEO Cockpit Phase 5 — 1:1 Notes, Commitment Extraction, and Update Drafts
// Admin-only. No keystroke tracking, no shaming language, no auto-send.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Calendar, Plus, FileText, Zap, Check, Copy, ExternalLink,
  ChevronDown, ChevronRight, AlertCircle, Loader2, Trash2,
} from "lucide-react";
import { Link } from "wouter";
import type { OneOnOneItem } from "./ceo-cockpit-sections";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OneOnOneNote {
  id: number;
  uuid: string;
  title: string | null;
  meetingDate: string | null;
  notesText: string | null;
  decisionsText: string | null;
  actionItemsText: string | null;
  sections: {
    wins: string | null;
    blockers: string | null;
    priorities: string | null;
    supportNeeded: string | null;
  };
  actionItemCount: number;
  createdAt: string;
  updatedAt: string;
}

interface AgendaItem {
  id?: string | number;
  text: string;
  source: string;
  priority?: string | null;
  dueDate?: string | null;
  staleDays?: number;
}

interface OneOnOneAgenda {
  teamMemberId: number;
  teamMemberName: string;
  openCommitments: AgendaItem[];
  overdueTasks: AgendaItem[];
  blockers: AgendaItem[];
  staleWork: AgendaItem[];
  recentWins: AgendaItem[];
  priorActionItems: AgendaItem[];
  suggestedQuestions: string[];
  generated_at: string;
}

interface CommitmentCandidate {
  title: string;
  ownerUserId: number | null;
  ownerName: string | null;
  dueDate: string | null;
  sourceQuote: string;
  confidence: number;
  suggestedPriority: string;
  needsReview: true;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(s: string | null | undefined): string {
  if (!s) return "";
  try { return new Date(s).toLocaleDateString("en-CA", { month: "short", day: "numeric" }); } catch { return ""; }
}

function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "";
  try { return new Date(s).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }); } catch { return ""; }
}

// ── Agenda Tab ────────────────────────────────────────────────────────────────

function AgendaSection({ label, items, emptyText, icon: Icon }: {
  label: string; items: AgendaItem[]; emptyText?: string; icon?: any;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-border/30 rounded-md overflow-hidden" data-testid={`agenda-section-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <button
        className="w-full flex items-center justify-between px-3 py-2 bg-card/50 hover:bg-card/80 text-left"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
          {Icon && <Icon className="h-3 w-3 text-muted-foreground" />}
          {label}
          {items.length > 0 && <Badge variant="secondary" className="h-4 px-1 text-[9px]">{items.length}</Badge>}
        </span>
        {open ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-3 py-2 space-y-1.5">
          {items.length === 0 ? (
            <p className="text-[11px] text-muted-foreground italic">{emptyText ?? "None"}</p>
          ) : (
            items.map((item, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px]">
                <span className="text-muted-foreground mt-0.5 flex-shrink-0">·</span>
                <div className="min-w-0">
                  <span className="text-foreground/90">{item.text}</span>
                  <span className="ml-1.5 text-muted-foreground/60">— {item.source}</span>
                  {item.staleDays && item.staleDays > 0 && (
                    <span className="ml-1 text-amber-400">({item.staleDays}d stale)</span>
                  )}
                  {item.dueDate && (
                    <span className="ml-1 text-muted-foreground/50">due {fmtDate(item.dueDate)}</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function AgendaTab({ teamMemberId }: { teamMemberId: number }) {
  const query = useQuery<OneOnOneAgenda>({
    queryKey: ["/api/today/ceo-cockpit/one-on-ones", teamMemberId, "agenda"],
    staleTime: 2 * 60 * 1000,
  });

  if (query.isLoading) return (
    <div className="flex items-center justify-center py-8" data-testid="agenda-loading">
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
    </div>
  );
  if (query.isError) return (
    <div className="py-4 text-center" data-testid="agenda-error">
      <AlertCircle className="h-4 w-4 text-destructive mx-auto mb-1" />
      <p className="text-xs text-muted-foreground">Failed to load agenda</p>
    </div>
  );
  const a = query.data!;
  return (
    <div className="space-y-2 py-2" data-testid="agenda-view">
      {a.openCommitments.length > 0 && (
        <AgendaSection label="Open Commitments" items={a.openCommitments} emptyText="No open commitments" />
      )}
      {a.overdueTasks.length > 0 && (
        <AgendaSection label="Overdue Tasks" items={a.overdueTasks} emptyText="No overdue tasks" />
      )}
      {a.blockers.length > 0 && (
        <AgendaSection label="Blockers" items={a.blockers} emptyText="No blockers" />
      )}
      {a.staleWork.length > 0 && (
        <AgendaSection label="No Recent Update" items={a.staleWork} emptyText="All items have recent activity" />
      )}
      {a.recentWins.length > 0 && (
        <AgendaSection label="Recent Wins" items={a.recentWins} emptyText="No recent completions" />
      )}
      {a.priorActionItems.length > 0 && (
        <AgendaSection label="Prior 1:1 Action Items" items={a.priorActionItems} emptyText="None" />
      )}
      <div className="border border-border/30 rounded-md overflow-hidden" data-testid="suggested-questions-section">
        <div className="px-3 py-2 bg-card/50">
          <p className="text-xs font-semibold text-foreground/80">Suggested Questions</p>
        </div>
        <div className="px-3 py-2 space-y-1.5">
          {a.suggestedQuestions.map((q, i) => (
            <p key={i} className="text-[11px] text-foreground/80">· {q}</p>
          ))}
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground/50 text-right">
        Generated {fmtDateTime(a.generated_at)}
      </p>
    </div>
  );
}

// ── Note Editor Sheet ─────────────────────────────────────────────────────────

interface NoteEditorProps {
  teamMemberId: number;
  teamMemberName: string;
  existingNote?: OneOnOneNote | null;
  onClose: () => void;
  onSaved: (noteId: number) => void;
}

function NoteEditorSheet({ teamMemberId, teamMemberName, existingNote, onClose, onSaved }: NoteEditorProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const isEdit = !!existingNote;

  const [title, setTitle] = useState(existingNote?.title ?? "");
  const [meetingDate, setMeetingDate] = useState(
    existingNote?.meetingDate ? existingNote.meetingDate.slice(0, 10) : new Date().toISOString().slice(0, 10)
  );
  const [wins, setWins] = useState(existingNote?.sections.wins ?? "");
  const [blockers, setBlockers] = useState(existingNote?.sections.blockers ?? "");
  const [priorities, setPriorities] = useState(existingNote?.sections.priorities ?? "");
  const [supportNeeded, setSupportNeeded] = useState(existingNote?.sections.supportNeeded ?? "");
  const [decisions, setDecisions] = useState(existingNote?.decisionsText ?? "");
  const [followups, setFollowups] = useState(existingNote?.actionItemsText ?? "");
  const [notes, setNotes] = useState(existingNote?.notesText ?? "");

  const createMut = useMutation({
    mutationFn: (body: object) => apiRequest("POST", `/api/today/ceo-cockpit/one-on-ones/${teamMemberId}/notes`, body),
    onSuccess: async (res: any) => {
      await qc.invalidateQueries({ queryKey: ["/api/today/ceo-cockpit/one-on-ones", teamMemberId, "notes"] });
      toast({ title: "1:1 note saved" });
      onSaved(res.id);
    },
    onError: () => toast({ title: "Failed to save note", variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: (body: object) => apiRequest("PATCH", `/api/today/ceo-cockpit/one-on-ones/notes/${existingNote!.id}`, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["/api/today/ceo-cockpit/one-on-ones", teamMemberId, "notes"] });
      toast({ title: "Note updated" });
      onClose();
    },
    onError: () => toast({ title: "Failed to update note", variant: "destructive" }),
  });

  function handleSubmit() {
    const body = { title: title || `1:1 — ${teamMemberName}`, meetingDate, wins, blockers, priorities, supportNeeded, decisionsText: decisions, actionItemsText: followups, notesText: notes };
    if (isEdit) updateMut.mutate(body);
    else createMut.mutate(body);
  }

  const isPending = createMut.isPending || updateMut.isPending;

  return (
    <div className="space-y-4 py-1" data-testid="note-editor-form">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground">Meeting Date</label>
          <Input type="date" value={meetingDate} onChange={e => setMeetingDate(e.target.value)}
            className="h-7 text-xs" data-testid="note-editor-date" />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground">Title (optional)</label>
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder={`1:1 — ${teamMemberName}`}
            className="h-7 text-xs" data-testid="note-editor-title" />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-[11px] font-semibold text-emerald-400">Wins / Progress</label>
        <Textarea value={wins} onChange={e => setWins(e.target.value)} rows={2}
          placeholder="What changed since last 1:1? What went well?"
          className="text-xs resize-none" data-testid="note-editor-wins" />
      </div>

      <div className="space-y-1">
        <label className="text-[11px] font-semibold text-amber-400">Blockers</label>
        <Textarea value={blockers} onChange={e => setBlockers(e.target.value)} rows={2}
          placeholder="What is blocked? What obstacles need removing?"
          className="text-xs resize-none" data-testid="note-editor-blockers" />
      </div>

      <div className="space-y-1">
        <label className="text-[11px] font-semibold text-primary">Priorities</label>
        <Textarea value={priorities} onChange={e => setPriorities(e.target.value)} rows={2}
          placeholder="What are the top priorities for the next period?"
          className="text-xs resize-none" data-testid="note-editor-priorities" />
      </div>

      <div className="space-y-1">
        <label className="text-[11px] font-semibold text-foreground/70">Support Needed from CEO</label>
        <Textarea value={supportNeeded} onChange={e => setSupportNeeded(e.target.value)} rows={2}
          placeholder="What decision does Trevor need to make? What support is needed?"
          className="text-xs resize-none" data-testid="note-editor-support-needed" />
      </div>

      <div className="space-y-1">
        <label className="text-[11px] font-semibold text-foreground/70">Decisions Made</label>
        <Textarea value={decisions} onChange={e => setDecisions(e.target.value)} rows={2}
          placeholder="Decisions made during this meeting"
          className="text-xs resize-none" data-testid="note-editor-decisions" />
      </div>

      <div className="space-y-1">
        <label className="text-[11px] font-semibold text-foreground/70">Follow-ups / Commitments</label>
        <Textarea value={followups} onChange={e => setFollowups(e.target.value)} rows={3}
          placeholder="What commitment should be tracked? Use lines starting with '- [ ]' or 'I will…' for easy extraction later."
          className="text-xs resize-none" data-testid="note-editor-followups" />
      </div>

      <div className="space-y-1">
        <label className="text-[11px] font-medium text-muted-foreground">Notes (freeform)</label>
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
          placeholder="Additional notes from the meeting"
          className="text-xs resize-none" data-testid="note-editor-notes" />
      </div>

      <div className="flex gap-2 pt-1">
        <Button onClick={handleSubmit} disabled={isPending} size="sm" className="flex-1" data-testid="note-editor-save">
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Check className="h-3.5 w-3.5 mr-1" />}
          {isEdit ? "Update Note" : "Save Note"}
        </Button>
        <Button onClick={onClose} variant="outline" size="sm" disabled={isPending} data-testid="note-editor-cancel">
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ── Commitment Candidate Review ───────────────────────────────────────────────

interface CommitmentReviewProps {
  noteId: number;
  teamMemberId: number;
  candidates: CommitmentCandidate[];
  warnings: string[];
  onDone: () => void;
}

function CommitmentCandidateReview({ noteId, teamMemberId, candidates, warnings, onDone }: CommitmentReviewProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<number>>(new Set(candidates.map((_, i) => i)));

  const createMut = useMutation({
    mutationFn: (body: object) => apiRequest("POST", `/api/today/ceo-cockpit/one-on-ones/notes/${noteId}/commitments`, body),
    onSuccess: async (res: any) => {
      await qc.invalidateQueries({ queryKey: ["/api/today/ceo-cockpit/one-on-ones", teamMemberId, "notes"] });
      await qc.invalidateQueries({ queryKey: ["/api/today/ceo-cockpit"] });
      toast({ title: `${res.createdIds?.length ?? 0} tasks created from commitments` });
      onDone();
    },
    onError: () => toast({ title: "Failed to create tasks", variant: "destructive" }),
  });

  function handleCreate() {
    const commitments = candidates
      .filter((_, i) => selected.has(i))
      .filter(c => c.ownerUserId)
      .map(c => ({
        title: c.title,
        ownerUserId: c.ownerUserId!,
        dueDate: c.dueDate,
        priority: c.suggestedPriority,
        sourceQuote: c.sourceQuote,
      }));
    if (commitments.length === 0) {
      toast({ title: "Select at least one commitment with an owner assigned", variant: "destructive" });
      return;
    }
    createMut.mutate({ commitments });
  }

  return (
    <div className="space-y-3" data-testid="commitment-candidate-review">
      {warnings.map((w, i) => (
        <div key={i} className="flex items-start gap-2 text-[11px] text-amber-400 bg-amber-400/10 rounded px-2 py-1.5">
          <AlertCircle className="h-3 w-3 flex-shrink-0 mt-0.5" />
          {w}
        </div>
      ))}
      {candidates.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">No commitment patterns found in note text.</p>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground">
            Review and select the commitments to create as tasks. All items require your review before creation.
          </p>
          <div className="space-y-2">
            {candidates.map((c, i) => (
              <div
                key={i}
                className="flex items-start gap-2.5 p-2.5 rounded border border-border/30 bg-card/30"
                data-testid={`commitment-candidate-${i}`}
              >
                <Checkbox
                  id={`cand-${i}`}
                  checked={selected.has(i)}
                  onCheckedChange={v => {
                    const ns = new Set(selected);
                    v ? ns.add(i) : ns.delete(i);
                    setSelected(ns);
                  }}
                  data-testid={`commitment-candidate-checkbox-${i}`}
                />
                <div className="min-w-0 flex-1">
                  <label htmlFor={`cand-${i}`} className="text-xs font-medium cursor-pointer">{c.title}</label>
                  {c.sourceQuote && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 italic truncate">"{c.sourceQuote}"</p>
                  )}
                  <div className="flex gap-2 mt-1 flex-wrap">
                    {c.ownerName && <Badge variant="outline" className="text-[9px] h-4 px-1">{c.ownerName}</Badge>}
                    {!c.ownerUserId && <Badge variant="destructive" className="text-[9px] h-4 px-1">No owner — skip</Badge>}
                    <Badge variant="secondary" className="text-[9px] h-4 px-1">
                      {Math.round(c.confidence * 100)}% confidence
                    </Badge>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              onClick={handleCreate}
              disabled={createMut.isPending || selected.size === 0}
              size="sm" className="flex-1"
              data-testid="commitment-create-tasks-btn"
            >
              {createMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Check className="h-3.5 w-3.5 mr-1" />}
              Create {selected.size} Task{selected.size !== 1 ? "s" : ""}
            </Button>
            <Button onClick={onDone} variant="outline" size="sm" data-testid="commitment-cancel-btn">Cancel</Button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Update Draft Sheet ─────────────────────────────────────────────────────────

interface UpdateDraftSheetProps {
  targetUserId: number;
  targetName: string;
  sourceType: string;
  sourceId?: string | number;
  isOpen: boolean;
  onClose: () => void;
}

export function UpdateDraftSheet({ targetUserId, targetName, sourceType, sourceId, isOpen, onClose }: UpdateDraftSheetProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const draftQuery = useQuery<{ draftText: string; dmConversationId: number | null; currentsLink: string | null }>({
    queryKey: ["/api/today/ceo-cockpit/update-draft", targetUserId, sourceType],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/today/ceo-cockpit/update-draft", {
        target_user_id: targetUserId,
        source_type: sourceType,
        source_id: sourceId,
      });
      return res;
    },
    enabled: isOpen,
    staleTime: 60000,
  });

  async function handleCopy() {
    const text = draftQuery.data?.draftText ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({ title: "Draft copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed — please select and copy manually", variant: "destructive" });
    }
  }

  return (
    <Sheet open={isOpen} onOpenChange={v => !v && onClose()}>
      <SheetContent side="right" className="w-96 max-w-full" data-testid="update-draft-sheet">
        <SheetHeader>
          <SheetTitle className="text-sm">Ask for Update — {targetName}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          <p className="text-[11px] text-muted-foreground">
            Review and edit the message below, then copy it to paste into Currents. Nothing is sent automatically.
          </p>
          {draftQuery.isLoading ? (
            <div className="flex items-center gap-2 py-4"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-xs">Preparing draft…</span></div>
          ) : draftQuery.isError ? (
            <p className="text-xs text-destructive">Failed to prepare draft</p>
          ) : (
            <Textarea
              defaultValue={draftQuery.data?.draftText}
              rows={5}
              className="text-xs resize-none"
              data-testid="update-draft-text"
            />
          )}
          <div className="flex gap-2">
            <Button onClick={handleCopy} size="sm" className="flex-1" data-testid="update-draft-copy-btn"
              disabled={!draftQuery.data}>
              {copied ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
              {copied ? "Copied!" : "Copy to Clipboard"}
            </Button>
            {draftQuery.data?.currentsLink && (
              <Link href={draftQuery.data.currentsLink}>
                <Button size="sm" variant="outline" data-testid="update-draft-open-currents">
                  <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open DM
                </Button>
              </Link>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground/60">
            This will not be sent automatically. You must paste and send it yourself in Currents.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Prior Notes List ─────────────────────────────────────────────────────────

interface PriorNotesListProps {
  teamMemberId: number;
  onEditNote: (note: OneOnOneNote) => void;
  onExtract: (noteId: number) => void;
}

function PriorNotesList({ teamMemberId, onEditNote, onExtract }: PriorNotesListProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const notesQuery = useQuery<{ notes: OneOnOneNote[] }>({
    queryKey: ["/api/today/ceo-cockpit/one-on-ones", teamMemberId, "notes"],
    staleTime: 60000,
  });

  const deleteMut = useMutation({
    mutationFn: (noteId: number) => apiRequest("DELETE", `/api/today/ceo-cockpit/one-on-ones/notes/${noteId}`, {}),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["/api/today/ceo-cockpit/one-on-ones", teamMemberId, "notes"] });
      toast({ title: "Note deleted" });
    },
    onError: () => toast({ title: "Failed to delete note", variant: "destructive" }),
  });

  if (notesQuery.isLoading) return (
    <div className="flex justify-center py-6" data-testid="prior-notes-loading">
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
    </div>
  );
  if (notesQuery.isError) return (
    <p className="text-xs text-destructive py-4 text-center" data-testid="prior-notes-error">Failed to load notes</p>
  );

  const notes = notesQuery.data?.notes ?? [];
  return (
    <div className="space-y-2 py-2" data-testid="prior-notes-list">
      {notes.length === 0 ? (
        <div className="text-center py-6" data-testid="prior-notes-empty">
          <FileText className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">No 1:1 notes yet.</p>
          <p className="text-[11px] text-muted-foreground/60 mt-0.5">Add a note from the Notes tab.</p>
        </div>
      ) : (
        notes.map(note => {
          const isExpanded = expandedId === note.id;
          return (
            <div key={note.id} className="border border-border/30 rounded-md overflow-hidden"
              data-testid={`prior-note-${note.id}`}>
              <button
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-card/50 text-left"
                onClick={() => setExpandedId(isExpanded ? null : note.id)}
                data-testid={`prior-note-expand-${note.id}`}
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{note.title || "1:1 Note"}</p>
                  <p className="text-[10px] text-muted-foreground">{fmtDateTime(note.meetingDate || note.createdAt)}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {note.actionItemCount > 0 && (
                    <Badge variant="secondary" className="text-[9px] h-4 px-1">{note.actionItemCount} items</Badge>
                  )}
                  {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                </div>
              </button>
              {isExpanded && (
                <div className="border-t border-border/30 px-3 py-2.5 bg-card/20 space-y-2.5">
                  {note.sections.wins && (
                    <div>
                      <p className="text-[10px] font-semibold text-emerald-400 mb-0.5">Wins</p>
                      <p className="text-[11px] text-foreground/80 whitespace-pre-wrap">{note.sections.wins}</p>
                    </div>
                  )}
                  {note.sections.blockers && (
                    <div>
                      <p className="text-[10px] font-semibold text-amber-400 mb-0.5">Blockers</p>
                      <p className="text-[11px] text-foreground/80 whitespace-pre-wrap">{note.sections.blockers}</p>
                    </div>
                  )}
                  {note.sections.priorities && (
                    <div>
                      <p className="text-[10px] font-semibold text-primary mb-0.5">Priorities</p>
                      <p className="text-[11px] text-foreground/80 whitespace-pre-wrap">{note.sections.priorities}</p>
                    </div>
                  )}
                  {note.sections.supportNeeded && (
                    <div>
                      <p className="text-[10px] font-semibold text-foreground/70 mb-0.5">Support Needed</p>
                      <p className="text-[11px] text-foreground/80 whitespace-pre-wrap">{note.sections.supportNeeded}</p>
                    </div>
                  )}
                  {note.decisionsText && (
                    <div>
                      <p className="text-[10px] font-semibold text-foreground/70 mb-0.5">Decisions</p>
                      <p className="text-[11px] text-foreground/80 whitespace-pre-wrap">{note.decisionsText}</p>
                    </div>
                  )}
                  {note.actionItemsText && (
                    <div>
                      <p className="text-[10px] font-semibold text-foreground/70 mb-0.5">Follow-ups</p>
                      <p className="text-[11px] text-foreground/80 whitespace-pre-wrap">{note.actionItemsText}</p>
                    </div>
                  )}
                  {note.notesText && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground mb-0.5">Notes</p>
                      <p className="text-[11px] text-foreground/70 whitespace-pre-wrap">{note.notesText}</p>
                    </div>
                  )}
                  <div className="flex gap-1.5 pt-1 flex-wrap">
                    <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1"
                      onClick={() => onEditNote(note)} data-testid={`prior-note-edit-${note.id}`}>
                      Edit
                    </Button>
                    <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1"
                      onClick={() => onExtract(note.id)} data-testid={`prior-note-extract-${note.id}`}>
                      <Zap className="h-2.5 w-2.5" /> Extract Commitments
                    </Button>
                    <Button
                      size="sm" variant="ghost"
                      className="h-6 text-[10px] gap-1 text-destructive hover:text-destructive"
                      onClick={() => deleteMut.mutate(note.id)}
                      disabled={deleteMut.isPending}
                      data-testid={`prior-note-delete-${note.id}`}
                    >
                      <Trash2 className="h-2.5 w-2.5" /> Delete
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// ── Notes Tab ─────────────────────────────────────────────────────────────────

interface NotesTabProps {
  teamMemberId: number;
  teamMemberName: string;
}

function NotesTab({ teamMemberId, teamMemberName }: NotesTabProps) {
  const [showEditor, setShowEditor] = useState(false);
  const [editingNote, setEditingNote] = useState<OneOnOneNote | null>(null);
  const [extractNoteId, setExtractNoteId] = useState<number | null>(null);
  const [extractResult, setExtractResult] = useState<{ candidates: CommitmentCandidate[]; warnings: string[] } | null>(null);
  const [extractLoading, setExtractLoading] = useState(false);
  const { toast } = useToast();

  async function handleExtract(noteId: number) {
    setExtractNoteId(noteId);
    setExtractLoading(true);
    setExtractResult(null);
    try {
      const res = await apiRequest("POST", `/api/today/ceo-cockpit/one-on-ones/notes/${noteId}/extract-commitments`, {});
      setExtractResult(res);
    } catch {
      toast({ title: "Extraction failed", variant: "destructive" });
      setExtractNoteId(null);
    } finally {
      setExtractLoading(false);
    }
  }

  if (extractNoteId && (extractResult || extractLoading)) {
    return (
      <div className="py-2 space-y-3" data-testid="extraction-view">
        <div className="flex items-center gap-2">
          <button className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => { setExtractNoteId(null); setExtractResult(null); }}>
            ← Back to Notes
          </button>
          <span className="text-[11px] text-muted-foreground">/ Extract Commitments</span>
        </div>
        {extractLoading ? (
          <div className="flex items-center gap-2 py-4"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-xs">Extracting commitments…</span></div>
        ) : extractResult ? (
          <CommitmentCandidateReview
            noteId={extractNoteId}
            teamMemberId={teamMemberId}
            candidates={extractResult.candidates}
            warnings={extractResult.warnings}
            onDone={() => { setExtractNoteId(null); setExtractResult(null); }}
          />
        ) : null}
      </div>
    );
  }

  if (showEditor) {
    return (
      <div className="py-2" data-testid="notes-editor-view">
        <button className="text-[11px] text-muted-foreground hover:text-foreground mb-3"
          onClick={() => { setShowEditor(false); setEditingNote(null); }}>
          ← Back to Notes
        </button>
        <NoteEditorSheet
          teamMemberId={teamMemberId}
          teamMemberName={teamMemberName}
          existingNote={editingNote}
          onClose={() => { setShowEditor(false); setEditingNote(null); }}
          onSaved={() => { setShowEditor(false); setEditingNote(null); }}
        />
      </div>
    );
  }

  return (
    <div className="py-2" data-testid="notes-list-view">
      <Button
        size="sm" variant="outline" className="w-full h-7 text-[11px] gap-1.5 mb-3"
        onClick={() => { setEditingNote(null); setShowEditor(true); }}
        data-testid="add-one-on-one-note-btn"
      >
        <Plus className="h-3 w-3" /> Add 1:1 Note
      </Button>
      <PriorNotesList
        teamMemberId={teamMemberId}
        onEditNote={note => { setEditingNote(note); setShowEditor(true); }}
        onExtract={handleExtract}
      />
    </div>
  );
}

// ── Main Drawer ────────────────────────────────────────────────────────────────

export interface OneOnOneDrawerProps {
  item: OneOnOneItem;
  isOpen: boolean;
  onClose: () => void;
}

export function OneOnOneDrawer({ item, isOpen, onClose }: OneOnOneDrawerProps) {
  const [tab, setTab] = useState<string>("agenda");
  const [showUpdateDraft, setShowUpdateDraft] = useState(false);

  return (
    <>
      <Sheet open={isOpen} onOpenChange={v => !v && onClose()}>
        <SheetContent side="right" className="w-[480px] max-w-full overflow-y-auto" data-testid="one-on-one-drawer">
          <SheetHeader className="pb-2">
            <SheetTitle className="text-sm flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              1:1 — {item.userName}
            </SheetTitle>
            <div className="flex items-center gap-2 pt-1">
              {item.nextScheduled && (
                <Badge variant="outline" className="text-[10px] h-5">
                  Next: {fmtDate(item.nextScheduled)}
                </Badge>
              )}
              {item.overdueCommitments > 0 && (
                <Badge variant="destructive" className="text-[10px] h-5">
                  {item.overdueCommitments} overdue
                </Badge>
              )}
              <Button
                size="sm" variant="ghost" className="h-5 text-[10px] gap-1 ml-auto"
                onClick={() => setShowUpdateDraft(true)}
                data-testid={`open-update-draft-${item.userId}`}
              >
                <Copy className="h-2.5 w-2.5" /> Ask for Update
              </Button>
            </div>
          </SheetHeader>

          <Tabs value={tab} onValueChange={setTab} className="mt-3">
            <TabsList className="h-7 text-[11px] w-full">
              <TabsTrigger value="agenda" className="flex-1 h-6 text-[11px]" data-testid="tab-agenda">
                Agenda
              </TabsTrigger>
              <TabsTrigger value="notes" className="flex-1 h-6 text-[11px]" data-testid="tab-notes">
                Notes
              </TabsTrigger>
            </TabsList>

            <TabsContent value="agenda" className="mt-0">
              <AgendaTab teamMemberId={item.userId} />
            </TabsContent>

            <TabsContent value="notes" className="mt-0">
              <NotesTab teamMemberId={item.userId} teamMemberName={item.userName} />
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>

      {showUpdateDraft && (
        <UpdateDraftSheet
          targetUserId={item.userId}
          targetName={item.userName}
          sourceType="team_pulse"
          isOpen={showUpdateDraft}
          onClose={() => setShowUpdateDraft(false)}
        />
      )}
    </>
  );
}
