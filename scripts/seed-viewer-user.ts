/**
 * Idempotent seed for the viewer integration-test user used by tests/permissions.test.js.
 *
 *   email:    viewer@voltsafe.com
 *   password: testpass1234
 *   role:     sales (non-admin)
 *   perms:    crm=view, all others=none
 */
import { db } from "../server/db";
import { users } from "../shared/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "../server/auth";

const EMAIL = "viewer@voltsafe.com";
const PASSWORD = "testpass1234";
const PERMS = {
  crm: "view", support: "none", quoting: "none", calendar: "none",
  projects: "none", communications: "none", team_workload: "none",
  knowledge: "none", partnerships: "none",
};

async function main() {
  const existing = await db.select().from(users).where(eq(users.email, EMAIL)).limit(1);
  const hash = await hashPassword(PASSWORD);
  if (existing.length > 0) {
    await db.update(users).set({
      password: hash,
      globalRole: "sales",
      permissions: PERMS as any,
    }).where(eq(users.id, existing[0].id));
    console.log(`[seed-viewer] reset existing user #${existing[0].id} ${EMAIL}`);
  } else {
    const [created] = await db.insert(users).values({
      email: EMAIL,
      password: hash,
      name: "Viewer Test",
      globalRole: "sales",
      permissions: PERMS as any,
    } as any).returning();
    console.log(`[seed-viewer] created user #${created.id} ${EMAIL}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("[seed-viewer] FAILED:", e);
  process.exit(1);
});
