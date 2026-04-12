import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Anchor, Loader2, CheckCircle2, XCircle, Eye, EyeOff } from "lucide-react";

type AuthUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  globalRole: string;
  status: string;
  mustChangePassword: boolean;
  permissions: Record<string, unknown>;
};

export default function ResetPasswordPage({ onLogin, token }: { onLogin: (user: AuthUser) => void; token: string }) {
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<"verifying" | "ready" | "error">("verifying");
  const [errorMsg, setErrorMsg] = useState("");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setErrorMsg("No reset token found. Please request a new password reset.");
      return;
    }

    fetch("/api/auth/reset-password-by-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token }),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          setStatus("error");
          setErrorMsg(data.message || "This link is invalid or has expired.");
        } else {
          setUser(data);
          setStatus("ready");
        }
      })
      .catch(() => {
        setStatus("error");
        setErrorMsg("Something went wrong. Please try again.");
      });
  }, [token]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      setErrorMsg("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirm) {
      setErrorMsg("Passwords don't match.");
      return;
    }
    setErrorMsg("");
    setSaving(true);

    try {
      const res = await fetch("/api/auth/change-password-forced", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.message || "Failed to save password.");
        return;
      }
      setSaved(true);
      // Log the user in
      if (user) {
        setTimeout(() => onLogin({ ...user, mustChangePassword: false }), 1500);
      }
    } catch {
      setErrorMsg("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-sm border-border/50 bg-card">
        <CardHeader className="text-center pb-4">
          <div className="flex justify-center mb-4">
            <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center shadow-lg shadow-primary/20">
              <Anchor className="w-7 h-7 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">
            VoltSafe <span className="text-primary">Cortex</span>
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">Set a new password</p>
        </CardHeader>

        <CardContent>
          {status === "verifying" && (
            <div className="flex flex-col items-center gap-3 py-6 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <p className="text-sm">Verifying your reset link…</p>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
                <XCircle className="w-6 h-6 text-red-400" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-red-400">Link invalid or expired</p>
                <p className="text-xs text-muted-foreground mt-1">{errorMsg}</p>
              </div>
              <Button
                variant="outline"
                className="w-full mt-2"
                onClick={() => navigate("/")}
                data-testid="button-back-to-login"
              >
                Back to Sign In
              </Button>
            </div>
          )}

          {status === "ready" && !saved && (
            <form onSubmit={handleSave} className="space-y-4">
              {user && (
                <p className="text-sm text-muted-foreground text-center">
                  Signed in as <span className="font-medium text-foreground">{user.name}</span>.
                  Choose a strong new password.
                </p>
              )}

              <div>
                <Label className="text-xs">New Password</Label>
                <div className="relative mt-1.5">
                  <Input
                    type={showPw ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    required
                    autoFocus
                    data-testid="input-new-password"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                    onClick={() => setShowPw(v => !v)}
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <Label className="text-xs">Confirm Password</Label>
                <div className="relative mt-1.5">
                  <Input
                    type={showConfirm ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Re-enter your password"
                    required
                    data-testid="input-confirm-password"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                    onClick={() => setShowConfirm(v => !v)}
                  >
                    {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {errorMsg && (
                <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2" data-testid="text-reset-error">
                  {errorMsg}
                </p>
              )}

              <Button
                type="submit"
                className="w-full bg-primary text-primary-foreground"
                disabled={saving || !newPassword || !confirm}
                data-testid="button-save-new-password"
              >
                {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : "Set New Password"}
              </Button>
            </form>
          )}

          {saved && (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="w-12 h-12 rounded-full bg-teal-500/10 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-teal-400" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">Password updated!</p>
                <p className="text-xs text-muted-foreground mt-1">Signing you in…</p>
              </div>
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
