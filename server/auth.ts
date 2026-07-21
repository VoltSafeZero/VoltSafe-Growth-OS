import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { isPrivilegedSalesRole } from "@shared/rbac";

// bcrypt cost factor — 12 strikes a reasonable balance between security and
// login latency on Replit's compute. Old hashes generated at cost=10 still
// verify correctly; this only affects newly generated hashes.
const BCRYPT_COST = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

/**
 * Centralized session user ID accessor.
 * All routes MUST use this instead of reading req.session.userId directly
 * to ensure a single, auditable source of truth for authenticated user identity.
 * requireAuth middleware guarantees this value is present before any handler runs.
 */
export function getSessionUserId(req: Request): number {
  return req.session.userId as number;
}

/**
 * Centralized name field validator.
 * Returns the trimmed string if valid, or null if blank/missing.
 * Use at the top of any POST/PUT handler that accepts a user-supplied name.
 */
export function requireName(value: unknown): string | null {
  if (!value || typeof value !== "string" || !value.trim()) return null;
  return value.trim();
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function seedUsers() {
  // Never seed known accounts with a shared default password in production.
  // An empty users table in production must be handled by an out-of-band
  // admin setup process, not by writing predictable credentials at startup.
  if (process.env.NODE_ENV === "production") {
    console.warn("[seed] seedUsers() skipped — production environment. Create accounts via the admin panel.");
    return;
  }

  const existingUsers = await db.select().from(users);
  if (existingUsers.length > 0) return;

  const defaultPassword = await hashPassword("alberni1444");

  const seedData = [
    { name: "Terri", email: "terri@voltsafe.com", role: "admin" },
    { name: "Scott", email: "scott@voltsafe.com", role: "sales" },
    { name: "Sanad", email: "sanad@voltsafe.com", role: "sales" },
    { name: "Trevor", email: "trevor@voltsafe.com", role: "sales" },
    { name: "Alex", email: "alex@voltsafe.com", role: "sales" },
  ];

  for (const user of seedData) {
    await db.insert(users).values({
      ...user,
      password: defaultPassword,
      mustChangePassword: true,
    });
  }

  console.log("Seeded 5 users with default password");
}

declare module "express-session" {
  interface SessionData {
    userId: number;
    email: string;
    role: string;
    name: string;
    mustChangePassword: boolean;
    webauthnRegChallenge: string;
    webauthnAuthChallenge: string;
    zoomOAuthState?: string;
    /** Per-session OAuth CSRF nonce. Set before redirect; consumed in callback. */
    oauthState?: { nonce: string; type: "personal" | "shared" | "calendar" };
    /** Current detected IANA timezone from the user's browser, refreshed every login/session start. */
    detectedTimezone?: string;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  if (req.session.mustChangePassword && req.path !== "/api/auth/change-password" && req.path !== "/api/auth/me" && req.path !== "/api/auth/logout") {
    return res.status(403).json({ message: "Password change required", mustChangePassword: true });
  }
  next();
}

/**
 * Canonical admin guard — checks globalRole stamped onto the session at login.
 * Use as: app.get("/api/admin/foo", requireAuth, requireAdmin, handler)
 * Routes already using locally-defined requireAdmin in routes.ts continue to work
 * (those use the same session.globalRole check); this export gives us a single source.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  const role = String((req.session as any).globalRole || "");
  if (role !== "master_admin" && role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

const PERMISSION_LEVELS: Record<string, number> = { none: 0, view: 1, edit: 2 };

// Sections that advisor role cannot access regardless of their permissions JSON.
const ADVISOR_BLOCKED_SECTIONS = new Set(["crm", "partnerships", "quoting"]);

export function requirePermission(section: string, minLevel: "view" | "edit") {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });

    try {
      const [user] = await db
        .select({ globalRole: users.globalRole, permissions: users.permissions })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) return res.status(401).json({ message: "User not found" });

      if (user.globalRole === "master_admin" || user.globalRole === "admin") {
        return next();
      }

      // Advisors cannot access sales/financial sections.
      if (user.globalRole === "advisor" && ADVISOR_BLOCKED_SECTIONS.has(section)) {
        return res.status(403).json({ message: "Advisors do not have access to this section" });
      }

      const perms = (user.permissions as Record<string, string>) || {};
      const userLevel = PERMISSION_LEVELS[perms[section] ?? "none"] ?? 0;
      const required = PERMISSION_LEVELS[minLevel] ?? 1;

      if (userLevel < required) {
        return res.status(403).json({ message: `Insufficient permissions: requires ${minLevel} access to ${section}` });
      }

      next();
    } catch (err) {
      console.error("[requirePermission] error:", err);
      res.status(500).json({ message: "Internal error checking permissions" });
    }
  };
}

// Blocks advisor role from accessing a route entirely.
export function requireNotAdvisor(req: Request, res: Response, next: NextFunction) {
  const role = String((req.session as any)?.globalRole || "");
  if (role === "advisor") {
    return res.status(403).json({ message: "Advisors do not have access to this resource" });
  }
  next();
}

/**
 * Sales/travel-intelligence gate — Revenue Simulator, Leads Nearby / My Travel
 * widgets, and single-day marina-visit route planning. Restricted to
 * master_admin / admin / manager / exec / sales (shared/rbac.ts is the single
 * source of truth for this allowlist so client hiding and server enforcement
 * never drift apart).
 */
export function requirePrivilegedSalesRole(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  const role = String((req.session as any).globalRole || "");
  if (!isPrivilegedSalesRole(role)) {
    return res.status(403).json({ message: "This feature is not available for your role" });
  }
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// Export / Download / Report authorization
// ─────────────────────────────────────────────────────────────────────────────

const EXPORT_PERMISSION_FLAG: Record<string, string> = {
  export:               "can_export",
  download_attachment:  "can_download_attachment",
  generate_report:      "can_generate_report",
};

/**
 * Central authorization helper for export, download, and report actions.
 *
 * Returns { ok: true } for master_admin and admin unconditionally.
 * For all other roles, checks users.permissions JSONB for the flag:
 *   action "export"              → can_export
 *   action "download_attachment" → can_download_attachment
 *   action "generate_report"     → can_generate_report
 *
 * When the flag is MISSING (legacy user, not yet backfilled), defaults to
 * ALLOW so that a migration race-condition does not silently break access.
 * Once the migration has run, missing flags will be absent only briefly.
 *
 * ADDITIVE: callers must still gate on requirePermission(section,"view")
 * before this to ensure section-level access is enforced separately.
 */
export async function authorizeResourceAction(params: {
  userId: number;
  action: "export" | "download_attachment" | "generate_report";
}): Promise<{ ok: boolean; reason?: string }> {
  try {
    const [user] = await db
      .select({ globalRole: users.globalRole, permissions: users.permissions })
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);

    if (!user) return { ok: false, reason: "User not found" };

    if (user.globalRole === "master_admin" || user.globalRole === "admin") {
      return { ok: true };
    }

    const perms = (user.permissions as Record<string, any>) || {};
    const flag = EXPORT_PERMISSION_FLAG[params.action];
    const flagValue = perms[flag];

    // Explicitly false → denied. Undefined/null → allow (legacy compat).
    if (flagValue === false) {
      return { ok: false, reason: `Permission '${params.action}' is not granted for this user` };
    }
    return { ok: true };
  } catch (err) {
    console.error("[authorizeResourceAction] error:", err);
    return { ok: false, reason: "Internal error checking permissions" };
  }
}

/**
 * Express middleware: blocks the request with HTTP 403 if the session user
 * lacks can_export permission. Always call AFTER requireAuth (and ideally
 * after requirePermission) so the user identity is already established.
 */
export function requireExportPermission(module?: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.session?.userId as number | undefined;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });
    const result = await authorizeResourceAction({ userId, action: "export" });
    if (!result.ok) {
      void logExportAudit(req, "export", module ?? "unknown", "denied", result.reason);
      return res.status(403).json({
        message: "You have view-only access and do not have permission to export or download this content.",
        code: "EXPORT_FORBIDDEN",
      });
    }
    void logExportAudit(req, "export", module ?? "unknown", "allowed");
    next();
  };
}

/**
 * Express middleware: blocks the request with HTTP 403 if the session user
 * lacks can_download_attachment permission.
 */
export function requireDownloadPermission(module?: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.session?.userId as number | undefined;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });
    const result = await authorizeResourceAction({ userId, action: "download_attachment" });
    if (!result.ok) {
      void logExportAudit(req, "download_attachment", module ?? "attachment", "denied", result.reason);
      return res.status(403).json({
        message: "You have view-only access and do not have permission to download attachments.",
        code: "DOWNLOAD_FORBIDDEN",
      });
    }
    void logExportAudit(req, "download_attachment", module ?? "attachment", "allowed");
    next();
  };
}

/**
 * Express middleware: blocks the request with HTTP 403 if the session user
 * lacks can_generate_report permission.
 */
export function requireGenerateReportPermission(module?: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.session?.userId as number | undefined;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });
    const result = await authorizeResourceAction({ userId, action: "generate_report" });
    if (!result.ok) {
      void logExportAudit(req, "generate_report", module ?? "unknown", "denied", result.reason);
      return res.status(403).json({
        message: "You do not have permission to generate downloadable reports.",
        code: "REPORT_FORBIDDEN",
      });
    }
    void logExportAudit(req, "generate_report", module ?? "unknown", "allowed");
    next();
  };
}

/**
 * Write a row to export_audit_log. Fire-and-forget — failures are logged to
 * console but never abort the calling request.
 *
 * Does NOT log file contents, tokens, signed URLs, or sensitive secrets.
 */
export async function logExportAudit(
  req: Request,
  action: string,
  module: string,
  outcome: "allowed" | "denied",
  reason?: string,
  resourceId?: string,
): Promise<void> {
  try {
    const userId  = req.session?.userId ?? null;
    const userName = (req.session as any)?.name ?? null;
    const forwarded = req.headers["x-forwarded-for"];
    const ip = (typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : null)
      ?? (req.socket as any)?.remoteAddress ?? null;
    const ua = req.headers["user-agent"] ?? null;
    await db.execute(sql`
      INSERT INTO export_audit_log
        (user_id, user_name, action, module, resource_id, endpoint, outcome, denial_reason, ip_address, user_agent)
      VALUES
        (${userId}, ${userName}, ${action}, ${module}, ${resourceId ?? null},
         ${req.path}, ${outcome}, ${reason ?? null}, ${ip}, ${ua})
    `);
  } catch (err) {
    console.error("[export-audit] write failed (non-fatal):", err);
  }
}
