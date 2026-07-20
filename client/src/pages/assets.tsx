import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Upload, Search, Trash2, Download, FileText, FileSpreadsheet,
  Image as ImageIcon, Presentation, File, Archive, X, Plus,
  MoreHorizontal, Eye, FolderOpen, AlertTriangle, RefreshCw,
  Paperclip, Folder, FolderPlus, ChevronRight, Home, Pencil, Check,
  Star, StarOff, Lock, Globe, Shield, Link as LinkIcon, ExternalLink,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";

type AssetFolder = { id: number; name: string; parentFolderId: number | null; createdAt: string; };
type AssetItem = {
  id: number; name: string; originalName: string; mimeType: string; size: number;
  category: string; description?: string | null; tags?: string | null; folderId?: number | null;
  createdAt: string; hasFile: boolean;
  useCase?: string | null; visibility?: string | null;
  isFavorite?: boolean; usageCount?: number; lastAttachedAt?: string | null;
  assetType?: string | null; uploadedBy?: number | null;
};

const USE_CASES = [
  { value: "general",  label: "General" },
  { value: "sales",    label: "Sales" },
  { value: "product",  label: "Product" },
  { value: "proof",    label: "Proof" },
  { value: "quotes",   label: "Quotes" },
  { value: "brand",    label: "Brand" },
];

const VISIBILITIES = [
  { value: "customer_safe",  label: "Customer Safe",  color: "text-teal-400"  },
  { value: "public",         label: "Public",          color: "text-green-400" },
  { value: "internal_only",  label: "Internal",        color: "text-amber-400" },
  { value: "investor_only",  label: "Investor Only",   color: "text-purple-400"},
  { value: "admin_only",     label: "Admin Only",      color: "text-red-400"   },
];

function visLabel(v: string | null | undefined) {
  return VISIBILITIES.find(x => x.value === (v ?? "customer_safe"))?.label ?? "Customer Safe";
}
function visColor(v: string | null | undefined) {
  return VISIBILITIES.find(x => x.value === (v ?? "customer_safe"))?.color ?? "text-teal-400";
}
function useCaseLabel(u: string | null | undefined) {
  return USE_CASES.find(x => x.value === (u ?? "general"))?.label ?? "General";
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
function formatDate(d: string | Date): string {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function getCategoryFromMime(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf" || mimeType.includes("word")) return "document";
  if (mimeType.includes("excel") || mimeType.includes("spreadsheet") || mimeType === "text/csv") return "spreadsheet";
  if (mimeType.includes("powerpoint") || mimeType.includes("presentation")) return "presentation";
  if (mimeType === "application/zip") return "archive";
  return "other";
}
function FileIcon({ mimeType, className = "h-8 w-8" }: { mimeType: string; className?: string }) {
  const cat = getCategoryFromMime(mimeType);
  if (cat === "image") return <ImageIcon className={`${className} text-sky-400`} />;
  if (cat === "document") return <FileText className={`${className} text-red-400`} />;
  if (cat === "spreadsheet") return <FileSpreadsheet className={`${className} text-emerald-400`} />;
  if (cat === "presentation") return <Presentation className={`${className} text-orange-400`} />;
  if (cat === "archive") return <Archive className={`${className} text-purple-400`} />;
  return <File className={`${className} text-muted-foreground`} />;
}

const CATEGORY_TABS = [
  { key: "all", label: "All" },
  { key: "document", label: "Documents" },
  { key: "spreadsheet", label: "Spreadsheets" },
  { key: "presentation", label: "Presentations" },
  { key: "image", label: "Images" },
  { key: "other", label: "Other" },
];

// ─── Upload Dialog ───────────────────────────────────────────────────────────
function UploadDialog({ open, onClose, replaceAsset, folders, defaultFolderId }: {
  open: boolean; onClose: () => void;
  replaceAsset?: AssetItem | null;
  folders: AssetFolder[];
  defaultFolderId?: number | null;
}) {
  const { toast } = useToast();
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [folderId, setFolderId] = useState<string>(defaultFolderId ? String(defaultFolderId) : "none");
  const [useCase, setUseCase] = useState<string>("general");
  const [visibility, setVisibility] = useState<string>("customer_safe");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isReplace = !!replaceAsset;

  useEffect(() => {
    if (open) {
      setFolderId(defaultFolderId ? String(defaultFolderId) : "none");
      if (!isReplace) { setUseCase("general"); setVisibility("customer_safe"); }
    }
  }, [open, defaultFolderId, isReplace]);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error("No file selected");
      const formData = new FormData();
      formData.append("file", selectedFile);
      if (!isReplace) {
        if (name.trim()) formData.append("name", name.trim());
        if (description.trim()) formData.append("description", description.trim());
        if (tags.trim()) formData.append("tags", tags.trim());
        if (folderId && folderId !== "none") formData.append("folderId", folderId);
        formData.append("useCase", useCase);
        formData.append("visibility", visibility);
      }
      const url = isReplace ? `/api/assets/${replaceAsset!.id}/replace` : "/api/assets";
      const res = await fetch(url, { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) { const err = await res.json().catch(() => ({ message: "Upload failed" })); throw new Error(err.message); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: isReplace ? "File restored" : "Asset uploaded", description: selectedFile?.name });
      queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
      handleClose();
    },
    onError: (err: any) => toast({ title: "Upload failed", description: err.message, variant: "destructive" }),
  });

  const handleClose = () => {
    setSelectedFile(null); setName(""); setDescription(""); setTags("");
    setFolderId(defaultFolderId ? String(defaultFolderId) : "none");
    setUseCase("general"); setVisibility("customer_safe");
    onClose();
  };
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) { setSelectedFile(file); if (!isReplace) setName(file.name); }
  }, [isReplace]);
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setSelectedFile(file); if (!isReplace) setName(file.name); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isReplace ? `Restore: ${replaceAsset!.name}` : "Upload Asset"}</DialogTitle>
        </DialogHeader>
        {isReplace && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
            Re-upload the same file to restore it. The name and metadata will be preserved.
          </div>
        )}
        <div className="space-y-4 py-2">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            data-testid="asset-dropzone"
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
            }`}
          >
            {selectedFile ? (
              <div className="flex items-center justify-center gap-3">
                <FileIcon mimeType={selectedFile.type} className="h-10 w-10" />
                <div className="text-left">
                  <p className="font-medium text-sm">{selectedFile.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(selectedFile.size)}</p>
                </div>
              </div>
            ) : (
              <>
                <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-sm font-medium">Drop file here or click to browse</p>
                <p className="text-xs text-muted-foreground mt-1">PDF, Word, Excel, PowerPoint, Images, CSV — up to 100 MB</p>
              </>
            )}
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.svg,.bmp,.tiff,.zip,.txt"
              data-testid="input-asset-file" />
          </div>

          {selectedFile && !isReplace && (
            <>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Display Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Asset name..." data-testid="input-asset-name" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Use Case</label>
                  <Select value={useCase} onValueChange={setUseCase}>
                    <SelectTrigger className="h-9 text-xs" data-testid="select-asset-usecase">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {USE_CASES.map(u => (
                        <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Visibility</label>
                  <Select value={visibility} onValueChange={setVisibility}>
                    <SelectTrigger className="h-9 text-xs" data-testid="select-asset-visibility">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VISIBILITIES.map(v => (
                        <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {folders.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Folder (optional)</label>
                  <Select value={folderId} onValueChange={setFolderId}>
                    <SelectTrigger data-testid="select-asset-folder">
                      <SelectValue placeholder="No folder (root)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No folder (root)</SelectItem>
                      {folders.map((f) => (
                        <SelectItem key={f.id} value={String(f.id)}>
                          <div className="flex items-center gap-2">
                            <Folder className="h-3.5 w-3.5 text-primary/70" />
                            {f.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Description (optional)</label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description..." className="resize-none h-20" data-testid="input-asset-description" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Tags (optional, comma-separated)</label>
                <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. proposal, Q1-2026" data-testid="input-asset-tags" />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={handleClose}>Cancel</Button>
          <Button onClick={() => uploadMutation.mutate()} disabled={!selectedFile || uploadMutation.isPending} data-testid="button-upload-asset">
            {uploadMutation.isPending ? (isReplace ? "Restoring..." : "Uploading...") : (isReplace ? "Restore File" : "Upload Asset")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit Metadata Dialog ─────────────────────────────────────────────────────
function EditMetaDialog({ asset, open, onClose }: { asset: AssetItem | null; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [useCase, setUseCase] = useState("general");
  const [visibility, setVisibility] = useState("customer_safe");

  useEffect(() => {
    if (asset && open) {
      setName(asset.name);
      setDescription(asset.description ?? "");
      setTags(asset.tags ?? "");
      setUseCase(asset.useCase ?? "general");
      setVisibility(asset.visibility ?? "customer_safe");
    }
  }, [asset, open]);

  const saveMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/assets/${asset!.id}`, {
      name: name.trim() || asset!.name,
      description: description.trim() || null,
      tags: tags.trim(),
      useCase: useCase || null,
      visibility,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
      toast({ title: "Asset updated" });
      onClose();
    },
    onError: () => toast({ title: "Failed to update asset", variant: "destructive" }),
  });

  if (!asset) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Asset Details</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-edit-asset-name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Use Case</label>
              <Select value={useCase} onValueChange={setUseCase}>
                <SelectTrigger className="h-9 text-xs" data-testid="select-edit-usecase">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {USE_CASES.map(u => (
                    <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Visibility</label>
              <Select value={visibility} onValueChange={setVisibility}>
                <SelectTrigger className="h-9 text-xs" data-testid="select-edit-visibility">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VISIBILITIES.map(v => (
                    <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Description</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description..." className="resize-none h-16 text-sm" data-testid="input-edit-description" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Tags (comma-separated)</label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. proposal, Q1-2026" data-testid="input-edit-tags" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-asset-meta">
            {saveMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Asset Card ──────────────────────────────────────────────────────────────
function AssetCard({ asset, onDelete, deleting, onReplace, onMove, onEdit, onToggleFavorite, folders }: {
  asset: AssetItem; onDelete: (id: number) => void; deleting: boolean;
  onReplace: (asset: AssetItem) => void;
  onMove: (assetId: number, folderId: number | null) => void;
  onEdit: (asset: AssetItem) => void;
  onToggleFavorite: (id: number, current: boolean) => void;
  folders: AssetFolder[];
}) {
  const isImage = asset.mimeType.startsWith("image/");
  const missing = !asset.hasFile;
  const vis = asset.visibility ?? "customer_safe";
  const isRestricted = ["internal_only", "investor_only", "admin_only"].includes(vis);

  return (
    <div
      className={`group relative bg-card border rounded-lg overflow-hidden transition-all ${
        missing ? "border-amber-500/40 hover:border-amber-500/60" : "border-border/50 hover:border-primary/30 hover:shadow-md"
      }`}
      data-testid={`asset-card-${asset.id}`}
    >
      {/* Thumbnail / icon area */}
      <div className={`h-36 flex items-center justify-center relative overflow-hidden ${missing ? "bg-amber-500/5" : "bg-muted/30"}`}>
        {missing ? (
          <div className="flex flex-col items-center gap-2 text-amber-500/70">
            <AlertTriangle className="h-10 w-10" />
            <span className="text-xs font-medium">File unavailable</span>
          </div>
        ) : isImage ? (
          <img src={`/api/assets/${asset.id}/file`} alt={asset.name} className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <FileIcon mimeType={asset.mimeType} className="h-14 w-14 opacity-70" />
        )}

        {/* Favorite star */}
        <button
          onClick={() => onToggleFavorite(asset.id, !!asset.isFavorite)}
          className={`absolute top-1.5 left-1.5 p-1 rounded-md transition-all ${
            asset.isFavorite ? "opacity-100 text-amber-400" : "opacity-0 group-hover:opacity-70 text-white"
          } bg-black/30 hover:bg-black/50`}
          title={asset.isFavorite ? "Remove from favorites" : "Add to favorites"}
          data-testid={`button-favorite-asset-${asset.id}`}
        >
          {asset.isFavorite ? <Star className="h-3 w-3 fill-current" /> : <Star className="h-3 w-3" />}
        </button>

        {/* Hover actions */}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          {missing ? (
            <button onClick={() => onReplace(asset)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 rounded-lg text-white text-xs font-medium transition-colors"
              data-testid={`button-restore-asset-${asset.id}`}>
              <RefreshCw className="h-3.5 w-3.5" /> Re-upload
            </button>
          ) : (
            <>
              <a href={`/api/assets/${asset.id}/file`} target="_blank" rel="noopener noreferrer"
                title="Preview / Open" className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition-colors"
                data-testid={`button-preview-asset-${asset.id}`}>
                <Eye className="h-4 w-4" />
              </a>
              <a href={`/api/assets/${asset.id}/download`} download={asset.originalName}
                title="Download" className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition-colors"
                data-testid={`button-download-asset-${asset.id}`}>
                <Download className="h-4 w-4" />
              </a>
            </>
          )}
        </div>
      </div>

      <div className="p-3">
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate" title={asset.name}>{asset.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{formatBytes(asset.size)} · {formatDate(asset.createdAt)}</p>

            {/* Use Case + Visibility badges */}
            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted/60 text-muted-foreground">
                {useCaseLabel(asset.useCase)}
              </span>
              <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted/40 ${visColor(asset.visibility)}`}>
                {isRestricted && <Lock className="h-2 w-2" />}
                {vis === "public" && <Globe className="h-2 w-2" />}
                {visLabel(asset.visibility)}
              </span>
              {(asset.usageCount ?? 0) > 0 && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted/40 text-muted-foreground">
                  Used {asset.usageCount}×
                </span>
              )}
            </div>

            {asset.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{asset.description}</p>}
            {asset.tags && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {asset.tags.split(",").filter(Boolean).map((t) => (
                  <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{t.trim()}</Badge>
                ))}
              </div>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7 flex-shrink-0" data-testid={`button-asset-menu-${asset.id}`}>
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!missing && (
                <>
                  <DropdownMenuItem asChild>
                    <a href={`/api/assets/${asset.id}/file`} target="_blank" rel="noopener noreferrer">
                      <Eye className="h-3.5 w-3.5 mr-2" /> Preview / Open
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={`/api/assets/${asset.id}/download`} download={asset.originalName}>
                      <Download className="h-3.5 w-3.5 mr-2" /> Download
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              {missing && (
                <DropdownMenuItem onClick={() => onReplace(asset)}>
                  <RefreshCw className="h-3.5 w-3.5 mr-2" /> Re-upload file
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => onEdit(asset)}>
                <Pencil className="h-3.5 w-3.5 mr-2" /> Edit details
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onToggleFavorite(asset.id, !!asset.isFavorite)}>
                {asset.isFavorite
                  ? <><StarOff className="h-3.5 w-3.5 mr-2" /> Remove from favorites</>
                  : <><Star className="h-3.5 w-3.5 mr-2" /> Add to favorites</>
                }
              </DropdownMenuItem>
              {folders.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Folder className="h-3.5 w-3.5 mr-2" /> Move to folder
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {asset.folderId !== null && (
                        <DropdownMenuItem onClick={() => onMove(asset.id, null)}>
                          <Home className="h-3.5 w-3.5 mr-2 text-muted-foreground" /> Root (no folder)
                        </DropdownMenuItem>
                      )}
                      {folders.filter(f => f.id !== asset.folderId).map((f) => (
                        <DropdownMenuItem key={f.id} onClick={() => onMove(asset.id, f.id)}
                          data-testid={`move-to-folder-${f.id}-${asset.id}`}>
                          <Folder className="h-3.5 w-3.5 mr-2 text-primary/70" /> {f.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive"
                onClick={() => onDelete(asset.id)} disabled={deleting}
                data-testid={`button-delete-asset-${asset.id}`}>
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

// ─── Folder Sidebar Item ─────────────────────────────────────────────────────
function FolderSidebarItem({ folder, isSelected, assetCount, onClick, onRename, onDelete }: {
  folder: AssetFolder; isSelected: boolean; assetCount: number;
  onClick: () => void; onRename: (id: number, name: string) => void; onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(folder.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditName(folder.name);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };
  const commitEdit = () => {
    if (editName.trim() && editName.trim() !== folder.name) onRename(folder.id, editName.trim());
    setEditing(false);
  };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") commitEdit();
    if (e.key === "Escape") setEditing(false);
  };

  return (
    <div
      onClick={onClick}
      className={`group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors select-none ${
        isSelected ? "bg-primary/10 text-primary" : "hover:bg-muted/50 text-muted-foreground hover:text-foreground"
      }`}
      data-testid={`sidebar-folder-${folder.id}`}
    >
      <Folder className={`h-3.5 w-3.5 flex-shrink-0 ${isSelected ? "text-primary" : "text-muted-foreground/70"}`} />
      {editing ? (
        <input
          ref={inputRef}
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 text-xs bg-transparent outline-none border-b border-primary"
          data-testid={`input-rename-folder-${folder.id}`}
        />
      ) : (
        <span className="flex-1 text-xs truncate">{folder.name}</span>
      )}
      <div className="flex items-center gap-1">
        {assetCount > 0 && !editing && (
          <span className="text-[10px] text-muted-foreground/60">{assetCount}</span>
        )}
        {!editing && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <button className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted transition-opacity"
                data-testid={`button-folder-menu-${folder.id}`}>
                <MoreHorizontal className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              <DropdownMenuItem onClick={startEdit}>
                <Pencil className="h-3.5 w-3.5 mr-2" /> Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive"
                onClick={(e) => { e.stopPropagation(); onDelete(folder.id); }}
                data-testid={`button-delete-folder-${folder.id}`}>
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete folder
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AssetsPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [categoryTab, setCategoryTab] = useState("all");
  const [selectedFolderId, setSelectedFolderId] = useState<number | null | "all">("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<AssetItem | null>(null);
  const [editTarget, setEditTarget] = useState<AssetItem | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  const assetsQuery = useQuery<AssetItem[]>({ queryKey: ["/api/assets"] });
  const foldersQuery = useQuery<AssetFolder[]>({ queryKey: ["/api/asset-folders"] });

  const folders = foldersQuery.data ?? [];
  const allAssets = assetsQuery.data ?? [];

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/assets/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/assets"] }); setDeletingId(null); toast({ title: "Asset deleted" }); },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const moveMutation = useMutation({
    mutationFn: async ({ assetId, folderId }: { assetId: number; folderId: number | null }) =>
      apiRequest("PATCH", `/api/assets/${assetId}`, { folderId }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/assets"] }); toast({ title: "Asset moved" }); },
    onError: () => toast({ title: "Failed to move asset", variant: "destructive" }),
  });

  const favoriteMutation = useMutation({
    mutationFn: async ({ id, isFavorite }: { id: number; isFavorite: boolean }) =>
      apiRequest("PATCH", `/api/assets/${id}`, { isFavorite }),
    onSuccess: (_, { isFavorite }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
      toast({ title: isFavorite ? "Added to favorites" : "Removed from favorites" });
    },
    onError: () => toast({ title: "Failed to update favorite", variant: "destructive" }),
  });

  const createFolderMutation = useMutation({
    mutationFn: async (name: string) => apiRequest("POST", "/api/asset-folders", { name }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/asset-folders"] }); toast({ title: "Folder created" }); },
    onError: () => toast({ title: "Failed to create folder", variant: "destructive" }),
  });

  const renameFolderMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => apiRequest("PATCH", `/api/asset-folders/${id}`, { name }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/asset-folders"] }); toast({ title: "Folder renamed" }); },
    onError: () => toast({ title: "Failed to rename folder", variant: "destructive" }),
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/asset-folders/${id}`),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/asset-folders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
      if (selectedFolderId === id) setSelectedFolderId("all");
      toast({ title: "Folder deleted", description: "Assets moved to root" });
    },
    onError: () => toast({ title: "Failed to delete folder", variant: "destructive" }),
  });

  const handleDelete = (id: number) => { setDeletingId(id); deleteMutation.mutate(id); };
  const handleMove = (assetId: number, folderId: number | null) => moveMutation.mutate({ assetId, folderId });
  const handleToggleFavorite = (id: number, current: boolean) => favoriteMutation.mutate({ id, isFavorite: !current });

  const handleStartCreateFolder = () => {
    setCreatingFolder(true);
    setNewFolderName("");
    setTimeout(() => newFolderInputRef.current?.focus(), 50);
  };
  const handleCommitCreateFolder = () => {
    if (newFolderName.trim()) {
      createFolderMutation.mutate(newFolderName.trim());
    }
    setCreatingFolder(false);
    setNewFolderName("");
  };

  const missingCount = allAssets.filter(a => !a.hasFile).length;

  const filtered = allAssets.filter((a) => {
    const q = search.toLowerCase();
    const matchesSearch = !search ||
      a.name.toLowerCase().includes(q) ||
      a.originalName.toLowerCase().includes(q) ||
      (a.description || "").toLowerCase().includes(q) ||
      (a.tags || "").toLowerCase().includes(q) ||
      (a.useCase ?? "general").toLowerCase().includes(q) ||
      useCaseLabel(a.useCase).toLowerCase().includes(q) ||
      (a.category ?? "").toLowerCase().includes(q);
    const matchesFolder = selectedFolderId === "all" ? true :
      selectedFolderId === null ? a.folderId == null :
      a.folderId === selectedFolderId;
    const matchesCategory = categoryTab === "all" || a.category === categoryTab ||
      (categoryTab === "other" && !["image", "document", "spreadsheet", "presentation"].includes(a.category));
    return matchesSearch && matchesFolder && matchesCategory;
  });

  const categoryCounts = CATEGORY_TABS.reduce((acc, tab) => {
    const base = selectedFolderId === "all" ? allAssets :
      selectedFolderId === null ? allAssets.filter(a => a.folderId == null) :
      allAssets.filter(a => a.folderId === selectedFolderId);
    if (tab.key === "all") acc[tab.key] = base.length;
    else if (tab.key === "other") acc[tab.key] = base.filter(a => !["image", "document", "spreadsheet", "presentation"].includes(a.category)).length;
    else acc[tab.key] = base.filter(a => a.category === tab.key).length;
    return acc;
  }, {} as Record<string, number>);

  const currentFolderName = selectedFolderId === "all" ? null :
    selectedFolderId === null ? "Root" :
    folders.find(f => f.id === selectedFolderId)?.name ?? "Unknown";

  const uploadDefaultFolder = selectedFolderId === "all" || selectedFolderId === null ? null :
    typeof selectedFolderId === "number" ? selectedFolderId : null;

  const statsBar = [
    { label: "Total", count: allAssets.length },
    { label: "Sales", count: allAssets.filter(a => (a.useCase ?? "general") === "sales").length },
    { label: "Product", count: allAssets.filter(a => (a.useCase ?? "general") === "product").length },
    { label: "General", count: allAssets.filter(a => !a.useCase || a.useCase === "general").length },
    { label: "Restricted", count: allAssets.filter(a => ["internal_only", "investor_only", "admin_only"].includes(a.visibility ?? "customer_safe")).length },
    { label: "Favorites", count: allAssets.filter(a => a.isFavorite).length },
  ];

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* ── Folder Sidebar ─────────────────────────────────────────── */}
      <div className="w-52 flex-shrink-0 border-r border-border/50 flex flex-col bg-card/20 overflow-hidden">
        <div className="px-3 py-3 border-b border-border/40 flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Folders</span>
          <button onClick={handleStartCreateFolder}
            className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
            title="New folder" data-testid="button-new-folder">
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
          {/* All Files */}
          <div
            onClick={() => setSelectedFolderId("all")}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors select-none ${
              selectedFolderId === "all" ? "bg-primary/10 text-primary" : "hover:bg-muted/50 text-muted-foreground hover:text-foreground"
            }`}
            data-testid="sidebar-all-files"
          >
            <Home className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="flex-1 text-xs">All Files</span>
            <span className="text-[10px] text-muted-foreground/60">{allAssets.length}</span>
          </div>

          {/* Unsorted / Root */}
          <div
            onClick={() => setSelectedFolderId(null)}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors select-none ${
              selectedFolderId === null ? "bg-primary/10 text-primary" : "hover:bg-muted/50 text-muted-foreground hover:text-foreground"
            }`}
            data-testid="sidebar-unsorted"
          >
            <FolderOpen className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="flex-1 text-xs">Unsorted</span>
            <span className="text-[10px] text-muted-foreground/60">{allAssets.filter(a => a.folderId == null).length}</span>
          </div>

          {folders.length > 0 && (
            <div className="pt-1 pb-0.5">
              <div className="h-px bg-border/40 mx-1 mb-1.5" />
            </div>
          )}

          {/* User folders */}
          {folders.map((folder) => (
            <FolderSidebarItem
              key={folder.id}
              folder={folder}
              isSelected={selectedFolderId === folder.id}
              assetCount={allAssets.filter(a => a.folderId === folder.id).length}
              onClick={() => setSelectedFolderId(folder.id)}
              onRename={(id, name) => renameFolderMutation.mutate({ id, name })}
              onDelete={(id) => deleteFolderMutation.mutate(id)}
            />
          ))}

          {/* New folder input */}
          {creatingFolder && (
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              <Folder className="h-3.5 w-3.5 text-primary/70 flex-shrink-0" />
              <input
                ref={newFolderInputRef}
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onBlur={handleCommitCreateFolder}
                onKeyDown={(e) => { if (e.key === "Enter") handleCommitCreateFolder(); if (e.key === "Escape") { setCreatingFolder(false); setNewFolderName(""); } }}
                placeholder="Folder name..."
                className="flex-1 text-xs bg-transparent outline-none border-b border-primary"
                data-testid="input-new-folder-name"
              />
              <button onClick={handleCommitCreateFolder} className="text-primary hover:text-primary/80">
                <Check className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Main Content ───────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 px-6 py-4 border-b border-border/50 bg-card/30">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-0.5">
                <button onClick={() => setSelectedFolderId("all")} className="hover:text-foreground transition-colors">
                  <Home className="h-3.5 w-3.5" />
                </button>
                {currentFolderName && (
                  <>
                    <ChevronRight className="h-3 w-3" />
                    <span className="text-foreground font-medium">{currentFolderName}</span>
                  </>
                )}
              </div>
              <h1 className="text-xl font-semibold">Document Hub</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Files, links and records — organized by use case and visibility · {allAssets.length} total
              </p>
            </div>
            <Button onClick={() => setUploadOpen(true)} data-testid="button-upload-new-asset">
              <Plus className="h-4 w-4 mr-2" /> Upload
            </Button>
          </div>

          {/* Stats bar */}
          <div className="flex items-center gap-4 mt-3 flex-wrap">
            {statsBar.map(s => (
              <div key={s.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{s.count}</span>
                <span>{s.label}</span>
              </div>
            ))}
          </div>

          {missingCount > 0 && (
            <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
              <span><strong>{missingCount} {missingCount === 1 ? "asset" : "assets"}</strong> {missingCount === 1 ? "is" : "are"} missing their file and need to be re-uploaded.</span>
            </div>
          )}

          <div className="mt-3 flex flex-col sm:flex-row gap-3">
            <div className="relative max-w-sm w-full">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, use case, tags..."
                className="pl-8 h-8 text-sm" data-testid="input-assets-search" />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="flex gap-1 flex-wrap">
              {CATEGORY_TABS.map((tab) => (
                <Button key={tab.key} size="sm" variant={categoryTab === tab.key ? "default" : "ghost"}
                  onClick={() => setCategoryTab(tab.key)} className="h-8 text-xs" data-testid={`tab-assets-${tab.key}`}>
                  {tab.label}
                  {categoryCounts[tab.key] > 0 && (
                    <span className="ml-1.5 text-[10px] opacity-70">({categoryCounts[tab.key]})</span>
                  )}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto pt-6 px-6 pb-24 lg:pb-8">
          {assetsQuery.isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="bg-card border border-border/50 rounded-lg overflow-hidden animate-pulse">
                  <div className="h-36 bg-muted/50" />
                  <div className="p-3 space-y-2"><div className="h-3 bg-muted rounded w-3/4" /><div className="h-2.5 bg-muted rounded w-1/2" /></div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <FolderOpen className="h-16 w-16 mb-4 opacity-20" />
              {allAssets.length === 0 ? (
                <>
                  <p className="font-medium">No assets yet</p>
                  <p className="text-sm mt-1 mb-4">Upload your first asset to get started</p>
                  <Button onClick={() => setUploadOpen(true)} data-testid="button-upload-first-asset">
                    <Upload className="h-4 w-4 mr-2" /> Upload Asset
                  </Button>
                </>
              ) : (
                <>
                  <p className="font-medium">No assets match this view</p>
                  <p className="text-sm mt-1 mb-3">Try a different category, folder, or search term</p>
                  <Button variant="outline" size="sm" onClick={() => { setSearch(""); setCategoryTab("all"); setSelectedFolderId("all"); }}
                    data-testid="button-clear-asset-filters">
                    Clear filters
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {filtered.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  onDelete={handleDelete}
                  deleting={deletingId === asset.id && deleteMutation.isPending}
                  onReplace={setReplaceTarget}
                  onMove={handleMove}
                  onEdit={setEditTarget}
                  onToggleFavorite={handleToggleFavorite}
                  folders={folders}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <UploadDialog
        open={uploadOpen || !!replaceTarget}
        onClose={() => { setUploadOpen(false); setReplaceTarget(null); }}
        replaceAsset={replaceTarget}
        folders={folders}
        defaultFolderId={uploadDefaultFolder}
      />

      <EditMetaDialog
        asset={editTarget}
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
      />
    </div>
  );
}
