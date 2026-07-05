import { useState, useEffect } from "react";
import { CheckCircle, XCircle, Loader2, ShieldCheck } from "lucide-react";

type PageState = "loading" | "success" | "already" | "invalid";

export default function ComplianceUnsubscribePage() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") ?? "";

  const [state, setState] = useState<PageState>("loading");
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setState("invalid"); return; }
    // One-click unsubscribe: process immediately on page load (idempotent).
    fetch("/api/compliance/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => {
        if (!r.ok) { setState("invalid"); return; }
        return r.json();
      })
      .then((data) => {
        if (!data) return;
        setEmail(data.email ?? null);
        setState(data.alreadyUnsubscribed ? "already" : "success");
      })
      .catch(() => setState("invalid"));
  }, [token]);

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
