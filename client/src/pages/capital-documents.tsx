// Capital Data Room — Phase 2G
// Metadata-first material tracker. File upload/download integration is
// deferred until secure storage is implemented behind requireCapitalAccess.
// TODO: Wire secure file storage when available (see server/services/capital-data-room.ts).

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  FolderOpen, Plus, Search, FileText, ExternalLink, Eye,
  Download, AlertTriangle, Share2, ClipboardList,
  Edit2, Trash2, Archive, Tag, Lock, ShieldAlert,
  MoreHorizontal, X, Info, Zap, Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Constants ──────────────────────────────────────────────────────────────────

const MATERIAL_TYPES: { value: string; label: string }[] = [
  { value: "pitch_deck",            label: "Pitch Deck" },
  { value: "executive_summary",     label: "Executive Summary" },
  { value: "financial_model",       label: "Financial Model" },
  { value: "cap_table",             label: "Cap Table" },
  { value: "product_overview",      label: "Product Overview" },
  { value: "technical_overview",    label: "Technical Overview" },
  { value: "patent_ip",             label: "Patent / IP" },
  { value: "customer_pipeline",     label: "Customer Pipeline" },
  { value: "pilot_results",         label: "Pilot Results" },
  { value: "market_analysis",       label: "Market Analysis" },
  { value: "data_room_index",       label: "Data Room Index" },
  { value: "legal_docs",            label: "Legal Docs" },
  { value: "subscription_agreement",label: "Subscription Agreement" },
  { value: "due_diligence",         label: "Due Diligence" },
  { value: "board_material",        label: "Board Material" },
  { value: "grant_document",        label: "Grant Document" },
  { value: "other",                 label: "Other" },
];

const MATERIAL_STATUSES  = ["draft","active","archived","superseded","restricted","pending_review"];
const SHARE_METHODS      = ["email","data_room_link","manual","meeting","other"];
const REQUEST_STATUSES   = ["requested","in_progress","ready","shared","blocked","waived","closed"];
const REQUEST_PRIORITIES = ["critical","high","medium","low"];

// ── Types ──────────────────────────────────────────────────────────────────────

type Material = {
  id: number; title: string; description: string | null;
  material_type: string; round_id: number | null; round_name: string | null;
  version_label: string | null; status: string;
  file_url: string | null; external_url: string | null; mime_type: string | null;
  file_size_bytes: number | null; tags: string | null;
  is_confidential: boolean; requires_nda: boolean;
  owner_user_id: number | null; owner_name: string | null;
  created_at: string; updated_at: string;
  share_count: number; latest_shared_at: string | null;
};

type MaterialShare = {
  id: number; material_id: number; investor_id: number | null;
  investor_name: string | null; contact_id: number | null; contact_name: string | null;
  share_method: string; shared_at: string; status: string;
  viewed_at: string | null; downloaded_at: string | null; notes: string | null;
};

type MaterialRequest = {
  id: number; investor_id: number | null; investor_name: string | null;
  requested_material_type: string | null; requested_title: string | null;
  request_status: string; priority: string; due_at: string | null;
  requested_at: string; fulfilled_at: string | null; notes: string | null;
  fulfilled_material_title: string | null;
};

type Investor = { id: number; name: string; stage: string };

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}
function fmtDateShort(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}
function typeLabel(t: string) {
  return MATERIAL_TYPES.find(m => m.value === t)?.label ?? t;
}
function statusColor(s: string) {
  if (s === "active")         return "bg-emerald-500/15 text-emerald-400 border-emerald-500/20";
  if (s === "draft")          return "bg-muted text-muted-foreground border-transparent";
  if (s === "archived")       return "bg-muted/40 text-muted-foreground/60 border-transparent";
  if (s === "superseded")     return "bg-amber-500/15 text-amber-400 border-amber-500/20";
  if (s === "restricted")     return "bg-red-500/15 text-red-400 border-red-500/20";
  if (s === "pending_review") return "bg-cyan-500/15 text-cyan-400 border-cyan-500/20";
  return "bg-secondary text-secondary-foreground border-transparent";
}
function shareStatusColor(s: string) {
  if (s === "viewed" || s === "downloaded" || s === "completed") return "bg-emerald-500/15 text-emerald-400";
  if (s === "shared")           return "bg-cyan-500/15 text-cyan-400";
  if (s === "follow_up_needed") return "bg-amber-500/15 text-amber-400";
  if (s === "stale" || s === "superseded") return "bg-red-500/15 text-red-400";
  return "bg-muted text-muted-foreground";
}
function requestStatusColor(s: string) {
  if (["shared","waived","closed"].includes(s)) return "bg-emerald-500/15 text-emerald-400";
  if (s === "blocked")   return "bg-red-500/15 text-red-400";
  if (s === "in_progress" || s === "ready") return "bg-cyan-500/15 text-cyan-400";
  if (s === "requested") return "bg-amber-500/15 text-amber-400";
  return "bg-muted text-muted-foreground";
}
function priorityColor(p: string) {
  if (p === "critical") return "text-red-400";
  if (p === "high")     return "text-amber-400";
  if (p === "medium")   return "text-cyan-400";
  return "text-muted-foreground";
}

// ── Add / Edit Material Dialog ─────────────────────────────────────────────────

function MaterialFormDialog({ existing, onClose }: {
  existing?: Material | null; onClose: () => void;
}) {
  const { toast } = useToast();
  const isEdit = !!existing;
  const [form, setForm] = useState({
    title:           existing?.title          ?? "",
    description:     existing?.description    ?? "",
    material_type:   existing?.material_type  ?? "other",
    version_label:   existing?.version_label  ?? "",
    status:          existing?.status         ?? "draft",
    external_url:    existing?.external_url   ?? "",
    tags:            existing?.tags           ?? "",
    is_confidential: existing?.is_confidential ?? true,
    requires_nda:    existing?.requires_nda    ?? false,
  });
  const mut = useMutation({
    mutationFn: (data: any) => isEdit
      ? apiRequest("PATCH", `/api/capital/materials/${existing!.id}`, data)
      : apiRequest("POST",  "/api/capital/materials", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capital/materials"] });
      toast({ title: isEdit ? "Material updated" : "Material created" });
      onClose();
    },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });
  function ff(k: string, v: any) { setForm(p => ({ ...p, [k]: v })); }
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            {isEdit ? "Edit Material" : "Add Material"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-1">
          <div>
            <Label className="text-xs">Title *</Label>
            <Input value={form.title} onChange={e => ff("title", e.target.value)}
              placeholder="e.g. VoltSafe Series A Pitch Deck v3" className="mt-1 text-sm"
              data-testid="input-material-title" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Material Type</Label>
              <Select value={form.material_type} onValueChange={v => ff("material_type", v)}>
                <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-material-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MATERIAL_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={form.status} onValueChange={v => ff("status", v)}>
                <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-material-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MATERIAL_STATUSES.map(s => (
                    <SelectItem key={s} value={s}>
                      {s.replace(/_/g," ").replace(/\b\w/g, c => c.toUpperCase())}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Version Label</Label>
              <Input value={form.version_label} onChange={e => ff("version_label", e.target.value)}
                placeholder="e.g. v3, Jan 2026" className="mt-1 h-8 text-xs"
                data-testid="input-version-label" />
            </div>
            <div>
              <Label className="text-xs">Tags (comma-separated)</Label>
              <Input value={form.tags} onChange={e => ff("tags", e.target.value)}
                placeholder="e.g. series-a, diligence" className="mt-1 h-8 text-xs"
                data-testid="input-material-tags" />
            </div>
          </div>
          <div>
            <Label className="text-xs">External URL (Google Drive, Notion, etc.)</Label>
            <Input value={form.external_url} onChange={e => ff("external_url", e.target.value)}
              placeholder="https://drive.google.com/…" className="mt-1 h-8 text-xs"
              data-testid="input-external-url" />
            <p className="text-[10px] text-muted-foreground mt-1">
              {/* TODO: secure file upload integration */}
              File upload coming soon — paste a link for now.
            </p>
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Textarea value={form.description} onChange={e => ff("description", e.target.value)}
              placeholder="Brief description…" className="mt-1 text-xs min-h-[60px]"
              data-testid="input-material-description" />
          </div>
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <Switch id="confidential" checked={form.is_confidential}
                onCheckedChange={v => ff("is_confidential", v)} data-testid="switch-confidential" />
              <Label htmlFor="confidential" className="text-xs flex items-center gap-1">
                <Lock className="w-3 h-3" /> Confidential
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="nda" checked={form.requires_nda}
                onCheckedChange={v => ff("requires_nda", v)} data-testid="switch-nda" />
              <Label htmlFor="nda" className="text-xs flex items-center gap-1">
                <ShieldAlert className="w-3 h-3" /> Requires NDA
              </Label>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={mut.isPending || !form.title.trim()}
            onClick={() => mut.mutate({
              title:           form.title,
              description:     form.description   || null,
              material_type:   form.material_type,
              version_label:   form.version_label || null,
              status:          form.status,
              external_url:    form.external_url  || null,
              tags:            form.tags           || null,
              is_confidential: form.is_confidential,
              requires_nda:    form.requires_nda,
            })} data-testid="btn-save-material">
            {mut.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Share Material Dialog ──────────────────────────────────────────────────────

function ShareMaterialDialog({ material, onClose }: {
  material: Material; onClose: () => void;
}) {
  const { toast } = useToast();
  const { data: investors = [] } = useQuery<Investor[]>({
    queryKey: ["/api/capital/investors"],
    queryFn: () => fetch("/api/capital/investors", { credentials: "include" }).then(r => r.json()),
    staleTime: 60_000,
  });
  const [form, setForm] = useState({ investor_id: "", share_method: "manual", notes: "" });
  const mut = useMutation({
    mutationFn: (data: any) => apiRequest("POST", `/api/capital/materials/${material.id}/share`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capital/materials"] });
      queryClient.invalidateQueries({ queryKey: ["/api/capital/materials", material.id] });
      toast({ title: "Share recorded" });
      onClose();
    },
    onError: (e: any) => toast({ title: e?.message || "Share failed", variant: "destructive" }),
  });
  function ff(k: string, v: any) { setForm(p => ({ ...p, [k]: v })); }
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="w-4 h-4 text-cyan-400" /> Share — {material.title}
          </DialogTitle>
        </DialogHeader>
        {material.requires_nda && (
          <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
            <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            NDA required. Verify the investor has a signed NDA before sharing.
          </div>
        )}
        {material.status === "superseded" && (
          <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            This material is superseded — consider sharing the latest version instead.
          </div>
        )}
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs">Investor *</Label>
            <Select value={form.investor_id} onValueChange={v => ff("investor_id", v)}>
              <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-share-investor">
                <SelectValue placeholder="Select investor" />
              </SelectTrigger>
              <SelectContent>
                {investors.map((inv: Investor) => (
                  <SelectItem key={inv.id} value={String(inv.id)}>{inv.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Share Method</Label>
            <Select value={form.share_method} onValueChange={v => ff("share_method", v)}>
              <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-share-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHARE_METHODS.map(m => (
                  <SelectItem key={m} value={m}>
                    {m.replace(/_/g," ").replace(/\b\w/g, c => c.toUpperCase())}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Notes (optional)</Label>
            <Textarea value={form.notes} onChange={e => ff("notes", e.target.value)}
              placeholder="e.g. Shared in follow-up email after partner meeting"
              className="mt-1 text-xs min-h-[60px]" data-testid="input-share-notes" />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={mut.isPending || !form.investor_id}
            onClick={() => mut.mutate({
              investor_id:  Number(form.investor_id),
              share_method: form.share_method,
              notes:        form.notes || null,
            })} data-testid="btn-confirm-share">
            {mut.isPending ? "Saving…" : "Record Share"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Material Request Dialog ────────────────────────────────────────────────────

function RequestDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const { data: investors = [] } = useQuery<Investor[]>({
    queryKey: ["/api/capital/investors"],
    queryFn: () => fetch("/api/capital/investors", { credentials: "include" }).then(r => r.json()),
    staleTime: 60_000,
  });
  const [form, setForm] = useState({
    investor_id: "",
    requested_material_type: "other",
    requested_title: "",
    priority: "medium",
    due_at: "",
    notes: "",
  });
  const mut = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/capital/material-requests", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capital/material-requests"] });
      toast({ title: "Request created" });
      onClose();
    },
    onError: () => toast({ title: "Failed to create request", variant: "destructive" }),
  });
  function ff(k: string, v: any) { setForm(p => ({ ...p, [k]: v })); }
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-amber-400" /> Log Material Request
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs">Investor *</Label>
            <Select value={form.investor_id} onValueChange={v => ff("investor_id", v)}>
              <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-req-investor">
                <SelectValue placeholder="Select investor" />
              </SelectTrigger>
              <SelectContent>
                {investors.map((inv: Investor) => (
                  <SelectItem key={inv.id} value={String(inv.id)}>{inv.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Material Type</Label>
              <Select value={form.requested_material_type} onValueChange={v => ff("requested_material_type", v)}>
                <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-req-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MATERIAL_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Priority</Label>
              <Select value={form.priority} onValueChange={v => ff("priority", v)}>
                <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-req-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REQUEST_PRIORITIES.map(p => (
                    <SelectItem key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Title / Description</Label>
            <Input value={form.requested_title} onChange={e => ff("requested_title", e.target.value)}
              placeholder="e.g. Q3 financial model with updated projections"
              className="mt-1 h-8 text-xs" data-testid="input-req-title" />
          </div>
          <div>
            <Label className="text-xs">Due Date (optional)</Label>
            <Input type="date" value={form.due_at} onChange={e => ff("due_at", e.target.value)}
              className="mt-1 h-8 text-xs" data-testid="input-req-due" />
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea value={form.notes} onChange={e => ff("notes", e.target.value)}
              placeholder="Context about this request…" className="mt-1 text-xs min-h-[50px]"
              data-testid="input-req-notes" />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={mut.isPending || !form.investor_id}
            onClick={() => mut.mutate({
              investor_id:             Number(form.investor_id),
              requested_material_type: form.requested_material_type,
              requested_title:         form.requested_title || null,
              priority:                form.priority,
              due_at:                  form.due_at || null,
              notes:                   form.notes  || null,
            })} data-testid="btn-confirm-request">
            {mut.isPending ? "Saving…" : "Create Request"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Material Detail Sheet ──────────────────────────────────────────────────────

function MaterialDetailSheet({ material, onClose, onEdit }: {
  material: Material; onClose: () => void; onEdit: () => void;
}) {
  const { toast } = useToast();
  const [shareOpen, setShareOpen] = useState(false);

  const { data: detail } = useQuery<{ shares: MaterialShare[]; requests: MaterialRequest[] } & Material>({
    queryKey: ["/api/capital/materials", material.id],
    queryFn: () => fetch(`/api/capital/materials/${material.id}`, { credentials: "include" }).then(r => r.json()),
    staleTime: 30_000,
  });

  const archiveMut = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/capital/materials/${material.id}`, { status: "archived" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capital/materials"] });
      toast({ title: "Archived" });
      onClose();
    },
    onError: () => toast({ title: "Archive failed", variant: "destructive" }),
  });

  const followUpMut = useMutation({
    mutationFn: (shareId: number) =>
      apiRequest("PATCH", `/api/capital/material-shares/${shareId}`, { status: "follow_up_needed" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capital/materials", material.id] });
      toast({ title: "Marked as follow-up needed" });
    },
  });

  const shares   = detail?.shares   ?? [];
  const requests = detail?.requests ?? [];

  return (
    <>
      <Sheet open onOpenChange={onClose}>
        <SheetContent side="right" className="w-full sm:w-[580px] overflow-y-auto p-0" data-testid="material-detail">
          <div className="p-5 space-y-4">
            <SheetHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <SheetTitle className="text-base font-semibold truncate" data-testid="material-detail-title">
                    {material.title}
                  </SheetTitle>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${statusColor(material.status)}`}
                      data-testid="badge-material-status">
                      {material.status}
                    </span>
                    <span className="text-xs text-muted-foreground">{typeLabel(material.material_type)}</span>
                    {material.version_label && (
                      <span className="text-[10px] bg-violet-500/10 text-violet-400 px-1.5 py-0.5 rounded">
                        {material.version_label}
                      </span>
                    )}
                    {material.is_confidential && <Lock className="w-3 h-3 text-muted-foreground" />}
                    {material.requires_nda    && <ShieldAlert className="w-3 h-3 text-amber-400" />}
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <Button size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => setShareOpen(true)} data-testid="btn-share-material">
                    <Share2 className="w-3 h-3 mr-1" /> Share
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={onEdit}
                    data-testid="btn-edit-material-detail">
                    <Edit2 className="w-3 h-3" />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => archiveMut.mutate()} data-testid="btn-archive-material">
                        <Archive className="w-3.5 h-3.5 mr-2" /> Archive
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </SheetHeader>

            <Tabs defaultValue="overview">
              <TabsList className="h-8 text-xs">
                <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
                <TabsTrigger value="shares" className="text-xs">
                  Shares{shares.length > 0 && (
                    <span className="ml-1 text-[9px] bg-muted rounded px-1">{shares.length}</span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="requests" className="text-xs">
                  Requests{requests.length > 0 && (
                    <span className="ml-1 text-[9px] bg-muted rounded px-1">{requests.length}</span>
                  )}
                </TabsTrigger>
              </TabsList>

              {/* ── Overview ── */}
              <TabsContent value="overview" className="mt-4 space-y-4" data-testid="tab-overview">
                {material.description && (
                  <p className="text-sm text-muted-foreground">{material.description}</p>
                )}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Round</p>
                    <p className="font-medium mt-0.5">{material.round_name ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Owner</p>
                    <p className="font-medium mt-0.5">{material.owner_name ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Updated</p>
                    <p className="font-medium mt-0.5">{fmtDate(material.updated_at)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Shares</p>
                    <p className="font-medium mt-0.5">{material.share_count}</p>
                  </div>
                </div>
                {material.tags && (
                  <div className="flex flex-wrap gap-1">
                    {material.tags.split(",").map(t => (
                      <span key={t.trim()}
                        className="text-[10px] bg-muted text-muted-foreground rounded px-1.5 py-0.5 flex items-center gap-1">
                        <Tag className="w-2.5 h-2.5" />{t.trim()}
                      </span>
                    ))}
                  </div>
                )}
                <Separator />
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">File / Link</p>
                  {material.external_url ? (
                    <a href={material.external_url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 text-xs text-cyan-400 hover:underline"
                      data-testid="link-external-url">
                      <ExternalLink className="w-3.5 h-3.5" /> Open document
                    </a>
                  ) : (
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Info className="w-3.5 h-3.5 shrink-0" />
                      No file or link. Edit to add one.
                      {/* TODO: secure file storage integration */}
                    </div>
                  )}
                </div>
                {material.requires_nda && (
                  <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0" /> NDA required before sharing
                  </div>
                )}
              </TabsContent>

              {/* ── Shares ── */}
              <TabsContent value="shares" className="mt-4" data-testid="tab-shares">
                {!detail ? (
                  <div className="text-xs text-muted-foreground text-center py-6">Loading…</div>
                ) : shares.length === 0 ? (
                  <div className="text-center text-muted-foreground text-xs py-8" data-testid="shares-empty">
                    <Share2 className="w-6 h-6 mx-auto mb-2 opacity-30" />
                    Not yet shared with any investor.
                    <Button size="sm" variant="link" className="block mx-auto mt-1 text-xs"
                      onClick={() => setShareOpen(true)}>
                      Share now
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2" data-testid="share-list">
                    {shares.map(s => (
                      <div key={s.id}
                        className="bg-card border border-border rounded-xl p-3 space-y-1.5"
                        data-testid={`share-row-${s.id}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{s.investor_name ?? "Unknown"}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded ${shareStatusColor(s.status)}`}>
                            {s.status.replace(/_/g," ")}
                          </span>
                        </div>
                        <div className="flex gap-3 text-[10px] text-muted-foreground flex-wrap">
                          <span>Shared {fmtDateShort(s.shared_at)}</span>
                          <span className="capitalize">{s.share_method.replace(/_/g," ")}</span>
                          {s.viewed_at     && (
                            <span className="text-emerald-400 flex items-center gap-0.5">
                              <Eye className="w-2.5 h-2.5" /> Viewed {fmtDateShort(s.viewed_at)}
                            </span>
                          )}
                          {s.downloaded_at && (
                            <span className="text-emerald-400 flex items-center gap-0.5">
                              <Download className="w-2.5 h-2.5" /> Downloaded
                            </span>
                          )}
                        </div>
                        {s.notes && <p className="text-[10px] text-muted-foreground/70">{s.notes}</p>}
                        {s.status === "shared" && (
                          <Button size="sm" variant="ghost"
                            className="h-6 text-[10px] text-amber-400 px-2"
                            onClick={() => followUpMut.mutate(s.id)}
                            data-testid={`btn-follow-up-${s.id}`}>
                            <Zap className="w-2.5 h-2.5 mr-1" /> Mark follow-up needed
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* ── Requests ── */}
              <TabsContent value="requests" className="mt-4" data-testid="tab-requests">
                {requests.length === 0 ? (
                  <div className="text-center text-muted-foreground text-xs py-8" data-testid="requests-empty">
                    <ClipboardList className="w-6 h-6 mx-auto mb-2 opacity-30" />
                    No material requests linked to this document.
                  </div>
                ) : (
                  <div className="space-y-2" data-testid="request-list">
                    {requests.map(r => (
                      <div key={r.id}
                        className="bg-card border border-border rounded-xl p-3 space-y-1"
                        data-testid={`request-row-${r.id}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium">{r.investor_name}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded ${requestStatusColor(r.request_status)}`}>
                            {r.request_status.replace(/_/g," ")}
                          </span>
                        </div>
                        {r.requested_title && (
                          <p className="text-[10px] text-muted-foreground">{r.requested_title}</p>
                        )}
                        <div className="flex gap-2 text-[10px] text-muted-foreground">
                          <span className={priorityColor(r.priority)}>{r.priority}</span>
                          {r.due_at    && <span>Due {fmtDateShort(r.due_at)}</span>}
                          {r.fulfilled_at && (
                            <span className="text-emerald-400">Fulfilled {fmtDateShort(r.fulfilled_at)}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </SheetContent>
      </Sheet>
      {shareOpen && (
        <ShareMaterialDialog material={material} onClose={() => setShareOpen(false)} />
      )}
    </>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function CapitalDocuments() {
  const { toast } = useToast();
  const [search,        setSearch]        = useState("");
  const [typeFilter,    setTypeFilter]    = useState("all");
  const [statusFilter,  setStatusFilter]  = useState("all");
  const [formOpen,      setFormOpen]      = useState(false);
  const [editTarget,    setEditTarget]    = useState<Material | null>(null);
  const [detailTarget,  setDetailTarget]  = useState<Material | null>(null);
  const [shareTarget,   setShareTarget]   = useState<Material | null>(null);
  const [reqDialogOpen, setReqDialogOpen] = useState(false);

  const params = new URLSearchParams();
  if (typeFilter   !== "all") params.set("type",   typeFilter);
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (search.trim())          params.set("search", search.trim());
  const qs = params.toString();

  const { data: materials = [], isLoading } = useQuery<Material[]>({
    queryKey: ["/api/capital/materials", qs],
    queryFn: () =>
      fetch(`/api/capital/materials${qs ? `?${qs}` : ""}`, { credentials: "include" }).then(r => r.json()),
    staleTime: 30_000,
  });

  const { data: requests = [] } = useQuery<MaterialRequest[]>({
    queryKey: ["/api/capital/material-requests"],
    queryFn: () => fetch("/api/capital/material-requests", { credentials: "include" }).then(r => r.json()),
    staleTime: 30_000,
  });

  const { data: portalStats = [] } = useQuery<{ material_id: number; portal_count: number }[]>({
    queryKey: ["/api/capital/portal-access/material-stats"],
    queryFn: () => fetch("/api/capital/portal-access/material-stats", { credentials: "include" }).then(r => r.json()),
    staleTime: 60_000,
  });
  const portalCountMap = new Map(portalStats.map(s => [s.material_id, s.portal_count]));

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/capital/materials/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capital/materials"] });
      toast({ title: "Material deleted" });
    },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const openRequests    = requests.filter(r => ["requested","in_progress","blocked"].includes(r.request_status));
  const overdueRequests = requests.filter(r =>
    r.due_at && new Date(r.due_at) < new Date() &&
    !["shared","waived","closed"].includes(r.request_status)
  );
  const noPitchDeck = !materials.some(m => m.material_type === "pitch_deck" && m.status === "active");

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto space-y-5" data-testid="capital-data-room">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-primary/10 rounded-lg shrink-0">
            <FolderOpen className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">Data Room</h1>
            <p className="text-xs text-muted-foreground">Fundraising materials tracker — Trevor &amp; Scott only</p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button size="sm" variant="outline" className="h-8 text-xs"
            onClick={() => setReqDialogOpen(true)} data-testid="btn-new-request">
            <ClipboardList className="w-3.5 h-3.5 mr-1" /> Log Request
          </Button>
          <Button size="sm" className="h-8 text-xs"
            onClick={() => setFormOpen(true)} data-testid="btn-add-material">
            <Plus className="w-3.5 h-3.5 mr-1" /> Add Material
          </Button>
        </div>
      </div>

      {/* ── Alert banners ── */}
      {noPitchDeck && materials.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3"
          data-testid="alert-no-pitch-deck">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          No active pitch deck in data room. Add one to track sharing with investors.
        </div>
      )}
      {overdueRequests.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3"
          data-testid="alert-overdue-requests">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {overdueRequests.length} overdue material request{overdueRequests.length > 1 ? "s" : ""}.
        </div>
      )}

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap gap-2 items-center" data-testid="filter-bar">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search materials…" className="pl-7 h-8 text-xs"
            data-testid="input-search-materials" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 text-xs w-44" data-testid="select-type-filter">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {MATERIAL_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 text-xs w-36" data-testid="select-status-filter">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {MATERIAL_STATUSES.map(s => (
              <SelectItem key={s} value={s}>
                {s.replace(/_/g," ").replace(/\b\w/g, c => c.toUpperCase())}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(typeFilter !== "all" || statusFilter !== "all" || search) && (
          <Button size="sm" variant="ghost" className="h-8 text-xs"
            onClick={() => { setSearch(""); setTypeFilter("all"); setStatusFilter("all"); }}>
            <X className="w-3.5 h-3.5 mr-1" /> Clear
          </Button>
        )}
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Materials",     value: materials.length, color: "" },
          { label: "Active",        value: materials.filter(m => m.status === "active").length, color: "text-emerald-400" },
          { label: "Open Requests", value: openRequests.length, color: openRequests.length > 0 ? "text-amber-400" : "" },
          { label: "Total Shares",  value: materials.reduce((s, m) => s + Number(m.share_count || 0), 0), color: "" },
          { label: "Total Views",   value: materials.reduce((s, m) => s + Number((m as any).total_views || (m as any).portal_views || 0), 0), color: "text-cyan-400" },
          // engagement + material_engagement: per-material view/download counts tracked via portal_events and material_shares
        ].map(stat => (
          <div key={stat.label} className="bg-card border border-border rounded-xl p-3 text-center"
            data-testid={`stat-${stat.label.toLowerCase().replace(/ /g,"-")}`}>
            <p className={`text-lg font-semibold ${stat.color}`}>{stat.value}</p>
            <p className="text-[10px] text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* ── Material Library ── */}
      <section data-testid="section-materials">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" /> Material Library
          <span className="text-xs text-muted-foreground font-normal">({materials.length})</span>
        </h2>

        {isLoading ? (
          <div className="text-xs text-muted-foreground py-8 text-center">Loading materials…</div>
        ) : materials.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-10 text-center space-y-3"
            data-testid="materials-empty">
            <FolderOpen className="w-8 h-8 mx-auto opacity-30" />
            <p className="text-sm text-muted-foreground">No materials yet.</p>
            <p className="text-xs text-muted-foreground/60">
              Add your first fundraising document to start tracking investor sharing.
            </p>
            <Button size="sm" onClick={() => setFormOpen(true)} data-testid="btn-add-material-empty">
              <Plus className="w-3.5 h-3.5 mr-1" /> Add Material
            </Button>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden"
            data-testid="material-library">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/20">
                    {["Material","Type","Version","Status","Shares","Portal Views","Last Shared","Round",""].map(h => (
                      <th key={h} className={`text-left px-3 py-2.5 text-[10px] text-muted-foreground font-medium ${h === "Shares" || h === "Portal Views" ? "text-right" : ""}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {materials.map(mat => (
                    <tr key={mat.id}
                      className="border-b border-border/50 hover:bg-muted/10 cursor-pointer transition-colors"
                      onClick={() => setDetailTarget(mat)}
                      data-testid={`material-row-${mat.id}`}>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium truncate max-w-[180px]">{mat.title}</p>
                            <div className="flex gap-1 mt-0.5">
                              {mat.is_confidential && <Lock className="w-2.5 h-2.5 text-muted-foreground" />}
                              {mat.requires_nda    && <ShieldAlert className="w-2.5 h-2.5 text-amber-400" />}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                        {typeLabel(mat.material_type)}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {mat.version_label ?? "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border ${statusColor(mat.status)}`}>
                          {mat.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium">
                        {mat.share_count ?? 0}
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium">
                        <div className="flex flex-col items-end gap-0.5">
                          {(portalCountMap.get(mat.id) ?? 0) > 0 ? (
                            <span className="flex items-center gap-0.5 text-cyan-400"
                              data-testid={`portal-views-${mat.id}`}>
                              <Eye className="w-2.5 h-2.5" />{portalCountMap.get(mat.id)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground" data-testid={`portal-views-${mat.id}`}>—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                        {fmtDateShort(mat.latest_shared_at)}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground truncate max-w-[100px]">
                        {mat.round_name ?? "—"}
                      </td>
                      <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0"
                              data-testid={`menu-material-${mat.id}`}>
                              <MoreHorizontal className="w-3 h-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setShareTarget(mat)}
                              data-testid={`btn-quick-share-${mat.id}`}>
                              <Share2 className="w-3.5 h-3.5 mr-2" /> Share
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setEditTarget(mat)}>
                              <Edit2 className="w-3.5 h-3.5 mr-2" /> Edit
                            </DropdownMenuItem>
                            {mat.external_url && (
                              <DropdownMenuItem asChild>
                                <a href={mat.external_url} target="_blank" rel="noopener noreferrer">
                                  <ExternalLink className="w-3.5 h-3.5 mr-2" /> Open link
                                </a>
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem className="text-red-400"
                              onClick={() => deleteMut.mutate(mat.id)}>
                              <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* ── Open Requests panel ── */}
      {openRequests.length > 0 && (
        <section data-testid="section-open-requests">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-amber-400" /> Open Material Requests
            <span className="text-xs text-muted-foreground font-normal">({openRequests.length})</span>
          </h2>
          <div className="space-y-2">
            {openRequests.slice(0, 6).map(r => (
              <div key={r.id}
                className="bg-card border border-border rounded-xl p-3 flex items-start gap-3"
                data-testid={`open-request-row-${r.id}`}>
                <ClipboardList className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium">{r.investor_name ?? "Unknown"}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${requestStatusColor(r.request_status)}`}>
                      {r.request_status.replace(/_/g," ")}
                    </span>
                    <span className={`text-[9px] ${priorityColor(r.priority)}`}>{r.priority}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {r.requested_title ?? typeLabel(r.requested_material_type ?? "other")}
                  </p>
                  {r.due_at && new Date(r.due_at) < new Date() && (
                    <p className="text-[10px] text-red-400">Overdue since {fmtDateShort(r.due_at)}</p>
                  )}
                  {r.due_at && new Date(r.due_at) >= new Date() && (
                    <p className="text-[10px] text-muted-foreground/60">Due {fmtDateShort(r.due_at)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Dialogs / Sheets ── */}
      {(formOpen || editTarget) && (
        <MaterialFormDialog
          existing={editTarget}
          onClose={() => { setFormOpen(false); setEditTarget(null); }}
        />
      )}
      {shareTarget && (
        <ShareMaterialDialog material={shareTarget} onClose={() => setShareTarget(null)} />
      )}
      {detailTarget && (
        <MaterialDetailSheet
          material={detailTarget}
          onClose={() => setDetailTarget(null)}
          onEdit={() => { setEditTarget(detailTarget); setDetailTarget(null); }}
        />
      )}
      {reqDialogOpen && <RequestDialog onClose={() => setReqDialogOpen(false)} />}
    </div>
  );
}
