import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NotesPanel } from "@/components/notes-panel";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Layers, Anchor, Handshake, Landmark, FlaskConical,
  CalendarDays, Megaphone, Star, Pencil, Trash2, Building2, DollarSign,
} from "lucide-react";
import type { Project } from "@shared/schema";

const PROJECT_TYPES = [
  { key: "pilot", label: "Pilot", icon: Anchor, color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/20" },
  { key: "lighthouse", label: "Lighthouse", icon: Star, color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20" },
  { key: "partnership", label: "Partnership", icon: Handshake, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
  { key: "grant", label: "Grant", icon: Landmark, color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/20" },
  { key: "research", label: "Research", icon: FlaskConical, color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20" },
  { key: "event", label: "Event", icon: CalendarDays, color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20" },
  { key: "marketing", label: "Marketing / Content", icon: Megaphone, color: "text-pink-400", bg: "bg-pink-500/10", border: "border-pink-500/20" },
  { key: "internal", label: "Internal Initiative", icon: Layers, color: "text-slate-400", bg: "bg-slate-500/10", border: "border-slate-500/20" },
];

const STATUS_COLORS: Record<string, string> = {
  planning: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  active: "bg-green-500/10 text-green-400 border-green-500/20",
  paused: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  completed: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  cancelled: "bg-red-500/10 text-red-400 border-red-500/20",
};

function getTypeConfig(type: string) {
  return PROJECT_TYPES.find(t => t.key === type) || PROJECT_TYPES[PROJECT_TYPES.length - 1];
}

export default function ProjectsPage() {
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Project | null>(null);
  const { toast } = useToast();

  const { data: projectsData, isLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects", { type: typeFilter, status: statusFilter }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/projects?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  const allProjects = projectsData || [];

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/projects/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Project deleted" });
      setSelected(null);
    },
  });

  const typeCounts = PROJECT_TYPES.reduce((acc, t) => {
    acc[t.key] = allProjects.filter(p => p.type === t.key).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-5 border-b border-border/50">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Projects</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Coordinated workstreams and internal initiatives · {allProjects.length} total</p>
          </div>
          <Button
            className="bg-primary text-primary-foreground shrink-0"
            onClick={() => setCreateOpen(true)}
            data-testid="button-create-project"
          >
            <Plus className="h-4 w-4 mr-2" /> New Project
          </Button>
        </div>
      </div>

      <div className="px-6 py-4 border-b border-border/30">
        <div className="flex flex-wrap gap-1.5 mb-3">
          <button
            onClick={() => setTypeFilter("all")}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${typeFilter === "all" ? "bg-primary/20 text-primary border-primary/30" : "border-border/50 text-muted-foreground hover:border-border"}`}
            data-testid="filter-type-all"
          >
            All Types ({allProjects.length})
          </button>
          {PROJECT_TYPES.map(t => (
            <button
              key={t.key}
              onClick={() => setTypeFilter(t.key === typeFilter ? "all" : t.key)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${typeFilter === t.key ? `${t.bg} ${t.color} ${t.border}` : "border-border/50 text-muted-foreground hover:border-border"}`}
              data-testid={`filter-type-${t.key}`}
            >
              {t.label} {typeCounts[t.key] > 0 && `(${typeCounts[t.key]})`}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-40 text-xs" data-testid="select-status-filter">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="planning">Planning</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-36" />)}
          </div>
        ) : allProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Layers className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-medium text-muted-foreground mb-2">No projects yet</h3>
            <p className="text-sm text-muted-foreground/70 mb-4">Create your first project to track pilots, grants, partnerships and more</p>
            <Button onClick={() => setCreateOpen(true)} data-testid="button-empty-create">
              <Plus className="h-4 w-4 mr-2" /> New Project
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {allProjects.map(project => {
              const typeConfig = getTypeConfig(project.type);
              const Icon = typeConfig.icon;
              return (
                <Card
                  key={project.id}
                  className="border-border/50 hover:border-border cursor-pointer transition-all hover:shadow-md group"
                  onClick={() => setSelected(project)}
                  data-testid={`card-project-${project.id}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className={`w-8 h-8 rounded-lg ${typeConfig.bg} ${typeConfig.border} border flex items-center justify-center shrink-0`}>
                        <Icon className={`h-4 w-4 ${typeConfig.color}`} />
                      </div>
                      <Badge variant="outline" className={`text-[11px] px-1.5 py-0 ${STATUS_COLORS[project.status] || ""}`}>
                        {project.status}
                      </Badge>
                    </div>
                    <h3 className="font-semibold text-sm leading-tight mb-1">{project.name}</h3>
                    {project.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{project.description}</p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap mt-2">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${typeConfig.bg} ${typeConfig.color} ${typeConfig.border}`}>
                        {typeConfig.label}
                      </span>
                      {project.phase && (
                        <span className="text-[10px] text-muted-foreground">Phase: {project.phase}</span>
                      )}
                    </div>
                    {(project.startDate || project.endDate) && (
                      <p className="text-[10px] text-muted-foreground mt-2">
                        {project.startDate ? new Date(project.startDate).getFullYear() : "?"} – {project.endDate ? new Date(project.endDate).getFullYear() : "ongoing"}
                      </p>
                    )}
                    {project.budget && (
                      <div className="flex items-center gap-1 mt-1.5">
                        <DollarSign className="h-3 w-3 text-green-400" />
                        <span className="text-xs text-green-400">{Number(project.budget).toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {createOpen && (
        <ProjectFormDialog onClose={() => setCreateOpen(false)} />
      )}

      {selected && (
        <ProjectDetailDialog
          project={selected}
          onClose={() => setSelected(null)}
          onDelete={() => deleteMutation.mutate(selected.id)}
          onRefresh={(updated) => setSelected(updated)}
        />
      )}
    </div>
  );
}

function ProjectFormDialog({ project, onClose }: { project?: Project; onClose: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(project?.name || "");
  const [type, setType] = useState(project?.type || "pilot");
  const [status, setStatus] = useState(project?.status || "planning");
  const [phase, setPhase] = useState(project?.phase || "");
  const [description, setDescription] = useState(project?.description || "");
  const [budget, setBudget] = useState(project?.budget ? String(project.budget) : "");
  const [currency, setCurrency] = useState(project?.currency || "USD");
  const [startDate, setStartDate] = useState(project?.startDate ? new Date(project.startDate).toISOString().split("T")[0] : "");
  const [endDate, setEndDate] = useState(project?.endDate ? new Date(project.endDate).toISOString().split("T")[0] : "");

  const mutation = useMutation({
    mutationFn: async (d: Record<string, unknown>) => {
      if (project) {
        const res = await apiRequest("PUT", `/api/projects/${project.id}`, d);
        return res.json();
      }
      const res = await apiRequest("POST", "/api/projects", d);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: project ? "Project updated" : "Project created" });
      onClose();
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  const handleSubmit = () => {
    if (!name.trim()) return;
    mutation.mutate({
      name: name.trim(),
      type,
      status,
      phase: phase || undefined,
      description: description || undefined,
      budget: budget ? Number(budget) : undefined,
      currency,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{project ? "Edit Project" : "New Project"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Project Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} className="mt-1" placeholder="e.g. RVYC Jericho Pilot" data-testid="input-project-name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="mt-1 h-8 text-sm" data-testid="select-project-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROJECT_TYPES.map(t => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="mt-1 h-8 text-sm" data-testid="select-project-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="planning">Planning</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Phase</Label>
            <Input value={phase} onChange={e => setPhase(e.target.value)} className="mt-1 h-8 text-sm" placeholder="e.g. Data collection" data-testid="input-project-phase" />
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="mt-1 text-sm" placeholder="What is this project about?" data-testid="input-project-description" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Budget</Label>
              <Input value={budget} onChange={e => setBudget(e.target.value)} type="number" className="mt-1 h-8 text-sm" placeholder="0" data-testid="input-project-budget" />
            </div>
            <div>
              <Label className="text-xs">Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="CAD">CAD</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Start Date</Label>
              <Input value={startDate} onChange={e => setStartDate(e.target.value)} type="date" className="mt-1 h-8 text-sm" data-testid="input-project-start" />
            </div>
            <div>
              <Label className="text-xs">End Date</Label>
              <Input value={endDate} onChange={e => setEndDate(e.target.value)} type="date" className="mt-1 h-8 text-sm" data-testid="input-project-end" />
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={!name.trim() || mutation.isPending} data-testid="button-save-project">
              {mutation.isPending ? "Saving..." : project ? "Update" : "Create Project"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProjectDetailDialog({ project, onClose, onDelete, onRefresh }: {
  project: Project;
  onClose: () => void;
  onDelete: () => void;
  onRefresh: (p: Project) => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState("overview");
  const typeConfig = getTypeConfig(project.type);
  const Icon = typeConfig.icon;

  const updateMutation = useMutation({
    mutationFn: async (d: Partial<Project>) => {
      const res = await apiRequest("PUT", `/api/projects/${project.id}`, d);
      return res.json();
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      onRefresh(updated);
    },
  });

  return (
    <>
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl ${typeConfig.bg} ${typeConfig.border} border flex items-center justify-center`}>
                  <Icon className={`h-5 w-5 ${typeConfig.color}`} />
                </div>
                <div>
                  <DialogTitle className="text-xl">{project.name}</DialogTitle>
                  <p className={`text-xs mt-0.5 ${typeConfig.color}`}>{typeConfig.label}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setEditOpen(true)} data-testid="button-edit-project">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={onDelete} data-testid="button-delete-project">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </DialogHeader>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4 mt-3">
              <div className="flex gap-2 flex-wrap">
                <Badge variant="outline" className={STATUS_COLORS[project.status] || ""}>{project.status}</Badge>
                {project.phase && <Badge variant="outline" className="text-muted-foreground">{project.phase}</Badge>}
              </div>

              {project.description && (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{project.description}</p>
              )}

              <Separator />

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {project.budget && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Budget</Label>
                    <div className="flex items-center gap-1 mt-1">
                      <DollarSign className="h-3.5 w-3.5 text-green-400" />
                      <p className="text-sm font-medium">{Number(project.budget).toLocaleString()} {project.currency}</p>
                    </div>
                  </div>
                )}
                {project.startDate && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Start</Label>
                    <p className="text-sm mt-1">{new Date(project.startDate).toLocaleDateString()}</p>
                  </div>
                )}
                {project.endDate && (
                  <div>
                    <Label className="text-xs text-muted-foreground">End</Label>
                    <p className="text-sm mt-1">{new Date(project.endDate).toLocaleDateString()}</p>
                  </div>
                )}
              </div>

              <div className="mt-2">
                <Label className="text-xs text-muted-foreground">Status</Label>
                <Select value={project.status} onValueChange={(v) => updateMutation.mutate({ status: v })}>
                  <SelectTrigger className="mt-1 h-8 w-40 text-sm" data-testid="select-detail-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="planning">Planning</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>

            <TabsContent value="notes" className="mt-3">
              <NotesPanel linkedObjectType="project" linkedObjectId={project.id} />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {editOpen && (
        <ProjectFormDialog project={project} onClose={() => setEditOpen(false)} />
      )}
    </>
  );
}
