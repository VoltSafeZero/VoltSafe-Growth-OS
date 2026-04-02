import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { MessageSquarePlus, Trash2, Pencil, Check, X } from "lucide-react";
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

  const startEdit = (note: Note) => {
    setEditingId(note.id);
    setEditContent(note.content);
  };

  return (
    <div className="space-y-3">
      {/* New note input */}
      <div className="space-y-2">
        <Textarea
          value={newContent}
          onChange={e => setNewContent(e.target.value)}
          placeholder="Add a note..."
          rows={compact ? 2 : 3}
          className="text-sm resize-none"
          data-testid="input-new-note"
          onKeyDown={e => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && newContent.trim()) {
              createMutation.mutate();
            }
          }}
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
        <p className="text-sm text-muted-foreground text-center py-4">No notes yet</p>
      ) : (
        <div className="space-y-2">
          {notes.map(note => (
            <div key={note.id} className="rounded-lg border border-border/50 bg-muted/10 p-3 group" data-testid={`note-${note.id}`}>
              {editingId === note.id ? (
                <div className="space-y-2">
                  <Textarea
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    rows={3}
                    className="text-sm resize-none"
                    data-testid={`input-edit-note-${note.id}`}
                    autoFocus
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
                  <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                  <div className="flex items-center justify-between mt-2">
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
          ))}
        </div>
      )}
    </div>
  );
}
