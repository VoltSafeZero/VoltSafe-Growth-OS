import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
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
  UserCheck, UserX, KeyRound, Edit2, X, Mail, Briefcase, Wrench, HeartHandshake,
  Clock, ChevronRight, AlertTriangle, CheckCircle2,
  UserCog, Crown, Eye, Lock, Unlock, Trash2, ShieldAlert,
  Building2, CalendarClock, Layers, Megaphone, Users2, BookOpen, LifeBuoy, FileText, GraduationCap,
} from "lucide-react";

type AccessLevel = "none" | "view" | "edit";

type UserPermissions = {
  crm: AccessLevel;
  partnerships: AccessLevel;
  projects: AccessLevel;
  communications: AccessLevel;
  team_workload: AccessLevel;
  knowledge: AccessLevel;
  support: AccessLevel;
  quoting: AccessLevel;
  calendar: AccessLevel;
  mail_team: Record<string, { view: boolean; edit: boolean }>;
  calendar_team: number[];
};

const DEFAULT_PERMISSIONS: UserPermissions = {
  crm: "edit", partnerships: "edit", projects: "edit",
  communications: "edit", team_workload: "edit", knowledge: "edit",
  support: "edit", quoting: "edit", calendar: "edit",
  mail_team: {}, calendar_team: [],
};

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
  permissions: UserPermissions | null;
  createdAt: string;
  lastLogin: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
};

const GLOBAL_ROLES = [
  { value: "master_admin", label: "Master Admin", icon: Crown, color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/30" },
  { value: "admin", label: "Admin", icon: ShieldCheck, color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/30" },
  { value: "manager", label: "Manager", icon: UserCog, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30" },
  { value: "engineer", label: "Engineer", icon: Wrench, color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/30" },
  { value: "sales", label: "Sales", icon: Briefcase, color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/30" },
  { value: "customer_success", label: "Customer Success", icon: HeartHandshake, color: "text-pink-400", bg: "bg-pink-500/10", border: "border-pink-500/30" },
  { value: "analyst", label: "Analyst", icon: Eye, color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/30" },
  { value: "advisor", label: "Advisor", icon: GraduationCap, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30" },
  { value: "read_only", label: "Read Only", icon: Lock, color: "text-gray-400", bg: "bg-gray-500/10", border: "border-gray-500/30" },
];

const STATUS_CONFIG = {
  active: { label: "Active", color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/30", icon: CheckCircle2 },
  invited: { label: "Invited", color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30", icon: Mail },
  suspended: { label: "Suspended", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30", icon: UserX },
  deactivated: { label: "Deactivated", color: "text-gray-400", bg: "bg-gray-500/10", border: "border-gray-500/30", icon: X },
};

const SECTION_DEFS = [
  { key: "crm", label: "Growth OS", description: "Accounts, Contacts, Opportunities, Pipeline", icon: Building2 },
  { key: "partnerships", label: "Industry Partnerships", description: "All partnership types", icon: Users2 },
  { key: "projects", label: "Projects", description: "Project management", icon: Layers },
  { key: "communications", label: "Communications", description: "Campaigns & comm lists", icon: Megaphone },
  { key: "team_workload", label: "Team Workload", description: "Workload overview", icon: Users },
  { key: "knowledge", label: "Knowledge", description: "Assets & Price Lists", icon: BookOpen },
  { key: "support", label: "Support", description: "Tickets", icon: LifeBuoy },
  { key: "quoting", label: "Quoting & Price Lists", description: "Quotes and pricing", icon: FileText },
  { key: "calendar", label: "Calendar", description: "Calendar & scheduling", icon: CalendarClock },
] as const;

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

function AccessLevelSelector({ value, onChange, disabled }: { value: AccessLevel; onChange: (v: AccessLevel) => void; disabled?: boolean }) {
  const options: { v: AccessLevel; label: string }[] = [
    { v: "none", label: "No Access" },
    { v: "view", label: "View Only" },
    { v: "edit", label: "View & Edit" },
  ];
  return (
    <div className={`flex rounded-md overflow-hidden border border-border/50 ${disabled ? "opacity-40 pointer-events-none" : ""}`}>
      {options.map(opt => (
        <button
          key={opt.v}
          onClick={() => onChange(opt.v)}
          className={`flex-1 text-[11px] font-medium py-1 px-1.5 transition-colors whitespace-nowrap ${
            value === opt.v
              ? opt.v === "none" ? "bg-red-500/20 text-red-300" : opt.v === "view" ? "bg-amber-500/20 text-amber-300" : "bg-teal-500/20 text-teal-300"
              : "bg-secondary/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          }`}
          data-testid={`access-level-${opt.v}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function AccessTab({ user, currentUserId }: { user: AdminUser; currentUserId: number }) {
  const { toast } = useToast();
  const isAdminUser = ["master_admin", "admin"].includes(user.globalRole);

  const perms: UserPermissions = { ...DEFAULT_PERMISSIONS, ...(user.permissions ?? {}) };

  const teamAccountsQuery = useQuery<{ id: number; emailAddress: string; displayName: string | null }[]>({
    queryKey: ["/api/admin/team-accounts"],
  });

  const teamMembersQuery = useQuery<{ id: number; name: string; email: string }[]>({
    queryKey: ["/api/admin/team-members"],
  });

  const permsMutation = useMutation({
    mutationFn: (newPerms: UserPermissions) =>
      apiRequest("PATCH", `/api/admin/users/${user.id}/permissions`, newPerms),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Permissions saved", description: `Updated access for ${user.name}` });
    },
    onError: () => toast({ title: "Failed to save permissions", variant: "destructive" }),
  });

  function updateSection(key: keyof typeof DEFAULT_PERMISSIONS, value: AccessLevel) {
    const updated = { ...perms, [key]: value };
    permsMutation.mutate(updated);
  }

  function updateMailTeam(inboxId: number, field: "view" | "edit", value: boolean) {
    const current = perms.mail_team[String(inboxId)] ?? { view: false, edit: false };
    const updated: UserPermissions = {
      ...perms,
      mail_team: {
        ...perms.mail_team,
        [String(inboxId)]: field === "view"
          ? { view: value, edit: value ? current.edit : false }
          : { view: current.view, edit: value },
      },
    };
    permsMutation.mutate(updated);
  }

  function updateCalendarTeam(memberId: number, checked: boolean) {
    const current = perms.calendar_team ?? [];
    const updated: UserPermissions = {
      ...perms,
      calendar_team: checked ? [...current, memberId] : current.filter(id => id !== memberId),
    };
    permsMutation.mutate(updated);
  }

  if (isAdminUser) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center px-4">
        <ShieldAlert className="w-8 h-8 text-primary/50 mb-2" />
        <p className="text-sm font-medium">Admin users have full access</p>
        <p className="text-xs text-muted-foreground mt-1">Master Admins and Admins bypass all permission restrictions.</p>
        <p className="text-xs text-muted-foreground/60 mt-3">To configure access for a team member, select a non-admin user from the list.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Section access */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Section Access</h3>
        <div className="space-y-2">
          {SECTION_DEFS.map(({ key, label, description, icon: Icon }) => (
            <div key={key} className="flex items-center gap-3 py-1.5">
              <Icon className="w-4 h-4 text-muted-foreground/60 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{label}</p>
                <p className="text-[11px] text-muted-foreground">{description}</p>
              </div>
              <div className="shrink-0 w-52">
                <AccessLevelSelector
                  value={(perms[key as keyof UserPermissions] as AccessLevel) ?? "edit"}
                  onChange={(v) => updateSection(key as keyof typeof DEFAULT_PERMISSIONS, v)}
                  disabled={permsMutation.isPending}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-border/40" />

      {/* Team inbox access */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Team Email Inboxes</h3>
        {teamAccountsQuery.isLoading && <p className="text-xs text-muted-foreground">Loading inboxes…</p>}
        {!teamAccountsQuery.isLoading && (teamAccountsQuery.data ?? []).length === 0 && (
          <p className="text-xs text-muted-foreground italic">No team inboxes connected yet.</p>
        )}
        <div className="space-y-2">
          {(teamAccountsQuery.data ?? []).map((acct) => {
            const entry = perms.mail_team[String(acct.id)] ?? { view: false, edit: false };
            return (
              <div key={acct.id} className="flex items-center gap-3 py-1 rounded-md bg-secondary/10 px-3">
                <span className="flex-shrink-0 h-6 w-6 rounded-full bg-teal-900/60 text-teal-300 flex items-center justify-center text-[11px] font-bold">
                  {acct.emailAddress[0].toUpperCase()}
                </span>
                <span className="flex-1 text-sm font-medium truncate">{acct.emailAddress}</span>
                <label className="flex items-center gap-1.5 cursor-pointer select-none" data-testid={`checkbox-inbox-view-${acct.id}`}>
                  <input type="checkbox" className="accent-teal-500" checked={entry.view}
                    onChange={e => updateMailTeam(acct.id, "view", e.target.checked)} disabled={permsMutation.isPending} />
                  <span className="text-[11px] text-muted-foreground">View</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer select-none" data-testid={`checkbox-inbox-edit-${acct.id}`}>
                  <input type="checkbox" className="accent-teal-500" checked={entry.edit && entry.view}
                    onChange={e => updateMailTeam(acct.id, "edit", e.target.checked)} disabled={permsMutation.isPending || !entry.view} />
                  <span className="text-[11px] text-muted-foreground">Reply/Send</span>
                </label>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t border-border/40" />

      {/* Calendar team overlays */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Calendar Overlays</h3>
        <p className="text-[11px] text-muted-foreground mb-3">Choose which team members' calendars this user can see.</p>
        {teamMembersQuery.isLoading && <p className="text-xs text-muted-foreground">Loading members…</p>}
        <div className="space-y-1.5">
          {(teamMembersQuery.data ?? []).filter(m => m.id !== user.id).map((member) => {
            const checked = (perms.calendar_team ?? []).includes(member.id);
            return (
              <label key={member.id} className="flex items-center gap-2.5 py-1 cursor-pointer select-none" data-testid={`checkbox-calendar-${member.id}`}>
                <input type="checkbox" className="accent-teal-500" checked={checked}
                  onChange={e => updateCalendarTeam(member.id, e.target.checked)} disabled={permsMutation.isPending} />
                <UserInitial name={member.name} />
                <div>
                  <p className="text-sm font-medium">{member.name}</p>
                  <p className="text-[11px] text-muted-foreground">{member.email}</p>
                </div>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function AdminUsersPage({ currentUserGlobalRole }: { currentUserGlobalRole: string }) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const isMasterAdmin = currentUserGlobalRole === "master_admin";
  const isAdminRole = ["master_admin", "admin"].includes(currentUserGlobalRole);

  if (!isAdminRole) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-8">
        <ShieldCheck className="w-12 h-12 text-muted-foreground/40" />
        <h2 className="text-xl font-semibold">Access Denied</h2>
        <p className="text-muted-foreground text-sm max-w-xs">You don't have permission to view this page. Contact your administrator.</p>
      </div>
    );
  }

  const { data: allUsers = [], isLoading } = useQuery<AdminUser[]>({ queryKey: ["/api/admin/users"] });

  // Derive the selected user from live query data so permission changes reflect immediately
  const selectedUser = selectedUserId != null ? (allUsers.find(u => u.id === selectedUserId) ?? null) : null;

  const meQuery = useQuery<{ id: number }>({ queryKey: ["/api/auth/me"] });
  const currentUserId = meQuery.data?.id ?? 0;

  const filtered = allUsers.filter(u => {
    const matchSearch = !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase()) || (u.department ?? "").toLowerCase().includes(search.toLowerCase());
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

  function mutationOpts(successMsg: string) {
    return {
      onSuccess: async (res: Response) => {
        const data = await res.json().catch(() => null);
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
        toast({ title: successMsg });
      },
      onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
    };
  }

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: number } & Record<string, unknown>) => apiRequest("PUT", `/api/admin/users/${id}`, data),
    ...mutationOpts("User updated"),
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiRequest("POST", "/api/admin/users", data),
    onSuccess: async (res: Response) => {
      const data = await res.json().catch(() => null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setCreateOpen(false);
      toast({ title: `User created`, description: data?.name ? `${data.name} has been added.` : "User added." });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const suspendMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
      apiRequest("PUT", `/api/admin/users/${id}`, { status: "suspended", suspendedReason: reason }),
    ...mutationOpts("User suspended"),
  });

  const activateMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PUT", `/api/admin/users/${id}`, { status: "active" }),
    ...mutationOpts("User reactivated"),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: ({ id, newPassword }: { id: number; newPassword: string }) =>
      apiRequest("POST", `/api/admin/users/${id}/reset-password`, { newPassword }),
    ...mutationOpts("Password reset"),
  });

  const resendInviteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/admin/users/${id}/resend-invite`, {}),
    ...mutationOpts("Invite resent — new credentials emailed"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setSelectedUserId(null);
      toast({ title: "User deleted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="flex h-full overflow-hidden" data-testid="page-admin-users">
      {/* Left panel */}
      <div className={`flex flex-col ${selectedUser ? "hidden lg:flex lg:w-[420px] lg:shrink-0" : "flex-1"} border-r border-border/50 overflow-hidden`}>
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-border/50">
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

          <div className="grid grid-cols-4 gap-3 mt-4">
            {[
              { label: "Total", value: stats.total, icon: Users, color: "text-primary", bg: "bg-primary/10" },
              { label: "Active", value: stats.active, icon: UserCheck, color: "text-green-400", bg: "bg-green-500/10" },
              { label: "Invited", value: stats.invited, icon: Mail, color: "text-blue-400", bg: "bg-blue-500/10" },
              { label: "Suspended", value: stats.suspended, icon: UserX, color: "text-red-400", bg: "bg-red-500/10" },
            ].map(s => (
              <Card key={s.label} className="border-border/50 bg-card/50" data-testid={`card-user-stat-${s.label.toLowerCase()}`}>
                <CardContent className="p-3 flex flex-col gap-1.5">
                  <div className={`w-7 h-7 rounded-md ${s.bg} flex items-center justify-center`}>
                    <s.icon className={`w-3.5 h-3.5 ${s.color}`} />
                  </div>
                  <div className="text-xl font-bold leading-none">{s.value}</div>
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="px-4 sm:px-6 py-3 flex gap-3 flex-wrap border-b border-border/30">
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)}
              className="pl-9 h-9 bg-secondary/30 border-transparent focus-visible:border-primary/50" data-testid="input-search-users" />
          </div>
          <Select value={filterRole} onValueChange={setFilterRole}>
            <SelectTrigger className="w-36 h-9 bg-secondary/30 border-transparent" data-testid="select-filter-role"><SelectValue placeholder="All Roles" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              {GLOBAL_ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-36 h-9 bg-secondary/30 border-transparent" data-testid="select-filter-status"><SelectValue placeholder="All Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="invited">Invited</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* User list */}
        <div className="flex-1 overflow-auto pb-36 lg:pb-24">
          {isLoading ? (
            <div className="p-6 space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-secondary/20 rounded-lg animate-pulse" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">No users found</div>
          ) : (
            <div className="divide-y divide-border/30">
              {filtered.map(user => (
                <div key={user.id}
                  className={`flex items-center gap-4 px-6 py-4 cursor-pointer hover:bg-muted/30 transition-colors ${selectedUserId === user.id ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
                  onClick={() => setSelectedUserId(prev => prev === user.id ? null : user.id)}
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
                    <div className="flex items-center gap-1 justify-end"><Clock className="w-3 h-3" />{user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : "Never"}</div>
                    <div className="text-xs text-muted-foreground/60 mt-0.5">Last login</div>
                  </div>
                  <ChevronRight className={`w-4 h-4 text-muted-foreground/40 shrink-0 transition-transform ${selectedUserId === user.id ? "rotate-90 text-primary" : ""}`} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail Panel */}
      {selectedUser && (
        <UserDetailPanel
          key={selectedUser.id}
          user={selectedUser}
          currentUserId={currentUserId}
          isMasterAdmin={isMasterAdmin}
          onClose={() => setSelectedUserId(null)}
          onUpdate={(data) => updateMutation.mutate({ id: selectedUser.id, ...data })}
          onSuspend={(reason) => suspendMutation.mutate({ id: selectedUser.id, reason })}
          onActivate={() => activateMutation.mutate(selectedUser.id)}
          onResendInvite={() => resendInviteMutation.mutate(selectedUser.id)}
          onResetPassword={(newPassword) => resetPasswordMutation.mutate({ id: selectedUser.id, newPassword })}
          onDelete={() => deleteMutation.mutate(selectedUser.id)}
          isPending={updateMutation.isPending || suspendMutation.isPending || activateMutation.isPending || deleteMutation.isPending || resendInviteMutation.isPending}
        />
      )}
    </div>
  );
}

function UserDetailPanel({ user, currentUserId, isMasterAdmin, onClose, onUpdate, onSuspend, onActivate, onResendInvite, onResetPassword, onDelete, isPending }: {
  user: AdminUser;
  currentUserId: number;
  isMasterAdmin: boolean;
  onClose: () => void;
  onUpdate: (data: Record<string, unknown>) => void;
  onSuspend: (reason?: string) => void;
  onActivate: () => void;
  onResendInvite: () => void;
  onResetPassword: (pw: string) => void;
  onDelete: () => void;
  isPending: boolean;
}) {
  const [activeTab, setActiveTab] = useState<"info" | "access">("info");
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

  function handleSave() { onUpdate(form); setEditMode(false); }

  return (
    <div className="flex-1 flex flex-col overflow-hidden" data-testid="panel-user-detail">
      {/* Panel header */}
      <div className="px-4 sm:px-6 py-4 border-b border-border/50 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <UserInitial name={user.name} size="lg" />
          <div>
            <h2 className="text-lg font-semibold">{user.name}</h2>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-user-panel"><X className="w-4 h-4" /></Button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border/50">
        {([["info", "Profile"], ["access", "Access"]] as const).map(([tab, label]) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 ${activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            data-testid={`tab-${tab}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-6 pb-36 lg:pb-24 space-y-6">
        {activeTab === "info" ? (
          <>
            {/* Status + Role badges */}
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className={`${statusCfg.color} ${statusCfg.bg} ${statusCfg.border} gap-1`}><StatusIcon className="w-3 h-3" />{statusCfg.label}</Badge>
              <Badge variant="outline" className={`${roleCfg.color} ${roleCfg.bg} ${roleCfg.border} gap-1`}><RoleIcon className="w-3 h-3" />{roleCfg.label}</Badge>
              {user.userType === "external" && <Badge variant="outline" className="text-xs text-orange-400 bg-orange-500/10 border-orange-500/30">External</Badge>}
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
                  <div><Label className="text-xs">Full Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="mt-1.5 h-9" data-testid="input-edit-name" /></div>
                  <div><Label className="text-xs">Email</Label><Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="mt-1.5 h-9" data-testid="input-edit-email" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs">Department</Label><Input value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} className="mt-1.5 h-9" data-testid="input-edit-department" /></div>
                  <div><Label className="text-xs">Job Title</Label><Input value={form.jobTitle} onChange={e => setForm(f => ({ ...f, jobTitle: e.target.value }))} className="mt-1.5 h-9" data-testid="input-edit-jobtitle" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs">Role</Label>
                    <Select value={form.globalRole} onValueChange={v => setForm(f => ({ ...f, globalRole: v }))}>
                      <SelectTrigger className="mt-1.5 h-9" data-testid="select-edit-role"><SelectValue /></SelectTrigger>
                      <SelectContent>{GLOBAL_ROLES.filter(r => isMasterAdmin || r.value !== "master_admin").map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label className="text-xs">User Type</Label>
                    <Select value={form.userType} onValueChange={v => setForm(f => ({ ...f, userType: v }))}>
                      <SelectTrigger className="mt-1.5 h-9" data-testid="select-edit-usertype"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="internal">Internal</SelectItem><SelectItem value="external">External</SelectItem></SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSave} disabled={isPending} data-testid="button-save-user">Save Changes</Button>
                  <Button size="sm" variant="outline" onClick={() => setEditMode(false)}>Cancel</Button>
                </div>
              </div>
            )}

            {user.status === "suspended" && user.suspendedAt && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                <div className="flex items-center gap-2 text-red-400 font-medium text-sm mb-1"><AlertTriangle className="w-4 h-4" /> Suspended</div>
                <p className="text-xs text-muted-foreground">Since: {new Date(user.suspendedAt).toLocaleDateString()}</p>
                {user.suspendedReason && <p className="text-xs text-muted-foreground mt-1">Reason: {user.suspendedReason}</p>}
              </div>
            )}

            <div className="border-t border-border/40" />

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Actions</h3>
              <div className="grid grid-cols-1 gap-2">
                <Button variant="outline" size="sm" className="justify-start gap-2 h-9" onClick={() => setEditMode(e => !e)} data-testid="button-edit-user">
                  <Edit2 className="w-4 h-4" />{editMode ? "Cancel Edit" : "Edit Profile"}
                </Button>
                {user.status !== "suspended" ? (
                  <Button variant="outline" size="sm" className="justify-start gap-2 h-9 text-red-400 border-red-500/30 hover:bg-red-500/10" onClick={() => setShowSuspendDialog(true)} data-testid="button-suspend-user">
                    <UserX className="w-4 h-4" />Suspend User
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" className="justify-start gap-2 h-9 text-green-400 border-green-500/30 hover:bg-green-500/10" onClick={onActivate} disabled={isPending} data-testid="button-activate-user">
                    <Unlock className="w-4 h-4" />Reactivate User
                  </Button>
                )}
                {user.status === "invited" && (
                  <Button variant="outline" size="sm" className="justify-start gap-2 h-9 text-blue-400 border-blue-500/30 hover:bg-blue-500/10" onClick={onResendInvite} disabled={isPending} data-testid="button-resend-invite">
                    <Mail className="w-4 h-4" />Resend Invite Email
                  </Button>
                )}
                <Button variant="outline" size="sm" className="justify-start gap-2 h-9" onClick={() => setShowResetDialog(true)} data-testid="button-reset-password">
                  <KeyRound className="w-4 h-4" />Reset Password
                </Button>
                <Button variant="outline" size="sm" className="justify-start gap-2 h-9 text-red-400 border-red-500/30 hover:bg-red-500/10 mt-2" onClick={() => setShowDeleteDialog(true)} data-testid="button-delete-user">
                  <Trash2 className="w-4 h-4" />Delete User
                </Button>
              </div>
            </div>
          </>
        ) : (
          <AccessTab user={user} currentUserId={currentUserId} />
        )}
      </div>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-red-400">Delete {user.name}?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This will permanently delete the account for <strong>{user.email}</strong>. This cannot be undone.</p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
            <Button size="sm" className="bg-red-500 hover:bg-red-600 text-white" disabled={isPending} onClick={() => { onDelete(); setShowDeleteDialog(false); }} data-testid="button-confirm-delete-user">Delete Permanently</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showSuspendDialog} onOpenChange={setShowSuspendDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-red-400">Suspend {user.name}?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This user will be locked out immediately. You can reactivate them at any time.</p>
          <div><Label className="text-xs">Reason (optional)</Label><Textarea value={suspendReason} onChange={e => setSuspendReason(e.target.value)} rows={3} className="mt-1.5" data-testid="input-suspend-reason" /></div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setShowSuspendDialog(false)}>Cancel</Button>
            <Button size="sm" className="bg-red-500 hover:bg-red-600 text-white" onClick={() => { onSuspend(suspendReason); setShowSuspendDialog(false); }} data-testid="button-confirm-suspend">Suspend</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Reset Password for {user.name}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Set a temporary password. The user will be required to change it on next login.</p>
          <div><Label className="text-xs">New Password</Label><Input type="text" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="mt-1.5" placeholder="Min 6 characters" data-testid="input-new-password" /></div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setShowResetDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={() => { onResetPassword(newPassword); setShowResetDialog(false); setNewPassword(""); }} disabled={newPassword.length < 6} data-testid="button-confirm-reset-password">Reset Password</Button>
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
        <div className="col-span-2"><Label>Full Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className="mt-1.5" data-testid="input-new-user-name" /></div>
        <div className="col-span-2"><Label>Email *</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required className="mt-1.5" data-testid="input-new-user-email" /></div>
        <div><Label>Role</Label>
          <Select value={form.globalRole} onValueChange={v => setForm(f => ({ ...f, globalRole: v }))}>
            <SelectTrigger className="mt-1.5" data-testid="select-new-user-role"><SelectValue /></SelectTrigger>
            <SelectContent>{GLOBAL_ROLES.filter(r => isMasterAdmin || r.value !== "master_admin").map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>User Type</Label>
          <Select value={form.userType} onValueChange={v => setForm(f => ({ ...f, userType: v }))}>
            <SelectTrigger className="mt-1.5" data-testid="select-new-user-type"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="internal">Internal</SelectItem><SelectItem value="external">External</SelectItem></SelectContent>
          </Select>
        </div>
        <div><Label>Department</Label><Input value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} className="mt-1.5" data-testid="input-new-user-department" /></div>
        <div><Label>Job Title</Label><Input value={form.jobTitle} onChange={e => setForm(f => ({ ...f, jobTitle: e.target.value }))} className="mt-1.5" data-testid="input-new-user-jobtitle" /></div>
      </div>
      <p className="text-xs text-muted-foreground bg-secondary/30 rounded-lg p-3">A temporary password will be generated. You can reset it after creation.</p>
      <Button type="submit" className="w-full bg-primary text-primary-foreground" disabled={isPending} data-testid="button-submit-create-user">{isPending ? "Creating..." : "Create User"}</Button>
    </form>
  );
}
