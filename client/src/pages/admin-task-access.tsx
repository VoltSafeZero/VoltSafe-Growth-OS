import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ShieldCheck, Trash2, Plus, Users, CheckSquare } from "lucide-react";

type Permission = {
  id: number;
  viewerUserId: number;
  viewerName: string;
  targetUserId: number;
  targetName: string;
  permissionLevel: "view" | "edit";
  createdAt: string;
};

type User = { id: number; name: string; email?: string };

export default function AdminTaskAccessPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [viewerUserId, setViewerUserId] = useState<string>("");
  const [targetUserId, setTargetUserId] = useState<string>("");
  const [permissionLevel, setPermissionLevel] = useState<string>("view");

  const { data: permissions = [], isLoading } = useQuery<Permission[]>({
    queryKey: ["/api/tasks/hub-access/permissions"],
    queryFn: () => fetch("/api/tasks/hub-access/permissions", { credentials: "include" }).then(r => r.json()),
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    queryFn: () => fetch("/api/admin/users", { credentials: "include" }).then(r => r.json()),
  });

  const grantMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/tasks/hub-access/permissions", {
      viewerUserId: Number(viewerUserId),
      targetUserId: Number(targetUserId),
      permissionLevel,
    }),
    onSuccess: () => {
      toast({ description: "Access granted" });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/hub-access/permissions"] });
      setViewerUserId("");
      setTargetUserId("");
      setPermissionLevel("view");
    },
    onError: async (err: any) => {
      const msg = err?.message || "Failed to grant access";
      toast({ variant: "destructive", description: msg });
    },
  });

  const revokeMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/tasks/hub-access/permissions/${id}`),
    onSuccess: () => {
      toast({ description: "Access revoked" });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/hub-access/permissions"] });
    },
    onError: () => toast({ variant: "destructive", description: "Failed to revoke access" }),
  });

  const canGrant = viewerUserId && targetUserId && viewerUserId !== targetUserId;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <CheckSquare className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Task Hub Access</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Control which users can view or edit another user's Tasks Hub.
          </p>
        </div>
      </div>

      {/* Grant new access */}
      <div className="rounded-xl border border-border/50 bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-primary" />
          <h2 className="font-semibold text-sm">Grant Access</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">Who gets access</label>
            <Select value={viewerUserId} onValueChange={setViewerUserId}>
              <SelectTrigger className="h-9 text-sm" data-testid="select-viewer">
                <SelectValue placeholder="Select user…" />
              </SelectTrigger>
              <SelectContent>
                {users.map(u => (
                  <SelectItem key={u.id} value={String(u.id)} data-testid={`option-viewer-${u.id}`}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">Whose tasks to see</label>
            <Select value={targetUserId} onValueChange={setTargetUserId}>
              <SelectTrigger className="h-9 text-sm" data-testid="select-target">
                <SelectValue placeholder="Select user…" />
              </SelectTrigger>
              <SelectContent>
                {users.filter(u => String(u.id) !== viewerUserId).map(u => (
                  <SelectItem key={u.id} value={String(u.id)} data-testid={`option-target-${u.id}`}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">Permission level</label>
            <Select value={permissionLevel} onValueChange={setPermissionLevel}>
              <SelectTrigger className="h-9 text-sm" data-testid="select-permission">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="view">View only</SelectItem>
                <SelectItem value="edit">View &amp; edit</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button
          size="sm"
          className="gap-2"
          disabled={!canGrant || grantMut.isPending}
          onClick={() => grantMut.mutate()}
          data-testid="button-grant-access"
        >
          <ShieldCheck className="h-4 w-4" />
          {grantMut.isPending ? "Granting…" : "Grant access"}
        </Button>
      </div>

      {/* Existing permissions */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold text-sm">Active Permissions</h2>
          <span className="text-xs text-muted-foreground">({permissions.length})</span>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
          </div>
        ) : permissions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 p-10 text-center">
            <ShieldCheck className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No cross-user access granted yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Use the form above to let one user view another's Tasks Hub.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border/50 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-secondary/20">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Viewer</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Can access tasks of</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Level</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {permissions.map((p, idx) => (
                  <tr
                    key={p.id}
                    className={`border-b border-border/20 last:border-0 hover:bg-secondary/10 transition-colors ${idx % 2 === 0 ? "" : "bg-secondary/5"}`}
                    data-testid={`permission-row-${p.id}`}
                  >
                    <td className="px-4 py-3 font-medium">{p.viewerName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{p.targetName}</td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="outline"
                        className={`text-[11px] px-2 py-0 h-5 ${
                          p.permissionLevel === "edit"
                            ? "border-primary/40 text-primary bg-primary/5"
                            : "border-border/60 text-muted-foreground"
                        }`}
                        data-testid={`badge-level-${p.id}`}
                      >
                        {p.permissionLevel === "edit" ? "View & edit" : "View only"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive gap-1"
                        onClick={() => revokeMut.mutate(p.id)}
                        disabled={revokeMut.isPending}
                        data-testid={`button-revoke-${p.id}`}
                      >
                        <Trash2 className="h-3 w-3" />
                        Revoke
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground border-t border-border/30 pt-4">
        <strong>View only</strong> — the viewer can see the target user's tasks but cannot complete, snooze, or reassign them.<br />
        <strong>View &amp; edit</strong> — the viewer has full edit access to the target user's tasks.
      </p>
    </div>
  );
}
