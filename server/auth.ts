import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
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

const PERMISSION_LEVELS: Record<string, number> = { none: 0, view: 1, edit: 2 };

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
