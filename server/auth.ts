import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
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
