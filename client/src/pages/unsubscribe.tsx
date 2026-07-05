import { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { CheckCircle, XCircle, Mail, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

type PageState = "loading" | "confirm" | "success" | "already" | "invalid";

export default function UnsubscribePage() {
  const [, params] = useRoute("/unsubscribe/:token");
  const token = params?.token ?? "";

  const [state, setState] = useState<PageState>("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!token) { setState("invalid"); return; }
    fetch(`/api/marketing/unsubscribe/${encodeURIComponent(token)}`)
      .then((r) => {
        if (!r.ok) { setState("invalid"); return; }
        return r.json();
      })
      .then((data) => {
        if (!data) return;
        setEmail(data.email ?? null);
        if (data.already_unsubscribed) {
          setState("already");
        } else {
          setState("confirm");
        }
      })
      .catch(() => setState("invalid"));
  }, [token]);

  async function handleUnsubscribe() {
    if (!token) return;
    setPending(true);
    try {
      const res = await fetch(`/api/marketing/unsubscribe/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) { setState("invalid"); return; }
      const data = await res.json();
      setEmail(data.email ?? email);
      setState(data.already_unsubscribed ? "already" : "success");
    } catch {
      setState("invalid");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0f1a] flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo / branding */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
            <ShieldCheck className="w-4 h-4 text-cyan-400" />
          </div>
          <span className="text-lg font-semibold text-white tracking-tight">VoltSafe</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-8 text-center space-y-5">
          {state === "loading" && (
            <>
              <Loader2 className="w-10 h-10 text-cyan-400 mx-auto animate-spin" />
              <p className="text-sm text-white/60">Verifying your unsubscribe link…</p>
            </>
          )}

          {state === "confirm" && (
            <>
              <Mail className="w-10 h-10 text-cyan-400 mx-auto" />
              <h1 className="text-xl font-semibold text-white">Unsubscribe from VoltSafe Emails</h1>
              {email && (
                <p className="text-sm text-white/60">
                  This will remove <span className="text-white font-medium">{email}</span> from all VoltSafe marketing campaigns.
                </p>
              )}
              <p className="text-xs text-white/40">
                You will no longer receive outreach from our marina electrification programme.
              </p>
              <Button
                className="w-full bg-cyan-500 hover:bg-cyan-400 text-black font-semibold"
                onClick={handleUnsubscribe}
                disabled={pending}
                data-testid="btn-confirm-unsubscribe"
              >
                {pending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processing…</>
                ) : (
                  "Confirm Unsubscribe"
                )}
              </Button>
              <p className="text-xs text-white/30">
                This is a one-click unsubscribe — no login required.
              </p>
            </>
          )}

          {state === "success" && (
            <>
              <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto" />
              <h1 className="text-xl font-semibold text-white">You've been unsubscribed</h1>
              {email && (
                <p className="text-sm text-white/60">
                  <span className="text-white font-medium">{email}</span> has been removed from our mailing list.
                </p>
              )}
              <p className="text-xs text-white/40">
                You will no longer receive marketing emails from VoltSafe. This may take up to 24 hours to fully propagate.
              </p>
            </>
          )}

          {state === "already" && (
            <>
              <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto" />
              <h1 className="text-xl font-semibold text-white">Already unsubscribed</h1>
              {email && (
                <p className="text-sm text-white/60">
                  <span className="text-white font-medium">{email}</span> is already removed from our mailing list.
                </p>
              )}
              <p className="text-xs text-white/40">
                No further action needed. You will not receive marketing emails from VoltSafe.
              </p>
            </>
          )}

          {state === "invalid" && (
            <>
              <XCircle className="w-10 h-10 text-red-400 mx-auto" />
              <h1 className="text-xl font-semibold text-white">Link not found</h1>
              <p className="text-sm text-white/60">
                This unsubscribe link is invalid or has expired. If you continue to receive emails, please reply directly to any email with "unsubscribe" in the subject.
              </p>
            </>
          )}
        </div>

        <p className="text-center text-xs text-white/20 mt-6">
          VoltSafe Marine Technologies · Shore Power Electrification
        </p>
      </div>
    </div>
  );
}
