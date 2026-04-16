import { useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Paperclip, Upload, Trash2, FileImage, FileVideo, X,
  File, FileText, Link2, Download, ExternalLink,
} from "lucide-react";
import type { Attachment } from "@shared/schema";
import { DOCUMENT_CATEGORIES } from "@/pages/documents";

function formatFileSize(bytes: number): string {
  if (!bytes) return "—";
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

function getMimeIcon(mimeType: string, source: string) {
  if (source === "link") return Link2;
  if (mimeType.startsWith("image/")) return FileImage;
  if (mimeType.startsWith("video/")) return FileVideo;
  if (mimeType === "application/pdf" || mimeType.includes("document") || mimeType.includes("word")) return FileText;
  return File;
}

function getCategoryMeta(key: string) {
  return DOCUMENT_CATEGORIES.find(c => c.key === key) ?? DOCUMENT_CATEGORIES[DOCUMENT_CATEGORIES.length - 1];
}

interface AttachmentsSectionProps {
  objectType: string;
  objectId: number;
}

function LinkDocumentModal({ open, onClose, objectType, objectId }: { open: boolean; onClose: () => void; objectType: string; objectId: number }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ url: "", title: "", category: "general", notes: "" });

  const linkMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/documents/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ url: form.url, title: form.title, category: form.category, notes: form.notes, objectType, objectId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? "Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attachments", objectType, objectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({ title: "Link added" });
      onClose();
      setForm({ url: "", title: "", category: "general", notes: "" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm" data-testid="modal-link-attachment">
        <DialogHeader><DialogTitle className="flex items-center gap-2 text-sm"><Link2 className="h-4 w-4" /> Link URL</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">URL *</Label>
            <Input className="h-8 text-xs" placeholder="https://…" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} data-testid="input-link-url" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Title</Label>
            <Input className="h-8 text-xs" placeholder="Display name" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} data-testid="input-link-title" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Category</Label>
            <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-link-category"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOCUMENT_CATEGORIES.filter(c => c.key !== "all").map(c => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs">Cancel</Button>
          <Button size="sm" disabled={!form.url || linkMutation.isPending} onClick={() => linkMutation.mutate()} className="text-xs" data-testid="button-confirm-link">
            {linkMutation.isPending ? "Saving…" : "Add Link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AttachmentsSection({ objectType, objectId }: AttachmentsSectionProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [uploadCategory, setUploadCategory] = useState("general");

  const { data: attachmentsList = [], isLoading } = useQuery<Attachment[]>({
    queryKey: ["/api/attachments", objectType, objectId],
    queryFn: async () => {
      const res = await fetch(`/api/attachments?objectType=${objectType}&objectId=${objectId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load attachments");
      return res.json();
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ file, category }: { file: File; category: string }) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("objectType", objectType);
      formData.append("objectId", String(objectId));
      formData.append("category", category);
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
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({ title: "Deleted" });
    },
    onError: () => {
      toast({ title: "Delete failed", variant: "destructive" });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate({ file, category: uploadCategory });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const isImage = (mime: string) => mime.startsWith("image/");
  const isVideo = (mime: string) => mime.startsWith("video/");

  return (
    <div className="space-y-3" data-testid="section-attachments">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Paperclip className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Documents</span>
          {attachmentsList.length > 0 && (
            <span className="text-xs text-muted-foreground">({attachmentsList.length})</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Select value={uploadCategory} onValueChange={setUploadCategory}>
            <SelectTrigger className="h-7 w-32 text-[11px]" data-testid="select-upload-category"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DOCUMENT_CATEGORIES.filter(c => c.key !== "all").map(c => <SelectItem key={c.key} value={c.key} className="text-xs">{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileSelect}
            data-testid="input-file-upload"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLinkOpen(true)}
            className="h-7 text-[11px] px-2"
            data-testid="button-link-url"
          >
            <Link2 className="h-3 w-3 mr-1" /> Link
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
            className="h-7 text-[11px] px-2"
            data-testid="button-upload-file"
          >
            {uploadMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <Upload className="h-3 w-3 mr-1" />
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
        <p className="text-xs text-muted-foreground text-center py-3">No documents yet</p>
      )}

      {attachmentsList.length > 0 && (
        <div className="space-y-1.5">
          {attachmentsList.map((att) => {
            const MimeIcon = getMimeIcon(att.mimeType, att.source ?? "upload");
            const catMeta = getCategoryMeta(att.category ?? "general");
            const CatIcon = catMeta.icon;
            const isImg = isImage(att.mimeType);
            const isVid = isVideo(att.mimeType);

            return (
              <div
                key={att.id}
                className="group flex items-center gap-2.5 p-2 rounded-lg border border-border/30 bg-card/30 hover:bg-muted/20 transition-colors"
                data-testid={`attachment-${att.id}`}
              >
                {/* Icon / thumbnail */}
                <div
                  className="w-8 h-8 rounded-md bg-muted/30 flex items-center justify-center shrink-0 cursor-pointer overflow-hidden"
                  onClick={() => (isImg || isVid) && setPreviewAttachment(att)}
                >
                  {isImg ? (
                    <img src={`/api/attachments/file/${att.fileName}`} alt={att.originalName} className="w-full h-full object-cover" loading="lazy" />
                  ) : isVid ? (
                    <video src={`/api/attachments/file/${att.fileName}`} className="w-full h-full object-cover" muted preload="metadata" />
                  ) : att.source === "link" ? (
                    <Link2 className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <MimeIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{att.title || att.originalName}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`inline-flex items-center gap-0.5 text-[9px] font-medium ${catMeta.color}`}>
                      <CatIcon className="h-2 w-2" />{catMeta.label}
                    </span>
                    {att.source !== "link" && (
                      <span className="text-[9px] text-muted-foreground/60">· {formatFileSize(att.fileSize)} · {timeAgo(att.createdAt)}</span>
                    )}
                    {att.source === "link" && (
                      <span className="text-[9px] text-muted-foreground/60">· {timeAgo(att.createdAt)}</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  {att.source === "link" && att.url ? (
                    <a href={att.url} target="_blank" rel="noopener noreferrer" className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors" title="Open link" data-testid={`button-open-link-${att.id}`}>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : att.source === "upload" && att.fileName ? (
                    <a href={`/api/attachments/file/${att.fileName}`} download={att.originalName} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors" title="Download" data-testid={`button-download-${att.id}`}>
                      <Download className="h-3 w-3" />
                    </a>
                  ) : null}
                  <button
                    onClick={() => deleteMutation.mutate(att.id)}
                    className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
                    title="Delete"
                    data-testid={`button-delete-attachment-${att.id}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Image/video preview lightbox */}
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

      <LinkDocumentModal open={linkOpen} onClose={() => setLinkOpen(false)} objectType={objectType} objectId={objectId} />
    </div>
  );
}
