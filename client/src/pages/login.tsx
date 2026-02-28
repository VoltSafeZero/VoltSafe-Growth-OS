import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Anchor, LogIn, Eye, EyeOff, Fingerprint, Loader2 } from "lucide-react";
import { startAuthentication } from "@simplewebauthn/browser";

type AuthUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  mustChangePassword: boolean;
};

export default function LoginPage({ onLogin }: { onLogin: (user: AuthUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [biometricSupported, setBiometricSupported] = useState(false);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.PublicKeyCredential &&
      typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function"
    ) {
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().then(
        (available) => setBiometricSupported(available)
      );
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include",
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Login failed");
        return;
      }

      onLogin(data);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleBiometricLogin = async () => {
    setError("");
    setBiometricLoading(true);

    try {
      const optionsRes = await fetch("/api/webauthn/auth-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!optionsRes.ok) throw new Error("Failed to get authentication options");
      const options = await optionsRes.json();

      const authentication = await startAuthentication({ optionsJSON: options });

      const verifyRes = await fetch("/api/webauthn/auth-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(authentication),
      });

      const data = await verifyRes.json();
      if (!verifyRes.ok) {
        setError(data.message || "Biometric authentication failed");
        return;
      }

      onLogin(data);
    } catch (e: any) {
      if (e.name === "NotAllowedError") {
        setError("Biometric authentication was cancelled.");
      } else {
        setError(e.message || "Biometric authentication failed. Please use your password.");
      }
    } finally {
      setBiometricLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-sm border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="text-center pb-4">
          <div className="flex justify-center mb-4">
            <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center shadow-lg shadow-primary/20">
              <Anchor className="w-7 h-7 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">
            VoltSafe <span className="text-primary">Cortex</span>
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">Sign in to your CMS account</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {biometricSupported && (
            <>
              <Button
                type="button"
                variant="outline"
                className="w-full border-primary/30 hover:border-primary/60"
                onClick={handleBiometricLogin}
                disabled={biometricLoading}
                data-testid="button-biometric-login"
              >
                {biometricLoading ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying...</>
                ) : (
                  <><Fingerprint className="mr-2 h-4 w-4" /> Sign in with Face ID / Biometric</>
                )}
              </Button>

              <div className="relative">
                <Separator />
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-3 text-xs text-muted-foreground">
                  or use password
                </span>
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@voltsafe.com"
                required
                autoFocus={!biometricSupported}
                data-testid="input-login-email"
              />
            </div>
            <div>
              <Label>Password</Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  data-testid="input-login-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                  onClick={() => setShowPassword(!showPassword)}
                  data-testid="button-toggle-password"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2" data-testid="text-login-error">
                {error}
              </p>
            )}

            <Button
              type="submit"
              className="w-full bg-primary text-primary-foreground"
              disabled={loading}
              data-testid="button-login"
            >
              {loading ? "Signing in..." : (
                <>
                  <LogIn className="mr-2 h-4 w-4" /> Sign In
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
