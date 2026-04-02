import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus, Layers, Anchor, Handshake, Landmark, FlaskConical,
  CalendarDays, Megaphone, Users2, Building2, Clock, Star,
} from "lucide-react";

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

type Project = {
  id: number;
  name: string;
  type: string;
  status: string;
  owner: string;
  account?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
};

const SAMPLE_PROJECTS: Project[] = [
  {
    id: 1,
    name: "RVYC Jericho Pilot",
    type: "pilot",
    status: "active",
    owner: "Trevor",
    account: "RVYC",
    description: "Pilot data collection and results — white paper. Innovate BC grant reporting.",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
  },
];

export default function ProjectsPage() {
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>(SAMPLE_PROJECTS);
  const [selected, setSelected] = useState<Project | null>(null);

  const filtered = projects.filter(p => {
    if (typeFilter !== "all" && p.type !== typeFilter) return false;
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-5 border-b border-border/50">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Projects</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Coordinated workstreams and internal initiatives</p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground h-9" data-testid="button-create-project">
                <Plus className="w-4 h-4 mr-2" />New Project
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>New Project</DialogTitle></DialogHeader>
              <CreateProjectForm
                onSubmit={(d) => {
                  const newProject: Project = { ...d, id: Date.now() };
                  setProjects(prev => [...prev, newProject]);
                  setCreateOpen(false);
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        {/* Type cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {PROJECT_TYPES.map(type => {
            const count = projects.filter(p => p.type === type.key).length;
            const TypeIcon = type.icon;
            const isActive = typeFilter === type.key;
            return (
              <button
                key={type.key}
                onClick={() => setTypeFilter(isActive ? "all" : type.key)}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all text-center ${
                  isActive
                    ? `${type.bg} ${type.border} border`
                    : "bg-secondary/10 border-border/30 hover:border-border/60 hover:bg-secondary/20"
                }`}
                data-testid={`filter-type-${type.key}`}
              >
                <TypeIcon className={`w-4 h-4 ${isActive ? type.color : "text-muted-foreground"}`} />
                <span className={`text-[10px] font-medium leading-tight ${isActive ? type.color : "text-muted-foreground"}`}>{type.label}</span>
                {count > 0 && <span className={`text-xs font-bold ${isActive ? type.color : "text-foreground"}`}>{count}</span>}
              </button>
            );
          })}
        </div>

        {/* Status filter */}
        <div className="flex gap-2 items-center">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 h-9 bg-secondary/30 border-transparent" data-testid="select-status-filter">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="planning">Planning</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">{filtered.length} project{filtered.length !== 1 ? "s" : ""}</span>
        </div>

        {/* Projects grid */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-border/40 rounded-xl">
            <Layers className="w-12 h-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground font-medium">No projects yet</p>
            <p className="text-muted-foreground/60 text-sm mt-1">Create your first project to track strategic initiatives</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => setCreateOpen(true)}>
              <Plus className="w-3.5 h-3.5 mr-1.5" />New Project
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map(project => {
              const typeConfig = PROJECT_TYPES.find(t => t.key === project.type) || PROJECT_TYPES[7];
              const TypeIcon = typeConfig.icon;
              return (
                <Card
                  key={project.id}
                  className="border-border/50 hover:border-border/80 bg-card/50 cursor-pointer transition-all hover:bg-card/80"
                  onClick={() => setSelected(project)}
                  data-testid={`project-card-${project.id}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3 mb-3">
                      <div className={`w-9 h-9 rounded-lg ${typeConfig.bg} border ${typeConfig.border} flex items-center justify-center shrink-0`}>
                        <TypeIcon className={`w-4 h-4 ${typeConfig.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{project.name}</p>
                        <p className="text-xs text-muted-foreground">{typeConfig.label}</p>
                      </div>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 capitalize shrink-0 ${STATUS_COLORS[project.status] || ""}`}>
                        {project.status}
                      </Badge>
                    </div>
                    {project.description && (
                      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 mb-3">{project.description}</p>
                    )}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {project.account && (
                        <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{project.account}</span>
                      )}
                      <span className="flex items-center gap-1"><Users2 className="w-3 h-3" />{project.owner}</span>
                      {project.endDate && (
                        <span className="flex items-center gap-1 ml-auto"><Clock className="w-3 h-3" />{new Date(project.endDate).toLocaleDateString()}</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {selected && (
        <ProjectDetailDialog project={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function ProjectDetailDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const typeConfig = PROJECT_TYPES.find(t => t.key === project.type) || PROJECT_TYPES[7];
  const TypeIcon = typeConfig.icon;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg ${typeConfig.bg} border ${typeConfig.border} flex items-center justify-center shrink-0`}>
              <TypeIcon className={`w-4 h-4 ${typeConfig.color}`} />
            </div>
            <div>
              <DialogTitle className="text-base">{project.name}</DialogTitle>
              <p className="text-xs text-muted-foreground">{typeConfig.label}</p>
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-secondary/20 rounded-lg p-3">
              <p className="text-xs text-muted-foreground">Status</p>
              <Badge variant="outline" className={`mt-1 text-xs capitalize ${STATUS_COLORS[project.status] || ""}`}>{project.status}</Badge>
            </div>
            <div className="bg-secondary/20 rounded-lg p-3">
              <p className="text-xs text-muted-foreground">Owner</p>
              <p className="text-sm font-medium mt-0.5">{project.owner}</p>
            </div>
            {project.account && (
              <div className="bg-secondary/20 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">Account</p>
                <p className="text-sm font-medium mt-0.5">{project.account}</p>
              </div>
            )}
            {project.endDate && (
              <div className="bg-secondary/20 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">Target Date</p>
                <p className="text-sm font-medium mt-0.5">{new Date(project.endDate).toLocaleDateString()}</p>
              </div>
            )}
          </div>
          {project.description && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Description</p>
              <p className="text-sm leading-relaxed">{project.description}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateProjectForm({ onSubmit }: { onSubmit: (d: any) => void }) {
  const [form, setForm] = useState({ name: "", type: "pilot", status: "planning", owner: "", account: "", description: "", endDate: "" });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }} className="space-y-4">
      <div><Label>Project Name *</Label><Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} required className="mt-1.5" data-testid="input-project-name" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Type</Label>
          <Select value={form.type} onValueChange={(v) => setForm(f => ({ ...f, type: v }))}>
            <SelectTrigger className="mt-1.5" data-testid="select-project-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PROJECT_TYPES.map(t => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Status</Label>
          <Select value={form.status} onValueChange={(v) => setForm(f => ({ ...f, status: v }))}>
            <SelectTrigger className="mt-1.5" data-testid="select-project-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="planning">Planning</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Owner</Label><Input value={form.owner} onChange={(e) => setForm(f => ({ ...f, owner: e.target.value }))} className="mt-1.5" data-testid="input-project-owner" /></div>
        <div><Label>Account</Label><Input value={form.account} onChange={(e) => setForm(f => ({ ...f, account: e.target.value }))} className="mt-1.5" placeholder="Optional" data-testid="input-project-account" /></div>
      </div>
      <div><Label>Target Date</Label><Input type="date" value={form.endDate} onChange={(e) => setForm(f => ({ ...f, endDate: e.target.value }))} className="mt-1.5" data-testid="input-project-date" /></div>
      <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} rows={3} className="mt-1.5" data-testid="input-project-description" /></div>
      <Button type="submit" className="w-full bg-primary text-primary-foreground" data-testid="button-submit-project">Create Project</Button>
    </form>
  );
}
