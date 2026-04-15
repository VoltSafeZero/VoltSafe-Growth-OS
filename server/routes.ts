import type { Express } from "express";
import type { Server } from "http";
import { pick } from "./utils";
import { storage } from "./storage";
import { db } from "./db";
import { metrics, sales, chartData, users, systemSettings, emailMessages, mailFolders, mailFolderDomains, emailFolderAssignments, notifications } from "@shared/schema";
import {
  insertLeadSchema, insertAccountSchema, insertContactSchema,
  insertOpportunitySchema, insertTicketSchema, insertQuoteSchema,
  insertQuoteLineItemSchema, insertServicesEstimateSchema,
  insertActivitySchema, insertTaskSchema,
  insertCommunicationListSchema, insertCampaignDraftSchema,
  insertInfrastructureProfileSchema, insertCommentSchema,
  insertPartnershipSchema,
  insertEcosystemOrganizationSchema, insertEcosystemPersonSchema,
  insertEcosystemRelationshipSchema, insertEcosystemEventSchema,
  insertEcosystemRegionSchema,
  insertCalendarEventSchema,
} from "@shared/schema";
import multer from "multer";
import { z } from "zod";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { requireAuth, requirePermission, seedUsers, hashPassword, verifyPassword, getSessionUserId, requireName } from "./auth";
import { toCsv, setCsvHeaders, type CsvColumn } from "./csv-export";
import {
  getRegistrationOptions, verifyRegistration,
  getAuthenticationOptions, verifyAuthentication,
  getUserCredentials, deleteCredential,
} from "./webauthn";
import { eq, sql, and, or, inArray, lte, gte, ilike, asc, desc, isNull, ne, count, not } from "drizzle-orm";
import { registerVoiceAssistantRoutes } from "./voice-assistant";
import { generateInvoiceHtml, generateQuoteXlsx, type QuoteData } from "./quote-generator";
import { listThreads, getThread, getMessageSummaries, sendEmail, getProfile, markMessageRead, saveDraft, listDraftSummaries, getDraftContent, deleteDraft } from "./gmail";
import { getAuthUrl, exchangeCodeForTokens, isGmailConnected, getGmailClient } from "./gmail-oauth";
import { parseGmailMessage } from "./services/email-parser";
import { runAssociationEngine } from "./services/association-engine";
import { computeSignals } from "./services/signal-engine";
import { runGmailSync, syncEmailAccount } from "./services/gmail-sync";
import { buildSweepReport } from "./services/auto-confirm";
import { generateGlobalSuggestions } from "./services/global-suggestions";
import {
  generateTrackingId, injectTracking, recordOpen, recordClick, getEngagementStats,
} from "./tracking";
import { startEngagementScheduler } from "./services/engagement-scheduler";
import { seedDefaultRules } from "./services/engagement-defaults";
import { computeAwaitingReply, clearAwaitingReply, getTriageSummary, getAwaitingReplyThreads } from "./services/awaiting-reply";
import {
  emailMessages, emailThreads, emailAssociations, associationFeedback, emailFilters, scheduledEmails,
  emailAccounts,
  assets, assetFolders, priceLists, priceListItems,
  contacts, accounts, leads, opportunities, partnerships,
  migrationMap, notes,
  calendarConnections, calendarEvents, tasks,
} from "@shared/schema";
import {
  getCalendarAuthUrl,
  exchangeCalendarCode,
  syncGoogleCalendar,
  syncCalDav,
  testCalDavConnection,
  getCalendarIntegrations,
  disconnectCalendarIntegration,
} from "./calendar-sync";

const UPLOADS_DIR = path.resolve("uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ASSETS_DIR = path.resolve("uploads/assets");
if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, crypto.randomUUID() + ext);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /^(image|video)\//;
    if (allowed.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image and video files are allowed"));
    }
  },
});

const ALLOWED_ASSET_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif",
  "image/svg+xml", "image/tiff", "image/bmp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv", "text/plain",
  "application/zip",
]);

const assetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_ASSET_MIME_TYPES.has(file.mimetype) || file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error(`File type '${file.mimetype}' is not allowed`));
    }
  },
});

// Module-level permission helpers — accessible from all route registration functions.
// (The same helpers are also defined inside registerRoutes for historical reasons;
//  these module-level versions let registerConfluenceRoutes use them too.)
async function getSessionUserAccess(session: any): Promise<{
  isAdmin: boolean;
  mailTeamPerms: Record<string, { view: boolean; edit: boolean }>;
}> {
  const role = String(session.globalRole || "");
  const isAdmin = role === "master_admin" || role === "admin";
  if (isAdmin) return { isAdmin: true, mailTeamPerms: {} };
  const userId = session.userId as number;
  const [u] = await db.select({ permissions: users.permissions })
    .from(users).where(eq(users.id, userId)).limit(1);
  const mailTeamPerms = ((u?.permissions as any)?.mail_team ?? {}) as Record<string, { view: boolean; edit: boolean }>;
  return { isAdmin: false, mailTeamPerms };
}

async function getAccessibleAccountIds(
  userId: number,
  isAdmin: boolean,
  mailTeamPerms: Record<string, { view: boolean; edit: boolean }> = {},
): Promise<number[]> {
  const [ownAccts, sharedAccts] = await Promise.all([
    db.select({ id: emailAccounts.id }).from(emailAccounts)
      .where(and(eq(emailAccounts.userId, userId), eq(emailAccounts.isActive, true))),
    db.select({ id: emailAccounts.id }).from(emailAccounts)
      .where(and(eq(emailAccounts.isShared, true), eq(emailAccounts.isActive, true))),
  ]);
  const ownIds = ownAccts.map((a) => a.id);
  const sharedIds = isAdmin
    ? sharedAccts.map((a) => a.id)
    : sharedAccts.filter((a) => mailTeamPerms[String(a.id)]?.view === true).map((a) => a.id);
  return [...new Set([...ownIds, ...sharedIds])];
}

// Module-level admin guard — available to all route-registration functions.
// Checks globalRole stored in session at login time (set by requireAuth flow).
function requireAdmin(req: any, res: any, next: any) {
  if (!req.session?.userId) return res.status(401).json({ message: "Not authenticated" });
  const role = String((req.session as any).globalRole || "");
  if (!["master_admin", "admin"].includes(role)) {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  registerVoiceAssistantRoutes(app);

  // ── Public Tracking Routes (NO auth — served to email clients) ─────────────
  // 1x1 transparent GIF pixel for open tracking
  // Shared handler for open pixel (both .gif and bare token variants)
  function serveTrackingPixel(trackingId: string, req: any, res: any) {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress;
    const ua = req.headers["user-agent"];
    const pixel = Buffer.from(
      "47494638396101000100800000ffffff00000021f90400000000002c00000000010001000002024401003b", "hex"
    );
    res.setHeader("Content-Type", "image/gif");
    res.setHeader("Content-Length", pixel.length);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(pixel);
    // Fire and forget — write event after response is already sent
    recordOpen(trackingId, ip, ua).catch(() => {});
  }

  // Primary: with .gif extension (used in injected pixels)
  app.get("/track/open/:trackingId.gif", (req, res) => {
    serveTrackingPixel(req.params.trackingId, req, res);
  });

  // Alias: bare token (spec requirement — used in injectTracking() pixel src)
  app.get("/track/open/:trackingId", (req, res) => {
    serveTrackingPixel(req.params.trackingId, req, res);
  });

  // Tracked link redirect
  app.get("/track/click/:trackingId", async (req, res) => {
    const { trackingId } = req.params;
    const destinationUrl = req.query.url as string;
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress;
    const ua = req.headers["user-agent"];

    // Validate destination URL to prevent open redirect abuse
    let safeUrl = "/";
    if (destinationUrl) {
      try {
        const parsed = new URL(decodeURIComponent(destinationUrl));
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          safeUrl = parsed.href;
        }
      } catch { /* invalid URL — redirect to / */ }
    }

    res.redirect(302, safeUrl);
    // Fire and forget
    recordClick(trackingId, safeUrl, ip, ua).catch(() => {});
  });

  // ── Engagement Stats API (authenticated) ───────────────────────────────────
  app.get("/api/email-engagement/:trackingId", requireAuth, async (req, res) => {
    try {
      const stats = await getEngagementStats(req.params.trackingId);
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/email-engagement/by-message/:gmailMessageId", requireAuth, async (req, res) => {
    try {
      const gmailMessageId = decodeURIComponent(req.params.gmailMessageId);
      const [pixel] = (await db.execute(sql.raw(`
        SELECT tracking_id FROM email_tracking_pixels
        WHERE gmail_message_id = '${gmailMessageId.replace(/'/g, "''")}'
        LIMIT 1
      `))).rows as any[];
      if (!pixel) return res.json({ trackingId: null, opens: 0, uniqueOpens: 0, clicks: 0, uniqueClicks: 0, firstOpenAt: null, lastOpenAt: null, score: 0, signalLevel: "none", isHot: false, events: [] });
      const stats = await getEngagementStats(pixel.tracking_id);
      res.json({ trackingId: pixel.tracking_id, ...stats });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Engagement rules CRUD
  app.get("/api/email-engagement-rules", requireAuth, async (req, res) => {
    try {
      const rows = (await db.execute(sql.raw(`SELECT * FROM email_engagement_rules ORDER BY id ASC`))).rows;
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/email-engagement-rules", requireAuth, requirePermission("crm", "edit"), async (req, res) => {
    try {
      const { name, triggerType, minEvents, actionType, actionConfig, triggerConfig, cooldownHours, isEnabled } = req.body;
      if (!name || !triggerType || !actionType) return res.status(400).json({ message: "name, triggerType, actionType required" });
      const [row] = (await db.execute(sql.raw(`
        INSERT INTO email_engagement_rules
          (name, trigger_type, min_events, action_type, action_config, trigger_config, cooldown_hours, is_enabled, created_at, updated_at)
        VALUES (
          '${String(name).replace(/'/g, "''")}',
          '${String(triggerType).replace(/'/g, "''")}',
          ${Number(minEvents) || 1},
          '${String(actionType).replace(/'/g, "''")}',
          ${actionConfig ? `'${JSON.stringify(actionConfig).replace(/'/g, "''")}'::jsonb` : "NULL"},
          ${triggerConfig ? `'${JSON.stringify(triggerConfig).replace(/'/g, "''")}'::jsonb` : "'{}'::jsonb"},
          ${Number(cooldownHours) || 24},
          ${isEnabled !== false},
          NOW(), NOW()
        ) RETURNING *
      `))).rows as any[];
      res.status(201).json(row);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/email-engagement-rules/:id", requireAuth, requirePermission("crm", "edit"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const r = req.body;
      const updates: string[] = ["updated_at = NOW()"];
      if (r.isEnabled !== undefined)  updates.push(`is_enabled = ${Boolean(r.isEnabled)}`);
      if (r.name)                     updates.push(`name = '${String(r.name).replace(/'/g, "''")}'`);
      if (r.minEvents !== undefined)  updates.push(`min_events = ${Number(r.minEvents)}`);
      if (r.cooldownHours !== undefined) updates.push(`cooldown_hours = ${Number(r.cooldownHours)}`);
      if (r.actionConfig !== undefined)  updates.push(`action_config = '${JSON.stringify(r.actionConfig).replace(/'/g, "''")}'::jsonb`);
      if (r.triggerConfig !== undefined) updates.push(`trigger_config = '${JSON.stringify(r.triggerConfig).replace(/'/g, "''")}'::jsonb`);
      if (r.triggerType) updates.push(`trigger_type = '${String(r.triggerType).replace(/'/g, "''")}'`);
      if (r.actionType)  updates.push(`action_type  = '${String(r.actionType).replace(/'/g, "''")}'`);
      const [row] = (await db.execute(sql.raw(
        `UPDATE email_engagement_rules SET ${updates.join(", ")} WHERE id = ${id} RETURNING *`
      ))).rows as any[];
      if (!row) return res.status(404).json({ message: "Rule not found" });
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/email-engagement-rules/:id", requireAuth, requirePermission("crm", "edit"), async (req, res) => {
    try {
      await db.execute(sql.raw(`DELETE FROM email_engagement_rules WHERE id = ${Number(req.params.id)}`));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Email and password required" });

    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim()));
    if (!user) return res.status(401).json({ message: "Invalid email or password" });

    const valid = await verifyPassword(password, user.password);
    if (!valid) return res.status(401).json({ message: "Invalid email or password" });

    await db.update(users).set({ lastLogin: new Date() }).where(eq(users.id, user.id));

    req.session.userId = user.id;
    req.session.email = user.email;
    req.session.role = user.role;
    req.session.name = user.name;
    req.session.mustChangePassword = user.mustChangePassword;
    (req.session as any).globalRole = user.globalRole;

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      globalRole: user.globalRole,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      permissions: user.permissions ?? { crm: "edit", partnerships: "edit", projects: "edit", communications: "edit", team_workload: "edit", knowledge: "edit", support: "edit", quoting: "edit", calendar: "edit", mail_team: {}, calendar_team: [] },
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ message: "Logged out" });
    });
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const [user] = await db.select().from(users).where(eq(users.id, req.session.userId));
    if (!user) return res.status(401).json({ message: "Not authenticated" });
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      globalRole: user.globalRole,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      permissions: user.permissions ?? { crm: "edit", partnerships: "edit", projects: "edit", communications: "edit", team_workload: "edit", knowledge: "edit", support: "edit", quoting: "edit", calendar: "edit", mail_team: {}, calendar_team: [] },
    });
  });

  app.post("/api/auth/change-password", async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Not authenticated" });

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ message: "Current and new password required" });
    if (newPassword.length < 6) return res.status(400).json({ message: "New password must be at least 6 characters" });

    const [user] = await db.select().from(users).where(eq(users.id, req.session.userId));
    if (!user) return res.status(404).json({ message: "User not found" });

    const valid = await verifyPassword(currentPassword, user.password);
    if (!valid) return res.status(401).json({ message: "Current password is incorrect" });

    const hashed = await hashPassword(newPassword);
    await db.update(users).set({ password: hashed, mustChangePassword: false }).where(eq(users.id, user.id));

    req.session.mustChangePassword = false;
    res.json({ message: "Password changed successfully" });
  });

  // POST /api/auth/change-password-forced — set new password when session has mustChangePassword=true (no old password needed)
  app.post("/api/auth/change-password-forced", async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Not authenticated" });
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ message: "Password must be at least 8 characters" });
    const hashed = await hashPassword(newPassword);
    await db.update(users).set({ password: hashed, mustChangePassword: false }).where(eq(users.id, req.session.userId));
    req.session.mustChangePassword = false;
    res.json({ message: "Password updated" });
  });

  // POST /api/auth/forgot-password — generate token and send reset email
  app.post("/api/auth/forgot-password", async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email required" });

    // Always respond with success to avoid user-enumeration attacks
    const [user] = await db.select().from(users).where(sql`LOWER(email) = LOWER(${email})`).limit(1);
    if (!user || user.status === "suspended" || user.status === "deactivated") {
      return res.json({ message: "If that email exists you'll receive a reset link shortly." });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.update(users)
      .set({ passwordResetToken: token, passwordResetExpires: expires } as any)
      .where(eq(users.id, user.id));

    const appUrl = process.env.APP_URL || "https://image-linker-burgesstrevor76.replit.app";
    const resetUrl = `${appUrl}/reset-password?token=${token}`;
    const SYSTEM_SENDER_ID = 4;

    const html = `
<div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; color: #1a1a1a;">
  <h2 style="margin-bottom: 4px;">Password Reset — VoltSafe Growth OS</h2>
  <p style="color: #555; margin-top: 0;">Hi ${user.name}, we received a request to reset your password.</p>
  <div style="margin: 24px 0;">
    <a href="${resetUrl}" style="display: inline-block; background: #00C1DE; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: 600; font-size: 15px;">
      Reset My Password
    </a>
  </div>
  <p style="color: #555; font-size: 14px;">This link expires in <strong>1 hour</strong>. If you didn't request a reset, you can safely ignore this email.</p>
  <p style="color: #999; font-size: 12px; border-top: 1px solid #eee; padding-top: 12px; margin-top: 20px;">
    Or copy this URL into your browser:<br>
    <span style="color: #0066cc;">${resetUrl}</span>
  </p>
</div>`;

    sendEmail(SYSTEM_SENDER_ID, user.email, "Reset your VoltSafe Growth OS password", html)
      .catch((err) => console.error("[reset-email] Failed to send reset email to", user.email, err?.message));

    res.json({ message: "If that email exists you'll receive a reset link shortly." });
  });

  // POST /api/auth/reset-password-by-token — validate token, log user in, force pw change
  app.post("/api/auth/reset-password-by-token", async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: "Token required" });

    const [user] = await db.select().from(users)
      .where(sql`password_reset_token = ${token} AND password_reset_expires > NOW()`)
      .limit(1);

    if (!user) return res.status(400).json({ message: "This reset link has expired or is invalid. Please request a new one." });

    // Clear the token, mark password must be changed, create session
    await db.update(users)
      .set({ passwordResetToken: null, passwordResetExpires: null, mustChangePassword: true } as any)
      .where(eq(users.id, user.id));

    req.session.userId = user.id;
    req.session.mustChangePassword = true;

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      globalRole: user.globalRole,
      status: user.status,
      mustChangePassword: true,
      permissions: user.permissions ?? {},
    });
  });

  app.post("/api/webauthn/register-options", requireAuth, async (req, res) => {
    try {
      const options = await getRegistrationOptions(req.session.userId!, req);
      res.json(options);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/webauthn/register-verify", requireAuth, async (req, res) => {
    try {
      const result = await verifyRegistration(req.session.userId!, req.body, req);
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/webauthn/auth-options", async (req, res) => {
    try {
      const options = await getAuthenticationOptions(req, req.body.email);
      res.json(options);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/webauthn/auth-verify", async (req, res) => {
    try {
      const result = await verifyAuthentication(req.body, req);
      if (!result.user) return res.status(401).json({ message: "Authentication failed" });

      await db.update(users).set({ lastLogin: new Date() }).where(eq(users.id, result.user.id));

      req.session.userId = result.user.id;
      req.session.email = result.user.email;
      req.session.role = result.user.role;
      req.session.name = result.user.name;
      req.session.mustChangePassword = result.user.mustChangePassword;
      (req.session as any).globalRole = result.user.globalRole;

      res.json({
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        role: result.user.role,
        globalRole: result.user.globalRole,
        mustChangePassword: result.user.mustChangePassword,
      });
    } catch (e: any) {
      res.status(401).json({ message: e.message });
    }
  });

  app.get("/api/webauthn/credentials", requireAuth, async (req, res) => {
    const creds = await getUserCredentials(req.session.userId!);
    res.json(creds);
  });

  app.delete("/api/webauthn/credentials/:id", requireAuth, async (req, res) => {
    try {
      await deleteCredential(req.session.userId!, Number(req.params.id));
      res.json({ deleted: true });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.use("/api/metrics", requireAuth);
  app.use("/api/sales", requireAuth);
  app.use("/api/chart-data", requireAuth);
  app.use("/api/marinas", requireAuth);
  app.use("/api/dashboard", requireAuth);
  // CRM section — view permission required for all reads; edit checked per write route
  app.use("/api/leads", requireAuth, requirePermission("crm", "view"));
  app.use("/api/accounts", requireAuth, requirePermission("crm", "view"));
  app.use("/api/contacts", requireAuth, requirePermission("crm", "view"));
  app.use("/api/opportunities", requireAuth, requirePermission("crm", "view"));
  // Support section — view permission required for all reads
  app.use("/api/tickets", requireAuth, requirePermission("support", "view"));
  // Quoting section — view permission required for all reads
  app.use("/api/quotes", requireAuth, requirePermission("quoting", "view"));
  // Activities, tasks, comments are cross-cutting (attached to multiple object types)
  // Enforced at the UI layer; backend requires auth only to avoid breaking cross-section use
  app.use("/api/activities", requireAuth);
  app.use("/api/tasks", requireAuth);
  app.use("/api/comments", requireAuth);
  app.use("/api/attachments", requireAuth);
  app.use("/api/users", requireAuth);
  // Section-guarded APIs — view permission required for reads; edit checked per write route
  app.use("/api/comm-lists", requireAuth, requirePermission("communications", "view"));
  app.use("/api/campaigns", requireAuth, requirePermission("communications", "view"));
  app.use("/api/team-workload", requireAuth, requirePermission("team_workload", "view"));
  app.use("/api/projects", requireAuth, requirePermission("projects", "view"));
  app.use("/api/assets", requireAuth, requirePermission("knowledge", "view"));
  app.use("/api/asset-folders", requireAuth, requirePermission("knowledge", "view"));
  // Partnerships section — view permission required for all reads
  app.use("/api/partnerships", requireAuth, requirePermission("partnerships", "view"));
  app.use("/api/ecosystem", requireAuth, requirePermission("partnerships", "view"));
  app.use("/api/geocode", requireAuth);

  app.get("/api/metrics", async (_req, res) => {
    res.json(await storage.getMetrics());
  });

  app.get("/api/sales", async (_req, res) => {
    res.json(await storage.getSales());
  });

  app.get("/api/chart-data", async (_req, res) => {
    res.json(await storage.getChartData());
  });

  // ── CSV Export Endpoints ──────────────────────────────────────────
  app.get("/api/marinas/export", async (req, res) => {
    const { search, state } = req.query;
    const result = await storage.getMarinas({ search: search as string, state: state as string, page: 1, limit: 100000 });
    const cols: CsvColumn[] = [
      { key: "name", header: "Name" }, { key: "city", header: "City" }, { key: "state", header: "State" },
      { key: "phone", header: "Phone" }, { key: "address", header: "Address" }, { key: "slips", header: "Slips" },
    ];
    setCsvHeaders(res, "marinas_export.csv");
    res.send(toCsv(result.data as any, cols));
  });

  app.get("/api/leads/export", async (req, res) => {
    const { search, status, country, state } = req.query;
    const result = await storage.getLeads({
      search: search as string, status: status as string,
      country: country as string, state: state as string,
      page: 1, limit: 100000, sortBy: "slips", sortOrder: "desc",
    });
    const cols: CsvColumn[] = [
      { key: "company", header: "Company" }, { key: "contactName", header: "Contact Name" },
      { key: "contactEmail", header: "Contact Email" }, { key: "contactPhone", header: "Contact Phone" },
      { key: "city", header: "City" }, { key: "state", header: "State" }, { key: "country", header: "Country" },
      { key: "slips", header: "Slips" }, { key: "status", header: "Stage" }, { key: "source", header: "Source" },
      { key: "segment", header: "Segment" }, { key: "tags", header: "Tags" }, { key: "notes", header: "Notes" },
      { key: "nextStep", header: "Next Step" }, { key: "dueDate", header: "Due Date" },
      { key: "dealAmount", header: "Deal Amount" }, { key: "dealProbability", header: "Probability %" },
      { key: "dealValueHardware", header: "Hardware $" }, { key: "dealValueSoftware", header: "Software $" },
      { key: "dealValueServices", header: "Services $" }, { key: "primaryValueDriver", header: "Value Driver" },
      { key: "estimatedPedestalCount", header: "Est. Pedestals" }, { key: "estimatedSlipsImpacted", header: "Est. Slips Impacted" },
      { key: "estCloseDate", header: "Est. Close Date" }, { key: "competitors", header: "Competitors" },
      { key: "createdAt", header: "Created At" },
    ];
    setCsvHeaders(res, "leads_export.csv");
    res.send(toCsv(result.data as any, cols));
  });

  app.get("/api/accounts/export", async (req, res) => {
    const { search, segment } = req.query;
    const result = await storage.getAccounts({ search: search as string, segment: segment as string, page: 1, limit: 100000 });
    const cols: CsvColumn[] = [
      { key: "name", header: "Name" }, { key: "segment", header: "Segment" },
      { key: "region", header: "Region" }, { key: "timezone", header: "Timezone" },
      { key: "slipCount", header: "Slip Count" }, { key: "tags", header: "Tags" },
      { key: "notes", header: "Notes" }, { key: "createdAt", header: "Created At" },
    ];
    setCsvHeaders(res, "accounts_export.csv");
    res.send(toCsv(result.data as any, cols));
  });

  app.get("/api/contacts/export", async (req, res) => {
    const { accountId } = req.query;
    const data = await storage.getContacts({ accountId: accountId ? Number(accountId) : undefined });
    const cols: CsvColumn[] = [
      { key: "name", header: "Name" }, { key: "title", header: "Title" },
      { key: "email", header: "Email" }, { key: "phone", header: "Phone" },
      { key: "persona", header: "Persona" }, { key: "accountId", header: "Account ID" },
    ];
    setCsvHeaders(res, "contacts_export.csv");
    res.send(toCsv(data as any, cols));
  });

  app.get("/api/opportunities/export", async (req, res) => {
    const { stage, owner } = req.query;
    const result = await storage.getOpportunities({ stage: stage as string, owner: owner as string, page: 1, limit: 100000 });
    const cols: CsvColumn[] = [
      { key: "title", header: "Title" }, { key: "accountId", header: "Account ID" },
      { key: "stage", header: "Stage" }, { key: "owner", header: "Owner" },
      { key: "estCloseDate", header: "Est Close Date" },
      { key: "valueHardware", header: "Hardware Value" }, { key: "valueSoftware", header: "Software Value" },
      { key: "valueServices", header: "Services Value" }, { key: "totalValue", header: "Total Value" },
      { key: "competitors", header: "Competitors" }, { key: "nextStep", header: "Next Step" },
      { key: "dueDate", header: "Due Date" }, { key: "riskFlags", header: "Risk Flags" },
      { key: "createdAt", header: "Created At" },
    ];
    setCsvHeaders(res, "opportunities_export.csv");
    res.send(toCsv(result.data as any, cols));
  });

  app.get("/api/tickets/export", async (req, res) => {
    const { status, severity } = req.query;
    const result = await storage.getTickets({ status: status as string, severity: severity as string, page: 1, limit: 100000 });
    const cols: CsvColumn[] = [
      { key: "id", header: "ID" }, { key: "category", header: "Category" },
      { key: "severity", header: "Severity" }, { key: "status", header: "Status" },
      { key: "requesterName", header: "Requester Name" }, { key: "requesterEmail", header: "Requester Email" },
      { key: "assignedTo", header: "Assigned To" }, { key: "description", header: "Description" },
      { key: "internalNotes", header: "Internal Notes" }, { key: "resolutionSummary", header: "Resolution Summary" },
      { key: "createdAt", header: "Created At" },
    ];
    setCsvHeaders(res, "tickets_export.csv");
    res.send(toCsv(result.data as any, cols));
  });

  app.get("/api/quotes/export", async (req, res) => {
    const { status } = req.query;
    const result = await storage.getQuotes({ status: status as string, page: 1, limit: 100000 });
    const cols: CsvColumn[] = [
      { key: "quoteNumber", header: "Quote Number" }, { key: "version", header: "Version" },
      { key: "quoteType", header: "Type" }, { key: "status", header: "Status" },
      { key: "currency", header: "Currency" }, { key: "subtotal", header: "Subtotal" },
      { key: "tax", header: "Tax" }, { key: "total", header: "Total" },
      { key: "assumptions", header: "Assumptions" }, { key: "exclusions", header: "Exclusions" },
      { key: "createdAt", header: "Created At" },
    ];
    setCsvHeaders(res, "quotes_export.csv");
    res.send(toCsv(result.data as any, cols));
  });

  app.get("/api/activities/export", async (req, res) => {
    const { objectType, objectId } = req.query;
    if (!objectType || !objectId) return res.status(400).json({ message: "objectType and objectId required" });
    const data = await storage.getActivities(objectType as string, Number(objectId));
    const cols: CsvColumn[] = [
      { key: "type", header: "Type" }, { key: "summary", header: "Summary" },
      { key: "rawContent", header: "Content" }, { key: "createdAt", header: "Created At" },
    ];
    setCsvHeaders(res, "activities_export.csv");
    res.send(toCsv(data as any, cols));
  });

  app.get("/api/tasks/export", async (req, res) => {
    const { owner, status, linkedObjectType, linkedObjectId } = req.query;
    const data = await storage.getTasks({
      owner: owner as string, status: status as string,
      linkedObjectType: linkedObjectType as string,
      linkedObjectId: linkedObjectId ? Number(linkedObjectId) : undefined,
    });
    const cols: CsvColumn[] = [
      { key: "title", header: "Title" }, { key: "description", header: "Description" },
      { key: "owner", header: "Owner" }, { key: "status", header: "Status" },
      { key: "dueDate", header: "Due Date" }, { key: "linkedObjectType", header: "Linked Object Type" },
      { key: "linkedObjectId", header: "Linked Object ID" }, { key: "createdAt", header: "Created At" },
    ];
    setCsvHeaders(res, "tasks_export.csv");
    res.send(toCsv(data as any, cols));
  });

  app.get("/api/comm-lists/export", async (_req, res) => {
    const data = await storage.getCommunicationLists();
    const cols: CsvColumn[] = [
      { key: "name", header: "Name" }, { key: "source", header: "Source" },
      { key: "externalId", header: "External ID" }, { key: "description", header: "Description" },
      { key: "memberCount", header: "Member Count" }, { key: "createdAt", header: "Created At" },
    ];
    setCsvHeaders(res, "communication_lists_export.csv");
    res.send(toCsv(data as any, cols));
  });

  app.get("/api/campaigns/export", async (req, res) => {
    const { status } = req.query;
    const data = await storage.getCampaignDrafts({ status: status as string });
    const cols: CsvColumn[] = [
      { key: "subject", header: "Subject" }, { key: "body", header: "Body" },
      { key: "status", header: "Status" }, { key: "externalCampaignId", header: "External Campaign ID" },
      { key: "externalCampaignLink", header: "External Campaign Link" },
      { key: "sentAt", header: "Sent At" }, { key: "createdAt", header: "Created At" },
    ];
    setCsvHeaders(res, "campaigns_export.csv");
    res.send(toCsv(data as any, cols));
  });

  // ── End CSV Export Endpoints ────────────────────────────────────────

  app.get("/api/marinas/states", async (_req, res) => {
    res.json(await storage.getMarinaStates());
  });

  app.get("/api/marinas", async (req, res) => {
    const { search, state, page, limit, sortBy, sortOrder } = req.query;
    res.json(await storage.getMarinas({
      search: search as string | undefined,
      state: state as string | undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      sortBy: sortBy as string | undefined,
      sortOrder: sortOrder as string | undefined,
    }));
  });

  app.get("/api/dashboard/summary", async (_req, res) => {
    res.json(await storage.getDashboardSummary());
  });

  app.get("/api/leads/nearby", async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radiusKm = Number(req.query.radius) || 100;
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ message: "lat and lng required" });
    const latDeg = radiusKm / 111.0;
    const lngDeg = radiusKm / (111.0 * Math.cos(lat * Math.PI / 180));
    const minLat = lat - latDeg;
    const maxLat = lat + latDeg;
    const minLng = lng - lngDeg;
    const maxLng = lng + lngDeg;
    const results = await db.execute(sql`
      SELECT * FROM (
        SELECT l.*, m.latitude as marina_lat, m.longitude as marina_lng, m.street_address as marina_address,
          (6371 * acos(
            LEAST(1.0, cos(radians(${lat})) * cos(radians(m.latitude)) *
            cos(radians(m.longitude) - radians(${lng})) +
            sin(radians(${lat})) * sin(radians(m.latitude)))
          )) AS distance_km
        FROM leads l
        JOIN marinas m ON l.marina_id = m.id
        WHERE m.latitude IS NOT NULL AND m.longitude IS NOT NULL
          AND m.latitude BETWEEN ${minLat} AND ${maxLat}
          AND m.longitude BETWEEN ${minLng} AND ${maxLng}
        UNION ALL
        SELECT l.*, l.lead_lat as marina_lat, l.lead_lng as marina_lng, l.street_address as marina_address,
          (6371 * acos(
            LEAST(1.0, cos(radians(${lat})) * cos(radians(l.lead_lat)) *
            cos(radians(l.lead_lng) - radians(${lng})) +
            sin(radians(${lat})) * sin(radians(l.lead_lat)))
          )) AS distance_km
        FROM leads l
        WHERE l.marina_id IS NULL
          AND l.lead_lat IS NOT NULL AND l.lead_lng IS NOT NULL
          AND l.lead_lat BETWEEN ${minLat} AND ${maxLat}
          AND l.lead_lng BETWEEN ${minLng} AND ${maxLng}
      ) sub
      WHERE distance_km <= ${radiusKm}
      ORDER BY distance_km ASC
      LIMIT ${limit}
    `);
    res.json(results.rows);
  });

  app.get("/api/geocode/search", async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ message: "q parameter required" });
    const limit = Math.min(Number(req.query.limit) || 1, 8);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=${limit}&addressdetails=1`;
      const response = await fetch(url, {
        headers: { "User-Agent": "VoltSafeCortex/1.0" },
      });
      const data = await response.json() as Array<{ lat: string; lon: string; display_name: string; type: string }>;
      if (!data.length) return res.status(404).json({ message: "Address not found" });
      if (limit === 1) {
        return res.json({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), display_name: data[0].display_name });
      }
      res.json(data.map(d => ({
        lat: parseFloat(d.lat),
        lng: parseFloat(d.lon),
        display_name: d.display_name,
      })));
    } catch {
      res.status(500).json({ message: "Geocoding failed" });
    }
  });

  app.post("/api/leads/:id/geocode-address", async (req, res) => {
    const leadId = Number(req.params.id);
    const lead = await storage.getLead(leadId);
    if (!lead) return res.status(404).json({ message: "Lead not found" });

    let lat: number | null = null;
    let lng: number | null = null;
    if (lead.marinaId) {
      const marinaResult = await db.execute(sql`SELECT latitude, longitude, street_address FROM marinas WHERE id = ${lead.marinaId}`);
      const marina = marinaResult.rows[0] as { latitude: number | null; longitude: number | null; street_address: string | null } | undefined;
      if (marina?.street_address) {
        return res.json({ address: marina.street_address, lat: marina.latitude, lng: marina.longitude });
      }
      lat = marina?.latitude as number | null;
      lng = marina?.longitude as number | null;
    }
    if (!lat || !lng) {
      return res.status(400).json({ message: "No coordinates available to reverse-geocode" });
    }

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
      const response = await fetch(url, {
        headers: { "User-Agent": "VoltSafeCortex/1.0" },
      });
      const data = await response.json() as { display_name?: string; address?: { road?: string; house_number?: string; city?: string; state?: string; postcode?: string } };
      if (!data.display_name) return res.status(404).json({ message: "Could not reverse-geocode address" });

      const addr = data.address;
      const street = [addr?.house_number, addr?.road].filter(Boolean).join(" ");
      const fullAddress = street || data.display_name;

      if (lead.marinaId) {
        await db.execute(sql`UPDATE marinas SET street_address = ${fullAddress} WHERE id = ${lead.marinaId}`);
      }
      if (!lead.streetAddress) {
        await db.execute(sql`UPDATE leads SET street_address = ${fullAddress} WHERE id = ${leadId}`);
      }

      res.json({ address: fullAddress, lat, lng });
    } catch {
      res.status(500).json({ message: "Reverse geocoding failed" });
    }
  });

  app.get("/api/leads/states", async (_req, res) => {
    res.json(await storage.getLeadStates());
  });

  app.post("/api/leads/import-marinas", requirePermission("crm", "edit"), async (_req, res) => {
    const count = await storage.importMarinasAsLeads();
    res.json({ imported: count, message: `Imported ${count} marinas as leads` });
  });

  app.get("/api/leads", async (req, res) => {
    const { search, status, state, country, page, limit, sortBy, sortOrder } = req.query;
    res.json(await storage.getLeads({
      search: search as string | undefined,
      status: status as string | undefined,
      state: state as string | undefined,
      country: country as string | undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      sortBy: sortBy as string | undefined,
      sortOrder: sortOrder as string | undefined,
    }));
  });

  app.get("/api/leads/:id", async (req, res) => {
    const lead = await storage.getLead(Number(req.params.id));
    if (!lead) return res.status(404).json({ message: "Lead not found" });
    res.json(lead);
  });

  app.post("/api/leads", requirePermission("crm", "edit"), async (req, res) => {
    const body = { ...req.body };
    if (body.dueDate && typeof body.dueDate === "string") body.dueDate = new Date(body.dueDate);
    if (body.estCloseDate && typeof body.estCloseDate === "string") body.estCloseDate = new Date(body.estCloseDate);
    const parsed = insertLeadSchema.safeParse(body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createLead(parsed.data));
  });

  app.put("/api/leads/:id", requirePermission("crm", "edit"), async (req, res) => {
    const lid = Number(req.params.id);
    const existing = await storage.getLead(lid);
    if (!existing) return res.status(404).json({ message: "Lead not found" });
    const body = { ...req.body };
    if (body.dueDate && typeof body.dueDate === "string") body.dueDate = new Date(body.dueDate);
    if (body.estCloseDate && typeof body.estCloseDate === "string") body.estCloseDate = new Date(body.estCloseDate);
    const result = await storage.updateLead(lid, body);
    if (!result) return res.status(404).json({ message: "Lead not found" });
    const userId = getSessionUserId(req) ?? null;
    if (body.status && body.status !== existing.status) {
      await storage.createActivity({
        linkedObjectType: "lead",
        linkedObjectId: lid,
        type: "status_change",
        summary: `Status changed from ${existing.status} to ${body.status}`,
        createdBy: userId,
      });
    }
    if (body.ownerUserId !== undefined && body.ownerUserId !== existing.ownerUserId) {
      await storage.createActivity({
        linkedObjectType: "lead",
        linkedObjectId: lid,
        type: "owner_change",
        summary: `Owner changed`,
        createdBy: userId,
      });
    }
    res.json(result);
  });

  app.delete("/api/leads/:id", requirePermission("crm", "edit"), async (req, res) => {
    const deleted = await storage.deleteLead(Number(req.params.id));
    if (!deleted) return res.status(404).json({ message: "Lead not found" });
    res.json({ message: "Deleted" });
  });

  // ── Phase 2: Lead → Organization conversion helpers ─────────────────────
  const PERSONAL_EMAIL_DOMAINS = new Set([
    "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com",
    "live.com", "msn.com", "me.com", "aol.com", "protonmail.com", "ymail.com",
  ]);

  function normalizeWebsiteDomain(raw: string): string {
    try {
      let s = raw.toLowerCase().trim();
      s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
      return s.split("/")[0].split("?")[0].split("#")[0];
    } catch { return raw.toLowerCase().trim(); }
  }

  // GET /api/leads/:id/convert-check — duplicate-detection before conversion
  app.get("/api/leads/:id/convert-check", requirePermission("crm", "view"), async (req, res) => {
    try {
      const lead = await storage.getLead(Number(req.params.id));
      if (!lead) return res.status(404).json({ message: "Lead not found" });

      type MatchEntry = {
        id: number; name: string; city: string | null; stateProvince: string | null;
        orgType: string | null; confidence: "high" | "medium"; reasons: string[];
      };
      const matchMap = new Map<number, MatchEntry>();

      // Signal 1 (strongest): Exact normalized email domain — excludes personal domains
      if (lead.contactEmail) {
        const emailDomain = lead.contactEmail.split("@")[1]?.toLowerCase().trim();
        if (emailDomain && !PERSONAL_EMAIL_DOMAINS.has(emailDomain)) {
          const rows = await db.select().from(accounts)
            .where(ilike(accounts.website, `%${emailDomain}%`))
            .limit(10);
          for (const a of rows) {
            if (!a.website) continue;
            const norm = normalizeWebsiteDomain(a.website);
            if (norm === emailDomain || norm.endsWith(`.${emailDomain}`)) {
              if (!matchMap.has(a.id)) {
                matchMap.set(a.id, { id: a.id, name: a.name, city: a.city, stateProvince: a.stateProvince, orgType: a.orgType, confidence: "high", reasons: [] });
              }
              matchMap.get(a.id)!.confidence = "high";
              matchMap.get(a.id)!.reasons.push(`Exact domain match: ${emailDomain}`);
            }
          }
        }
      }

      // Signal 2 (secondary): Name similarity — word overlap ≥50%
      const companyWords = lead.company.toLowerCase().split(/[\s\-_&/,.()+]+/).filter(w => w.length > 3);
      if (companyWords.length > 0) {
        const searchWord = [...companyWords].sort((a, b) => b.length - a.length)[0];
        const rows = await db.select().from(accounts)
          .where(ilike(accounts.name, `%${searchWord}%`))
          .limit(20);
        for (const a of rows) {
          const accountWords = a.name.toLowerCase().split(/[\s\-_&/,.()+]+/).filter(w => w.length > 3);
          const overlap = companyWords.filter(cw =>
            accountWords.some(aw => aw === cw || aw.includes(cw) || cw.includes(aw))
          ).length;
          const total = Math.max(companyWords.length, accountWords.length, 1);
          const ratio = overlap / total;
          if (ratio >= 0.5) {
            const nameConfidence: "high" | "medium" = ratio >= 0.8 ? "high" : "medium";
            if (!matchMap.has(a.id)) {
              matchMap.set(a.id, { id: a.id, name: a.name, city: a.city, stateProvince: a.stateProvince, orgType: a.orgType, confidence: nameConfidence, reasons: [] });
            } else if (nameConfidence === "high" && matchMap.get(a.id)!.confidence !== "high") {
              matchMap.get(a.id)!.confidence = "high";
            }
            matchMap.get(a.id)!.reasons.push(`Name similarity: "${a.name}"`);
            if (lead.city && a.city && lead.city.toLowerCase() === a.city.toLowerCase()) {
              matchMap.get(a.id)!.reasons.push(`Same city: ${lead.city}`);
            }
          }
        }
      }

      const matches = Array.from(matchMap.values()).sort((a, b) => {
        if (a.confidence === b.confidence) return a.name.localeCompare(b.name);
        return a.confidence === "high" ? -1 : 1;
      });

      // ── Contact duplicate detection ──────────────────────────────────────
      type ContactMatch = {
        id: number; name: string; email: string | null;
        accountId: number | null; accountName?: string | null;
        confidence: "high" | "medium"; reasons: string[];
      };
      const contactMatchMap = new Map<number, ContactMatch>();

      if (lead.contactEmail) {
        const rows = await db.execute(sql.raw(`
          SELECT c.id, c.name, c.email, c.account_id,
                 a.name AS account_name
          FROM contacts c
          LEFT JOIN accounts a ON a.id = c.account_id
          WHERE LOWER(c.email) = LOWER('${lead.contactEmail.replace(/'/g, "''")}')
          LIMIT 5
        `));
        for (const c of rows.rows as any[]) {
          contactMatchMap.set(c.id, {
            id: c.id, name: c.name, email: c.email,
            accountId: c.account_id, accountName: c.account_name,
            confidence: "high", reasons: [`Exact email match: ${lead.contactEmail}`],
          });
        }
      }

      if (lead.contactName && contactMatchMap.size === 0) {
        const nameWords = lead.contactName.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
        const lastName = nameWords[nameWords.length - 1];
        if (lastName) {
          const rows = await db.execute(sql.raw(`
            SELECT c.id, c.name, c.email, c.account_id,
                   a.name AS account_name
            FROM contacts c
            LEFT JOIN accounts a ON a.id = c.account_id
            WHERE LOWER(c.name) LIKE '%${lastName.replace(/'/g, "''")}%'
            LIMIT 15
          `));
          for (const c of rows.rows as any[]) {
            const cWords = (c.name as string).toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
            const overlap = nameWords.filter((nw: string) => cWords.some((cw: string) => cw === nw || cw.includes(nw))).length;
            const ratio = overlap / Math.max(nameWords.length, 1);
            if (ratio >= 0.5 && !contactMatchMap.has(c.id)) {
              contactMatchMap.set(c.id, {
                id: c.id, name: c.name, email: c.email,
                accountId: c.account_id, accountName: c.account_name,
                confidence: "medium", reasons: [`Name similarity: "${c.name}"`],
              });
            }
          }
        }
      }

      const contactMatches = Array.from(contactMatchMap.values())
        .sort((a, b) => (a.confidence === b.confidence ? a.name.localeCompare(b.name) : a.confidence === "high" ? -1 : 1));

      res.json({ matches, contactMatches });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/leads/:id/linked-org — returns the Organization + contact + opportunity this lead was converted to
  app.get("/api/leads/:id/linked-org", requirePermission("crm", "view"), async (req, res) => {
    try {
      const lead = await storage.getLead(Number(req.params.id));
      if (!lead) return res.status(404).json({ message: "Lead not found" });
      if (lead.status !== "converted") return res.json({ account: null, contact: null, opportunity: null });

      // Primary lookup: convertedAccountId on lead (new), fallback: accounts.converted_from_lead_id
      let acct: any = null;
      if ((lead as any).convertedAccountId) {
        const [a] = await db.select().from(accounts).where(eq(accounts.id, (lead as any).convertedAccountId)).limit(1);
        acct = a ?? null;
      }
      if (!acct) {
        const [a] = await db.select().from(accounts)
          .where(eq(accounts.convertedFromLeadId as any, lead.id)).limit(1);
        acct = a ?? null;
      }

      let contact: any = null;
      if ((lead as any).convertedContactId) {
        const rows = await db.execute(sql.raw(`SELECT id, name, email, account_id FROM contacts WHERE id = ${(lead as any).convertedContactId} LIMIT 1`));
        contact = rows.rows[0] ?? null;
      }

      let opportunity: any = null;
      if ((lead as any).convertedOpportunityId) {
        const rows = await db.execute(sql.raw(`SELECT id, title, stage, amount FROM opportunities WHERE id = ${(lead as any).convertedOpportunityId} LIMIT 1`));
        opportunity = rows.rows[0] ?? null;
      }

      res.json({ account: acct, contact, opportunity });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/leads/:id/convert — promote a lead to an Account + Contact + Opportunity
  app.post("/api/leads/:id/convert", requirePermission("crm", "edit"), async (req, res) => {
    try {
      const lead = await storage.getLead(Number(req.params.id));
      if (!lead) return res.status(404).json({ message: "Lead not found" });
      if (lead.status === "converted") return res.status(400).json({ message: "Lead is already converted" });
      if (!lead.company?.trim()) return res.status(400).json({ message: "Cannot convert a lead with no company name" });

      const {
        existingAccountId,
        existingContactId,
        skipContact = false,
        createOpportunity = false,
        opportunityTitle,
        opportunityAmount,
        opportunityStage = "inbound_new",
        orgType = "marina_prospect",
        fieldOverrides = {},
      } = req.body ?? {};

      const userId = getSessionUserId(req) ?? null;
      const priorStatus = lead.status;

      // ── Resolve account ─────────────────────────────────────────────────────
      let account: any;
      const isLinkingAccount = Boolean(existingAccountId);

      if (isLinkingAccount) {
        const [existing] = await db.select().from(accounts).where(eq(accounts.id, Number(existingAccountId))).limit(1);
        if (!existing) return res.status(404).json({ message: "Organization not found" });
        account = existing;
        if (!existing.convertedFromLeadId) {
          await db.update(accounts).set({ convertedFromLeadId: lead.id } as any).where(eq(accounts.id, existing.id));
          account = { ...account, convertedFromLeadId: lead.id };
        }
      } else {
        const accountName = (fieldOverrides.name as string)?.trim() || lead.company;
        account = await storage.createAccount({
          name: accountName,
          segment: (fieldOverrides.segment ?? lead.segment) as any || "marina",
          notes: (fieldOverrides.notes ?? lead.notes) as any,
          tags: lead.tags as any,
          city: (fieldOverrides.city ?? lead.city) as any,
          stateProvince: (fieldOverrides.state ?? lead.state) as any,
          country: (fieldOverrides.country ?? lead.country) as any,
          streetAddress: (fieldOverrides.streetAddress ?? lead.streetAddress) as any,
          postalZip: (fieldOverrides.zipCode ?? lead.zipCode) as any,
          orgType: (fieldOverrides.orgType ?? orgType) as any,
          convertedFromLeadId: lead.id,
          assignedToUserId: lead.ownerUserId as any,
        } as any);
      }

      // ── Resolve contact ──────────────────────────────────────────────────────
      let finalContact: any = null;

      if (!skipContact) {
        if (existingContactId) {
          // Link to existing contact — just retrieve it
          const rows = await db.execute(sql.raw(`SELECT id, name, email, account_id FROM contacts WHERE id = ${Number(existingContactId)} LIMIT 1`));
          finalContact = rows.rows[0] ?? null;
        } else if (lead.contactName) {
          // Create new contact — check for email duplicate first
          const existingContacts = await db.select().from(contacts).where(eq(contacts.accountId, account.id));
          const emailTaken = lead.contactEmail
            ? existingContacts.some(c => c.email?.toLowerCase() === lead.contactEmail!.toLowerCase())
            : false;
          if (!emailTaken) {
            finalContact = await storage.createContact({
              accountId: account.id,
              name: (fieldOverrides.contactName ?? lead.contactName) as string,
              email: (fieldOverrides.contactEmail ?? lead.contactEmail) as string | undefined,
              phone: (fieldOverrides.contactPhone ?? lead.contactPhone) as string | undefined,
            });
          }
        }
      }

      // ── Create opportunity if requested ──────────────────────────────────────
      let newOpportunity: any = null;
      if (createOpportunity) {
        const title = (opportunityTitle as string)?.trim()
          || `${account.name}${lead.primaryValueDriver ? ` — ${lead.primaryValueDriver}` : ""}`;
        newOpportunity = await storage.createOpportunity({
          accountId: account.id,
          contactId: finalContact?.id ?? null,
          title,
          stage: (opportunityStage as string) || "inbound_new",
          amount: opportunityAmount != null ? Number(opportunityAmount) : lead.dealAmount ?? null,
          dealProbability: lead.dealProbability ?? null,
          estCloseDate: lead.estCloseDate ?? null,
          primaryValueDriver: lead.primaryValueDriver ?? null,
          ownerUserId: lead.ownerUserId ?? null,
        } as any);
      }

      // ── Write to migrationMap ────────────────────────────────────────────────
      await db.insert(migrationMap).values({
        legacyTable: "leads",
        legacyRecordId: lead.id,
        newTable: "accounts",
        newRecordId: account.id,
        notes: JSON.stringify({
          action: isLinkingAccount ? "linked" : "created",
          priorStatus,
          leadCompany: lead.company,
          linkedAccountName: account.name,
          contactId: finalContact?.id ?? null,
          opportunityId: newOpportunity?.id ?? null,
        }),
      });

      // ── Update lead — mark converted + store result IDs ──────────────────────
      await db.execute(sql.raw(`
        UPDATE leads SET
          status = 'converted',
          converted_account_id = ${account.id},
          converted_contact_id = ${finalContact?.id ?? "NULL"},
          converted_opportunity_id = ${newOpportunity?.id ?? "NULL"},
          converted_at = NOW(),
          updated_at = NOW()
        WHERE id = ${lead.id}
      `));

      // ── Timeline events: lead_converted on lead + account ────────────────────
      const summaryParts = [`Lead converted → ${account.name}`];
      if (finalContact) summaryParts.push(`Contact: ${finalContact.name}`);
      if (newOpportunity) summaryParts.push(`Opportunity: ${newOpportunity.title}`);
      const conversionSummary = summaryParts.join(" · ");

      await storage.createActivity({
        linkedObjectType: "lead",
        linkedObjectId: lead.id,
        type: "lead_converted",
        summary: conversionSummary,
        createdBy: userId,
      });
      await storage.createActivity({
        linkedObjectType: "account",
        linkedObjectId: account.id,
        type: "lead_converted",
        summary: `New organization created from lead conversion · Lead: ${lead.company}`,
        createdBy: userId,
      });

      // ── Create handoff note on account with lead context ─────────────────────
      if (lead.notes) {
        await storage.createNote({
          linkedObjectType: "account",
          linkedObjectId: account.id,
          authorName: "Lead Conversion",
          content: `**Converted from lead:** ${lead.company}\n\n${lead.notes}`,
        });
      }

      // ── Preserve email linkage (non-fatal) ───────────────────────────────────
      try {
        const threadPatch: Record<string, any> = { primaryAccountId: account.id, updatedAt: new Date() };
        if (finalContact) threadPatch.primaryContactId = finalContact.id;
        await db.update(emailThreads).set(threadPatch).where(eq(emailThreads.primaryLeadId, lead.id));

        const leadAssocs = await db.select().from(emailAssociations)
          .where(and(eq(emailAssociations.objectType, "lead"), eq(emailAssociations.objectId, lead.id)));
        const processed = new Set<number>();
        for (const la of leadAssocs) {
          if (processed.has(la.emailMessageId)) continue;
          processed.add(la.emailMessageId);
          const existingForMsg = await db
            .select({ objectType: emailAssociations.objectType, objectId: emailAssociations.objectId })
            .from(emailAssociations).where(eq(emailAssociations.emailMessageId, la.emailMessageId));
          const existingKeys = new Set(existingForMsg.map(e => `${e.objectType}:${e.objectId}`));
          if (!existingKeys.has(`account:${account.id}`)) {
            await db.insert(emailAssociations).values({
              emailMessageId: la.emailMessageId, objectType: "account", objectId: account.id,
              objectName: account.name, confidenceScore: 100,
              associationReasonJson: JSON.stringify([`Auto-migrated from lead conversion (lead ID ${lead.id})`]),
              isAuto: false, isUserConfirmed: true,
            });
          }
          if (finalContact && !existingKeys.has(`contact:${finalContact.id}`)) {
            await db.insert(emailAssociations).values({
              emailMessageId: la.emailMessageId, objectType: "contact", objectId: finalContact.id,
              objectName: finalContact.name, confidenceScore: 100,
              associationReasonJson: JSON.stringify([`Auto-migrated from lead conversion (lead ID ${lead.id})`]),
              isAuto: false, isUserConfirmed: true,
            });
          }
        }
      } catch (linkErr) {
        console.error("[convert] Email linkage migration error:", linkErr);
      }

      res.json({
        account,
        contact: finalContact,
        opportunity: newOpportunity,
        leadId: lead.id,
        action: isLinkingAccount ? "linked" : "created",
      });
    } catch (err: any) {
      console.error("[convert] Error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/leads/:id/unconvert — revert promotion; preserves Organization
  app.post("/api/leads/:id/unconvert", requirePermission("crm", "edit"), async (req, res) => {
    try {
      const lead = await storage.getLead(Number(req.params.id));
      if (!lead) return res.status(404).json({ message: "Lead not found" });
      if (lead.status !== "converted") return res.status(400).json({ message: "Lead is not in converted status" });

      // Recover prior status from migrationMap notes (written at convert time)
      const RESTORABLE = new Set(["new", "contacted", "meeting_scheduled", "qualified", "proposal_sent", "negotiation", "lost"]);
      const [mapRow] = await db.select().from(migrationMap)
        .where(and(eq(migrationMap.legacyTable, "leads"), eq(migrationMap.legacyRecordId, lead.id)))
        .orderBy(sql`migrated_at desc`)
        .limit(1);

      let restoreStatus = "contacted"; // safe fallback if prior status unavailable
      let priorStatusLabel: string | null = null;
      if (mapRow?.notes) {
        try {
          const parsed = JSON.parse(mapRow.notes);
          if (parsed.priorStatus && RESTORABLE.has(parsed.priorStatus)) {
            restoreStatus = parsed.priorStatus;
            priorStatusLabel = parsed.priorStatus;
          }
        } catch { /* fallback to "contacted" */ }
      }

      await storage.updateLead(lead.id, { status: restoreStatus });

      const auditNote = priorStatusLabel
        ? `Lead unconverted — status restored to "${restoreStatus}" (was "${priorStatusLabel}" before promotion). Organization is preserved and unchanged.`
        : `Lead unconverted — status reset to "${restoreStatus}" (prior status unavailable from audit log). Organization is preserved and unchanged.`;

      await storage.createActivity({
        linkedObjectType: "lead",
        linkedObjectId: lead.id,
        type: "status_change",
        summary: auditNote,
      });

      res.json({ leadId: lead.id, status: restoreStatus, description: auditNote });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/accounts", async (req, res) => {
    const { search, segment, leadStatus, priority, orgType, page, limit, sortBy, sortOrder } = req.query;
    res.json(await storage.getAccounts({
      search: search as string | undefined,
      segment: segment as string | undefined,
      leadStatus: leadStatus as string | undefined,
      priority: priority as string | undefined,
      orgType: orgType as string | undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      sortBy: sortBy as string | undefined,
      sortOrder: sortOrder as string | undefined,
    }));
  });

  // ── GET /api/record-summary/:objectType/:objectId ─────────────────────────
  // Unified record health + activity summary used by RecordSummaryBar.
  // Returns: lastInbound, lastOutbound, lastNote, lastActivity, openTasksCount,
  //   overdueTasksCount, openOppsCount, openOppsValue, contactsCount,
  //   attachmentsCount, healthScore (0-100), healthLabel, healthReasons, warnings.
  //
  // Health model:
  //   Base 100. Deductions by days since last touch (any channel):
  //     0-7d: 0  |  8-14d: -10  |  15-21d: -20  |  22-30d: -30
  //     31-45d: -40  |  46-60d: -50  |  60+d: -60
  //   Inbound warmth:  0-14d: +5  |  31-60d: -10  |  60+d: -20
  //   Overdue tasks:   1: -5  |  2+: -10
  //   Stale open opp (updated_at 30+d, acct/opp only): -10 per (max -20)
  //   Clamped 0–100.  Labels: 80+ Strong | 65+ Active | 50+ Warm | 35+ Cooling | 20+ At Risk | else Stale
  //
  // Warnings (thresholds):
  //   no_outbound_21d  — no outbound email in 21+ days
  //   no_touch_30d     — no touch (any channel) in 30+ days
  //   inbound_stale_45d — last inbound email 45+ days ago
  //   overdue_tasks     — at least one overdue task
  //   stale_opportunity — open opp updated_at 30+ days ago (acct/opp only)

  const SUMMARY_TYPES = ["account", "contact", "opportunity", "lead", "partner"] as const;

  function daysSince(date: string | null | undefined): number | null {
    if (!date) return null;
    const ms = Date.now() - new Date(date).getTime();
    return Math.floor(ms / (1000 * 60 * 60 * 24));
  }

  function computeHealth(
    lastTouchDate: string | null,
    lastInbound: string | null,
    overdueCount: number,
    staleOppCount: number,
  ): { score: number; label: string; reasons: string[]; warnings: Array<{ type: string; message: string }> } {
    let score = 100;
    const reasons: string[] = [];
    const warnings: Array<{ type: string; message: string }> = [];

    const touchDays = daysSince(lastTouchDate);
    const inboundDays = daysSince(lastInbound);

    // Touch recency deductions
    if (touchDays === null) {
      score -= 50;
      reasons.push("No recorded interactions");
    } else if (touchDays <= 7) {
      reasons.push(`Touched ${touchDays}d ago`);
    } else if (touchDays <= 14) { score -= 10; reasons.push(`Last touch ${touchDays}d ago`); }
    else if (touchDays <= 21) { score -= 20; reasons.push(`Last touch ${touchDays}d ago`); }
    else if (touchDays <= 30) { score -= 30; reasons.push(`Last touch ${touchDays}d ago`); }
    else if (touchDays <= 45) { score -= 40; reasons.push(`Last touch ${touchDays}d ago`); }
    else if (touchDays <= 60) { score -= 50; reasons.push(`Last touch ${touchDays}d ago`); }
    else { score -= 60; reasons.push(`Last touch ${touchDays}d ago — no recent contact`); }

    if (touchDays !== null && touchDays >= 30) {
      warnings.push({ type: "no_touch_30d", message: `No touch in ${touchDays} days` });
    }

    // Inbound email warmth
    if (inboundDays !== null) {
      if (inboundDays <= 14) { score += 5; reasons.push("Recent inbound email"); }
      else if (inboundDays >= 31 && inboundDays <= 60) { score -= 10; }
      else if (inboundDays > 60) { score -= 20; reasons.push(`Inbound email ${inboundDays}d ago`); }
      if (inboundDays >= 45) {
        warnings.push({ type: "inbound_stale_45d", message: `Last inbound email ${inboundDays} days ago` });
      }
    }

    // Overdue tasks
    if (overdueCount === 1) { score -= 5; reasons.push("1 overdue task"); warnings.push({ type: "overdue_tasks", message: "1 overdue task" }); }
    else if (overdueCount >= 2) { score -= 10; reasons.push(`${overdueCount} overdue tasks`); warnings.push({ type: "overdue_tasks", message: `${overdueCount} overdue tasks` }); }

    // Stale opportunities
    const staleApplied = Math.min(staleOppCount, 2);
    if (staleApplied > 0) {
      score -= staleApplied * 10;
      reasons.push(`${staleApplied} open deal${staleApplied > 1 ? "s" : ""} with no recent activity`);
      warnings.push({ type: "stale_opportunity", message: `${staleApplied} open opportunity${staleApplied > 1 ? "ies" : "y"} without activity in 30+ days` });
    }

    score = Math.max(0, Math.min(100, score));
    const label =
      score >= 80 ? "Strong" :
      score >= 65 ? "Active" :
      score >= 50 ? "Warm" :
      score >= 35 ? "Cooling" :
      score >= 20 ? "At Risk" : "Stale";

    return { score, label, reasons, warnings };
  }

  app.get("/api/record-summary/:objectType/:objectId", requirePermission("crm", "view"), async (req, res) => {
    const { objectType, objectId: objectIdStr } = req.params;
    if (!SUMMARY_TYPES.includes(objectType as any)) {
      return res.status(400).json({ message: `Invalid objectType. Must be one of: ${SUMMARY_TYPES.join(", ")}` });
    }
    const objectId = Number(objectIdStr);
    if (!Number.isInteger(objectId) || objectId <= 0) {
      return res.status(400).json({ message: "objectId must be a positive integer" });
    }

    try {
      // ── Per-type query strategy ───────────────────────────────────────────
      let emailAccountId: number | null = null;
      let contactEmail: string | null = null;
      let opportunityAccountId: number | null = null;
      let opportunityUpdatedAt: string | null = null;

      if (objectType === "account") {
        const { rows } = await db.execute(sql.raw(`SELECT id FROM accounts WHERE id = ${objectId} LIMIT 1`));
        if (!rows.length) return res.status(404).json({ message: "Account not found" });
        emailAccountId = objectId;
      } else if (objectType === "contact") {
        const { rows } = await db.execute(sql.raw(`SELECT id, email FROM contacts WHERE id = ${objectId} LIMIT 1`));
        if (!rows.length) return res.status(404).json({ message: "Contact not found" });
        contactEmail = (rows[0] as any).email ?? null;
      } else if (objectType === "opportunity") {
        const { rows } = await db.execute(sql.raw(`SELECT id, account_id, updated_at FROM opportunities WHERE id = ${objectId} LIMIT 1`));
        if (!rows.length) return res.status(404).json({ message: "Opportunity not found" });
        opportunityAccountId = (rows[0] as any).account_id ?? null;
        opportunityUpdatedAt = (rows[0] as any).updated_at ?? null;
      } else if (objectType === "lead") {
        const { rows } = await db.execute(sql.raw(`SELECT id FROM leads WHERE id = ${objectId} LIMIT 1`));
        if (!rows.length) return res.status(404).json({ message: "Lead not found" });
      } else if (objectType === "partner") {
        const { rows } = await db.execute(sql.raw(`SELECT id FROM partnerships WHERE id = ${objectId} LIMIT 1`));
        if (!rows.length) return res.status(404).json({ message: "Partner not found" });
      }

      // ── Build email query ─────────────────────────────────────────────────
      let emailQuery: string | null = null;
      if (objectType === "account" && emailAccountId) {
        emailQuery = `SELECT direction, MAX(sent_at) as last_date FROM email_messages WHERE source_account_id = ${emailAccountId} GROUP BY direction`;
      } else if (objectType === "contact" && contactEmail) {
        const safeEmail = contactEmail.replace(/'/g, "''");
        emailQuery = `SELECT direction, MAX(sent_at) as last_date FROM email_messages WHERE from_email = '${safeEmail}' OR all_participants ILIKE '%${safeEmail}%' GROUP BY direction`;
      } else if (objectType === "opportunity" && opportunityAccountId) {
        emailQuery = `SELECT direction, MAX(sent_at) as last_date FROM email_messages WHERE source_account_id = ${opportunityAccountId} GROUP BY direction`;
      } else if (objectType === "partner") {
        emailQuery = `SELECT direction, MAX(sent_at) as last_date FROM email_associations ea JOIN email_messages em ON ea.email_message_id = em.id WHERE ea.object_type = 'partner' AND ea.object_id = ${objectId} GROUP BY em.direction`;
      }

      // ── Parallel queries ──────────────────────────────────────────────────
      const linkedType = objectType === "partner" ? "partner" : objectType;
      const linkedId = objectId;

      const [emailRows, noteRow, activityRow, taskRow, oppRow, contactCountRow, attachRow, staleOppRow] =
        await Promise.all([
          emailQuery ? db.execute(sql.raw(emailQuery)) : Promise.resolve({ rows: [] }),
          db.execute(sql.raw(`SELECT MAX(created_at) as last_date FROM notes WHERE linked_object_type = '${linkedType}' AND linked_object_id = ${linkedId}`)),
          db.execute(sql.raw(`SELECT MAX(created_at) as last_date FROM activities WHERE linked_object_type = '${linkedType}' AND linked_object_id = ${linkedId}${objectType === "contact" ? ` OR contact_id = ${linkedId}` : ""}`)),
          // open tasks + overdue tasks
          objectType === "account"
            ? db.execute(sql.raw(`SELECT COUNT(*) FILTER (WHERE status != 'done') as open_count, COUNT(*) FILTER (WHERE status != 'done' AND due_date < NOW()) as overdue_count FROM (SELECT DISTINCT id, status, due_date FROM tasks WHERE account_id = ${linkedId} OR (linked_object_type = 'account' AND linked_object_id = ${linkedId})) t`))
            : db.execute(sql.raw(`SELECT COUNT(*) FILTER (WHERE status != 'done') as open_count, COUNT(*) FILTER (WHERE status != 'done' AND due_date < NOW()) as overdue_count FROM tasks WHERE linked_object_type = '${linkedType}' AND linked_object_id = ${linkedId}`)),
          // open opportunities count + value
          objectType === "account"
            ? db.execute(sql.raw(`SELECT COUNT(*) FILTER (WHERE stage NOT IN ('closed_won','closed_lost')) as open_count, COALESCE(SUM(amount) FILTER (WHERE stage NOT IN ('closed_won','closed_lost')), 0) as open_value FROM opportunities WHERE account_id = ${linkedId}`))
            : objectType === "contact"
              ? db.execute(sql.raw(`SELECT COUNT(*) FILTER (WHERE o.stage NOT IN ('closed_won','closed_lost')) as open_count, COALESCE(SUM(o.amount) FILTER (WHERE o.stage NOT IN ('closed_won','closed_lost')), 0) as open_value FROM opportunities o LEFT JOIN opportunity_contacts oc ON o.id = oc.opportunity_id WHERE oc.contact_id = ${linkedId} OR o.contact_id = ${linkedId}`))
              : Promise.resolve({ rows: [{ open_count: 0, open_value: 0 }] }),
          // contacts count (account only)
          objectType === "account"
            ? db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM contacts WHERE account_id = ${linkedId}`))
            : Promise.resolve({ rows: [{ cnt: 0 }] }),
          // attachments count (attachments table uses object_type/object_id, not linked_object_*)
          db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM attachments WHERE object_type = '${linkedType}' AND object_id = ${linkedId}`)),
          // stale open opportunities (updated_at 30+ days ago) — account or opportunity
          objectType === "account"
            ? db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM opportunities WHERE account_id = ${linkedId} AND stage NOT IN ('closed_won','closed_lost') AND updated_at < NOW() - INTERVAL '30 days'`))
            : objectType === "opportunity"
              ? Promise.resolve({ rows: [{ cnt: opportunityUpdatedAt && daysSince(opportunityUpdatedAt)! >= 30 ? 1 : 0 }] })
              : Promise.resolve({ rows: [{ cnt: 0 }] }),
        ]);

      const emailData = emailRows.rows as any[];
      const lastInbound = emailData.find((r: any) => r.direction === "inbound")?.last_date ?? null;
      const lastOutbound = emailData.find((r: any) => r.direction === "outbound")?.last_date ?? null;
      const lastNote = (noteRow.rows[0] as any)?.last_date ?? null;
      const lastActivity = (activityRow.rows[0] as any)?.last_date ?? null;
      const openTasksCount = Number((taskRow.rows[0] as any)?.open_count ?? 0);
      const overdueTasksCount = Number((taskRow.rows[0] as any)?.overdue_count ?? 0);
      const openOppsCount = Number((oppRow.rows[0] as any)?.open_count ?? 0);
      const openOppsValue = Number((oppRow.rows[0] as any)?.open_value ?? 0);
      const contactsCount = Number((contactCountRow.rows[0] as any)?.cnt ?? 0);
      const attachmentsCount = Number((attachRow.rows[0] as any)?.cnt ?? 0);
      const staleOppCount = Number((staleOppRow.rows[0] as any)?.cnt ?? 0);

      // Last touch = most recent across all channels
      const allDates = [lastInbound, lastOutbound, lastNote, lastActivity].filter(Boolean) as string[];
      const lastTouchDate = allDates.length ? allDates.reduce((a, b) => (new Date(a) > new Date(b) ? a : b)) : null;

      // Outbound warning — find last outbound specifically
      const outboundDays = daysSince(lastOutbound);

      const { score, label, reasons, warnings } = computeHealth(lastTouchDate, lastInbound, overdueTasksCount, staleOppCount);

      if (outboundDays !== null && outboundDays >= 21 && !warnings.find(w => w.type === "no_outbound_21d")) {
        warnings.push({ type: "no_outbound_21d", message: `No outbound email in ${outboundDays} days` });
      } else if (outboundDays === null && !warnings.find(w => w.type === "no_outbound_21d")) {
        warnings.push({ type: "no_outbound_21d", message: "No outbound email recorded" });
      }

      res.json({
        objectType,
        objectId,
        lastInboundEmail: lastInbound,
        lastOutboundEmail: lastOutbound,
        lastNote,
        lastActivity,
        lastTouch: lastTouchDate,
        openTasksCount,
        overdueTasksCount,
        openOppsCount,
        openOppsValue,
        contactsCount,
        attachmentsCount,
        healthScore: score,
        healthLabel: label,
        healthReasons: reasons,
        warnings,
      });
    } catch (err: any) {
      console.error("record-summary error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Signal-Driven Task Suggestions ────────────────────────────────────────
  // Helper: fetch the same signal-input data as record-summary, for any record.
  async function buildSignalInput(objectType: string, objectId: number): Promise<{
    found: boolean;
    lastInboundEmail: string | null;
    lastOutboundEmail: string | null;
    lastNote: string | null;
    lastActivity: string | null;
    lastTouch: string | null;
    openTasksCount: number;
    overdueTasksCount: number;
    openOppsCount: number;
    openOppsValue: number;
    staleOppsCount: number;
    healthScore: number;
    healthLabel: string;
  }> {
    let emailAccountId: number | null = null;
    let contactEmail: string | null = null;
    let opportunityAccountId: number | null = null;
    let opportunityUpdatedAt: string | null = null;

    if (objectType === "account") {
      const { rows } = await db.execute(sql.raw(`SELECT id FROM accounts WHERE id = ${objectId} LIMIT 1`));
      if (!rows.length) return { found: false, lastInboundEmail: null, lastOutboundEmail: null, lastNote: null, lastActivity: null, lastTouch: null, openTasksCount: 0, overdueTasksCount: 0, openOppsCount: 0, openOppsValue: 0, staleOppsCount: 0, healthScore: 0, healthLabel: "Stale" };
      emailAccountId = objectId;
    } else if (objectType === "contact") {
      const { rows } = await db.execute(sql.raw(`SELECT id, email FROM contacts WHERE id = ${objectId} LIMIT 1`));
      if (!rows.length) return { found: false, lastInboundEmail: null, lastOutboundEmail: null, lastNote: null, lastActivity: null, lastTouch: null, openTasksCount: 0, overdueTasksCount: 0, openOppsCount: 0, openOppsValue: 0, staleOppsCount: 0, healthScore: 0, healthLabel: "Stale" };
      contactEmail = (rows[0] as any).email ?? null;
    } else if (objectType === "opportunity") {
      const { rows } = await db.execute(sql.raw(`SELECT id, account_id, updated_at FROM opportunities WHERE id = ${objectId} LIMIT 1`));
      if (!rows.length) return { found: false, lastInboundEmail: null, lastOutboundEmail: null, lastNote: null, lastActivity: null, lastTouch: null, openTasksCount: 0, overdueTasksCount: 0, openOppsCount: 0, openOppsValue: 0, staleOppsCount: 0, healthScore: 0, healthLabel: "Stale" };
      opportunityAccountId = (rows[0] as any).account_id ?? null;
      opportunityUpdatedAt = (rows[0] as any).updated_at ?? null;
    } else if (objectType === "lead") {
      const { rows } = await db.execute(sql.raw(`SELECT id FROM leads WHERE id = ${objectId} LIMIT 1`));
      if (!rows.length) return { found: false, lastInboundEmail: null, lastOutboundEmail: null, lastNote: null, lastActivity: null, lastTouch: null, openTasksCount: 0, overdueTasksCount: 0, openOppsCount: 0, openOppsValue: 0, staleOppsCount: 0, healthScore: 0, healthLabel: "Stale" };
    } else if (objectType === "partner") {
      const { rows } = await db.execute(sql.raw(`SELECT id FROM partnerships WHERE id = ${objectId} LIMIT 1`));
      if (!rows.length) return { found: false, lastInboundEmail: null, lastOutboundEmail: null, lastNote: null, lastActivity: null, lastTouch: null, openTasksCount: 0, overdueTasksCount: 0, openOppsCount: 0, openOppsValue: 0, staleOppsCount: 0, healthScore: 0, healthLabel: "Stale" };
    }

    let emailQuery: string | null = null;
    if (objectType === "account" && emailAccountId) {
      emailQuery = `SELECT direction, MAX(sent_at) as last_date FROM email_messages WHERE source_account_id = ${emailAccountId} GROUP BY direction`;
    } else if (objectType === "contact" && contactEmail) {
      const safeEmail = contactEmail.replace(/'/g, "''");
      emailQuery = `SELECT direction, MAX(sent_at) as last_date FROM email_messages WHERE from_email = '${safeEmail}' OR all_participants ILIKE '%${safeEmail}%' GROUP BY direction`;
    } else if (objectType === "opportunity" && opportunityAccountId) {
      emailQuery = `SELECT direction, MAX(sent_at) as last_date FROM email_messages WHERE source_account_id = ${opportunityAccountId} GROUP BY direction`;
    } else if (objectType === "partner") {
      emailQuery = `SELECT direction, MAX(sent_at) as last_date FROM email_associations ea JOIN email_messages em ON ea.email_message_id = em.id WHERE ea.object_type = 'partner' AND ea.object_id = ${objectId} GROUP BY em.direction`;
    }

    const linkedType = objectType === "partner" ? "partner" : objectType;
    const daysSinceLocal = (date: string | null | undefined): number | null => {
      if (!date) return null;
      return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
    };

    const [emailRows, noteRow, activityRow, taskRow, oppRow, staleOppRow] = await Promise.all([
      emailQuery ? db.execute(sql.raw(emailQuery)) : Promise.resolve({ rows: [] }),
      db.execute(sql.raw(`SELECT MAX(created_at) as last_date FROM notes WHERE linked_object_type = '${linkedType}' AND linked_object_id = ${objectId}`)),
      db.execute(sql.raw(`SELECT MAX(created_at) as last_date FROM activities WHERE linked_object_type = '${linkedType}' AND linked_object_id = ${objectId}${objectType === "contact" ? ` OR contact_id = ${objectId}` : ""}`)),
      objectType === "account"
        ? db.execute(sql.raw(`SELECT COUNT(*) FILTER (WHERE status != 'done') as open_count, COUNT(*) FILTER (WHERE status != 'done' AND due_date < NOW()) as overdue_count FROM (SELECT DISTINCT id, status, due_date FROM tasks WHERE account_id = ${objectId} OR (linked_object_type = 'account' AND linked_object_id = ${objectId})) t`))
        : db.execute(sql.raw(`SELECT COUNT(*) FILTER (WHERE status != 'done') as open_count, COUNT(*) FILTER (WHERE status != 'done' AND due_date < NOW()) as overdue_count FROM tasks WHERE linked_object_type = '${linkedType}' AND linked_object_id = ${objectId}`)),
      objectType === "account"
        ? db.execute(sql.raw(`SELECT COUNT(*) FILTER (WHERE stage NOT IN ('closed_won','closed_lost')) as open_count, COALESCE(SUM(amount) FILTER (WHERE stage NOT IN ('closed_won','closed_lost')), 0) as open_value FROM opportunities WHERE account_id = ${objectId}`))
        : objectType === "contact"
          ? db.execute(sql.raw(`SELECT COUNT(*) FILTER (WHERE o.stage NOT IN ('closed_won','closed_lost')) as open_count, COALESCE(SUM(o.amount) FILTER (WHERE o.stage NOT IN ('closed_won','closed_lost')), 0) as open_value FROM opportunities o LEFT JOIN opportunity_contacts oc ON o.id = oc.opportunity_id WHERE oc.contact_id = ${objectId} OR o.contact_id = ${objectId}`))
          : Promise.resolve({ rows: [{ open_count: 0, open_value: 0 }] }),
      objectType === "account"
        ? db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM opportunities WHERE account_id = ${objectId} AND stage NOT IN ('closed_won','closed_lost') AND updated_at < NOW() - INTERVAL '30 days'`))
        : objectType === "opportunity"
          ? Promise.resolve({ rows: [{ cnt: opportunityUpdatedAt && daysSinceLocal(opportunityUpdatedAt) !== null && daysSinceLocal(opportunityUpdatedAt)! >= 30 ? 1 : 0 }] })
          : Promise.resolve({ rows: [{ cnt: 0 }] }),
    ]);

    const emailData = emailRows.rows as any[];
    const lastInboundEmail = emailData.find((r: any) => r.direction === "inbound")?.last_date ?? null;
    const lastOutboundEmail = emailData.find((r: any) => r.direction === "outbound")?.last_date ?? null;
    const lastNote = (noteRow.rows[0] as any)?.last_date ?? null;
    const lastActivity = (activityRow.rows[0] as any)?.last_date ?? null;
    const openTasksCount = Number((taskRow.rows[0] as any)?.open_count ?? 0);
    const overdueTasksCount = Number((taskRow.rows[0] as any)?.overdue_count ?? 0);
    const openOppsCount = Number((oppRow.rows[0] as any)?.open_count ?? 0);
    const openOppsValue = Number((oppRow.rows[0] as any)?.open_value ?? 0);
    const staleOppsCount = Number((staleOppRow.rows[0] as any)?.cnt ?? 0);

    const allDates = [lastInboundEmail, lastOutboundEmail, lastNote, lastActivity].filter(Boolean) as string[];
    const lastTouch = allDates.length ? allDates.reduce((a, b) => (new Date(a) > new Date(b) ? a : b)) : null;

    const { score, label } = computeHealth(lastTouch, lastInboundEmail, overdueTasksCount, staleOppsCount);

    return {
      found: true,
      lastInboundEmail,
      lastOutboundEmail,
      lastNote,
      lastActivity,
      lastTouch,
      openTasksCount,
      overdueTasksCount,
      openOppsCount,
      openOppsValue,
      staleOppsCount,
      healthScore: score,
      healthLabel: label,
    };
  }

  app.get("/api/suggestions/:objectType/:objectId", requirePermission("crm", "view"), async (req, res) => {
    const { objectType, objectId: objectIdStr } = req.params;
    if (!SUMMARY_TYPES.includes(objectType as any)) {
      return res.status(400).json({ message: `Invalid objectType. Must be one of: ${SUMMARY_TYPES.join(", ")}` });
    }
    const objectId = Number(objectIdStr);
    if (!Number.isInteger(objectId) || objectId <= 0) {
      return res.status(400).json({ message: "objectId must be a positive integer" });
    }

    try {
      const data = await buildSignalInput(objectType, objectId);
      if (!data.found) return res.status(404).json({ message: "Record not found" });

      const signals = computeSignals({
        objectType: objectType as any,
        objectId,
        lastInboundEmail: data.lastInboundEmail ? String(data.lastInboundEmail) : null,
        lastOutboundEmail: data.lastOutboundEmail ? String(data.lastOutboundEmail) : null,
        lastNote: data.lastNote ? String(data.lastNote) : null,
        lastActivity: data.lastActivity ? String(data.lastActivity) : null,
        lastTouch: data.lastTouch ? String(data.lastTouch) : null,
        openTasksCount: data.openTasksCount,
        overdueTasksCount: data.overdueTasksCount,
        openOppsCount: data.openOppsCount,
        openOppsValue: data.openOppsValue,
        staleOppsCount: data.staleOppsCount,
        healthScore: data.healthScore,
        healthLabel: data.healthLabel,
      });

      // Fetch existing suggestion records for this object
      const { rows: existingRows } = await db.execute(sql.raw(
        `SELECT * FROM task_suggestions WHERE object_type = '${objectType}' AND object_id = ${objectId}`
      ));
      const existing = existingRows as any[];
      const now = new Date();

      // Build final list: for each signal, find/create a DB record and check suppression
      const DISMISSED_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
      const ACCEPTED_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;
      const results: any[] = [];

      for (const signal of signals) {
        const ext = existing.find((r: any) => r.signal_type === signal.signalType);

        if (ext) {
          // Check suppression
          if (ext.status === "dismissed" && ext.dismissed_at) {
            const cooldownEnd = new Date(ext.dismissed_at).getTime() + DISMISSED_COOLDOWN_MS;
            if (now.getTime() < cooldownEnd) continue;
          }
          if (ext.status === "accepted" && ext.accepted_at) {
            const cooldownEnd = new Date(ext.accepted_at).getTime() + ACCEPTED_COOLDOWN_MS;
            if (now.getTime() < cooldownEnd) continue;
          }
          if (ext.status === "snoozed" && ext.snoozed_until) {
            if (now.getTime() < new Date(ext.snoozed_until).getTime()) continue;
          }

          // Cooldown expired — reset to pending and refresh content
          if (ext.status !== "pending") {
            const safeTitle = signal.title.replace(/'/g, "''");
            const safeReason = signal.reason.replace(/'/g, "''");
            const safeLabel = signal.suggestedActionLabel.replace(/'/g, "''");
            const dueDateMs = now.getTime() + signal.suggestedDueDays * 24 * 60 * 60 * 1000;
            const dueDateStr = new Date(dueDateMs).toISOString();
            await db.execute(sql.raw(
              `UPDATE task_suggestions SET status = 'pending', dismissed_at = NULL, accepted_at = NULL, snoozed_until = NULL,
               title = '${safeTitle}', reason = '${safeReason}', severity = '${signal.severity}',
               suggested_action_type = '${signal.suggestedActionType}', suggested_action_label = '${safeLabel}',
               priority = '${signal.priority}', suggested_due_date = '${dueDateStr}', updated_at = NOW()
               WHERE id = ${ext.id}`
            ));
            results.push({ ...ext, status: "pending", ...signal, id: ext.id, suggested_due_date: dueDateStr });
          } else {
            results.push(ext);
          }
        } else {
          // Insert new suggestion
          const safeTitle = signal.title.replace(/'/g, "''");
          const safeReason = signal.reason.replace(/'/g, "''");
          const safeLabel = signal.suggestedActionLabel.replace(/'/g, "''");
          const dueDateMs = now.getTime() + signal.suggestedDueDays * 24 * 60 * 60 * 1000;
          const dueDateStr = new Date(dueDateMs).toISOString();
          const { rows: inserted } = await db.execute(sql.raw(
            `INSERT INTO task_suggestions (object_type, object_id, signal_type, severity, title, reason,
             suggested_action_type, suggested_action_label, priority, suggested_due_date, status)
             VALUES ('${objectType}', ${objectId}, '${signal.signalType}', '${signal.severity}',
             '${safeTitle}', '${safeReason}', '${signal.suggestedActionType}', '${safeLabel}',
             '${signal.priority}', '${dueDateStr}', 'pending') RETURNING *`
          ));
          results.push(inserted[0]);
        }
      }

      // Sort by severity (high > medium > low) and return top 3
      const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
      results.sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3));

      res.json(results.slice(0, 3).map((r) => ({
        id: r.id,
        objectType: r.object_type ?? objectType,
        objectId: r.object_id ?? objectId,
        signalType: r.signal_type ?? r.signalType,
        severity: r.severity,
        title: r.title,
        reason: r.reason,
        suggestedActionType: r.suggested_action_type ?? r.suggestedActionType,
        suggestedActionLabel: r.suggested_action_label ?? r.suggestedActionLabel,
        priority: r.priority,
        suggestedDueDate: r.suggested_due_date ?? r.suggestedDueDate ?? null,
        status: "pending",
      })));
    } catch (err: any) {
      console.error("suggestions error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/suggestions/:id/accept", requirePermission("crm", "edit"), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid suggestion id" });
    const userId = getSessionUserId(req);
    const createTask = req.body?.createTask !== false;

    try {
      const { rows } = await db.execute(sql.raw(`SELECT * FROM task_suggestions WHERE id = ${id} LIMIT 1`));
      if (!rows.length) return res.status(404).json({ message: "Suggestion not found" });
      const suggestion = rows[0] as any;

      let taskId: number | null = null;
      if (createTask) {
        const safeTitle = suggestion.title.replace(/'/g, "''");
        const safeDesc = `Auto-created from signal: ${suggestion.signal_type}`.replace(/'/g, "''");
        const dueDate = suggestion.suggested_due_date ?? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
        const { rows: taskRows } = await db.execute(sql.raw(
          `INSERT INTO tasks (linked_object_type, linked_object_id, owner_user_id, created_by_user_id, title, description, due_date, status, priority, ai_suggested)
           VALUES ('${suggestion.object_type}', ${suggestion.object_id}, ${userId ?? "NULL"}, ${userId ?? "NULL"}, '${safeTitle}', '${safeDesc}', '${dueDate}', 'pending', '${suggestion.priority}', true)
           RETURNING id`
        ));
        taskId = (taskRows[0] as any)?.id ?? null;
      }

      const taskIdClause = taskId ? `, created_task_id = ${taskId}` : "";
      await db.execute(sql.raw(
        `UPDATE task_suggestions SET status = 'accepted', accepted_at = NOW()${taskIdClause}, updated_at = NOW() WHERE id = ${id}`
      ));

      res.json({ success: true, taskCreated: createTask && taskId !== null, taskId });
    } catch (err: any) {
      console.error("suggestions accept error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/suggestions/:id/dismiss", requirePermission("crm", "view"), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid suggestion id" });

    try {
      const { rows } = await db.execute(sql.raw(`SELECT id FROM task_suggestions WHERE id = ${id} LIMIT 1`));
      if (!rows.length) return res.status(404).json({ message: "Suggestion not found" });

      await db.execute(sql.raw(
        `UPDATE task_suggestions SET status = 'dismissed', dismissed_at = NOW(), updated_at = NOW() WHERE id = ${id}`
      ));
      res.json({ success: true });
    } catch (err: any) {
      console.error("suggestions dismiss error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/suggestions/:id/snooze", requirePermission("crm", "view"), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid suggestion id" });
    const days = Number(req.body?.days ?? 3);
    if (!Number.isInteger(days) || days < 1 || days > 90) return res.status(400).json({ message: "days must be 1–90" });

    try {
      const { rows } = await db.execute(sql.raw(`SELECT id FROM task_suggestions WHERE id = ${id} LIMIT 1`));
      if (!rows.length) return res.status(404).json({ message: "Suggestion not found" });

      const snoozedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      await db.execute(sql.raw(
        `UPDATE task_suggestions SET status = 'snoozed', snoozed_until = '${snoozedUntil}', updated_at = NOW() WHERE id = ${id}`
      ));
      res.json({ success: true, snoozedUntil });
    } catch (err: any) {
      console.error("suggestions snooze error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ── End Task Suggestions ───────────────────────────────────────────────────

  app.get("/api/accounts/:id/profile", requirePermission("crm", "view"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const [accountRows, contactRows, oppRows, emailRows, meetingRows, noteRows, taskRows] = await Promise.all([
        db.execute(sql.raw(`
          SELECT a.*, u.name as assigned_user_name
          FROM accounts a
          LEFT JOIN users u ON a.assigned_to_user_id = u.id
          WHERE a.id = ${id} LIMIT 1
        `)),
        db.execute(sql.raw(`
          SELECT id, name, title, email, phone, role_type, is_primary, relationship_strength
          FROM contacts WHERE account_id = ${id}
          ORDER BY is_primary DESC NULLS LAST, name ASC LIMIT 20
        `)),
        db.execute(sql.raw(`
          SELECT o.id, o.title, o.stage, o.amount, o.est_close_date, o.next_step, o.owner_user_id,
                 u.name as owner_name
          FROM opportunities o
          LEFT JOIN users u ON o.owner_user_id = u.id
          WHERE o.account_id = ${id}
          ORDER BY o.updated_at DESC LIMIT 10
        `)),
        db.execute(sql.raw(`
          SELECT id, subject, from_email, from_name, direction, snippet, sent_at
          FROM email_messages
          WHERE source_account_id = ${id}
          ORDER BY sent_at DESC LIMIT 8
        `)),
        db.execute(sql.raw(`
          SELECT id, title, event_type, start_time, end_time, location, meeting_url, status
          FROM calendar_events
          WHERE (linked_object_type = 'account' AND linked_object_id = ${id})
             OR (linked_object_type = 'opportunity' AND linked_object_id IN (
                   SELECT id FROM opportunities WHERE account_id = ${id}
                 ))
          ORDER BY start_time DESC LIMIT 8
        `)),
        db.execute(sql.raw(`
          SELECT id, content, author_name, created_at, updated_at, is_pinned
          FROM notes WHERE linked_object_type = 'account' AND linked_object_id = ${id}
          ORDER BY is_pinned DESC, created_at DESC LIMIT 15
        `)),
        db.execute(sql.raw(`
          SELECT id, title, status, priority, due_date, owner_user_id
          FROM (
            SELECT DISTINCT id, title, status, priority, due_date, owner_user_id
            FROM tasks
            WHERE account_id = ${id}
               OR (linked_object_type = 'account' AND linked_object_id = ${id})
          ) dedup
          ORDER BY CASE WHEN status != 'done' THEN 0 ELSE 1 END, due_date ASC NULLS LAST
          LIMIT 10
        `)),
      ]);
      if (!accountRows.rows.length) return res.status(404).json({ message: "Account not found" });
      const account = accountRows.rows[0];
      const opps = oppRows.rows as any[];
      const hasOverdueTasks = (taskRows.rows as any[]).some((t: any) => t.status !== 'done' && t.due_date && new Date(t.due_date) < new Date());
      const openOpps = opps.filter((o: any) => !['closed_won','closed_lost'].includes(o.stage));
      let suggestedAction = "Schedule a discovery call to understand current needs";
      if (hasOverdueTasks) suggestedAction = "Complete overdue tasks to keep this account moving";
      else if (openOpps.some((o: any) => o.stage === 'proposal')) suggestedAction = "Follow up on open proposal — close or re-qualify";
      else if (openOpps.length === 0) suggestedAction = "Explore new opportunity — no active deals in pipeline";
      else if (!account.next_action) suggestedAction = "Set a next action to maintain momentum";
      res.json({
        account,
        contacts: contactRows.rows,
        opportunities: opps,
        emails: emailRows.rows,
        meetings: meetingRows.rows,
        notes: noteRows.rows,
        tasks: taskRows.rows,
        suggestedAction,
      });
    } catch (e: any) {
      console.error("Account profile error:", e);
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/accounts/:id", async (req, res) => {
    const account = await storage.getAccount(Number(req.params.id));
    if (!account) return res.status(404).json({ message: "Account not found" });
    res.json(account);
  });

  app.post("/api/accounts", requirePermission("crm", "edit"), async (req, res) => {
    const parsed = insertAccountSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createAccount(parsed.data));
  });

  app.put("/api/accounts/:id", requirePermission("crm", "edit"), async (req, res) => {
    const result = await storage.updateAccount(Number(req.params.id), req.body);
    if (!result) return res.status(404).json({ message: "Account not found" });
    res.json(result);
  });

  app.delete("/api/accounts/:id", requirePermission("crm", "edit"), async (req, res) => {
    try {
      const account = await storage.getAccount(Number(req.params.id));
      if (!account) return res.status(404).json({ message: "Account not found" });
      const deleted = await storage.deleteAccount(Number(req.params.id));
      if (!deleted) return res.status(500).json({ message: "Failed to delete account" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/accounts/:id/infrastructure", async (req, res) => {
    const profile = await storage.getInfrastructureProfile(Number(req.params.id));
    res.json(profile || null);
  });

  app.put("/api/accounts/:id/infrastructure", requirePermission("crm", "edit"), async (req, res) => {
    const accountId = Number(req.params.id);
    const account = await storage.getAccount(accountId);
    if (!account) return res.status(404).json({ message: "Account not found" });
    const { id, accountId: _aid, createdAt, updatedAt, ...rest } = req.body;
    const parsed = insertInfrastructureProfileSchema.partial().safeParse(rest);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    const result = await storage.upsertInfrastructureProfile(accountId, parsed.data);
    res.json(result);
  });

  // GET /api/accounts/:id/source-lead — read-only; returns source lead + full conversion history
  app.get("/api/accounts/:id/source-lead", requirePermission("crm", "view"), async (req, res) => {
    try {
      const account = await storage.getAccount(Number(req.params.id));
      if (!account) return res.status(404).json({ message: "Account not found" });
      const fromLeadId = (account as any).convertedFromLeadId as number | null | undefined;
      if (!fromLeadId) return res.json({ lead: null, history: [] });
      const lead = await storage.getLead(fromLeadId);
      const history = await db.select().from(migrationMap)
        .where(and(eq(migrationMap.legacyTable, "leads"), eq(migrationMap.legacyRecordId, fromLeadId)))
        .orderBy(sql`migrated_at desc`);
      res.json({ lead: lead ?? null, history });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/contacts", async (req, res) => {
    const { accountId, search } = req.query;
    res.json(await storage.getContacts({
      accountId: accountId ? Number(accountId) : undefined,
      search: search as string | undefined,
    }));
  });

  app.get("/api/contacts/:id/profile", requirePermission("crm", "view"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const contactRes = await db.execute(sql.raw(`
        SELECT c.*, a.name as account_name, a.id as account_id_val
        FROM contacts c
        LEFT JOIN accounts a ON c.account_id = a.id
        WHERE c.id = ${id} LIMIT 1
      `));
      if (!contactRes.rows.length) return res.status(404).json({ message: "Contact not found" });
      const contact = contactRes.rows[0] as any;
      const emailQ = contact.email ? `'${contact.email.replace(/'/g, "''")}'` : "NULL";
      const [oppRows, emailRows, meetingRows, noteRows, taskRows, activityRows] = await Promise.all([
        db.execute(sql.raw(`
          SELECT o.id, o.title, o.stage, o.amount, o.est_close_date, o.next_step,
                 u.name as owner_name, a.name as account_name
          FROM opportunities o
          LEFT JOIN opportunity_contacts oc ON o.id = oc.opportunity_id
          LEFT JOIN users u ON o.owner_user_id = u.id
          LEFT JOIN accounts a ON o.account_id = a.id
          WHERE oc.contact_id = ${id}
             OR o.contact_id = ${id}
          ORDER BY o.updated_at DESC LIMIT 10
        `)),
        contact.email ? db.execute(sql.raw(`
          (SELECT id, subject, from_email, from_name, direction, snippet, sent_at
           FROM email_messages
           WHERE from_email = ${emailQ}
           ORDER BY sent_at DESC LIMIT 8)
          UNION
          (SELECT id, subject, from_email, from_name, direction, snippet, sent_at
           FROM email_messages
           WHERE from_email != ${emailQ}
             AND all_participants ILIKE '%${contact.email.replace(/'/g, "''")}%'
           ORDER BY sent_at DESC LIMIT 8)
          ORDER BY sent_at DESC LIMIT 8
        `)) : Promise.resolve({ rows: [] }),
        db.execute(sql.raw(`
          SELECT id, title, event_type, start_time, end_time, location, meeting_url, status, invitees
          FROM calendar_events
          WHERE linked_object_type = 'contact' AND linked_object_id = ${id}
          ${contact.email ? `OR invitees::text ILIKE '%${contact.email.replace(/'/g, "''")}%'` : ""}
          ORDER BY start_time DESC LIMIT 8
        `)),
        db.execute(sql.raw(`
          SELECT id, content, author_name, created_at, updated_at
          FROM notes WHERE linked_object_type = 'contact' AND linked_object_id = ${id}
          ORDER BY created_at DESC LIMIT 10
        `)),
        db.execute(sql.raw(`
          SELECT id, title, status, priority, due_date
          FROM tasks
          WHERE linked_object_type = 'contact' AND linked_object_id = ${id}
          ORDER BY CASE WHEN status != 'done' THEN 0 ELSE 1 END, due_date ASC NULLS LAST LIMIT 10
        `)),
        db.execute(sql.raw(`
          SELECT id, type, summary, created_at FROM activities
          WHERE (linked_object_type = 'contact' AND linked_object_id = ${id})
             OR contact_id = ${id}
          ORDER BY created_at DESC LIMIT 10
        `)),
      ]);
      const opps = oppRows.rows as any[];
      const tasks = taskRows.rows as any[];
      const emails = emailRows.rows as any[];
      const meetings = meetingRows.rows as any[];
      const hasOverdueTasks = tasks.some((t: any) => t.status !== 'done' && t.due_date && new Date(t.due_date) < new Date());
      let suggestedAction = "Send an introductory email to build relationship";
      if (hasOverdueTasks) suggestedAction = "Complete overdue tasks for this contact";
      else if (opps.some((o: any) => o.stage === 'proposal')) suggestedAction = "Follow up on open proposal with this contact";
      else if (emails.length === 0 && meetings.length === 0) suggestedAction = "No recent touchpoints — reach out to re-engage";
      else if (opps.length === 0) suggestedAction = "Explore opportunity — no deals linked to this contact";
      res.json({
        contact,
        opportunities: opps,
        emails,
        meetings,
        notes: noteRows.rows,
        tasks,
        activities: activityRows.rows,
        suggestedAction,
      });
    } catch (e: any) {
      console.error("Contact profile error:", e);
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/contacts/:id", requirePermission("crm", "view"), async (req, res) => {
    const contact = await storage.getContact(Number(req.params.id));
    if (!contact) return res.status(404).json({ message: "Contact not found" });
    res.json(contact);
  });

  app.post("/api/contacts", requirePermission("crm", "edit"), async (req, res) => {
    const parsed = insertContactSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createContact(parsed.data));
  });

  app.put("/api/contacts/:id", requirePermission("crm", "edit"), async (req, res) => {
    const result = await storage.updateContact(Number(req.params.id), req.body);
    if (!result) return res.status(404).json({ message: "Contact not found" });
    res.json(result);
  });

  app.delete("/api/contacts/:id", requirePermission("crm", "edit"), async (req, res) => {
    const deleted = await storage.deleteContact(Number(req.params.id));
    if (!deleted) return res.status(404).json({ message: "Contact not found" });
    res.json({ message: "Deleted" });
  });

  app.get("/api/opportunities", async (req, res) => {
    const { accountId, stage, ownerId, forecastCategory, search, page, limit } = req.query;
    res.json(await storage.getOpportunities({
      accountId: accountId ? Number(accountId) : undefined,
      stage: stage as string | undefined,
      ownerId: ownerId ? Number(ownerId) : undefined,
      forecastCategory: forecastCategory as string | undefined,
      search: search as string | undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    }));
  });

  app.get("/api/opportunities/:id/profile", requirePermission("crm", "view"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const [oppRows, contactRows, emailRows, meetingRows, noteRows, taskRows, historyRows, activityRows] = await Promise.all([
        db.execute(sql.raw(`
          SELECT o.*, a.name as account_name, u.name as owner_name
          FROM opportunities o
          LEFT JOIN accounts a ON o.account_id = a.id
          LEFT JOIN users u ON o.owner_user_id = u.id
          WHERE o.id = ${id} LIMIT 1
        `)),
        db.execute(sql.raw(`
          SELECT c.id, c.name, c.title, c.email, c.phone, c.role_type, c.relationship_strength,
                 oc.role as opp_role
          FROM contacts c
          JOIN opportunity_contacts oc ON c.id = oc.contact_id
          WHERE oc.opportunity_id = ${id}
          ORDER BY c.is_primary DESC NULLS LAST, c.name ASC LIMIT 20
        `)),
        db.execute(sql.raw(`
          SELECT em.id, em.subject, em.from_email, em.from_name, em.direction, em.snippet, em.sent_at
          FROM email_messages em
          WHERE em.source_account_id = (SELECT account_id FROM opportunities WHERE id = ${id})
          ORDER BY em.sent_at DESC LIMIT 8
        `)),
        db.execute(sql.raw(`
          SELECT id, title, event_type, start_time, end_time, location, meeting_url, status
          FROM calendar_events
          WHERE linked_object_type = 'opportunity' AND linked_object_id = ${id}
          ORDER BY start_time DESC LIMIT 8
        `)),
        db.execute(sql.raw(`
          SELECT id, content, author_name, created_at, updated_at, is_pinned
          FROM notes WHERE linked_object_type = 'opportunity' AND linked_object_id = ${id}
          ORDER BY is_pinned DESC, created_at DESC LIMIT 15
        `)),
        db.execute(sql.raw(`
          SELECT id, title, status, priority, due_date
          FROM tasks
          WHERE linked_object_type = 'opportunity' AND linked_object_id = ${id}
          ORDER BY CASE WHEN status != 'done' THEN 0 ELSE 1 END, due_date ASC NULLS LAST LIMIT 10
        `)),
        db.execute(sql.raw(`
          SELECT from_stage, to_stage, changed_at FROM deal_stage_history
          WHERE deal_id = ${id}
          ORDER BY changed_at ASC
        `)),
        db.execute(sql.raw(`
          SELECT id, type, summary, created_at FROM activities
          WHERE linked_object_type = 'opportunity' AND linked_object_id = ${id}
          ORDER BY created_at DESC LIMIT 10
        `)),
      ]);
      if (!oppRows.rows.length) return res.status(404).json({ message: "Opportunity not found" });
      const opp = oppRows.rows[0] as any;
      const tasks = taskRows.rows as any[];
      const contacts = contactRows.rows as any[];
      const hasOverdueTasks = tasks.some((t: any) => t.status !== 'done' && t.due_date && new Date(t.due_date) < new Date());
      let suggestedAction = "Advance to next stage — update stage when ready";
      if (hasOverdueTasks) suggestedAction = "Clear overdue tasks to unblock this deal";
      else if (opp.stage === 'proposal') suggestedAction = "Follow up on proposal — confirm decision timeline";
      else if (opp.stage === 'discovery') suggestedAction = "Complete discovery and prepare proposal";
      else if (opp.stage === 'qualified') suggestedAction = "Schedule demo or site visit to advance deal";
      else if (contacts.length === 0) suggestedAction = "Link a contact — no stakeholders mapped to this deal";
      else if (!opp.next_step) suggestedAction = "Define the next step to keep deal moving";
      res.json({
        opportunity: opp,
        contacts,
        emails: emailRows.rows,
        meetings: meetingRows.rows,
        notes: noteRows.rows,
        tasks,
        stageHistory: historyRows.rows,
        activities: activityRows.rows,
        suggestedAction,
      });
    } catch (e: any) {
      console.error("Opportunity profile error:", e);
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/opportunities/:id/stage-history", async (req, res) => {
    res.json(await storage.getDealStageHistory(Number(req.params.id)));
  });

  app.get("/api/opportunities/:id", requirePermission("crm", "view"), async (req, res) => {
    const opp = await storage.getOpportunity(Number(req.params.id));
    if (!opp) return res.status(404).json({ message: "Opportunity not found" });
    res.json(opp);
  });

  app.post("/api/opportunities", requirePermission("crm", "edit"), async (req, res) => {
    const parsed = insertOpportunitySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    const opp = await storage.createOpportunity(parsed.data);
    await storage.createActivity({
      linkedObjectType: "opportunity",
      linkedObjectId: opp.id,
      type: "status_change",
      summary: `Opportunity created: ${opp.title}`,
    });
    res.status(201).json(opp);
  });

  app.put("/api/opportunities/:id", requirePermission("crm", "edit"), async (req, res) => {
    const existing = await storage.getOpportunity(Number(req.params.id));
    if (!existing) return res.status(404).json({ message: "Opportunity not found" });
    const result = await storage.updateOpportunity(Number(req.params.id), req.body);
    if (req.body.stage && req.body.stage !== existing.stage) {
      await storage.createDealStageHistory({
        dealId: existing.id,
        fromStage: existing.stage,
        toStage: req.body.stage,
        changedByUserId: req.session?.userId || null,
      });
      await storage.createActivity({
        linkedObjectType: "opportunity",
        linkedObjectId: existing.id,
        type: "status_change",
        summary: `Stage changed from ${existing.stage} to ${req.body.stage}`,
      });
    }
    res.json(result);
  });

  app.get("/api/tickets", async (req, res) => {
    const { status, severity, assignedTo, page, limit } = req.query;
    res.json(await storage.getTickets({
      status: status as string | undefined,
      severity: severity as string | undefined,
      assignedTo: assignedTo ? Number(assignedTo) : undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    }));
  });

  app.get("/api/tickets/:id", async (req, res) => {
    const ticket = await storage.getTicket(Number(req.params.id));
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });
    res.json(ticket);
  });

  app.post("/api/tickets", requirePermission("support", "edit"), async (req, res) => {
    const parsed = insertTicketSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    const ticket = await storage.createTicket(parsed.data);
    await storage.createActivity({
      linkedObjectType: "ticket",
      linkedObjectId: ticket.id,
      type: "ticket_created",
      summary: `Ticket created: ${ticket.subject}`,
    });
    res.status(201).json(ticket);
  });

  app.put("/api/tickets/:id", requirePermission("support", "edit"), async (req, res) => {
    const result = await storage.updateTicket(Number(req.params.id), req.body);
    if (!result) return res.status(404).json({ message: "Ticket not found" });
    res.json(result);
  });

  app.get("/api/quotes", async (req, res) => {
    const { status, accountId, page, limit, sortBy, sortOrder } = req.query;
    res.json(await storage.getQuotes({
      status: status as string | undefined,
      accountId: accountId ? Number(accountId) : undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      sortBy: sortBy as string | undefined,
      sortOrder: sortOrder as string | undefined,
    }));
  });

  app.get("/api/quotes/next-number", async (_req, res) => {
    res.json({ quoteNumber: await storage.getNextQuoteNumber() });
  });

  app.get("/api/quotes/:id", async (req, res) => {
    const quote = await storage.getQuote(Number(req.params.id));
    if (!quote) return res.status(404).json({ message: "Quote not found" });
    const lineItems = await storage.getQuoteLineItems(quote.id);
    const servicesEst = await storage.getServicesEstimates(quote.id);
    res.json({ ...quote, lineItems, servicesEstimates: servicesEst });
  });

  app.post("/api/quotes", requirePermission("quoting", "edit"), async (req, res) => {
    const { lineItems, servicesEstimates: svcEstimates, ...quoteData } = req.body;
    const quoteNumber = await storage.getNextQuoteNumber();
    const parsed = insertQuoteSchema.safeParse({ ...quoteData, quoteNumber });
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });

    const quote = await storage.createQuote(parsed.data);

    const savedItems: any[] = [];
    if (lineItems && Array.isArray(lineItems)) {
      for (const item of lineItems) {
        const saved = await storage.createQuoteLineItem({ ...item, quoteId: quote.id });
        savedItems.push(saved);
      }
    }

    if (svcEstimates && Array.isArray(svcEstimates)) {
      for (const est of svcEstimates) {
        await storage.createServicesEstimate({ ...est, quoteId: quote.id });
      }
    }

    await storage.createActivity({
      linkedObjectType: "quote",
      linkedObjectId: quote.id,
      type: "quote_generated",
      summary: `Quote ${quoteNumber} created`,
    });

    // Generate XLSX + HTML assets asynchronously, don't block the response
    const fullQuote = await storage.getQuote(quote.id);
    const items = await storage.getQuoteLineItems(quote.id);
    const estimates = await storage.getServicesEstimates(quote.id);

    try {
      const qd: QuoteData = {
        quoteNumber: fullQuote!.quoteNumber,
        version: fullQuote!.version,
        status: fullQuote!.status,
        country: fullQuote!.country || "US",
        currency: fullQuote!.currency,
        customerName: fullQuote!.customerName || undefined,
        customerEmail: fullQuote!.customerEmail || undefined,
        customerPhone: fullQuote!.customerPhone || undefined,
        marinaAddress: fullQuote!.marinaAddress || undefined,
        siteAddress: fullQuote!.siteAddress || undefined,
        billingPeriodStart: fullQuote!.billingPeriodStart || undefined,
        billingPeriodEnd: fullQuote!.billingPeriodEnd || undefined,
        entitlementNumber: fullQuote!.entitlementNumber || undefined,
        licensedTo: fullQuote!.licensedTo || undefined,
        paymentTermDeposit: fullQuote!.paymentTermDeposit ?? 10,
        paymentTermProduction: fullQuote!.paymentTermProduction ?? 40,
        paymentTermInstall: fullQuote!.paymentTermInstall ?? 50,
        taxRate: fullQuote!.taxRate ?? 0,
        taxAmount: fullQuote!.taxAmount ?? 0,
        hardwareSubtotal: fullQuote!.hardwareSubtotal ?? 0,
        softwareSubtotal: fullQuote!.softwareSubtotal ?? 0,
        subtotal: fullQuote!.subtotal ?? 0,
        total: fullQuote!.total ?? 0,
        depositDue: fullQuote!.depositDue ?? 0,
        slipsCount: fullQuote!.slipsCount || undefined,
        validUntil: fullQuote!.validUntil,
        notes: fullQuote!.notes || undefined,
        assumptions: fullQuote!.assumptions || undefined,
        exclusions: fullQuote!.exclusions || undefined,
        lineItems: items.map(i => ({
          name: i.name,
          description: i.description || undefined,
          category: i.category,
          qty: i.qty,
          listPrice: i.listPrice ?? 0,
          discountPercent: i.discountPercent ?? 0,
          unitPrice: i.unitPrice,
          lineTotal: i.lineTotal,
          unitType: i.unitType || undefined,
          isRecurring: i.isRecurring ?? false,
        })),
        createdAt: fullQuote!.createdAt,
      };

      const [xlsxBuf, htmlStr] = await Promise.all([
        generateQuoteXlsx(qd),
        Promise.resolve(generateInvoiceHtml(qd)),
      ]);

      const xlsxB64 = xlsxBuf.toString("base64");
      const htmlB64 = Buffer.from(htmlStr, "utf-8").toString("base64");
      const xlsxName = `Quote-${quoteNumber}.xlsx`;
      const htmlName = `Invoice-${quoteNumber}.html`;

      const [xlsxAsset] = await db.insert(assets).values({
        name: xlsxName,
        originalName: xlsxName,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size: xlsxBuf.length,
        filePath: "",
        fileData: xlsxB64,
        category: "quotes",
        description: `XLSX Quote for ${quoteNumber}`,
        tags: "quote,xlsx",
      }).returning();

      const [htmlAsset] = await db.insert(assets).values({
        name: htmlName,
        originalName: htmlName,
        mimeType: "text/html",
        size: htmlStr.length,
        filePath: "",
        fileData: htmlB64,
        category: "quotes",
        description: `HTML Invoice for ${quoteNumber}`,
        tags: "quote,html,invoice",
      }).returning();

      await storage.updateQuote(quote.id, {
        xlsxAssetId: xlsxAsset.id,
        htmlAssetId: htmlAsset.id,
      } as any);

      const refreshedQuote = await storage.getQuote(quote.id);
      res.status(201).json({ ...refreshedQuote, lineItems: items, servicesEstimates: estimates });
    } catch (genErr) {
      console.error("Quote asset generation error:", genErr);
      res.status(201).json({ ...fullQuote, lineItems: items, servicesEstimates: estimates });
    }
  });

  app.get("/api/quotes/:id/print", async (req, res) => {
    const quote = await storage.getQuote(Number(req.params.id));
    if (!quote) return res.status(404).send("Quote not found");
    const items = await storage.getQuoteLineItems(quote.id);
    const qd: QuoteData = {
      quoteNumber: quote.quoteNumber,
      version: quote.version,
      status: quote.status,
      country: quote.country || "US",
      currency: quote.currency,
      customerName: quote.customerName || undefined,
      customerEmail: quote.customerEmail || undefined,
      customerPhone: quote.customerPhone || undefined,
      marinaAddress: quote.marinaAddress || undefined,
      siteAddress: quote.siteAddress || undefined,
      billingPeriodStart: quote.billingPeriodStart || undefined,
      billingPeriodEnd: quote.billingPeriodEnd || undefined,
      entitlementNumber: quote.entitlementNumber || undefined,
      licensedTo: quote.licensedTo || undefined,
      paymentTermDeposit: quote.paymentTermDeposit ?? 10,
      paymentTermProduction: quote.paymentTermProduction ?? 40,
      paymentTermInstall: quote.paymentTermInstall ?? 50,
      taxRate: quote.taxRate ?? 0,
      taxAmount: quote.taxAmount ?? 0,
      hardwareSubtotal: quote.hardwareSubtotal ?? 0,
      softwareSubtotal: quote.softwareSubtotal ?? 0,
      subtotal: quote.subtotal ?? 0,
      total: quote.total ?? 0,
      depositDue: quote.depositDue ?? 0,
      slipsCount: quote.slipsCount || undefined,
      validUntil: quote.validUntil,
      notes: quote.notes || undefined,
      assumptions: quote.assumptions || undefined,
      exclusions: quote.exclusions || undefined,
      lineItems: items.map(i => ({
        name: i.name, description: i.description || undefined, category: i.category,
        qty: i.qty, listPrice: i.listPrice ?? 0, discountPercent: i.discountPercent ?? 0,
        unitPrice: i.unitPrice, lineTotal: i.lineTotal, unitType: i.unitType || undefined,
        isRecurring: i.isRecurring ?? false,
      })),
      createdAt: quote.createdAt,
    };
    const html = generateInvoiceHtml(qd);
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  });

  app.get("/api/quotes/:id/download/xlsx", async (req, res) => {
    const quote = await storage.getQuote(Number(req.params.id));
    if (!quote) return res.status(404).json({ message: "Quote not found" });

    if (quote.xlsxAssetId) {
      const [assetRow] = await db.select().from(assets).where(eq(assets.id, quote.xlsxAssetId));
      if (assetRow?.fileData) {
        const buf = Buffer.from(assetRow.fileData, "base64");
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="Quote-${quote.quoteNumber}.xlsx"`);
        return res.send(buf);
      }
    }

    const items = await storage.getQuoteLineItems(quote.id);
    const qd: QuoteData = {
      quoteNumber: quote.quoteNumber, version: quote.version, status: quote.status,
      country: quote.country || "US", currency: quote.currency,
      customerName: quote.customerName || undefined, customerEmail: quote.customerEmail || undefined,
      customerPhone: quote.customerPhone || undefined, marinaAddress: quote.marinaAddress || undefined,
      siteAddress: quote.siteAddress || undefined, billingPeriodStart: quote.billingPeriodStart || undefined,
      billingPeriodEnd: quote.billingPeriodEnd || undefined, entitlementNumber: quote.entitlementNumber || undefined,
      licensedTo: quote.licensedTo || undefined,
      paymentTermDeposit: quote.paymentTermDeposit ?? 10, paymentTermProduction: quote.paymentTermProduction ?? 40,
      paymentTermInstall: quote.paymentTermInstall ?? 50, taxRate: quote.taxRate ?? 0,
      taxAmount: quote.taxAmount ?? 0, hardwareSubtotal: quote.hardwareSubtotal ?? 0,
      softwareSubtotal: quote.softwareSubtotal ?? 0, subtotal: quote.subtotal ?? 0,
      total: quote.total ?? 0, depositDue: quote.depositDue ?? 0, slipsCount: quote.slipsCount || undefined,
      validUntil: quote.validUntil, notes: quote.notes || undefined,
      assumptions: quote.assumptions || undefined, exclusions: quote.exclusions || undefined,
      lineItems: items.map(i => ({
        name: i.name, description: i.description || undefined, category: i.category,
        qty: i.qty, listPrice: i.listPrice ?? 0, discountPercent: i.discountPercent ?? 0,
        unitPrice: i.unitPrice, lineTotal: i.lineTotal, unitType: i.unitType || undefined,
        isRecurring: i.isRecurring ?? false,
      })),
      createdAt: quote.createdAt,
    };
    const buf = await generateQuoteXlsx(qd);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Quote-${quote.quoteNumber}.xlsx"`);
    res.send(buf);
  });

  app.put("/api/quotes/:id", requirePermission("quoting", "edit"), async (req, res) => {
    const { lineItems, servicesEstimates: svcEstimates, ...quoteData } = req.body;
    const result = await storage.updateQuote(Number(req.params.id), quoteData);
    if (!result) return res.status(404).json({ message: "Quote not found" });
    res.json(result);
  });

  app.get("/api/quotes/:quoteId/line-items", async (req, res) => {
    res.json(await storage.getQuoteLineItems(Number(req.params.quoteId)));
  });

  app.post("/api/quotes/:quoteId/line-items", requirePermission("quoting", "edit"), async (req, res) => {
    const data = { ...req.body, quoteId: Number(req.params.quoteId) };
    const parsed = insertQuoteLineItemSchema.safeParse(data);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createQuoteLineItem(parsed.data));
  });

  app.delete("/api/quote-line-items/:id", requirePermission("quoting", "edit"), async (req, res) => {
    const deleted = await storage.deleteQuoteLineItem(Number(req.params.id));
    if (!deleted) return res.status(404).json({ message: "Line item not found" });
    res.json({ message: "Deleted" });
  });

  app.get("/api/quotes/:quoteId/services-estimates", async (req, res) => {
    res.json(await storage.getServicesEstimates(Number(req.params.quoteId)));
  });

  app.post("/api/quotes/:quoteId/services-estimates", requirePermission("quoting", "edit"), async (req, res) => {
    const data = { ...req.body, quoteId: Number(req.params.quoteId) };
    const parsed = insertServicesEstimateSchema.safeParse(data);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createServicesEstimate(parsed.data));
  });

  app.delete("/api/services-estimates/:id", requirePermission("quoting", "edit"), async (req, res) => {
    const deleted = await storage.deleteServicesEstimate(Number(req.params.id));
    if (!deleted) return res.status(404).json({ message: "Estimate not found" });
    res.json({ message: "Deleted" });
  });

  app.get("/api/activities", async (req, res) => {
    const { objectType, objectId } = req.query;
    if (!objectType || !objectId) return res.status(400).json({ message: "objectType and objectId required" });
    res.json(await storage.getActivities(objectType as string, Number(objectId)));
  });

  app.post("/api/activities", async (req, res) => {
    const parsed = insertActivitySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createActivity(parsed.data));
  });

  app.get("/api/tasks", async (req, res) => {
    const { ownerUserId, status, linkedObjectType, linkedObjectId } = req.query;
    res.json(await storage.getTasks({
      ownerUserId: ownerUserId ? Number(ownerUserId) : undefined,
      status: status as string | undefined,
      linkedObjectType: linkedObjectType as string | undefined,
      linkedObjectId: linkedObjectId ? Number(linkedObjectId) : undefined,
    }));
  });

  app.post("/api/tasks", async (req, res) => {
    const body = { ...req.body };
    if (body.dueDate && typeof body.dueDate === "string") body.dueDate = new Date(body.dueDate);
    body.createdByUserId = req.session.userId;
    const parsed = insertTaskSchema.safeParse(body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createTask(parsed.data));
  });

  // POST /api/quick-actions/task — create a linked task from the command bar
  app.post("/api/quick-actions/task", requireAuth, requirePermission("crm", "edit"), async (req, res) => {
    try {
      const userId = getSessionUserId(req);
      const { linkedObjectType, linkedObjectId, linkedLabel } = req.body;
      if (!linkedObjectType || !linkedObjectId) {
        return res.status(400).json({ message: "linkedObjectType and linkedObjectId are required" });
      }
      const safe = (s: string) => String(s).replace(/'/g, "''").slice(0, 120);
      const title = linkedLabel ? `Follow up: ${safe(String(linkedLabel))}` : "Follow up";
      const task = await storage.createTask({
        title,
        status: "pending",
        priority: "medium",
        linkedObjectType: String(linkedObjectType),
        linkedObjectId: Number(linkedObjectId),
        ownerUserId: userId ?? undefined,
        createdByUserId: userId ?? undefined,
      });
      res.status(201).json(task);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/tasks/:id", requireAuth, async (req, res) => {
    const body = { ...req.body };
    if (body.dueDate && typeof body.dueDate === "string") body.dueDate = new Date(body.dueDate);
    if (body.reminderAt && typeof body.reminderAt === "string") body.reminderAt = new Date(body.reminderAt);
    if (body.snoozedUntil && typeof body.snoozedUntil === "string") body.snoozedUntil = new Date(body.snoozedUntil);
    if (body.snoozedUntil === null) body.snoozedUntil = null;
    const result = await storage.updateTask(Number(req.params.id), body);
    if (!result) return res.status(404).json({ message: "Task not found" });
    res.json(result);
  });

  // ── Tasks Hub — rich read with joins, views, grouping ──────────────────
  app.get("/api/tasks/hub", async (req, res) => {
    try {
      const userId = getSessionUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const isAdminUser = req.session.globalRole === "master_admin" || req.session.globalRole === "admin";
      const view = (req.query.view as string) || "my";
      const groupBy = (req.query.groupBy as string) || "due_date";
      const now = new Date();
      const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
      const todayEnd = new Date(now); todayEnd.setHours(23,59,59,999);
      const sevenDaysOut = new Date(now); sevenDaysOut.setDate(now.getDate() + 7);

      let whereClause = "";
      switch (view) {
        case "my":
          whereClause = `t.owner_user_id = ${userId} AND t.status NOT IN ('done','completed') AND (t.snoozed_until IS NULL OR t.snoozed_until <= NOW())`;
          break;
        case "team":
          whereClause = `t.status NOT IN ('done','completed') AND (t.snoozed_until IS NULL OR t.snoozed_until <= NOW())`;
          break;
        case "today":
          whereClause = `t.status NOT IN ('done','completed') AND t.due_date >= '${todayStart.toISOString()}' AND t.due_date <= '${todayEnd.toISOString()}' ${isAdminUser ? "" : `AND t.owner_user_id = ${userId}`}`;
          break;
        case "overdue":
          whereClause = `t.status NOT IN ('done','completed') AND t.due_date < '${todayStart.toISOString()}' ${isAdminUser ? "" : `AND t.owner_user_id = ${userId}`}`;
          break;
        case "upcoming":
          whereClause = `t.status NOT IN ('done','completed') AND t.due_date > '${todayEnd.toISOString()}' AND t.due_date <= '${sevenDaysOut.toISOString()}' ${isAdminUser ? "" : `AND t.owner_user_id = ${userId}`}`;
          break;
        case "completed":
          whereClause = `t.status IN ('done','completed') ${isAdminUser ? "" : `AND t.owner_user_id = ${userId}`}`;
          break;
        default:
          whereClause = `t.owner_user_id = ${userId} AND t.status NOT IN ('done','completed')`;
      }

      const taskRes = await db.execute(sql.raw(`
        SELECT
          t.id, t.title, t.description, t.status, t.priority, t.due_date AS "dueDate",
          t.reminder_at AS "reminderAt", t.snoozed_until AS "snoozedUntil",
          t.linked_object_type AS "linkedObjectType", t.linked_object_id AS "linkedObjectId",
          t.account_id AS "accountId", t.ai_suggested AS "aiSuggested",
          t.source, t.created_at AS "createdAt", t.updated_at AS "updatedAt",
          t.owner_user_id AS "ownerUserId",
          u.name AS "ownerName",
          a.name AS "accountName"
        FROM tasks t
        LEFT JOIN users u ON u.id = t.owner_user_id
        LEFT JOIN accounts a ON a.id = t.account_id
        WHERE ${whereClause}
        ORDER BY
          CASE WHEN t.status IN ('done','completed') THEN 1 ELSE 0 END ASC,
          CASE WHEN t.due_date < NOW() AND t.status NOT IN ('done','completed') THEN 0 ELSE 1 END ASC,
          t.due_date ASC NULLS LAST,
          CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END ASC
        LIMIT 500
      `));
      const taskRows: any[] = (taskRes as any).rows ?? [];

      // Build groups
      const groups: Record<string, any[]> = {};
      const addToGroup = (key: string, task: any) => {
        if (!groups[key]) groups[key] = [];
        groups[key].push(task);
      };

      for (const t of taskRows) {
        let key: string;
        if (groupBy === "priority") {
          key = t.priority || "medium";
        } else if (groupBy === "assignee") {
          key = t.ownerName || "Unassigned";
        } else if (groupBy === "linked_record") {
          key = t.accountName ? `${t.accountName}` : (t.linkedObjectType ? `${t.linkedObjectType} #${t.linkedObjectId}` : "No linked record");
        } else {
          // default: due_date
          if (!t.dueDate) { key = "No due date"; }
          else {
            const d = new Date(t.dueDate);
            const taskDay = new Date(d); taskDay.setHours(0,0,0,0);
            const today = new Date(); today.setHours(0,0,0,0);
            const diffDays = Math.round((taskDay.getTime() - today.getTime()) / 86400000);
            if (diffDays < 0) key = "Overdue";
            else if (diffDays === 0) key = "Today";
            else if (diffDays === 1) key = "Tomorrow";
            else if (diffDays <= 7) key = "This week";
            else key = "Later";
          }
        }
        addToGroup(key, t);
      }

      // Counts for sidebar badges
      const countsRes = await db.execute(sql.raw(`
        SELECT
          COUNT(*) FILTER (WHERE owner_user_id = ${userId} AND status NOT IN ('done','completed') AND (snoozed_until IS NULL OR snoozed_until <= NOW()))::int AS my_count,
          COUNT(*) FILTER (WHERE status NOT IN ('done','completed') AND (snoozed_until IS NULL OR snoozed_until <= NOW()))::int AS team_count,
          COUNT(*) FILTER (WHERE status NOT IN ('done','completed') AND due_date >= '${todayStart.toISOString()}' AND due_date <= '${todayEnd.toISOString()}' ${isAdminUser ? "" : `AND owner_user_id = ${userId}`})::int AS today_count,
          COUNT(*) FILTER (WHERE status NOT IN ('done','completed') AND due_date < '${todayStart.toISOString()}' ${isAdminUser ? "" : `AND owner_user_id = ${userId}`})::int AS overdue_count,
          COUNT(*) FILTER (WHERE status NOT IN ('done','completed') AND due_date > '${todayEnd.toISOString()}' AND due_date <= '${sevenDaysOut.toISOString()}' ${isAdminUser ? "" : `AND owner_user_id = ${userId}`})::int AS upcoming_count
        FROM tasks
      `));
      const counts = (countsRes as any).rows?.[0] ?? {};

      res.json({ tasks: taskRows, groups, counts, view, groupBy, total: taskRows.length });
    } catch (err: any) {
      console.error("[tasks/hub]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Global Task Suggestions ───────────────────────────────────────────────

  app.get("/api/tasks/suggestions", requirePermission("crm", "view"), async (req, res) => {
    try {
      const userId = getSessionUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const suggestions = await generateGlobalSuggestions(userId);
      res.json({ suggestions, total: suggestions.length });
    } catch (err: any) {
      console.error("[tasks/suggestions]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/tasks/suggestions/:id/accept", requirePermission("crm", "edit"), async (req, res) => {
    const suggId = Number(req.params.id);
    if (!Number.isInteger(suggId) || suggId <= 0) return res.status(400).json({ message: "Invalid id" });
    const userId = getSessionUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    try {
      const { rows } = await db.execute(sql.raw(`SELECT * FROM task_suggestions WHERE id = ${suggId} LIMIT 1`));
      if (!rows.length) return res.status(404).json({ message: "Suggestion not found" });
      const s = rows[0] as any;

      // Build task fields with source info
      const safeTitle = s.title.replace(/'/g, "''");
      const safeDesc = (`${s.reason ?? ""} [Auto-created from: ${s.source_label ?? s.signal_type}]`).replace(/'/g, "''");
      const safeSourceLabel = (s.source_label ?? s.signal_type).replace(/'/g, "''");
      const dueDate = s.suggested_due_date
        ? new Date(s.suggested_due_date).toISOString()
        : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      const ownerUserId = s.suggested_assignee_id ?? userId;

      const { rows: taskRows } = await db.execute(sql.raw(
        `INSERT INTO tasks
           (linked_object_type, linked_object_id, owner_user_id, created_by_user_id,
            title, description, due_date, status, priority, ai_suggested,
            source, source_label, account_id)
         VALUES
           ('${s.object_type}', ${s.object_id}, ${ownerUserId}, ${userId},
            '${safeTitle}', '${safeDesc}', '${dueDate}', 'pending', '${s.priority}', true,
            'suggestion', '${safeSourceLabel}',
            ${s.object_type === 'account' ? s.object_id : 'NULL'})
         RETURNING id`
      ));
      const taskId = (taskRows[0] as any)?.id ?? null;

      await db.execute(sql.raw(
        `UPDATE task_suggestions
         SET status = 'accepted', accepted_at = NOW(), created_task_id = ${taskId ?? "NULL"}, updated_at = NOW()
         WHERE id = ${suggId}`
      ));

      res.json({ success: true, taskId });
    } catch (err: any) {
      console.error("[tasks/suggestions/accept]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/tasks/suggestions/:id/dismiss", requirePermission("crm", "view"), async (req, res) => {
    const suggId = Number(req.params.id);
    if (!Number.isInteger(suggId) || suggId <= 0) return res.status(400).json({ message: "Invalid id" });
    const userId = getSessionUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    try {
      const { rows } = await db.execute(sql.raw(`SELECT id FROM task_suggestions WHERE id = ${suggId} LIMIT 1`));
      if (!rows.length) return res.status(404).json({ message: "Suggestion not found" });

      await db.execute(sql.raw(
        `UPDATE task_suggestions
         SET status = 'dismissed', dismissed_at = NOW(), dismissed_by = ${userId}, updated_at = NOW()
         WHERE id = ${suggId}`
      ));
      res.json({ success: true });
    } catch (err: any) {
      console.error("[tasks/suggestions/dismiss]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/tasks/suggestions/:id/snooze", requirePermission("crm", "view"), async (req, res) => {
    const suggId = Number(req.params.id);
    if (!Number.isInteger(suggId) || suggId <= 0) return res.status(400).json({ message: "Invalid id" });
    const days = Number(req.body?.days ?? 3);
    if (!Number.isInteger(days) || days < 1 || days > 90) return res.status(400).json({ message: "days must be 1–90" });

    try {
      const { rows } = await db.execute(sql.raw(`SELECT id FROM task_suggestions WHERE id = ${suggId} LIMIT 1`));
      if (!rows.length) return res.status(404).json({ message: "Suggestion not found" });

      const snoozedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      await db.execute(sql.raw(
        `UPDATE task_suggestions
         SET status = 'snoozed', snoozed_until = '${snoozedUntil}', updated_at = NOW()
         WHERE id = ${suggId}`
      ));
      res.json({ success: true, snoozedUntil });
    } catch (err: any) {
      console.error("[tasks/suggestions/snooze]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Task Rule Configs ─────────────────────────────────────────────────────

  app.get("/api/task-rules", requirePermission("crm", "view"), async (req, res) => {
    try {
      const { rows } = await db.execute(sql.raw(`SELECT * FROM task_rule_configs ORDER BY rule_id`));
      res.json((rows as any[]).map(r => ({
        ruleId: r.rule_id,
        label: r.label,
        description: r.description,
        thresholdValue: Number(r.threshold_value),
        thresholdUnit: r.threshold_unit,
        isEnabled: Boolean(r.is_enabled),
        assigneeStrategy: r.assignee_strategy,
        defaultAssigneeUserId: r.default_assignee_user_id ? Number(r.default_assignee_user_id) : null,
      })));
    } catch (err: any) {
      console.error("[task-rules GET]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/task-rules/:ruleId", requirePermission("crm", "edit"), async (req, res) => {
    const ruleId = req.params.ruleId;
    const { thresholdValue, thresholdUnit, isEnabled, assigneeStrategy, defaultAssigneeUserId } = req.body ?? {};

    const allowed = ["unanswered_email","stale_lead","missing_next_step","quote_no_followup","account_needs_attention","overdue_task_reminder"];
    if (!allowed.includes(ruleId)) return res.status(400).json({ message: "Unknown rule" });

    try {
      const { rows } = await db.execute(sql.raw(`SELECT rule_id FROM task_rule_configs WHERE rule_id = '${ruleId}' LIMIT 1`));
      if (!rows.length) return res.status(404).json({ message: "Rule not found" });

      const sets: string[] = [];
      if (thresholdValue !== undefined) sets.push(`threshold_value = ${Number(thresholdValue)}`);
      if (thresholdUnit !== undefined) sets.push(`threshold_unit = '${String(thresholdUnit).replace(/'/g,"''")}'`);
      if (isEnabled !== undefined) sets.push(`is_enabled = ${Boolean(isEnabled)}`);
      if (assigneeStrategy !== undefined) sets.push(`assignee_strategy = '${String(assigneeStrategy).replace(/'/g,"''")}'`);
      if (defaultAssigneeUserId !== undefined) {
        sets.push(defaultAssigneeUserId ? `default_assignee_user_id = ${Number(defaultAssigneeUserId)}` : `default_assignee_user_id = NULL`);
      }
      if (!sets.length) return res.status(400).json({ message: "No fields to update" });
      sets.push("updated_at = NOW()");

      await db.execute(sql.raw(`UPDATE task_rule_configs SET ${sets.join(", ")} WHERE rule_id = '${ruleId}'`));

      const { rows: updated } = await db.execute(sql.raw(`SELECT * FROM task_rule_configs WHERE rule_id = '${ruleId}' LIMIT 1`));
      const r = updated[0] as any;
      res.json({
        ruleId: r.rule_id, label: r.label, description: r.description,
        thresholdValue: Number(r.threshold_value), thresholdUnit: r.threshold_unit,
        isEnabled: Boolean(r.is_enabled), assigneeStrategy: r.assignee_strategy,
        defaultAssigneeUserId: r.default_assignee_user_id ? Number(r.default_assignee_user_id) : null,
      });
    } catch (err: any) {
      console.error("[task-rules PUT]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Execution: Daily + Summary + Reminders + Bulk ─────────────────────────

  // SQL-safe string escaping: wraps in single quotes and escapes internal single quotes/backslashes.
  const sqlStr = (s: string | null | undefined): string => {
    if (s == null) return "NULL";
    return `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
  };

  app.get("/api/execution/today", requirePermission("crm", "view"), async (req, res) => {
    try {
      const userId = getSessionUserId(req)!;
      const now = new Date();
      const todayStart = `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
      const todayEnd = `${now.toISOString().slice(0, 10)}T23:59:59.999Z`;

      const [mustDoRes, overdueRes, newlyRes, awaitingRes, recentRes, suggestionsRes] = await Promise.all([
        db.execute(sql.raw(`
          SELECT t.id, t.title, t.priority, t.status, t.due_date, t.reminder_count, t.escalation_level,
            t.source, t.source_label, t.account_id, t.linked_object_type, t.linked_object_id,
            t.owner_user_id, u.name AS owner_name, a.name AS account_name,
            EXTRACT(EPOCH FROM (NOW() - t.due_date))/86400 AS days_overdue
          FROM tasks t
          LEFT JOIN users u ON u.id = t.owner_user_id
          LEFT JOIN accounts a ON a.id = t.account_id
          WHERE t.owner_user_id = ${userId}
            AND t.status NOT IN ('completed','cancelled')
            AND t.due_date >= '${todayStart}' AND t.due_date <= '${todayEnd}'
            AND (t.snoozed_until IS NULL OR t.snoozed_until < NOW())
          ORDER BY t.priority DESC, t.due_date ASC
          LIMIT 20
        `)),
        db.execute(sql.raw(`
          SELECT t.id, t.title, t.priority, t.status, t.due_date, t.reminder_count, t.escalation_level,
            t.source, t.source_label, t.account_id, t.linked_object_type, t.linked_object_id,
            t.owner_user_id, u.name AS owner_name, a.name AS account_name,
            EXTRACT(EPOCH FROM (NOW() - t.due_date))/86400 AS days_overdue
          FROM tasks t
          LEFT JOIN users u ON u.id = t.owner_user_id
          LEFT JOIN accounts a ON a.id = t.account_id
          WHERE t.owner_user_id = ${userId}
            AND t.status NOT IN ('completed','cancelled')
            AND t.due_date < '${todayStart}'
            AND (t.snoozed_until IS NULL OR t.snoozed_until < NOW())
          ORDER BY t.priority DESC, t.due_date ASC
          LIMIT 20
        `)),
        db.execute(sql.raw(`
          SELECT t.id, t.title, t.priority, t.status, t.due_date, t.reminder_count, t.escalation_level,
            t.source, t.source_label, t.account_id, t.linked_object_type, t.linked_object_id,
            t.owner_user_id, u.name AS owner_name, a.name AS account_name
          FROM tasks t
          LEFT JOIN users u ON u.id = t.owner_user_id
          LEFT JOIN accounts a ON a.id = t.account_id
          WHERE t.owner_user_id = ${userId}
            AND t.status NOT IN ('completed','cancelled')
            AND t.created_at >= NOW() - INTERVAL '24 hours'
          ORDER BY t.created_at DESC
          LIMIT 10
        `)),
        db.execute(sql.raw(`
          SELECT t.id, t.title, t.priority, t.status, t.due_date, t.reminder_count, t.escalation_level,
            t.source, t.source_label, t.account_id, t.linked_object_type, t.linked_object_id,
            t.owner_user_id, u.name AS owner_name, a.name AS account_name
          FROM tasks t
          LEFT JOIN users u ON u.id = t.owner_user_id
          LEFT JOIN accounts a ON a.id = t.account_id
          WHERE t.owner_user_id = ${userId}
            AND t.status NOT IN ('completed','cancelled')
            AND t.source IN ('email','suggestion')
          ORDER BY t.due_date ASC NULLS LAST
          LIMIT 10
        `)),
        db.execute(sql.raw(`
          SELECT t.id, t.title, t.priority, t.status, t.completed_at,
            t.owner_user_id, u.name AS owner_name, a.name AS account_name
          FROM tasks t
          LEFT JOIN users u ON u.id = t.owner_user_id
          LEFT JOIN accounts a ON a.id = t.account_id
          WHERE t.owner_user_id = ${userId}
            AND t.status = 'completed'
            AND t.completed_at >= NOW() - INTERVAL '24 hours'
          ORDER BY t.completed_at DESC
          LIMIT 10
        `)),
        db.execute(sql.raw(`
          SELECT COUNT(*) AS cnt FROM task_suggestions
          WHERE status = 'pending'
            AND (snoozed_until IS NULL OR snoozed_until < NOW())
        `)),
      ]);

      const suggestionsReady = Number((suggestionsRes.rows[0] as any)?.cnt) || 0;

      res.json({
        mustDoToday: mustDoRes.rows,
        overdue: overdueRes.rows,
        newlyAssigned: newlyRes.rows,
        awaitingReply: awaitingRes.rows,
        recentlyCompleted: recentRes.rows,
        suggestionsReady,
        meta: {
          userId,
          generatedAt: now.toISOString(),
          counts: {
            mustDoToday: mustDoRes.rows.length,
            overdue: overdueRes.rows.length,
            newlyAssigned: newlyRes.rows.length,
            awaitingReply: awaitingRes.rows.length,
            recentlyCompleted: recentRes.rows.length,
          },
        },
      });
    } catch (err: any) {
      console.error("[execution/today]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/execution/summary", requirePermission("crm", "view"), async (req, res) => {
    try {
      const userId = getSessionUserId(req)!;

      const [statsRes, avgAgeRes, blockedRes, staleRes] = await Promise.all([
        db.execute(sql.raw(`
          SELECT
            COUNT(*) FILTER (WHERE status NOT IN ('completed','cancelled')) AS total_open,
            COUNT(*) FILTER (WHERE status NOT IN ('completed','cancelled') AND due_date < NOW()) AS overdue_count,
            COUNT(*) FILTER (WHERE status NOT IN ('completed','cancelled') AND due_date >= CURRENT_DATE AND due_date < CURRENT_DATE + INTERVAL '1 day') AS due_today,
            COUNT(*) FILTER (WHERE status = 'completed' AND completed_at >= NOW() - INTERVAL '7 days') AS completed_7d,
            COUNT(*) FILTER (WHERE status NOT IN ('completed','cancelled') AND created_at >= NOW() - INTERVAL '7 days') AS created_7d
          FROM tasks
          WHERE owner_user_id = ${userId}
        `)),
        db.execute(sql.raw(`
          SELECT AVG(EXTRACT(EPOCH FROM (NOW() - created_at))/86400)::int AS avg_age_days
          FROM tasks
          WHERE owner_user_id = ${userId} AND status NOT IN ('completed','cancelled')
        `)),
        db.execute(sql.raw(`
          SELECT u.name AS owner_name, COUNT(*) AS overdue_count
          FROM tasks t
          JOIN users u ON u.id = t.owner_user_id
          WHERE t.status NOT IN ('completed','cancelled') AND t.due_date < NOW()
          GROUP BY u.id, u.name
          ORDER BY overdue_count DESC
          LIMIT 5
        `)),
        db.execute(sql.raw(`
          SELECT COALESCE(a.name, t.linked_object_type) AS record_name,
            t.linked_object_type,
            COUNT(*) AS task_count
          FROM tasks t
          LEFT JOIN accounts a ON a.id = t.account_id
          WHERE t.status NOT IN ('completed','cancelled')
            AND t.due_date < NOW() - INTERVAL '7 days'
          GROUP BY a.name, t.linked_object_type
          ORDER BY task_count DESC
          LIMIT 5
        `)),
      ]);

      const statsRow = statsRes.rows[0] as any || {};
      const totalOpen = Number(statsRow.total_open) || 0;
      const completedLast7d = Number(statsRow.completed_7d) || 0;
      const createdLast7d = Number(statsRow.created_7d) || 0;
      const completionRate = createdLast7d > 0
        ? Math.round((completedLast7d / (completedLast7d + totalOpen)) * 100)
        : 0;

      res.json({
        totalOpen,
        overdueCount: Number(statsRow.overdue_count) || 0,
        dueToday: Number(statsRow.due_today) || 0,
        completionRateLast7d: completionRate,
        avgAgeOfOpenTasksDays: Number((avgAgeRes.rows[0] as any)?.avg_age_days) || 0,
        topBlockedOwners: blockedRes.rows,
        topStaleLinkedRecords: staleRes.rows,
      });
    } catch (err: any) {
      console.error("[execution/summary]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/tasks/:id/remind-now", requirePermission("crm", "edit"), async (req, res) => {
    try {
      const userId = getSessionUserId(req)!;
      const taskId = Number(req.params.id);

      const taskRes = await db.execute(sql.raw(`SELECT * FROM tasks WHERE id = ${taskId} LIMIT 1`));
      if (taskRes.rows.length === 0) return res.status(404).json({ message: "Task not found" });
      const task = taskRes.rows[0] as any;

      const dedupeKey = `manual-reminder-${taskId}-${userId}-${new Date().toISOString().slice(0, 13)}`;
      const notifResult = await db.execute(sql.raw(`
        INSERT INTO notifications (user_id, type, title, body, severity, linked_object_type, linked_object_id, action_url, is_read, dedupe_key)
        VALUES (
          ${task.owner_user_id || userId},
          'task_reminder',
          'Task Reminder',
          ${sqlStr(`"${task.title}" — reminder sent by your manager.`)},
          'medium',
          'task',
          ${taskId},
          '/execution/daily',
          false,
          ${sqlStr(dedupeKey)}
        )
        ON CONFLICT (dedupe_key) DO NOTHING
        RETURNING id
      `));

      if (notifResult.rows.length > 0) {
        const notifId = (notifResult.rows[0] as any).id;
        await db.execute(sql.raw(`
          INSERT INTO task_reminder_logs (task_id, user_id, reminder_type, channel, notification_id)
          VALUES (${taskId}, ${userId}, 'manual', 'in_app', ${notifId})
        `));
        await db.execute(sql.raw(`
          UPDATE tasks SET last_reminded_at = NOW(), reminder_count = COALESCE(reminder_count,0)+1, updated_at = NOW()
          WHERE id = ${taskId}
        `));
      }

      res.json({ ok: true, sent: notifResult.rows.length > 0 });
    } catch (err: any) {
      console.error("[tasks/remind-now]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/tasks/:id/escalate", requirePermission("crm", "edit"), async (req, res) => {
    try {
      const userId = getSessionUserId(req)!;
      const taskId = Number(req.params.id);

      const taskRes = await db.execute(sql.raw(`SELECT * FROM tasks WHERE id = ${taskId} LIMIT 1`));
      if (taskRes.rows.length === 0) return res.status(404).json({ message: "Task not found" });
      const task = taskRes.rows[0] as any;

      const newLevel = (task.escalation_level || 0) + 1;
      await db.execute(sql.raw(`
        UPDATE tasks SET escalation_level = ${newLevel}, updated_at = NOW() WHERE id = ${taskId}
      `));

      const dedupeKey = `escalate-${taskId}-${newLevel}-${new Date().toISOString().slice(0, 10)}`;
      await db.execute(sql.raw(`
        INSERT INTO notifications (user_id, type, title, body, severity, linked_object_type, linked_object_id, action_url, is_read, dedupe_key)
        VALUES (
          ${task.owner_user_id || userId},
          'task_escalation',
          'Task Escalated',
          ${sqlStr(`"${task.title}" has been escalated to level ${newLevel}.`)},
          'high',
          'task',
          ${taskId},
          '/execution/daily',
          false,
          ${sqlStr(dedupeKey)}
        )
        ON CONFLICT (dedupe_key) DO NOTHING
      `));

      await db.execute(sql.raw(`
        INSERT INTO task_reminder_logs (task_id, user_id, reminder_type, channel)
        VALUES (${taskId}, ${userId}, 'escalation', 'in_app')
      `));

      res.json({ ok: true, escalationLevel: newLevel });
    } catch (err: any) {
      console.error("[tasks/escalate]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/tasks/bulk/complete", requirePermission("crm", "edit"), async (req, res) => {
    try {
      const userId = getSessionUserId(req)!;
      const { taskIds } = req.body as { taskIds: number[] };
      if (!Array.isArray(taskIds) || taskIds.length === 0)
        return res.status(400).json({ message: "taskIds array required" });

      const ids = taskIds.map(Number).filter(Boolean);
      await db.execute(sql.raw(`
        UPDATE tasks SET status = 'completed', completed_at = NOW(), updated_at = NOW()
        WHERE id = ANY(ARRAY[${ids.join(",")}])
          AND (owner_user_id = ${userId} OR ${userId} IN (SELECT id FROM users WHERE global_role IN ('admin','master_admin')))
      `));

      res.json({ ok: true, updated: ids.length });
    } catch (err: any) {
      console.error("[tasks/bulk/complete]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/tasks/bulk/reassign", requirePermission("crm", "edit"), async (req, res) => {
    try {
      const userId = getSessionUserId(req)!;
      const { taskIds, assigneeUserId } = req.body as { taskIds: number[]; assigneeUserId: number };
      if (!Array.isArray(taskIds) || taskIds.length === 0)
        return res.status(400).json({ message: "taskIds array required" });
      if (!assigneeUserId) return res.status(400).json({ message: "assigneeUserId required" });

      const ids = taskIds.map(Number).filter(Boolean);
      const assignee = Number(assigneeUserId);

      await db.execute(sql.raw(`
        UPDATE tasks SET owner_user_id = ${assignee}, updated_at = NOW()
        WHERE id = ANY(ARRAY[${ids.join(",")}])
      `));

      const userRes = await db.execute(sql.raw(`SELECT name FROM users WHERE id = ${assignee} LIMIT 1`));
      const assigneeName = (userRes.rows[0] as any)?.name || "someone";

      for (const id of ids) {
        const dedupeKey = `reassign-${id}-${assignee}-${Date.now()}`;
        await db.execute(sql.raw(`
          INSERT INTO notifications (user_id, type, title, body, severity, linked_object_type, linked_object_id, action_url, is_read, dedupe_key)
          VALUES (
            ${assignee},
            'task_reassigned',
            'Task Assigned to You',
            ${sqlStr(`A task has been reassigned to you by ${assigneeName}.`)},
            'medium',
            'task',
            ${id},
            '/execution/daily',
            false,
            ${sqlStr(dedupeKey)}
          )
          ON CONFLICT (dedupe_key) DO NOTHING
        `));
      }

      res.json({ ok: true, updated: ids.length });
    } catch (err: any) {
      console.error("[tasks/bulk/reassign]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/tasks/bulk/snooze", requirePermission("crm", "edit"), async (req, res) => {
    try {
      const userId = getSessionUserId(req)!;
      const { taskIds, days, until } = req.body as { taskIds: number[]; days?: number; until?: string };
      if (!Array.isArray(taskIds) || taskIds.length === 0)
        return res.status(400).json({ message: "taskIds array required" });

      let snoozedUntil: Date;
      if (until) {
        snoozedUntil = new Date(until);
      } else {
        const d = days !== undefined && days !== null ? Number(days) : 1;
        if (!Number.isFinite(d) || d < 1 || d > 90) return res.status(400).json({ message: "days must be 1–90" });
        snoozedUntil = new Date(Date.now() + d * 86_400_000);
      }

      const ids = taskIds.map(Number).filter(Boolean);
      await db.execute(sql.raw(`
        UPDATE tasks SET snoozed_until = '${snoozedUntil.toISOString()}', updated_at = NOW()
        WHERE id = ANY(ARRAY[${ids.join(",")}])
          AND (owner_user_id = ${userId} OR ${userId} IN (SELECT id FROM users WHERE global_role IN ('admin','master_admin')))
      `));

      res.json({ ok: true, updated: ids.length, snoozedUntil: snoozedUntil.toISOString() });
    } catch (err: any) {
      console.error("[tasks/bulk/snooze]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Execution Settings ─────────────────────────────────────────────────────

  app.get("/api/execution/settings", requirePermission("crm", "view"), async (req, res) => {
    try {
      const userId = getSessionUserId(req)!;
      const result = await db.execute(sql.raw(
        `SELECT * FROM execution_settings WHERE user_id = ${userId} LIMIT 1`
      ));
      if (result.rows.length === 0) {
        return res.json({
          userId,
          reminderHour: 9,
          overdueEscalationDays: 3,
          maxRemindersPerDay: 3,
          managerDigestEnabled: true,
          suggestionsInDigest: true,
          bulkConfirmEnabled: true,
        });
      }
      const row = result.rows[0] as any;
      res.json({
        userId: Number(row.user_id),
        reminderHour: Number(row.reminder_hour),
        overdueEscalationDays: Number(row.overdue_escalation_days),
        maxRemindersPerDay: Number(row.max_reminders_per_day),
        managerDigestEnabled: Boolean(row.manager_digest_enabled),
        suggestionsInDigest: Boolean(row.suggestions_in_digest),
        bulkConfirmEnabled: Boolean(row.bulk_confirm_enabled),
      });
    } catch (err: any) {
      console.error("[execution/settings GET]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/execution/settings", requirePermission("crm", "edit"), async (req, res) => {
    try {
      const userId = getSessionUserId(req)!;
      const {
        reminderHour, overdueEscalationDays, maxRemindersPerDay,
        managerDigestEnabled, suggestionsInDigest, bulkConfirmEnabled
      } = req.body;

      if (reminderHour !== undefined && (reminderHour < 0 || reminderHour > 23))
        return res.status(400).json({ message: "reminderHour must be 0–23" });
      if (maxRemindersPerDay !== undefined && (maxRemindersPerDay < 1 || maxRemindersPerDay > 10))
        return res.status(400).json({ message: "maxRemindersPerDay must be 1–10" });

      const existing = await db.execute(sql.raw(
        `SELECT id FROM execution_settings WHERE user_id = ${userId} LIMIT 1`
      ));

      if (existing.rows.length === 0) {
        await db.execute(sql.raw(`
          INSERT INTO execution_settings (user_id, reminder_hour, overdue_escalation_days, max_reminders_per_day, manager_digest_enabled, suggestions_in_digest, bulk_confirm_enabled)
          VALUES (
            ${userId},
            ${reminderHour ?? 9},
            ${overdueEscalationDays ?? 3},
            ${maxRemindersPerDay ?? 3},
            ${managerDigestEnabled ?? true},
            ${suggestionsInDigest ?? true},
            ${bulkConfirmEnabled ?? true}
          )
        `));
      } else {
        const updates: string[] = [];
        if (reminderHour !== undefined) updates.push(`reminder_hour = ${Number(reminderHour)}`);
        if (overdueEscalationDays !== undefined) updates.push(`overdue_escalation_days = ${Number(overdueEscalationDays)}`);
        if (maxRemindersPerDay !== undefined) updates.push(`max_reminders_per_day = ${Number(maxRemindersPerDay)}`);
        if (managerDigestEnabled !== undefined) updates.push(`manager_digest_enabled = ${Boolean(managerDigestEnabled)}`);
        if (suggestionsInDigest !== undefined) updates.push(`suggestions_in_digest = ${Boolean(suggestionsInDigest)}`);
        if (bulkConfirmEnabled !== undefined) updates.push(`bulk_confirm_enabled = ${Boolean(bulkConfirmEnabled)}`);
        updates.push("updated_at = NOW()");
        if (updates.length > 1) {
          await db.execute(sql.raw(`UPDATE execution_settings SET ${updates.join(", ")} WHERE user_id = ${userId}`));
        }
      }

      const updated = await db.execute(sql.raw(
        `SELECT * FROM execution_settings WHERE user_id = ${userId} LIMIT 1`
      ));
      const row = updated.rows[0] as any;
      res.json({
        userId: Number(row.user_id),
        reminderHour: Number(row.reminder_hour),
        overdueEscalationDays: Number(row.overdue_escalation_days),
        maxRemindersPerDay: Number(row.max_reminders_per_day),
        managerDigestEnabled: Boolean(row.manager_digest_enabled),
        suggestionsInDigest: Boolean(row.suggestions_in_digest),
        bulkConfirmEnabled: Boolean(row.bulk_confirm_enabled),
      });
    } catch (err: any) {
      console.error("[execution/settings PUT]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Digest ─────────────────────────────────────────────────────────────────

  app.post("/api/execution/digest", requirePermission("crm", "view"), async (req, res) => {
    try {
      const userId = getSessionUserId(req)!;
      const { type, force } = req.body as { type?: string; force?: boolean };
      const digestType = (type as any) || "morning_personal";
      const validTypes = ["morning_personal", "evening_unresolved", "manager_team"];
      if (!validTypes.includes(digestType))
        return res.status(400).json({ message: "Invalid digest type" });

      const { generateDigest } = await import("./services/digest-engine");
      const payload = await generateDigest(userId, digestType, false, Boolean(force));
      if (!payload) return res.json({ skipped: true, reason: "Already delivered today" });
      res.json(payload);
    } catch (err: any) {
      console.error("[execution/digest]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Reminder trigger (manual run for a user) ───────────────────────────────

  app.post("/api/execution/run-reminders", requirePermission("crm", "edit"), async (req, res) => {
    try {
      const userId = getSessionUserId(req)!;
      const { generateRemindersForUser } = await import("./services/reminder-engine");
      const result = await generateRemindersForUser(userId);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      console.error("[execution/run-reminders]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/execution/rules", requirePermission("crm", "view"), async (req, res) => {
    try {
      const { REMINDER_RULES } = await import("./services/reminder-engine");
      const rules = REMINDER_RULES.map(({ id, label, description, reminderType, escalates, cooldownHours }) => ({
        id, label, description, reminderType, escalates, cooldownHours,
      }));
      res.json({ rules });
    } catch (err: any) {
      console.error("[execution/rules]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Task quick actions ──────────────────────────────────────────────────
  app.post("/api/tasks/:id/complete", async (req, res) => {
    try {
      const userId = getSessionUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const taskId = Number(req.params.id);
      const result = await storage.updateTask(taskId, { status: "done" });
      if (!result) return res.status(404).json({ message: "Task not found" });
      res.json({ ok: true, task: result });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/tasks/:id/snooze", async (req, res) => {
    try {
      const userId = getSessionUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const { preset, snoozedUntil } = req.body;
      const taskId = Number(req.params.id);
      let snoozeDate: Date;
      const now = new Date();
      if (preset === "later_today") {
        snoozeDate = new Date(now.getTime() + 3 * 3600_000);
      } else if (preset === "tomorrow_morning") {
        snoozeDate = new Date(now); snoozeDate.setDate(snoozeDate.getDate() + 1); snoozeDate.setHours(9,0,0,0);
      } else if (preset === "next_week") {
        snoozeDate = new Date(now); snoozeDate.setDate(snoozeDate.getDate() + 7); snoozeDate.setHours(9,0,0,0);
      } else if (snoozedUntil) {
        snoozeDate = new Date(snoozedUntil);
      } else {
        return res.status(400).json({ message: "preset or snoozedUntil required" });
      }
      const result = await storage.updateTask(taskId, { snoozedUntil: snoozeDate } as any);
      if (!result) return res.status(404).json({ message: "Task not found" });
      res.json({ ok: true, snoozedUntil: snoozeDate, task: result });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/tasks/:id/reassign", async (req, res) => {
    try {
      const userId = getSessionUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const { ownerUserId } = req.body;
      if (!ownerUserId) return res.status(400).json({ message: "ownerUserId required" });
      const taskId = Number(req.params.id);
      const result = await storage.updateTask(taskId, { ownerUserId: Number(ownerUserId) });
      if (!result) return res.status(404).json({ message: "Task not found" });
      res.json({ ok: true, task: result });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/comm-lists", async (_req, res) => {
    res.json(await storage.getCommunicationLists());
  });

  app.post("/api/comm-lists", requirePermission("communications", "edit"), async (req, res) => {
    const parsed = insertCommunicationListSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createCommunicationList(parsed.data));
  });

  app.put("/api/comm-lists/:id", requirePermission("communications", "edit"), async (req, res) => {
    const result = await storage.updateCommunicationList(Number(req.params.id), req.body);
    if (!result) return res.status(404).json({ message: "List not found" });
    res.json(result);
  });

  app.get("/api/campaigns", async (req, res) => {
    const { status } = req.query;
    res.json(await storage.getCampaignDrafts({ status: status as string | undefined }));
  });

  app.get("/api/campaigns/:id", async (req, res) => {
    const campaign = await storage.getCampaignDraft(Number(req.params.id));
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    res.json(campaign);
  });

  app.post("/api/campaigns", requirePermission("communications", "edit"), async (req, res) => {
    const parsed = insertCampaignDraftSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createCampaignDraft(parsed.data));
  });

  app.put("/api/campaigns/:id", requirePermission("communications", "edit"), async (req, res) => {
    const result = await storage.updateCampaignDraft(Number(req.params.id), req.body);
    if (!result) return res.status(404).json({ message: "Campaign not found" });
    res.json(result);
  });

  // ── Comments ──────────────────────────────────────────────────────
  app.get("/api/comments", async (req, res) => {
    const { objectType, objectId } = req.query;
    if (!objectType || !objectId) return res.status(400).json({ message: "objectType and objectId required" });
    res.json(await storage.getComments(objectType as string, Number(objectId)));
  });

  app.post("/api/comments", async (req, res) => {
    const data = {
      ...req.body,
      userId: req.session.userId,
      userName: req.session.name,
    };
    const parsed = insertCommentSchema.safeParse(data);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createComment(parsed.data));
  });

  // ── Attachments ────────────────────────────────────────────────
  app.get("/api/attachments", async (req, res) => {
    const { objectType, objectId } = req.query;
    if (!objectType || !objectId) return res.status(400).json({ message: "objectType and objectId required" });
    res.json(await storage.getAttachments(objectType as string, Number(objectId)));
  });

  app.post("/api/attachments", (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) {
        return res.status(400).json({ message: err.message || "Upload failed" });
      }
      next();
    });
  }, async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const { objectType, objectId } = req.body;
    const allowedTypes = ["lead", "account", "partnership"];
    if (!objectType || !objectId || !allowedTypes.includes(objectType)) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ message: "Valid objectType (lead/account/partnership) and objectId required" });
    }
    try {
      const attachment = await storage.createAttachment({
        objectType,
        objectId: Number(objectId),
        fileName: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        fileSize: req.file.size,
        uploadedBy: req.session.userId ?? null,
        uploadedByName: req.session.name ?? null,
      });
      res.status(201).json(attachment);
    } catch (e) {
      try { fs.unlinkSync(req.file.path); } catch {}
      res.status(500).json({ message: "Failed to save attachment" });
    }
  });

  app.get("/api/attachments/file/:fileName", async (req, res) => {
    const fileName = path.basename(req.params.fileName);
    const filePath = path.join(UPLOADS_DIR, fileName);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(UPLOADS_DIR)) return res.status(403).json({ message: "Forbidden" });
    if (!fs.existsSync(resolved)) return res.status(404).json({ message: "File not found" });
    res.sendFile(resolved);
  });

  app.delete("/api/attachments/:id", requireAuth, async (req, res) => {
    const attachment = await storage.getAttachment(Number(req.params.id));
    if (!attachment) return res.status(404).json({ message: "Attachment not found" });
    // Owner-or-admin gate.
    // uploadedBy === null means the record pre-dates ownership tracking → allow as legacy fallback.
    if (attachment.uploadedBy !== null) {
      const role = String((req.session as any).globalRole || "");
      const isAdmin = ["master_admin", "admin"].includes(role);
      const isOwner = req.session.userId === attachment.uploadedBy;
      if (!isAdmin && !isOwner) {
        return res.status(403).json({ message: "Not authorized to delete this attachment" });
      }
    }
    const filePath = path.join(UPLOADS_DIR, path.basename(attachment.fileName));
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
    await storage.deleteAttachment(attachment.id);
    res.json({ message: "Deleted" });
  });

  // ── Users List (simple, for dropdowns) ─────────────────────────
  app.get("/api/users", async (_req, res) => {
    res.json(await storage.getUsers());
  });

  // ── Admin User Management ────────────────────────────────────────
  function requireAdmin(req: any, res: any, next: any) {
    if (!req.session?.userId) return res.status(401).json({ message: "Not authenticated" });
    const role = (req.session as any).globalRole || "";
    if (!["master_admin", "admin"].includes(role)) {
      return res.status(403).json({ message: "Admin access required" });
    }
    next();
  }

  app.get("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
    const allUsers = await db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      globalRole: users.globalRole,
      status: users.status,
      userType: users.userType,
      department: users.department,
      jobTitle: users.jobTitle,
      mustChangePassword: users.mustChangePassword,
      permissions: users.permissions,
      createdAt: users.createdAt,
      lastLogin: users.lastLogin,
      suspendedAt: users.suspendedAt,
      suspendedReason: users.suspendedReason,
    }).from(users).orderBy(users.id);
    res.json(allUsers);
  });

  // PATCH /api/admin/users/:id/permissions — update granular access permissions
  const accessLevelSchema = z.enum(["none", "view", "edit"]);
  const permissionsBodySchema = z.object({
    crm: accessLevelSchema.optional(),
    partnerships: accessLevelSchema.optional(),
    projects: accessLevelSchema.optional(),
    communications: accessLevelSchema.optional(),
    team_workload: accessLevelSchema.optional(),
    knowledge: accessLevelSchema.optional(),
    support: accessLevelSchema.optional(),
    quoting: accessLevelSchema.optional(),
    calendar: accessLevelSchema.optional(),
    mail_team: z.record(z.string(), z.object({ view: z.boolean(), edit: z.boolean() })).optional(),
    calendar_team: z.array(z.number()).optional(),
  });
  app.patch("/api/admin/users/:id/permissions", requireAuth, async (req, res) => {
    try {
      const actorId = (req.session as any).userId;
      const [actor] = await db.select({ role: users.globalRole }).from(users).where(eq(users.id, actorId)).limit(1);
      if (!actor || !["master_admin", "admin"].includes(actor.role)) {
        return res.status(403).json({ message: "Admin access required" });
      }
      const targetId = parseInt(req.params.id);
      if (isNaN(targetId)) return res.status(400).json({ message: "Invalid user ID" });
      const parsed = permissionsBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid permissions payload", errors: parsed.error.issues });
      }
      const [updated] = await db.update(users).set({ permissions: parsed.data } as any).where(eq(users.id, targetId)).returning({ id: users.id, permissions: users.permissions });
      if (!updated) return res.status(404).json({ message: "User not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/admin/team-accounts — shared email inboxes (for Access tab)
  app.get("/api/admin/team-accounts", requireAuth, requireAdmin, async (req, res) => {
    try {
      const accounts = await db.select({ id: emailAccounts.id, emailAddress: emailAccounts.emailAddress, displayName: emailAccounts.displayName })
        .from(emailAccounts).where(and(eq(emailAccounts.isShared, true), eq(emailAccounts.isActive, true)));
      res.json(accounts);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/admin/team-members — active users (for calendar overlay list)
  app.get("/api/admin/team-members", requireAuth, requireAdmin, async (req, res) => {
    try {
      const members = await db.select({ id: users.id, name: users.name, email: users.email, globalRole: users.globalRole })
        .from(users).where(sql`status != 'suspended' AND status != 'deactivated'`).orderBy(users.name);
      res.json(members);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/admin/auto-confirm/dry-run
  // Always runs in dry-run mode (never writes). Returns structured sweep report:
  // pipeline state, per-candidate gate decisions, and bucketed skip reasons.
  // Access: master_admin / admin only.
  app.get("/api/admin/auto-confirm/dry-run", requireAuth, requireAdmin, async (req, res) => {
    try {
      const report = await buildSweepReport(false); // false = honour dry-run flag (always safe)
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/admin/gmail/backfill-associations
  // Backfills email_associations for all email_messages that were inserted before
  // the association engine was active — i.e. messages with no association rows yet.
  //
  // Safety properties:
  //   - Admin-only.
  //   - No schema changes. No deletions. No destructive writes.
  //   - Idempotent: the engine skips any (emailMessageId, objectType, objectId)
  //     triplet that already exists, so re-running is always safe.
  //   - Sequential: messages are processed oldest-first (sent_at ASC) to preserve
  //     thread-bonus scoring (+25 when a thread is already marked "associated").
  //   - Per-message errors are caught and reported; processing always continues.
  //   - Access: master_admin / admin only.
  app.post("/api/admin/gmail/backfill-associations", requireAuth, requireAdmin, async (req, res) => {
    const startedAt = Date.now();

    try {
      // 1. Snapshot association count before so we can diff at the end.
      const beforeResult = await db.execute(sql`SELECT COUNT(*)::int AS count FROM email_associations`);
      const countBefore = Number((beforeResult.rows[0] as any)?.count ?? 0);

      // 2. Load all messages ordered oldest-first.
      //    sent_at is the canonical timestamp; fall back to created_at for messages
      //    where sent_at is null (should not happen in practice, but defensive).
      const messages = await db
        .select({
          id: emailMessages.id,
          gmailMessageId: emailMessages.gmailMessageId,
          ignoredReason: emailMessages.ignoredReason,
          sentAt: emailMessages.sentAt,
        })
        .from(emailMessages)
        .orderBy(emailMessages.sentAt);

      let examined = 0;
      let processed = 0;
      let skipped = 0;
      const failures: { id: number; gmailMessageId: string | null; error: string }[] = [];

      // 3. Process sequentially — never concurrent, preserves thread-level ordering.
      for (const msg of messages) {
        examined++;

        // Skip messages the engine would ignore anyway (saves unnecessary DB round-trips).
        if (msg.ignoredReason) {
          skipped++;
          continue;
        }

        try {
          await runAssociationEngine(msg.id);
          processed++;
        } catch (err: any) {
          failures.push({
            id: msg.id,
            gmailMessageId: msg.gmailMessageId,
            error: err.message ?? String(err),
          });
          // Always continue — one bad message must not abort the batch.
        }
      }

      // 4. Snapshot association count after to compute diff.
      const afterResult = await db.execute(sql`SELECT COUNT(*)::int AS count FROM email_associations`);
      const countAfter = Number((afterResult.rows[0] as any)?.count ?? 0);

      const elapsedMs = Date.now() - startedAt;

      res.json({
        ok: true,
        summary: {
          examined,
          processed,
          skipped,
          failed: failures.length,
          associationsBefore: countBefore,
          associationsAfter: countAfter,
          associationsCreated: countAfter - countBefore,
          elapsedMs,
        },
        failures,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/admin/users/:id", requireAuth, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      if (isNaN(userId)) return res.status(400).json({ message: "Invalid user ID" });

      const sessionUser = await db.select().from(users).where(eq(users.id, req.session.userId!)).limit(1);
      if (!sessionUser[0]) return res.status(401).json({ message: "Not authenticated" });
      const actorRole = sessionUser[0].globalRole;
      if (!["master_admin", "admin"].includes(actorRole)) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { name, email, globalRole, status, userType, department, jobTitle, suspendedReason } = req.body;

      // Only master_admin can set master_admin role
      if (globalRole === "master_admin" && actorRole !== "master_admin") {
        return res.status(403).json({ message: "Only Master Admin can assign Master Admin role" });
      }

      // Prevent demoting or suspending the last master_admin
      if (globalRole && globalRole !== "master_admin") {
        const [existing] = await db.select({ id: users.id, globalRole: users.globalRole }).from(users).where(eq(users.id, userId));
        if (existing?.globalRole === "master_admin") {
          const masterAdmins = await db.select({ id: users.id }).from(users).where(sql`global_role = 'master_admin'`);
          if (masterAdmins.length <= 1) {
            return res.status(400).json({ message: "Cannot demote the last Master Admin" });
          }
        }
      }

      const updateData: Record<string, unknown> = {};
      if (name !== undefined) updateData.name = name;
      if (email !== undefined) updateData.email = email.toLowerCase().trim();
      if (globalRole !== undefined) updateData.globalRole = globalRole;
      if (userType !== undefined) updateData.userType = userType;
      if (department !== undefined) updateData.department = department || null;
      if (jobTitle !== undefined) updateData.jobTitle = jobTitle || null;
      if (status !== undefined) {
        updateData.status = status;
        if (status === "suspended") {
          updateData.suspendedAt = new Date();
          updateData.suspendedReason = suspendedReason || null;
        } else if (status === "active") {
          updateData.suspendedAt = null;
          updateData.suspendedReason = null;
        }
      }

      const [updated] = await db.update(users).set(updateData as any).where(eq(users.id, userId)).returning();
      if (!updated) return res.status(404).json({ message: "User not found" });
      res.json(updated);
    } catch (err: any) {
      console.error("[admin/users PUT]", err);
      res.status(500).json({ message: err?.message || "Failed to update user" });
    }
  });

  app.post("/api/admin/users", requireAuth, async (req, res) => {
    const sessionUser = await db.select().from(users).where(eq(users.id, req.session.userId!)).limit(1);
    if (!sessionUser[0]) return res.status(401).json({ message: "Not authenticated" });
    const actorRole = sessionUser[0].globalRole;
    if (!["master_admin", "admin"].includes(actorRole)) {
      return res.status(403).json({ message: "Admin access required" });
    }

    const { name, email, globalRole = "sales", userType = "internal", department, jobTitle } = req.body;
    if (!name || !email) return res.status(400).json({ message: "Name and email required" });

    const existing = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim()));
    if (existing.length > 0) return res.status(409).json({ message: "Email already in use" });

    const tempPassword = Math.random().toString(36).slice(-10) + "Aa1!";
    const hashed = await hashPassword(tempPassword);

    const [created] = await db.insert(users).values({
      name,
      email: email.toLowerCase().trim(),
      password: hashed,
      role: "read-only",
      globalRole,
      status: "invited",
      userType,
      department: department || null,
      jobTitle: jobTitle || null,
      invitedBy: req.session.userId,
      mustChangePassword: true,
    }).returning();

    // Send welcome email (non-blocking — user is created regardless of email success)
    const SYSTEM_SENDER_ID = 4; // Trevor's account used as the system sender
    const loginUrl = process.env.APP_URL || "https://image-linker-burgesstrevor76.replit.app";
    const welcomeHtml = `
<div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; color: #1a1a1a;">
  <h2 style="margin-bottom: 4px;">Welcome to VoltSafe Growth OS</h2>
  <p style="color: #555; margin-top: 0;">Hi ${name}, your account has been created.</p>
  <div style="background: #f5f5f5; border-radius: 8px; padding: 16px 20px; margin: 20px 0;">
    <p style="margin: 0 0 8px;"><strong>Login URL:</strong><br>
      <a href="${loginUrl}" style="color: #0066cc;">${loginUrl}</a>
    </p>
    <p style="margin: 0 0 8px;"><strong>Email:</strong><br>${email.toLowerCase().trim()}</p>
    <p style="margin: 0;"><strong>Temporary Password:</strong><br>
      <code style="background: #e0e0e0; padding: 2px 6px; border-radius: 4px; font-size: 15px;">${tempPassword}</code>
    </p>
  </div>
  <p style="color: #555; font-size: 14px;">When you log in for the first time, you will be prompted to set a new password of your choice.</p>
  <p style="color: #999; font-size: 12px;">If you were not expecting this email, please ignore it or contact your administrator.</p>
</div>`;

    sendEmail(SYSTEM_SENDER_ID, email.toLowerCase().trim(), "Welcome to VoltSafe Growth OS — Your Login Details", welcomeHtml)
      .catch((err) => console.error("[welcome-email] Failed to send welcome email to", email, err?.message));

    res.json({ ...created, tempPassword });
  });

  app.post("/api/admin/users/:id/resend-invite", requireAuth, async (req, res) => {
    const userId = parseInt(req.params.id);
    const sessionUser = await db.select().from(users).where(eq(users.id, req.session.userId!)).limit(1);
    if (!sessionUser[0] || !["master_admin", "admin"].includes(sessionUser[0].globalRole)) {
      return res.status(403).json({ message: "Admin access required" });
    }
    const [target] = await db.select().from(users).where(eq(users.id, userId));
    if (!target) return res.status(404).json({ message: "User not found" });

    const tempPassword = Math.random().toString(36).slice(-10) + "Aa1!";
    const hashed = await hashPassword(tempPassword);
    await db.update(users).set({ password: hashed, mustChangePassword: true } as any).where(eq(users.id, userId));

    const SYSTEM_SENDER_ID = 4;
    const loginUrl = process.env.APP_URL || "https://image-linker-burgesstrevor76.replit.app";
    const welcomeHtml = `
<div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; color: #1a1a1a;">
  <h2 style="margin-bottom: 4px;">Your VoltSafe Growth OS Login Details</h2>
  <p style="color: #555; margin-top: 0;">Hi ${target.name}, here are your updated login credentials.</p>
  <div style="background: #f5f5f5; border-radius: 8px; padding: 16px 20px; margin: 20px 0;">
    <p style="margin: 0 0 8px;"><strong>Login URL:</strong><br>
      <a href="${loginUrl}" style="color: #0066cc;">${loginUrl}</a>
    </p>
    <p style="margin: 0 0 8px;"><strong>Email:</strong><br>${target.email}</p>
    <p style="margin: 0;"><strong>Temporary Password:</strong><br>
      <code style="background: #e0e0e0; padding: 2px 6px; border-radius: 4px; font-size: 15px;">${tempPassword}</code>
    </p>
  </div>
  <p style="color: #555; font-size: 14px;">When you log in for the first time, you will be prompted to set a new password of your choice.</p>
  <p style="color: #999; font-size: 12px;">If you were not expecting this email, please ignore it or contact your administrator.</p>
</div>`;

    sendEmail(SYSTEM_SENDER_ID, target.email, "VoltSafe Growth OS — Your Login Details", welcomeHtml)
      .catch((err) => console.error("[resend-invite] Failed to send invite email to", target.email, err?.message));

    res.json({ message: "Invite resent" });
  });

  app.post("/api/admin/users/:id/suspend", requireAuth, async (req, res) => {
    const userId = parseInt(req.params.id);
    const sessionUser = await db.select().from(users).where(eq(users.id, req.session.userId!)).limit(1);
    if (!sessionUser[0] || !["master_admin", "admin"].includes(sessionUser[0].globalRole)) {
      return res.status(403).json({ message: "Admin access required" });
    }
    const [target] = await db.select().from(users).where(eq(users.id, userId));
    if (!target) return res.status(404).json({ message: "User not found" });
    if (target.globalRole === "master_admin") {
      const masters = await db.select().from(users).where(eq(users.globalRole as any, "master_admin"));
      if (masters.length <= 1) return res.status(400).json({ message: "Cannot suspend the last Master Admin" });
    }
    const [updated] = await db.update(users).set({ status: "suspended", suspendedAt: new Date(), suspendedReason: req.body.reason || null }).where(eq(users.id, userId)).returning();
    res.json(updated);
  });

  app.post("/api/admin/users/:id/activate", requireAuth, async (req, res) => {
    const userId = parseInt(req.params.id);
    const sessionUser = await db.select().from(users).where(eq(users.id, req.session.userId!)).limit(1);
    if (!sessionUser[0] || !["master_admin", "admin"].includes(sessionUser[0].globalRole)) {
      return res.status(403).json({ message: "Admin access required" });
    }
    const [updated] = await db.update(users).set({ status: "active", suspendedAt: null, suspendedReason: null }).where(eq(users.id, userId)).returning();
    res.json(updated);
  });

  app.post("/api/admin/users/:id/reset-password", requireAuth, async (req, res) => {
    const userId = parseInt(req.params.id);
    const sessionUser = await db.select().from(users).where(eq(users.id, req.session.userId!)).limit(1);
    if (!sessionUser[0] || !["master_admin", "admin"].includes(sessionUser[0].globalRole)) {
      return res.status(403).json({ message: "Admin access required" });
    }
    const newPass = req.body.newPassword;
    if (!newPass || newPass.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
    const hashed = await hashPassword(newPass);
    await db.update(users).set({ password: hashed, mustChangePassword: true }).where(eq(users.id, userId));
    res.json({ message: "Password reset" });
  });

  app.delete("/api/admin/users/:id", requireAuth, async (req, res) => {
    const userId = parseInt(req.params.id);
    const sessionUser = await db.select().from(users).where(eq(users.id, req.session.userId!)).limit(1);
    if (!sessionUser[0] || !["master_admin", "admin"].includes(sessionUser[0].globalRole)) {
      return res.status(403).json({ message: "Admin access required" });
    }
    if (userId === req.session.userId) {
      return res.status(400).json({ message: "You cannot delete your own account" });
    }
    const [target] = await db.select().from(users).where(eq(users.id, userId));
    if (!target) return res.status(404).json({ message: "User not found" });
    if (target.globalRole === "master_admin" && sessionUser[0].globalRole !== "master_admin") {
      return res.status(403).json({ message: "Only a master admin can delete another master admin" });
    }
    await db.delete(users).where(eq(users.id, userId));
    res.json({ message: "User deleted" });
  });

  // ── Team Workload ───────────────────────────────────────────────
  app.get("/api/team-workload", async (_req, res) => {
    res.json(await storage.getTeamWorkload());
  });

  // ── Partnerships ───────────────────────────────────────────────
  app.get("/api/partnerships", async (req, res) => {
    const { category, search, industryType } = req.query;
    res.json(await storage.getPartnerships({
      category: category as string | undefined,
      search: search as string | undefined,
      industryType: industryType as string | undefined,
    }));
  });
  app.get("/api/partnerships/:id", async (req, res) => {
    const p = await storage.getPartnership(Number(req.params.id));
    if (!p) return res.status(404).json({ message: "Partnership not found" });
    res.json(p);
  });
  app.post("/api/partnerships", requirePermission("partnerships", "edit"), async (req, res) => {
    const body = { ...req.body };
    if (body.startDate && typeof body.startDate === "string") body.startDate = new Date(body.startDate);
    if (body.endDate && typeof body.endDate === "string") body.endDate = new Date(body.endDate);
    if (body.trainingCompletedDate && typeof body.trainingCompletedDate === "string") body.trainingCompletedDate = new Date(body.trainingCompletedDate);
    const parsed = insertPartnershipSchema.safeParse(body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createPartnership(parsed.data));
  });
  app.put("/api/partnerships/:id", requirePermission("partnerships", "edit"), async (req, res) => {
    const body = { ...req.body };
    if (body.startDate && typeof body.startDate === "string") body.startDate = new Date(body.startDate);
    if (body.endDate && typeof body.endDate === "string") body.endDate = new Date(body.endDate);
    if (body.trainingCompletedDate && typeof body.trainingCompletedDate === "string") body.trainingCompletedDate = new Date(body.trainingCompletedDate);
    const result = await storage.updatePartnership(Number(req.params.id), body);
    if (!result) return res.status(404).json({ message: "Partnership not found" });
    res.json(result);
  });
  app.delete("/api/partnerships/:id", requirePermission("partnerships", "edit"), async (req, res) => {
    const ok = await storage.deletePartnership(Number(req.params.id));
    if (!ok) return res.status(404).json({ message: "Partnership not found" });
    res.json({ message: "Deleted" });
  });

  // ── Ecosystem Organizations ────────────────────────────────────
  app.get("/api/ecosystem/organizations", async (req, res) => {
    res.json(await storage.getEcosystemOrganizations({ search: req.query.search as string | undefined }));
  });
  app.get("/api/ecosystem/organizations/:id", async (req, res) => {
    const o = await storage.getEcosystemOrganization(Number(req.params.id));
    if (!o) return res.status(404).json({ message: "Organization not found" });
    res.json(o);
  });
  app.post("/api/ecosystem/organizations", requirePermission("partnerships", "edit"), async (req, res) => {
    const parsed = insertEcosystemOrganizationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createEcosystemOrganization(parsed.data));
  });
  app.put("/api/ecosystem/organizations/:id", requirePermission("partnerships", "edit"), async (req, res) => {
    const result = await storage.updateEcosystemOrganization(Number(req.params.id), req.body);
    if (!result) return res.status(404).json({ message: "Organization not found" });
    res.json(result);
  });
  app.delete("/api/ecosystem/organizations/:id", requirePermission("partnerships", "edit"), async (req, res) => {
    const ok = await storage.deleteEcosystemOrganization(Number(req.params.id));
    if (!ok) return res.status(404).json({ message: "Organization not found" });
    res.json({ message: "Deleted" });
  });

  // ── Ecosystem People ───────────────────────────────────────────
  app.get("/api/ecosystem/people", async (req, res) => {
    res.json(await storage.getEcosystemPeople({
      search: req.query.search as string | undefined,
      organizationId: req.query.organizationId ? Number(req.query.organizationId) : undefined,
    }));
  });
  app.get("/api/ecosystem/people/:id", async (req, res) => {
    const p = await storage.getEcosystemPerson(Number(req.params.id));
    if (!p) return res.status(404).json({ message: "Person not found" });
    res.json(p);
  });
  app.post("/api/ecosystem/people", requirePermission("partnerships", "edit"), async (req, res) => {
    const parsed = insertEcosystemPersonSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createEcosystemPerson(parsed.data));
  });
  app.put("/api/ecosystem/people/:id", requirePermission("partnerships", "edit"), async (req, res) => {
    const result = await storage.updateEcosystemPerson(Number(req.params.id), req.body);
    if (!result) return res.status(404).json({ message: "Person not found" });
    res.json(result);
  });
  app.delete("/api/ecosystem/people/:id", requirePermission("partnerships", "edit"), async (req, res) => {
    const ok = await storage.deleteEcosystemPerson(Number(req.params.id));
    if (!ok) return res.status(404).json({ message: "Person not found" });
    res.json({ message: "Deleted" });
  });

  // ── Ecosystem Relationships ────────────────────────────────────
  app.get("/api/ecosystem/relationships", async (req, res) => {
    res.json(await storage.getEcosystemRelationships({
      entityType: req.query.entityType as string | undefined,
      entityId: req.query.entityId ? Number(req.query.entityId) : undefined,
      search: req.query.search as string | undefined,
    }));
  });
  app.get("/api/ecosystem/relationships/:id", async (req, res) => {
    const r = await storage.getEcosystemRelationship(Number(req.params.id));
    if (!r) return res.status(404).json({ message: "Relationship not found" });
    res.json(r);
  });
  app.post("/api/ecosystem/relationships", requirePermission("partnerships", "edit"), async (req, res) => {
    const body = { ...req.body };
    if (body.startDate && typeof body.startDate === "string") body.startDate = new Date(body.startDate);
    const parsed = insertEcosystemRelationshipSchema.safeParse(body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createEcosystemRelationship(parsed.data));
  });
  app.put("/api/ecosystem/relationships/:id", requirePermission("partnerships", "edit"), async (req, res) => {
    const body = { ...req.body };
    if (body.startDate && typeof body.startDate === "string") body.startDate = new Date(body.startDate);
    const result = await storage.updateEcosystemRelationship(Number(req.params.id), body);
    if (!result) return res.status(404).json({ message: "Relationship not found" });
    res.json(result);
  });
  app.delete("/api/ecosystem/relationships/:id", requirePermission("partnerships", "edit"), async (req, res) => {
    const ok = await storage.deleteEcosystemRelationship(Number(req.params.id));
    if (!ok) return res.status(404).json({ message: "Relationship not found" });
    res.json({ message: "Deleted" });
  });

  // ── Ecosystem Events ───────────────────────────────────────────
  app.get("/api/ecosystem/events", async (req, res) => {
    res.json(await storage.getEcosystemEvents({ search: req.query.search as string | undefined }));
  });
  app.get("/api/ecosystem/events/:id", async (req, res) => {
    const e = await storage.getEcosystemEvent(Number(req.params.id));
    if (!e) return res.status(404).json({ message: "Event not found" });
    res.json(e);
  });
  app.post("/api/ecosystem/events", requirePermission("partnerships", "edit"), async (req, res) => {
    const body = { ...req.body };
    if (body.eventDate && typeof body.eventDate === "string") body.eventDate = new Date(body.eventDate);
    const parsed = insertEcosystemEventSchema.safeParse(body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createEcosystemEvent(parsed.data));
  });
  app.put("/api/ecosystem/events/:id", requirePermission("partnerships", "edit"), async (req, res) => {
    const body = { ...req.body };
    if (body.eventDate && typeof body.eventDate === "string") body.eventDate = new Date(body.eventDate);
    const result = await storage.updateEcosystemEvent(Number(req.params.id), body);
    if (!result) return res.status(404).json({ message: "Event not found" });
    res.json(result);
  });
  app.delete("/api/ecosystem/events/:id", requirePermission("partnerships", "edit"), async (req, res) => {
    const ok = await storage.deleteEcosystemEvent(Number(req.params.id));
    if (!ok) return res.status(404).json({ message: "Event not found" });
    res.json({ message: "Deleted" });
  });

  // ── Ecosystem Regions ──────────────────────────────────────────
  app.get("/api/ecosystem/regions", async (req, res) => {
    res.json(await storage.getEcosystemRegions({ search: req.query.search as string | undefined }));
  });
  app.get("/api/ecosystem/regions/:id", async (req, res) => {
    const r = await storage.getEcosystemRegion(Number(req.params.id));
    if (!r) return res.status(404).json({ message: "Region not found" });
    res.json(r);
  });
  app.post("/api/ecosystem/regions", requirePermission("partnerships", "edit"), async (req, res) => {
    const parsed = insertEcosystemRegionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createEcosystemRegion(parsed.data));
  });
  app.put("/api/ecosystem/regions/:id", requirePermission("partnerships", "edit"), async (req, res) => {
    const result = await storage.updateEcosystemRegion(Number(req.params.id), req.body);
    if (!result) return res.status(404).json({ message: "Region not found" });
    res.json(result);
  });
  app.delete("/api/ecosystem/regions/:id", requirePermission("partnerships", "edit"), async (req, res) => {
    const ok = await storage.deleteEcosystemRegion(Number(req.params.id));
    if (!ok) return res.status(404).json({ message: "Region not found" });
    res.json({ message: "Deleted" });
  });

  app.get("/api/calendar/events", requireAuth, async (req, res) => {
    const userId = req.session.userId!;
    const start = req.query.start ? new Date(req.query.start as string) : new Date();
    const end = req.query.end ? new Date(req.query.end as string) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const events = await storage.getCalendarEvents(userId, start, end);
    res.json(events);
  });
  // GET /api/calendar/events/team — fetch permitted team members' events
  app.get("/api/calendar/events/team", requireAuth, async (req, res) => {
    try {
      const userId = req.session!.userId;
      const { start, end, userIds } = req.query;
      if (!userIds || !start || !end) return res.status(400).json({ message: "userIds, start, end required" });

      const requestedIds = String(userIds).split(",").map(Number).filter(Boolean);
      if (requestedIds.length === 0) return res.json([]);

      const [requester] = await db.select({ globalRole: users.globalRole, permissions: users.permissions })
        .from(users).where(eq(users.id, userId)).limit(1);
      if (!requester) return res.status(401).json({ message: "Not authenticated" });

      const adminRoles = ["master_admin", "admin"];
      let permittedIds: number[];
      if (adminRoles.includes(requester.globalRole ?? "")) {
        permittedIds = requestedIds;
      } else {
        const perms = (requester.permissions as Record<string, unknown>) || {};
        const calendarTeam: number[] = Array.isArray(perms.calendar_team) ? (perms.calendar_team as number[]) : [];
        permittedIds = requestedIds.filter((id) => calendarTeam.includes(id));
      }

      if (permittedIds.length === 0) return res.json([]);

      const startDate = new Date(String(start));
      const endDate = new Date(String(end));

      const events = await db.select()
        .from(calendarEvents)
        .where(and(
          inArray(calendarEvents.userId, permittedIds),
          sql`${calendarEvents.startTime} >= ${startDate}`,
          sql`${calendarEvents.startTime} <= ${endDate}`
        ))
        .orderBy(asc(calendarEvents.startTime));

      res.json(events);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/calendar/events/:id", requireAuth, async (req, res) => {
    const event = await storage.getCalendarEvent(Number(req.params.id));
    if (!event || event.userId !== req.session.userId) return res.status(404).json({ message: "Event not found" });
    res.json(event);
  });
  app.post("/api/calendar/events", requireAuth, async (req, res) => {
    const body = { ...req.body, userId: req.session.userId };
    if (body.startTime && typeof body.startTime === "string") body.startTime = new Date(body.startTime);
    if (body.endTime && typeof body.endTime === "string") body.endTime = new Date(body.endTime);
    const parsed = insertCalendarEventSchema.safeParse(body);
    if (!parsed.success) return res.status(400).json({ message: "Validation error", errors: parsed.error.flatten() });
    const event = await storage.createCalendarEvent(parsed.data);
    res.status(201).json(event);
  });
  app.put("/api/calendar/events/:id", requireAuth, async (req, res) => {
    const existing = await storage.getCalendarEvent(Number(req.params.id));
    if (!existing || existing.userId !== req.session.userId) return res.status(404).json({ message: "Event not found" });
    const { userId, id, ...updates } = req.body;
    if (updates.startTime && typeof updates.startTime === "string") updates.startTime = new Date(updates.startTime);
    if (updates.endTime && typeof updates.endTime === "string") updates.endTime = new Date(updates.endTime);
    const result = await storage.updateCalendarEvent(Number(req.params.id), updates);
    res.json(result);
  });
  app.delete("/api/calendar/events/:id", requireAuth, async (req, res) => {
    const existing = await storage.getCalendarEvent(Number(req.params.id));
    if (!existing || existing.userId !== req.session.userId) return res.status(404).json({ message: "Event not found" });
    const ok = await storage.deleteCalendarEvent(Number(req.params.id));
    if (!ok) return res.status(404).json({ message: "Event not found" });
    res.json({ message: "Deleted" });
  });

  // ── Calendar integrations (sync providers) ─────────────────────────────────

  // List connected calendar providers for the current user
  app.get("/api/calendar/integrations", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId as number;
      const connections = await getCalendarIntegrations(userId);
      // Strip sensitive tokens before returning
      const safe = connections.map(({ accessToken: _a, refreshToken: _r, caldavPassword: _p, ...rest }) => rest);
      res.json(safe);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Get Google Calendar OAuth authorization URL
  app.get("/api/calendar/integrations/google/auth-url", requireAuth, (_req, res) => {
    try {
      const url = getCalendarAuthUrl();
      res.json({ url });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Test CalDAV connection without saving — returns discovered calendars
  app.post("/api/calendar/integrations/caldav/test", requireAuth, async (req, res) => {
    try {
      const { url, username, password } = req.body as { url: string; username: string; password: string };
      if (!url || !username || !password) {
        return res.status(400).json({ message: "url, username, and password are required" });
      }
      const result = await testCalDavConnection(url, username, password);
      if (!result.ok) {
        return res.status(400).json({ message: result.error || "Could not connect to CalDAV server" });
      }
      res.json({ ok: true, calendars: result.calendars });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Connect Apple/iCloud or generic CalDAV calendar
  app.post("/api/calendar/integrations/caldav/connect", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId as number;
      const { url, username, password, provider = "caldav", conflictResolution } = req.body as {
        url: string;
        username: string;
        password: string;
        provider?: string;
        conflictResolution?: string;
      };

      if (!url || !username || !password) {
        return res.status(400).json({ message: "url, username, and password are required" });
      }

      const test = await testCalDavConnection(url, username, password);
      if (!test.ok) {
        return res.status(400).json({ message: test.error || "Could not connect to CalDAV server" });
      }

      // Pick the first calendar as default
      const defaultCal = test.calendars[0];
      const calendarsDiscovered = test.calendars;
      const resolvedConflict = conflictResolution || "latest_wins";

      // Upsert connection
      const [existing] = await db
        .select({ id: calendarConnections.id })
        .from(calendarConnections)
        .where(and(eq(calendarConnections.userId, userId), eq(calendarConnections.provider, provider)))
        .limit(1);

      const displayName = provider === "apple"
        ? `iCloud (${username})`
        : `CalDAV (${username})`;

      if (existing) {
        await db
          .update(calendarConnections)
          .set({
            caldavUrl: url,
            caldavUsername: username,
            caldavPassword: password,
            accountEmail: username,
            displayName,
            defaultCalendarId: defaultCal?.url || url,
            defaultCalendarName: defaultCal?.name || "Calendar",
            calendarsDiscovered,
            conflictResolution: resolvedConflict,
            isActive: true,
            syncEnabled: true,
            syncError: null,
            updatedAt: new Date(),
          })
          .where(eq(calendarConnections.id, existing.id));
      } else {
        await db.insert(calendarConnections).values({
          userId,
          provider,
          caldavUrl: url,
          caldavUsername: username,
          caldavPassword: password,
          accountEmail: username,
          displayName,
          defaultCalendarId: defaultCal?.url || url,
          defaultCalendarName: defaultCal?.name || "Calendar",
          calendarsDiscovered,
          conflictResolution: resolvedConflict,
          isActive: true,
          syncEnabled: true,
          syncDirection: "pull",
        });
      }

      res.json({
        message: "CalDAV calendar connected",
        calendars: test.calendars,
        defaultCalendar: defaultCal || null,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Trigger manual sync for a calendar integration
  app.post("/api/calendar/integrations/:id/sync", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId as number;
      const connectionId = Number(req.params.id);

      const [conn] = await db
        .select({ provider: calendarConnections.provider, userId: calendarConnections.userId })
        .from(calendarConnections)
        .where(eq(calendarConnections.id, connectionId))
        .limit(1);

      if (!conn || conn.userId !== userId) {
        return res.status(404).json({ message: "Integration not found" });
      }

      let result: any;
      if (conn.provider === "google") {
        result = await syncGoogleCalendar(connectionId, userId);
      } else {
        result = await syncCalDav(connectionId, userId);
      }

      res.json({
        message: "Sync complete",
        imported: result.imported ?? 0,
        updated: result.updated ?? 0,
        pushed: result.pushed ?? 0,
        deleted: result.deleted ?? 0,
        errors: result.errors ?? [],
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Update calendar integration settings
  app.patch("/api/calendar/integrations/:id", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId as number;
      const connectionId = Number(req.params.id);

      const [conn] = await db
        .select({ userId: calendarConnections.userId })
        .from(calendarConnections)
        .where(eq(calendarConnections.id, connectionId))
        .limit(1);

      if (!conn || conn.userId !== userId) {
        return res.status(404).json({ message: "Integration not found" });
      }

      const { syncDirection, syncEnabled, syncFrequencyMinutes, defaultCalendarId, defaultCalendarName, conflictResolution } = req.body as {
        syncDirection?: string;
        syncEnabled?: boolean;
        syncFrequencyMinutes?: number;
        defaultCalendarId?: string;
        defaultCalendarName?: string;
        conflictResolution?: string;
      };

      await db
        .update(calendarConnections)
        .set({
          ...(syncDirection !== undefined && { syncDirection }),
          ...(syncEnabled !== undefined && { syncEnabled }),
          ...(syncFrequencyMinutes !== undefined && { syncFrequencyMinutes }),
          ...(defaultCalendarId !== undefined && { defaultCalendarId }),
          ...(defaultCalendarName !== undefined && { defaultCalendarName }),
          ...(conflictResolution !== undefined && { conflictResolution }),
          updatedAt: new Date(),
        })
        .where(eq(calendarConnections.id, connectionId));

      res.json({ message: "Settings updated" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Disconnect a calendar integration
  app.delete("/api/calendar/integrations/:id", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId as number;
      const connectionId = Number(req.params.id);
      await disconnectCalendarIntegration(connectionId, userId);
      res.json({ message: "Disconnected" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Calendar CRM Intelligence ─────────────────────────────────────────────

  // CRM context for a calendar event — match invitees to contacts/accounts
  app.get("/api/calendar/events/:id/crm-context", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId as number;
      const eventId = Number(req.params.id);
      const [event] = await db.select().from(calendarEvents)
        .where(and(eq(calendarEvents.id, eventId), eq(calendarEvents.userId, userId))).limit(1);
      if (!event) return res.status(404).json({ message: "Event not found" });

      const invitees: string[] = (event.invitees || []).filter(Boolean);
      const matchedContacts: any[] = [];
      const unmatchedEmails: string[] = [];
      const accountIdSet = new Set<number>();

      // Match each invitee email to a contact
      for (const email of invitees) {
        const [contact] = await db.select().from(contacts).where(eq(contacts.email, email.toLowerCase().trim())).limit(1);
        if (contact) {
          matchedContacts.push(contact);
          accountIdSet.add(contact.accountId);
        } else {
          unmatchedEmails.push(email);
        }
      }

      // Domain → account fallback for unmatched
      for (const email of unmatchedEmails) {
        const domain = email.split("@")[1];
        if (!domain || domain.includes("gmail.com") || domain.includes("outlook.com") || domain.includes("yahoo.com") || domain.includes("hotmail.com")) continue;
        const domainAccounts = await db.select({ id: accounts.id }).from(accounts)
          .where(sql`website ILIKE ${"%" + domain + "%"}`).limit(2);
        for (const a of domainAccounts) accountIdSet.add(a.id);
      }

      // Fetch matched accounts
      const matchedAccounts: any[] = [];
      for (const id of accountIdSet) {
        const [acc] = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
        if (acc) matchedAccounts.push(acc);
      }

      // Open opportunities for matched accounts
      const openOpportunities: any[] = [];
      for (const id of accountIdSet) {
        const opps = await db.select().from(opportunities)
          .where(and(eq(opportunities.accountId, id), not(eq(opportunities.stage, "closed_won")), not(eq(opportunities.stage, "closed_lost"))))
          .orderBy(desc(opportunities.updatedAt)).limit(3);
        openOpportunities.push(...opps);
      }

      // Recent emails involving these invitees
      const recentEmails: any[] = [];
      for (const email of invitees.slice(0, 3)) {
        const msgs = await db.select({
          id: emailMessages.id, subject: emailMessages.subject, fromEmail: emailMessages.fromEmail,
          sentAt: emailMessages.sentAt, direction: emailMessages.direction, snippet: emailMessages.snippet,
        }).from(emailMessages)
          .where(sql`(from_email ILIKE ${"%" + email + "%"} OR to_emails ILIKE ${"%" + email + "%"})`)
          .orderBy(desc(emailMessages.sentAt)).limit(3);
        recentEmails.push(...msgs);
      }
      const dedupedEmails = Array.from(new Map(recentEmails.map(e => [e.id, e])).values())
        .sort((a: any, b: any) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
        .slice(0, 5);

      // Open tasks for matched accounts
      const openTasks: any[] = [];
      for (const id of accountIdSet) {
        const ts = await db.select().from(tasks)
          .where(and(eq(tasks.accountId, id), eq(tasks.status, "pending")))
          .orderBy(asc(tasks.dueDate)).limit(3);
        openTasks.push(...ts);
      }

      // Recommended action
      let recommendedAction: any = null;
      const stageActions: Record<string, string> = {
        inbound_new: "Send intro email and schedule a discovery call",
        qualifying: "Complete discovery — identify pain, budget, and timeline",
        proposal: "Send proposal and follow up within 48 hours",
        negotiation: "Address objections and align on final terms",
        verbal_commit: "Get written commitment and issue contract",
      };
      if (openOpportunities.length > 0) {
        const top = openOpportunities[0];
        recommendedAction = {
          text: stageActions[top.stage] || "Advance the deal to the next stage",
          opportunityId: top.id,
          opportunityTitle: top.title,
          stage: top.stage,
        };
      } else if (matchedAccounts.length > 0) {
        const acc = matchedAccounts[0];
        const accountActions: Record<string, string> = {
          new: "Qualify this account — assess fit, size, and timing",
          contacted: "Follow up, confirm interest, and identify a champion",
          working: "Deepen the relationship and uncover a deal opportunity",
        };
        recommendedAction = {
          text: accountActions[acc.leadStatus] || "Continue relationship development",
          accountId: acc.id,
          accountName: acc.name,
        };
      } else if (unmatchedEmails.length > 0) {
        recommendedAction = {
          text: "Add these attendees to the CRM to start tracking the relationship",
          suggestCreate: true,
        };
      }

      res.json({ matchedContacts, unmatchedEmails, matchedAccounts, openOpportunities, recentEmails: dedupedEmails, openTasks, recommendedAction });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Post-meeting workflow — record notes, create tasks, advance pipeline
  app.post("/api/calendar/events/:id/post-meeting", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId as number;
      const eventId = Number(req.params.id);
      const [event] = await db.select().from(calendarEvents)
        .where(and(eq(calendarEvents.id, eventId), eq(calendarEvents.userId, userId))).limit(1);
      if (!event) return res.status(404).json({ message: "Event not found" });

      const { notes, markCompleted, createTask, taskTitle, taskDueDate, taskAccountId, opportunityId, nextStage } = req.body as {
        notes?: string; markCompleted?: boolean;
        createTask?: boolean; taskTitle?: string; taskDueDate?: string; taskAccountId?: number;
        opportunityId?: number; nextStage?: string;
      };

      const results: Record<string, any> = {};

      if (notes || markCompleted) {
        const updates: Record<string, any> = { updatedAt: new Date() };
        if (notes) {
          const dateStr = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
          const existing = event.description ? event.description + "\n\n" : "";
          updates.description = `${existing}[Meeting Notes — ${dateStr}]\n${notes}`;
        }
        if (markCompleted) updates.status = "completed";
        await db.update(calendarEvents).set(updates).where(eq(calendarEvents.id, eventId));
        results.eventUpdated = true;
      }

      if (createTask && taskTitle) {
        const task = await storage.createTask({
          title: taskTitle,
          dueDate: taskDueDate ? new Date(taskDueDate) : undefined,
          ownerUserId: userId,
          status: "pending",
          priority: "medium",
          accountId: taskAccountId || null,
          linkedObjectType: "calendar_event",
          linkedObjectId: eventId,
          createdByUserId: userId,
          aiSuggested: false,
        });
        results.task = task;
      }

      if (opportunityId && nextStage) {
        await db.update(opportunities).set({ stage: nextStage, lastActivityDate: new Date(), updatedAt: new Date() })
          .where(eq(opportunities.id, opportunityId));
        results.opportunityUpdated = true;
      }

      res.json({ message: "Post-meeting workflow applied", ...results });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Team calendar connection health (admin only)
  app.get("/api/calendar/connections/team", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId as number;
      const [me] = await db.select({ globalRole: users.globalRole }).from(users).where(eq(users.id, userId)).limit(1);
      if (!me || (me.globalRole !== "master_admin" && me.globalRole !== "admin")) {
        return res.status(403).json({ message: "Admin only" });
      }
      const allUsers = await db.select({ id: users.id, name: users.name, email: users.email, globalRole: users.globalRole }).from(users);
      const allConnections = await db.select({
        id: calendarConnections.id, userId: calendarConnections.userId,
        provider: calendarConnections.provider, displayName: calendarConnections.displayName,
        accountEmail: calendarConnections.accountEmail, isActive: calendarConnections.isActive,
        syncEnabled: calendarConnections.syncEnabled, syncDirection: calendarConnections.syncDirection,
        lastSyncedAt: calendarConnections.lastSyncedAt, syncError: calendarConnections.syncError,
      }).from(calendarConnections);
      const result = allUsers.map(u => ({
        ...u,
        connections: allConnections.filter(c => c.userId === u.id),
      }));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Calendar activity metrics for the current user
  app.get("/api/calendar/metrics", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId as number;
      const now = new Date();
      const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 7);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const [thisWeek] = await db.select({ n: count() }).from(calendarEvents)
        .where(and(eq(calendarEvents.userId, userId), gte(calendarEvents.startTime, weekStart), lte(calendarEvents.startTime, weekEnd)));
      const [completedWeek] = await db.select({ n: count() }).from(calendarEvents)
        .where(and(eq(calendarEvents.userId, userId), eq(calendarEvents.status, "completed"), gte(calendarEvents.startTime, weekStart), lte(calendarEvents.startTime, weekEnd)));
      const [upcoming] = await db.select({ n: count() }).from(calendarEvents)
        .where(and(eq(calendarEvents.userId, userId), gte(calendarEvents.startTime, now), ne(calendarEvents.status, "cancelled")));
      const [thisMonth] = await db.select({ n: count() }).from(calendarEvents)
        .where(and(eq(calendarEvents.userId, userId), gte(calendarEvents.startTime, monthStart)));
      const eventsByType = await db.select({ eventType: calendarEvents.eventType, n: count() }).from(calendarEvents)
        .where(and(eq(calendarEvents.userId, userId), gte(calendarEvents.startTime, monthStart)))
        .groupBy(calendarEvents.eventType);
      const [overdueTasks] = await db.select({ n: count() }).from(tasks)
        .where(and(eq(tasks.ownerUserId, userId), eq(tasks.status, "pending"), lte(tasks.dueDate, now)));
      const [dormantAccounts] = await db.select({ n: count() }).from(accounts)
        .where(and(
          eq(accounts.assignedToUserId, userId),
          or(isNull(accounts.lastInteractionAt), lte(accounts.lastInteractionAt, thirtyDaysAgo)),
          not(eq(accounts.leadStatus, "closed_won")),
          not(eq(accounts.leadStatus, "closed_lost")),
        ));

      res.json({
        meetingsThisWeek: Number(thisWeek?.n ?? 0),
        completedThisWeek: Number(completedWeek?.n ?? 0),
        meetingsThisMonth: Number(thisMonth?.n ?? 0),
        upcomingCount: Number(upcoming?.n ?? 0),
        overdueTasks: Number(overdueTasks?.n ?? 0),
        dormantAccounts: Number(dormantAccounts?.n ?? 0),
        eventsByType: eventsByType.map(r => ({ eventType: r.eventType, count: Number(r.n) })),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Daily Command Center ──────────────────────────────────────────────────

  // Personal Today Dashboard
  app.get("/api/dashboard/today", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId as number;
      const now = new Date();
      const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);

      const todaysMeetingsRes = await db.execute(sql.raw(
        `SELECT id, title, start_time AS "startTime", end_time AS "endTime", event_type AS "eventType", location, meeting_url AS "meetingUrl", status, invitees FROM calendar_events WHERE user_id = ${userId} AND start_time >= '${todayStart.toISOString()}' AND start_time <= '${todayEnd.toISOString()}' AND status != 'cancelled' ORDER BY start_time ASC`
      ));
      const todaysMeetings = (todaysMeetingsRes as any).rows ?? [];

      const tasksDueTodayRes = await db.execute(sql.raw(
        `SELECT id, title, due_date AS "dueDate", priority, status FROM tasks WHERE owner_user_id = ${userId} AND status = 'pending' AND due_date >= '${todayStart.toISOString()}' AND due_date <= '${todayEnd.toISOString()}' ORDER BY due_date ASC LIMIT 10`
      ));
      const tasksDueToday = (tasksDueTodayRes as any).rows ?? [];

      const overdueTasksRes = await db.execute(sql.raw(
        `SELECT id, title, due_date AS "dueDate", priority, status FROM tasks WHERE owner_user_id = ${userId} AND status = 'pending' AND due_date < '${todayStart.toISOString()}' ORDER BY due_date DESC LIMIT 10`
      ));
      const overdueTasks = (overdueTasksRes as any).rows ?? [];

      const newLeadsRes = await db.execute(sql.raw(
        `SELECT id, company, contact_name AS "contactName", contact_email AS "contactEmail", status, city, state, country, created_at AS "createdAt", deal_amount AS "dealAmount" FROM leads WHERE status = 'inbound_new' AND created_at >= '${sevenDaysAgo.toISOString()}' ORDER BY created_at DESC LIMIT 8`
      ));
      const newLeadRecords = (newLeadsRes as any).rows ?? [];

      const hotOppsRes = await db.execute(sql.raw(
        `SELECT o.id, o.title, o.stage, o.amount, o.account_id AS "accountId", o.updated_at AS "updatedAt", a.name AS "accountName" FROM opportunities o LEFT JOIN accounts a ON a.id = o.account_id WHERE o.owner_user_id = ${userId} AND o.stage NOT IN ('closed_won','closed_lost') ORDER BY o.amount DESC NULLS LAST LIMIT 6`
      ));
      const enrichedOpps = (hotOppsRes as any).rows ?? [];

      const recentActivityRes = await db.execute(sql.raw(
        `SELECT id, subject, from_email AS "fromEmail", sent_at AS "sentAt", direction, snippet FROM email_messages WHERE owner_user_id = ${userId} AND sent_at >= '${sevenDaysAgo.toISOString()}' ORDER BY sent_at DESC LIMIT 8`
      ));
      const recentActivity = (recentActivityRes as any).rows ?? [];

      const stalledOppsRes = await db.execute(sql.raw(
        `SELECT o.id, o.title, o.stage, o.account_id AS "accountId", o.last_activity_date AS "lastActivityDate", o.amount, a.name AS "accountName" FROM opportunities o LEFT JOIN accounts a ON a.id = o.account_id WHERE o.owner_user_id = ${userId} AND o.stage NOT IN ('closed_won','closed_lost') AND (o.last_activity_date IS NULL OR o.last_activity_date <= '${sevenDaysAgo.toISOString()}') ORDER BY o.amount DESC NULLS LAST LIMIT 5`
      ));
      const stalledOpps = (stalledOppsRes as any).rows ?? [];

      const suggestedActions: Array<{ type: string; text: string; link: string; priority: "high" | "medium" | "low" }> = [];

      if (overdueTasks.length > 0)
        suggestedActions.push({ type: "task", text: `You have ${overdueTasks.length} overdue task${overdueTasks.length > 1 ? "s" : ""}`, link: "/execution/team-workload", priority: "high" });

      for (const opp of stalledOpps.slice(0, 3)) {
        const daysStalled = opp.lastActivityDate ? Math.floor((now.getTime() - new Date(opp.lastActivityDate).getTime()) / 86400000) : 30;
        suggestedActions.push({ type: "opportunity", text: `Follow up on "${opp.title}" (${opp.accountName ?? ""}) — stalled ${daysStalled}d`, link: "/opportunities", priority: daysStalled > 14 ? "high" : "medium" });
      }

      if (newLeadRecords.length > 0)
        suggestedActions.push({ type: "lead", text: `${newLeadRecords.length} new lead${newLeadRecords.length > 1 ? "s" : ""} arrived this week`, link: "/opportunities", priority: "medium" });

      const nextMeetingRes = await db.execute(sql.raw(
        `SELECT id, title, start_time AS "startTime" FROM calendar_events WHERE user_id = ${userId} AND start_time >= NOW() AND start_time <= '${twoHoursFromNow.toISOString()}' AND status != 'cancelled' ORDER BY start_time ASC LIMIT 1`
      ));
      const nextMeetingRows = (nextMeetingRes as any).rows ?? [];
      if (nextMeetingRows.length > 0) {
        const mins = Math.floor((new Date(nextMeetingRows[0].startTime).getTime() - now.getTime()) / 60000);
        suggestedActions.unshift({ type: "meeting", text: `"${nextMeetingRows[0].title}" starts in ${mins} min — review briefing`, link: "/execution/calendar", priority: "high" });
      }

      res.json({
        todaysMeetings, tasksDueToday, overdueTasks, newLeads: newLeadRecords,
        hotOpportunities: enrichedOpps, recentActivity, suggestedActions,
        stats: {
          meetingsToday: todaysMeetings.length, tasksDueCount: tasksDueToday.length,
          overdueCount: overdueTasks.length, newLeadsCount: newLeadRecords.length,
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Growth OS Command Center ───────────────────────────────────────────
  app.get("/api/command-center", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId as number;
      const now = new Date();
      const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

      const [me] = await db.select({ globalRole: users.globalRole, name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
      const isAdminUser = !!me && ["master_admin", "admin"].includes(me.globalRole ?? "");
      const viewMode = (req.query.view === "team" && isAdminUser) ? "team" : "mine";
      const isMine = viewMode === "mine";

      // All users map for name lookups
      const allUsersMap = new Map<number, string>();
      const allUsersList = await db.select({ id: users.id, name: users.name }).from(users);
      for (const u of allUsersList) allUsersMap.set(u.id, u.name);

      // ── All queries via raw SQL to avoid Drizzle query builder issues ──
      const mineFilter = isMine ? userId : null;

      // Stat counts
      const openOppsRes = await db.execute(sql.raw(
        mineFilter !== null
          ? `SELECT COUNT(*)::int AS n FROM opportunities WHERE owner_user_id = ${mineFilter} AND stage NOT IN ('closed_won','closed_lost')`
          : `SELECT COUNT(*)::int AS n FROM opportunities WHERE stage NOT IN ('closed_won','closed_lost')`
      ));
      const openOpportunities = Number((openOppsRes as any).rows?.[0]?.n ?? 0);

      const hotOppsRes = await db.execute(sql.raw(
        mineFilter !== null
          ? `SELECT COUNT(*)::int AS n FROM opportunities WHERE owner_user_id = ${mineFilter} AND stage IN ('verbal_commit','negotiation','proposal')`
          : `SELECT COUNT(*)::int AS n FROM opportunities WHERE stage IN ('verbal_commit','negotiation','proposal')`
      ));
      const hotDeals = Number((hotOppsRes as any).rows?.[0]?.n ?? 0);

      const overdueRes = await db.execute(sql.raw(
        mineFilter !== null
          ? `SELECT COUNT(*)::int AS n FROM tasks WHERE owner_user_id = ${mineFilter} AND status = 'pending' AND due_date < NOW()`
          : `SELECT COUNT(*)::int AS n FROM tasks WHERE status = 'pending' AND due_date < NOW()`
      ));
      const overdueFollowUps = Number((overdueRes as any).rows?.[0]?.n ?? 0);

      const meetingsTodayRes = await db.execute(sql.raw(
        `SELECT COUNT(*)::int AS n FROM calendar_events WHERE user_id = ${userId} AND start_time >= '${todayStart.toISOString()}' AND start_time <= '${todayEnd.toISOString()}' AND status != 'cancelled'`
      ));
      const meetingsToday = Number((meetingsTodayRes as any).rows?.[0]?.n ?? 0);

      const partnersTotalRes = await db.execute(sql.raw(`SELECT COUNT(*)::int AS n FROM partnerships WHERE migration_status = 'legacy'`));
      const activePartnerships = Number((partnersTotalRes as any).rows?.[0]?.n ?? 0);

      const investorRes = await db.execute(sql.raw(`SELECT COUNT(*)::int AS n FROM partnerships WHERE migration_status = 'legacy' AND category IN ('investor','innovation_research','research')`));
      const investorConversations = Number((investorRes as any).rows?.[0]?.n ?? 0);

      const govtRes = await db.execute(sql.raw(`SELECT COUNT(*)::int AS n FROM partnerships WHERE migration_status = 'legacy' AND category IN ('government','government_public')`));
      const grantsGovt = Number((govtRes as any).rows?.[0]?.n ?? 0);

      // Today's data
      const todayMeetingsRes = await db.execute(sql.raw(
        `SELECT id, title, start_time AS "startTime", end_time AS "endTime", event_type AS "eventType", location, meeting_url AS "meetingUrl", status FROM calendar_events WHERE user_id = ${userId} AND start_time >= '${todayStart.toISOString()}' AND start_time <= '${todayEnd.toISOString()}' AND status != 'cancelled' ORDER BY start_time ASC LIMIT 8`
      ));
      const todayMeetings = (todayMeetingsRes as any).rows ?? [];

      const tasksDueTodayRes = await db.execute(sql.raw(
        mineFilter !== null
          ? `SELECT id, title, due_date AS "dueDate", priority, status FROM tasks WHERE owner_user_id = ${mineFilter} AND status = 'pending' AND due_date >= '${todayStart.toISOString()}' AND due_date <= '${todayEnd.toISOString()}' ORDER BY due_date ASC LIMIT 8`
          : `SELECT id, title, due_date AS "dueDate", priority, status FROM tasks WHERE status = 'pending' AND due_date >= '${todayStart.toISOString()}' AND due_date <= '${todayEnd.toISOString()}' ORDER BY due_date ASC LIMIT 8`
      ));
      const tasksDueToday = (tasksDueTodayRes as any).rows ?? [];

      // Needs attention
      const overdueTasksRes = await db.execute(sql.raw(
        mineFilter !== null
          ? `SELECT id, title, due_date AS "dueDate", priority FROM tasks WHERE owner_user_id = ${mineFilter} AND status = 'pending' AND due_date < NOW() ORDER BY due_date ASC LIMIT 8`
          : `SELECT id, title, due_date AS "dueDate", priority FROM tasks WHERE status = 'pending' AND due_date < NOW() ORDER BY due_date ASC LIMIT 8`
      ));
      const overdueTasksList = (overdueTasksRes as any).rows ?? [];

      const stalledRes = await db.execute(sql.raw(
        mineFilter !== null
          ? `SELECT o.id, o.title, o.stage, o.amount, o.account_id AS "accountId", o.owner_user_id AS "ownerUserId", o.last_activity_date AS "lastActivityDate", a.name AS "accountName" FROM opportunities o LEFT JOIN accounts a ON a.id = o.account_id WHERE o.owner_user_id = ${mineFilter} AND o.stage NOT IN ('closed_won','closed_lost') AND (o.last_activity_date IS NULL OR o.last_activity_date <= '${sevenDaysAgo.toISOString()}') ORDER BY o.amount DESC NULLS LAST LIMIT 8`
          : `SELECT o.id, o.title, o.stage, o.amount, o.account_id AS "accountId", o.owner_user_id AS "ownerUserId", o.last_activity_date AS "lastActivityDate", a.name AS "accountName" FROM opportunities o LEFT JOIN accounts a ON a.id = o.account_id WHERE o.stage NOT IN ('closed_won','closed_lost') AND (o.last_activity_date IS NULL OR o.last_activity_date <= '${sevenDaysAgo.toISOString()}') ORDER BY o.amount DESC NULLS LAST LIMIT 8`
      ));
      const stalledDeals = ((stalledRes as any).rows ?? []).map((o: any) => ({
        ...o,
        ownerName: o.ownerUserId ? (allUsersMap.get(o.ownerUserId) ?? "Unassigned") : "Unassigned",
        daysSinceActivity: o.lastActivityDate ? Math.floor((now.getTime() - new Date(o.lastActivityDate).getTime()) / 86400000) : 30,
      }));

      const noNextStepRes = await db.execute(sql.raw(
        mineFilter !== null
          ? `SELECT o.id, o.title, o.stage, o.amount, o.account_id AS "accountId", o.owner_user_id AS "ownerUserId", a.name AS "accountName" FROM opportunities o LEFT JOIN accounts a ON a.id = o.account_id WHERE o.owner_user_id = ${mineFilter} AND o.stage NOT IN ('closed_won','closed_lost') AND o.next_step IS NULL ORDER BY o.amount DESC NULLS LAST LIMIT 8`
          : `SELECT o.id, o.title, o.stage, o.amount, o.account_id AS "accountId", o.owner_user_id AS "ownerUserId", a.name AS "accountName" FROM opportunities o LEFT JOIN accounts a ON a.id = o.account_id WHERE o.stage NOT IN ('closed_won','closed_lost') AND o.next_step IS NULL ORDER BY o.amount DESC NULLS LAST LIMIT 8`
      ));
      const noNextStep = ((noNextStepRes as any).rows ?? []).map((o: any) => ({
        ...o,
        ownerName: o.ownerUserId ? (allUsersMap.get(o.ownerUserId) ?? "Unassigned") : "Unassigned",
      }));

      // Pipeline momentum
      const topOppsRes = await db.execute(sql.raw(
        mineFilter !== null
          ? `SELECT o.id, o.title, o.stage, o.amount, o.account_id AS "accountId", o.owner_user_id AS "ownerUserId", o.updated_at AS "updatedAt", o.est_close_date AS "estCloseDate", a.name AS "accountName" FROM opportunities o LEFT JOIN accounts a ON a.id = o.account_id WHERE o.owner_user_id = ${mineFilter} AND o.stage NOT IN ('closed_won','closed_lost') ORDER BY o.amount DESC NULLS LAST LIMIT 8`
          : `SELECT o.id, o.title, o.stage, o.amount, o.account_id AS "accountId", o.owner_user_id AS "ownerUserId", o.updated_at AS "updatedAt", o.est_close_date AS "estCloseDate", a.name AS "accountName" FROM opportunities o LEFT JOIN accounts a ON a.id = o.account_id WHERE o.stage NOT IN ('closed_won','closed_lost') ORDER BY o.amount DESC NULLS LAST LIMIT 8`
      ));
      const topOpportunities = ((topOppsRes as any).rows ?? []).map((o: any) => ({
        ...o,
        ownerName: o.ownerUserId ? (allUsersMap.get(o.ownerUserId) ?? "Unassigned") : "Unassigned",
      }));

      // Partnership activity
      const partnerRes = await db.execute(sql.raw(
        `SELECT id, name, category, strategic_importance AS "strategicImportance", priority_level AS "priorityLevel", region, updated_at AS "updatedAt" FROM partnerships ORDER BY updated_at DESC LIMIT 6`
      ));
      const partnershipActivity = (partnerRes as any).rows ?? [];

      // Recent contacts
      const contactsRes = await db.execute(sql.raw(
        `SELECT c.id, c.name, c.email, c.account_id AS "accountId", c.created_at AS "createdAt", a.name AS "accountName" FROM contacts c LEFT JOIN accounts a ON a.id = c.account_id ORDER BY c.created_at DESC LIMIT 6`
      ));
      const recentContacts = (contactsRes as any).rows ?? [];

      // Recent emails
      const emailsRes = await db.execute(sql.raw(
        `SELECT id, subject, from_email AS "fromEmail", sent_at AS "sentAt", direction, snippet FROM email_messages WHERE owner_user_id = ${userId} AND sent_at >= '${sevenDaysAgo.toISOString()}' ORDER BY sent_at DESC LIMIT 6`
      ));
      const recentEmails = (emailsRes as any).rows ?? [];

      // Upcoming meetings
      const upcomingRes = await db.execute(sql.raw(
        `SELECT id, title, start_time AS "startTime", end_time AS "endTime", location, meeting_url AS "meetingUrl" FROM calendar_events WHERE user_id = ${userId} AND start_time >= NOW() AND start_time <= '${threeDaysFromNow.toISOString()}' AND status != 'cancelled' ORDER BY start_time ASC LIMIT 6`
      ));
      const upcomingMeetings = (upcomingRes as any).rows ?? [];

      // ── Suggested Actions ─────────────────────────────────────────────
      const suggestedActions: Array<{ type: string; text: string; link: string; priority: "high" | "medium" | "low" }> = [];
      if (overdueFollowUps > 0)
        suggestedActions.push({ type: "task", text: `${overdueFollowUps} overdue task${overdueFollowUps > 1 ? "s" : ""} need attention`, link: "/execution/team-workload", priority: "high" });
      for (const d of stalledDeals.slice(0, 2))
        suggestedActions.push({ type: "opportunity", text: `Follow up on "${d.title}" — stalled ${d.daysSinceActivity}d`, link: "/opportunities", priority: d.daysSinceActivity > 14 ? "high" : "medium" });
      if (noNextStep.length > 0)
        suggestedActions.push({ type: "deal", text: `${noNextStep.length} deal${noNextStep.length > 1 ? "s" : ""} missing a next step`, link: "/pipeline", priority: "medium" });
      const nextMeeting = upcomingMeetings[0];
      if (nextMeeting) {
        const mins = Math.floor((new Date(nextMeeting.startTime).getTime() - now.getTime()) / 60000);
        if (mins > 0 && mins < 120)
          suggestedActions.unshift({ type: "meeting", text: `"${nextMeeting.title}" in ${mins} min — review briefing`, link: "/execution/calendar", priority: "high" });
      }

      res.json({
        userName: me?.name ?? "there",
        viewMode,
        isAdmin: isAdminUser,
        stats: { openOpportunities, hotDeals, overdueFollowUps, meetingsToday, activePartnerships, investorConversations, grantsGovt },
        today: { meetings: todayMeetings, tasksDue: tasksDueToday },
        needsAttention: { overdueTasks: overdueTasksList, stalledDeals, noNextStep },
        pipelineMomentum: { topOpportunities },
        partnershipActivity,
        recentRelationshipActivity: { contacts: recentContacts, emails: recentEmails },
        suggestedActions,
        intelligence: { upcomingMeetings, inboxSignals: recentEmails.filter((e: any) => e.direction === "inbound"), newContacts: recentContacts },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Daily Command Center ─────────────────────────────────────────────────
  app.get("/api/daily-command-center", requireAuth, requirePermission("crm", "view"), async (req, res) => {
    try {
      const userId = getSessionUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const [me] = await db.select({ globalRole: users.globalRole, name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
      const isAdminUser = !!me && ["master_admin", "admin"].includes(me.globalRole ?? "");
      const viewMode = (req.query.view === "team" && isAdminUser) ? "team" : "mine";
      const isMine = viewMode === "mine";
      const userFilter = isMine ? `AND t.owner_user_id = ${userId}` : "";
      const oppFilter  = isMine ? `AND o.owner_user_id = ${userId}` : "";

      // ── 1. Overdue Tasks ──────────────────────────────────────────────────
      const overdueTasksRes = await db.execute(sql.raw(`
        SELECT t.id, t.title, t.due_date, t.priority, t.status,
               t.linked_object_type, t.linked_object_id,
               EXTRACT(EPOCH FROM (NOW() - t.due_date)) / 86400 AS days_overdue,
               CASE
                 WHEN t.linked_object_type = 'account' THEN a.name
                 WHEN t.linked_object_type = 'contact' THEN c.name
                 WHEN t.linked_object_type = 'opportunity' THEN op.title
               END AS linked_object_name
        FROM tasks t
        LEFT JOIN accounts a ON t.linked_object_type = 'account' AND t.linked_object_id = a.id
        LEFT JOIN contacts c ON t.linked_object_type = 'contact' AND t.linked_object_id = c.id
        LEFT JOIN opportunities op ON t.linked_object_type = 'opportunity' AND t.linked_object_id = op.id
        WHERE t.status NOT IN ('completed','cancelled')
          AND t.due_date < NOW()
          ${userFilter}
        ORDER BY t.due_date ASC
        LIMIT 8
      `));
      const overdueTasks = (overdueTasksRes as any).rows ?? [];

      // ── 2. Signal-Based Suggested Actions (from task_suggestions) ─────────
      const suggestedActionsRes = await db.execute(sql.raw(`
        SELECT ts.id, ts.object_type, ts.object_id, ts.signal_type, ts.severity,
               ts.title, ts.reason, ts.suggested_action_type, ts.suggested_action_label,
               ts.priority, ts.suggested_due_date,
               CASE
                 WHEN ts.object_type = 'account' THEN a.name
                 WHEN ts.object_type = 'contact' THEN c.name
                 WHEN ts.object_type = 'opportunity' THEN op.title
               END AS object_name
        FROM task_suggestions ts
        LEFT JOIN accounts a ON ts.object_type = 'account' AND ts.object_id = a.id
        LEFT JOIN contacts c ON ts.object_type = 'contact' AND ts.object_id = c.id
        LEFT JOIN opportunities op ON ts.object_type = 'opportunity' AND ts.object_id = op.id
        WHERE ts.status = 'pending'
          AND (ts.snoozed_until IS NULL OR ts.snoozed_until < NOW())
          AND (ts.dismissed_at IS NULL OR ts.dismissed_at < NOW() - INTERVAL '7 days')
          AND (ts.accepted_at IS NULL OR ts.accepted_at < NOW() - INTERVAL '3 days')
        ORDER BY CASE ts.severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                 ts.created_at ASC
        LIMIT 10
      `));
      const suggestedActions = (suggestedActionsRes as any).rows ?? [];

      // ── 3. Accounts At Risk ────────────────────────────────────────────────
      const accountsAtRiskRes = await db.execute(sql.raw(`
        SELECT a.id, a.name, a.last_interaction_at, a.priority, a.strategic_importance,
               COUNT(DISTINCT o.id) AS open_deal_count,
               COALESCE(SUM(o.amount), 0) AS open_deal_value,
               EXTRACT(EPOCH FROM (NOW() - a.last_interaction_at)) / 86400 AS days_since_touch
        FROM accounts a
        LEFT JOIN opportunities o ON o.account_id = a.id
          AND o.stage NOT IN ('closed_won','closed_lost')
        WHERE (a.last_interaction_at < NOW() - INTERVAL '21 days'
               OR a.last_interaction_at IS NULL)
        GROUP BY a.id, a.name, a.last_interaction_at, a.priority, a.strategic_importance
        ORDER BY open_deal_value DESC, a.last_interaction_at ASC NULLS LAST
        LIMIT 6
      `));
      const accountsAtRisk = (accountsAtRiskRes as any).rows ?? [];

      // ── 4. Stale Opportunities ────────────────────────────────────────────
      const staleOppsRes = await db.execute(sql.raw(`
        SELECT o.id, o.title, o.stage, o.amount, o.updated_at, o.last_activity_date,
               o.est_close_date, o.account_id,
               a.name AS account_name,
               EXTRACT(EPOCH FROM (NOW() - COALESCE(o.last_activity_date, o.updated_at))) / 86400 AS days_stale
        FROM opportunities o
        LEFT JOIN accounts a ON o.account_id = a.id
        WHERE o.stage NOT IN ('closed_won','closed_lost')
          AND COALESCE(o.last_activity_date, o.updated_at) < NOW() - INTERVAL '21 days'
          ${oppFilter}
        ORDER BY o.amount DESC NULLS LAST, days_stale DESC
        LIMIT 6
      `));
      const staleOpportunities = (staleOppsRes as any).rows ?? [];

      // ── 5. Inbox Follow-Ups Needed ────────────────────────────────────────
      const inboxFollowUpsRes = await db.execute(sql.raw(`
        SELECT em.id, em.subject, em.from_email, em.from_name, em.sent_at,
               em.snippet, em.source_account_id, a.name AS account_name
        FROM email_messages em
        LEFT JOIN accounts a ON em.source_account_id = a.id
        WHERE em.direction = 'inbound'
          AND em.sent_at > NOW() - INTERVAL '14 days'
          AND NOT EXISTS (
            SELECT 1 FROM email_messages em2
            WHERE em2.source_account_id = em.source_account_id
              AND em2.source_account_id IS NOT NULL
              AND em2.direction = 'outbound'
              AND em2.sent_at > em.sent_at
          )
        ORDER BY em.sent_at DESC
        LIMIT 5
      `));
      const inboxFollowUps = (inboxFollowUpsRes as any).rows ?? [];

      // ── 6. New / Unlinked Emails ──────────────────────────────────────────
      const unlinkedEmailsRes = await db.execute(sql.raw(`
        SELECT id, subject, from_email, from_name, sent_at, snippet
        FROM email_messages
        WHERE source_account_id IS NULL
          AND direction = 'inbound'
          AND sent_at > NOW() - INTERVAL '30 days'
        ORDER BY sent_at DESC
        LIMIT 5
      `));
      const newUnlinkedEmails = (unlinkedEmailsRes as any).rows ?? [];

      // ── 7. This Week's Priorities ─────────────────────────────────────────
      const weekTasksRes = await db.execute(sql.raw(`
        SELECT t.id, t.title, t.due_date, t.priority, t.status,
               t.linked_object_type, t.linked_object_id
        FROM tasks t
        WHERE t.status NOT IN ('completed','cancelled')
          AND t.due_date BETWEEN NOW() AND NOW() + INTERVAL '7 days'
          ${userFilter}
        ORDER BY t.due_date ASC, t.priority DESC
        LIMIT 8
      `));
      const weekTasks = (weekTasksRes as any).rows ?? [];

      const weekMeetingsRes = await db.execute(sql.raw(`
        SELECT id, title, start_time, end_time, location, meeting_url, event_type
        FROM calendar_events
        WHERE start_time BETWEEN NOW() AND NOW() + INTERVAL '7 days'
          AND user_id = ${userId}
        ORDER BY start_time ASC
        LIMIT 8
      `));
      const weekMeetings = (weekMeetingsRes as any).rows ?? [];

      // ── Compute section severity levels for items that need it ────────────
      const taggedOverdue = overdueTasks.map((t: any) => ({
        ...t,
        severity: Number(t.days_overdue) > 7 ? "high" : Number(t.days_overdue) > 3 ? "medium" : "low",
        deepLink: t.linked_object_type && t.linked_object_id
          ? `/${t.linked_object_type}s/${t.linked_object_id}`
          : "/tasks",
      }));

      const taggedAtRisk = accountsAtRisk.map((a: any) => ({
        ...a,
        severity: Number(a.days_since_touch) > 45 ? "high" : Number(a.days_since_touch) > 30 ? "medium" : "low",
        deepLink: `/accounts/${a.id}`,
      }));

      const taggedStale = staleOpportunities.map((o: any) => ({
        ...o,
        severity: Number(o.amount) > 10000 ? "high" : Number(o.amount) > 2000 ? "medium" : "low",
        deepLink: `/opportunities/${o.id}`,
      }));

      const taggedSuggested = suggestedActions.map((s: any) => ({
        ...s,
        deepLink: s.object_type && s.object_id
          ? `/${s.object_type}s/${s.object_id}`
          : "/",
      }));

      const taggedFollowUps = inboxFollowUps.map((e: any) => ({
        ...e,
        severity: "high",
        deepLink: e.source_account_id ? `/accounts/${e.source_account_id}` : "/",
      }));

      res.json({
        userName: me?.name?.split(" ")[0] ?? "there",
        viewMode,
        isAdmin: isAdminUser,
        sections: {
          overdueTasks: { count: taggedOverdue.length, items: taggedOverdue },
          suggestedActions: { count: taggedSuggested.length, items: taggedSuggested },
          accountsAtRisk: { count: taggedAtRisk.length, items: taggedAtRisk },
          staleOpportunities: { count: taggedStale.length, items: taggedStale },
          inboxFollowUps: { count: taggedFollowUps.length, items: taggedFollowUps },
          newUnlinkedEmails: { count: newUnlinkedEmails.length, items: newUnlinkedEmails },
          thisWeekPriorities: {
            count: weekTasks.length + weekMeetings.length,
            tasks: weekTasks,
            meetings: weekMeetings,
          },
        },
        generatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Pipeline insights — stalled deals, no next step, forecast
  app.get("/api/pipeline/insights", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId as number;
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const [meRow] = await db.select({ globalRole: users.globalRole }).from(users).where(eq(users.id, userId)).limit(1);
      const isAdminUser = !!meRow && ["master_admin", "admin"].includes(meRow.globalRole ?? "");

      const ownerClause = isAdminUser ? "" : `AND o.owner_user_id = ${userId}`;

      const allActiveRes = await db.execute(sql.raw(
        `SELECT o.id, o.title, o.stage, o.amount, o.account_id AS "accountId", o.owner_user_id AS "ownerUserId", o.last_activity_date AS "lastActivityDate", o.updated_at AS "updatedAt", o.created_at AS "createdAt", a.name AS "accountName" FROM opportunities o LEFT JOIN accounts a ON a.id = o.account_id WHERE o.stage NOT IN ('closed_won','closed_lost') ${ownerClause} ORDER BY o.amount DESC NULLS LAST`
      ));
      const allActiveRaw: any[] = (allActiveRes as any).rows ?? [];

      const userMap = new Map<number, string>();
      const allUsers = await db.select({ id: users.id, name: users.name }).from(users);
      for (const u of allUsers) userMap.set(u.id, u.name);

      const enriched = allActiveRaw.map(o => ({
        ...o,
        ownerName: o.ownerUserId ? (userMap.get(o.ownerUserId) ?? "Unassigned") : "Unassigned",
        daysSinceActivity: o.lastActivityDate
          ? Math.floor((now.getTime() - new Date(o.lastActivityDate).getTime()) / 86400000)
          : Math.floor((now.getTime() - new Date(o.updatedAt).getTime()) / 86400000),
      }));

      const stalled = enriched.filter(o => o.daysSinceActivity >= 7);
      const noNextStep = enriched.filter(o => o.daysSinceActivity >= 3 && o.stage !== "verbal_commit");
      const amounts = enriched.map(o => o.amount ?? 0).sort((a: number, b: number) => b - a);
      const p75 = amounts[Math.floor(amounts.length * 0.25)] ?? 0;
      const highValueInactive = enriched.filter(o => (o.amount ?? 0) >= p75 && o.daysSinceActivity >= 14);

      const STAGE_PROBABILITY: Record<string, number> = {
        inbound_new: 10, qualifying: 20, proposal: 40, negotiation: 65, verbal_commit: 85,
      };
      const byStage = Object.entries(STAGE_PROBABILITY).map(([stage, prob]) => {
        const stageOpps = enriched.filter(o => o.stage === stage);
        const totalAmount = stageOpps.reduce((sum: number, o: any) => sum + (o.amount ?? 0), 0);
        return { stage, probability: prob, count: stageOpps.length, totalAmount, weightedAmount: Math.round(totalAmount * prob / 100) };
      });

      const byOwner = Array.from(
        enriched.reduce((map: Map<string, any>, o: any) => {
          const name = o.ownerName;
          const entry = map.get(name) ?? { owner: name, count: 0, totalAmount: 0, stalled: 0 };
          entry.count++;
          entry.totalAmount += o.amount ?? 0;
          if (o.daysSinceActivity >= 7) entry.stalled++;
          return map.set(name, entry);
        }, new Map<string, any>())
      ).map(([, v]) => v).sort((a: any, b: any) => b.totalAmount - a.totalAmount);

      res.json({ stalled, noNextStep, highValueInactive, byStage, byOwner, totalActive: enriched.length, totalPipeline: enriched.reduce((s: number, o: any) => s + (o.amount ?? 0), 0) });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Notification generation helper ──────────────────────────────────────
  // Deterministic, deduped: runs on every GET /api/notifications call.
  // Cooldown: a notification with the same dedupe_key won't be recreated
  // within 24 hours (for daily types) or 7 days (for weekly types).
  // Old notifications expire after 7 days.
  async function generateNotifications(userId: number): Promise<void> {
    const now = new Date();
    const iso = (d: Date) => d.toISOString();
    const sevenDaysAgo  = new Date(now.getTime() - 7  * 86400_000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400_000);
    const twoHoursFrom  = new Date(now.getTime() + 2  * 3600_000);
    const oneDayAgo     = new Date(now.getTime() - 86400_000);
    const expiry        = new Date(now.getTime() + 7  * 86400_000);
    const todayKey      = now.toISOString().slice(0, 10);
    const weekKey       = `${now.getFullYear()}-W${Math.ceil(now.getDate() / 7)}`;

    // Fetch existing dedupe keys for this user (created in last 24h) to skip duplicates
    const existingRes = await db.execute(sql.raw(
      `SELECT dedupe_key FROM notifications WHERE user_id = ${userId} AND dedupe_key IS NOT NULL AND created_at >= '${iso(oneDayAgo)}'`
    ));
    const existingKeys = new Set<string>((existingRes as any).rows.map((r: any) => r.dedupe_key));

    // Also fetch weekly dedupe keys (created in last 7 days)
    const existingWeeklyRes = await db.execute(sql.raw(
      `SELECT dedupe_key FROM notifications WHERE user_id = ${userId} AND dedupe_key IS NOT NULL AND created_at >= '${iso(sevenDaysAgo)}'`
    ));
    const existingWeeklyKeys = new Set<string>((existingWeeklyRes as any).rows.map((r: any) => r.dedupe_key));

    const toInsert: Array<{
      userId: number; type: string; title: string; body: string;
      severity: string; linkedObjectType?: string; linkedObjectId?: number;
      actionUrl: string; dedupeKey: string; expiresAt: Date;
    }> = [];

    const maybeAdd = (key: string, row: typeof toInsert[0], weekly = false) => {
      const seen = weekly ? existingWeeklyKeys : existingKeys;
      if (!seen.has(key)) toInsert.push({ ...row, dedupeKey: key, expiresAt: expiry });
    };

    // 1. OVERDUE TASKS — per task, daily cooldown
    const overdueRes = await db.execute(sql.raw(
      `SELECT id, title FROM tasks WHERE owner_user_id = ${userId} AND status NOT IN ('done','completed') AND due_date < NOW() ORDER BY due_date ASC LIMIT 10`
    ));
    for (const t of (overdueRes as any).rows ?? []) {
      maybeAdd(`overdue-task-${t.id}-${todayKey}`, {
        userId, type: "overdue_task", severity: "high",
        title: "Overdue Task", body: `"${t.title}" is past due`,
        linkedObjectType: "task", linkedObjectId: Number(t.id),
        actionUrl: "/execution/team-workload",
      });
    }

    // 2. TASK REMINDERS — fire when reminder_at has passed, daily cooldown
    const reminderRes = await db.execute(sql.raw(
      `SELECT id, title FROM tasks WHERE owner_user_id = ${userId} AND reminder_at IS NOT NULL AND reminder_at <= NOW() AND status NOT IN ('done','completed') LIMIT 10`
    ));
    for (const t of (reminderRes as any).rows ?? []) {
      maybeAdd(`reminder-task-${t.id}-${todayKey}`, {
        userId, type: "reminder", severity: "high",
        title: "Reminder", body: `"${t.title}" — your reminder is due`,
        linkedObjectType: "task", linkedObjectId: Number(t.id),
        actionUrl: "/execution/team-workload",
      });
    }

    // 3. STALE OPPORTUNITIES — no activity in 7+ days, weekly cooldown
    const staleOppRes = await db.execute(sql.raw(
      `SELECT id, title, amount FROM opportunities WHERE owner_user_id = ${userId} AND stage NOT IN ('closed_won','closed_lost') AND (last_activity_date IS NULL OR last_activity_date <= '${iso(sevenDaysAgo)}') ORDER BY amount DESC NULLS LAST LIMIT 5`
    ));
    const staleOpps: any[] = (staleOppRes as any).rows ?? [];
    if (staleOpps.length > 0) {
      const top = staleOpps[0];
      maybeAdd(`stale-opp-${top.id}-${weekKey}`, {
        userId, type: "stale_opportunity", severity: "high",
        title: "Stalled Deal",
        body: `"${top.title}" has had no activity in 7+ days${staleOpps.length > 1 ? ` (+${staleOpps.length - 1} more)` : ""}`,
        linkedObjectType: "opportunity", linkedObjectId: Number(top.id),
        actionUrl: "/pipeline",
      }, true);
    }

    // 4. ACCOUNT AT RISK — open deals, no contact in 30+ days, weekly cooldown
    const atRiskRes = await db.execute(sql.raw(
      `SELECT DISTINCT a.id, a.name, a.last_interaction_at FROM accounts a
       JOIN opportunities o ON o.account_id = a.id
       WHERE o.stage NOT IN ('closed_won','closed_lost')
         AND o.owner_user_id = ${userId}
         AND (a.last_interaction_at IS NULL OR a.last_interaction_at <= '${iso(thirtyDaysAgo)}')
       ORDER BY a.last_interaction_at ASC NULLS FIRST LIMIT 3`
    ));
    for (const a of (atRiskRes as any).rows ?? []) {
      maybeAdd(`account-at-risk-${a.id}-${weekKey}`, {
        userId, type: "account_at_risk", severity: "high",
        title: "Account at Risk",
        body: `${a.name} has open deals but no activity in 30+ days`,
        linkedObjectType: "account", linkedObjectId: Number(a.id),
        actionUrl: `/accounts/${a.id}`,
      }, true);
    }

    // 5. INBOX FOLLOW-UP NEEDED — inbound email >24h old with no outbound reply, daily cooldown
    const followupRes = await db.execute(sql.raw(
      `SELECT m.id, m.subject, m.from_email AS "fromEmail", m.gmail_thread_id AS "threadId"
       FROM email_messages m
       WHERE m.owner_user_id = ${userId}
         AND m.direction = 'inbound'
         AND m.sent_at <= '${iso(oneDayAgo)}'
         AND m.sent_at >= '${iso(sevenDaysAgo)}'
         AND NOT EXISTS (
           SELECT 1 FROM email_messages r
           WHERE r.owner_user_id = ${userId}
             AND r.direction = 'outbound'
             AND r.gmail_thread_id = m.gmail_thread_id
             AND r.sent_at > m.sent_at
         )
       ORDER BY m.sent_at DESC LIMIT 3`
    ));
    for (const e of (followupRes as any).rows ?? []) {
      maybeAdd(`followup-email-${e.id}-${todayKey}`, {
        userId, type: "inbox_followup_needed", severity: "medium",
        title: "Follow-Up Needed",
        body: `${e.fromEmail}: "${e.subject || "(no subject)"}" — no reply yet`,
        actionUrl: `/gmail`,
      });
    }

    // 6. UPCOMING MEETING — within 2 hours, daily cooldown
    const meetingRes = await db.execute(sql.raw(
      `SELECT id, title, start_time AS "startTime" FROM calendar_events WHERE user_id = ${userId} AND start_time >= NOW() AND start_time <= '${iso(twoHoursFrom)}' AND status != 'cancelled' ORDER BY start_time ASC LIMIT 3`
    ));
    for (const m of (meetingRes as any).rows ?? []) {
      const mins = Math.floor((new Date(m.startTime).getTime() - now.getTime()) / 60000);
      maybeAdd(`meeting-${m.id}-${todayKey}`, {
        userId, type: "meeting", severity: "high",
        title: "Upcoming Meeting",
        body: `"${m.title}" in ${mins} min`,
        linkedObjectType: "event", linkedObjectId: Number(m.id),
        actionUrl: "/calendar",
      });
    }

    // 7. NEW INBOUND LEADS — weekly cooldown
    const newLeadRes = await db.execute(sql.raw(
      `SELECT COUNT(*)::int AS n FROM leads WHERE status = 'inbound_new' AND created_at >= '${iso(sevenDaysAgo)}'`
    ));
    const newLeadN = Number((newLeadRes as any).rows?.[0]?.n ?? 0);
    if (newLeadN > 0) {
      maybeAdd(`new-leads-${weekKey}`, {
        userId, type: "lead", severity: "medium",
        title: "New Leads",
        body: `${newLeadN} new inbound lead${newLeadN > 1 ? "s" : ""} this week`,
        actionUrl: "/opportunities",
      }, true);
    }

    // Batch insert all new notifications
    if (toInsert.length > 0) {
      const vals = toInsert.map(n =>
        `(${n.userId}, '${n.type.replace(/'/g, "''")}', '${n.title.replace(/'/g, "''")}', '${n.body.replace(/'/g, "''")}', '${n.severity}', ${n.linkedObjectType ? `'${n.linkedObjectType}'` : "NULL"}, ${n.linkedObjectId ?? "NULL"}, '${n.actionUrl.replace(/'/g, "''")}', false, '${n.dedupeKey.replace(/'/g, "''")}', '${n.expiresAt.toISOString()}', NOW())`
      ).join(",\n");
      await db.execute(sql.raw(
        `INSERT INTO notifications (user_id, type, title, body, severity, linked_object_type, linked_object_id, action_url, is_read, dedupe_key, expires_at, created_at) VALUES ${vals}`
      ));
    }

    // Clean up expired notifications
    await db.execute(sql.raw(
      `DELETE FROM notifications WHERE user_id = ${userId} AND expires_at < NOW()`
    ));
  }

  // GET /api/notifications — run generator then return recent notifications
  app.get("/api/notifications", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId as number;
      await generateNotifications(userId);

      const rows = await db.execute(sql.raw(
        `SELECT id, user_id AS "userId", type, title, body, severity, linked_object_type AS "linkedObjectType", linked_object_id AS "linkedObjectId", action_url AS "actionUrl", is_read AS "isRead", dedupe_key AS "dedupeKey", created_at AS "createdAt"
         FROM notifications WHERE user_id = ${userId}
         ORDER BY is_read ASC, severity = 'high' DESC, created_at DESC LIMIT 30`
      ));
      const notifs: any[] = (rows as any).rows ?? [];
      const unreadCount = notifs.filter(n => !n.isRead).length;

      res.json({ notifications: notifs, unreadCount });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PATCH /api/notifications/:id/read — mark single notification as read
  app.patch("/api/notifications/:id/read", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId as number;
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
      await db.execute(sql.raw(
        `UPDATE notifications SET is_read = true WHERE id = ${id} AND user_id = ${userId}`
      ));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PATCH /api/notifications/read-all — mark all user notifications as read
  app.patch("/api/notifications/read-all", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId as number;
      await db.execute(sql.raw(
        `UPDATE notifications SET is_read = true WHERE user_id = ${userId} AND is_read = false`
      ));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/tasks/:id/reminder — set or update reminder on a task
  app.post("/api/tasks/:id/reminder", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId as number;
      const taskId = Number(req.params.id);
      if (isNaN(taskId)) return res.status(400).json({ message: "Invalid task id" });

      const { preset, reminderAt } = req.body as { preset?: string; reminderAt?: string };
      let reminderDate: Date;

      if (preset) {
        const now = new Date();
        if (preset === "later_today") {
          reminderDate = new Date(now.getTime() + 3 * 3600_000); // 3 hours from now
        } else if (preset === "tomorrow_morning") {
          reminderDate = new Date(now);
          reminderDate.setDate(reminderDate.getDate() + 1);
          reminderDate.setHours(9, 0, 0, 0);
        } else if (preset === "next_week") {
          reminderDate = new Date(now);
          reminderDate.setDate(reminderDate.getDate() + 7);
          reminderDate.setHours(9, 0, 0, 0);
        } else {
          return res.status(400).json({ message: "Invalid preset. Use: later_today | tomorrow_morning | next_week" });
        }
      } else if (reminderAt) {
        reminderDate = new Date(reminderAt);
        if (isNaN(reminderDate.getTime())) return res.status(400).json({ message: "Invalid reminderAt date" });
      } else {
        return res.status(400).json({ message: "Provide preset or reminderAt" });
      }

      // Verify the task belongs to this user
      const taskCheck = await db.execute(sql.raw(
        `SELECT id FROM tasks WHERE id = ${taskId} AND owner_user_id = ${userId}`
      ));
      if (!(taskCheck as any).rows?.length) return res.status(404).json({ message: "Task not found" });

      await db.execute(sql.raw(
        `UPDATE tasks SET reminder_at = '${reminderDate.toISOString()}', updated_at = NOW() WHERE id = ${taskId}`
      ));

      // Clear any existing reminder notification so it re-fires when the time comes
      await db.execute(sql.raw(
        `DELETE FROM notifications WHERE user_id = ${userId} AND type = 'reminder' AND linked_object_id = ${taskId}`
      ));

      res.json({ ok: true, reminderAt: reminderDate.toISOString() });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // DELETE /api/tasks/:id/reminder — clear reminder from a task
  app.delete("/api/tasks/:id/reminder", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId as number;
      const taskId = Number(req.params.id);
      if (isNaN(taskId)) return res.status(400).json({ message: "Invalid task id" });
      await db.execute(sql.raw(`UPDATE tasks SET reminder_at = NULL, updated_at = NOW() WHERE id = ${taskId} AND owner_user_id = ${userId}`));
      await db.execute(sql.raw(`DELETE FROM notifications WHERE user_id = ${userId} AND type = 'reminder' AND linked_object_id = ${taskId}`));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/notifications/digest — today's high-signal summary
  app.get("/api/notifications/digest", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId as number;
      await generateNotifications(userId);

      const rows = await db.execute(sql.raw(
        `SELECT type, severity, COUNT(*)::int AS count
         FROM notifications WHERE user_id = ${userId} AND is_read = false
         GROUP BY type, severity ORDER BY severity = 'high' DESC, count DESC`
      ));
      const summary: any[] = (rows as any).rows ?? [];
      const totalUnread = summary.reduce((s, r) => s + Number(r.count), 0);

      // Top 3 most urgent unread
      const topRows = await db.execute(sql.raw(
        `SELECT id, type, title, body, severity, action_url AS "actionUrl", created_at AS "createdAt"
         FROM notifications WHERE user_id = ${userId} AND is_read = false
         ORDER BY severity = 'high' DESC, created_at DESC LIMIT 3`
      ));

      res.json({ totalUnread, summary, topAlerts: (topRows as any).rows ?? [] });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // AI Meeting Briefing
  app.post("/api/calendar/events/:id/briefing", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId as number;
      const now = new Date();
      const eventId = Number(req.params.id);
      const [event] = await db.select().from(calendarEvents)
        .where(and(eq(calendarEvents.id, eventId), eq(calendarEvents.userId, userId))).limit(1);
      if (!event) return res.status(404).json({ message: "Event not found" });

      const invitees: string[] = (event.invitees || []).filter(Boolean);

      // Build CRM context
      const matchedContactsList: string[] = [];
      const accountNames: string[] = [];
      const accountIdSet = new Set<number>();

      for (const email of invitees) {
        const [contact] = await db.select({ name: contacts.name, title: contacts.title, accountId: contacts.accountId }).from(contacts).where(eq(contacts.email, email.toLowerCase())).limit(1);
        if (contact) {
          const [acc] = await db.select({ name: accounts.name, segment: accounts.segment, leadStatus: accounts.leadStatus }).from(accounts).where(eq(accounts.id, contact.accountId)).limit(1);
          matchedContactsList.push(`${contact.name}${contact.title ? ` (${contact.title})` : ""} at ${acc?.name ?? "Unknown"}`);
          if (acc) { accountNames.push(`${acc.name} — ${acc.segment ?? ""}, status: ${acc.leadStatus ?? "unknown"}`); accountIdSet.add(contact.accountId); }
        } else {
          const domain = email.split("@")[1];
          if (domain && !["gmail.com","outlook.com","yahoo.com","hotmail.com"].includes(domain)) {
            const [acc] = await db.select({ id: accounts.id, name: accounts.name, segment: accounts.segment, leadStatus: accounts.leadStatus }).from(accounts).where(sql`website ILIKE ${"%" + domain + "%"}`).limit(1);
            if (acc) { accountNames.push(`${acc.name} — ${acc.segment ?? ""}, status: ${acc.leadStatus ?? "unknown"}`); accountIdSet.add(acc.id); }
            else matchedContactsList.push(`Unknown (${email})`);
          } else {
            matchedContactsList.push(`Unknown (${email})`);
          }
        }
      }

      // Open opportunities
      const oppLines: string[] = [];
      for (const id of accountIdSet) {
        const opps = await db.select({ title: opportunities.title, stage: opportunities.stage, amount: opportunities.amount }).from(opportunities)
          .where(and(eq(opportunities.accountId, id), not(eq(opportunities.stage, "closed_won")), not(eq(opportunities.stage, "closed_lost")))).limit(3);
        for (const o of opps) oppLines.push(`"${o.title}" — stage: ${o.stage}, value: $${(o.amount ?? 0).toLocaleString()}`);
      }

      // Recent emails
      const emailLines: string[] = [];
      for (const email of invitees.slice(0, 2)) {
        const msgs = await db.select({ subject: emailMessages.subject, direction: emailMessages.direction, sentAt: emailMessages.sentAt, snippet: emailMessages.snippet })
          .from(emailMessages).where(sql`(from_email ILIKE ${"%" + email + "%"} OR to_emails ILIKE ${"%" + email + "%"})`).orderBy(desc(emailMessages.sentAt)).limit(3);
        for (const m of msgs) emailLines.push(`[${m.direction}] ${m.subject ?? "(no subject)"} on ${m.sentAt ? new Date(m.sentAt).toLocaleDateString() : "?"}${m.snippet ? " — " + m.snippet.substring(0, 80) : ""}`);
      }

      // Build prompt
      const { openai } = await import("./replit_integrations/audio/client");
      const prompt = `You are an expert sales strategist preparing a briefing for a B2B sales meeting at VoltSafe (marine EV charging company).

MEETING: "${event.title}"
DATE: ${new Date(event.startTime).toLocaleString()}
${event.description ? `NOTES: ${event.description.substring(0, 300)}` : ""}

ATTENDEES: ${matchedContactsList.length > 0 ? matchedContactsList.join("; ") : "Unknown"}

ACCOUNTS: ${accountNames.length > 0 ? accountNames.join(" | ") : "Not in CRM"}

OPEN DEALS: ${oppLines.length > 0 ? oppLines.join(" | ") : "None found"}

RECENT EMAILS: ${emailLines.length > 0 ? emailLines.join(" | ") : "None found"}

Generate a concise pre-meeting briefing in JSON format with these exact keys:
{
  "context": "2-3 sentence company/relationship summary",
  "talkingPoints": ["point 1", "point 2", "point 3", "point 4"],
  "risks": ["risk 1", "risk 2"],
  "desiredOutcome": "single sentence — the #1 goal of this meeting",
  "openingQuestion": "a strong opening question to ask the prospect"
}`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 600,
        temperature: 0.5,
      });

      const briefing = JSON.parse(completion.choices[0].message.content ?? "{}");
      res.json({ ...briefing, generatedAt: now.toISOString() });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Gmail mailbox isolation helper (Phase 1) ─────────────────────────────
  // Returns the user's own active email_accounts record (first one found).
  async function getUserGmailAccount(userId: number) {
    const [acct] = await db
      .select()
      .from(emailAccounts)
      .where(and(eq(emailAccounts.userId, userId), eq(emailAccounts.isActive, true)))
      .limit(1);
    return acct ?? null;
  }

  // Returns the IDs of email accounts accessible to a user.
  // Admins see all shared accounts; non-admins only see shared accounts
  // they have been explicitly granted view permission for via mail_team permissions.
  async function getAccessibleAccountIds(
    userId: number,
    isAdmin: boolean,
    mailTeamPerms: Record<string, { view: boolean; edit: boolean }> = {},
  ): Promise<number[]> {
    const [ownAccts, sharedAccts] = await Promise.all([
      db.select({ id: emailAccounts.id }).from(emailAccounts)
        .where(and(eq(emailAccounts.userId, userId), eq(emailAccounts.isActive, true))),
      db.select({ id: emailAccounts.id }).from(emailAccounts)
        .where(and(eq(emailAccounts.isShared, true), eq(emailAccounts.isActive, true))),
    ]);
    const ownIds = ownAccts.map((a) => a.id);
    const sharedIds = isAdmin
      ? sharedAccts.map((a) => a.id)
      : sharedAccts.filter((a) => mailTeamPerms[String(a.id)]?.view === true).map((a) => a.id);
    return [...new Set([...ownIds, ...sharedIds])];
  }

  async function getAccessibleAccounts(
    userId: number,
    isAdmin = false,
    mailTeamPerms: Record<string, { view: boolean; edit: boolean }> = {},
  ) {
    const allSharedCondition = and(eq(emailAccounts.isActive, true), eq(emailAccounts.isShared, true));
    const [ownAccts, sharedAccts] = await Promise.all([
      db.select().from(emailAccounts)
        .where(and(eq(emailAccounts.isActive, true), eq(emailAccounts.userId, userId))),
      db.select().from(emailAccounts).where(allSharedCondition),
    ]);
    const visibleShared = isAdmin
      ? sharedAccts
      : sharedAccts.filter((a) => mailTeamPerms[String(a.id)]?.view === true);
    return [...ownAccts, ...visibleShared];
  }

  // Resolves which account to use for a Gmail API request.
  // If asAccountId is provided AND the account is accessible (owned OR shared+permitted), use it.
  // Returns { userId, accountId } — userId is used only as a fallback context,
  // accountId drives getGmailClient when set.
  async function resolveAccount(
    currentUserId: number,
    asAccountId?: number,
    isAdmin = false,
    mailTeamPerms: Record<string, { view: boolean; edit: boolean }> = {},
  ) {
    if (asAccountId) {
      const [acct] = await db
        .select()
        .from(emailAccounts)
        .where(eq(emailAccounts.id, asAccountId))
        .limit(1);
      if (!acct || !acct.isActive) return null;
      if (acct.userId === currentUserId) {
        // Owner always has access to their own account
        return { userId: acct.userId, accountId: acct.id, acct };
      }
      if (!acct.isShared) return null; // Personal account belonging to someone else — deny
      // Shared account: admins always in; non-admins need explicit view permission
      if (!isAdmin && mailTeamPerms[String(acct.id)]?.view !== true) return null;
      return { userId: acct.userId, accountId: acct.id, acct };
    }
    // Default: user's own account
    const acct = await getUserGmailAccount(currentUserId);
    if (!acct) return null;
    return { userId: currentUserId, accountId: undefined as number | undefined, acct };
  }

  // Helper: extract role + mail_team perms for the session user.
  // Uses the session-cached globalRole so no DB round-trip for admins.
  async function getSessionUserAccess(session: any): Promise<{
    isAdmin: boolean;
    mailTeamPerms: Record<string, { view: boolean; edit: boolean }>;
  }> {
    const role = String(session.globalRole || "");
    const isAdmin = role === "master_admin" || role === "admin";
    if (isAdmin) return { isAdmin: true, mailTeamPerms: {} };
    // Non-admin: fetch permissions from DB (one query, lightweight)
    const userId = session.userId as number;
    const [u] = await db.select({ permissions: users.permissions })
      .from(users).where(eq(users.id, userId)).limit(1);
    const mailTeamPerms = ((u?.permissions as any)?.mail_team ?? {}) as Record<string, { view: boolean; edit: boolean }>;
    return { isAdmin: false, mailTeamPerms };
  }

  // ── Gmail routes (per-user isolated) ─────────────────────────────────────
  app.get("/api/gmail/profile", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const asAccountId = req.query.asAccountId ? Number(req.query.asAccountId) : undefined;
    const { isAdmin: _ia, mailTeamPerms: _mtp } = await getSessionUserAccess(req.session);
    const resolved = await resolveAccount(userId, asAccountId, _ia, _mtp);
    if (!resolved) return res.status(403).json({ message: "No Gmail account connected" });
    try {
      const profile = await getProfile(resolved.userId, resolved.accountId);
      res.json(profile);
    } catch (err: any) {
      res.status(503).json({ message: "Gmail not connected", error: err.message });
    }
  });

  app.get("/api/gmail/messages", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const asAccountId = req.query.asAccountId ? Number(req.query.asAccountId) : undefined;
    const { isAdmin: _ia, mailTeamPerms: _mtp } = await getSessionUserAccess(req.session);
    const resolved = await resolveAccount(userId, asAccountId, _ia, _mtp);
    if (!resolved) return res.json({ messages: [], nextPageToken: null });
    try {
      const q = (req.query.q as string) || "";
      const maxResults = Math.min(Number(req.query.limit) || 50, 100);
      const pageToken = (req.query.pageToken as string) || undefined;
      const { summaries, nextPageToken } = await getMessageSummaries(resolved.userId, maxResults, q, pageToken, resolved.accountId);
      res.json({ messages: summaries, nextPageToken });
    } catch (err: any) {
      res.status(503).json({ message: "Gmail not connected", error: err.message });
    }
  });

  app.get("/api/gmail/threads", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const asAccountId = req.query.asAccountId ? Number(req.query.asAccountId) : undefined;
    const { isAdmin: _ia, mailTeamPerms: _mtp } = await getSessionUserAccess(req.session);
    const resolved = await resolveAccount(userId, asAccountId, _ia, _mtp);
    if (!resolved) return res.json([]);
    try {
      const q = (req.query.q as string) || "";
      const maxResults = Math.min(Number(req.query.limit) || 30, 100);
      const threads = await listThreads(resolved.userId, q, maxResults, resolved.accountId);
      res.json(threads);
    } catch (err: any) {
      res.status(503).json({ message: "Gmail not connected", error: err.message });
    }
  });

  app.get("/api/gmail/threads/:id", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const asAccountId = req.query.asAccountId ? Number(req.query.asAccountId) : undefined;
    const { isAdmin: _ia, mailTeamPerms: _mtp } = await getSessionUserAccess(req.session);
    const resolved = await resolveAccount(userId, asAccountId, _ia, _mtp);
    if (!resolved) return res.status(403).json({ message: "No Gmail account connected" });
    try {
      const thread = await getThread(resolved.userId, req.params.id, resolved.accountId);
      res.json(thread);
    } catch (err: any) {
      res.status(503).json({ message: "Gmail not connected", error: err.message });
    }
  });

  // ── Gmail Thread CRM Record ───────────────────────────────────────────────
  // GET /api/gmail/thread-record/:threadId — fetch DB record + linked CRM entities
  app.get("/api/gmail/thread-record/:threadId", requireAuth, async (req, res) => {
    const threadId = String(req.params.threadId);
    try {
      const INTERNAL_DOMAIN = "voltsafe.com";

      const [thread] = await db
        .select()
        .from(emailThreads)
        .where(eq(emailThreads.gmailThreadId, threadId));

      // Always fetch sender from email_messages regardless of whether a thread record exists
      const [senderMsg] = await db
        .select({
          fromEmail: emailMessages.fromEmail,
          fromName: emailMessages.fromName,
          bulkEmailScore: emailMessages.bulkEmailScore,
          autoGeneratedScore: emailMessages.autoGeneratedScore,
        })
        .from(emailMessages)
        .where(
          and(
            eq(emailMessages.gmailThreadId, threadId),
            sql`${emailMessages.fromEmail} NOT ILIKE ${"%" + INTERNAL_DOMAIN}`
          )
        )
        .orderBy(sql`${emailMessages.sentAt} ASC NULLS LAST`)
        .limit(1);

      if (!thread) return res.json({ found: false, sender: senderMsg ?? null });

      const [contact, account, lead] = await Promise.all([
        thread.primaryContactId ? storage.getContact(thread.primaryContactId) : Promise.resolve(undefined),
        thread.primaryAccountId ? storage.getAccount(thread.primaryAccountId) : Promise.resolve(undefined),
        thread.primaryLeadId ? storage.getLead(thread.primaryLeadId) : Promise.resolve(undefined),
      ]);

      res.json({
        found: true,
        thread,
        contact: contact || null,
        account: account || null,
        lead: lead || null,
        sender: senderMsg ?? null,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // PATCH /api/gmail/thread-record/:threadId — upsert workflow state / snooze / follow-up / reply status
  app.patch("/api/gmail/thread-record/:threadId", requireAuth, async (req, res) => {
    const threadId = String(req.params.threadId);
    const { workflowState, snoozedUntil, followUpAt, replyStatus } = req.body;
    try {
      const existing = await db
        .select({ id: emailThreads.id })
        .from(emailThreads)
        .where(eq(emailThreads.gmailThreadId, threadId));

      if (existing.length === 0) {
        const insertValues: Record<string, unknown> = {
          gmailThreadId: threadId,
          workflowState: workflowState ?? null,
          snoozedUntil: snoozedUntil ? new Date(snoozedUntil) : null,
          followUpAt: followUpAt ? new Date(followUpAt) : null,
          associationStatus: "unassociated",
        };
        if (replyStatus !== undefined) {
          insertValues.replyStatus = replyStatus || "none";
          if (replyStatus === "needs_reply") insertValues.awaitingReplySince = new Date();
        }
        await db.insert(emailThreads).values(insertValues as any);
      } else {
        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (workflowState !== undefined) updates.workflowState = workflowState || null;
        if (snoozedUntil !== undefined) updates.snoozedUntil = snoozedUntil ? new Date(snoozedUntil) : null;
        if (followUpAt !== undefined) updates.followUpAt = followUpAt ? new Date(followUpAt) : null;
        if (replyStatus !== undefined) {
          updates.replyStatus = replyStatus || "none";
          // When marked as "waiting_on_them" or "done", clear awaiting_reply_since
          if (replyStatus === "waiting_on_them" || replyStatus === "done") {
            updates.awaitingReplySince = null;
          }
          // When manually set to "needs_reply", set awaiting_reply_since to now
          if (replyStatus === "needs_reply") {
            updates.awaitingReplySince = new Date();
          }
        }
        await db.update(emailThreads).set(updates as any).where(eq(emailThreads.gmailThreadId, threadId));
      }
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Thread Association Review API ─────────────────────────────────────────
  // GET /api/gmail/thread-associations/:threadId
  // Returns all email_associations for any message in this thread,
  // enriched with entity display data and grouped by objectType.
  app.get("/api/gmail/thread-associations/:threadId", requireAuth, async (req, res) => {
    const threadId = String(req.params.threadId);
    try {
      // Find all messages for this thread in our DB
      const msgs = await db
        .select({ id: emailMessages.id })
        .from(emailMessages)
        .where(eq(emailMessages.gmailThreadId, threadId));

      if (!msgs.length) return res.json({ candidates: [] });

      const msgIds = msgs.map(m => m.id);

      // Get all associations for these messages
      const assocs = await db
        .select()
        .from(emailAssociations)
        .where(inArray(emailAssociations.emailMessageId, msgIds));

      // Deduplicate by objectType+objectId, keeping highest score
      const best = new Map<string, typeof assocs[0]>();
      for (const a of assocs) {
        const key = `${a.objectType}:${a.objectId}`;
        const existing = best.get(key);
        if (!existing || (a.confidenceScore ?? 0) > (existing.confidenceScore ?? 0)) {
          best.set(key, a);
        }
      }

      const deduped = Array.from(best.values()).sort((a, b) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0));

      // Enrich with entity detail (name already stored in objectName, but load fresh data)
      const enriched = await Promise.all(deduped.map(async (a) => {
        let entityDetail: Record<string, any> = {};
        try {
          if (a.objectType === "contact") {
            const [r] = await db.select({ id: contacts.id, name: contacts.name, email: contacts.email, accountId: contacts.accountId }).from(contacts).where(eq(contacts.id, a.objectId)).limit(1);
            if (r) entityDetail = { name: r.name, email: r.email, accountId: r.accountId };
          } else if (a.objectType === "account") {
            const [r] = await db.select({ id: accounts.id, name: accounts.name, website: accounts.website }).from(accounts).where(eq(accounts.id, a.objectId)).limit(1);
            if (r) entityDetail = { name: r.name, website: r.website };
          } else if (a.objectType === "lead") {
            const [r] = await db.select({ id: leads.id, company: leads.company, contactEmail: leads.contactEmail, leadStatus: leads.leadStatus }).from(leads).where(eq(leads.id, a.objectId)).limit(1);
            if (r) entityDetail = { name: r.company, email: r.contactEmail, status: r.leadStatus };
          } else if (a.objectType === "opportunity") {
            const [r] = await db.select({ id: opportunities.id, title: opportunities.title, stage: opportunities.stage, amount: opportunities.amount }).from(opportunities).where(eq(opportunities.id, a.objectId)).limit(1);
            if (r) entityDetail = { name: r.title, stage: r.stage, amount: r.amount };
          } else if (a.objectType === "partner") {
            const [r] = await db.select({ id: partnerships.id, name: partnerships.name, category: partnerships.category }).from(partnerships).where(eq(partnerships.id, a.objectId)).limit(1);
            if (r) entityDetail = { name: r.name, category: r.category };
          }
        } catch {}
        return {
          ...a,
          reasons: a.associationReasonJson ? JSON.parse(a.associationReasonJson) : [],
          entityDetail,
        };
      }));

      res.json({ candidates: enriched });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/gmail/thread-associations/confirm
  // User confirms an association:
  //   - marks isUserConfirmed=true (immutable from engine's perspective)
  //   - updates email_threads primary pointer for this objectType
  //   - logs "confirmed" feedback so engine can learn from it
  app.post("/api/gmail/thread-associations/confirm", requireAuth, async (req, res) => {
    const { associationId, threadId } = req.body;
    if (!associationId) return res.status(400).json({ message: "associationId required" });
    try {
      const [assoc] = await db
        .select()
        .from(emailAssociations)
        .where(eq(emailAssociations.id, Number(associationId)));

      if (!assoc) return res.status(404).json({ message: "Association not found" });

      // Mark association as user-confirmed (immutable — engine will not overwrite)
      await db.update(emailAssociations)
        .set({ isUserConfirmed: true, isAuto: false, updatedAt: new Date() })
        .where(eq(emailAssociations.id, assoc.id));

      // Log confirmation to feedback table so engine can learn from it
      await db.insert(associationFeedback).values({
        emailMessageId: assoc.emailMessageId,
        originalObjectType: assoc.objectType,
        originalObjectId: assoc.objectId,
        feedbackType: "confirmed",
      });

      // Update email_threads primary pointer for this objectType
      if (threadId) {
        const updates: Record<string, any> = { associationStatus: "associated", updatedAt: new Date() };
        if (assoc.objectType === "contact") updates.primaryContactId = assoc.objectId;
        else if (assoc.objectType === "account") updates.primaryAccountId = assoc.objectId;
        else if (assoc.objectType === "lead") updates.primaryLeadId = assoc.objectId;
        else if (assoc.objectType === "opportunity") updates.primaryOpportunityId = assoc.objectId;
        else if (assoc.objectType === "partner") updates.primaryPartnerId = assoc.objectId;

        const [existing] = await db
          .select({ id: emailThreads.id })
          .from(emailThreads)
          .where(eq(emailThreads.gmailThreadId, String(threadId)));
        if (existing) {
          await db.update(emailThreads).set(updates).where(eq(emailThreads.gmailThreadId, String(threadId)));
        } else {
          await db.insert(emailThreads).values({ gmailThreadId: String(threadId), ...updates });
        }
      }

      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/gmail/thread-associations/reject
  // User rejects an association:
  //   - removes the association record
  //   - logs "rejected" feedback (engine will never recreate this pairing)
  //   - clears email_threads primary pointer if this was the active primary link
  app.post("/api/gmail/thread-associations/reject", requireAuth, async (req, res) => {
    const { associationId, emailMessageId, threadId } = req.body;
    if (!associationId) return res.status(400).json({ message: "associationId required" });
    try {
      const [assoc] = await db
        .select()
        .from(emailAssociations)
        .where(eq(emailAssociations.id, Number(associationId)));

      if (!assoc) return res.status(404).json({ message: "Association not found" });

      // Log rejection so the engine skips this entity for this thread forever
      await db.insert(associationFeedback).values({
        emailMessageId: emailMessageId || assoc.emailMessageId,
        originalObjectType: assoc.objectType,
        originalObjectId: assoc.objectId,
        feedbackType: "rejected",
      });

      // Delete the association
      await db.delete(emailAssociations).where(eq(emailAssociations.id, assoc.id));

      // Clear the email_threads primary pointer if this was the active primary
      // so the thread doesn't appear as "associated" to a dismissed entity
      if (threadId) {
        const [threadRow] = await db
          .select()
          .from(emailThreads)
          .where(eq(emailThreads.gmailThreadId, String(threadId)));
        if (threadRow) {
          const clears: Record<string, any> = { updatedAt: new Date() };
          if (assoc.objectType === "contact" && threadRow.primaryContactId === assoc.objectId) {
            clears.primaryContactId = null;
          }
          if (assoc.objectType === "account" && threadRow.primaryAccountId === assoc.objectId) {
            clears.primaryAccountId = null;
          }
          if (assoc.objectType === "lead" && threadRow.primaryLeadId === assoc.objectId) {
            clears.primaryLeadId = null;
          }
          if (assoc.objectType === "opportunity" && threadRow.primaryOpportunityId === assoc.objectId) {
            clears.primaryOpportunityId = null;
          }
          if (assoc.objectType === "partner" && threadRow.primaryPartnerId === assoc.objectId) {
            clears.primaryPartnerId = null;
          }
          // If all primary pointers become null after this rejection, flag for review
          const contactAfter = assoc.objectType === "contact" ? null : threadRow.primaryContactId;
          const accountAfter = assoc.objectType === "account" ? null : threadRow.primaryAccountId;
          const leadAfter = assoc.objectType === "lead" ? null : threadRow.primaryLeadId;
          const oppAfter = assoc.objectType === "opportunity" ? null : threadRow.primaryOpportunityId;
          const partnerAfter = assoc.objectType === "partner" ? null : threadRow.primaryPartnerId;
          const anyPrimaryRemains = [contactAfter, accountAfter, leadAfter, oppAfter, partnerAfter].some(Boolean);
          if (!anyPrimaryRemains) {
            clears.associationStatus = "needs_review";
          }
          if (Object.keys(clears).length > 1) {
            await db.update(emailThreads)
              .set(clears)
              .where(eq(emailThreads.gmailThreadId, String(threadId)));
          }
        }
      }

      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/gmail/thread-associations/bulk-confirm
  // Bulk confirm a set of associations (top candidate per thread).
  // Permission-enforced per item — items the user cannot access are skipped (not errored).
  // Returns: { confirmed: number[], skipped: [{id,reason}], failed: [{id,reason}] }
  app.post("/api/gmail/thread-associations/bulk-confirm", requireAuth, async (req, res) => {
    const items: Array<{ associationId: number; threadId: string }> = req.body?.items ?? [];
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "items array is required and must be non-empty" });
    }
    if (items.length > 100) {
      return res.status(400).json({ message: "Maximum 100 items per bulk operation" });
    }

    // Load actor once for permission checks
    const userId = (req.session as any).userId;
    const [actor] = await db
      .select({ globalRole: users.globalRole, permissions: users.permissions })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!actor) return res.status(401).json({ message: "User not found" });

    const isAdmin = actor.globalRole === "master_admin" || actor.globalRole === "admin";
    const perms = (actor.permissions as Record<string, string>) || {};

    const confirmed: number[] = [];
    const skipped: Array<{ id: number; reason: string }> = [];
    const failed: Array<{ id: number; reason: string }> = [];

    for (const item of items) {
      const assocId = Number(item.associationId);
      const threadId = String(item.threadId ?? "");
      try {
        // Load association
        const [assoc] = await db
          .select()
          .from(emailAssociations)
          .where(eq(emailAssociations.id, assocId));

        if (!assoc) {
          skipped.push({ id: assocId, reason: "Not found" });
          continue;
        }

        // Permission check
        if (!isAdmin) {
          const section = assoc.objectType === "partner" ? "partnerships" : "crm";
          const level = perms[section] ?? "none";
          if (level === "none") {
            skipped.push({ id: assocId, reason: `No ${section} access` });
            continue;
          }
        }

        // Already confirmed — treat as no-op success
        if (assoc.isUserConfirmed) {
          confirmed.push(assocId);
          continue;
        }

        // Mark confirmed
        await db.update(emailAssociations)
          .set({ isUserConfirmed: true, isAuto: false, updatedAt: new Date() })
          .where(eq(emailAssociations.id, assocId));

        // Write feedback
        await db.insert(associationFeedback).values({
          emailMessageId: assoc.emailMessageId,
          originalObjectType: assoc.objectType,
          originalObjectId: assoc.objectId,
          feedbackType: "confirmed",
        });

        // Update email_threads primary pointer
        if (threadId) {
          const updates: Record<string, any> = { associationStatus: "associated", updatedAt: new Date() };
          if (assoc.objectType === "contact") updates.primaryContactId = assoc.objectId;
          else if (assoc.objectType === "account") updates.primaryAccountId = assoc.objectId;
          else if (assoc.objectType === "lead") updates.primaryLeadId = assoc.objectId;
          else if (assoc.objectType === "opportunity") updates.primaryOpportunityId = assoc.objectId;
          else if (assoc.objectType === "partner") updates.primaryPartnerId = assoc.objectId;

          const [existing] = await db
            .select({ id: emailThreads.id })
            .from(emailThreads)
            .where(eq(emailThreads.gmailThreadId, threadId));
          if (existing) {
            await db.update(emailThreads).set(updates).where(eq(emailThreads.gmailThreadId, threadId));
          } else {
            await db.insert(emailThreads).values({ gmailThreadId: threadId, ...updates });
          }
        }

        confirmed.push(assocId);
      } catch (err: any) {
        failed.push({ id: assocId, reason: err.message ?? "Unknown error" });
      }
    }

    res.json({ confirmed, skipped, failed });
  });

  // POST /api/gmail/thread-associations/bulk-reject
  // Bulk reject a set of associations (top candidate per thread).
  // Permission-enforced per item — items the user cannot access are skipped.
  // Returns: { rejected: number[], skipped: [{id,reason}], failed: [{id,reason}] }
  app.post("/api/gmail/thread-associations/bulk-reject", requireAuth, async (req, res) => {
    const items: Array<{ associationId: number; threadId: string }> = req.body?.items ?? [];
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "items array is required and must be non-empty" });
    }
    if (items.length > 100) {
      return res.status(400).json({ message: "Maximum 100 items per bulk operation" });
    }

    const userId = (req.session as any).userId;
    const [actor] = await db
      .select({ globalRole: users.globalRole, permissions: users.permissions })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!actor) return res.status(401).json({ message: "User not found" });

    const isAdmin = actor.globalRole === "master_admin" || actor.globalRole === "admin";
    const perms = (actor.permissions as Record<string, string>) || {};

    const rejected: number[] = [];
    const skipped: Array<{ id: number; reason: string }> = [];
    const failed: Array<{ id: number; reason: string }> = [];

    for (const item of items) {
      const assocId = Number(item.associationId);
      const threadId = String(item.threadId ?? "");
      try {
        const [assoc] = await db
          .select()
          .from(emailAssociations)
          .where(eq(emailAssociations.id, assocId));

        if (!assoc) {
          skipped.push({ id: assocId, reason: "Not found" });
          continue;
        }

        // Permission check
        if (!isAdmin) {
          const section = assoc.objectType === "partner" ? "partnerships" : "crm";
          const level = perms[section] ?? "none";
          if (level === "none") {
            skipped.push({ id: assocId, reason: `No ${section} access` });
            continue;
          }
        }

        // Write feedback
        await db.insert(associationFeedback).values({
          emailMessageId: assoc.emailMessageId,
          originalObjectType: assoc.objectType,
          originalObjectId: assoc.objectId,
          feedbackType: "rejected",
        });

        // Delete association
        await db.delete(emailAssociations).where(eq(emailAssociations.id, assocId));

        // Clear email_threads primary pointer if needed
        if (threadId) {
          const [threadRow] = await db
            .select()
            .from(emailThreads)
            .where(eq(emailThreads.gmailThreadId, threadId));
          if (threadRow) {
            const clears: Record<string, any> = { updatedAt: new Date() };
            if (assoc.objectType === "contact" && threadRow.primaryContactId === assoc.objectId) clears.primaryContactId = null;
            if (assoc.objectType === "account" && threadRow.primaryAccountId === assoc.objectId) clears.primaryAccountId = null;
            if (assoc.objectType === "lead" && threadRow.primaryLeadId === assoc.objectId) clears.primaryLeadId = null;
            if (assoc.objectType === "opportunity" && threadRow.primaryOpportunityId === assoc.objectId) clears.primaryOpportunityId = null;
            if (assoc.objectType === "partner" && threadRow.primaryPartnerId === assoc.objectId) clears.primaryPartnerId = null;

            const contactAfter = assoc.objectType === "contact" ? null : threadRow.primaryContactId;
            const accountAfter = assoc.objectType === "account" ? null : threadRow.primaryAccountId;
            const leadAfter = assoc.objectType === "lead" ? null : threadRow.primaryLeadId;
            const oppAfter = assoc.objectType === "opportunity" ? null : threadRow.primaryOpportunityId;
            const partnerAfter = assoc.objectType === "partner" ? null : threadRow.primaryPartnerId;
            if (![contactAfter, accountAfter, leadAfter, oppAfter, partnerAfter].some(Boolean)) {
              clears.associationStatus = "needs_review";
            }
            if (Object.keys(clears).length > 1) {
              await db.update(emailThreads).set(clears).where(eq(emailThreads.gmailThreadId, threadId));
            }
          }
        }

        rejected.push(assocId);
      } catch (err: any) {
        failed.push({ id: assocId, reason: err.message ?? "Unknown error" });
      }
    }

    res.json({ rejected, skipped, failed });
  });

  // POST /api/gmail/thread-associations/manual
  // Manually link a thread to any CRM entity — creates an association + updates thread primary pointer.
  app.post("/api/gmail/thread-associations/manual", requireAuth, async (req, res) => {
    const { threadId, objectType, objectId, objectName, emailMessageId } = req.body;
    if (!threadId || !objectType || !objectId) {
      return res.status(400).json({ message: "threadId, objectType, objectId required" });
    }
    try {
      const msgId = emailMessageId || null;

      // Find a real message ID for this thread if not provided
      let resolvedMsgId = msgId;
      if (!resolvedMsgId) {
        const [firstMsg] = await db
          .select({ id: emailMessages.id })
          .from(emailMessages)
          .where(eq(emailMessages.gmailThreadId, String(threadId)))
          .limit(1);
        resolvedMsgId = firstMsg?.id || null;
      }

      if (resolvedMsgId) {
        // Check if association already exists
        const [existing] = await db
          .select({ id: emailAssociations.id })
          .from(emailAssociations)
          .where(and(
            eq(emailAssociations.emailMessageId, resolvedMsgId),
            eq(emailAssociations.objectType, objectType),
            eq(emailAssociations.objectId, Number(objectId))
          ));

        if (!existing) {
          await db.insert(emailAssociations).values({
            emailMessageId: resolvedMsgId,
            objectType,
            objectId: Number(objectId),
            objectName: objectName || String(objectId),
            confidenceScore: 100,
            associationReasonJson: JSON.stringify(["Manually linked by user"]),
            isAuto: false,
            isUserConfirmed: true,
          });
        } else {
          await db.update(emailAssociations)
            .set({ isUserConfirmed: true, confidenceScore: 100, updatedAt: new Date() })
            .where(eq(emailAssociations.id, existing.id));
        }
      }

      // Update email_threads primary pointer
      const updates: Record<string, any> = { associationStatus: "associated", updatedAt: new Date() };
      if (objectType === "contact") updates.primaryContactId = Number(objectId);
      else if (objectType === "account") updates.primaryAccountId = Number(objectId);
      else if (objectType === "lead") updates.primaryLeadId = Number(objectId);
      else if (objectType === "opportunity") updates.primaryOpportunityId = Number(objectId);
      else if (objectType === "partner") updates.primaryPartnerId = Number(objectId);

      const [existingThread] = await db
        .select({ id: emailThreads.id })
        .from(emailThreads)
        .where(eq(emailThreads.gmailThreadId, String(threadId)));

      if (existingThread) {
        await db.update(emailThreads).set(updates).where(eq(emailThreads.gmailThreadId, String(threadId)));
      } else {
        await db.insert(emailThreads).values({ gmailThreadId: String(threadId), ...updates });
      }

      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/gmail/thread-associations/replace
  // Replace an existing confirmed association with a different CRM record.
  // Runs atomically: old association is deleted only if new association + audit both succeed.
  // Permission-enforced server-side: crm for contact/account/lead/opportunity; partnerships for partner.
  app.post("/api/gmail/thread-associations/replace", requireAuth, async (req, res) => {
    const { oldAssociationId, threadId, objectType, objectId, objectName } = req.body;
    if (!oldAssociationId || !objectType || !objectId) {
      return res.status(400).json({ message: "oldAssociationId, objectType, and objectId are required" });
    }

    // ── Permission check ────────────────────────────────────────────────────
    const userId = (req.session as any).userId;
    const [actor] = await db
      .select({ globalRole: users.globalRole, permissions: users.permissions })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!actor) return res.status(401).json({ message: "User not found" });

    const isAdmin = actor.globalRole === "master_admin" || actor.globalRole === "admin";
    if (!isAdmin) {
      const perms = (actor.permissions as Record<string, string>) || {};
      const section = objectType === "partner" ? "partnerships" : "crm";
      const level = perms[section] ?? "none";
      if (level === "none") {
        return res.status(403).json({
          message: `Insufficient permissions: requires view access to ${section}`,
        });
      }
    }

    // ── Load old association ─────────────────────────────────────────────────
    const [old] = await db
      .select()
      .from(emailAssociations)
      .where(eq(emailAssociations.id, Number(oldAssociationId)));

    if (!old) return res.status(404).json({ message: "Association not found" });

    // ── No-op guard ──────────────────────────────────────────────────────────
    if (old.objectType === objectType && old.objectId === Number(objectId)) {
      return res.status(400).json({
        message: "Replacement target is the same as the current association — no change made",
      });
    }

    // ── Atomic transaction ───────────────────────────────────────────────────
    try {
      await db.transaction(async (tx) => {
        // 1. Delete old association
        await tx.delete(emailAssociations).where(eq(emailAssociations.id, old.id));

        // 2. Insert new association (manually confirmed, 100% confidence)
        await tx.insert(emailAssociations).values({
          emailMessageId: old.emailMessageId,
          objectType,
          objectId: Number(objectId),
          objectName: objectName || String(objectId),
          confidenceScore: 100,
          associationReasonJson: JSON.stringify(["Manually corrected by user"]),
          isAuto: false,
          isUserConfirmed: true,
        });

        // 3. Update email_threads primary pointer:
        //    clear old type's pointer, set new type's pointer
        if (threadId) {
          const threadUpdates: Record<string, any> = { associationStatus: "associated", updatedAt: new Date() };

          // Clear old type pointer
          if (old.objectType === "contact") threadUpdates.primaryContactId = null;
          else if (old.objectType === "account") threadUpdates.primaryAccountId = null;
          else if (old.objectType === "lead") threadUpdates.primaryLeadId = null;
          else if (old.objectType === "opportunity") threadUpdates.primaryOpportunityId = null;
          else if (old.objectType === "partner") threadUpdates.primaryPartnerId = null;

          // Set new type pointer
          if (objectType === "contact") threadUpdates.primaryContactId = Number(objectId);
          else if (objectType === "account") threadUpdates.primaryAccountId = Number(objectId);
          else if (objectType === "lead") threadUpdates.primaryLeadId = Number(objectId);
          else if (objectType === "opportunity") threadUpdates.primaryOpportunityId = Number(objectId);
          else if (objectType === "partner") threadUpdates.primaryPartnerId = Number(objectId);

          const [existingThread] = await tx
            .select({ id: emailThreads.id })
            .from(emailThreads)
            .where(eq(emailThreads.gmailThreadId, String(threadId)));

          if (existingThread) {
            await tx.update(emailThreads)
              .set(threadUpdates)
              .where(eq(emailThreads.gmailThreadId, String(threadId)));
          } else {
            await tx.insert(emailThreads).values({ gmailThreadId: String(threadId), ...threadUpdates });
          }
        }

        // 4. Write audit record (feedbackType="corrected" with both original and corrected IDs)
        await tx.insert(associationFeedback).values({
          emailMessageId: old.emailMessageId,
          originalObjectType: old.objectType,
          originalObjectId: old.objectId,
          correctedObjectType: objectType,
          correctedObjectId: Number(objectId),
          feedbackType: "corrected",
        });
      });

      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/gmail/thread-associations/:threadId/refresh
  // Re-runs the association engine on all messages in the thread.
  // Safe to call multiple times — engine is idempotent.
  app.post("/api/gmail/thread-associations/:threadId/refresh", requireAuth, async (req, res) => {
    const threadId = String(req.params.threadId);
    try {
      const msgs = await db
        .select({ id: emailMessages.id })
        .from(emailMessages)
        .where(eq(emailMessages.gmailThreadId, threadId));

      for (const msg of msgs) {
        await runAssociationEngine(msg.id);
      }

      res.json({ ok: true, messagesProcessed: msgs.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/gmail/sender/create-contact
  // Atomically creates a Contact from an unmatched email sender,
  // linked to either an existing or newly-created stub Organization.
  // Includes server-side duplicate prevention for both contact email and org domain.
  app.post("/api/gmail/sender/create-contact", requireAuth, requirePermission("crm", "edit"), async (req, res) => {
    const { fromEmail, name, title, orgMode, accountId, orgName, orgType } = req.body;

    if (!fromEmail || typeof fromEmail !== "string") {
      return res.status(400).json({ message: "fromEmail is required" });
    }
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ message: "name is required" });
    }
    if (orgMode !== "existing" && orgMode !== "new") {
      return res.status(400).json({ message: "orgMode must be 'existing' or 'new'" });
    }
    if (orgMode === "existing" && !accountId) {
      return res.status(400).json({ message: "accountId is required when orgMode is 'existing'" });
    }
    if (orgMode === "new" && (!orgName || typeof orgName !== "string" || !orgName.trim())) {
      return res.status(400).json({ message: "orgName is required when orgMode is 'new'" });
    }

    try {
      // ── Duplicate contact check ────────────────────────────────────────────
      const [existingContact] = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(sql`LOWER(${contacts.email}) = LOWER(${fromEmail.trim()})`)
        .limit(1);
      if (existingContact) {
        return res.status(409).json({
          code: "CONTACT_EXISTS",
          message: "A contact with this email already exists",
          existingContactId: existingContact.id,
        });
      }

      let resolvedAccountId: number;
      let accountCreated = false;

      if (orgMode === "existing") {
        // Verify account exists
        const [acct] = await db
          .select({ id: accounts.id })
          .from(accounts)
          .where(eq(accounts.id, Number(accountId)))
          .limit(1);
        if (!acct) return res.status(400).json({ message: "Organization not found" });
        resolvedAccountId = acct.id;
      } else {
        // ── Org domain duplicate prevention ───────────────────────────────
        const rawDomain = fromEmail.split("@")[1]?.toLowerCase() ?? "";
        const normalizedDomain = rawDomain.replace(/^www\./, "");

        if (normalizedDomain) {
          const [domainConflict] = await db
            .select({ id: accounts.id, name: accounts.name })
            .from(accounts)
            .where(sql`LOWER(${accounts.website}) ILIKE ${"%" + normalizedDomain + "%"}`)
            .limit(1);
          if (domainConflict) {
            return res.status(409).json({
              code: "DOMAIN_CONFLICT",
              message: `An organization with domain "${normalizedDomain}" already exists`,
              conflictAccountId: domainConflict.id,
              conflictAccountName: domainConflict.name,
            });
          }
        }

        // ── Domain inference when no type provided ─────────────────────────
        function inferOrgTypeFromDomain(domain: string): string {
          const d = domain.toLowerCase();
          if (d.endsWith(".mil")) return "defense_military";
          if (d.endsWith(".gov")) return "government_agency";
          if (/marina/.test(d)) return "marina";
          if (/yacht/.test(d)) return "yacht_club";
          if (/harbor|harbour/.test(d)) return "port_harbor";
          if (/\bport/.test(d)) return "port_harbor";
          if (/shipyard/.test(d)) return "shipyard";
          if (/boatyard/.test(d)) return "boatyard";
          return "unclassified";
        }

        // ── Org type → segment + orgType mapping ──────────────────────────
        const ORG_TYPE_MAP: Record<string, { segment: string; orgType: string }> = {
          marina:                 { segment: "marina",        orgType: "marina" },
          port_harbor:            { segment: "marina",        orgType: "port_harbor" },
          shipyard:               { segment: "marina",        orgType: "shipyard" },
          boatyard:               { segment: "marina",        orgType: "boatyard" },
          yacht_club:             { segment: "marina",        orgType: "yacht_club" },
          marina_group:           { segment: "marina",        orgType: "marina_group" },
          property_developer:     { segment: "other",         orgType: "property_developer" },
          utility:                { segment: "government",    orgType: "utility" },
          municipality:           { segment: "government",    orgType: "municipality" },
          government_agency:      { segment: "government",    orgType: "government_agency" },
          defense_military:       { segment: "government",    orgType: "defense_military" },
          oem:                    { segment: "vendor",        orgType: "oem" },
          distributor:            { segment: "vendor",        orgType: "distributor" },
          dealer_reseller:        { segment: "vendor",        orgType: "dealer_reseller" },
          installer:              { segment: "vendor",        orgType: "installer" },
          industry_association:   { segment: "association",   orgType: "industry_association" },
          accelerator:            { segment: "investor",      orgType: "accelerator" },
          investor:               { segment: "investor",      orgType: "investor" },
          media:                  { segment: "other",         orgType: "media" },
          engineering_firm:       { segment: "other",         orgType: "engineering_firm" },
          consultant:             { segment: "other",         orgType: "consultant" },
          insurance:              { segment: "other",         orgType: "insurance" },
          standards_body:         { segment: "other",         orgType: "standards_body" },
          university_research:    { segment: "research",      orgType: "university_research" },
          supplier_manufacturer:  { segment: "vendor",        orgType: "supplier_manufacturer" },
          partner:                { segment: "other",         orgType: "partner" },
          prospect:               { segment: "other",         orgType: "prospect" },
          customer:               { segment: "other",         orgType: "customer" },
          vendor:                 { segment: "vendor",        orgType: "vendor" },
          other:                  { segment: "other",         orgType: "other" },
          unclassified:           { segment: "other",         orgType: "unclassified" },
          // legacy aliases
          government:             { segment: "government",    orgType: "government_agency" },
          association:            { segment: "association",   orgType: "industry_association" },
          research:               { segment: "research",      orgType: "university_research" },
        };
        const resolvedOrgType = orgType && ORG_TYPE_MAP[orgType]
          ? orgType
          : inferOrgTypeFromDomain(normalizedDomain);
        const { segment, orgType: mappedOrgType } = ORG_TYPE_MAP[resolvedOrgType] ?? ORG_TYPE_MAP["unclassified"];

        const website = normalizedDomain ? `https://${normalizedDomain}` : undefined;

        const [newAccount] = await db
          .insert(accounts)
          .values({
            name: orgName.trim(),
            website: website ?? null,
            segment,
            orgType: mappedOrgType,
            leadStatus: "new",
            priority: "medium",
          } as any)
          .returning({ id: accounts.id });

        resolvedAccountId = newAccount.id;
        accountCreated = true;
      }

      // ── Conservative name parsing ──────────────────────────────────────────
      const trimmedName = name.trim();
      const words = trimmedName.split(/\s+/);
      const firstName = words.length === 2 ? words[0] : null;
      const lastName  = words.length === 2 ? words[1] : null;

      // ── Create contact ─────────────────────────────────────────────────────
      const [newContact] = await db
        .insert(contacts)
        .values({
          name: trimmedName,
          email: fromEmail.trim().toLowerCase(),
          accountId: resolvedAccountId,
          title: (title && typeof title === "string" && title.trim()) ? title.trim() : null,
          firstName,
          lastName,
        } as any)
        .returning();

      res.status(201).json({
        contact: newContact,
        accountId: resolvedAccountId,
        created: { contact: true, account: accountCreated },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/gmail/sender/create-lead
  // Create a Lead from an unmatched email sender (no existing contact/account).
  // Used from the inbox no-match quick-create panel.
  app.post("/api/gmail/sender/create-lead", requireAuth, requirePermission("crm", "edit"), async (req, res) => {
    const { fromEmail, company, contactName } = req.body;

    if (!fromEmail || typeof fromEmail !== "string" || !fromEmail.trim()) {
      return res.status(400).json({ message: "fromEmail is required" });
    }
    if (!company || typeof company !== "string" || !company.trim()) {
      return res.status(400).json({ message: "company is required" });
    }

    try {
      const normalizedEmail = fromEmail.trim().toLowerCase();

      // Duplicate check — same email already on a lead
      const [existingLead] = await db
        .select({ id: leads.id })
        .from(leads)
        .where(sql`LOWER(${leads.contactEmail}) = ${normalizedEmail}`)
        .limit(1);
      if (existingLead) {
        return res.status(409).json({
          code: "LEAD_EXISTS",
          message: "A lead with this email already exists",
          existingLeadId: existingLead.id,
        });
      }

      const [newLead] = await db
        .insert(leads)
        .values({
          contactEmail: normalizedEmail,
          contactName: contactName?.trim() || normalizedEmail,
          company: company.trim(),
          status: "new",
          source: "email_inbox",
        } as any)
        .returning();

      res.status(201).json({ lead: newLead });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/gmail/sender/create-account
  // Create an Account stub from a sender domain when no org exists for that domain.
  app.post("/api/gmail/sender/create-account", requireAuth, requirePermission("crm", "edit"), async (req, res) => {
    const { fromEmail, name, orgType } = req.body;

    if (!fromEmail || typeof fromEmail !== "string" || !fromEmail.trim()) {
      return res.status(400).json({ message: "fromEmail is required" });
    }
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ message: "name is required" });
    }

    try {
      const domain = fromEmail.trim().toLowerCase().split("@")[1] ?? "";
      const normalizedDomain = domain.replace(/^www\./, "");

      if (!normalizedDomain) {
        return res.status(400).json({ message: "Could not extract domain from fromEmail" });
      }

      // Duplicate check — org with same domain
      const [domainConflict] = await db
        .select({ id: accounts.id, name: accounts.name })
        .from(accounts)
        .where(sql`LOWER(${accounts.website}) ILIKE ${"%" + normalizedDomain + "%"}`)
        .limit(1);
      if (domainConflict) {
        return res.status(409).json({
          code: "DOMAIN_CONFLICT",
          message: `An organization with domain "${normalizedDomain}" already exists`,
          conflictAccountId: domainConflict.id,
          conflictAccountName: domainConflict.name,
        });
      }

      const resolvedOrgType = orgType && typeof orgType === "string" ? orgType : "unclassified";
      const segmentMap: Record<string, string> = {
        marina: "marina", port_harbor: "marina", shipyard: "marina", boatyard: "marina",
        yacht_club: "marina", marina_group: "marina", utility: "government",
        municipality: "government", government_agency: "government",
        defense_military: "government", oem: "vendor", distributor: "vendor",
        dealer_reseller: "vendor", installer: "vendor", supplier_manufacturer: "vendor",
        industry_association: "association", accelerator: "investor", investor: "investor",
        university_research: "research",
      };
      const segment = segmentMap[resolvedOrgType] ?? "other";

      const [newAccount] = await db
        .insert(accounts)
        .values({
          name: name.trim(),
          website: `https://${normalizedDomain}`,
          segment,
          orgType: resolvedOrgType,
          leadStatus: "new",
          priority: "medium",
        } as any)
        .returning();

      res.status(201).json({ account: newAccount });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/org-types — full list of organisation types supported by Cortex
  app.get("/api/org-types", requireAuth, (_req, res) => {
    res.json([
      { value: "unclassified",          label: "Unclassified" },
      { value: "marina",                label: "Marina" },
      { value: "port_harbor",           label: "Port / Harbor" },
      { value: "shipyard",              label: "Shipyard" },
      { value: "boatyard",              label: "Boatyard" },
      { value: "yacht_club",            label: "Yacht Club" },
      { value: "marina_group",          label: "Marina Group / Ownership Group" },
      { value: "property_developer",    label: "Property Developer" },
      { value: "utility",               label: "Utility" },
      { value: "municipality",          label: "Municipality" },
      { value: "government_agency",     label: "Government Agency" },
      { value: "defense_military",      label: "Defense / Military" },
      { value: "oem",                   label: "OEM" },
      { value: "distributor",           label: "Distributor" },
      { value: "dealer_reseller",       label: "Dealer / Reseller" },
      { value: "installer",             label: "Installer / Electrical Contractor" },
      { value: "industry_association",  label: "Industry Association" },
      { value: "accelerator",           label: "Accelerator" },
      { value: "investor",              label: "Investor" },
      { value: "media",                 label: "Media" },
      { value: "engineering_firm",      label: "Engineering Firm" },
      { value: "consultant",            label: "Consultant" },
      { value: "insurance",             label: "Insurance" },
      { value: "standards_body",        label: "Standards Body" },
      { value: "university_research",   label: "University / Research" },
      { value: "supplier_manufacturer", label: "Supplier / Manufacturer" },
      { value: "partner",               label: "Partner" },
      { value: "prospect",              label: "Prospect" },
      { value: "customer",              label: "Customer" },
      { value: "vendor",                label: "Vendor" },
      { value: "other",                 label: "Other" },
    ]);
  });

  // GET /api/gmail/crm-search?q=...&types=contact,account,lead,opportunity,partner
  // Unified CRM search used for manual association linking.
  app.get("/api/gmail/crm-search", requireAuth, async (req, res) => {
    const q = String(req.query.q || "").trim();
    const types = String(req.query.types || "contact,account,lead,opportunity,partner").split(",");
    if (q.length < 2) return res.json([]);

    try {
      const results: Array<{ objectType: string; objectId: number; objectName: string; meta: string }> = [];

      if (types.includes("contact")) {
        const rows = await db.select({ id: contacts.id, name: contacts.name, email: contacts.email }).from(contacts)
          .where(or(ilike(contacts.name, `%${q}%`), ilike(contacts.email, `%${q}%`))).limit(8);
        rows.forEach(r => results.push({ objectType: "contact", objectId: r.id, objectName: r.name, meta: r.email || "" }));
      }

      if (types.includes("account")) {
        const rows = await db.select({ id: accounts.id, name: accounts.name, website: accounts.website }).from(accounts)
          .where(ilike(accounts.name, `%${q}%`)).limit(8);
        rows.forEach(r => results.push({ objectType: "account", objectId: r.id, objectName: r.name, meta: r.website || "" }));
      }

      if (types.includes("lead")) {
        const rows = await db.select({ id: leads.id, company: leads.company, contactEmail: leads.contactEmail }).from(leads)
          .where(or(ilike(leads.company, `%${q}%`), ilike(leads.contactEmail, `%${q}%`))).limit(8);
        rows.forEach(r => results.push({ objectType: "lead", objectId: r.id, objectName: r.company, meta: r.contactEmail || "" }));
      }

      if (types.includes("opportunity")) {
        const rows = await db.select({ id: opportunities.id, title: opportunities.title, stage: opportunities.stage }).from(opportunities)
          .where(ilike(opportunities.title, `%${q}%`)).limit(8);
        rows.forEach(r => results.push({ objectType: "opportunity", objectId: r.id, objectName: r.title, meta: r.stage }));
      }

      if (types.includes("partner")) {
        const rows = await db.select({ id: partnerships.id, name: partnerships.name, category: partnerships.category }).from(partnerships)
          .where(ilike(partnerships.name, `%${q}%`)).limit(8);
        rows.forEach(r => results.push({ objectType: "partner", objectId: r.id, objectName: r.name, meta: r.category }));
      }

      res.json(results.slice(0, 20));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/gmail/review-queue/stats
  // Returns a count of threads that have unconfirmed auto-associations.
  // Used to display the "Needs Review" badge count in the inbox sidebar.
  app.get("/api/gmail/review-queue/stats", requireAuth, async (req, res) => {
    try {
      const [row] = await db
        .select({ count: sql<number>`count(distinct ${emailMessages.gmailThreadId})` })
        .from(emailAssociations)
        .innerJoin(emailMessages, eq(emailMessages.id, emailAssociations.emailMessageId))
        .where(
          and(
            eq(emailAssociations.isAuto, true),
            eq(emailAssociations.isUserConfirmed, false)
          )
        );
      res.json({ needsReview: Number(row?.count ?? 0) });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/gmail/review-queue?limit=20&offset=0
  // Returns a paginated list of threads with unconfirmed auto-associations.
  // Each row includes the latest message (subject/snippet/sender) + top candidate association.
  app.get("/api/gmail/review-queue", requireAuth, async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 25, 100);
    const offset = Number(req.query.offset) || 0;
    try {
      // Step 1: Get distinct thread IDs that have unconfirmed auto-associations
      const threadRows = await db
        .selectDistinct({ gmailThreadId: emailMessages.gmailThreadId })
        .from(emailAssociations)
        .innerJoin(emailMessages, eq(emailMessages.id, emailAssociations.emailMessageId))
        .where(
          and(
            eq(emailAssociations.isAuto, true),
            eq(emailAssociations.isUserConfirmed, false)
          )
        )
        .limit(limit)
        .offset(offset);

      const threadIds = threadRows.map(r => r.gmailThreadId).filter(Boolean) as string[];
      if (threadIds.length === 0) return res.json({ items: [], total: Number((await db.select({ c: sql<number>`count(distinct ${emailMessages.gmailThreadId})` }).from(emailAssociations).innerJoin(emailMessages, eq(emailMessages.id, emailAssociations.emailMessageId)).where(and(eq(emailAssociations.isAuto, true), eq(emailAssociations.isUserConfirmed, false))))[0]?.c ?? 0) });

      // Step 2: For each thread, get latest message + top unconfirmed candidate
      const items: any[] = [];
      for (const tid of threadIds) {
        // Latest message in this thread
        const [latestMsg] = await db
          .select({
            id: emailMessages.id,
            subject: emailMessages.subject,
            fromName: emailMessages.fromName,
            fromEmail: emailMessages.fromEmail,
            snippet: emailMessages.snippet,
            sentAt: emailMessages.sentAt,
          })
          .from(emailMessages)
          .where(eq(emailMessages.gmailThreadId, tid))
          .orderBy(sql`${emailMessages.sentAt} desc`)
          .limit(1);

        if (!latestMsg) continue;

        // Top unconfirmed auto-association for this thread (highest confidence)
        const threadMsgIds = (
          await db
            .select({ id: emailMessages.id })
            .from(emailMessages)
            .where(eq(emailMessages.gmailThreadId, tid))
        ).map(m => m.id);

        const topAssoc = threadMsgIds.length > 0
          ? (await db
              .select()
              .from(emailAssociations)
              .where(
                and(
                  inArray(emailAssociations.emailMessageId, threadMsgIds),
                  eq(emailAssociations.isAuto, true),
                  eq(emailAssociations.isUserConfirmed, false)
                )
              )
              .orderBy(sql`${emailAssociations.confidenceScore} desc`)
              .limit(1))[0]
          : null;

        // Total candidate count for this thread
        const totalCandidates = threadMsgIds.length > 0
          ? Number((await db
              .select({ c: sql<number>`count(*)` })
              .from(emailAssociations)
              .where(
                and(
                  inArray(emailAssociations.emailMessageId, threadMsgIds),
                  eq(emailAssociations.isAuto, true),
                  eq(emailAssociations.isUserConfirmed, false)
                )
              ))[0]?.c ?? 0)
          : 0;

        items.push({
          gmailThreadId: tid,
          latestMessage: latestMsg,
          topCandidate: topAssoc ?? null,
          candidateCount: totalCandidates,
        });
      }

      // Total count for pagination
      const [totalRow] = await db
        .select({ c: sql<number>`count(distinct ${emailMessages.gmailThreadId})` })
        .from(emailAssociations)
        .innerJoin(emailMessages, eq(emailMessages.id, emailAssociations.emailMessageId))
        .where(
          and(
            eq(emailAssociations.isAuto, true),
            eq(emailAssociations.isUserConfirmed, false)
          )
        );

      res.json({ items, total: Number(totalRow?.c ?? 0) });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Gmail Drafts ─────────────────────────────────────────────────────────
  app.get("/api/gmail/drafts", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const asAccountId = req.query.asAccountId ? Number(req.query.asAccountId) : undefined;
    const { isAdmin: _ia, mailTeamPerms: _mtp } = await getSessionUserAccess(req.session);
    const resolved = await resolveAccount(userId, asAccountId, _ia, _mtp);
    if (!resolved) return res.json([]);
    try {
      const drafts = await listDraftSummaries(resolved.userId, resolved.accountId);
      res.json(drafts);
    } catch (err: any) {
      res.status(503).json({ message: "Gmail not connected", error: err.message });
    }
  });

  app.get("/api/gmail/drafts/:id", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const asAccountId = req.query.asAccountId ? Number(req.query.asAccountId) : undefined;
    const { isAdmin: _ia, mailTeamPerms: _mtp } = await getSessionUserAccess(req.session);
    const resolved = await resolveAccount(userId, asAccountId, _ia, _mtp);
    if (!resolved) return res.status(403).json({ message: "No Gmail account connected" });
    try {
      const content = await getDraftContent(resolved.userId, req.params.id, resolved.accountId);
      res.json(content);
    } catch (err: any) {
      res.status(503).json({ message: "Gmail not connected", error: err.message });
    }
  });

  app.post("/api/gmail/drafts", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const asAccountId = req.body.asAccountId ? Number(req.body.asAccountId) : undefined;
    const { isAdmin: _ia, mailTeamPerms: _mtp } = await getSessionUserAccess(req.session);
    const resolved = await resolveAccount(userId, asAccountId, _ia, _mtp);
    if (!resolved) return res.status(403).json({ message: "No Gmail account connected" });
    try {
      const { to, subject, body, threadId, draftId } = req.body;
      if (!body) return res.status(400).json({ message: "body is required" });
      const draft = await saveDraft(resolved.userId, to || "", subject || "", body, threadId, draftId, resolved.accountId);
      res.json(draft);
    } catch (err: any) {
      res.status(503).json({ message: "Failed to save draft", error: err.message });
    }
  });

  app.delete("/api/gmail/drafts/:id", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const asAccountId = req.query.asAccountId ? Number(req.query.asAccountId) : undefined;
    const { isAdmin: _ia, mailTeamPerms: _mtp } = await getSessionUserAccess(req.session);
    const resolved = await resolveAccount(userId, asAccountId, _ia, _mtp);
    if (!resolved) return res.status(403).json({ message: "No Gmail account connected" });
    try {
      await deleteDraft(resolved.userId, req.params.id, resolved.accountId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(503).json({ message: "Failed to delete draft", error: err.message });
    }
  });

  // ── Scheduled Emails ─────────────────────────────────────────────────────
  app.get("/api/gmail/scheduled", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const acct = await getUserGmailAccount(userId);
    if (!acct) return res.json([]);
    try {
      const emails = await db.select().from(scheduledEmails)
        .where(eq(scheduledEmails.status, "pending"))
        .orderBy(scheduledEmails.scheduledAt);
      res.json(emails);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/gmail/schedule", requireAuth, async (req, res) => {
    const [user] = await db.select().from(users).where(eq(users.id, req.session.userId!));
    if (!user || user.email !== "trevor@voltsafe.com") {
      return res.status(403).json({ message: "Only the account owner can schedule emails." });
    }
    try {
      const { to, subject, body, threadId, scheduledAt } = req.body;
      if (!to || !body || !scheduledAt) return res.status(400).json({ message: "to, body, scheduledAt required" });
      const [email] = await db.insert(scheduledEmails)
        .values({ to, subject, body, threadId, scheduledAt: new Date(scheduledAt) })
        .returning();
      res.json(email);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/gmail/scheduled/:id", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const acct = await getUserGmailAccount(userId);
    if (!acct) return res.status(403).json({ message: "No Gmail account connected" });
    try {
      await db.update(scheduledEmails)
        .set({ status: "cancelled" })
        .where(eq(scheduledEmails.id, Number(req.params.id)));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/gmail/messages/:id/mark-read", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const asAccountId = req.body.asAccountId ? Number(req.body.asAccountId) : undefined;
    const { isAdmin: _ia, mailTeamPerms: _mtp } = await getSessionUserAccess(req.session);
    const resolved = await resolveAccount(userId, asAccountId, _ia, _mtp);
    if (!resolved) return res.status(403).json({ message: "No Gmail account connected" });
    try {
      await markMessageRead(resolved.userId, req.params.id, resolved.accountId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(503).json({ message: "Failed to mark as read", error: err.message });
    }
  });

  app.post("/api/gmail/messages/:id/toggle-star", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const asAccountId = req.body.asAccountId ? Number(req.body.asAccountId) : undefined;
    const { isAdmin: _ia, mailTeamPerms: _mtp } = await getSessionUserAccess(req.session);
    const resolved = await resolveAccount(userId, asAccountId, _ia, _mtp);
    if (!resolved) return res.status(403).json({ message: "No Gmail account connected" });
    try {
      const gmail = await getGmailClient(resolved.userId, resolved.accountId);
      const { id } = req.params;
      const msg = await gmail.users.messages.get({ userId: "me", id, format: "minimal" });
      const labelIds: string[] = msg.data.labelIds || [];
      const isStarred = labelIds.includes("STARRED");
      if (isStarred) {
        await gmail.users.messages.modify({ userId: "me", id, requestBody: { removeLabelIds: ["STARRED"] } });
      } else {
        await gmail.users.messages.modify({ userId: "me", id, requestBody: { addLabelIds: ["STARRED"] } });
      }
      res.json({ starred: !isStarred });
    } catch (err: any) {
      res.status(503).json({ message: "Failed to toggle star", error: err.message });
    }
  });

  app.post("/api/gmail/bulk-mark-read", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const { messageIds, markAs, asAccountId } = req.body;
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ message: "messageIds array required" });
    }
    if (messageIds.length > 100) {
      return res.status(400).json({ message: "Maximum 100 messages per request" });
    }
    if (!["read", "unread"].includes(markAs)) {
      return res.status(400).json({ message: "markAs must be 'read' or 'unread'" });
    }
    const { isAdmin: _ia, mailTeamPerms: _mtp } = await getSessionUserAccess(req.session);
    const resolved = await resolveAccount(userId, asAccountId ? Number(asAccountId) : undefined, _ia, _mtp);
    if (!resolved) return res.status(403).json({ message: "No Gmail account connected" });
    try {
      const gmail = await getGmailClient(resolved.userId, resolved.accountId);
      let success = 0; let failed = 0;
      for (const messageId of messageIds) {
        try {
          await gmail.users.messages.modify({
            userId: "me", id: messageId,
            requestBody: markAs === "read" ? { removeLabelIds: ["UNREAD"] } : { addLabelIds: ["UNREAD"] },
          });
          success++;
        } catch { failed++; }
      }
      res.json({ success, failed });
    } catch (err: any) {
      res.status(503).json({ message: "Gmail API error", error: err.message });
    }
  });

  app.post("/api/gmail/bulk-archive", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const { threadIds, asAccountId } = req.body;
    if (!Array.isArray(threadIds) || threadIds.length === 0) {
      return res.status(400).json({ message: "threadIds array required" });
    }
    if (threadIds.length > 50) {
      return res.status(400).json({ message: "Maximum 50 threads per request" });
    }
    const { isAdmin: _ia, mailTeamPerms: _mtp } = await getSessionUserAccess(req.session);
    const resolved = await resolveAccount(userId, asAccountId ? Number(asAccountId) : undefined, _ia, _mtp);
    if (!resolved) return res.status(403).json({ message: "No Gmail account connected" });
    try {
      const gmail = await getGmailClient(resolved.userId, resolved.accountId);
      let success = 0; let failed = 0;
      for (const threadId of threadIds) {
        try {
          await gmail.users.threads.modify({
            userId: "me", id: threadId,
            requestBody: { removeLabelIds: ["INBOX"] },
          });
          success++;
        } catch { failed++; }
      }
      res.json({ success, failed });
    } catch (err: any) {
      res.status(503).json({ message: "Gmail API error", error: err.message });
    }
  });

  // ── Inbox Triage API ──────────────────────────────────────────────────────

  // GET /api/inbox/triage-summary — badge counts for triage tabs
  app.get("/api/inbox/triage-summary", requireAuth, async (_req, res) => {
    try {
      const summary = await getTriageSummary();
      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/inbox/awaiting-reply — threads where we owe an external reply
  app.get("/api/inbox/awaiting-reply", requireAuth, async (_req, res) => {
    try {
      const threads = await getAwaitingReplyThreads();
      res.json(threads);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/inbox/triage-thread-ids — all thread IDs bucketed by triage category
  // Used by the frontend to filter Gmail API results locally
  app.get("/api/inbox/triage-thread-ids", requireAuth, async (_req, res) => {
    try {
      const [awaitingRows, hotRows, unlinkedRows] = await Promise.all([
        db.execute(sql`SELECT gmail_thread_id FROM email_threads WHERE awaiting_reply_since IS NOT NULL`),
        db.execute(sql`
          SELECT DISTINCT em.gmail_thread_id
          FROM email_tracking_pixels p
          JOIN email_messages em ON em.gmail_message_id = p.gmail_message_id
          WHERE p.is_hot = true
        `),
        db.execute(sql`
          SELECT gmail_thread_id FROM email_threads
          WHERE association_status = 'unassociated'
        `),
      ]);
      res.json({
        awaitingReply: (awaitingRows.rows as any[]).map(r => r.gmail_thread_id),
        hot:           (hotRows.rows as any[]).map(r => r.gmail_thread_id),
        unlinked:      (unlinkedRows.rows as any[]).map(r => r.gmail_thread_id),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/inbox/compute-awaiting-reply — manually trigger triage computation
  app.post("/api/inbox/compute-awaiting-reply", requireAuth, async (_req, res) => {
    try {
      const result = await computeAwaitingReply();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/inbox/create-task-from-thread", requireAuth, requirePermission("crm", "edit"), async (req, res) => {
    const userId = getSessionUserId(req);
    const { threadId, subject, fromEmail, fromName, linkedObjectType, linkedObjectId, title, dueDate } = req.body;
    if (!threadId) return res.status(400).json({ message: "threadId required" });
    const taskTitle = title || `Follow up: ${subject || fromEmail || "Email"}`;
    const taskDueDate = dueDate ? new Date(dueDate) : (() => {
      const d = new Date(); d.setDate(d.getDate() + 1); return d;
    })();
    const taskData: any = {
      title: taskTitle,
      description: `Created from email thread: ${subject || "(no subject)"}${fromName ? ` from ${fromName}` : fromEmail ? ` from ${fromEmail}` : ""}`,
      dueDate: taskDueDate,
      priority: "medium",
      status: "pending",
      ownerUserId: userId,
      createdByUserId: userId,
    };
    if (linkedObjectType) taskData.linkedObjectType = linkedObjectType;
    if (linkedObjectId) taskData.linkedObjectId = Number(linkedObjectId);
    try {
      const task = await storage.createTask(taskData);
      res.status(201).json(task);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/inbox/create-note-from-thread", requireAuth, requirePermission("crm", "edit"), async (req, res) => {
    const userId = getSessionUserId(req);
    const { threadId, subject, snippet, fromEmail, fromName, linkedObjectType, linkedObjectId } = req.body;
    if (!threadId) return res.status(400).json({ message: "threadId required" });
    if (!linkedObjectType || !linkedObjectId) {
      return res.status(400).json({ message: "linkedObjectType and linkedObjectId required — link this thread to a CRM record first" });
    }
    const noteContent = [
      `Email from: ${fromName || fromEmail || "Unknown"}`,
      `Subject: ${subject || "(no subject)"}`,
      snippet ? `\n${snippet}` : "",
    ].filter(Boolean).join("\n");
    const noteData: any = {
      content: noteContent,
      noteType: "note",
      authorUserId: userId,
      linkedObjectType,
      linkedObjectId: Number(linkedObjectId),
    };
    try {
      const note = await storage.createNote(noteData);
      res.status(201).json(note);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/inbox/thread-signals — batch signal + triage data for multiple thread IDs
  app.get("/api/inbox/thread-signals", requireAuth, async (req, res) => {
    const raw = String(req.query.threadIds || "");
    if (!raw.trim()) return res.json({});
    const threadIds = raw.split(",").map(s => s.trim()).filter(Boolean).slice(0, 100);
    if (!threadIds.length) return res.json({});
    try {
      const escaped = threadIds.map(id => `'${id.replace(/'/g, "''")}'`).join(",");

      // Signal data from tracking pixels (outbound messages in each thread)
      const pixelRows = (await db.execute(sql.raw(`
        SELECT
          em.gmail_thread_id,
          BOOL_OR(p.is_replied)  AS is_replied,
          BOOL_OR(p.is_hot)      AS is_hot,
          MAX(p.engagement_score) AS max_score,
          (ARRAY_AGG(
            COALESCE(p.signal_level, 'none')
            ORDER BY
              CASE COALESCE(p.signal_level, 'none')
                WHEN 'replied' THEN 6
                WHEN 'hot'     THEN 5
                WHEN 'high'    THEN 4
                WHEN 'medium'  THEN 3
                WHEN 'low'     THEN 2
                ELSE 1
              END DESC
          ))[1] AS signal_level
        FROM email_tracking_pixels p
        JOIN email_messages em ON em.gmail_message_id = p.gmail_message_id
        WHERE em.gmail_thread_id IN (${escaped})
          AND em.direction = 'outbound'
        GROUP BY em.gmail_thread_id
      `))).rows as any[];

      // Triage / workflow state from email_threads
      const threadRows = (await db.execute(sql.raw(`
        SELECT
          gmail_thread_id,
          awaiting_reply_since,
          workflow_state,
          reply_status
        FROM email_threads
        WHERE gmail_thread_id IN (${escaped})
      `))).rows as any[];

      const result: Record<string, any> = {};
      for (const t of threadRows) {
        result[t.gmail_thread_id] = {
          awaitingReplySince: t.awaiting_reply_since ?? null,
          workflowState:      t.workflow_state ?? null,
          replyStatus:        t.reply_status ?? null,
          signalLevel:        null,
          isHot:              false,
          isReplied:          false,
          engScore:           0,
        };
      }
      for (const p of pixelRows) {
        if (!result[p.gmail_thread_id]) result[p.gmail_thread_id] = {};
        result[p.gmail_thread_id].signalLevel = p.signal_level ?? null;
        result[p.gmail_thread_id].isHot       = p.is_hot   === true || p.is_hot === "true";
        result[p.gmail_thread_id].isReplied   = p.is_replied === true || p.is_replied === "true";
        result[p.gmail_thread_id].engScore    = Number(p.max_score || 0);
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/inbox/thread-tasks/:threadId — open tasks for a thread's linked CRM records
  app.get("/api/inbox/thread-tasks/:threadId", requireAuth, async (req, res) => {
    const threadId = String(req.params.threadId);
    try {
      const [thread] = (await db.execute(sql.raw(`
        SELECT primary_contact_id, primary_account_id, primary_lead_id, primary_opportunity_id
        FROM email_threads WHERE gmail_thread_id = '${threadId.replace(/'/g, "''")}'
      `))).rows as any[];
      if (!thread) return res.json([]);

      const ids: string[] = [];
      if (thread.primary_contact_id)     ids.push(`(linked_object_type = 'contact'     AND linked_object_id = ${thread.primary_contact_id})`);
      if (thread.primary_account_id)     ids.push(`(linked_object_type = 'account'     AND linked_object_id = ${thread.primary_account_id})`);
      if (thread.primary_lead_id)        ids.push(`(linked_object_type = 'opportunity' AND linked_object_id = ${thread.primary_lead_id})`);
      if (thread.primary_opportunity_id) ids.push(`(linked_object_type = 'opportunity' AND linked_object_id = ${thread.primary_opportunity_id})`);
      if (!ids.length) return res.json([]);

      const tasks = (await db.execute(sql.raw(`
        SELECT id, title, status, priority, due_date, linked_object_type, linked_object_id
        FROM tasks
        WHERE (${ids.join(" OR ")})
          AND status NOT IN ('done', 'completed')
          AND (snoozed_until IS NULL OR snoozed_until <= NOW())
        ORDER BY due_date ASC NULLS LAST, created_at DESC
        LIMIT 8
      `))).rows;
      res.json(tasks);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PATCH /api/inbox/bulk-mark-done — mark threads as workflow_state=done, clears awaiting reply
  app.patch("/api/inbox/bulk-mark-done", requireAuth, async (req, res) => {
    const { threadIds } = req.body;
    if (!Array.isArray(threadIds) || !threadIds.length) {
      return res.status(400).json({ message: "threadIds array required" });
    }
    try {
      const safe = threadIds.map((id: string) => `'${String(id).replace(/'/g, "''")}'`).join(",");
      // Upsert each thread record with done state
      await db.execute(sql.raw(`
        INSERT INTO email_threads (gmail_thread_id, workflow_state, reply_status, awaiting_reply_since, association_status, updated_at)
        SELECT t, 'done', 'done', NULL, 'unassociated', NOW()
        FROM UNNEST(ARRAY[${safe}]) AS t(t)
        ON CONFLICT (gmail_thread_id) DO UPDATE SET
          workflow_state = 'done',
          reply_status = 'done',
          awaiting_reply_since = NULL,
          updated_at = NOW()
      `));
      res.json({ updated: threadIds.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/gmail/send", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const asAccountId = req.body.asAccountId ? Number(req.body.asAccountId) : undefined;
    const { isAdmin: _ia, mailTeamPerms: _mtp } = await getSessionUserAccess(req.session);
    const resolved = await resolveAccount(userId, asAccountId, _ia, _mtp);
    if (!resolved) return res.status(403).json({ message: "No Gmail account connected. Connect your Gmail to send emails." });
    try {
      const { to, subject, body, threadId, attachmentIds, cc, bcc, enableTracking } = req.body;
      if (!to || !body) {
        return res.status(400).json({ message: "to and body are required" });
      }
      if (!threadId && !subject) {
        return res.status(400).json({ message: "subject is required for new emails" });
      }
      const mimeAttachments: { name: string; mimeType: string; data: Buffer }[] = [];
      if (Array.isArray(attachmentIds) && attachmentIds.length > 0) {
        const assetRows = await db.select().from(assets).where(inArray(assets.id, attachmentIds.map(Number)));
        for (const a of assetRows) {
          if (a.fileData) {
            mimeAttachments.push({ name: a.originalName, mimeType: a.mimeType, data: Buffer.from(a.fileData, "base64") });
          } else if (a.filePath && fs.existsSync(a.filePath)) {
            mimeAttachments.push({ name: a.originalName, mimeType: a.mimeType, data: fs.readFileSync(a.filePath) });
          }
        }
      }

      // ── Tracking injection (non-fatal) ────────────────────────────────────
      const trackingId = generateTrackingId();
      const trackingEnabled = enableTracking !== false; // default: true
      let trackedBody = body;
      if (trackingEnabled) {
        try {
          const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
          const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:5000";
          const baseUrl = `${protocol}://${host}`;
          trackedBody = injectTracking(body, trackingId, baseUrl);
        } catch (trackErr) {
          console.warn("[tracking] injection failed (non-fatal):", trackErr);
          trackedBody = body; // fall back to untracked
        }
      }

      const result = await sendEmail(resolved.userId, to, subject || "", trackedBody, threadId, mimeAttachments, resolved.accountId, cc || undefined, bcc || undefined);

      // ── Save tracking record (non-fatal) ──────────────────────────────────
      if (trackingEnabled && result?.id) {
        try {
          await db.execute(sql.raw(`
            INSERT INTO email_tracking_pixels (tracking_id, gmail_message_id, subject, recipient_email, sent_by_user_id, created_at)
            VALUES (
              '${trackingId}',
              '${String(result.id).replace(/'/g, "''")}',
              ${subject ? `'${String(subject).replace(/'/g, "''")}'` : "NULL"},
              '${String(to).replace(/'/g, "''")}',
              ${userId},
              NOW()
            )
          `));
        } catch (saveErr) {
          console.warn("[tracking] pixel save failed (non-fatal):", saveErr);
        }
      }

      // ── Clear awaiting-reply when a threaded reply is sent (non-fatal) ──────
      if (threadId && result?.id) {
        clearAwaitingReply(String(threadId)).catch(e =>
          console.warn("[awaiting-reply] clearAwaitingReply non-fatal:", e)
        );
      }

      res.json({ ...result, trackingId: trackingEnabled ? trackingId : null });
    } catch (err: any) {
      res.status(503).json({ message: "Failed to send email", error: err.message });
    }
  });

  // ── Gmail OAuth connect/callback ─────────────────────────────────────────
  // User-aware: returns connected:false for users without their own Gmail account.
  app.get("/api/gmail/status", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const hasCredentials = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    const { connected, tokenValid, apiEnabled } = await isGmailConnected(userId);
    res.json({ connected, tokenValid, apiEnabled, hasCredentials });
  });

  // ── S1: Per-user email accounts with status ───────────────────────────────
  // Returns the current user's accounts PLUS any workspace-shared accounts.
  // Each account is annotated with isOwner so the frontend can distinguish.
  app.get("/api/gmail/accounts", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const { isAdmin, mailTeamPerms } = await getSessionUserAccess(req.session);
      const accounts = await getAccessibleAccounts(userId, isAdmin, mailTeamPerms);
      const annotated = accounts.map((a) => ({ ...a, isOwner: a.userId === userId && !a.isShared }));
      res.json(annotated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Toggle shared mailbox (master_admin only) ─────────────────────────────
  // PATCH /api/gmail/accounts/:id/share { isShared: boolean }
  app.patch("/api/gmail/accounts/:id/share", requireAuth, async (req, res) => {
    try {
      const currentUser = (req.session as any).userId;
      const [me] = await db.select({ role: users.globalRole }).from(users).where(eq(users.id, currentUser)).limit(1);
      if (!me || me.role !== "master_admin") {
        return res.status(403).json({ message: "Only master admins can share mailboxes." });
      }
      const accountId = Number(req.params.id);
      const { isShared } = req.body;
      if (typeof isShared !== "boolean") {
        return res.status(400).json({ message: "isShared must be a boolean" });
      }
      const [updated] = await db
        .update(emailAccounts)
        .set({ isShared, updatedAt: new Date() })
        .where(eq(emailAccounts.id, accountId))
        .returning();
      if (!updated) return res.status(404).json({ message: "Account not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── S2: Per-account on-demand resync ─────────────────────────────────────
  app.post("/api/gmail/accounts/:id/resync", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const accountId = Number(req.params.id);
      // Enforce ownership — only resync your own account
      const [acct] = await db
        .select()
        .from(emailAccounts)
        .where(and(eq(emailAccounts.id, accountId), eq(emailAccounts.userId, userId)))
        .limit(1);
      if (!acct) return res.status(404).json({ message: "Account not found" });
      const limit = Number(req.query.limit) || 100;
      const result = await syncEmailAccount(accountId, limit);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── S2: Per-account disconnect ────────────────────────────────────────────
  // Sets auth_status = 'revoked', disconnected_at = now, sync_enabled = false.
  // Historical emails are preserved.
  app.post("/api/gmail/accounts/:id/disconnect", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const accountId = Number(req.params.id);
      const [acct] = await db
        .select()
        .from(emailAccounts)
        .where(and(eq(emailAccounts.id, accountId), eq(emailAccounts.userId, userId)))
        .limit(1);
      if (!acct) return res.status(404).json({ message: "Account not found" });

      await db.update(emailAccounts)
        .set({
          authStatus: "revoked",
          syncEnabled: false,
          disconnectedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(emailAccounts.id, accountId));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/gmail/disconnect", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      // Clear legacy system_settings tokens
      await db.delete(systemSettings).where(eq(systemSettings.key, "gmail_refresh_token"));
      await db.delete(systemSettings).where(eq(systemSettings.key, "gmail_access_token"));
      // S2: Also stamp the email_accounts record for this user
      await db.update(emailAccounts)
        .set({
          authStatus: "revoked",
          syncEnabled: false,
          disconnectedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(emailAccounts.userId, userId));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Connect personal Gmail account
  app.get("/api/auth/gmail/connect", requireAuth, (_req, res) => {
    try {
      const url = getAuthUrl();
      res.redirect(url);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Connect a shared workspace inbox (master_admin only).
  // Passes state="shared" through the OAuth flow so the callback knows to
  // mark the resulting account record as isShared=true.
  app.get("/api/auth/gmail/connect-shared", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const [me] = await db.select({ role: users.globalRole }).from(users).where(eq(users.id, userId)).limit(1);
      if (!me || me.role !== "master_admin") {
        return res.status(403).send(`<html><body style="background:#0a0a0a;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
          <div style="text-align:center"><h2 style="color:#ef4444">Access Denied</h2><p>Only master admins can connect shared team inboxes.</p><a href="/gmail" style="color:#14b8a6">← Back</a></div>
        </body></html>`);
      }
      const url = getAuthUrl("shared");
      res.redirect(url);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/auth/google/callback", async (req, res) => {
    const code = req.query.code as string;
    const state = (req.query.state as string) || "";
    if (!code) return res.status(400).send("Missing authorization code");
    const userId: number | undefined = (req.session as any)?.userId;
    if (!userId) {
      return res.status(401).send(`<html><body style="background:#0a0a0a;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
        <div style="text-align:center">
          <h2 style="color:#ef4444">Session Expired</h2>
          <p>Please log in again and try connecting Gmail.</p>
          <a href="/login" style="color:#14b8a6">← Back to Login</a>
        </div>
      </body></html>`);
    }

    // ── Google Calendar OAuth callback ────────────────────────────────────
    if (state === "calendar") {
      try {
        const { email, displayName } = await exchangeCalendarCode(code, userId);
        res.send(`<html><body style="background:#0a0a0a;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
          <div style="text-align:center">
            <h2 style="color:#22c55e">✓ Google Calendar Connected</h2>
            <p>${email ? email + " has been" : "Your calendar has been"} connected to VoltSafe Growth OS.</p>
            <p style="color:#94a3b8;font-size:0.85rem">Syncing your events now…</p>
            <a href="/settings" style="color:#14b8a6">← Back to Settings</a>
            <script>
              // Trigger initial sync after a short delay
              setTimeout(() => fetch('/api/calendar/integrations').then(r => r.json()).then(conns => {
                const g = conns.find(c => c.provider === 'google');
                if (g) fetch('/api/calendar/integrations/' + g.id + '/sync', { method: 'POST' });
              }), 1000);
            </script>
          </div>
        </body></html>`);
      } catch (err: any) {
        res.status(500).send(`<html><body style="background:#0a0a0a;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
          <div style="text-align:center">
            <h2 style="color:#ef4444">Calendar Connection Failed</h2>
            <p>${err.message}</p>
            <a href="/settings" style="color:#14b8a6">← Back to Settings</a>
          </div>
        </body></html>`);
      }
      return;
    }

    // ── Gmail OAuth callback (existing) ───────────────────────────────────
    const isShared = state === "shared";
    try {
      const { emailAddress } = await exchangeCodeForTokens(code, userId, isShared);
      const label = isShared ? "Team inbox" : "Gmail account";
      res.send(`<html><body style="background:#0a0a0a;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
        <div style="text-align:center">
          <h2 style="color:#22c55e">✓ ${label} Connected</h2>
          <p>${emailAddress ? emailAddress + " has been" : "The account has been"} connected to VoltSafe Growth OS${isShared ? " as a shared team inbox" : ""}.</p>
          <a href="/gmail" style="color:#14b8a6">Go to Gmail Inbox →</a>
        </div>
      </body></html>`);
    } catch (err: any) {
      res.status(500).send(`<html><body style="background:#0a0a0a;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
        <div style="text-align:center">
          <h2 style="color:#ef4444">Connection Failed</h2>
          <p>${err.message}</p>
          <a href="/gmail" style="color:#14b8a6">← Back</a>
        </div>
      </body></html>`);
    }
  });

  // ── Email Sync + Association Routes ─────────────────────────────────────
  app.post("/api/gmail/sync", requireAuth, async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 50;
      const result = await runGmailSync(limit);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: "Sync failed", error: err.message });
    }
  });

  // ── Email Filters (blocked domains → "Other") ───────────────────────────
  app.get("/api/email-filters", requireAuth, async (req, res) => {
    try {
      const filters = await db.select().from(emailFilters).orderBy(emailFilters.createdAt);
      res.json(filters);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/email-filters", requireAuth, async (req, res) => {
    try {
      const { domain } = req.body;
      if (!domain) return res.status(400).json({ message: "domain required" });
      const normalised = domain.toLowerCase().trim();
      const [row] = await db.insert(emailFilters)
        .values({ domain: normalised, addedBy: req.session.userId })
        .onConflictDoNothing()
        .returning();
      res.json(row || { domain: normalised });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/email-filters/:id", requireAuth, async (req, res) => {
    try {
      await db.delete(emailFilters).where(eq(emailFilters.id, Number(req.params.id)));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/email-messages", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const msgs = await db.select().from(emailMessages)
        .where(eq(emailMessages.ownerUserId, userId))
        .orderBy(emailMessages.sentAt)
        .limit(100);
      const reversed = msgs.reverse();
      res.json(reversed);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/email-messages/:id/associations", requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const assocs = await db.select().from(emailAssociations)
        .where(eq(emailAssociations.emailMessageId, id));
      res.json(assocs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/email-messages/:id/reassign", requireAuth, async (req, res) => {
    try {
      const emailMsgId = Number(req.params.id);
      const { objectType, objectId, objectName, removeObjectType, removeObjectId } = req.body;

      if (removeObjectType && removeObjectId) {
        await db.delete(emailAssociations).where(
          and(
            eq(emailAssociations.emailMessageId, emailMsgId),
            eq(emailAssociations.objectType, removeObjectType),
            eq(emailAssociations.objectId, Number(removeObjectId))
          )
        );
        await db.insert(associationFeedback).values({
          emailMessageId: emailMsgId,
          originalObjectType: removeObjectType,
          originalObjectId: Number(removeObjectId),
          correctedObjectType: objectType || null,
          correctedObjectId: objectId ? Number(objectId) : null,
          feedbackType: "moved",
        });
      }

      if (objectType && objectId) {
        await db.insert(emailAssociations).values({
          emailMessageId: emailMsgId,
          objectType,
          objectId: Number(objectId),
          objectName: objectName || null,
          confidenceScore: 100,
          associationReasonJson: JSON.stringify(["Manually assigned by user"]),
          isAuto: false,
          isUserConfirmed: true,
        }).onConflictDoNothing();
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/email-messages/:id/confirm", requireAuth, async (req, res) => {
    try {
      const emailMsgId = Number(req.params.id);
      const { associationId } = req.body;
      await db.update(emailAssociations)
        .set({ isUserConfirmed: true, updatedAt: new Date() })
        .where(
          and(
            eq(emailAssociations.emailMessageId, emailMsgId),
            eq(emailAssociations.id, Number(associationId))
          )
        );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/crm-emails", requireAuth, async (req, res) => {
    try {
      const { objectType, objectId } = req.query;
      if (!objectType || !objectId) return res.status(400).json({ message: "objectType and objectId required" });

      const assocs = await db.select().from(emailAssociations)
        .where(
          and(
            eq(emailAssociations.objectType, objectType as string),
            eq(emailAssociations.objectId, Number(objectId))
          )
        )
        .orderBy(emailAssociations.createdAt);

      if (assocs.length === 0) return res.json([]);

      const msgIds = assocs.map(a => a.emailMessageId);
      const msgs = await db.select().from(emailMessages)
        .where(inArray(emailMessages.id, msgIds));

      // Batch-fetch signal data for outbound emails
      const outboundGmailIds = msgs
        .filter(m => m.direction === "outbound" && m.gmailMessageId)
        .map(m => `'${String(m.gmailMessageId).replace(/'/g, "''")}'`);

      const signalMap: Record<string, { signalLevel: string; isHot: boolean; engagementScore: number; isReplied: boolean }> = {};
      if (outboundGmailIds.length > 0) {
        const pixelRows = (await db.execute(sql.raw(`
          SELECT gmail_message_id, signal_level, is_hot, engagement_score, is_replied
          FROM email_tracking_pixels
          WHERE gmail_message_id IN (${outboundGmailIds.join(",")})
        `))).rows as any[];
        for (const r of pixelRows) {
          signalMap[r.gmail_message_id] = {
            signalLevel: r.signal_level || "none",
            isHot: Boolean(r.is_hot),
            engagementScore: Number(r.engagement_score || 0),
            isReplied: Boolean(r.is_replied),
          };
        }
      }

      const result = msgs.map(msg => {
        const assoc = assocs.find(a => a.emailMessageId === msg.id);
        const signal = msg.gmailMessageId ? (signalMap[msg.gmailMessageId] ?? null) : null;
        return {
          ...msg,
          association: assoc,
          signalLevel: signal?.signalLevel ?? null,
          isHot: signal?.isHot ?? false,
          engagementScore: signal?.engagementScore ?? 0,
          isReplied: signal?.isReplied ?? false,
        };
      }).sort((a, b) => {
        const aTime = a.sentAt ? new Date(a.sentAt).getTime() : 0;
        const bTime = b.sentAt ? new Date(b.sentAt).getTime() : 0;
        return bTime - aTime;
      });

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── UNIFIED TIMELINE ────────────────────────────────────────────────────────

  const TIMELINE_OBJECT_TYPES = new Set(["account", "contact", "opportunity", "lead", "partner", "ticket", "quote"]);
  const TIMELINE_ITEM_TYPES = new Set(["note", "activity", "attachment", "email", "task", "quote", "stage_change"]);

  async function buildTimeline(objectType: string, objectId: number, typeFilter: string | undefined, limit: number) {
    const ot = objectType;
    const oid = objectId;
    const lim = limit;
    const typeWhere = typeFilter ? `WHERE tl.type = '${typeFilter}'` : "";

    // Exclude status_change/stage_change activities for opportunities — they surface via stage_change union
    const activityTypeExclude = ot === "opportunity"
      ? `AND a.type NOT IN ('status_change', 'stage_change')`
      : "";

    // Quotes sub-query — only applicable for account and opportunity records
    const quoteUnion = (ot === "account" || ot === "opportunity") ? `
          UNION ALL

          SELECT
            CONCAT('quote_', q.id::text)                                                AS timeline_id,
            'quote'                                                                     AS type,
            q.quote_number                                                              AS title,
            CONCAT(INITCAP(q.status), ' · $', ROUND(q.total::numeric, 0)::text)       AS body,
            q.created_at,
            COALESCE((SELECT name FROM users WHERE id = q.created_by), 'System')       AS created_by,
            json_build_object(
              'quoteId',     q.id,
              'quoteNumber', q.quote_number,
              'status',      q.status,
              'total',       q.total,
              'sentAt',      q.sent_at,
              'acceptedAt',  q.accepted_at
            )::text                                                                     AS metadata
          FROM quotes q
          WHERE ${ot === "account" ? `q.account_id = ${oid}` : `q.opportunity_id = ${oid}`}
    ` : "";

    // Stage-change sub-query — only for opportunity records
    const stageChangeUnion = ot === "opportunity" ? `
          UNION ALL

          SELECT
            CONCAT('stage_', dsh.id::text)                                              AS timeline_id,
            'stage_change'                                                               AS type,
            CONCAT(COALESCE(dsh.from_stage, 'New'), ' → ', dsh.to_stage)               AS title,
            NULL                                                                         AS body,
            dsh.changed_at                                                               AS created_at,
            COALESCE((SELECT name FROM users WHERE id = dsh.changed_by_user_id), 'System') AS created_by,
            json_build_object(
              'fromStage', dsh.from_stage,
              'toStage',   dsh.to_stage,
              'dealId',    dsh.deal_id
            )::text                                                                     AS metadata
          FROM deal_stage_history dsh
          WHERE dsh.deal_id = ${oid}
    ` : "";

    const rows = await db.execute(sql.raw(`
        SELECT * FROM (
          SELECT
            CONCAT('note_', n.id::text)   AS timeline_id,
            'note'                         AS type,
            LEFT(n.content, 120)           AS title,
            n.content                      AS body,
            n.created_at,
            n.author_name                  AS created_by,
            json_build_object(
              'noteId',   n.id,
              'isPinned', n.is_pinned,
              'authorId', n.author_id
            )::text                        AS metadata
          FROM notes n
          WHERE n.linked_object_type = '${ot}' AND n.linked_object_id = ${oid}

          UNION ALL

          SELECT
            CONCAT('activity_', a.id::text)                                           AS timeline_id,
            'activity'                                                                 AS type,
            COALESCE(a.subject, a.type)                                               AS title,
            COALESCE(a.summary, '')                                                    AS body,
            a.created_at,
            COALESCE((SELECT name FROM users WHERE id = a.created_by), 'System')      AS created_by,
            json_build_object(
              'activityId',   a.id,
              'activityType', a.type,
              'outcome',      a.outcome,
              'attendees',    a.attendees,
              'contactId',    a.contact_id
            )::text                                                                    AS metadata
          FROM activities a
          WHERE a.linked_object_type = '${ot}' AND a.linked_object_id = ${oid} ${activityTypeExclude}

          UNION ALL

          SELECT
            CONCAT('attachment_', att.id::text)                                                          AS timeline_id,
            'attachment'                                                                                  AS type,
            att.original_name                                                                            AS title,
            CONCAT(att.mime_type, ' · ', ROUND(att.file_size::numeric / 1024.0, 1), ' KB')             AS body,
            att.created_at,
            att.uploaded_by_name                                                                         AS created_by,
            json_build_object(
              'attachmentId', att.id,
              'fileName',     att.file_name,
              'mimeType',     att.mime_type,
              'fileSize',     att.file_size
            )::text                                                                                       AS metadata
          FROM attachments att
          WHERE att.object_type = '${ot}' AND att.object_id = ${oid}

          UNION ALL

          SELECT
            CONCAT('email_', em.id::text)                                            AS timeline_id,
            'email'                                                                   AS type,
            COALESCE(em.subject, '(no subject)')                                     AS title,
            COALESCE(em.snippet, LEFT(em.body_text, 200))                            AS body,
            COALESCE(em.sent_at, em.created_at)                                      AS created_at,
            COALESCE(em.from_name, em.from_email, 'Unknown')                         AS created_by,
            json_build_object(
              'emailId',          em.id,
              'fromEmail',        em.from_email,
              'fromName',         em.from_name,
              'toEmails',         em.to_emails,
              'direction',        em.direction,
              'confidenceScore',  ea.confidence_score,
              'isAuto',           ea.is_auto,
              'isUserConfirmed',  ea.is_user_confirmed,
              'associationId',    ea.id,
              'associationReasons', ea.association_reason_json,
              'gmailThreadId',    em.gmail_thread_id,
              'gmailMessageId',   em.gmail_message_id
            )::text                                                                   AS metadata
          FROM email_messages em
          JOIN email_associations ea ON ea.email_message_id = em.id
          WHERE ea.object_type = '${ot}' AND ea.object_id = ${oid}

          UNION ALL

          SELECT
            CONCAT('task_', t.id::text)                                              AS timeline_id,
            'task'                                                                   AS type,
            t.title                                                                  AS title,
            t.description                                                            AS body,
            t.created_at,
            COALESCE((SELECT name FROM users WHERE id = t.created_by_user_id), 'System') AS created_by,
            json_build_object(
              'taskId',      t.id,
              'status',      t.status,
              'priority',    t.priority,
              'dueDate',     t.due_date,
              'completedAt', t.completed_at,
              'ownerUserId', t.owner_user_id
            )::text                                                                  AS metadata
          FROM tasks t
          WHERE t.linked_object_type = '${ot}' AND t.linked_object_id = ${oid}
          ${quoteUnion}
          ${stageChangeUnion}
        ) tl
        ${typeWhere}
        ORDER BY tl.created_at DESC NULLS LAST
        LIMIT ${lim}
    `));

    return rows.rows.map((r: any) => ({
      ...r,
      metadata: r.metadata ? JSON.parse(r.metadata) : {},
    }));
  }

  app.get("/api/timeline", requirePermission("crm", "view"), async (req, res) => {
    try {
      const { objectType, objectId, type: typeFilter, limit: limitQ } = req.query as Record<string, string>;
      if (!objectType || !objectId) return res.status(400).json({ message: "objectType and objectId required" });
      if (!TIMELINE_OBJECT_TYPES.has(objectType)) return res.status(400).json({ message: "Invalid objectType" });
      const oid = parseInt(objectId);
      if (isNaN(oid) || oid < 1) return res.status(400).json({ message: "objectId must be a positive integer" });
      if (typeFilter && !TIMELINE_ITEM_TYPES.has(typeFilter)) return res.status(400).json({ message: "Invalid type filter" });
      const lim = Math.min(parseInt(limitQ || "150"), 300);
      const items = await buildTimeline(objectType, oid, typeFilter, lim);
      res.json({ items, total: items.length });
    } catch (err: any) {
      console.error("Timeline error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Per-record timeline shortcut endpoints
  for (const recType of ["account", "lead", "contact", "opportunity"] as const) {
    app.get(`/api/timeline/${recType}/:id`, requirePermission("crm", "view"), async (req, res) => {
      try {
        const oid = parseInt(req.params.id);
        if (isNaN(oid) || oid < 1) return res.status(400).json({ message: "id must be a positive integer" });
        const typeFilter = req.query.type as string | undefined;
        if (typeFilter && !TIMELINE_ITEM_TYPES.has(typeFilter)) return res.status(400).json({ message: "Invalid type filter" });
        const lim = Math.min(parseInt((req.query.limit as string) || "150"), 300);
        const items = await buildTimeline(recType, oid, typeFilter, lim);
        res.json({ items, total: items.length });
      } catch (err: any) {
        console.error(`Timeline/${recType} error:`, err);
        res.status(500).json({ message: err.message });
      }
    });
  }

  app.post("/api/timeline/link-email", requirePermission("crm", "view"), async (req, res) => {
    try {
      const { emailMessageId, objectType, objectId, objectName } = req.body;
      if (!emailMessageId || !objectType || !objectId) {
        return res.status(400).json({ message: "emailMessageId, objectType, objectId required" });
      }
      if (!TIMELINE_OBJECT_TYPES.has(objectType)) return res.status(400).json({ message: "Invalid objectType" });
      const oid = parseInt(objectId);
      const emid = parseInt(emailMessageId);
      if (isNaN(oid) || isNaN(emid)) return res.status(400).json({ message: "objectId and emailMessageId must be integers" });

      // Prevent duplicate association
      const existing = await db.select().from(emailAssociations)
        .where(and(
          eq(emailAssociations.emailMessageId, emid),
          eq(emailAssociations.objectType, objectType),
          eq(emailAssociations.objectId, oid)
        ))
        .limit(1);
      if (existing.length > 0) return res.status(409).json({ message: "Email already linked to this record", association: existing[0] });

      const [created] = await db.insert(emailAssociations).values({
        emailMessageId: emid,
        objectType,
        objectId: oid,
        objectName: objectName ?? null,
        confidenceScore: 100,
        associationReasonJson: JSON.stringify(["manual"]),
        isAuto: false,
        isUserConfirmed: true,
      }).returning();

      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/timeline/unlink-email/:id", requirePermission("crm", "view"), async (req, res) => {
    try {
      const assocId = parseInt(req.params.id);
      if (isNaN(assocId)) return res.status(400).json({ message: "Invalid association id" });
      const [deleted] = await db.delete(emailAssociations)
        .where(eq(emailAssociations.id, assocId))
        .returning();
      if (!deleted) return res.status(404).json({ message: "Association not found" });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────

  app.get("/api/gmail/associations-by-thread", requireAuth, async (req, res) => {
    try {
      const { threadIds } = req.query;
      if (!threadIds) return res.json({});
      const ids: string[] = Array.isArray(threadIds) ? threadIds as string[] : [threadIds as string];

      const threads = await db.select().from(emailThreads)
        .where(inArray(emailThreads.gmailThreadId, ids));

      const result: Record<string, any> = {};
      for (const t of threads) {
        result[t.gmailThreadId] = t;
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Sales & Marketing Assets ────────────────────────────────────────────
  app.get("/api/assets", requireAuth, async (_req, res) => {
    try {
      const all = await db.select().from(assets).orderBy(assets.createdAt);
      // Include hasFile flag, but never return fileData in the list (too large)
      const result = all.reverse().map(({ fileData, filePath, ...rest }) => ({
        ...rest,
        hasFile: !!(fileData || (filePath && fs.existsSync(filePath))),
      }));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/assets", requirePermission("knowledge", "edit"), assetUpload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file provided" });
      const { name, description, tags } = req.body;
      const mimeType = req.file.mimetype;
      let category = "other";
      if (mimeType.startsWith("image/")) category = "image";
      else if (mimeType === "application/pdf") category = "document";
      else if (["application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(mimeType)) category = "document";
      else if (["application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv"].includes(mimeType)) category = "spreadsheet";
      else if (["application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation"].includes(mimeType)) category = "presentation";

      const fileData = req.file.buffer.toString("base64");
      const { folderId } = req.body;
      const [asset] = await db.insert(assets).values({
        name: name || req.file.originalname,
        originalName: req.file.originalname,
        mimeType,
        size: req.file.size,
        filePath: "",
        fileData,
        category,
        description: description || null,
        tags: tags || "",
        folderId: folderId ? Number(folderId) : null,
        uploadedBy: req.session.userId ?? null,
      }).returning();
      res.json({ ...asset, fileData: undefined });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/assets/:id", requirePermission("knowledge", "edit"), async (req, res) => {
    try {
      const { name, description, tags, folderId } = req.body;
      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (tags !== undefined) updateData.tags = tags;
      if (folderId !== undefined) updateData.folderId = folderId === null ? null : Number(folderId);
      const [updated] = await db.update(assets)
        .set(updateData)
        .where(eq(assets.id, Number(req.params.id)))
        .returning();
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Replace file data for an existing asset (re-upload flow)
  app.post("/api/assets/:id/replace", requirePermission("knowledge", "edit"), assetUpload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file provided" });
      const fileData = req.file.buffer.toString("base64");
      const [updated] = await db.update(assets)
        .set({ fileData, size: req.file.size, mimeType: req.file.mimetype, filePath: "" })
        .where(eq(assets.id, Number(req.params.id)))
        .returning();
      if (!updated) return res.status(404).json({ message: "Asset not found" });
      res.json({ ...updated, fileData: undefined });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/assets/:id", requirePermission("knowledge", "edit"), async (req, res) => {
    try {
      const [asset] = await db.select().from(assets).where(eq(assets.id, Number(req.params.id)));
      if (!asset) return res.status(404).json({ message: "Asset not found" });
      // Clean up legacy disk file if it exists
      if (asset.filePath && fs.existsSync(asset.filePath)) { try { fs.unlinkSync(asset.filePath); } catch {} }
      await db.delete(assets).where(eq(assets.id, Number(req.params.id)));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Price Lists ──────────────────────────────────────────────────────────
  app.get("/api/price-lists", requireAuth, async (_req, res) => {
    try {
      const lists = await db.select().from(priceLists).orderBy(priceLists.id);
      const items = await db.select().from(priceListItems).orderBy(priceListItems.sortOrder, priceListItems.id);
      const result = lists.map(list => ({
        ...list,
        items: items.filter(i => i.priceListId === list.id),
      }));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/price-lists", requireAuth, async (req, res) => {
    try {
      const { name, currency, description } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "Name is required" });
      const [list] = await db.insert(priceLists).values({ name: name.trim(), currency: currency || "USD", description: description || null }).returning();
      res.status(201).json({ ...list, items: [] });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/price-lists/:id", requireAuth, async (req, res) => {
    try {
      const { name, currency, description } = req.body;
      const updateData: any = { updatedAt: new Date() };
      if (name !== undefined) updateData.name = name;
      if (currency !== undefined) updateData.currency = currency;
      if (description !== undefined) updateData.description = description;
      const [updated] = await db.update(priceLists).set(updateData).where(eq(priceLists.id, Number(req.params.id))).returning();
      if (!updated) return res.status(404).json({ message: "Price list not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/price-lists/:id", requireAuth, async (req, res) => {
    try {
      await db.delete(priceLists).where(eq(priceLists.id, Number(req.params.id)));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Price List Items
  app.post("/api/price-lists/:id/items", requireAuth, async (req, res) => {
    try {
      const priceListId = Number(req.params.id);
      const { sku, name, description, category, listPrice, unitType, isRecurring, sortOrder } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "Name is required" });
      const [item] = await db.insert(priceListItems).values({
        priceListId,
        sku: sku?.trim() || "",
        name: name.trim(),
        description: description?.trim() || "",
        category: category || "hardware",
        listPrice: Number(listPrice) || 0,
        unitType: unitType?.trim() || "unit",
        isRecurring: !!isRecurring,
        sortOrder: Number(sortOrder) || 0,
      }).returning();
      res.status(201).json(item);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/price-list-items/:id", requireAuth, async (req, res) => {
    try {
      const { sku, name, description, category, listPrice, unitType, isRecurring, sortOrder } = req.body;
      const updateData: any = {};
      if (sku !== undefined) updateData.sku = sku;
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (category !== undefined) updateData.category = category;
      if (listPrice !== undefined) updateData.listPrice = Number(listPrice);
      if (unitType !== undefined) updateData.unitType = unitType;
      if (isRecurring !== undefined) updateData.isRecurring = !!isRecurring;
      if (sortOrder !== undefined) updateData.sortOrder = Number(sortOrder);
      const [updated] = await db.update(priceListItems).set(updateData).where(eq(priceListItems.id, Number(req.params.id))).returning();
      if (!updated) return res.status(404).json({ message: "Item not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/price-list-items/:id", requireAuth, async (req, res) => {
    try {
      await db.delete(priceListItems).where(eq(priceListItems.id, Number(req.params.id)));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Asset Folder CRUD
  app.get("/api/asset-folders", requireAuth, async (_req, res) => {
    try {
      const folders = await db.select().from(assetFolders).orderBy(assetFolders.name);
      res.json(folders);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/asset-folders", requirePermission("knowledge", "edit"), async (req, res) => {
    try {
      const { name, parentFolderId } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "Folder name is required" });
      const [folder] = await db.insert(assetFolders).values({
        name: name.trim(),
        parentFolderId: parentFolderId ? Number(parentFolderId) : null,
      }).returning();
      res.status(201).json(folder);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/asset-folders/:id", requirePermission("knowledge", "edit"), async (req, res) => {
    try {
      const { name } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "Folder name is required" });
      const [updated] = await db.update(assetFolders)
        .set({ name: name.trim() })
        .where(eq(assetFolders.id, Number(req.params.id)))
        .returning();
      if (!updated) return res.status(404).json({ message: "Folder not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/asset-folders/:id", requirePermission("knowledge", "edit"), async (req, res) => {
    try {
      const fId = Number(req.params.id);
      // Move assets in this folder back to root (null)
      await db.update(assets).set({ folderId: null }).where(eq(assets.folderId, fId));
      // Move sub-folders to root
      await db.update(assetFolders).set({ parentFolderId: null }).where(eq(assetFolders.parentFolderId, fId));
      await db.delete(assetFolders).where(eq(assetFolders.id, fId));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  function sendAssetFile(asset: { fileData?: string | null; filePath: string; mimeType: string; originalName: string }, res: any, disposition: "inline" | "attachment") {
    res.setHeader("Content-Disposition", `${disposition}; filename="${encodeURIComponent(asset.originalName)}"`);
    res.setHeader("Content-Type", asset.mimeType);
    if (asset.fileData) {
      const buf = Buffer.from(asset.fileData, "base64");
      return res.send(buf);
    }
    // Legacy fallback: file was stored on disk
    if (asset.filePath && fs.existsSync(asset.filePath)) {
      return res.sendFile(path.resolve(asset.filePath));
    }
    return res.status(404).json({ message: "File data not found — please re-upload this asset" });
  }

  app.get("/api/assets/:id/file", requireAuth, async (req, res) => {
    try {
      const [asset] = await db.select().from(assets).where(eq(assets.id, Number(req.params.id)));
      if (!asset) return res.status(404).json({ message: "Asset not found" });
      sendAssetFile(asset, res, "inline");
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/assets/:id/download", requireAuth, async (req, res) => {
    try {
      const [asset] = await db.select().from(assets).where(eq(assets.id, Number(req.params.id)));
      if (!asset) return res.status(404).json({ message: "Asset not found" });
      sendAssetFile(asset, res, "attachment");
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  await seedDatabase();
  await seedUsers();

  return httpServer;
}

async function seedDatabase() {
  const existingMetrics = await storage.getMetrics();
  if (existingMetrics.length === 0) {
    await db.insert(metrics).values([
      { title: "Total Revenue", value: "$45,231.89", change: "+20.1% from last month", description: "", icon: "dollar-sign" },
      { title: "Subscriptions", value: "+2350", change: "+180.1% from last month", description: "", icon: "users" },
      { title: "Sales", value: "+12,234", change: "+19% from last month", description: "", icon: "credit-card" },
      { title: "Active Now", value: "+573", change: "+201 since last hour", description: "", icon: "activity" },
    ]);
  }

  const existingSales = await storage.getSales();
  if (existingSales.length === 0) {
    await db.insert(sales).values([
      { name: "Olivia Martin", email: "olivia.martin@email.com", amount: "+$1,999.00", avatarUrl: "https://i.pravatar.cc/150?u=olivia" },
      { name: "Jackson Lee", email: "jackson.lee@email.com", amount: "+$39.00", avatarUrl: "https://i.pravatar.cc/150?u=jackson" },
      { name: "Isabella Nguyen", email: "isabella.nguyen@email.com", amount: "+$299.00", avatarUrl: "https://i.pravatar.cc/150?u=isabella" },
      { name: "William Kim", email: "will@email.com", amount: "+$99.00", avatarUrl: "https://i.pravatar.cc/150?u=william" },
      { name: "Sofia Davis", email: "sofia.davis@email.com", amount: "+$39.00", avatarUrl: "https://i.pravatar.cc/150?u=sofia" },
    ]);
  }

  const existingChartData = await storage.getChartData();
  if (existingChartData.length === 0) {
    await db.insert(chartData).values([
      { month: "Jan", revenue: 4000 }, { month: "Feb", revenue: 3000 }, { month: "Mar", revenue: 2000 },
      { month: "Apr", revenue: 2780 }, { month: "May", revenue: 1890 }, { month: "Jun", revenue: 2390 },
      { month: "Jul", revenue: 3490 }, { month: "Aug", revenue: 4000 }, { month: "Sep", revenue: 3000 },
      { month: "Oct", revenue: 2000 }, { month: "Nov", revenue: 2780 }, { month: "Dec", revenue: 1890 },
    ]);
  }
}

// ── Jira Routes ────────────────────────────────────────────────────────────────
export function registerJiraRoutes(app: Express) {
  app.get("/api/jira/projects", requireAuth, async (req, res) => {
    try {
      const { getUncachableJiraClient, invalidateJiraToken } = await import("./jira-client");
      let client = await getUncachableJiraClient();
      let projects: any;
      try {
        projects = await client.projects.searchProjects({ maxResults: 50 });
      } catch (err: any) {
        const is401 = err?.response?.status === 401 || err?.status === 401 ||
          (err?.message && (err.message.includes('401') || err.message.toLowerCase().includes('unauthorized')));
        if (is401) {
          invalidateJiraToken();
          client = await getUncachableJiraClient();
          projects = await client.projects.searchProjects({ maxResults: 50 });
        } else throw err;
      }
      res.json(projects);
    } catch (err: any) {
      res.status(503).json({ message: "Jira not connected", error: err.message });
    }
  });

  app.get("/api/jira/issues", requireAuth, async (req, res) => {
    try {
      const { getJiraCredentials, invalidateJiraToken } = await import("./jira-client");
      const projectKey = req.query.project as string | undefined;
      if (!projectKey) return res.json({ issues: [], isLast: true });

      const doFetch = async () => {
        const { accessToken, hostName } = await getJiraCredentials();
        const jql = encodeURIComponent(`project = ${projectKey} ORDER BY updated DESC`);
        const fields = "summary,status,priority,assignee,updated,issuetype,project";
        const url = `${hostName}/rest/api/3/search/jql?jql=${jql}&maxResults=50&fields=${fields}`;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
        if (r.status === 401) { invalidateJiraToken(); throw Object.assign(new Error("401"), { status: 401 }); }
        if (!r.ok) throw new Error(`Jira API error: ${r.status}`);
        return r.json();
      };

      let data: any;
      try { data = await doFetch(); }
      catch (err: any) {
        if (err.status === 401) data = await doFetch();
        else throw err;
      }
      res.json(data);
    } catch (err: any) {
      res.status(503).json({ message: "Jira not connected", error: err.message });
    }
  });

  app.post("/api/jira/issues", requireAuth, async (req, res) => {
    try {
      const { getUncachableJiraClient, invalidateJiraToken } = await import("./jira-client");
      let client = await getUncachableJiraClient();
      const { projectKey, summary, description, issueType = "Task" } = req.body;
      const issueBody = {
        fields: {
          project: { key: projectKey },
          summary,
          description: description ? {
            type: "doc", version: 1,
            content: [{ type: "paragraph", content: [{ type: "text", text: description }] }],
          } : undefined,
          issuetype: { name: issueType },
        },
      };
      let issue: any;
      try {
        issue = await client.issues.createIssue(issueBody);
      } catch (err: any) {
        const is401 = err?.response?.status === 401 || err?.status === 401 ||
          (err?.message && (err.message.includes('401') || err.message.toLowerCase().includes('unauthorized')));
        if (is401) {
          invalidateJiraToken();
          client = await getUncachableJiraClient();
          issue = await client.issues.createIssue(issueBody);
        } else throw err;
      }
      res.json(issue);
    } catch (err: any) {
      res.status(503).json({ message: "Jira not connected", error: err.message });
    }
  });
}

// ── Confluence Routes ──────────────────────────────────────────────────────────
// Uses direct fetch — confluence.js SDK calls deprecated endpoints (410 Gone).
// Spaces are derived from recent page content (no dedicated spaces API available with current scopes).
export function registerConfluenceRoutes(app: Express) {
  async function confFetch(path: string, invalidate: () => void, getCredentials: () => Promise<{ accessToken: string; hostName: string }>) {
    const doFetch = async () => {
      const { accessToken, hostName } = await getCredentials();
      const r = await fetch(`${hostName}${path}`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
      if (r.status === 401) { invalidate(); throw Object.assign(new Error("401"), { status: 401 }); }
      if (!r.ok) throw new Error(`Confluence API error: ${r.status}`);
      return r.json();
    };
    try { return await doFetch(); }
    catch (err: any) {
      if (err.status === 401) return doFetch();
      throw err;
    }
  }

  app.get("/api/confluence/spaces", requireAuth, async (req, res) => {
    try {
      const { getConfluenceCredentials, invalidateConfluenceToken } = await import("./confluence-client");
      // Derive spaces from recent pages — no dedicated spaces endpoint is available
      const data = await confFetch(
        "/rest/api/content/search?cql=type%3Dpage+ORDER+BY+lastmodified+DESC&limit=50&expand=space",
        invalidateConfluenceToken,
        getConfluenceCredentials,
      );
      const spaceMap: Record<string, string> = {};
      for (const page of data.results || []) {
        if (page.space?.key && !spaceMap[page.space.key]) spaceMap[page.space.key] = page.space.name;
      }
      const results = Object.entries(spaceMap).map(([key, name]) => ({ key, name }));
      res.json({ results, size: results.length });
    } catch (err: any) {
      res.status(503).json({ message: "Confluence not connected", error: err.message });
    }
  });

  app.get("/api/confluence/pages", requireAuth, async (req, res) => {
    try {
      const { getConfluenceCredentials, invalidateConfluenceToken } = await import("./confluence-client");
      const spaceKey = req.query.space as string | undefined;
      const query = req.query.q as string | undefined;
      const cql = query
        ? `type = page AND text ~ "${query.replace(/"/g, '')}"${spaceKey ? ` AND space.key = "${spaceKey}"` : ""} ORDER BY lastmodified DESC`
        : spaceKey
        ? `type = page AND space.key = "${spaceKey}" ORDER BY lastmodified DESC`
        : `type = page ORDER BY lastmodified DESC`;
      const data = await confFetch(
        `/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=25&expand=space,history.lastUpdated,version`,
        invalidateConfluenceToken,
        getConfluenceCredentials,
      );
      res.json(data);
    } catch (err: any) {
      res.status(503).json({ message: "Confluence not connected", error: err.message });
    }
  });

  app.get("/api/confluence/pages/:id", requireAuth, async (req, res) => {
    try {
      const { getConfluenceCredentials, invalidateConfluenceToken } = await import("./confluence-client");
      const { id } = req.params;
      // Use CQL search — direct /content/{id} endpoint is 410 Gone
      const [pageData, childrenData] = await Promise.all([
        confFetch(
          `/rest/api/content/search?cql=${encodeURIComponent(`id = ${id}`)}&expand=body.view,body.storage,version,space,ancestors&limit=1`,
          invalidateConfluenceToken,
          getConfluenceCredentials,
        ),
        confFetch(
          `/rest/api/content/search?cql=${encodeURIComponent(`parent = ${id} AND type = page ORDER BY title`)}&limit=50`,
          invalidateConfluenceToken,
          getConfluenceCredentials,
        ),
      ]);
      const page = pageData.results?.[0];
      if (!page) return res.status(404).json({ message: "Page not found" });
      // Attach children in the shape the frontend expects
      page.children = { page: { results: childrenData.results || [], size: childrenData.size || 0 } };
      res.json(page);
    } catch (err: any) {
      console.error("[confluence] page detail error:", err.message);
      res.status(503).json({ message: err.message || "Confluence not connected", error: err.message });
    }
  });

  app.post("/api/confluence/pages", requireAuth, async (req, res) => {
    try {
      const { getConfluenceCredentials, invalidateConfluenceToken } = await import("./confluence-client");
      const { title, spaceKey, parentId, body: bodyText } = req.body;
      const payload: any = {
        type: "page",
        title,
        space: { key: spaceKey },
        body: {
          storage: {
            value: bodyText ? `<p>${bodyText.replace(/\n/g, "</p><p>")}</p>` : "",
            representation: "storage",
          },
        },
      };
      if (parentId) payload.ancestors = [{ id: parentId }];
      const { accessToken, hostName } = await getConfluenceCredentials();
      const r = await fetch(`${hostName}/rest/api/content`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        return res.status(r.status).json({ message: err.message || `Confluence error: ${r.status}` });
      }
      const data = await r.json();
      res.json(data);
    } catch (err: any) {
      res.status(503).json({ message: "Confluence not connected", error: err.message });
    }
  });

  app.put("/api/confluence/pages/:id", requireAuth, async (req, res) => {
    try {
      const { getConfluenceCredentials, invalidateConfluenceToken } = await import("./confluence-client");
      const { id } = req.params;
      const { title, body: bodyText, version } = req.body;
      const payload = {
        version: { number: version },
        title,
        type: "page",
        body: {
          storage: {
            value: bodyText ? `<p>${bodyText.replace(/\n/g, "</p><p>")}</p>` : "",
            representation: "storage",
          },
        },
      };
      const { accessToken, hostName } = await getConfluenceCredentials();
      const r = await fetch(`${hostName}/rest/api/content/${id}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        return res.status(r.status).json({ message: err.message || `Confluence error: ${r.status}` });
      }
      const data = await r.json();
      res.json(data);
    } catch (err: any) {
      res.status(503).json({ message: "Confluence not connected", error: err.message });
    }
  });

  app.get("/api/jira/issues/:key", requireAuth, async (req, res) => {
    try {
      const { getJiraCredentials, invalidateJiraToken } = await import("./jira-client");
      const { key } = req.params;
      const fields = "summary,description,status,priority,assignee,updated,created,issuetype,subtasks,labels,project,comment,attachment";
      const doFetch = async () => {
        const { accessToken, hostName } = await getJiraCredentials();
        const r = await fetch(`${hostName}/rest/api/3/issue/${key}?fields=${fields}`, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        });
        if (r.status === 401) { invalidateJiraToken(); throw Object.assign(new Error("401"), { status: 401 }); }
        if (!r.ok) throw new Error(`Jira API error: ${r.status}`);
        return r.json();
      };
      let data: any;
      try { data = await doFetch(); } catch (err: any) {
        if (err.status === 401) data = await doFetch(); else throw err;
      }
      res.json(data);
    } catch (err: any) {
      res.status(503).json({ message: "Jira not connected", error: err.message });
    }
  });

  app.get("/api/jira/issues/:key/transitions", requireAuth, async (req, res) => {
    try {
      const { getJiraCredentials, invalidateJiraToken } = await import("./jira-client");
      const { key } = req.params;
      const doFetch = async () => {
        const { accessToken, hostName } = await getJiraCredentials();
        const r = await fetch(`${hostName}/rest/api/3/issue/${key}/transitions`, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        });
        if (r.status === 401) { invalidateJiraToken(); throw Object.assign(new Error("401"), { status: 401 }); }
        if (!r.ok) throw new Error(`Jira API error: ${r.status}`);
        return r.json();
      };
      let data: any;
      try { data = await doFetch(); } catch (err: any) {
        if (err.status === 401) data = await doFetch(); else throw err;
      }
      res.json(data);
    } catch (err: any) {
      res.status(503).json({ message: "Jira not connected", error: err.message });
    }
  });

  app.post("/api/jira/issues/:key/transitions", requireAuth, async (req, res) => {
    try {
      const { getJiraCredentials, invalidateJiraToken } = await import("./jira-client");
      const { key } = req.params;
      const { transitionId } = req.body;
      const doFetch = async () => {
        const { accessToken, hostName } = await getJiraCredentials();
        const r = await fetch(`${hostName}/rest/api/3/issue/${key}/transitions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ transition: { id: transitionId } }),
        });
        if (r.status === 401) { invalidateJiraToken(); throw Object.assign(new Error("401"), { status: 401 }); }
        if (!r.ok) throw new Error(`Jira API error: ${r.status}`);
        return { ok: true };
      };
      try { await doFetch(); } catch (err: any) {
        if (err.status === 401) await doFetch(); else throw err;
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(503).json({ message: "Jira not connected", error: err.message });
    }
  });

  // ─── Stage 3 — Projects ─────────────────────────────────────────────────
  app.get("/api/projects", requireAuth, async (req, res) => {
    try {
      const { type, status, accountId } = req.query as Record<string, string>;
      const data = await storage.getProjects({
        type: type || undefined,
        status: status || undefined,
        accountId: accountId ? Number(accountId) : undefined,
      });
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/projects/:id", requireAuth, async (req, res) => {
    try {
      const p = await storage.getProject(Number(req.params.id));
      if (!p) return res.status(404).json({ message: "Not found" });
      res.json(p);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/projects", requirePermission("projects", "edit"), async (req, res) => {
    try {
      const p = await storage.createProject(req.body);
      res.status(201).json(p);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/projects/:id", requirePermission("projects", "edit"), async (req, res) => {
    try {
      const p = await storage.updateProject(Number(req.params.id), req.body);
      if (!p) return res.status(404).json({ message: "Not found" });
      res.json(p);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/projects/:id", requirePermission("projects", "edit"), async (req, res) => {
    try {
      const ok = await storage.deleteProject(Number(req.params.id));
      if (!ok) return res.status(404).json({ message: "Not found" });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Stage 3 — Notes ────────────────────────────────────────────────────
  app.get("/api/notes/all", requirePermission("crm", "view"), async (req, res) => {
    try {
      const { type, search, limit: limitQ } = req.query as Record<string, string>;
      const lim = Math.min(Number(limitQ) || 50, 100);
      const typeFilter = type && type !== "all" ? `AND linked_object_type = '${type.replace(/'/g,"''")}'` : "";
      const searchFilter = search ? `AND content ILIKE '%${search.replace(/'/g,"''").replace(/%/g,"\\%").replace(/_/g,"\\_")}%'` : "";
      const rows = await db.execute(sql.raw(`
        SELECT n.*, 
          CASE n.linked_object_type
            WHEN 'contact' THEN (SELECT name FROM contacts WHERE id = n.linked_object_id)
            WHEN 'account' THEN (SELECT name FROM accounts WHERE id = n.linked_object_id)
            WHEN 'opportunity' THEN (SELECT title FROM opportunities WHERE id = n.linked_object_id)
            ELSE NULL
          END AS linked_object_name
        FROM notes n
        WHERE 1=1 ${typeFilter} ${searchFilter}
        ORDER BY n.created_at DESC
        LIMIT ${lim}
      `));
      res.json(rows.rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/activity-feed", requirePermission("crm", "view"), async (req, res) => {
    try {
      const { limit: limitQ, balanced: balancedQ } = req.query as Record<string, string>;
      const lim = Math.min(Number(limitQ) || 50, 100);
      // Default: balanced mode — each arm contributes up to lim*3 rows so every data source
      // can appear in the final chronological cut even when one type dominates recently.
      // Pass ?balanced=false to get strict chronological mode (each arm limited to lim rows).
      const balanced = balancedQ !== "false";
      const armLim = balanced ? Math.min(lim * 3, 200) : lim;
      const rows = await db.execute(sql.raw(`
        SELECT * FROM (
          SELECT 'note' as feed_type, n.id, n.content as summary,
                 n.author_name as actor, n.created_at,
                 n.linked_object_type, n.linked_object_id,
                 CASE n.linked_object_type
                   WHEN 'contact' THEN (SELECT name FROM contacts WHERE id = n.linked_object_id)
                   WHEN 'account' THEN (SELECT name FROM accounts WHERE id = n.linked_object_id)
                   WHEN 'opportunity' THEN (SELECT title FROM opportunities WHERE id = n.linked_object_id)
                   ELSE NULL
                 END AS linked_object_name,
                 NULL::text as extra
          FROM notes n
          ORDER BY n.created_at DESC LIMIT ${armLim}
        ) notes_arm
        UNION ALL
        SELECT * FROM (
          SELECT 'email' as feed_type, em.id, em.subject as summary,
                 COALESCE(em.from_name, em.from_email) as actor, em.sent_at as created_at,
                 'account' as linked_object_type, em.source_account_id::int as linked_object_id,
                 (SELECT name FROM accounts WHERE id = em.source_account_id) as linked_object_name,
                 em.direction::text as extra
          FROM email_messages em
          WHERE em.source_account_id IS NOT NULL AND em.sent_at IS NOT NULL
          ORDER BY em.sent_at DESC LIMIT ${armLim}
        ) email_arm
        UNION ALL
        SELECT * FROM (
          SELECT 'meeting' as feed_type, ce.id, ce.title as summary,
                 'Calendar' as actor, ce.created_at,
                 ce.linked_object_type, ce.linked_object_id,
                 NULL::text as linked_object_name,
                 ce.event_type::text as extra
          FROM calendar_events ce
          WHERE ce.created_at IS NOT NULL
          ORDER BY ce.created_at DESC LIMIT ${armLim}
        ) meeting_arm
        UNION ALL
        SELECT * FROM (
          SELECT 'task' as feed_type, t.id, t.title as summary,
                 (SELECT name FROM users WHERE id = t.owner_user_id) as actor, t.created_at,
                 t.linked_object_type, t.linked_object_id,
                 CASE t.linked_object_type
                   WHEN 'contact' THEN (SELECT name FROM contacts WHERE id = t.linked_object_id)
                   WHEN 'account' THEN (SELECT name FROM accounts WHERE id = t.linked_object_id)
                   WHEN 'opportunity' THEN (SELECT title FROM opportunities WHERE id = t.linked_object_id)
                   ELSE NULL
                 END AS linked_object_name,
                 t.status::text as extra
          FROM tasks t
          ORDER BY t.created_at DESC LIMIT ${armLim}
        ) task_arm
        UNION ALL
        SELECT * FROM (
          SELECT 'activity' as feed_type, a.id, a.summary,
                 COALESCE((SELECT name FROM users WHERE id = a.created_by), 'System') as actor, a.created_at,
                 a.linked_object_type, a.linked_object_id,
                 NULL::text as linked_object_name,
                 a.type::text as extra
          FROM activities a
          ORDER BY a.created_at DESC LIMIT ${armLim}
        ) activity_arm
        ORDER BY created_at DESC
        LIMIT ${lim}
      `));
      res.json(rows.rows);
    } catch (err: any) {
      console.error("Activity feed error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/notes", requireAuth, async (req, res) => {
    try {
      const { linkedObjectType, linkedObjectId } = req.query as Record<string, string>;
      if (!linkedObjectType || !linkedObjectId) return res.status(400).json({ message: "linkedObjectType and linkedObjectId required" });
      const data = await storage.getNotes(linkedObjectType, Number(linkedObjectId));
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/notes", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const [dbUser] = userId
        ? await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, userId)).limit(1)
        : [];
      const note = await storage.createNote({
        ...req.body,
        authorId: dbUser?.id ?? null,
        authorName: dbUser?.name ?? "System",
      });
      res.status(201).json(note);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Returns true if the session user is the note's author OR holds an admin role.
  // globalRole is set in session at login time (see requireAuth / login route).
  function noteOwnerOrAdmin(session: any, authorId: number | null): boolean {
    const role = String(session.globalRole || "");
    if (["master_admin", "admin"].includes(role)) return true;
    return authorId !== null && authorId !== undefined && authorId === session.userId;
  }

  app.put("/api/notes/:id", requireAuth, async (req, res) => {
    try {
      const existing = await storage.getNoteById(Number(req.params.id));
      if (!existing) return res.status(404).json({ message: "Note not found" });

      if (!noteOwnerOrAdmin(req.session, existing.authorId ?? null)) {
        return res.status(403).json({ message: "You do not have permission to edit this note" });
      }

      // Whitelist: only 'content' is editable. Authorship, linkage, and timestamps
      // are system-managed and must not be alterable by the client.
      const safe = pick(req.body as Record<string, unknown>, ["content"] as const);
      if (!safe.content || typeof safe.content !== "string" || !(safe.content as string).trim()) {
        return res.status(400).json({ message: "content is required" });
      }

      const note = await storage.updateNote(existing.id, safe as any);
      if (!note) return res.status(404).json({ message: "Note not found" });
      res.json(note);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/notes/:id", requireAuth, async (req, res) => {
    try {
      const existing = await storage.getNoteById(Number(req.params.id));
      if (!existing) return res.status(404).json({ message: "Note not found" });

      if (!noteOwnerOrAdmin(req.session, existing.authorId ?? null)) {
        return res.status(403).json({ message: "You do not have permission to delete this note" });
      }

      await storage.deleteNote(existing.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/notes/:id/pin", requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const existing = await storage.getNoteById(id);
      if (!existing) return res.status(404).json({ message: "Note not found" });
      const newPinned = !existing.isPinned;
      await db.execute(sql`UPDATE notes SET is_pinned = ${newPinned}, updated_at = NOW() WHERE id = ${id}`);
      res.json({ ok: true, isPinned: newPinned });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Global Search ────────────────────────────────────────────────────────
  app.get("/api/search", requireAuth, async (req, res) => {
    try {
      const q = ((req.query.q as string) || "").trim();
      if (q.length < 2) return res.json({ results: [] });

      // Sanitize for sql.raw ILIKE: escape single quotes (SQL injection prevention)
      // and backslashes (PostgreSQL ILIKE escape character).
      // We use sql.raw() instead of the sql`` tagged template because Drizzle's
      // parameterized template cannot mix multiple ${param} substitutions inside a
      // UNION ALL query without generating invalid SQL (it produces separate $N
      // placeholders across UNION branches which PostgreSQL rejects at parse time).
      const safe = q.replace(/\\/g, "\\\\").replace(/'/g, "''");
      const term = `%${safe}%`;
      const safePrefix = `${safe}%`;
      // Phase 5 — decompacted matching: "portcredit" finds "Port Credit Marina"
      // Strip spaces from BOTH the query and the indexed field, then ILIKE-match.
      // This handles run-together queries (portcredit, barriemarina) and also
      // camelCase / run-together field values with no extra infrastructure.
      const safeNorm = safe.replace(/ /g, '');
      const termNorm = `%${safeNorm}%`;

      // Each UNION branch MUST be wrapped in parentheses so that LIMIT applies
      // per-branch. Without parentheses PostgreSQL parses LIMIT as belonging to
      // the first SELECT only and raises "syntax error at or near UNION".
      //
      // contacts and opportunities do NOT have an account_name column — they
      // store account_id as a foreign key. A LEFT JOIN is required to resolve the
      // human-readable account name for the search sub-label (sub2 field).
      //
      // Lead branch uses a ranked subquery so exact/prefix company matches surface
      // above partial-company, contact-name, and city-only matches.
      //
      // Phase 6 — sub-label enrichment:
      //   accounts → status + "city, state_province"
      //   opportunities → stage + account name
      const result = await db.execute(sql.raw(`
        (SELECT 'account' as type, a.id::text, a.name as label, a.lead_status as sub,
          TRIM(COALESCE(a.city,'') || CASE WHEN a.state_province IS NOT NULL AND a.state_province <> '' THEN ', ' || a.state_province ELSE '' END) as sub2,
          NULL as linked_id
         FROM accounts a
         WHERE a.name ILIKE '${term}'
            OR LOWER(REPLACE(a.name, ' ', '')) ILIKE LOWER('${termNorm}')
         LIMIT 5)
        UNION ALL
        (SELECT 'contact' as type, c.id::text, (COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')) as label,
                c.email as sub, ac.name as sub2, NULL as linked_id
         FROM contacts c LEFT JOIN accounts ac ON c.account_id = ac.id
         WHERE (c.first_name || ' ' || c.last_name) ILIKE '${term}' OR c.email ILIKE '${term}' LIMIT 5)
        UNION ALL
        (SELECT 'opportunity' as type, o.id::text, o.title as label,
                o.stage as sub,
                COALESCE(ac.name,'') || CASE WHEN o.amount IS NOT NULL THEN '  ·  $' || TRIM(TO_CHAR(o.amount, 'FM999,999,999')) ELSE '' END as sub2,
                NULL as linked_id
         FROM opportunities o LEFT JOIN accounts ac ON o.account_id = ac.id
         WHERE o.title ILIKE '${term}' OR ac.name ILIKE '${term}' LIMIT 5)
        UNION ALL
        (SELECT type, id, label, sub, sub2, linked_id FROM (
          SELECT 'lead' as type, l.id::text as id, l.company as label, l.status as sub,
            TRIM(COALESCE(l.city,'') || CASE WHEN l.state IS NOT NULL AND l.state <> '' THEN ', ' || l.state ELSE '' END) as sub2,
            NULL::text as linked_id,
            CASE
              WHEN LOWER(l.company) = LOWER('${safe}')                                 THEN 0
              WHEN l.company        ILIKE '${safePrefix}'                               THEN 1
              WHEN l.company        ILIKE '${term}'                                     THEN 2
              WHEN LOWER(REPLACE(l.company, ' ', '')) ILIKE LOWER('${termNorm}')        THEN 3
              WHEN l.contact_name   ILIKE '${term}'                                     THEN 4
              ELSE 5
            END as _rank
          FROM leads l
          WHERE l.company      ILIKE '${term}'
             OR l.contact_name ILIKE '${term}'
             OR l.city         ILIKE '${term}'
             OR LOWER(REPLACE(l.company, ' ', '')) ILIKE LOWER('${termNorm}')
          ORDER BY _rank, l.company
          LIMIT 5
        ) _ranked_leads)
        UNION ALL
        (SELECT 'note' as type, n.id::text, SUBSTRING(n.content, 1, 90) as label,
                n.linked_object_type as sub, NULL as sub2, n.linked_object_id::text as linked_id
         FROM notes n WHERE n.content ILIKE '${term}' LIMIT 4)
        LIMIT 24
      `));
      res.json({ results: result.rows });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Stage 3 — Tags ─────────────────────────────────────────────────────
  app.get("/api/tags", requireAuth, async (req, res) => {
    try {
      const { category } = req.query as Record<string, string>;
      const data = await storage.getTags(category || undefined);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/tags", requireAuth, async (req, res) => {
    try {
      const tag = await storage.createTag(req.body);
      res.status(201).json(tag);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Global tag deletion removes the tag for every record that uses it —
  // scoped to admin-only to prevent accidental shared-vocabulary destruction.
  app.delete("/api/tags/:id", requireAdmin, async (req, res) => {
    try {
      const ok = await storage.deleteTag(Number(req.params.id));
      if (!ok) return res.status(404).json({ message: "Not found" });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/record-tags", requireAuth, async (req, res) => {
    try {
      const { recordType, recordId } = req.query as Record<string, string>;
      if (!recordType || !recordId) return res.status(400).json({ message: "recordType and recordId required" });
      const data = await storage.getRecordTags(recordType, Number(recordId));
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/record-tags", requireAuth, async (req, res) => {
    try {
      const rt = await storage.addRecordTag(req.body);
      res.status(201).json(rt);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/record-tags", requireAuth, async (req, res) => {
    try {
      const { tagId, recordType, recordId } = req.query as Record<string, string>;
      if (!tagId || !recordType || !recordId) return res.status(400).json({ message: "tagId, recordType, recordId required" });
      const ok = await storage.removeRecordTag(Number(tagId), recordType, Number(recordId));
      if (!ok) return res.status(404).json({ message: "Not found" });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Stage 3 — Saved Views ───────────────────────────────────────────────
  app.get("/api/saved-views", requireAuth, async (req, res) => {
    try {
      const { pageKey } = req.query as Record<string, string>;
      if (!pageKey) return res.status(400).json({ message: "pageKey required" });
      const userId = getSessionUserId(req);
      const data = await storage.getSavedViews(pageKey, userId);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/saved-views", requireAuth, async (req, res) => {
    try {
      const { pageKey, filtersJson, columnsJson, sortBy, sortOrder, isShared } = req.body;
      const name = requireName(req.body.name);
      if (!name) return res.status(400).json({ message: "name is required" });
      if (!pageKey) return res.status(400).json({ message: "pageKey is required" });
      const userId = getSessionUserId(req);
      const view = await storage.createSavedView({ name, pageKey, filtersJson, columnsJson, sortBy, sortOrder, isShared, userId });
      res.status(201).json(view);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/saved-views/:id", requireAuth, async (req, res) => {
    try {
      const view = await storage.updateSavedView(Number(req.params.id), req.body);
      if (!view) return res.status(404).json({ message: "Not found" });
      res.json(view);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/saved-views/:id", requireAuth, async (req, res) => {
    try {
      const userId = getSessionUserId(req);
      const result = await storage.deleteSavedView(Number(req.params.id), userId);
      if (result === "not_found") return res.status(404).json({ message: "Not found" });
      if (result === "forbidden") return res.status(403).json({ message: "Cannot delete another user's saved view" });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PATCH /api/saved-views/:id/set-default — mark one view as default for a pageKey
  app.patch("/api/saved-views/:id/set-default", requireAuth, async (req, res) => {
    try {
      const userId = getSessionUserId(req)!;
      const id = Number(req.params.id);
      await db.execute(sql.raw(`
        UPDATE saved_views sv
        SET is_default = (sv.id = ${id})
        WHERE sv.page_key = (SELECT page_key FROM saved_views WHERE id = ${id})
          AND (sv.user_id = ${userId} OR sv.is_shared = true)
      `));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Bulk Actions — Leads ───────────────────────────────────────────────────
  app.post("/api/leads/bulk/assign", requirePermission("crm", "edit"), async (req, res) => {
    try {
      const { leadIds, ownerUserId } = req.body as { leadIds: number[]; ownerUserId: number };
      if (!Array.isArray(leadIds) || !leadIds.length) return res.status(400).json({ message: "leadIds required" });
      if (!ownerUserId) return res.status(400).json({ message: "ownerUserId required" });
      const ids = leadIds.map(Number).filter(Boolean);
      const owner = Number(ownerUserId);
      await db.execute(sql.raw(`UPDATE leads SET owner_user_id = ${owner}, updated_at = NOW() WHERE id = ANY(ARRAY[${ids.join(",")}])`));
      res.json({ ok: true, updated: ids.length });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/leads/bulk/status", requirePermission("crm", "edit"), async (req, res) => {
    try {
      const { leadIds, status } = req.body as { leadIds: number[]; status: string };
      if (!Array.isArray(leadIds) || !leadIds.length) return res.status(400).json({ message: "leadIds required" });
      if (!status) return res.status(400).json({ message: "status required" });
      const ids = leadIds.map(Number).filter(Boolean);
      const safe = status.replace(/'/g, "");
      await db.execute(sql.raw(`UPDATE leads SET status = '${safe}', updated_at = NOW() WHERE id = ANY(ARRAY[${ids.join(",")}])`));
      res.json({ ok: true, updated: ids.length });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/leads/bulk/archive", requirePermission("crm", "edit"), async (req, res) => {
    try {
      const { leadIds } = req.body as { leadIds: number[] };
      if (!Array.isArray(leadIds) || !leadIds.length) return res.status(400).json({ message: "leadIds required" });
      const ids = leadIds.map(Number).filter(Boolean);
      await db.execute(sql.raw(`UPDATE leads SET status = 'archived', updated_at = NOW() WHERE id = ANY(ARRAY[${ids.join(",")}])`));
      res.json({ ok: true, updated: ids.length });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/leads/bulk/task", requirePermission("crm", "edit"), async (req, res) => {
    try {
      const userId = getSessionUserId(req)!;
      const { leadIds, title, dueDate } = req.body as { leadIds: number[]; title: string; dueDate?: string };
      if (!Array.isArray(leadIds) || !leadIds.length) return res.status(400).json({ message: "leadIds required" });
      if (!title?.trim()) return res.status(400).json({ message: "title required" });
      const ids = leadIds.map(Number).filter(Boolean);
      const due = dueDate ? `'${new Date(dueDate).toISOString()}'` : "NULL";
      const safeTitle = title.trim().replace(/'/g, "''");
      let created = 0;
      for (const id of ids) {
        await db.execute(sql.raw(`
          INSERT INTO tasks (title, status, owner_user_id, linked_object_type, linked_object_id, due_date, created_at, updated_at)
          VALUES ('${safeTitle}', 'pending', ${userId}, 'lead', ${id}, ${due}, NOW(), NOW())
        `));
        created++;
      }
      res.json({ ok: true, created });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ─── Bulk Actions — Accounts ────────────────────────────────────────────────
  app.post("/api/accounts/bulk/assign", requirePermission("crm", "edit"), async (req, res) => {
    try {
      const { accountIds, ownerUserId } = req.body as { accountIds: number[]; ownerUserId: number };
      if (!Array.isArray(accountIds) || !accountIds.length) return res.status(400).json({ message: "accountIds required" });
      if (!ownerUserId) return res.status(400).json({ message: "ownerUserId required" });
      const ids = accountIds.map(Number).filter(Boolean);
      await db.execute(sql.raw(`UPDATE accounts SET assigned_to_user_id = ${Number(ownerUserId)}, updated_at = NOW() WHERE id = ANY(ARRAY[${ids.join(",")}])`));
      res.json({ ok: true, updated: ids.length });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/accounts/bulk/tag", requirePermission("crm", "edit"), async (req, res) => {
    try {
      const { accountIds, tagId } = req.body as { accountIds: number[]; tagId: number };
      if (!Array.isArray(accountIds) || !accountIds.length) return res.status(400).json({ message: "accountIds required" });
      if (!tagId) return res.status(400).json({ message: "tagId required" });
      const ids = accountIds.map(Number).filter(Boolean);
      const tid = Number(tagId);
      let added = 0;
      for (const id of ids) {
        await db.execute(sql.raw(`
          INSERT INTO record_tags (tag_id, record_type, record_id, created_at)
          VALUES (${tid}, 'account', ${id}, NOW())
          ON CONFLICT DO NOTHING
        `));
        added++;
      }
      res.json({ ok: true, added });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/accounts/bulk/task", requirePermission("crm", "edit"), async (req, res) => {
    try {
      const userId = getSessionUserId(req)!;
      const { accountIds, title, dueDate } = req.body as { accountIds: number[]; title: string; dueDate?: string };
      if (!Array.isArray(accountIds) || !accountIds.length) return res.status(400).json({ message: "accountIds required" });
      if (!title?.trim()) return res.status(400).json({ message: "title required" });
      const ids = accountIds.map(Number).filter(Boolean);
      const due = dueDate ? `'${new Date(dueDate).toISOString()}'` : "NULL";
      const safeTitle = title.trim().replace(/'/g, "''");
      let created = 0;
      for (const id of ids) {
        await db.execute(sql.raw(`
          INSERT INTO tasks (title, status, owner_user_id, linked_object_type, linked_object_id, due_date, created_at, updated_at)
          VALUES ('${safeTitle}', 'pending', ${userId}, 'account', ${id}, ${due}, NOW(), NOW())
        `));
        created++;
      }
      res.json({ ok: true, created });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ─── Bulk Actions — Contacts ────────────────────────────────────────────────
  app.post("/api/contacts/bulk/tag", requirePermission("crm", "edit"), async (req, res) => {
    try {
      const { contactIds, tagId, tagName } = req.body as { contactIds: number[]; tagId?: number; tagName?: string };
      if (!Array.isArray(contactIds) || !contactIds.length) return res.status(400).json({ message: "contactIds required" });
      let tid: number | null = tagId ? Number(tagId) : null;
      if (!tid && tagName) {
        const safeName = tagName.trim().replace(/'/g, "''");
        const existing = await db.execute(sql.raw(`SELECT id FROM tags WHERE name = '${safeName}' LIMIT 1`));
        if (existing.rows.length > 0) {
          tid = Number((existing.rows[0] as any).id);
        } else {
          const inserted = await db.execute(sql.raw(`INSERT INTO tags (name, color, created_at) VALUES ('${safeName}', '#6366f1', NOW()) RETURNING id`));
          tid = Number((inserted.rows[0] as any).id);
        }
      }
      if (!tid) return res.status(400).json({ message: "tagId or tagName required" });
      const ids = contactIds.map(Number).filter(Boolean);
      for (const id of ids) {
        await db.execute(sql.raw(`
          INSERT INTO record_tags (tag_id, record_type, record_id, created_at)
          VALUES (${tid}, 'contact', ${id}, NOW())
          ON CONFLICT DO NOTHING
        `));
      }
      res.json({ ok: true, added: ids.length });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/contacts/bulk/task", requirePermission("crm", "edit"), async (req, res) => {
    try {
      const userId = getSessionUserId(req)!;
      const { contactIds, title, dueDate } = req.body as { contactIds: number[]; title: string; dueDate?: string };
      if (!Array.isArray(contactIds) || !contactIds.length) return res.status(400).json({ message: "contactIds required" });
      if (!title?.trim()) return res.status(400).json({ message: "title required" });
      const ids = contactIds.map(Number).filter(Boolean);
      const due = dueDate ? `'${new Date(dueDate).toISOString()}'` : "NULL";
      const safeTitle = title.trim().replace(/'/g, "''");
      let created = 0;
      for (const id of ids) {
        await db.execute(sql.raw(`
          INSERT INTO tasks (title, status, owner_user_id, linked_object_type, linked_object_id, due_date, created_at, updated_at)
          VALUES ('${safeTitle}', 'pending', ${userId}, 'contact', ${id}, ${due}, NOW(), NOW())
        `));
        created++;
      }
      res.json({ ok: true, created });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ─── Bulk Actions — Opportunities ──────────────────────────────────────────
  app.post("/api/opportunities/bulk/assign", requirePermission("crm", "edit"), async (req, res) => {
    try {
      const { opportunityIds, ownerUserId } = req.body as { opportunityIds: number[]; ownerUserId: number };
      if (!Array.isArray(opportunityIds) || !opportunityIds.length) return res.status(400).json({ message: "opportunityIds required" });
      if (!ownerUserId) return res.status(400).json({ message: "ownerUserId required" });
      const ids = opportunityIds.map(Number).filter(Boolean);
      await db.execute(sql.raw(`UPDATE opportunities SET owner_user_id = ${Number(ownerUserId)}, updated_at = NOW() WHERE id = ANY(ARRAY[${ids.join(",")}])`));
      res.json({ ok: true, updated: ids.length });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/opportunities/bulk/stage", requirePermission("crm", "edit"), async (req, res) => {
    try {
      const { opportunityIds, stage } = req.body as { opportunityIds: number[]; stage: string };
      if (!Array.isArray(opportunityIds) || !opportunityIds.length) return res.status(400).json({ message: "opportunityIds required" });
      if (!stage) return res.status(400).json({ message: "stage required" });
      const ids = opportunityIds.map(Number).filter(Boolean);
      const safe = stage.replace(/'/g, "");
      await db.execute(sql.raw(`UPDATE opportunities SET stage = '${safe}', updated_at = NOW() WHERE id = ANY(ARRAY[${ids.join(",")}])`));
      res.json({ ok: true, updated: ids.length });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/opportunities/bulk/task", requirePermission("crm", "edit"), async (req, res) => {
    try {
      const userId = getSessionUserId(req)!;
      const { opportunityIds, title, dueDate } = req.body as { opportunityIds: number[]; title: string; dueDate?: string };
      if (!Array.isArray(opportunityIds) || !opportunityIds.length) return res.status(400).json({ message: "opportunityIds required" });
      if (!title?.trim()) return res.status(400).json({ message: "title required" });
      const ids = opportunityIds.map(Number).filter(Boolean);
      const due = dueDate ? `'${new Date(dueDate).toISOString()}'` : "NULL";
      const safeTitle = title.trim().replace(/'/g, "''");
      let created = 0;
      for (const id of ids) {
        await db.execute(sql.raw(`
          INSERT INTO tasks (title, status, owner_user_id, linked_object_type, linked_object_id, due_date, created_at, updated_at)
          VALUES ('${safeTitle}', 'pending', ${userId}, 'opportunity', ${id}, ${due}, NOW(), NOW())
        `));
        created++;
      }
      res.json({ ok: true, created });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ─── Bulk Actions — Tasks (priority, in addition to complete/reassign/snooze) ─
  app.post("/api/tasks/bulk/priority", requirePermission("crm", "edit"), async (req, res) => {
    try {
      const { taskIds, priority } = req.body as { taskIds: number[]; priority: string };
      if (!Array.isArray(taskIds) || !taskIds.length) return res.status(400).json({ message: "taskIds required" });
      const validPriorities = ["low", "medium", "high", "urgent"];
      if (!validPriorities.includes(priority)) return res.status(400).json({ message: "priority must be low|medium|high|urgent" });
      const ids = taskIds.map(Number).filter(Boolean);
      await db.execute(sql.raw(`UPDATE tasks SET priority = '${priority}', updated_at = NOW() WHERE id = ANY(ARRAY[${ids.join(",")}])`));
      res.json({ ok: true, updated: ids.length });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ─── Stage 3 — Opportunity Contacts ────────────────────────────────────
  app.get("/api/opportunities/:id/contacts", requireAuth, async (req, res) => {
    try {
      const data = await storage.getOpportunityContacts(Number(req.params.id));
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/opportunities/:id/contacts", requirePermission("crm", "edit"), async (req, res) => {
    try {
      const oc = await storage.addOpportunityContact({ ...req.body, opportunityId: Number(req.params.id) });
      res.status(201).json(oc);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/opportunities/:id/contacts/:contactId", requirePermission("crm", "edit"), async (req, res) => {
    try {
      const ok = await storage.removeOpportunityContact(Number(req.params.id), Number(req.params.contactId));
      if (!ok) return res.status(404).json({ message: "Not found" });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Mail Folders ────────────────────────────────────────────────────────

  app.get("/api/mail-folders", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const folders = await db.select().from(mailFolders).where(eq(mailFolders.ownerUserId, userId));
      // Attach domain count + unread count per folder
      const enriched = await Promise.all(folders.map(async (f) => {
        const domains = await db.select().from(mailFolderDomains).where(eq(mailFolderDomains.folderId, f.id));
        const assignments = await db.select({ emailId: emailFolderAssignments.emailId })
          .from(emailFolderAssignments).where(eq(emailFolderAssignments.folderId, f.id));
        const emailIds = assignments.map(a => a.emailId);
        let unreadCount = 0;
        if (emailIds.length > 0) {
          const unread = await db.select({ id: emailMessages.id }).from(emailMessages)
            .where(and(
              inArray(emailMessages.id, emailIds),
              sql`email_messages.label_ids ILIKE '%UNREAD%'`
            ));
          unreadCount = unread.length;
        }
        return { ...f, domains, emailCount: emailIds.length, unreadCount };
      }));
      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/mail-folders", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const { name, color, sourceAccountId } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "Name is required" });
      const [folder] = await db.insert(mailFolders).values({
        ownerUserId: userId,
        name: name.trim(),
        color: color || "teal",
        sourceAccountId: sourceAccountId ?? null,
      }).returning();
      res.status(201).json(folder);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/mail-folders/:id", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const folderId = Number(req.params.id);
      const { name, color } = req.body;
      const [updated] = await db.update(mailFolders)
        .set({ name: name?.trim(), color, updatedAt: new Date() })
        .where(and(eq(mailFolders.id, folderId), eq(mailFolders.ownerUserId, userId)))
        .returning();
      if (!updated) return res.status(404).json({ message: "Folder not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/mail-folders/:id", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const folderId = Number(req.params.id);
      await db.delete(mailFolders)
        .where(and(eq(mailFolders.id, folderId), eq(mailFolders.ownerUserId, userId)));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Folder domain rules
  app.get("/api/mail-folders/:id/domains", requireAuth, async (req, res) => {
    try {
      const domains = await db.select().from(mailFolderDomains)
        .where(eq(mailFolderDomains.folderId, Number(req.params.id)));
      res.json(domains);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/mail-folders/:id/domains", requireAuth, async (req, res) => {
    try {
      const folderId = Number(req.params.id);
      const { domain, matchType } = req.body;
      if (!domain?.trim()) return res.status(400).json({ message: "Domain is required" });
      const { normalizeDomain } = await import("./services/email-folder-router");
      const normalized = normalizeDomain(domain);
      const [d] = await db.insert(mailFolderDomains).values({
        folderId,
        domain: normalized,
        matchType: matchType || "ends_with",
      }).onConflictDoNothing().returning();
      res.status(201).json(d || { folderId, domain: normalized, matchType: matchType || "ends_with" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/mail-folders/:id/domains/:domainId", requireAuth, async (req, res) => {
    try {
      await db.delete(mailFolderDomains).where(eq(mailFolderDomains.id, Number(req.params.domainId)));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Folder emails view
  app.get("/api/mail-folders/:id/emails", requireAuth, async (req, res) => {
    try {
      const folderId = Number(req.params.id);
      const userId = (req.session as any).userId;
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const offset = Number(req.query.offset) || 0;

      const assignments = await db.select({ emailId: emailFolderAssignments.emailId })
        .from(emailFolderAssignments)
        .where(and(
          eq(emailFolderAssignments.folderId, folderId),
          eq(emailFolderAssignments.ownerUserId, userId)
        ));

      const emailIds = assignments.map(a => a.emailId);
      if (emailIds.length === 0) return res.json([]);

      const emails = await db.select().from(emailMessages)
        .where(inArray(emailMessages.id, emailIds.slice(offset, offset + limit)))
        .orderBy(sql`sent_at DESC`);

      res.json(emails);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Backfill existing emails into a folder
  app.post("/api/mail-folders/:id/backfill", requireAuth, async (req, res) => {
    try {
      const folderId = Number(req.params.id);
      const userId = (req.session as any).userId;

      const folder = await db.select().from(mailFolders)
        .where(and(eq(mailFolders.id, folderId), eq(mailFolders.ownerUserId, userId)))
        .limit(1);
      if (!folder.length) return res.status(404).json({ message: "Folder not found" });

      // Run async so UI gets immediate response
      res.json({ ok: true, message: "Backfill started" });

      // Fire-and-forget after response
      import("./services/email-folder-router").then(({ backfillFolderEmails }) => {
        backfillFolderEmails(folderId, userId).then(result => {
          console.log(`[backfill] Folder ${folderId}: processed=${result.processed}, assigned=${result.assigned}`);
        });
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Manual remove email from folder
  app.delete("/api/mail-folders/:id/emails/:emailId", requireAuth, async (req, res) => {
    try {
      await db.delete(emailFolderAssignments).where(
        and(
          eq(emailFolderAssignments.folderId, Number(req.params.id)),
          eq(emailFolderAssignments.emailId, Number(req.params.emailId))
        )
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Create folder from account (pre-filled)
  app.post("/api/mail-folders/from-account", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const { accountId, name, domains } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "Name is required" });

      const [folder] = await db.insert(mailFolders).values({
        ownerUserId: userId,
        name: name.trim(),
        color: "teal",
        sourceAccountId: accountId ?? null,
      }).returning();

      const { normalizeDomain } = await import("./services/email-folder-router");
      const insertedDomains = [];
      for (const rawDomain of (domains || [])) {
        const nd = normalizeDomain(rawDomain);
        if (!nd) continue;
        const [d] = await db.insert(mailFolderDomains).values({
          folderId: folder.id,
          domain: nd,
          matchType: "ends_with",
        }).onConflictDoNothing().returning();
        if (d) insertedDomains.push(d);
      }

      res.status(201).json({ ...folder, domains: insertedDomains });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Relationship Intelligence ───────────────────────────────────────────────
  app.get("/api/relationships/intelligence", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const { isAdmin, mailTeamPerms } = await getSessionUserAccess(req.session);
      // Only analyse emails from accounts this user can access
      const accessibleIds = await getAccessibleAccountIds(userId, isAdmin, mailTeamPerms);
      if (accessibleIds.length === 0) {
        return res.json({ period: 30, cards: { totalExternal: 0, activeRelationships: 0, dormantRelationships: 0, newRelationships: 0, unlinkedSenders: 0 }, mostActive: [], neglected: [], orgsByVolume: [], unlinkedSenders: [], trend: [] });
      }
      const accountIdList = accessibleIds.join(",");
      const accountFilter = `em.source_account_id IN (${accountIdList})`;

      const days = parseInt(req.query.days as string) || 30;
      const PERSONAL_DOMAINS = [
        "gmail.com","yahoo.com","outlook.com","hotmail.com","icloud.com",
        "me.com","aol.com","msn.com","ymail.com","googlemail.com",
        "protonmail.com","live.com","mac.com",
      ];
      const personalList = PERSONAL_DOMAINS.map(d => `'${d}'`).join(",");
      const periodFilter = days > 0 ? `AND em.sent_at >= NOW() - INTERVAL '${days} days'` : "";
      const externalFilter = `
        em.from_email IS NOT NULL AND em.from_email != ''
        AND em.from_email NOT ILIKE '%@voltsafe.com'
        AND LOWER(SPLIT_PART(em.from_email,'@',2)) NOT IN (${personalList})
        AND (em.bulk_email_score < 40 OR em.bulk_email_score IS NULL)
        AND (em.auto_generated_score < 40 OR em.auto_generated_score IS NULL)
      `;

      // Cards ──────────────────────────────────────────────────────────────────
      const cardsResult = await db.execute(sql.raw(`
        SELECT
          (SELECT COUNT(DISTINCT em.from_email)
           FROM email_messages em
           WHERE ${accountFilter} AND ${externalFilter} ${periodFilter}) AS total_external,
          (SELECT COUNT(DISTINCT em.from_email)
           FROM email_messages em
           LEFT JOIN contacts c ON LOWER(c.email) = LOWER(em.from_email)
           WHERE ${accountFilter} AND ${externalFilter} ${periodFilter}
             AND c.id IS NULL) AS unlinked_senders
      `));

      // Separate active count (contacts with 2+ messages in period)
      const activeResult = await db.execute(sql.raw(`
        SELECT COUNT(*) AS cnt FROM (
          SELECT ea.object_id
          FROM email_associations ea
          JOIN email_messages em ON em.id = ea.email_message_id
          WHERE ea.object_type = 'contact' AND ${accountFilter} ${periodFilter}
          GROUP BY ea.object_id
          HAVING COUNT(em.id) >= 2
        ) sub
      `));

      // Separate dormant count (contacts with history, no email in 60d)
      const dormantResult = await db.execute(sql.raw(`
        SELECT COUNT(*) AS cnt FROM (
          SELECT ea.object_id
          FROM email_associations ea
          JOIN email_messages em ON em.id = ea.email_message_id
          WHERE ea.object_type = 'contact' AND ${accountFilter}
          GROUP BY ea.object_id
          HAVING MAX(em.sent_at) < NOW() - INTERVAL '60 days'
        ) sub
      `));

      // New relationships: contacts whose first associated message is in period
      const newRelsResult = await db.execute(sql.raw(`
        SELECT COUNT(*) AS cnt FROM (
          SELECT ea.object_id
          FROM email_associations ea
          JOIN email_messages em ON em.id = ea.email_message_id
          WHERE ea.object_type = 'contact' AND ${accountFilter}
          GROUP BY ea.object_id
          HAVING MIN(em.sent_at) >= NOW() - INTERVAL '${days > 0 ? days : 36500} days'
        ) sub
      `));

      const cardRow = (cardsResult.rows as any[])[0] || {};
      const cards = {
        totalExternal: parseInt(cardRow.total_external || "0"),
        activeRelationships: parseInt((activeResult.rows as any[])[0]?.cnt || "0"),
        dormantRelationships: parseInt((dormantResult.rows as any[])[0]?.cnt || "0"),
        newRelationships: parseInt((newRelsResult.rows as any[])[0]?.cnt || "0"),
        unlinkedSenders: parseInt(cardRow.unlinked_senders || "0"),
      };

      // Most Active Contacts ───────────────────────────────────────────────────
      const mostActiveResult = await db.execute(sql.raw(`
        SELECT
          c.id AS contact_id,
          c.name AS contact_name,
          a.id AS account_id,
          a.name AS account_name,
          a.org_type,
          COUNT(DISTINCT em.id) AS message_count,
          MAX(em.sent_at) AS last_activity
        FROM email_associations ea
        JOIN email_messages em ON em.id = ea.email_message_id
        JOIN contacts c ON c.id = ea.object_id AND ea.object_type = 'contact'
        LEFT JOIN accounts a ON a.id = c.account_id
        WHERE ${accountFilter} ${periodFilter}
        GROUP BY c.id, c.name, a.id, a.name, a.org_type
        ORDER BY message_count DESC, last_activity DESC
        LIMIT 15
      `));

      // Neglected Relationships ─────────────────────────────────────────────────
      const neglectedResult = await db.execute(sql.raw(`
        SELECT
          c.id AS contact_id,
          c.name AS contact_name,
          a.id AS account_id,
          a.name AS account_name,
          a.org_type,
          MAX(em.sent_at) AS last_activity,
          EXTRACT(DAY FROM NOW() - MAX(em.sent_at))::integer AS days_since_contact
        FROM email_associations ea
        JOIN email_messages em ON em.id = ea.email_message_id
        JOIN contacts c ON c.id = ea.object_id AND ea.object_type = 'contact'
        LEFT JOIN accounts a ON a.id = c.account_id
        WHERE ${accountFilter}
        GROUP BY c.id, c.name, a.id, a.name, a.org_type
        HAVING MAX(em.sent_at) < NOW() - INTERVAL '30 days'
        ORDER BY last_activity ASC
        LIMIT 15
      `));

      // Orgs by Volume ─────────────────────────────────────────────────────────
      const orgsByVolumeResult = await db.execute(sql.raw(`
        SELECT
          a.id AS account_id,
          a.name AS account_name,
          a.org_type,
          COUNT(DISTINCT CASE WHEN ea.object_type = 'contact' THEN ea.object_id END) AS contact_count,
          COUNT(DISTINCT em.id) AS message_count,
          MAX(em.sent_at) AS last_activity
        FROM email_associations ea
        JOIN email_messages em ON em.id = ea.email_message_id
        LEFT JOIN contacts c ON c.id = ea.object_id AND ea.object_type = 'contact'
        LEFT JOIN accounts a ON a.id = CASE
          WHEN ea.object_type = 'account' THEN ea.object_id
          ELSE c.account_id
        END
        WHERE a.id IS NOT NULL AND ${accountFilter} ${periodFilter}
        GROUP BY a.id, a.name, a.org_type
        ORDER BY message_count DESC
        LIMIT 10
      `));

      // Unlinked Senders ───────────────────────────────────────────────────────
      const unlinkedResult = await db.execute(sql.raw(`
        SELECT
          em.from_name,
          em.from_email,
          LOWER(SPLIT_PART(em.from_email,'@',2)) AS domain,
          COUNT(DISTINCT em.gmail_thread_id) AS thread_count,
          COUNT(*) AS message_count,
          MAX(em.sent_at) AS last_seen,
          (
            SELECT em2.gmail_thread_id
            FROM email_messages em2
            WHERE LOWER(em2.from_email) = LOWER(em.from_email)
              AND em2.source_account_id IN (${accountIdList})
            ORDER BY em2.sent_at DESC
            LIMIT 1
          ) AS latest_thread_id
        FROM email_messages em
        LEFT JOIN contacts c ON LOWER(c.email) = LOWER(em.from_email)
        WHERE ${accountFilter} AND ${externalFilter} ${periodFilter}
          AND c.id IS NULL
        GROUP BY em.from_name, em.from_email
        ORDER BY message_count DESC, thread_count DESC
        LIMIT 20
      `));

      // Trend (daily message count) ─────────────────────────────────────────────
      const trendDays = days > 0 ? days : 90;
      const trendResult = await db.execute(sql.raw(`
        SELECT
          TO_CHAR(DATE_TRUNC('day', em.sent_at), 'YYYY-MM-DD') AS date,
          COUNT(*) AS count
        FROM email_messages em
        WHERE em.sent_at >= NOW() - INTERVAL '${trendDays} days'
          AND ${accountFilter}
          AND ${externalFilter}
        GROUP BY DATE_TRUNC('day', em.sent_at)
        ORDER BY DATE_TRUNC('day', em.sent_at)
      `));

      res.json({
        period: days,
        cards,
        mostActive: (mostActiveResult.rows as any[]).map(r => ({
          contactId: r.contact_id,
          contactName: r.contact_name,
          accountId: r.account_id,
          accountName: r.account_name,
          orgType: r.org_type,
          messageCount: parseInt(r.message_count),
          lastActivity: r.last_activity,
        })),
        neglected: (neglectedResult.rows as any[]).map(r => ({
          contactId: r.contact_id,
          contactName: r.contact_name,
          accountId: r.account_id,
          accountName: r.account_name,
          orgType: r.org_type,
          lastActivity: r.last_activity,
          daysSinceContact: parseInt(r.days_since_contact),
        })),
        orgsByVolume: (orgsByVolumeResult.rows as any[]).map(r => ({
          accountId: r.account_id,
          accountName: r.account_name,
          orgType: r.org_type,
          contactCount: parseInt(r.contact_count),
          messageCount: parseInt(r.message_count),
          lastActivity: r.last_activity,
        })),
        unlinkedSenders: (unlinkedResult.rows as any[]).map(r => ({
          fromName: r.from_name,
          fromEmail: r.from_email,
          domain: r.domain,
          threadCount: parseInt(r.thread_count),
          messageCount: parseInt(r.message_count),
          lastSeen: r.last_seen,
          latestThreadId: r.latest_thread_id ?? null,
        })),
        trend: (trendResult.rows as any[]).map(r => ({
          date: r.date,
          count: parseInt(r.count),
        })),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Engagement scheduler + default rules ────────────────────────────────────
  seedDefaultRules().catch(err => console.error("[routes] seedDefaultRules error:", err));
  startEngagementScheduler();

  // ── Awaiting-reply: initial computation on boot (non-blocking) ─────────────
  computeAwaitingReply().catch(err => console.error("[routes] computeAwaitingReply boot error:", err));
}
