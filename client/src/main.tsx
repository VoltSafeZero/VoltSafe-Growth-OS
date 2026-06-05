import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// ── Cookie diagnostics & cleanup ─────────────────────────────────────────────
// Runs at startup and also available interactively as window.__debugCookies().
// Never logs cookie VALUES — only names and lengths.

function auditCookies(verbose = false): { total: number; names: string[]; details: { name: string; bytes: number }[] } {
  const raw = document.cookie;
  if (!raw.trim()) return { total: 0, names: [], details: [] };
  const pairs = raw.split(";").map(c => c.trim());
  const details = pairs.map(p => {
    const eq = p.indexOf("=");
    const name  = eq >= 0 ? p.slice(0, eq).trim() : p.trim();
    return { name, bytes: p.length };
  }).sort((a, b) => b.bytes - a.bytes);
  const total = raw.length;
  const names = details.map(d => d.name);
  if (verbose) {
    console.group(`%c[__debugCookies] total Cookie header: ${total} bytes (${pairs.length} cookies)`, "color:#14b8a6;font-weight:bold");
    for (const d of details) console.log(`  ${d.name.padEnd(40)} ${d.bytes} bytes`);
    if (total > 4096) console.warn(`  ⚠️  Cookie header exceeds 4 KB — may cause HTTP 431 on Replit proxy`);
    if (total > 7168) console.error(`  ❌ Cookie header exceeds 7 KB — WILL cause HTTP 431`);
    console.groupEnd();
  }
  return { total, names, details };
}

// Expire any cookie that looks like it might contain large structured data
// (compose payloads, signature HTML, draft bodies, base64 blobs, etc.).
// Only names are checked — values are never read.
const UNSAFE_COOKIE_PATTERNS = [
  /compose/i, /draft/i, /signature/i, /payload/i, /thread/i,
  /mailbox/i, /session-data/i, /crm/i, /auth-state/i, /oauth/i,
];
function cleanupOversizedCookies() {
  const { details, total } = auditCookies(false);
  if (total <= 4096) return;  // Nothing to clean
  for (const { name, bytes } of details) {
    const isSuspect = UNSAFE_COOKIE_PATTERNS.some(p => p.test(name));
    const isLarge   = bytes > 512;
    if (isSuspect || isLarge) {
      // Expire the cookie on all likely path/domain combinations.
      const expiry = "Max-Age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      document.cookie = `${name}=; path=/; ${expiry}`;
      document.cookie = `${name}=; path=/api; ${expiry}`;
      console.warn(`[cookie-cleanup] Expired oversized/suspect cookie: "${name}" (${bytes} bytes)`);
    }
  }
}

// Expose debug helper globally for DevTools console use.
(window as any).__debugCookies = () => auditCookies(true);

// Run silent audit at startup; only log if cookies are over the warning threshold.
const _startup = auditCookies(false);
if (_startup.total > 4096) {
  console.warn(
    `[cookie-startup] Cookie header is ${_startup.total} bytes — approaching HTTP 431 limit. ` +
    `Run window.__debugCookies() for details.`,
    { names: _startup.names },
  );
  cleanupOversizedCookies();
  // Re-check after cleanup
  const _after = auditCookies(false);
  if (_after.total > 4096) {
    console.error(
      `[cookie-startup] Still ${_after.total} bytes after cleanup. ` +
      `Use DevTools → Application → Cookies → Clear all site data, then reload.`,
    );
  }
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: "100vh", background: "#0a0a0a", color: "#e5e5e5",
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: "2rem", fontFamily: "monospace",
        }}>
          <div style={{ maxWidth: 600, width: "100%" }}>
            <h1 style={{ color: "#f87171", fontSize: "1.25rem", marginBottom: "1rem" }}>
              Something went wrong
            </h1>
            <pre style={{
              background: "#1a1a1a", border: "1px solid #333", borderRadius: 8,
              padding: "1rem", fontSize: "0.75rem", overflowX: "auto",
              whiteSpace: "pre-wrap", wordBreak: "break-word", color: "#fca5a5",
            }}>
              {this.state.error.toString()}
              {"\n\n"}
              {this.state.error.stack}
            </pre>
            <button
              onClick={() => window.location.reload()}
              style={{
                marginTop: "1rem", padding: "0.5rem 1.5rem", background: "#14b8a6",
                color: "#0a0a0a", border: "none", borderRadius: 6, cursor: "pointer",
                fontWeight: 600, fontSize: "0.875rem",
              }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
