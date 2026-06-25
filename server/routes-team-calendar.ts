import type { Express } from "express";
import { db } from "./db";
import { eq, and, gte, lte, inArray, desc } from "drizzle-orm";
import { teamWorkScheduleEntries, teamWorkScheduleDefaults, teamWorkScheduleAuditLog, users } from "@shared/schema";
import { sql } from "drizzle-orm";

function requireAdmin(req: any, res: any, next: any) {
  if (!req.session?.userId) return res.status(401).json({ message: "Not authenticated" });
  const role = req.session?.globalRole;
  if (role !== "admin" && role !== "master_admin") return res.status(403).json({ message: "Admin required" });
  next();
}

async function writeAudit(entryId: number | null, changedBy: number, changeType: string, oldValue: any, newValue: any) {
  try {
    await db.insert(teamWorkScheduleAuditLog).values({ entryId, changedBy, changeType, oldValue, newValue });
  } catch { /* non-blocking */ }
}

// Returns YYYY-MM-DD for a date offset from today
function isoDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// Map dayOfWeek JS (0=Sun) to Mon-based index (0=Mon)
function dowMonBased(date: Date): number {
  return (date.getDay() + 6) % 7;
}

// Build augmented team schedule for a date range, merging defaults where no explicit entry
async function buildTeamSchedule(startDate: string, endDate: string) {
  // All active internal users
  const allUsers = await db
    .select({ id: users.id, name: users.name, email: users.email, department: users.department, jobTitle: users.jobTitle, avatarUrl: users.avatarUrl, globalRole: users.globalRole })
    .from(users)
    .where(and(eq(users.status, "active"), eq(users.userType, "internal")));

  // All explicit entries for the date range
  const entries = await db
    .select()
    .from(teamWorkScheduleEntries)
    .where(and(gte(teamWorkScheduleEntries.date, startDate), lte(teamWorkScheduleEntries.date, endDate)));

  // All recurring defaults
  const defaults = await db.select().from(teamWorkScheduleDefaults);

  // Build a map: userId → dayOfWeek → default
  const defaultMap = new Map<string, typeof defaults[0]>();
  for (const d of defaults) defaultMap.set(`${d.userId}:${d.dayOfWeek}`, d);

  // Build a map: userId → date → entries[]
  const entryMap = new Map<string, typeof entries>();
  for (const e of entries) {
    const k = `${e.userId}:${e.date}`;
    if (!entryMap.has(k)) entryMap.set(k, []);
    entryMap.get(k)!.push(e);
  }

  // Generate all dates between startDate and endDate (inclusive)
  const dates: string[] = [];
  const cur = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }

  // For each user × date, produce the resolved schedule
  const result: Record<string, { user: typeof allUsers[0]; date: string; entries: any[]; source: "entry" | "default" | "none" }[]> = {};

  for (const u of allUsers) {
    result[u.id] = [];
    for (const date of dates) {
      const k = `${u.id}:${date}`;
      const dayEntries = entryMap.get(k);
      if (dayEntries && dayEntries.length > 0) {
        result[u.id].push({ user: u, date, entries: dayEntries, source: "entry" });
      } else {
        const dow = dowMonBased(new Date(date + "T00:00:00Z"));
        const def = defaultMap.get(`${u.id}:${dow}`);
        if (def) {
          result[u.id].push({
            user: u, date, source: "default",
            entries: [{
              id: null, userId: u.id, date,
              startTime: def.defaultStartTime, endTime: def.defaultEndTime,
              status: def.defaultStatus, locationType: def.defaultLocationType,
              locationName: def.defaultLocationName, availability: def.defaultAvailability,
              workFocus: null, notes: null, visibility: "team", isRecurringOverride: false,
              isDefault: true,
            }],
          });
        } else {
          result[u.id].push({ user: u, date, entries: [], source: "none" });
        }
      }
    }
  }

  return { users: allUsers, dates, schedule: result };
}

export function registerTeamCalendarRoutes(app: Express, requireAuth: any) {

  // ── GET /api/team-calendar/today ─────────────────────────────────────────
  app.get("/api/team-calendar/today", requireAuth, async (req, res) => {
    try {
      const today = isoDate();
      const { users: allUsers, schedule } = await buildTeamSchedule(today, today);

      const rows = allUsers.map(u => {
        const dayData = schedule[u.id]?.[0];
        return { user: u, date: today, entries: dayData?.entries ?? [], source: dayData?.source ?? "none" };
      });

      // Summary counts
      const counts: Record<string, number> = {
        in_office: 0, remote: 0, work_travel: 0, day_off: 0, sick: 0, hybrid: 0, flexible: 0, not_updated: 0,
      };
      for (const row of rows) {
        if (row.entries.length === 0) { counts.not_updated++; continue; }
        const primaryStatus = row.entries[0].status ?? "not_updated";
        const key = primaryStatus in counts ? primaryStatus : "not_updated";
        counts[key]++;
      }

      res.json({ date: today, rows, summary: counts });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── GET /api/team-calendar/week?startDate=YYYY-MM-DD ─────────────────────
  app.get("/api/team-calendar/week", requireAuth, async (req, res) => {
    try {
      const startDate = (req.query.startDate as string) || (() => {
        const d = new Date();
        const dow = d.getDay();
        const diff = dow === 0 ? -6 : 1 - dow; // Monday
        d.setDate(d.getDate() + diff);
        return d.toISOString().slice(0, 10);
      })();

      const endD = new Date(startDate + "T00:00:00Z");
      endD.setDate(endD.getDate() + 4); // Mon–Fri
      const endDate = endD.toISOString().slice(0, 10);

      const data = await buildTeamSchedule(startDate, endDate);
      res.json(data);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── GET /api/team-calendar/user/:userId ──────────────────────────────────
  app.get("/api/team-calendar/user/:userId", requireAuth, async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const today = isoDate();
      const twoWeeksOut = isoDate(14);

      const entries = await db
        .select()
        .from(teamWorkScheduleEntries)
        .where(and(eq(teamWorkScheduleEntries.userId, userId), gte(teamWorkScheduleEntries.date, today)))
        .orderBy(teamWorkScheduleEntries.date, teamWorkScheduleEntries.startTime);

      const defaults = await db
        .select()
        .from(teamWorkScheduleDefaults)
        .where(eq(teamWorkScheduleDefaults.userId, userId))
        .orderBy(teamWorkScheduleDefaults.dayOfWeek);

      const [user] = await db.select({ id: users.id, name: users.name, email: users.email, department: users.department, jobTitle: users.jobTitle }).from(users).where(eq(users.id, userId)).limit(1);

      res.json({ user, entries, defaults });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── GET /api/team-calendar/my-entries ────────────────────────────────────
  app.get("/api/team-calendar/my-entries", requireAuth, async (req, res) => {
    try {
      const myId = (req.session as any).userId as number;
      const today = isoDate();

      const entries = await db
        .select()
        .from(teamWorkScheduleEntries)
        .where(and(eq(teamWorkScheduleEntries.userId, myId), gte(teamWorkScheduleEntries.date, today)))
        .orderBy(teamWorkScheduleEntries.date, teamWorkScheduleEntries.startTime);

      const defaults = await db
        .select()
        .from(teamWorkScheduleDefaults)
        .where(eq(teamWorkScheduleDefaults.userId, myId))
        .orderBy(teamWorkScheduleDefaults.dayOfWeek);

      res.json({ entries, defaults });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── POST /api/team-calendar/entries ──────────────────────────────────────
  app.post("/api/team-calendar/entries", requireAuth, async (req, res) => {
    try {
      const myId = (req.session as any).userId as number;
      const myRole = (req.session as any).globalRole as string;
      const isAdmin = myRole === "admin" || myRole === "master_admin";

      const { userId, date, startTime, endTime, status, locationType, locationName, workFocus, availability, notes, visibility } = req.body;

      const targetUserId = userId ?? myId;
      if (targetUserId !== myId && !isAdmin) {
        return res.status(403).json({ message: "You can only create your own schedule entries" });
      }

      const [entry] = await db.insert(teamWorkScheduleEntries).values({
        userId: targetUserId,
        date, startTime: startTime || null, endTime: endTime || null,
        status: status || "flexible",
        locationType: locationType || null, locationName: locationName || null,
        workFocus: workFocus || null, availability: availability || "available",
        notes: notes || null, visibility: visibility || "team",
        isRecurringOverride: false,
        createdBy: myId, updatedBy: myId,
      }).returning();

      await writeAudit(entry.id, myId, "created", null, entry);
      res.status(201).json(entry);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── PUT /api/team-calendar/entries/:id ───────────────────────────────────
  app.put("/api/team-calendar/entries/:id", requireAuth, async (req, res) => {
    try {
      const myId = (req.session as any).userId as number;
      const myRole = (req.session as any).globalRole as string;
      const isAdmin = myRole === "admin" || myRole === "master_admin";
      const entryId = parseInt(req.params.id);

      const [existing] = await db.select().from(teamWorkScheduleEntries).where(eq(teamWorkScheduleEntries.id, entryId)).limit(1);
      if (!existing) return res.status(404).json({ message: "Entry not found" });
      if (existing.userId !== myId && !isAdmin) return res.status(403).json({ message: "Cannot edit another person's schedule" });

      const { startTime, endTime, status, locationType, locationName, workFocus, availability, notes, visibility } = req.body;

      const [updated] = await db.update(teamWorkScheduleEntries)
        .set({ startTime, endTime, status, locationType, locationName, workFocus, availability, notes, visibility, updatedBy: myId, updatedAt: new Date() })
        .where(eq(teamWorkScheduleEntries.id, entryId))
        .returning();

      await writeAudit(entryId, myId, "updated", existing, updated);
      res.json(updated);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── DELETE /api/team-calendar/entries/:id ────────────────────────────────
  app.delete("/api/team-calendar/entries/:id", requireAuth, async (req, res) => {
    try {
      const myId = (req.session as any).userId as number;
      const myRole = (req.session as any).globalRole as string;
      const isAdmin = myRole === "admin" || myRole === "master_admin";
      const entryId = parseInt(req.params.id);

      const [existing] = await db.select().from(teamWorkScheduleEntries).where(eq(teamWorkScheduleEntries.id, entryId)).limit(1);
      if (!existing) return res.status(404).json({ message: "Entry not found" });
      if (existing.userId !== myId && !isAdmin) return res.status(403).json({ message: "Cannot delete another person's schedule" });

      await db.delete(teamWorkScheduleEntries).where(eq(teamWorkScheduleEntries.id, entryId));
      await writeAudit(entryId, myId, "deleted", existing, null);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── GET /api/team-calendar/defaults/:userId ───────────────────────────────
  app.get("/api/team-calendar/defaults/:userId", requireAuth, async (req, res) => {
    try {
      const myId = (req.session as any).userId as number;
      const myRole = (req.session as any).globalRole as string;
      const isAdmin = myRole === "admin" || myRole === "master_admin";
      const userId = parseInt(req.params.userId);
      if (userId !== myId && !isAdmin) return res.status(403).json({ message: "Cannot view another person's defaults" });

      const defaults = await db.select().from(teamWorkScheduleDefaults).where(eq(teamWorkScheduleDefaults.userId, userId)).orderBy(teamWorkScheduleDefaults.dayOfWeek);
      res.json(defaults);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── PUT /api/team-calendar/defaults ──────────────────────────────────────
  // Upserts one day-of-week default. Body: { userId?, dayOfWeek, defaultStatus, ... }
  app.put("/api/team-calendar/defaults", requireAuth, async (req, res) => {
    try {
      const myId = (req.session as any).userId as number;
      const myRole = (req.session as any).globalRole as string;
      const isAdmin = myRole === "admin" || myRole === "master_admin";

      const { userId, dayOfWeek, defaultStatus, defaultStartTime, defaultEndTime, defaultLocationType, defaultLocationName, defaultAvailability } = req.body;
      const targetUserId = userId ?? myId;
      if (targetUserId !== myId && !isAdmin) return res.status(403).json({ message: "Cannot edit another person's defaults" });

      const values = {
        userId: targetUserId, dayOfWeek,
        defaultStatus, defaultStartTime: defaultStartTime || null, defaultEndTime: defaultEndTime || null,
        defaultLocationType: defaultLocationType || null, defaultLocationName: defaultLocationName || null,
        defaultAvailability: defaultAvailability || null,
        updatedAt: new Date(),
      };

      await db.execute(sql.raw(`
        INSERT INTO team_work_schedule_defaults
          (user_id, day_of_week, default_status, default_start_time, default_end_time, default_location_type, default_location_name, default_availability, updated_at)
        VALUES
          (${targetUserId}, ${dayOfWeek}, '${defaultStatus.replace(/'/g, "''")}',
           ${defaultStartTime ? `'${defaultStartTime}'` : 'NULL'},
           ${defaultEndTime ? `'${defaultEndTime}'` : 'NULL'},
           ${defaultLocationType ? `'${defaultLocationType.replace(/'/g, "''")}'` : 'NULL'},
           ${defaultLocationName ? `'${defaultLocationName.replace(/'/g, "''")}'` : 'NULL'},
           ${defaultAvailability ? `'${defaultAvailability.replace(/'/g, "''")}'` : 'NULL'},
           NOW())
        ON CONFLICT (user_id, day_of_week) DO UPDATE SET
          default_status = EXCLUDED.default_status,
          default_start_time = EXCLUDED.default_start_time,
          default_end_time = EXCLUDED.default_end_time,
          default_location_type = EXCLUDED.default_location_type,
          default_location_name = EXCLUDED.default_location_name,
          default_availability = EXCLUDED.default_availability,
          updated_at = NOW()
      `));

      const [result] = await db.select().from(teamWorkScheduleDefaults)
        .where(and(eq(teamWorkScheduleDefaults.userId, targetUserId), eq(teamWorkScheduleDefaults.dayOfWeek, dayOfWeek)))
        .limit(1);

      res.json(result);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── DELETE /api/team-calendar/defaults/:userId/:dayOfWeek ────────────────
  app.delete("/api/team-calendar/defaults/:userId/:dayOfWeek", requireAuth, async (req, res) => {
    try {
      const myId = (req.session as any).userId as number;
      const myRole = (req.session as any).globalRole as string;
      const isAdmin = myRole === "admin" || myRole === "master_admin";
      const userId = parseInt(req.params.userId);
      const dayOfWeek = parseInt(req.params.dayOfWeek);
      if (userId !== myId && !isAdmin) return res.status(403).json({ message: "Cannot edit another person's defaults" });

      await db.delete(teamWorkScheduleDefaults)
        .where(and(eq(teamWorkScheduleDefaults.userId, userId), eq(teamWorkScheduleDefaults.dayOfWeek, dayOfWeek)));
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── GET /api/team-calendar/audit — admin only ─────────────────────────────
  app.get("/api/team-calendar/audit", requireAuth, requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const rows = await db
        .select({ log: teamWorkScheduleAuditLog, changerName: users.name })
        .from(teamWorkScheduleAuditLog)
        .leftJoin(users, eq(teamWorkScheduleAuditLog.changedBy, users.id))
        .orderBy(desc(teamWorkScheduleAuditLog.createdAt))
        .limit(limit);
      res.json(rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── GET /api/team-calendar/users — list of all active internal users ─────
  app.get("/api/team-calendar/users", requireAuth, async (req, res) => {
    try {
      const allUsers = await db
        .select({ id: users.id, name: users.name, email: users.email, department: users.department, jobTitle: users.jobTitle, avatarUrl: users.avatarUrl })
        .from(users)
        .where(and(eq(users.status, "active"), eq(users.userType, "internal")));
      res.json(allUsers);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });
}
