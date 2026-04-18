import type { Request, Response, NextFunction } from "express";

/**
 * Origin/Referer host allowlist guard for state-changing requests.
 *
 * Threat model:
 *  - The session cookie is HttpOnly + SameSite=Lax. Modern browsers won't
 *    attach it to cross-site fetch/XHR or cross-site form POSTs, so the
 *    practical CSRF risk against those clients is already low.
 *  - However, defence in depth at the server is required because:
 *      (a) some HTTP clients (curl, native mobile, scripts) bypass browser
 *          SameSite enforcement entirely (proven exploitable in pen-test T10),
 *      (b) a future relaxation of cookie SameSite or addition of CORS would
 *          silently re-open the hole,
 *      (c) defence against same-site subdomain takeover requires server-side
 *          host pinning, not just SameSite.
 *
 * Behaviour (fail-closed):
 *  - Safe methods (GET/HEAD/OPTIONS) pass through unchanged.
 *  - Webhook routes under /api/webhooks/ pass through (authenticated by
 *    per-route signature/token, not cookies — see /api/webhooks/gmail token).
 *  - All other POST/PUT/PATCH/DELETE requests:
 *      1. Read Origin header, parse host. If valid and allow-listed → allow.
 *      2. Else read Referer header, parse host. If valid and allow-listed → allow.
 *      3. Else respond 403 with explanatory message.
 *  - Host comparison is *exact* string match against a Set built once at
 *    module load. No substring, no suffix wildcard, no regex.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Webhook prefixes that legitimately accept POSTs from external systems
// without an Origin header. Each such route MUST authenticate the caller
// via its own signature/token mechanism (e.g. the GMAIL_WEBHOOK_TOKEN query
// param checked inside the /api/webhooks/gmail handler).
const WEBHOOK_PREFIXES = ["/api/webhooks/"];

function buildAllowedHosts(): Set<string> {
  const hosts = new Set<string>();

  // Production canonical hostnames.
  hosts.add("voltsafe.app");
  hosts.add("www.voltsafe.app");

  // Replit injects REPLIT_DOMAINS as a comma-separated list of fully-qualified
  // hostnames the current Repl is reachable on (preview + custom domains).
  // Add each verbatim — exact match only.
  const replitDomains = (process.env.REPLIT_DOMAINS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  for (const h of replitDomains) hosts.add(h);

  // Operator-supplied additional hostnames (comma-separated). Use this for
  // staging/preview domains that aren't covered by REPLIT_DOMAINS.
  const extra = (process.env.CSRF_ALLOWED_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  for (const h of extra) hosts.add(h);

  // Local development hosts (only outside production).
  if (process.env.NODE_ENV !== "production") {
    hosts.add("localhost:5000");
    hosts.add("127.0.0.1:5000");
  }

  return hosts;
}

const ALLOWED_HOSTS = buildAllowedHosts();

function hostFromHeader(value: string | undefined | null): string | null {
  if (!value) return null;
  // The browser may send Origin as the literal string "null" (sandboxed
  // iframe, file://). Treat as missing.
  if (value === "null") return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.host.toLowerCase();
  } catch {
    return null;
  }
}

function isWebhookExempt(pathname: string): boolean {
  return WEBHOOK_PREFIXES.some((p) => pathname.startsWith(p));
}

export function csrfOriginGuard(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (isWebhookExempt(req.path)) return next();

  // Origin first.
  const originHost = hostFromHeader(req.get("origin"));
  if (originHost) {
    if (ALLOWED_HOSTS.has(originHost)) return next();
    return res.status(403).json({
      message: "Cross-site request blocked: untrusted Origin",
    });
  }

  // Referer fallback.
  const refererHost = hostFromHeader(req.get("referer"));
  if (refererHost) {
    if (ALLOWED_HOSTS.has(refererHost)) return next();
    return res.status(403).json({
      message: "Cross-site request blocked: untrusted Referer",
    });
  }

  // Fail closed: a state-changing request without any usable provenance
  // header is treated as suspicious.
  return res.status(403).json({
    message: "Cross-site request blocked: missing Origin/Referer",
  });
}

// Exposed for unit-style verification (e.g. ad-hoc inspection in tests).
export const __csrfInternals = {
  ALLOWED_HOSTS,
  hostFromHeader,
  isWebhookExempt,
};
