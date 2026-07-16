import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { MentionInput, renderMentionBody } from "@/components/shared/mention-input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { MessageSquarePlus, Trash2, Pencil, Check, X, Pin, PinOff, StickyNote } from "lucide-react";
import type { Note } from "@shared/schema";

interface NotesPanelProps {
  linkedObjectType: string;
  linkedObjectId: number;
  compact?: boolean;
}

export function NotesPanel({ linkedObjectType, linkedObjectId, compact = false }: NotesPanelProps) {
  const [newContent, setNewContent] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const { toast } = useToast();

  const queryKey = ["/api/notes", linkedObjectType, linkedObjectId];

  const { data, isLoading } = useQuery<Note[]>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ linkedObjectType, linkedObjectId: String(linkedObjectId) });
      const res = await fetch(`/api/notes?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  const notes = data || [];
  const pinnedNotes = notes.filter(n => n.isPinned);
  const unpinnedNotes = notes.filter(n => !n.isPinned);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/notes", {
        linkedObjectType,
        linkedObjectId,
        content: newContent.trim(),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setNewContent("");
    },
    onError: () => toast({ title: "Failed to save note", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, content }: { id: number; content: string }) => {
      const res = await apiRequest("PUT", `/api/notes/${id}`, { content });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setEditingId(null);
    },
    onError: () => toast({ title: "Failed to update note", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/notes/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: () => toast({ title: "Failed to delete note", variant: "destructive" }),
  });

  const pinMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("PATCH", `/api/notes/${id}/pin`, {});
      return res.json() as Promise<{ ok: boolean; isPinned: boolean }>;
    },
    onMutate: async (id: number) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<Note[]>(queryKey);
      queryClient.setQueryData<Note[]>(queryKey, old =>
        old?.map(n => n.id === id ? { ...n, isPinned: !n.isPinned } : n) ?? []
      );
      return { prev };
    },
    onSuccess: (result) => {
      toast({
        title: result.isPinned ? "Note pinned" : "Note unpinned",
        description: result.isPinned ? "Note will appear in Key Facts" : "Note removed from Key Facts",
      });
    },
    onError: (_, __, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
      toast({ title: "Failed to pin note", variant: "destructive" });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const startEdit = (note: Note) => {
    setEditingId(note.id);
    setEditContent(note.content);
  };

  const renderNote = (note: Note) => (
    <div
      key={note.id}
      className={`rounded-lg border p-3 group transition-all ${
        note.isPinned
          ? "border-primary/40 bg-primary/8 ring-1 ring-primary/10"
          : "border-border/50 bg-muted/10 hover:border-border/80"
      }`}
      data-testid={`note-${note.id}`}
    >
      {editingId === note.id ? (
        <div className="space-y-2">
          <MentionInput
            value={editContent}
            onChange={setEditContent}
            rows={3}
            autoFocus
            data-testid={`input-edit-note-${note.id}`}
          />
          <div className="flex gap-1.5">
            <Button
              size="sm"
              className="h-6 text-xs"
              disabled={!editContent.trim() || updateMutation.isPending}
              onClick={() => updateMutation.mutate({ id: note.id, content: editContent })}
              data-testid={`button-save-note-${note.id}`}
            >
              <Check className="h-3 w-3 mr-1" /> Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => setEditingId(null)}
              data-testid={`button-cancel-edit-note-${note.id}`}
            >
              <X className="h-3 w-3 mr-1" /> Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{renderMentionBody(note.content)}</p>
          <div className="flex items-center justify-between mt-2.5">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">{note.authorName}</Badge>
              <span className="text-[10px] text-muted-foreground">
                {new Date(note.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                {note.updatedAt && note.updatedAt !== note.createdAt && " (edited)"}
              </span>
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="sm"
                className={`h-5 w-5 p-0 transition-colors ${
                  note.isPinned
                    ? "text-primary opacity-100"
                    : "text-muted-foreground hover:text-primary"
                }`}
                onClick={() => pinMutation.mutate(note.id)}
                disabled={pinMutation.isPending && pinMutation.variables === note.id}
                title={note.isPinned ? "Unpin note" : "Pin note"}
                data-testid={`button-pin-note-${note.id}`}
              >
                {note.isPinned ? <PinOff className="h-2.5 w-2.5" /> : <Pin className="h-2.5 w-2.5" />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => startEdit(note)}
                data-testid={`button-edit-note-${note.id}`}
              >
                <Pencil className="h-2.5 w-2.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => deleteMutation.mutate(note.id)}
                data-testid={`button-delete-note-${note.id}`}
              >
                <Trash2 className="h-2.5 w-2.5" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* New note input */}
      <div className="space-y-2">
        <MentionInput
          value={newContent}
          onChange={setNewContent}
          placeholder="Add a note… type @ to mention someone"
          rows={compact ? 2 : 3}
          data-testid="input-new-note"
          onSubmit={() => { if (newContent.trim()) createMutation.mutate(); }}
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">Cmd/Ctrl+Enter to submit</span>
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={!newContent.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
            data-testid="button-add-note"
          >
            <MessageSquarePlus className="h-3.5 w-3.5 mr-1" />
            {createMutation.isPending ? "Saving..." : "Add Note"}
          </Button>
        </div>
      </div>

      {/* Notes list */}
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : notes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <StickyNote className="w-8 h-8 text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">No notes yet</p>
          <p className="text-xs text-muted-foreground/60 mt-0.5">Notes you add will appear here</p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Pinned section */}
          {pinnedNotes.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 px-0.5">
                <Pin className="h-3 w-3 text-primary" />
                <span className="text-[10px] font-semibold text-primary uppercase tracking-widest">
                  Pinned · {pinnedNotes.length}
                </span>
              </div>
              {pinnedNotes.map(renderNote)}
            </div>
          )}

          {/* Divider between sections */}
          {pinnedNotes.length > 0 && unpinnedNotes.length > 0 && (
            <div className="flex items-center gap-2 py-0.5">
              <div className="flex-1 border-t border-border/30" />
              <span className="text-[9px] text-muted-foreground/40 uppercase tracking-widest">other notes</span>
              <div className="flex-1 border-t border-border/30" />
            </div>
          )}

          {/* Unpinned notes */}
          {unpinnedNotes.map(renderNote)}
        </div>
      )}
    </div>
  );
}
