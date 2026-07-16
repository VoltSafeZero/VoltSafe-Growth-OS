import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { MentionInput, renderMentionBody } from "@/components/shared/mention-input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, MessageSquare, Send } from "lucide-react";
import type { Comment } from "@shared/schema";

function timeAgo(dateStr: string | Date): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function CommentsFeed({
  objectType,
  objectId,
}: {
  objectType: string;
  objectId: number;
}) {
  const { toast } = useToast();
  const [newComment, setNewComment] = useState("");

  const { data: comments = [], isLoading } = useQuery<Comment[]>({
    queryKey: ["/api/comments", { objectType, objectId }],
    queryFn: async () => {
      const res = await fetch(
        `/api/comments?objectType=${objectType}&objectId=${objectId}`,
        { credentials: "include" }
      );
      return res.json();
    },
  });

  const postMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiRequest("POST", "/api/comments", {
        objectType,
        objectId,
        content,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/comments", { objectType, objectId }],
      });
      setNewComment("");
    },
    onError: () => {
      toast({ title: "Failed to post comment", variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    postMutation.mutate(newComment.trim());
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">
          Comments{" "}
          {comments.length > 0 && (
            <span className="text-muted-foreground">({comments.length})</span>
          )}
        </span>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <MentionInput
          value={newComment}
          onChange={setNewComment}
          placeholder="Add a comment… type @ to mention"
          rows={2}
          data-testid="input-comment"
          onSubmit={() => { if (newComment.trim()) postMutation.mutate(newComment.trim()); }}
        />
        <Button
          type="submit"
          size="sm"
          disabled={!newComment.trim() || postMutation.isPending}
          className="self-end"
          data-testid="button-post-comment"
        >
          {postMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </form>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-4 text-center">
          Loading comments...
        </div>
      ) : comments.length === 0 ? (
        <div className="text-sm text-muted-foreground py-4 text-center border border-dashed border-border/50 rounded-lg">
          No comments yet. Be the first to add one.
        </div>
      ) : (
        <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
          {comments.map((comment) => (
            <div
              key={comment.id}
              className="flex gap-3"
              data-testid={`comment-${comment.id}`}
            >
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-medium text-primary">
                {getInitials(comment.userName)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {comment.userName}
                  </span>
                  <span
                    className="text-xs text-muted-foreground"
                    title={new Date(comment.createdAt).toLocaleString()}
                  >
                    {timeAgo(comment.createdAt)}
                  </span>
                </div>
                <p className="text-sm text-foreground/80 whitespace-pre-wrap mt-0.5">
                  {renderMentionBody(comment.content)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
