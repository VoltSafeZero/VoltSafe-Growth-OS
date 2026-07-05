import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { CheckCircle, XCircle, Settings2, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

type PageState = "loading" | "ready" | "success" | "invalid";

const TOPIC_LABELS: Record<string, string> = {
  product_updates: "Product Updates",
  case_studies: "Case Studies & Success Stories",
  industry_news: "Marina Industry News",
  event_invitations: "Webinars & Events",
  promotions: "Special Offers & Promotions",
  technical_resources: "Technical Resources",
  company_news: "Company News",
};

const DEFAULT_TOPICS = Object.keys(TOPIC_LABELS).reduce(
  (acc, k) => ({ ...acc, [k]: true }),
  {} as Record<string, boolean>
);

export default function PreferencesPage() {
  const [location] = useLocation();
  const token = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : ""
  ).get("token") ?? "";

  const [state, setState] = useState<PageState>("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [topics, setTopics] = useState<Record<string, boolean>>(DEFAULT_TOPICS);
  const [globalUnsub, setGlobalUnsub] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!token) { setState("invalid"); return; }
    fetch(`/api/compliance/preferences?token=${encodeURIComponent(token)}`)
      .then((r) => {
        if (!r.ok) { setState("invalid"); return null; }
        return r.json();
      })
      .then((data) => {
        if (!data) return;
        setEmail(data.email ?? null);
        setTopics({ ...DEFAULT_TOPICS, ...(data.topics ?? {}) });
        setGlobalUnsub(data.globalUnsubscribed ?? false);
        setState("ready");
      })
      .catch(() => setState("invalid"));
  }, [token]);

  async function handleSave() {
    if (!token) return;
    setPending(true);
    try {
      const res = await fetch("/api/compliance/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, topics, globalUnsubscribe: globalUnsub }),
      });
      if (!res.ok) { setState("invalid"); return; }
      setState("success");
    } catch {
      setState("invalid");
    } finally {
      setPending(false);
    }
  }

  function toggleTopic(key: string) {
    setTopics((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div className="min-h-screen bg-[#0a0f1a] flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-lg">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
            <ShieldCheck className="w-4 h-4 text-cyan-400" />
          </div>
          <span className="text-lg font-semibold text-white tracking-tight">VoltSafe</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-8 space-y-6">
          {state === "loading" && (
            <div className="text-center space-y-3">
              <Loader2 className="w-10 h-10 text-cyan-400 mx-auto animate-spin" />
              <p className="text-sm text-white/60">Loading your preferences…</p>
            </div>
          )}

          {state === "invalid" && (
            <div className="text-center space-y-4">
              <XCircle className="w-10 h-10 text-red-400 mx-auto" />
              <h1 className="text-xl font-semibold text-white">Link Not Found</h1>
              <p className="text-sm text-white/60">
                This preferences link is invalid or has expired. If you need help, reply to any VoltSafe email.
              </p>
            </div>
          )}

          {state === "success" && (
            <div className="text-center space-y-4">
              <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto" />
              <h1 className="text-xl font-semibold text-white">Preferences Saved</h1>
              {email && (
                <p className="text-sm text-white/60">
                  Your email preferences for <span className="text-white font-medium">{email}</span> have been updated.
                </p>
              )}
              {globalUnsub && (
                <p className="text-sm text-amber-300/80">
                  You have been unsubscribed from all VoltSafe marketing emails.
                </p>
              )}
            </div>
          )}

          {state === "ready" && (
            <>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Settings2 className="w-5 h-5 text-cyan-400" />
                  <h1 className="text-xl font-semibold text-white">Email Preferences</h1>
                </div>
                {email && (
                  <p className="text-sm text-white/50 pl-7">Managing preferences for <span className="text-white/80">{email}</span></p>
                )}
              </div>

              <div className="space-y-3">
                <p className="text-xs font-medium text-white/50 uppercase tracking-wide">Topics</p>
                {Object.entries(TOPIC_LABELS).map(([key, label]) => (
                  <label
                    key={key}
                    className={`flex items-center justify-between rounded-lg border px-4 py-3 cursor-pointer transition-colors ${
                      globalUnsub
                        ? "border-white/5 opacity-40 pointer-events-none"
                        : topics[key]
                        ? "border-cyan-500/40 bg-cyan-500/10"
                        : "border-white/10 bg-white/5 hover:bg-white/10"
                    }`}
                    data-testid={`topic-toggle-${key}`}
                  >
                    <span className="text-sm text-white/80">{label}</span>
                    <div
                      className={`w-9 h-5 rounded-full transition-colors relative ${
                        topics[key] ? "bg-cyan-500" : "bg-white/20"
                      }`}
                      onClick={() => !globalUnsub && toggleTopic(key)}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                          topics[key] ? "translate-x-4" : ""
                        }`}
                      />
                    </div>
                  </label>
                ))}
              </div>

              <div className="pt-2 border-t border-white/10">
                <label
                  className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 cursor-pointer hover:bg-red-500/20 transition-colors"
                  data-testid="global-unsubscribe-toggle"
                >
                  <div>
                    <p className="text-sm font-medium text-red-300">Unsubscribe from all</p>
                    <p className="text-xs text-white/40 mt-0.5">Remove me from all VoltSafe marketing emails</p>
                  </div>
                  <div
                    className={`w-9 h-5 rounded-full transition-colors relative ${
                      globalUnsub ? "bg-red-500" : "bg-white/20"
                    }`}
                    onClick={() => setGlobalUnsub((v) => !v)}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                        globalUnsub ? "translate-x-4" : ""
                      }`}
                    />
                  </div>
                </label>
                {globalUnsub && (
                  <p className="text-xs text-amber-300/80 mt-2 px-1">
                    Global unsubscribe overrides all topic preferences above.
                  </p>
                )}
              </div>

              <Button
                className="w-full bg-cyan-500 hover:bg-cyan-400 text-black font-semibold"
                onClick={handleSave}
                disabled={pending}
                data-testid="btn-save-preferences"
              >
                {pending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</>
                ) : (
                  "Save Preferences"
                )}
              </Button>
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
