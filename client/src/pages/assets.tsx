import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Upload, Search, Trash2, Download, FileText, FileSpreadsheet,
  Image as ImageIcon, Presentation, File, Archive, X, Plus,
  MoreHorizontal, Eye, FolderOpen,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Asset } from "@shared/schema";

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
  if (mimeType === "application/pdf") return "document";
  if (mimeType.includes("word")) return "document";
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

interface UploadDialogProps {
  open: boolean;
  onClose: () => void;
}

function UploadDialog({ open, onClose }: UploadDialogProps) {
  const { toast } = useToast();
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error("No file selected");
      const formData = new FormData();
      formData.append("file", selectedFile);
      if (name.trim()) formData.append("name", name.trim());
      if (description.trim()) formData.append("description", description.trim());
      if (tags.trim()) formData.append("tags", tags.trim());
      const res = await fetch("/api/assets", {
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
      toast({ title: "Asset uploaded", description: selectedFile?.name });
      queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
      handleClose();
    },
    onError: (err: any) => toast({ title: "Upload failed", description: err.message, variant: "destructive" }),
  });

  const handleClose = () => {
    setSelectedFile(null);
    setName("");
    setDescription("");
    setTags("");
    onClose();
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) { setSelectedFile(file); setName(file.name); }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setSelectedFile(file); setName(file.name); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload Asset</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Drop zone */}
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
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileChange}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.svg,.bmp,.tiff,.zip,.txt"
              data-testid="input-asset-file"
            />
          </div>

          {selectedFile && (
            <>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Display Name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Asset name..."
                  data-testid="input-asset-name"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Description (optional)</label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description of this asset..."
                  className="resize-none h-20"
                  data-testid="input-asset-description"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Tags (optional, comma-separated)</label>
                <Input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="e.g. proposal, Q1-2026, marina"
                  data-testid="input-asset-tags"
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={handleClose}>Cancel</Button>
          <Button
            onClick={() => uploadMutation.mutate()}
            disabled={!selectedFile || uploadMutation.isPending}
            data-testid="button-upload-asset"
          >
            {uploadMutation.isPending ? "Uploading..." : "Upload Asset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface AssetCardProps {
  asset: Asset;
  onDelete: (id: number) => void;
  deleting: boolean;
}

function AssetCard({ asset, onDelete, deleting }: AssetCardProps) {
  const isImage = asset.mimeType.startsWith("image/");

  return (
    <div
      className="group relative bg-card border border-border/50 rounded-lg overflow-hidden hover:border-primary/30 hover:shadow-md transition-all"
      data-testid={`asset-card-${asset.id}`}
    >
      {/* Thumbnail / icon area */}
      <div className="h-36 bg-muted/30 flex items-center justify-center relative overflow-hidden">
        {isImage ? (
          <img
            src={`/api/assets/${asset.id}/file`}
            alt={asset.name}
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <FileIcon mimeType={asset.mimeType} className="h-14 w-14 opacity-70" />
        )}
        {/* Hover overlay with quick actions */}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <a
            href={`/api/assets/${asset.id}/file`}
            target="_blank"
            rel="noopener noreferrer"
            title="Preview"
            className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition-colors"
            data-testid={`button-preview-asset-${asset.id}`}
          >
            <Eye className="h-4 w-4" />
          </a>
          <a
            href={`/api/assets/${asset.id}/download`}
            download={asset.originalName}
            title="Download"
            className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition-colors"
            data-testid={`button-download-asset-${asset.id}`}
          >
            <Download className="h-4 w-4" />
          </a>
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate" title={asset.name}>{asset.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatBytes(asset.size)} · {formatDate(asset.createdAt)}
            </p>
            {asset.description && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{asset.description}</p>
            )}
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
              <DropdownMenuItem asChild>
                <a href={`/api/assets/${asset.id}/file`} target="_blank" rel="noopener noreferrer">
                  <Eye className="h-3.5 w-3.5 mr-2" /> Preview
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={`/api/assets/${asset.id}/download`} download={asset.originalName}>
                  <Download className="h-3.5 w-3.5 mr-2" /> Download
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onDelete(asset.id)}
                disabled={deleting}
                data-testid={`button-delete-asset-${asset.id}`}
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

export default function AssetsPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [categoryTab, setCategoryTab] = useState("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const assetsQuery = useQuery<Asset[]>({
    queryKey: ["/api/assets"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/assets/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
      setDeletingId(null);
      toast({ title: "Asset deleted" });
    },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const handleDelete = (id: number) => {
    setDeletingId(id);
    deleteMutation.mutate(id);
  };

  const allAssets = assetsQuery.data ?? [];

  const filtered = allAssets.filter((a) => {
    const matchesSearch = !search || a.name.toLowerCase().includes(search.toLowerCase()) ||
      (a.description || "").toLowerCase().includes(search.toLowerCase()) ||
      (a.tags || "").toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryTab === "all" || a.category === categoryTab ||
      (categoryTab === "other" && !["image", "document", "spreadsheet", "presentation"].includes(a.category));
    return matchesSearch && matchesCategory;
  });

  const categoryCounts = CATEGORY_TABS.reduce((acc, tab) => {
    if (tab.key === "all") acc[tab.key] = allAssets.length;
    else if (tab.key === "other") acc[tab.key] = allAssets.filter(a => !["image", "document", "spreadsheet", "presentation"].includes(a.category)).length;
    else acc[tab.key] = allAssets.filter(a => a.category === tab.key).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-border/50 bg-card/30">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Sales & Marketing Assets</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {allAssets.length} {allAssets.length === 1 ? "asset" : "assets"} stored · attach to emails from the compose window
            </p>
          </div>
          <Button onClick={() => setUploadOpen(true)} data-testid="button-upload-new-asset">
            <Plus className="h-4 w-4 mr-2" /> Upload Asset
          </Button>
        </div>

        {/* Search + tabs */}
        <div className="mt-4 flex flex-col sm:flex-row gap-3">
          <div className="relative max-w-sm w-full">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search assets..."
              className="pl-8 h-8 text-sm"
              data-testid="input-assets-search"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex gap-1 flex-wrap">
            {CATEGORY_TABS.map((tab) => (
              <Button
                key={tab.key}
                size="sm"
                variant={categoryTab === tab.key ? "default" : "ghost"}
                onClick={() => setCategoryTab(tab.key)}
                className="h-8 text-xs"
                data-testid={`tab-assets-${tab.key}`}
              >
                {tab.label}
                {categoryCounts[tab.key] > 0 && (
                  <span className="ml-1.5 text-[10px] opacity-70">({categoryCounts[tab.key]})</span>
                )}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto p-6">
        {assetsQuery.isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="bg-card border border-border/50 rounded-lg overflow-hidden animate-pulse">
                <div className="h-36 bg-muted/50" />
                <div className="p-3 space-y-2">
                  <div className="h-3 bg-muted rounded w-3/4" />
                  <div className="h-2.5 bg-muted rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <FolderOpen className="h-16 w-16 mb-4 opacity-20" />
            {allAssets.length === 0 ? (
              <>
                <p className="font-medium">No assets yet</p>
                <p className="text-sm mt-1 mb-4">Upload your first sales or marketing asset to get started</p>
                <Button onClick={() => setUploadOpen(true)} data-testid="button-upload-first-asset">
                  <Upload className="h-4 w-4 mr-2" /> Upload Asset
                </Button>
              </>
            ) : (
              <>
                <p className="font-medium">No assets match your filter</p>
                <p className="text-sm mt-1">Try a different category or search term</p>
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
              />
            ))}
          </div>
        )}
      </div>

      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </div>
  );
}
