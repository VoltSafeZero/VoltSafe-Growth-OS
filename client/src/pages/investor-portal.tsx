import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { FileText, Download, ExternalLink, Lock, Eye, Clock, ChevronRight, Shield, AlertCircle } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

type PortalMaterial = {
  id: number;
  title: string;
  description: string | null;
  material_type: string;
  material_type_label: string;
  version_label: string | null;
  external_url: string | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  permission: "view" | "download";
  requires_nda: boolean;
};

type PortalData = {
  access_label: string;
  investor_name: string;
  round_name: string | null;
  expires_at: string | null;
  materials: PortalMaterial[];
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtBytes(n: number | null): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function fmtExpiry(s: string): string {
  const d = new Date(s);
  const daysLeft = Math.ceil((d.getTime() - Date.now()) / 86400000);
  if (daysLeft <= 0) return "Expired";
  if (daysLeft === 1) return "Expires tomorrow";
  if (daysLeft <= 7) return `Expires in ${daysLeft} days`;
  return `Expires ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function InvestorPortalPage() {
  const [location] = useLocation();
  // Extract token from the URL path: /investor-portal/:token
  const token = typeof window !== "undefined"
    ? window.location.pathname.split("/investor-portal/")[1]?.split("?")[0]?.trim()
    : "";

  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewedMaterials, setViewedMaterials] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!token) { setError("Invalid portal link."); setLoading(false); return; }
    fetch(`/api/investor-portal/${token}`)
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.message || "This link is invalid or has expired.");
        }
        return r.json();
      })
      .then(d => {
        setData(d);
        setLoading(false);
        // Log portal_opened once per session load
        fetch(`/api/investor-portal/${token}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event_type: "portal_opened" }),
        }).catch(() => { /* non-fatal */ });
      })
      .catch(e => {
        const msg = e.message || "Failed to load portal.";
        // Surface revoked state clearly
        const isRevoked = msg.toLowerCase().includes("revoked");
        setError(isRevoked ? "This portal link has been revoked. Please contact your VoltSafe representative." : msg);
        setLoading(false);
      });
  }, [token]);

  const logEvent = useCallback((eventType: string, materialId?: number) => {
    if (!token) return;
    fetch(`/api/investor-portal/${token}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: eventType, material_id: materialId }),
    }).catch(() => { /* non-fatal */ });
  }, [token]);

  const handleViewMaterial = (mat: PortalMaterial) => {
    if (!mat.external_url) return;
    if (!viewedMaterials.has(mat.id)) {
      logEvent("material_viewed", mat.id);
      setViewedMaterials(prev => new Set([...prev, mat.id]));
    }
    window.open(mat.external_url, "_blank", "noopener,noreferrer");
  };

  const handleDownloadMaterial = (mat: PortalMaterial) => {
    if (!mat.external_url) return;
    logEvent("material_downloaded", mat.id);
    const a = document.createElement("a");
    a.href = mat.external_url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
  };

  // ── Render states ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a1628] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
          <p className="text-slate-400 text-sm">Loading secure portal…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0a1628] flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="w-14 h-14 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-7 h-7 text-red-400" />
          </div>
          <h1 className="text-xl font-semibold text-white mb-2">Link Unavailable</h1>
          <p className="text-slate-400 text-sm">{error}</p>
          <p className="text-slate-500 text-xs mt-4">
            If you believe this is an error, please contact your VoltSafe representative.
          </p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const expiryWarning = data.expires_at
    ? Math.ceil((new Date(data.expires_at).getTime() - Date.now()) / 86400000)
    : null;

  return (
    <div className="min-h-screen bg-[#0a1628]" data-testid="investor-portal-page">
      {/* Header */}
      <header className="border-b border-slate-800 bg-[#0c1d36]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center shrink-0">
              <Shield className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <p className="text-white font-semibold text-sm leading-tight">VoltSafe</p>
              <p className="text-slate-400 text-xs">Investor Data Room</p>
            </div>
          </div>
          {data.expires_at && expiryWarning !== null && expiryWarning <= 7 && expiryWarning > 0 && (
            <div className="flex items-center gap-1.5 text-amber-400 text-xs bg-amber-400/10 border border-amber-400/20 rounded-full px-3 py-1">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              {fmtExpiry(data.expires_at)}
            </div>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8" data-testid="portal-main-content">
        {/* Hero */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1" data-testid="portal-access-label">
            {data.access_label || "Investor Portal"}
          </h1>
          <div className="flex items-center gap-2 text-sm text-slate-400 flex-wrap">
            {data.investor_name && (
              <span data-testid="portal-investor-name">{data.investor_name}</span>
            )}
            {data.investor_name && data.round_name && (
              <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
            )}
            {data.round_name && (
              <span data-testid="portal-round-name">{data.round_name}</span>
            )}
          </div>
        </div>

        {/* Materials */}
        {data.materials.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-12 h-12 rounded-full bg-slate-700/50 flex items-center justify-center mx-auto mb-3">
              <FileText className="w-5 h-5 text-slate-500" />
            </div>
            <p className="text-slate-400 text-sm">No documents have been shared in this portal yet.</p>
            <p className="text-slate-500 text-xs mt-1">Check back soon or contact your VoltSafe representative.</p>
          </div>
        ) : (
          <div className="space-y-3" data-testid="portal-materials-list">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">
              {data.materials.length} document{data.materials.length === 1 ? "" : "s"} shared with you
            </p>
            {data.materials.map(mat => (
              <div
                key={mat.id}
                className="group bg-[#0f2240] border border-slate-700/60 rounded-xl p-4 hover:border-cyan-500/30 transition-colors"
                data-testid={`portal-material-${mat.id}`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-slate-700/60 flex items-center justify-center shrink-0 mt-0.5">
                    <FileText className="w-4.5 h-4.5 text-slate-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-white font-medium text-sm leading-snug" data-testid={`portal-material-title-${mat.id}`}>
                          {mat.title}
                        </h3>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-xs text-slate-500">{mat.material_type_label}</span>
                          {mat.version_label && (
                            <>
                              <span className="text-slate-700">·</span>
                              <span className="text-xs text-slate-500">{mat.version_label}</span>
                            </>
                          )}
                          {mat.file_size_bytes && (
                            <>
                              <span className="text-slate-700">·</span>
                              <span className="text-xs text-slate-500">{fmtBytes(mat.file_size_bytes)}</span>
                            </>
                          )}
                        </div>
                        {mat.requires_nda && (
                          <div className="flex items-center gap-1 mt-1.5 text-amber-400 text-[10px]" data-testid={`portal-nda-badge-${mat.id}`}>
                            <Lock className="w-2.5 h-2.5 shrink-0" /> NDA required
                          </div>
                        )}
                        {mat.description && (
                          <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                            {mat.description}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {mat.permission === "download" && mat.external_url ? (
                          <button
                            onClick={() => handleDownloadMaterial(mat)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 text-xs font-medium hover:bg-cyan-500/25 transition-colors"
                            data-testid={`btn-download-material-${mat.id}`}
                          >
                            <Download className="w-3.5 h-3.5" /> Download
                          </button>
                        ) : mat.external_url ? (
                          <button
                            onClick={() => handleViewMaterial(mat)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700/60 border border-slate-600/60 text-slate-300 text-xs font-medium hover:bg-slate-700 transition-colors"
                            data-testid={`btn-view-material-${mat.id}`}
                          >
                            <ExternalLink className="w-3.5 h-3.5" /> View
                          </button>
                        ) : (
                          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/40 text-slate-500 text-xs">
                            <Lock className="w-3 h-3" /> Not Available
                          </div>
                        )}
                      </div>
                    </div>
                    {viewedMaterials.has(mat.id) && (
                      <div className="flex items-center gap-1 mt-2 text-xs text-emerald-400/70">
                        <Eye className="w-3 h-3" /> Viewed
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="mt-10 pt-6 border-t border-slate-800 text-center">
          <p className="text-xs text-slate-600">
            This is a confidential investor data room provided by VoltSafe.
            All access is logged. Do not share this link.
          </p>
          {data.expires_at && (
            <p className="text-xs text-slate-600 mt-1">{fmtExpiry(data.expires_at)}</p>
          )}
        </div>
      </main>
    </div>
  );
}
