/**
 * Idempotent seed for a low-permission integration-test user.
 * INSERT-only into the existing `users` table — NO schema changes.
 *
 *   email:    lowperm@voltsafe.com
 *   password: lowperm1444
 *   role:     sales (non-admin)
 *   perms:    everything = "none" (so create_lead / add_note / etc. should be denied)
 */
import { db } from "../server/db";
import { users } from "../shared/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "../server/auth";

const EMAIL = "lowperm@voltsafe.com";
const PASSWORD = "lowperm1444";

async function main() {
  const existing = await db.select().from(users).where(eq(users.email, EMAIL)).limit(1);
  if (existing.length > 0) {
    const u = existing[0];
    // Make sure the perms are still locked down even if someone fiddled
    await db
      .update(users)
      .set({
        globalRole: "sales",
        permissions: { crm: "none", support: "none", quoting: "none", calendar: "none", projects: "none", communications: "none", team_workload: "none", knowledge: "none", partnerships: "none" } as any,
      })
      .where(eq(users.id, u.id));
    console.log(`[seed-low-perm] reset existing user #${u.id} ${EMAIL} to no-permission sales role`);
    process.exit(0);
  }
  const hash = await hashPassword(PASSWORD);
  const [created] = await db
    .insert(users)
    .values({
      email: EMAIL,
      password: hash,
      name: "Low Perm Test",
      globalRole: "sales",
      permissions: { crm: "none", support: "none", quoting: "none", calendar: "none", projects: "none", communications: "none", team_workload: "none", knowledge: "none", partnerships: "none" } as any,
    } as any)
    .returning();
  console.log(`[seed-low-perm] created user #${created.id} ${EMAIL} (sales, perms=none)`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[seed-low-perm] FAILED:", e);
  process.exit(1);
});
