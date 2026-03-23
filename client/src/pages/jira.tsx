import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Search, RefreshCw, Plus, ExternalLink, ChevronRight, Loader2, AlertTriangle, LayoutList } from "lucide-react";
import { SiJira } from "react-icons/si";

const SITE_URL = "https://voltsafe.atlassian.net";

type JiraProject = {
  id: string; key: string; name: string;
  avatarUrls?: { "48x48": string; "24x24": string };
  projectTypeKey?: string;
};

type JiraIssue = {
  id: string; key: string;
  fields: {
    summary: string;
    status: { name: string; statusCategory: { colorName: string; key: string; name: string } };
    priority: { name: string; iconUrl: string } | null;
    assignee: { displayName: string; avatarUrls: { "24x24": string; "32x32": string } } | null;
    updated: string;
    issuetype: { name: string; iconUrl: string };
    project: { key: string; name: string; avatarUrls?: { "24x24": string } };
    labels?: string[];
  };
};

function IssueTypeIcon({ iconUrl, name }: { iconUrl: string; name: string }) {
  const colorMap: Record<string, string> = {
    Bug: "bg-red-500", Story: "bg-green-500", Epic: "bg-purple-500",
    Task: "bg-blue-500", Subtask: "bg-sky-400", "Sub-task": "bg-sky-400",
  };
  const labelMap: Record<string, string> = {
    Bug: "B", Story: "S", Epic: "E", Task: "T", Subtask: "s",
  };
  const color = colorMap[name] || "bg-slate-500";
  const letter = labelMap[name] || name[0] || "?";
  if (iconUrl) {
    return <img src={iconUrl} alt={name} className="h-4 w-4 flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />;
  }
  return (
    <span className={`inline-flex items-center justify-center h-4 w-4 rounded-sm text-white text-[9px] font-bold flex-shrink-0 ${color}`}>
      {letter}
    </span>
  );
}

function PriorityIcon({ name, iconUrl }: { name: string; iconUrl: string }) {
  if (iconUrl) return <img src={iconUrl} alt={name} className="h-3.5 w-3.5 flex-shrink-0" title={name} />;
  const colors: Record<string, string> = { Highest: "text-red-500", High: "text-orange-400", Medium: "text-yellow-400", Low: "text-blue-400", Lowest: "text-slate-400" };
  return <span className={`text-[10px] font-bold ${colors[name] || "text-muted-foreground"}`} title={name}>{name[0]}</span>;
}

function StatusBadge({ status }: { status: JiraIssue["fields"]["status"] }) {
  const key = status.statusCategory.key;
  const styles: Record<string, string> = {
    new: "bg-slate-500/20 text-slate-300 border-slate-500/30",
    indeterminate: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    done: "bg-green-500/20 text-green-300 border-green-500/30",
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase tracking-wide whitespace-nowrap ${styles[key] || "bg-muted text-muted-foreground border-border"}`}>
      {status.name}
    </span>
  );
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function JiraPage() {
  const { toast } = useToast();
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ projectKey: "", summary: "", description: "", issueType: "Task" });
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");

  const projectsQuery = useQuery<{ values: JiraProject[] }>({
    queryKey: ["/api/jira/projects"],
    queryFn: async () => {
      const res = await fetch("/api/jira/projects", { credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to load projects");
      return res.json();
    },
  });

  useEffect(() => {
    const projects = projectsQuery.data?.values;
    if (projects && projects.length > 0 && !selectedProject) {
      setSelectedProject(projects[0].key);
    }
  }, [projectsQuery.data]);

  const issuesQuery = useQuery<{ issues: JiraIssue[]; isLast: boolean }>({
    queryKey: ["/api/jira/issues", selectedProject],
    enabled: !!selectedProject,
    queryFn: async () => {
      const res = await fetch(`/api/jira/issues?project=${selectedProject}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to load issues");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/jira/issues", form);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Issue created", description: `${data.key} — ${form.summary}` });
      queryClient.invalidateQueries({ queryKey: ["/api/jira/issues"] });
      setCreateOpen(false);
      setForm({ projectKey: "", summary: "", description: "", issueType: "Task" });
    },
    onError: (err: any) => toast({ title: "Failed to create issue", description: err.message, variant: "destructive" }),
  });

  const projects = projectsQuery.data?.values || [];
  const allIssues = issuesQuery.data?.issues || [];

  const filteredIssues = useMemo(() => {
    return allIssues.filter((issue) => {
      if (search && !issue.fields.summary.toLowerCase().includes(search.toLowerCase()) && !issue.key.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterStatus !== "all" && issue.fields.status.statusCategory.key !== filterStatus) return false;
      if (filterType !== "all" && issue.fields.issuetype.name !== filterType) return false;
      if (filterPriority !== "all" && issue.fields.priority?.name !== filterPriority) return false;
      return true;
    });
  }, [allIssues, search, filterStatus, filterType, filterPriority]);

  const uniqueTypes = useMemo(() => [...new Set(allIssues.map(i => i.fields.issuetype.name))].sort(), [allIssues]);
  const uniquePriorities = useMemo(() => [...new Set(allIssues.map(i => i.fields.priority?.name).filter(Boolean) as string[])].sort(), [allIssues]);

  const selectedProjectData = projects.find(p => p.key === selectedProject);
  const isConnected = !projectsQuery.error;

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Left: Project sidebar */}
      <div className="w-52 flex-shrink-0 border-r border-border/50 bg-card/30 flex flex-col overflow-hidden">
        <div className="px-3 py-2.5 border-b border-border/50 flex items-center gap-2">
          <SiJira className="h-4 w-4 text-[#0052CC] flex-shrink-0" />
          <span className="text-xs font-semibold text-foreground">Projects</span>
          <button
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => { queryClient.invalidateQueries({ queryKey: ["/api/jira/projects"] }); queryClient.invalidateQueries({ queryKey: ["/api/jira/issues"] }); }}
            data-testid="button-refresh-jira"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {projectsQuery.isLoading
            ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="px-3 py-2"><Skeleton className="h-4 w-full" /></div>)
            : projects.map((p) => (
              <button
                key={p.key}
                onClick={() => { setSelectedProject(p.key); setSearch(""); setFilterStatus("all"); setFilterType("all"); setFilterPriority("all"); }}
                data-testid={`project-${p.key}`}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors ${selectedProject === p.key ? "bg-[#0052CC]/10 border-l-2 border-[#0052CC]" : "border-l-2 border-transparent"}`}
              >
                {p.avatarUrls?.["24x24"]
                  ? <img src={p.avatarUrls["24x24"]} alt={p.name} className="h-5 w-5 rounded-sm flex-shrink-0" />
                  : <div className="h-5 w-5 rounded-sm bg-[#0052CC] flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">{p.key[0]}</div>
                }
                <span className={`text-xs truncate ${selectedProject === p.key ? "text-foreground font-medium" : "text-muted-foreground"}`}>{p.name}</span>
              </button>
            ))
          }
        </div>
        {isConnected && (
          <div className="p-2 border-t border-border/50">
            <a href={SITE_URL} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              data-testid="link-jira-open">
              <ExternalLink className="h-3 w-3" /> Open in Jira
            </a>
          </div>
        )}
      </div>

      {/* Right: Issue list */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!isConnected && !projectsQuery.isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
            <SiJira className="h-14 w-14 text-[#0052CC] opacity-30" />
            <p className="text-lg font-semibold">Jira not connected</p>
            <p className="text-sm text-muted-foreground max-w-sm">{(projectsQuery.error as Error)?.message}</p>
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div className="flex-shrink-0 px-4 py-2.5 border-b border-border/50 bg-card/20">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {selectedProjectData?.avatarUrls?.["24x24"]
                    ? <img src={selectedProjectData.avatarUrls["24x24"]} alt="" className="h-5 w-5 rounded-sm flex-shrink-0" />
                    : <div className="h-5 w-5 rounded-sm bg-[#0052CC] flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">{selectedProject[0]}</div>
                  }
                  <h2 className="font-semibold text-sm truncate">{selectedProjectData?.name || selectedProject}</h2>
                  <span className="text-xs text-muted-foreground font-mono">{selectedProject}</span>
                  <span className="text-xs text-muted-foreground">·</span>
                  <LayoutList className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">List</span>
                </div>
                <Button size="sm" onClick={() => { setForm(f => ({ ...f, projectKey: selectedProject })); setCreateOpen(true); }} data-testid="button-create-issue"
                  className="bg-[#0052CC] hover:bg-[#0747A6] text-white flex-shrink-0">
                  <Plus className="h-3.5 w-3.5 mr-1" /> Create
                </Button>
              </div>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <div className="relative flex-1 min-w-40 max-w-xs">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search issues..."
                    className="pl-8 h-7 text-xs bg-background/50" data-testid="input-search-issues" />
                </div>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="h-7 text-xs w-32" data-testid="filter-status"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="new">To Do</SelectItem>
                    <SelectItem value="indeterminate">In Progress</SelectItem>
                    <SelectItem value="done">Done</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="h-7 text-xs w-32" data-testid="filter-type"><SelectValue placeholder="Type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {uniqueTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={filterPriority} onValueChange={setFilterPriority}>
                  <SelectTrigger className="h-7 text-xs w-32" data-testid="filter-priority"><SelectValue placeholder="Priority" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All priorities</SelectItem>
                    {uniquePriorities.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
                {(search || filterStatus !== "all" || filterType !== "all" || filterPriority !== "all") && (
                  <button onClick={() => { setSearch(""); setFilterStatus("all"); setFilterType("all"); setFilterPriority("all"); }}
                    className="text-xs text-[#0052CC] hover:underline">Clear filters</button>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {issuesQuery.isLoading ? "Loading..." : `${filteredIssues.length} issue${filteredIssues.length !== 1 ? "s" : ""}`}
                </span>
              </div>
            </div>

            {/* Column headers */}
            <div className="flex-shrink-0 flex items-center px-4 py-1.5 border-b border-border/50 bg-muted/20 text-[11px] text-muted-foreground font-medium uppercase tracking-wide gap-2">
              <span className="w-5 flex-shrink-0" />
              <span className="w-24 flex-shrink-0">Key</span>
              <span className="flex-1 min-w-0">Summary</span>
              <span className="w-28 flex-shrink-0 text-center">Status</span>
              <span className="w-20 flex-shrink-0 text-center">Priority</span>
              <span className="w-28 flex-shrink-0">Assignee</span>
              <span className="w-24 flex-shrink-0 text-right">Updated</span>
              <span className="w-6 flex-shrink-0" />
            </div>

            {/* Issue rows */}
            <div className="flex-1 overflow-y-auto">
              {issuesQuery.isLoading && (
                <div className="divide-y divide-border/30">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-2 px-4 py-2.5">
                      <Skeleton className="h-4 w-4 rounded-sm" />
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className="h-3 flex-1" />
                      <Skeleton className="h-5 w-20 rounded" />
                      <Skeleton className="h-3 w-14" />
                      <Skeleton className="h-5 w-5 rounded-full" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  ))}
                </div>
              )}
              {issuesQuery.error && (
                <div className="flex flex-col items-center justify-center p-12 gap-3 text-center">
                  <AlertTriangle className="h-8 w-8 text-muted-foreground opacity-40" />
                  <p className="text-sm text-muted-foreground">{(issuesQuery.error as Error).message}</p>
                </div>
              )}
              {!issuesQuery.isLoading && !issuesQuery.error && filteredIssues.length === 0 && (
                <div className="flex flex-col items-center justify-center p-12 gap-2 text-center">
                  <LayoutList className="h-8 w-8 text-muted-foreground opacity-30" />
                  <p className="text-sm text-muted-foreground">{search || filterStatus !== "all" || filterType !== "all" || filterPriority !== "all" ? "No issues match your filters" : "No issues in this project"}</p>
                </div>
              )}
              <div className="divide-y divide-border/20">
                {filteredIssues.map((issue) => (
                  <a
                    key={issue.id}
                    href={`${SITE_URL}/browse/${issue.key}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid={`issue-row-${issue.key}`}
                    className="flex items-center gap-2 px-4 py-2 hover:bg-muted/30 transition-colors group cursor-pointer"
                  >
                    <div className="w-5 flex-shrink-0 flex items-center justify-center">
                      <IssueTypeIcon iconUrl={issue.fields.issuetype.iconUrl} name={issue.fields.issuetype.name} />
                    </div>
                    <span className="w-24 flex-shrink-0 text-xs text-muted-foreground font-mono group-hover:text-[#0052CC] transition-colors">{issue.key}</span>
                    <span className="flex-1 min-w-0 text-sm truncate group-hover:text-foreground">{issue.fields.summary}</span>
                    <div className="w-28 flex-shrink-0 flex justify-center">
                      <StatusBadge status={issue.fields.status} />
                    </div>
                    <div className="w-20 flex-shrink-0 flex items-center justify-center gap-1">
                      {issue.fields.priority
                        ? <PriorityIcon name={issue.fields.priority.name} iconUrl={issue.fields.priority.iconUrl} />
                        : <span className="text-[10px] text-muted-foreground">—</span>}
                    </div>
                    <div className="w-28 flex-shrink-0 flex items-center gap-1.5 overflow-hidden">
                      {issue.fields.assignee ? (
                        <>
                          <img src={issue.fields.assignee.avatarUrls?.["24x24"]} alt="" className="h-5 w-5 rounded-full flex-shrink-0" />
                          <span className="text-xs text-muted-foreground truncate">{issue.fields.assignee.displayName.split(" ")[0]}</span>
                        </>
                      ) : <span className="text-xs text-muted-foreground">Unassigned</span>}
                    </div>
                    <span className="w-24 flex-shrink-0 text-right text-xs text-muted-foreground">{timeAgo(issue.fields.updated)}</span>
                    <div className="w-6 flex-shrink-0 flex items-center justify-center">
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </a>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Create Issue Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SiJira className="h-4 w-4 text-[#0052CC]" /> Create Issue
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block">Project</Label>
                <Select value={form.projectKey} onValueChange={(v) => setForm((f) => ({ ...f, projectKey: v }))}>
                  <SelectTrigger data-testid="select-project"><SelectValue placeholder="Select project..." /></SelectTrigger>
                  <SelectContent>{projects.map((p) => <SelectItem key={p.key} value={p.key}>{p.name} ({p.key})</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Issue Type</Label>
                <Select value={form.issueType} onValueChange={(v) => setForm((f) => ({ ...f, issueType: v }))}>
                  <SelectTrigger data-testid="select-issue-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Task">Task</SelectItem>
                    <SelectItem value="Bug">Bug</SelectItem>
                    <SelectItem value="Story">Story</SelectItem>
                    <SelectItem value="Epic">Epic</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Summary *</Label>
              <Input value={form.summary} onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
                placeholder="Brief description of the issue" data-testid="input-issue-summary" />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Detailed description..." rows={4} data-testid="input-issue-description" />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button className="flex-1 bg-[#0052CC] hover:bg-[#0747A6]"
                disabled={!form.projectKey || !form.summary || createMutation.isPending}
                onClick={() => createMutation.mutate()} data-testid="button-submit-issue">
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Create Issue
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
