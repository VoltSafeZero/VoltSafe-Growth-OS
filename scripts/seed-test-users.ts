/**
 * Idempotent seed for permission-test fixture users.
 * Creates (or resets) two accounts used by tests/permissions.test.js,
 * tests/hardening.test.js, and tests/conversion.test.js.
 *
 *   viewer@voltsafe.com  — crm=view, everything else=none
 *   mixed@voltsafe.com   — crm=edit, quoting=view, support=edit, knowledge=view, rest=none
 *
 * Both use password: testpass1234
 * Neither is an admin (globalRole = "sales").
 *
 * Run with: npx tsx scripts/seed-test-users.ts
 */
import { db } from "../server/db";
import { users } from "../shared/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "../server/auth";

const PASSWORD = "testpass1234";

const FIXTURES = [
  {
    email: "viewer@voltsafe.com",
    name: "Viewer Test",
    globalRole: "sales",
    permissions: {
      crm: "view",
      quoting: "none",
      support: "none",
      calendar: "none",
      projects: "none",
      knowledge: "none",
      communications: "none",
      team_workload: "none",
      partnerships: "none",
      mail_team: {},
      calendar_team: [],
    },
  },
  {
    email: "mixed@voltsafe.com",
    name: "Mixed Test",
    globalRole: "sales",
    permissions: {
      crm: "edit",
      quoting: "view",
      support: "edit",
      calendar: "none",
      projects: "none",
      knowledge: "view",
      communications: "none",
      team_workload: "none",
      partnerships: "none",
      mail_team: {},
      calendar_team: [],
    },
  },
] as const;

async function main() {
  const hash = await hashPassword(PASSWORD);
  for (const fixture of FIXTURES) {
    const existing = await db.select().from(users).where(eq(users.email, fixture.email)).limit(1);
    if (existing.length > 0) {
      await db.update(users)
        .set({ globalRole: fixture.globalRole as any, permissions: fixture.permissions as any, password: hash })
        .where(eq(users.id, existing[0].id));
      console.log(`[seed-test-users] reset ${fixture.email} (id=${existing[0].id})`);
    } else {
      const [created] = await db.insert(users).values({
        email: fixture.email,
        password: hash,
        name: fixture.name,
        globalRole: fixture.globalRole as any,
        permissions: fixture.permissions as any,
      } as any).returning();
      console.log(`[seed-test-users] created ${fixture.email} (id=${created.id})`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("[seed-test-users] FAILED:", e);
  process.exit(1);
});
