import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  CheckSquare, AlertCircle, RefreshCw, Plus, ExternalLink,
  ChevronDown, User, Clock, Loader2,
} from "lucide-react";
import { SiJira } from "react-icons/si";

type JiraProject = {
  id: string;
  key: string;
  name: string;
  avatarUrls?: { "48x48": string };
};

type JiraIssue = {
  id: string;
  key: string;
  self: string;
  fields: {
    summary: string;
    status: { name: string; statusCategory: { colorName: string } };
    priority: { name: string; iconUrl: string } | null;
    assignee: { displayName: string; avatarUrls: { "24x24": string } } | null;
    updated: string;
    issuetype: { name: string; iconUrl: string };
    project: { key: string; name: string };
  };
};

function statusColor(colorName: string) {
  if (colorName === "green") return "text-green-400 bg-green-400/10 border-green-400/20";
  if (colorName === "blue-grey") return "text-sky-400 bg-sky-400/10 border-sky-400/20";
  if (colorName === "yellow") return "text-yellow-400 bg-yellow-400/10 border-yellow-400/20";
  return "text-muted-foreground bg-muted border-border";
}

function priorityColor(name: string) {
  if (name === "Highest" || name === "High") return "text-red-400";
  if (name === "Medium") return "text-yellow-400";
  return "text-muted-foreground";
}

function timeAgo(dateStr: string) {
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function JiraPage() {
  const { toast } = useToast();
  const [selectedProject, setSelectedProject] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ projectKey: "", summary: "", description: "", issueType: "Task" });

  const projectsQuery = useQuery<{ values: JiraProject[] }>({
    queryKey: ["/api/jira/projects"],
    queryFn: async () => {
      const res = await fetch("/api/jira/projects", { credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to load projects");
      return res.json();
    },
  });

  const issuesQuery = useQuery<{ issues: JiraIssue[]; total: number }>({
    queryKey: ["/api/jira/issues", selectedProject],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedProject !== "all") params.set("project", selectedProject);
      const res = await fetch(`/api/jira/issues?${params}`, { credentials: "include" });
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
  const issues = issuesQuery.data?.issues || [];
  const isConnected = !projectsQuery.error;

  const getSiteUrl = () => {
    const p = projects[0];
    if (!p) return "https://id.atlassian.com";
    return `https://${new URL((p as any).self || "https://id.atlassian.com").hostname}`;
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      <div className="flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-border/50 bg-card/50 flex-shrink-0">
        <SiJira className="h-5 w-5 text-[#0052CC]" />
        <div>
          <h1 className="text-lg font-bold leading-tight" data-testid="text-page-title">Jira</h1>
          <p className="text-xs text-muted-foreground">
            {projectsQuery.isLoading ? "Loading..." : isConnected ? `${projects.length} project${projects.length !== 1 ? "s" : ""}` : "Not connected"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isConnected && (
            <a
              href={getSiteUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              data-testid="link-jira-open"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open Jira
            </a>
          )}
          <Button
            size="icon"
            variant="ghost"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/jira/projects"] });
              queryClient.invalidateQueries({ queryKey: ["/api/jira/issues"] });
            }}
            data-testid="button-refresh-jira"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          {isConnected && (
            <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="button-create-issue">
              <Plus className="h-4 w-4 mr-1" /> New Issue
            </Button>
          )}
        </div>
      </div>

      {!isConnected && !projectsQuery.isLoading && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
          <SiJira className="h-12 w-12 text-[#0052CC] opacity-50" />
          <p className="text-lg font-semibold">Jira not connected</p>
          <p className="text-sm text-muted-foreground max-w-sm">{(projectsQuery.error as Error)?.message}</p>
        </div>
      )}

      {isConnected && (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          {/* Project filter bar */}
          <div className="flex-shrink-0 px-4 sm:px-6 py-2 border-b border-border/50 flex items-center gap-3 bg-background/50">
            <span className="text-xs text-muted-foreground font-medium">Project:</span>
            <div className="flex gap-1 flex-wrap">
              <button
                onClick={() => setSelectedProject("all")}
                data-testid="filter-project-all"
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${selectedProject === "all" ? "bg-primary/10 border-primary/30 text-primary" : "border-border/50 text-muted-foreground hover:border-border"}`}
              >
                All assigned
              </button>
              {projectsQuery.isLoading
                ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-6 w-20 rounded-full" />)
                : projects.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setSelectedProject(p.key)}
                    data-testid={`filter-project-${p.key}`}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${selectedProject === p.key ? "bg-primary/10 border-primary/30 text-primary" : "border-border/50 text-muted-foreground hover:border-border"}`}
                  >
                    {p.name}
                  </button>
                ))}
            </div>
            <span className="ml-auto text-xs text-muted-foreground">
              {issuesQuery.data ? `${issuesQuery.data.total} issue${issuesQuery.data.total !== 1 ? "s" : ""}` : ""}
            </span>
          </div>

          {/* Issues list */}
          <div className="flex-1 overflow-y-auto">
            {issuesQuery.isLoading && (
              <div className="p-4 space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-border/40">
                    <Skeleton className="h-4 w-4 rounded" />
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                ))}
              </div>
            )}
            {issuesQuery.error && (
              <div className="p-8 text-center">
                <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm text-muted-foreground">{(issuesQuery.error as Error).message}</p>
              </div>
            )}
            {!issuesQuery.isLoading && !issuesQuery.error && issues.length === 0 && (
              <div className="p-8 text-center">
                <CheckSquare className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm text-muted-foreground">No issues found</p>
              </div>
            )}
            {issues.map((issue) => (
              <div
                key={issue.id}
                className="flex items-start gap-3 px-4 sm:px-6 py-3 border-b border-border/30 hover:bg-muted/30 transition-colors group"
                data-testid={`issue-row-${issue.key}`}
              >
                <div className="mt-0.5 flex-shrink-0">
                  {issue.fields.issuetype?.iconUrl ? (
                    <img src={issue.fields.issuetype.iconUrl} alt={issue.fields.issuetype.name} className="h-4 w-4" />
                  ) : (
                    <CheckSquare className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground font-mono flex-shrink-0">{issue.key}</span>
                    <span className="text-sm leading-snug">{issue.fields.summary}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${statusColor(issue.fields.status.statusCategory.colorName)}`}>
                      {issue.fields.status.name}
                    </span>
                    {issue.fields.priority && (
                      <span className={`text-[11px] flex items-center gap-1 ${priorityColor(issue.fields.priority.name)}`}>
                        <AlertCircle className="h-3 w-3" />
                        {issue.fields.priority.name}
                      </span>
                    )}
                    {issue.fields.assignee && (
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {issue.fields.assignee.displayName}
                      </span>
                    )}
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1 ml-auto">
                      <Clock className="h-3 w-3" />
                      {timeAgo(issue.fields.updated)}
                    </span>
                  </div>
                </div>
                <a
                  href={`${getSiteUrl()}/browse/${issue.key}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5"
                  data-testid={`link-issue-${issue.key}`}
                >
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create Issue Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Jira Issue</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs mb-1.5 block">Project</Label>
              <Select value={form.projectKey} onValueChange={(v) => setForm((f) => ({ ...f, projectKey: v }))}>
                <SelectTrigger data-testid="select-project">
                  <SelectValue placeholder="Select project..." />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.key} value={p.key}>{p.name} ({p.key})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Issue Type</Label>
              <Select value={form.issueType} onValueChange={(v) => setForm((f) => ({ ...f, issueType: v }))}>
                <SelectTrigger data-testid="select-issue-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Task">Task</SelectItem>
                  <SelectItem value="Bug">Bug</SelectItem>
                  <SelectItem value="Story">Story</SelectItem>
                  <SelectItem value="Epic">Epic</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Summary *</Label>
              <Input
                value={form.summary}
                onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
                placeholder="Brief description of the issue"
                data-testid="input-issue-summary"
              />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Detailed description..."
                rows={4}
                data-testid="input-issue-description"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button
                className="flex-1"
                disabled={!form.projectKey || !form.summary || createMutation.isPending}
                onClick={() => createMutation.mutate()}
                data-testid="button-submit-issue"
              >
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
