import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Fingerprint, Trash2, Shield, Smartphone, Loader2 } from "lucide-react";
import { startRegistration } from "@simplewebauthn/browser";

type Credential = {
  id: number;
  deviceName: string | null;
  createdAt: string;
};

export default function SettingsPage() {
  const { toast } = useToast();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(
      typeof window !== "undefined" &&
        !!window.PublicKeyCredential &&
        typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function"
    );
    fetchCredentials();
  }, []);

  const fetchCredentials = async () => {
    try {
      const res = await fetch("/api/webauthn/credentials", { credentials: "include" });
      if (res.ok) setCredentials(await res.json());
    } catch {
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    setRegistering(true);
    try {
      const optionsRes = await fetch("/api/webauthn/register-options", {
        method: "POST",
        credentials: "include",
      });
      if (!optionsRes.ok) throw new Error("Failed to get registration options");
      const options = await optionsRes.json();

      const registration = await startRegistration({ optionsJSON: options });

      const verifyRes = await fetch("/api/webauthn/register-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(registration),
      });

      if (!verifyRes.ok) {
        const data = await verifyRes.json();
        throw new Error(data.message || "Verification failed");
      }

      toast({ title: "Biometric registered", description: "You can now use Face ID / Touch ID to sign in." });
      fetchCredentials();
    } catch (e: any) {
      if (e.name === "NotAllowedError") {
        toast({
          title: "Registration cancelled",
          description: "The biometric prompt was dismissed. If you're using an embedded preview, try opening the app in a full browser tab instead.",
          variant: "destructive",
        });
      } else if (e.name === "InvalidStateError") {
        toast({
          title: "Already registered",
          description: "This device already has a biometric credential registered.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Registration failed", description: e.message, variant: "destructive" });
      }
    } finally {
      setRegistering(false);
    }
  };

  const handleDelete = async (credId: number) => {
    setDeleting(credId);
    try {
      const res = await fetch(`/api/webauthn/credentials/${credId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to remove");
      setCredentials((prev) => prev.filter((c) => c.id !== credId));
      toast({ title: "Removed", description: "Biometric credential has been removed." });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your account and security preferences.</p>
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Biometric Authentication</CardTitle>
              <CardDescription>
                Use Face ID, Touch ID, or Windows Hello for faster and more secure sign-in.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!supported ? (
            <div className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-4" data-testid="text-biometric-unsupported">
              Biometric authentication is not supported on this device or browser.
              Try using Safari on iPhone/Mac, Chrome on Android, or Edge on Windows.
            </div>
          ) : (
            <>
              <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2" data-testid="text-biometric-tip">
                Tip: For best results, open the app in a full browser tab (not an embedded preview). Use Safari on iPhone/Mac, Chrome on Android, or Edge on Windows.
              </div>
              <Button
                onClick={handleRegister}
                disabled={registering}
                className="bg-primary text-primary-foreground"
                data-testid="button-register-biometric"
              >
                {registering ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Registering...</>
                ) : (
                  <><Fingerprint className="mr-2 h-4 w-4" /> Register Face ID / Biometric</>
                )}
              </Button>

              {loading ? (
                <div className="text-sm text-muted-foreground">Loading credentials...</div>
              ) : credentials.length === 0 ? (
                <div className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-4" data-testid="text-no-credentials">
                  No biometric credentials registered yet. Register one above to enable
                  passwordless sign-in on this device.
                </div>
              ) : (
                <div className="space-y-2" data-testid="list-credentials">
                  <p className="text-sm font-medium text-muted-foreground">Registered Devices</p>
                  {credentials.map((cred) => (
                    <div
                      key={cred.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-card"
                      data-testid={`credential-${cred.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <Smartphone className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{cred.deviceName || "Biometric Device"}</p>
                          <p className="text-xs text-muted-foreground">
                            Added {new Date(cred.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs text-green-400 border-green-500/30">Active</Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(cred.id)}
                          disabled={deleting === cred.id}
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-red-400"
                          data-testid={`button-delete-credential-${cred.id}`}
                        >
                          {deleting === cred.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
