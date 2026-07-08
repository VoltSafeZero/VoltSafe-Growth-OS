/**
 * Fixture seed/cleanup helper for tests/calendar-privacy.test.js.
 * Idempotent: creates (or resets) 3 users + a handful of calendar_connections
 * and calendar_events rows covering company_managed / private_personal /
 * external_calendar / team_shared visibility types, and their linked ids.
 *
 * Usage:
 *   npx tsx tests/helpers/calendar-privacy-seed.ts seed     — create/reset fixtures
 *   npx tsx tests/helpers/calendar-privacy-seed.ts ids      — print fixture ids as JSON
 *   npx tsx tests/helpers/calendar-privacy-seed.ts cleanup  — remove fixture rows
 */
import { db } from "../../server/db";
import { users, calendarConnections, calendarEvents } from "../../shared/schema";
import { eq, sql } from "drizzle-orm";
import { hashPassword } from "../../server/auth";

const PASSWORD = "testpass1234";

const OWNER_EMAIL = "cal-owner@voltsafe.com";
const ADMIN_EMAIL = "cal-admin@voltsafe.com";
const SALES_EMAIL = "cal-sales@voltsafe.com";

const MARKER = "VoltSafe Privacy Test";

async function upsertUser(email: string, name: string, globalRole: string, permissions: any) {
  const hash = await hashPassword(PASSWORD);
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    await db.update(users)
      .set({ globalRole: globalRole as any, permissions, password: hash, mustChangePassword: false })
      .where(eq(users.id, existing[0].id));
    return existing[0].id;
  }
  const [created] = await db.insert(users).values({
    email, password: hash, name, globalRole: globalRole as any, permissions, mustChangePassword: false,
  } as any).returning();
  return created.id;
}

async function seed() {
  const ownerUserId = await upsertUser(OWNER_EMAIL, "Cal Owner Test", "sales", {
    crm: "none", quoting: "none", support: "none", calendar: "none", projects: "none",
    knowledge: "none", communications: "none", team_workload: "none", partnerships: "none",
    mail_team: {}, calendar_team: [],
  });
  const adminUserId = await upsertUser(ADMIN_EMAIL, "Cal Admin Test", "admin", {
    crm: "edit", quoting: "edit", support: "edit", calendar: "edit", projects: "edit",
    knowledge: "edit", communications: "edit", team_workload: "edit", partnerships: "edit",
    mail_team: {}, calendar_team: [],
  });
  const salesUserId = await upsertUser(SALES_EMAIL, "Cal Sales Test", "sales", {
    crm: "none", quoting: "none", support: "none", calendar: "none", projects: "none",
    knowledge: "none", communications: "none", team_workload: "none", partnerships: "none",
    mail_team: {}, calendar_team: [], // no explicit grant to ownerUserId
  });

  // Clean up any pre-existing fixture rows for the owner before re-creating.
  await db.execute(sql`DELETE FROM calendar_events WHERE user_id = ${ownerUserId} AND title LIKE ${MARKER + "%"}`);
  await db.execute(sql`DELETE FROM calendar_connections WHERE user_id = ${ownerUserId} AND display_name LIKE ${MARKER + "%"}`);

  const [companyConn] = await db.insert(calendarConnections).values({
    userId: ownerUserId, provider: "google", accountEmail: "cal-owner@voltsafe.com",
    displayName: `${MARKER} Company Conn`, isActive: true,
  } as any).returning();
  await db.execute(sql`UPDATE calendar_connections SET visibility_type = 'company_managed' WHERE id = ${companyConn.id}`);

  const [privateConn] = await db.insert(calendarConnections).values({
    userId: ownerUserId, provider: "google", accountEmail: "cal-owner@gmail.com",
    displayName: `${MARKER} Private Conn`, isActive: true,
  } as any).returning();
  await db.execute(sql`UPDATE calendar_connections SET visibility_type = 'private_personal' WHERE id = ${privateConn.id}`);

  const [externalConn] = await db.insert(calendarConnections).values({
    userId: ownerUserId, provider: "caldav", accountEmail: "shared@partner-org.example",
    displayName: `${MARKER} External Conn`, isActive: true,
  } as any).returning();
  await db.execute(sql`UPDATE calendar_connections SET visibility_type = 'external_calendar' WHERE id = ${externalConn.id}`);

  const [teamSharedConn] = await db.insert(calendarConnections).values({
    userId: ownerUserId, provider: "google", accountEmail: "team-resource@voltsafe.com",
    displayName: `${MARKER} Team Shared Conn`, isActive: true,
  } as any).returning();
  await db.execute(sql`UPDATE calendar_connections SET visibility_type = 'team_shared' WHERE id = ${teamSharedConn.id}`);

  const now = new Date();
  const hourLater = new Date(now.getTime() + 60 * 60_000);

  const [companyEvent] = await db.insert(calendarEvents).values({
    userId: ownerUserId, title: `${MARKER} — Company Event`, description: "Confidential company details",
    eventType: "meeting", startTime: now, endTime: hourLater, location: "Boardroom",
  } as any).returning();
  await db.execute(sql`UPDATE calendar_events SET connection_id = ${companyConn.id} WHERE id = ${companyEvent.id}`);

  const [privateEvent] = await db.insert(calendarEvents).values({
    userId: ownerUserId, title: `${MARKER} — Private Event`, description: "Personal doctor appointment",
    eventType: "meeting", startTime: now, endTime: hourLater, location: "Clinic",
  } as any).returning();
  await db.execute(sql`UPDATE calendar_events SET connection_id = ${privateConn.id} WHERE id = ${privateEvent.id}`);

  const [externalEvent] = await db.insert(calendarEvents).values({
    userId: ownerUserId, title: `${MARKER} — External Event`, description: "External org details",
    eventType: "meeting", startTime: now, endTime: hourLater, meetingUrl: "https://partner.example/meet",
    attendeeDetails: [{ name: "Partner Contact", email: "partner@partner-org.example" }],
  } as any).returning();
  await db.execute(sql`UPDATE calendar_events SET connection_id = ${externalConn.id} WHERE id = ${externalEvent.id}`);

  const [teamSharedEvent] = await db.insert(calendarEvents).values({
    userId: ownerUserId, title: `${MARKER} — Team Shared Event`, description: "Company all-hands",
    eventType: "meeting", startTime: now, endTime: hourLater,
  } as any).returning();
  await db.execute(sql`UPDATE calendar_events SET connection_id = ${teamSharedConn.id} WHERE id = ${teamSharedEvent.id}`);

  const ids = {
    ownerUserId, adminUserId, salesUserId,
    companyEventId: companyEvent.id, privateEventId: privateEvent.id,
    externalEventId: externalEvent.id, teamSharedEventId: teamSharedEvent.id,
    companyConnectionId: companyConn.id, privateConnectionId: privateConn.id,
    externalConnectionId: externalConn.id, teamSharedConnectionId: teamSharedConn.id,
  };
  console.error("[calendar-privacy-seed] seeded:", JSON.stringify(ids));
  return ids;
}

async function printIds() {
  const [owner] = await db.select().from(users).where(eq(users.email, OWNER_EMAIL)).limit(1);
  const [admin] = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const [salesUser] = await db.select().from(users).where(eq(users.email, SALES_EMAIL)).limit(1);
  if (!owner || !admin || !salesUser) throw new Error("Fixtures not seeded — run `seed` first");

  const events = await db.select().from(calendarEvents)
    .where(sql`${calendarEvents.userId} = ${owner.id} AND ${calendarEvents.title} LIKE ${MARKER + "%"}`);
  const conns = await db.select().from(calendarConnections)
    .where(sql`${calendarConnections.userId} = ${owner.id} AND ${calendarConnections.displayName} LIKE ${MARKER + "%"}`);

  const findEvent = (suffix: string) => events.find((e: any) => e.title.endsWith(suffix))?.id;
  const findConn = (suffix: string) => conns.find((c: any) => (c.displayName || "").endsWith(suffix))?.id;

  const ids = {
    ownerUserId: owner.id, adminUserId: admin.id, salesUserId: salesUser.id,
    companyEventId: findEvent("Company Event"),
    privateEventId: findEvent("Private Event"),
    externalEventId: findEvent("External Event"),
    teamSharedEventId: findEvent("Team Shared Event"),
    companyConnectionId: findConn("Company Conn"),
    privateConnectionId: findConn("Private Conn"),
    externalConnectionId: findConn("External Conn"),
    teamSharedConnectionId: findConn("Team Shared Conn"),
  };
  process.stdout.write(JSON.stringify(ids));
}

async function cleanup() {
  const [owner] = await db.select().from(users).where(eq(users.email, OWNER_EMAIL)).limit(1);
  if (owner) {
    await db.execute(sql`DELETE FROM calendar_events WHERE user_id = ${owner.id} AND title LIKE ${MARKER + "%"}`);
    await db.execute(sql`DELETE FROM calendar_connections WHERE user_id = ${owner.id} AND display_name LIKE ${MARKER + "%"}`);
  }
  console.error("[calendar-privacy-seed] cleaned up event/connection fixtures (users kept for reuse).");
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === "seed") await seed();
  else if (cmd === "ids") await printIds();
  else if (cmd === "cleanup") await cleanup();
  else throw new Error("Usage: calendar-privacy-seed.ts <seed|ids|cleanup>");
  process.exit(0);
}

main().catch((e) => {
  console.error("[calendar-privacy-seed] FAILED:", e);
  process.exit(1);
});
