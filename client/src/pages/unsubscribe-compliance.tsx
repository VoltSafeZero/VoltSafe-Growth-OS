import { useState, useEffect } from "react";
import { CheckCircle, XCircle, Mail, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

type PageState = "loading" | "confirm" | "success" | "already" | "invalid";

export default function ComplianceUnsubscribePage() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") ?? "";

  const [state, setState] = useState<PageState>("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!token) { setState("invalid"); return; }
    fetch(`/api/compliance/unsubscribe?token=${encodeURIComponent(token)}`)
      .then((r) => {
        if (!r.ok) { setState("invalid"); return; }
        return r.json();
      })
      .then((data) => {
        if (!data) return;
        setEmail(data.email ?? null);
        setState(data.alreadyUnsubscribed ? "already" : "confirm");
      })
      .catch(() => setState("invalid"));
  }, [token]);

  async function handleUnsubscribe() {
    if (!token) return;
    setPending(true);
    try {
      const res = await fetch("/api/compliance/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) { setState("invalid"); return; }
      const data = await res.json();
      setEmail(data.email ?? email);
      setState(data.alreadyUnsubscribed ? "already" : "success");
    } catch {
      setState("invalid");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0f1a] flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
            <ShieldCheck className="w-4 h-4 text-cyan-400" />
          </div>
          <span className="text-white font-semibold text-lg">VoltSafe</span>
        </div>

        <div className="bg-[#111827] border border-white/10 rounded-2xl p-8 text-center space-y-6">
          {state === "loading" && (
            <>
              <Loader2 className="w-10 h-10 text-cyan-400 mx-auto animate-spin" />
              <p className="text-white/60">Verifying your request…</p>
            </>
          )}

          {state === "confirm" && (
            <>
              <div className="w-12 h-12 rounded-full bg-cyan-500/10 flex items-center justify-center mx-auto">
                <Mail className="w-6 h-6 text-cyan-400" />
              </div>
              <div>
                <h1 className="text-white text-xl font-semibold mb-2">Unsubscribe</h1>
                {email && (
                  <p className="text-white/50 text-sm">
                    Unsubscribing <span className="text-white/80 font-medium">{email}</span>
                  </p>
                )}
                <p className="text-white/50 text-sm mt-1">
                  You will no longer receive marketing emails from VoltSafe.
                </p>
              </div>
              <Button
                data-testid="button-confirm-unsubscribe"
                className="w-full bg-cyan-600 hover:bg-cyan-500 text-white"
                onClick={handleUnsubscribe}
                disabled={pending}
              >
                {pending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Confirm Unsubscribe
              </Button>
              <p className="text-white/30 text-xs">
                You can manage preferences at any time.{" "}
                <a
                  href={`/preferences?token=${encodeURIComponent(token)}`}
                  className="text-cyan-400 underline"
                >
                  Manage preferences
                </a>
              </p>
            </>
          )}

          {state === "success" && (
            <>
              <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
                <CheckCircle className="w-6 h-6 text-green-400" />
              </div>
              <div>
                <h1 className="text-white text-xl font-semibold mb-2">Unsubscribed</h1>
                {email && (
                  <p className="text-white/50 text-sm">
                    <span className="text-white/80 font-medium">{email}</span> has been removed.
                  </p>
                )}
                <p className="text-white/50 text-sm mt-1">
                  Your request has been processed. You will not receive further marketing emails from VoltSafe.
                </p>
              </div>
            </>
          )}

          {state === "already" && (
            <>
              <div className="w-12 h-12 rounded-full bg-cyan-500/10 flex items-center justify-center mx-auto">
                <CheckCircle className="w-6 h-6 text-cyan-400" />
              </div>
              <div>
                <h1 className="text-white text-xl font-semibold mb-2">Already Unsubscribed</h1>
                <p className="text-white/50 text-sm">This address is already opted out of marketing emails.</p>
              </div>
            </>
          )}

          {state === "invalid" && (
            <>
              <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
                <XCircle className="w-6 h-6 text-red-400" />
              </div>
              <div>
                <h1 className="text-white text-xl font-semibold mb-2">Invalid Link</h1>
                <p className="text-white/50 text-sm">
                  This unsubscribe link is invalid or has expired (links expire after 30 days).
                </p>
              </div>
            </>
          )}
        </div>

        <p className="text-white/20 text-xs text-center mt-6">
          © {new Date().getFullYear()} VoltSafe Marine Technologies. All rights reserved.
        </p>
      </div>
    </div>
  );
}
