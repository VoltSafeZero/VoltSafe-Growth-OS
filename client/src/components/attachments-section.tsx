import { useRef, useState, useCallback, useEffect } from "react";
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
  File, FileText, Link2, Download, ExternalLink, CheckCircle2,
  AlertCircle, Music, Archive, Code2, FileSpreadsheet, FileType,
  FileCog,
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
  if (mimeType.startsWith("audio/")) return Music;
  if (mimeType === "application/pdf") return FileText;
  if (mimeType.includes("word") || mimeType.includes("document") || mimeType.includes("rtf") || mimeType.includes("opendocument.text")) return FileText;
  if (mimeType.includes("excel") || mimeType.includes("spreadsheet") || mimeType.includes("csv") || mimeType.includes("opendocument.spreadsheet")) return FileSpreadsheet;
  if (mimeType.includes("powerpoint") || mimeType.includes("presentation") || mimeType.includes("opendocument.presentation")) return FileType;
  if (mimeType.includes("zip") || mimeType.includes("tar") || mimeType.includes("gzip") || mimeType.includes("7z") || mimeType.includes("rar") || mimeType.includes("bzip")) return Archive;
  if (
    mimeType.startsWith("text/") ||
    mimeType.includes("javascript") || mimeType.includes("typescript") ||
    mimeType.includes("python") || mimeType.includes("json") ||
    mimeType.includes("xml") || mimeType.includes("php") ||
    mimeType.includes("java") || mimeType.includes("ruby") ||
    mimeType.includes("go") || mimeType.includes("rust") || mimeType.includes("sh")
  ) return Code2;
  if (mimeType.includes("octet-stream")) return FileCog;
  return File;
}

function getMimeIconColor(mimeType: string, source: string): string {
  if (source === "link") return "text-primary";
  if (mimeType.startsWith("image/")) return "text-violet-400";
  if (mimeType.startsWith("video/")) return "text-rose-400";
  if (mimeType.startsWith("audio/")) return "text-amber-400";
  if (mimeType === "application/pdf") return "text-red-400";
  if (mimeType.includes("word") || mimeType.includes("document") || mimeType.includes("rtf")) return "text-blue-400";
  if (mimeType.includes("excel") || mimeType.includes("spreadsheet") || mimeType.includes("csv")) return "text-emerald-400";
  if (mimeType.includes("powerpoint") || mimeType.includes("presentation")) return "text-orange-400";
  if (mimeType.includes("zip") || mimeType.includes("tar") || mimeType.includes("gz") || mimeType.includes("7z") || mimeType.includes("rar")) return "text-yellow-500";
  if (mimeType.startsWith("text/") || mimeType.includes("javascript") || mimeType.includes("json") || mimeType.includes("python")) return "text-teal-400";
  return "text-muted-foreground";
}

function getCategoryMeta(key: string) {
  return DOCUMENT_CATEGORIES.find(c => c.key === key) ?? DOCUMENT_CATEGORIES[DOCUMENT_CATEGORIES.length - 1];
}

interface UploadQueueItem {
  id: string;
  file: File;
  status: "uploading" | "done" | "error";
  error?: string;
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
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [uploadCategory, setUploadCategory] = useState("general");
  const [isDragging, setIsDragging] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const dragCounter = useRef(0);

  const { data: attachmentsList = [], isLoading } = useQuery<Attachment[]>({
    queryKey: ["/api/attachments", objectType, objectId],
    queryFn: async () => {
      const res = await fetch(`/api/attachments?objectType=${objectType}&objectId=${objectId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load attachments");
      return res.json();
    },
  });

  const uploadFile = useCallback(async (file: File, category: string): Promise<void> => {
    const queueId = crypto.randomUUID();
    setUploadQueue(q => [...q, { id: queueId, file, status: "uploading" }]);
    try {
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
      setUploadQueue(q => q.map(item => item.id === queueId ? { ...item, status: "done" } : item));
      queryClient.invalidateQueries({ queryKey: ["/api/attachments", objectType, objectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
    } catch (err: any) {
      setUploadQueue(q => q.map(item => item.id === queueId ? { ...item, status: "error", error: err.message } : item));
      toast({ title: `Failed: ${file.name}`, description: err.message, variant: "destructive" });
    }
  }, [objectType, objectId, toast]);

  const uploadFiles = useCallback((files: FileList | File[], category: string) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    arr.forEach(f => uploadFile(f, category));
    if (arr.length > 1) {
      toast({ title: `Uploading ${arr.length} files…` });
    }
  }, [uploadFile, toast]);

  // Clear "done" queue items after a short delay
  useEffect(() => {
    const done = uploadQueue.filter(q => q.status === "done");
    if (done.length === 0) return;
    const timer = setTimeout(() => {
      setUploadQueue(q => q.filter(item => item.status !== "done"));
    }, 2500);
    return () => clearTimeout(timer);
  }, [uploadQueue]);

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
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles(e.target.files, uploadCategory);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      uploadFiles(files, uploadCategory);
    }
  };

  const isImage = (mime: string) => mime.startsWith("image/");
  const isVideo = (mime: string) => mime.startsWith("video/");
  const isAudio = (mime: string) => mime.startsWith("audio/");

  const activeUploads = uploadQueue.filter(q => q.status === "uploading");
  const hasActivity = uploadQueue.length > 0;

  return (
    <div
      ref={dropZoneRef}
      className={`space-y-3 relative transition-colors rounded-xl ${isDragging ? "ring-2 ring-primary ring-offset-1 bg-primary/5" : ""}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      data-testid="section-attachments"
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-primary/60 bg-primary/8 pointer-events-none">
          <Upload className="h-8 w-8 text-primary mb-2" />
          <p className="text-sm font-semibold text-primary">Drop files here</p>
          <p className="text-xs text-primary/70 mt-0.5">Any file type · up to 100 MB each</p>
        </div>
      )}

      {/* Header toolbar */}
      <div className="flex items-center justify-between gap-2">
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
            multiple
            className="hidden"
            onChange={handleFileInputChange}
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
            disabled={activeUploads.length > 0}
            className="h-7 text-[11px] px-2"
            data-testid="button-upload-file"
          >
            {activeUploads.length > 0 ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <Upload className="h-3 w-3 mr-1" />
            )}
            Upload
          </Button>
        </div>
      </div>

      {/* Upload queue — in-progress and recently done */}
      {hasActivity && (
        <div className="space-y-1">
          {uploadQueue.map(item => (
            <div
              key={item.id}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs transition-colors ${
                item.status === "uploading" ? "border-primary/20 bg-primary/5" :
                item.status === "done" ? "border-emerald-500/20 bg-emerald-500/5" :
                "border-destructive/20 bg-destructive/5"
              }`}
            >
              {item.status === "uploading" && <Loader2 className="h-3 w-3 animate-spin text-primary flex-shrink-0" />}
              {item.status === "done" && <CheckCircle2 className="h-3 w-3 text-emerald-500 flex-shrink-0" />}
              {item.status === "error" && <AlertCircle className="h-3 w-3 text-destructive flex-shrink-0" />}
              <span className={`truncate flex-1 ${item.status === "error" ? "text-destructive" : "text-foreground/80"}`}>
                {item.file.name}
              </span>
              <span className="text-muted-foreground/60 flex-shrink-0">
                {item.status === "uploading" ? "Uploading…" :
                 item.status === "done" ? "Done" :
                 (item.error ?? "Failed")}
              </span>
              {item.status === "error" && (
                <button
                  onClick={() => setUploadQueue(q => q.filter(x => x.id !== item.id))}
                  className="text-muted-foreground hover:text-foreground flex-shrink-0"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty drop zone CTA */}
      {!isLoading && attachmentsList.length === 0 && uploadQueue.length === 0 && (
        <button
          className="w-full flex flex-col items-center gap-2 py-6 rounded-lg border border-dashed border-border/50 bg-muted/20 hover:bg-muted/40 hover:border-primary/30 transition-colors cursor-pointer group"
          onClick={() => fileInputRef.current?.click()}
          data-testid="drop-zone-empty"
        >
          <Upload className="h-5 w-5 text-muted-foreground/50 group-hover:text-primary/60 transition-colors" />
          <div className="text-center">
            <p className="text-xs font-medium text-muted-foreground/70 group-hover:text-foreground/70 transition-colors">
              Drop files here or click to upload
            </p>
            <p className="text-[10px] text-muted-foreground/40 mt-0.5">
              Images, videos, docs, spreadsheets, code, archives — any file type
            </p>
          </div>
        </button>
      )}

      {/* Attachment list */}
      {attachmentsList.length > 0 && (
        <div className="space-y-1.5">
          {attachmentsList.map((att) => {
            const MimeIcon = getMimeIcon(att.mimeType, att.source ?? "upload");
            const iconColor = getMimeIconColor(att.mimeType, att.source ?? "upload");
            const catMeta = getCategoryMeta(att.category ?? "general");
            const CatIcon = catMeta.icon;
            const isImg = isImage(att.mimeType);
            const isVid = isVideo(att.mimeType);
            const isAud = isAudio(att.mimeType);
            const clickable = isImg || isVid || isAud;

            return (
              <div
                key={att.id}
                className="group flex items-center gap-2.5 p-2 rounded-lg border border-border/30 bg-card/30 hover:bg-muted/20 transition-colors"
                data-testid={`attachment-${att.id}`}
              >
                {/* Icon / thumbnail */}
                <div
                  className={`w-8 h-8 rounded-md bg-muted/30 flex items-center justify-center shrink-0 overflow-hidden ${clickable ? "cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all" : ""}`}
                  onClick={() => clickable && setPreviewAttachment(att)}
                >
                  {isImg ? (
                    <img src={`/api/attachments/file/${att.fileName}`} alt={att.originalName} className="w-full h-full object-cover" loading="lazy" />
                  ) : isVid ? (
                    <video src={`/api/attachments/file/${att.fileName}`} className="w-full h-full object-cover" muted preload="metadata" />
                  ) : att.source === "link" ? (
                    <Link2 className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <MimeIcon className={`h-3.5 w-3.5 ${iconColor}`} />
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

          {/* Drop hint when list is non-empty */}
          <p className="text-[10px] text-muted-foreground/40 text-center pt-1 select-none">
            Drop more files anywhere in this section to upload
          </p>
        </div>
      )}

      {/* Lightbox preview — images, video, audio */}
      {previewAttachment && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85"
          onClick={() => setPreviewAttachment(null)}
          data-testid="attachment-preview-overlay"
        >
          <button
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
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
            ) : isAudio(previewAttachment.mimeType) ? (
              <div className="bg-card rounded-2xl p-8 flex flex-col items-center gap-4 shadow-2xl">
                <Music className="h-12 w-12 text-amber-400" />
                <p className="text-sm font-medium text-foreground">{previewAttachment.originalName}</p>
                <audio src={`/api/attachments/file/${previewAttachment.fileName}`} controls autoPlay className="w-72" />
              </div>
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
