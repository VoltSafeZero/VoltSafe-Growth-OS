import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Users, Plus, Search, ShieldCheck,
  UserCheck, UserX, KeyRound, Edit2, X, Mail, Briefcase,
  Clock, ChevronRight, AlertTriangle, CheckCircle2,
  UserCog, Crown, Eye, Lock, Unlock, Trash2,
} from "lucide-react";

type AdminUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  globalRole: string;
  status: string;
  userType: string;
  department: string | null;
  jobTitle: string | null;
  mustChangePassword: boolean;
  createdAt: string;
  lastLogin: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
};

const GLOBAL_ROLES = [
  { value: "master_admin", label: "Master Admin", icon: Crown, color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/30" },
  { value: "admin", label: "Admin", icon: ShieldCheck, color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/30" },
  { value: "manager", label: "Manager", icon: UserCog, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30" },
  { value: "sales", label: "Sales", icon: Briefcase, color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/30" },
  { value: "analyst", label: "Analyst", icon: Eye, color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/30" },
  { value: "read_only", label: "Read Only", icon: Lock, color: "text-gray-400", bg: "bg-gray-500/10", border: "border-gray-500/30" },
];

const STATUS_CONFIG = {
  active: { label: "Active", color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/30", icon: CheckCircle2 },
  invited: { label: "Invited", color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30", icon: Mail },
  suspended: { label: "Suspended", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30", icon: UserX },
  deactivated: { label: "Deactivated", color: "text-gray-400", bg: "bg-gray-500/10", border: "border-gray-500/30", icon: X },
};

function RoleBadge({ role }: { role: string }) {
  const cfg = GLOBAL_ROLES.find(r => r.value === role) ?? GLOBAL_ROLES[GLOBAL_ROLES.length - 1];
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`text-xs ${cfg.color} ${cfg.bg} ${cfg.border} gap-1`}>
      <Icon className="w-3 h-3" />{cfg.label}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.active;
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`text-xs ${cfg.color} ${cfg.bg} ${cfg.border} gap-1`}>
      <Icon className="w-3 h-3" />{cfg.label}
    </Badge>
  );
}

function UserInitial({ name, size = "sm" }: { name: string; size?: "sm" | "lg" }) {
  const initials = name.split(" ").map(p => p[0]).join("").toUpperCase().slice(0, 2);
  const colors = ["bg-blue-500", "bg-purple-500", "bg-green-500", "bg-orange-500", "bg-pink-500", "bg-cyan-500"];
  const color = colors[name.charCodeAt(0) % colors.length];
  const sizeClass = size === "lg" ? "w-12 h-12 text-lg" : "w-8 h-8 text-sm";
  return (
    <div className={`${sizeClass} rounded-full ${color} flex items-center justify-center font-semibold text-white shrink-0`}>
      {initials}
    </div>
  );
}

export default function AdminUsersPage({ currentUserGlobalRole }: { currentUserGlobalRole: string }) {
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const { toast } = useToast();

  const { data: allUsers = [], isLoading } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users");
      if (!res.ok) throw new Error("Failed to load users");
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number; [key: string]: unknown }) => {
      const res = await apiRequest("PUT", `/api/admin/users/${id}`, data);
      return res.json();
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      if (selectedUser?.id === updated.id) setSelectedUser(updated);
      toast({ title: "User updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const suspendMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason?: string }) => {
      const res = await apiRequest("POST", `/api/admin/users/${id}/suspend`, { reason });
      return res.json();
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      if (selectedUser?.id === updated.id) setSelectedUser(updated);
      toast({ title: "User suspended" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const activateMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/admin/users/${id}/activate`, {});
      return res.json();
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      if (selectedUser?.id === updated.id) setSelectedUser(updated);
      toast({ title: "User activated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", `/api/admin/users`, data);
      return res.json();
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setCreateOpen(false);
      toast({
        title: "User created",
        description: created.tempPassword ? `Temp password: ${created.tempPassword}` : "User added",
      });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ id, newPassword }: { id: number; newPassword: string }) => {
      const res = await apiRequest("POST", `/api/admin/users/${id}/reset-password`, { newPassword });
      return res.json();
    },
    onSuccess: () => toast({ title: "Password reset", description: "User will need to change it on next login" }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/users/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setSelectedUser(null);
      toast({ title: "User deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = allUsers.filter(u => {
    const q = search.toLowerCase();
    const matchSearch = !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.department || "").toLowerCase().includes(q);
    const matchRole = filterRole === "all" || u.globalRole === filterRole;
    const matchStatus = filterStatus === "all" || u.status === filterStatus;
    return matchSearch && matchRole && matchStatus;
  });

  const stats = {
    total: allUsers.length,
    active: allUsers.filter(u => u.status === "active").length,
    invited: allUsers.filter(u => u.status === "invited").length,
    suspended: allUsers.filter(u => u.status === "suspended").length,
  };

  const isMasterAdmin = currentUserGlobalRole === "master_admin";

  return (
    <div className="flex h-full">
      {/* Main list */}
      <div className={`flex flex-col ${selectedUser ? "w-[55%] border-r border-border/50" : "w-full"} transition-all`}>
        {/* Header */}
        <div className="px-6 py-5 border-b border-border/50">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">User Management</h1>
              <p className="text-muted-foreground text-sm mt-0.5">Manage team members, roles, and access levels</p>
            </div>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button className="bg-primary text-primary-foreground h-9" data-testid="button-create-user">
                  <Plus className="mr-2 h-4 w-4" />Add User
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>Add New User</DialogTitle></DialogHeader>
                <CreateUserForm onSubmit={(d) => createMutation.mutate(d)} isPending={createMutation.isPending} isMasterAdmin={isMasterAdmin} />
              </DialogContent>
            </Dialog>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-3 mt-4">
            {[
              { label: "Total", value: stats.total, icon: Users, color: "text-primary", bg: "bg-primary/10" },
              { label: "Active", value: stats.active, icon: UserCheck, color: "text-green-400", bg: "bg-green-500/10" },
              { label: "Invited", value: stats.invited, icon: Mail, color: "text-blue-400", bg: "bg-blue-500/10" },
              { label: "Suspended", value: stats.suspended, icon: UserX, color: "text-red-400", bg: "bg-red-500/10" },
            ].map(s => (
              <Card key={s.label} className="border-border/50 bg-card/50" data-testid={`card-user-stat-${s.label.toLowerCase()}`}>
                <CardContent className="p-3 flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-lg ${s.bg} flex items-center justify-center shrink-0`}>
                    <s.icon className={`w-4 h-4 ${s.color}`} />
                  </div>
                  <div>
                    <div className="text-xl font-bold">{s.value}</div>
                    <div className="text-xs text-muted-foreground">{s.label}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="px-6 py-3 flex gap-3 flex-wrap border-b border-border/30">
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)}
              className="pl-9 h-9 bg-secondary/30 border-transparent focus-visible:border-primary/50" data-testid="input-search-users" />
          </div>
          <Select value={filterRole} onValueChange={setFilterRole}>
            <SelectTrigger className="w-36 h-9 bg-secondary/30 border-transparent" data-testid="select-filter-role">
              <SelectValue placeholder="All Roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              {GLOBAL_ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-36 h-9 bg-secondary/30 border-transparent" data-testid="select-filter-status">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="invited">Invited</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* User list */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-secondary/20 rounded-lg animate-pulse" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">No users found</div>
          ) : (
            <div className="divide-y divide-border/30">
              {filtered.map(user => (
                <div
                  key={user.id}
                  className={`flex items-center gap-4 px-6 py-4 cursor-pointer hover:bg-muted/30 transition-colors ${selectedUser?.id === user.id ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
                  onClick={() => setSelectedUser(prev => prev?.id === user.id ? null : user)}
                  data-testid={`row-user-${user.id}`}
                >
                  <UserInitial name={user.name} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{user.name}</span>
                      <RoleBadge role={user.globalRole} />
                      <StatusBadge status={user.status} />
                      {user.userType === "external" && (
                        <Badge variant="outline" className="text-xs text-orange-400 bg-orange-500/10 border-orange-500/30">External</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-muted-foreground truncate">{user.email}</span>
                      {user.department && <span className="text-xs text-muted-foreground hidden sm:inline">· {user.department}</span>}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground hidden md:block text-right shrink-0">
                    <div className="flex items-center gap-1 justify-end">
                      <Clock className="w-3 h-3" />
                      {user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : "Never"}
                    </div>
                    <div className="text-xs text-muted-foreground/60 mt-0.5">Last login</div>
                  </div>
                  <ChevronRight className={`w-4 h-4 text-muted-foreground/40 shrink-0 transition-transform ${selectedUser?.id === user.id ? "rotate-90 text-primary" : ""}`} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail Panel */}
      {selectedUser && (
        <UserDetailPanel
          user={selectedUser}
          isMasterAdmin={isMasterAdmin}
          onClose={() => setSelectedUser(null)}
          onUpdate={(data) => updateMutation.mutate({ id: selectedUser.id, ...data })}
          onSuspend={(reason) => suspendMutation.mutate({ id: selectedUser.id, reason })}
          onActivate={() => activateMutation.mutate(selectedUser.id)}
          onResetPassword={(newPassword) => resetPasswordMutation.mutate({ id: selectedUser.id, newPassword })}
          onDelete={() => deleteMutation.mutate(selectedUser.id)}
          isPending={updateMutation.isPending || suspendMutation.isPending || activateMutation.isPending || deleteMutation.isPending}
        />
      )}
    </div>
  );
}

function UserDetailPanel({ user, isMasterAdmin, onClose, onUpdate, onSuspend, onActivate, onResetPassword, onDelete, isPending }: {
  user: AdminUser;
  isMasterAdmin: boolean;
  onClose: () => void;
  onUpdate: (data: Record<string, unknown>) => void;
  onSuspend: (reason?: string) => void;
  onActivate: () => void;
  onResetPassword: (pw: string) => void;
  onDelete: () => void;
  isPending: boolean;
}) {
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState({ name: user.name, email: user.email, globalRole: user.globalRole, userType: user.userType, department: user.department || "", jobTitle: user.jobTitle || "" });
  const [suspendReason, setSuspendReason] = useState("");
  const [showSuspendDialog, setShowSuspendDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const { toast } = useToast();

  const roleCfg = GLOBAL_ROLES.find(r => r.value === user.globalRole) ?? GLOBAL_ROLES[GLOBAL_ROLES.length - 1];
  const statusCfg = STATUS_CONFIG[user.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.active;
  const RoleIcon = roleCfg.icon;
  const StatusIcon = statusCfg.icon;

  function handleSave() {
    onUpdate(form);
    setEditMode(false);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden" data-testid="panel-user-detail">
      {/* Panel header */}
      <div className="px-6 py-4 border-b border-border/50 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <UserInitial name={user.name} size="lg" />
          <div>
            <h2 className="text-lg font-semibold">{user.name}</h2>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-user-panel"><X className="w-4 h-4" /></Button>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Status + Role badges */}
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className={`${statusCfg.color} ${statusCfg.bg} ${statusCfg.border} gap-1`}>
            <StatusIcon className="w-3 h-3" />{statusCfg.label}
          </Badge>
          <Badge variant="outline" className={`${roleCfg.color} ${roleCfg.bg} ${roleCfg.border} gap-1`}>
            <RoleIcon className="w-3 h-3" />{roleCfg.label}
          </Badge>
          {user.userType === "external" && (
            <Badge variant="outline" className="text-xs text-orange-400 bg-orange-500/10 border-orange-500/30">External</Badge>
          )}
        </div>

        {/* Info grid */}
        {!editMode ? (
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Department", value: user.department || "—" },
              { label: "Job Title", value: user.jobTitle || "—" },
              { label: "User Type", value: user.userType === "internal" ? "Internal" : "External" },
              { label: "Must Change Password", value: user.mustChangePassword ? "Yes" : "No" },
              { label: "Created", value: new Date(user.createdAt).toLocaleDateString() },
              { label: "Last Login", value: user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : "Never" },
            ].map(item => (
              <div key={item.label} className="bg-secondary/20 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className="text-sm font-medium mt-0.5">{item.value}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4 p-4 border border-border/50 rounded-lg bg-secondary/10">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Full Name</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="mt-1.5 h-9" data-testid="input-edit-name" />
              </div>
              <div><Label className="text-xs">Email</Label>
                <Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="mt-1.5 h-9" data-testid="input-edit-email" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Department</Label>
                <Input value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} className="mt-1.5 h-9" data-testid="input-edit-department" />
              </div>
              <div><Label className="text-xs">Job Title</Label>
                <Input value={form.jobTitle} onChange={e => setForm(f => ({ ...f, jobTitle: e.target.value }))} className="mt-1.5 h-9" data-testid="input-edit-jobtitle" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Role</Label>
                <Select value={form.globalRole} onValueChange={v => setForm(f => ({ ...f, globalRole: v }))}>
                  <SelectTrigger className="mt-1.5 h-9" data-testid="select-edit-role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {GLOBAL_ROLES.filter(r => isMasterAdmin || r.value !== "master_admin").map(r => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">User Type</Label>
                <Select value={form.userType} onValueChange={v => setForm(f => ({ ...f, userType: v }))}>
                  <SelectTrigger className="mt-1.5 h-9" data-testid="select-edit-usertype"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="internal">Internal</SelectItem>
                    <SelectItem value="external">External</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave} disabled={isPending} data-testid="button-save-user">Save Changes</Button>
              <Button size="sm" variant="outline" onClick={() => setEditMode(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Suspension info */}
        {user.status === "suspended" && user.suspendedAt && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
            <div className="flex items-center gap-2 text-red-400 font-medium text-sm mb-1">
              <AlertTriangle className="w-4 h-4" /> Suspended
            </div>
            <p className="text-xs text-muted-foreground">Since: {new Date(user.suspendedAt).toLocaleDateString()}</p>
            {user.suspendedReason && <p className="text-xs text-muted-foreground mt-1">Reason: {user.suspendedReason}</p>}
          </div>
        )}

        <div className="border-t border-border/40" />

        {/* Actions */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Actions</h3>
          <div className="grid grid-cols-1 gap-2">
            <Button variant="outline" size="sm" className="justify-start gap-2 h-9" onClick={() => setEditMode(e => !e)} data-testid="button-edit-user">
              <Edit2 className="w-4 h-4" />{editMode ? "Cancel Edit" : "Edit Profile"}
            </Button>

            {user.status !== "suspended" ? (
              <Button
                variant="outline" size="sm"
                className="justify-start gap-2 h-9 text-red-400 border-red-500/30 hover:bg-red-500/10"
                onClick={() => setShowSuspendDialog(true)}
                data-testid="button-suspend-user"
              >
                <UserX className="w-4 h-4" />Suspend User
              </Button>
            ) : (
              <Button
                variant="outline" size="sm"
                className="justify-start gap-2 h-9 text-green-400 border-green-500/30 hover:bg-green-500/10"
                onClick={onActivate}
                disabled={isPending}
                data-testid="button-activate-user"
              >
                <Unlock className="w-4 h-4" />Reactivate User
              </Button>
            )}

            <Button variant="outline" size="sm" className="justify-start gap-2 h-9" onClick={() => setShowResetDialog(true)} data-testid="button-reset-password">
              <KeyRound className="w-4 h-4" />Reset Password
            </Button>

            <Button
              variant="outline" size="sm"
              className="justify-start gap-2 h-9 text-red-400 border-red-500/30 hover:bg-red-500/10 mt-2"
              onClick={() => setShowDeleteDialog(true)}
              data-testid="button-delete-user"
            >
              <Trash2 className="w-4 h-4" />Delete User
            </Button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-red-400">Delete {user.name}?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete the user account for <strong>{user.email}</strong>. This action cannot be undone.
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
            <Button
              size="sm"
              className="bg-red-500 hover:bg-red-600 text-white"
              disabled={isPending}
              onClick={() => { onDelete(); setShowDeleteDialog(false); }}
              data-testid="button-confirm-delete-user"
            >
              Delete Permanently
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Suspend Dialog */}
      <Dialog open={showSuspendDialog} onOpenChange={setShowSuspendDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-red-400">Suspend {user.name}?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This user will be locked out immediately. You can reactivate them at any time.</p>
          <div><Label className="text-xs">Reason (optional)</Label>
            <Textarea value={suspendReason} onChange={e => setSuspendReason(e.target.value)} rows={3} className="mt-1.5" data-testid="input-suspend-reason" />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setShowSuspendDialog(false)}>Cancel</Button>
            <Button size="sm" className="bg-red-500 hover:bg-red-600 text-white" onClick={() => { onSuspend(suspendReason); setShowSuspendDialog(false); }} data-testid="button-confirm-suspend">
              Suspend
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Reset Password for {user.name}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Set a temporary password. The user will be required to change it on next login.</p>
          <div><Label className="text-xs">New Password</Label>
            <Input type="text" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="mt-1.5" placeholder="Min 6 characters" data-testid="input-new-password" />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setShowResetDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={() => { onResetPassword(newPassword); setShowResetDialog(false); setNewPassword(""); }} disabled={newPassword.length < 6} data-testid="button-confirm-reset-password">
              Reset Password
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateUserForm({ onSubmit, isPending, isMasterAdmin }: { onSubmit: (d: Record<string, unknown>) => void; isPending: boolean; isMasterAdmin: boolean }) {
  const [form, setForm] = useState({ name: "", email: "", globalRole: "sales", userType: "internal", department: "", jobTitle: "" });

  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(form); }} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Label>Full Name *</Label>
          <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className="mt-1.5" data-testid="input-new-user-name" />
        </div>
        <div className="col-span-2"><Label>Email *</Label>
          <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required className="mt-1.5" data-testid="input-new-user-email" />
        </div>
        <div><Label>Role</Label>
          <Select value={form.globalRole} onValueChange={v => setForm(f => ({ ...f, globalRole: v }))}>
            <SelectTrigger className="mt-1.5" data-testid="select-new-user-role"><SelectValue /></SelectTrigger>
            <SelectContent>
              {GLOBAL_ROLES.filter(r => isMasterAdmin || r.value !== "master_admin").map(r => (
                <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div><Label>User Type</Label>
          <Select value={form.userType} onValueChange={v => setForm(f => ({ ...f, userType: v }))}>
            <SelectTrigger className="mt-1.5" data-testid="select-new-user-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="internal">Internal</SelectItem>
              <SelectItem value="external">External</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label>Department</Label>
          <Input value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} className="mt-1.5" data-testid="input-new-user-department" />
        </div>
        <div><Label>Job Title</Label>
          <Input value={form.jobTitle} onChange={e => setForm(f => ({ ...f, jobTitle: e.target.value }))} className="mt-1.5" data-testid="input-new-user-jobtitle" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground bg-secondary/30 rounded-lg p-3">A temporary password will be generated. You can reset it after creation.</p>
      <Button type="submit" className="w-full bg-primary text-primary-foreground" disabled={isPending} data-testid="button-submit-create-user">
        {isPending ? "Creating..." : "Create User"}
      </Button>
    </form>
  );
}
