import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ShieldCheck, Plus, Pencil, Trash2, Lock, AlertTriangle, Crown, Tag,
} from "lucide-react";

type RoleDefinition = {
  id: number;
  value: string;
  label: string;
  color: string;
  is_system: boolean;
  sort_order: number;
  created_at: string;
};

export const COLOR_OPTIONS = [
  { value: "yellow", label: "Yellow", text: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/30" },
  { value: "purple", label: "Purple", text: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/30" },
  { value: "blue",   label: "Blue",   text: "text-blue-400",   bg: "bg-blue-500/10",   border: "border-blue-500/30"   },
  { value: "orange", label: "Orange", text: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/30" },
  { value: "green",  label: "Green",  text: "text-green-400",  bg: "bg-green-500/10",  border: "border-green-500/30"  },
  { value: "pink",   label: "Pink",   text: "text-pink-400",   bg: "bg-pink-500/10",   border: "border-pink-500/30"   },
  { value: "cyan",   label: "Cyan",   text: "text-cyan-400",   bg: "bg-cyan-500/10",   border: "border-cyan-500/30"   },
  { value: "amber",  label: "Amber",  text: "text-amber-400",  bg: "bg-amber-500/10",  border: "border-amber-500/30"  },
  { value: "teal",   label: "Teal",   text: "text-teal-400",   bg: "bg-teal-500/10",   border: "border-teal-500/30"   },
  { value: "red",    label: "Red",    text: "text-red-400",    bg: "bg-red-500/10",    border: "border-red-500/30"    },
  { value: "indigo", label: "Indigo", text: "text-indigo-400", bg: "bg-indigo-500/10", border: "border-indigo-500/30" },
  { value: "gray",   label: "Gray",   text: "text-gray-400",   bg: "bg-gray-500/10",   border: "border-gray-500/30"   },
] as const;

export function colorClasses(color: string) {
  return COLOR_OPTIONS.find(c => c.value === color) ?? COLOR_OPTIONS.find(c => c.value === "blue")!;
}

function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2 mt-1.5">
      {COLOR_OPTIONS.map(c => (
        <button
          key={c.value}
          type="button"
          title={c.label}
          onClick={() => onChange(c.value)}
          className={`w-6 h-6 rounded-full border-2 transition-all ${c.bg} ${
            value === c.value ? `${c.border} scale-110 shadow-md` : "border-transparent hover:scale-105"
          }`}
        >
          <span className={`block w-3 h-3 mx-auto rounded-full opacity-80 ${c.text.replace("text-", "bg-")}`} />
        </button>
      ))}
    </div>
  );
}

function RolePill({ role }: { role: RoleDefinition }) {
  const c = colorClasses(role.color);
  return (
    <Badge variant="outline" className={`text-xs ${c.text} ${c.bg} ${c.border} gap-1`}>
      <Tag className="w-3 h-3" />
      {role.label}
    </Badge>
  );
}

function AddRoleDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("blue");

  const mutation = useMutation({
    mutationFn: (data: { label: string; color: string }) =>
      apiRequest("POST", "/api/admin/role-definitions", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/role-definitions"] });
      toast({ title: "Role created" });
      onClose();
    },
    onError: (e: any) => toast({ title: e?.message ?? "Failed to create role", variant: "destructive" }),
  });

  const slug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Plus className="w-4 h-4 text-primary" /> Add Role
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4 pt-1">
        <div>
          <Label className="text-xs">Role Name *</Label>
          <Input
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="e.g. Field Technician"
            className="mt-1.5 h-9"
            data-testid="input-new-role-label"
            autoFocus
          />
          {slug && (
            <p className="text-[10px] text-muted-foreground mt-1">
              Internal key: <code className="bg-muted px-1 rounded">{slug}</code>
            </p>
          )}
        </div>
        <div>
          <Label className="text-xs">Badge Color</Label>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        <div className="flex items-center gap-2 pt-1">
          <span className="text-xs text-muted-foreground">Preview:</span>
          {label.trim() && (
            <RolePill role={{ id: 0, value: slug, label: label.trim(), color, is_system: false, sort_order: 0, created_at: "" }} />
          )}
        </div>
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            onClick={() => mutation.mutate({ label, color })}
            disabled={mutation.isPending || label.trim().length < 2}
            data-testid="button-confirm-add-role"
          >
            {mutation.isPending ? "Creating…" : "Create Role"}
          </Button>
          <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </DialogContent>
  );
}

function EditRoleDialog({ role, onClose }: { role: RoleDefinition; onClose: () => void }) {
  const { toast } = useToast();
  const [label, setLabel] = useState(role.label);
  const [color, setColor] = useState(role.color);

  const mutation = useMutation({
    mutationFn: (data: { label: string; color: string }) =>
      apiRequest("PATCH", `/api/admin/role-definitions/${role.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/role-definitions"] });
      toast({ title: "Role updated" });
      onClose();
    },
    onError: (e: any) => toast({ title: e?.message ?? "Failed to update role", variant: "destructive" }),
  });

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Pencil className="w-4 h-4 text-primary" /> Edit Role
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4 pt-1">
        {role.is_system && (
          <div className="flex items-start gap-2 text-xs text-amber-400/80 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            System role — label and color can be customised but it cannot be deleted.
          </div>
        )}
        <div>
          <Label className="text-xs">Role Name</Label>
          <Input
            value={label}
            onChange={e => setLabel(e.target.value)}
            className="mt-1.5 h-9"
            data-testid="input-edit-role-label"
            autoFocus
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Internal key: <code className="bg-muted px-1 rounded">{role.value}</code> (unchangeable)
          </p>
        </div>
        <div>
          <Label className="text-xs">Badge Color</Label>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        <div className="flex items-center gap-2 pt-1">
          <span className="text-xs text-muted-foreground">Preview:</span>
          <RolePill role={{ ...role, label, color }} />
        </div>
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            onClick={() => mutation.mutate({ label, color })}
            disabled={mutation.isPending || label.trim().length < 2}
            data-testid="button-confirm-edit-role"
          >
            {mutation.isPending ? "Saving…" : "Save Changes"}
          </Button>
          <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </DialogContent>
  );
}

function DeleteRoleDialog({ role, onClose }: { role: RoleDefinition; onClose: () => void }) {
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/admin/role-definitions/${role.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/role-definitions"] });
      toast({ title: `Role "${role.label}" deleted` });
      onClose();
    },
    onError: (e: any) => toast({ title: e?.message ?? "Failed to delete role", variant: "destructive" }),
  });

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-red-400">
          <Trash2 className="w-4 h-4" /> Delete Role
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4 pt-1">
        <p className="text-sm text-muted-foreground">
          Are you sure you want to delete the <strong className="text-foreground">{role.label}</strong> role?
        </p>
        <p className="text-xs text-muted-foreground bg-secondary/40 rounded-lg p-3">
          This only works if no users are currently assigned this role. Users must be reassigned first.
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            data-testid="button-confirm-delete-role"
          >
            {mutation.isPending ? "Deleting…" : "Delete Role"}
          </Button>
          <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </DialogContent>
  );
}

export default function AdminRolesPage({ currentUserGlobalRole }: { currentUserGlobalRole: string }) {
  const { toast } = useToast();
  const isMasterAdmin = currentUserGlobalRole === "master_admin";
  const [showAdd, setShowAdd] = useState(false);
  const [editRole, setEditRole] = useState<RoleDefinition | null>(null);
  const [deleteRole, setDeleteRole] = useState<RoleDefinition | null>(null);

  const rolesQuery = useQuery<RoleDefinition[]>({
    queryKey: ["/api/admin/role-definitions"],
  });

  if (!isMasterAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-center p-6">
        <Crown className="w-10 h-10 text-yellow-400/50" />
        <h2 className="text-xl font-semibold">Master Admin Only</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Only Master Admins can manage role definitions. Contact a Master Admin if you need access.
        </p>
      </div>
    );
  }

  const roles = rolesQuery.data ?? [];

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-primary" />
            Role Manager
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Define roles that appear in user dropdowns. System roles cannot be deleted.
          </p>
        </div>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => setShowAdd(true)}
          data-testid="button-add-role"
        >
          <Plus className="w-4 h-4" /> Add Role
        </Button>
      </div>

      {rolesQuery.isLoading && (
        <div className="text-sm text-muted-foreground animate-pulse">Loading roles…</div>
      )}

      <div className="space-y-2">
        {roles.map(role => {
          const c = colorClasses(role.color);
          return (
            <div
              key={role.id}
              className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border/40 bg-card/60 hover:bg-card/90 transition-colors"
              data-testid={`role-row-${role.value}`}
            >
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${c.bg.replace("/10", "/80")}`} style={{ backgroundColor: "currentColor" }}>
                <span className={`block w-2 h-2 rounded-full ${c.text.replace("text-", "bg-")}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{role.label}</span>
                  {role.is_system && (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground/60 border-border/40 py-0 px-1.5">
                      <Lock className="w-2.5 h-2.5 mr-0.5" />system
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{role.value}</p>
              </div>
              <RolePill role={role} />
              <div className="flex items-center gap-1 ml-2">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground/60 hover:text-foreground"
                  onClick={() => setEditRole(role)}
                  data-testid={`button-edit-role-${role.value}`}
                  title="Edit role"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground/40 hover:text-red-400 disabled:opacity-25"
                  onClick={() => setDeleteRole(role)}
                  disabled={role.is_system}
                  title={role.is_system ? "System roles cannot be deleted" : "Delete role"}
                  data-testid={`button-delete-role-${role.value}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-lg border border-border/30 bg-secondary/20 p-4 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground/70">How roles work</p>
        <p>Roles control how users are labelled across the app. <strong>Master Admin</strong> and <strong>Admin</strong> bypass all section-level permission restrictions. All other roles can have custom section permissions set per-user on the Users page.</p>
        <p>Deleting a role is blocked if any users are still assigned to it. Reassign those users first.</p>
      </div>

      <Dialog open={showAdd} onOpenChange={o => !o && setShowAdd(false)}>
        {showAdd && <AddRoleDialog onClose={() => setShowAdd(false)} />}
      </Dialog>

      <Dialog open={!!editRole} onOpenChange={o => !o && setEditRole(null)}>
        {editRole && <EditRoleDialog role={editRole} onClose={() => setEditRole(null)} />}
      </Dialog>

      <Dialog open={!!deleteRole} onOpenChange={o => !o && setDeleteRole(null)}>
        {deleteRole && <DeleteRoleDialog role={deleteRole} onClose={() => setDeleteRole(null)} />}
      </Dialog>
    </div>
  );
}
