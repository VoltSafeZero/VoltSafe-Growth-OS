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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  FileText, Upload, Link2, Search, Download, Eye, Trash2,
  ShieldCheck, Package, Wrench, Camera, Receipt, RefreshCcw, FlaskConical,
  FileSignature, Ruler, Paperclip, X, ExternalLink, FolderOpen, File,
  FileImage, FileVideo, ChevronRight, Star, Lock, Users, Megaphone,
  TrendingUp, Layers, ShieldAlert, UserX, AlertTriangle, Clock,
} from "lucide-react";
import type { Attachment } from "@shared/schema";

export const ASSET_USE_CASES = [
  { key: "all",      label: "All",      icon: FolderOpen,  color: "text-muted-foreground",  bg: "bg-muted/40",        border: "border-border/40" },
  { key: "sales",    label: "Sales",    icon: TrendingUp,  color: "text-blue-400",          bg: "bg-blue-500/10",     border: "border-blue-500/20" },
  { key: "product",  label: "Product",  icon: Package,     color: "text-cyan-400",          bg: "bg-cyan-500/10",     border: "border-cyan-500/20" },
  { key: "proof",    label: "Proof",    icon: Camera,      color: "text-pink-400",          bg: "bg-pink-500/10",     border: "border-pink-500/20" },
  { key: "quotes",   label: "Quotes",   icon: Receipt,     color: "text-amber-400",         bg: "bg-amber-500/10",    border: "border-amber-500/20" },
  { key: "brand",    label: "Brand",    icon: Megaphone,   color: "text-purple-400",        bg: "bg-purple-500/10",   border: "border-purple-500/20" },
  { key: "internal", label: "Internal", icon: Lock,        color: "text-red-400",           bg: "bg-red-500/10",      border: "border-red-500/20" },
  { key: "general",  label: "General",  icon: Paperclip,   color: "text-muted-foreground",  bg: "bg-muted/30",        border: "border-border/40" },
];

// ── Detailed categories (secondary filter / type badge) ───────────────────────

export const DOCUMENT_CATEGORIES = [
  { key: "all",              label: "All Categories",    icon: FolderOpen },
  { key: "quote_proposal",   label: "Quote / Proposal",  icon: FileText },
  { key: "contract",         label: "Contract",          icon: FileSignature },
  { key: "certification",    label: "Certification",     icon: ShieldCheck },
  { key: "lab_report",       label: "Lab Report",        icon: FlaskConical },
  { key: "drawing_spec",     label: "Drawing / Spec",    icon: Ruler },
  { key: "install_doc",      label: "Install Document",  icon: Wrench },
  { key: "deployment_photo", label: "Deployment Photo",  icon: Camera },
  { key: "procurement_po",   label: "Procurement / PO",  icon: Package },
  { key: "invoice_billing",  label: "Invoice / Billing", icon: Receipt },
  { key: "cs_renewal",       label: "CS / Renewal",      icon: RefreshCcw },
  { key: "general",          label: "General",           icon: Paperclip },
];

// ── Visibility config ─────────────────────────────────────────────────────────

export const VISIBILITY_OPTIONS = [
  { key: "all",             label: "All Visibility" },
  { key: "public",          label: "Public" },
  { key: "customer_safe",   label: "Customer Safe" },
  { key: "partner_safe",    label: "Partner Safe" },
  { key: "internal_only",   label: "Internal Only" },
  { key: "investor_only",   label: "Investor Only" },
  { key: "admin_only",      label: "Admin Only" },
];

export const OBJECT_TYPES = [
  { key: "all",              label: "All Records" },
  { key: "account",          label: "Account" },
  { key: "contact",          label: "Contact" },
  { key: "opportunity",      label: "Opportunity" },
  { key: "quote",            label: "Quote" },
  { key: "install_workflow", label: "Install Workflow" },
  { key: "deployment",       label: "Deployment" },
  { key: "purchase_order",   label: "Purchase Order" },
  { key: "project",          label: "Project" },
  { key: "customer_success", label: "Customer Success" },
  { key: "general",          label: "General (unlinked)" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function getUseCaseMeta(key: string) {
  return ASSET_USE_CASES.find(u => u.key === key) ?? ASSET_USE_CASES[0];
}

function getCategoryMeta(key: string) {
  return DOCUMENT_CATEGORIES.find(c => c.key === key) ?? DOCUMENT_CATEGORIES[DOCUMENT_CATEGORIES.length - 1];
}

function getVisibilityMeta(key: string) {
  const map: Record<string, { label: string; color: string; icon: typeof Lock }> = {
    public:          { label: "Public",          color: "text-green-400 bg-green-500/10 border-green-500/20",   icon: Eye },
    customer_safe:   { label: "Customer Safe",   color: "text-teal-400 bg-teal-500/10 border-teal-500/20",     icon: Users },
    partner_safe:    { label: "Partner Safe",    color: "text-blue-400 bg-blue-500/10 border-blue-500/20",     icon: Layers },
    internal_only:   { label: "Internal Only",   color: "text-amber-400 bg-amber-500/10 border-amber-500/20",  icon: Lock },
    investor_only:   { label: "Investor Only",   color: "text-red-400 bg-red-500/10 border-red-500/20",        icon: ShieldAlert },
    admin_only:      { label: "Admin Only",      color: "text-red-500 bg-red-500/15 border-red-500/30",        icon: ShieldAlert },
  };
  return map[key] ?? map.customer_safe;
}

function isRestricted(visibility: string) {
  return ["internal_only", "investor_only", "admin_only"].includes(visibility);
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
  const [form, setForm] = useState({
    objectType: "general", objectId: "0", category: "general",
    useCase: "general", visibility: "customer_safe",
    title: "", notes: "",
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      if (file) fd.append("file", file);
      fd.append("objectType", form.objectType);
      fd.append("objectId", form.objectId || "0");
      fd.append("category", form.category);
      fd.append("useCase", form.useCase);
      fd.append("visibility", form.visibility);
      if (form.title) fd.append("title", form.title);
      if (form.notes) fd.append("notes", form.notes);
      const res = await fetch("/api/attachments", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? "Upload failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/documents/stats"] });
      toast({ title: "Asset uploaded" });
      onClose();
      setFile(null);
      setForm({ objectType: "general", objectId: "0", category: "general", useCase: "general", visibility: "customer_safe", title: "", notes: "" });
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md" data-testid="modal-upload-document">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Upload className="h-4 w-4" /> Upload Asset</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
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
              <Label className="text-xs text-muted-foreground mb-1.5 block">Use Case</Label>
              <Select value={form.useCase} onValueChange={v => setForm(f => ({ ...f, useCase: v }))}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-use-case"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ASSET_USE_CASES.filter(u => u.key !== "all").map(u => <SelectItem key={u.key} value={u.key}>{u.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Visibility</Label>
              <Select value={form.visibility} onValueChange={v => setForm(f => ({ ...f, visibility: v }))}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-visibility"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VISIBILITY_OPTIONS.filter(v => v.key !== "all").map(v => <SelectItem key={v.key} value={v.key}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
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
            <Label className="text-xs text-muted-foreground mb-1.5 block">Detailed Category</Label>
            <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-category"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOCUMENT_CATEGORIES.filter(c => c.key !== "all").map(c => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Title (optional)</Label>
              <Input className="h-8 text-xs" placeholder="Display name" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} data-testid="input-title" />
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Notes (optional)</Label>
            <Textarea className="text-xs min-h-[56px] resize-none" placeholder="Context or description…" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} data-testid="input-notes" />
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
  const [form, setForm] = useState({
    url: "", title: "", objectType: "general", objectId: "0",
    category: "general", useCase: "general", visibility: "customer_safe", notes: "",
  });

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
      queryClient.invalidateQueries({ queryKey: ["/api/documents/stats"] });
      toast({ title: "Link added" });
      onClose();
      setForm({ url: "", title: "", objectType: "general", objectId: "0", category: "general", useCase: "general", visibility: "customer_safe", notes: "" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md" data-testid="modal-link-document">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Link2 className="h-4 w-4" /> Link URL</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
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
              <Label className="text-xs text-muted-foreground mb-1.5 block">Use Case</Label>
              <Select value={form.useCase} onValueChange={v => setForm(f => ({ ...f, useCase: v }))}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-link-use-case"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ASSET_USE_CASES.filter(u => u.key !== "all").map(u => <SelectItem key={u.key} value={u.key}>{u.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Visibility</Label>
              <Select value={form.visibility} onValueChange={v => setForm(f => ({ ...f, visibility: v }))}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-link-visibility"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VISIBILITY_OPTIONS.filter(v => v.key !== "all").map(v => <SelectItem key={v.key} value={v.key}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
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
            <Label className="text-xs text-muted-foreground mb-1.5 block">Notes (optional)</Label>
            <Textarea className="text-xs min-h-[56px] resize-none" placeholder="Context…" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} data-testid="input-link-notes" />
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

// ── Visibility badge ─────────────────────────────────────────────────────────

function VisibilityBadge({ visibility }: { visibility: string }) {
  const meta = getVisibilityMeta(visibility);
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${meta.color}`}>
      <Icon className="h-2.5 w-2.5" />
      {meta.label}
    </span>
  );
}

// ── Document Detail Panel ────────────────────────────────────────────────────

function DocumentDetail({ doc, onClose, onDeleted }: { doc: Attachment & { useCase?: string; visibility?: string; isFavorite?: boolean }; onClose: () => void; onDeleted: () => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    category: doc.category ?? "general",
    useCase: (doc as any).useCase ?? "general",
    visibility: (doc as any).visibility ?? "customer_safe",
    title: doc.title ?? "",
    notes: doc.notes ?? "",
  });
  const ucMeta = getUseCaseMeta((doc as any).useCase ?? "general");
  const UcIcon = ucMeta.icon;
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
      queryClient.invalidateQueries({ queryKey: ["/api/documents/stats"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/documents/stats"] });
      toast({ title: "Deleted" });
      onDeleted();
    },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  return (
    <div className="flex flex-col h-full border-l border-border/30 bg-card/30">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/30">
        <span className="text-sm font-medium flex-1 truncate min-w-0">Asset Details</span>
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

        <div className="flex flex-wrap gap-1.5">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${ucMeta.bg} ${ucMeta.color} ${ucMeta.border}`}>
            <UcIcon className="h-3 w-3" />
            {ucMeta.label}
          </span>
          <VisibilityBadge visibility={(doc as any).visibility ?? "customer_safe"} />
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
            <span className="text-muted-foreground">Category</span>
            <span className="font-medium">{getCategoryMeta(doc.category ?? "general").label}</span>
          </div>
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
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Use Case</Label>
                <Select value={draft.useCase} onValueChange={v => setDraft(d => ({ ...d, useCase: v }))}>
                  <SelectTrigger className="h-8 text-xs" data-testid="select-edit-use-case"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ASSET_USE_CASES.filter(u => u.key !== "all").map(u => <SelectItem key={u.key} value={u.key}>{u.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Visibility</Label>
                <Select value={draft.visibility} onValueChange={v => setDraft(d => ({ ...d, visibility: v }))}>
                  <SelectTrigger className="h-8 text-xs" data-testid="select-edit-visibility"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VISIBILITY_OPTIONS.filter(v => v.key !== "all").map(v => <SelectItem key={v.key} value={v.key}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Detailed Category</Label>
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

type DocRow = Attachment & { useCase?: string; visibility?: string; isFavorite?: boolean };

function DocumentRow({ doc, selected, onClick }: { doc: DocRow; selected: boolean; onClick: () => void }) {
  const ucMeta = getUseCaseMeta((doc as any).useCase ?? "general");
  const UcIcon = ucMeta.icon;
  const MimeIcon = getMimeIcon(doc.mimeType, doc.source ?? "upload");
  const vis = (doc as any).visibility ?? "customer_safe";
  const restricted = isRestricted(vis);

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-2.5 border-b border-border/20 hover:bg-muted/20 cursor-pointer transition-colors ${selected ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
      data-testid={`document-row-${doc.id}`}
    >
      <div className="w-8 h-8 rounded-md bg-muted/30 flex items-center justify-center shrink-0">
        {doc.source === "link" ? <Link2 className="h-4 w-4 text-primary" /> : <MimeIcon className="h-4 w-4 text-muted-foreground" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium truncate">{doc.title || doc.originalName}</p>
          {(doc as any).isFavorite && <Star className="h-3 w-3 text-amber-400 fill-amber-400 flex-shrink-0" />}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${ucMeta.color}`}>
            <UcIcon className="h-2.5 w-2.5" />{ucMeta.label}
          </span>
          <span className="text-[10px] text-muted-foreground/40">·</span>
          <span className="text-[10px] text-muted-foreground capitalize">{getObjectTypeLabel(doc.objectType)}</span>
          {restricted && (
            <>
              <span className="text-[10px] text-muted-foreground/40">·</span>
              <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${getVisibilityMeta(vis).color.split(" ")[0]}`}>
                <Lock className="h-2 w-2" />{getVisibilityMeta(vis).label}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="text-right shrink-0 hidden sm:block">
        <p className="text-xs text-muted-foreground">{doc.uploadedByName ?? "—"}</p>
        <p className="text-[10px] text-muted-foreground/60">{timeAgo(doc.createdAt)}</p>
      </div>
      {!restricted && (
        <span className="hidden md:inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border text-teal-400 bg-teal-500/10 border-teal-500/20 shrink-0" data-testid={`badge-customer-safe-${doc.id}`}>
          <Eye className="h-2.5 w-2.5" />Safe
        </span>
      )}
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
    </div>
  );
}

type StaleBreakdownItem = { key: string; count: number };

// ── Main Page ─────────────────────────────────────────────────────────────────

const NO_OWNER_ALERT_THRESHOLD = 10;

export default function DocumentsPage() {
  const [search, setSearch] = useState("");
  const [useCaseFilter, setUseCaseFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [visibilityFilter, setVisibilityFilter] = useState("all");
  const [objectTypeFilter, setObjectTypeFilter] = useState("all");
  const [noOwnerFilter, setNoOwnerFilter] = useState(false);
  const [noOwnerBannerDismissed, setNoOwnerBannerDismissed] = useState(false);
  const [staleSheetOpen, setStaleSheetOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedDoc, setSelectedDoc] = useState<DocRow | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const limit = 50;

  const queryParams = new URLSearchParams();
  if (search) queryParams.set("search", search);
  if (useCaseFilter !== "all") queryParams.set("useCase", useCaseFilter);
  if (categoryFilter !== "all") queryParams.set("category", categoryFilter);
  if (visibilityFilter !== "all") queryParams.set("visibility", visibilityFilter);
  if (objectTypeFilter !== "all") queryParams.set("objectType", objectTypeFilter);
  if (noOwnerFilter) queryParams.set("noOwner", "true");
  queryParams.set("limit", String(limit));
  queryParams.set("offset", String(page * limit));

  const { data, isLoading } = useQuery<{ documents: DocRow[]; total: number }>({
    queryKey: ["/api/documents", search, useCaseFilter, categoryFilter, visibilityFilter, objectTypeFilter, noOwnerFilter, page],
    queryFn: async () => {
      const res = await fetch(`/api/documents?${queryParams}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load documents");
      return res.json();
    },
  });

  const { data: statsData } = useQuery<{ total: number; recent: number; stale: number; noOwner: number }>({
    queryKey: ["/api/documents/stats"],
    queryFn: async () => {
      const res = await fetch("/api/documents/stats", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load document stats");
      return res.json();
    },
  });

  const documents = data?.documents ?? [];
  const total = data?.total ?? 0;

  const statSales = documents.filter(d => (d as any).useCase === "sales").length;
  const statRestricted = documents.filter(d => isRestricted((d as any).visibility ?? "customer_safe")).length;
  const statFavorites = documents.filter(d => (d as any).isFavorite).length;

  const noOwnerCount = statsData?.noOwner ?? 0;
  const showNoOwnerBanner = !noOwnerBannerDismissed && noOwnerCount >= NO_OWNER_ALERT_THRESHOLD && !noOwnerFilter;

  const clearAllFilters = () => {
    setSearch(""); setUseCaseFilter("all"); setCategoryFilter("all");
    setVisibilityFilter("all"); setObjectTypeFilter("all");
    setNoOwnerFilter(false); setPage(0);
  };

  const hasActiveFilters = search || useCaseFilter !== "all" || categoryFilter !== "all"
    || visibilityFilter !== "all" || objectTypeFilter !== "all" || noOwnerFilter;

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="page-documents">
      {/* No-Owner alert banner */}
      {showNoOwnerBanner && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20 text-amber-400" data-testid="banner-no-owner">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p className="text-xs flex-1">
            <span className="font-semibold">{noOwnerCount} unowned docs</span> — assets without an owner can't be managed or expired.{" "}
            <button
              className="underline hover:no-underline font-medium"
              onClick={() => { setNoOwnerFilter(true); setPage(0); }}
              data-testid="banner-no-owner-filter-link"
            >
              Review them
            </button>
          </p>
          <button
            className="h-5 w-5 flex items-center justify-center rounded hover:bg-amber-500/20 transition-colors"
            onClick={() => setNoOwnerBannerDismissed(true)}
            data-testid="banner-no-owner-dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="p-4 sm:p-6 pb-4 border-b border-border/30">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Asset Library</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Files, links and records — organized by use case and visibility · {total} total</p>
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
        <div className="flex items-center gap-6 mt-4 flex-wrap">
          {[
            { label: "Total Assets", value: total },
            { label: "Sales", value: statSales },
            { label: "Restricted", value: statRestricted },
            { label: "Favorites", value: statFavorites },
            { label: "Recent (30d)", value: statsData?.recent ?? "—" },
          ].map(s => (
            <div key={s.label}>
              <p className="text-lg font-bold" data-testid={`stat-${s.label.toLowerCase().replace(/[\s()]+/g, "-").replace(/-+$/g, "")}`}>{s.value}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
            </div>
          ))}
          {/* Stale stat — clickable to open breakdown sheet */}
          <button
            onClick={() => setStaleSheetOpen(true)}
            className="text-left group"
            data-testid="stat-stale-6mo"
          >
            <p className="text-lg font-bold group-hover:text-amber-400 transition-colors" data-testid="stat-stale-6mo-">
              {statsData?.stale ?? "—"}
            </p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide group-hover:text-amber-400/70 transition-colors flex items-center gap-1">
              Stale (6mo+)
              <Clock className="h-2.5 w-2.5 opacity-60" />
            </p>
          </button>
          {/* No Owner stat — clickable to toggle filter */}
          <div
            onClick={() => { setNoOwnerFilter(v => !v); setPage(0); }}
            className="cursor-pointer group"
            data-testid="stat-no-owner-btn"
          >
            <p
              className={`text-lg font-bold transition-colors ${
                noOwnerFilter
                  ? "text-amber-400"
                  : noOwnerCount > 0
                    ? "text-amber-400/80 group-hover:text-amber-400"
                    : ""
              }`}
              data-testid="stat-no-owner"
            >
              {statsData?.noOwner ?? "—"}
            </p>
            <p className={`text-[10px] uppercase tracking-wide flex items-center gap-1 ${
              noOwnerFilter ? "text-amber-400" : "text-muted-foreground"
            }`}>
              <UserX className="h-2.5 w-2.5" />
              No Owner
              {noOwnerFilter && <span className="text-[9px] font-semibold ml-0.5">(filtered)</span>}
            </p>
          </div>
        </div>
      </div>

      {/* Use-case filter chips */}
      <div className="px-6 pt-3 pb-1 border-b border-border/10">
        <div className="flex items-center gap-1.5 flex-wrap">
          {ASSET_USE_CASES.map(uc => {
            const Icon = uc.icon;
            const active = useCaseFilter === uc.key;
            return (
              <button
                key={uc.key}
                onClick={() => { setUseCaseFilter(uc.key); setPage(0); }}
                data-testid={`use-case-filter-${uc.key}`}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  active
                    ? `${uc.bg} ${uc.color} ${uc.border} shadow-sm`
                    : "bg-muted/30 text-muted-foreground border-border/30 hover:bg-muted/50"
                }`}
              >
                <Icon className="h-3 w-3" />
                {uc.label}
              </button>
            );
          })}
          {/* No Owner quick-filter chip */}
          <button
            onClick={() => { setNoOwnerFilter(v => !v); setPage(0); }}
            data-testid="use-case-filter-no-owner"
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              noOwnerFilter
                ? "bg-amber-500/15 text-amber-400 border-amber-500/30 shadow-sm"
                : "bg-muted/30 text-muted-foreground border-border/30 hover:bg-muted/50"
            }`}
          >
            <UserX className="h-3 w-3" />
            No Owner
            {noOwnerCount > 0 && (
              <span className={`ml-0.5 px-1 py-0 rounded-full text-[9px] font-bold ${noOwnerFilter ? "bg-amber-500/30" : "bg-muted/60"}`}>
                {noOwnerCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Secondary filters + search */}
      <div className="px-6 py-2.5 border-b border-border/20">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search assets…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              className="pl-8 h-8 text-xs"
              data-testid="input-search"
            />
          </div>
          <Select value={visibilityFilter} onValueChange={v => { setVisibilityFilter(v); setPage(0); }}>
            <SelectTrigger className="h-8 text-xs w-40" data-testid="select-filter-visibility"><SelectValue placeholder="Visibility" /></SelectTrigger>
            <SelectContent>
              {VISIBILITY_OPTIONS.map(v => <SelectItem key={v.key} value={v.key}>{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={v => { setCategoryFilter(v); setPage(0); }}>
            <SelectTrigger className="h-8 text-xs w-44" data-testid="select-filter-category"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              {DOCUMENT_CATEGORIES.map(c => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={objectTypeFilter} onValueChange={v => { setObjectTypeFilter(v); setPage(0); }}>
            <SelectTrigger className="h-8 text-xs w-40" data-testid="select-filter-object-type"><SelectValue placeholder="Record Type" /></SelectTrigger>
            <SelectContent>
              {OBJECT_TYPES.map(t => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearAllFilters} data-testid="button-clear-filters">
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className={`flex flex-1 min-h-0 overflow-hidden`}>
        {/* Document list */}
        <div className={`flex flex-col flex-1 min-w-0 overflow-hidden ${selectedDoc ? "hidden md:flex" : "flex"}`}>
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 space-y-1">
                {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-none" />)}
              </div>
            ) : documents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
                <FolderOpen className="h-8 w-8 opacity-30" />
                <p className="text-sm">No assets found</p>
                <p className="text-xs opacity-60">Try changing your filters or upload an asset</p>
              </div>
            ) : (
              documents.map(doc => (
                <DocumentRow
                  key={doc.id}
                  doc={doc}
                  selected={selectedDoc?.id === doc.id}
                  onClick={() => setSelectedDoc(doc)}
                />
              ))
            )}
          </div>

          {/* Pagination */}
          {total > limit && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-border/20 bg-card/20 shrink-0">
              <p className="text-xs text-muted-foreground">{page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page === 0} onClick={() => setPage(p => p - 1)} data-testid="button-prev-page">Prev</Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)} data-testid="button-next-page">Next</Button>
              </div>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedDoc && (
          <div className="w-full md:w-80 shrink-0 overflow-hidden">
            <DocumentDetail
              doc={selectedDoc}
              onClose={() => setSelectedDoc(null)}
              onDeleted={() => setSelectedDoc(null)}
            />
          </div>
        )}
      </div>

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <LinkModal open={linkOpen} onClose={() => setLinkOpen(false)} />
      <StaleBreakdownSheet open={staleSheetOpen} onClose={() => setStaleSheetOpen(false)} />
    </div>
  );
}

type StaleBreakdownData = { byUseCase: StaleBreakdownItem[]; byCategory: StaleBreakdownItem[] };

function StaleBreakdownSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, isLoading } = useQuery<StaleBreakdownData>({
    queryKey: ["/api/documents/stats/stale-breakdown"],
    queryFn: async () => {
      const res = await fetch("/api/documents/stats/stale-breakdown", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: open,
  });

  function BreakdownBar({ item, max, labelFn }: { item: StaleBreakdownItem; max: number; labelFn: (key: string) => string }) {
    const pct = max > 0 ? Math.round((item.count / max) * 100) : 0;
    return (
      <div className="flex items-center gap-3 py-1.5">
        <span className="text-xs text-muted-foreground w-32 shrink-0 truncate">{labelFn(item.key)}</span>
        <div className="flex-1 h-2 bg-muted/40 rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-500/70 rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs font-semibold w-6 text-right shrink-0">{item.count}</span>
      </div>
    );
  }

  const maxUseCase = data?.byUseCase[0]?.count ?? 1;
  const maxCategory = data?.byCategory[0]?.count ?? 1;

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col gap-0 p-0" data-testid="sheet-stale-breakdown">
        <SheetHeader className="px-6 py-4 border-b border-border/30">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-amber-400" />
            Stale Docs — 6 mo+ Breakdown
          </SheetTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Shows which use cases and categories have the most outdated content so you can prioritize cleanup.
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-8">
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
            </div>
          ) : !data || (data.byUseCase.length === 0 && data.byCategory.length === 0) ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
              <Clock className="h-8 w-8 opacity-30" />
              <p className="text-sm">No stale docs found</p>
              <p className="text-xs opacity-60">All assets were added within the last 6 months</p>
            </div>
          ) : (
            <>
              {/* By Use Case */}
              {data.byUseCase.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">By Use Case</h3>
                  <div className="space-y-0.5">
                    {data.byUseCase.map(item => (
                      <BreakdownBar
                        key={item.key}
                        item={item}
                        max={maxUseCase}
                        labelFn={k => getUseCaseMeta(k).label}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* By Category */}
              {data.byCategory.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">By Category</h3>
                  <div className="space-y-0.5">
                    {data.byCategory.map(item => (
                      <BreakdownBar
                        key={item.key}
                        item={item}
                        max={maxCategory}
                        labelFn={k => getCategoryMeta(k).label}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
