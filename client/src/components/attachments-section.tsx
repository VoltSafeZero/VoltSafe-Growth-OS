import { useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Paperclip, Upload, Trash2, FileImage, FileVideo, X } from "lucide-react";
import type { Attachment } from "@shared/schema";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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

interface AttachmentsSectionProps {
  objectType: string;
  objectId: number;
}

export function AttachmentsSection({ objectType, objectId }: AttachmentsSectionProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);

  const { data: attachmentsList = [], isLoading } = useQuery<Attachment[]>({
    queryKey: ["/api/attachments", objectType, objectId],
    queryFn: async () => {
      const res = await fetch(`/api/attachments?objectType=${objectType}&objectId=${objectId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load attachments");
      return res.json();
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("objectType", objectType);
      formData.append("objectId", String(objectId));
      const res = await fetch("/api/attachments", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attachments", objectType, objectId] });
      toast({ title: "File uploaded" });
    },
    onError: (err: Error) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/attachments/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attachments", objectType, objectId] });
      toast({ title: "File deleted" });
    },
    onError: () => {
      toast({ title: "Delete failed", variant: "destructive" });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const isImage = (mime: string) => mime.startsWith("image/");
  const isVideo = (mime: string) => mime.startsWith("video/");

  return (
    <div className="space-y-3" data-testid="section-attachments">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Paperclip className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Attachments</span>
          {attachmentsList.length > 0 && (
            <span className="text-xs text-muted-foreground">({attachmentsList.length})</span>
          )}
        </div>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={handleFileSelect}
            data-testid="input-file-upload"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
            data-testid="button-upload-file"
          >
            {uploadMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <Upload className="h-3.5 w-3.5 mr-1.5" />
            )}
            Upload
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="flex justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && attachmentsList.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-3">No attachments yet</p>
      )}

      {attachmentsList.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {attachmentsList.map((att) => (
            <div
              key={att.id}
              className="group relative rounded-lg border border-border/30 bg-card/50 overflow-hidden cursor-pointer"
              onClick={() => setPreviewAttachment(att)}
              data-testid={`attachment-${att.id}`}
            >
              <div className="aspect-square flex items-center justify-center bg-muted/20">
                {isImage(att.mimeType) ? (
                  <img
                    src={`/api/attachments/file/${att.fileName}`}
                    alt={att.originalName}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : isVideo(att.mimeType) ? (
                  <video
                    src={`/api/attachments/file/${att.fileName}`}
                    className="w-full h-full object-cover"
                    muted
                    preload="metadata"
                  />
                ) : (
                  <FileImage className="h-8 w-8 text-muted-foreground" />
                )}
              </div>
              <div className="p-1.5">
                <p className="text-[10px] font-medium truncate">{att.originalName}</p>
                <p className="text-[9px] text-muted-foreground">
                  {formatFileSize(att.fileSize)} · {timeAgo(att.createdAt)}
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteMutation.mutate(att.id);
                }}
                className="absolute top-1 right-1 p-1 rounded-md bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                data-testid={`button-delete-attachment-${att.id}`}
                title="Delete"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {previewAttachment && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80"
          onClick={() => setPreviewAttachment(null)}
          data-testid="attachment-preview-overlay"
        >
          <button
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white transition-colors"
            onClick={() => setPreviewAttachment(null)}
            data-testid="button-close-preview"
          >
            <X className="h-5 w-5" />
          </button>
          <div
            className="max-w-[90vw] max-h-[90vh] flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {isImage(previewAttachment.mimeType) ? (
              <img
                src={`/api/attachments/file/${previewAttachment.fileName}`}
                alt={previewAttachment.originalName}
                className="max-w-full max-h-[85vh] rounded-lg object-contain"
              />
            ) : isVideo(previewAttachment.mimeType) ? (
              <video
                src={`/api/attachments/file/${previewAttachment.fileName}`}
                controls
                autoPlay
                className="max-w-full max-h-[85vh] rounded-lg"
              />
            ) : null}
          </div>
          <p className="absolute bottom-4 text-sm text-white/70">
            {previewAttachment.originalName}
          </p>
        </div>
      )}
    </div>
  );
}
