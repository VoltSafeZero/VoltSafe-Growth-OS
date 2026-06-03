import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckSquare, Eye, Pencil, Minus } from "lucide-react";

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
type CellState = "none" | "view" | "edit";

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function firstName(name: string) {
  return name.split(" ")[0];
}

function nextState(current: CellState): CellState {
  if (current === "none") return "view";
  if (current === "view") return "edit";
  return "none";
}

export default function AdminTaskAccessPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: permissions = [], isLoading: permLoading } = useQuery<Permission[]>({
    queryKey: ["/api/tasks/hub-access/permissions"],
    queryFn: () => fetch("/api/tasks/hub-access/permissions", { credentials: "include" }).then((r) => r.json()),
  });

  const { data: users = [], isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    queryFn: () => fetch("/api/admin/users", { credentials: "include" }).then((r) => r.json()),
  });

  const grantMut = useMutation({
    mutationFn: ({ viewerUserId, targetUserId, permissionLevel }: { viewerUserId: number; targetUserId: number; permissionLevel: string }) =>
      apiRequest("POST", "/api/tasks/hub-access/permissions", { viewerUserId, targetUserId, permissionLevel }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tasks/hub-access/permissions"] }),
    onError: () => toast({ variant: "destructive", description: "Failed to update permission" }),
  });

  const revokeMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/tasks/hub-access/permissions/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tasks/hub-access/permissions"] }),
    onError: () => toast({ variant: "destructive", description: "Failed to revoke access" }),
  });

  const permMap = new Map<string, Permission>();
  for (const p of permissions) {
    permMap.set(`${p.viewerUserId}:${p.targetUserId}`, p);
  }

  function getCellState(viewerId: number, targetId: number): CellState {
    const p = permMap.get(`${viewerId}:${targetId}`);
    if (!p) return "none";
    return p.permissionLevel === "edit" ? "edit" : "view";
  }

  function handleCellClick(viewer: User, target: User) {
    if (viewer.id === target.id) return;
    const current = getCellState(viewer.id, target.id);
    const next = nextState(current);
    const existing = permMap.get(`${viewer.id}:${target.id}`);

    if (next === "none") {
      if (existing) revokeMut.mutate(existing.id);
    } else {
      grantMut.mutate({ viewerUserId: viewer.id, targetUserId: target.id, permissionLevel: next });
    }
  }

  const isLoading = permLoading || usersLoading;
  const isBusy = grantMut.isPending || revokeMut.isPending;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
          <CheckSquare className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Task Hub Access</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Click any cell to cycle through: <span className="text-muted-foreground/70">None</span> → <span className="text-primary">View</span> → <span className="text-primary font-semibold">Edit</span> → <span className="text-muted-foreground/70">None</span>
          </p>
        </div>
      </div>

      {/* Matrix grid */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
        </div>
      ) : users.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
          No users found.
        </div>
      ) : (
        <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {/* Top-left corner label */}
                  <th className="sticky left-0 z-20 bg-card border-b border-r border-border/40 px-4 py-3 text-left">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 leading-tight">
                      <div>VIEWER</div>
                      <div className="text-[9px] mt-0.5 text-muted-foreground/40">can see tasks of →</div>
                    </div>
                  </th>
                  {/* Column headers = targets */}
                  {users.map((target) => (
                    <th
                      key={target.id}
                      className="border-b border-r border-border/40 last:border-r-0 px-2 py-3 min-w-[72px] text-center"
                    >
                      <div
                        className="h-8 w-8 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center mx-auto mb-1"
                        title={target.name}
                      >
                        {initials(target.name)}
                      </div>
                      <div className="text-[10px] text-muted-foreground font-medium leading-tight max-w-[64px] mx-auto truncate" title={target.name}>
                        {firstName(target.name)}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((viewer, rowIdx) => (
                  <tr key={viewer.id} className={rowIdx % 2 === 0 ? "" : "bg-muted/10"}>
                    {/* Row header = viewer */}
                    <td className="sticky left-0 z-10 border-r border-border/40 px-4 py-2 bg-inherit">
                      <div className="flex items-center gap-2.5">
                        <div className="h-7 w-7 rounded-full bg-secondary/60 text-[10px] font-bold flex items-center justify-center text-muted-foreground flex-shrink-0">
                          {initials(viewer.name)}
                        </div>
                        <span className="text-sm font-medium truncate max-w-[120px]" title={viewer.name}>
                          {viewer.name}
                        </span>
                      </div>
                    </td>
                    {/* Cells */}
                    {users.map((target) => {
                      const isSelf = viewer.id === target.id;
                      const state = getCellState(viewer.id, target.id);
                      return (
                        <td
                          key={target.id}
                          className="border-r border-border/20 last:border-r-0 p-1.5 text-center"
                        >
                          {isSelf ? (
                            <div className="h-9 w-full rounded-lg bg-muted/30 flex items-center justify-center" title="Own tasks">
                              <Minus className="h-3.5 w-3.5 text-muted-foreground/25" />
                            </div>
                          ) : (
                            <button
                              onClick={() => handleCellClick(viewer, target)}
                              disabled={isBusy}
                              title={
                                state === "none"
                                  ? `Grant ${viewer.name} view access to ${target.name}'s tasks`
                                  : state === "view"
                                  ? `Upgrade to edit access (click again to remove)`
                                  : `${viewer.name} has edit access to ${target.name}'s tasks — click to remove`
                              }
                              data-testid={`cell-${viewer.id}-${target.id}`}
                              className={[
                                "h-9 w-full rounded-lg transition-all duration-150 flex items-center justify-center gap-1 text-[11px] font-semibold border",
                                state === "none"
                                  ? "border-border/20 bg-muted/10 text-muted-foreground/30 hover:bg-primary/8 hover:border-primary/20 hover:text-primary/50"
                                  : state === "view"
                                  ? "border-primary/30 bg-primary/8 text-primary hover:bg-primary/15"
                                  : "border-primary/50 bg-primary/20 text-primary hover:bg-primary/30",
                                isBusy ? "cursor-wait opacity-70" : "cursor-pointer",
                              ].join(" ")}
                            >
                              {state === "none" && <span className="opacity-40">—</span>}
                              {state === "view" && (
                                <>
                                  <Eye className="h-3 w-3" />
                                  <span>View</span>
                                </>
                              )}
                              {state === "edit" && (
                                <>
                                  <Pencil className="h-3 w-3" />
                                  <span>Edit</span>
                                </>
                              )}
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground border-t border-border/30 pt-4">
        <div className="flex items-center gap-1.5">
          <div className="h-5 w-10 rounded border border-border/20 bg-muted/10 flex items-center justify-center">
            <span className="text-muted-foreground/30 text-[10px]">—</span>
          </div>
          <span>No access</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-5 w-10 rounded border border-primary/30 bg-primary/8 flex items-center justify-center gap-0.5">
            <Eye className="h-2.5 w-2.5 text-primary" />
            <span className="text-primary text-[9px] font-semibold">View</span>
          </div>
          <span>Can view tasks, no edits</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-5 w-10 rounded border border-primary/50 bg-primary/20 flex items-center justify-center gap-0.5">
            <Pencil className="h-2.5 w-2.5 text-primary" />
            <span className="text-primary text-[9px] font-semibold">Edit</span>
          </div>
          <span>Full edit access</span>
        </div>
        <div className="ml-auto text-muted-foreground/50">
          Click a cell to cycle · Changes save instantly
        </div>
      </div>
    </div>
  );
}
