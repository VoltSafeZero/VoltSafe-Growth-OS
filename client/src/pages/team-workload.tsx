import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronRight,
  Anchor,
  Building2,
  ListTodo,
} from "lucide-react";
import type { Task } from "@shared/schema";

type TeamMember = {
  userId: number;
  userName: string;
  userEmail: string;
  assignedLeads: number;
  assignedAccounts: number;
  openTasks: number;
  overdueTasks: number;
  tasks: Task[];
  leadsList: { id: number; company: string; status: string; dueDate: string | null }[];
  accountsList: { id: number; name: string; nextAction: string | null; nextActionAt: string | null }[];
};

function getInitials(name: string): string {
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

function formatDate(d: string | Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}

function isOverdue(d: string | Date | null): boolean {
  if (!d) return false;
  return new Date(d) < new Date();
}

const priorityColors: Record<string, string> = {
  high: "text-red-400",
  medium: "text-amber-400",
  low: "text-slate-400",
};

export default function TeamWorkloadPage() {
  const { data: workload = [], isLoading } = useQuery<TeamMember[]>({
    queryKey: ["/api/team-workload"],
  });

  const [expanded, setExpanded] = useState<Record<number, string | null>>({});

  const toggleSection = (userId: number, section: string) => {
    setExpanded(prev => ({
      ...prev,
      [userId]: prev[userId] === section ? null : section,
    }));
  };

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-page-title">Team Workload</h1>
        <div className="grid gap-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-48" />)}</div>
      </div>
    );
  }

  const totalOverdue = workload.reduce((sum, m) => sum + m.overdueTasks, 0);

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-page-title">Team Workload</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {workload.length} team members
          {totalOverdue > 0 && (
            <span className="text-red-400 ml-2">· {totalOverdue} overdue task{totalOverdue !== 1 ? "s" : ""}</span>
          )}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-border/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Team Members</p>
            <p className="text-2xl font-bold">{workload.length}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Assigned Leads</p>
            <p className="text-2xl font-bold">{workload.reduce((s, m) => s + m.assignedLeads, 0)}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Open Tasks</p>
            <p className="text-2xl font-bold">{workload.reduce((s, m) => s + m.openTasks, 0)}</p>
          </CardContent>
        </Card>
        <Card className={`border-border/50 ${totalOverdue > 0 ? "border-red-500/30" : ""}`}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Overdue Tasks</p>
            <p className={`text-2xl font-bold ${totalOverdue > 0 ? "text-red-400" : ""}`}>{totalOverdue}</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        {workload.map((member) => (
          <Card key={member.userId} className={`border-border/50 ${member.overdueTasks > 0 ? "border-l-2 border-l-red-500/50" : ""}`} data-testid={`card-user-${member.userId}`}>
            <CardContent className="p-4 sm:p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary">
                  {getInitials(member.userName)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold" data-testid={`text-user-name-${member.userId}`}>{member.userName}</p>
                  <p className="text-xs text-muted-foreground">{member.userEmail}</p>
                </div>
                {member.overdueTasks > 0 && (
                  <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/20" data-testid={`badge-overdue-${member.userId}`}>
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    {member.overdueTasks} overdue
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3 mb-3">
                <button
                  onClick={() => toggleSection(member.userId, "leads")}
                  className="flex items-center gap-2 p-2 rounded-lg border border-border/50 hover:border-primary/30 transition-colors text-left"
                  data-testid={`button-leads-${member.userId}`}
                >
                  <Anchor className="h-4 w-4 text-primary shrink-0" />
                  <div>
                    <p className="text-lg font-semibold leading-none">{member.assignedLeads}</p>
                    <p className="text-xs text-muted-foreground">Leads</p>
                  </div>
                  {expanded[member.userId] === "leads" ? <ChevronDown className="h-3.5 w-3.5 ml-auto text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 ml-auto text-muted-foreground" />}
                </button>
                <button
                  onClick={() => toggleSection(member.userId, "accounts")}
                  className="flex items-center gap-2 p-2 rounded-lg border border-border/50 hover:border-primary/30 transition-colors text-left"
                  data-testid={`button-accounts-${member.userId}`}
                >
                  <Building2 className="h-4 w-4 text-blue-400 shrink-0" />
                  <div>
                    <p className="text-lg font-semibold leading-none">{member.assignedAccounts}</p>
                    <p className="text-xs text-muted-foreground">Accounts</p>
                  </div>
                  {expanded[member.userId] === "accounts" ? <ChevronDown className="h-3.5 w-3.5 ml-auto text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 ml-auto text-muted-foreground" />}
                </button>
                <button
                  onClick={() => toggleSection(member.userId, "tasks")}
                  className="flex items-center gap-2 p-2 rounded-lg border border-border/50 hover:border-primary/30 transition-colors text-left"
                  data-testid={`button-tasks-${member.userId}`}
                >
                  <ListTodo className="h-4 w-4 text-amber-400 shrink-0" />
                  <div>
                    <p className="text-lg font-semibold leading-none">{member.openTasks}</p>
                    <p className="text-xs text-muted-foreground">Tasks</p>
                  </div>
                  {expanded[member.userId] === "tasks" ? <ChevronDown className="h-3.5 w-3.5 ml-auto text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 ml-auto text-muted-foreground" />}
                </button>
              </div>

              {expanded[member.userId] === "leads" && (
                <div className="border-t border-border/30 pt-3 mt-2">
                  {member.leadsList.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-2">No leads assigned</p>
                  ) : (
                    <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                      {member.leadsList.map(lead => (
                        <div key={lead.id} className="flex items-center justify-between text-sm p-2 rounded-md bg-muted/30" data-testid={`workload-lead-${lead.id}`}>
                          <div className="flex items-center gap-2 min-w-0">
                            <Anchor className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span className="truncate">{lead.company}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge variant="outline" className="text-xs">{lead.status}</Badge>
                            {lead.dueDate && (
                              <span className={`text-xs ${isOverdue(lead.dueDate) ? "text-red-400" : "text-muted-foreground"}`}>
                                {formatDate(lead.dueDate)}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {expanded[member.userId] === "accounts" && (
                <div className="border-t border-border/30 pt-3 mt-2">
                  {member.accountsList.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-2">No accounts assigned</p>
                  ) : (
                    <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                      {member.accountsList.map(acct => (
                        <div key={acct.id} className="flex items-center justify-between text-sm p-2 rounded-md bg-muted/30" data-testid={`workload-account-${acct.id}`}>
                          <div className="flex items-center gap-2 min-w-0">
                            <Building2 className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                            <span className="truncate">{acct.name}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {acct.nextAction && <span className="text-xs text-muted-foreground truncate max-w-[120px]">{acct.nextAction}</span>}
                            {acct.nextActionAt && (
                              <span className={`text-xs ${isOverdue(acct.nextActionAt) ? "text-red-400" : "text-muted-foreground"}`}>
                                {formatDate(acct.nextActionAt)}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {expanded[member.userId] === "tasks" && (
                <div className="border-t border-border/30 pt-3 mt-2">
                  {member.tasks.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-2">No open tasks</p>
                  ) : (
                    <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                      {member.tasks.map(task => (
                        <div key={task.id} className={`flex items-center justify-between text-sm p-2 rounded-md ${task.dueDate && isOverdue(task.dueDate) ? "bg-red-500/5 border border-red-500/20" : "bg-muted/30"}`} data-testid={`workload-task-${task.id}`}>
                          <div className="flex items-center gap-2 min-w-0">
                            {task.status === "completed" ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />
                            ) : (
                              <Clock className={`h-3.5 w-3.5 shrink-0 ${task.dueDate && isOverdue(task.dueDate) ? "text-red-400" : "text-amber-400"}`} />
                            )}
                            <span className="truncate">{task.title}</span>
                            <span className={`text-xs ${priorityColors[task.priority] || "text-muted-foreground"}`}>
                              {task.priority}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {task.linkedObjectType && (
                              <Badge variant="outline" className="text-xs">{task.linkedObjectType}</Badge>
                            )}
                            {task.dueDate ? (
                              <span className={`text-xs font-medium ${isOverdue(task.dueDate) ? "text-red-400" : "text-muted-foreground"}`}>
                                {formatDate(task.dueDate)}
                                {isOverdue(task.dueDate) && " (overdue)"}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">No date</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
