import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  FileText, Upload, Link2, Search, Filter, Download, Eye, Trash2,
  ShieldCheck, Package, Wrench, Camera, Receipt, RefreshCcw, FlaskConical,
  FileSignature, Ruler, Paperclip, X, ExternalLink, FolderOpen, File,
  FileImage, FileVideo, Building2, Users, Layers, Truck, ClipboardList,
  Calendar, ChevronRight,
} from "lucide-react";
import type { Attachment } from "@shared/schema";

// ── Constants ────────────────────────────────────────────────────────────────

export const DOCUMENT_CATEGORIES = [
  { key: "all", label: "All Categories", icon: FolderOpen, color: "text-muted-foreground", bg: "bg-muted/30", border: "border-border/40" },
  { key: "quote_proposal", label: "Quote / Proposal", icon: FileText, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
  { key: "contract", label: "Contract", icon: FileSignature, color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20" },
  { key: "certification", label: "Certification", icon: ShieldCheck, color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/20" },
  { key: "lab_report", label: "Lab Report", icon: FlaskConical, color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20" },
  { key: "drawing_spec", label: "Drawing / Spec", icon: Ruler, color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/20" },
  { key: "install_doc", label: "Install Document", icon: Wrench, color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20" },
  { key: "deployment_photo", label: "Deployment Photo", icon: Camera, color: "text-pink-400", bg: "bg-pink-500/10", border: "border-pink-500/20" },
  { key: "procurement_po", label: "Procurement / PO", icon: Package, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
  { key: "invoice_billing", label: "Invoice / Billing", icon: Receipt, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20" },
  { key: "cs_renewal", label: "CS / Renewal", icon: RefreshCcw, color: "text-teal-400", bg: "bg-teal-500/10", border: "border-teal-500/20" },
  { key: "general", label: "General", icon: Paperclip, color: "text-muted-foreground", bg: "bg-muted/30", border: "border-border/40" },
];

export const OBJECT_TYPES = [
  { key: "all", label: "All Records" },
  { key: "account", label: "Account" },
  { key: "contact", label: "Contact" },
  { key: "opportunity", label: "Opportunity" },
  { key: "quote", label: "Quote" },
  { key: "install_workflow", label: "Install Workflow" },
  { key: "deployment", label: "Deployment" },
  { key: "purchase_order", label: "Purchase Order" },
  { key: "project", label: "Project" },
  { key: "customer_success", label: "Customer Success" },
  { key: "general", label: "General (unlinked)" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function getCategoryMeta(key: string) {
  return DOCUMENT_CATEGORIES.find(c => c.key === key) ?? DOCUMENT_CATEGORIES[DOCUMENT_CATEGORIES.length - 1];
}

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
  return date.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

function getMimeIcon(mimeType: string, source: string) {
  if (source === "link") return Link2;
  if (mimeType.startsWith("image/")) return FileImage;
  if (mimeType.startsWith("video/")) return FileVideo;
  if (mimeType === "application/pdf") return FileText;
  if (mimeType.includes("word") || mimeType.includes("document")) return FileText;
  if (mimeType.includes("excel") || mimeType.includes("spreadsheet")) return FileText;
  return File;
}

function getObjectTypeLabel(objectType: string) {
  return OBJECT_TYPES.find(t => t.key === objectType)?.label ?? objectType;
}

// ── Upload Modal ─────────────────────────────────────────────────────────────

function UploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ objectType: "general", objectId: "0", category: "general", title: "", notes: "" });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      if (file) fd.append("file", file);
      fd.append("objectType", form.objectType);
      fd.append("objectId", form.objectId || "0");
      fd.append("category", form.category);
      if (form.title) fd.append("title", form.title);
      if (form.notes) fd.append("notes", form.notes);
      const res = await fetch("/api/attachments", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? "Upload failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({ title: "Document uploaded" });
      onClose();
      setFile(null);
      setForm({ objectType: "general", objectId: "0", category: "general", title: "", notes: "" });
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md" data-testid="modal-upload-document">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Upload className="h-4 w-4" /> Upload Document</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">File</Label>
            <div
              className="border-2 border-dashed border-border/50 rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
              data-testid="dropzone-upload"
            >
              {file ? (
                <div className="flex items-center justify-center gap-2 text-sm">
                  <File className="h-4 w-4 text-primary" />
                  <span className="font-medium truncate max-w-[200px]">{file.name}</span>
                  <span className="text-muted-foreground">({formatFileSize(file.size)})</span>
                </div>
              ) : (
                <div className="text-muted-foreground text-sm">
                  <Upload className="h-6 w-6 mx-auto mb-1 opacity-50" />
                  Click to select a file
                </div>
              )}
              <input ref={fileInputRef} type="file" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} data-testid="input-file" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Linked To</Label>
              <Select value={form.objectType} onValueChange={v => setForm(f => ({ ...f, objectType: v }))}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-object-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OBJECT_TYPES.map(t => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {form.objectType !== "general" && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Record ID</Label>
                <Input className="h-8 text-xs" placeholder="e.g. 42" value={form.objectId} onChange={e => setForm(f => ({ ...f, objectId: e.target.value }))} data-testid="input-object-id" />
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Category</Label>
            <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-category"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOCUMENT_CATEGORIES.filter(c => c.key !== "all").map(c => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Title (optional)</Label>
            <Input className="h-8 text-xs" placeholder="Display name" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} data-testid="input-title" />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Notes (optional)</Label>
            <Textarea className="text-xs min-h-[60px] resize-none" placeholder="Context or description…" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} data-testid="input-notes" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} data-testid="button-cancel-upload">Cancel</Button>
          <Button size="sm" disabled={!file || uploadMutation.isPending} onClick={() => uploadMutation.mutate()} data-testid="button-confirm-upload">
            {uploadMutation.isPending ? "Uploading…" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Link URL Modal ───────────────────────────────────────────────────────────

function LinkModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ url: "", title: "", objectType: "general", objectId: "0", category: "general", notes: "" });

  const linkMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/documents/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...form, objectId: form.objectId || "0" }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? "Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({ title: "Link added" });
      onClose();
      setForm({ url: "", title: "", objectType: "general", objectId: "0", category: "general", notes: "" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md" data-testid="modal-link-document">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Link2 className="h-4 w-4" /> Link URL</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">URL *</Label>
            <Input className="h-8 text-xs" placeholder="https://…" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} data-testid="input-url" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Title</Label>
            <Input className="h-8 text-xs" placeholder="Display name" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} data-testid="input-link-title" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Linked To</Label>
              <Select value={form.objectType} onValueChange={v => setForm(f => ({ ...f, objectType: v }))}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-link-object-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OBJECT_TYPES.map(t => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {form.objectType !== "general" && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Record ID</Label>
                <Input className="h-8 text-xs" placeholder="e.g. 42" value={form.objectId} onChange={e => setForm(f => ({ ...f, objectId: e.target.value }))} data-testid="input-link-object-id" />
              </div>
            )}
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Category</Label>
            <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-link-category"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOCUMENT_CATEGORIES.filter(c => c.key !== "all").map(c => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Notes (optional)</Label>
            <Textarea className="text-xs min-h-[60px] resize-none" placeholder="Context…" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} data-testid="input-link-notes" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} data-testid="button-cancel-link">Cancel</Button>
          <Button size="sm" disabled={!form.url || linkMutation.isPending} onClick={() => linkMutation.mutate()} data-testid="button-confirm-link">
            {linkMutation.isPending ? "Saving…" : "Add Link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Document Detail Panel ────────────────────────────────────────────────────

function DocumentDetail({ doc, onClose, onDeleted }: { doc: Attachment; onClose: () => void; onDeleted: () => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ category: doc.category ?? "general", title: doc.title ?? "", notes: doc.notes ?? "" });
  const catMeta = getCategoryMeta(doc.category ?? "general");
  const CatIcon = catMeta.icon;
  const MimeIcon = getMimeIcon(doc.mimeType, doc.source ?? "upload");

  const updateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/attachments/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({ title: "Updated" });
      setEditing(false);
    },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/attachments/${doc.id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({ title: "Deleted" });
      onDeleted();
    },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  return (
    <div className="flex flex-col h-full border-l border-border/30 bg-card/30">
      {/* Header with inline actions — no bottom footer, avoids split-pane FAB conflict */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/30">
        <span className="text-sm font-medium flex-1 truncate min-w-0">Document Details</span>
        <div className="flex items-center gap-0.5 shrink-0">
          {doc.source === "upload" && doc.fileName && !editing && (
            <a href={`/api/attachments/file/${doc.fileName}`} download={doc.originalName}>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Download" data-testid="button-download">
                <Download className="h-3.5 w-3.5" />
              </Button>
            </a>
          )}
          {editing ? (
            <>
              <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => setEditing(false)} data-testid="button-cancel-edit">Cancel</Button>
              <Button size="sm" className="h-7 text-xs px-2" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate()} data-testid="button-save-edit">
                {updateMutation.isPending ? "…" : "Save"}
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => setEditing(true)} data-testid="button-edit-doc">Edit</Button>
          )}
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive/70 hover:text-destructive hover:bg-destructive/10" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()} data-testid="button-delete-doc">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <button onClick={onClose} className="ml-1 h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors" data-testid="button-close-detail">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pt-4 px-4 pb-8 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-muted/30 flex items-center justify-center shrink-0">
            {doc.source === "link" ? <Link2 className="h-5 w-5 text-primary" /> : <MimeIcon className="h-5 w-5 text-muted-foreground" />}
          </div>
          <div className="min-w-0">
            <p className="font-medium text-sm truncate" data-testid="text-doc-name">{doc.title || doc.originalName}</p>
            <p className="text-xs text-muted-foreground">{doc.originalName}</p>
          </div>
        </div>

        <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${catMeta.bg} ${catMeta.color} ${catMeta.border}`}>
          <CatIcon className="h-3 w-3" />
          {catMeta.label}
        </div>

        <div className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Linked to</span>
            <span className="font-medium capitalize">{getObjectTypeLabel(doc.objectType)} #{doc.objectId}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Uploaded by</span>
            <span className="font-medium">{doc.uploadedByName ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Date</span>
            <span className="font-medium">{timeAgo(doc.createdAt)}</span>
          </div>
          {doc.source === "upload" && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Size</span>
              <span className="font-medium">{formatFileSize(doc.fileSize)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Source</span>
            <Badge variant="outline" className="text-[10px] h-4">{doc.source === "link" ? "URL Link" : "Upload"}</Badge>
          </div>
        </div>

        {doc.notes && !editing && (
          <div className="bg-muted/20 rounded-lg p-3">
            <p className="text-xs text-muted-foreground mb-1">Notes</p>
            <p className="text-xs">{doc.notes}</p>
          </div>
        )}

        {doc.url && (
          <a href={doc.url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 text-xs text-primary hover:underline"
            data-testid="link-external-url">
            <ExternalLink className="h-3 w-3" />
            Open URL
          </a>
        )}

        {editing && (
          <div className="space-y-3 pt-2 border-t border-border/30">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Category</Label>
              <Select value={draft.category} onValueChange={v => setDraft(d => ({ ...d, category: v }))}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-edit-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOCUMENT_CATEGORIES.filter(c => c.key !== "all").map(c => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Title</Label>
              <Input className="h-8 text-xs" value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} data-testid="input-edit-title" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Notes</Label>
              <Textarea className="text-xs min-h-[80px] resize-none" value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} data-testid="input-edit-notes" />
            </div>
          </div>
        )}
      </div>

    </div>
  );
}

// ── Document Row ─────────────────────────────────────────────────────────────

function DocumentRow({ doc, selected, onClick }: { doc: Attachment; selected: boolean; onClick: () => void }) {
  const catMeta = getCategoryMeta(doc.category ?? "general");
  const CatIcon = catMeta.icon;
  const MimeIcon = getMimeIcon(doc.mimeType, doc.source ?? "upload");

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-3 border-b border-border/20 hover:bg-muted/20 cursor-pointer transition-colors ${selected ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
      data-testid={`document-row-${doc.id}`}
    >
      <div className="w-8 h-8 rounded-md bg-muted/30 flex items-center justify-center shrink-0">
        {doc.source === "link" ? <Link2 className="h-4 w-4 text-primary" /> : <MimeIcon className="h-4 w-4 text-muted-foreground" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{doc.title || doc.originalName}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${catMeta.color}`}>
            <CatIcon className="h-2.5 w-2.5" />{catMeta.label}
          </span>
          <span className="text-[10px] text-muted-foreground">·</span>
          <span className="text-[10px] text-muted-foreground capitalize">{getObjectTypeLabel(doc.objectType)}</span>
        </div>
      </div>
      <div className="text-right shrink-0 hidden sm:block">
        <p className="text-xs text-muted-foreground">{doc.uploadedByName ?? "—"}</p>
        <p className="text-[10px] text-muted-foreground/60">{timeAgo(doc.createdAt)}</p>
      </div>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DocumentsPage() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [objectTypeFilter, setObjectTypeFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [selectedDoc, setSelectedDoc] = useState<Attachment | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const limit = 50;

  const queryParams = new URLSearchParams();
  if (search) queryParams.set("search", search);
  if (categoryFilter !== "all") queryParams.set("category", categoryFilter);
  if (objectTypeFilter !== "all") queryParams.set("objectType", objectTypeFilter);
  queryParams.set("limit", String(limit));
  queryParams.set("offset", String(page * limit));

  const { data, isLoading } = useQuery<{ documents: Attachment[]; total: number }>({
    queryKey: ["/api/documents", search, categoryFilter, objectTypeFilter, page],
    queryFn: async () => {
      const res = await fetch(`/api/documents?${queryParams}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load documents");
      return res.json();
    },
  });

  const documents = data?.documents ?? [];
  const total = data?.total ?? 0;

  const filtered = sourceFilter === "all" ? documents : documents.filter(d => (d.source ?? "upload") === sourceFilter);

  const recentDocs = documents.slice(0, 6);

  const statUploads = documents.filter(d => d.source === "upload").length;
  const statLinks = documents.filter(d => d.source === "link").length;

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="page-documents">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-border/30">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Document Hub</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Files, links and records — organized and searchable · {total} total</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => setLinkOpen(true)} className="gap-1.5 text-xs" data-testid="button-link-url">
              <Link2 className="h-3.5 w-3.5" /> Link URL
            </Button>
            <Button size="sm" onClick={() => setUploadOpen(true)} className="gap-1.5 text-xs bg-primary text-primary-foreground" data-testid="button-upload">
              <Upload className="h-3.5 w-3.5" /> Upload
            </Button>
          </div>
        </div>

        {/* Stats strip */}
        <div className="flex items-center gap-6 mt-4">
          {[
            { label: "Total Documents", value: total },
            { label: "Uploaded Files", value: statUploads },
            { label: "URL Links", value: statLinks },
            { label: "Categories", value: DOCUMENT_CATEGORIES.length - 1 },
          ].map(s => (
            <div key={s.label}>
              <p className="text-lg font-bold" data-testid={`stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}>{s.value}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="px-6 py-3 border-b border-border/20 space-y-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="pl-8 h-8 text-xs"
              placeholder="Search documents…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              data-testid="input-search"
            />
          </div>
          <Select value={objectTypeFilter} onValueChange={v => { setObjectTypeFilter(v); setPage(0); }}>
            <SelectTrigger className="h-8 w-40 text-xs" data-testid="select-object-type-filter"><SelectValue placeholder="All Records" /></SelectTrigger>
            <SelectContent>
              {OBJECT_TYPES.map(t => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sourceFilter} onValueChange={v => { setSourceFilter(v); }}>
            <SelectTrigger className="h-8 w-32 text-xs" data-testid="select-source-filter"><SelectValue placeholder="All Sources" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="upload">Uploads Only</SelectItem>
              <SelectItem value="link">Links Only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Category chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {DOCUMENT_CATEGORIES.map(c => {
            const Icon = c.icon;
            const active = categoryFilter === c.key;
            return (
              <button
                key={c.key}
                onClick={() => { setCategoryFilter(c.key); setPage(0); }}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border transition-all ${active ? `${c.bg} ${c.color} ${c.border}` : "border-border/40 text-muted-foreground/70 hover:border-border"}`}
                data-testid={`filter-category-${c.key}`}
              >
                <Icon className="h-2.5 w-2.5" />
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 min-h-0">
        {/* Document list */}
        <div className={`flex flex-col ${selectedDoc ? "w-1/2 lg:w-3/5" : "flex-1"} min-h-0`}>
          {/* Recent (only when no filters active) */}
          {!search && categoryFilter === "all" && objectTypeFilter === "all" && page === 0 && recentDocs.length > 0 && !selectedDoc && (
            <div className="px-6 py-4 border-b border-border/20">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Recent</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {recentDocs.map(doc => {
                  const catMeta = getCategoryMeta(doc.category ?? "general");
                  const CatIcon = catMeta.icon;
                  const MimeIcon = getMimeIcon(doc.mimeType, doc.source ?? "upload");
                  return (
                    <button
                      key={doc.id}
                      onClick={() => setSelectedDoc(doc)}
                      className="flex flex-col items-center p-2.5 rounded-lg border border-border/30 bg-card/30 hover:bg-muted/20 transition-colors text-center group"
                      data-testid={`recent-doc-${doc.id}`}
                    >
                      <div className="w-8 h-8 rounded-md bg-muted/30 flex items-center justify-center mb-1.5">
                        {doc.source === "link" ? <Link2 className="h-4 w-4 text-primary" /> : <MimeIcon className="h-4 w-4 text-muted-foreground" />}
                      </div>
                      <p className="text-[10px] font-medium truncate w-full">{doc.title || doc.originalName}</p>
                      <span className={`text-[9px] mt-0.5 ${catMeta.color}`}>{catMeta.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* List */}
          <div className="flex-1 overflow-y-auto pb-36 md:pb-24">
            {isLoading ? (
              <div className="space-y-0">
                {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-none" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                <div className="w-12 h-12 rounded-xl bg-muted/30 flex items-center justify-center mb-3">
                  <FolderOpen className="h-6 w-6 text-muted-foreground/50" />
                </div>
                <p className="font-medium text-sm">No documents found</p>
                <p className="text-xs text-muted-foreground mt-1">Try adjusting your filters or upload a document</p>
                <div className="flex gap-2 mt-4">
                  <Button size="sm" variant="outline" onClick={() => setLinkOpen(true)} className="text-xs gap-1.5" data-testid="button-empty-link"><Link2 className="h-3 w-3" /> Link URL</Button>
                  <Button size="sm" onClick={() => setUploadOpen(true)} className="text-xs gap-1.5 bg-primary text-primary-foreground" data-testid="button-empty-upload"><Upload className="h-3 w-3" /> Upload</Button>
                </div>
              </div>
            ) : (
              <>
                {filtered.map(doc => (
                  <DocumentRow
                    key={doc.id}
                    doc={doc}
                    selected={selectedDoc?.id === doc.id}
                    onClick={() => setSelectedDoc(selectedDoc?.id === doc.id ? null : doc)}
                  />
                ))}
                {total > limit && (
                  <div className="flex items-center justify-center gap-3 p-4">
                    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)} data-testid="button-prev-page" className="text-xs">Previous</Button>
                    <span className="text-xs text-muted-foreground">{page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}</span>
                    <Button variant="outline" size="sm" disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)} data-testid="button-next-page" className="text-xs">Next</Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Detail panel */}
        {selectedDoc && (
          <div className="w-1/2 lg:w-2/5 min-h-0 overflow-hidden">
            <DocumentDetail
              key={selectedDoc.id}
              doc={selectedDoc}
              onClose={() => setSelectedDoc(null)}
              onDeleted={() => setSelectedDoc(null)}
            />
          </div>
        )}
      </div>

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <LinkModal open={linkOpen} onClose={() => setLinkOpen(false)} />
    </div>
  );
}
