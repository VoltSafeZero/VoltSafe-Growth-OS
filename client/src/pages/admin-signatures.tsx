import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, Pencil, ShieldAlert, CheckCircle2, XCircle, Crown } from "lucide-react";
import { SignatureDialog } from "@/pages/signature-settings";
import type { EmailSignature } from "@/pages/signature-settings";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type UserSigRow = {
  userId: number;
  name: string;
  email: string;
  globalRole: string;
  hasSignature: boolean;
  sigName: string | null;
  updatedAt: string | null;
};

type AdminSigPayload = {
  user: { id: number; name: string; email: string };
  signature: EmailSignature | null;
};

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  master_admin: { label: "Master Admin", color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30" },
  admin:        { label: "Admin",        color: "bg-purple-500/10 text-purple-400 border-purple-500/30" },
  sales:        { label: "Sales",        color: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
  manager:      { label: "Manager",      color: "bg-teal-500/10 text-teal-400 border-teal-500/30" },
  advisor:      { label: "Advisor",      color: "bg-orange-500/10 text-orange-400 border-orange-500/30" },
};

function RoleBadge({ role }: { role: string }) {
  const cfg = ROLE_LABELS[role] ?? { label: role, color: "bg-muted text-muted-foreground border-border" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${cfg.color}`}>
      {role === "master_admin" && <Crown className="h-2.5 w-2.5 mr-1" />}
      {cfg.label}
    </span>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function AdminSignaturesPage({ currentUserGlobalRole }: { currentUserGlobalRole: string }) {
  const { toast } = useToast();
  const isMasterAdmin = currentUserGlobalRole === "master_admin";
  const [search, setSearch] = useState("");
  const [editTarget, setEditTarget] = useState<{ user: { id: number; name: string; email: string }; signature: EmailSignature | null } | null>(null);
  const [loadingUserId, setLoadingUserId] = useState<number | null>(null);

  const usersQuery = useQuery<UserSigRow[]>({
    queryKey: ["/api/admin/users/signatures"],
    enabled: isMasterAdmin,
  });

  const filtered = (usersQuery.data ?? []).filter(u => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  async function handleEdit(user: UserSigRow) {
    setLoadingUserId(user.userId);
    try {
      const res = await apiRequest("GET", `/api/admin/users/${user.userId}/signature`);
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as any).message || "Failed to load signature");
      }
      const data: AdminSigPayload = await res.json();
      setEditTarget(data);
    } catch (err: any) {
      toast({ title: "Failed to load signature", description: err.message, variant: "destructive" });
    } finally {
      setLoadingUserId(null);
    }
  }

  if (!isMasterAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center p-8">
        <div className="w-16 h-16 rounded-full bg-muted/40 flex items-center justify-center mb-4">
          <ShieldAlert className="w-8 h-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Master Admin Only</h2>
        <p className="text-muted-foreground text-sm max-w-sm">
          Only Master Admins can view and edit all users' email signatures. Contact a Master Admin if you need access.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Crown className="h-5 w-5 text-yellow-400" />
          <h1 className="text-xl font-semibold">User Signatures</h1>
          <Badge variant="outline" className="text-[10px] border-yellow-500/40 text-yellow-400 bg-yellow-500/10">Master Admin</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          View and edit email signatures for any VoltSafe Mail user. Changes are saved immediately and take effect on the user's next send.
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or email…"
          className="pl-8 h-9 text-sm"
          data-testid="input-admin-sig-search"
        />
      </div>

      <Card className="border-border bg-card">
        <CardContent className="p-0">
          {usersQuery.isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : usersQuery.isError ? (
            <div className="flex items-center justify-center py-16 text-sm text-destructive">
              Failed to load users. You may not have sufficient permissions.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Name</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">Email</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden md:table-cell">Role</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Signature</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden lg:table-cell">Last Updated</th>
                    <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-muted-foreground text-sm">
                        {search ? "No users match your search." : "No users found."}
                      </td>
                    </tr>
                  ) : filtered.map(user => (
                    <tr
                      key={user.userId}
                      className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                      data-testid={`row-user-sig-${user.userId}`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{user.name}</div>
                        <div className="text-xs text-muted-foreground sm:hidden">{user.email}</div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">{user.email}</td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <RoleBadge role={user.globalRole} />
                      </td>
                      <td className="px-4 py-3">
                        {user.hasSignature ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {user.sigName ?? "Set"}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <XCircle className="h-3.5 w-3.5" />
                            None
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">
                        {formatDate(user.updatedAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1.5"
                          onClick={() => handleEdit(user)}
                          disabled={loadingUserId === user.userId}
                          data-testid={`button-edit-sig-${user.userId}`}
                        >
                          {loadingUserId === user.userId
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Pencil className="h-3 w-3" />}
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {editTarget && (
        <SignatureDialog
          open={!!editTarget}
          onClose={() => setEditTarget(null)}
          existing={editTarget.signature}
          adminTargetUser={editTarget.user}
        />
      )}
    </div>
  );
}
